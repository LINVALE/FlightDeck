/**
 * FlightDeck's idle clock policy. It owns only WHEN the face becomes a clock;
 * the TV's own hardware screensaver and the Wake Lock rail remain independent.
 *
 * Kept as a small pure controller so repeated snapshots, throttled TV timers and
 * live setting changes can be proved without a browser DOM.
 */
export var IDLE_DELAY_MINUTES = [0, 15, 30, 60, 120, 240];

export function normalizeIdleDelay(value) {
  if (value === null || value === undefined || value === '') return 15;
  var parsed = typeof value === 'number' ? value : Number(value);
  return IDLE_DELAY_MINUTES.indexOf(parsed) === -1 ? 15 : parsed;
}

export function createIdleDelayPolicy(options) {
  var now = options.now;
  var setTimer = options.setTimer;
  var clearTimer = options.clearTimer;
  var onDue = options.onDue;
  var delayMinutes = normalizeIdleDelay(options.delayMinutes);
  var inactiveZoneId = null;
  var inactiveSince = null;
  var paintedZoneId = null;
  var timer = null;
  var timerDeadline = null;
  var epoch = 0;

  function cancelTimer() {
    epoch += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
    timerDeadline = null;
  }

  function schedule(deadline) {
    // Snapshot and heartbeat repeats do not move or churn the absolute deadline.
    if (timer !== null && timerDeadline === deadline) return;
    cancelTimer();
    timerDeadline = deadline;
    var mine = epoch;
    timer = setTimer(function () {
      if (mine !== epoch) return;
      timer = null;
      timerDeadline = null;
      // Re-read the live store in the caller; this closure owns no stale zone.
      onDue();
    }, Math.max(0, deadline - now()));
  }

  function reconcile(zoneId, inactive, hasNowPlaying) {
    if (!inactive) {
      inactiveZoneId = null;
      inactiveSince = null;
      cancelTimer();
      return false;
    }

    if (inactiveZoneId !== zoneId || inactiveSince === null) {
      inactiveZoneId = zoneId;
      inactiveSince = now();
      cancelTimer();
    }

    // Never hold another room's art, or show a blank composition for 15 minutes.
    if (!hasNowPlaying && paintedZoneId !== zoneId) {
      cancelTimer();
      return true;
    }

    var deadline = inactiveSince + delayMinutes * 60000;
    if (delayMinutes === 0 || now() >= deadline) {
      cancelTimer();
      return true;
    }
    schedule(deadline);
    return false;
  }

  function markPainted(zoneId) { paintedZoneId = zoneId; }

  function setDelay(value) {
    var next = normalizeIdleDelay(value);
    if (next === delayMinutes) return false;
    delayMinutes = next;
    // Keep the original inactivity anchor; the next reconcile decides whether a
    // shorter delay is already due or a longer one should restore held content.
    cancelTimer();
    return true;
  }

  function delay() { return delayMinutes; }

  return { reconcile: reconcile, markPainted: markPainted, setDelay: setDelay, delay: delay };
}
