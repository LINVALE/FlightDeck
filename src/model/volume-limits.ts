/**
 * The server's reading of Roon's two volume limits — the same rule as
 * assets/volume-limits.js, kept in step by test: comfort (`soft_limit`) is a
 * stop a hand may pass with a double tap (`override`), safety
 * (`hard_limit_max`) is a wall nothing passes. The clients hold their own
 * hands to it; the server holds every client to it.
 */
import type { OutputVolume } from './types.ts';

export interface VolumeLimits {
  readonly min: number;
  readonly max: number;
  readonly comfort: number;
  readonly safety: number;
  readonly step: number;
}

export function limitsOf(volume: OutputVolume): VolumeLimits {
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

export type Held = 'none' | 'comfort' | 'safety';

/** An exact level a hand asked for: held to comfort unless overridden; null beyond safety. */
export function askedLevel(value: number, limits: VolumeLimits, override: boolean): { value: number; held: Held } | null {
  if (!Number.isFinite(value)) return null;
  let rounded = Number((limits.min + Math.round((value - limits.min) / limits.step) * limits.step).toFixed(9));
  if (value > limits.safety) return null;
  rounded = Math.min(rounded, limits.safety);
  if (rounded < limits.min) rounded = limits.min;
  if (rounded > limits.comfort && !override) return { value: limits.comfort, held: 'comfort' };
  return { value: rounded, held: 'none' };
}

/** How many of `steps` upward may be taken from `at`. Downward steps stop at the lower hard limit. */
export function askedSteps(at: number | null, steps: number, limits: VolumeLimits, override: boolean): { steps: number; held: Held } {
  if (at === null) return { steps, held: 'none' };
  if (steps <= 0) return { steps: Math.max(steps, -Math.max(0, Math.floor((at - limits.min) / limits.step + 1e-9))) || 0, held: 'none' };
  const ceiling = override ? limits.safety : limits.comfort;
  const room = Math.floor((ceiling - at) / limits.step + 1e-9);
  if (room <= 0) return { steps: 0, held: override ? 'safety' : 'comfort' };
  return { steps: Math.min(steps, room), held: 'none' };
}
