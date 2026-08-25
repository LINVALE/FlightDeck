/**
 * Generate the PWA icons as real PNGs, with no image library.
 *
 * A data: URI cannot be used for a manifest icon (Android rejects it), and the
 * CSP forbids anything off-origin, so these are written as files under assets/.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** The mark: an amber approach-lamp arc on the deck ground — the Presence face's own idea. */
function icon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y += 1) {
    raw[p] = 0; p += 1;
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const ang = Math.atan2(dy, dx);
      let rr = 10, gg = 11, bb = 13, aa = 255;               // deck ground
      // the arc: 0.62..0.80 radius, from -140deg round to +40deg
      const inArc = r > 0.60 && r < 0.80 && ang > -2.45 && ang < 0.70;
      if (inArc) { rr = 216; gg = 162; bb = 74; }             // amber
      // the still centre: the record
      if (r < 0.34) { rr = 233; gg = 198; bb = 122; }
      if (r < 0.10) { rr = 10; gg = 11; bb = 13; }            // the spindle
      if (r > 0.97) aa = 0;                                   // round the corners off
      raw[p] = rr; raw[p + 1] = gg; raw[p + 2] = bb; raw[p + 3] = aa; p += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                                   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const size of [192, 512]) {
  writeFileSync(new URL('../assets/icon-' + size + '.png', import.meta.url), icon(size));
  console.log('assets/icon-' + size + '.png');
}
