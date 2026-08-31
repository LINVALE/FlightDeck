# Putting FlightDeck on a TV

Samsung, LG and Fire TV all end up in the same place — **the TV's browser, opened
to a short URL, remembered**. Only Fire TV can go further than that, and none of
the three can have a real installed app without a store submission (see the end).

## 0. First, make the address short — this is the biggest single win

Typing on a TV remote is the actual pain, not the browser. So make the address as
short as it can be: add a **router DNS record** (UniFi → Settings → Networks →
DNS → Create New Record, type `A`):

| Name | Points to | You type |
|------|-----------|----------|
| `fd` | `192.168.1.114` | **`fd/`** ← two characters |
| `flightdeck` | `192.168.1.114` | `flightdeck/` |

Add both — `fd` for the remote, `flightdeck` for humans. This is ordinary unicast
DNS, so it works on **every** device: Samsung, LG, Fire TV, Windows with mDNS
locked down, the lot. `.local` does not, and never will on those TVs.

⚠️ Pair it with a **DHCP reservation** for `192.168.1.114`, or the record rots the
day the box gets a different lease.

Without a DNS record the fallback is always `192.168.1.114/` — and the House Wall
prints it, with a QR, in its footer.

## 1. Samsung (Tizen)

1. Open **Internet**, go to `fd/`.
2. **Settings → Hide Tabs and Menu Bar → Use** — removes the browser chrome.
3. Add it as a bookmark, then **Settings → Set as Homepage**. Opening Internet is
   now FlightDeck.
4. **General & Privacy → Start Screen Options → Autorun Last App → On.** The TV
   now boots into it.
5. ⚠️ **General → Power and Energy Saving → Auto Power Off → Off.** It is 4 hours
   by default and a firmware update can turn it back on.

That is as close to an app as Tizen allows without publishing to Samsung's store.

## 2. LG (webOS)

1. Open **Web Browser**, go to `fd/`.
2. **Settings → Always Show Address Bar → Off** (a thin strip may remain — the 5%
   safe area covers it).
3. Bookmark it and set it as the homepage.
4. ⚠️ **The screensaver will interrupt you.** LG only exempts full-screen *video*,
   and its `navigator.wakeLock` hangs rather than rejects — FlightDeck races it
   against a 5-second timeout so the page never stalls, but the screensaver still
   wins. Turn the screensaver off in **General → Screen Saver** if you want an
   unattended display. Expect the 2-hour drill to fail here otherwise; that is a
   webOS limitation, not a FlightDeck defect.
5. webOS has no boot-into-browser without root.

## 3. Fire TV — the one that can do better

The Silk browser works, but it exits to the home screen after 10–15 minutes and
Amazon states that timeout cannot be disabled. So do **not** use Silk for a
permanent display. Two better routes:

**a. Add to Home Screen (free, no sideloading).** FlightDeck now ships a PWA
manifest, so Fire TV and Android TV can install it: an icon on the home row, true
fullscreen, no browser chrome.

**b. Fully Kiosk Browser (the signage answer).** Sideload it, point it at `fd/`,
and enable **Launch on Boot** and **Keep Screen On**. Its WebView is a current
Chromium, so it is far ahead of the Samsung/LG engines. This is what actually
gives an always-on wall display.

## 4. On any of them, once it is open

| Key | Does |
|-----|------|
| ◀ ▶ | change face — Presence or Classic |
| ▲ ▼ | change room |
| OK  | toggle album / artist artwork (portraits rotate every 10 s) |
| Space / ▶⏸ | play or pause |
| ⏭ ⏮ | next / previous track |
| Vol +/− | volume — **this room's speaker only**, never the whole group |

The on-screen strip carries the same controls as buttons, for a pointer or a
touchscreen. A control Roon reports as unavailable (skipping an internet radio
stream, say) is shown but plainly inert rather than hidden, so the row does not
jump about as tracks change.

**Where you press decides what appears.** Moving the pointer, or a first touch,
only fades in the affordances — the room name and a cog — so you can see there is
something to press. It opens nothing.

