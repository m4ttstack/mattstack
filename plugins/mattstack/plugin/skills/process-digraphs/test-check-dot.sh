#!/usr/bin/env bash
# Each case must make check-dot.py fail with the named finding; the good case must pass.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

expect() { # name, expected substring (empty = must pass), dot body
  printf '%s' "$3" > "$tmp/$1.dot"
  out="$(python3 "$here/check-dot.py" "$tmp/$1.dot" 2>&1)"; rc=$?
  if [ -z "$2" ]; then
    [ $rc -eq 0 ] && echo "ok   $1" || { echo "FAIL $1 (expected pass)"; echo "$out"; fails=$((fails+1)); }
  else
    if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "$2"; then echo "ok   $1"; else echo "FAIL $1 (expected: $2)"; echo "$out"; fails=$((fails+1)); fi
  fi
}

GOOD='digraph g {
 "Trigger: go" [shape=ellipse];
 "Ready?" [shape=diamond];
 "Do it" [shape=box];
 "Attempt = 3?" [shape=diamond];
 "STOP: hand back" [shape=octagon style=filled fillcolor=red fontcolor=white];
 "Done" [shape=doublecircle style=filled fillcolor=lightgreen];
 "Trigger: go" -> "Ready?";
 "Ready?" -> "Done" [label="yes"];
 "Ready?" -> "Attempt = 3?" [label="no"];
 "Attempt = 3?" -> "Do it" [label="no - retry"];
 "Do it" -> "Ready?";
 "Attempt = 3?" -> "STOP: hand back" [label="yes - budget spent"];
}'
expect good "" "$GOOD"

expect unlabeled-edge "decision edge has no label" 'digraph g { "S" [shape=ellipse]; "Q?" [shape=diamond]; "A" [shape=doublecircle style=filled]; "B" [shape=doublecircle]; "S" -> "Q?"; "Q?" -> "A" [label="yes"]; "Q?" -> "B"; }'
expect one-way-diamond "needs an out-edge for every outcome" 'digraph g { "S" [shape=ellipse]; "Q?" [shape=diamond]; "A" [shape=doublecircle style=filled]; "S" -> "Q?"; "Q?" -> "A" [label="yes"]; }'
expect not-a-question "phrased as a question" 'digraph g { "S" [shape=ellipse]; "Check" [shape=diamond]; "A" [shape=doublecircle style=filled]; "B" [shape=doublecircle]; "S" -> "Check"; "Check" -> "A" [label="y"]; "Check" -> "B" [label="n"]; }'
expect dead-end "dead end" 'digraph g { "S" [shape=ellipse]; "Do" [shape=box]; "A" [shape=doublecircle style=filled]; "S" -> "Do"; "S" -> "A"; }'
expect unbounded "unbounded loop" 'digraph g { "S" [shape=ellipse]; "Poll" [shape=box]; "Wait" [shape=box]; "A" [shape=doublecircle style=filled]; "S" -> "Poll"; "Poll" -> "Wait"; "Wait" -> "Poll"; "S" -> "A"; }'
expect stop-name 'start its text with "STOP:"' 'digraph g { "S" [shape=ellipse]; "Halt" [shape=octagon]; "A" [shape=doublecircle style=filled]; "S" -> "Halt"; "S" -> "A"; }'
expect no-success "no success terminal" 'digraph g { "S" [shape=ellipse]; "End" [shape=doublecircle]; "S" -> "End"; }'
expect opaque-id "opaque id" 'digraph g { n1 [label="Start here" shape=ellipse]; "A" [shape=doublecircle style=filled]; n1 -> "A"; }'
expect unreachable "unreachable" 'digraph g { "S" [shape=ellipse]; "A" [shape=doublecircle style=filled]; "Orphan loop" [shape=box]; "Orphan q?" [shape=diamond]; "S" -> "A"; "Orphan loop" -> "Orphan q?"; "Orphan q?" -> "Orphan loop" [label="again"]; "Orphan q?" -> "A" [label="done"]; }'
expect stop-branches "at most one way out" 'digraph g { "S" [shape=ellipse]; "STOP: halt" [shape=octagon]; "Go on" [shape=box]; "Or this" [shape=box]; "A" [shape=doublecircle style=filled]; "S" -> "STOP: halt"; "STOP: halt" -> "Go on"; "STOP: halt" -> "Or this"; "Go on" -> "A"; "Or this" -> "A"; }'
expect stop-redirect "" 'digraph g { "S" [shape=ellipse]; "Need a read?" [shape=diamond]; "STOP: reads go through rt_verb" [shape=octagon]; "rt_verb {args}" [shape=plaintext]; "A" [shape=doublecircle style=filled]; "S" -> "Need a read?"; "Need a read?" -> "rt_verb {args}" [label="yes"]; "Need a read?" -> "STOP: reads go through rt_verb" [label="tempted to use the shell"]; "STOP: reads go through rt_verb" -> "rt_verb {args}"; "Need a read?" -> "A" [label="no"]; "rt_verb {args}" -> "A"; }'
expect stop-exit-to-step "only a guard STOP" 'digraph g { "S" [shape=ellipse]; "Push refused?" [shape=diamond]; "STOP: push only with git_push" [shape=octagon]; "Push with the shell" [shape=box]; "A" [shape=doublecircle style=filled]; "S" -> "Push refused?"; "Push refused?" -> "A" [label="no"]; "Push refused?" -> "STOP: push only with git_push" [label="yes"]; "STOP: push only with git_push" -> "Push with the shell"; "Push with the shell" -> "A"; }'
expect stop-to-outcome "" 'digraph g { "S" [shape=ellipse]; "Gate closed?" [shape=diamond]; "STOP: never re-ask a closed gate" [shape=octagon]; "Path ended" [shape=doublecircle]; "A" [shape=doublecircle style=filled]; "S" -> "Gate closed?"; "Gate closed?" -> "A" [label="no"]; "Gate closed?" -> "STOP: never re-ask a closed gate" [label="yes"]; "STOP: never re-ask a closed gate" -> "Path ended"; }'
expect merged-step "unlabelled out-edges" 'digraph g { "S" [shape=ellipse]; "Resumed?" [shape=diamond]; "run_stage {start}" [shape=plaintext]; "Fetch" [shape=box]; "Report" [shape=box]; "A" [shape=doublecircle style=filled]; "S" -> "Resumed?"; "Resumed?" -> "run_stage {start}" [label="no"]; "Resumed?" -> "run_stage {start}" [label="yes"]; "run_stage {start}" -> "Fetch"; "run_stage {start}" -> "Report"; "Fetch" -> "A"; "Report" -> "A"; }'
expect gate-answers "" 'digraph g { "S" [shape=ellipse]; "Ask the human: retry or take over" [shape=box]; "A" [shape=doublecircle style=filled]; "B" [shape=doublecircle]; "S" -> "Ask the human: retry or take over"; "Ask the human: retry or take over" -> "A" [label="retry"]; "Ask the human: retry or take over" -> "B" [label="takes over"]; }'
expect loop-no-exit "no decision edge leaves it" 'digraph g { "S" [shape=ellipse]; "Try" [shape=box]; "Again?" [shape=diamond]; "A" [shape=doublecircle style=filled]; "S" -> "Try"; "S" -> "A"; "Try" -> "Again?"; "Again?" -> "Try" [label="yes"]; "Again?" -> "Try" [label="no"]; }'
expect stop-to-gate "" 'digraph g { "S" [shape=ellipse]; "Push refused?" [shape=diamond]; "STOP: push only with git_push" [shape=octagon]; "Off-script gate" [shape=box]; "A" [shape=doublecircle style=filled]; "S" -> "Push refused?"; "Push refused?" -> "A" [label="no"]; "Push refused?" -> "STOP: push only with git_push" [label="yes"]; "STOP: push only with git_push" -> "Off-script gate"; "Off-script gate" -> "A" [label="human pushed"]; }'
expect outcome-out "an outcome ends the path" 'digraph g { "S" [shape=ellipse]; "A" [shape=doublecircle style=filled]; "More" [shape=box]; "B" [shape=doublecircle]; "S" -> "A"; "A" -> "More"; "More" -> "B"; }'
expect parse-error "syntax error" 'digraph g { "S" -> ; }'

