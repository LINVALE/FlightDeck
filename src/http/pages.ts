import { renderMarkdown } from './markdown.ts';

/**
 * Page shells only. Everything live is rendered by the client from the snapshot,
 * so these are tiny and cacheable-in-spirit: no zone data is ever baked in.
 */

// Every face from the design tournament, each with a layout behind it. A name
// only belongs here once it renders differently from the others.
const FACES = ['presence', 'classic', 'dial', 'orbit', 'libretto', 'folio', 'plate', 'rondo', 'canvas', 'gallery', 'aurora'] as const;
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
    + '<script type="module" nonce="' + nonce + '" src="/assets/' + (styleHref.includes('wall') ? 'wall' : (styleHref.includes('phone') ? 'phone' : 'face')) + '.js"></script>'
    + '</head>';
}

/**
 * ONE address, and no QR.
 *
 * The QR was here because `.local` does not resolve on Fire OS, Echo Show or
 * Android <= 11, so a TV may only ever be able to show a typeable or scannable
 * address. That reasoning still holds for the ADDRESS — which is why the one
 * shown is the numeric one, not the pretty one — but the code itself was never
 * once scanned successfully, and a broken affordance taking a corner of the wall
 * is worse than none (Peter, 08-26). `qrSvg` and its tests stay put, for a
 * click-to-show once a phone has actually read one.
 *
 * Three lines were two too many: whoever is reading this already reached the
 * page, and the address is for the NEXT device, which needs one that works.
 */
export function renderWallPage(nonce: string, urls: readonly string[]): string {
  const numeric = urls.find((url) => /^https?:\/\/\d+\.\d+\.\d+\.\d+(\/|:|$)/.test(url));
  const reach = numeric ?? urls[0] ?? '';
  return head(nonce, 'FlightDeck', '/assets/wall.css')
    + '<body><main class="wall" id="wall" data-state="connecting">'
    + '<div class="wall-startup" id="wall-startup" role="status" aria-live="polite">'
    + '<div class="wall-startup-brand">FLIGHT<span>DECK</span></div>'
    + '<span class="wall-startup-spinner" aria-hidden="true"></span>'
    + '<div class="wall-startup-title">Preparing rooms</div>'
    + '<div class="wall-startup-copy">Finding devices and arranging the Wall…</div>'
    + '</div>'
    + '<header class="wall-head">'
    + '<nav class="wall-tabs" id="tabs" hidden></nav>'
    + '</header>'
    + '<div class="grid" id="grid"></div>'
    + '<footer class="wall-foot">'
    + '<div class="wall-status">'
    + '<div class="brand">FLIGHT<span>DECK</span></div>'
    + '<div class="wall-summary" id="summary">Connecting…</div>'
    + '<div class="wall-core" id="core"></div>'
    + '</div>'
    + '<div class="reach">'
    + (reach === '' ? '' : '<span class="url primary">' + reach + '</span>')
    + '<span class="reach-note">add <code>/now</code> for a screen that follows the music</span>'
    + '</div>'
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
  zones: readonly { id: string; name: string; state: string; outputs?: readonly { name: string }[] }[],
  token: string,
): string | null {
  if (token === '') return null;
  for (const zone of zones) if (zone.id === token) return zone.id;
  const wanted = zoneSlug(token);
  if (wanted === '') return null;

  /**
   * A zone is matched on its own name AND on its OUTPUT names (Peter, 08-25:
   * "the actual name is the display name on the output"). This matters the moment
   * zones are grouped: Roon renames the ZONE to the group, and the room's real
   * name survives only in the outputs — so /face/kitchen must still find the
   * kitchen when the kitchen is playing as part of a group.
   */
  const names = (zone: { name: string; outputs?: readonly { name: string }[] }): string[] => {
    const all = [zoneSlug(zone.name)];
    for (const output of zone.outputs ?? []) all.push(zoneSlug(output.name));
    return all.filter((n) => n !== '');
  };

  const exact = zones.filter((zone) => names(zone).includes(wanted));
  const prefix = zones.filter((zone) => names(zone).some((n) => n.startsWith(wanted)));
  const pool = exact.length > 0 ? exact : prefix;
  if (pool.length === 0) return null;
  const playing = pool.find((zone) => zone.state === 'playing' || zone.state === 'loading');
  return (playing ?? pool[0]).id;
}


