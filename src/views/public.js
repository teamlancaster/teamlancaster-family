// Public front page: crest + first names of founders and branch parents. No photos.
import { esc } from '../lib/http.js';
import { head, DEFS } from './layout.js';

function node(x, y, name, sub, { r = 26, halo = 'halo', lock = false } = {}) {
  const ini = name ? esc(name[0].toUpperCase()) : '✧';
  const lk = lock ? `<g transform="translate(${x + r - 6},${y - r - 2})"><circle r="9" fill="#0B121B" stroke="#9A7448"/><rect x="-4" y="-1" width="8" height="6" rx="1" fill="none" stroke="#B9A487" stroke-width="1.2"/><path d="M-2.5 -1v-2a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#B9A487" stroke-width="1.2"/></g>` : '';
  return `<g class="node" data-name="${esc((name || '').toLowerCase())}" tabindex="0"><circle class="halo" cx="${x}" cy="${y}" r="${r * 2.6}" fill="url(#${halo})"/><circle class="core" cx="${x}" cy="${y}" r="${r}"/><circle cx="${x}" cy="${y}" r="${r + 5}" fill="none" stroke="rgba(185,164,135,.25)" stroke-dasharray="2 4"/><text class="ini" x="${x}" y="${y}">${ini}</text><text class="nm" x="${x}" y="${y + r + 20}">${esc(name || 'Branch')}</text><text class="sub" x="${x}" y="${y + r + 35}">${esc(sub)}</text>${lk}</g>`;
}
function curve(x1, y1, x2, y2) {
  const my = (y1 + y2) / 2, d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  return `<path class="link" d="${d}"/><path class="flow" d="${d}"/>`;
}

export function constellation(tree) {
  const fx = 445, fy = 250, links = [], nodes = [];
  const f = tree.founders;
  if (f.length >= 2) {
    links.push(`<path class="link" d="M${fx - 48},${fy} L${fx + 48},${fy}"/><circle cx="${fx}" cy="${fy}" r="4" fill="#E9E1D3" filter="url(#glow)"/>`);
    nodes.push(node(fx - 70, fy, f[0].first, 'Founder', { r: 30, halo: 'haloIvory' }), node(fx + 70, fy, f[1].first, 'Founder', { r: 30, halo: 'haloIvory' }));
  } else if (f.length === 1) nodes.push(node(fx, fy, f[0].first, 'Founder', { r: 30, halo: 'haloIvory' }));
  else links.push(`<circle cx="${fx}" cy="${fy}" r="5" fill="#E9E1D3" filter="url(#glow)"/>`);
  const n = tree.branches.length;
  tree.branches.forEach((b, i) => {
    // Spread branch stars on a lower arc (matches the mockup for 5 branches).
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ang = Math.PI * (0.92 - 0.84 * t);
    const x = Math.round(fx + Math.cos(ang) * 300), y = Math.round(fy + 120 + Math.sin(ang) * 220);
    links.push(curve(fx, fy + 4, x, y - 30));
    nodes.push(node(x, y, b.first, 'Branch', { lock: true }));
  });
  for (const [x, y] of [[90, 600], [800, 610], [445, 90], [220, 170], [680, 160]]) nodes.push(`<circle cx="${x}" cy="${y}" r="3" fill="#B9A487" opacity=".5" filter="url(#glow)"/>`);
  if (!n) nodes.push('<text x="445" y="40" text-anchor="middle" style="font-size:11px;letter-spacing:.2em;fill:rgba(185,164,135,.55)">BRANCHES APPEAR AS THEY ARE ADDED</text>');
  return `<svg id="sky" viewBox="0 0 890 736" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Family constellation">${DEFS}
<g id="world"><g opacity=".35"><circle cx="445" cy="300" r="250" fill="none" stroke="rgba(185,164,135,.25)" stroke-dasharray="1 7"/><circle cx="445" cy="300" r="150" fill="none" stroke="rgba(185,164,135,.18)" stroke-dasharray="1 9"/></g>
${links.join('\n')}\n${nodes.join('\n')}</g></svg>`;
}

