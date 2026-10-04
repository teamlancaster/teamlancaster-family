export async function verifyTurnstile(env, token, ip, fetchImpl = fetch) {
  if (!env.TURNSTILE_SECRET || !token) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', String(token).slice(0, 2048));
  if (ip) body.append('remoteip', ip);
  try {
    const r = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const j = await r.json();
    return !!j.success;
  } catch { return false; }
}
