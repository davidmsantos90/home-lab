#!/usr/bin/env bash
# lab.sh — home lab service manager
# Usage: ./lab.sh <command> [service...]
# If no service is specified, the command is applied to all services.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ALL_SERVICES=(nginx-proxy-manager pihole immich portainer deluge plex jellyfin wg-easy)

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[${1}]${RESET} ${2}"; }
success() { echo -e "${GREEN}[${1}]${RESET} ${2}"; }
warn()    { echo -e "${YELLOW}[${1}]${RESET} ${2}"; }
error()   { echo -e "${RED}[${1}]${RESET} ${2}" >&2; }

# ── Helpers ───────────────────────────────────────────────────────────────────

# Returns 0 if at least one container of the service is running
is_running() {
    local count
    count=$(cd "$SCRIPT_DIR/$1" && docker compose ps --status running -q 2>/dev/null | wc -l)
    [ "$count" -gt 0 ]
}

# Returns 0 if the service directory and compose file exist
service_exists() {
    [ -d "$SCRIPT_DIR/$1" ] && [ -f "$SCRIPT_DIR/$1/compose.yaml" ]
}

# Ensure the shared homelab + macvlan networks exist (created by root compose.yaml)
ensure_networks() {
    if ! docker network inspect homelab &>/dev/null || ! docker network inspect macvlan &>/dev/null; then
        echo -e "${BOLD}Creating shared networks...${RESET}"
        (cd "$SCRIPT_DIR" && docker compose up --no-log-prefix 2>&1 | grep -v "^$" || true)
    fi
}

# Some services (currently only wg-easy) have a one-shot "*-hooks-bootstrap"
# container that configures the main app via its API once its dependency is
# healthy (depends_on: condition: service_healthy). `docker compose up -d`
# can return before that dependency actually reports healthy, leaving the
# one-shot container stuck in "Created" and never actually executed —
# silently skipping its setup with no error. Force-recreate any such
# container after bringing the service up so it's guaranteed to actually
# run, rather than relying on depends_on timing.
run_bootstrap_hooks() {
    local svc=$1
    local hook_services
    hook_services=$(cd "$SCRIPT_DIR/$svc" && docker compose config --services 2>/dev/null | grep -- '-hooks-bootstrap$' || true)
    for hook in $hook_services; do
        info "$svc" "Running one-shot hook: $hook..."
        (cd "$SCRIPT_DIR/$svc" && docker compose up -d --force-recreate "$hook")
    done
}

# ── Commands ──────────────────────────────────────────────────────────────────

cmd_start() {
    local svc=$1
    if is_running "$svc"; then
        warn "$svc" "Already running — skipping"
        return 0
    fi
    ensure_networks
    info "$svc" "Starting..."
    (cd "$SCRIPT_DIR/$svc" && docker compose up -d)
    run_bootstrap_hooks "$svc"
    success "$svc" "Started"
}

cmd_stop() {
    local svc=$1
    if ! is_running "$svc"; then
        warn "$svc" "Already stopped — skipping"
        return 0
    fi
    info "$svc" "Stopping..."
    (cd "$SCRIPT_DIR/$svc" && docker compose down)
    success "$svc" "Stopped"
}

cmd_restart() {
    local svc=$1
    if ! is_running "$svc"; then
        warn "$svc" "Not running — starting instead of restarting"
    else
        info "$svc" "Restarting..."
        (cd "$SCRIPT_DIR/$svc" && docker compose down)
    fi
    ensure_networks
    (cd "$SCRIPT_DIR/$svc" && docker compose up -d)
    run_bootstrap_hooks "$svc"
    success "$svc" "Restarted"
}

cmd_update() {
    local svc=$1
    local was_running=false
    is_running "$svc" && was_running=true

    info "$svc" "Pulling latest images..."
    (cd "$SCRIPT_DIR/$svc" && docker compose pull)

    if $was_running; then
        info "$svc" "Applying update..."
        ensure_networks
        (cd "$SCRIPT_DIR/$svc" && docker compose up -d)
        run_bootstrap_hooks "$svc"
        success "$svc" "Updated and restarted"
    else
        success "$svc" "Images pulled — service is stopped, not starting"
    fi
}

cmd_status() {
    local svc=$1
    echo -e "\n${BOLD}── $svc ──${RESET}"
    if ! is_running "$svc"; then
        warn "$svc" "Stopped"
    else
        (cd "$SCRIPT_DIR/$svc" && docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null \
            || docker compose ps)
    fi
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

usage() {
    echo -e "${BOLD}Usage:${RESET} $0 <command> [service...]"
    echo ""
    echo -e "${BOLD}Commands:${RESET}"
    echo "  start      Start service(s) (skips if already running)"
    echo "  stop       Stop service(s) (skips if already stopped)"
    echo "  restart    Restart service(s) (starts if stopped)"
    echo "  update     Pull latest images and restart if running"
    echo "  status     Show running state of service(s)"
    echo ""
    echo -e "${BOLD}Services:${RESET} ${ALL_SERVICES[*]}"
    echo ""
    echo -e "${BOLD}Examples:${RESET}"
    echo "  $0 status                   # status of all services"
    echo "  $0 start pihole             # start only pihole"
    echo "  $0 update immich jellyfin   # update two services"
    echo "  $0 stop                     # stop all services"
}

if [ $# -lt 1 ]; then
    usage; exit 1
fi

COMMAND=$1; shift

# Validate command
case "$COMMAND" in
    start|stop|restart|update|status) ;;
    help|--help|-h) usage; exit 0 ;;
    *) error "lab" "Unknown command: $COMMAND"; usage; exit 1 ;;
esac

# Resolve target services
if [ $# -eq 0 ]; then
    TARGETS=("${ALL_SERVICES[@]}")
else
    TARGETS=("$@")
fi

# Validate service names
for svc in "${TARGETS[@]}"; do
    if ! service_exists "$svc"; then
        error "lab" "Unknown service: '$svc'"
        echo "  Available: ${ALL_SERVICES[*]}" >&2
        exit 1
    fi
done

# Run command for each target
for svc in "${TARGETS[@]}"; do
    case "$COMMAND" in
        start)     cmd_start     "$svc" ;;
        stop)      cmd_stop      "$svc" ;;
        restart)   cmd_restart   "$svc" ;;
        update)    cmd_update    "$svc" ;;
        status)    cmd_status    "$svc" ;;
    esac
done
