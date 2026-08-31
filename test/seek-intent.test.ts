import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The shipped browser module is intentionally plain ES2018 JavaScript.
import { createSeekIntentGate } from '../assets/seek-intent.js';

function clock() {
  let at = 0;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: (): number => at,
    setTimer: (run: () => void, delay: number): number => {
      next += 1;
      timers.set(next, { at: at + delay, run });
      return next;
    },
    clearTimer: (id: number): void => { timers.delete(id); },
    advance: async (ms: number): Promise<void> => {
      const end = at + ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        at = due[1].at;
        timers.delete(due[0]);
        due[1].run();
        await Promise.resolve();
      }
      at = end;
      await Promise.resolve();
    },
  };
}

test('the evidenced 10s then 201s at 520ms becomes one latest seek', async () => {
  const time = clock();
  const sent: unknown[] = [];
  const gate = createSeekIntentGate((body: unknown) => { sent.push(body); return Promise.resolve(); }, {
    quietMs: 700, settleMs: 2500, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
  });
  gate.seek({ zone: 'study', seconds: 10 });
  await time.advance(520);
  gate.seek({ zone: 'study', seconds: 201 });
  await time.advance(699);
  assert.deepEqual(sent, []);
  await time.advance(1);
  assert.deepEqual(sent, [{ action: 'seek', zone: 'study', seconds: 201 }]);
});

test('a later intent cannot overlap an active seek and observes the settlement rail', async () => {
  const time = clock();
  const sent: { seconds: number }[] = [];
  let finish: (() => void) | null = null;
  const gate = createSeekIntentGate((body: { seconds: number }) => {
    sent.push(body);
    return new Promise<void>((resolve) => { finish = resolve; });
  }, { quietMs: 700, settleMs: 2500, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer });

  gate.seek({ zone: 'study', seconds: 20 });
  await time.advance(700);
  gate.seek({ zone: 'study', seconds: 80 });
  gate.seek({ zone: 'study', seconds: 140 });
  await time.advance(5000);
  assert.deepEqual(sent.map((entry) => entry.seconds), [20], 'nothing overlaps the unanswered Core call');
  assert.ok(finish !== null);
  finish?.();
  await Promise.resolve();
  await time.advance(0);
  assert.deepEqual(sent.map((entry) => entry.seconds), [20, 140], 'only the latest queued intention survives');
});

test('duplicate event tails do not manufacture another seek', async () => {
  const time = clock();
  const sent: unknown[] = [];
  const gate = createSeekIntentGate((body: unknown) => { sent.push(body); return Promise.resolve(); }, {
    quietMs: 700, settleMs: 2500, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
  });
  gate.seek({ zone: 'study', seconds: 42 });
  gate.seek({ zone: 'study', seconds: 42 });
  await time.advance(700);
  assert.equal(sent.length, 1);
});
