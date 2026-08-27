# FlightDeck on a phone

*2026-08-27. The design behind `/phone` — argued, then built. The prototype is
real: `src/http/pages.ts` (`renderPhonePage`), `assets/phone.js`,
`assets/phone.css`, verified at 390×844 and 360×800.*

---

## What the phone view IS

**A third page, not the Face responding.** The repo already settled this
question once: the Wall and the Face are two pages, not one page with media
queries, because they answer different questions. The phone is a third answer.

The Face's whole grammar is a television's. Its controls are invisible until
summoned because a TV at rest is furniture — the music IS the interface, and
chrome on it is vandalism. Its presses are zoned and unlabelled because a TV
has no chrome to hang labels on. Its dwell-to-arm exists because a pointer
remote cannot comfortably click. Every one of those decisions is *correct for
a screen across the room* and wrong at 30cm:

- A phone is **picked up with intent**. Nobody idly watches their phone play
  album art from the sofa — they picked it up to *do* something, and a page
  that makes them tap once to reveal the controls has already wasted the
  reason they came.
- Zoned invisible presses are a TV's virtue and a phone's bug. Phone users
  have thirty years of expectations about what a screen region does; an
  unlabelled press that opens browse is a mystery, not elegance.
- The layout inverts. On a TV everything important is centred, sized for
  distance. On a phone everything *operable* must be in the bottom third
  (below), which no responsive stylesheet can do to the Face's DOM without
  becoming a second page wearing the first one's clothes.

What is **shared is the organs, not the skin** — exactly as Wall and Face
already share them: the snapshot store and SSE stream (`store.js`,
`stream.js`, imported unchanged), the art relay, the one write route, the
palette pass that lifts the accent out of the sleeve until it clears the deck,
the runway lamps, Georgia for titles and letterspaced caps for labels. The
phone page is unmistakably FlightDeck; it is just FlightDeck *held* rather
than FlightDeck *watched*.

So: **display pages** (Face, Wall) and a **remote page** (Phone). The rule for
which is which: does the screen belong to the room, or to the hand?

## The thumb

A phone is held in one hand and worked with one thumb. The comfortable arc
covers roughly the bottom third of the glass, weighted toward the holding
side; the top corners cost a re-grip. So the page is a strict column, ordered
by how often a thumb needs it:

```
FLIGHTDECK · status            ← identity + stream health. Display only.
        [ sleeve ]             ← the music. Display only. SACRED.
      title / artist / album
   runway lamps · times        ← seek — occasional, mid-reach is fine
          (air)
 speaker | volume scale | 52   ← the bottom third begins here
 [🖼 STUDY RHEOS         ⌄]    ← the room bar: what this remote is holding
 shuffle ⏮  [play]  ⏭ repeat  ← transport, largest and lowest
```

Everything that acts sits in the bottom third: **transport, volume, the room
switcher**. The runway (seek) sits just above it — an occasional gesture earns
mid-reach, not prime reach. The top of the glass is display only, so the
re-grip is never required. This is also why the room control is a *bar above
the transport* rather than a name in the header the way the Face wears it:
switching rooms is one of the three things a remote is for, and the header is
the one place a thumb cannot go.

Targets are 44px minimum (52–68px for transport), a real gap between the
runway and the volume scale so a seek never lands on a level, and
`touch-action: manipulation` so no press pays the double-tap-zoom tax.

## The six faces: the phone has one

Presence, Classic, Dial, Orbit, Libretto, Canvas answer one question — *what
should a large idle screen look like from across the room* — six ways. The
phone never asks that question. It is not idle (it locks itself in seconds),
not large, and not across the room. Offering six layouts for the 200ms
between unlock and tap would be the tournament cargo-culted onto an
instrument that never entered it.

So the phone gets **one face**, and it is Presence's values without its name:
sleeve sacred and dominant, type doing the work, the accent belonging to the
album. The Dial's ring, Orbit's asymmetry, Libretto's text-forwardness are
TV compositions; none survives contact with a 6-inch portrait glass holding a
transport bar.

