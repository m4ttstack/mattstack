#!/bin/sh
# Exercises hooks/pipeline-gate-stop.sh with a PATH-stubbed rt: a running
# run with a fresh waiting-gate marker must not block the stop (exit 0);
# the same run without it must block (exit 2).
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
    FAKE_FIND="$TMP/find.json" FAKE_SNAP="$TMP/snap.json" \
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

echo "ok"