export function publicPage({ tree, siteKey }) {
  const ts = siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : '';
  return `${head('Team Lancaster', `<link rel="stylesheet" href="/assets/public.css">${ts}<script src="/assets/public.js" defer></script>`)}
<body class="pub"><div class="stars"></div><div class="grid"></div>
<header class="top"><div class="brand"><img src="/assets/lancaster-arms.webp" alt="">Team Lancaster</div>
<label class="search glass"><span class="ic">⌕</span><input id="q" class="sq" type="search" placeholder="Search first names&hellip;" autocomplete="off" aria-label="Search"><span class="kbd">/</span><div id="qres" class="qres"></div></label>
<button class="pill" id="openBranch" type="button">Family members: open your branch &rarr;</button></header>
<aside class="hero glass"><img src="/assets/lancaster-arms.webp" alt="Lancaster arms"><h1>Team Lancaster</h1>
<div class="rule"></div><p class="muted">One family, many branches. Pick your branch star and enter its passphrase to see its people, stories and photos.</p>
<div class="rule"></div><div class="legend"><span class="l1">Founders</span><span class="l2">Branch</span></div>
<button class="btn reqbtn" id="openReq" type="button">✎ Request a change</button></aside>
<div class="zoom"><button class="glass" data-z="in" aria-label="Zoom in">+</button><button class="glass" data-z="out" aria-label="Zoom out">&minus;</button><button class="glass" data-z="reset" aria-label="Recenter">&#9678;</button></div>
${constellation(tree)}
<section class="guide glass" id="guide"><h3><i></i>Guide<span class="r">Workers AI &middot; public info only</span></h3>
<div class="glog" id="glog" aria-live="polite"><div class="gm bot">Hi! I can explain how this family site works, how to open your branch, or how to request a change.</div></div>
<form id="gform" class="gform"><input class="in" id="gq" maxlength="300" placeholder="Ask the guide&hellip;" autocomplete="off" aria-label="Ask the guide"><button class="btn sm pri" type="submit">Ask</button></form></section>
<div class="hint glass"><span class="muted">Drag to explore</span><span class="kbd">scroll</span><span class="muted">zoom</span><span class="kbd">/</span><span class="muted">search</span></div>

<dialog id="reqDlg"><form id="reqForm" method="dialog">
<h2>Request a change</h2><p class="small" style="margin-bottom:14px">Text only. A family admin reviews every request before anything changes. Please don't include addresses, phone numbers or birthdates.</p>
<label class="f" for="rname">Your name</label><input class="in" id="rname" name="name" maxlength="80" required>
<label class="f" for="rperson" style="margin-top:10px">Who is it about?</label><input class="in" id="rperson" name="person" maxlength="200" required placeholder="e.g. my uncle on Dad's side">
<label class="f" for="rkind" style="margin-top:10px">Type</label><select class="in" id="rkind" name="kind"><option value="edit">Fix something</option><option value="add">Add someone</option><option value="privacy">Privacy / take something down</option><option value="other">Other</option></select>
<label class="f" for="rchange" style="margin-top:10px">What should change?</label><textarea class="in" id="rchange" name="change" rows="4" maxlength="2000" required></textarea>
<div class="cf-turnstile" data-sitekey="${esc(siteKey || '')}" data-theme="dark" style="margin-top:12px"></div>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn pri" id="reqSend" type="button">Send request</button></div>
<p class="small" id="reqMsg" style="margin-top:10px"></p></form></dialog>
<dialog id="branchDlg"><h2>Open your branch</h2><p class="muted" style="font-size:13px;line-height:1.6">Branch areas are coming soon. When they open, pick your branch star and enter the passphrase your branch shared with you.</p><form method="dialog" style="text-align:right;margin-top:14px"><button class="btn">Close</button></form></dialog>
<div class="toast" id="toast"></div>
</body></html>`;
}
