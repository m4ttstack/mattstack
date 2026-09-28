#!/bin/sh
# Offline tests for scripts/review-source.sh (and the vendored gate-ctx.sh)
# against the fixtures beside this file.
set -u
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RS="$DIR/../scripts/review-source.sh"
GC="$DIR/../scripts/gate-ctx.sh"
V2="$DIR/fixtures/findings-v2.json"
V1="$DIR/fixtures/findings-v1.json"
X="$DIR/fixtures/extras.json"
fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fails=$((fails+1)); fi
}
run() { # args... -> sets OUT, ERR, RC
  e=$(mktemp)
  OUT=$(sh "$RS" "$@" 2>"$e"); RC=$?
  ERR=$(cat "$e"); rm -f "$e"
}
mutate() { # jq-filter file -> path of a mutated copy
  m=$(mktemp); jq "$1" "$2" > "$m"; echo "$m"
}
q() { printf '%s' "$OUT" | jq -r "$1"; }

# --- the vendored gate-ctx.sh is the receive-review copy, byte for byte ---
if cmp -s "$GC" "$DIR/../../receive-review/scripts/gate-ctx.sh"; then echo "ok   vendored gate-ctx.sh matches receive-review"
else echo "FAIL vendored gate-ctx.sh drifted from receive-review/scripts/gate-ctx.sh"; fails=$((fails+1)); fi

# --- version 2: structured source ---
run "$V2" "$X"
check "v2 exits 0" 0 "$RC"
check "gate context is review@1 from the summary, counts, and re-review fields" \
  '{"gate-ctx":"review@1","reviewer":"renee","readiness":"with-fixes","summary":"the retry guard holds on the parity path only; the live path still re-enqueues.","findings":{"critical":1,"important":1,"minor":3},"round":2,"re_review":true,"prior":{"addressed":3,"still_open":1}}' \
  "$(q '.context | tojson')"
check "findings go by tier, four per question, then the extras questions" \
  '[["findings-1",["f4","f2","f1","f3"]],["findings-2",["f5"]],["outcome",["comment","approve"]]]' \
  "$(q '[.questions[] | [.id, [.options[].value]]] | tojson')"
check "every findings question asks the same thing" '["Post which findings to !87?","Post which findings to !87?"]' \
  "$(q '[.questions[0,1].label] | tojson')"
check "extras questions ride verbatim" true \
  "$(printf '%s' "$OUT" | jq --slurpfile x "$X" '.questions[2:] == $x[0].questions')"

# the degraded view: label [Tier] title, description anchor · fix · kind:<word>
check "file-only anchor, no kind" '[Critical] permanent failures re-enqueue forever|queue/worker.ts · drop non-retryable jobs in the worker'"'"'s catch block' \
  "$(q '.questions[0].options[0] | "\(.label)|\(.description)"')"
check "file:line anchor with kind" '[Important] retry fix is parity wiring, not a live fix|queue/enqueue.ts:81 · move the retryable check ahead of the parity branch · kind:suggestion' \
  "$(q '.questions[0].options[1] | "\(.label)|\(.description)"')"
check "kind is lowercased" 'queue/enqueue.test.ts:132 · assert set membership · kind:nitpick' \
  "$(q '.questions[0].options[2].description')"
check "fileLabel stands in for the anchor; kind spaces become hyphens" 'not inline-anchorable · say backoff in the README and name the base interval and the cap it grows to · kind:follow-up' \
  "$(q '.questions[0].options[3].description')"
check "a long title is middle-truncated to the 200-byte label cap" '200|[Minor] the backoff schedule doubles from a 250 ms base with ±20 % jitter per attempt, so the tenth re… which outlasts the worker lease; renew the lease on each attempt or cap the schedule below it' \
  "$(q '.questions[1].options[0].label | "\(utf8bytelength)|\(.)"')"

# the structured view: full text, severity lowercased, anchors only when real
check "entry carries body, evidence, disposition and a file:line" \
  '{"id":"f2","severity":"important","title":"retry fix is parity wiring, not a live fix","body":"the guard only runs on the parity path; the live path still re-enqueues a permanently failed job.","file":"queue/enqueue.ts:81","fix":"move the retryable check ahead of the parity branch","evidence":"FAIL queue/enqueue.test.ts > live path drops permanent failures\n  expected enqueue calls: 0\n  received enqueue calls: 1","disposition":"still-open"}' \
  "$(q '.questions[0].context.findings[1] | tojson')"
check "a fileLabel is not a file" false "$(q '.questions[0].context.findings[3] | has("file")')"
check "a file without a line stays bare" queue/worker.ts "$(q '.questions[0].context.findings[0].file')"
check "titles are never truncated in the context" true \
  "$(printf '%s' "$OUT" | jq --slurpfile f "$V2" '.questions[1].context.findings[0].title == $f[0].findings[4].title')"
printf '%s' "$OUT" > "${TMPDIR:-/tmp}/review-source-v2.$$"
FIT=$(sh "$GC" fit < "${TMPDIR:-/tmp}/review-source-v2.$$"); FRC=$?; rm -f "${TMPDIR:-/tmp}/review-source-v2.$$"
check "the source fits structured with the vendored gate-ctx.sh" '0|structured' "$FRC|$(printf '%s' "$FIT" | jq -r .mode)"

