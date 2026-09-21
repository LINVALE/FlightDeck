/** Screensaver timing, independent of the player controls and the idle clock. */
export function createBlankPolicy(now) {
  var activeAt = now(), protectedBefore = false, asleep = false, manual = false;
  return {
    activity: function () { activeAt = now(); asleep = false; manual = false; },
    sleep: function () { asleep = true; manual = true; },
    asleep: function () { return asleep; },
    check: function (minutes, protectedByPlayback) {
      if (protectedByPlayback || protectedBefore) activeAt = now();
      protectedBefore = protectedByPlayback;
      if (!manual) asleep = !protectedByPlayback && minutes > 0 && now() - activeAt >= minutes * 60000;
      return asleep;
    }
  };
}

/** The complete first wake gesture is consumed, including compatibility clicks. */
export function createScreensaver(care, protectedByPlayback, onWake, onSleep) {
  var policy = createBlankPolicy(function () { return Date.now(); });
  var heldUntil = 0, sleepHeldUntil = 0, previous = null;
  var blank = document.createElement('button'); blank.type = 'button'; blank.className = 'display-screen-blank';
  blank.setAttribute('aria-label', 'Display blanked. Touch or press a key to wake.');
  blank.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:100000;width:100vw;height:100vh;margin:0;padding:0;border:0;border-radius:0;background:#000;color:#000;outline:none;cursor:none;display:none';
  blank.hidden = true; document.body.appendChild(blank);
  function paint() {
    var asleep = policy.asleep();
    if (asleep === !blank.hidden) return;
    if (asleep) {
      previous = document.activeElement;
      if (onSleep) onSleep();
      blank.hidden = false; blank.style.display = 'block'; blank.focus();
    } else {
      blank.hidden = true; blank.style.display = 'none';
      if (previous && document.documentElement.contains(previous)) previous.focus();
      if (onWake) onWake();
    }
  }
  function check() { policy.check(care.prefs.blankMinutes, protectedByPlayback()); paint(); }
  function activity() { policy.activity(); paint(); }
  function input(event) {
    if (policy.asleep() && Date.now() < sleepHeldUntil) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation(); return;
    }
    if (policy.asleep() || Date.now() < heldUntil) {
      activity(); heldUntil = Date.now() + 700;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    } else if (['pointerdown','mousedown','touchstart','keydown','wheel'].indexOf(event.type) >= 0) activity();
  }
  ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','click','keydown','keyup','wheel'].forEach(function (kind) {
    document.addEventListener(kind, input, { capture: true, passive: false });
  });
  setInterval(check, 1000);
  document.addEventListener('visibilitychange', check);
  return { check: check, activity: activity, asleep: policy.asleep, sleep: function () { sleepHeldUntil = Date.now() + 700; policy.sleep(); paint(); } };
}
