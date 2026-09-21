# Puck companion face

The browser Puck now follows the round screen designs in the 13 September review's `puck-mocks.html`: metadata above artwork, artwork as the play/pause target, separate Previous/Next, Browse and Queue, a persistent Now Playing thumbnail in menus, and a three-row selection list.

The outer rim displays volume marks from the permitted minimum up to Roon's safety limit. Lit marks and a moving indicator show the confirmed level; changes animate over 320 ms. The comfort marker and the subtle amber band above it stay fixed, with a muted safety endpoint. A small gap at twelve separates minimum from maximum. The lower caption gives the numeric comfort and safety limits.

On Now Playing, clicking a mark requests that volume on the device's own step grid. The first click holds at comfort; a second click on the same mark within 700 ms may reach above comfort, up to safety. The animation follows the volume Roon reports. Fixed/incremental-only outputs do not show a misleading absolute scale.

Dragging along either side continues to turn by relative steps: down on the right or up on the left moves forward, with the reverse movement moving backward. In Browse and Queue, the marks are neutral and clicking or dragging moves the selection. In Seek, the rim adjusts the five-second preview. Releasing a drag adds no extra click. Volume drags retain the existing rate and comfort-limit guard.

Menu turning does not activate an item. Tap the highlighted choice to open it. Queue selections show a named action before playing or pausing. Clicking or dragging the inner progress ring scrubs directly: the arc and time preview follow the pointer, then one seek is sent on release. Escape, pointer cancellation, leaving the page, or a changed track cancels the scrub. The outer rim keeps its relative wheel behaviour.

Seek also opens from the time readout: Cancel sends nothing; Apply sends one seek, provided the Core, room, track and seek capability still match. Returning to Now Playing parks Browse so it reopens at the same selection.

A persistent “← Other faces” button sits outside the dial at the top left. On small square displays it becomes a back-arrow button with an accessible label. It opens the face chooser for the same room, including at phone sizes, and restores the previous face so the remembered Puck cannot send you straight back. The button remains available in Browse, Queue and Seek.

The ellipsis menu retains room selection, search, Radio, mute, shuffle/repeat, room transfer controls where relevant, puck connection, other faces and the Wall. Existing Roon navigation, paging, controller pairing and output binding remain the command owners. This is a browser face update; it does not flash or replace hardware firmware.

Validation: 419 tests across 44 files, Chromium 63 floor lint (37 assets), and isolated Chrome checks at 1920×1080, 390×844 and 360×360. Browser checks exercise actual rim pointer presses, relative volume steps, Browse selection without activation, preserved position, Queue confirmation, keyboard artwork activation, and Seek preview/Cancel/Apply. No live player commands were used during implementation.

Refresh the Puck page after applying these assets. No service restart is required. `node scripts/check-community-ui.mjs` repeats the mock browser checks; optional `FLIGHTDECK_TEST_ART=/path/to/image.jpg` adds local sample artwork to screenshots only.

Progress-scrub follow-up: all seven focused preview tests and the mock Chrome pointer checks passed, covering direct clicks, drag preview/release, cancellation and changed-track invalidation. Browser floor lint remains clean.

Rim-drag follow-up: ten focused tests and mock browser gesture checks passed, including multi-step straight drags on both sides, event-rate independence, cancellation, unchanged scrubbing and no activation or release click during menu spinning.

Volume-scale follow-up: eleven focused Puck tests, existing volume-limit/gate tests and mock Chrome checks passed. Browser checks verify exact marked levels, intermediate animation frames, comfort enforcement and the second-tap override, the top gap, and unchanged Browse/Seek gestures. Browser floor lint remains clean.

Simulator-exit follow-up: 121 focused Puck, Face and navigation tests passed, with Chromium 63 floor lint and mock Chrome round trips at desktop, phone and square sizes. The browser check covers leaving while browsing, keyboard activation, previous-face restoration and a changed group identity without a redirect loop or player command.
