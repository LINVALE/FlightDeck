import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVolumeGate, levelAtAngle } from '../assets/volume-gate.js';

/**
 * A clock and a timer the test owns, so a five-second flood runs in no time and
 * every request is answered exactly when the test says.
 */
function rig(opts: Record<string, unknown> = {}) {
  let clock = 0;
  const sent: number[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let answer: (() => void)[] = [];
  const gate = createVolumeGate((steps: number) => {
    sent.push(steps);
    return new Promise<void>((resolve) => { answer.push(resolve); });
  }, {
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => { timers.push({ at: clock + ms, fn }); return timers.length; },
    ...opts,
  });
  const tick = (ms: number): void => {
    clock += ms;
    for (const t of timers.splice(0)) { if (t.at <= clock) t.fn(); else timers.push(t); }
  };
  const settle = async (): Promise<void> => {
    const waiting = answer; answer = [];
    for (const resolve of waiting) resolve();
    await new Promise((r) => setImmediate(r));
  };
  return { gate, sent, tick, settle, clock: () => clock };
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * ⚠️ THE RUNAWAY, replayed: a wheel with inertia delivering sixty events a
 * second for five seconds, each answered by Roon promptly. Before the gate that
 * was +104 steps to a real room; the log is in the commit.
 */
test('a five-second wheel flood cannot move a room more than the session cap', async () => {
  const r = rig();
  let stepped = 0;
  for (let i = 0; i < 300; i += 1) {
    r.gate.scroll(100, (dir) => { if (r.gate.step(dir) === 'sent') stepped += 1; });
    r.tick(16);
    await r.settle();
  }
  assert.ok(stepped <= 12, 'accepted ' + String(stepped) + ' steps of a 300-event flood');
  assert.ok(sum(r.sent) <= 12, 'sent ' + String(sum(r.sent)) + ' steps net to Roon');
  for (const batch of r.sent) assert.ok(Math.abs(batch) <= 4, 'a batch of ' + String(batch));
});

test('a trackpad\'s forty tiny deltas are four detents, not forty', () => {
  const r = rig();
  const dirs: number[] = [];
  let detents = 0;
  for (let i = 0; i < 40; i += 1) detents += r.gate.scroll(10, (d) => { dirs.push(d); });
  assert.equal(detents, 4);
  assert.deepEqual(dirs, [1, 1, 1, 1]);
  // A mouse notch is exactly one; half a notch is nothing until the other half.
  assert.equal(r.gate.scroll(50), 0);
  assert.equal(r.gate.scroll(50), 1);
  assert.equal(r.gate.scroll(-100), 1);
  assert.equal(r.gate.scroll(0), 0);
  assert.equal(r.gate.scroll(NaN), 0);
});

test('no more than five steps in any second, whatever the hand does', async () => {
  const r = rig();
  const verdicts: string[] = [];
  for (let i = 0; i < 20; i += 1) { verdicts.push(r.gate.step(1)); r.tick(20); await r.settle(); }
  assert.equal(verdicts.filter((v) => v === 'sent').length, 5);
  assert.equal(verdicts.filter((v) => v === 'budget').length, 15);
  // The budget is rolling: a second later there is room again.
  r.tick(1000);
  assert.equal(r.gate.step(1), 'sent');
});

test('a continuous spin stops at twelve net until the wheel rests', async () => {
  const r = rig();
  const verdicts: string[] = [];
  // Four detents a second, well inside the budget, for six seconds.
  for (let i = 0; i < 24; i += 1) { verdicts.push(r.gate.step(1)); r.tick(250); await r.settle(); }
  assert.equal(verdicts.filter((v) => v === 'sent').length, 12);
  assert.equal(verdicts.filter((v) => v === 'rest').length, 12);
  assert.equal(sum(r.sent), 12);
  // Resting for most of a second opens a new session; turning back down is fine
  // within one too — the cap is on NET movement, not on activity.
  r.tick(900);
  assert.equal(r.gate.step(-1), 'sent');
  assert.equal(r.gate.step(-1), 'sent');
});

test('one request in flight, and what gathers meanwhile goes as one batch', async () => {
  const r = rig();
  assert.equal(r.gate.step(1), 'sent');
  assert.deepEqual(r.sent, [1]);
  assert.equal(r.gate.inFlight(), true);
  // Three more detents while Roon is still answering the first.
  r.tick(120); r.gate.step(1);
  r.tick(120); r.gate.step(1);
  r.tick(120); r.gate.step(1);
  assert.deepEqual(r.sent, [1], 'nothing else may leave while one is in flight');
  await r.settle();
  assert.deepEqual(r.sent, [1, 3], 'then the three go together, once');
  assert.equal(r.gate.inFlight(), true);
  await r.settle();
  assert.equal(r.gate.inFlight(), false);
});

test('a request that never answers unlatches, but not early', async () => {
  const r = rig();
  r.gate.step(1);
  r.tick(120); r.gate.step(1);
  r.tick(2000);
  assert.deepEqual(r.sent, [1], 'two seconds is not long enough to assume Roon is gone');
  r.tick(600);
  assert.deepEqual(r.sent, [1, 1], 'past the guard the held step goes, alone');
});

test('the reading under the hand never runs more than four ahead of Roon', async () => {
  const r = rig();
  for (let i = 0; i < 5; i += 1) { r.gate.step(1); r.tick(210); }
  assert.equal(r.gate.ahead(), 4, 'five accepted, but the face may only claim four');
  r.gate.confirm();
  assert.equal(r.gate.ahead(), 0, 'what Roon answered is no longer owed');
  r.gate.reset();
  assert.equal(r.gate.inFlight(), true, 'reset forgets the hand, not the wire');
});

/**
 * ⚖️ THE DOTS ARE THE CONTROL (Peter, 09-03). A tap on a dot is the level that
 * dot shows: twelve o'clock is the floor, round clockwise to the device's own
 * maximum at the top again, quantised to the thirty detents the bezel draws.
 */
test('a tap on the bezel maps to the dot under it, on the device\'s own range', () => {
  // atan2 angles: -90 is twelve o'clock, 0 is three, 90 is six, 180 is nine.
  // With four dots the quarter hours sit exactly on a dot.
  assert.equal(levelAtAngle(-90, 0, 80, 4), 0, 'twelve o\'clock is the floor');
  assert.equal(levelAtAngle(0, 0, 80, 4), 20, 'three o\'clock is a quarter turn');
  assert.equal(levelAtAngle(90, 0, 80, 4), 40, 'six is half');
  assert.equal(levelAtAngle(180, 0, 80, 4), 60, 'nine is three quarters');
  // Thirty dots, as the bezel draws: six o'clock is dot 15 of 30, and just
  // short of twelve is the top dot — the maximum, never a step past it.
  assert.equal(levelAtAngle(90, 0, 80, 30), 40);
  assert.equal(levelAtAngle(-91, 0, 80, 30), 80);
  // The Theater: 0–98, and a range that does not start at zero.
  assert.equal(levelAtAngle(90, 0, 98, 30), 49);
  assert.equal(levelAtAngle(90, 20, 60, 30), 40);
  // Quantised: two angles inside the same detent give the same level.
  assert.equal(levelAtAngle(3, 0, 80, 30), levelAtAngle(8, 0, 80, 30));
  assert.equal(levelAtAngle(NaN, 0, 80, 30), null);
  assert.equal(levelAtAngle(0, 80, 80, 30), null, 'a range with no span is not a control');
});
