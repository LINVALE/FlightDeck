# FlightDeck

Display and control faces for **every Roon zone** — a Roon add-in, not a RHEOS feature.

FlightDeck pairs with your Roon Core as an ordinary extension and subscribes to zones, which is core-wide.
That means it serves RHEOS rooms and Roon Ready rooms alike, and needs nothing from RHEOS.

- **Zone Face** `/face/<zoneId>` — a 10-foot now-playing screen for a TV, tablet or phone.
- **House Wall** `/` — every zone at a glance, ordered by **most recently played**.

*FlightDeck is not affiliated with or certified by Roon Labs. "for Roon" is descriptive only.*

## Why it exists

Roon's own Display is a **push** model: the Core owns the display session, the app starts it onto a zone, and
when the session lapses the screen has no authority to recover. The community record is consistent — it
freezes after 10–20 minutes, times out to a screensaver, vanishes from the Displays list, and needs a human
with a remote.

> A Roon Display is something Roon does **to** a screen.
> A FlightDeck Face is something a screen does **for itself**.

The screen owns its zone and its face (URL + local memory); the server holds no per-screen state; nothing to
start and nothing to expire. A client-side 25-second no-frame watchdog closes and reopens the stream, because
`EventSource` never notices a half-open TCP socket — which *is* the "freezes after 20 minutes" symptom.

## Run it

```bash
npm install          # see "node_modules" below
npm start
```

Then enable **FlightDeck** in Roon → Settings → Extensions. The log prints every URL to reach it.

| Env | Default | Meaning |
|-----|---------|---------|
| `FLIGHTDECK_PORT` | `80`, falling back to `8440` | Only `:80` satisfies "reachable by name" |
| `FLIGHTDECK_DATA` | `./data` | Roon pairing state and the last-played ledger |
| `FLIGHTDECK_NAME` | `flightdeck` | Published as `flightdeck.local` |

## Reaching it by name

FlightDeck runs its own zero-dependency mDNS/DNS-SD responder and claims `flightdeck.local`. It coexists with
a host `avahi`.

### If another device cannot find `flightdeck.local`

Diagnose the publishing side first — this asks the way a TV or phone does, from an
ephemeral port, rather than through this host's own resolver (which can succeed
while a remote query fails):

```bash
node scripts/mdns-probe.mjs flightdeck.local
```

An answer of `flightdeck.local -> <the LAN IP>` means FlightDeck is publishing
correctly and the *other* device is not doing mDNS lookups. That is common:
Windows with mDNS restricted by policy, Linux without `nss-mdns`, and every TV
listed below.

**The fix that reaches everything is a router DNS record.** This LAN already
serves unicast names for its hosts (`asus-study.localdomain -> 192.168.1.114`
via 192.168.1.1), so adding `flightdeck -> <the LAN IP>` makes
**`http://flightdeck/`** work on Tizen, webOS, Fire TV, Windows-under-policy and
everything else, with no mDNS involved at all. In UniFi: Settings → Networks →
DNS → add a local DNS record.

⚠️ **`.local` is not universal, so the IP is always printed too.** It resolves on Windows 10 1903+/11, Apple
devices, Android 12+ (including Chromecast with Google TV) and Linux with nss-mdns. It does **not** resolve on
Fire OS / Echo Show / Android ≤ 11 (including Nvidia Shield), and is unverified on Samsung Tizen and LG webOS
— exactly the TV class a Zone Face targets. The House Wall therefore prints the IP URL and a QR code, and
`/api/v1/health` reports the claimed name. For a name on *every* TV, give the host a DHCP hostname of
`flightdeck` or a static entry on the router.

Binding `:80` unprivileged: systemd `AmbientCapabilities=CAP_NET_BIND_SERVICE`, or root in a host-network
container. Never require the host-wide sysctl. Bridge networking cannot carry mDNS at all.

## On a TV

Samsung, LG and Fire TV each need a slightly different setup, and one shared trick:
make the address short with a router DNS record so it is typeable on a remote.
Step-by-step per platform, including why no native app exists: **`docs/tv-setup.md`**.

## Faces

All five are **user-selectable** — the ranking below decides what loads first, not what survives.

