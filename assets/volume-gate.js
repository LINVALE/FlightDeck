/**
 * THE VOLUME GATE — everything between a hand on the wheel and a request to
 * Roon, in one place, so that it can be proven offline.
 *
 * ⚠️⚠️ 09-03, 22:14 — A RUNAWAY. 119 volume commands reached Study ROON in
 * three bursts, +104 steps net, at up to six steps a second. A scroll wheel with
 * inertia fires dozens of events a second; every event was counted as a whole
 * detent, and every 140 ms window sent another batch. The room climbed from 11
 * toward its maximum with nobody's hand on anything. The seek path already had
 * a gate for exactly this shape of failure (seek-intent.js); the wheel did not.
 *
 * ⚖️ THE GUARDS, all of them, because any one alone is a patch:
 *   · a wheel event is DISTANCE, not a detent — a hundred units is one step, so
 *     a trackpad's forty tiny deltas are four detents, not forty
 *   · ONE request in flight; steps that arrive meanwhile are held, never queued
 *     past the four the server will honour, and go as one batch afterwards
 *   · a rolling BUDGET: no more than five steps in any second, which is what a
 *     hand does on a detented knob and more than a wheel with inertia deserves
 *   · a SESSION CAP: no more than sixty steps net without the wheel resting for
 *     most of a second — a continuous spin cannot run away with a room
 *
 * ⚖️ THE CAP IS SIXTY, AND ONLY AN ACCEPTED STEP HOLDS THE SESSION OPEN
 * (Peter, 09-08: "on html keep getting wheel paused lift … that makes no
 * sense!"). Two faults, both false alarms rather than saved rooms:
 *
 *   · twelve, then twenty, were inside ordinary use. The budget already holds
 *     the rate to five steps a second, so sixty steps is twelve unbroken
 *     seconds of turning — no hand does that, and every deliberate sweep of a
 *     scale is now under it. And since 09-07 the DECK holds every request at
 *     Roon's comfort level unless the hand overrode it, so the outcome this
 *     cap was invented to prevent — a room climbing toward its maximum with
 *     nobody's hand on anything — is prevented at the other end too.
 *   · a REFUSED step used to hold the session open. A trackpad goes on firing
 *     for a second or more after the finger lifts, so those refusals kept the
 *     window alive, and the guard could not be escaped by doing what it asked.
 *     Now the window is measured from the last step actually SENT: the guard
 *     interrupts, and lets the hand back in whatever the hardware is still
 *     doing.
 *   · the reading under the hand never runs more than four ahead of what Roon
 *     has confirmed, so a face cannot show a level the room never reached
 *
 * ES2018 only: this module is shipped to the Chromium 63 browser floor.
 */

