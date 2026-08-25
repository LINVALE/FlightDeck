/**
 * Ask for a .local name the way a REMOTE client does — an RFC 6762 §5.1 one-shot
 * query from an ephemeral port — and print every answer that comes back.
 *
 * This is the test that matters for "the TV cannot find it": the host's own
 * getent/avahi can succeed while a remote query gets nothing, or gets the wrong
 * address (a docker bridge, say), and only this shows which.
 *
 *   node scripts/mdns-probe.mjs [name] [timeoutMs]
 */
import { createSocket } from 'node:dgram';

const name = process.argv[2] ?? 'flightdeck.local';
const timeout = Number(process.argv[3] ?? 2500);

function encodeName(n) {
  const parts = n.split('.').filter(Boolean);
  const chunks = [];
  for (const p of parts) { const b = Buffer.from(p, 'utf8'); chunks.push(Buffer.from([b.length]), b); }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}
function readName(buf, off) {
  const labels = []; let cur = off, next = -1, jumps = 0;
  while (cur < buf.length) {
    const len = buf[cur];
    if (len === 0) { cur += 1; break; }
    if ((len & 0xc0) === 0xc0) { if (next === -1) next = cur + 2; cur = ((len & 0x3f) << 8) | buf[cur + 1]; if (++jumps > 16) break; continue; }
    labels.push(buf.toString('utf8', cur + 1, cur + 1 + len)); cur += 1 + len;
  }
  return { name: labels.join('.'), next: next === -1 ? cur : next };
}

const header = Buffer.alloc(12);
header.writeUInt16BE(0, 0); header.writeUInt16BE(0, 2); header.writeUInt16BE(1, 4);
const meta = Buffer.alloc(4);
meta.writeUInt16BE(1, 0);            // A
meta.writeUInt16BE(1, 2);            // IN (QU bit clear = ask for a multicast reply too)
const query = Buffer.concat([header, encodeName(name), meta]);

const socket = createSocket({ type: 'udp4', reuseAddr: true });
const answers = [];
socket.on('message', (msg, remote) => {
  try {
    if (msg.length < 12) return;
    const anCount = msg.readUInt16BE(6);
    const qdCount = msg.readUInt16BE(4);
    let cur = 12;
    for (let i = 0; i < qdCount; i += 1) { cur = readName(msg, cur).next + 4; }
    for (let i = 0; i < anCount && cur < msg.length; i += 1) {
      const parsed = readName(msg, cur); cur = parsed.next;
      const type = msg.readUInt16BE(cur);
      const ttl = msg.readUInt32BE(cur + 4);
      const rdLen = msg.readUInt16BE(cur + 8);
      const rd = msg.subarray(cur + 10, cur + 10 + rdLen);
      cur += 10 + rdLen;
      if (type === 1 && rdLen === 4) {
        answers.push({ from: remote.address, name: parsed.name, ip: [...rd].join('.'), ttl });
      }
    }
  } catch { /* a malformed neighbour must not crash the probe */ }
});
socket.bind(0, () => {
  socket.setMulticastTTL(255);
  socket.send(query, 5353, '224.0.0.251');
  console.log('asked the network for ' + name + ' (one-shot, ephemeral port — as a TV or phone does)');
});
setTimeout(() => {
  socket.close();
  if (answers.length === 0) { console.log('  NO ANSWER — a remote client would fail to resolve this name'); process.exit(1); }
  for (const a of answers) console.log('  ' + a.name + ' -> ' + a.ip + '  (ttl ' + a.ttl + ', from ' + a.from + ')');
  const bad = answers.filter((a) => a.ip.startsWith('172.') || a.ip.startsWith('169.254.'));
  if (bad.length) console.log('  ⚠ a bridge/link-local address was advertised — a remote client may take it and fail');
}, timeout);
