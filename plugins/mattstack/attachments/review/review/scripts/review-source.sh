#!/bin/sh
# review-source.sh -- build the review-post gate source from a report's
# findings json, ready for gate-ctx.sh fit.
#   review-source.sh <findings.json> <extras.json>
# extras.json: {"target": "!87", "reviewer"?, "round"?, "questions": [<the
# questions that follow the findings, outcome first>]}.
# stdout: {"context": <review@1>, "questions": [thread-1.., findings-1..,
# skipped-1.., extras questions]}. Findings go Critical, Important, Minor
# (report order within a tier), four options per findings-N question;
# skipped findings keep report order, four per skipped-N question, and no
# restore:<id> option is ever recommended. Option labels and
# descriptions are the degraded view older renderers parse: keep their recipe
# byte-exact. A findings file without "version" 2 or 3 is legacy: its
# findings questions carry no context, so fit turns the whole gate to prose.
# Exit 0 = ok. Exit 1 = contract violation (one line per problem on
# stderr). Exit 2 = usage.
set -u

[ $# -eq 2 ] || { echo "usage: review-source.sh <findings.json> <extras.json>" >&2; exit 2; }
[ -r "$1" ] && [ -r "$2" ] || { echo "review-source: cannot read $1 or $2" >&2; exit 2; }

LIB=$(cat <<'JQ'
def ok(f): [try f catch false] | length > 0 and all;
def chk(f; $msg): if ok(f) then empty else $msg end;
def str: type == "string" and length > 0;
def int: type == "number" and . == floor and . >= 0;
def optional($k; f): (has($k) | not) or (.[$k] | f);
def among($xs): . as $v | $xs | index([$v]) != null;
def entries: if (.findings | type) == "array" then .findings else [] end;
def threads: if (.threads | type) == "array" then .threads else [] end;
def skips: if (.skipped | type) == "array" then .skipped else [] end;
def structured: .version == 2 or .version == 3;
def pos: type == "number" and . == floor and . >= 1;

def file_errs: [
  chk(optional("version"; . == 2 or . == 3); "version: 2 or 3 when present (absent is a legacy file)"),
  chk(.summary.readiness | among(["yes","no","with-fixes"]); "summary.readiness: yes|no|with-fixes"),
  chk(.summary.reasoning | str; "summary.reasoning: required non-empty string"),
  chk(.findings | type == "array"; "findings: required array"),
  chk(optional("re_review"; type == "boolean"); "re_review: boolean when present"),
  chk(optional("prior"; type == "object" and (.addressed | int) and (.still_open | int)); "prior: {addressed, still_open} integers when present"),
  structured as $v2
  | (entries | to_entries[] | .key as $i | .value | (
      chk(.id | str; "findings[\($i)].id: required non-empty string"),
      chk(.tier | among(["Critical","Important","Minor"]); "findings[\($i)].tier: Critical|Important|Minor"),
      chk(.title | str; "findings[\($i)].title: required non-empty string"),
      (if $v2 then chk(.body | str; "findings[\($i)].body: required non-empty string") else empty end),
      chk(optional("evidence"; str); "findings[\($i)].evidence: non-empty string when present"),
      chk(optional("disposition"; among(["new","still-open","addressed-check"])); "findings[\($i)].disposition: new|still-open|addressed-check"),
      chk(optional("file"; str); "findings[\($i)].file: non-empty string when present"),
      chk(optional("line"; int); "findings[\($i)].line: integer when present"),
      chk(optional("fileLabel"; str); "findings[\($i)].fileLabel: non-empty string when present"),
      chk(optional("fix"; str); "findings[\($i)].fix: non-empty string when present"),
      chk(optional("kind"; str); "findings[\($i)].kind: non-empty string when present")
    )),
  chk(optional("threads"; type == "array"); "threads: array when present"),
  (threads | to_entries[] | .key as $i | .value | (
      chk(.discussionId | str; "threads[\($i)].discussionId: required non-empty string"),
      chk(.round | pos; "threads[\($i)].round: integer of at least 1"),
      chk(.call | among(["fixed","not-fixed","pushback-accepted","pushback-rejected"]); "threads[\($i)].call: fixed|not-fixed|pushback-accepted|pushback-rejected"),
      chk(.original | str; "threads[\($i)].original: required non-empty string"),
      chk(.reply | str; "threads[\($i)].reply: required non-empty string"),
      chk(optional("file"; str); "threads[\($i)].file: non-empty string when present"),
      chk(optional("line"; pos); "threads[\($i)].line: integer of at least 1 when present"),
      chk(optional("authorReply"; str); "threads[\($i)].authorReply: non-empty string when present"),
      chk(optional("note"; str); "threads[\($i)].note: non-empty string when present")
    )),
  ([threads[] | .discussionId?] | group_by(.) | map(select(length > 1) | .[0])[] | "threads: discussion \(.) appears more than once"),
  chk(optional("skipped"; type == "array"); "skipped: array when present"),
  (skips | to_entries[] | .key as $i | .value | (
      chk(.id | str; "skipped[\($i)].id: required non-empty string"),
      chk(.round | pos; "skipped[\($i)].round: integer of at least 1"),
      chk(.tier | among(["Critical","Important","Minor"]); "skipped[\($i)].tier: Critical|Important|Minor"),
      chk(.title | str; "skipped[\($i)].title: required non-empty string"),
      chk(.changed | type == "boolean"; "skipped[\($i)].changed: required boolean"),
      chk(optional("file"; str); "skipped[\($i)].file: non-empty string when present"),
      chk(optional("line"; pos); "skipped[\($i)].line: integer of at least 1 when present")
    )),
  ([skips[] | .id?] | group_by(.) | map(select(length > 1) | .[0])[] | "skipped: id \(.) appears more than once"),
  ([entries[] | .id?] | group_by(.) | map(select(length > 1) | .[0])[] | "findings: id \(.) appears more than once")
];
def extras_errs: [
  chk(.target | str; "target: required non-empty string"),
  chk(optional("reviewer"; str); "reviewer: non-empty string when present"),
  chk(optional("round"; type == "number" and . == floor and . >= 1); "round: integer of at least 1 when present"),
  chk(.questions | type == "array" and length > 0 and all(.[]; type == "object" and (.id | str)); "questions: required non-empty array of questions with an id"),
  chk(all(.questions[]; .id | (startswith("findings-") or startswith("thread-") or startswith("skipped-")) | not); "questions: findings-*, thread-* and skipped-* ids are built from the findings file")
];

def mid_trunc($max):
  if utf8bytelength <= $max then .
  else explode as $cs | ($cs | length) as $n
    | first(range($n - 1; -1; -1) as $k
        | ($cs[0:(($k + 1) / 2 | floor)] | implode) + "…" + ($cs[($n - ($k / 2 | floor)):] | implode)
        | select(utf8bytelength <= $max))
  end;
def end_trunc($max):
  if utf8bytelength <= $max then .
  elif $max < 3 then ""
  else explode as $cs
    | first(range(($cs | length) - 1; -1; -1) as $k | ($cs[0:$k] | implode) + "…" | select(utf8bytelength <= $max))
  end;
def anchor: if has("file") and has("line") then "\(.file):\(.line)" elif has("file") then .file else .fileLabel end;
def kind_word: (.kind // "") | ascii_downcase | gsub("[\\s_]+"; "-") | gsub("[^a-z-]"; "") | gsub("-+"; "-") | ltrimstr("-") | rtrimstr("-");
def opt_label: "[\(.tier)] " as $p | $p + (.title | mid_trunc(200 - ($p | utf8bytelength)));
def opt_description:
  (if anchor then anchor + " · " else "" end) as $head
  | (kind_word | if . == "" then "" else " · kind:\(.)" end) as $tail
  | (if has("fix") then .fix | end_trunc(1024 - ($head | utf8bytelength) - ($tail | utf8bytelength)) else "" end) as $fix
  | if $fix != "" then $head + $fix + $tail
    elif anchor then anchor + $tail
    else null end;
def option: {value: .id, label: opt_label} + (opt_description as $d | if $d then {description: $d} else {} end);
def entry: {id, severity: (.tier | ascii_downcase), title, body}
  + (if has("file") then {file: (if has("line") then "\(.file):\(.line)" else .file end)} else {} end)
  + with_entries(select(.key == "fix" or .key == "evidence" or .key == "disposition"));
def rank: {"Critical": 0, "Important": 1, "Minor": 2}[.tier];
def thread_anchor: if has("file") and has("line") then "\(.file):\(.line)" elif has("file") then .file else null end;
def settled: .call == "fixed" or .call == "pushback-accepted";
def thread_question($n):
  thread_anchor as $a
  | {id: "thread-\($n)", label: ($a // "General thread"), multi: true,
     context: ({"gate-ctx": "carryover@1", thread: .discussionId, round, call, original, reply}
       + (if $a then {file: $a} else {} end)
       + with_entries(select(.key == "authorReply" or .key == "note"))),
     options: [{value: "post:\(.discussionId)", label: "Post reply (recommended)"},
               {value: "resolve:\(.discussionId)", label: (if settled then "Resolve thread (recommended)" else "Resolve thread" end)}]};
def skip_option:
  thread_anchor as $a
  | {value: "restore:\(.id)", label: opt_label,
     description: ([$a, "skipped in round \(.round)", (if .changed then "code changed since" else null end)] | map(select(. != null)) | join(" · "))};
def skip_entry:
  thread_anchor as $a
  | {id, round, severity: (.tier | ascii_downcase), title}
    + (if $a then {file: $a} else {} end)
    + {changed};

def build($x):
  structured as $v2
  | (.findings | sort_by(rank)) as $ordered
  | skips as $skips
  | {context: ({"gate-ctx": "review@1"}
      + ($x | with_entries(select(.key == "reviewer")))
      + {readiness: .summary.readiness, summary: .summary.reasoning,
         findings: ($ordered | group_by(rank) | map({key: (.[0].tier | ascii_downcase), value: length}) | from_entries)}
      + ($x | with_entries(select(.key == "round")))
      + with_entries(select(.key == "re_review" or .key == "prior"))),
     questions: ((threads | to_entries | map(.key as $i | .value | thread_question($i + 1)))
       + ([range(0; $ordered | length; 4) as $i | $ordered[$i:$i + 4]] | to_entries
       | map({id: "findings-\(.key + 1)", label: "Post which findings to \($x.target)?", multi: true}
           + (if $v2 then {context: {"gate-ctx": "findings@1", findings: (.value | map(entry))}} else {} end)
           + {options: (.value | map(option))}))
       + ([range(0; $skips | length; 4) as $i | $skips[$i:$i + 4]] | to_entries
          | map({id: "skipped-\(.key + 1)", label: "Bring back a finding you skipped earlier?", multi: true,
                 context: {"gate-ctx": "skipped@1", skipped: (.value | map(skip_entry))},
                 options: (.value | map(skip_option))}))
       + $x.questions)};
JQ
)

ERRS=$(jq -r "$LIB"' file_errs[] | "findings file: \(.)"' "$1" 2>/dev/null) || { echo "review-source: $1 is not a JSON object" >&2; exit 1; }
XERRS=$(jq -r "$LIB"' extras_errs[] | "extras: \(.)"' "$2" 2>/dev/null) || { echo "review-source: $2 is not a JSON object" >&2; exit 1; }
ALL=$(printf '%s\n%s\n' "$ERRS" "$XERRS" | sed '/^$/d')
if [ -n "$ALL" ]; then printf '%s\n' "$ALL" >&2; exit 1; fi
jq -c --slurpfile x "$2" "$LIB"' build($x[0])' "$1"
