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

/**
 * The FlightDeck TV app lays pages out at the television's real resolution.
 *
 * Android's WebView measures a page in density-independent pixels, so a 1080p
 * Fire TV at 2x gave every page 960x540: The Deck drew half its cards and asked
 * for half-size art. The app names the screen's real size in its user agent,
 * `FlightDeckTV/<version> (<width>x<height>)`, and the page widens its viewport
 * to that width, which the WebView then scales to fit exactly — one CSS pixel
 * per screen pixel, as a Samsung or LG browser already gives. It runs first,
 * before any page measures itself. Any other browser is untouched.
 */
/**
 * Android's overlay scrollbar is a hairline that fades away, so on a Fire TV a
 * long menu gave no sign that more was below. Silk and the FlightDeck TV app
 * are marked here, and face.css and wall.css give every scrolling area a solid
 * rail on those browsers only. The Samsung and desktop renderings are unchanged.
 */
if (typeof navigator !== 'undefined' && /\bSilk\/|FlightDeckTV\//i.test(navigator.userAgent || '')) {
  document.documentElement.setAttribute('data-android-rail', '1');
}

(function () {
  var match = /FlightDeckTV\/[\d.]+ \((\d+)x(\d+)\)/.exec(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  if (match === null) return;
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta !== null) meta.setAttribute('content', 'width=' + match[1] + ',viewport-fit=cover');
})();
