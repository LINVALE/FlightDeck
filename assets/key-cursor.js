/**
 * THE KEY CURSOR — a pointer for a television that sends keys but has no pointer.
 *
 * ⚖️ Peter, 2026-09-22, on the first Vega stick: The Deck drew beautifully, the
 * arrows reached the page, and they were stuck adjusting whichever volume bar had
 * focus — "unable to navigate away from that highlighted volume bar". A browser
 * moves focus with Tab, not with a D-pad, and The Deck is built for a pointer.
 *
 * So the page supplies one. The arrows move a cursor over the page (faster while
 * held), OK clicks whatever is under it, and Back or Escape puts it away. It sends
 * the same mouse moves a real pointer sends, so cards light up and chrome appears.
 *
 * Who this serves:
 *  - Vega (the Fire TV Stick 4K Select and every stick after it): keys arrive, no pointer.
 *  - Any other TV browser that delivers keys.
 *  - NOT Samsung or LG, which keep the keys and give their pages a real pointer;
 *    nothing here runs because no key ever arrives.
 *  - NOT the FlightDeck TV app on Fire OS, which supplies its own pointer and
 *    consumes the keys before the page sees them.
 *
 * A real pointer wins: one genuine mouse move puts the key cursor away.
 * ES2018, like every shipped asset.
 */

var KEY_LEFT = 37, KEY_UP = 38, KEY_RIGHT = 39, KEY_DOWN = 40;
var KEY_ENTER = 13, KEY_SPACE = 32, KEY_ESC = 27, KEY_BACK = 461; // 461: webOS back

function named(event) {
  var code = event.keyCode || event.which || 0;
  var key = event.key || '';
  // 'Left' and friends are the old names some television engines still send.
  if (key === 'ArrowLeft' || key === 'Left' || code === KEY_LEFT) return 'left';
  if (key === 'ArrowRight' || key === 'Right' || code === KEY_RIGHT) return 'right';
  if (key === 'ArrowUp' || key === 'Up' || code === KEY_UP) return 'up';
  if (key === 'ArrowDown' || key === 'Down' || code === KEY_DOWN) return 'down';
  if (key === 'Enter' || code === KEY_ENTER) return 'ok';
  if (key === ' ' || code === KEY_SPACE) return 'space';
  if (key === 'Escape' || code === KEY_ESC || code === KEY_BACK || key === 'GoBack') return 'back';
  return '';
}

/**
 * @param {object} options
 *   start: () => boolean  — whether an arrow should raise the cursor at all.
 *   claim: (name) => boolean — true while the page wants the key for itself.
 */
