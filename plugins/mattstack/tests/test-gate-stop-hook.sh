#!/bin/sh
# Exercises hooks/pipeline-gate-stop.sh with a PATH-stubbed rt: a running
# run with a fresh waiting-gate marker, or an open gate filed against it,
# must not block the stop (exit 0); the same run without either must block
# (exit 2).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/hooks/pipeline-gate-stop.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/runs/repo/run1"
touch "$TMP/runs/repo/run1/state.db"

cat > "$TMP/bin/rt" <<'FAKE'
#!/bin/sh
case "$1 $2" in
  "runs find") cat "$FAKE_FIND" ;;
  "runs snapshot") cat "$FAKE_SNAP" ;;
  "gate list")
    [ "$*" = "gate list --open --run run1" ] || exit 1
    [ -f "$FAKE_GATES" ] || exit 1
    cat "$FAKE_GATES" ;;
  *) exit 1 ;;
esac
FAKE
chmod +x "$TMP/bin/rt"

cat > "$TMP/find.json" <<EOF
{"ok":true,"runs":[{"runDb":"$TMP/runs/repo/run1/state.db"}]}
EOF

snapshot() {
  # $1 = extra fields JSON rows (may be empty)
  cat > "$TMP/snap.json" <<EOF
{"run":{"id":"run1","status":"running","current_stage":"implement","started_at":100},
 "stages":[{"stage":"implement","started_at":100}],
 "fields":[{"key":"claude-session","value":"sess-1","at":150}$1]}
EOF
}

run_hook() {
  printf '%s' '{"session_id":"sess-1"}' | \
    PATH="$TMP/bin:$PATH" RT_RUNS_ROOT="$TMP/runs" \
    FAKE_FIND="$TMP/find.json" FAKE_SNAP="$TMP/snap.json" FAKE_GATES="$TMP/gates.json" \
    sh "$HOOK" >/dev/null 2>&1
}

snapshot ""
if run_hook; then echo "FAIL: open run did not block the stop"; exit 1; fi

snapshot ',{"key":"waiting-gate","value":"g1","at":150}'
if ! run_hook; then echo "FAIL: fresh waiting-gate marker still blocked the stop"; exit 1; fi

snapshot ',{"key":"waiting-gate","value":"g1","at":50}'
if run_hook; then echo "FAIL: STALE waiting-gate marker (before stage start) did not block"; exit 1; fi

snapshot ',{"key":"waiting-gate","value":"-","at":150}'
if run_hook; then echo "FAIL: cleared waiting-gate marker did not block"; exit 1; fi

# RT-593: a gate opened without runDb (the board's posting gate) still names
# the run in its origin, so an open one means the run is waiting.
snapshot ""
echo '{"ok":true,"gates":[{"id":"g2","kind":"review-post","status":"open","origin":{"runId":"run1"}}],"cursor":0}' > "$TMP/gates.json"
if ! run_hook; then echo "FAIL: an open gate filed against the run still blocked the stop"; exit 1; fi

# An rt older than --run ignores the flag and lists every open gate.
echo '{"ok":true,"gates":[{"id":"g3","kind":"review-post","status":"open","subject":"mr:x","origin":{"runId":"run9"}}],"cursor":0}' > "$TMP/gates.json"
if run_hook; then echo "FAIL: an open gate of another run let the stop through"; exit 1; fi

echo '{"ok":true,"gates":[],"cursor":0}' > "$TMP/gates.json"
if run_hook; then echo "FAIL: no open gate for the run did not block"; exit 1; fi

rm -f "$TMP/gates.json"
if run_hook; then echo "FAIL: a failed gate list did not block"; exit 1; fi

echo "ok"
