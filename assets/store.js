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
     * failure this whole project exists to avoid. A changed generation, or an
     * authoritative frame, clears it.
     */
    accept: function (next, authoritative) {
      if (!next || typeof next.revision !== 'number' || !Array.isArray(next.zones)) return;
      var newProcess = snapshot !== null && next.generation !== snapshot.generation;
      if (!authoritative && !newProcess
          && snapshot !== null && next.revision < snapshot.revision) return;
      snapshot = next;
      seekAt = {};
      emit('snapshot');
      cache();
    },

    /** Seek rides its own frame and carries no revision bump — apply it in place. */
    acceptSeek: function (frame) {
      if (snapshot === null || !frame || !Array.isArray(frame.zones)) return;
      if (frame.revision !== snapshot.revision) return;
      if (frame.generation && snapshot.generation && frame.generation !== snapshot.generation) return;
      var when = Date.parse(frame.at);
      for (var i = 0; i < frame.zones.length; i += 1) {
        var entry = frame.zones[i];
        seekAt[entry.id] = { positionSec: entry.positionSec, at: isNaN(when) ? Date.now() : when };
      }
      emit('seek');
    },

    snapshot: function () { return snapshot; },

    /**
     * Interpolated position for a zone, clamped to the track length. This is what
     * makes progress smooth between 1 Hz frames without ever running past the end.
     */
    positionSec: function (zone) {
      if (!zone || !zone.nowPlaying) return null;
      var base = seekAt[zone.id];
      var seek = zone.nowPlaying.seek;
      var positionSec, at;
      if (base) { positionSec = base.positionSec; at = base.at; }
      else if (seek) { positionSec = seek.positionSec; at = Date.parse(seek.at); }
      else return null;
      if (isNaN(at)) at = Date.now();
      var elapsed = zone.state === 'playing' ? (Date.now() - at) / 1000 : 0;
      var value = positionSec + Math.max(0, elapsed);
      var length = zone.nowPlaying.lengthSec;
      if (typeof length === 'number' && length > 0) value = Math.min(value, length);
      return value;
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
