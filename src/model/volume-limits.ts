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
  const min = volume.min ?? 0;
  let max = volume.max ?? 100;
  if (max <= min) max = min + 1;
  const hard = volume.hardLimitMax ?? max;
  const safety = hard > min && hard < max ? hard : max;
  // The scale ends at the safety limit, as Roon reports a RAAT device's range
  // (Peter, 09-07: "match what RAAT does"); supersedes the red band to 100.
  if (safety < max) max = safety;
  const soft = volume.softLimit ?? safety;
  const comfort = soft > min && soft < safety ? soft : safety;
  const step = volume.step !== null && volume.step > 0 ? volume.step : 1;
  return { min, max, comfort, safety, step };
}

export type Held = 'none' | 'comfort' | 'safety';

/** An exact level a hand asked for: held to comfort unless overridden; null beyond safety. */
export function askedLevel(value: number, limits: VolumeLimits, override: boolean): { value: number; held: Held } | null {
  if (!Number.isFinite(value)) return null;
  let rounded = Math.round(value);
  if (rounded > limits.safety) return null;
  if (rounded < limits.min) rounded = limits.min;
  if (rounded > limits.comfort && !override) return { value: limits.comfort, held: 'comfort' };
  return { value: rounded, held: 'none' };
}

/** How many of `steps` upward may be taken from `at`. Downward steps are always free. */
export function askedSteps(at: number | null, steps: number, limits: VolumeLimits, override: boolean): { steps: number; held: Held } {
  if (at === null || steps <= 0) return { steps, held: 'none' };
  const ceiling = override ? limits.safety : limits.comfort;
  const room = Math.floor((ceiling - at) / limits.step);
  if (room <= 0) return { steps: 0, held: override ? 'safety' : 'comfort' };
  return { steps: Math.min(steps, room), held: 'none' };
}
