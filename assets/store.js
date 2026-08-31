/**
 * The snapshot store. Holds one snapshot, applies seek frames on top of it, and
 * caches the last one so a cold start paints before the network answers (R8).
 */

var CACHE_KEY = 'flightdeck.snapshot';

export function createStore(onChange) {
  var snapshot = null;
  var seekAt = {};
  var listeners = onChange ? [onChange] : [];

  function emit(kind) {
    for (var i = 0; i < listeners.length; i += 1) listeners[i](snapshot, kind);
  }

  function cache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot)); }
    catch (error) { /* private mode, or a full quota: the cache is a nicety */ }
  }

  return {
    /** Paint from the last known snapshot before the stream opens. */
    hydrate: function () {
      try {
        var raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return false;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.revision !== 'number') return false;
        snapshot = parsed;
        emit('cache');
        return true;
      } catch (error) { return false; }
    },

    /**
     * `authoritative` marks a full snapshot or a resync — the server stating what
     * is true right now, rather than an incremental step.
     *
     * The monotonic guard below must never outlive the process that produced the
     * revisions. FlightDeck restarts its counter at zero, so a display holding a
     * high revision from the previous process rejected EVERY frame the new one
     * sent and froze until someone reloaded it by hand — which is precisely the
     * failure this whole project exists to avoid. A changed generation clears
     * it. "Authoritative" does not make an older response from the SAME process
     * newer than a frame already on the screen.
     */
    accept: function (next, authoritative) {
      if (!next || typeof next.revision !== 'number' || !Array.isArray(next.zones)) return;
      var newProcess = snapshot !== null && next.generation !== snapshot.generation;
      if (!newProcess && snapshot !== null && next.revision < snapshot.revision) return;
      var sameRevision = !newProcess && snapshot !== null && next.revision === snapshot.revision;
      snapshot = next;
      // A same-revision /snapshot fetch contains no newer seek truth. Preserve a
      // 1 Hz frame that may have arrived while the HTTP response was in flight.
      if (!sameRevision) seekAt = {};
      // Preserve provenance for effects that must distinguish a live successor
      // from a cold/reconnect baseline. Existing renderers already treat every
      // non-seek kind structurally; only the Face consumes the finer distinction.
      emit(authoritative === true ? 'snapshot' : 'update');
      cache();
    },

    /**
     * Seek rides its own frame and carries no revision bump — apply it in place. The frame holds the position
     * Roon itself reported for each zone, a whole second on Roon's own once-a-second clock. That number is what
     * the faces show, verbatim (Peter, 2026-08-28: "just use the one Roon position reported every second for
     * each zone — no correction needed"). Interpolating between frames on the browser clock made the dial wobble
     * back and forth whenever the two clocks slipped phase; Roon's own sequence never runs backwards.
     */
    acceptSeek: function (frame) {
      if (snapshot === null || !frame || !Array.isArray(frame.zones)) return;
      if (frame.revision !== snapshot.revision) return;
      if (frame.generation && snapshot.generation && frame.generation !== snapshot.generation) return;
      for (var i = 0; i < frame.zones.length; i += 1) {
        var entry = frame.zones[i];
        if (typeof entry.positionSec === 'number') seekAt[entry.id] = { positionSec: entry.positionSec };
      }
      emit('seek');
    },

    snapshot: function () { return snapshot; },

    /**
     * The position Roon last reported for a FINITE timeline — the latest seek
     * frame, or the snapshot's own stamp before the first frame — clamped to the
     * track length. A live stream may expose a steadily increasing
     * `seek_position` even though it has no duration and cannot seek; that is a
     * stream-age counter, not progress, and must never inherit the previous
     * track's rail or ring. Loading is blank for the same reason: its metadata
     * may still be in transition.
     */
    positionSec: function (zone) {
      if (!zone || !zone.nowPlaying) return null;
      var length = zone.nowPlaying.lengthSec;
      if (zone.state === 'loading' || !zone.allowed || zone.allowed.seek !== true
          || typeof length !== 'number' || length <= 0) return null;
      var base = seekAt[zone.id];
      var seek = zone.nowPlaying.seek;
      var value;
      if (base) value = base.positionSec;
      else if (seek && typeof seek.positionSec === 'number') value = seek.positionSec;
      else return null;
      return Math.min(value, length);
    },

    subscribe: function (listener) { listeners.push(listener); }
  };
}

export function formatTime(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '–:––';
  var total = Math.floor(seconds);
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  var mm = h > 0 && m < 10 ? '0' + m : String(m);
  var ss = s < 10 ? '0' + s : String(s);
  return (h > 0 ? String(h) + ':' : '') + mm + ':' + ss;
}
