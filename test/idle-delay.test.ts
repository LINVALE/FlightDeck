import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdleDelayPolicy, normalizeIdleDelay } from '../assets/idle-delay.js';

function fakeClock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  let lastCallback: (() => void) | null = null;
  return {
    now: () => time,
    setTimer(run: () => void, delay: number) {
      const id = nextId++;
      lastCallback = run;
      timers.set(id, { at: time + delay, run });
      return id;
    },
    clearTimer(id: number) { timers.delete(id); },
    advance(ms: number) {
      time += ms;
      while (true) {
        const due = [...timers.entries()]
          .filter((entry) => entry[1].at <= time)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].run();
      }
    },
    deadline() {
      const first = [...timers.values()].sort((a, b) => a.at - b.at)[0];
      return first ? first.at : null;
    },
    timerCount: () => timers.size,
    lastCallback: () => lastCallback,
  };
}

function policy(clock: ReturnType<typeof fakeClock>, delayMinutes: unknown = 15) {
  let due = 0;
  const idle = createIdleDelayPolicy({
    delayMinutes,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => { due += 1; },
  });
  return { idle, due: () => due };
}

test('idle delays are a bounded policy with a 15 minute default', () => {
  for (const value of [0, 15, 30, 60, 120, 240]) assert.equal(normalizeIdleDelay(value), value);
  for (const value of [undefined, null, -1, 14, 241, 'rubbish']) {
    assert.equal(normalizeIdleDelay(value), 15);
  }
});

test('repeated inactive snapshots and paused-to-stopped do not move the deadline', () => {
  const clock = fakeClock();
  const { idle, due } = policy(clock);
  idle.markPainted('z1');
  assert.equal(idle.reconcile('z1', true, true), false);
  assert.equal(clock.deadline(), 15 * 60000);
  clock.advance(5 * 60000);
  assert.equal(idle.reconcile('z1', true, false), false, 'same-zone stopped state keeps held art');
  assert.equal(clock.deadline(), 15 * 60000);
  assert.equal(clock.timerCount(), 1, 'the existing absolute timer is reused');
  clock.advance(10 * 60000);
  assert.equal(due(), 1);
  assert.equal(idle.reconcile('z1', true, false), true);
});

test('resume cancels the timer and fences even a late callback', () => {
  const clock = fakeClock();
  const { idle, due } = policy(clock);
  idle.markPainted('z1');
  idle.reconcile('z1', true, true);
  const stale = clock.lastCallback();
  assert.equal(idle.reconcile('z1', false, true), false);
  assert.equal(clock.timerCount(), 0);
  stale?.();
  assert.equal(due(), 0);
});

test('changing zones starts a fresh deadline and never holds the other room art', () => {
  const clock = fakeClock();
  const { idle } = policy(clock);
  idle.markPainted('z1');
  idle.reconcile('z1', true, true);
  clock.advance(5 * 60000);
  assert.equal(idle.reconcile('z2', true, true), false);
  assert.equal(clock.deadline(), 20 * 60000);
  assert.equal(idle.reconcile('z3', true, false), true, 'cold null-now-playing zones clock immediately');
});

test('live delay changes retain the original inactivity anchor', () => {
  const clock = fakeClock();
  const { idle } = policy(clock);
  idle.markPainted('z1');
  idle.reconcile('z1', true, true);
  clock.advance(10 * 60000);
  assert.equal(idle.setDelay(30), true);
  assert.equal(idle.reconcile('z1', true, true), false);
  assert.equal(clock.deadline(), 30 * 60000, 'a longer choice extends from the original pause');
  clock.advance(15 * 60000);
  assert.equal(idle.setDelay(15), true);
  assert.equal(idle.reconcile('z1', true, true), true, 'a shorter elapsed choice clocks now');
  assert.equal(idle.setDelay(15), false, 'an unchanged heartbeat is a no-op');
});

test('null now-playing receives grace only for content painted by that same zone', () => {
  const clock = fakeClock();
  const { idle } = policy(clock);
  assert.equal(idle.reconcile('z1', true, false), true);
  assert.equal(clock.timerCount(), 0);
  idle.reconcile('z1', false, true);
  idle.markPainted('z1');
  assert.equal(idle.reconcile('z1', true, false), false);
  assert.equal(clock.deadline(), 15 * 60000);
});
