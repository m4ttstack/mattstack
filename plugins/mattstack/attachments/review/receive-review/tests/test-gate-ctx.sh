#!/bin/sh
# Offline tests for scripts/gate-ctx.sh against the fixtures beside this file.
set -u
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GC="$DIR/../scripts/gate-ctx.sh"
PLAN="$DIR/fixtures/plan-source.json"
POST="$DIR/fixtures/post-source.json"
REVIEW="$DIR/fixtures/review-source.json"
fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fails=$((fails+1)); fi
}
run() { # stdin-file args... -> sets OUT, ERR, RC
  f=$1; shift; e=$(mktemp)
  OUT=$(sh "$GC" "$@" < "$f" 2>"$e"); RC=$?
  ERR=$(cat "$e"); rm -f "$e"
}
mutate() { # jq-filter fixture -> path of a mutated copy
  m=$(mktemp); jq "$1" "$2" > "$m"; echo "$m"
}

# --- structured, under budget: contexts round-trip exactly ---
run "$PLAN" fit
check "plan fit exits 0" 0 "$RC"
check "plan fit is structured" structured "$(printf '%s' "$OUT" | jq -r .mode)"
check "plan fit trims nothing" '[]' "$(printf '%s' "$OUT" | jq -c .trimmed)"
check "gate context round-trips" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$PLAN" '(.context | fromjson) == $s[0].context')"
check "question contexts round-trip" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$PLAN" '[.questions[] | .context // null | if . then fromjson else . end] == [$s[0].questions[] | .context // null]')"
check "options untouched" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$PLAN" '[.questions[].options] == [$s[0].questions[].options]')"
check "bytes is the shared-budget total" true \
  "$(printf '%s' "$OUT" | jq '.bytes == ((.context | utf8bytelength) + ([.questions[] | .context // empty | utf8bytelength] | add))')"
check "structured open fits" true "$(printf '%s' "$OUT" | jq .fits)"

run "$POST" fit
check "post fit is structured" structured "$(printf '%s' "$OUT" | jq -r .mode)"
check "replies context round-trips" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$POST" '(.questions[0].context | fromjson) == $s[0].questions[0].context')"

M=$(mutate '.questions[0].context.extra = {"x": 1} | .context.future = "later"' "$PLAN"); run "$M" fit; rm -f "$M"
check "unknown keys pass through" '{"x":1}|later' \
  "$(printf '%s' "$OUT" | jq -r '(.questions[0].context | fromjson | .extra | tojson) + "|" + (.context | fromjson | .future)')"

M=$(mutate '.questions[0].context.reply = {"kind": "none"}' "$PLAN"); run "$M" fit; rm -f "$M"
check "reply.kind none needs no text" 0 "$RC"

# --- over budget: points from the longest thread, then notes, never reply.text ---
run "$PLAN" fit --limit 1000
check "trim drops the longest thread's points first" '["thread-1:points"]' "$(printf '%s' "$OUT" | jq -c .trimmed)"
check "trimmed thread keeps its summary" true \
  "$(printf '%s' "$OUT" | jq '.questions[0].context | fromjson | (.claim | has("points") | not) and (.claim.summary | length > 0)')"
check "trimmed open fits" true "$(printf '%s' "$OUT" | jq '.bytes < 1000')"

run "$PLAN" fit --limit 900
check "notes go after every thread's points" '["thread-1:points","thread-2:note"]' "$(printf '%s' "$OUT" | jq -c .trimmed)"
check "reply texts survive trimming" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$PLAN" '[.questions[0,1].context | fromjson | .reply.text] == [$s[0].questions[0,1].context.reply.text]')"

run "$PLAN" fit --limit 700
check "no fit falls back to prose for the whole gate" prose "$(printf '%s' "$OUT" | jq -r .mode)"
check "prose fallback flattens the gate context" "Responding to renee's review" \
  "$(printf '%s' "$OUT" | jq -r '.context | split(" · ")[0]')"
check "prose fallback keeps every reply text whole" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$PLAN" '[.questions[0,1].context] as $p | [$s[0].questions[0,1].context.reply.text] | to_entries | all(.value as $t | $p[.key] | contains($t))')"
check "prose fallback flattens the trimmed source when the full prose is over" '["thread-1:points","thread-2:note","thread-1:note"]' "$(printf '%s' "$OUT" | jq -c .trimmed)"
check "prose fallback fits" true "$(printf '%s' "$OUT" | jq '.fits and .bytes < 700')"

