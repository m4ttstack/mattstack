#!/usr/bin/env bash
# Offline tests for work_progress.py.
#
# Fixture trees live in a mktemp dir. `rt` is a stub that serves `progress
# list`, `herd status`, `herd gates` and `runs` from fixture files, and exits 2
# on `progress` when RT_STUB_OLD is set (an rt without the verb). HOME is
# sandboxed so nothing reads the real ~/.mattstack.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/../plugin/skills/work-progress/scripts/work_progress.py"
PY="$(command -v python3)"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
SANDBOX="$(cd "$SANDBOX" && pwd -P)"
mkdir -p "$SANDBOX/bin" "$SANDBOX/home" "$SANDBOX/fx"
FX="$SANDBOX/fx"
cat > "$SANDBOX/bin/rt" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RT_STUB_CALLS"
case "$1 $2" in
  "progress list")
    if [ -n "${RT_STUB_OLD:-}" ]; then echo "usage: rt progress ..." >&2; exit 2; fi
    cat "$RT_STUB_FX/plans.json" ;;
  "herd status") cat "$RT_STUB_FX/herd-status.json" ;;
  "herd gates") echo '{"gates":[]}' ;;
  "runs "*|"runs ") echo '{"runs":[]}' ;;
  *) echo "unexpected rt call: $*" >&2; exit 2 ;;
esac
STUB
chmod +x "$SANDBOX/bin/rt"

TREE="$SANDBOX/widgets"
git init -q -b feature-x "$TREE"
mkdir -p "$TREE/docs/plans" "$TREE/docs/specs"
echo "# Widgets spec" > "$TREE/docs/specs/widgets-spec.md"
mkplan() { # stem tasks [spec-line]
  { echo "# Plan $1"; [ -n "${3:-}" ] && echo "$3"; for i in $(seq 1 "$2"); do echo "### Task $i: step"; done; } > "$TREE/docs/plans/$1.md"
}
mkplan 2026-10-01-one 12 '**Spec:** docs/specs/widgets-spec.md'
mkplan 2026-10-01-two 9
mkplan 2026-10-01-three 9
LEDGER="$TREE/.superpowers/sdd/2026-10-01-two"
mkdir -p "$LEDGER"
{ echo "plan: docs/plans/2026-10-01-two.md"; for i in 1 2 3 4 5 6 7; do echo "Task $i: complete"; done; echo "Task 8: reviewing"; } > "$LEDGER/progress.md"

cat > "$FX/plans.json" <<JSON
{"ok":true,"plans":[
{"tree":"$TREE","branch":"feature-x","plan":"docs/plans/2026-10-01-one.md","stem":"2026-10-01-one","done":12,"total":12,"latest":"Task 12: complete","firstSeen":1000,"lastSeen":2000,"finishedAt":2000,"state":"done"},
{"tree":"$TREE","branch":"feature-x","plan":"docs/plans/2026-10-01-two.md","stem":"2026-10-01-two","done":7,"total":9,"latest":"T8 reviewing","firstSeen":1000,"lastSeen":3000,"finishedAt":null,"state":"running"}
]}
JSON

fails=0
has() { # name needle haystack
  case "$3" in *"$2"*) echo "ok   $1" ;; *) echo "FAIL $1"; echo "       want to contain: $2"; echo "       got : $3"; fails=$((fails+1)) ;; esac
}
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

run() { # args... -> stdout+stderr, then "exit=<code>"
  local out code
  out="$(env -i HOME="$SANDBOX/home" PATH="$SANDBOX/bin:$(dirname "$PY"):/usr/bin:/bin" \
    RT_STUB_CALLS="$SANDBOX/calls" RT_STUB_FX="$FX" ${RT_STUB_OLD:+RT_STUB_OLD=1} \
    "$PY" "$SCRIPT" "$@" 2>&1)"
  code=$?
  printf '%s\nexit=%s' "$out" "$code"
}
rowof() { grep -F "| $1 |" <<<"$2" | head -1; }
PLANS=(--plan "$TREE/docs/plans/2026-10-01-one.md" --plan "$TREE/docs/plans/2026-10-01-two.md" --plan "$TREE/docs/plans/2026-10-01-three.md")

