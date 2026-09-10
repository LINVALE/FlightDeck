# FlightDeck — what the screens are, and how to use them

FlightDeck gives every Roon zone in the house a display and a control surface.
A wall of rooms on a tablet or a television, a full-screen face for one room, a
phone remote that fits in a hand, and a round face for the knob.

It is a Roon extension. It reads the same zones Roon reads and sends the same
commands the Roon app sends. Nothing here is a second source of truth: if Roon
disagrees with a screen, Roon is right and the screen catches up within a second.

---

## Turning it on

**On its own.** Start FlightDeck, then in Roon go to **Settings → Extensions**
and enable **FlightDeck**. It needs no other software.

**With RHEOS.** If you run RHEOS, go to **Settings → Extensions → RHEOS →
Settings** and there is a **FLIGHTDECK** panel. Switch it On, and put
FlightDeck's web address in the box if it is not on the same machine. The RHEOS
web console then carries a FlightDeck link, and the address is spelled out in
Roon so you can copy it to a tablet or a TV.

Either way FlightDeck stays its own extension with its own settings. RHEOS is a
convenience, not a requirement.

**Finding it.** FlightDeck answers to `http://flightdeck.local:8080` on most
networks. If a television cannot resolve that name, give it the server's IP
address instead, or add a short DNS record on the router so it is typeable on a
remote. There is a step-by-step guide at `/setup`, and a five-minute check at
`/drill`.

---

## The Wall — every room at once

**Address:** `/`

![The Wall, eight rooms](/assets/screens/wall.png)

One card per Roon zone: what is playing, who it is by, and how far through it
is. A room that is playing is marked **now**.

**Cards are in alphabetical order and they hold it.** They do not re-sort when a
room starts or stops, so a card never moves out from under your hand. If you
want a different order, **Reorder** lets you drag them into one and it is
remembered on that screen.

### How the controls appear

That depends on how many rooms you have, because a card that is one of six has
room for everything and a card that is one of twenty does not.

**Up to two rows** — every control is on the card, as above. Nothing is hidden.

**Three rows or more** — a card at rest shows the words and the position only,
and a drawer of controls opens when you bring a pointer over it or tap it once:
play and pause, previous and next, volume, mute, and the buttons for grouping.
On the bottom row the card rises and the drawer opens beneath it, so the
controls are never off the edge of the screen.

