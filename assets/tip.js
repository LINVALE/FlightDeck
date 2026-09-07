/**
 * A TIP THAT SHOWS EVERYWHERE (Peter, 09-07: the sentences were hung on
 * `title`, which Chrome on a laptop shows after a pause and a television's
 * browser never shows at all — "no hints showing"). One small dark card of
 * the page's own, read from `data-tip`: for a pointer — a mouse, a pen, a
 * television's pointer remote — it appears a beat after the pointer settles
 * and leaves when it moves on; for a finger, a press held half a second
 * shows it, and the lift that follows is not a tap. Delegated once per page;
 * styled inline so it needs no stylesheet and no nonce.
 */

export function installTips(options) {
  var opts = options || {};
  var size = opts.size || '13px';
  var card = null;
  var showTimer = null;
  var holdTimer = null;
  var over = null;
  var swallowUntil = 0;

  function ensure() {
    if (card !== null) return card;
    card = document.createElement('div');
    card.className = 'fd-tip';
    var s = card.style;
    s.position = 'fixed'; s.zIndex = '9999'; s.pointerEvents = 'none';
    s.maxWidth = '42vw'; s.padding = '0.55em 0.8em'; s.borderRadius = '8px';
    s.background = 'rgba(12, 13, 16, .96)'; s.color = '#f2eee6';
    s.border = '1px solid rgba(242, 238, 230, .28)'; s.boxShadow = '0 6px 22px rgba(0, 0, 0, .55)';
    s.fontFamily = '"Helvetica Neue", Helvetica, Arial, sans-serif'; s.fontSize = size; s.lineHeight = '1.3';
    s.letterSpacing = '0.01em'; s.display = 'none';
    document.body.appendChild(card);
    return card;
  }

  function place(node) {
    var c = ensure();
    var r = node.getBoundingClientRect();
    c.style.display = 'block';
    c.style.left = '0px'; c.style.top = '0px';
    var w = c.offsetWidth, h = c.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var x = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
    var y = r.bottom + 10;
    if (y + h > vh - 8) y = r.top - h - 10;
    if (y < 8) y = 8;
    c.style.left = String(Math.round(x)) + 'px';
    c.style.top = String(Math.round(y)) + 'px';
  }

  function show(node) {
    var text = node.getAttribute('data-tip');
    if (!text) return;
    var c = ensure();
    c.textContent = text;
    place(node);
    over = node;
  }

  function hide() {
    if (showTimer !== null) { clearTimeout(showTimer); showTimer = null; }
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    if (card !== null) card.style.display = 'none';
    over = null;
  }

  function target(event) {
    var node = event.target;
    while (node !== null && node !== document && node.nodeType === 1 && !node.hasAttribute('data-tip')) node = node.parentNode;
    return node !== null && node !== document && node.nodeType === 1 ? node : null;
  }

  document.addEventListener('pointerover', function (event) {
    if (event.pointerType === 'touch') return;
    var node = target(event);
    if (node === null) { hide(); return; }
    if (node === over) return;
    hide();
    showTimer = setTimeout(function () { showTimer = null; show(node); }, 260);
  }, true);
  document.addEventListener('pointerout', function (event) {
    if (event.pointerType === 'touch') return;
    var node = target(event);
    if (node !== null && (node === over || showTimer !== null)) {
      var to = event.relatedTarget;
      while (to && to !== node && to.nodeType === 1) to = to.parentNode;
      if (to !== node) hide();
    }
  }, true);
  // A finger: hold half a second to read; the lift after a hold is not a tap.
  var hold = null;
  document.addEventListener('pointerdown', function (event) {
    if (event.pointerType !== 'touch') { hide(); return; }
    var node = target(event);
    if (node === null) return;
    hold = { node: node, x: event.clientX, y: event.clientY };
    holdTimer = setTimeout(function () {
      holdTimer = null;
      if (hold !== null) { show(hold.node); swallowUntil = Infinity; }
    }, 500);
  }, true);
  document.addEventListener('pointermove', function (event) {
    if (hold === null || event.pointerType !== 'touch') return;
    if (Math.abs(event.clientX - hold.x) > 8 || Math.abs(event.clientY - hold.y) > 8) { hold = null; hide(); swallowUntil = 0; }
  }, true);
  var release = function (event) {
    if (event.pointerType !== 'touch') return;
    var shown = over !== null;
    hold = null;
    hide();
    swallowUntil = shown ? Date.now() + 400 : 0;
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  document.addEventListener('click', function (event) {
    if (Date.now() < swallowUntil) { event.stopPropagation(); event.preventDefault(); swallowUntil = 0; }
  }, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  return { hide: hide };
}
