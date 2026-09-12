import { createSocket, type Socket, type RemoteInfo } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import {
  buildQuery, buildResponse, parseAnswers, parseQuestions,
  answerA, answerPtr, answerSrv, answerTxt,
  TYPE_A, TYPE_ANY, TYPE_PTR, TYPE_SRV, TYPE_TXT, type Answer,
} from './dns-wire.ts';

/**
 * A zero-dependency mDNS / DNS-SD responder so FlightDeck is reachable BY NAME
 * (Peter's ruling 08-25), not just by port.
 *
 * It coexists with a host avahi: SO_REUSEADDR plus multicast group membership
 * means every joined socket receives the datagram — which is why avahi and
 * Chrome already share 5353 on this machine.
 *
 * ⚠️ .local resolution is NOT universal: it fails on Fire OS, Echo Show and
 * Android <= 11, and is unverified on Tizen/webOS. The IP URL and QR that the
 * Wall prints are therefore mandatory, not a nicety.
 */

const GROUP = '224.0.0.251';
const PORT = 5353;
const TTL_HOST = 120;
const TTL_SERVICE = 4500;
const SERVICE = '_http._tcp.local';

export interface MdnsOptions {
  readonly hostname: string;      // 'flightdeck' -> flightdeck.local
  readonly instance: string;      // 'FlightDeck'
  readonly port: number;
  readonly log?: (message: string) => void;
}

export interface MdnsStatus {
  readonly name: string;
  readonly probed: boolean;
  readonly renamed: boolean;
  readonly addresses: readonly string[];
}

interface Iface { readonly address: string; readonly name: string }

function ipv4Interfaces(): Iface[] {
  const found: Iface[] = [];
  const all = networkInterfaces();
  for (const [name, entries] of Object.entries(all)) {
    if (entries === undefined) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      // Never answer with a container bridge or a link-local address: a TV that
      // gets the Docker bridge gateway back is worse off than one that got no answer at all.
      if (entry.address.startsWith('169.254.')) continue;
      if (name.startsWith('docker') || name.startsWith('br-') || name.startsWith('veth')) continue;
      found.push({ address: entry.address, name });
    }
  }
  return found;
}

