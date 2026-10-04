import { esc, ROBOTS_META } from '../lib/http.js';
// No og:/twitter: tags, ever (family-only rule). Tests assert this.
export function head(title, extra = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="${ROBOTS_META}"><meta name="googlebot" content="${ROBOTS_META}">
<meta name="referrer" content="no-referrer"><meta name="color-scheme" content="dark">
<title>${esc(title)}</title><link rel="icon" href="/assets/favicon.png">
<link rel="preload" href="/assets/fonts/cormorant.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">${extra}</head>`;
}
export const DEFS = `<defs>
 <radialGradient id="nodeFill" cx="40%" cy="35%"><stop offset="0" stop-color="#2a3d52"/><stop offset="1" stop-color="#121d2a"/></radialGradient>
 <radialGradient id="halo"><stop offset="0" stop-color="#9A7448" stop-opacity=".55"/><stop offset=".5" stop-color="#9A7448" stop-opacity=".12"/><stop offset="1" stop-color="#9A7448" stop-opacity="0"/></radialGradient>
 <radialGradient id="haloIvory"><stop offset="0" stop-color="#E9E1D3" stop-opacity=".5"/><stop offset=".5" stop-color="#B9A487" stop-opacity=".12"/><stop offset="1" stop-color="#B9A487" stop-opacity="0"/></radialGradient>
 <linearGradient id="linkGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="900" y2="700"><stop offset="0" stop-color="#B9A487" stop-opacity=".85"/><stop offset="1" stop-color="#9A7448" stop-opacity=".5"/></linearGradient>
 <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="900" height="740"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;
