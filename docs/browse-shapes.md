# What Roon's Browse API actually returns

Captured from Nucleus Titan on 2026-08-25 with `scripts/capture-browse.ts`.
Raw payloads in `test/fixtures/browse/`.

Everything here was previously **unverified** — the 08-25 scout found two plausible
call shapes for search and no capture of either anywhere in the RHEOS tree. These
are receipts, not documentation.

## browse then load — always two calls

`browse` returns the LIST (title, count); it does **not** return the items.
`load` returns the items. Every hierarchy behaved this way.

| Hierarchy | List title | Count on this library |
|-----------|-----------|------------------------|
| `browse` | Explore | 7 — Library, Playlists, My Live Radio, Genres, TIDAL, … |
| `genres` | Genres | 56 |
| `albums` | Albums | 2295 |
| `artists` | Artists | 1475 |
| `playlists` | Playlists | 11 |
| `internet_radio` | My Live Radio | 2 |

## ⚖️ Item keys are session-scoped — never cache them

The same items came back as `1:0` on one run and `3:0` on the next. They identify a
position in a server-side stack, not a thing in the library. Cache an `image_key`;
never an `item_key`.

## ⚖️ Search takes `input` directly on the hierarchy

The settled question. **The simpler form is the right one:**

```js
browse({ hierarchy: 'search', popAll: true, input: 'miles davis' })
load({ hierarchy: 'search', count: 12 })
```

returns six items — the best match first, then category buckets:

```
Miles Davis   (hint: list)   <- the top hit
Artists       (hint: list)
Albums        (hint: list)
Composers     (hint: list)
Tracks        (hint: list)
Works         (hint: list)
```

Walking to a root Search item and using its `input_prompt` is **not** required.
Calling `search` with no input returns a single item, `No Results`.

## Search includes Roon's connected catalogue

Captured read-only on Nucleus Titan on 2026-08-31, using a fresh private Browse
session and no `zone_or_output_id`:

```text
Search: Chappell Roan
  Chappell Roan     0 Albums
  Albums            33 Results

Albums
  The Rise and Fall of a Midwest Princess
    Play Album      action_list
    1–14            action_list
```

The artist had zero local-library albums while Roon returned 33 album results and
the complete 14-track action tree. That is the discriminating receipt that the
generic `search` hierarchy includes the catalogue of the services connected in
Roon. FlightDeck does not connect to TIDAL or Qobuz itself and there is no
`include_services` flag: it gives the words to Roon and draws the tree Roon returns.
The probe stopped before selecting any `action_list`, so it changed no playback.

The Browse item contract has no provider/badge field. `title`, `subtitle`, art and
the navigation hint are all Roon supplies here, so the honest UI label is the Roon
catalogue rather than a guessed per-result service badge.

The same distinction was reproduced with `Joe Jackson` on 2026-08-31: Roon's
first shortcut said `1 Album`, while the separate Albums bucket contained 41
results including *Night And Day*, *Body And Soul*, *Look Sharp!*, *Big World*,
*I'm The Man* and the rest of the connected catalogue. FlightDeck therefore
labels the shortcut `my library` and the result buckets `Roon catalogue`; neither
the ordering nor the Roon item keys are changed.

## Hints seen in the wild

- `list` — descend into it with `browse({ itemKey })`
- `action` — selecting it DOES something. `internet_radio`'s stations are
  `action` items, so choosing one starts playback. `zone_or_output_id` decides
  where, which is why a browse call can start music and the route is guarded like
  a control rather than a GET.

## Playing from browse — the chain, captured

```
albums                       -> 2295 items, hint list
  an album                   -> 13 items: "Play Album" then each track, all action_list
    Play Album               -> 4 items, all hint action:
                                Play Now · Add Next · Queue · Start Radio
```

Pressing an `action` item performs it and returns `action: "none"` — there is no
list to draw afterwards, which is why the panel closes rather than waiting.

`zone_or_output_id` on the call decides WHERE it plays, so the panel puts the room
in its title ("Play Album → Study RHEOS"): a screen on a wall is often not the
room the person is standing in, and "Play Now" means something different depending
on which speakers answer.
