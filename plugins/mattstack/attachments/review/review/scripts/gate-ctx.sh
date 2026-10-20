#!/bin/sh
# gate-ctx.sh -- validate and flatten a gate-ctx@1 gate open, and fit its
# pane prose to the pane budget.
#   gate-ctx.sh fit [--limit <bytes>] < source.json
#   gate-ctx.sh prose < source.json
# source.json: {"context": <plan@1, post@1 or review@1>, "questions":
# [<question, its "context" a thread@1, reply@1, carryover@1, findings@1 or
# skipped@1 object when it has one>]}.
# fit stdout: {"mode","context","questions","bytes","pane"}. "context" and
# "questions" are the open to store, whole and untrimmed, every context
# already a string, ready for --context and each question's context field.
# A review@1 gate is stored structured only when every findings-* question
# carries a findings@1 context; otherwise (a legacy findings file) it is
# stored as prose. "pane": {"context","questions","fits","trimmed",
# "contextDropped","droppedContexts"} is the prose a pane's form shows as
# it stands, fitted to the limit (PANE_PROSE_LIMIT UTF-8 bytes) and never
# carrying a board-only field: optional parts trimmed first, then whole
# question contexts left out, largest first, then the gate context.
# "contextDropped": true when any context was left out; "droppedContexts"
# names those questions. prose stdout: the untrimmed prose open,
# {"mode","context","questions","bytes"}.
# Exit 0 = ok. Exit 1 = contract violation (one line per problem on
# stderr). Exit 2 = usage.
set -u

usage() { echo "usage: gate-ctx.sh fit [--limit <bytes>] | gate-ctx.sh prose  (source JSON on stdin)" >&2; exit 2; }

MODE=${1:-}
PANE_PROSE_LIMIT=8192
LIMIT=$PANE_PROSE_LIMIT
case "$MODE" in
  fit)
    if [ $# -eq 3 ] && [ "$2" = "--limit" ]; then LIMIT=$3
    elif [ $# -ne 1 ]; then usage; fi ;;
  prose) [ $# -eq 1 ] || usage ;;
  *) usage ;;
esac
case "$LIMIT" in ''|*[!0-9]*) usage ;; esac