![Fourteen rooms, one card's drawer open](/assets/screens/wall-drawer.png)

**One row** — the cards are held to half the height of the screen, so four
rooms do not become four enormous posters.

**Tap a card twice** (or click its title) to open that room's full-screen Face.

**The bar across the top** carries the house-wide actions:

| Button | What it does |
|---|---|
| Group | Choose two or more rooms to play together |
| Group all | Group every room in one device family at once |
| Ungroup | Break a group back into its rooms |
| Pull | Bring what is playing elsewhere into this room |
| Transfer | Send what is playing here to another room |
| Pause all | Stop every room that is playing |
| Reorder | Drag cards into the order you want on this screen |
| Hidden | Show the rooms you have hidden, and put them all back |

**Hiding a room** takes it off this screen only. It is still a Roon zone and
still plays. The hidden page has a **put every hidden room card back on the
wall** button, so nothing is ever lost.

**Reorder is per screen.** The order you set on the kitchen tablet does not
disturb the order on the television.

### Example — the whole house is playing and you want silence

Press **Pause all** in the top bar. Every playing room stops. Nothing is
ungrouped and no volume changes, so pressing play in one room resumes exactly
where it was.

---

## A room's Face — one room, full screen

**Address:** `/<room>` — for example `http://flightdeck.local/study` — or tap a
card twice on the Wall. Use your server's address and your room name, with spaces
removed: **Living Room** becomes `/livingroom`. Keep any port number in your
server address. The display stays with that speaker when it joins a group.

The bare address opens all rooms. Existing `/face/<room>` bookmarks still work.
Names reserved for app pages, such as `/guide` and `/phone`, keep opening those
pages; use `/face/<room>` if your room has one of those names.

![Presence, the default face](/assets/screens/face-presence.png)

This is the screen for a television or a spare tablet: the cover art large, the
title and artist under it, and the position running along the bottom.

**The controls are summoned, not permanent.** Move a mouse, or touch the glass,
and the transport, volume and the browse and queue doors appear over the art.
They go away again when you stop. The cover is never covered while you are
simply listening to music.

**Dragging the position line seeks.** A small copy of the sleeve rides with your
finger so you can see where you are landing. The seek is sent once, when you let
go, so a long drag does not fire a hundred requests at the room.

**Arrow keys cycle the faces** on a television remote.

### The album, and the artist

**Press the cover and the screen flips to the artist.** The photograph Roon
holds for the performer fills the screen, the sleeve shrinks to a small plate
beside the words, and everything else stays where it was. Press it again and you
are back on the album.

![The same track, flipped to the artist](/assets/screens/face-artist.png)

Roon often has more than one photograph for a track — a performer, a conductor,
a composer — and it does not say which is which. So when there are several they
**rotate every ten seconds** and a small counter shows which one you are on. You
never have to press anything to see them all, and you can press the cover to
stop and go back to the album at any time.

A new track always comes back to the album view.

### The faces

The same room, drawn eleven ways. `?face=` in the address always wins; otherwise
each screen remembers its own choice per room.

| Face | Signature |
|---|---|
| **Presence** (default) | Blurred artist behind an untouched cover; progress is a runway of approach lamps |
| Classic-Plus | Roon's own grammar done properly; the largest cover |
| Dial | A ring instrument opposite the cover; remaining time and when the track ends; idle becomes a clock |
| Orbit | The circle to one side, the words to the other |
| Libretto | Concert-programme typography |
| Folio | A book page: the sleeve to the right, the credits set as text |
| Plate | Type on the disc, the sleeve a plate at the side |
| Rondo | Libretto's page with the ring drawn round its picture |
| Ambient Canvas | A generative field in the cover's own colours |
| Gallery | The artist's own photographs, cycled |
| Aurora | Slow colour drawn from the sleeve |
| Puck | Forwards to the round face — see below |

![Dial](/assets/screens/face-dial.png)

![Plate](/assets/screens/face-plate.png)

**The cover is never touched.** No crop, tint, filter or overlay on the artwork
itself, on any face. Everything a face needs to say, it says in the space around
the picture.

### Browse and the queue

Both doors are on every face and on the phone.

**Browse** walks your Roon library — artists, albums, tracks, genres, playlists,
and your streaming services — and plays what you choose into this room. Long
lists get an alphabet so you are never scrolling through ten thousand titles.
Search finds artists, albums and tracks by name.

**The queue** shows what is coming, and lets you jump to any track in it.

---

## On a phone

FlightDeck detects a phone by the shape of the screen, not by what the browser
calls itself, so a Fire TV is never mistaken for one.

### The phone Wall — `/phone`

![The phone Wall](/assets/screens/phone-wall.png)

One card per room, alphabetical, sized for a thumb. Volume is a pair of large
steps rather than a slider you cannot hit while walking. In landscape it stays
one column, so a card is never squeezed into an unreadable strip.

### The phone remote — `/phone/<room>`

![The phone remote](/assets/screens/phone-remote.png)

The room's cover, its words, transport, volume, and the doors to browse and the
queue. It fits the screen in either orientation, including the shortened screen
a browser leaves once its own bar is on show.

**The search keyboard stays up** while you type. Results arrive underneath it.

**Add it to your home screen** from the browser's share menu and it opens
without browser furniture, like an app. There is nothing to install from a
store.

---

## The puck — the round face

**Address:** `/puck/<output>`, or choose **Puck** from the faces on any Face
screen.

![The puck](/assets/screens/puck.png)

This is the face the physical knob runs, and it is the same drawing in a browser
so you can use it before the hardware is in your hand.

- **The outer rim is the volume.** On the knob it is the wheel; on a screen you
  can tap or drag it.
- **The inner ring is the position.** Touch the outer band anywhere to seek
  there.
- **The middle is play and pause**, and it lights under your finger.
- **Previous and next** flank it, with **repeat** and **shuffle** on the row
  beneath, and **mute** at six o'clock.
- **Up** goes to the queue, **down** goes to browse.
- **The words at the foot** open browse as well.
- **Tap the room name** to choose a different room.

On the knob itself the controls are summoned by a touch and put themselves away
after five seconds, leaving the sleeve, the rings and the words.

---

## Volume, and Roon's two limits

Roon lets you set a **volume limit** per zone. FlightDeck honours it everywhere,
in exactly one way, on every screen:

- **The scale ends where the device's own maximum ends** — the same range Roon
  reports for that device. A device that reports 80 shows a scale to 80, not a
  scale to 100 with the top fifth dead.
- **Up to the comfort level the scale is plain.** From the comfort level to the
  end it is amber.
- **Dragging stops at the comfort level** and says so.
- **To go above it, press or tap again** — a deliberate second action.
- **Nothing passes the safety limit.** Not a drag, not a double tap, not the
  wheel. The server refuses it as well as the screen, so no client can talk a
  room past it.

A quick spin of a scroll wheel cannot run a room up. There is a rate limit,
and if you spin far enough in one motion the volume pauses for a second and
tells you so, then carries on.

---

## What to do when something looks wrong

**A screen says it is reconnecting.** It lost the server, not Roon. It keeps the
last thing it knew on screen and reconnects by itself.

**A room has no volume control.** Roon is reporting that zone without one —
usually a fixed line output, or an amplifier that has gone into standby. Wake
the amplifier and it comes back.

**A television shows small faint text.** Faces are drawn for a metre away. If
your set is scaling the picture, turn off its overscan or "just scan" setting.

**Cover art is missing.** FlightDeck keeps the previous artwork rather than
showing a hole, so a single failed image is invisible. Persistent blanks mean
the Core is not answering for images; restarting the extension re-pairs it.

---

## Privacy and licence

FlightDeck talks only to your Roon Core and the browsers on your own network.
It sends nothing anywhere else, and no artwork URL, image key or Core handle
ever reaches a browser — screens are given opaque addresses on FlightDeck's own
origin.

FlightDeck is licensed under the **Functional Source License 1.1 with an MIT
future licence**, the same terms as RHEOS. The full text is in `LICENSE`.