| Face | `?face=` | Signature |
|------|----------|-----------|
| **Presence** (default) | `presence` | Blurred artist behind an untouched cover; progress is a runway of approach lamps |
| Dial | `dial` | A ring instrument opposite the cover; remaining time and `ENDS hh:mm`; idle becomes a clock |
| Classic-Plus | `classic` | Roon's grammar done properly; the largest cover |
| Ambient Canvas | `canvas` | A generative field in the cover's own colours |
| Libretto | `libretto` | Concert-programme typography |

`?face=` always wins; otherwise the screen remembers per zone. On a TV, arrow keys cycle faces.

**⚖️ The cover is sacred.** No crop, tint, overlay, filter, transform or mask — on the cover *or any ancestor
of it*. State lives in the copy around it. `npm run lint:floor` enforces this; two entries in the design
tournament broke it while claiming they had not.

## Browser floor

Chromium 63 (Samsung 2019+, LG 2020+) and iPadOS Safari 15. That rules out `clamp()`, container queries,
`aspect-ratio`, `conic-gradient`, `backdrop-filter`, flex `gap`, `?.` and `??`. `npm run lint:floor` checks
every shipped asset. The progress ring is SVG `stroke-dashoffset`; blur is a tiny canvas scaled up.

## Development

```bash
npm test              # projection, SSE semantics, end-to-end HTTP
npm run lint:floor    # browser floor + cover-sacred
node scripts/preview.ts   # the real server on fixtures — no Roon pairing needed
```

`node_modules` is currently a symlink to the RHEOS tree for the three Roon packages
(`node-roon-api`, `-transport`, `-image`, all Apache-2.0). A real `npm install` is owed before this repo
stands alone.

## Status

I0 (pair) and I1 (spine, Wall, name) are built and tested offline; the Presence face is built. **No live Roon
pairing has been run yet** — that is the first receipt to take. See `docs/tv-drill.md`.

## Licence

**FSL-1.1-MIT** — Functional Source License 1.1, MIT Future License. Copyright 2026 Peter Richardson.
Full text in [`LICENSE`](LICENSE); the same licence RHEOS carries, deliberately, so code moves freely between
the two repositories.

FSL is a **Fair Source / source-available** licence — **not** an open-source one. The source is published and
you may read it, run it, and modify it for your own use: internal use and access is an express permitted
purpose, which covers everything a home user or tester actually does. What it withholds is competing
commercial use — you may not sell it or build a competing commercial product on it. That restriction is
time-limited, not permanent: **each version converts to MIT two years after its release**, at which point it
becomes open source in the ordinary sense.

### Money and code

**Optional donations.** FlightDeck is free and stays free. If it earns a place on your screen you may support
the work, entirely at your discretion. A donation funds development — it does not purchase support, a warranty,
a feature, or any priority. The licence disclaims warranty and there is no support undertaking.

**We are not currently accepting code contributions.** Bug reports, logs and hardware observations are very
welcome and genuinely useful. Patches and pull requests are not being accepted at this time, so that copyright
in the work stays with a single holder.

### Third-party

- **Lucide** (ISC) — genre and category icons, vendored into `assets/icons/`. See
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
- **`node-roon-api`, `-transport`, `-image`** (Apache-2.0) — runtime dependencies, not vendored. Their licence
  texts ship with any distributed bundle.

*FlightDeck is not affiliated with or certified by Roon Labs.*

## Browser support

FlightDeck targets **recent smart-TV browsers**. A TV whose built-in browser is too old is served by a **Fire TV
stick or Roku**, not by a compatibility layer — transpiling and polyfilling the client is explicitly out of scope
(ruling, 2026-08-30).

The client uses template literals, `class`, spread, optional chaining, `fetch()` and `EventSource`. On a browser
that predates those the script fails at **parse**, so the page paints its shell and sits on "connecting…" forever.
**A stuck "connecting…" on an old TV is a SyntaxError, not a network or API fault** — don't debug it as one.
Measured case: Samsung built-in browser, `Copyright 2010`, `BIN_B:170210_1.1.527`.

`/now` is not a lighter page — `/now`, `/face` and `/face/` all route to the same `renderFacePage`.
