/**
 * One screen owns at most one seek command at a time. A quick run of presses is
 * one changing intention, so wait for its quiet edge and send only the latest
 * position. If another intention arrives while Roon is answering, retain just
 * that latest position and observe a short settlement rail before sending it.
 *
 * This prevents a physical renderer from latching seek A while Roon's cursor
 * accepts overlapping seek B—the exact 10s -> 201s live failure.
 * ES2018 only: this module is shipped to the Chromium 63 browser floor.
 */

function same(left, right) {
  return left !== null && right !== null
    && left.zone === right.zone && left.seconds === right.seconds;
}

export function createSeekIntentGate(send, options) {
  var opts = options || {};
  var quietMs = typeof opts.quietMs === 'number' ? opts.quietMs : 700;
  var settleMs = typeof opts.settleMs === 'number' ? opts.settleMs : 2500;
  var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
  var setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : setTimeout;
  var clearTimer = typeof opts.clearTimer === 'function' ? opts.clearTimer : clearTimeout;
  var pending = null;
  var active = null;
  var timer = null;
  var quietUntil = 0;
  var lastSentAt = -Infinity;

  function arm() {
    if (active !== null || pending === null) return;
    var wait = Math.max(0, quietUntil - now(), lastSentAt + settleMs - now());
    if (timer !== null) clearTimer(timer);
    timer = setTimer(dispatch, wait);
  }

  function settled() {
    active = null;
    arm();
  }

  function dispatch() {
    timer = null;
    if (active !== null || pending === null) return;
    var wait = Math.max(0, quietUntil - now(), lastSentAt + settleMs - now());
    if (wait > 0) { arm(); return; }
    active = pending;
    pending = null;
    lastSentAt = now();
    var result;
    try { result = send(active); } catch (error) { settled(); return; }
    Promise.resolve(result).then(settled, settled);
  }

  return {
    seek: function (intent) {
      if (intent === null || typeof intent.zone !== 'string'
          || typeof intent.seconds !== 'number' || !isFinite(intent.seconds)) return;
      if (same(intent, active) || same(intent, pending)) return;
      pending = { action: 'seek', zone: intent.zone, seconds: intent.seconds };
      quietUntil = now() + quietMs;
      arm();
    },
  };
}