rm -f "$SANDBOX/calls"
out="$(run "${PLANS[@]}" --title epic)"
has "epic view header" "**epic** · branch feature-x · worktree widgets · 19 of 30 tasks done · nothing stuck" "$out"
has "epic view overall" 'Overall `█████████████░░░░░░░` 63%' "$out"
has "epic view table header" "| plan | status | spec | plan | exec | review | tasks | now |" "$out"
check "epic view rows in the given order" "one two three" "$(grep -E '^\| (one|two|three) \|' <<<"$out" | cut -d'|' -f2 | tr -d ' ' | tr '\n' ' ' | sed 's/ $//')"
has "epic view done row" "| one | done | ✓ | ✓ | ✓ | ✓ | \`██████████\` 12/12 |" "$(rowof one "$out")"
has "epic view running row" "| two | running | · | ✓ | ▸ |  | \`████████░░\` 7/9 |" "$(rowof two "$out")"
has "epic view not started row" "| three | not started | · | ✓ |  |  | \`░░░░░░░░░░\` 0/9 |" "$(rowof three "$out")"
has "epic view reads rt for the tree" "progress list --tree $TREE --refresh --json" "$(cat "$SANDBOX/calls")"
check "epic view makes one progress call" "1" "$(grep -c '^progress list' "$SANDBOX/calls")"

default="$(run --plan "$TREE/docs/plans/2026-10-01-two.md")"
has "default title drops the date" "**two** · branch feature-x" "$default"

touch -t 202001010000 "$LEDGER/progress.md"
quiet="$(run "${PLANS[@]}" --title epic)"
has "quiet ledger shows quiet status" "| two | *quiet* |" "$(rowof two "$quiet")"
has "quiet ledger counts in the header" "19 of 30 tasks done · 1 quiet" "$quiet"
touch "$LEDGER/progress.md"

cp "$FX/plans.json" "$FX/plans.live.json"
cat > "$FX/plans.json" <<JSON
{"ok":true,"plans":[
{"tree":"$TREE","branch":"feature-x","plan":"docs/plans/2026-10-01-three.md","stem":"2026-10-01-three","done":4,"total":9,"latest":"T5 started","firstSeen":1000,"lastSeen":2000,"finishedAt":null,"state":"tree-gone"}
]}
JSON
gone="$(run "${PLANS[@]}" --title epic)"
has "tree-gone record shows tree gone" "| three | tree gone |" "$(rowof three "$gone")"
has "tree-gone record keeps the last counts" "4/9" "$(rowof three "$gone")"
cp "$FX/plans.live.json" "$FX/plans.json"

check "no flags exits 1 with the message" \
  "work_progress: name a herd (--herd <id>) or the plans to show (--plan <path> ...)
exit=1" "$(run)"

old="$(RT_STUB_OLD=1 run "${PLANS[@]}" --title epic)"
has "old rt falls back: live plan parsed in script" "| two | running |" "$(rowof two "$old")"
has "old rt falls back: live plan reads 7/9" "7/9" "$(rowof two "$old")"
has "old rt falls back: no ledger reads unknown" "| one | unknown |" "$(rowof one "$old")"
has "old rt falls back: unknown row explains itself" "not started or finished (rt has no record)" "$(rowof one "$old")"
has "old rt falls back: exit 0" "exit=0" "$old"

# Lettered sub-tasks: Task 3 is done only when every part the ledger mentions is complete.
cat > "$LEDGER/progress.md" <<'LED'
plan: docs/plans/2026-10-01-two.md
Task 1: complete
Task 2a: complete
Task 2b: complete
Task 3a: complete
Task 3b: reviewing
LED
lettered="$(RT_STUB_OLD=1 run --plan "$TREE/docs/plans/2026-10-01-two.md")"
has "old rt fallback applies the lettered rule" "2/9" "$(rowof two "$lettered")"

