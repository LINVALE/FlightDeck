#!/usr/bin/env bash
# Lifecycle wrapper for FlightDeck, shaped after rheos-launch.sh so the muscle
# memory carries over.
#
# It only ever stops a process it started, identified by a pidfile AND verified
# to still be FlightDeck. It never does a broad process-name kill: a pattern like
# `pkill -f src/main.ts` also matches the shell running it, which is exactly how
# a session on 2026-08-25 kept killing its own terminal.

set -euo pipefail

FD_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$FD_DIR"

LOG_DIR="$FD_DIR/logs"
PID_FILE="$LOG_DIR/flightdeck.pid"
LOG_FILE="$LOG_DIR/flightdeck.log"
MAIN="$FD_DIR/src/main.ts"
STOP_WAIT_TICKS=20   # 10s

mkdir -p "$LOG_DIR"

: "${FLIGHTDECK_DATA:=$FD_DIR/data}"
: "${FLIGHTDECK_NAME:=flightdeck}"
export FLIGHTDECK_DATA FLIGHTDECK_NAME
# Browse changes the registration Roon holds on file, so Roon parks the extension
# until a human re-enables it in Settings. Opt in deliberately, never by default.
: "${FLIGHTDECK_BROWSE:=0}"
export FLIGHTDECK_BROWSE

running_pid() {
    [ -f "$PID_FILE" ] || return 1
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    # Verify it is actually ours before we ever signal it: a recycled PID
    # belonging to something else must never be killed.
    grep -qa "main.ts" "/proc/$pid/cmdline" 2>/dev/null || return 1
    echo "$pid"
}

# The systemd unit is the AUTHORITATIVE owner when it is installed and running.
# Two FlightDecks must never run at once: they register with Roon under the SAME
# extension_id, so the Core sees one identity flapping between two processes —
# and only one of them can hold the port. This happened for real on 2026-08-25,
# when a VSCode task started a second copy on :8440 beside the service on :80.
service_active() {
    command -v systemctl >/dev/null 2>&1 || return 1
    systemctl is-active --quiet flightdeck 2>/dev/null
}

port_holder() {
    ss -ltnp 2>/dev/null | grep -oP ":${1}\s.*pid=\K[0-9]+" | head -1
}

bound_port() {
    local pid="$1" p
    for p in 80 8440 8441; do
        if [ "$(port_holder "$p")" = "$pid" ]; then echo "$p"; return 0; fi
    done
    return 1
}

cmd_start() {
    if service_active; then
        echo "REFUSING to start: the systemd service already owns FlightDeck."
        echo
        systemctl status flightdeck --no-pager 2>/dev/null | sed -n '1,4p'
        echo
        echo "  use it:      sudo systemctl restart flightdeck"
        echo "  watch it:    journalctl -u flightdeck -f"
        echo "  hand back:   sudo systemctl disable --now flightdeck   (then this script again)"
        return 1
    fi
    if pid="$(running_pid)"; then
        echo "FlightDeck already running (pid $pid)"
        cmd_status
        return 0
    fi
    # A stale pidfile from a crash must not block a start.
    rm -f "$PID_FILE"

    for p in 80 8440; do
        holder="$(port_holder "$p" || true)"
        if [ -n "$holder" ]; then
            echo "note: port $p is held by pid $holder ($(ps -p "$holder" -o comm= 2>/dev/null || echo unknown))"
        fi
    done

    echo "starting FlightDeck (browse=$FLIGHTDECK_BROWSE)…"
    nohup node "$MAIN" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 3
    if ! pid="$(running_pid)"; then
        echo "FAILED to start — last lines:"
        tail -n 15 "$LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
    cmd_status
}