export interface ZoneLike {
  id: string;
  name: string;
  state: string;
  outputs?: readonly { id?: string; name: string }[];
}

/**
 * Resolve what someone typed after /face/ to an OUTPUT — the physical thing in
 * the room — rather than to a zone.
 *
 * Peter, 08-25: a display should show "the zone that is playing and contains the
 * output this screen is set up for". That is the difference that matters when
 * rooms are grouped: the Study speaker joins the Downstairs zone, and the TV in
 * the study should then show what Downstairs is playing, because that IS what is
 * coming out of the speaker beside it. Binding to a zone cannot express that;
 * binding to an output can, and the zone is re-derived on every snapshot.
 */
export function resolveOutput(zones: readonly ZoneLike[], token: string): { outputId: string; zoneId: string } | null {
  if (token === '') return null;
  const wanted = zoneSlug(token);
  if (wanted === '') return null;

  const candidates: { outputId: string; zoneId: string; exact: boolean; playing: boolean }[] = [];
  for (const zone of zones) {
    const playing = zone.state === 'playing' || zone.state === 'loading';
    for (const output of zone.outputs ?? []) {
      const slug = zoneSlug(output.name);
      if (slug === '' || output.id === undefined) continue;
      if (slug === wanted) candidates.push({ outputId: output.id, zoneId: zone.id, exact: true, playing });
      else if (slug.startsWith(wanted)) candidates.push({ outputId: output.id, zoneId: zone.id, exact: false, playing });
    }
  }
  if (candidates.length === 0) return null;
  const exact = candidates.filter((c) => c.exact);
  const pool = exact.length > 0 ? exact : candidates;
  const playing = pool.find((c) => c.playing);
  const chosen = playing ?? pool[0];
  return { outputId: chosen.outputId, zoneId: chosen.zoneId };
}

export function renderFacePage(
  nonce: string, zoneId: string, faceParam: string | null, followParam: string | null = null,
  zoneToken: string | null = null, outputId: string | null = null,
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
    // The OUTPUT this screen belongs to. The zone is re-derived from it on every
    // snapshot, so grouping the room does not strand the display.
    + (outputId === null ? '' : ' data-output="' + outputId.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 128) + '"')
    // An explicit ?face= always WINS; otherwise the client reads its own memory.
    + (face === null ? '' : ' data-face-param="' + face + '"')
    + (followParam === '1' ? ' data-follow="1"' : (followParam === '0' ? ' data-follow="0"' : ''))
    + ' data-state="connecting"></main>'
    + '<div class="picker" id="picker" hidden aria-live="polite"></div>'
    + '</body></html>';
}

/**
 * The PHONE. A third page, not the Face responding: the Face's grammar (zoned
 * presses, summoned chrome, dwell) is a television's, and a phone inverts it —
 * controls standing, thumb-reach layout, visible navigation. Same organs
 * underneath: snapshot, stream, art relay, control API (docs/phone-interface.md).
 *
 * Like the Face it can be pinned by NAME (/phone/study); with no token the page
 * holds whatever this phone last held, then whatever is playing.
 */
export function renderPhonePage(nonce: string, zoneId: string, zoneToken: string | null = null): string {
  const safeZone = zoneId.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 128);
  const safeToken = (zoneToken ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64).toLowerCase();
  return head(nonce, 'FlightDeck', '/assets/phone.css')
    + '<body><main class="phone" id="phone"'
    + ' data-zone="' + safeZone + '"'
    + (safeToken === '' ? '' : ' data-zone-slug="' + safeToken + '"')
    + ' data-state="connecting"></main>'
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