LIB=$(cat <<'JQ'
def ok(f): [try f catch false] | length > 0 and all;
def chk(f; $msg): if ok(f) then empty else $msg end;
def str: type == "string" and test("\\S");
def int: type == "number" and . == floor and . >= 0;
def optional($k; f): (has($k) | not) or (.[$k] | f);
def among($xs): . as $v | $xs | index([$v]) != null;
def entries($k): if (.[$k] | type) == "array" then .[$k] else [] end;

def plan_errs: [
  chk(.reviewer | str; "reviewer: required non-empty string"),
  chk(.threads | type == "object"; "threads: required object"),
  chk(.threads.total | int; "threads.total: required integer"),
  chk(.threads | optional("blocking"; int); "threads.blocking: integer when present"),
  chk(optional("round"; int); "round: integer when present"),
  chk(optional("adjudication"; str); "adjudication: non-empty string when present")
];
def post_errs: [
  chk(.reviewer | str; "reviewer: required non-empty string"),
  chk(.replies | int; "replies: required integer"),
  chk(optional("round"; int); "round: integer when present"),
  chk(optional("fixes"; type == "array" and all(.[]; type == "object" and (.sha | str))); "fixes: array of {sha} when present")
];
def thread_errs: [
  chk(.author | str; "author: required non-empty string"),
  chk(.severity | among(["blocking","non-blocking","question","none"]); "severity: blocking|non-blocking|question|none"),
  chk(.claim | type == "object"; "claim: required object"),
  chk(.claim.summary | str; "claim.summary: required non-empty string"),
  chk(.claim | optional("points"; type == "array" and all(.[]; str)); "claim.points: array of strings when present"),
  chk(.verdict | type == "object"; "verdict: required object"),
  chk(.verdict.call | among(["valid","valid-low-value","pushback","needs-clarification","no-ask"]); "verdict.call: valid|valid-low-value|pushback|needs-clarification|no-ask"),
  chk(.verdict | optional("note"; str); "verdict.note: non-empty string when present"),
  chk(.reply | type == "object"; "reply: required object"),
  chk(.reply.kind | among(["verbatim","direction","none"]); "reply.kind: verbatim|direction|none"),
  chk(.reply.kind == "none" or (.reply.text | str); "reply.text: required unless reply.kind is none")
];
def reply_errs($values): [
  chk(.thread | str; "thread: required non-empty string"),
  chk(.file | str; "file: required non-empty string"),
  chk(.verb | among(["reply","fix"]); "verb: reply|fix"),
  chk(.text | str; "text: required non-empty string"),
  chk(optional("sha"; str); "sha: non-empty string when present"),
  chk(.verb == "fix" or (has("sha") | not); "sha: only a fix carries sha"),
  (if .thread | str then .thread as $t
     | if .file == "Overview comment"
       then chk(($values | sort) as $s | $s == ["post:\($t)"] or $s == ["post:\($t)", "resolve:\($t)"]; "options: exactly post:\($t), or post:\($t) and resolve:\($t)")
       else chk(($values | sort) == ["post:\($t)", "resolve:\($t)"]; "options: exactly post:\($t) and resolve:\($t)") end
   else empty end)
];
def carryover_errs($values): [
  chk(.thread | str; "thread: required non-empty string"),
  chk(.round | type == "number" and . == floor and . >= 1; "round: integer of at least 1"),
  chk(.call | among(["fixed","not-fixed","pushback-accepted","pushback-rejected"]); "call: fixed|not-fixed|pushback-accepted|pushback-rejected"),
  chk(.original | str; "original: required non-empty string"),
  chk(.reply | str; "reply: required non-empty string"),
  chk(optional("file"; str); "file: non-empty string when present"),
  chk(optional("authorReply"; str); "authorReply: non-empty string when present"),
  chk(optional("note"; str); "note: non-empty string when present"),
  (if .thread | str then .thread as $t
     | chk(($values | sort) == ["post:\($t)", "resolve:\($t)"]; "options: exactly post:\($t) and resolve:\($t)")
   else empty end)
];
def review_errs: [
  chk(.readiness | among(["yes","no","with-fixes"]); "readiness: yes|no|with-fixes"),
  chk(.summary | str; "summary: required non-empty string"),
  chk(.findings | type == "object"; "findings: required object"),
  (("critical","important","minor") as $s | chk(.findings | optional($s; int); "findings.\($s): integer when present")),
  chk(optional("reviewer"; str); "reviewer: non-empty string when present"),
  chk(optional("round"; type == "number" and . == floor and . >= 1); "round: integer of at least 1 when present"),
  chk(optional("re_review"; type == "boolean"); "re_review: boolean when present"),
  chk(optional("prior"; type == "object" and (.addressed | int) and (.still_open | int)); "prior: {addressed, still_open} integers when present")
];
def findings_errs($values): [
  chk(.findings | type == "array" and length > 0; "findings: required non-empty array"),
  (entries("findings") | to_entries[] | .key as $i | .value | (
    chk(.id | str; "findings[\($i)].id: required non-empty string"),
    chk(.severity | among(["critical","important","minor"]); "findings[\($i)].severity: critical|important|minor"),
    chk(.title | str; "findings[\($i)].title: required non-empty string"),
    chk(.body | str; "findings[\($i)].body: required non-empty string"),
    chk(optional("file"; str); "findings[\($i)].file: non-empty string when present"),
    chk(optional("fix"; str); "findings[\($i)].fix: non-empty string when present"),
    chk(optional("evidence"; str); "findings[\($i)].evidence: non-empty string when present"),
    chk(optional("disposition"; among(["new","still-open","addressed-check"])); "findings[\($i)].disposition: new|still-open|addressed-check"),
    chk(.id as $id | $values | index([$id]) != null; "findings[\($i)].id: matches no option value of this question")
  )),
  ([entries("findings")[] | .id?] as $ids
    | ($values[] | select(. as $v | $ids | index([$v]) == null) | "option \(.): no findings entry carries its value"),
      ($ids | group_by(.) | map(select(length > 1) | .[0])[] | "findings: id \(.) appears more than once"))
];
def skipped_errs($values): [
  chk(.skipped | type == "array" and length > 0; "skipped: required non-empty array"),
  (entries("skipped") | to_entries[] | .key as $i | .value | (
    chk(.id | str; "skipped[\($i)].id: required non-empty string"),
    chk(.round | type == "number" and . == floor and . >= 1; "skipped[\($i)].round: integer of at least 1"),
    chk(.severity | among(["critical","important","minor"]); "skipped[\($i)].severity: critical|important|minor"),
    chk(.title | str; "skipped[\($i)].title: required non-empty string"),
    chk(.changed | type == "boolean"; "skipped[\($i)].changed: required boolean"),
    chk(optional("file"; str); "skipped[\($i)].file: non-empty string when present"),
    chk("restore:\(.id)" as $v | $values | index([$v]) != null; "skipped[\($i)].id: matches no option value of this question")
  )),
  ([entries("skipped")[] | .id?] as $ids
    | ($values[] | select(. as $v | ($ids | map("restore:\(.)")) | index([$v]) == null) | "option \(.): no skipped entry carries its value"),
      ($ids | group_by(.) | map(select(length > 1) | .[0])[] | "skipped: id \(.) appears more than once"))
];
def shape_errs($where; $allowed; $values):
  if type != "object" then ["\($where): context must be an object"]
  elif (.["gate-ctx"] | among($allowed)) | not then ["\($where): gate-ctx must be one of \($allowed | join(", "))"]
  else (
    if .["gate-ctx"] == "plan@1" then plan_errs
    elif .["gate-ctx"] == "post@1" then post_errs
    elif .["gate-ctx"] == "review@1" then review_errs
    elif .["gate-ctx"] == "thread@1" then thread_errs
    elif .["gate-ctx"] == "reply@1" then reply_errs($values)
    elif .["gate-ctx"] == "carryover@1" then carryover_errs($values)
    elif .["gate-ctx"] == "skipped@1" then skipped_errs($values)
    else findings_errs($values) end
  ) | map("\($where): \(.)") end;
def option_values: [.options[]? | if type == "object" then .value else . end];

def errors:
  if (.questions | type) != "array" then ["questions: required array"]
  else
    (if has("context") then .context | shape_errs("gate"; ["plan@1","post@1","review@1"]; []) else [] end)
    + [.questions[] | select(has("context")) | option_values as $v | .id as $id
        | .context | shape_errs("\($id)"; ["thread@1","reply@1","findings@1","carryover@1","skipped@1"]; $v)[]]
    + [.questions[] | select((.context["gate-ctx"]? | among(["reply@1","carryover@1"])) and .multi != true)
        | "\(.id): multi: a per-thread question is multi"]
    + ([.questions[] | select(.context["gate-ctx"]? | among(["reply@1","carryover@1"])) | {id, t: .context.thread}]
        | group_by(.t) | map(select(length > 1) | .[1:][] | "\(.id): thread \(.t) is offered by more than one question"))
  end;

def sev: {"blocking":"BLOCKING","non-blocking":"NON-BLOCKING","question":"QUESTION","none":"NO ASK"}[.];
def plural($n; $one; $many): if $n == 1 then "\($n) \($one)" else "\($n) \($many)" end;
def tier: {"critical":"Critical","important":"Important","minor":"Minor"}[.];
# Per shape, the fields only the board shows (BOARD_ONLY_FIELDS in
# lib/gates/ctx.ts). A name is dropped from the context and from every
# object in the context's top-level arrays.
def board_only: {};
def without_board_only:
  (board_only[.["gate-ctx"] | strings] // []) as $fs
  | if $fs == [] then .
    else del(.[$fs[]])
      | map_values(if type == "array" then map(if type == "object" then del(.[$fs[]]) else . end) else . end)
    end;
def prose:
  without_board_only
  | if .["gate-ctx"] == "plan@1" then
    ["Responding to \(.reviewer)'s review",
     (if has("round") then "round \(.round)" else empty end),
     "\(plural(.threads.total; "thread"; "threads")), \(.threads.blocking // 0) blocking",
     (if has("adjudication") then .adjudication else empty end)] | join(" · ")
  elif .["gate-ctx"] == "post@1" then
    ["Posting replies to \(.reviewer)'s review",
     (if has("round") then "round \(.round)" else empty end),
     plural(.replies; "reply"; "replies"),
     (if (.fixes // []) | length >= 3 then "\(.fixes | length) fixes pushed"
      else (.fixes // [])[] | "fix pushed \(.sha)" end)] | join(" · ")
  elif .["gate-ctx"] == "review@1" then
    ([(if has("reviewer") then "Review by \(.reviewer)" else empty end),
      (if has("round") then "round \(.round)" else empty end),
      (if .re_review == true then "re-review" else empty end),
      (if has("prior") then "prior: \(.prior.addressed) addressed, \(.prior.still_open) still open" else empty end)]
     | if length > 0 then [join(" · ")] else [] end)
    + ["Ready to merge: \(.readiness) -- \(.summary)",
       (.findings as $f | [("critical","important","minor") | select(($f[.] // 0) > 0) | "\(tier) (\($f[.]))"]
        | if length > 0 then join(", ") else "No findings" end)]
    | join("\n")
  elif .["gate-ctx"] == "findings@1" then
    [.findings[]
     | ["[\(.severity | ascii_upcase)] \(.title)" + (if has("file") then " (\(.file))" else "" end)
          + (if has("disposition") then " · \(.disposition)" else "" end),
        .body]
       + (if has("fix") then ["Fix: \(.fix)"] else [] end)
       + (if has("evidence") then ["Evidence: \(.evidence)"] else [] end)
     | join("\n")] | join("\n\n")
  elif .["gate-ctx"] == "carryover@1" then
    ([([(if has("file") then .file else "General thread" end), "round \(.round)",
        {"fixed":"fixed by author","not-fixed":"waiting on author","pushback-accepted":"author pushed back, accept","pushback-rejected":"author pushed back, hold firm"}[.call]]
       | join(" · ")),
      "You wrote: \(.original)"]
     + (if has("authorReply") then ["Author replied: \(.authorReply)"] else ["The author has not replied in this thread."] end)
     + (if has("note") then ["Checked: \(.note)"] else [] end)
     + ["Will post as reply: \(.reply)"]) | join("\n")
  elif .["gate-ctx"] == "skipped@1" then
    [.skipped[]
     | "[\(.severity | ascii_upcase)] \(.title)" + (if has("file") then " (\(.file))" else "" end)
       + " · skipped in round \(.round)" + (if .changed then " · code changed since" else "" end)]
    | join("\n")
  elif .["gate-ctx"] == "thread@1" then
    (["[\(.severity | sev)] \(.author): \(.claim.summary)"]
     + [(.claim.points // [])[] | "- \(.)"]
     + ["Verdict: \(.verdict.call)" + (if .verdict | has("note") then " -- \(.verdict.note)" else "" end)]
     + (if .reply.kind == "verbatim" then ["Will post as reply: \(.reply.text)"]
        elif .reply.kind == "direction" then ["Reply direction: \(.reply.text)"]
        else [] end)) | join("\n")
  else
    "\(.file) " + (if .verb == "fix" then "FIX" + (if has("sha") then " · \(.sha)" else "" end) else "REPLY" end) + ": \(.text)"
  end;

def pane_bytes: (if has("context") then .context | prose | utf8bytelength else 0 end)
  + ([.questions[] | select(has("context")) | .context | prose | utf8bytelength] | add // 0);
def has_field($f): if $f == "points" then .claim | has("points") else .verdict | has("note") end;
def drop_field($f): if $f == "points" then del(.claim.points) else del(.verdict.note) end;
def candidates($f): [.questions | to_entries[]
  | select(.value.context["gate-ctx"]? == "thread@1" and (.value.context | has_field($f)))
  | {i: .key, b: (.value.context | tojson | utf8bytelength)}];
def trim($f; $limit):
  until(pane_bytes < $limit or (candidates($f) | length == 0);
    (candidates($f) | sort_by(-.b, .i) | first.i) as $i
    | .questions[$i].context |= drop_field($f)
    | .trimmed += ["\(.questions[$i].id):\($f)"]);
def carry_candidates($f): [.questions | to_entries[]
  | select(.value.context["gate-ctx"]? == "carryover@1" and (.value.context | has($f)))
  | {i: .key, b: (.value.context | tojson | utf8bytelength)}];
def trim_carry($f; $limit):
  until(pane_bytes < $limit or (carry_candidates($f) | length == 0);
    (carry_candidates($f) | sort_by(-.b, .i) | first.i) as $i
    | .questions[$i].context |= del(.[$f])
    | .trimmed += ["\(.questions[$i].id):\($f)"]);
def long_carry($f): [.questions | to_entries[]
  | select(.value.context["gate-ctx"]? == "carryover@1" and (.value.context[$f] | length) > 80)
  | {i: .key, b: (.value.context | tojson | utf8bytelength)}];
# A second pass cuts out the first marker with the middle half, so a field
# carries one marker however often it shrinks.
def middle: length as $n | ($n / 4 | floor) as $k | .[:$k] + " ... " + .[$n - $k:];
# Shortens, never deletes: carryover@1 reads an absent authorReply as
# "the author never replied", and original is required.
def shorten_carry($f; $limit):
  until(pane_bytes < $limit or (long_carry($f) | length == 0);
    (long_carry($f) | sort_by(-.b, .i) | first.i) as $i
    | .questions[$i].context[$f] |= middle
    | "\(.questions[$i].id):\($f)" as $tag
    | if .trimmed | index([$tag]) then . else .trimmed += [$tag] end);
def entry_candidates($f): [.questions | to_entries[] | .key as $i
  | select(.value.context["gate-ctx"]? == "findings@1")
  | .value.context.findings | to_entries[] | select(.value | has($f))
  | {i: $i, j: .key, b: (.value[$f] | tojson | utf8bytelength)}];
def trim_entries($f; $limit):
  until(pane_bytes < $limit or (entry_candidates($f) | length == 0);
    (entry_candidates($f) | sort_by(-.b, .i, .j) | first) as $c
    | .trimmed += ["\(.questions[$c.i].id):\(.questions[$c.i].context.findings[$c.j].id):\($f)"]
    | .questions[$c.i].context.findings[$c.j] |= del(.[$f]));
def structurable: (.context["gate-ctx"]? != "review@1")
  or all(.questions[] | select(.id | tostring | startswith("findings-")); .context["gate-ctx"]? == "findings@1");

def render($mode):
  {mode: $mode}
  + (if has("context") then {context: (.context | if $mode == "prose" then prose else tojson end)} else {} end)
  + {questions: [.questions[] | if has("context") then .context |= (if $mode == "prose" then prose else tojson end) else . end]}
  | .bytes = ((if has("context") then .context | utf8bytelength else 0 end)
      + ([.questions[] | select(has("context")) | .context | utf8bytelength] | add // 0));

def str_bytes: if type == "string" then utf8bytelength else 0 end;
def open_bytes: (.context | str_bytes) + ([.questions[] | .context | str_bytes] | add // 0);
# Whole question contexts leave the pane largest first (ties to the earliest
# question), then the gate context, until it is under the limit.
def drop_contexts($limit):
  ([.questions | to_entries[] | select(.value | has("context"))
    | {i: .key, b: (.value.context | str_bytes)}] | sort_by(-.b, .i)) as $order
  | reduce $order[] as $c (. + {dropped: [], total: open_bytes};
      if .total < $limit then .
      else .questions[$c.i] |= del(.context) | .total -= $c.b | .dropped += [.questions[$c.i].id]
      end)
  | (if .total >= $limit then del(.context) else . end)
  | del(.total);
def pane($limit):
  (.trimmed = [] | trim("points"; $limit) | trim("note"; $limit)
    | trim_carry("note"; $limit) | shorten_carry("authorReply"; $limit) | shorten_carry("original"; $limit)
    | trim_entries("evidence"; $limit) | trim_entries("fix"; $limit)) as $fitted
  | ($fitted | render("prose")) as $p
  | ($p | drop_contexts($limit)) as $d
  | (if $d | has("context") then {context: $d.context} else {} end)
    + {questions: $d.questions, fits: ($d | open_bytes < $limit), trimmed: $fitted.trimmed,
       contextDropped: (($d.dropped | length > 0) or (($p | has("context")) and ($d | has("context") | not))),
       droppedContexts: $d.dropped};

def main($mode; $limit):
  if $mode == "prose" then render("prose")
  else (if structurable then render("structured") else render("prose") end) + {pane: pane($limit)}
  end;
JQ
)

SRC=$(cat)
ERRS=$(printf '%s' "$SRC" | jq -r "$LIB"' errors[]' 2>/dev/null) || { echo "gate-ctx: stdin is not a JSON object" >&2; exit 1; }
if [ -n "$ERRS" ]; then printf '%s\n' "$ERRS" >&2; exit 1; fi
printf '%s' "$SRC" | jq -c --arg mode "$MODE" --argjson limit "$LIMIT" "$LIB"' main($mode; $limit)'