M=$(mutate '.findings[0].fix = ("x" * 1100)' "$V2"); run "$M" "$X"; rm -f "$M"
check "an over-long fix is shortened to the 1024-byte description cap, anchor and kind kept" 'true|true|true' \
  "$(q '.questions[0].options[2].description | "\(utf8bytelength <= 1024)|\(startswith("queue/enqueue.test.ts:132 · xxx"))|\(endswith("x… · kind:nitpick"))"')"
M=$(mutate '.findings[0].kind = " Needs_Work!"' "$V2"); run "$M" "$X"; rm -f "$M"
check "kind normalizes to lowercase and hyphens" 'queue/enqueue.test.ts:132 · assert set membership · kind:needs-work' "$(q '.questions[0].options[2].description')"
M=$(mutate 'del(.findings[0].fix)' "$V2"); run "$M" "$X"; rm -f "$M"
check "no fix: anchor and kind only" 'queue/enqueue.test.ts:132 · kind:nitpick' "$(q '.questions[0].options[2].description')"
M=$(mutate 'del(.findings[2].fileLabel, .findings[2].fix)' "$V2"); run "$M" "$X"; rm -f "$M"
check "no anchor and no fix: no description" false "$(q '.questions[0].options[3] | has("description")')"
M=$(mutate '.findings = []' "$V2"); run "$M" "$X"; rm -f "$M"
check "a clean review has no findings questions and empty counts" '["outcome"]|{}' "$(q '"\([.questions[].id] | tojson)|\(.context.findings | tojson)"')"
M=$(mutate 'del(.reviewer, .round)' "$X"); run "$V2" "$M"; rm -f "$M"
check "reviewer and round only when the caller supplies them" 'false|false' "$(q '.context | "\(has("reviewer"))|\(has("round"))"')"

# --- legacy (no version): no findings contexts, so fit goes prose ---
run "$V1" "$X"
check "v1 exits 0" 0 "$RC"
check "legacy findings questions carry no context" '[false,false]' "$(q '[.questions[] | has("context")] | tojson')"
check "legacy options keep the degraded recipe" '[Critical] permanent failures re-enqueue forever|queue/worker.ts · drop non-retryable jobs in the worker'"'"'s catch block · kind:suggestion' \
  "$(q '.questions[0].options[0] | "\(.label)|\(.description)"')"
check "legacy fits as whole-gate prose" 'prose|[]' "$(printf '%s' "$OUT" | sh "$GC" fit | jq -r '"\(.mode)|\(.trimmed | tojson)"')"

# --- contract violations: exit 1, one stderr line per problem ---
reject() { # name findings-file extras-file expected-stderr
  run "$2" "$3"
  check "$1 exits 1" 1 "$RC"
  check "$1 names the field" "$4" "$ERR"
}
M=$(mutate 'del(.findings[1].body)' "$V2"); reject "v2 entry without a body" "$M" "$X" "findings file: findings[1].body: required non-empty string"; rm -f "$M"
M=$(mutate '.version = 3' "$V2"); reject "unknown version" "$M" "$X" "findings file: version: 2 when present (absent is a legacy file)"; rm -f "$M"
M=$(mutate '.findings[0].tier = "minor"' "$V2"); reject "lowercase tier" "$M" "$X" "findings file: findings[0].tier: Critical|Important|Minor"; rm -f "$M"
M=$(mutate '.findings[1].id = "f1"' "$V2"); reject "duplicate id" "$M" "$X" "findings file: findings: id f1 appears more than once"; rm -f "$M"
M=$(mutate '.findings[0].disposition = "open"' "$V2"); reject "disposition outside the enum" "$M" "$X" "findings file: findings[0].disposition: new|still-open|addressed-check"; rm -f "$M"
M=$(mutate '.summary.readiness = "with fixes"' "$V2"); reject "spaced readiness" "$M" "$X" "findings file: summary.readiness: yes|no|with-fixes"; rm -f "$M"
M=$(mutate 'del(.target)' "$X"); reject "extras without a target" "$V2" "$M" "extras: target: required non-empty string"; rm -f "$M"
M=$(mutate '.round = 0' "$X"); reject "round below 1" "$V2" "$M" "extras: round: integer of at least 1 when present"; rm -f "$M"
M=$(mutate '.questions += [{"id": "findings-9", "options": []}]' "$X"); reject "extras naming a findings question" "$V2" "$M" "extras: questions: findings-* ids are built from the findings file"; rm -f "$M"

BAD=$(mktemp); printf 'not json' > "$BAD"; run "$BAD" "$X"; rm -f "$BAD"
check "non-JSON findings file exits 1" 1 "$RC"
run "$V2";                     check "one argument is usage" 2 "$RC"
run "$V2" "$DIR/missing.json"; check "an unreadable file is usage" 2 "$RC"

[ "$fails" -eq 0 ] || { echo "$fails failing"; exit 1; }
echo "all passing"
