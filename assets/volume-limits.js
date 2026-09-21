/**
 * ⚖️ VOLUME LIMITS, THE SAME ON EVERY FACE (Peter, 09-06: "we need to be
 * consistent in how we show volume limits — all dials and bars should show 100;
 * the comfort limit to the safe limit in amber/brown and safe to 100 in red;
 * drag to comfort, double tap to go above comfort, and never respond above
 * safe — across all faces").
 *
 * Roon keeps both limits per output and reports them on the wire: `soft_limit`
 * is the COMFORT level (its own app stops there and asks before going on) and
 * `hard_limit_max` is the SAFETY level (nothing goes past it). FlightDeck
 * carries them as softLimit and hardLimitMax and builds no limit of its own.
 * This module is the one reading of them: what the scale shows, what a drag
 * may ask for, what a double tap may ask for, and what nothing may ask for.
 * DOM-free, so the same rule runs in every page and in the tests.
 */

/** The four numbers a scale is drawn from. Missing limits collapse inward. */
export function limitsOf(volume) {
  var step = typeof volume.step === 'number' && isFinite(volume.step) && volume.step > 0 ? volume.step : 1;
  var origin = typeof volume.min === 'number' && isFinite(volume.min) ? volume.min : 0;
  var nativeMax = typeof volume.max === 'number' && isFinite(volume.max) ? Math.max(origin, volume.max) : Math.max(origin, 100);
  var low = typeof volume.hardLimitMin === 'number' && isFinite(volume.hardLimitMin) ? volume.hardLimitMin : origin;
  var high = typeof volume.hardLimitMax === 'number' && isFinite(volume.hardLimitMax) ? volume.hardLimitMax : nativeMax;
  // Round boundaries inward on the device's own grid, including fractional dB.
  var min = Number((origin + Math.ceil((Math.max(origin, Math.min(nativeMax, low)) - origin) / step - 1e-9) * step).toFixed(9));
  var safety = Number((origin + Math.floor((Math.max(min, Math.min(nativeMax, high)) - origin) / step + 1e-9) * step).toFixed(9));
  var soft = typeof volume.softLimit === 'number' && isFinite(volume.softLimit) ? volume.softLimit : safety;
  var comfort = Number((min + Math.floor((Math.max(min, Math.min(safety, soft)) - min) / step + 1e-9) * step).toFixed(9));
  return { min: min, max: safety, comfort: comfort, safety: safety, step: step };
}

/** Where a level sits: 'ok' up to comfort, 'comfort' up to safety, 'danger' beyond. */
export function bandOf(value, limits) {
  if (typeof value !== 'number') return 'ok';
  if (value > limits.safety) return 'danger';
  if (value > limits.comfort) return 'comfort';
  return 'ok';
}

/** The limits as fractions of the scale, for painting: 1 means "no such band". */
export function bandsOf(limits) {
  var span = Math.max(1, limits.max - limits.min);
  return {
    comfortAt: Math.max(0, Math.min(1, (limits.comfort - limits.min) / span)),
    safetyAt: Math.max(0, Math.min(1, (limits.safety - limits.min) / span)),
  };
}

/** The band a scale segment at `fraction` of the way up belongs to. */
export function bandAtFraction(fraction, bands) {
  if (fraction >= bands.safetyAt && bands.safetyAt < 1) return 'danger';
  if (fraction >= bands.comfortAt && bands.comfortAt < bands.safetyAt) return 'comfort';
  return 'ok';
}

/**
 * What a hand may ASK for. A drag or a single tap is held to comfort; a
 * double tap (override) may go to safety; beyond safety nothing is asked at
 * all — null — the room does not respond. The reply says what happened:
 * held at 'comfort', or 'none'.
 */
export function askedLevel(value, limits, override) {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  var rounded = Number((limits.min + Math.round((value - limits.min) / limits.step) * limits.step).toFixed(9));
  if (value > limits.safety) return null;
  rounded = Math.min(rounded, limits.safety);
  if (rounded < limits.min) rounded = limits.min;
  if (rounded > limits.comfort && override !== true) return { value: limits.comfort, held: 'comfort' };
  return { value: rounded, held: 'none' };
}

/** The same rule for a step: how many of `steps` may be taken from `at`. */
export function askedSteps(at, steps, limits, override) {
  if (typeof at !== 'number') return { steps: steps, held: 'none' };
  if (steps <= 0) return { steps: Math.max(steps, -Math.max(0, Math.floor((at - limits.min) / limits.step + 1e-9))) || 0, held: 'none' };
  var ceiling = override === true ? limits.safety : limits.comfort;
  var room = Math.floor((ceiling - at) / limits.step + 1e-9);
  if (room <= 0) return { steps: 0, held: override === true ? 'safety' : 'comfort' };
  return { steps: Math.min(steps, room), held: 'none' };
}

/**
 * A second press of the SAME thing inside the window is a double tap. Keys
 * tell one control from another; `now` is a millisecond clock so the rule
 * can be tested without one.
 */
export function createDoubleTap(windowMs) {
  var lastKey = null;
  var lastAt = -1;
  return {
    press: function (key, now) {
      var twice = key === lastKey && now - lastAt <= windowMs && now >= lastAt;
      lastKey = twice ? null : key;
      lastAt = twice ? -1 : now;
      return twice;
    },
    reset: function () { lastKey = null; lastAt = -1; },
  };
}