M=$(mutate 'del(.questions[0].context.claim.points)' "$PLAN"); run "$M" fit --limit 700; rm -f "$M"
check "untrimmed prose wins when it fits" '[]|true' "$(printf '%s' "$OUT" | jq -r '(.trimmed | tojson) + "|" + (.questions[0].context | test("confirmed against the checkout") | tostring)')"

run "$PLAN" fit --limit 300
check "an open no prose can fit still exits 0" 0 "$RC"
check "and reports that it does not fit" false "$(printf '%s' "$OUT" | jq .fits)"

# --- prose flattening: exact text ---
run "$PLAN" prose
check "prose gate line" "Responding to renee's review · round 1 · 2 threads, 1 blocking · 1 valid, 1 pushback · fresh-context adjudicated" \
  "$(printf '%s' "$OUT" | jq -r .context)"
check "prose thread with points and a direction" "[BLOCKING] renee: the retry queue re-enqueues a job that already failed permanently.
- permanent failures carry retryable: false, but enqueue() never reads it
- violates the queue-contract doc; the other three callers all check it
Verdict: valid -- confirmed against the checkout
Reply direction: enqueue() now drops non-retryable jobs; added the missing check and a test." \
  "$(printf '%s' "$OUT" | jq -r '.questions[0].context')"
check "prose thread with a verbatim reply" "[NON-BLOCKING] renee: nit: the README should call this a backoff, not a delay.
Verdict: pushback -- the doc describes a fixed delay; there is no backoff in the code
Will post as reply: the wait is a fixed 30s delay (queue/retry.ts:14), so the README keeps delay; backoff would describe behavior the code does not have." \
  "$(printf '%s' "$OUT" | jq -r '.questions[1].context')"
check "prose leaves context-free questions alone" false "$(printf '%s' "$OUT" | jq '.questions[2] | has("context")')"

run "$POST" prose
check "prose post line" "Posting replies to renee's review · round 1 · 2 replies · fix pushed ab12cd3" \
  "$(printf '%s' "$OUT" | jq -r .context)"
check "prose replies block" "queue/enqueue.ts:88 FIX · ab12cd3: Fixed -- queue/enqueue.ts:88 / enqueue() now drops non-retryable jobs; added the check and a test.
queue/README.md:12 REPLY: the wait is a fixed 30s delay (queue/retry.ts:14), so the README keeps delay." \
  "$(printf '%s' "$OUT" | jq -r '.questions[0].context')"

M=$(mutate '.context.fixes = [{"sha": "a1"}, {"sha": "b2"}, {"sha": "c3"}]' "$POST"); run "$M" prose; rm -f "$M"
check "three or more fixes collapse" "Posting replies to renee's review · round 1 · 2 replies · 3 fixes pushed" \
  "$(printf '%s' "$OUT" | jq -r .context)"

# --- review-post: review@1 gate, findings@1 per findings-* question ---
run "$REVIEW" fit
check "review fit is structured" structured "$(printf '%s' "$OUT" | jq -r .mode)"
check "review contexts round-trip" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$REVIEW" '((.context | fromjson) == $s[0].context) and ([.questions[] | .context // null | if . then fromjson else . end] == [$s[0].questions[] | .context // null])')"
check "review options untouched" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$REVIEW" '[.questions[].options] == [$s[0].questions[].options]')"
FULL=$(printf '%s' "$OUT" | jq .bytes)

M=$(mutate 'del(.questions[0].context.findings[2].disposition, .questions[0].context.findings[3].fix) | .context = {"gate-ctx": "review@1", "readiness": "yes", "summary": "clean enough.", "findings": {}}' "$REVIEW"); run "$M" fit; rm -f "$M"
check "optional review and entry fields may all be absent" 0 "$RC"

