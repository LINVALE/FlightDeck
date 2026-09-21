/*
 * THE SCREEN CHECK (/check) — can this browser run FlightDeck?
 *
 * Written deliberately in the oldest JavaScript there is (var, function,
 * no arrows, no template strings), because the whole point is to give an
 * answer on the browsers that CANNOT run FlightDeck. The rest of FlightDeck
 * dies at parse on those, so it cannot report anything; this file must not.
 * The floor lint still applies to it, and it sits far below that floor.
 *
 * Two probes load beside it as separate files, so an old parser fails only
 * the probe: check-syntax.js (ES2018 syntax) and check-module.js (ES modules).
 * Then it opens the live stream and waits for one real frame, which is what
 * every Face and The Deck actually need.
 */
(function () {
  var VERSION = 'FDC1';
  var results = [];

  function el(id) { return document.getElementById(id); }
  function text(node, value) {
    while (node.firstChild) node.removeChild(node.firstChild);
    node.appendChild(document.createTextNode(value));
  }
  function add(name, ok, required) { results.push({ name: name, ok: ok, required: required }); }

  function has(fn) { try { return !!fn(); } catch (e) { return false; } }

  /** The short engine name and major version from the user agent, e.g. "Chrome 108". */
  function engine(ua) {
    var m = /(?:Chrome|Chromium)\/(\d+)/.exec(ua);
    if (m) return 'Chrome ' + m[1];
    m = /Version\/(\d+)[.\d]* .*Safari\//.exec(ua);
    if (m) return 'Safari ' + m[1];
    m = /Firefox\/(\d+)/.exec(ua);
    if (m) return 'Firefox ' + m[1];
    m = /AppleWebKit\/(\d+)/.exec(ua);
    if (m) return 'WebKit ' + m[1];
    return 'unknown engine';
  }

  /** The TV platform, where the user agent names one. */
  function platform(ua) {
    var m = /Tizen\s?([\d.]+)/.exec(ua);
    if (m) return 'Tizen ' + m[1];
    m = /Web0S|webOS/.exec(ua);
    if (m) return 'webOS';
    if (/AFT[A-Z]+/.test(ua)) return 'Fire TV ' + /AFT[A-Z]+/.exec(ua)[0];
    if (/Silk\//.test(ua)) return 'Silk';
    if (/VIDAA/i.test(ua)) return 'VIDAA';
    if (/Android/.test(ua)) return 'Android';
    if (/FlightDeckTV\//.test(ua)) return 'FlightDeck TV app';
    return '';
  }

  function staticChecks() {
    add('Modern syntax (ES2018)', window.fdCheckSyntax === true, true);
    add('ES modules', window.fdCheckModule === true, true);
    add('fetch', typeof window.fetch === 'function', true);
    add('Promise', typeof window.Promise === 'function', true);
    add('EventSource (live updates)', typeof window.EventSource === 'function', true);
    add('localStorage (remembers its room)', has(function () {
      window.localStorage.setItem('fd.check', '1');
      window.localStorage.removeItem('fd.check');
      return true;
    }), true);
    add('Flexbox layout', has(function () {
      var probe = document.createElement('div');
      probe.style.display = 'flex';
      return probe.style.display === 'flex';
    }), true);
    add('Screen Wake Lock (keeps the screen on)', has(function () { return navigator.wakeLock; }), false);
    add('Image decode before swap', has(function () { return 'decode' in HTMLImageElement.prototype; }), false);
  }

  function liveCheck(done) {
    if (typeof window.EventSource !== 'function') { add('Live stream: first frame', false, true); done(); return; }
    var finished = false;
    var source = null;
    function finish(ok) {
      if (finished) return;
      finished = true;
      try { if (source) source.close(); } catch (e) { /* already closed */ }
      add('Live stream: first frame', ok, true);
      done();
    }
    try {
      source = new window.EventSource('/api/v1/events');
      source.addEventListener('snapshot', function () { finish(true); });
      source.onmessage = function () { finish(true); };
    } catch (e) { finish(false); return; }
    setTimeout(function () { finish(false); }, 8000);
  }

  function report() {
    var ua = navigator.userAgent || '';
    var missing = [];
    var i;
    for (i = 0; i < results.length; i += 1) if (results[i].required && !results[i].ok) missing.push(results[i].name);
    var pass = missing.length === 0;
    var size = String(window.screen ? window.screen.width : 0) + 'x' + String(window.screen ? window.screen.height : 0)
      + '@' + String(window.devicePixelRatio || 1);
    var where = platform(ua);
    var line = VERSION + ' ' + (pass ? 'PASS' : 'FAIL') + ' · ' + engine(ua) + (where ? ' · ' + where : '')
      + ' · ' + size + (pass ? '' : ' · missing: ' + missing.join(', '));

    var verdict = el('verdict');
    verdict.className = pass ? 'pass' : 'fail';
    text(verdict, pass ? 'This screen can run FlightDeck.' : 'This screen cannot run FlightDeck.');
    text(el('line'), line);
    text(el('ua'), ua);

    var table = el('results');
    while (table.firstChild) table.removeChild(table.firstChild);
    for (i = 0; i < results.length; i += 1) {
      var row = document.createElement('tr');
      var mark = document.createElement('td');
      mark.className = results[i].ok ? 'pass' : (results[i].required ? 'fail' : '');
      mark.appendChild(document.createTextNode(results[i].ok ? 'yes' : (results[i].required ? 'NO' : 'no')));
      var name = document.createElement('td');
      name.appendChild(document.createTextNode(results[i].name + (results[i].required ? '' : ' (nice to have)')));
      row.appendChild(mark);
      row.appendChild(name);
      table.appendChild(row);
    }

    // Also written to the FlightDeck server's own log, for a TV that cannot copy text.
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/check', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ line: line, ua: ua }));
    } catch (e) { /* the page already shows the answer */ }
  }

  function run() {
    text(el('verdict'), 'Checking…');
    staticChecks();
    liveCheck(report);
  }

  // The module probe runs deferred, after this classic script; wait for load.
  if (document.readyState === 'complete') setTimeout(run, 50);
  else window.addEventListener('load', function () { setTimeout(run, 50); }, false);
})();