cmd_stop() {
    if service_active && ! running_pid >/dev/null 2>&1; then
        echo "FlightDeck is run by systemd, not by this script."
        echo "  stop it:  sudo systemctl stop flightdeck"
        return 1
    fi
    if ! pid="$(running_pid)"; then
        # Still report a squatter, because "stopped" while something holds the
        # port is the confusing state.
        holder="$(port_holder 8440 || true)"
        if [ -n "$holder" ]; then
            echo "not running from this pidfile, but pid $holder holds :8440"
            echo "  inspect:  ps -p $holder -o pid,etime,args"
            return 1
        fi
        echo "not running"
        rm -f "$PID_FILE"
        return 0
    fi
    echo "stopping FlightDeck (pid $pid)…"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq "$STOP_WAIT_TICKS"); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
        echo "did not exit in time; sending SIGKILL"
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$PID_FILE"
    echo "stopped"
}

cmd_status() {
    if service_active && ! running_pid >/dev/null 2>&1; then
        local sport
        sport="$(curl -s --max-time 2 http://127.0.0.1/api/v1/health 2>/dev/null | grep -o '"port":[0-9]*' | cut -d: -f2)"
        echo "FlightDeck  RUNNING (systemd)${sport:+  port $sport}"
        echo "  managed by: systemctl {start,stop,restart} flightdeck  (needs sudo)"
        echo "  logs      : journalctl -u flightdeck -f"
        [ -n "$sport" ] && echo "  reach     : http://flightdeck.local${sport:+$([ "$sport" = 80 ] && echo "" || echo ":$sport")}/"
        return 0
    fi
    if pid="$(running_pid)"; then
        port="$(bound_port "$pid" || echo '?')"
        printf 'FlightDeck  RUNNING  pid %s  up %s  port %s\n' \
            "$pid" "$(ps -p "$pid" -o etime= 2>/dev/null | tr -d ' ')" "$port"
        if [ "$port" != "?" ]; then
            curl -s --max-time 3 "http://127.0.0.1:$port/api/v1/health" \
              | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("  health: no answer"); raise SystemExit
b = d.get("browse") or {}
m = d.get("mdns") or {}
print("  core     :", "paired" if d.get("revision") else "not paired yet")
print("  clients  :", d.get("clients"), " revision:", d.get("revision"))
print("  browse   :", "granted" if b.get("granted") else ("requested, awaiting approval in Roon" if b.get("requested") else "off"))
print("  name     :", m.get("name"), "->", ", ".join(m.get("addresses") or []))
for u in d.get("urls") or []:
    print("  reach    :", u)
' 2>/dev/null || echo "  health: unavailable"
        fi
    else
        holder="$(port_holder 8440 || true)"
        if [ -n "$holder" ]; then
            echo "FlightDeck  NOT RUNNING (from this pidfile) — but pid $holder holds :8440"
            ps -p "$holder" -o pid,etime,args --no-headers 2>/dev/null | sed 's/^/  /'
        else
            echo "FlightDeck  STOPPED"
        fi
    fi
}

cmd_tail() { tail -n "${2:-40}" -f "$LOG_FILE"; }

case "${1:-status}" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    restart)
        # When systemd owns FlightDeck, restart THROUGH it rather than refusing.
        # With release/50-flightdeck.rules installed this needs no sudo at all.
        if service_active; then
            echo "restarting the systemd service…"
            if systemctl restart flightdeck 2>/dev/null; then
                sleep 3; cmd_status
            else
                echo "could not restart without elevation. Either:"
                echo "  sudo systemctl restart flightdeck"
                echo "  or install the polkit rule once, and this stops asking:"
                echo "    sudo cp $FD_DIR/release/50-flightdeck.rules /etc/polkit-1/rules.d/"
                exit 1
            fi
        else
            cmd_stop || true; cmd_start
        fi ;;
    status)  cmd_status ;;
    tail|log|logs) cmd_tail "$@" ;;
    browse)  FLIGHTDECK_BROWSE=1 export FLIGHTDECK_BROWSE; cmd_stop || true; FLIGHTDECK_BROWSE=1 cmd_start ;;
    *)
        echo "usage: $0 {start|stop|restart|status|tail|browse}"
        echo "  browse  restart with the Roon Browse service requested"
        echo "          (then re-enable FlightDeck in Roon -> Settings -> Extensions)"
        exit 2 ;;
esac
