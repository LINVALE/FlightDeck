/**
 * Tiny DOM compatibility rail for the declared Chromium 63 television floor.
 *
 * `Element.replaceChildren()` did not arrive in Chromium until much later. A
 * missing method fails only when a picker is drawn, which looks exactly like a
 * menu that opens and hangs. Keep the polyfill local and deliberately small.
 */
if (typeof Element !== 'undefined' && Element.prototype.replaceChildren === undefined) {
  Object.defineProperty(Element.prototype, 'replaceChildren', {
    configurable: true,
    writable: true,
    value: function () {
      while (this.firstChild !== null) this.removeChild(this.firstChild);
      for (var i = 0; i < arguments.length; i += 1) {
        var child = arguments[i];
        this.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
    },
  });
}
