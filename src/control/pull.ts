import type { NowPlaying, Snapshot, Zone } from '../model/types.ts';

/** The narrow surfaces owned by a Pull transaction. */
export interface PullCommandPort {
  transferZone(fromZoneId: string, toOutputId: string): Promise<void>;
  control(outputId: string, action: 'play'): Promise<void>;
}

export interface PullSnapshotSource {
  snapshot(): Snapshot | null;
  /** Future structural publications only; delivery is synchronous and ordered. */
  observe(observer: (snapshot: Snapshot) => void): () => void;
}

export interface PullRequest {
  readonly sourceZoneId: string;
  readonly destinationOutputId: string;
  /** The exact browser snapshot on which the gesture was made. */
  readonly generation: string;
  readonly revision: number;
}

export interface PullOutcome {
  readonly generation: string;
  readonly revision: number;
  readonly destinationZoneId: string;
  readonly playIssued: boolean;
}

export type PullErrorCode =
  | 'busy'
  | 'closed'
  | 'snapshot-unavailable'
  | 'stale-request'
  | 'source-not-found'
  | 'source-empty'
  | 'destination-not-found'
  | 'destination-ambiguous'
  | 'same-zone'
  | 'generation-drift'
  | 'revision-drift'
  | 'identity-drift'
  | 'destination-drift'
  | 'play-not-allowed'
  | 'timeout'
  | 'transfer-failed'
  | 'play-failed';

export class PullError extends Error {
  readonly code: PullErrorCode;

  constructor(code: PullErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PullError';
    this.code = code;
  }
}

export interface PullCoordinatorOptions {
  readonly snapshots: PullSnapshotSource;
  readonly commands: PullCommandPort;
  readonly timeoutMs?: number;
}

interface PullToken {
  cancelled: boolean;
  wake: (() => void) | null;
  cancelCommand: (() => void) | null;
}

interface ItemIdentity {
  readonly title: string;
  readonly line2: string;
  readonly line3: string;
  readonly lengthSec: number | null;
  readonly artKey: string | null;
}

interface PreparedPull {
  readonly source: Zone;
  readonly sourceIdentity: ItemIdentity;
  readonly sourceOutputIds: ReadonlySet<string>;
  readonly destination: Zone;
  readonly destinationIdentity: ItemIdentity | null;
}

type LandingDecision =
  | { readonly kind: 'wait' }
  | { readonly kind: 'play'; readonly destination: Zone }
  | { readonly kind: 'complete'; readonly destination: Zone };

/**
 * One server-owned Pull transaction at a time.
 *
 * The transfer callback proves only command acceptance. Completion comes from
 * the ordered structural publications that follow it. A paused landing receives
 * at most one explicit Play and is not successful until a later publication
 * proves the exact item is playing/loading on the durable destination output.
 */
export class PullCoordinator {
  private readonly snapshots: PullSnapshotSource;
  private readonly commands: PullCommandPort;
  private readonly timeoutMs: number;
  private activeToken: PullToken | null = null;
  private closed = false;

  constructor(options: PullCoordinatorOptions) {
    this.snapshots = options.snapshots;
    this.commands = options.commands;
    this.timeoutMs = positiveInteger(options.timeoutMs, 5_000);
  }

  get active(): boolean { return this.activeToken !== null; }

  async pull(request: PullRequest): Promise<PullOutcome> {
    if (this.closed) throw new PullError('closed', 'pull coordinator is closed');
    if (this.activeToken !== null) throw new PullError('busy', 'another pull is already active');

    const token: PullToken = { cancelled: false, wake: null, cancelCommand: null };
    this.activeToken = token;
    try {
      return await this.run(request, token);
    } finally {
      token.cancelCommand = null;
      if (this.activeToken === token) this.activeToken = null;
    }
  }

  /** Cancel observation and prohibit any later transaction during shutdown. */
  close(): void {
    this.closed = true;
    if (this.activeToken === null) return;
    this.activeToken.cancelled = true;
    this.activeToken.wake?.();
    this.activeToken.cancelCommand?.();
  }

