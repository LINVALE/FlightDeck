import { qrSvg } from './qr.ts';

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

export function renderFacePage(
  nonce: string, zoneId: string, faceParam: string | null, followParam: string | null = null,
): string {
  const face = normalizeFace(faceParam);
  const safeZone = zoneId.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 128);
  return head(nonce, 'FlightDeck', '/assets/face.css')
    + '<body><main class="face" id="face"'
    + ' data-zone="' + safeZone + '"'
    // An explicit ?face= always WINS; otherwise the client reads its own memory.
    + (face === null ? '' : ' data-face-param="' + face + '"')
    + (followParam === '1' ? ' data-follow="1"' : (followParam === '0' ? ' data-follow="0"' : ''))
    + ' data-state="connecting"></main>'
    + '<div class="picker" id="picker" hidden aria-live="polite"></div>'
    + '</body></html>';
}
