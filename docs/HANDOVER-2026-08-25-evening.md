# HANDOVER — 2026-08-25 evening (FlightDeck)

**Read first:** `docs/DESIGN-faces.md` (the design + tournament verdict), then this.
Peter stopped for the day here: *"good progress - this will be fabulous."*

## Where it is running

`flightdeck.service` is **installed and enabled** (`systemctl enable --now flightdeck`), binding **:80**
via `AmbientCapabilities=CAP_NET_BIND_SERVICE` as user `peter`.

- `http://flightdeck.local/` and `http://192.168.1.114/` — both bare, no port
- Paired with **Nucleus Titan** (192.168.1.33), **22 zones** live
- Logs: `~/dev/FlightDeck/logs/flightdeck.log` or `journalctl -u flightdeck -f`
- It comes back on boot. Nothing to do after a restart.

⚠️ **Two things need `sudo`, which the assistant does not have:**
- `sudo systemctl restart flightdeck` — required after ANY change under `src/`.
  Changes under `assets/` are served from disk: a browser refresh is enough.
- Updating `ExecStart` after a node upgrade (the nvm path carries the version).

⚠️ **Never run `flightdeck-launch.sh` while the service is up.** It now REFUSES to
(commit below), after a VSCode task started a second copy on `:8440` beside the service on `:80` — both
registered with Roon under the same `extension_id`. Use the *"FlightDeck: Restart service (sudo)"* task.

## What exists (HEAD 7d6f3f1)

I0, I1 and the Presence face, all live-proven against the real Core:

- **House Wall** `/` — 22 zones ordered most-recently-played, real art, quiet-since rail, IP + QR footer
- **Zone Face** `/face/<zoneId>` — Presence: untouched cover, blurred-artist backdrop tinted to the
  cover's palette, runway lamps, `ENDS hh:mm`
- **The artwork cycle** (press OK / tap the cover): artist blur → album blur → **album forward** →
  each artist sharp → back
- Snapshot/SSE spine with the 25 s client watchdog, opaque art relay, mDNS responder, the ledger
- 28/28 tests, floor lint clean (Chromium 63 floor + cover-sacred)

## ⚖️ Rulings settled today — do not reopen

- Repo **FlightDeck**; identity `linvale.FlightDeck`, publisher `Linvale`
- Reachable **by name** → mDNS + the 80→8440 ladder; `.local` fallbacks are mandatory
- Wall ordered by **most recently played**
- **The cover is SACRED** — no crop/tint/filter/transform/mask on it *or any ancestor*. Only its SIZE
  may change. `scripts/floor-lint.ts` enforces it; two tournament entries broke it while claiming not to.
- **All five faces are user-selectable**, Presence default (Peter: *"These should be user selectable
  they are amazing!"*)

## The tournament

`wf_886d6786-ecb` — 3 scouts, 6 designs, 1 judge, then it **hit the account's monthly spend limit**;
the other two lenses and the synthesis were run inline. Gallery (all six mocks live):
`claude.ai/code/artifact/451ce2cc-e537-4bda-99d2-ff2f166b4cfd`.
Mocks + 1080p renders are in the session scratchpad `faces/` — **not copied into this repo**; recover
them from the artifact if they are wanted.

Scout findings worth citing rather than re-deriving are in `docs/DESIGN-faces.md` §3, §5b.

## ⚠️ NOT proven — the honest list

- **The QR has never been scanned by a phone.** Hand-written encoder, no decoder available offline.
- **The mDNS responder has never been checked from another device** — it answers on this host, but the
  4-client name receipt in `tv-drill.md` has not been taken.
- **No TV has ever displayed a Face.** Every render so far is headless Chrome at 1920x1080. The whole
  10-foot premise — legibility, the 2 h screensaver test, the side-by-side against Roon's own Display —
  is untested on real hardware.
- Four of the five faces (Dial, Classic-Plus, Canvas, Libretto) exist only as tournament mocks; the
  picker cycles names but only **Presence** is implemented.

## Next, in order

1. **Take the I2 receipts on a real TV** — the side-by-side against `http://<core>:9330/display`, and
   Peter's ruling on the artist backdrop with a real Roon banner (the gradient-map strength is one number).
2. Scan the QR with a phone; take the 4-client name receipt.
3. Build the remaining four faces behind the picker that already exists.
4. Ambient Canvas owes a frame-rate number from a 2019-era TV before it is offered there.
