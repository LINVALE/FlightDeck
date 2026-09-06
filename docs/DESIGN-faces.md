# FlightDeck — Faces: the display-first design (2026-08-25)

**Read with:** `HANDOVER-2026-08-25-flightdeck-kickoff.md` (rulings + grounded API facts) and memory
`project_2026_08_24_house_canvas_vision_and_cash_contribution`. This doc moves to the FlightDeck repo the day it exists.

> ⭐ **BUILT 2026-08-25 — `~/dev/FlightDeck` (commit 9548899).** I0+I1 and the Presence face exist and run:
> 3483 lines, tests 20/20, floor lint clean, end-to-end over real HTTP against a stand-in Core. The Wall and
> the Presence face were rendered at 1080p from the live server (`node scripts/preview.ts`).
> ⚠️ **NO LIVE ROON PAIRING HAS BEEN RUN** — deliberately, to avoid touching the live Core mid-session. That
> is the first receipt in `~/dev/FlightDeck/docs/tv-drill.md`. Also unverified: the hand-written QR encoder
> has never been scanned by a phone (no decoder available offline).

## 0. What this is

The next step for FlightDeck: its **initial displays** — called **Faces** — on the thinnest honest spine.

- **Zone Face** `/face/<zoneId>` — the 10-foot TV now-playing screen; the like-for-like replacement for Roon's Display.
- **House Wall** `/` — every Roon zone at a glance (Roon has no equivalent; RHEOS rooms and Roon Ready rooms alike).

**Scope fence:** display only. No transport verbs, no browse/search, no grouping, no mic-VU, no generative art. The spine
is shaped so each of those hangs off it later without rework (the `allowed` flags already ride the wire; the palette
pipeline is the v0 of the image engine).

## 1. Diagnosis — why Roon's Display is "flakey" (which layer's reality is wrong)

Facts (community + Roon docs, links at the end):

- Roon Display is a receiver page at `http://<core>:9330/display/` (`9332` in newer builds). The Roon app **starts** a
  display onto a zone (zone volume → TV icon → start display); it can auto-start with playback.
- Reported failure modes, 2019–2023, across cores × Chromecasts × networks: freezes/disconnects after ~10–20 min; times
  out to a screensaver; the display **vanishes** from Roon's Displays list; only the TV remote wakes it; one user
  reproduced it on 3 cores × 3 casts × 3 networks.

Diagnosis: the **Core owns the display session** — a push model. The screen is a passive sink that Roon must keep alive.
When the session lapses (screensaver, cast sleep, a dropped socket) the screen has no authority to recover; a human
with the app or the remote has to start it again.

> ⚖️ **Thesis.** A Roon Display is something Roon does *to* a screen. A FlightDeck Face is something a screen does
> *for itself.* The screen owns its zone choice and its connection; the server holds no per-screen state; there is
> nothing to "start" and nothing to expire; every loss is rendered honestly and heals without a human.

## 2. The reliability contract — each line is a live receipt