# evidence goes largest first, across every findings-* question, then fix the same way
run "$REVIEW" fit --limit "$FULL"
check "trim drops the largest evidence first" '["findings-1:f2:evidence"]' "$(printf '%s' "$OUT" | jq -c .trimmed)"
NOEV=$(jq 'del(.questions[].context.findings?[]?.evidence)' "$REVIEW" | sh "$GC" fit | jq .bytes)
run "$REVIEW" fit --limit $((NOEV + 1))
check "every evidence goes, largest first, before any fix" '["findings-1:f2:evidence","findings-2:f5:evidence","findings-1:f4:evidence"]' "$(printf '%s' "$OUT" | jq -c .trimmed)"
run "$REVIEW" fit --limit "$NOEV"
check "then the largest fix" '["findings-1:f2:evidence","findings-2:f5:evidence","findings-1:f4:evidence","findings-1:f3:fix"]' "$(printf '%s' "$OUT" | jq -c .trimmed)"
B=$(printf '%s' "$OUT" | jq .bytes); run "$REVIEW" fit --limit "$B"
check "equal fixes go in position order" '"findings-1:f4:fix"' "$(printf '%s' "$OUT" | jq -c '.trimmed[4]')"
check "trimmed entries keep title, file and body" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$REVIEW" '[.questions[0,1].context | fromjson | .findings[] | {title, file, body}] == [$s[0].questions[0,1].context.findings[] | {title, file, body}]')"

MIN=$(jq 'del(.questions[].context.findings?[]?.evidence, .questions[].context.findings?[]?.fix)' "$REVIEW" | sh "$GC" fit | jq .bytes)
run "$REVIEW" fit --limit "$MIN"
check "a review that cannot fit structured goes prose for the whole gate" 'prose|true' "$(printf '%s' "$OUT" | jq -r '"\(.mode)|\(.fits)"')"
check "prose keeps every body whole" true \
  "$(printf '%s' "$OUT" | jq --slurpfile s "$REVIEW" '(.questions[0].context + .questions[1].context) as $p | [$s[0].questions[0,1].context.findings[].body] | all(. as $b | $p | contains($b))')"

M=$(mutate '(.questions[] | select(.id | startswith("findings-"))) |= del(.context)' "$REVIEW"); run "$M" fit; rm -f "$M"
check "findings questions without contexts (a legacy findings file) fit as prose" 'prose|[]|true' "$(printf '%s' "$OUT" | jq -r '"\(.mode)|\(.trimmed | tojson)|\(.fits)"')"
check "the legacy open carries no question contexts" '[false,false,false]' "$(printf '%s' "$OUT" | jq -c '[.questions[] | has("context")]')"
M=$(mutate 'del(.questions[1].context)' "$REVIEW"); run "$M" fit; rm -f "$M"
check "one findings question without a context sends the whole gate prose" prose "$(printf '%s' "$OUT" | jq -r .mode)"

run "$REVIEW" prose
check "prose review block" "Review by renee · round 2 · re-review · prior: 3 addressed, 1 still open
Ready to merge: with-fixes -- the retry guard holds on the parity path only; the live path still re-enqueues.
Critical (1), Important (1), Minor (3)" "$(printf '%s' "$OUT" | jq -r .context)"
check "prose findings block" "[MINOR] test over-specifies the ordering (queue/enqueue.test.ts:132) · new
asserts exact call order where the contract only promises the set.
Fix: assert set membership

[MINOR] README still says delay · addressed-check
the README describes a fixed delay; the queue now backs off exponentially.
Fix: say backoff in the README and name the base interval and the cap it grows to" \
  "$(printf '%s' "$OUT" | jq -r '.questions[0].context | split("\n\n")[2:] | join("\n\n")')"
check "prose evidence keeps its lines" "Evidence: FAIL queue/enqueue.test.ts > live path drops permanent failures
  expected enqueue calls: 0
  received enqueue calls: 1" "$(printf '%s' "$OUT" | jq -r '.questions[0].context | split("\n\n")[1] | split("\n")[3:] | join("\n")')"
M=$(mutate '.context = {"gate-ctx": "review@1", "readiness": "yes", "summary": "no issues found.", "findings": {}} | .questions = [.questions[2]]' "$REVIEW"); run "$M" prose; rm -f "$M"
check "a clean review's prose" "Ready to merge: yes -- no issues found.
No findings" "$(printf '%s' "$OUT" | jq -r .context)"

