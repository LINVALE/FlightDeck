/**
 * Screenshot a Face or the Wall from the running server.
 *
 * Headless Chrome's --screenshot flag never returns on a Face: the SSE stream
 * keeps the page from ever firing `load`. So this drives Chrome over CDP and
 * captures on a timer instead, and reports console errors — which is how the
 * blank-artwork and picker-overlap defects were both caught.
 *
 *   node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs] [--keys=Enter,Enter]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , url, out, w = '1920', h = '1080', wait = '4000'] = process.argv;
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [w] [h] [waitMs] [--keys=Enter,Enter]');
  process.exit(2);
}
const keysArg = process.argv.find((a) => a.startsWith('--keys='));
const keys = keysArg ? keysArg.slice('--keys='.length).split(',').filter(Boolean) : [];
const port = 9300 + Math.floor(Math.random() * 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + port, '--window-size=' + w + ',' + h,
  '--user-data-dir=/tmp/fd-cdp-' + port, 'about:blank',
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && target === null; i += 1) {
  await sleep(250);
  try {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    target = list.find((t) => t.type === 'page') ?? null;
  } catch { /* not up yet */ }
}
if (target === null) { chrome.kill(); throw new Error('chrome did not start'); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
  }
});
const send = (method, params = {}) => new Promise((r) => {
  const mid = ++id; pending.set(mid, r);
  ws.send(JSON.stringify({ id: mid, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(+wait);
for (const key of keys) {
  await send('Runtime.evaluate', { expression: "document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "'}))" });
  await sleep(2000);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
const overflow = await send('Runtime.evaluate', {
  expression: '({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,'
    + ' sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight })',
  returnByValue: true,
});
const o = overflow.result.value;
console.log(out + '  ' + w + 'x' + h);
if (o.sw > o.cw) console.log('  ⚠ HORIZONTAL OVERFLOW: content ' + o.sw + 'px in ' + o.cw + 'px');
if (o.sh > o.ch) console.log('  ⚠ vertical overflow: content ' + o.sh + 'px in ' + o.ch + 'px (a TV cannot scroll)');
console.log(errors.length ? '  CONSOLE ERRORS:\n   ' + errors.join('\n   ') : '  no console errors');
ws.close(); chrome.kill();
