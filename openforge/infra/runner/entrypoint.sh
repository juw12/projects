#!/usr/bin/env bash
# =============================================================================
# OpenForge CI Runner entrypoint
# - Starts the inner Docker daemon (DinD) with runsc configured
# - Waits for /var/run/docker.sock to come up
# - Registers this runner with the OpenForge API
# - Starts the heartbeat loop (every 30s, auto-rotates token)
# - Starts the job pickup loop (polls API for the next job)
# - For each job, launches a gVisor-sandboxed container with:
#     --runtime=runsc  --read-only  --network=none  --rm
# - Streams container stdout/stderr back to the API in 64KB chunks
#
# Signal handling: SIGTERM/SIGINT trigger graceful shutdown — stop the
# heartbeat/pickup loops, kill the in-flight job, then stop dockerd.
# =============================================================================

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Logging helpers — write to stdout (compose picks them up)
# ---------------------------------------------------------------------------
log()  { printf '%s [runner] %s\n'  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
err()  { printf '%s [runner] ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
audit(){ printf '%s [audit] %s\n'  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# ---------------------------------------------------------------------------
# Required environment
# ---------------------------------------------------------------------------
: "${OPENFORGE_API_URL:?OPENFORGE_API_URL must be set (e.g. http://api:8787)}"
: "${RUNNER_TOKEN:?RUNNER_TOKEN must be set — generate with: openssl rand -hex 32}"
: "${RUNNER_NAME:-runner-local}"

RUNNER_LABELS="${RUNNER_LABELS:-linux,x64,gvisor}"
RUNNER_CONCURRENCY="${RUNNER_CONCURRENCY:-2}"
DOCKERD_PIDFILE="/var/run/dockerd.pid"
DOCKERD_LOG="/var/log/openforge/dockerd.log"
RUNNER_LOG="/var/log/openforge/runner.log"

mkdir -p "$(dirname "$DOCKERD_LOG")" "$(dirname "$RUNNER_LOG")"

# ---------------------------------------------------------------------------
# 1. Start the inner Docker daemon
# We background it as root (the only user that can), then drop to 'runner'
# for the daemon process. The non-root 'runner' user has sudo rights ONLY
# for the dockerd binary — it never gains a root shell.
# ---------------------------------------------------------------------------
start_dockerd() {
  if [ -S /var/run/docker.sock ]; then
    log "Docker socket already present, skipping dockerd start"
    return 0
  fi

  log "Starting inner Docker daemon (DinD)..."
  # We are 'runner' (non-root); dockerd needs root, so escalate via sudo.
  # --host=unix:///var/run/docker.sock — bind inside the container.
  # --iptables=false — runsc manages netns directly; iptables conflict.
  # --bridge=none       — we never use bridge networking (jobs use --network=none).
  sudo -- /usr/local/bin/dockerd \
        --host=unix:///var/run/docker.sock \
        --iptables=false \
        --bridge=none \
        --storage-driver=overlay2 \
        --pidfile="$DOCKERD_PIDFILE" \
        >>"$DOCKERD_LOG" 2>&1 &
  DOCKERD_PID=$!

  # Wait for the socket (max 30s)
  for i in $(seq 1 60); do
    if [ -S /var/run/docker.sock ]; then
      log "Docker daemon up (pid=$DOCKERD_PID, waited ${i}*500ms)"
      return 0
    fi
    sleep 0.5
  done

  err "Docker daemon failed to start within 30s. Tail of log:"
  tail -n 50 "$DOCKERD_LOG" >&2 || true
  return 1
}

# ---------------------------------------------------------------------------
# 2. Wait for the OpenForge API to be reachable
# -----------------------------------------------------------------------
wait_for_api() {
  log "Waiting for OpenForge API at $OPENFORGE_API_URL ..."
  for i in $(seq 1 60); do
    if curl -fsS --max-time 2 "$OPENFORGE_API_URL/api/healthz" >/dev/null 2>&1; then
      log "API is healthy (attempt $i)"
      return 0
    fi
    sleep 1
  done
  err "API never came up at $OPENFORGE_API_URL"
  return 1
}

# ---------------------------------------------------------------------------
# 3. Verify gVisor runsc is wired up
# A failed registration here is FATAL — running untrusted code without
# the sandbox would be the exact failure mode that bit Chia Network.
# ---------------------------------------------------------------------------
verify_gvisor() {
  log "Verifying gVisor runsc runtime..."
  if ! /usr/local/bin/runsc --version >/dev/null 2>&1; then
    err "runsc binary not executable"; return 1
  fi
  if ! docker info --format '{{json .Runtimes}}' 2>/dev/null \
       | grep -q '"runsc"'; then
    err "runsc runtime NOT registered with Docker daemon"
    return 1
  fi
  log "gVisor runsc OK: $(/usr/local/bin/runsc --version 2>&1 | head -n1)"
}

# ---------------------------------------------------------------------------
# 4. Launch the runner daemon
# We exec into Bun so signals reach the process. The TS code handles
# SIGTERM gracefully — finishes the current job (up to timeout), then exits.
# ---------------------------------------------------------------------------
launch_runner() {
  log "Starting runner daemon (bun, labels=$RUNNER_LABELS, concurrency=$RUNNER_CONCURRENCY)"
  audit "runner_start name=$RUNNER_NAME labels=$RUNNER_LABELS concurrency=$RUNNER_CONCURRENCY"
  cd /app
  exec bun run src/runner.ts
}

# ---------------------------------------------------------------------------
# Signal handling
# ---------------------------------------------------------------------------
shutdown() {
  local sig="$1"
  log "Received $sig — shutting down gracefully"
  audit "runner_stop signal=$sig"
  if [ -n "${DOCKERD_PID:-}" ] && kill -0 "$DOCKERD_PID" 2>/dev/null; then
    log "Stopping dockerd (pid=$DOCKERD_PID)"
    kill -TERM "$DOCKERD_PID" 2>/dev/null || true
    wait "$DOCKERD_PID" 2>/dev/null || true
  fi
  exit 0
}
trap 'shutdown SIGTERM' SIGTERM
trap 'shutdown SIGINT'  SIGINT

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  start_dockerd
  wait_for_api
  verify_gvisor
  launch_runner
}

main "$@"
