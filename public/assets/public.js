// Public page behaviour: pan/zoom, first-name search, guide chat, request form. All output via textContent.
(() => {
  const $ = (s) => document.querySelector(s);
  const toast = (m, err) => { const t = $('#toast'); t.textContent = m; t.className = 'toast show' + (err ? ' err' : ''); setTimeout(() => (t.className = 'toast'), 3500); };
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  };

  // ---- pan / zoom ----
  const sky = $('#sky'), world = $('#world');
  let s = 1, tx = 0, ty = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apply = (anim) => { world.style.transition = anim && !reduce ? 'transform .45s ease' : 'none'; world.setAttribute('transform', `translate(${tx} ${ty}) scale(${s})`); world.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; };
  const zoomAt = (f, cx = 445, cy = 368) => { const ns = Math.min(3, Math.max(0.5, s * f)); tx = cx - (cx - tx) * (ns / s); ty = cy - (cy - ty) * (ns / s); s = ns; apply(true); };
  document.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => { const z = b.dataset.z; if (z === 'in') zoomAt(1.25); else if (z === 'out') zoomAt(0.8); else { s = 1; tx = ty = 0; apply(true); } }));
  sky.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
  let drag = null;
  sky.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, tx, ty }; sky.classList.add('drag'); sky.setPointerCapture(e.pointerId); });
  sky.addEventListener('pointermove', (e) => { if (!drag) return; const k = 890 / sky.clientWidth; tx = drag.tx + (e.clientX - drag.x) * k; ty = drag.ty + (e.clientY - drag.y) * k; apply(false); });
  sky.addEventListener('pointerup', () => { drag = null; sky.classList.remove('drag'); });
  document.querySelectorAll('.node').forEach((n) => n.addEventListener('click', () => {
    const c = n.querySelector('circle.core'); const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy');
    tx = 445 - cx * s; ty = 368 - cy * s; apply(true);
  }));

  // ---- search (public dataset only: first names on the front page) ----
  const q = $('#q'), qres = $('#qres');
  document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); q.focus(); } });
  let qt;
  q.addEventListener('input', () => {
    clearTimeout(qt);
    qt = setTimeout(async () => {
      const v = q.value.trim().toLowerCase();
      document.querySelectorAll('.node').forEach((n) => { n.classList.toggle('hit', !!v && n.dataset.name.includes(v)); n.classList.toggle('dim', !!v && !n.dataset.name.includes(v)); });
      qres.replaceChildren();
      if (!v) return qres.classList.remove('on');
      const r = await fetch('/api/public/search?q=' + encodeURIComponent(v)).then((x) => x.json()).catch(() => []);
      for (const p of r) { const d = document.createElement('div'); d.textContent = p.first; const sp = document.createElement('span'); sp.textContent = p.role; d.append(sp); qres.append(d); }
      if (!r.length) { const d = document.createElement('div'); d.textContent = 'No match on the front page. People are listed inside each branch.'; qres.append(d); }
      qres.classList.add('on');
    }, 160);
  });
  q.addEventListener('blur', () => setTimeout(() => qres.classList.remove('on'), 200));

  // ---- guide ----
  const glog = $('#glog');
  const say = (t, who) => { const d = document.createElement('div'); d.className = 'gm ' + who; d.textContent = t; glog.append(d); glog.scrollTop = glog.scrollHeight; };
  $('#gform').addEventListener('submit', async (e) => {
    e.preventDefault(); const v = $('#gq').value.trim(); if (!v) return;
    $('#gq').value = ''; say(v, 'me');
    try { say((await post('/api/guide', { q: v })).answer, 'bot'); } catch (err) { say(err.message, 'bot'); }
  });

  // ---- dialogs ----
  $('#openBranch').addEventListener('click', () => $('#branchDlg').showModal());
  $('#openReq').addEventListener('click', () => { $('#reqMsg').textContent = ''; $('#reqDlg').showModal(); });
  $('#reqSend').addEventListener('click', async () => {
    const f = $('#reqForm'); if (!f.reportValidity()) return;
    const tok = (f.querySelector('[name="cf-turnstile-response"]') || {}).value || '';
    try {
      const r = await post('/api/request', { name: f.elements.name.value, person: f.elements.person.value, kind: f.elements.kind.value, change: f.elements.change.value, turnstile: tok });
      f.reset(); $('#reqDlg').close(); toast(r.message);
    } catch (err) { $('#reqMsg').textContent = err.message; if (window.turnstile) window.turnstile.reset(); }
  });
})();