# Herd mode.
JOBTREE="$SANDBOX/jobtree"; mkdir -p "$JOBTREE"
mkdir -p "$SANDBOX/home/.mattstack/rt/herds/h1/alpha"
printf 'Method: superpowers\n' > "$SANDBOX/home/.mattstack/rt/herds/h1/alpha/job.md"
cat > "$FX/herd-status.json" <<JSON
{"herd":{"id":"h1","shepherdName":"shep","createdAt":1000},"unread":0,
"jobs":[{"name":"alpha","status":"done","lastReport":{"at":5000},"worktree":"$JOBTREE","tree":"$JOBTREE","branch":"job-x","createdAt":1000,"updatedAt":9000}]}
JSON
echo '{"ok":true,"plans":[]}' > "$FX/plans.json"
herd="$(run --herd h1)"
has "herd mode unchanged: header" '**Herd `h1`** · shepherd shep · up ' "$herd"
has "herd mode unchanged: header tail" " · 0 gates open · 0 unread" "$herd"
has "herd mode unchanged: overall" 'Overall `████████████████████` 1/1 finished · 0 need you · 0 trouble · 0 running' "$herd"
has "herd mode unchanged: table header" "| job | status | spec | plan | exec | review | tasks | now |" "$herd"
has "herd mode without a record leaves counts empty" "| alpha | done | ✓ | ✓ | ✓ | ✓ | · | reported |" "$(rowof alpha "$herd")"

cat > "$FX/plans.json" <<JSON
{"ok":true,"plans":[
{"tree":"$JOBTREE","branch":"job-x","plan":"docs/plans/p.md","stem":"p","done":5,"total":5,"latest":"Task 5: complete","firstSeen":1500,"lastSeen":2000,"finishedAt":2000,"state":"done"}
]}
JSON
rm -f "$SANDBOX/calls"
herd="$(run --herd h1)"
has "herd job with no ledger takes counts from the rt record" "\`██████████\` 5/5" "$(rowof alpha "$herd")"
has "herd record read names the job tree" "progress list --tree $JOBTREE --json" "$(cat "$SANDBOX/calls")"

cat > "$FX/plans.json" <<JSON
{"ok":true,"plans":[
{"tree":"$JOBTREE","branch":"job-x","plan":"docs/plans/p.md","stem":"p","done":5,"total":5,"latest":"Task 5: complete","firstSeen":1,"lastSeen":2,"finishedAt":2,"state":"done"}
]}
JSON
herd="$(run --herd h1)"
has "herd ignores a record older than the job" "| alpha | done | ✓ | ✓ | ✓ | ✓ | · | reported |" "$(rowof alpha "$herd")"

# Herd mode counts lettered sub-tasks with the same rule as plan mode.
BETATREE="$SANDBOX/betatree"
mkdir -p "$BETATREE/docs/plans" "$BETATREE/.superpowers/sdd/p"
{ echo "# Plan p"; for i in 1 2 3 4 5; do echo "### Task $i: step"; done; } > "$BETATREE/docs/plans/p.md"
mkdir -p "$SANDBOX/home/.mattstack/rt/herds/h1/beta"
printf 'Method: superpowers\n' > "$SANDBOX/home/.mattstack/rt/herds/h1/beta/job.md"
cat > "$FX/herd-status.json" <<JSON
{"herd":{"id":"h1","shepherdName":"shep","createdAt":1000},"unread":0,
"jobs":[{"name":"beta","status":"active","worktree":"$BETATREE","tree":"$BETATREE","branch":"beta-x","createdAt":1000}]}
JSON
echo '{"ok":true,"plans":[]}' > "$FX/plans.json"
{ echo "plan: docs/plans/p.md"; echo "Task 1: complete"; echo "Task 2: complete"; echo "Task 3: complete"
  echo "Task 4a: complete"; echo "Task 4b: dispatched"; } > "$BETATREE/.superpowers/sdd/p/progress.md"
herd="$(run --herd h1)"
has "herd split task with an open part is not done" "3/5" "$(rowof beta "$herd")"
echo "Task 4b: complete" >> "$BETATREE/.superpowers/sdd/p/progress.md"
herd="$(run --herd h1)"
has "herd split task is done once every part is" "4/5" "$(rowof beta "$herd")"

[ "$fails" -eq 0 ] && echo "all work-progress tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
