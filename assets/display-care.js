/** Optional dimming and gentle movement after 30 seconds without deliberate input. */
export function createDisplayCare(root, storage, storageKey) {
  storageKey = storageKey || 'flightdeck.display-care';
  var prefs = { brightness: 100, drift: false, artistFit: false, keepControls: false, playingOnly: false, blankMinutes: 0, blankOnlySilent: true };
  try { var saved = JSON.parse(storage.getItem(storageKey) || '{}');
    Object.keys(prefs).forEach(function (key) { if (typeof saved[key] === typeof prefs[key]) prefs[key] = saved[key]; });
  } catch (e) {}
  if ([100, 75, 50].indexOf(prefs.brightness) < 0) prefs.brightness = 100;
  if ([0, 15, 30, 60].indexOf(prefs.blankMinutes) < 0) prefs.blankMinutes = 0;
  var activeAt = Date.now();
  var shade = document.createElement('div'); shade.className = 'display-care-shade'; shade.setAttribute('aria-hidden', 'true');
  shade.style.cssText = 'position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:#000;pointer-events:none;z-index:9999;opacity:0;transition:opacity .4s';
  document.body.appendChild(shade);
  function paint() {
    var quiet = Date.now() - activeAt >= 30000 && !document.hidden;
    shade.style.opacity = quiet ? String(1 - prefs.brightness / 100) : '0';
    root.style.transform = quiet && prefs.drift ? 'translate(' + ((Math.floor(Date.now() / 60000) % 3 - 1) * 3) + 'px,' + ((Math.floor(Date.now() / 180000) % 3 - 1) * 3) + 'px) scale(.99)' : '';
    root.setAttribute('data-artist-fit', prefs.artistFit ? '1' : '0');
  }
  ['pointerdown', 'pointermove', 'mousemove', 'touchstart', 'keydown', 'wheel'].forEach(function (kind) {
    document.addEventListener(kind, function () { activeAt = Date.now(); paint(); }, true);
  });
  setInterval(paint, 1000); paint();
  return { prefs: prefs, wake: function () { activeAt = Date.now(); paint(); }, set: function (key, value) {
    prefs[key] = value;
    try { storage.setItem(storageKey, JSON.stringify(prefs)); } catch (e) {}
    activeAt = Date.now(); paint();
  } };
}

/** Hold one lock, release it when unwanted, and release a late grant after the policy changed. */
export function createWakePolicy(request) {
  var held = null, pending = false, wanted = false;
  function update(want) {
    wanted = want;
    if (!wanted && held) { var old = held; held = null; Promise.resolve(old.release()).catch(function () {}); }
    if (!wanted || held || pending) return;
    pending = true;
    Promise.resolve().then(request).then(function (lock) {
      pending = false;
      if (!wanted) { return lock.release(); }
      held = lock;
      lock.addEventListener('release', function () { if (held === lock) held = null; });
    }).catch(function () { pending = false; });
  }
  return { update: update };
}
