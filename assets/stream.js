/**
 * The live connection. ES2018 only — no ?. or ?? — because the floor is
 * Chromium 63 (Samsung 2019 TVs) and the syntax would be a parse error there.
 *
 * The watchdog is the whole point. EventSource never notices a half-open TCP
 * socket: the browser thinks it is connected and simply stops receiving. That is
 * exactly the "Roon Display freezes after 20 minutes" symptom. The server sends
 * a named heartbeat every 10 s, so silence for 25 s means the socket is dead —
 * close it and reopen rather than waiting forever.
 */

var WATCHDOG_MS = 25000;
var BACKOFF_MIN = 1000;
var BACKOFF_MAX = 8000;

export function createStream(store, onStatus) {
  var source = null;
  var watchdogTimer = null;
  var reconnectTimer = null;
  var backoff = BACKOFF_MIN;
  var stopped = false;
  // A closed EventSource can still deliver one last error event. Without an
  // epoch, that stale error lands AFTER the new connection is live and leaves
  // "catching up" on a screen whose data is already current — the screen lies.
  var epoch = 0;
  // A late snapshot fetch must not overwrite a newer connection's truth.
  var fetchEpoch = 0;

  function status(state) { if (onStatus) onStatus(state); }

  function clearWatchdog() {
    if (watchdogTimer !== null) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  }

  function kick(mine, candidate) {
    if (mine !== epoch || candidate !== source) return;
    clearWatchdog();
    watchdogTimer = setTimeout(function () {
      if (stopped || mine !== epoch || candidate !== source) return;
      status('catching-up');
      reopen(true);
    }, WATCHDOG_MS);
  }

  function scheduleConnect(delay, mine) {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect(mine);
    }, delay);
  }

  function reopen(immediate) {
    if (stopped) return;
    epoch += 1;
    fetchEpoch += 1;
    clearWatchdog();
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (source !== null) { try { source.close(); } catch (error) { /* already gone */ } source = null; }
    var delay = immediate ? 0 : backoff;
    if (!immediate) backoff = Math.min(BACKOFF_MAX, backoff * 2);
    scheduleConnect(delay, epoch);
  }

  function frame(mine, candidate, handler) {
    return function (event) {
      if (mine !== epoch || candidate !== source) return;
      kick(mine, candidate);
      backoff = BACKOFF_MIN;
      var payload = null;
      try { payload = JSON.parse(event.data); } catch (error) { return; }
      if (payload === null) return;
      handler(payload);
      status('live');
    };
  }

  function connect(mine) {
    if (stopped || mine !== epoch) return;
    var candidate = null;
    try {
      candidate = new EventSource('/api/v1/events');
    } catch (error) {
      reopen(false);
      return;
    }
    source = candidate;
    // EventSource can reconnect with an event literally named `update` as its
    // first structural truth. It is still a BASELINE for this connection: no
    // visual transition may claim it witnessed what happened while absent.
    var structuralSeen = false;
    candidate.addEventListener('open', function () {
      if (mine !== epoch || candidate !== source) return;
      backoff = BACKOFF_MIN; kick(mine, candidate); status('live');
    });
    candidate.addEventListener('heartbeat', function () {
      if (mine !== epoch || candidate !== source) return;
      backoff = BACKOFF_MIN; kick(mine, candidate); status('live');
    });
    candidate.addEventListener('snapshot', frame(mine, candidate, function (data) {
      structuralSeen = true;
      store.accept(data, true);
    }));
    candidate.addEventListener('update', frame(mine, candidate, function (data) {
      var baseline = !structuralSeen;
      structuralSeen = true;
      store.accept(data, baseline);
    }));
    candidate.addEventListener('resync', frame(mine, candidate, function (data) {
      // A resync is the server saying "here is the truth" — always authoritative.
      structuralSeen = true;
      if (data.snapshot) store.accept(data.snapshot, true); else refetch();
    }));
    candidate.addEventListener('seek', frame(mine, candidate, function (data) { store.acceptSeek(data); }));
    candidate.addEventListener('error', function () {
      if (mine !== epoch || candidate !== source) return;   // a dying socket must not speak for the live one
      status('catching-up');
      reopen(false);
    });
    kick(mine, candidate);
  }

  function refetch() {
    var mine = epoch;
    var request = ++fetchEpoch;
    fetch('/api/v1/snapshot', { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!stopped && mine === epoch && request === fetchEpoch && data !== null) {
          store.accept(data, true); status('live');
        }
      })
      .catch(function () { /* the watchdog will try again */ });
  }

  // A screen that comes back from sleep must not trust a socket it slept through.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { reopen(true); refetch(); }
  });

  connect(epoch);
  return {
    stop: function () {
      stopped = true;
      epoch += 1;
      fetchEpoch += 1;
      clearWatchdog();
      if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (source !== null) { try { source.close(); } catch (error) { /* gone */ } source = null; }
    },
    refetch: refetch
  };
}