| # | Invariant | Mechanism | Receipt (live, with denominator) |
|---|-----------|-----------|----------------------------------|
| R1 | The screen owns its zone | URL + `localStorage`; no app step ever | Power-cycle the TV → same Face returns, 5/5 |
| R2 | Liveness watchdog | SSE (`id`=revision, `snapshot/update/resync`, `Last-Event-ID`, `retry`) **plus a client-side 25 s no-frame watchdog** that closes and reopens the stream — `EventSource` never notices a half-open TCP socket, which *is* the "freezes after 20 min" symptom | Unplug the server's Ethernet 60 s mid-track → "catching up" ≤ 25 s → healed ≤ 5 s after replug, no reload, 3/3 |
| R3 | Core honesty | `core_unpaired`/`core_lost` → `core.state='away'`; Face dims to last-known + one quiet line; `core_paired` heals | Restart RoonServer → away → heals with correct now-playing, no reload |
| R4 | Smooth progress | 1 Hz batched `seek` frames + client `requestAnimationFrame` interpolation clamped to length; pause freezes on the next frame | No visible stutter over one album; pause halts within one frame |
| R5 | Artwork never breaks | Opaque same-origin relay, bounded, `immutable`-cached; `img.decode()` **before** swap (⚠️ guarded: `'decode' in HTMLImageElement.prototype ? img.decode() : onload` — Samsung 2019 lacks it); failure keeps previous art or a palette card | Block the Core's image port → art stays, no broken glyph |
| R6 | Stays awake | Screen Wake Lock when `isSecureContext`, else the muted looping-video keep-alive; re-acquire on `visibilitychange` | 2 h unattended with the TV screensaver enabled → still showing |
| R7 | Runs for weeks | Bounded DOM (nodes reused, never appended per tick); no retained per-tick allocations; server: per-IP cap, heartbeat pruning | 7-day soak: heap and server RSS flat (numbers recorded) |
| R8 | Instant cold start | Last snapshot cached in `localStorage` paints < 100 ms; live snapshot < 1 s on LAN | Reload → art visible before the stream opens |
| R9 | Nothing leaves the LAN | CSP `default-src 'none'` + nonces; same-origin assets; **self-hosted font** (TV browsers ship poor font sets) | DevTools network: zero third-party requests |
| R10 | Many screens | Each Face its own stream; one broadcast per change; 64 clients total | 6 screens live at once |
| R11 | Time-to-truth | Roon event → paint ≤ 300 ms on LAN, measured via `generatedAt` in the frame | Track change → paint ≤ 500 ms including art |

## 3. "Better looking" — the Zone Face

Roon's Display: art left, three lines, a progress bar, lyrics/queue, flat dark. Ours:

- **10-foot type.** Title `4.5vw` (~86 px at 1080p) with two media-query clamps (≤888px → 40px; ≥2134px → 96px);
  line 2 at 2.2vw; line 3 at 1.6vw and quieter. ⚠️ NOT `clamp()` — it is Chromium 79, above the floor.
  5% safe-area inset for overscan. Two-line wrap with ellipsis — no marquee.
- **Ambient backdrop from the art.** Downsample to 32×32 → median-cut → three tones → a slow radial wash behind the
  blurred, oversized art; accent and progress colour = dominant tone lifted to AA contrast. This is the **v0 of the
  image engine**: the same pipeline later grows the generative faces. (Same-origin relay ⇒ canvas is not tainted.)
- ⭐ **The blurred ARTIST is FREE — no Browse API needed.** 🔬 `now_playing.artist_image_keys: string[]` rides every
  zones frame (RoonServer's own trace, `evidence-archive/roon-arc-corrupt-media-20260803/roon-20260803-log04.txt`:
  **185 of 192** now-playing objects carry it; the 7 without were internet radio and all had a cover key). RHEOS has
  consumed it since 08-16 (`packages/v4/src/RoonHub.mjs:1326-1328`). Keys resolve on the same `/api/image/<key>`
  endpoint; native artist images are **1024×448 wide banners** (cover is 1024×1024). Wire contract gains
  `nowPlaying.artistArt: {path,key} | null`, minted by the same opaque relay.
  ⚠️ **UNDOCUMENTED and it vanished once** (build 880, Dec 2021, community thread 181800, no staff reply) → tolerate
  `undefined`/non-array/empty forever; a stale key 404 keeps the previous backdrop (R5).
  ⚠️ Which key is "the" artist is NOT inferable (3 names/4 keys; 5 names/3 keys) — RHEOS uses `[0]`; first capture
  must view them. Request backdrops at `scale=fit&width=1024&height=576` (native, ~50 KB), never 1920-wide (upscales).
  **Browse-by-name is NOT day 1** — flag-gated later, one dedicated `multi_session_key`, serialized, cache
  name→key with negative entries, never cache `item_key`s. Prior wiring to lift: archived
  `operator-roon-browse.ts:16-63` `sanitizeBrowseResult` (the live tree has no Browse — it was removed, not "never wired").
- **Composition by aspect.** Landscape: art 42% left, copy right. Portrait tablet: art top. Square: art centred.
- **Composer/artist subtly.** Roon's `three_line` carries it; line 2 secondary, line 3 tertiary.
- **Grouped zone:** member chips under the zone name (`Study · Kitchen · Garden`).
- **Header grammar:** **Face | Queue · current room · Group**. Face sits over the artwork it changes; the other
  three are one stable right-hand music-geography group. Each opens one viewport-owned panel immediately below
  its own trigger, so changing face cannot move the open menu into a transformed artwork or copy column.
