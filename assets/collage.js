/**
 * A COLLAGE FOR A PLAYLIST — the covers of its first few tracks, tiled into
 * the circle that stands for it (Peter, 09-04: "make a collage of the album
 * covers in the playlist and miniaturise into a circle as the selector, with
 * the title adjacent rather than the single capital letter").
 *
 * Roon gives a playlist row no art of its own, but its tracks have theirs. So:
 * descend into the playlist in a browse session OF OUR OWN — Roon keeps one
 * stack per session key, and the level the person is looking at must not move
 * under them — read a dozen rows, keep the first four distinct sleeves, and
 * draw them two by two on a small canvas. The result is remembered by title,
 * so coming back to Playlists costs nothing.
 *
 * The pure parts (which sleeves, where they go) are proven in node; only the
 * drawing touches the DOM. ES2018 floor, like every other shipped asset.
 */

/** The first `want` distinct sleeves among a playlist's rows, in order. */
export function distinctArt(items, want) {
  var out = [];
  for (var i = 0; i < items.length && out.length < want; i += 1) {
    var art = items[i] && typeof items[i].art === 'string' ? items[i].art : null;
    if (art === null || out.indexOf(art) !== -1) continue;
    out.push(art);
  }
  return out;
}

/**
 * Where `n` sleeves go on a square of side `size`: one fills it, two share it
 * side by side, three or four tile it two by two (three repeats the first in
 * the empty corner, so the circle never has a dark quarter).
 */
export function collageLayout(n, size) {
  var half = size / 2;
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0, w: size, h: size, at: 0 }];
  if (n === 2) return [{ x: 0, y: 0, w: half, h: size, at: 0 }, { x: half, y: 0, w: half, h: size, at: 1 }];
  return [
    { x: 0, y: 0, w: half, h: half, at: 0 },
    { x: half, y: 0, w: half, h: half, at: 1 },
    { x: 0, y: half, w: half, h: half, at: 2 },
    { x: half, y: half, w: half, h: half, at: n >= 4 ? 3 : 0 },
  ];
}

/** Cover-fit a sleeve into a cell: crop, never stretch. */
function coverFit(context, image, cell) {
  var scale = Math.max(cell.w / image.naturalWidth, cell.h / image.naturalHeight);
  var w = image.naturalWidth * scale;
  var h = image.naturalHeight * scale;
  context.drawImage(image, cell.x + (cell.w - w) / 2, cell.y + (cell.h - h) / 2, w, h);
}

/** Draw the sleeves at `paths` into a data: URL, or null when none could be read. */
export function drawCollage(paths, size, done) {
  var images = [];
  var pending = paths.length;
  if (pending === 0) { done(null); return; }
  var settle = function () {
    pending -= 1;
    if (pending > 0) return;
    var loaded = images.filter(function (image) { return image !== null; });
    if (loaded.length === 0) { done(null); return; }
    try {
      var pad = document.createElement('canvas');
      pad.width = size; pad.height = size;
      var context = pad.getContext('2d');
      context.fillStyle = '#15171c';
      context.fillRect(0, 0, size, size);
      var cells = collageLayout(loaded.length, size);
      for (var c = 0; c < cells.length; c += 1) coverFit(context, loaded[cells[c].at], cells[c]);
      done(pad.toDataURL('image/jpeg', 0.82));
    } catch (error) { done(null); }
  };
  for (var i = 0; i < paths.length; i += 1) {
    (function (index) {
      var image = new Image();
      images[index] = null;
      image.onload = function () { images[index] = image; settle(); };
      image.onerror = function () { settle(); };
      image.src = paths[index];
    }(i));
  }
}

/**
 * The builder: given `ask` (the browse call, taking a body and a session key),
 * hands back a function that resolves a playlist title to a collage, one at a
 * time, remembered by title. `hierarchy` is the level the playlists live on.
 */
export function createCollages(ask, options) {
  var opts = options || {};
  var size = typeof opts.size === 'number' ? opts.size : 96;
  var want = typeof opts.want === 'number' ? opts.want : 4;
  var session = 'puck-collage-' + String(Math.floor(Math.random() * 1e6));
  var known = {};        // title -> data: URL | null (null = tried, nothing to show)
  var waiting = [];      // { hierarchy, title, done }
  var running = false;

  function next() {
    if (running || waiting.length === 0) return;
    var job = waiting.shift();
    running = true;
    var finish = function (url) {
      known[job.title] = url;
      running = false;
      job.done(url);
      next();
    };
    // Our own stack: to the root, find the row by title, descend, read rows.
    ask({ hierarchy: job.hierarchy, popAll: true }, session)
      .then(function () { return ask({ hierarchy: job.hierarchy, load: true, count: 200, offset: 0 }, session); })
      .then(function (page) {
        var rows = (page && page.items) || [];
        var row = null;
        for (var i = 0; i < rows.length; i += 1) if (rows[i].title === job.title) { row = rows[i]; break; }
        if (row === null || !row.itemKey) throw new Error('no such playlist');
        return ask({ hierarchy: job.hierarchy, itemKey: row.itemKey }, session);
      })
      .then(function () { return ask({ hierarchy: job.hierarchy, load: true, count: 12, offset: 0 }, session); })
      .then(function (page) {
        var paths = distinctArt((page && page.items) || [], want);
        if (paths.length === 0) { finish(null); return; }
        drawCollage(paths, size, finish);
      })
      .catch(function () { finish(null); });
  }

  return {
    /** Calls `done` at once from memory, or later when built; never twice. */
    request: function (hierarchy, title, done) {
      if (Object.prototype.hasOwnProperty.call(known, title)) { done(known[title]); return; }
      for (var i = 0; i < waiting.length; i += 1) if (waiting[i].title === title) return;
      waiting.push({ hierarchy: hierarchy, title: title, done: done });
      next();
    },
    known: function (title) { return Object.prototype.hasOwnProperty.call(known, title) ? known[title] : undefined; },
  };
}