**At rest the face is the music and nothing else** — sleeve, title, artist, album,
progress. No room name, no status, no controls.

**Movement, or a touch anywhere undefined, reveals it**: the room appears top left,
the face's own name top right, and the transport bar below the music, which shifts
up to make space. All of it fades again after six seconds.

| Press here | Get |
|-----------|-----|
| the **cover** | flips album ↔ artist |
| the **title band** (beside the cover) | **browse** — change what is playing |
| the **room**, top left | the **room selector**, and "the wall" for the whole house |
| the **face name**, top right | the **faces** |
| the **lower band** | the transport bar |
| the **progress row** | **seeks** to that point in the track |
| the **speaker** | mute / unmute |
| the **volume scale** | sets the level — press anywhere on it |

The defined areas work **at rest too** — you do not have to wake the screen first.
Each indicator NAMES what it changes, so the screen explains itself without a
legend.

A panel never appears under the press that summoned it, and a freshly raised panel
ignores presses for half a second — before that, a touch low on the screen raised
the strip beneath the finger and the same touch fell through onto the play button,
which is why music started at random on a touchscreen.

Resting on a face name in the strip switches to it after about a second — no
click or OK needed, and a line fills under the name while it arms so the wait is
visible. Moving away before it completes cancels, so passing over a name costs
nothing. A tap or click applies it immediately.

### ⚖️ On a Samsung TV the D-pad never reaches the browser — use letters

Probed on a 2025 Samsung, 2026-08-25. The browser received keyCodes
`[32, 65–90, 189]` and **nothing else**: no arrows, no Enter, no media keys, no
coloured buttons. The television's own navigation consumes them all before the
page exists. A keyboard, however, reaches it perfectly.

So the controls live on letters whenever a text field does not have focus.
**Search Roon** has a real search field; while it is selected, typing belongs
only to that field and cannot trigger playback, artwork or volume shortcuts:

| Key | Does |
|-----|------|
| `space` or `k` | play / pause |
| `n` | next track |
| `b` | back a track |
| `u` / `d` | volume up / down — **this room's speaker only** |
| `f` / `g` | next / previous face |
| `a` | album ↔ artist artwork |
| `r` | next room |

Arrows and media keys are still mapped for desktop browsers, where nothing
intercepts them. On the TV, pair a cheap USB or Bluetooth keyboard with the set —
or use the on-screen buttons with the remote's pointer.

### If the remote does nothing

Add `?keys=1` to the URL. Every key you press then prints its name and keyCode on
screen, and says whether FlightDeck acted on it:

```
http://192.168.1.114/face/study?keys=1
```

`(no .key) code=39 -> right` means the TV reports only a keyCode, which is
handled. `-> IGNORED` means that key is not one FlightDeck uses — tell the
maintainer the code and it can be mapped.

TV browsers use the D-pad for their own on-page navigation, so FlightDeck listens
in the capture phase on both window and document and calls `preventDefault`, which
stops the page scrolling under you. If arrows still do nothing, the browser is
consuming them before the page sees them at all — try the tap targets instead:
tapping the cover returns to the album view.

`/now` on the end of the URL gives a screen that follows whatever is playing,
instead of pinning one room.

## 5. Why there is no native app

It is not an oversight — the platforms gate it:

- **Samsung Tizen** — a `.wgt` needs a Samsung developer account, and TV dev mode
  expires in about 60 days. Permanent use means submitting to their store.
- **LG webOS** — an `.ipk` needs a dev-mode session that expires in **50 hours**
  and must be renewed by hand. Unusable for a house display.
- **Fire TV / Android TV** — the one platform where an APK is realistic. The PWA
  above gets most of the way; a WebView APK is the remaining step if the icon and
  boot behaviour ever matter more than the effort.

So: browser + short URL + homepage on Samsung and LG, and Fully Kiosk or the PWA
on Fire TV. That is the whole answer, and none of it needs code.
