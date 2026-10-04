// Admin client. All user-supplied text is inserted with textContent (never innerHTML).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const data = (() => { try { return JSON.parse(($('#page-data') || {}).textContent || '{}'); } catch { return {}; } })();
  const toast = (m, err) => { const t = $('#toast'); t.textContent = m; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 4000); };
  async function api(method, url, body, isForm) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { if (isForm) opt.body = body; else { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); } }
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

  // Generic action buttons: data-act="METHOD /url" [data-body] [data-confirm] [data-then]
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    e.preventDefault();
    if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
    const [method, url] = b.dataset.act.split(' ');
    try { await api(method, url, b.dataset.body ? JSON.parse(b.dataset.body) : {}); toast('Done'); setTimeout(() => (b.dataset.then ? (location.href = b.dataset.then) : location.reload()), 300); }
    catch (err) { toast(err.message, true); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const i = $('input[name="q"]'); if (i) { e.preventDefault(); i.focus(); } } });

  // ---------------- Person page ----------------
  const pf = $('#personForm');
  if (pf) {
    const id = pf.dataset.id;
    const tg = (k) => $(`[data-tog="${k}"]`);
    const setTog = (k, on) => { const t = tg(k); if (!t) return; t.classList.toggle('on', on); t.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    const isOn = (k) => tg(k)?.classList.contains('on');
    $$('[data-tog]').forEach((t) => t.addEventListener('click', () => {
      if (t.disabled) return;
      setTog(t.dataset.tog, !isOn(t.dataset.tog));
      // Fix 7: the public-name toggle is only enabled while "Confirmed adult" is on.
      if (t.dataset.tog === 'adult_confirmed') {
        const pub = tg('public_ok'); pub.disabled = !isOn('adult_confirmed');
        pub.title = pub.disabled ? 'Turn on Confirmed adult first' : '';
        if (pub.disabled) setTog('public_ok', false);
      }
    }));
    pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const k of ['first_name', 'middle', 'last_name', 'birth_surname', 'nickname', 'birth_year', 'death_year', 'bio_md']) body[k] = pf.elements[k].value;
      for (const k of ['memorial', 'adult_confirmed', 'public_ok', 'is_founder', 'is_deceased']) body[k] = !!isOn(k);
      try {
        if (id) { await api('PATCH', `/api/admin/people/${id}`, body); toast('Saved'); setTimeout(() => location.reload(), 300); }
        else { const r = await api('POST', '/api/admin/people', body); location.href = `/admin/people/${r.id}`; }
      } catch (err) { toast(err.message, true); }
    });
    $$('select[data-pk]').forEach((s) => s.addEventListener('change', async () => {
      const [parent_id, child_id] = s.dataset.pk.split('|');
      try { await api('PATCH', '/api/admin/links/parent', { parent_id, child_id, kind: s.value }); toast('Link updated'); } catch (err) { toast(err.message, true); }
    }));
    $$('select[data-uk]').forEach((s) => s.addEventListener('change', async () => {
      try { await api('PATCH', '/api/admin/links/partner', { id: s.dataset.uk, kind: s.value }); toast('Partnership updated'); } catch (err) { toast(err.message, true); }
    }));
    $('#addBranch')?.addEventListener('change', async (e) => {
      if (!e.target.value) return;
      try { await api('POST', `/api/admin/people/${id}/branches`, { branch_id: e.target.value }); location.reload(); } catch (err) { toast(err.message, true); }
    });
    // Link dialog
    const dlg = $('#linkDlg'); let mode = '';
    $$('[data-addlink]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.addlink;
      $('#linkTitle').textContent = `Add ${mode}`;
      $('#linkWho').replaceChildren(...(data.people || []).map((p) => el('option', { value: p.id, textContent: p.name + (p.minor ? ' (minor)' : '') })));
      const kinds = mode === 'partner' ? ['married', 'partner', 'engaged'] : ['bio', 'adopted', 'step', 'foster', 'guardian'];
      $('#linkKind').replaceChildren(...kinds.map((k) => el('option', { value: k, textContent: k })));
      dlg.showModal();
    }));
    $('#linkCancel')?.addEventListener('click', () => dlg.close());
    $('#linkGo')?.addEventListener('click', async () => {
      const other = $('#linkWho').value, kind = $('#linkKind').value;
      try {
        if (mode === 'partner') await api('POST', '/api/admin/links/partner', { partner_a: id, partner_b: other, kind });
        else if (mode === 'parent') await api('POST', '/api/admin/links/parent', { parent_id: other, child_id: id, kind });
        else await api('POST', '/api/admin/links/parent', { parent_id: id, child_id: other, kind });
        location.reload();
      } catch (err) { toast(err.message, true); }
    });
    // Story helper
    const sd = $('#storyDlg');
    $('#storyBtn')?.addEventListener('click', () => sd.showModal());
    $('#storyCancel')?.addEventListener('click', () => sd.close());
    $('#storyGo')?.addEventListener('click', async () => {
      $('#storyMsg').textContent = 'Drafting…';
      try {
        const r = await api('POST', '/api/admin/ai/story', { notes: $('#storyNotes').value, kind: isOn('memorial') ? 'memorial' : 'bio' });
        if (!r.draft) { $('#storyMsg').textContent = 'Workers AI is not reachable here (local dev). It works once deployed.'; return; }
        pf.elements.bio_md.value = r.draft; sd.close(); toast('Draft added to the bio. Edit it, then Save.');
      } catch (err) { $('#storyMsg').textContent = err.message; }
    });
  }

  $('#rebuildPublic')?.addEventListener('click', async () => {
    if (!confirm('Rebuilds the public names from the database and publishes the front page. Continue?')) return;
    try { toast((await api('POST', '/api/admin/rebuild-public', {})).message); }
    catch (err) { toast(err.message, true); }
  });

  // Story helper on the AI page
  if (!pf && $('#storyGo')) $('#storyGo').addEventListener('click', async () => {
    $('#storyMsg').textContent = 'Drafting…';
    try { const r = await api('POST', '/api/admin/ai/story', { notes: $('#storyNotes').value }); $('#storyMsg').textContent = r.draft || 'Workers AI is not reachable here (local dev). It works once deployed.'; }
    catch (err) { $('#storyMsg').textContent = err.message; }
  });

  // ---------------- Photo upload pipeline (spec §7) ----------------
  async function encode(bitmap, max) {
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas'); c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.86)); // canvas output carries no EXIF/GPS
    return { blob, w: c.width, h: c.height };
  }
  $('#photoIn')?.addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      try {
        if (file.size > 40 * 1024 * 1024) throw new Error(`${file.name}: too large`);
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const full = await encode(bmp, 2048), thumb = await encode(bmp, 400);
        const fd = new FormData();
        fd.append('full', full.blob, 'full.webp'); fd.append('thumb', thumb.blob, 'thumb.webp');
        fd.append('w', full.w); fd.append('h', full.h);
        if (pf?.dataset.id) fd.append('person_id', pf.dataset.id);
        await api('POST', '/api/admin/photos', fd, true);
        toast(`Uploaded ${file.name}`);
      } catch (err) { toast(err.message || 'Could not read that image (HEIC may need Safari).', true); }
    }
    setTimeout(() => location.reload(), 600);
  });

  // ---------------- Branches (fix 5: copy only on the one-time panel; nothing persisted) -----
  if ($('#reveal')) {
    let phrase = null; // memory only. Never localStorage/sessionStorage, never logged.
    const clear = () => { phrase = null; $('#words').replaceChildren(); $('#reveal').classList.remove('on'); };
    addEventListener('pagehide', clear); addEventListener('beforeunload', clear);
    let target = null;
    $$('[data-rotate]').forEach((b) => b.addEventListener('click', () => { target = b.dataset.rotate; $('#rotName').textContent = b.dataset.name; $('#rotDlg').showModal(); }));
    $('#rotCancel').addEventListener('click', () => $('#rotDlg').close());
    $('#rotGo').addEventListener('click', async () => {
      try {
        const r = await api('POST', `/api/admin/branches/${target}/rotate`, { confirm: true });
        $('#rotDlg').close();
        phrase = r.words.join(' ');
        $('#revealTitle').textContent = `New passphrase, ${r.branch}`;
        $('#words').replaceChildren(...r.words.map((w) => el('span', { textContent: w })));
        $('#reveal').classList.add('on');
      } catch (err) { toast(err.message, true); }
    });
    $('#copyAll').addEventListener('click', async () => { if (!phrase) return; try { await navigator.clipboard.writeText(phrase); toast('Copied. Share it privately.'); } catch { toast('Copy failed. Select the words manually.', true); } });
    const bd = $('#branchDlg');
    $('#newBranch').addEventListener('click', () => bd.showModal());
    $('#bCancel').addEventListener('click', () => bd.close());
    $('#bName').addEventListener('input', () => { $('#bSlug').value = $('#bName').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); });
    $('#bGo').addEventListener('click', async () => {
      try { await api('POST', '/api/admin/branches', { display_name: $('#bName').value, slug: $('#bSlug').value, root_union_id: $('#bUnion').value || null }); location.reload(); }
      catch (err) { $('#bMsg').textContent = err.message; }
    });
  }

  // ---------------- Requests: review = exact diff first, then apply (fix 4) -------------------
  const rv = $('#reviewDlg');
  if (rv) {
    const FIELDS = ['first_name', 'middle', 'last_name', 'birth_surname', 'nickname', 'birth_year', 'death_year', 'is_deceased', 'hidden', 'bio_md'];
    let req = null, token = null, previewed = null;
    const invalidate = () => { token = null; $('#rvApply').disabled = true; $('#rvDiff').style.display = 'none'; };
    const addRow = () => {
      const who = el('select', { className: 'in' }, el('option', { value: '', textContent: '(person)' }), ...(data.people || []).map((p) => el('option', { value: p.id, textContent: p.name + (p.minor ? ' (minor)' : '') })));
      const field = el('select', { className: 'in' }, ...FIELDS.map((f) => el('option', { value: f, textContent: f.replace(/_/g, ' ') })));
      const val = el('input', { className: 'in', placeholder: 'new value' });
      const row = el('div', { className: 'rvrow', style: 'display:grid;grid-template-columns:1.3fr 1fr 1.3fr;gap:8px;margin-bottom:8px' }, who, field, val);
      row.addEventListener('input', invalidate); row.addEventListener('change', invalidate);
      $('#rvRows').append(row);
    };
    $$('[data-review]').forEach((b) => b.addEventListener('click', () => {
      req = (data.requests || []).find((r) => String(r.id) === b.dataset.review);
      $('#rvId').textContent = `#${req.id}`;
      $('#rvNote').textContent = req.source === 'public' ? 'Public form: the sender’s name is NOT verified.' : `Branch request (tagged by the sender’s branch cookie: ${req.branch_name || 'branch'}).`;
      $('#rvText').textContent = `About: ${req.person_text}\n${req.change_text}`;
      $('#rvRows').replaceChildren(); addRow(); invalidate(); $('#rvMsg').textContent = '';
      rv.showModal();
    }));
    $('#rvAdd').addEventListener('click', () => { addRow(); invalidate(); });
    $('#rvCancel').addEventListener('click', () => rv.close());
    const changes = () => $$('.rvrow').map((r) => { const [w, f, v] = r.querySelectorAll('select,input'); return { person_id: w.value, field: f.value, value: /^(is_deceased|hidden)$/.test(f.value) ? /^(1|true|yes|on)$/i.test(v.value) : v.value }; }).filter((c) => c.person_id);
    $('#rvPreview').addEventListener('click', async () => {
      try {
        previewed = changes();
        const r = await api('POST', `/api/admin/requests/${req.id}/preview`, { changes: previewed });
        token = r.token;
        $('#rvDiffBody').replaceChildren(...r.items.map((it) => el('tr', {}, el('td', { textContent: it.label + (it.minor ? ' (minor)' : '') }), el('td', { textContent: it.field }),
          el('td', { className: 'old', textContent: it.before ?? '—' }), el('td', { className: 'new', textContent: it.after ?? '—' }))));
        $('#rvDiff').style.display = 'block'; $('#rvApply').disabled = false; $('#rvMsg').textContent = 'Check the diff. Apply writes exactly these values.';
      } catch (err) { invalidate(); $('#rvMsg').textContent = err.message; }
    });
    $('#rvApply').addEventListener('click', async () => {
      if (!token) return;
      try { await api('POST', `/api/admin/requests/${req.id}/apply`, { changes: previewed, token }); rv.close(); toast('Applied'); setTimeout(() => location.reload(), 300); }
      catch (err) { invalidate(); $('#rvMsg').textContent = err.message; }
    });
    // Hide now
    const hd = $('#hideDlg'); let hreq = null;
    $('#hdPerson').append(...(data.people || []).map((p) => el('option', { value: p.id, textContent: p.name })));
    $$('[data-hidenow]').forEach((b) => b.addEventListener('click', () => { hreq = b.dataset.hidenow; hd.showModal(); }));
    $('#hdCancel').addEventListener('click', () => hd.close());
    $('#hdGo').addEventListener('click', async () => {
      try { await api('POST', `/api/admin/requests/${hreq}/hide-now`, { person_id: $('#hdPerson').value || undefined, photo_id: $('#hdPhoto').value.trim() || undefined }); hd.close(); toast('Hidden'); setTimeout(() => location.reload(), 300); }
      catch (err) { toast(err.message, true); }
    });
  }
})();
