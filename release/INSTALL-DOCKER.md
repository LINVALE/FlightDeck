# Running FlightDeck with Docker

The FlightDeck image runs on its own. It is the same image RHEOS's installer adds beside RHEOS, so if you use
RHEOS you already have it: turn it on or off in **Roon → Settings → Extensions → RHEOS → Settings → FlightDeck**.

## What you need

- An always-on Linux host (amd64 or arm64) with Docker Engine and the Compose plugin, on the same LAN as your Roon
  Server. Wired Ethernet is best.
- Port **8440** free on that host. FlightDeck uses only that port. If something already holds it — often another
  FlightDeck — the container logs that the port is in use and stops; it never picks a different port, so two
  FlightDecks can never register as the same Roon extension.

## Install

```bash
mkdir -p ~/flightdeck/data && cd ~/flightdeck
cp /path/to/FlightDeck/release/compose.yaml .
sudo chown 1000:1000 data                                  # the container runs as uid 1000
echo 'FLIGHTDECK_IMAGE=<published image>@sha256:<digest>' > .env
docker compose up -d
```

Then, in Roon: **Settings → Extensions → enable FlightDeck**, and open `http://<host-address>:8440/` on a phone,
tablet or TV browser. `http://flightdeck.local:8440/` works on devices that resolve `.local` names; many TVs do not,
so the address is the dependable one. The step-by-step TV guide is at `/setup`.

## Keep it on your LAN

FlightDeck's pages have no login: anyone who can reach port 8440 can see what is playing and control your zones.
Never forward 8440 through your router or expose it to the internet.

## Update, stop, remove

```bash
echo 'FLIGHTDECK_IMAGE=<new image>@sha256:<new digest>' > .env && docker compose up -d   # update
docker compose down                                                                     # stop
```

`data/` holds the Roon pairing, remembered displays and play history. Keep it to keep them; delete it to start fresh
(Roon will ask you to enable the extension again).

## Switched off by a host

When FlightDeck runs beside a host application such as RHEOS, the host can switch it off by writing
`host-switch.json` into the data folder. FlightDeck then waits — no web page, not registered with Roon — until it is
switched on, and the container still reports healthy. On its own there is no such file, and FlightDeck always runs.
