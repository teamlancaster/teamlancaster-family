// Shared D1 queries (admin + public projection). Public routes only call publicTree()/publicSearch().
import { isMinor, isPublicEligible, publicPerson } from './privacy.js';

export const getPerson = (db, id) => db.prepare('SELECT * FROM person WHERE id=?').bind(id).first();

export async function personGraph(db, id) {
  const [parents, children, unions, branches, photos] = await Promise.all([
    db.prepare(`SELECT pc.*, p.first_name, p.last_name, p.birth_year, p.adult_confirmed, p.is_deceased, p.death_year FROM parent_child pc JOIN person p ON p.id=pc.parent_id WHERE pc.child_id=?`).bind(id).all(),
    db.prepare(`SELECT pc.*, p.first_name, p.last_name, p.birth_year, p.adult_confirmed, p.is_deceased, p.death_year FROM parent_child pc JOIN person p ON p.id=pc.child_id WHERE pc.parent_id=?`).bind(id).all(),
    db.prepare(`SELECT u.*, p.id AS other_id, p.first_name, p.last_name FROM unions u JOIN person p ON p.id = CASE WHEN u.partner_a=?1 THEN u.partner_b ELSE u.partner_a END WHERE u.partner_a=?1 OR u.partner_b=?1`).bind(id).all(),
    db.prepare(`SELECT b.id, b.slug, b.display_name FROM person_branch pb JOIN branch b ON b.id=pb.branch_id WHERE pb.person_id=? ORDER BY b.sort`).bind(id).all(),
    db.prepare(`SELECT ph.* FROM photo_tag t JOIN photo ph ON ph.id=t.photo_id WHERE t.person_id=? AND ph.deleted_at IS NULL ORDER BY ph.created_at DESC LIMIT 24`).bind(id).all(),
  ]);
  return { parents: parents.results, children: children.results, unions: unions.results, branches: branches.results, photos: photos.results };
}

/** Would linking parent->child create a cycle (child is already an ancestor of parent)? */
export async function wouldCreateLoop(db, parentId, childId) {
  if (parentId === childId) return true;
  const r = await db.prepare(`WITH RECURSIVE anc(id) AS (SELECT parent_id FROM parent_child WHERE child_id=?1
      UNION SELECT pc.parent_id FROM parent_child pc JOIN anc ON pc.child_id=anc.id) SELECT 1 AS hit FROM anc WHERE id=?2 LIMIT 1`).bind(parentId, childId).first();
  return !!r;
}

export async function minorsList(db) {
  const { results } = await db.prepare('SELECT id, first_name, birth_year, adult_confirmed, is_deceased, death_year FROM person').all();
  return results.filter((p) => isMinor(p));
}

/**
 * The public projection: founders + branch parents who are public-eligible. FIRST NAMES ONLY.
 * Ineligible branch parents appear as a lock-only star with no name.
 */
export async function publicTree(db) {
  const founders = (await db.prepare('SELECT * FROM person WHERE is_founder=1 ORDER BY birth_year, id LIMIT 2').all()).results;
  const { results: branches } = await db.prepare(`SELECT b.id, b.sort, u.partner_a, u.partner_b FROM branch b LEFT JOIN unions u ON u.id=b.root_union_id ORDER BY b.sort, b.id`).all();
  const ids = [...new Set(branches.flatMap((b) => [b.partner_a, b.partner_b]).filter(Boolean))];
  const people = ids.length ? (await db.prepare(`SELECT * FROM person WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results : [];
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const founderIds = new Set(founders.map((f) => f.id));
  const out = {
    founders: founders.filter(isPublicEligible).map((p, i) => publicPerson(p, 'founder', i)),
    branches: branches.map((b, i) => {
      // Prefer the partner who is a child of the founders (the "branch parent").
      const cands = [b.partner_a, b.partner_b].map((id) => byId[id]).filter(Boolean).filter((p) => !founderIds.has(p.id));
      const p = cands.find(isPublicEligible);
      return p ? { ...publicPerson(p, 'branch', i), star: i } : { id: `b${i}`, first: null, role: 'branch', star: i };
    }),
  };
  return out;
}

export async function publicSearch(db, q) {
  const t = String(q || '').trim().toLowerCase().slice(0, 40);
  if (!t) return [];
  const tree = await publicTree(db);
  return [...tree.founders, ...tree.branches.filter((b) => b.first)].filter((p) => p.first.toLowerCase().includes(t)).slice(0, 10);
}
