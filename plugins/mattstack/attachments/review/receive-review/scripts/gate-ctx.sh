#!/bin/sh
# gate-ctx.sh -- validate, size-fit, and flatten a gate-ctx@1 gate open.
#   gate-ctx.sh fit [--limit <bytes>] < source.json
#   gate-ctx.sh prose < source.json
# source.json: {"context": <gate-level object>, "questions": [<question,
# its "context" an object when it has one>]}.
# stdout: {"mode","bytes","trimmed","context","questions"}, every context
# already a string, ready for --context and each question's context field.
# Exit 0 = ok. Exit 1 = contract violation (one line per problem on
# stderr). Exit 2 = usage.
set -u

usage() { echo "usage: gate-ctx.sh fit [--limit <bytes>] | gate-ctx.sh prose  (source JSON on stdin)" >&2; exit 2; }

MODE=${1:-}
LIMIT=8192
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
def str: type == "string" and length > 0;
def int: type == "number" and . == floor and . >= 0;
def optional($k; f): (has($k) | not) or (.[$k] | f);
def among($xs): . as $v | $xs | index([$v]) != null;

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
def replies_errs($values): [
  chk(.replies | type == "array" and length > 0; "replies: required non-empty array"),
  ((.replies // []) | to_entries[] | .key as $i | .value | (
    chk(.thread | str; "replies[\($i)].thread: required non-empty string"),
    chk(.file | str; "replies[\($i)].file: required non-empty string"),
    chk(.verb | among(["reply","fix"]); "replies[\($i)].verb: reply|fix"),
    chk(.text | str; "replies[\($i)].text: required non-empty string"),
    chk(optional("sha"; str); "replies[\($i)].sha: non-empty string when present"),
    chk(.thread as $t | $values | index([$t]) != null; "replies[\($i)].thread: matches no option value of this question")
  ))
];
def shape_errs($where; $allowed; $values):
  if type != "object" then ["\($where): context must be an object"]
  elif (.["gate-ctx"] | among($allowed)) | not then ["\($where): gate-ctx must be one of \($allowed | join(", "))"]
  else (
    if .["gate-ctx"] == "plan@1" then plan_errs
    elif .["gate-ctx"] == "post@1" then post_errs
    elif .["gate-ctx"] == "thread@1" then thread_errs
    else replies_errs($values) end
  ) | map("\($where): \(.)") end;
def option_values: [.options[]? | if type == "object" then .value else . end];

def errors:
  if (.questions | type) != "array" then ["questions: required array"]
  else
    (if has("context") then .context | shape_errs("gate"; ["plan@1","post@1"]; []) else [] end)
    + [.questions[] | select(has("context")) | option_values as $v | .id as $id
        | .context | shape_errs("\($id)"; ["thread@1","replies@1"]; $v)[]]
  end;

def sev: {"blocking":"BLOCKING","non-blocking":"NON-BLOCKING","question":"QUESTION","none":"NO ASK"}[.];
def plural($n; $one; $many): if $n == 1 then "\($n) \($one)" else "\($n) \($many)" end;
def prose:
  if .["gate-ctx"] == "plan@1" then
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
  elif .["gate-ctx"] == "thread@1" then
    (["[\(.severity | sev)] \(.author): \(.claim.summary)"]
     + [(.claim.points // [])[] | "- \(.)"]
     + ["Verdict: \(.verdict.call)" + (if .verdict | has("note") then " -- \(.verdict.note)" else "" end)]
     + (if .reply.kind == "verbatim" then ["Will post as reply: \(.reply.text)"]
        elif .reply.kind == "direction" then ["Reply direction: \(.reply.text)"]
        else [] end)) | join("\n")
  else
    [.replies[] | "\(.file) " + (if .verb == "fix" then "FIX" + (if has("sha") then " · \(.sha)" else "" end) else "REPLY" end) + ": \(.text)"] | join("\n")
  end;

def ctx_bytes: (if has("context") then .context | tojson | utf8bytelength else 0 end)
  + ([.questions[] | select(has("context")) | .context | tojson | utf8bytelength] | add // 0);
def has_field($f): if $f == "points" then .claim | has("points") else .verdict | has("note") end;
def drop_field($f): if $f == "points" then del(.claim.points) else del(.verdict.note) end;
def candidates($f): [.questions | to_entries[]
  | select(.value.context["gate-ctx"]? == "thread@1" and (.value.context | has_field($f)))
  | {i: .key, b: (.value.context | tojson | utf8bytelength)}];
def trim($f; $limit):
  until(ctx_bytes < $limit or (candidates($f) | length == 0);
    (candidates($f) | sort_by(-.b, .i) | first.i) as $i
    | .questions[$i].context |= drop_field($f)
    | .trimmed += ["\(.questions[$i].id):\($f)"]);

def render($mode; $flatten):
  {mode: $mode, trimmed: (.trimmed // [])}
  + (if has("context") then {context: (.context | if $flatten then prose else tojson end)} else {} end)
  + {questions: [.questions[] | if has("context") then .context |= (if $flatten then prose else tojson end) else . end]}
  | .bytes = ((if has("context") then .context | utf8bytelength else 0 end)
      + ([.questions[] | select(has("context")) | .context | utf8bytelength] | add // 0));

def main($mode; $limit):
  if $mode == "prose" then render("prose"; true)
  else . as $src
    | (.trimmed = [] | trim("points"; $limit) | trim("note"; $limit)) as $fitted
    | if ($fitted | ctx_bytes) < $limit then $fitted | render("structured"; false)
      else $src | render("prose"; true) end
  end;
JQ
)

SRC=$(cat)
ERRS=$(printf '%s' "$SRC" | jq -r "$LIB"' errors[]' 2>/dev/null) || { echo "gate-ctx: stdin is not a JSON object" >&2; exit 1; }
if [ -n "$ERRS" ]; then printf '%s\n' "$ERRS" >&2; exit 1; fi
printf '%s' "$SRC" | jq -c --arg mode "$MODE" --argjson limit "$LIMIT" "$LIB"' main($mode; $limit)'
