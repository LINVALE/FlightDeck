# FlightDeck — a living face for every Roon zone

A quick teaser for the community:

FlightDeck is a simple Roon-facing display system for local screens. It gives each room or zone its own persistent “face” instead of relying on Roon’s fragile display session model.

The idea is straightforward:

- each screen owns its own URL and local state
- the server does not hold per-screen session state
- the screen can reconnect and recover itself
- a local house wall shows every room at a glance
- room pages work for both RHEOS rooms and Roon Ready zones

## What it looks like

- `/study` or `/living-room` for a room-level now-playing face
- `/` for a house wall with all zones ordered by recent activity
- user-selectable faces such as Presence, Dial, Classic, Canvas and Libretto
- a local URL like `http://flightdeck/` or `http://flightdeck.local/`

## Why build it

Roon’s Display model is a push session owned by the Core. In practice, those screens often freeze, time out, vanish from the Displays list, and then need a human to recover them.

FlightDeck turns that around:

> A Roon Display is something Roon does to a screen.
> A FlightDeck Face is something a screen does for itself.

The screen owns its face, the URL remains stable, and the client can reopen the stream if the connection goes half-open.

## Why this matters

This is aimed at TVs and local displays where a normal Roon display is not dependable. The goal is a screen that behaves like a proper local dashboard instead of a temporary app session.

## Current status

This is very much a work-in-progress, but the core design and the first pass of the room faces are already in place. The project is intentionally lightweight and built around screen autonomy rather than a server-managed display session.

## Example URLs

- `http://flightdeck/`
- `http://flightdeck.local/`
- `http://<lan-ip>/`
- `http://<lan-ip>/study`

## A note

This is not affiliated with or certified by Roon Labs. It is simply a local, self-owned display layer for people who want zone faces that keep working.

If this is useful, I’m happy to share more screenshots, implementation notes, or the repo/README as it evolves.