- **Queue means forward, not history.** The current item is a read-only `now` row. A later row is an explicit
  play-from-here action carrying the exact zone, Core generation and queue revision the viewer just read; a stale
  window refuses the action and asks to be reopened.
- **State cues:** playing → progress moves · paused/stopped → the composition holds for the display's selected
  delay (15 min default; Immediate, 30 min, 1 h, 2 h and 4 h are available) → **Idle Face**.
- **Idle Face:** dim clock + slow gallery of recently played art from **our own ledger** (Roon's API has no history;
  FlightDeck sees every zone, so it can keep one — a feature Roon's own display lacks).
- **OLED care:** ±8 px composition shift every 5 min; idle luminance low.
- **Motion:** a witnessed finite-track change to genuinely different artwork may use Flip, Slide, Dissolve or Lift.
  **Tasteful Random** is the default and cannot choose the same actual effect twice in succession. A screen remembers
  an independent choice for each face (for example Dial = Flip, Canvas = Dissolve); **None** is also available. Every
  effect finishes inside the existing 760 ms receipt window, while the outer cover geometry and every progress ring
  remain still. Reconnects, room/view changes, live radio, same-cover tracks and artwork corrections settle directly.
  `prefers-reduced-motion` is honoured with a direct swap. Dark only, day 1.
- **Honest gap:** no lyrics — not in the Roon API. Goes in `KNOWN-LIMITATIONS.md`, not hidden.

## 3b. The face lineup (⚖️ tournament wf_886d6786-ecb + Peter 08-25: "These should be user selectable")

⚖️ **All five faces ship as user choices.** The ranking decides what loads FIRST, not what survives. Gallery artifact:
`claude.ai/code/artifact/451ce2cc-e537-4bda-99d2-ff2f166b4cfd`; mocks under the session scratchpad `faces/`.

| Face | `?face=` | Mean | Signature |
|------|----------|------|-----------|
| **Presence** (default) | `presence` | 9.0 | Blurred ARTIST behind an untouched centred cover, recoloured to the cover's tones; progress = **the Approach** (runway lamps, count ≈ track length) |
| Dial | `dial` | 7.7 | SVG ring instrument on the copy side; remaining time large + **ENDS hh:mm**; idle turns the same dial into a clock |
| Classic-Plus | `classic` | 7.7 | Roon's grammar done properly; largest cover; the I2 side-by-side CONTROL |
| Ambient Canvas | `canvas` | 6.7 | Generative bokeh field from the cover's palette; tide-line progress with per-minute ticks |
| Libretto | `libretto` | 5.7 | Concert-programme typography; for reading a programme, not watching a record |

**How a face is chosen** (design, lands in I2 — the increment that first has more than one):
- `?face=` in the URL always WINS — the durable, pinnable, hand-off form.
- Otherwise the screen remembers, per screen AND per zone, beside the zone choice itself (R1's mechanism, no new
  server state, nothing to expire).
- On a TV: any key/tap/pointer raises a quiet auto-hiding strip naming the current face; **arrow keys cycle** (TV
  remotes send arrows + Enter). Its face panel also carries that face's remembered cover-transition choice. The strip
  NEVER covers the cover.
- The Wall offers "open as…" per zone — how a phone sets up the TV it is standing next to.
- ⚖️ Receipt: choose a face on the TV, pull the power, it returns as chosen.

**Grafts — shared furniture, not spoils for the winner** (each goes into every face it fits):
idle-becomes-clock + `ENDS hh:mm` (Dial) · one ruler tick per minute of the piece (Canvas) · non-breaking hints so
`Op. 18` / `K. 364` / `C Minor` never split + the 3-line line-2 clamp (Classic-Plus) · nowrap performer spans so line 2
wraps only BETWEEN names + tiered title fit (Libretto) · recency stamps (Wall) · Presence's t0 paint ladder.

⚖️ **THE COVER IS SACRED — this is a CODE rule, not a note.** Two entries violated it in CSS while claiming they did
not (`classic` dimmed the container holding the cover in core-away; `canvas` tinted it when stopped). Both fixed.
**Never** put opacity/filter/transform/mask on the cover or on any ANCESTOR of it — dim the copy elements by name.
A `node:test` asserts no shipped stylesheet targets a cover ancestor with those properties.

## 4. The House Wall

A grid of zone tiles ordered by **most recently played** (⚖️ Peter 08-25) — the top-left tile is the zone that last had
activity, from FlightDeck's own per-zone last-activity ledger (which therefore lands in I1, not I4). State shows as
size/luminance, never as re-ordering: playing tiles large and bright, paused dimmer, stopped smallest.
Tile = art, title, artist, hairline progress, member chips; tap → that Zone Face. Same stream as the Faces. This is the
kitchen-tablet page — the verdict's ambient-house hypothesis — now for every zone including Roon Ready.

## 5. The spine

**Repo:** **FlightDeck** (⚖️ Peter 08-25; location `~/dev/FlightDeck` suggested). **Stack:** Node 24 native TypeScript, ESM, `node:test` —
the rheos_v2 muscle memory, zero build step. **Deps:** `node-roon-api`, `-transport`, `-image` (Apache-2.0 — compatible
with any FlightDeck licence). **Front end:** vanilla ES modules served as same-origin static assets; no framework day 1 — revisit at the control
surface. ⚠️ **ES2018, not ES2020** — no `?.`, `??`, class fields or named regex groups (Samsung 2019 = Chromium 63).
Guardrail: a `node:test` parses every shipped asset with acorn at `ecmaVersion: 2018`.

```
TV / tablet / phone            FlightDeck (Node 24, :80→:8440)             Roon Core
┌──────────────┐   SSE        ┌─────────────────────────────┐   WS (paired)   ┌──────────┐
│ face.js      │◄─────────────│ http/events  ◄── model/snapshot◄── roon/extension│ subscribe│
│ wall.js      │  /snapshot   │ http/server                 │                 │ _zones   │
│ store+stream │◄─────────────│ art/relay ────────────────────────────────────►│ /api/image│
└──────────────┘  /art/<tok>  └─────────────────────────────┘                 └──────────┘
```

Modules:

- `src/roon/extension.ts` — registers `{ extension_id: 'linvale.FlightDeck', display_name: 'FlightDeck',
  publisher: 'Linvale' }` (⚖️ Peter 08-25 — exact strings); `core_paired`/`core_unpaired`; `subscribe_zones`; `get_persisted_state`/`set_persisted_state`
  → `${DATA_DIR}/roon-state.json` (the library's default writes `config.json` into **cwd** — never rely on it).
  Core address for images = `core.moo.transport.host` + `core.registration.http_port` (the RHEOS pattern,
  `packages/v4/src/RoonHub.mjs:300-305`), never hardcoded.
- `src/model/snapshot.ts` — projects Roon zones into the **FlightDeck snapshot** (the wire contract; Faces never see
  Roon's shape). Revision bumps on structural change only.
- `src/http/server.ts` — one `node:http` handler; the same handler mounts on `node:https` when `DATA_DIR` holds a cert
  (I3). **Port ladder: `listen(80)` → on EACCES/EADDRINUSE `listen(8440)`** (RHEOS holds 8420/8421/61982/61001–63048
  — no collision). Only :80 satisfies "by name, not port": a browser given a bare name always means :80.
- `src/net/mdns.ts` — ⚖️ **a built-in zero-dependency mDNS/DNS-SD responder** (`node:dgram`, ~250 lines + `node:test`
  on captured packets) claiming `flightdeck.local` (A = the address of the interface the query ARRIVED on — never
  docker0/veth/link-local) and `FlightDeck._http._tcp.local` (PTR/SRV/TXT carrying the ACTUAL port). RFC 6762
  minimums: probe ×3 at 250 ms, rename on conflict (`flightdeck-2.local`), announce ×2, unicast reply on the QU bit,
  ≥1 s per-record rate limit, goodbye TTL 0 on SIGTERM, drop off-link sources. `reuseAddr:true` + `addMembership` per
  IPv4 interface, TTL 255, loopback on — it **coexists with host avahi** (Chrome and avahi already share 5353 here).
  Rejected: delegating to avahi (absent in containers/NAS images) and npm (`multicast-dns` last released 2022).
- `src/http/events.ts` — SSE hub: `snapshot|update|resync` with `id`=revision; `Last-Event-ID` (previous+1 → `update`;
  gap → `resync`); `retry: 3000`; named heartbeat every 10 s; per-IP cap; 64 total. Plus the 1 Hz batched `seek` frame.
- `src/art/relay.ts` — HMAC token per run; two sizes (`640` faces, `320` tiles); 1 MiB cap; LRU 96 × 30 min;
  4 concurrent; 6 s timeout; `Cache-Control: private, max-age=86400, immutable`.
- `src/ledger/recent.ts` — ring of `(zone, track, art, at)` from now-playing transitions; memory → JSON in I4.
- `src/main.ts` — `FLIGHTDECK_PORT` (default: the 80→8440 ladder), `FLIGHTDECK_DATA=./data`; `/api/v1/health` for the soak.

⚖️ **The name needs a fallback and it is NOT optional.** `.local` does **not** resolve on Fire OS / Echo Show /
Android ≤ 11 (incl. Nvidia Shield), and is **unverified on Samsung Tizen and LG webOS** — i.e. exactly the TV class the
Zone Face targets. It DOES work on Windows 10 1903+/11, Apple, Android 12+ (Chromecast w/ Google TV), Linux+nss-mdns.
So: ① the Wall and every Face footer print the IP URL **and a same-origin QR** (inline SVG, no library); ② the
extension's startup log prints both URLs; ③ `/api/v1/health` returns `{urls, port, mdns:{name, probed|renamed}}`;
④ docs describe the router-DNS route (DHCP hostname `flightdeck`, or a static entry) as the way to get a name on EVERY
TV. Roon's own Display is reached by IP, so an IP path for TVs is parity, not a regression.
⚖️ Binding :80 unprivileged — systemd `AmbientCapabilities=CAP_NET_BIND_SERVICE` (+`CapabilityBoundingSet`,
`NoNewPrivileges=yes`); container = root on host network, or `setcap` on the image's node binary. NEVER require the
host sysctl. Bridge networking is a non-starter for mDNS (multicast does not cross it).

Routes: `GET /` (Wall) · `GET /face/:zoneId` (+`?face=`) · `GET /api/v1/snapshot` · `GET /api/v1/events` (SSE) ·
`GET /api/v1/art/:token?s=640|320` · `GET /assets/*` (hashed, immutable) · `GET /api/v1/health`.

**Wire contract — the snapshot:**

```json
{
  "revision": 412,
  "generatedAt": "2026-08-25T09:41:02.113Z",
  "core": { "state": "paired", "name": "ROCK", "sinceAt": "2026-08-25T07:02:11.000Z" },
  "zones": [{
    "id": "1601…", "name": "Study", "state": "playing",
    "outputs": [{ "id": "1701…", "name": "Study" }],
    "nowPlaying": {
      "title": "Sinfonia Concertante in E-flat, K. 364",
      "line2": "Mozart · Rachel Podger, Pavlo Beznosiuk",
      "line3": "Mozart: Sinfonia Concertante",
      "art": { "path": "/api/v1/art/9QfR…", "key": "a1b2…" },
      "lengthSec": 1834,
      "seek": { "positionSec": 512, "at": "2026-08-25T09:41:02.113Z" }
    },
    "allowed": { "play": false, "pause": true, "next": true, "previous": true, "seek": true },
    "changedAt": "2026-08-25T09:32:48.902Z"
  }]
}
```

**SSE frames:** `snapshot` (full) · `update` (full, revision+1) · `resync` (`{reason, fromRevision, toRevision,
snapshot}`) · `seek` (`{revision, at, zones: [{id, positionSec}]}`) — once per second, **playing zones only**, no
revision bump; a client whose revision mismatches ignores it and waits for the next `update`/`resync`.

Why full snapshots, not diffs: 18 zones ≈ 6 KB; structural changes are a few per minute; diffs buy nothing and cost a
whole merge-bug class. Seek is the only chatty thing, and it is its own 1 Hz frame.

**Client (`assets/`):** `store.js` (snapshot + revision; applies update/resync/seek; persists last snapshot) ·
`stream.js` (EventSource + 25 s watchdog + 1→8 s backoff + `/snapshot` fetch when resume is impossible) ·
`face.js` / `wall.js` (render from store; rAF progress; palette in a Worker/OffscreenCanvas where available) ·
`keepawake.js` (wake lock / muted video).

**Auth, day 1:** none. Faces are read-only and LAN-only — the same exposure as Roon's own display page (now-playing
metadata + art). The handover's PIN/auth question belongs to the control increment.

**HTTPS:** the handler is transport-agnostic from day 0; the HTTPS listener + self-signed cert generation ships in I3
for tablets (mic-VU and Wake Lock need a secure context). **TVs stay on HTTP** — a cert warning on a TV browser is a
worse reliability story than plain HTTP on a trusted LAN.

## 5b. The capability floor (⚖️ scout-verified — vendor engine tables + caniuse/MDN parsed locally)

⚖️ **Floor = Chromium 63** (Samsung 2019+, LG 2020+) **and iPadOS Safari 15**. LG 2018–19 (webOS 4.x = Chromium 53) is
**best-effort only** — supporting it costs CSS grid, ES modules and async/await, i.e. a transpiled bundle and the end of
the zero-build spine. ⚠️ OPEN FOR PETER: is there a 2019 LG in the house? If not, this never costs us anything.

Engine bands: Samsung Tizen 5.0/2019=**M63** · 5.5=M69 · 6.0=M76 · 6.5=M85 · 7.0=M94 · 8.0=M108 · 9.0=M120 (frozen at
manufacture, never updated). LG webOS 4.x=M53 · 5.x/2020=**M68** · 6.x=M79 · 22=M87 · 23=M94 · 24=M108. Fire TV Silk =
CURRENT Chromium (OTA). Android TV has **no Chrome** — the practical hosts are TV Bro / Fully Kiosk (system WebView).

| Want | Floor-safe? | Ship this instead |
|------|-------------|-------------------|
| Progress ring | `conic-gradient` is M69 | **SVG `stroke-dasharray`/`dashoffset`** — universal (M53/Safari 9), animatable, round caps, no mask |
| Blur | `backdrop-filter` M76 & costly | tiny PNG (`?s=32`) or a 32×32 canvas → `filter: blur(2–3px)` **at that size** → `transform: scale()` up. Blurs ~2k px, not 2M — the difference between smooth and stuttering on a 2019 SoC |
| Fluid type | `clamp()` M79 | `vw` + two media-query clamps |
| Layout sizing | container queries M105 | **viewport units** — a Face IS the viewport, so `cqw` buys nothing; Wall tiles via `repeat(auto-fill, minmax())` |
| Square art | `aspect-ratio` M88 | `vw`/padding-top |
| Art swap | `img.decode()` M64 | `'decode' in HTMLImageElement.prototype ? decode() : onload` |
| Palette work | `OffscreenCanvas` M69 | 32×32 on the main thread (~1k px — a Worker was never worth it) |
| Gaps | flex `gap` M84 | grid `grid-gap`, or margins |
| Syntax | `?.`/`??` M80 | ES2018, acorn-guarded |

⚠️ **R6 (stays awake) is partly DEVICE SETUP, not code — say so honestly.** `navigator.wakeLock` needs a secure context
(so HTTPS/I3) and **hangs rather than rejects on webOS** → race it against a 5 s timeout. LG's screensaver is documented
to fire even over video; Samsung's Auto Power Off kills the set after 4 h and firmware updates re-enable it; Silk on
Fire TV is reported not to autoplay video at all. So `docs/tv-drill.md` carries per-device setup steps with their own
receipts (Samsung: Auto Power Off → Off, Hide Tabs and Menu Bar; LG: Always Show Address Bar → Off; Fire/Android TV:
**Fully Kiosk, not Silk**; iPad: Guided Access + Auto-Lock Never) — and **expect the 2 h receipt to FAIL on LG in the
bare browser; record that honestly.** ⚠️ **Echo Show: WORKS (08-25, kitchen Show, Silk, touch).** The earlier ruling was wrong. Silk is still reported to exit to home after 10–15 min idle and
Amazon states the timeout cannot be disabled. Later, if boot-launch matters: thin Tizen `.wgt` / webOS `.ipk` hosted-web
shells are the only real route (that is what signage vendors do).

## 6. Increment ladder — the transport-arc ritual (one live receipt each, commit per confirm)

| Inc | Build | Live receipt | Explicitly NOT in it |
|-----|-------|--------------|----------------------|
| **I0** Bootstrap & pair | Repo, `package.json`, extension registers and pairs, persisted state in `DATA_DIR`, logs every zone | Appears in Roon **Settings → Extensions** as *FlightDeck*; enable; log lists all zones (18 expected) | Any HTTP |
| **I1** Spine + House Wall + name | Snapshot model, SSE hub, art relay, `/`, **the last-played ledger** (the Wall's order needs it), **mDNS responder + 80→8440 ladder**, IP+QR footer | Lounge TV shows every zone with art, ordered most-recent-first; play/pause in Roon → tile ≤ 1 s; **Ethernet pull 60 s → "catching up" → heals, no reload** (R2); **name receipt: `getent hosts flightdeck.local` + iPhone + a Windows laptop + one Android-12 TV, 4 clients each recorded pass/fail, plus a two-instance start to see the `flightdeck-2` rename** | Zone Face, any polish |
| **I2** The faces + the picker | **Presence** (default) then Dial / Classic-Plus / Canvas / Libretto; the artist backdrop (`artist_image_keys`); the grafts; **the face picker** (`?face=`, per-screen+zone memory, arrow-key cycling) | **Side-by-side with `http://<core>:9330/display` on the same TV for one album** — record what each does, honestly; track change → paint ≤ 500 ms; 2 h unattended with the screensaver on (R6, expect an LG failure); **pick a face, pull the power, it returns as chosen**; **Peter sees the artist layer with a REAL Roon banner and rules on the gradient-map strength** | Idle Face, PWA, HTTPS |
| **I3** Endurance & kiosk | Watchdog tuning, cold-start cache, pixel shift, PWA manifest, HTTPS listener + cert (443→8443), docker/systemd unit (`AmbientCapabilities`), `/health` | 48 h on the TV + **7-day soak with heap/RSS numbers** (R7); 6 screens (R10) | Idle Face, ledger persistence |
| **I4** Idle & Recent | Idle Face (+ Dial's idle-clock), the ledger persisted to JSON + the recent-art gallery, `?follow=1` (the Face follows whichever zone is playing) | Stop the zone → Idle ≤ 2 min; recent list matches the day's Roon history | Control, browse |

**Later, on this spine (not this design):** the Roon-led control surface (`allowed` flags already on the wire) ·
drag-and-drop grouping (⚖️ ONE `ungroup_outputs` carrying every departing output, then ONE Roon-led Play) ·
browse/search/genre via `RoonApiBrowse` (`multi_session_key` per screen) · mic-VU on tablets · generative faces ·
a RheoStat hand-off link (never an iframe — `frame-ancestors 'none'`).

## 7. Tests

- **Capture first** (the standing rule): `scripts/capture-zones.ts` records raw `subscribe_zones` frames from Peter's
  Core into `test/fixtures/` — grouped zones, a loading state, a zone with no `image_key`, a RHEOS 🔗 virtual. The
  projection tests run on those, not on imagined shapes. ⚖️ The FIRST capture must also settle, verbatim:
  (i) does the initial `Subscribed` payload carry `artist_image_keys`, or only `Changed` frames (a cold-start Face
  otherwise waits for the first change); (ii) which SOURCES carry it — local vs Qobuz/Tidal vs Roon Radio vs internet
  radio; (iii) `line2` names vs key count/order on a classical and a multi-performer jazz track — **view each key** to
  learn whether `[0]` is the performer or the composer.
- **Cover-sacred lint:** a `node:test` that fails if any shipped stylesheet applies opacity/filter/transform/mask to the
  cover element **or any ancestor of it**. Two tournament entries broke this while claiming they had not.
- **Floor lint:** acorn-parse every shipped asset at `ecmaVersion: 2018`; grep the CSS for `clamp(`, `cqw`,
  `conic-gradient`, `backdrop-filter`, `aspect-ratio`, flex `gap`.
- **Unit:** snapshot projection · SSE hub revision/resync semantics (port the console's test shapes) · relay caps ·
  seek interpolation (clamp, pause, tick snap).
- **Live drills:** `docs/tv-drill.md` — the receipts above as a checklist with denominators, filled in per increment.

## 8. Open for Peter — none block I0/I1

1. ~~Repo name~~ → ⚖️ **FlightDeck**; location/visibility/**licence** still open.
2. ~~Port~~ → ⚖️ **80 → 8440 ladder**, name via built-in mDNS + router-DNS fallback.
3. ~~Wall ordering~~ → ⚖️ **most recently played**.
4. ~~Identity strings~~ → ⚖️ `linvale.FlightDeck`, publisher *Linvale*.
5. ~~Faces~~ → ⚖️ **all five user-selectable**, Presence default.

**Still open (none block I0/I1):**
- **The artist layer needs Peter's eye on a REAL Roon banner** (I2) — in the mock the presence is faint enough that the
  no-artist fallback looks nearly identical. If he wants the artist to keep more of its own colour, the gradient map is
  one number.
- **Cover size**: Presence runs 25cqw, Classic-Plus 42cqw. His TV decides.
- **Is there a 2019 LG in the house?** (decides whether the Chromium 53 floor costs us the zero-build spine.)
- FlightDeck's licence.
**Tournament wf_886d6786-ecb: COMPLETE** (scouts + 6 designs + 1 agent judge; the other 2 lenses and the synthesis were
run inline after the run hit the account's monthly spend limit). Gallery:
`claude.ai/code/artifact/451ce2cc-e537-4bda-99d2-ff2f166b4cfd`. Mocks + 1080p renders: session scratchpad `faces/`.

## 9. Volume limits — Roon's two, the same on every face (⚖️ Peter 2026-09-05 · 09-06)

Roon keeps **two limits per output** in its own zone settings and reports both on
the transport wire: `soft_limit` is the **comfort level** (Roon's own app stops
there and asks before going on) and `hard_limit_max` is the **safety level**
(nothing goes past it). Measured on the Core: `min 0, max 100, soft_limit 100,
hard_limit_max 100` when neither is set. FlightDeck builds **no limit of its
own** — it carries Roon's as `softLimit` and `hardLimitMax` — and **set them in
Roon when a zone is first enabled**: that is the one place they live.

One reading of them, on every face (`assets/volume-limits.js`, mirrored by
`src/model/volume-limits.ts` and kept in step by test):

- **The scale is drawn to the top**, whatever the limits: plain up to comfort,
  **amber** (`#c9902e`) from comfort to safety, **red** (`rgb(232,84,70)`)
  beyond — on the Wall's rule, the Face's rail, the phone's scale, the puck's
  bezel of a hundred ticks alike. (09-05 hid the puck's ticks past comfort;
  09-06 supersedes that: hidden ticks said nothing about *where* the limit was.)
- **A drag, a turn, a press or a step goes up to comfort and stops there.**
- **A second press inside 700ms on the same control passes comfort** — the
  request carries `override: true` — up to safety.
- **Nothing passes safety.** A press there is not sent; the room does not
  respond, and the face says why.
- **The deck holds every hand to the same rule** (`/api/v1/control`): a level
  above comfort without `override` is held to comfort and the reply says
  `held: 'comfort'`; a level above safety is refused (`409`, `code: 'safety'`);
  steps are cut to reach comfort (or safety, with `override`) and a press with
  no room to move sends nothing to the Core. A group move holds each room to
  **its own** limits rather than carrying one room past them to satisfy the
  average.

## Sources (Roon Display facts)

- https://community.roonlabs.com/t/using-web-display-with-roon/52106
- https://community.roonlabs.com/t/port-change-for-roon-display/191382
- https://darko.audio/2018/09/roon-comes-to-the-big-screen/
- https://community.roonlabs.com/t/display-via-chromecast-freezes-disconnects/110725
- https://community.roonlabs.com/t/roon-display-disconnect/230951
- https://community.roonlabs.com/t/chromecast-with-google-tv-display-times-out/177679
- https://community.roonlabs.com/t/google-chromecast-display-vanished/223463
- https://community.roonlabs.com/t/roon-display-times-out-to-screensaver-on-google-chromecast-tv-fixed-in-roon-build-1272/233991
