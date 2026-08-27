# FlightDeck — 2026-08-26

**Live:** `6494bf4` on `:80` (systemd `flightdeck`, active), Nucleus Titan, 22 zones.
**Green:** floor lint clean (7 assets, Chromium 63 floor) · **65/65** tests.
Working tree clean; every change below is its own commit.

---

## What changed today

**The ring faces finished.** Dial puts the reading in the circle's top segment and the copy in the
bottom one — a segment is a *lens*, so each line is capped at the chord where it actually sits and
elides rather than crossing the arc. **Orbit** is the same ring composed asymmetrically, circle left
and words right, and is the sixth face. In the artist view a ring face keeps its own composition
rather than switching to sleeve-beside-words: it shrinks to a corner, and shrinks again when the
chrome is up so the transport bar never lands on the title. The "artist" label is gone; the rotation
count stays, as a bare `2 / 5`.

**Controls.** Shuffle and repeat bracket the transport line, lit rather than pressed-looking.
Shuffle reads the live snapshot and sends the inverse; repeat asks the *Core* to cycle (`loop: 'next'`)
so off/all/one is Roon's order and two screens cannot disagree.

**A press outside what is raised goes back to the music** — the transport bar included — and *stays*
back: a touch ends with the browser's compatibility mouse events, and the `mousemove` among them was
re-revealing the chrome before the finger left the glass.

**Grouping**, from the room badge: `group… | ungroup | send to…`, each with a mark (chain, broken
chain, arrow leaving the room). The picker shows only rooms that can actually join. Proven live on the
silent RAAT island: group → `"Study ROON + 1"`, ungroup → both standalone.

**The Wall** gained island tabs, lost the 16-tile cap (22 now fill 92%), lost the QR, and **holds its
place**: it re-sorts when a room starts or stops, not when a track changes.

**The pickers** draw each room as its sleeve, its name, and `▶`/`‖` plus the track.

---

## Two things measured, so they need not be measured again

Recorded in memory as `reference_roon_extension_api_limits_measured`.

1. **Roon carries no format or resolution anywhere** — not in `now_playing`, not on a zone, not on an
   output, not in the queue; the transport library has four subscriptions and no vocabulary for sample
   rate, bit depth or signal path. Only the decoder knows, which here means RHEOS — and Peter declined
   that bridge on the grounds it would be a RHEOS-only feature.
2. **`can_group_with_output_ids` is a closed equivalence class**, not a neighbour list. 22 outputs gave
   exactly three membership lists, each identical for all its members (16 Squeezebox, 3 RAAT, 3
   AirPlay). Roon never names the protocol, so **the relation is the taxonomy** — every output now
   carries an `island` derived from it, and nothing is inferred from a room's name.

## A lint worth knowing about

`scripts/floor-lint.ts` now rejects a **lopsided selector list** — a comma-list where one branch has
lost the descendant its siblings carry. Extending a rule to a second face by find-and-replacing its
prefix produces `.face[data-face="dial"], .face[data-face="orbit"] .cover`, which sizes the *face* for
one and the cover for the other. It is valid CSS and silent; twice today it blanked a face, and both
times only a screenshot caught it. The tests are those two real edits.

---

## Open

- **Presets** — a saved group is a named *ordered* set of outputs within one island. Order is
  load-bearing: `group_outputs` preserves the first output's zone's queue and discards the rest, so the
  head is the room whose music the others join. Recall must compute the *minimum* change — Roon tears a
  Squeezebox grouped zone down on every `ungroup_outputs`. Naming on a TV is the awkward part; suggest
  auto-naming from the members and renaming from a phone.
- **Island tab labels** are derived (`Cobalt RHEOS +15`) because Roon names nothing. Editable labels
  would let them read *RHEOS* / *Roon Ready* / *AirPlay*.
- **Search** — the Browse shape is captured (`input` goes directly on the `search` hierarchy); not built.
- **A saxophone for Jazz** — Lucide has none; would be hand-drawn like the clef.
- **Classic, Libretto and Canvas** have not been reviewed since the interaction rebuild.
- **The QR** is unwired, not deleted: `qrSvg` and its tests stay for a click-to-show, once a phone has
  actually read one.
- Never soaked for 2h or 7 days; never compared side-by-side with Roon Display.
