/**
 * A deliberately conservative answer to "did the music just turn a page?".
 *
 * Roon's zone projection does not expose a queue-item id.  A Face therefore
 * animates only the small intersection it can prove visually: one witnessed
 * live successor, same zone/process, active finite media, changed music
 * metadata, and a genuinely different cover that is still the image on screen.
 * Roon may publish several structural frames while one successor loads, so the
 * painted cover's last stable receipt is carried across those intermediate
 * frames. Every ambiguous case settles directly instead of manufacturing a
 * transition.
 *
 * ES2018 only: this module is shipped to the Chromium 63 browser floor.
 */

function text(value) { return typeof value === 'string' ? value : ''; }

export function coverTransitionReceipt(snapshot, zone) {
  if (snapshot === null || zone === null || zone.nowPlaying === null) return null;
  var np = zone.nowPlaying;
  var artKey = np.art !== null && typeof np.art.key === 'string' ? np.art.key : '';
  var length = typeof np.lengthSec === 'number' && isFinite(np.lengthSec) && np.lengthSec > 0
    ? np.lengthSec : null;
  return {
    generation: text(snapshot.generation),
    revision: typeof snapshot.revision === 'number' && Number.isInteger(snapshot.revision)
      ? snapshot.revision : -1,
    zoneId: text(zone.id),
    state: text(zone.state),
    artKey: artKey,
    // Loading briefly disables seek on some Roon outputs even when the incoming
    // item already has an honest duration. Duration—not that transient control
    // flag—is what distinguishes a finite track from live radio here.
    finite: length !== null,
    trackKey: [text(np.title), text(np.line2), text(np.line3), String(length)].join('\u001f'),
  };
}

function active(state) { return state === 'playing' || state === 'loading'; }

/**
 * Keep the receipt belonging to the image a person can still see. Roon often
 * inserts a same-cover `loading` frame (and unrelated rooms can advance the
 * global revision) before it publishes the successor's artwork. Replacing the
 * receipt on that frame erases the very old/new pair the turn needs.
 *
 * A real same-cover track or metadata change advances once its finite identity
 * is available, ensuring a later artwork correction does not masquerade as a
 * second track. Pause/stop and every authoritative baseline also advance.
 */
export function stableCoverReceipt(previous, next, kind, sameArt) {
  if (kind !== 'update' || previous === null || next === null || sameArt !== true) return next;
  if (previous.generation !== next.generation || previous.zoneId !== next.zoneId) return next;
  if (next.state === 'paused' || next.state === 'stopped') return next;
  if (next.trackKey !== previous.trackKey && next.finite === true) return next;
  return previous;
}

export function shouldFlipCover(previous, next, kind, paintedArtKey, visible, albumView) {
  if (kind !== 'update' || previous === null || next === null) return false;
  if (visible !== true || albumView !== true) return false;
  if (previous.generation === '' || previous.generation !== next.generation) return false;
  if (previous.zoneId === '' || previous.zoneId !== next.zoneId) return false;
  // Snapshot revision is fleet-global. Other rooms and the successor's loading
  // frame may legitimately sit between these two observations.
  if (previous.revision < 0 || next.revision <= previous.revision) return false;
  if (!active(previous.state) || !active(next.state)) return false;
  if (previous.finite !== true || next.finite !== true) return false;
  if (previous.trackKey === next.trackKey) return false;
  if (previous.artKey === '' || next.artKey === '' || previous.artKey === next.artKey) return false;
  return paintedArtKey === previous.artKey;
}
