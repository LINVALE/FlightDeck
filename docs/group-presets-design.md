# Group Presets — design

*2026-08-27. Design only; nothing here is built.*

A preset is a named, **ordered** set of rooms that FlightDeck forms on demand and lets go of
when nobody is listening any more. Roon has no such concept; this is entirely ours. The brief,
verbatim: *"forming the group on play and dissolving on long pause (stop)."* So a preset is a
**recipe, not a zone** — pressing it brings the rooms together, and a long-enough silence
returns them to themselves. Between those two moments FlightDeck is an attendant, not an owner
of anything Roon holds: Roon leads, always, and every action below is a Core instruction whose
result comes back on the ordinary zone subscription. Nothing is optimistically applied.

Three measured facts shape everything (all from the live Core, 08-26, recorded in
`reference_roon_extension_api_limits_measured` and `src/model/types.ts`):

1. **Roon will not group across its protocol partition.** Every output carries `island` and
   `groupableWith`; the relation is the taxonomy. A preset lives inside ONE island, checked at
   save time and again at recall time.
2. **`group_outputs(ordered)` preserves the first output's zone's queue** and discards the
   others'. Order is load-bearing: the head is the room whose music the others join.
3. **Roon tears a Squeezebox grouped zone down on every `ungroup_outputs`.** Recall and
   dissolve therefore compute the *minimum* change — recall never ungroups anything, and
   dissolve is ONE call, exactly as `handleControl`'s existing `ungroup` branch already does.

And one fact that shapes nothing: there is no format or resolution information anywhere on
the wire, so presets make no claims about it. A preset cannot warn "this group mixes rates"
because nothing can.

## 0. Grounding against the field

Three platforms shipped close cousins of this (researched 08-27), and the recipe model is
the industry consensus, not an invention: **Sonos** saved groups (2024 app — pick rooms,
name it, the name sits in the grouping sheet, tap to form), **HEOS** Group Presets (2025 —
create from the Rooms tab, one-tap recall, membership editable after), and **Yamaha
MusicCast Room Presets** (long-press a room tile; saves link topology, source AND volumes;
Yamaha's own example is exactly ours — link the house for a party, unlink after, recall
next time). The anti-pattern is equally well established: **BluOS Fixed Groups** are a
persistent single player — elegant, but membership is immutable (delete-and-recreate to
change it) and the group is only as available as its least-available member. That is
essentially what a RHEOS 🔗 zone is, which sharpens the boundary in §2: RHEOS owns the
permanent construct; FlightDeck presets are the mutable, recallable, dissolvable one, and
**a preset is never made into a zone**.

Where this design deliberately differs from all three:

