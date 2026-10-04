// Request notification email (reviewer fix 3): POINTER ONLY.
// Subject/body carry the request number, the branch label, and an admin link. Never the
// requester's name, the person text, the change text, or photos.

export function buildPointerEmail({ id, branchLabel }, env) {
  const site = String(env.SITE_URL || 'https://teamlancaster.com').replace(/\/+$/, '');
  const where = branchLabel ? ` (${branchLabel})` : ' (public form)';
  const link = `${site}/admin/requests#r${Number(id)}`;
  const subject = `New change request #${Number(id)}${where}`;
  const text = `New request in the admin queue: #${Number(id)}${where}.\n\nOpen the queue: ${link}\n\nThis is a notice only. The request content is in the admin queue, not in this email.`;
  return { from: env.NOTIFY_FROM, to: [env.NOTIFY_TO], subject, text,
    headers: { 'X-Team-Lancaster-Notice': 'pointer-only' } };
}

export async function sendPointerEmail(env, info, fetchImpl = fetch) {
  const msg = buildPointerEmail(info, env);
  if (!env.RESEND_API_KEY) {
    console.log('[notify] dry-run (no RESEND_API_KEY):', msg.subject);
    return { ok: true, dryRun: true, msg };
  }
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(msg),
  });
  return { ok: res.ok, status: res.status };
}