printf '# t\n\n  ```dot\ndigraph g { "S" [shape=ellipse]; }\n  ```\n' > "$tmp/indented.md"
out="$(python3 "$here/check-dot.py" "$tmp/indented.md" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "indented"; then echo "ok   indented-fence"; else echo "FAIL indented-fence"; echo "$out"; fails=$((fails+1)); fi

printf '# t\n\n```dot\ndigraph g { "S" [shape=ellipse]; "A" [shape=doublecircle style=filled]; "S" -> "A"; }\n```\n\n### S\n\none\n\n### S\n\ntwo\n' > "$tmp/dupsec.md"
out="$(python3 "$here/check-dot.py" "$tmp/dupsec.md" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "duplicate section"; then echo "ok   duplicate-section"; else echo "FAIL duplicate-section"; echo "$out"; fails=$((fails+1)); fi

printf '# t\n\n```dot\ndigraph g { "S" [shape=ellipse]; "A" [shape=doublecircle style=filled]; "S" -> "A"; }\n```\n\n````markdown\n### S\n````\n\n### S\n\none\n' > "$tmp/fencedsec.md"
out="$(python3 "$here/check-dot.py" "$tmp/fencedsec.md" 2>&1)"; rc=$?
if [ $rc -eq 0 ]; then echo "ok   fenced-heading-ignored"; else echo "FAIL fenced-heading-ignored"; echo "$out"; fails=$((fails+1)); fi

printf '# nothing here\n' > "$tmp/empty.md"
out="$(python3 "$here/check-dot.py" "$tmp/empty.md" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "no \`\`\`dot block"; then echo "ok   no-blocks"; else echo "FAIL no-blocks"; echo "$out"; fails=$((fails+1)); fi

echo "---"
[ $fails -eq 0 ] && echo "all cases pass" || echo "$fails case(s) failed"
exit $fails
