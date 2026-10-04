// Upload safety (reviewer fix 2 + spec §7).
// - Admin uploads: re-encoded to WebP in Chris's browser (canvas => no EXIF); server re-checks.
// - In-branch request uploads (Phase 3 form): quarantine/ prefix, magic-byte sniff, 10 MB cap,
//   JPEG/PNG/WebP/HEIC only (no SVG, ever), then a server-side re-encode before anyone sees them.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const ascii = (b, off, len) => String.fromCharCode(...b.subarray(off, off + len));

/** Detect type from magic bytes only (never trust Content-Type or file name). */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
  }
  return null; // SVG, GIF, PDF, HTML, executables, anything else => rejected
}

/** WebP container still carrying EXIF/XMP chunks? (admin upload re-check) */
export function webpHasMetadata(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (sniffImageType(b) !== 'image/webp') return true;
  let off = 12;
  while (off + 8 <= b.length) {
    const id = ascii(b, off, 4);
    const size = b[off + 4] | (b[off + 5] << 8) | (b[off + 6] << 16) | (b[off + 7] << 24);
    if (id === 'EXIF' || id === 'XMP ') return true;
    if (id === 'VP8X' && (b[off + 8] & 0x0c)) return true; // EXIF (0x08) or XMP (0x04) flag set
    off += 8 + size + (size & 1);
  }
  return false;
}

/** Validate an in-branch request upload BEFORE it is written to quarantine/. */
export function validateQuarantineUpload(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!b.length) return { ok: false, error: 'empty' };
  if (b.length > MAX_UPLOAD_BYTES) return { ok: false, error: 'too-large' };
  const type = sniffImageType(b);
  if (!type || !ALLOWED_TYPES.includes(type)) return { ok: false, error: 'type-not-allowed' };
  return { ok: true, type };
}

export const R2 = {
  photo: (id) => `photos/orig/${id}.webp`,
  thumb: (id) => `photos/thumb/${id}.webp`,
  quarantine: (id) => `quarantine/${id}`,
  clean: (id) => `clean/${id}.webp`,
};

/**
 * Server-side re-encode of a quarantined upload using the Cloudflare Images binding (env.IMAGES).
 * Re-encoding to WebP drops EXIF/GPS/XMP. Wired up in Phase 3 together with the in-branch form;
 * until the IMAGES binding exists this returns {ok:false} and the object stays in quarantine.
 */
export async function reencodeQuarantined(env, row) {
  if (!env.IMAGES) return { ok: false, error: 'images-binding-not-configured' };
  const obj = await env.PHOTOS.get(row.r2_key);
  if (!obj) return { ok: false, error: 'missing' };
  const out = await env.IMAGES.input(obj.body).transform({ width: 2048, height: 2048, fit: 'scale-down' }).output({ format: 'image/webp', quality: 85 });
  const body = await out.response().arrayBuffer();
  if (webpHasMetadata(new Uint8Array(body))) return { ok: false, error: 'metadata-survived' };
  await env.PHOTOS.put(R2.clean(row.id), body, { httpMetadata: { contentType: 'image/webp' } });
  return { ok: true, key: R2.clean(row.id), bytes: body.byteLength };
}
