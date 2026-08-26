import { qrSvg } from './qr.ts';
import { renderMarkdown } from './markdown.ts';

/**
 * Page shells only. Everything live is rendered by the client from the snapshot,
 * so these are tiny and cacheable-in-spirit: no zone data is ever baked in.
 */

const FACES = ['presence', 'dial', 'classic', 'canvas', 'libretto'] as const;
export type FaceName = (typeof FACES)[number];
export const DEFAULT_FACE: FaceName = 'presence';

export function normalizeFace(raw: string | null): FaceName | null {
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  return (FACES as readonly string[]).includes(lower) ? (lower as FaceName) : null;
}

function head(nonce: string, title: string, styleHref: string): string {
  return '<!doctype html><html lang="en"><head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="color-scheme" content="dark">'
    + '<title>' + title + '</title>'
    // Add-to-Home-Screen: gives Fire TV / Android TV / iPad an icon and true
    // fullscreen with no browser chrome. Samsung and LG browsers ignore it —
    // there the route is the browser homepage plus Autorun (docs/tv-setup.md).
    + '<link rel="manifest" href="/assets/app.webmanifest">'
    + '<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">'
    + '<link rel="apple-touch-icon" href="/assets/icon-192.png">'
    + '<meta name="mobile-web-app-capable" content="yes">'
    + '<meta name="apple-mobile-web-app-capable" content="yes">'
    + '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    + '<meta name="theme-color" content="#0a0b0d">'
    + '<link rel="stylesheet" href="' + styleHref + '">'
    + '<script type="module" nonce="' + nonce + '" src="/assets/' + (styleHref.includes('wall') ? 'wall' : 'face') + '.js"></script>'
    + '</head>';
}

export function renderWallPage(nonce: string, urls: readonly string[]): string {
  const primary = urls[0] ?? '';
  const secondary = urls.slice(1);
  // ⚠️ The QR is REQUIRED, not decorative: .local does not resolve on Fire OS,
  // Echo Show or Android <= 11, so a TV may only ever show a typeable/scannable IP.
  const qr = secondary.length > 0 ? qrSvg(secondary[0], 132, '#0b0c0e', '#e8e3d8')
    : (primary === '' ? '' : qrSvg(primary, 132, '#0b0c0e', '#e8e3d8'));
  return head(nonce, 'FlightDeck', '/assets/wall.css')
    + '<body><main class="wall" id="wall" data-state="connecting">'
    + '<header class="wall-head">'
    + '<div class="brand">FLIGHT<span>DECK</span></div>'
    + '<div class="wall-summary" id="summary">Connecting…</div>'
    + '<div class="wall-core" id="core"></div>'
    + '</header>'
    + '<div class="grid" id="grid"></div>'
    + '<footer class="wall-foot">'
    + '<div class="reach"><div class="reach-urls">'
    + (primary === '' ? '' : '<div class="url primary">' + primary + '</div>')
    + secondary.map((url) => '<div class="url alt">' + url + '</div>').join('')
    + '<div class="reach-note">Add <code>/now</code> for a screen that follows the music · '
    + 'type the address on a TV that cannot find <code>.local</code></div>'
    + '</div><div class="qr">' + qr + '</div></div>'
    + '</footer></main></body></html>';
}


/** `Study RHEOS` -> `studyrheos`. What a person can type on a TV remote. */
export function zoneSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve what someone typed after /face/ to a zone id. Accepts the real id, or
 * a NAME — because a zone id is 36 hex characters and nobody is typing that with
 * a remote.
 *
 * A partial name is allowed and deliberately prefers a zone that is playing:
 * `/face/study` on a house with Study RHEOS, Study Airplay and Study ROON should
 * land on the one making sound.
 */
export function resolveZone(
  zones: readonly { id: string; name: string; state: string }[], token: string,
): string | null {
  if (token === '') return null;
  for (const zone of zones) if (zone.id === token) return zone.id;
  const wanted = zoneSlug(token);
  if (wanted === '') return null;
  const exact = zones.filter((zone) => zoneSlug(zone.name) === wanted);
  const prefix = zones.filter((zone) => zoneSlug(zone.name).startsWith(wanted));
  const pool = exact.length > 0 ? exact : prefix;
  if (pool.length === 0) return null;
  const playing = pool.find((zone) => zone.state === 'playing' || zone.state === 'loading');
  return (playing ?? pool[0]).id;
}

export function renderFacePage(
  nonce: string, zoneId: string, faceParam: string | null, followParam: string | null = null,
  zoneToken: string | null = null,
): string {
  const face = normalizeFace(faceParam);
  const safeZone = zoneId.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 128);
  // The NAME travels with the page as well as the id. A TV is mounted for years;
  // Roon zone ids do not survive every Core change, and a bookmark that dies
  // silently is worse than one that re-finds its room by name.
  const safeToken = (zoneToken ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64).toLowerCase();
  return head(nonce, 'FlightDeck', '/assets/face.css')
    + '<body><main class="face" id="face"'
    + ' data-zone="' + safeZone + '"'
    + (safeToken === '' ? '' : ' data-zone-slug="' + safeToken + '"')
    // An explicit ?face= always WINS; otherwise the client reads its own memory.
    + (face === null ? '' : ' data-face-param="' + face + '"')
    + (followParam === '1' ? ' data-follow="1"' : (followParam === '0' ? ' data-follow="0"' : ''))
    + ' data-state="connecting"></main>'
    + '<div class="picker" id="picker" hidden aria-live="polite"></div>'
    + '</body></html>';
}

/**
 * A repo document, rendered. Served from the Markdown at request time so the file
 * in docs/ stays the single source of truth — there is no generated copy to drift.
 */
export function renderDocPage(nonce: string, title: string, markdown: string): string {
  return '<!doctype html><html lang="en"><head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="color-scheme" content="dark">'
    + '<title>' + title + ' — FlightDeck</title>'
    + '<link rel="stylesheet" href="/assets/doc.css">'
    + '<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">'
    + '</head><body><main>'
    + '<nav class="docnav"><span class="brand">FLIGHT<span>DECK</span></span>'
    + '<a href="/">&larr; the Wall</a></nav>'
    + renderMarkdown(markdown)
    + '</main></body></html>';
}
