// Minor + public-visibility rules (spec §4 + reviewer amendments + reviewer fix 7).

/** Request-time minor check. Never stored. No birth year => minor until Chris confirms adult. */
export function isMinor(p, year = new Date().getUTCFullYear()) {
  if (p.adult_confirmed) return false;
  if (p.is_deceased && p.death_year) return false;
  return p.birth_year == null || year - Number(p.birth_year) < 18;
}

/** Eligible for the public page: confirmed adult, opted in, not hidden. (Fix 7: needs adult_confirmed.) */
export const isPublicEligible = (p) => !!p.public_ok && !!p.adult_confirmed && !p.hidden && !isMinor(p);

/** The ONLY shape that may leave the Worker on public routes: first name + role. */
// Public ids are positional (f0, b2...) so no D1 id ever leaves the Worker on public routes.
export function publicPerson(p, role, idx = 0) {
  return { id: `${role[0]}${idx}`, first: String(p.first_name || '').trim().split(/\s+/)[0], role };
}

/** Server-side validation of a person patch. Throws Error(message) on violation. */
export function validatePersonPatch(next) {
  if (!String(next.first_name || '').trim()) throw new Error('First name is required.');
  for (const k of ['birth_year', 'death_year']) {
    const v = next[k];
    if (v != null && v !== '' && (!Number.isInteger(Number(v)) || v < 1500 || v > 2200)) throw new Error(`${k} must be a 4-digit year.`);
  }
  if (next.public_ok && !next.adult_confirmed) throw new Error('"Show first name on public page" needs "Confirmed adult" first.');
  if (next.public_ok && next.hidden) throw new Error('Hidden people cannot be public.');
  if (next.death_year && next.birth_year && Number(next.death_year) < Number(next.birth_year)) throw new Error('Death year is before birth year.');
}

/** Branch slug/display name must not contain any minor's first name (spec §4). */
export function branchNameViolation(slug, displayName, minors) {
  const hay = `${slug} ${displayName}`.toLowerCase();
  for (const m of minors) {
    const f = String(m.first_name || '').trim().toLowerCase();
    if (f.length >= 2 && new RegExp(`(^|[^a-z])${f.replace(/[^a-z]/g, '')}([^a-z]|$)`).test(hay)) return m.first_name;
  }
  return null;
}
