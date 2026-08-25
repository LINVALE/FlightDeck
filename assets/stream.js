/**
 * The live connection. ES2018 only — no ?. or ?? — because the floor is
 * Chromium 63 (Samsung 2019 TVs) and the syntax would be a parse error there.
 *
 * The watchdog is the whole point. EventSource never notices a half-open TCP
 * socket: the browser thinks it is connected and simply stops receiving. That is
 * exactly the "Roon Display freezes after 20 minutes" symptom. The server sends
 * a heartbeat comment every 10 s, so silence for 25 s means the socket is dead —
 * close it and reopen rather than waiting forever.
 */

var WATCHDOG_MS = 25000;
var BACKOFF_MIN = 1000;
var BACKOFF_MAX = 8000;

export function createStream(store, onStatus) {
  var source = null;
  var timer = null;
  var backoff = BACKOFF_MIN;
  var stopped = false;
  // A closed EventSource can still deliver one last error event. Without an
  // epoch, that stale error lands AFTER the new connection is live and leaves
  // "catching up" on a screen whose data is already current — the screen lies.
  var epoch = 0;

  function status(state) { if (onStatus) onStatus(state); }

  function kick() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(function () {
      status('catching-up');
      reopen(true);
    }, WATCHDOG_MS);
  }

  function reopen(immediate) {
    if (stopped) return;
    epoch += 1;
    if (source !== null) { try { source.close(); } catch (error) { /* already gone */ } source = null; }
    var delay = immediate ? 0 : backoff;
    backoff = Math.min(BACKOFF_MAX, backoff * 2);
    setTimeout(connect, delay);
  }

  function frame(handler) {
    return function (event) {
      kick();
      backoff = BACKOFF_MIN;
      var payload = null;
      try { payload = JSON.parse(event.data); } catch (error) { return; }
      if (payload === null) return;
      handler(payload);
      status('live');
    };
  }

  function connect() {
    if (stopped) return;
    var mine = epoch;
    try {
      source = new EventSource('/api/v1/events');
    } catch (error) {
      reopen(false);
      return;
    }
    source.addEventListener('open', function () {
      if (mine !== epoch) return;
      backoff = BACKOFF_MIN; kick(); status('live');
    });
    source.addEventListener('snapshot', frame(function (data) { store.accept(data); }));
    source.addEventListener('update', frame(function (data) { store.accept(data); }));
    source.addEventListener('resync', frame(function (data) {
      if (data.snapshot) store.accept(data.snapshot); else refetch();
    }));
    source.addEventListener('seek', frame(function (data) { store.acceptSeek(data); }));
    source.addEventListener('error', function () {
      if (mine !== epoch) return;   // a dying socket must not speak for the live one
      status('catching-up');
      reopen(false);
    });
    kick();
  }

  function refetch() {
    fetch('/api/v1/snapshot', { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) { if (data !== null) { store.accept(data); status('live'); } })
      .catch(function () { /* the watchdog will try again */ });
  }

  // A screen that comes back from sleep must not trust a socket it slept through.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { refetch(); reopen(true); }
  });

  connect();
  return {
    stop: function () {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      if (source !== null) { try { source.close(); } catch (error) { /* gone */ } }
    },
    refetch: refetch
  };
}