export function startKeyCursor(options) {
  var opts = options || {};
  var canStart = typeof opts.start === 'function' ? opts.start : function () { return true; };
  var claimed = typeof opts.claim === 'function' ? opts.claim : function () { return false; };
  var node = null;
  var x = 0, y = 0, shown = false, held = 0, idleTimer = null;

  function build() {
    if (node !== null) return;
    node = document.createElement('div');
    node.className = 'key-cursor';
    node.setAttribute('aria-hidden', 'true');
    document.body.appendChild(node);
    x = Math.round(window.innerWidth / 2);
    y = Math.round(window.innerHeight / 2);
  }

  function place() {
    node.style.left = x + 'px';
    node.style.top = y + 'px';
  }

  function show() {
    build();
    shown = true;
    node.className = 'key-cursor on';
    place();
    clearTimeout(idleTimer);
    // A cursor left alone is clutter on a display; it goes quietly after a rest.
    idleTimer = setTimeout(hide, 12000);
  }

  function hide() {
    clearTimeout(idleTimer);
    shown = false;
    held = 0;
    if (node !== null) node.className = 'key-cursor';
  }

  function at() { return document.elementFromPoint(x, y); }

  function mouse(type, target) {
    var hit = target || at();
    if (hit === null) return;
    var init = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0 };
    try { hit.dispatchEvent(new MouseEvent(type, init)); } catch (error) { /* older engine */ }
  }

  /** Scroll what the cursor rests in, when it is pushed past that thing's edge. */
  function scrollUnder(dy) {
    var hit = at();
    while (hit !== null && hit !== document.body && hit !== document.documentElement) {
      var style = window.getComputedStyle(hit);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && hit.scrollHeight > hit.clientHeight + 2) {
        var box = hit.getBoundingClientRect();
        var zone = Math.max(48, box.height * 0.18);
        var step = Math.max(80, hit.clientHeight * 0.4);
        if (dy > 0 && y > box.bottom - zone && hit.scrollTop + hit.clientHeight < hit.scrollHeight - 1) {
          hit.scrollTop += step; return true;
        }
        if (dy < 0 && y < box.top + zone && hit.scrollTop > 0) { hit.scrollTop -= step; return true; }
        return false;
      }
      hit = hit.parentElement;
    }
    return false;
  }

  /**
   * ⚖️ AN ARROW MOVES BETWEEN CARDS, SMOOTHLY (Peter, 09-23: "arrives between cards
   * would be great… arrow to move between cards?"). Landing control-to-control was
   * tried and rejected as "jumping"; pixel gliding alone never arrives anywhere. So
   * each press aims at the next CARD in that direction and the cursor GLIDES there —
   * the CSS eases the travel, so the eye follows it across.
   *
   * Second choice is any other pressable thing (the bar's buttons, a list row, a menu
   * choice), and where there is nothing at all that way it simply glides on, which is
   * what keeps a card's own controls and the edges of long lists reachable.
   */
  var CARDS = '.tile, .roomcard, .browse-row, .wall-menu-choice';
  var THINGS = 'a[href], button, [role="button"], [role="slider"], [tabindex]:not([tabindex="-1"]), .opt';

  function boxes(selector) {
    var found = [];
    var all = document.querySelectorAll(selector);
    for (var i = 0; i < all.length; i += 1) {
      var box = all[i].getBoundingClientRect();
      if (box.width < 24 || box.height < 18) continue;
      if (box.bottom < 4 || box.top > window.innerHeight - 4) continue;
      if (box.right < 4 || box.left > window.innerWidth - 4) continue;
      var style = window.getComputedStyle(all[i]);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05) continue;
      found.push({ cx: box.left + box.width / 2, cy: box.top + box.height / 2 });
    }
    return found;
  }

  /** The nearest one that way: distance along the arrow, with drift across it penalised. */
  function nearest(selector, dx, dy) {
    var list = boxes(selector);
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i += 1) {
      var along = (list[i].cx - x) * dx + (list[i].cy - y) * dy;
      var across = Math.abs(dx !== 0 ? list[i].cy - y : list[i].cx - x);
      if (along < 24) continue;
      if (across > (dx !== 0 ? window.innerHeight : window.innerWidth) * 0.3) continue;
      var score = along + across * 3;
      if (score < bestScore) { bestScore = score; best = list[i]; }
    }
    return best;
  }

  function move(dx, dy) {
    /**
     * ⚖️ SMOOTH, AND IT MUST CROSS THE CARDS (Peter, 09-23: "jumping isn't good —
     * smooth pointer movement best, up down and side should go between cards").
     * Jumping from control to control was tried and rejected. So: a tap nudges, and
     * holding the arrow sweeps — the second press already covers half a card, and a
     * held arrow crosses one about every three frames, with the move itself eased so
     * the eye can follow it.
     */
    var step = held < 1 ? 26 : (held < 4 ? 64 : 116);
    held += 1;
    if (dy !== 0 && scrollUnder(dy)) { show(); return; }
    var target = nearest(CARDS, dx, dy) || nearest(THINGS, dx, dy);
    if (target !== null) {
      x = Math.max(2, Math.min(window.innerWidth - 2, Math.round(target.cx)));
      y = Math.max(2, Math.min(window.innerHeight - 2, Math.round(target.cy)));
    } else {
      x = Math.max(2, Math.min(window.innerWidth - 2, x + dx * step));
      y = Math.max(2, Math.min(window.innerHeight - 2, y + dy * step));
    }
    show();
    // The same movement a mouse makes: cards light, chrome appears, tips arm.
    mouse('mousemove');
    mouse('pointermove');
  }

  function press() {
    var hit = at();
    if (hit === null) return;
    mouse('pointerdown', hit);
    mouse('mousedown', hit);
    mouse('mouseup', hit);
    mouse('click', hit);
    show();
  }

  var probing = /[?&]keys=1/.test(location.search);
  function report(name, acted) {
    if (!probing) return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/keyprobe', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ key: 'cursor ' + (event_key || '(no .key)'), code: event_code, acted: acted }));
    } catch (error) { /* the probe is a convenience */ }
  }
  var event_key = '', event_code = 0;

  window.addEventListener('keydown', function (event) {
    var name = named(event);
    event_key = event.key || '';
    event_code = event.keyCode || event.which || 0;
    report(name === '' ? 'IGNORED' : name, name === '' ? 'IGNORED' : name);
    if (name === '') return;
    if (claimed(name, shown)) return;
    if (name === 'back') {
      if (!shown) return;
      event.preventDefault(); event.stopPropagation();
      hide();
      return;
    }
    if (name === 'ok' || name === 'space') {
      if (!shown) return;
      event.preventDefault(); event.stopPropagation();
      press();
      return;
    }
    if (!shown && !canStart()) return;
    event.preventDefault(); event.stopPropagation();
    if (!shown) { show(); return; }   // the first arrow only raises it
    move(name === 'left' ? -1 : (name === 'right' ? 1 : 0), name === 'up' ? -1 : (name === 'down' ? 1 : 0));
  }, true);

  window.addEventListener('keyup', function (event) { if (named(event) !== '') held = 0; }, true);

  // A real pointer wins: one true mouse move and the key cursor stands down.
  window.addEventListener('mousemove', function (event) {
    if (event.isTrusted && shown) hide();
  }, true);

  return { visible: function () { return shown; }, hide: hide, show: show };
}
