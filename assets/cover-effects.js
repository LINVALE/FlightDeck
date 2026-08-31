/** A small, television-safe transition repertoire. */
var EFFECTS = ['flip', 'slide', 'dissolve', 'lift'];

/**
 * Resolve a fixed choice, or choose a random effect without immediately
 * repeating the last random result. `sample` is injected by tests; production
 * passes Math.random().
 */
export function chooseCoverEffect(mode, previous, sample) {
  if (EFFECTS.indexOf(mode) !== -1) return mode;
  if (mode !== 'random') return null;
  var choices = EFFECTS.filter(function (name) { return name !== previous; });
  if (choices.length === 0) choices = EFFECTS.slice();
  var value = typeof sample === 'number' && isFinite(sample) ? sample : 0;
  var index = Math.floor(Math.max(0, Math.min(0.999999, value)) * choices.length);
  return choices[index];
}