  private async run(request: PullRequest, token: PullToken): Promise<PullOutcome> {
    const initial = this.snapshots.snapshot();
    if (initial === null) throw new PullError('snapshot-unavailable', 'no structural snapshot is available');
    const prepared = prepare(initial, request);
    const deadline = Date.now() + this.timeoutMs;
    const publications: Snapshot[] = [];

    // Subscribe before the second fence check. A Core publication between the
    // browser check and transfer is therefore either rejected by the recheck or
    // captured here; it can never disappear into the gap.
    const stopObserving = this.snapshots.observe((snapshot) => {
      publications.push(snapshot);
      const wake = token.wake;
      token.wake = null;
      wake?.();
    });

    try {
      const rechecked = this.snapshots.snapshot();
      if (rechecked === null) throw new PullError('snapshot-unavailable', 'snapshot vanished before transfer');
      const checkedAgain = prepare(rechecked, request);
      if (!samePreparation(prepared, checkedAgain)) {
        throw new PullError('identity-drift', 'source or destination changed before transfer');
      }
      ensureOpen(token, this.closed);

      try {
        await beforeDeadline(
          () => this.commands.transferZone(prepared.source.id, request.destinationOutputId), deadline, token,
        );
      } catch (error) {
        if (error instanceof PullError) throw error;
        throw new PullError('transfer-failed', 'Roon refused the pull transfer', error);
      }

      let lastRevision = request.revision;
      let playIssued = false;
      while (true) {
        ensureOpen(token, this.closed);
        while (publications.length > 0) {
          const publication = publications.shift() as Snapshot;
          if (publication.generation !== request.generation) {
            throw new PullError('generation-drift', 'FlightDeck restarted during the pull');
          }
          if (publication.revision !== lastRevision + 1) {
            throw new PullError('revision-drift', 'structural publications were not consecutive');
          }
          lastRevision = publication.revision;

          const decision = inspectLanding(publication, prepared, request.destinationOutputId, playIssued);
          if (decision.kind === 'complete') {
            return result(publication, decision.destination, playIssued);
          }
          if (decision.kind === 'play') {
            // Latch BEFORE the command. A synchronous publication or a failed
            // callback can never turn this into a second Play.
            playIssued = true;
            try {
              await beforeDeadline(
                () => this.commands.control(request.destinationOutputId, 'play'), deadline, token,
              );
            } catch (error) {
              if (error instanceof PullError) throw error;
              throw new PullError('play-failed', 'Roon refused Play on the pull destination', error);
            }
          }
        }
        await waitForPublication(token, deadline);
      }
    } finally {
      stopObserving();
    }
  }
}

function prepare(snapshot: Snapshot, request: PullRequest): PreparedPull {
  if (snapshot.generation !== request.generation || snapshot.revision !== request.revision) {
    throw new PullError('stale-request', 'the screen acted on an old FlightDeck snapshot');
  }

  const source = snapshot.zones.find((zone) => zone.id === request.sourceZoneId);
  if (source === undefined) throw new PullError('source-not-found', 'the source zone no longer exists');
  if (source.nowPlaying === null) throw new PullError('source-empty', 'the source zone has no current item');

  const owners = outputOwners(snapshot, request.destinationOutputId);
  if (owners.length === 0) throw new PullError('destination-not-found', 'the destination output no longer exists');
  if (owners.length !== 1) throw new PullError('destination-ambiguous', 'the destination output has more than one owner');
  const destination = owners[0];
  if (destination.id === source.id) throw new PullError('same-zone', 'source and destination are already the same zone');

  const sourceIdentity = itemIdentity(source.nowPlaying);
  const destinationIdentity = destination.nowPlaying === null ? null : itemIdentity(destination.nowPlaying);
  if (destinationIdentity !== null && sameIdentity(sourceIdentity, destinationIdentity)) {
    throw new PullError(
      'destination-ambiguous',
      'the destination already shows the same item, so a transfer landing cannot be proved',
    );
  }

  return {
    source,
    sourceIdentity,
    sourceOutputIds: new Set(source.outputs.map((output) => output.id)),
    destination,
    destinationIdentity,
  };
}

function samePreparation(left: PreparedPull, right: PreparedPull): boolean {
  return left.source.id === right.source.id
    && left.source.state === right.source.state
    && sameIdentity(left.sourceIdentity, right.sourceIdentity)
    && sameStringSet(left.sourceOutputIds, right.sourceOutputIds)
    && left.destination.id === right.destination.id
    && nullableIdentityEqual(left.destinationIdentity, right.destinationIdentity);
}

