/**
 * WHAT IS THIS SCREEN STANDING ON? (Peter, 09-06: a Fire TV had been taken
 * for a phone.) FlightDeck never read the user agent for it; the only rule was
 * a WIDTH breakpoint, and width alone is the wrong signal — a phone lying down
 * is wider than the breakpoint, and a television whose browser scales its
 * layout is narrower. Three things together, none of them the user agent:
 *
 *   · the SHORT side of the viewport, phone-sized (≤ 600 CSS px). A
 *     television's short side is 720 or 1080 however its browser scales;
 *   · NO HOVER and a COARSE pointer, from the media queries. A phone has both.
 *     Silk on a Fire TV drives a cursor, so it has neither;
 *   · an EXPLICIT choice that wins and is remembered — `?ui=phone` or
 *     `?ui=tv`, forgotten again by `?ui=auto` — the same pattern as `?face=`,
 *     so a wrong guess is fixed once per screen and designs can be compared
 *     on any device.
 *
 * Tablets read as `tv` on purpose: their short side is past the bound and the
 * television pages are comfortable at that size.
 */

export var PHONE_SHORT_SIDE = 600;
export var UI_KEY = 'flightdeck.ui';

/** The shape a reading resolves to: 'phone' or 'tv'. */
export function shapeOf(reading) {
  var short = Number(reading.shortSide) || 0;
  if (short > 0 && short <= PHONE_SHORT_SIDE && reading.hoverNone === true && reading.coarse === true) return 'phone';
  return 'tv';
}

/** What the browser reports, in the terms the rule wants. */
export function readScreen(win) {
  var w = win.innerWidth || 0;
  var h = win.innerHeight || 0;
  var mq = function (query) {
    try { return typeof win.matchMedia === 'function' && win.matchMedia(query).matches === true; } catch (e) { return false; }
  };
  return { width: w, height: h, shortSide: Math.min(w, h), hoverNone: mq('(hover: none)'), coarse: mq('(pointer: coarse)') };
}

/**
 * The explicit choice. A `?ui=` in the address is stored and wins; with none,
 * what was stored wins; `?ui=auto` clears it. Storage may be null (private
 * mode), in which case only the address counts.
 */
export function uiOverride(search, storage) {
  var match = /[?&]ui=([a-z]+)/.exec(String(search || ''));
  var asked = match === null ? null : match[1];
  if (asked === 'auto') {
    if (storage !== null) { try { storage.removeItem(UI_KEY); } catch (e) { /* private */ } }
    return null;
  }
  if (asked === 'phone' || asked === 'tv') {
    if (storage !== null) { try { storage.setItem(UI_KEY, asked); } catch (e) { /* private */ } }
    return asked;
  }
  if (storage === null) return null;
  var stored = null;
  try { stored = storage.getItem(UI_KEY); } catch (e) { stored = null; }
  return stored === 'phone' || stored === 'tv' ? stored : null;
}

/** The decision a page acts on. */
export function decideUi(win, search, storage) {
  var chosen = uiOverride(search, storage);
  return chosen !== null ? chosen : shapeOf(readScreen(win));
}

/** What a page tells the registry about its screen. */
export function screenReport(win, page, shape) {
  var reading = readScreen(win);
  var agent = '';
  try { agent = String(win.navigator && win.navigator.userAgent || '').slice(0, 160); } catch (e) { agent = ''; }
  return { width: reading.width, height: reading.height, agent: agent, page: page, shape: shape };
}
