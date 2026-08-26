/**
 * The minimum DNS wire codec an mDNS responder needs. Node has none built in,
 * and the npm options (multicast-dns, last released 2022) add four transitive
 * packages for the half we do not use.
 */

export interface Question { readonly name: string; readonly type: number; readonly qclass: number; readonly unicast: boolean }

export const TYPE_A = 1;
export const TYPE_PTR = 12;
export const TYPE_TXT = 16;
export const TYPE_SRV = 33;
export const TYPE_ANY = 255;
export const CLASS_IN = 1;
export const FLUSH = 0x8000;

/** Parse a name, following compression pointers with a bounded jump count. */
export function readNameAt(buffer: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let jumps = 0;
  let cursor = offset;
  let next = -1;
  while (cursor < buffer.length) {
    const length = buffer[cursor];
    if (length === 0) { cursor += 1; break; }
    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= buffer.length) throw new Error('truncated pointer');
      if (next === -1) next = cursor + 2;
      cursor = ((length & 0x3f) << 8) | buffer[cursor + 1];
      jumps += 1;
      if (jumps > 16) throw new Error('pointer loop');
      continue;
    }
    if (cursor + 1 + length > buffer.length) throw new Error('truncated label');
    labels.push(buffer.toString('utf8', cursor + 1, cursor + 1 + length));
    cursor += 1 + length;
  }
  return { name: labels.join('.'), next: next === -1 ? cursor : next };
}

export function encodeName(name: string): Buffer {
  const parts = name.split('.').filter((part) => part.length > 0);
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const bytes = Buffer.from(part, 'utf8');
    if (bytes.length > 63) throw new Error('label too long');
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

export function parseQuestions(message: Buffer): { id: number; flags: number; questions: Question[] } {
  if (message.length < 12) throw new Error('short message');
  const id = message.readUInt16BE(0);
  const flags = message.readUInt16BE(2);
  const count = message.readUInt16BE(4);
  const questions: Question[] = [];
  let cursor = 12;
  for (let index = 0; index < count && cursor < message.length; index += 1) {
    const parsed = readNameAt(message, cursor);
    cursor = parsed.next;
    if (cursor + 4 > message.length) break;
    const type = message.readUInt16BE(cursor);
    const rawClass = message.readUInt16BE(cursor + 2);
    cursor += 4;
    questions.push({ name: parsed.name, type, qclass: rawClass & 0x7fff, unicast: (rawClass & 0x8000) !== 0 });
  }
  return { id, flags, questions };
}

export interface Answer { name: string; type: number; ttl: number; data: Buffer; flush?: boolean }

export function answerA(name: string, ip: string, ttl: number): Answer {
  const octets = ip.split('.').map((part) => Number(part));
  return { name, type: TYPE_A, ttl, data: Buffer.from(octets), flush: true };
}

export function answerPtr(name: string, target: string, ttl: number): Answer {
  return { name, type: TYPE_PTR, ttl, data: encodeName(target) };
}

export function answerSrv(name: string, target: string, port: number, ttl: number): Answer {
  const head = Buffer.alloc(6);
  head.writeUInt16BE(0, 0);       // priority
  head.writeUInt16BE(0, 2);       // weight
  head.writeUInt16BE(port, 4);
  return { name, type: TYPE_SRV, ttl, data: Buffer.concat([head, encodeName(target)]), flush: true };
}

export function answerTxt(name: string, entries: readonly string[], ttl: number): Answer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry, 'utf8');
    chunks.push(Buffer.from([Math.min(255, bytes.length)]), bytes.subarray(0, 255));
  }
  if (chunks.length === 0) chunks.push(Buffer.from([0]));
  return { name, type: TYPE_TXT, ttl, data: Buffer.concat(chunks), flush: true };
}


/**
 * The A records in a response, as dotted-quad strings. Used to tell OUR OWN
 * name being echoed back (by the host's avahi, or by our own loopback) from a
 * genuine conflict with another machine.
 */
export function parseAnswers(message: Buffer): { name: string; type: number; ip: string | null }[] {
  const out: { name: string; type: number; ip: string | null }[] = [];
  if (message.length < 12) return out;
  const qd = message.readUInt16BE(4);
  const an = message.readUInt16BE(6);
  let cursor = 12;
  for (let i = 0; i < qd && cursor < message.length; i += 1) {
    cursor = readNameAt(message, cursor).next + 4;
  }
  for (let i = 0; i < an && cursor + 10 <= message.length; i += 1) {
    const parsed = readNameAt(message, cursor);
    cursor = parsed.next;
    if (cursor + 10 > message.length) break;
    const type = message.readUInt16BE(cursor);
    const rdLength = message.readUInt16BE(cursor + 8);
    const rd = message.subarray(cursor + 10, cursor + 10 + rdLength);
    cursor += 10 + rdLength;
    out.push({
      name: parsed.name,
      type,
      ip: type === TYPE_A && rd.length === 4 ? [...rd].join('.') : null,
    });
  }
  return out;
}

export function buildResponse(answers: readonly Answer[], id = 0): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x8400, 2);            // QR + AA
  header.writeUInt16BE(0, 4);                 // no questions echoed
  header.writeUInt16BE(answers.length, 6);
  const records: Buffer[] = [header];
  for (const answer of answers) {
    const name = encodeName(answer.name);
    const meta = Buffer.alloc(10);
    meta.writeUInt16BE(answer.type, 0);
    meta.writeUInt16BE(CLASS_IN | (answer.flush === true ? FLUSH : 0), 2);
    meta.writeUInt32BE(answer.ttl, 4);
    meta.writeUInt16BE(answer.data.length, 8);
    records.push(name, meta, answer.data);
  }
  return Buffer.concat(records);
}

export function buildQuery(name: string, type: number): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(1, 4);
  const meta = Buffer.alloc(4);
  meta.writeUInt16BE(type, 0);
  meta.writeUInt16BE(CLASS_IN, 2);
  return Buffer.concat([header, encodeName(name), meta]);
}