function sameSubnet(a: string, b: string): boolean {
  const left = a.split('.'); const right = b.split('.');
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

export class MdnsResponder {
  private readonly options: MdnsOptions;
  private socket: Socket | null = null;
  private interfaces: Iface[] = [];
  private hostname: string;
  private instance: string;
  private renamed = false;
  private probed = false;
  private conflicts = 0;
  private readonly lastAnswered = new Map<string, number>();
  private stopping = false;

  constructor(options: MdnsOptions) {
    this.options = options;
    this.hostname = options.hostname;
    this.instance = options.instance;
  }

  status(): MdnsStatus {
    return {
      name: this.fqdn(),
      probed: this.probed,
      renamed: this.renamed,
      addresses: this.interfaces.map((iface) => iface.address),
    };
  }

  fqdn(): string { return this.hostname + '.local'; }

  async start(): Promise<MdnsStatus> {
    this.interfaces = ipv4Interfaces();
    const log = this.options.log ?? ((): void => {});
    if (this.interfaces.length === 0) {
      log('mdns: no usable IPv4 interface — name publication skipped');
      return this.status();
    }
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(PORT, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });

    socket.setMulticastTTL(255);           // RFC 6762 §11
    socket.setMulticastLoopback(true);     // so this host's own avahi/nss sees us
    for (const iface of this.interfaces) {
      try { socket.addMembership(GROUP, iface.address); } catch { /* one bad iface is not fatal */ }
    }
    socket.on('message', (message, remote) => this.onMessage(message, remote));
    socket.on('error', () => { /* a transient socket error must not kill the http server */ });

    await this.probe();
    this.announce();
    log('mdns: ' + this.fqdn() + ' -> ' + this.interfaces.map((i) => i.address).join(', ')
      + ' (port ' + String(this.options.port) + ')' + (this.renamed ? ' [renamed]' : ''));
    return this.status();
  }

  /** RFC 6762 §8.1 — three probes 250 ms apart before claiming the name. */
  private async probe(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.sendMulticast(buildQuery(this.fqdn(), TYPE_A));
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (this.conflicts > 0) {
        this.conflicts = 0;
        this.rename();
        attempt = -1;
        if (this.renamedTooOften()) break;
      }
    }
    this.probed = true;
  }

  private renamedTooOften(): boolean {
    return /-(\d+)$/.exec(this.hostname) !== null && Number(/-(\d+)$/.exec(this.hostname)?.[1] ?? '0') > 9;
  }

  /** RFC 6762 §9 — on conflict, rename rather than fight. */
  private rename(): void {
    const match = /^(.*)-(\d+)$/.exec(this.hostname);
    const next = match === null ? 2 : Number(match[2]) + 1;
    const base = match === null ? this.hostname : match[1];
    this.hostname = base + '-' + String(next);
    this.instance = this.options.instance + ' (' + String(next) + ')';
    this.renamed = true;
  }

  /** RFC 6762 §8.3 — announce twice. */
  private announce(): void {
    for (const iface of this.interfaces) {
      this.sendMulticast(buildResponse(this.recordsFor(iface.address, TYPE_ANY, SERVICE)), iface.address);
    }
    setTimeout(() => {
      if (this.stopping) return;
      for (const iface of this.interfaces) {
        this.sendMulticast(buildResponse(this.recordsFor(iface.address, TYPE_ANY, SERVICE)), iface.address);
      }
    }, 1000).unref();
  }

  private recordsFor(address: string, type: number, name: string): Answer[] {
    const host = this.fqdn();
    const instanceName = this.instance + '.' + SERVICE;
    const answers: Answer[] = [];
    const wantsHost = type === TYPE_ANY || type === TYPE_A;
    const wantsService = type === TYPE_ANY || type === TYPE_PTR || type === TYPE_SRV || type === TYPE_TXT;
    if (wantsHost && (name === host || type === TYPE_ANY)) answers.push(answerA(host, address, TTL_HOST));
    if (wantsService) {
      answers.push(answerPtr(SERVICE, instanceName, TTL_SERVICE));
      answers.push(answerSrv(instanceName, host, this.options.port, TTL_SERVICE));
      answers.push(answerTxt(instanceName, ['path=/'], TTL_SERVICE));
      if (!answers.some((a) => a.type === TYPE_A)) answers.push(answerA(host, address, TTL_HOST));
    }
    return answers;
  }

  private onMessage(message: Buffer, remote: RemoteInfo): void {
    if (this.stopping) return;
    // RFC 6762 §11: ignore anything that did not come from this link.
    const local = this.interfaces.find((iface) => sameSubnet(iface.address, remote.address));
    if (local === undefined) return;

    let parsed;
    try { parsed = parseQuestions(message); } catch { return; }

    // A response for our own name is a conflict only when it points SOMEWHERE
    // ELSE. Judging by the sender's address was wrong: the host's own avahi
    // caches our previous announcement and replies for it, and multicast
    // loopback returns our own packets — so every restart looked like a
    // conflict and the responder renamed itself, reaching flightdeck-10.local
    // while still advertising flightdeck.local in its URLs.
    const isResponse = (parsed.flags & 0x8000) !== 0;
    if (isResponse) {
      if (this.probed) return;
      const host = this.fqdn().toLowerCase();
      const mine = new Set(this.interfaces.map((iface) => iface.address));
      for (const answer of parseAnswers(message)) {
        if (answer.name.toLowerCase() !== host || answer.ip === null) continue;
        if (!mine.has(answer.ip)) { this.conflicts += 1; return; }
      }
      return;
    }

    const host = this.fqdn();
    const instanceName = this.instance + '.' + SERVICE;
    for (const question of parsed.questions) {
      const name = question.name.toLowerCase();
      const matches = name === host.toLowerCase()
        || name === SERVICE
        || name === instanceName.toLowerCase()
        || name === '_services._dns-sd._udp.local';
      if (!matches) continue;

      // RFC 6762 §6: at most one answer per record per second.
      const key = name + ':' + String(question.type);
      const now = Date.now();
      const last = this.lastAnswered.get(key) ?? 0;
      if (now - last < 1000) continue;
      this.lastAnswered.set(key, now);

      const answers = name === '_services._dns-sd._udp.local'
        ? [answerPtr('_services._dns-sd._udp.local', SERVICE, TTL_SERVICE)]
        : this.recordsFor(local.address, question.type, question.name);
      const payload = buildResponse(answers, question.unicast ? parsed.id : 0);

      // §5.4 / §6.7: unicast when the QU bit is set or the source is not :5353
      // (a legacy one-shot resolver — which is exactly what Android and Windows send).
      if (question.unicast || remote.port !== PORT) {
        this.socket?.send(payload, remote.port, remote.address);
      } else {
        this.sendMulticast(payload, local.address);
      }
    }
  }

  private sendMulticast(payload: Buffer, address?: string): void {
    const socket = this.socket;
    if (socket === null) return;
    try {
      if (address !== undefined) socket.setMulticastInterface(address);
      socket.send(payload, PORT, GROUP);
    } catch { /* an interface can vanish mid-send */ }
  }

  /** RFC 6762 §10.1 — goodbye with TTL 0 so a restart does not shadow itself. */
  stop(): void {
    if (this.socket === null || this.stopping) return;
    this.stopping = true;
    try {
      for (const iface of this.interfaces) {
        const goodbye = this.recordsFor(iface.address, TYPE_ANY, SERVICE).map((a) => ({ ...a, ttl: 0 }));
        this.sendMulticast(buildResponse(goodbye), iface.address);
      }
    } catch { /* best effort */ }
    try { this.socket.close(); } catch { /* already closed */ }
    this.socket = null;
  }
}