What the phone *does* inherit from the faces work is the **image engine**:
the same 32×32 palette pass, the same WCAG-lifted accent, the same
blurred-tiny-canvas backdrop (54×96 portrait rather than 96×54). A green
sleeve makes a green remote; the phone and the TV in the same room visibly
belong to the same instrument family. That, not a face picker, is the
character carrying over.

(The phone is, however, the natural place to *choose a TV's face* one day —
it is the device in your hand while you stand in front of the screen you are
setting up, and the handover already notes that naming islands and renaming
presets belong on a phone. A `?for=<display>` settings mode is future work,
not prototype scope.)

## Browse: search-first, because there is a keyboard

The TV's browse is shaped by what a TV lacks. No keyboard → the alphabet
rail, probing Roon's list for the first row of each letter. No scroll habit →
paging. No pointer → big rows and dwell.

A phone lacks none of that, so browse inverts:

- **Search is the front door.** The Browse capture (docs/browse-shapes.md)
  established that `input` goes directly on the `search` hierarchy — the
  server route passes it today. On the TV that shape is awkward (typing on a
  remote); on a phone it is the *whole point*: a search field pinned at the
  top of the browse sheet, OS keyboard, results as rows. The TV works around
  a missing keyboard; the phone should never make the user browse to what
  they could type in four letters.
- **Scrolling lists, native momentum**, rows at list density (~60px with
  thumbnail) rather than TV density.
- **The alphabet rail survives** — as the phone-native right-edge index (the
  Contacts pattern) on albums/artists/composers, reusing the same
  probe-for-letter calls. It earns its place on a 4,000-album library where
  even search is slower than a flick to "M"; it is secondary to search, not
  primary as on the TV.
- **Same hierarchies, same `/api/v1/browse`**, same session-scoped item-key
  rules. Nothing server-side changes.

Browse is design-settled but deliberately **not in the prototype** — the
prototype proves the remote (now-playing, transport, volume, rooms); browse
is the first increment after it.

## Grouping with a thumb

The verbs and the rules are the Face's, relocated into the rooms sheet:

- The room bar opens a **bottom sheet** — rooms as rows (sleeve, name,
  ▶/‖ + track, exactly the picker's roomcard anatomy), the current room in
  accent. Above the rows, the action strip: `group… | ungroup | send to…`,
  each with its chain/broken-chain/leaving-arrow mark, each offered only when
  possible (no ungroup on a solo room, no send-to with nothing playing).
- **group…** turns the sheet into a picker: only rooms in the head's island
  appear (the relation is the taxonomy; a room Roon would refuse is simply
  not there — same ruling as the TV, 08-26), tap to check, tap again to
  uncheck, and a pinned confirm — `GROUP 3 ROOMS` — sits at the sheet's
  bottom, in thumb reach, with `back` beside it. The current zone is the
  head, so grouping from the playing room carries its music outward; the
  server enforces all of it again regardless of what the page asks.
- **ungroup** is one press, one call for the whole set (Roon tears a
  Squeezebox group down on every ungroup — a second call is a second injury).
- **send to…** lists destinations; a tap transfers and the remote follows the
  music to the new room.

Multi-select-then-confirm is the one grouping gesture that works with a
thumb; drag-to-group (the House Canvas idea) needs a canvas and two hands.

**Volume is where the phone beats the TV.** A TV bound to one output shows
one scale — correct for a screen that belongs to a room. The phone holds the
*zone*, so a grouped zone shows **one row per speaker**, each with its own
mute, scale, and reading: Kitchen 52, Dining 44, Music Room muted. Canon
holds — volume always acts on a single output, never a group knob — and the
phone is the first surface where the whole group's balance is visible at
once. (Verified in the prototype: three live rows, the muted room reading
crossed-and-grey.)

## Navigation: the phone has chrome, so use it

The TV's navigation is zoned presses because it has nothing else. The phone
has conventions, and fighting them costs more than they are worth:

- **No tab bar.** A tab bar earns its place at three-plus peers; the phone
  has one screen (now playing) plus two sheets (rooms, browse). Sheets are
  cheaper than pages: they keep the music visible behind the scrim, they
  cannot lose your place, and the back gesture cannot dump you somewhere
  surprising.
- **Bottom sheets dismiss three native ways**: scrim tap, the × in the
  sheet's own header, drag down past 70px. No mode survives a dismissal
  half-armed — closing the group picker clears the picks.
- **The back gesture** never navigates within the page (sheets are not
  history entries), so swipe-back does what a phone user expects: leaves.
  One URL, one place.
- **Pull-to-refresh is made redundant, not fought.** The page is live over
  SSE with the 25s watchdog; there is nothing to pull for.
  `overscroll-behavior: none` keeps an idle downward drag from tearing the
  connection down with a reload; if a refresh happens anyway, the snapshot
  cache paints the page back before the network answers.
- **Deep links**: `/phone` (holds what this phone last held, else the room
  that is playing), `/phone/study` (pins by name, same resolution as
  `/face/`), `/phone?rooms=1` (opens onto the room list — "I picked the
  phone up to move the music, not to look at it").

## Left out, on purpose

- **The face tournament** — one face (argued above).
- **Zoned presses, dwell-to-arm, chrome timers** — TV grammar.
- **The idle clock** — a phone locks itself; FlightDeck is not its lockscreen.
- **Wake lock** — a remote must not hold a phone's screen on.
- **The artist-portrait rotation** — a display behaviour. (Tap-the-sleeve to
  flip could return as an increment; it is the one Face gesture that
  translates, and it is not in the prototype.)
- **The ambient canvas field** — battery spent on weather nobody watches.
- **The key probe, D-pad handling, spatial-nav suppression** — no keys.
- **Per-screen display registry (`sayHello`)** — a phone is a person's, not a
  room's; it has no output binding and never appears in the screens registry.
- **The QR** — the phone is the thing that would *scan* one.

## The floor, and how the lint treats the phone

`floor-lint.ts` walks all of `assets/`, and the phone assets **pass it as
written** — no `?.`, no `??`, no `clamp()`, no `aspect-ratio`, the decode
guard present, the cover class named `.cover` so the sacred-cover rule
protects the phone sleeve too. This was a choice, not an accident: phones are
evergreen, but one dialect across the directory means one rulebook, and the
parse check + lopsided-selector check + cover check (the rules that catch
*real* regressions) apply to every file without ceremony. The only
above-floor syntax is `env(safe-area-inset-*)`, always preceded by a plain
fallback declaration, which the lint's rule set does not (and need not) flag:
an engine that lacks it drops the refinement and keeps the layout.

If a phone asset ever genuinely needs modern CSS (say, `dvh` for the iOS URL
bar collapse), the proposal is a **per-file pragma**, not an exemption list:
a `/* floor: modern */` header in the file's first comment switches
`floor-lint.ts` to a modern ruleset (iOS 15 / Chromium ~100) for that file
while keeping the parse, cover, and lopsided-selector rules unconditional.
The lint stays one tool, the floor stays declared *in the file it governs*,
and `git blame` shows who raised it and when. Not implemented, because
nothing needs it yet.

## Should this be an app?

**No — it should be exactly what it now is: an installable page. Revisit only
if hardware volume keys become the ask.** The reasoning, not the preference:

**What any app must confront first:** FlightDeck is a LAN-only tool talking
to a server on the user's own network. There is no cloud relay, and (unlike
the Echo case, where one would be required because Alexa routes through
Amazon's cloud) a phone needs none — it is *on* the LAN. But that cuts both
ways: an app has no reach advantage. Away from home, native FlightDeck and
web FlightDeck are equally dead. Nothing app-shaped fixes that; only a relay
would, and that is a product decision, not a packaging one.

**The PWA column (today's page):**
- *Installable now*: Add to Home Screen gives an icon, a standalone window
  with no browser chrome (the manifest and `apple-mobile-web-app-capable`
  are already served), and a bookmark that survives — on iOS, Android, iPad,
  and the Fire TV route already documented in tv-setup.md.
- *No store, no accounts, no review, no signing* — matters at beta scale
  (3–5 users) and matters more at "Lukas installs it from the invite email"
  scale.
- **The killer property: zero version skew.** The server serves the client.
  Update the container, and every phone, TV and wall in the house runs the
  matching UI on next open. A store binary against a self-hosted server is a
  version matrix; a served page *is* the server's version. For a
  self-hosted LAN tool this is the argument that ends the meeting.
- *Honest costs*: over plain `http://` on a LAN there is **no service
  worker** (secure context required), so no offline shell and no web push —
  though both are near-worthless here: the page without its server is a
  brick regardless, and push with no relay has no path to a locked phone
  anyway. No mDNS from the browser — first contact means typing `fd/` or
  `192.168.1.114` once (the router-DNS record in tv-setup.md §0 is the real
  fix). No hardware volume keys. iOS will not run the SSE stream in the
  background — reopening refetches, which the snapshot cache makes feel
  instant, but a paused phone is not a live remote in the pocket.

**The React Native / Capacitor column:** buys mDNS discovery ("found your
FlightDeck at Study" on first run), a store listing, and — the only feature a
listener would actually *feel* — hardware volume keys steering the room.
Costs: a build pipeline where there is deliberately none (Node 24, no
bundler, is a stated constraint of this repo); two platform projects to keep
green; $99/yr Apple + Play console; store review for updates *to a remote
control for the user's own server*; TestFlight friction at beta scale; and
the version-skew matrix. And the volume-key prize is smaller than it looks:
iOS only yields the buttons to the app that owns the audio session (the
Sonos trick — playing silence — sits poorly with a hi-fi product and with
Apple review), so the honest win is Android-only.

**The native column:** everything Capacitor costs, doubled, for polish this
page does not lack. A LAN remote is exactly the app class the web was made
adequate for.

**Recommendation:** ship `/phone` as the installable page; put one line in
the invite ("open `fd/phone`, Share → Add to Home Screen"). Spend the app
budget on a relay *decision* instead — because remote access, not packaging,
is the only thing on any of these lists that a listener would notice. The
trigger to revisit Capacitor is written down: if beta users ask for volume
keys more than they ask for anything else, that is the one thing the page
can never give them, and Android Capacitor is the cheapest honest answer.

## What was verified (2026-08-27)

Against the real server (`createFlightDeckServer`) fed by an enriched
fixture house — five zones, two islands, a three-room group, number and
incremental volumes, a radio zone — screenshots at **390×844 and 360×800**,
via headless Chromium CDP, console-error-clean, no horizontal or vertical
overflow:

- Now playing with palette-lifted accent (a green sleeve made a green
  remote; a gold one, gold) and the blurred portrait backdrop.
- Transport: tap pause → server state flips → button becomes play, ENDS
  clears, lamps head goes dark. Disabled states honoured (radio zone: prev,
  next, shuffle, repeat inert; pause and volume live).
- Volume: tap at 85% of the scale → level 85 on the server and back into the
  scale and reading. Grouped zone: three per-speaker rows, muted row crossed
  and grey. Shuffle/repeat lit from live zone settings (`ctl side lit`,
  computed accent `rgb(243,201,139)`).
- Rooms sheet: open, switch (remote followed Garden), group picker offering
  only same-island rooms with `GROUP 2 ROOMS` confirm arming on selection,
  scrim/×/drag-down dismissal.
- `/phone`, `/phone/study` name resolution and attribute sanitisation under
  test in `server.e2e.test.ts` (79 tests green); floor lint clean at 9
  assets.

**Not yet verified:** a physical iPhone or Android hand-set (headless
Chromium only — Safari's viewport and safe-area behaviour need a real
device), landscape, browse (not built), long-session battery, and the page
against the live 22-zone Core.
