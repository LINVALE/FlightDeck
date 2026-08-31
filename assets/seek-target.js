/**
 * Convert a progress fraction into an absolute Roon seek without ever naming
 * the track's terminal boundary. Roon positions are zero-based: on a 211-second
 * item, 210 is the last whole playable second and 211 is the hand-off edge.
 *
 * ES2018 only: this module is shipped to the Chromium 63 browser floor.
 */
export function seekTargetSecond(fraction, length) {
  if (typeof fraction !== 'number' || !isFinite(fraction)
      || typeof length !== 'number' || !isFinite(length) || length <= 0) return null;
  var bounded = Math.max(0, Math.min(1, fraction));
  var lastPlayable = Math.max(0, Math.ceil(length) - 1);
  return Math.min(Math.round(bounded * length), lastPlayable);
}