- **Partial-form is documented behaviour, not a shrug.** Not one platform says what
  happens when a member is powered off (Google's docs: "make sure all devices are powered
  on"). Sleep is Tuesday in this house, `src/labels/islands.ts` already solved identity
  under sleep by overlap, and §3/§4 make absence a first-class, reported case. This is the
  most valuable part of the design, not an edge.
- **Auto-dissolve.** None of the three dissolves on its own — they recall and stop there.
  "Dissolving on long pause" is the novel half of the brief, which is exactly why §5's
  guards get the rigour they do.
- **Volumes yes, source no.** MusicCast captures source + volumes; a FlightDeck preset
  captures per-room volumes (§1) but no source — Roon owns the queue and offers no verb to
  save one. The head rule *is* the source semantics: the head's music is what the group
  plays.
- **Two rooms, not three.** Sonos requires 3+ products; the most useful preset in a real
  house is often a pair.

---

## 1. What a preset is on disk

A fourth persistent registry, in the mould of `src/labels/islands.ts` and
`src/displays/registry.ts`: one small JSON file in `DATA_DIR`, loaded tolerantly, written
atomically via temp-and-rename, in-memory-only when the data dir is read-only. Proposed home:
`src/presets/registry.ts`, file `data/group-presets.json`.

```ts
const MAX_PRESETS = 32;
const MAX_NAME = 24;          // same ceiling as an island label

/** The recipe. Everything a person decided; nothing Roon owns. */
interface PresetRecord {
  id: string;                  // 'p1', 'p2', … — counter-minted like island ids
  name: string;                // auto-named from members at save; renamed in Roon Settings
  island: string;              // island id at save time ('i1') — the validity envelope
  /**
   * ORDERED output ids, head first. The head is the room whose queue survives
   * group_outputs; everyone else's is discarded. Output ids are stable across
   * sleep and restart (unlike zone ids), which is why nothing else is stored.
   */
  outputs: string[];
  /** Minutes of continuous silence before auto-dissolve. 0 = never dissolve. */
  dissolveAfterMin: number;    // default 15
  /**
   * Per-output ABSOLUTE volume captured at save — the MusicCast lesson: a preset
   * is "this arrangement", not just "these rooms". Applied ONCE, best-effort,
   * after a recall's snapshot confirms the zone; never enforced afterwards, so a
   * nudge two minutes later is not fought. Outputs with no volume control, or an
   * `incremental` one (no readout, no absolute), are simply absent here and left
   * alone at recall. null = saved before this field existed; touch no volumes.
   */
  volumes: Record<string, number> | null;
}

/**
 * A live claim: proof that a specific group is OURS. Created only by a recall,
 * released only by dissolve or disownment — never inferred from a snapshot.
 */
interface PresetClaim {
  presetId: string;
  /** Exactly what group_outputs was called with, in the order used (the head may
   *  have been promoted if the recipe's head was asleep). */
  formedOutputs: string[];
  headOutput: string;          // formedOutputs[0], named for the log's sake
  formedAt: string;            // ISO — the floor under the silence clock
}
```

```json
{
  "presets": [
    {
      "id": "p1",
      "name": "Downstairs evening",
      "island": "i1",
      "outputs": ["1701abcd…study", "1701abcd…kitchen", "1701abcd…hall"],
      "dissolveAfterMin": 15,
      "volumes": { "1701abcd…study": 42, "1701abcd…kitchen": 35 }
    }
  ],
  "claims": [
    {
      "presetId": "p1",
      "formedOutputs": ["1701abcd…study", "1701abcd…kitchen", "1701abcd…hall"],
      "headOutput": "1701abcd…study",
      "formedAt": "2026-08-27T19:04:11.000Z"
    }
  ]
}
```

Claims are persisted in the same file so a service restart does not orphan a formed group —
FlightDeck must still know, after `systemctl restart flightdeck`, that the "Downstairs
evening" zone is its to dissolve. On load, every claim is re-verified against the first
snapshot (§4); a claim whose group no longer exists is dropped silently.

**Why outputs and not zones:** the same reasoning `src/displays/registry.ts` states for
screens — zone ids are re-minted as groups form and dissolve, output ids stand still. Whether
a formed group keeps the head's `zone_id` or gets a new one is **unmeasured**, and the design
never needs to know: the owned zone is found as *the zone that currently contains the head
output* (§4).

**Why the union-membership trick is NOT copied from islands.ts:** an island is an open-ended
discovery — devices come and go and the record accretes. A preset is a closed statement of
intent — a person chose exactly these rooms — so its membership never grows on its own. What
*is* copied from islands.ts is the sleep lesson: absence from the zone list means asleep, not
gone, and every comparison below tolerates it.

## 2. Not competing with RHEOS

RHEOS fixed groups (`🔗 Garden`, `🔗 Downstairs`, `🔗Outside`) are HEOS-level, permanent,
and owned elsewhere. The reliable discriminator is **structural, not the name**: a RHEOS
fixed group reaches Roon as ONE virtual Squeezebox output, so its zone has
`outputs.length === 1` — it is not a Roon group at all. FlightDeck's existing `ungroup`
branch already refuses single-output zones, and every preset verb inherits the same shape:

- **"Save as preset" is offered only on a zone with two or more outputs.** A 🔗 zone can
  never be saved, because there is nothing Roon-level to save.
- **Dissolve only ever calls `ungroup_outputs` on outputs FlightDeck itself grouped.**
  FlightDeck has no HEOS vocabulary at all, so it structurally cannot touch the HEOS-level
  group inside a 🔗 output.
- A 🔗 output **may be an ordinary preset member** — it lives in the Squeezebox island like
  any other player, and grouping "🔗 Garden + Study" at the Roon level, then releasing it,
  is exactly the legitimate use. Dissolving returns the 🔗 output to its own standalone
  virtual zone, untouched inside.

The 🔗 glyph is kept for the UI (people recognise it) but **never for logic** — the islands
principle "nothing is inferred from a room's name" holds here too.

The division of labour, stated once: a 🔗 zone is the BluOS-style persistent construct —
always there, immutable membership, owned by RHEOS. A FlightDeck preset is everything a
persistent construct cannot be — mutable, recallable, gone when abandoned — and **never
becomes a zone of its own**. The two are complements, not competitors, precisely because
they occupy opposite corners of that trade.

**One accepted limitation, stated honestly:** RHEOS publishes a fixed group's member rooms
as separate players *alongside* the 🔗 zone, and Roon carries no link between them. A person
could therefore build a preset out of the raw members that mirrors a 🔗 group — two paths to
the same speakers, one Roon-level, one HEOS-level. No machine discriminator for that exists
on the Roon wire. Mitigation is at the human layer: the save flow's copy suggests including
the 🔗 room itself rather than rebuilding it, and the picker sorts 🔗 rooms first within
their island. This is documented as a limitation, not solved, because pretending to solve it
with name-matching would be exactly the unreliability islands.ts exists to bury.

## 2a. ⚖️ MEASURED AFTER THIS DESIGN WAS WRITTEN (2026-08-27)

A live experiment on the silent RAAT island, prompted by the survey's completeness critic
noticing that the whole design rested on one JSDoc sentence:

```
group_outputs([Study ROON (paused), M and S (paused)])
  +2s / +5s / +9s -> zone "Study ROON + 1"  state=stopped  nowPlaying: none
ungroup_outputs(both)
  Study ROON  paused   now playing: Instead      <- the head's queue came BACK
  M and S     stopped  now playing: none         <- the joiner's queue was destroyed
```

Three findings, and the first changes this design:

1. **A group formed from a head that is not playing lands `stopped`, shows no
   now-playing at all, and never resumes on its own.** Roon auto-plays a newly grouped
   zone ONLY when its first output was already playing. RHEOS proved the same on
   2026-08-18 across three Downstairs formation cycles, with the no-halt formation as the
   decisive counter-example (`rheos_v2/src/group/preset-formation-pause-recovery.ts`), and
   the canon cure is named there: **ONE ungroup + an explicit Roon-led resume**.
2. The head's queue survives the round trip — it returns, paused, on ungroup.
3. The joiner's queue is destroyed, permanently. Not restored on ungroup.

**Consequence for this design: `andPlay` is not §9.5 polish, it is the core of recall.**
A preset whose promise is "form on play" does not work at all without it, because the
overwhelmingly common case — pressing a preset while the house is quiet — produces a
silent, stopped group. Move it into increment 2, and make its Play the same single gated
Roon-led Play RHEOS already proved on 2026-08-16, not a manufactured Pause→Play (refuted
2026-07-14).

**Consequence for §3's busy-skip:** the "does `group_outputs` steal a playing output"
question stands, but the "does a superset regroup interrupt the playing group" question
now has a partial answer — if the head is playing, Roon carries it; the risk is confined
to what happens to the OTHER members' audio.

## 3. Forming (recall)

Recall is a **pure plan computed from the live snapshot, then at most ONE `group_outputs`
call**. The planner takes (preset, snapshot) and returns (call-or-nothing, report); making it
a pure function is what makes §9's tests cheap and the no-ungroup invariant provable.

Walking the recipe's ordered outputs against the snapshot, each member is one of:

- **Present and free** (standalone zone, or already in the zone the head is in) → included.
- **Asleep** (in no zone at all — the device left Roon's list entirely) → **skipped, and
  said so**. Partial-form is the ruling: on a house of sleepy AVRs, refusing the whole
  preset because one room sleeps makes presets useless, and waiting violates nothing but
  the user's patience — FlightDeck has no wake verb and must not pretend to. (A later
  increment may try the output's `source_controls` standby switch; out of scope here.)
  Alexa is the existence proof that real users accept this: Amazon's documented behaviour
  for a group with unreachable members is to play on the ones it can reach, and a flaky
  member heals in **at the next track boundary**. That seam is cheap on a cloud-stream
  model and is NOT ours: on Roon, a late `group_outputs` disturbs the group's audio, and —
  more fundamentally — a device waking is a device event, not a user gesture, and a device
  must never drive Roon. So the honest promise is: **no mid-session self-heal; a woken
  member waits for the next press of the preset.** That press is cheap because recall is
  idempotent and minimum-change: the planner sees one missing member and emits one
  superset `group_outputs` — whether that superset call interrupts the playing group's
  audio is **UNMEASURED** and is measured in increment 2 before the picker promises
  anything about it.
- **Busy** (currently in a *different multi-output zone*) → **skipped, and said so**. Taking
  it would silence rooms that didn't ask — worse, whether `group_outputs` quietly steals an
  output from an existing zone or requires an ungroup first is **UNMEASURED**, and until it
  is measured (increment 2, §8) no plan may gamble on it. This applies whether the other
  group is playing or idle: pulling a room out of a Squeezebox group tears that zone down.
- **Solo and playing** → **included**. Pressing the preset is the human authorisation, and
  joining a group discards a solo room's queue by Roon's own design. The alternative
  (skip any playing room) was considered and rejected: it makes the most common gesture —
  "music is on in the study, now bring the house in" — do nothing. Recorded as a ruling so
  it is revisited deliberately, not re-derived.

Then the head rule: if the recipe's head is present, it leads. **If the head is asleep or
busy, the first included member is promoted to acting head**, and the report says whose music
now leads ("formed without Study — asleep; Kitchen leads"). If **zero** members are awake and
free, recall refuses with a clear error rather than forming a group of one.

Minimum change, in order of preference:

1. Current zone already equals the plan with the right head → **no call at all**; the claim
   is (re)recorded and the response says "already formed".
2. Otherwise → **one `group_outputs(planned)`**. Never an ungroup, under any circumstance,
   during recall — that is the Squeezebox-teardown rule as a planner invariant, not a code
   comment.

Recall re-validates the island: any member whose current `island` no longer matches the
recipe's (a re-provisioned device) is skipped and reported, because handing Roon a
cross-island list produces the silent refusal `handleControl`'s group branch exists to
prevent.

All of the above is one invariant wearing four hats, named after the platform that gets it
wrong: **a recall never silences a room it was not asked to change** (Google Home stops
playback on *every* member when a casting group's membership is edited). Busy-skip is that
invariant at recall time; and editing a *recipe* — rename, reorder, add or remove a member
in Settings — **touches no live zone at all**, ever, even one the preset currently owns.
A recipe edit takes effect at the next recall, full stop.

After the volumes: once the snapshot confirms the zone, each captured volume is applied
once through the existing per-output `setVolume` — one shot, best-effort, a failure logged
and ignored. Never re-applied, never enforced: the preset sets the stage and then keeps its
hands in its pockets.

**The implicit preset: Everywhere.** Sonos puts "Everywhere" at the top of the grouping
sheet, HEOS binds it to a two-finger pinch, and Amazon auto-creates a group of that name
the moment you own two devices — the gesture is expected furniture. Roon's partition means
"everywhere" can only ever mean "everywhere in this island", so FlightDeck synthesises one
un-stored preset per island: id `everywhere:i1`, name from the island's label ("Everywhere
in RHEOS"), membership = the island's currently awake outputs, **head = the room whose
badge was pressed** — everyone comes to *this* room's music, which is the only head rule
that makes sense for a preset with no saved order. It runs through the same planner, the
same claim, the same dissolve; it merely has no row on disk and cannot be renamed or
deleted. Apple Home, for contrast, refuses persistent audio groups entirely and re-asks
per session — a defensible position FlightDeck already covers with the badge picker, and
rejects for the rest because the same arrangement recurs nightly, a TV remote makes
re-picking painful, and auto-dissolve is precisely the answer to the staleness that makes
persistent groups scary.

**Form-and-play:** the brief says "forming the group on play", so the recall verb takes an
optional `andPlay`. After the snapshot confirms the group (not before — nothing optimistic),
FlightDeck sends `control(zone, 'play')` to the Core exactly as any button press does. Roon
leads; the preset merely presses play on the user's behalf.

## 4. Ownership

**A claim is created only by a recall and is never inferred.** A group the user made by hand
through the badge picker, the Roon app, or anything else is never FlightDeck's to dissolve,
even if it happens to match a recipe exactly. This is the whole defence against the worst
failure mode (§6.1/6.2): FlightDeck can only kill what it can prove it started.

On every snapshot, each claim is re-verified. The owned zone is *the zone containing
`headOutput`* — and if the head itself has gone to sleep (whether a Roon group survives
its head sleeping is **unmeasured**; increment 3 measures it), the fallback is the
islands.ts move: the multi-output zone with the **largest overlap** of `formedOutputs`,
any overlap at all being unambiguous because the formed outputs were disjoint from every
other claim. Compare the owned zone's outputs to `formedOutputs`:

- **A formed output missing from the owned zone but present in some OTHER zone** → a person
  deliberately removed it → **DISOWNED**. Their arrangement, their rules.
- **A formed output missing from every zone** → asleep, not removed (the islands.ts lesson)
  → still owned. It is not chased when it wakes; it simply rejoins nothing.
- **An output in the owned zone that FlightDeck did not form** → a person added a room by
  hand → **DISOWNED**. They have taken over; the dissolve timer must never fire on a group
  that is now partly theirs.
- **The head output standing alone, or the zone gone** → the group has already dissolved
  (by hand, or by Roon) → claim released, back to idle. No action; the world already agrees.

DISOWNED is terminal for a claim: FlightDeck stops all timers, keeps its hands off, and the
claim is dropped once the zone naturally ceases to match anything. Ownership is never
regained except by a fresh recall.

RHEOS ownership needs no rule here because it cannot arise: a 🔗 zone is single-output and a
claim's zone always has ≥2 formed outputs behind it.

## 5. Dissolving

"A long pause" is defined precisely:

- **The clock**: continuous not-playing on the owned zone, measured as
  `now − max(claim.formedAt, zone.lastPlayedAt)` — `lastPlayedAt` is already kept per zone by
  `src/ledger/recent.ts` for the Wall, stamped from FlightDeck's own snapshot stream. The
  `formedAt` floor means a group formed and never played still dissolves, and a restart can
  never make the clock read *older* than the evidence.
- **The threshold**: `dissolveAfterMin`, **default 15 minutes**, per preset, settable in Roon
  Settings (0 = never). Fifteen because every innocent silence is an order of magnitude
  shorter, and a group abandoned at night should be gone before morning.
- **A track gap** never trips it: between tracks the zone is `playing` or `loading`, both of
  which count as playing and keep `lastPlayedAt` current. The timer only accumulates on
  `paused`/`stopped`.
- **A seek** never trips it: any momentary state blip is seconds against a 15-minute
  threshold, and the first `playing` frame resets the clock to zero.
- **A deliberate two-minute pause** never trips it: 2 ≪ 15. And any control gesture routed
  through FlightDeck at the owned zone (transport, volume, seek) resets the countdown —
  someone touching the group is someone still there. (Gestures made in the Roon app are
  invisible except as state changes; the design errs long, never short.)
- **A person who regrouped by hand meanwhile**: the claim went DISOWNED the moment the
  membership drifted (§4), so the timer is already dead. The preset does not own that group
  any more, full stop.

Because a silent house emits no zone events, expiry cannot ride the snapshot stream alone: a
coarse **60-second tick** (alongside main.ts's existing heartbeat/seek/flush intervals)
re-evaluates claims. The countdown is *derived state* — recomputed from evidence on every
look, never a free-running `setTimeout` that a restart or a suspend could leave stale.

**At the instant of firing, four guards, all from the live snapshot, all required:**

1. the claim is still held (membership exact, sleepers tolerated per §4);
2. the owned zone's state is not `playing` and not `loading`;
3. the silence clock genuinely reads ≥ threshold;
4. the Core is paired.

Any guard failing aborts the dissolve and, for guard 2, resets the clock. Then: **ONE
`ungroup_outputs` with the owned zone's CURRENT outputs — never the claim's
`formedOutputs`** — one call for the whole set, as the existing branch insists, because
repeated calls are repeated damage. The current-not-formed distinction is load-bearing:
Roon cannot ungroup a group while a member is offline, and a sleeping member has already
left the zone's output list — so the call, by construction, names only outputs Roon can
see. A dissolve therefore never strands on a sleeper; naming `formedOutputs` instead would
hand Roon an offline id and strand exactly the groups this feature abandons overnight.
The claim is released when the snapshot confirms the split.

A wrong dissolve silently kills someone's music; these guards are why it cannot. The dissolve
only ever touches a group FlightDeck formed, whose membership nobody has adjusted, in which
nothing has played for a quarter of an hour, checked again at the moment of action. What it
*costs* even when right: on Squeezebox, teardown means the paused position does not survive —
the standalone head keeps its queue but resume-where-you-were may not. Acceptable for a group
fifteen minutes silent, and stated here so it is never re-litigated as a bug.

**Restart**: claims reload and re-verify (§4). The silence clock rebuilds from
`max(formedAt, lastPlayedAt, process start)` — the process-start floor means a restart can
only lengthen a countdown, never shorten it. Fail long, never short.

## 6. The state machine

Per preset. Transitions are driven by the snapshot stream (`republish()` in `src/main.ts`)
plus one 60 s tick; the only wall-clock quantities are the two watchdogs and the derived
silence clock.

```
                         recall pressed
  ┌────────┐  (plan computed; ≥1 member; ONE     ┌───────────┐
  │  IDLE  │──group_outputs, or no-op if equal──▶│  FORMING  │
  │        │                                     │ watchdog  │
  │ recipe │◀── plan empty: refuse, report ──────│   10 s    │
  └────────┘                                     └───────────┘
      ▲  ▲                                         │        │
      │  │                        snapshot shows   │        │ watchdog fires /
      │  │                        head's zone ⊇    │        │ Core error:
      │  │                        planned outputs  │        │ report, no claim
      │  │                                         ▼        ▼
      │  │                                   ┌──────────┐  IDLE (with report)
      │  │        state playing/loading      │  FORMED  │
      │  │      ┌───────────────────────────▶│  (owned, │──── membership drift:
      │  │      │                            │  playing)│     hand-add / hand-remove
      │  │      │    state paused/stopped    └──────────┘     (§4 discriminator)
      │  │      │  ┌─────────────────────────────┘  │              │
      │  │      │  ▼                                │              ▼
      │  │   ┌──────────┐                           │        ┌───────────┐
      │  │   │ DRAINING │── any FlightDeck gesture ─┘        │ DISOWNED  │
      │  │   │ (owned,  │   at the zone, or playing:         │ (passive; │
      │  │   │  silent; │   clock resets, back to FORMED     │ no timers)│
      │  │   │ clock    │                                    └───────────┘
      │  │   │ derived, │── membership drift ──▶ DISOWNED          │
      │  │   │ 60s tick)│                              zone ceases │
      │  │   └──────────┘                              to match:   │
      │  │        │ clock ≥ dissolveAfterMin           claim drops ▼
      │  │        │ AND all four fire-guards          IDLE
      │  │        ▼
      │  │   ┌────────────┐
      │  │   │ DISSOLVING │── snapshot confirms split: claim released
      │  └───│ watchdog   │──────────────────────────────────────────▶ IDLE
      │      │   10 s     │
      │      └────────────┘
      │            │ watchdog fires: DO NOT retry (repeated ungroup =
      └────────────│ repeated damage) ──▶ DISOWNED, logged
                   ▼
        (head alone / zone gone at any owned state = already
         dissolved by hand or by Roon: claim released ──▶ IDLE)
```

Timers, complete list: **FORM watchdog 10 s** (call acknowledged but zone never appears →
report failure, hold no claim); **DISSOLVE watchdog 10 s** (split never appears → DISOWNED,
never a second call); **silence clock** (derived, threshold `dissolveAfterMin`, evaluated on
every snapshot and on the 60 s tick); the **60 s tick** itself. Claims are disjoint by
construction: a recall whose plan overlaps another claim's `formedOutputs` treats those rooms
as busy (§3) — two presets cannot fight over a speaker.

## 7. Failure modes, ranked

1. **Dissolve fires while music plays** — the cardinal sin; a room goes silent mid-song with
   no one having touched anything. Prevented by fire-guard 2 (live state re-check at the
   instant of action) plus the clock reset on every `playing` frame. *Seen if broken:* music
   stops dead, rooms split, nothing in any app explains it.
2. **Dissolve of a hand-modified group** — someone built on our group and we knocked it
   down. Prevented by the DISOWNED discriminator (§4): any add, or any remove-to-elsewhere,
   kills the claim permanently. *Seen if broken:* the group you adjusted an hour ago has
   quietly disintegrated.
3. **Recall silences another room** — pressing "Downstairs evening" steals the kitchen from
   a playing bedroom group. Prevented by the busy-skip rule; doubly prevented because
   steal-behaviour is unmeasured and the planner refuses to gamble. *Seen if broken:*
   pressing a preset here stops music there.
4. **Recall tears down a Squeezebox zone** via a "tidy up first" ungroup. Prevented by the
   planner invariant: recall has no ungroup path at all. *Seen if broken:* a stutter or full
   stop in every room of an existing group whenever a preset is pressed.
5. **Restart shortens a countdown** — a reboot at minute 14 must not dissolve at minute 15.
   Prevented by the process-start floor: restart always re-arms the full window. *Seen if
   broken:* groups vanish suspiciously soon after any service restart.
6. **Dissolve strands on a sleeper** — Roon cannot ungroup while a member is offline, so a
   dissolve that names an absent output leaves the group standing forever. Prevented by
   construction: the call names the zone's *current* outputs, which a sleeper has already
   left (§5). *Seen if broken:* the abandoned evening group is still there in the morning,
   every morning.
7. **Cross-island drift** — a re-provisioned device makes the recipe unformable and Roon
   refuses silently. Prevented by recall-time re-validation with a spoken report ("Hall is
   on a different connection now — skipped"). *Seen if broken:* pressing the preset does
   nothing, no message, ever.
8. **Head asleep → wrong music leads** — the others join the kitchen's queue, not the
   study's. Mitigated, not prevented: promotion is reported in the response and the log.
   *Seen:* the group plays, but the wrong room's queue.
9. **🔗 duplication** — a preset rebuilt from a fixed group's member rooms rides over the
   HEOS-level group. Not machine-detectable (§2); mitigated by save-flow copy and picker
   ordering. *Seen if hit:* RHEOS and Roon disagree about who is grouping the garden;
   behaviour belongs to RHEOS's domain.
10. **A captured volume fails to apply** — one output refuses its saved level. Deliberately
    minor: one-shot, best-effort, logged, never retried (a retry loop on volume is how a
    house learns to fear its own remote). *Seen:* one room a notch off; a thumb fixes it.
11. **Core unpaired mid-anything** — guard 4 and the no-snapshot-no-action rule freeze all
    claims; they re-verify on re-pair. *Seen:* nothing; that is the point.

## 8. Where it lives in the UI

All three surfaces, with different jobs — creation where the group already is, recall where
rooms are handled, administration where there is a keyboard:

- **The room badge picker** (`group… | ungroup | send to…`) gains the recall surface: the
  island's presets listed above the room list, each drawn the way rooms already are (sleeve,
  name, member count), with skipped-member counts when partial ("Downstairs evening · 2 of 3
  awake"), and **Everywhere** (§3) pinned first. A zone with ≥2 outputs additionally offers
  **"save this group as a preset"** — auto-named from its members, no typing, which answers
  the handover's "naming on a TV is the awkward part."
- **The Wall**: a formed preset's tile wears the preset's name as a badge, so a glance says
  the group is a preset and which one. Draining is not drawn — a countdown on a wall invites
  watching it.
- **Roon Settings** (the page `src/roon/extension.ts` already provides — no registration
  change, so no parking): a presets section beside the island-naming one. Rename with a real
  keyboard, set dissolve minutes, delete. Exactly the islands pattern: the TV states intent,
  the Settings page curates it.
- **Faces**: nothing. A face is something a screen does for itself; presets are a house
  gesture.

One door left open, not built: Siri's **pull verb** — "play music from the kitchen here."
FlightDeck has the push (`send to…`); a display bound to an output is the natural surface
for the inverse, and the machinery is already on the shelf: recall forms the group with
*this* room as head, then the existing `transferZone` moves the kitchen's music into it,
queue and position intact. Nothing in this design forecloses it — the planner takes a head
parameter (Everywhere already needs one) and transfer is a separate, ordinary Core verb
after formation. Noted; no more.

## 9. Build order

Each increment ships something verifiable on the live Core alone.

1. **Registry + save + list.** `src/presets/registry.ts`, `preset-save` on a ≥2-output zone
   (island recorded, order = zone's current order, auto-name), presets in the snapshot, the
   Roon Settings section for rename/delete. *Verify:* save the live Study group, restart the
   service, it is still listed and renameable; a 🔗 zone refuses to save.
2. **Recall.** The pure planner + `preset-recall` + picker entries. **Includes two
   measurements**, answered on the silent RAAT island and recorded in the planner's
   comments: does `group_outputs` steal an output from an existing zone? and does a
   superset `group_outputs` (the woken-member re-press, §3) interrupt the playing group's
   audio? — until answered, busy-skip stands and the picker promises nothing about
   healing. *Verify:* press on the RAAT island → group forms, head's queue survives; press
   again → "already formed", zero calls; sleep a member, press → partial-form with the
   report.
3. **Claims + ownership.** Persistence, the §4 discriminator (including the head-asleep
   overlap fallback), DISOWNED, status in the snapshot, the Wall badge. No timers yet.
   **Third measurement**: does a Roon group survive its head sleeping? *Verify:* form,
   hand-add a room in Roon → badge drops, log says disowned; hand-ungroup → claim
   releases; restart mid-claim → claim survives and re-verifies.
4. **Auto-dissolve.** The silence clock, the 60 s tick, the four guards, the single-call
   current-outputs dissolve, the watchdog-to-DISOWNED rule. *Verify:* form, play, pause,
   wait the threshold (set to 2 min for the test) → one ungroup, rooms standalone; pause
   then resume at minute 1 → nothing; pause then hand-add a room → nothing, ever; sleep a
   member, then let it expire → still dissolves cleanly (failure 6, live).
5. **Polish.** `andPlay`, captured volumes applied at recall, the synthetic Everywhere
   preset, per-preset minutes in Settings, skipped-member copy, picker ordering that
   favours 🔗 rooms. Then the 2 h soak the handover already owes the rest of FlightDeck,
   with a preset formed and abandoned overnight.

## 10. What to test

Unit, in the style of `test/islands.test.ts`:

- **Registry**: tolerant load (missing file, corrupt JSON, wrong shapes), atomic save,
  MAX_PRESETS/MAX_NAME ceilings, read-only data dir degrades to in-memory.
- **Save validation**: cross-island membership refused; single-output zone refused (the 🔗
  guard, failure 8's only testable edge); duplicate names allowed (ids, not names, are
  identity).
- **The planner (pure)**: given (preset, snapshot fixtures) assert the exact call list —
  no-op when already formed (failure 4's cousin); busy members skipped (**catches 3**);
  sleepers skipped with report; head promotion (**catches 8**); zero-awake refusal;
  cross-island member skipped with report (**catches 7**); the woken-member re-press emits
  exactly one superset call; the synthetic Everywhere plan (pressing room leads, sleepers
  absent, no disk row); and the invariant test that the planner's output type *cannot
  express* an ungroup (**catches 4**).
- **Ownership discriminator**: sleep vs hand-removal vs hand-add fixtures (**catches 2**);
  head-asleep resolution by overlap; head-alone and zone-gone release;
  overlap-with-existing-claim treated busy.
- **Dissolve guards**: expiry with state `playing` aborts and resets (**catches 1**); expiry
  after drift does nothing (**catches 2** again, at the last line of defence); expiry with a
  member asleep still fires, and the emitted call names only the zone's current outputs —
  never the sleeper's id (**catches 6**); clock math from `formedAt` vs `lastPlayedAt`; the
  restart floor never shortens (**catches 5**); dissolve watchdog goes DISOWNED and provably
  never calls twice.
- **Volumes**: applied once after confirmation; an output with no volume control or an
  `incremental` one is skipped; a failed set is logged and not retried (**catches 10**);
  a `volumes: null` legacy record touches nothing.
- **End-to-end** (`test/server.e2e.test.ts` pattern): `preset-save` → `preset-recall` →
  snapshot shows claim → simulated drift → DISOWNED, against fixture snapshots.

Live, before any of it is called done: the RAAT-island form/dissolve pass from §9, and one
overnight abandonment — because the failure this feature must never have is the one that
happens at minute 15 when nobody is watching.
