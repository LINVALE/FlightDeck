/**
 * A minimal QR encoder — byte mode, version 1-6, level M — so a phone can reach
 * the Wall from a TV screen without a library. The name fallback needs this:
 * .local does not resolve on Fire OS, Echo Show or Android <= 11, so the IP URL
 * has to be scannable, not just typeable.
 *
 * Returns a module matrix; the caller renders it as inline SVG (CSP-safe).
 */

const EC_CODEWORDS_M = [0, 10, 16, 26, 18, 24, 16];       // per block, versions 1-6
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4];
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172];
const ALIGN_POS = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables(): void {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= mul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function ecBytes(data: number[], degree: number): number[] {
  const gen = generator(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let j = 0; j < degree; j += 1) remainder[j] ^= mul(gen[j + 1], factor);
  }
  return remainder;
}

function pickVersion(length: number): number {
  for (let version = 1; version <= 6; version += 1) {
    const total = TOTAL_CODEWORDS[version];
    const blocks = BLOCKS_M[version];
    const capacity = total - blocks * EC_CODEWORDS_M[version];
    const header = version < 10 ? 2 : 3;               // mode nibble + 8/16-bit count
    if (length + header <= capacity) return version;
  }
  throw new Error('payload too long for a version-6 QR');
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = [...Buffer.from(text, 'utf8')];
  const version = pickVersion(bytes.length);
  const size = 17 + version * 4;
  const blocks = BLOCKS_M[version];
  const ecPerBlock = EC_CODEWORDS_M[version];
  const totalCodewords = TOTAL_CODEWORDS[version];
  const dataCodewords = totalCodewords - blocks * ecPerBlock;

  // ---- bit stream: mode 0100, 8-bit count, payload, terminator, pad ----
  const bits: number[] = [];
  const push = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);
  const capacityBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (bits.length < capacityBits) { push(pads[padIndex % 2], 8); padIndex += 1; }

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }

  // ---- interleave blocks ----
  const perBlock = Math.floor(dataCodewords / blocks);
  const extra = dataCodewords % blocks;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let cursor = 0;
  for (let b = 0; b < blocks; b += 1) {
    const count = perBlock + (b >= blocks - extra ? 1 : 0);
    const block = codewords.slice(cursor, cursor + count);
    cursor += count;
    dataBlocks.push(block);
    ecBlocks.push(ecBytes(block, ecPerBlock));
  }
  const finalCodewords: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) finalCodewords.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) finalCodewords.push(block[i]);
  }

  // ---- matrix ----
  const modules: (boolean | null)[][] = Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
  const setFinder = (row: number, col: number): void => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r; const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const onEdge = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        modules[rr][cc] = (r >= 0 && r <= 6 && c >= 0 && c <= 6) && (onEdge || inCore);
      }
    }
  };
  setFinder(0, 0); setFinder(0, size - 7); setFinder(size - 7, 0);
  for (let i = 8; i < size - 8; i += 1) {
    const on = i % 2 === 0;
    modules[6][i] = on; modules[i][6] = on;
  }
  for (const r of ALIGN_POS[version]) {
    for (const c of ALIGN_POS[version]) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          modules[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        }
      }
    }
  }
  modules[size - 8][8] = true;                        // dark module
  const reserveFormat = (): void => {
    for (let i = 0; i < 9; i += 1) {
      if (modules[8][i] === null) modules[8][i] = false;
      if (modules[i][8] === null) modules[i][8] = false;
    }
    for (let i = 0; i < 8; i += 1) {
      if (modules[8][size - 1 - i] === null) modules[8][size - 1 - i] = false;
      if (modules[size - 1 - i][8] === null) modules[size - 1 - i][8] = false;
    }
  };
  reserveFormat();

  // ---- place data, mask 0 ----
  let bitIndex = 0;
  const dataBits: number[] = [];
  for (const codeword of finalCodewords) for (let i = 7; i >= 0; i -= 1) dataBits.push((codeword >> i) & 1);
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let c = 0; c < 2; c += 1) {
        const col = right - c;
        if (modules[row][col] !== null) continue;
        let bit = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
        bitIndex += 1;
        if ((row + col) % 2 === 0) bit = !bit;              // mask pattern 0
        modules[row][col] = bit;
      }
    }
    upward = !upward;
  }

  // ---- format info: level M (00), mask 0 ----
  const formatBits = 0b101010000010010;                     // precomputed for M/mask0
  for (let i = 0; i <= 5; i += 1) modules[8][i] = ((formatBits >> i) & 1) === 1;
  modules[8][7] = ((formatBits >> 6) & 1) === 1;
  modules[8][8] = ((formatBits >> 7) & 1) === 1;
  modules[7][8] = ((formatBits >> 8) & 1) === 1;
  for (let i = 9; i <= 14; i += 1) modules[14 - i][8] = ((formatBits >> i) & 1) === 1;
  for (let i = 0; i <= 7; i += 1) modules[size - 1 - i][8] = ((formatBits >> i) & 1) === 1;
  for (let i = 8; i <= 14; i += 1) modules[8][size - 15 + i] = ((formatBits >> i) & 1) === 1;

  return modules.map((row) => row.map((cell) => cell === true));
}

/** Inline SVG — no library, no external request, works under `default-src 'none'`. */
export function qrSvg(text: string, sizePx = 120, dark = '#000', light = '#fff'): string {
  const matrix = qrMatrix(text);
  const modules = matrix.length;
  const quiet = 2;
  const total = modules + quiet * 2;
  const parts: string[] = [];
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (matrix[row][col]) parts.push('M' + String(col + quiet) + ' ' + String(row + quiet) + 'h1v1h-1z');
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + String(sizePx) + '" height="' + String(sizePx)
    + '" viewBox="0 0 ' + String(total) + ' ' + String(total) + '" shape-rendering="crispEdges" role="img" aria-label="QR code">'
    + '<rect width="' + String(total) + '" height="' + String(total) + '" fill="' + light + '"/>'
    + '<path fill="' + dark + '" d="' + parts.join('') + '"/></svg>';
}
