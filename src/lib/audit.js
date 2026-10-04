// Audit log with undo (spec §5). Passphrase rotations are logged WITHOUT the phrase and are not undoable.
export async function audit(db, { actor, action, entity, entityId, summary, before = null, after = null, undoable = true }) {
  await db.prepare(`INSERT INTO audit_log (actor_email, action, entity, entity_id, summary, before_json, after_json, undoable)
    VALUES (?,?,?,?,?,?,?,?)`).bind(actor, action, entity, String(entityId), summary || null,
    before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), undoable ? 1 : 0).run();
}

const PERSON_COLS = ['id', 'first_name', 'middle', 'last_name', 'birth_surname', 'nickname', 'birth_year', 'death_year', 'is_deceased',
  'adult_confirmed', 'public_ok', 'is_founder', 'memorial', 'bio_md', 'memorial_md', 'avatar_photo_id', 'hidden'];
export const PERSON_EDITABLE = PERSON_COLS.filter((c) => c !== 'id');

async function upsertPerson(db, p) {
  const cols = PERSON_COLS.filter((c) => c in p);
  await db.prepare(`INSERT INTO person (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(...cols.map((c) => p[c] ?? null)).run();
}

/** Undo one audit entry. Returns a summary string or throws. */
export async function undoEntry(db, row, actor) {
  if (!row || row.undone_at) throw new Error('Already undone or missing.');
  if (!row.undoable) throw new Error('This change cannot be undone.');
  const before = row.before_json ? JSON.parse(row.before_json) : null;
  const after = row.after_json ? JSON.parse(row.after_json) : null;
  const k = `${row.entity}:${row.action}`;
  switch (k) {
    case 'person:create': await db.prepare('DELETE FROM person WHERE id=?').bind(row.entity_id).run(); break;
    case 'person:update': case 'person:hide': case 'person:apply_request':
      if (!before) throw new Error('No snapshot.'); await upsertPerson(db, before); break;
    case 'person:delete':
      if (!before?.person) throw new Error('No snapshot.');
      await upsertPerson(db, before.person);
      for (const l of before.parents || []) await db.prepare('INSERT OR IGNORE INTO parent_child (parent_id,child_id,kind,union_id) VALUES (?,?,?,?)').bind(l.parent_id, l.child_id, l.kind, l.union_id).run();
      for (const u of before.unions || []) await db.prepare('INSERT OR IGNORE INTO unions (id,partner_a,partner_b,kind,start_year,end_year,end_reason) VALUES (?,?,?,?,?,?,?)').bind(u.id, u.partner_a, u.partner_b, u.kind, u.start_year, u.end_year, u.end_reason).run();
      for (const b of before.branches || []) await db.prepare('INSERT OR IGNORE INTO person_branch VALUES (?,?)').bind(b.person_id, b.branch_id).run();
      break;
    case 'parent_child:link': await db.prepare('DELETE FROM parent_child WHERE parent_id=? AND child_id=?').bind(after.parent_id, after.child_id).run(); break;
    case 'parent_child:unlink': await db.prepare('INSERT OR IGNORE INTO parent_child (parent_id,child_id,kind,union_id) VALUES (?,?,?,?)').bind(before.parent_id, before.child_id, before.kind, before.union_id).run(); break;
    case 'parent_child:update': await db.prepare('UPDATE parent_child SET kind=? WHERE parent_id=? AND child_id=?').bind(before.kind, before.parent_id, before.child_id).run(); break;
    case 'unions:link': await db.prepare('DELETE FROM unions WHERE id=?').bind(after.id).run(); break;
    case 'unions:unlink': await db.prepare('INSERT OR IGNORE INTO unions (id,partner_a,partner_b,kind,start_year,end_year,end_reason) VALUES (?,?,?,?,?,?,?)').bind(before.id, before.partner_a, before.partner_b, before.kind, before.start_year, before.end_year, before.end_reason).run(); break;
    case 'unions:update': await db.prepare('UPDATE unions SET kind=?, start_year=?, end_year=?, end_reason=? WHERE id=?').bind(before.kind, before.start_year, before.end_year, before.end_reason, before.id).run(); break;
    case 'person_branch:link': await db.prepare('DELETE FROM person_branch WHERE person_id=? AND branch_id=?').bind(after.person_id, after.branch_id).run(); break;
    case 'person_branch:unlink': await db.prepare('INSERT OR IGNORE INTO person_branch VALUES (?,?)').bind(before.person_id, before.branch_id).run(); break;
    case 'photo:delete': case 'photo:hide': case 'photo:update':
      await db.prepare('UPDATE photo SET deleted_at=?, visibility=?, has_minor=?, caption=?, year=? WHERE id=?').bind(before.deleted_at, before.visibility, before.has_minor, before.caption, before.year, row.entity_id).run(); break;
    case 'branch:create': await db.prepare('DELETE FROM branch WHERE id=?').bind(row.entity_id).run(); break;
    case 'branch:update': await db.prepare('UPDATE branch SET display_name=?, slug=?, root_union_id=?, public_blurb=?, sort=? WHERE id=?').bind(before.display_name, before.slug, before.root_union_id, before.public_blurb, before.sort, row.entity_id).run(); break;
    default: throw new Error(`Undo not supported for ${k}.`);
  }
  await db.prepare("UPDATE audit_log SET undone_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(row.id).run();
  await audit(db, { actor, action: 'undo', entity: 'audit_log', entityId: row.id, summary: `Undid: ${row.summary || k}`, undoable: false });
  return row.summary || k;
}