# --- contract violations: exit 1, one stderr line per problem ---
reject() { # name jq-filter fixture expected-stderr
  M=$(mutate "$2" "$3"); run "$M" fit; rm -f "$M"
  check "$1 exits 1" 1 "$RC"
  check "$1 names the field" "$4" "$ERR"
}
reject "missing reviewer" 'del(.context.reviewer)' "$PLAN" "gate: reviewer: required non-empty string"
reject "severity outside the enum" '.questions[0].context.severity = "major"' "$PLAN" "thread-1: severity: blocking|non-blocking|question|none"
reject "verbatim reply without text" '.questions[1].context.reply = {"kind": "verbatim"}' "$PLAN" "thread-2: reply.text: required unless reply.kind is none"
reject "retired verdict word" '.questions[1].context.verdict.call = "invalid"' "$PLAN" "thread-2: verdict.call: valid|valid-low-value|pushback|needs-clarification|no-ask"
reject "question shape at gate level" '.context["gate-ctx"] = "thread@1"' "$PLAN" "gate: gate-ctx must be one of plan@1, post@1, review@1"
reject "unknown version" '.questions[0].context["gate-ctx"] = "thread@2"' "$PLAN" "thread-1: gate-ctx must be one of thread@1, replies@1, findings@1"
reject "null optional" '.context.round = null' "$PLAN" "gate: round: integer when present"
reject "points as a string" '.questions[0].context.claim.points = "one"' "$PLAN" "thread-1: claim.points: array of strings when present"
reject "reply entry joins no option" '.questions[0].context.replies[0].thread = "TX"' "$POST" "replies: replies[0].thread: matches no option value of this question"
reject "post without a replies count" 'del(.context.replies)' "$POST" "gate: replies: required integer"
reject "sha on a reply entry" '.questions[0].context.replies[1].sha = "x"' "$POST" "replies: replies[1].sha: only a fix carries sha"
reject "missing readiness" 'del(.context.readiness)' "$REVIEW" "gate: readiness: yes|no|with-fixes"
reject "spaced readiness" '.context.readiness = "with fixes"' "$REVIEW" "gate: readiness: yes|no|with-fixes"
reject "missing summary" 'del(.context.summary)' "$REVIEW" "gate: summary: required non-empty string"
reject "a count as a string" '.context.findings.minor = "3"' "$REVIEW" "gate: findings.minor: integer when present"
reject "prior missing still_open" '.context.prior = {"addressed": 3}' "$REVIEW" "gate: prior: {addressed, still_open} integers when present"
reject "re_review as a string" '.context.re_review = "yes"' "$REVIEW" "gate: re_review: boolean when present"
reject "entry without a body" 'del(.questions[0].context.findings[1].body)' "$REVIEW" "findings-1: findings[1].body: required non-empty string"
reject "report-cased severity" '.questions[0].context.findings[0].severity = "Critical"' "$REVIEW" "findings-1: findings[0].severity: critical|important|minor"
reject "disposition outside the enum" '.questions[0].context.findings[2].disposition = "open"' "$REVIEW" "findings-1: findings[2].disposition: new|still-open|addressed-check"
reject "null evidence" '.questions[0].context.findings[0].evidence = null' "$REVIEW" "findings-1: findings[0].evidence: non-empty string when present"
reject "an option with no entry" '.questions[0].options += [{"value": "f7", "label": "[Minor] extra"}]' "$REVIEW" "findings-1: option f7: no findings entry carries its value"
reject "an entry with no option" '.questions[1].context.findings += [.questions[1].context.findings[0] | .id = "f8"]' "$REVIEW" "findings-2: findings[1].id: matches no option value of this question"
reject "a duplicated entry id" '.questions[0].context.findings[3].id = "f1" | .questions[0].options[3].value = "f1"' "$REVIEW" "findings-1: findings: id f1 appears more than once"
reject "findings shape at gate level" '.context["gate-ctx"] = "findings@1"' "$REVIEW" "gate: gate-ctx must be one of plan@1, post@1, review@1"
reject "review shape on a question" '.questions[0].context["gate-ctx"] = "review@1"' "$REVIEW" "findings-1: gate-ctx must be one of thread@1, replies@1, findings@1"

BAD=$(mktemp); printf 'not json' > "$BAD"; run "$BAD" fit; rm -f "$BAD"
check "non-JSON stdin exits 1" 1 "$RC"
run "$PLAN" bogus;              check "unknown subcommand exits 2" 2 "$RC"
run "$PLAN" fit --limit abc;    check "non-numeric limit exits 2" 2 "$RC"
run "$PLAN" prose --limit 10;   check "prose takes no limit" 2 "$RC"

[ "$fails" -eq 0 ] || { echo "$fails failing"; exit 1; }
echo "all passing"