function inspectLanding(
  snapshot: Snapshot,
  prepared: PreparedPull,
  destinationOutputId: string,
  playIssued: boolean,
): LandingDecision {
  const owners = outputOwners(snapshot, destinationOutputId);
  if (owners.length !== 1) {
    throw new PullError('destination-drift', 'the durable destination output changed ownership ambiguously');
  }
  const destination = owners[0];
  const destinationMatches = destination.nowPlaying !== null
    && sameIdentity(prepared.sourceIdentity, itemIdentity(destination.nowPlaying));

  const sourceStillActive = snapshot.zones.some((zone) =>
    (zone.state === 'playing' || zone.state === 'loading')
    && zone.outputs.some((output) => prepared.sourceOutputIds.has(output.id))
    && zone.nowPlaying !== null
    && sameIdentity(prepared.sourceIdentity, itemIdentity(zone.nowPlaying)));

  if (!destinationMatches) {
    if (playIssued) throw new PullError('identity-drift', 'the landed item changed after Play');
    const sourceChangedWhileActive = snapshot.zones.some((zone) =>
      (zone.state === 'playing' || zone.state === 'loading')
      && zone.outputs.some((output) => prepared.sourceOutputIds.has(output.id))
      && zone.nowPlaying !== null
      && !sameIdentity(prepared.sourceIdentity, itemIdentity(zone.nowPlaying)));
    if (sourceChangedWhileActive) {
      throw new PullError('identity-drift', 'the source changed item before the transfer landed');
    }
    return { kind: 'wait' };
  }

  // A publication may briefly show both ends during Core reconciliation. It is
  // evidence to keep waiting, not authority to send Play or report success.
  if (sourceStillActive) return { kind: 'wait' };
  if (destination.state === 'playing' || destination.state === 'loading') {
    return { kind: 'complete', destination };
  }
  if (playIssued) return { kind: 'wait' };
  if (!destination.allowed.play) {
    throw new PullError('play-not-allowed', 'Roon does not allow Play on the pull destination');
  }
  return { kind: 'play', destination };
}

function outputOwners(snapshot: Snapshot, outputId: string): Zone[] {
  return snapshot.zones.filter((zone) => zone.outputs.some((output) => output.id === outputId));
}

function itemIdentity(item: NowPlaying): ItemIdentity {
  return {
    title: item.title,
    line2: item.line2,
    line3: item.line3,
    lengthSec: item.lengthSec,
    artKey: item.art?.key ?? null,
  };
}

function sameIdentity(left: ItemIdentity, right: ItemIdentity): boolean {
  return left.title === right.title && left.line2 === right.line2 && left.line3 === right.line3
    && left.lengthSec === right.lengthSec && left.artKey === right.artKey;
}

function nullableIdentityEqual(left: ItemIdentity | null, right: ItemIdentity | null): boolean {
  if (left === null || right === null) return left === right;
  return sameIdentity(left, right);
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function result(snapshot: Snapshot, destination: Zone, playIssued: boolean): PullOutcome {
  return {
    generation: snapshot.generation,
    revision: snapshot.revision,
    destinationZoneId: destination.id,
    playIssued,
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function ensureOpen(token: PullToken, closed: boolean): void {
  if (token.cancelled || closed) throw new PullError('closed', 'pull coordinator closed while waiting');
}

async function waitForPublication(token: PullToken, deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new PullError('timeout', 'no exact pull landing arrived in time');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (token.wake === wake) token.wake = null;
      reject(new PullError('timeout', 'no exact pull landing arrived in time'));
    }, remaining);
    const wake = (): void => {
      clearTimeout(timer);
      resolve();
    };
    token.wake = wake;
    if (token.cancelled) {
      token.wake = null;
      wake();
    }
  });
}

async function beforeDeadline(run: () => Promise<void>, deadline: number, token: PullToken): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new PullError('timeout', 'pull command did not settle in time');
  let timer: ReturnType<typeof setTimeout> | null = null;
  const boundary = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new PullError('timeout', 'pull command did not settle in time')),
      remaining,
    );
  });
  const cancelled = new Promise<never>((_resolve, reject) => {
    token.cancelCommand = () => reject(new PullError('closed', 'pull coordinator closed during a command'));
  });
  try {
    if (token.cancelled) throw new PullError('closed', 'pull coordinator is closed');
    await Promise.race([run(), boundary, cancelled]);
  } finally {
    token.cancelCommand = null;
    if (timer !== null) clearTimeout(timer);
  }
}
