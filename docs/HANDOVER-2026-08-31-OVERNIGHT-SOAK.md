# FlightDeck overnight soak handover — 2026-08-31

## Confirmed observations

- The two-sided sleeve flip is visibly working on the live display after a page refresh. The progress ring remains
  stationary. Same-cover music and live radio still settle directly.
- The reported seek stall was a real downstream divergence, not a frozen FlightDeck page or service. Study received
  valid seeks to 10s and 201s only 520ms apart. RHEOS claimed the first target while Roon retained the second cursor.
  Roon then advanced while the physical RHEOS session retained the previous qid for about 26 seconds.
- Primary evidence: `/home/peter/dev/rheos-proxy/logs/rheos-v2-20260830-214638.log`:
  - lines 11259-11268: 10s then 201s; the 10s target is claimed;
  - lines 11271-11289: physical re-pour and progress from 10s;
  - lines 11295-11325: Roon and physical-session identities disagree;
  - lines 11326-11358: later near-end attach, socket close and ingest-stall warning;
  - lines 11359-11373: tail handling finally advances to Blackbird.
- The client now treats a burst of seeks as one trailing latest intent: 700ms quiet edge, at most one unanswered
  request, then a 2500ms settlement rail. The exact live 10s -> 201s / 520ms shape is a regression test.
- Face, ring and phone also clamp the far edge to the greatest whole second strictly inside the track. The HTTP server
  has the same defensive clamp on disk.
- The cover repertoire is now implemented on disk. **Tasteful Random** is the default and chooses Flip, Slide,
  Dissolve or Lift without immediately repeating the last actual effect on that face. Each face remembers its own
  choice in this browser; None is explicit. Pointer and D-pad focus retain one face-qualified semantic identity.
- Only the replaceable inner sleeve planes move. Slide and Lift are clipped inside the artwork; Dissolve fades only
  the incoming art over the one stationary old shadow. The outer cover and Dial/Orbit/Rondo progress ring have no
  effect selector. Reduced motion settles directly.
- Verification: `npm test` = 227 pass / 0 fail; `npm run lint:floor` clean for 15 assets at the Chromium 63 floor;
  browser syntax and `git diff --check` clean. The complete HTTP suite needs normal loopback permission: the
  restricted command sandbox refused its four listener-owning files, while the same exact aggregate gate passed
  227/227 outside that sandbox. `npm run typecheck` could not run because this checkout has no local `tsc`;
  dependencies were deliberately not installed during the soak.
- The live service remains healthy on ports 80 and 8440 with six clients. It was deliberately not restarted.
  Browser assets are served directly from the tree, so a page refresh loads the client seek gate.

## Refuted hypotheses

- The missing flip was not simply too fast: the original transition gate lost evidence across Roon loading/revision
  frames, and legacy Fire TV needed an explicit transformed front plane.
- The seek episode was not caused by the cover transition.
- Seeking near the end was not the complete cause: both failed targets (10 and 201 of 217 seconds) were valid. The
  causal trigger was the overlapping 520ms seek pair; proximity to the end merely made the divergence surface quickly.
- FlightDeck itself did not die: its HTTP/SSE plane remained responsive and later playback positions advanced.

## Unproven / deliberately deferred

- No post-fix physical repeated-seek exercise has been run. Do not manufacture one during the soak.
- The server-side terminal clamp is on disk but is not in PID 1586505; it needs the next authorized FlightDeck
  relaunch. The refreshed client clamp and latest-intent gate require no process restart.
- Overnight endurance, screen wake behavior and device-specific recovery remain to be read in the morning.
- The open display was refreshed before the new repertoire assets were written and therefore continues running the
  earlier approved Flip client overnight. Refresh/reopen it once in the morning to load the per-face choices. No
  physical Fire TV receipt exists yet for Slide, Dissolve or Lift; explicitly watch for compositor flicker, seams,
  shadow pulses or ring movement.
- Nothing is committed and no beta artifact has been built or distributed.

## Relevant code

- Cover eligibility and repertoire: `assets/cover-transition.js`, `assets/cover-effects.js`, `assets/face.js`,
  `assets/face.css`.
- Seek intent owner: `assets/seek-intent.js`; target bound: `assets/seek-target.js`.
- Server defense: `src/http/server.ts`.
- Regression receipts: `test/cover-transition.test.ts`, `test/cover-effects.test.ts`, `test/seek-intent.test.ts`,
  `test/seek-target.test.ts`, `test/face-tv-runtime.test.ts`, `test/control.test.ts`.

## Working-tree rule

The FlightDeck tree is intentionally very dirty and contains the whole UI/control hand-off. Preserve it exactly;
do not reset, re-apply earlier patches, commit blindly, or restart RHEOS. Establish the exact diff and live identity
before selecting a beta cut.

## Precise open question

Did the unchanged service and already-loaded Flip client remain healthy through the overnight soak, do all four new
effects render cleanly after one morning refresh on Fire TV, and is the exact on-disk tree then ready to be frozen as
the next private beta candidate?

## Next discriminating experiment

In a fresh context tomorrow: read this handover, record the live PID/start/restart count and `/api/v1/health`, passively
sample the displayed zone twice to prove progress, and inspect overnight FlightDeck/RHEOS warnings without sending a
control. Then refresh FlightDeck once, use the Face menu to prove two different per-face choices and Tasteful Random
on naturally arriving different-cover Roon Radio tracks; do not manufacture another seek burst. Follow the exact I2
drill in `docs/tv-drill.md`, then compare the complete working tree with the intended beta scope. Only after those
receipts pass should the exact candidate be committed, built, packaged or distributed.
