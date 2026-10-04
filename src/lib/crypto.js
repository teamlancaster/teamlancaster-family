import { WORDS } from './wordlist.js';

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomId(prefix = '') {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return prefix + [...b].map((x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
}

/** Uniform random index without modulo bias. */
function randIndex(n) {
  const max = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= max);
  return a[0] % n;
}
/** 5 words from the EFF long list = ~64.6 bits. */
export const generatePassphrase = (words = 5) => Array.from({ length: words }, () => WORDS[randIndex(WORDS.length)]);

export const PBKDF2_ITERS = 100000; // Workers WebCrypto max; spec §6
export async function pbkdf2(pass, saltB64, iters = PBKDF2_ITERS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC').trim().toLowerCase()), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: iters }, key, 256);
  return toB64(bits);
}
export async function hashPassphrase(pass) {
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  return { pw_hash: await pbkdf2(pass, salt), pw_salt: salt, pw_iters: PBKDF2_ITERS };
}
export function constantTimeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
export async function hmacHex(keyStr, msg) {
  if (!keyStr) throw new Error('missing HMAC key');
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
/** Salted (peppered) IP hash; raw IPs are never stored. */
export const ipHash = (env, ip) => hmacHex(env.IP_HASH_PEPPER, `ip:${ip || 'unknown'}`);
export const sha256Hex = async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));