export function createVolumeGate(send, options) {
  var opts = options || {};
  var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
  var setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : setTimeout;
  var detentDelta = typeof opts.detentDelta === 'number' ? opts.detentDelta : 100;
  var budget = typeof opts.budgetPerSecond === 'number' ? opts.budgetPerSecond : 5;
  var sessionCap = typeof opts.sessionCap === 'number' ? opts.sessionCap : 60;
  var restMs = typeof opts.restMs === 'number' ? opts.restMs : 800;
  var batchMax = typeof opts.batchMax === 'number' ? opts.batchMax : 4;
  var flightMs = typeof opts.flightMs === 'number' ? opts.flightMs : 2500;

  var carry = 0;            // wheel distance not yet worth a detent
  var accepted = [];        // when the last few steps were accepted
  var sessionNet = 0;
  var sessionLast = -Infinity;
  var pending = 0;          // steps accepted and not yet sent
  var inFlight = false;
  var ahead = 0;            // steps sent or pending that Roon has not confirmed
  var flightGuard = null;

  function trim(at) {
    while (accepted.length > 0 && at - accepted[0] >= 1000) accepted.shift();
  }

  function dispatch() {
    if (inFlight || pending === 0) return;
    var steps = Math.max(-batchMax, Math.min(batchMax, pending));
    pending = 0;
    inFlight = true;
    var done = function () {
      inFlight = false;
      if (flightGuard !== null) { flightGuard = null; }
      // Whatever gathered while Roon was answering goes as ONE more batch, and
      // only now that the last was acknowledged — never a queue of them.
      if (pending !== 0) dispatch();
    };
    // A request that never answers must not hold the wheel hostage — nor may
    // it let a second one out early. The guard is long, and it only unlatches.
    flightGuard = setTimer(function () { if (inFlight) done(); }, flightMs);
    var result;
    try { result = send(steps); } catch (error) { done(); return; }
    Promise.resolve(result).then(done, done);
  }

  /**
   * One detent. Returns 'sent' when accepted, 'budget' or 'rest' when dropped,
   * so the face can say why the wheel went quiet without inventing a level.
   */
  function step(direction) {
    var dir = direction > 0 ? 1 : -1;
    var at = now();
    if (at - sessionLast > restMs) sessionNet = 0;
    trim(at);
    if (accepted.length >= budget) return 'budget';
    if (Math.abs(sessionNet + dir) > sessionCap) return 'rest';
    sessionLast = at;          /* only a step that WENT holds the session open */
    accepted.push(at);
    sessionNet += dir;
    ahead = Math.max(-batchMax, Math.min(batchMax, ahead + dir));
    pending = Math.max(-batchMax, Math.min(batchMax, pending + dir));
    dispatch();
    return 'sent';
  }

  return {
    step: step,

    /** Wheel distance in. Returns how many detents it was worth, each stepped. */
    scroll: function (delta, onStep) {
      if (typeof delta !== 'number' || !isFinite(delta) || delta === 0) return 0;
      carry += delta;
      var detents = 0;
      while (Math.abs(carry) >= detentDelta) {
        var dir = carry > 0 ? 1 : -1;
        carry -= dir * detentDelta;
        detents += 1;
        if (onStep) onStep(dir);
      }
      return detents;
    },

    /** Unconfirmed steps, bounded: what the readout may add to Roon's number. */
    ahead: function () { return ahead; },

    /** Roon reported a level. Whatever it answered is no longer owed. */
    confirm: function () { ahead = 0; },

    /** The wheel now belongs to another output: nothing carries across. */
    reset: function () { carry = 0; pending = 0; ahead = 0; sessionNet = 0; },

    inFlight: function () { return inFlight; },
  };
}

/**
 * The level a tap on the bezel means. The dots run from twelve o'clock
 * clockwise, one per detent; an angle is measured from three o'clock the way
 * atan2 gives it, so twelve is -90. The tap is quantised to the dot under it,
 * then placed on the device's own range — and the top dot is the device's own
 * maximum, never a step past it.
 */
/**
 * ⚖️ A DRAG ON THE SCALE IS A DIAL (Peter, 09-05: "make drags on the progress
 * circle and volume controls work as well as taps"): the level is the tick
 * under the finger, as a tap sets it, continuously. Bounded by the comfort
 * level (Roon's soft limit), and a finger that crosses twelve must not fling
 * the level to the other end — a jump of more than a quarter of the scale in
 * one move is refused, and the level stays where it was.
 */
export function levelForDrag(degrees, bounds, last, detents) {
  var value = levelAtAngle(degrees, bounds.min, bounds.max, detents, bounds.step);
  if (value === null) return null;
  var ceiling = typeof bounds.ceiling === 'number' ? bounds.ceiling : bounds.max;
  if (value > ceiling) value = ceiling;
  if (typeof last === 'number' && Math.abs(value - last) > (bounds.max - bounds.min) / 4) return null;
  return value;
}

export function levelAtAngle(degrees, min, max, detents, step) {
  if (typeof degrees !== 'number' || !isFinite(degrees)) return null;
  if (typeof min !== 'number' || typeof max !== 'number' || max <= min) return null;
  if (typeof detents !== 'number' || detents < 1) return null;
  var turn = (((degrees + 90) % 360) + 360) % 360;      // 0 at twelve, clockwise
  var dot = Math.round((turn / 360) * detents);
  if (dot >= detents) dot = detents;
  var fraction = dot / detents;
  var size = typeof step === 'number' && step > 0 ? step : 1;
  return Number((min + Math.round(fraction * (max - min) / size) * size).toFixed(9));
}
