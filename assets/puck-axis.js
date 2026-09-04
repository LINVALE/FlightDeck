/**
 * THE PUCK'S AXIS — three faces on a wheel.
 *
 * ⚖️ ONE AXIS, THREE FACES (Peter, 09-04: "an up and a down arrow on that
 * centre circle that indicates a swipe up or down — and those navigate between
 * control, browse and queue"). A swipe down from the music is the library; down
 * again is the queue; down again is the music. Up runs the other way. A WHEEL,
 * not a ladder: three stops on a wheel put every face one swipe from every
 * other in a known direction, and both arrows on the disc always lead
 * somewhere. Climbing a LEVEL inside the library is the title's job
 * ("‹ GENRES") — it used to be ↑, and that is what changed.
 *
 * ES2018 floor, like every other shipped asset.
 */

export var STOPS = ['play', 'browse', 'queue'];

/** The face a swipe lands on: `dir` > 0 is down, < 0 is up. */
export function nextStop(at, dir) {
  var here = STOPS.indexOf(at);
  if (here === -1) here = 0;
  var step = dir > 0 ? 1 : -1;
  return STOPS[((here + step) % STOPS.length + STOPS.length) % STOPS.length];
}
