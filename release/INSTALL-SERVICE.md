# Running FlightDeck on port 80

Only `:80` satisfies "reachable by name, not port" — a browser given a bare
hostname always means `:80`, and no browser reads the DNS-SD SRV record to find
out otherwise.

Binding it needs one privileged step. This unit grants **only**
`CAP_NET_BIND_SERVICE`, to **only** the FlightDeck process, still running as
`peter` and with `NoNewPrivileges=yes`.

> Do NOT use `setcap cap_net_bind_service=+ep /usr/bin/node` instead. That grants
> the capability to *every* node process on the box — the RHEOS fleet included.

## Install

`data/` and `logs/` must exist before the first start — the unit lists them in
`ReadWritePaths`, and systemd refuses to start a service whose ReadWritePath is
missing:

```bash
mkdir -p ~/dev/FlightDeck/data ~/dev/FlightDeck/logs
```

Stop the launcher-run copy first, so the two do not fight over the port:

```bash
cd ~/dev/FlightDeck && ./flightdeck-launch.sh stop
```

Then:

```bash
sudo cp ~/dev/FlightDeck/release/flightdeck.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now flightdeck
```



## Stop needing sudo to restart it

Every change under `src/` needs a restart, and typing `sudo` each time is the
friction that makes people stop restarting. Install the polkit rule once:

```bash
sudo cp ~/dev/FlightDeck/release/50-flightdeck.rules /etc/polkit-1/rules.d/
```

That is scoped to **this unit and this user**, and grants nothing else. Afterwards:

```bash
systemctl restart flightdeck      # no sudo, no prompt
./flightdeck-launch.sh restart    # drives systemd for you
```

The VSCode task **FlightDeck: Restart** then works with no password prompt.

## The service and the launcher must never both run

Installing the unit makes systemd the owner. `flightdeck-launch.sh` now refuses
to start while the service is active, and `status` reports the service instead —
because on 2026-08-25 a VSCode task started a second copy on `:8440` beside the
service on `:80`, and both registered with Roon under the same `extension_id`.

```
$ ./flightdeck-launch.sh start
REFUSING to start: the systemd service already owns FlightDeck.
```

**After any change under `src/`:** `sudo systemctl restart flightdeck`.
Changes under `assets/` are served from disk — a browser refresh is enough.

## Check

```bash
systemctl status flightdeck --no-pager
curl -s http://127.0.0.1/api/v1/health | head -c 200
```

The health payload names the bound port. Expect `"port": 80` and
`http://flightdeck.local/` with no port suffix.

## Afterwards

The service and `flightdeck-launch.sh` must never run together — both bind the
same port. With the service installed, use systemd:

```bash
sudo systemctl restart flightdeck
sudo systemctl stop flightdeck
journalctl -u flightdeck -f          # or: tail -f ~/dev/FlightDeck/logs/flightdeck.log
```

To go back to the launcher: `sudo systemctl disable --now flightdeck`.

## After a node upgrade

`ExecStart` carries an absolute, version-bearing nvm path, because a service has
no nvm shims. After upgrading node, repoint it or the unit will not start:

```bash
readlink -f "$(which node)"
sudo sed -i "s|^ExecStart=.*node |ExecStart=$(readlink -f "$(which node)") |" /etc/systemd/system/flightdeck.service
sudo systemctl daemon-reload && sudo systemctl restart flightdeck
```

## If :80 is already taken

Something else on the host owns it (a NAS UI, Pi-hole, another web server):

```bash
ss -ltnp | grep ':80 '
```

FlightDeck falls back to `:8440` on its own and says so in the log, so it keeps
working — you just keep the port in the URL.
