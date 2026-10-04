// Server-rendered admin pages (match plans/mockup/admin-*.png). Reached only after requireAdmin().
import { esc, html, notFound } from '../lib/http.js';
import { head } from './layout.js';
import { isMinor } from '../lib/privacy.js';
import { personGraph } from '../lib/data.js';

const NAV = [['Dashboard', '/admin'], ['People', '/admin/people'], ['Branches', '/admin/branches'], ['Photos', '/admin/photos'],
  ['Requests', '/admin/requests'], ['Stories & AI', '/admin/ai'], ['Backups', '/admin/backups']];
const full = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ');
const ini = (s) => esc(String(s || '?').trim()[0] || '?').toUpperCase();
const firstOf = (email) => { const n = String(email).split('@')[0].split(/[._-]/)[0]; return n ? n[0].toUpperCase() + n.slice(1) : 'there'; };

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  if (s < 86400 * 365) return `${Math.round(s / (86400 * 30))} months ago`;
  return `${Math.round(s / (86400 * 365))} years ago`;
}

function shell(title, on, body, { admin, pending = 0, data = null }) {
  const nav = NAV.map(([n, href]) => `<a class="${n === on ? 'on' : ''}" href="${href}"><i></i>${n}${n === 'Requests' && pending ? `<span class="badge">${pending}</span>` : ''}</a>`).join('');
  return `${head(`${title} · Admin · Team Lancaster`, '<script src="/assets/admin.js" defer></script>')}
<body class="adm"><div class="stars"></div><div class="grid"></div>
<aside class="side"><a class="brand" href="/admin" style="text-decoration:none"><img src="/assets/lancaster-arms.webp" alt="">Team Lancaster</a><div class="tag">Admin</div><nav class="nav">${nav}</nav>
<div class="who">Signed in as <b>${esc(firstOf(admin.email))}</b> via Cloudflare email link<br><span class="small">${admin.dev ? 'LOCAL DEV bypass (localhost only)' : 'Cloudflare Access &middot; session 24 h'}</span></div></aside>
<main class="main">${body}</main>
${data ? `<script type="application/json" id="page-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>` : ''}
<div class="toast" id="toast"></div></body></html>`;
}

async function pendingCount(db) { return (await db.prepare("SELECT COUNT(*) n FROM change_request WHERE status='pending'").first()).n; }
async function peopleIndex(db) {
  return (await db.prepare('SELECT id, first_name, last_name, birth_year, adult_confirmed, is_deceased, death_year FROM person ORDER BY first_name, last_name').all()).results
    .map((p) => ({ id: p.id, name: full(p), minor: isMinor(p) }));
}

function requestCard(r) {
  const tag = r.source === 'public' ? '<span class="chip ox" title="Public form: the sender\'s name is not verified">Public &middot; name not verified</span>'
    : `<span class="chip br">${esc(r.branch_name || 'Branch')}</span>`;
  const kindChip = r.kind === 'photo_removal' ? '<span class="chip ox" style="margin-left:auto">Photo removal</span>' : r.kind === 'privacy' ? '<span class="chip ox" style="margin-left:auto">Privacy</span>' : '';
  return `<div class="req" id="r${r.id}"><div style="display:flex;gap:10px;align-items:center">${tag}<span class="small">#${r.id} &middot; from ${esc(r.requester_name)} &middot; ${ago(r.created_at)}</span></div>
 <p><span class="small">About: ${esc(r.person_text)}</span><br>&ldquo;${esc(r.change_text)}&rdquo;</p>
 <div class="acts"><button class="btn sm pri" data-review="${r.id}">Review &amp; apply</button><button class="btn sm ox" data-hidenow="${r.id}">Hide now</button><button class="btn sm" data-act="POST /api/admin/requests/${r.id}/dismiss" data-confirm="Dismiss request #${r.id}?">Dismiss</button>${kindChip}</div></div>`;
}

const REVIEW_DIALOG = `<dialog id="reviewDlg"><h2>Review &amp; apply <span id="rvId"></span></h2>
<p class="small" id="rvNote" style="margin-bottom:10px"></p>
<div class="small" style="margin-bottom:6px">Request text (untrusted, shown as-is):</div><div class="in bio" id="rvText" style="min-height:0;margin-bottom:12px;white-space:pre-wrap"></div>
<div id="rvRows"></div><button class="btn sm" id="rvAdd" type="button">＋ Add a change</button>
<div id="rvDiff" style="display:none"><h3 class="small" style="margin-top:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--sand)">Exact diff to apply</h3><table class="diff"><thead><tr><th>Who</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody id="rvDiffBody"></tbody></table></div>
<p class="small" id="rvMsg" style="margin-top:8px"></p>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" id="rvCancel" type="button">Cancel</button><button class="btn" id="rvPreview" type="button">Preview diff</button><button class="btn pri" id="rvApply" type="button" disabled>Apply exactly this</button></div></dialog>
<dialog id="hideDlg"><h2>Hide now</h2><p class="small" style="margin-bottom:12px">Immediately hides the person everywhere (and turns off their public name), or hides a photo to admin-only. Undo is in the audit log.</p>
<label class="f">Person</label><select class="in" id="hdPerson"><option value="">(none)</option></select>
<label class="f" style="margin-top:10px">Photo id (optional)</label><input class="in" id="hdPhoto" placeholder="ph_...">
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" id="hdCancel" type="button">Cancel</button><button class="btn ox" id="hdGo" type="button">Hide now</button></div></dialog>`;

// ---------------------------------------------------------------------------------------------
async function dashboard(env, admin) {
  const db = env.DB;
  const people = (await db.prepare('SELECT birth_year, adult_confirmed, is_deceased, death_year FROM person').all()).results;
  const missing = people.filter((p) => p.birth_year == null && !p.adult_confirmed).length;
  const br = await db.prepare('SELECT COUNT(*) n, SUM(pw_hash IS NULL) unset FROM branch').first();
  const ph = await db.prepare('SELECT COUNT(*) n, COALESCE(SUM(bytes),0) b FROM photo WHERE deleted_at IS NULL').first();
  const reqs = (await db.prepare("SELECT r.*, b.display_name branch_name FROM change_request r LEFT JOIN branch b ON b.id=r.branch_id WHERE status='pending' ORDER BY created_at DESC LIMIT 3").all()).results;
  const pending = await pendingCount(db);
  const changes = (await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 4').all()).results;
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const gb = (ph.b / 1e9).toFixed(1);
  const body = `<div class="head"><div><div class="crumb">Admin &middot; Overview</div><h1>${greet}, ${esc(firstOf(admin.email))}</h1></div>
<div style="display:flex;gap:8px"><form action="/admin/people" style="display:contents"><label class="btn" style="padding:5px 10px">⌕ <input name="q" placeholder="Search people&hellip;" aria-label="Search people" style="background:none;border:0;outline:none;color:var(--ivory);font:inherit;width:120px"><span class="small">/</span></label></form><a class="btn" href="/" target="_blank" rel="noopener">Preview public site</a></div></div>
<style>.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}.stat{padding:14px 18px;position:relative;overflow:hidden}
.stat .n{font-family:Cormorant,serif;font-size:40px;line-height:1;color:var(--ivory);text-shadow:0 0 18px rgba(185,164,135,.35)}.stat .l{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--sand);margin-top:6px}
.stat .s{font-size:11px;color:rgba(233,225,211,.55);margin-top:4px}.stat::after{content:"";position:absolute;right:-30px;top:-30px;width:110px;height:110px;border-radius:50%;background:radial-gradient(rgba(154,116,72,.35),transparent 65%)}
.cols{display:grid;grid-template-columns:1.25fr 1fr;gap:14px}.qa{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.qa .btn{justify-content:flex-start;padding:12px 14px;font-size:12.5px}.req{padding:11px 0;border-top:1px solid rgba(185,164,135,.1)}.req:first-of-type{border-top:0}
.req p{font-size:12.5px;line-height:1.45;margin:4px 0 8px}.acts{display:flex;gap:6px;align-items:center}</style>
<div class="stats">
 <div class="stat glass"><div class="n">${people.length.toLocaleString('en-US')}</div><div class="l">People</div><div class="s">${missing} missing birth year &middot; hidden</div></div>
 <div class="stat glass"><div class="n">${br.n}</div><div class="l">Branches</div><div class="s">${br.n && !br.unset ? 'All passphrases set' : `${br.unset || 0} without a passphrase`}</div></div>
 <div class="stat glass"><div class="n">${ph.n.toLocaleString('en-US')}</div><div class="l">Photos</div><div class="s">${gb} GB of 10 GB free tier</div></div>
 <div class="stat glass"><div class="n">${pending}</div><div class="l">Pending requests</div><div class="s">From the family form</div></div>
</div>
<div class="cols"><div style="display:flex;flex-direction:column;gap:14px">
 <div class="card glass"><h3><i></i>Requests<a class="r" href="/admin/requests">${pending} pending &middot; view all</a></h3>
 ${reqs.map(requestCard).join('') || '<p class="small">No pending requests.</p>'}</div></div>
 <div style="display:flex;flex-direction:column;gap:14px">
  <div class="card glass"><h3><i></i>Quick actions</h3><div class="qa">
   <a class="btn pri" href="/admin/people/new">＋ Add person</a><a class="btn" href="/admin/photos">⇪ Upload photos</a><a class="btn ai" href="/admin/ai">Paste text to add relatives</a><a class="btn" href="/api/admin/export">⤓ Export backup</a></div></div>
  <div class="card glass"><h3><i></i>Public page</h3><p class="small" style="margin-bottom:10px">Rebuilds the public names from the database and publishes the front page.</p><button class="btn pri" id="rebuildPublic" type="button">Update public page</button></div>
  <div class="card glass list"><h3><i></i>Recent changes<a class="r" href="/admin/audit">audit log</a></h3>
  ${changes.map(auditItem).join('') || '<p class="small">No changes yet.</p>'}</div>
 </div></div>${REVIEW_DIALOG}`;
  return shell('Dashboard', 'Dashboard', body, { admin, pending, data: { people: await peopleIndex(db), requests: reqs } });
}

function auditItem(a) {
  const glyph = a.action === 'rotate_passphrase' ? '⟳' : a.summary && /AI|pasted/i.test(a.summary) ? '✦' : ini(String(a.summary || a.entity).replace(/^(Edited|Added|Deleted|Linked|Hid|Rotated passphrase,|Undid:)\s*/, ''));
  const undo = a.undoable && !a.undone_at ? `<button class="btn sm" data-act="POST /api/admin/audit/${a.id}/undo" data-confirm="Undo this change?">↶ Undo</button>` : a.undone_at ? '<span class="small">undone</span>' : '';
  return `<div class="it"><div class="orb">${glyph}</div><div style="flex:1">${esc(a.summary || `${a.action} ${a.entity}`)}<div class="small">${esc(a.action.replace(/_/g, ' '))} &middot; ${ago(a.at)}</div></div>${undo}</div>`;
}

async function peopleList(env, admin, url) {
  const db = env.DB;
  const q = (url.searchParams.get('q') || '').trim();
  let rows;
  if (q) {
    const fts = q.replace(/["*^():]/g, ' ').trim().split(/\s+/).filter(Boolean).map((t) => `"${t}"*`).join(' ');
    rows = fts ? (await db.prepare('SELECT p.* FROM person_fts f JOIN person p ON p.id=f.person_id WHERE person_fts MATCH ? LIMIT 100').bind(fts).all()).results : [];
  } else rows = (await db.prepare('SELECT * FROM person ORDER BY last_name, first_name LIMIT 500').all()).results;
  const tr = rows.map((p) => `<tr><td><a href="/admin/people/${esc(p.id)}" style="display:flex;gap:10px;align-items:center;text-decoration:none"><span class="orb">${ini(p.first_name)}</span>${esc(full(p))}</a></td>
<td>${p.birth_year ?? '<span class="small">missing</span>'}</td><td>${isMinor(p) ? '<span class="chip ox">minor &middot; private</span>' : '<span class="chip ol">adult</span>'}</td>
<td>${p.public_ok ? '<span class="chip br">public first name</span>' : '<span class="small">not public</span>'}</td><td>${p.hidden ? '<span class="chip ox">hidden</span>' : ''}</td></tr>`).join('');
  const body = `<style>table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--sand);font-weight:500;padding:0 10px 10px}td{padding:9px 10px;border-top:1px solid rgba(185,164,135,.1)}</style>
<div class="head"><div><div class="crumb">Admin &middot; People</div><h1>People</h1></div><div style="display:flex;gap:8px"><form action="/admin/people"><input class="in" name="q" value="${esc(q)}" placeholder="Search names, nicknames, birth surnames&hellip;" style="width:300px"></form><a class="btn pri" href="/admin/people/new">＋ Add person</a></div></div>
<div class="card glass"><table><tr><th>Name</th><th>Birth year</th><th>Age rule</th><th>Public page</th><th></th></tr>${tr || '<tr><td colspan="5" class="small">Nobody found.</td></tr>'}</table></div>`;
  return shell('People', 'People', body, { admin, pending: await pendingCount(db) });
}

const KINDS = ['bio', 'adopted', 'step', 'foster', 'guardian'];
const UKINDS = ['married', 'partner', 'engaged'];
const sel = (opts, cur, attrs) => `<select class="kind" ${attrs}>${opts.map((o) => `<option${o === cur ? ' selected' : ''}>${o}</option>`).join('')}</select>`;

async function personPage(env, admin, id) {
  const db = env.DB;
  const isNew = id === 'new';
  const p = isNew ? { id: '', first_name: '', adult_confirmed: 0, public_ok: 0, hidden: 0 } : await db.prepare('SELECT * FROM person WHERE id=?').bind(id).first();
  if (!p) return notFound();
  const g = isNew ? { parents: [], children: [], unions: [], branches: [], photos: [] } : await personGraph(db, id);
  const allBranches = (await db.prepare('SELECT id, display_name FROM branch ORDER BY sort').all()).results;
  const minor = isMinor(p);
  const inp = (k, ph = 'optional', type = 'text') => `<input class="in" name="${k}" type="${type}" value="${esc(p[k] ?? '')}" placeholder="${ph}" ${type === 'number' ? 'min="1500" max="2200"' : 'maxlength="120"'}>`;
  const tog = (k, label, extra = '') => `<span style="display:inline-flex;align-items:center;gap:8px"><button type="button" class="tog${p[k] ? ' on' : ''}" data-tog="${k}" aria-pressed="${p[k] ? 'true' : 'false'}" ${extra}></button>${label}</span>`;
  const linkRow = (o, kindHtml, extra = '', del = '') => `<div class="it"><a class="orb" href="/admin/people/${esc(o.id)}" style="text-decoration:none">${ini(o.first_name)}</a><div style="flex:1">${esc(full(o))}${extra}</div>${kindHtml}${del}</div>`;
  const parents = g.parents.map((l) => linkRow({ ...l, id: l.parent_id }, sel(KINDS, l.kind, `data-pk="${esc(l.parent_id)}|${esc(id)}"`), isMinor(l) ? ' <span class="chip ox" style="margin-left:6px">minor &middot; private</span>' : '', `<button class="btn sm" title="Remove link" data-act="DELETE /api/admin/links/parent" data-body='${esc(JSON.stringify({ parent_id: l.parent_id, child_id: id }))}' data-confirm="Remove this parent link?">✕</button>`)).join('');
  const children = g.children.map((l) => linkRow({ ...l, id: l.child_id }, sel(KINDS, l.kind, `data-pk="${esc(id)}|${esc(l.child_id)}"`), isMinor(l) ? ' <span class="chip ox" style="margin-left:6px">minor &middot; private</span>' : '', `<button class="btn sm" title="Remove link" data-act="DELETE /api/admin/links/parent" data-body='${esc(JSON.stringify({ parent_id: id, child_id: l.child_id }))}' data-confirm="Remove this child link?">✕</button>`)).join('');
  const partners = g.unions.map((u) => linkRow({ ...u, id: u.other_id }, sel(UKINDS, u.kind, `data-uk="${esc(u.id)}"`), `<div class="small">${esc(u.kind)} &middot; ${u.start_year || '?'} &ndash; ${u.end_year || 'present'}</div>`, `<button class="btn sm" title="Remove partnership" data-act="DELETE /api/admin/links/partner" data-body='${esc(JSON.stringify({ id: u.id }))}' data-confirm="Remove this partnership?">✕</button>`)).join('');
  const crumbBranch = g.branches[0] ? ` &middot; ${esc(g.branches[0].display_name)}` : '';
  const chips = g.branches.map((b) => `<button class="chip br" data-act="DELETE /api/admin/people/${esc(id)}/branches" data-body='${esc(JSON.stringify({ branch_id: b.id }))}' title="Remove from branch">${esc(b.display_name)} ✕</button>`).join(' ');
  const addBranch = allBranches.filter((b) => !g.branches.some((x) => x.id === b.id));
  const photos = g.photos.map((ph) => `<div><img src="/api/admin/photos/${esc(ph.id)}/thumb" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px"></div>`).join('');
  const body = `<style>.pg{display:grid;grid-template-columns:1.35fr 1fr;gap:14px}.row{display:grid;gap:10px;margin-bottom:12px}.r4{grid-template-columns:repeat(4,1fr)}
.rel .it{padding:8px 0}.kind{font-size:10.5px;padding:3px 8px;border-radius:7px;border:1px solid rgba(185,164,135,.35);background:rgba(11,18,27,.5);color:var(--sand);font-family:inherit}
.warn{display:flex;gap:10px;align-items:flex-start;font-size:12px;line-height:1.45;padding:10px 12px;border-radius:12px;border:1px solid rgba(106,41,44,.8);background:rgba(106,41,44,.2)}
.ph{display:flex;gap:8px;flex-wrap:wrap}.ph>div,.ph>label{width:62px;height:62px;border-radius:12px;border:1px solid var(--line);background:linear-gradient(135deg,rgba(86,96,74,.35),rgba(24,39,56,.6));display:grid;place-items:center;font-size:14px;color:rgba(233,225,211,.5)}
.bio{font-size:12.5px;line-height:1.55;color:rgba(233,225,211,.85);min-height:84px}.hd{display:flex;align-items:center;gap:14px}.big{width:58px;height:58px;font-size:28px}
.sub{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:rgba(233,225,211,.55);margin-top:6px}</style>
<form id="personForm" data-id="${esc(p.id)}" autocomplete="off">
<div class="head"><div class="hd"><div class="orb big">${ini(p.first_name || '+')}</div><div><div class="crumb">People${crumbBranch}</div><h1>${isNew ? 'New person' : esc(full(p))}</h1></div></div>
<div style="display:flex;gap:8px">${isNew ? '' : `<button type="button" class="btn ox" data-act="POST /api/admin/people/${esc(id)}/hide" data-confirm="Hide ${esc(full(p))} everywhere now?">⦸ Hide now</button><a class="btn" href="/" target="_blank" rel="noopener">◎ Preview as public</a>`}<button class="btn pri" type="submit">Save</button></div></div>
<div class="pg"><div style="display:flex;flex-direction:column;gap:14px">
 <div class="card glass"><h3><i></i>Identity${p.hidden ? '<span class="r"><span class="chip ox">hidden</span></span>' : ''}</h3>
  <div class="row r4"><div><label class="f">First</label>${inp('first_name', 'required')}</div><div><label class="f">Middle</label>${inp('middle')}</div><div><label class="f">Last</label>${inp('last_name')}</div><div><label class="f">Birth surname</label>${inp('birth_surname')}</div></div>
  <div class="row r4"><div><label class="f">Nickname</label>${inp('nickname')}</div><div><label class="f">Birth year</label>${inp('birth_year', 'year only', 'number')}</div><div><label class="f">Death year</label>${inp('death_year', '—', 'number')}</div><div><label class="f">Memorial</label><div class="in" style="display:flex;align-items:center;gap:8px">${tog('memorial', `<span class="small">${p.memorial ? 'on' : 'off'}</span>`)}</div></div></div>
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap"><label class="f" style="margin:0">Branches</label>${chips}
   ${isNew || !addBranch.length ? '' : `<select class="chip" id="addBranch" aria-label="Add to branch"><option value="">＋ add</option>${addBranch.map((b) => `<option value="${esc(b.id)}">${esc(b.display_name)}</option>`).join('')}</select>`}</div>
  <div style="display:flex;gap:16px;align-items:center;font-size:12.5px;flex-wrap:wrap">${tog('adult_confirmed', 'Confirmed adult')}
   ${tog('public_ok', 'Show first name on public page', p.adult_confirmed ? '' : 'disabled title="Turn on Confirmed adult first"')}${tog('is_founder', 'Founder')}${tog('is_deceased', 'Deceased')}</div>
 </div>
 <div class="card glass"><h3><i></i>Bio<span class="r">Visible inside branch only</span></h3>
  <textarea class="in bio" name="bio_md" rows="4" maxlength="20000" placeholder="A few warm lines&hellip;">${esc(p.bio_md || '')}</textarea>
  <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn ai" id="storyBtn">AI story helper: draft from notes</button><span class="small" style="align-self:center">Drafts only. You review before saving. Runs on Cloudflare Workers AI.</span></div>
 </div>
 <div class="card glass"><h3><i></i>Photos<span class="r">EXIF stripped on upload</span></h3>
  <div class="ph">${photos}${isNew ? '' : '<label style="border-style:dashed;cursor:pointer" title="Upload photos">＋<input type="file" id="photoIn" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden></label>'}</div></div>
</div>
<div style="display:flex;flex-direction:column;gap:14px">
 ${isNew ? '' : `<div class="card glass rel list"><h3><i></i>Family links</h3>
  <div class="sub">Parents</div>${parents || '<div class="small" style="padding:6px 0">None yet</div>'}
  <div class="sub">Partners</div>${partners || '<div class="small" style="padding:6px 0">None yet</div>'}
  <div class="sub">Children</div>${children || '<div class="small" style="padding:6px 0">None yet</div>'}
  <div style="display:flex;gap:6px;margin-top:8px"><button type="button" class="btn sm" data-addlink="parent">＋ Parent</button><button type="button" class="btn sm" data-addlink="partner">＋ Partner</button><button type="button" class="btn sm" data-addlink="child">＋ Child</button></div>
 </div>`}
 <div class="warn"><span style="color:#E9E1D3">⚑</span><div><b>Private until confirmed adult.</b> People without a birth year, or under 18, stay hidden from public and their photos stay behind branch gates, until you turn on &ldquo;Confirmed adult&rdquo;. ${minor ? '<br><b>This person currently counts as a minor.</b>' : ''}</div></div>
 ${isNew ? '' : `<button type="button" class="btn sm" style="align-self:flex-start" data-act="DELETE /api/admin/people/${esc(id)}" data-confirm="Delete ${esc(full(p))}? (Undo is in the audit log.)" data-then="/admin/people">Delete person</button>`}
</div></div></form>
<dialog id="linkDlg"><h2 id="linkTitle">Add link</h2><label class="f">Person</label><select class="in" id="linkWho"></select>
<label class="f" style="margin-top:10px">Kind</label><select class="in" id="linkKind"></select>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" id="linkCancel" type="button">Cancel</button><button class="btn pri" id="linkGo" type="button">Add</button></div></dialog>
<dialog id="storyDlg"><h2>AI story helper</h2><p class="small" style="margin-bottom:10px">Write a few bullet notes. You get a draft to edit. Nothing is saved until you press Save.</p>
<textarea class="in" id="storyNotes" rows="5" placeholder="- loved fishing&#10;- made holiday bread every December"></textarea><p class="small" id="storyMsg" style="margin-top:8px"></p>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" id="storyCancel" type="button">Close</button><button class="btn pri ai" id="storyGo" type="button">Draft</button></div></dialog>`;
  return shell(isNew ? 'New person' : full(p), 'People', body, { admin, pending: await pendingCount(db), data: { people: (await peopleIndex(db)).filter((x) => x.id !== p.id), person: { id: p.id } } });
}

async function branchesPage(env, admin) {
  const db = env.DB;
  const rows = (await db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM person_branch pb WHERE pb.branch_id=b.id) members,
    pa.first_name a_first, pa.last_name a_last, pb2.first_name b_first, pb2.last_name b_last
    FROM branch b LEFT JOIN unions u ON u.id=b.root_union_id LEFT JOIN person pa ON pa.id=u.partner_a LEFT JOIN person pb2 ON pb2.id=u.partner_b ORDER BY b.sort`).all()).results;
  const unions = (await db.prepare(`SELECT u.id, a.first_name af, a.last_name al, b.first_name bf, b.last_name bl FROM unions u JOIN person a ON a.id=u.partner_a JOIN person b ON b.id=u.partner_b`).all()).results;
  const status = (b) => {
    if (!b.pw_hash) return '<span class="dot old"></span>Not set yet';
    const days = (Date.now() - Date.parse(b.pw_rotated_at)) / 86400000;
    return `<span class="dot ${days > 180 ? 'old' : 'ok'}"></span>Set &middot; ${days > 180 ? `${Math.round(days / 30)} months old` : `rotated ${ago(b.pw_rotated_at)}`}`;
  };
  const tr = rows.map((b) => `<tr><td><span class="chip br">${esc(b.display_name)}</span></td><td>${b.a_first ? `${esc(b.a_first)} ${esc(b.a_last || '')} &amp; ${esc(b.b_first)} ${esc(b.b_last || '')}` : '<span class="small">no root couple</span>'}</td><td>${b.members}</td>
<td><span class="pp">${b.pw_hash ? '&bull;&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;&bull;' : '&mdash;'}</span></td><td>${status(b)}</td>
<td style="text-align:right"><button class="btn sm ox" data-rotate="${esc(b.id)}" data-name="${esc(b.display_name)}">⟳ ${b.pw_hash ? 'Rotate' : 'Set'}</button></td></tr>`).join('');
  const body = `<style>table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--sand);font-weight:500;padding:0 10px 10px}
td{padding:12px 10px;border-top:1px solid rgba(185,164,135,.1);vertical-align:middle}.pp{font-family:ui-monospace,monospace;letter-spacing:.12em;color:var(--sand);white-space:nowrap}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;box-shadow:0 0 8px currentColor}.ok{background:#56604A;color:#7d8a6c}.old{background:#9A7448;color:#9A7448}
.note{display:flex;gap:12px;align-items:center;padding:12px 16px;font-size:12.5px;margin-bottom:14px}.note .k{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--sand);box-shadow:0 0 12px rgba(154,116,72,.4)}
.reveal{margin-top:14px;padding:16px 18px;display:none;gap:18px;align-items:center}.reveal.on{display:flex}.words{display:flex;gap:8px;flex-wrap:wrap}.words span{font-family:ui-monospace,monospace;font-size:14px;padding:8px 12px;border-radius:10px;border:1px solid rgba(185,164,135,.4);background:rgba(11,18,27,.55);box-shadow:0 0 14px rgba(154,116,72,.18)}</style>
<div class="head"><div><div class="crumb">Admin &middot; Branch gates</div><h1>Branches</h1></div><div style="display:flex;gap:8px"><button class="btn pri" id="newBranch" type="button">＋ New branch</button></div></div>
<div class="note glass"><div class="k">✓</div><div><b>Signed in as ${esc(firstOf(admin.email))} via Cloudflare email link.</b> <span class="small">&nbsp;Admin is protected by Cloudflare Access. Branch visitors use passphrases, not Access seats.</span></div></div>
<div class="card glass"><table><tr><th>Branch</th><th>Root couple</th><th>Members</th><th>Passphrase</th><th>Status</th><th></th></tr>${tr || '<tr><td colspan="6" class="small">No branches yet.</td></tr>'}</table></div>
<div class="reveal glass" id="reveal" aria-live="polite"><div><div class="small" style="letter-spacing:.14em;text-transform:uppercase;color:var(--sand)" id="revealTitle">New passphrase</div><div class="small" style="margin-top:4px">Shown once. Copy it now and share it with the branch privately.</div></div>
<div class="words" id="words"></div><button class="btn sm pri" id="copyAll" type="button" style="margin-left:auto">⧉ Copy all</button></div>
<div class="small" style="margin-top:12px;display:flex;gap:8px;align-items:center"><span class="chip ox">⟳ Rotate</span> makes a new 5-word passphrase and signs everyone in that branch out. Only a hash is stored, so the passphrase is shown once, right here. Lost ones get rotated, not recovered. Rotations can't be undone.</div>
<dialog id="branchDlg"><h2>New branch</h2><p class="small" style="margin-bottom:10px">Use the parents' or couple's names. Names of minors are blocked.</p>
<label class="f">Display name</label><input class="in" id="bName" maxlength="60"><label class="f" style="margin-top:10px">Slug (URL)</label><input class="in" id="bSlug" maxlength="40" placeholder="e.g. example-branch">
<label class="f" style="margin-top:10px">Root couple</label><select class="in" id="bUnion"><option value="">(none yet)</option>${unions.map((u) => `<option value="${esc(u.id)}">${esc(`${u.af} ${u.al || ''} & ${u.bf} ${u.bl || ''}`)}</option>`).join('')}</select>
<p class="small" id="bMsg" style="margin-top:8px"></p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" id="bCancel" type="button">Cancel</button><button class="btn pri" id="bGo" type="button">Create</button></div></dialog>
<dialog id="rotDlg"><h2>Rotate passphrase?</h2><p class="muted" style="font-size:13px;line-height:1.6">This makes a new passphrase for <b id="rotName"></b> and signs everyone in that branch out. It can't be undone.</p>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" id="rotCancel" type="button">Cancel</button><button class="btn ox" id="rotGo" type="button">Rotate and show once</button></div></dialog>`;
  return shell('Branches', 'Branches', body, { admin, pending: await pendingCount(db) });
}

async function requestsPage(env, admin, url) {
  const db = env.DB;
  const status = ['pending', 'applied', 'dismissed', 'hidden'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
  const reqs = (await db.prepare('SELECT r.*, b.display_name branch_name FROM change_request r LEFT JOIN branch b ON b.id=r.branch_id WHERE status=? ORDER BY created_at DESC LIMIT 200').bind(status).all()).results;
  const tabs = ['pending', 'applied', 'dismissed', 'hidden'].map((s) => `<a class="chip${s === status ? ' br' : ''}" href="?status=${s}" style="text-decoration:none">${s}</a>`).join(' ');
  const body = `<style>.req{padding:12px 0;border-top:1px solid rgba(185,164,135,.1)}.req:first-of-type{border-top:0}.req p{font-size:12.5px;line-height:1.5;margin:4px 0 8px}.acts{display:flex;gap:6px;align-items:center}</style>
<div class="head"><div><div class="crumb">Admin &middot; Family requests</div><h1>Requests</h1></div><div style="display:flex;gap:6px">${tabs}</div></div>
<div class="card glass"><h3><i></i>${esc(status)}<span class="r">Request text is untrusted. Every apply shows the exact diff first.</span></h3>
${reqs.map((r) => (status === 'pending' ? requestCard(r) : `<div class="req"><span class="small">#${r.id} &middot; ${esc(r.source)} &middot; ${esc(r.requester_name)} &middot; ${ago(r.created_at)} &middot; ${esc(r.status)} by ${esc(r.resolved_by || '')}</span><p>&ldquo;${esc(r.change_text)}&rdquo;</p></div>`)).join('') || '<p class="small">Nothing here.</p>'}</div>
${REVIEW_DIALOG}`;
  return shell('Requests', 'Requests', body, { admin, pending: await pendingCount(db), data: { people: await peopleIndex(db), requests: reqs } });
}

async function photosPage(env, admin) {
  const db = env.DB;
  const rows = (await db.prepare('SELECT * FROM photo WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200').all()).results;
  const body = `<style>.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.pgrid figure{padding:8px}.pgrid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px}.pgrid figcaption{font-size:11px;margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}</style>
<div class="head"><div><div class="crumb">Admin &middot; Private R2</div><h1>Photos</h1></div><label class="btn pri" style="cursor:pointer">⇪ Upload photos<input type="file" id="photoIn" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden></label></div>
<div class="card glass" style="margin-bottom:14px"><p class="small">Photos are resized and re-encoded to WebP in your browser (EXIF/GPS removed), then stored in the private bucket. The server rejects anything that still has EXIF/XMP. Photos with minors can never be public.</p></div>
<div class="pgrid">${rows.map((ph) => `<figure class="glass"><img src="/api/admin/photos/${esc(ph.id)}/thumb" alt="" loading="lazy"><figcaption><span class="chip">${esc(ph.visibility)}</span>${ph.has_minor ? '<span class="chip ox">minor</span>' : ''}<span class="small">${esc(ph.id)}</span><button class="btn sm" data-act="DELETE /api/admin/photos/${esc(ph.id)}" data-confirm="Delete this photo? (30-day soft delete)">✕</button></figcaption></figure>`).join('') || '<p class="small">No photos yet.</p>'}</div>`;
  return shell('Photos', 'Photos', body, { admin, pending: await pendingCount(db) });
}

async function aiPage(env, admin) {
  const body = `<div class="head"><div><div class="crumb">Admin &middot; Workers AI</div><h1>Stories &amp; AI</h1></div></div>
<div class="cols" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
<div class="card glass"><h3><i></i>Story helper</h3><p class="small" style="margin-bottom:10px">Bullet notes in, a warm draft out. Always a draft: copy it into a person's bio and edit before saving.</p>
<textarea class="in" id="storyNotes" rows="6" placeholder="- grew up near the coast&#10;- made holiday bread every December"></textarea>
<div style="display:flex;gap:8px;margin-top:10px"><button class="btn ai pri" id="storyGo" type="button">Draft bio</button></div><p class="small" id="storyMsg" style="margin-top:8px;white-space:pre-wrap"></p></div>
<div class="card glass"><h3><i></i>Paste text to add relatives<span class="r">Phase 5</span></h3><p class="small">Paste &ldquo;Aunt Mary married Tom in 1982, kids Sam and Jo&rdquo; and review each proposed person and link as a diff before anything is written. Scheduled for Phase 5 with Ask-the-tree.</p></div>
</div>`;
  return shell('Stories & AI', 'Stories & AI', body, { admin, pending: await pendingCount(env.DB) });
}
async function backupsPage(env, admin) {
  const body = `<div class="head"><div><div class="crumb">Admin &middot; Backups</div><h1>Backups</h1></div></div>
<div class="card glass"><h3><i></i>Export</h3><p class="small" style="margin-bottom:12px">Download a JSON export of people, links, branches (no passphrase hashes) and photo metadata. Downloads only, never emailed. D1 Time Travel can restore any minute in the last 7 days.</p><a class="btn pri" href="/api/admin/export">⤓ Download JSON export</a></div>`;
  return shell('Backups', 'Backups', body, { admin, pending: await pendingCount(env.DB) });
}
async function auditPage(env, admin) {
  const rows = (await env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all()).results;
  const body = `<div class="head"><div><div class="crumb">Admin &middot; History</div><h1>Audit log</h1></div></div><div class="card glass list">${rows.map((a) => auditItem(a).replace('</div><', ` <span class="small">&middot; ${esc(a.actor_email)}</span></div><`)).join('') || '<p class="small">Empty.</p>'}</div>`;
  return shell('Audit log', 'Dashboard', body, { admin, pending: await pendingCount(env.DB) });
}

export async function handleAdminPage(request, env, admin, url) {
  if (request.method !== 'GET') return notFound();
  const p = url.pathname.replace(/\/+$/, '') || '/admin';
  let m;
  if (p === '/admin') return html(await dashboard(env, admin));
  if (p === '/admin/people') return html(await peopleList(env, admin, url));
  if ((m = p.match(/^\/admin\/people\/([\w-]+)$/))) { const r = await personPage(env, admin, m[1]); return typeof r === 'string' ? html(r) : r; }
  if (p === '/admin/branches') return html(await branchesPage(env, admin));
  if (p === '/admin/requests') return html(await requestsPage(env, admin, url));
  if (p === '/admin/photos') return html(await photosPage(env, admin));
  if (p === '/admin/ai') return html(await aiPage(env, admin));
  if (p === '/admin/backups') return html(await backupsPage(env, admin));
  if (p === '/admin/audit') return html(await auditPage(env, admin));
  return notFound();
}
