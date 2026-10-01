---
name: board:review
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to review an MR in a fresh
  herdr pane. Emits lifecycle status through the board's status CLI, then
  delegates the actual review to the skill named by --skill (or reviews
  generically when none is given). Invoked as "/board:review
  <mrUrl> --state <path> --status-bin <path> [--report <path>] [--skill <name>]
  [--re-review]". When no --skill is given, the domain skill is resolved from
  the review slot binding in the pack's bindings file
  (repos/<slug>/packs/<pack>/skills.jsonc, chosen by MATTSTACK_PACK). Not for
  manual use.
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*), Bash(${CLAUDE_SKILL_DIR}/scripts/open-gate.sh:*)
metadata:
  slots: "review"
  slot-review: "required mr-review@2 -- owns the domain review flow for one MR: resolving the MR/ticket, producing the draft review, writing the report, reporting the severity levels present, and executing the posting once handed the human's decision. Never presents posting gates or decides disposition."
  compiled: "mattstack:gate-protocol@0.30.4"
---

<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->

<!-- part: step source=review/SKILL.md path=review/SKILL.md lines=20-1581 -->
# mr-board review runner

The mr-board spawned this pane to review one MR and report status back to the
board through its status CLI. A human decides the verdict only at a gate. This
wrapper carries **no** repo-, team-, or tool-specific knowledge: the board
injects everything it needs as flags:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | the merge request to review |
| `--state <handle>` | opaque board handle for this MR's review. Pass it verbatim to `--status-bin` and the `gate` verbs; never read, stat, or write it. It looks like a `.json` path but no such file exists: board state lives in the board's database, and the path is only a key. Its absence on disk says nothing about whether the board is tracking this pass. |
| `--status-bin <path>` | absolute path to the board's status-writer CLI; run it to emit status |
| `--report <path>` | where to save the written review the board shows in a modal |
| `--skill <name>` | the domain skill that owns the actual review (optional) |
| `--skill-path <path>` | absolute path to that skill's SKILL.md, when the board already resolved it (optional; see "Resolving the domain skill") |
| `--re-review` | this is a re-review of an already-reviewed MR (optional; see "Re-review mode") |
| `--resumed-gate <gateId>` | this invocation is a parked-gate resume, not a fresh review (optional; see "Resumed entry" under Flow) |
| `--resumed-gate-kind <kind>` | the `kind` of the gate `--resumed-gate` names (`review-post` or `review-escalation`). Present exactly when `--resumed-gate` is, and the only way to learn it: `--state` is an opaque handle and `gate wait` returns only the answer. |

Write status **only** by running the injected `--status-bin`:

```
<status-bin> review-status <state> <status> [message] [--outcome <comment|approve>]
```

## Flow

The graph is the map: start at the trigger and take only the edges it
draws. Each box has its own section below the graph.

```dot
digraph review_flow {
    rankdir=TB;

    "Trigger: the board launched /board:review" [shape=ellipse];
    "--resumed-gate given (review)?" [shape=diamond];
    "--re-review given?" [shape=diamond];
    "Print the RE-REVIEW banner as the first output" [shape=box];
    "<status-bin> review-status <state> reviewing" [shape=plaintext];
    "--skill given (review)?" [shape=diamond];
    "--skill-path given (review)?" [shape=diamond];
    "Read <--skill-path> (review)" [shape=plaintext];
    "Load the --skill domain skill by name (review)" [shape=box];
    "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh (review)" [shape=plaintext];
    "resolve-args.sh exit (review)?" [shape=diamond];
    "Read <resolved.review.path>" [shape=plaintext];
    "Print the resolver's errors verbatim (review)" [shape=box];
    "Which entry (review)?" [shape=diamond];

    "<status-bin> gate wait <state> (resumed review gate)" [shape=plaintext];
    "Resumed wait result (review)?" [shape=diamond];
    "Resumed wait failures = 3 (review)?" [shape=diamond];
    "Resumed kind (review)?" [shape=diamond];
    "Read <--report> and its json sibling (resumed review)" [shape=plaintext];
    "Report fits the resumed answer (review)?" [shape=diamond];
    "Route the resumed escalation by its origin (review)" [shape=box];
    "Resumed escalation origin (review)?" [shape=diamond];
    "Read <--report>, its verdict line and json sibling (resumed escalation)" [shape=plaintext];
    "Verdict line present (review)?" [shape=diamond];
    "Read <--report> (prior review, resumed re-review)" [shape=plaintext];

    "Prior review at --report (re-review)?" [shape=diamond];
    "Read <--report> (prior review)" [shape=plaintext];
    "Domain skill resolved (review)?" [shape=diamond];
    "Delegate the review to the domain skill" [shape=box];
    "Domain review result?" [shape=diamond];
    "rt_verb {args: [skills, writing-style, show]} (review)" [shape=plaintext];
    "rt_verb named a style skill (review)?" [shape=diamond];
    "Load the named writing-style skill (review)" [shape=box];
    "Load the preferences.md style, else conversational (review)" [shape=box];
    "Which entry (review writing style)?" [shape=diamond];
    "mr_view {mrUrl} (review)" [shape=plaintext];
    "mr_view result (review)?" [shape=diamond];
    "STOP: MR reads go through mr_view (review)" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Fixed the mr_view call once already (review)?" [shape=diamond];
    "Fix what the mr_view error names (review)" [shape=box];
    "review off-script gate: mr_view refused" [shape=box];
    "Off-script outcome (mr_view, review)?" [shape=diamond];
    "Off-script rounds = 2 (mr_view, review)?" [shape=diamond];
    "--re-review given (thread read)?" [shape=diamond];
    "mr_threads {mrUrl, refresh: true} (re-review)" [shape=plaintext];
    "mr_threads result (re-review)?" [shape=diamond];
    "STOP: threads are read with mr_threads (review)" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Fixed the re-review mr_threads call once already?" [shape=diamond];
    "Fix what the re-review mr_threads error names" [shape=box];
    "review off-script gate: mr_threads refused (re-review)" [shape=box];
    "Off-script outcome (re-review mr_threads)?" [shape=diamond];
    "Off-script rounds = 2 (re-review mr_threads)?" [shape=diamond];
    "Review the MR yourself" [shape=box];
    "Generic review result?" [shape=diamond];
    "Write the review report to --report" [shape=box];

    "Fitted review-post open file handed back?" [shape=diamond];
    "${CLAUDE_SKILL_DIR}/scripts/open-gate.sh <status-bin> <state> review-post <open-file>" [shape=plaintext];
    "Report json sibling (review)?" [shape=diamond];
    "Build the per-finding questions (findings-N, outcome)" [shape=box];
    "Build the outcome-only question (clean review)" [shape=box];
    "Print the tier-fallback line in the pane" [shape=box];
    "Build the tier-fallback questions (tiers, outcome)" [shape=box];
    "<status-bin> gate open <state> --kind review-post --questions <json> --context <text>" [shape=plaintext];
    "review-post open exit?" [shape=diamond];
    "review-post: take the review gate step" [shape=box];
    "review-post step outcome?" [shape=diamond];
    "Ask the review questions as one combined native form (degraded)" [shape=box];
    "Record the verdict answer in --report" [shape=box];

    "Domain skill resolved (review act)?" [shape=diamond];
    "Hand the answer to the domain skill to post" [shape=box];
    "Domain posting result (review)?" [shape=diamond];
    "Writing style loaded (review act)?" [shape=diamond];
    "Record the resumed take's mark in --report (review)" [shape=box];
    "Resumed pane (review posting)?" [shape=diamond];
    "mr_threads {mrUrl, refresh: true} (review posted already)" [shape=plaintext];
    "mr_threads result (review posted already)?" [shape=diamond];
    "STOP: the Posted already read goes through mr_threads (review)" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Fixed the posted-already mr_threads call once already (review)?" [shape=diamond];
    "Fix what the posted-already mr_threads error names (review)" [shape=box];
    "Mark the findings and summary already posted" [shape=box];
    "review off-script gate: mr_threads refused (posted already)" [shape=box];
    "Off-script outcome (review posted-already mr_threads)?" [shape=diamond];
    "Off-script rounds = 2 (review posted-already mr_threads)?" [shape=diamond];
    "Findings left to post (review)?" [shape=diamond];
    "Anchored to a diff line (this finding)?" [shape=diamond];
    "mr_comment_inline {mrUrl, body, path, line}" [shape=plaintext];
    "mr_comment_inline result?" [shape=diamond];
    "STOP: review comments post through the mr_* tools" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Fixed the mr_comment_inline call once already?" [shape=diamond];
    "Fix what the mr_comment_inline error names" [shape=box];
    "Add the finding to the summary note" [shape=box];
    "Summary note carries findings?" [shape=diamond];
    "mr_comment {mrUrl, body}" [shape=plaintext];
    "mr_comment result?" [shape=diamond];
    "STOP: the summary note posts through mr_comment" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Fixed the mr_comment call once already?" [shape=diamond];
    "Fix what the mr_comment error names" [shape=box];
    "Outcome is approve?" [shape=diamond];
    "mr_approve {mrUrl}" [shape=plaintext];
    "mr_approve result?" [shape=diamond];
    "STOP: the approval goes through mr_approve" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Fixed the mr_approve call once already?" [shape=diamond];
    "Fix what the mr_approve error names" [shape=box];

    "review off-script gate: mr_comment_inline refused" [shape=box];
    "Off-script outcome (mr_comment_inline)?" [shape=diamond];
    "Off-script rounds = 2 (mr_comment_inline)?" [shape=diamond];
    "review off-script gate: mr_comment refused" [shape=box];
    "Off-script outcome (mr_comment)?" [shape=diamond];
    "Off-script rounds = 2 (mr_comment)?" [shape=diamond];
    "review off-script gate: mr_approve refused" [shape=box];
    "Off-script outcome (mr_approve)?" [shape=diamond];
    "Off-script rounds = 2 (mr_approve)?" [shape=diamond];

    "<status-bin> review-status <state> done <summary> --outcome <comment|approve>" [shape=plaintext];
    "<status-bin> review-status <state> error <what went wrong>" [shape=plaintext];
    "Review error written: stay in the pane and report" [shape=doublecircle];
    "Review gate gone: ended cleanly, no status write" [shape=doublecircle];
    "Held at a review off-script gate: the pane stays" [shape=doublecircle];
    "Review done: the board closes this tab" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: the board launched /board:review" -> "--resumed-gate given (review)?";
    "--resumed-gate given (review)?" -> "<status-bin> review-status <state> reviewing" [label="yes"];
    "--resumed-gate given (review)?" -> "--re-review given?" [label="no: a fresh review"];
    "--re-review given?" -> "Print the RE-REVIEW banner as the first output" [label="yes"];
    "--re-review given?" -> "<status-bin> review-status <state> reviewing" [label="no"];
    "Print the RE-REVIEW banner as the first output" -> "<status-bin> review-status <state> reviewing";
    "<status-bin> review-status <state> reviewing" -> "--skill given (review)?";
    "--skill given (review)?" -> "--skill-path given (review)?" [label="yes"];
    "--skill given (review)?" -> "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh (review)" [label="no"];
    "--skill-path given (review)?" -> "Read <--skill-path> (review)" [label="yes"];
    "--skill-path given (review)?" -> "Load the --skill domain skill by name (review)" [label="no"];
    "Read <--skill-path> (review)" -> "Which entry (review)?";
    "Load the --skill domain skill by name (review)" -> "Which entry (review)?";
    "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh (review)" -> "resolve-args.sh exit (review)?";
    "resolve-args.sh exit (review)?" -> "Read <resolved.review.path>" [label="0"];
    "resolve-args.sh exit (review)?" -> "Print the resolver's errors verbatim (review)" [label="nonzero: generic path"];
    "Read <resolved.review.path>" -> "Which entry (review)?";
    "Print the resolver's errors verbatim (review)" -> "Which entry (review)?";
    "Which entry (review)?" -> "<status-bin> gate wait <state> (resumed review gate)" [label="resumed gate"];
    "Which entry (review)?" -> "Prior review at --report (re-review)?" [label="fresh review"];

    "<status-bin> gate wait <state> (resumed review gate)" -> "Resumed wait result (review)?";
    "Resumed wait result (review)?" -> "Resumed kind (review)?" [label="answered"];
    "Resumed wait result (review)?" -> "Review gate gone: ended cleanly, no status write" [label="closed, not found, or no gate open"];
    "Resumed wait result (review)?" -> "Resumed wait failures = 3 (review)?" [label="any other failure"];
    "Resumed wait failures = 3 (review)?" -> "<status-bin> gate wait <state> (resumed review gate)" [label="no: wait again"];
    "Resumed wait failures = 3 (review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="yes"];
    "Resumed kind (review)?" -> "Read <--report> and its json sibling (resumed review)" [label="review-post"];
    "Resumed kind (review)?" -> "Route the resumed escalation by its origin (review)" [label="review-escalation"];
    "Read <--report> and its json sibling (resumed review)" -> "Report fits the resumed answer (review)?";
    "Report fits the resumed answer (review)?" -> "Record the verdict answer in --report" [label="yes, or the answer is outcome alone"];
    "Report fits the resumed answer (review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="no: missing or malformed for the answer's shape"];
    "Route the resumed escalation by its origin (review)" -> "Resumed escalation origin (review)?";
    "Resumed escalation origin (review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="iterate at round 2, any origin: the refusals are the reason"];
    "Resumed escalation origin (review)?" -> "Delegate the review to the domain skill" [label="a pre-verdict origin, take or iterate at round 1, a domain skill resolved on this resume: it reviews afresh"];
    "Resumed escalation origin (review)?" -> "rt_verb {args: [skills, writing-style, show]} (review)" [label="generic path, mr_view, not on a re-review: take with branches, or iterate at round 1"];
    "Resumed escalation origin (review)?" -> "Read <--report> (prior review, resumed re-review)" [label="generic path, a re-review origin: take, or iterate at round 1"];
    "Resumed escalation origin (review)?" -> "Read <--report>, its verdict line and json sibling (resumed escalation)" [label="a posting origin: take, or iterate at round 1"];
    "Resumed escalation origin (review)?" -> "Held at a review off-script gate: the pane stays" [label="hold"];
    "Resumed escalation origin (review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="hand back, or a generic-path take at mr_view with no branches"];
    "Read <--report> (prior review, resumed re-review)" -> "rt_verb {args: [skills, writing-style, show]} (review)";
    "Read <--report>, its verdict line and json sibling (resumed escalation)" -> "Verdict line present (review)?";
    "Verdict line present (review)?" -> "Domain skill resolved (review act)?" [label="yes, and the report fits its answer"];
    "Verdict line present (review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="no, or the report does not fit its answer"];

    "Prior review at --report (re-review)?" -> "Read <--report> (prior review)" [label="yes, and --re-review given"];
    "Prior review at --report (re-review)?" -> "Domain skill resolved (review)?" [label="no, or not a re-review"];
    "Read <--report> (prior review)" -> "Domain skill resolved (review)?";
    "Domain skill resolved (review)?" -> "Delegate the review to the domain skill" [label="yes"];
    "Domain skill resolved (review)?" -> "rt_verb {args: [skills, writing-style, show]} (review)" [label="no: generic path"];
    "Delegate the review to the domain skill" -> "Domain review result?";
    "Domain review result?" -> "Fitted review-post open file handed back?" [label="report written, severity levels handed back"];
    "Domain review result?" -> "<status-bin> review-status <state> error <what went wrong>" [label="failed: bad MR, mismatched ticket, fetch failure"];
    "rt_verb {args: [skills, writing-style, show]} (review)" -> "rt_verb named a style skill (review)?";
    "rt_verb named a style skill (review)?" -> "Load the named writing-style skill (review)" [label="yes"];
    "rt_verb named a style skill (review)?" -> "Load the preferences.md style, else conversational (review)" [label="no: refused, failed or unavailable"];
    "Load the named writing-style skill (review)" -> "Which entry (review writing style)?";
    "Load the preferences.md style, else conversational (review)" -> "Which entry (review writing style)?";
    "Which entry (review writing style)?" -> "mr_view {mrUrl} (review)" [label="fresh review"];
    "Which entry (review writing style)?" -> "Resumed pane (review posting)?" [label="posting the answer, not a resumed take"];
    "Which entry (review writing style)?" -> "Record the resumed take's mark in --report (review)" [label="posting the answer, a resumed take at a posting origin or the Posted already read"];
    "Record the resumed take's mark in --report (review)" -> "Resumed pane (review posting)?";
    "Which entry (review writing style)?" -> "mr_view {mrUrl} (review)" [label="resumed escalation, pre-verdict origin, not a take at mr_view"];
    "Which entry (review writing style)?" -> "--re-review given (thread read)?" [label="resumed escalation, take at mr_view: branches from its note"];
    "mr_view {mrUrl} (review)" -> "mr_view result (review)?";
    "mr_view result (review)?" -> "--re-review given (thread read)?" [label="ok: keep title, description, branches"];
    "mr_view result (review)?" -> "Fixed the mr_view call once already (review)?" [label="tool error"];
    "mr_view result (review)?" -> "STOP: MR reads go through mr_view (review)" [label="tempted to read the MR with the GitLab CLI or the API"];
    "STOP: MR reads go through mr_view (review)" -> "Fixed the mr_view call once already (review)?";
    "Fixed the mr_view call once already (review)?" -> "Fix what the mr_view error names (review)" [label="no"];
    "Fixed the mr_view call once already (review)?" -> "review off-script gate: mr_view refused" [label="yes"];
    "Fix what the mr_view error names (review)" -> "mr_view {mrUrl} (review)";
    "review off-script gate: mr_view refused" -> "Off-script outcome (mr_view, review)?";
    "Off-script outcome (mr_view, review)?" -> "--re-review given (thread read)?" [label="take: the human gave the branches in the note"];
    "Off-script outcome (mr_view, review)?" -> "Off-script rounds = 2 (mr_view, review)?" [label="iterate: the cause is fixed"];
    "Off-script outcome (mr_view, review)?" -> "Held at a review off-script gate: the pane stays" [label="hold"];
    "Off-script outcome (mr_view, review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="hand back"];
    "Off-script outcome (mr_view, review)?" -> "Review gate gone: ended cleanly, no status write" [label="gate gone"];
    "Off-script outcome (mr_view, review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="gate unavailable"];
    "Off-script rounds = 2 (mr_view, review)?" -> "mr_view {mrUrl} (review)" [label="no: read again"];
    "Off-script rounds = 2 (mr_view, review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="yes: the refusals are the reason"];
    "--re-review given (thread read)?" -> "mr_threads {mrUrl, refresh: true} (re-review)" [label="yes, or a resumed re-review origin other than a re-review mr_threads take"];
    "--re-review given (thread read)?" -> "Review the MR yourself" [label="no, or a resumed re-review mr_threads take"];
    "mr_threads {mrUrl, refresh: true} (re-review)" -> "mr_threads result (re-review)?";
    "mr_threads result (re-review)?" -> "Review the MR yourself" [label="ok"];
    "mr_threads result (re-review)?" -> "Fixed the re-review mr_threads call once already?" [label="tool error"];
    "mr_threads result (re-review)?" -> "STOP: threads are read with mr_threads (review)" [label="tempted to read them with the GitLab CLI or the API"];
    "STOP: threads are read with mr_threads (review)" -> "Fixed the re-review mr_threads call once already?";
    "Fixed the re-review mr_threads call once already?" -> "Fix what the re-review mr_threads error names" [label="no"];
    "Fixed the re-review mr_threads call once already?" -> "review off-script gate: mr_threads refused (re-review)" [label="yes"];
    "Fix what the re-review mr_threads error names" -> "mr_threads {mrUrl, refresh: true} (re-review)";
    "review off-script gate: mr_threads refused (re-review)" -> "Off-script outcome (re-review mr_threads)?";
    "Off-script outcome (re-review mr_threads)?" -> "Review the MR yourself" [label="take: a full review without the thread history"];
    "Off-script outcome (re-review mr_threads)?" -> "Off-script rounds = 2 (re-review mr_threads)?" [label="iterate: the cause is fixed"];
    "Off-script outcome (re-review mr_threads)?" -> "Held at a review off-script gate: the pane stays" [label="hold"];
    "Off-script outcome (re-review mr_threads)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="hand back"];
    "Off-script outcome (re-review mr_threads)?" -> "Review gate gone: ended cleanly, no status write" [label="gate gone"];
    "Off-script outcome (re-review mr_threads)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="gate unavailable"];
    "Off-script rounds = 2 (re-review mr_threads)?" -> "mr_threads {mrUrl, refresh: true} (re-review)" [label="no: read again"];
    "Off-script rounds = 2 (re-review mr_threads)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="yes: the refusals are the reason"];
    "Review the MR yourself" -> "Generic review result?";
    "Generic review result?" -> "Write the review report to --report" [label="findings produced"];
    "Generic review result?" -> "<status-bin> review-status <state> error <what went wrong>" [label="failed: bad MR link or diff unreadable"];
    "Write the review report to --report" -> "Fitted review-post open file handed back?";

    "Fitted review-post open file handed back?" -> "${CLAUDE_SKILL_DIR}/scripts/open-gate.sh <status-bin> <state> review-post <open-file>" [label="yes"];
    "Fitted review-post open file handed back?" -> "Report json sibling (review)?" [label="no"];
    "${CLAUDE_SKILL_DIR}/scripts/open-gate.sh <status-bin> <state> review-post <open-file>" -> "review-post open exit?";
    "Report json sibling (review)?" -> "Build the per-finding questions (findings-N, outcome)" [label="valid, findings present"];
    "Report json sibling (review)?" -> "Build the outcome-only question (clean review)" [label="valid, findings is an empty array"];
    "Report json sibling (review)?" -> "Print the tier-fallback line in the pane" [label="absent or malformed"];
    "Print the tier-fallback line in the pane" -> "Build the tier-fallback questions (tiers, outcome)";
    "Build the per-finding questions (findings-N, outcome)" -> "<status-bin> gate open <state> --kind review-post --questions <json> --context <text>";
    "Build the outcome-only question (clean review)" -> "<status-bin> gate open <state> --kind review-post --questions <json> --context <text>";
    "Build the tier-fallback questions (tiers, outcome)" -> "<status-bin> gate open <state> --kind review-post --questions <json> --context <text>";
    "<status-bin> gate open <state> --kind review-post --questions <json> --context <text>" -> "review-post open exit?";
    "review-post open exit?" -> "review-post: take the review gate step" [label="0"];
    "review-post open exit?" -> "Ask the review questions as one combined native form (degraded)" [label="nonzero: the daemon is down"];
    "review-post: take the review gate step" -> "review-post step outcome?";
    "review-post step outcome?" -> "Record the verdict answer in --report" [label="answered"];
    "review-post step outcome?" -> "Review gate gone: ended cleanly, no status write" [label="gate gone"];
    "review-post step outcome?" -> "Ask the review questions as one combined native form (degraded)" [label="the wait keeps failing"];
    "Ask the review questions as one combined native form (degraded)" -> "Record the verdict answer in --report";
    "Record the verdict answer in --report" -> "Domain skill resolved (review act)?";

    "Domain skill resolved (review act)?" -> "Hand the answer to the domain skill to post" [label="yes"];
    "Domain skill resolved (review act)?" -> "Writing style loaded (review act)?" [label="no"];
    "Hand the answer to the domain skill to post" -> "Domain posting result (review)?";
    "Domain posting result (review)?" -> "<status-bin> review-status <state> done <summary> --outcome <comment|approve>" [label="posted"];
    "Domain posting result (review)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="failed"];
    "Writing style loaded (review act)?" -> "Resumed pane (review posting)?" [label="yes"];
    "Writing style loaded (review act)?" -> "rt_verb {args: [skills, writing-style, show]} (review)" [label="no: a resumed pane"];
    "Resumed pane (review posting)?" -> "mr_threads {mrUrl, refresh: true} (review posted already)" [label="yes"];
    "Resumed pane (review posting)?" -> "Findings left to post (review)?" [label="no: this pane opened the gate, or a resumed posted-already take"];
    "mr_threads {mrUrl, refresh: true} (review posted already)" -> "mr_threads result (review posted already)?";
    "mr_threads result (review posted already)?" -> "Mark the findings and summary already posted" [label="ok"];
    "mr_threads result (review posted already)?" -> "Fixed the posted-already mr_threads call once already (review)?" [label="tool error"];
    "mr_threads result (review posted already)?" -> "STOP: the Posted already read goes through mr_threads (review)" [label="tempted to skip the read and post anyway"];
    "STOP: the Posted already read goes through mr_threads (review)" -> "Fixed the posted-already mr_threads call once already (review)?";
    "Fixed the posted-already mr_threads call once already (review)?" -> "Fix what the posted-already mr_threads error names (review)" [label="no"];
    "Fixed the posted-already mr_threads call once already (review)?" -> "review off-script gate: mr_threads refused (posted already)" [label="yes"];
    "Fix what the posted-already mr_threads error names (review)" -> "mr_threads {mrUrl, refresh: true} (review posted already)";
    "Mark the findings and summary already posted" -> "Findings left to post (review)?";
    "review off-script gate: mr_threads refused (posted already)" -> "Off-script outcome (review posted-already mr_threads)?";
    "Off-script outcome (review posted-already mr_threads)?" -> "Mark the findings and summary already posted" [label="take: the human names what is already up, marked in --report"];
    "Off-script outcome (review posted-already mr_threads)?" -> "Off-script rounds = 2 (review posted-already mr_threads)?" [label="iterate: the cause is fixed"];
    "Off-script outcome (review posted-already mr_threads)?" -> "Held at a review off-script gate: the pane stays" [label="hold"];
    "Off-script outcome (review posted-already mr_threads)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="hand back: nothing posts unchecked"];
    "Off-script outcome (review posted-already mr_threads)?" -> "Review gate gone: ended cleanly, no status write" [label="gate gone"];
    "Off-script outcome (review posted-already mr_threads)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="gate unavailable"];
    "Off-script rounds = 2 (review posted-already mr_threads)?" -> "mr_threads {mrUrl, refresh: true} (review posted already)" [label="no: read again"];
    "Off-script rounds = 2 (review posted-already mr_threads)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="yes: the refusals are the reason"];
    "Findings left to post (review)?" -> "Anchored to a diff line (this finding)?" [label="yes"];
    "Findings left to post (review)?" -> "Summary note carries findings?" [label="no"];
    "Anchored to a diff line (this finding)?" -> "mr_comment_inline {mrUrl, body, path, line}" [label="yes"];
    "Anchored to a diff line (this finding)?" -> "Add the finding to the summary note" [label="no"];
    "Add the finding to the summary note" -> "Findings left to post (review)?";
    "mr_comment_inline {mrUrl, body, path, line}" -> "mr_comment_inline result?";
    "mr_comment_inline result?" -> "Findings left to post (review)?" [label="posted"];
    "mr_comment_inline result?" -> "Fixed the mr_comment_inline call once already?" [label="tool error"];
    "mr_comment_inline result?" -> "STOP: review comments post through the mr_* tools" [label="tempted to post with the GitLab CLI or the API"];
    "STOP: review comments post through the mr_* tools" -> "Fixed the mr_comment_inline call once already?";
    "Fixed the mr_comment_inline call once already?" -> "Fix what the mr_comment_inline error names" [label="no"];
    "Fixed the mr_comment_inline call once already?" -> "review off-script gate: mr_comment_inline refused" [label="yes"];
    "Fix what the mr_comment_inline error names" -> "mr_comment_inline {mrUrl, body, path, line}";
    "Summary note carries findings?" -> "mr_comment {mrUrl, body}" [label="yes, not already posted or marked posted by hand"];
    "Summary note carries findings?" -> "Outcome is approve?" [label="no"];
    "mr_comment {mrUrl, body}" -> "mr_comment result?";
    "mr_comment result?" -> "Outcome is approve?" [label="posted"];
    "mr_comment result?" -> "Fixed the mr_comment call once already?" [label="tool error"];
    "mr_comment result?" -> "STOP: the summary note posts through mr_comment" [label="tempted to post with the GitLab CLI or the API"];
    "STOP: the summary note posts through mr_comment" -> "Fixed the mr_comment call once already?";
    "Fixed the mr_comment call once already?" -> "Fix what the mr_comment error names" [label="no"];
    "Fixed the mr_comment call once already?" -> "review off-script gate: mr_comment refused" [label="yes"];
    "Fix what the mr_comment error names" -> "mr_comment {mrUrl, body}";
    "Outcome is approve?" -> "mr_approve {mrUrl}" [label="yes, not marked approved"];
    "Outcome is approve?" -> "<status-bin> review-status <state> done <summary> --outcome <comment|approve>" [label="no: comment, or --report marks it approved by hand"];
    "mr_approve {mrUrl}" -> "mr_approve result?";
    "mr_approve result?" -> "<status-bin> review-status <state> done <summary> --outcome <comment|approve>" [label="approved, or already approved by this account"];
    "mr_approve result?" -> "Fixed the mr_approve call once already?" [label="tool error"];
    "mr_approve result?" -> "STOP: the approval goes through mr_approve" [label="tempted to approve with the GitLab CLI or the API"];
    "STOP: the approval goes through mr_approve" -> "Fixed the mr_approve call once already?";
    "Fixed the mr_approve call once already?" -> "Fix what the mr_approve error names" [label="no"];
    "Fixed the mr_approve call once already?" -> "review off-script gate: mr_approve refused" [label="yes"];
    "Fix what the mr_approve error names" -> "mr_approve {mrUrl}";

    "review off-script gate: mr_comment_inline refused" -> "Off-script outcome (mr_comment_inline)?";
    "Off-script outcome (mr_comment_inline)?" -> "Findings left to post (review)?" [label="take: the human posted it, marked in --report"];
    "Off-script outcome (mr_comment_inline)?" -> "Off-script rounds = 2 (mr_comment_inline)?" [label="iterate: the cause is fixed"];
    "Off-script outcome (mr_comment_inline)?" -> "Held at a review off-script gate: the pane stays" [label="hold"];
    "Off-script outcome (mr_comment_inline)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="hand back"];
    "Off-script outcome (mr_comment_inline)?" -> "Review gate gone: ended cleanly, no status write" [label="gate gone"];
    "Off-script outcome (mr_comment_inline)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="gate unavailable"];
    "Off-script rounds = 2 (mr_comment_inline)?" -> "mr_comment_inline {mrUrl, body, path, line}" [label="no: post again"];
    "Off-script rounds = 2 (mr_comment_inline)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="yes: the refusals are the reason"];

    "review off-script gate: mr_comment refused" -> "Off-script outcome (mr_comment)?";
    "Off-script outcome (mr_comment)?" -> "Outcome is approve?" [label="take: the human posted it, marked in --report"];
    "Off-script outcome (mr_comment)?" -> "Off-script rounds = 2 (mr_comment)?" [label="iterate: the cause is fixed"];
    "Off-script outcome (mr_comment)?" -> "Held at a review off-script gate: the pane stays" [label="hold"];
    "Off-script outcome (mr_comment)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="hand back"];
    "Off-script outcome (mr_comment)?" -> "Review gate gone: ended cleanly, no status write" [label="gate gone"];
    "Off-script outcome (mr_comment)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="gate unavailable"];
    "Off-script rounds = 2 (mr_comment)?" -> "mr_comment {mrUrl, body}" [label="no: post again"];
    "Off-script rounds = 2 (mr_comment)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="yes: the refusals are the reason"];

    "review off-script gate: mr_approve refused" -> "Off-script outcome (mr_approve)?";
    "Off-script outcome (mr_approve)?" -> "<status-bin> review-status <state> done <summary> --outcome <comment|approve>" [label="take: the human approved it, marked in --report"];
    "Off-script outcome (mr_approve)?" -> "Off-script rounds = 2 (mr_approve)?" [label="iterate: the cause is fixed"];
    "Off-script outcome (mr_approve)?" -> "Held at a review off-script gate: the pane stays" [label="hold"];
    "Off-script outcome (mr_approve)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="hand back"];
    "Off-script outcome (mr_approve)?" -> "Review gate gone: ended cleanly, no status write" [label="gate gone"];
    "Off-script outcome (mr_approve)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="gate unavailable"];
    "Off-script rounds = 2 (mr_approve)?" -> "mr_approve {mrUrl}" [label="no: approve again"];
    "Off-script rounds = 2 (mr_approve)?" -> "<status-bin> review-status <state> error <what went wrong>" [label="yes: the refusals are the reason"];

    "<status-bin> review-status <state> done <summary> --outcome <comment|approve>" -> "Review done: the board closes this tab";
    "<status-bin> review-status <state> error <what went wrong>" -> "Review error written: stay in the pane and report";
}
```

What the graph cannot show:

- **The done write is the last call.** The board closes this pane's tab
  the moment `review-status <state> done` lands, which ends this session
  mid-batch. So the done write is a call of its own, sent only after every
  other write of the run has returned: the posting (the domain skill's, or
  this skill's own `mr_comment_inline` and `mr_comment`), `mr_approve`,
  the `--report` write, and under a run the domain skill's `run_stage` done
  and `run_status` done. A write sent in the same batch as the done write
  is lost.
- **Resumed entry.** `--resumed-gate <gateId>` means a human answered a
  gate an earlier pane on this MR opened and the board parked, and the
  board is replaying that answer into this pane. `--resumed-gate-kind`
  names one of the two kinds this wrapper parks: `review-post` (the
  verdict) or `review-escalation` (an off-script gate). Write `reviewing`,
  resolve the domain skill, then read the parked answer with `gate wait`
  before anything else: it is registry-status-first, so on an answered
  gate it returns the recorded answer at once instead of blocking. No node
  between the trigger and that wait opens a gate, and never run `gate
  open` for the resumed gate: it lives in the rt daemon's registry, and a
  fresh open mints a new `gateId` and orphans the answer recorded against
  the old one. `Resumed kind (review)?` then routes by the kind. On
  `review-post`, never re-review and never rewrite the report: `Read
  <--report> and its json sibling (resumed review)` loads the findings it
  picked, and `Record the verdict answer in --report` records it before
  anything posts. On `review-escalation`, `Route the resumed escalation by
  its origin (review)` reads where the earlier pane stopped. Either way
  the Posted already read (`Mark the findings and summary already posted`
  on the generic path, the domain skill's own otherwise) drops what an
  earlier pane already put up, and an off-script gate at a read or
  posting refusal opens normally. This invocation supersedes any earlier
  gate contract remembered in the conversation.
- **What a resumed pane carries.** On a `review-post` resume, from the
  resumed wait: `answers`, `by` and `answeredAt`. On a `review-escalation`
  resume, the wait returns the escalation's answer, and the verdict's
  `{answers, by, answeredAt}` comes from the `review-post-answer:` line in
  `--report`. The verdict's keys name its shape: `findings-N` keys plus
  `outcome` are the per-finding path, `tiers` plus `outcome` the tier
  fallback, and `outcome` alone a clean review. From `--report`'s json
  sibling (the stem swap in "Building the review-post questions"): each
  finding by its `id`, with its `tier`, `title`, `file`, `line`, `fix` and
  `kind`. From `--report` itself on the tier fallback: the findings under
  each tier. From the launch: `<mrUrl>`. Nothing else survives the earlier
  pane.
- **Finding ids.** A per-finding option's value is the finding's `id` from
  the json sibling, verbatim. The same string keys the finding in the json,
  so a picked value joins its finding with no renumbering.
- **Posting.** On the generic path, `Findings left to post (review)?`
  walks the picked findings in gate order, skipping every finding `Mark
  the findings and summary already posted` marked. On the per-finding
  path they are the union of every `findings-N` answer array; on the tier
  fallback, every finding in the report whose tier the `tiers` answer
  picked; on a clean review, none. An explicit empty array posts nothing
  from that question. A finding is anchored when it has both a `file` and
  a `line`: the `mr_comment_inline` node's `path` is the finding's `file`
  and its `line` the finding's `line`, always both, never a `position`
  object; for a line the diff removed, add `oldPath` and `oldLine` as
  well. The daemon re-fetches the diff refs itself, so no sha is needed.
  Every comment body is written in the loaded voice: the tier and title,
  what to change, and the anchor. The summary note posts once, after
  every anchored finding, and only when it carries findings and is not
  already posted. `mr_approve` runs only when the outcome is `approve`,
  after the findings; approval has no read, so a resumed pane approves
  again unless `--report` marks it approved by hand ("Escalation marks"),
  and a refusal saying this account already approved counts as approved.
  Read each answer's `value` (an answer may be a `{value, note}` object); a
  note is the human's steer on the wording of what posts. No finding
  posts twice: a resumed pane reads what is already up with `mr_threads
  {mrUrl, refresh: true} (review posted already)` before anything posts.
- **Escalation marks.** An off-script take at a posting origin, or at the
  Posted already read, writes a mark line into `--report` before the walk
  moves on, whether this pane or a resumed one acts on it. Each mark is
  one line with the fixed prefix `review-escalation-mark:`:
  `review-escalation-mark: finding <id> posted by hand` (an
  `mr_comment_inline` take, or each finding a Posted already read take's
  note names), `review-escalation-mark: summary posted by hand` (an
  `mr_comment` take, or a Posted already read take whose note names the
  summary) and `review-escalation-mark: approved by hand` (an `mr_approve`
  take). The walk reads them back: a finding marked posted by hand never
  posts, a summary marked posted by hand never posts, and an approval
  marked by hand never runs. A pane resumed on a later escalation has lost
  every earlier answer but these, so they are what keeps a taken call from
  running twice.
- **Budgets.** `Fixed the mr_comment_inline call once already?` counts per
  finding; the `mr_comment` and `mr_approve` counters, and the three read
  counters (`mr_view`, the re-review `mr_threads` and the posted-already
  `mr_threads`), count for the whole run. A resumed pane counts them from
  zero, except that a resumed iterate seeds its origin's counter as spent
  (the named finding's, for `mr_comment_inline`), as a live iterate
  leaves it. A guard STOP's re-entry passes the same counter as a tool
  error. None resets after an off-script iterate: a refusal after an
  iterate goes straight back to that origin's off-script gate, and its
  `Off-script rounds = 2 (...)?` counter (per finding for
  `mr_comment_inline`) bounds the loop. The round rides in the gate's
  option values, so the budget holds across a park: a resumed pane seeds
  the counter from it, and an iterate at round 2 is spent. `Resumed wait
  failures = 3 (review)?` counts failing resumed waits; closed, not found
  and `no gate open` are terminal, never counted.
- **Exit messages.** `done` carries a short summary, the same one-liner as
  the report's summary line, e.g. `"2 issues: 1 critical, 1 minor"` or
  `"looks solid"`, and `--outcome` is the human's pick. `error` names what
  went wrong specifically: the bad MR link, the mismatched MR and ticket,
  the fetch failure, the failed domain skill, the refused read or post
  tool with its error and what already posted, or the resumed wait's
  third failure. Gate gone writes no status: say so in the pane and stop,
  since whatever superseded the gate (a re-review relaunch, a fresh pane)
  already owns this MR's board state.

### Print the RE-REVIEW banner as the first output

`--re-review` was passed. Print this line, verbatim, as your first output:

```
=== RE-REVIEW !<iid>: prior review exists; scrollback above is history ===
```

REQUIRED. It is the only marker that separates this pass from the replayed
original above it (see "Re-review mode"). Print it before any tool call,
including the `reviewing` status write.

### Load the --skill domain skill by name (review)

The board passed `--skill <name>` without `--skill-path`: load that skill
by name and treat it as the domain skill. The resolver does not run. When
`--skill-path` is also given, `Read <--skill-path> (review)` reads the
SKILL.md at that absolute path instead, and it is the same domain skill.

### Print the resolver's errors verbatim (review)

The resolver exited nonzero. Print its JSON `errors` verbatim in the pane.
Never guess or substitute a binding: the script is the only enforcement
point. The review continues on the generic path: every `Domain skill
resolved (...)?` diamond answers no, so an unbound board still gets a
review, never a silently mis-bound one.

### Read <--report> and its json sibling (resumed review)

A resumed pane has no findings of its own: the earlier pane wrote them.
Read `--report` and its json sibling (the stem swap in "The json sibling"
under "Building the review-post questions") with the Read tool before
anything posts. The answer's keys say which file it needs:

- `findings-N` plus `outcome`: the json sibling. Join each picked value to
  the finding with that `id` for its `tier`, `title`, `file`, `line`,
  `fix` and `kind`.
- `tiers` plus `outcome`: `--report` itself, for the findings listed under
  each picked tier.
- `outcome` alone: neither. A clean review posts no findings.

Missing or malformed means what it means for the tier fallback: no
sibling `.json`, unparseable json, or a parsed report whose `findings` is
missing, not an array, or holds entries that don't fit the schema. On a
resume it is never a reason to fall back, because the gate is answered
and its shape is fixed. A per-finding answer whose json sibling is missing
or malformed, a picked value no finding's `id` matches, or a tier answer
whose `--report` is missing or unreadable cannot be posted as answered:
`Report fits the resumed answer (review)?` answers no, and the `error`
names the file and which case it was. Never rebuild the findings by
reviewing again, and never post a picked finding from memory.

### Route the resumed escalation by its origin (review)

The resumed wait returned a `review-escalation` answer: an off-script
gate an earlier pane opened on this MR. Read `answers.action`'s value (a
bare value or a `{value, note}` object). It starts with its verb (`take:`,
`iterate:`, `hold:` or `hand back:`) and ends `(<origin>, round <k>)`,
the origin being the refused call the table names. Check the round first:
an iterate at round 2 is that origin's second iterate, which the live
pane's `Off-script rounds = 2 (...)?` answers yes to, so it writes
`error` naming the refusals and never retries. Otherwise round `k` seeds
that origin's `Off-script rounds = 2 (...)?` counter, and a later iterate
at the same origin counts on from it. An iterate also seeds that origin's
fix-once counter as spent (the named finding's, for `mr_comment_inline`),
as a live iterate leaves it: a refusal after the retry goes straight back
to the off-script gate.

- **Pre-verdict origins** (`mr_view refused`, `mr_view refused on a
  re-review`, `mr_threads refused on the re-review read`): no verdict
  exists yet, so the review runs from the refused read on, exactly as the
  fresh take and iterate edges do. The writing style loads first. A take
  at `mr_view` continues with the branches its note gives and skips the
  read; a note with no branches takes the `hand back` edge. An iterate at
  `mr_view` reads the MR again. Every pre-verdict escalation opened on the
  generic path; when this resume resolves a domain skill after all, a take
  or round-1 iterate delegates the review afresh, and the domain skill
  makes its own reads.
- **Re-review origins** (`mr_view refused on a re-review`, `mr_threads
  refused on the re-review read`) make this pass a re-review, though the
  launch carries no `--re-review`. `--report` still holds the prior
  review, since this pass has not written one: `Read <--report> (prior
  review, resumed re-review)` loads it before the writing style, and a
  missing file means no prior review, as "Re-review mode" says. The
  threads are then read again, except after a take at the re-review
  `mr_threads` read, which reviews the whole MR without them.
- **Posting origins** (`mr_comment_inline refused`, `mr_comment refused`,
  `mr_approve refused`, `mr_threads refused on the Posted already read`):
  the verdict was answered and recorded before the escalation opened.
  `Read <--report>, its verdict line and json sibling (resumed
  escalation)` loads the `review-post-answer:` line and the files that
  answer's shape needs, the same files `Read <--report> and its json
  sibling (resumed review)` names. `Verdict line present (review)?`
  answers no when the line is missing or unparseable, or when the report
  does not fit its answer by that section's rules; the `error` names the
  file and which case it was. Never rebuild the verdict from memory or
  from the conversation. The same read loads every
  `review-escalation-mark:` line an earlier pane wrote ("Escalation
  marks"), and the walk honours them.
- **A take at a posting origin** writes its mark before the walk
  (`Record the resumed take's mark in --report (review)`): finding `<id>` posted
  (`mr_comment_inline`), the summary posted (`mr_comment`), or the
  approval done (`mr_approve`). The Posted already read then runs as for
  any resumed pane. A take at the Posted already read itself marks exactly
  what its note names and skips the read, since that read is what refused.
- **An iterate at a posting origin** walks the posting again from the
  top; the Posted already read drops what is up, so the refused call is
  the first to post.
- **Hold** keeps the pane open with nothing more posted and no terminal
  status. **Hand back** writes `error` naming the refusal the value names.

### Delegate the review to the domain skill

If a rule in the domain skill asks for a move this graph marks STOP, take the off-script edge instead.

Here that means the STOP's redirect: the move passes the same fix-once counter and goes through the tool the STOP names. On the domain path, a move the domain skill cannot make that way is its reported failure, which takes the `error` exit.

Tell the domain skill these things:

- the MR url;
- the `--report <path>`;
- that this wrapper owns the gate, so it opens nothing: it hands back
  instead, including the absolute paths of the fitted `review-post` open
  file and of the `gate-ctx.sh` that fitted it, when it builds one;
- under `--re-review`, the re-review framing: the prior review read at
  `Read <--report> (prior review)` (or that none was found), "check what
  the author addressed since the last review", and "flag it and fall back
  to a full review if nothing was acted on" ("Re-review mode"). A resumed
  re-review origin gets the same framing, with the prior review still at
  `--report`;
- on a resumed pre-verdict escalation, that it reviews afresh: the
  escalation's take or iterate belonged to the generic path's own read.

Pass the operator note along as context when the launch carries one.

The domain skill owns the actual review: resolving the MR and ticket,
producing the draft, and writing the report to `--report` (the Markdown
and its json sibling). It hands back the severity levels present in its
findings, plus the two paths when it built a fitted open file. Carry all
three to the gate: the paths decide `Fitted review-post open file handed
back?`, and the levels are the tier fallback's options. It never presents
posting gates or decides disposition; this wrapper opens the one event
gate and later hands it the human's answer to post.

A failure it reports (a bad MR link, a mismatched MR and ticket, a fetch
failure) is `error` with its message.

### Load the named writing-style skill (review)

`rt_verb` answered with the resolved style skill in its `skill` field.
Load that skill before drafting anything: compose in its voice from the
first word, never as a pass over a finished draft. It governs every
finding and comment this pane writes.

### Load the preferences.md style, else conversational (review)

`rt_verb` is unavailable, refused, or failed. Read
`~/.mattstack/user/skills/preferences.md` with the Read tool and load the
skill its `writing-style:` line names, if it has one. If the line is
missing, or that skill will not load, load
`mattstack:writing-style-conversational`. The load still comes before the
first drafted word. This fallback chain is the defined path, not an
off-script origin.

### Review the MR yourself

The generic path, in the loaded voice. The MR record is already read:
`mr_view {mrUrl} (review)` gave its title, description, source and target
branches, or after that read's off-script take, the human's note gave the
branches. Under `--re-review` the threads are already read too, at
`mr_threads {mrUrl, refresh: true} (re-review)`. Read the diff in the
checkout this pane runs in (the board's configured review checkout): fetch
both branches from `origin`, then read the diff of the target branch to
the source branch with read-only git. A failed read is never a reason to
read with the GitLab CLI or the API.

`Generic review result?` answers failed when the MR link is bad or the
diff cannot be read, and the review writes `error` naming which. A source
branch this checkout's `origin` cannot reach (an MR from another project,
or from a fork) is a failed read.

Read the diff critically and produce findings. Each finding has:

- a severity tier: `Critical`, `Important` or `Minor`, the report's fixed
  tier vocabulary;
- its anchor, `file:line` (or `file` alone when no single line fits);
- what to change.

Honor the operator note (for example "focus on the migration files", "skip
the vendored code").

On a re-review (`--re-review` given, or a resumed re-review origin),
frame the review as "Re-review mode" says: check the threads already read
and the new commits since the last review against the prior review, read
at `Read <--report> (prior review)` or, on a resumed pane, at `Read
<--report> (prior review, resumed re-review)`. **Author acted:**
re-review focused on that: for each prior comment, was it adequately
addressed? Are the new changes sound? Note anything still open. **No
action found** (no threads addressed, no relevant new changes since the
last review): say so explicitly in the report's summary line, e.g.
`"no author action found since last review"`, and fall back to a normal
full review of the whole MR so the pass is still useful. **No thread
history** (the re-review read's off-script take): a full review of the
whole MR, its summary line saying the threads could not be read, e.g.
`"threads unreadable; full review"`.

### Write the review report to --report

Save the review to `--report <path>` as Markdown: a short summary line,
then the findings, grouped by tier, each with its anchor and what to
change. Write it before the gate opens, so the board makes the
"reviewing..." badge clickable to open the review modal while you hold at
the gate. On the domain path the domain skill wrote the report itself;
this box is the generic path's. Either way the file exists before `done`.

The generic path writes the Markdown only. The json sibling is the domain
skill's structured report, so without one the gate takes the tier
fallback, built from your own findings' tiers. On the generic path a json
sibling this pass did not write is stale: treat it as absent at `Report
json sibling (review)?`.

### Build the per-finding questions (findings-N, outcome)

The json sibling parsed and its `findings` is a non-empty array. Build the
`findings-1..N` questions and the `outcome` question exactly as "Building
the review-post questions" draws them: ordered by tier, chunked four
options per question, the pinned option recipe, the composed verdict
label, and the recommended outcome first. `--context` is the readiness
line plus the tier-counts line (`review-post: take the review gate step`).

### Build the outcome-only question (clean review)

The json sibling parsed and its `findings` is a valid empty array: a clean
review. Omit every `findings-N` question and open the gate with `outcome`
alone, so a clean review is approvable in one click. The recommended
outcome is still listed first, and the human still picks it: a clean
review makes Approve the sensible pick to offer, never a pick you make.
Only the empty array means clean ("Building the review-post questions",
"Clean review").

### Print the tier-fallback line in the pane

The json sibling is absent or malformed (no sibling `.json`, unparseable
json, or a parsed report whose `findings` is missing, not an array, or
holds entries that don't fit the schema).
Print one line in the pane naming which case it was, for example:

- `report.json not found; falling back to tier-level options`
- `report.json has no findings array; falling back to tier-level options`

A human watching then knows posting will be tier-grained instead of
per-finding.

### Build the tier-fallback questions (tiers, outcome)

Build the `tiers` and `outcome` questions exactly as "Building the
review-post questions" draws them under "Tier fallback". The levels are
the ones the domain skill handed back as present, or your own findings'
tiers on the generic path. Add `tiers` only when at least one level is
present; with none, `outcome` alone. The finding titles ride the `tiers`
question's own `context`, one line per finding, verbatim from the report
file. `--context` is the tier-counts line alone.

### review-post: take the review gate step

Take "Gate step" with the open's `gateId` and `presentation`. Its outcome
comes back here: answered (the answers and `by`, from the pane form's
`gate answer`, its CAS-loss line, or the wait), gate gone (end cleanly
with no status write), or the wait keeps failing (the degraded combined
form). Nothing posts before the answer.

**`--context`.** The built gate's `--context` is its only shared context
carrier:

- **Per-finding path** (a clean review included): the readiness line
  (`summary.readiness` plus `summary.reasoning`, verbatim) and a
  tier-counts line, e.g. "Critical (1), Important (3), Minor (2)". Finding
  titles ride the `findings-N` options, never question `context`.
- **Tier fallback:** there is no `summary` to read a readiness line from,
  so `--context` carries only the tier-counts line; the `tiers` question
  carries the finding titles in its own `context`.
- **Either way,** `--context` fits inside the gate's 8192 UTF-8 byte
  budget; an oversized one is dropped loudly by the daemon, not by you:
  never pre-trim it yourself.

A fitted open file carries its own `.context` (the review's structured
summary); `open-gate.sh` opens it as it stands.

### Ask the review questions as one combined native form (degraded)

The daemon was down at open time (`gate open` or `open-gate.sh` exited
nonzero), or the gate step's wait failed three times ("A failing wait is
not degradation" in `board:gate-cli-recipes`). Ask one combined native
form carrying the same questions the gate would have: every `findings-N`
chunk plus `outcome` when the json has findings, the fallback's `tiers`
plus `outcome` on the json-absent path, `outcome` alone on a clean
review. Past four questions, chunk it across AskUserQuestion calls in gate
order, as the pane form does, and proceed only on the answers from every
call. It is still one form, never two gates. Render it by the same rules
as the pane form (`Ask the review gate as a pane form`), a fitted file
flattened to prose exactly as that section describes. When the daemon is
down the PreToolUse hook allows the native form.

### Record the verdict answer in --report

The verdict is in hand: from the gate step, the degraded form, or a
resumed `review-post` wait. Before anything posts, append one final line
to `--report`:

`review-post-answer: <{answers, by, answeredAt} as one-line JSON>`

It is the whole answer envelope, not just `answers`. When `--report`
already ends in a `review-post-answer:` line, replace it; never write a
second. `answeredAt` is always epoch milliseconds, as the wait returns
it. When the answer came with no `answeredAt` (this pane's own `gate
answer` stood, or the degraded form), write the current time in epoch
milliseconds as you write the line, and `by` is `pane`: nothing has
posted yet, so no note from this pass predates it.

The verdict starts a new posting pass: delete every
`review-escalation-mark:` line from `--report` ("Escalation marks"). What
an earlier pass posted by hand the Posted already read finds.

The line exists because an off-script gate moves the state's gate id to
the escalation, and `gate wait` can then no longer return the verdict. A
pane resumed on that escalation reads the verdict from this line, and
`Mark the findings and summary already posted` dates its notes against
its `answeredAt`.

### Hand the answer to the domain skill to post

If a rule in the domain skill asks for a move this graph marks STOP, take the off-script edge instead.

Here that means the STOP's redirect: the move passes the same fix-once counter and goes through the tool the STOP names. On the domain path, a move the domain skill cannot make that way is its reported failure, which takes the `error` exit.

Hand the domain skill the human's answer, the MR url and the `--report`
path, so it executes the posting:

- **Per-finding path:** `{findings: [ids], outcome}`, where `ids` is the
  union of every `findings-N` question's answer array, and empty when the
  gate carried `outcome` alone, since a clean review has no findings to
  post.
- **Tier fallback:** `{tiers, outcome}`.

Pass each answer's notes along with it. On a resumed pane
(`--resumed-gate` given), tell the domain skill the pass is a resume, so
it runs its own Posted already read before anything posts and hands back
what it found already up. On a posting-origin escalation resume the
answer comes from the report's `review-post-answer:` line, and hand it too every
`review-escalation-mark:` line in `--report` plus the resumed answer's own
take (at a posting origin or the Posted already read, which a
domain-path resume has not recorded), so it skips what the human already
posted or approved. The domain skill posts through the mr_* tools
and hands back what posted, the findings it found already up included; a
failure it reports is `error` with its message.

### Add the finding to the summary note

The finding has no `file` and `line` to anchor to (its option's anchor was
the json's `fileLabel`, or `file` alone). It posts in the review's summary
comment instead of an inline thread. Add it to the summary note: its tier
and title, what to change, and its `fileLabel` or `file` when it has one.
The note posts once, with `mr_comment`, after the last anchored finding.

### Fix what the mr_view error names (review)

`mr_view` refused. Correct what the error names: `mrUrl` the MR's https
URL, `.../-/merge_requests/<iid>`, whose project is registered with rt.
An error that names no input (the daemon down, a GitLab fetch failure)
has nothing to correct: read again unchanged, once, and the off-script
gate follows. An error is never a reason to read the MR with the GitLab
CLI or the API.

### Fix what the re-review mr_threads error names

`mr_threads` refused the re-review read. Correct what the error names:
`mrUrl` the MR's https URL, whose project is registered with rt;
`refresh` a boolean. An error that names no input has nothing to correct:
read again unchanged, once, and the off-script gate follows. An error is
never a reason to read the threads with the GitLab CLI or the API.

### Fix what the posted-already mr_threads error names (review)

`mr_threads` refused the Posted already read. Correct what the error
names: `mrUrl` the MR's https URL, whose project is registered with rt;
`refresh` a boolean. An error that names no input (the daemon down, a
GitLab fetch failure) has nothing to correct: read again unchanged, once,
and the off-script gate follows. An error is never a reason to skip the
read and post anyway: a finding posted twice is what this read prevents.

### Mark the findings and summary already posted

The Posted already rule, on a resumed pane (`--resumed-gate` given) before
anything posts. An earlier pane may have posted part of this answer before
it died, so read what is up in the `mr_threads` result, each thread's full
note chain, against the picked findings. A note counts only when the
account this pane posts as wrote it after the verdict's `answeredAt`
(from the resumed wait on a `review-post` resume, from the verdict line
on an escalation resume):

- a picked finding is posted when a thread carries such a note whose body
  is the finding's comment (its tier and title) or that sits at the
  finding's `path:line`;
- the summary is posted when such a top-level note carries the summary.

`Findings left to post (review)?` skips every finding marked posted, and
`Summary note carries findings?` answers no when the summary is marked
posted. They count as posted in the `done` summary. One read covers every
finding and the summary. After an off-script take, what the human names
is the list. Every `review-escalation-mark:` line in `--report` already
marks its finding, summary or approval: keep those marks and add what the
read finds. Approval has no read: `mr_approve` runs again unless a mark
says it was approved by hand.

### Record the resumed take's mark in --report (review)

The generic path, before the Posted already read. A refusal at that read
opens a second escalation, which moves the state's gate id, and a pane
resumed on it could then no longer learn this answer. So a resumed take
writes its mark now, as "Escalation marks" spells it: the same mark the
live pane writes when it acts on that take. A take at a posting origin
writes the one mark its value names; a take at the Posted already read
writes one mark per finding its note names, and one for the summary when
the note names it. The marks outlive this pane: a pane resumed on a later
escalation reads them back, and the posting walk honours them.

### Fix what the mr_comment_inline error names

`mr_comment_inline` refused. Correct what the error names: `mrUrl` the
MR's https URL, `.../-/merge_requests/<iid>`, whose project is registered
with rt; `path` the finding's file as the diff names it; `line` a line
the diff shows, always given with `path` (plus `oldPath` and `oldLine`
for a line the diff removed); `body` the non-empty comment. An anchor
GitLab rejects with the anchor already matching the finding, or an error
that names no input, has nothing to correct: post again unchanged, once,
and the off-script gate follows. An error is never a reason to post with
the GitLab CLI or the API.

### Fix what the mr_comment error names

`mr_comment` refused. Correct what the error names: `mrUrl` the MR's https
URL, whose project is registered with rt; `body` the non-empty summary
note. An error that names no input has nothing to correct: post again
unchanged, once, and the off-script gate follows. An error is never a
reason to post with the GitLab CLI or the API.

### Fix what the mr_approve error names

`mr_approve` refused. Correct what the error names: `mrUrl` the MR's https
URL, whose project is registered with rt. A refusal about the approval
itself (the token's user may not approve this MR) has nothing to correct
in the call: approve again unchanged, once, and the off-script gate
follows. A refusal saying this account already approved is not an error:
it counts as approved. An error is never a reason to approve with the
GitLab CLI or the API.

### review off-script gate: mr_view refused

Take "Off-script step" with this question. Label: `mr_view refused twice
on !<iid>: <second error>`. Context: both `mr_view` errors, quoted, with
the MR url.

| Value | Label | Description |
|---|---|---|
| `take: you give the source and target branches in a note (mr_view refused, round <k>)` | Give the branches | You name both branches in a note and I review the diff between them. |
| `iterate: you fixed the cause, read the MR again (mr_view refused, round <k>)` | Fixed it, read again | You fixed what refused the read and I read the MR again. |
| `hold: keep this pane open with the review not started (mr_view refused, round <k>)` | Hold this pane | I stop here before reviewing anything and the pane stays open. |
| `hand back: write an error naming the refusal, nothing reviewed (mr_view refused, round <k>)` | Hand it back | I write an error naming the refusal and you take over. |

A take reads the source and target branches from the answer's note and
continues without the title and description; a take with no branches in
its note takes the `hand back` edge. Iterate passes `Off-script rounds =
2 (mr_view, review)?` before reading again. Hand back, gate unavailable
and a spent round budget write `error` naming the refusal.

When this pass is a re-review (`--re-review` was given, or the pane
resumed on a re-review origin), every value's origin reads `mr_view
refused on a re-review` in place of `mr_view refused`.

### review off-script gate: mr_threads refused (re-review)

Take "Off-script step" with this question. Label: `mr_threads refused
twice on the re-review read for !<iid>: <second error>`. Context: both
`mr_threads` errors, quoted, and whether a prior review was found at
`--report`.

| Value | Label | Description |
|---|---|---|
| `take: review the whole MR without the thread history, saying so in the summary (mr_threads refused on the re-review read, round <k>)` | Full review instead | I review the whole MR without the threads and the summary says so. |
| `iterate: you fixed the cause, read the threads again (mr_threads refused on the re-review read, round <k>)` | Fixed it, read again | You fixed what refused the read and I read the threads again. |
| `hold: keep this pane open with the re-review not started (mr_threads refused on the re-review read, round <k>)` | Hold this pane | I stop here before reviewing anything and the pane stays open. |
| `hand back: write an error naming the refusal, nothing reviewed (mr_threads refused on the re-review read, round <k>)` | Hand it back | I write an error naming the refusal and you take over. |

A take continues at `Review the MR yourself` as a full review with no
thread history. Iterate passes `Off-script rounds = 2 (re-review
mr_threads)?` before reading again. Hand back, gate unavailable and a
spent round budget write `error` naming the refusal.

### review off-script gate: mr_threads refused (posted already)

Take "Off-script step" with this question. Label: `mr_threads refused
twice on the Posted already read for !<iid>: <second error>`. Context:
both `mr_threads` errors, quoted, and the picked findings' ids and anchors
this pass could post.

| Value | Label | Description |
|---|---|---|
| `take: you name the findings and summary already posted (mr_threads refused on the Posted already read, round <k>)` | Name what is posted | You name what is already up and I post only the rest. |
| `iterate: you fixed the cause, read the threads again (mr_threads refused on the Posted already read, round <k>)` | Fixed it, read again | You fixed what refused the read and I read the threads again. |
| `hold: keep this pane open with nothing posted (mr_threads refused on the Posted already read, round <k>)` | Hold this pane | I stop before posting anything and the pane stays open. |
| `hand back: write an error naming the refusal, nothing posted (mr_threads refused on the Posted already read, round <k>)` | Hand it back | I write an error naming the refusal and post nothing. |

A take marks exactly what the human names in the note as posted already,
one `review-escalation-mark:` line per finding and one for the summary
("Escalation marks"), before the walk moves on.
Iterate passes `Off-script rounds = 2 (review posted-already
mr_threads)?` before reading again. Hand back, gate unavailable and a
spent round budget write `error` naming the refusal; nothing posts
unchecked.

### review off-script gate: mr_comment_inline refused

Take "Off-script step" with this question. Label: `inline comment on
<file>:<line> refused twice on !<iid>: <second error>`. Context: both
`mr_comment_inline` errors, quoted, with the finding's id, anchor and
body.

| Value | Label | Description |
|---|---|---|
| `take: you post finding <id> on <file>:<line> yourself (mr_comment_inline refused, round <k>)` | Post it yourself | You post this finding's comment and I continue with the next finding. |
| `iterate: you fixed the cause, post finding <id> inline again (mr_comment_inline refused, round <k>)` | Fixed it, post again | You fixed what refused the comment and I post it inline again. |
| `hold: keep this pane open with the remaining findings unposted (mr_comment_inline refused, round <k>)` | Hold this pane | I stop here and the findings not yet posted stay unposted. |
| `hand back: write an error naming the refusal and what already posted (mr_comment_inline refused, round <k>)` | Hand it back | I write an error naming the refusal and what posted, and you take over. |

A take counts the finding as posted, writes
`review-escalation-mark: finding <id> posted by hand` into `--report`,
and moves to the next one. Iterate passes `Off-script rounds = 2
(mr_comment_inline)?` for this finding before posting again. Hand back,
gate unavailable and a spent round budget write `error` naming the
refusal and which findings posted.

### review off-script gate: mr_comment refused

Take "Off-script step" with this question. Label: `summary note refused
twice on !<iid>: <second error>`. Context: both `mr_comment` errors,
quoted, and the note's text.

| Value | Label | Description |
|---|---|---|
| `take: you post the summary note yourself, then I apply the verdict (mr_comment refused, round <k>)` | Post the summary yourself | You post the summary note and I carry on to the verdict. |
| `iterate: you fixed the cause, post the summary note again (mr_comment refused, round <k>)` | Fixed it, post again | You fixed what refused the note and I post it again. |
| `hold: keep this pane open with the summary unposted and no verdict applied (mr_comment refused, round <k>)` | Hold this pane | I stop here with the summary unposted and the verdict unapplied. |
| `hand back: write an error naming the refusal and what already posted (mr_comment refused, round <k>)` | Hand it back | I write an error naming the refusal and what posted, and you take over. |

A take writes `review-escalation-mark: summary posted by hand` into
`--report` and continues to `Outcome is approve?`. Iterate passes `Off-script
rounds = 2 (mr_comment)?` before posting again. Hand back, gate
unavailable and a spent round budget write `error` naming the refusal and
which findings posted inline.

### review off-script gate: mr_approve refused

Take "Off-script step" with this question. Label: `approval of !<iid>
refused twice: <second error>`. Context: both `mr_approve` errors, quoted.

| Value | Label | Description |
|---|---|---|
| `take: you approve !<iid> yourself, then I mark the review done (mr_approve refused, round <k>)` | Approve it yourself | You approve the MR and I mark the review done as approve. |
| `iterate: you fixed the cause, approve !<iid> again (mr_approve refused, round <k>)` | Fixed it, approve again | You fixed what refused the approval and I approve again. |
| `hold: keep this pane open with the findings posted and no approval (mr_approve refused, round <k>)` | Hold this pane | I stop here with the findings posted and no approval. |
| `hand back: write an error naming the refusal, the findings stay posted (mr_approve refused, round <k>)` | Hand it back | I write an error naming the refusal and you take over. |

A take writes `review-escalation-mark: approved by hand` into `--report`
and marks the review `done` with `--outcome approve`. Iterate passes
`Off-script rounds = 2 (mr_approve)?` before approving again. Hand back,
gate unavailable and a spent round budget write `error` naming the
refusal; the posted findings stay.

## Gate step

Both kinds of board gate this wrapper opens take this step after their
open: `review-post` from `review-post: take the review gate step`, and
every `review-escalation` from `review-escalation: take the review gate
step`. `<status-bin> gate open` prints one JSON line, `{"gateId": "...",
"presentation": "form"}` or `"wait"`; `open-gate.sh` prints the same line
and exits with the open's status. Keep both: `Presentation (review gate)?`
reads `presentation`, and `End the turn: holding at gate <gateId>
(review)` names `gateId`. The step writes no status. The gate box that
entered reads the outcome:

- **Answered:** the answers and `by` go back to the box.
- **Gone** (closed, not found, or `no gate open`): end cleanly, say so in
  the pane, write neither `done` nor `error`: whatever superseded the gate
  already owns this MR's board state.
- **Wait keeps failing:** `review-post`'s box asks the degraded combined
  form; an escalation's box takes `gate unavailable`.

```dot
digraph review_gate_step {
    rankdir=TB;

    "Trigger: a review gate opened (review-post or review-escalation)" [shape=ellipse];
    "Presentation (review gate)?" [shape=diamond];
    "STOP: the answer is the human's; wait for the review gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Ask the review gate as a pane form" [shape=box];
    "<status-bin> gate answer <state> --answers <json> --by pane (review form)" [shape=plaintext];
    "gate answer printed a JSON line (review form)?" [shape=diamond];
    "Trigger: a doorbell arrives while the review form is open" [shape=ellipse];
    "<status-bin> gate wait <state> --max-ms 1000 (review doorbell)" [shape=plaintext];
    "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (review)" [shape=plaintext];
    "End the turn: holding at gate <gateId> (review)" [shape=box];
    "Trigger: the review wait loop finished" [shape=ellipse];
    "Review wait result?" [shape=diamond];
    "Review wait failures = 3?" [shape=diamond];
    "Trigger: a human answers a review gate in the pane" [shape=ellipse];
    "<status-bin> gate answer <state> --answers <json> --by pane (review escape hatch)" [shape=plaintext];
    "gate answer printed a JSON line (review escape hatch)?" [shape=diamond];
    "Review gate gone: back to its gate box" [shape=doublecircle];
    "Review wait keeps failing: back to its gate box" [shape=doublecircle];
    "Held at the review gate: report readable, no done" [shape=doublecircle];
    "Review gate answered: back to its gate box" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a review gate opened (review-post or review-escalation)" -> "Presentation (review gate)?";
    "Presentation (review gate)?" -> "Ask the review gate as a pane form" [label="form"];
    "Presentation (review gate)?" -> "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (review)" [label="wait"];
    "Presentation (review gate)?" -> "STOP: the answer is the human's; wait for the review gate" [label="tempted to pick the answer yourself, a clean review's verdict included"];
    "STOP: the answer is the human's; wait for the review gate" -> "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (review)";
    "Ask the review gate as a pane form" -> "<status-bin> gate answer <state> --answers <json> --by pane (review form)";
    "<status-bin> gate answer <state> --answers <json> --by pane (review form)" -> "gate answer printed a JSON line (review form)?";
    "gate answer printed a JSON line (review form)?" -> "Review gate answered: back to its gate box" [label="no: this answer stands"];
    "gate answer printed a JSON line (review form)?" -> "Review gate answered: back to its gate box" [label="yes: another surface won, proceed on its answer"];
    "Trigger: a doorbell arrives while the review form is open" -> "<status-bin> gate wait <state> --max-ms 1000 (review doorbell)";
    "<status-bin> gate wait <state> --max-ms 1000 (review doorbell)" -> "Review gate answered: back to its gate box";
    "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (review)" -> "End the turn: holding at gate <gateId> (review)";
    "End the turn: holding at gate <gateId> (review)" -> "Trigger: the review wait loop finished" [style=dashed label="the wait loop finished"];
    "End the turn: holding at gate <gateId> (review)" -> "Held at the review gate: report readable, no done" [style=dashed label="the pane ends or the board parks it before an answer"];
    "Trigger: the review wait loop finished" -> "Review wait result?";
    "Review wait result?" -> "Review gate answered: back to its gate box" [label="answered"];
    "Review wait result?" -> "Review gate gone: back to its gate box" [label="closed, not found, or no gate open"];
    "Review wait result?" -> "Review wait failures = 3?" [label="any other failure"];
    "Review wait failures = 3?" -> "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (review)" [label="no: wait again"];
    "Review wait failures = 3?" -> "Review wait keeps failing: back to its gate box" [label="yes"];
    "Trigger: a human answers a review gate in the pane" -> "<status-bin> gate answer <state> --answers <json> --by pane (review escape hatch)";
    "<status-bin> gate answer <state> --answers <json> --by pane (review escape hatch)" -> "gate answer printed a JSON line (review escape hatch)?";
    "gate answer printed a JSON line (review escape hatch)?" -> "Review gate answered: back to its gate box" [label="no: this answer stands"];
    "gate answer printed a JSON line (review escape hatch)?" -> "Review gate answered: back to its gate box" [label="yes: another surface won, tell the human which answer won"];
}
```

### Ask the review gate as a pane form

Follow the gate protocol included at the end of this skill: its "Present
the in-pane gate form" step and its "Answers are option values" and
"Doorbell" sections, for the rendering and conflict mechanics:
one form question per gate question in gate order, labels and values
verbatim, chunked when the gate carries more questions than one form call
fits, and one answer after the last chunk. Where it records the pane's
answer with the `gate_answer` tool, a board gate records it with
`<status-bin> gate answer <state> --answers <json> --by pane` instead.

A `review-escalation` gate carries its one `action` question: render its
label and the four options verbatim and submit the chosen value verbatim,
nuance in the `{value, note}` form. Four things stay specific to
`review-post`, which the included gate protocol does not cover:

1. A label's " (recommended)" suffix becomes the form's own (Recommended)
   affordance.
2. Your framing and reasoning go in the pane prose or option descriptions,
   never into rewritten question or option text.
3. The question order is fixed: findings before outcome, since the human
   weighs the findings before choosing a verdict.
4. Never an option that folds another question's answer in: there is
   never a "skip and approve clean" combo option, since "post nothing" is
   every `findings-N` question answered as an explicit empty array, which
   the daemon records.

- **Fitted files.** A gate opened from a fitted file never shows its JSON
  in the form: run the `gate-ctx.sh`
  whose path the domain skill handed back with the open file,
  in `prose` mode on the source file beside it
  (the open file's name with `.open.json` swapped for `.source.json`: `sh
  <gate-ctx.sh> prose < <dir>/review-post.source.json`), print its
  `.context` as one pane line before the form call, and make each
  `findings-N` question's form text its label, a newline, then its prose
  `context`. Options keep the gate's labels and descriptions.
- **Answers.** Each value is the chosen option's value verbatim, never an
  index or a paraphrase; nuance rides the note form, e.g. `{"outcome":
  {"value": "comment", "note": "approve once CI is green"}}`. A
  `findings-N` question's explicit empty array (`{"findings-1": []}`) is
  valid, recording the decision to post none of that chunk's findings:
  one chunk empty and another picked is a normal partial post. On the
  tier fallback this is `{"tiers": []}`.
- **Another surface won.** A JSON line printed by `gate answer`, or a
  doorbell while the form still sits open, means another surface answered
  first: proceed on the winning answer, never the one you meant to submit.
  The doorbell is verify-only: read the recorded answer with `<status-bin>
  gate wait <state> --max-ms 1000`.
- **The hook.** A PreToolUse hook may deny native AskUserQuestion when no
  gate is open; that denial is the gate protocol speaking: the gate opens
  first, through its gate node. When the daemon is down the hook allows the
  native form, which is the degraded path.

### End the turn: holding at gate <gateId> (review)

Read `${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md` with the Read
tool and follow its "Wait recipe": one background shell task loops
`<status-bin> gate wait <state> --max-ms 90000` while it prints
`{"status":"pending"}`; never launch a second while one runs. End the turn
in one line, `holding at gate <gateId>`, naming this gate. The loop's
completion re-invokes the pane with the answer.

If the human ends the pane, or the board parks it, before the gate is
answered, leave it there: `Held at the review gate: report readable, no
done`. The report is written and readable from the badge, with no `done`
and no outcome. An unanswered verdict is not an approve. The board parks a
pane that holds past its grace window, and a later answer to the same
gate resumes it in a fresh invocation with `--resumed-gate` (Resumed
entry under Flow), for `review-post` and `review-escalation` alike. A
pre-verdict escalation (`mr_view`, the re-review `mr_threads`) holds
before the report is written, so the badge has nothing to open yet.

A human who interrupts the wait and answers in the pane is the escape
hatch: record it with `<status-bin> gate answer <state> --answers <json>
--by pane` so a parked resume stays in sync, under the same answer rules
as the pane form. Per that file's "CAS loss and reading answers back":
silence and exit 0 means this answer stands; one printed JSON line
(`{answers, by, answeredAt}`) means another surface answered first, so
proceed on the printed answer and tell the human which answer won.

Per "Closed or missing gate" and "A failing wait is not degradation": a
`gate <id> closed (<reason>)`, not-found or `no gate open for <url>`
result is terminal, so end cleanly without re-running it; any other
failing wait re-runs, and only the third failure falls through, saying
why: to the degraded combined form for `review-post`, to `gate
unavailable` for an escalation.

## Off-script step

Every `review off-script gate: ...` box takes this step. It is a board
gate of kind `review-escalation`, opened through the status-bin on this
MR's review state, and it runs through "Gate step" like `review-post`.
The step writes no status: `reviewing` stands while it waits. Opening it
moves the state's gate id to the escalation, which is why `Record the
verdict answer in --report` runs before anything posts. The box that
entered reads the outcome:

- **Answered:** its outcome diamond reads `answers.action`'s value, which
  starts with `take:`, `iterate:`, `hold:` or `hand back:`. A hold answer
  ends the turn with the pane open and no terminal status.
- **Unanswered:** the turn ends at `End the turn: holding at gate
  <gateId> (review)` with no terminal status. The board parks the pane
  after its grace window and resumes it on the answer, and `Route the
  resumed escalation by its origin (review)` picks up where this pane
  stopped.
- **Gone** (closed, not found, or `no gate open`): end cleanly, say so in
  the pane, and write no status.
- **Unavailable** (the open exits nonzero, or the wait fails three times):
  the box's `gate unavailable` edge, which writes `error` as hand back
  does.

```dot
digraph review_off_script_step {
    rankdir=TB;

    "Trigger: a review off-script gate box is entered" [shape=ellipse];
    "Build the review-escalation question" [shape=box];
    "<status-bin> gate open <state> --kind review-escalation --questions <json> --context <text>" [shape=plaintext];
    "review-escalation open exit?" [shape=diamond];
    "review-escalation: take the review gate step" [shape=box];
    "review-escalation step outcome?" [shape=diamond];
    "Off-script gate gone (review)" [shape=doublecircle];
    "Off-script gate unavailable (review)" [shape=doublecircle];
    "Off-script answered: back to its box (review)" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a review off-script gate box is entered" -> "Build the review-escalation question";
    "Build the review-escalation question" -> "<status-bin> gate open <state> --kind review-escalation --questions <json> --context <text>";
    "<status-bin> gate open <state> --kind review-escalation --questions <json> --context <text>" -> "review-escalation open exit?";
    "review-escalation open exit?" -> "review-escalation: take the review gate step" [label="0"];
    "review-escalation open exit?" -> "Off-script gate unavailable (review)" [label="nonzero: the daemon is down"];
    "review-escalation: take the review gate step" -> "review-escalation step outcome?";
    "review-escalation step outcome?" -> "Off-script answered: back to its box (review)" [label="answered"];
    "review-escalation step outcome?" -> "Off-script gate gone (review)" [label="gate gone"];
    "review-escalation step outcome?" -> "Off-script gate unavailable (review)" [label="the wait keeps failing"];
}
```

### Build the review-escalation question

Exactly one question: id `action`, `multi: false`, its `label` the box's
situation line, and the four options the box's table gives, in order take,
iterate, hold, hand back. Each option is an object:

```json
{"value": "iterate: you fixed the cause, post the summary note again (mr_comment refused, round 1)", "label": "Fixed it, post again", "description": "You fixed what refused the note and I post it again."}
```

`value` is spelled in full, starts with its verb, names the proposed move,
and ends `(<refused tool or origin>, round <k>)`, where `k` is this
origin's current off-script round: 1 at its first gate, 2 at the gate
after one iterate. A resumed pane reads the origin and the round back
from the value, so both are spelled exactly as the box's table gives
them. `label` is 2 to 6 words; `description` is one sentence saying what
happens on that answer. Four options stay inside the native form's
per-question cap.

At round 2 the iterate cannot retry: `Off-script rounds = 2 (...)?`
answers yes, and in every review table that exit writes `error` as the
hand back row does. Keep the iterate's `value` exactly as the table
spells it, so a resumed pane still routes it as an iterate at round 2,
and give it the label `No retry: ` plus the hand back row's label (its
first letter lowercased) and the description `Retries are spent, so `
plus the hand back row's description:

```json
{"value": "iterate: you fixed the cause, post the summary note again (mr_comment refused, round 2)", "label": "No retry: hand it back", "description": "Retries are spent, so I write an error naming the refusal and what posted, and you take over."}
```

`--context` quotes both errors verbatim (the first refusal and the one
after the fix) with the call that was refused. Never send an empty
context. It fits inside the gate's 8192 UTF-8 byte budget like
`review-post`'s; an oversized one is dropped loudly by the daemon, so
never pre-trim it yourself. A nonzero open exit is not itself an
off-script origin: it is `Off-script gate unavailable (review)`.

### review-escalation: take the review gate step

Take "Gate step" with the open's `gateId` and `presentation`. Its outcome
comes back here: answered (`answers.action` and `by`, from the pane
form's `gate answer`, its CAS-loss line, or the wait), gate gone (end
cleanly with no status write), or the wait keeps failing (`gate
unavailable`, never a native form). Nothing moves before the answer.

## Operator note

The launch prompt may end with a paragraph beginning `Operator note (from the
human who launched this pane):`. That is direct instruction from the human,
typed at launch time: not a flag and not part of the MR. Honor it throughout
the review (e.g. "focus on the migration files", "skip the vendored code") and
pass it along to the domain skill as context. It never overrides the gate
protocol or the status contract. A note that asks for a move the graph marks
STOP takes the off-script edge instead.

## Resolving the domain skill

The domain skill that owns the actual review comes from the first source that
answers; the order is fixed and the flow's first diamonds draw it:

1. **Explicit `--skill <name>` wins.** When the board passed it, use it and do
   not run the resolver. When the board also passed `--skill-path <path>`,
   read the SKILL.md at that absolute path directly and treat it exactly as
   the domain skill named by `--skill`.
2. **Otherwise resolve the `review` slot** with the vendored resolver,
   `"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"`. On exit 0, read the
   SKILL.md at `resolved.review.path` and treat that skill exactly as if it
   had been passed via `--skill`.
3. **Otherwise degrade loudly.** On a nonzero exit, print the resolver's JSON
   `errors` verbatim in the pane. Never guess or substitute a binding; the
   script is the only enforcement point. The generic review follows, so an
   unbound board still gets a review, never a silently mis-bound one.

## Building the review-post questions

**One event gate.** This wrapper presents exactly one event gate,
`review-post`, carrying `outcome` and, when the report has findings, one
option per finding chunked into `findings-1..N`: never a "disposition
gate" and a "severity gate" as two separate gates. This is the gate
contract for this invocation; it supersedes any two-gate or per-skill
posting-gate protocol you might recall from an earlier transcript or
session.

**Fitted open file.** When the domain skill hands back a fitted open file,
that file IS this gate: `gate-ctx.sh fit` output whose `.context` carries
the review's structured summary and whose `findings-N` questions each
carry their findings' structured context, with options already in the
recipe below. Open it with:

```bash
"${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" <status-bin> <state> review-post <open-file>
```

A `fits: false` file is still over the shared context budget; the script
drops whole question contexts, largest first, until it fits, so the file
goes in untouched: never rebuilt, re-ordered, trimmed, or hand-edited.
Nothing below is built for it.

**The json sibling.** Otherwise build the questions yourself from the json
sibling of `--report`: swap the trailing `.md` for `.json`, or append
`.json` when `--report`'s path doesn't end in `.md`: a stem swap, never an
append onto the md path. That's the same derivation the board's own
`readReviewReportJson` uses server-side; the wrapper just reads the file
itself.

**Per-finding questions.** When the json exists and its `findings` is a
non-empty array, build one multi-select option per finding from that
array, plus always one `outcome` question:

```json
[
  {"id": "findings-1", "label": "Post which findings to !<iid>?", "multi": true,
   "options": [
     {"value": "f1", "label": "[Critical] Example finding title",
      "description": "path/to/file.ts:12 · one-line fix gist"},
     {"value": "f2", "label": "[Minor] Another example finding",
      "description": "path/to/other.ts · one-line fix gist · kind:nitpick"},
     {"value": "f3", "label": "[Minor] Non-anchorable example finding",
      "description": "not inline-anchorable · one-line fix gist"}
   ]},
  {"id": "outcome", "label": "Verdict on !<iid>: <readiness clause>", "multi": false,
   "options": [
     {"value": "approve", "label": "approve (recommended)",
      "description": "no blocking issues; ready to merge"},
     {"value": "comment", "label": "comment",
      "description": "post the picked findings, no merge decision yet"}
   ]}
]
```

`f1`/`f2`/`f3` and every string above are invented placeholders:
substitute the report's real `id`/`tier`/`title`/`file`/`line`/`fix`/
`kind` values. Don't copy the example verbatim.

- **Ordering and chunking.** Order the whole `findings` array by tier
  first (`Critical`, then `Important`, then `Minor`: the report's fixed
  tier vocabulary), keeping each tier's own report order within it. Chunk
  that ordered list into 4-option questions `findings-1`, `findings-2`,
  ... `findings-N`, running straight across tier boundaries (a chunk mixes
  tiers when a tier's count isn't a multiple of 4). Answers read back as
  one union, the gate protocol's chunk convention (see `Hand the answer to
  the domain skill to post` and "Posting" under Flow).
- **Option shape.** `value` is the finding's `id` verbatim (never
  re-derive or renumber it). `label` is `[Tier] title`; if that would
  exceed the option label's 200 UTF-8 byte cap, middle-truncate the title
  only, keeping the `[Tier] ` prefix and the value untouched: an oversized
  label rejects the `gate open` outright, so size it before calling out.
  `description` is the anchor plus the fix gist, joined by " · ": the
  anchor is `file:line` when both are present, `file` alone when there's
  no `line`, or the json's `fileLabel` verbatim when the finding has
  neither (a finding with no anchor at all posts to the review's summary
  comment downstream, not an inline thread). When the finding carries a
  `kind`, append " · kind:<word>" to the very end of the description,
  `<word>` being the report's `kind` value verbatim. `<word>` must be
  lowercase and hyphens only, the pinned format's whole vocabulary for it,
  so normalize anything else (case, spaces, underscores) to that shape
  before it rides the description. Descriptions cap at 1024 UTF-8 bytes;
  if one would run over, shorten the fix gist, never the anchor and never
  the trailing kind suffix, which the pinned format keeps at the literal
  end of the string. This option recipe is pinned: a fitted open's options
  carry the same one, and surfaces without a card renderer read it, so it
  never changes shape.
- **Verdict label.** Compose `<readiness clause>` from the json's
  `summary.readiness` and `summary.reasoning`, not a copy of either field
  verbatim: readiness `yes` reads as "ready to merge"; `with-fixes` or `no`
  reads as "not ready" or "ready once <the gist of the reasoning>", tuned
  to what the reasoning actually says. For example, readiness `with-fixes`
  with reasoning "One example concern remains; the rest looks solid."
  becomes the clause "ready once the example concern is addressed". Keep
  the whole label tight: shorten the clause first, never the `!<iid>`
  prefix.
- **Outcome options.** Exactly two values, `approve` and `comment`: the
  only values `review-status --outcome` accepts (see the status contract).
  Each option carries a `description`: a short one-liner of what picking
  it *does* for this review, not a restatement of the label. The
  recommended-first rule below applies.
- **Clean review** (`findings` is present and a valid empty array): omit
  every `findings-N` question and open the gate with `outcome` alone, so a
  clean review is approvable in one click. Only the empty array means
  clean: a report whose `findings` field is missing, not an array, or holds
  entries that don't fit the schema is a malformed report, not a clean
  one. Treating it as clean would let an approve go out with the omitted
  findings unseen, so take the tier fallback for it. Never map a clean
  review to Approve on your own: a clean review just means Approve is the
  sensible pick to *offer*.

**Tier fallback.** When the json is absent or malformed (no sibling
`.json`, unparseable json, or a parsed report whose `findings` is missing,
not an array, or holds entries that don't fit the schema), fall back to
tier-level options and print the pane line
(`Print the tier-fallback line in the pane`). Posting accepts this
`{tiers, outcome}` shape. Add a `tiers` question (multi-select over the
severity levels the domain skill reported present, or your own findings'
levels on the generic path) only when at least one level is present:

```json
[
  {"id": "tiers", "label": "Post which findings?", "multi": true,
   "context": "<one line per finding title, verbatim from the report, grouped by tier>",
   "options": [<levels present>]},
  {"id": "outcome", "label": "Verdict", "multi": false, "options": ["comment", "approve"]}
]
```

`<levels present>` is a placeholder: substitute the actual tier objects,
e.g. on the generic path `[{"value":"Critical","label":"Critical (1)"},
{"value":"Minor","label":"Minor (2)"}]`. Don't copy it verbatim. Each
`value` is the tier exactly as the report spells it, so posting matches
the `tiers` answer to the report's tiers verbatim. The finding
titles ride this `tiers` question's own `context` (one line per finding,
verbatim from the report file, never re-summarized).

When no levels are present here either (a clean review with no findings,
and no json to confirm it), omit the `tiers` question the same way as the
per-finding path and open the gate with `outcome` alone, so a clean review
is approvable in one click on this branch too:

```json
[{"id": "outcome", "label": "Verdict", "multi": false, "options": ["comment", "approve"]}]
```

**Recommended outcome first.** On every branch above, unconditionally,
list the recommended outcome FIRST and give it a label ending in "
(recommended)", e.g. `[{"value": "approve", "label": "approve
(recommended)"}, "comment"]`: the other option can stay a bare string. The
outcome question's shape doesn't change between branches; only whether a
`findings-N` or `tiers` question sits alongside it does.

## Re-review mode

Only when `--re-review` was passed. This MR was reviewed before and the author
should have responded to that feedback: replied to or resolved comment
threads, and/or pushed new commits. Your job is to re-review with that in
mind, not to start from a blank slate.

A resumed pane replays the whole prior session above your first message, so the
top of this pane shows the ORIGINAL review's prompt and transcript. That
scrollback is history, not your instructions. `--re-review` on THIS invocation
is what governs, and a reader scrolling from the top has no way to tell the two
apart, which is why `Print the RE-REVIEW banner as the first output` comes
before anything else.

1. **Load the prior review, if any.** If a file exists at `--report <path>`,
   it holds the previous review: read it first so you know exactly what was
   flagged. If it's missing, there's no board record of a prior review;
   carry on with the re-review framing anyway, since a human may have
   reviewed outside the board.
2. **Check whether the author actually acted.** Look at the MR's
   discussions (read at `mr_threads {mrUrl, refresh: true} (re-review)`
   on the generic path; the domain skill reads them itself) and new
   commits since the last review. Did the author address the prior
   feedback?
3. **Branch.** Author acted: re-review focused on that. No action found:
   say so explicitly in the report's summary line and fall back to a
   normal full review. `Review the MR yourself` carries both branches.
4. **Delegating to `--skill`?** Hand it the same framing: the prior review
   (from `--report`), "check what the author addressed since the last
   review", and the "flag and fall back to a full review if nothing was
   acted on" instruction.

Everything else (status writes, saving the report to `--report`, the gate)
is the same: a re-review is still a review.

## Rules

- The board turns your status writes into the slack reactions on this MR's
  review-request message: 👀 when you mark `reviewing`, 💬 or ✅ when you
  mark `done` with an outcome. You never react in slack yourself.
- `--state` is a handle, not a file: pass it verbatim, never read or write
  it yourself. `--report` is a real file you write. Status goes only
  through `--status-bin`, and the review Markdown only to `--report`.
- The verdict is the human's. Never mark `done` without the gate's answer,
  and never pick the outcome yourself, a clean review included.

## Gate protocol

The daemon-generic gate mechanics every passage above refers to. The board's
own projections (`<status-bin> gate ...`) sit in `board:gate-cli-recipes`;
everything else is here.

Below, `gate_ask` is what this wrapper's `<status-bin> gate open` already
did; `gate_answer` is `<status-bin> gate answer <state> --answers <json>
--by pane`; `rt gate wait` is the wait recipe in `board:gate-cli-recipes`.
This wrapper's own "Off-script step" replaces the protocol's "Off-script
gate" section.

<!-- part: include:gate-protocol source=mattstack:gate-protocol version=0.30.4 path=attachments/gate-protocol/SKILL.md lines=7-452 -->
# Gate protocol

One shared protocol for any gated pane or wrapper: publish first, then act
on the presentation the daemon returns. The daemon's gate registry is the
single arbiter; no per-verb conflict logic belongs anywhere downstream of
it. Every gate walks this graph: the site names the scope, the questions
and the selection; this part publishes, answers and records.

If a site's questions or a rule in the including verb ask for a move this
graph marks STOP, open the Off-script gate (below) instead.

```dot
digraph gate_protocol {
    rankdir=TB;

    "Trigger: a site reaches its gate" [shape=ellipse];
    "Build the gate's questions and context" [shape=box];
    "Under a run: bracket the gate?" [shape=diamond];
    "run_field_set {key: gate, value: <scope>, stage}" [shape=plaintext];
    "gate_ask {questions, kind: <scope>, context?, subject?}" [shape=plaintext];
    "gate_ask result?" [shape=diamond];
    "Fixed this gate_ask call once already?" [shape=diamond];
    "Fix what the gate_ask refusal names" [shape=box];
    "Daemon down: is the gated pane unattended?" [shape=diamond];
    "Under a run: fail the stage at the gate?" [shape=diamond];
    "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" [shape=plaintext];
    "Present the gate form with no registry" [shape=box];
    "gate_ask presentation?" [shape=diamond];
    "Wait: is the gated pane an attended non-herdr session?" [shape=diamond];
    "Present the in-pane gate form" [shape=box];
    "Gate form result?" [shape=diamond];
    "Gate questions left for another form call?" [shape=diamond];
    "Map the gate answer to exact option values" [shape=box];
    "gate_answer {id, answers}" [shape=plaintext];
    "gate_answer result?" [shape=diamond];
    "Resubmitted this gate_answer once already?" [shape=diamond];
    "Discard the form's gate answer; say which surface won" [shape=box];
    "Holding an open gate: under a run?" [shape=diamond];
    "Under a run: set waiting-gate?" [shape=diamond];
    "run_field_set {key: waiting-gate, value: <id>, stage}" [shape=plaintext];
    "rt gate wait <id> as a background Bash task" [shape=plaintext];
    "End the turn: holding at gate <id>" [shape=box];
    "Trigger: the gate wait finished and re-invoked this pane" [shape=ellipse];
    "Gate wait result for an already reconciled gate?" [shape=diamond];
    "Trigger: the human answers in words at a held gate" [shape=ellipse];
    "Words answer for an already reconciled gate?" [shape=diamond];
    "Trigger: a gate doorbell push arrives" [shape=ellipse];
    "Doorbell for an already reconciled gate?" [shape=diamond];
    "rt gate wait <id> --timeout 2s" [shape=plaintext];
    "waiting-gate set on this run?" [shape=diamond];
    "run_field_set {key: waiting-gate, value: -, stage}" [shape=plaintext];
    "Gate answer already in hand?" [shape=diamond];
    "Gate wait status?" [shape=diamond];
    "Take the winning gate answer and its by" [shape=box];
    "Under a run: record the gate decision?" [shape=diamond];
    "run_decision {contract: gate@1, scope, selection, decidedBy}" [shape=plaintext];
    "STOP: never invent an answer or re-ask a closed gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Gate stage failed" [shape=doublecircle];
    "Verb ends at the gate, quoting the refusal" [shape=doublecircle];
    "No run: held at the open gate, turn ends" [shape=doublecircle];
    "Late gate signal discarded" [shape=doublecircle];
    "Gate path ended per the verb's policy" [shape=doublecircle];
    "Act on the gate answer at the site" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a site reaches its gate" -> "Build the gate's questions and context";
    "Build the gate's questions and context" -> "Under a run: bracket the gate?";
    "Under a run: bracket the gate?" -> "run_field_set {key: gate, value: <scope>, stage}" [label="yes"];
    "Under a run: bracket the gate?" -> "gate_ask {questions, kind: <scope>, context?, subject?}" [label="no"];
    "run_field_set {key: gate, value: <scope>, stage}" -> "gate_ask {questions, kind: <scope>, context?, subject?}";
    "gate_ask {questions, kind: <scope>, context?, subject?}" -> "gate_ask result?";
    "gate_ask result?" -> "gate_ask presentation?" [label="ok: keep id and presentation"];
    "gate_ask result?" -> "Daemon down: is the gated pane unattended?" [label="refused: daemon unreachable"];
    "gate_ask result?" -> "Fixed this gate_ask call once already?" [label="refused: any other reason"];
    "Fixed this gate_ask call once already?" -> "Fix what the gate_ask refusal names" [label="no"];
    "Fixed this gate_ask call once already?" -> "Under a run: fail the stage at the gate?" [label="yes: budget spent"];
    "Fix what the gate_ask refusal names" -> "gate_ask {questions, kind: <scope>, context?, subject?}";
    "Daemon down: is the gated pane unattended?" -> "Present the gate form with no registry" [label="no: attended"];
    "Daemon down: is the gated pane unattended?" -> "Under a run: fail the stage at the gate?" [label="yes"];
    "Under a run: fail the stage at the gate?" -> "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" [label="yes"];
    "Under a run: fail the stage at the gate?" -> "Verb ends at the gate, quoting the refusal" [label="no"];
    "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" -> "Gate stage failed";
    "Present the gate form with no registry" -> "Under a run: record the gate decision?" [label="answered: decidedBy is pane"];
    "gate_ask presentation?" -> "Present the in-pane gate form" [label="form"];
    "gate_ask presentation?" -> "Wait: is the gated pane an attended non-herdr session?" [label="wait"];
    "Wait: is the gated pane an attended non-herdr session?" -> "Present the in-pane gate form" [label="yes: take the form anyway"];
    "Wait: is the gated pane an attended non-herdr session?" -> "Under a run: set waiting-gate?" [label="no: spawned, or any herdr pane"];
    "Present the in-pane gate form" -> "Gate form result?";
    "Gate form result?" -> "Gate questions left for another form call?" [label="answered"];
    "Gate form result?" -> "Trigger: a gate doorbell push arrives" [label="dismissed by the daemon: the doorbell is the next input" style=dashed];
    "Gate form result?" -> "Holding an open gate: under a run?" [label="cancelled by the human"];
    "Gate questions left for another form call?" -> "Present the in-pane gate form" [label="yes: the next chunk"];
    "Gate questions left for another form call?" -> "Map the gate answer to exact option values" [label="no: last chunk answered"];
    "Map the gate answer to exact option values" -> "gate_answer {id, answers}";
    "gate_answer {id, answers}" -> "gate_answer result?";
    "gate_answer result?" -> "Take the winning gate answer and its by" [label="recorded: this answer won"];
    "gate_answer result?" -> "Discard the form's gate answer; say which surface won" [label="conflict: true"];
    "gate_answer result?" -> "Resubmitted this gate_answer once already?" [label="refused: not an option value"];
    "gate_answer result?" -> "STOP: never invent an answer or re-ask a closed gate" [label="refused: gate closed or not found"];
    "Resubmitted this gate_answer once already?" -> "Map the gate answer to exact option values" [label="no"];
    "Resubmitted this gate_answer once already?" -> "Holding an open gate: under a run?" [label="yes: leave it open for another surface"];
    "Discard the form's gate answer; say which surface won" -> "Take the winning gate answer and its by";
    "Holding an open gate: under a run?" -> "run_field_set {key: waiting-gate, value: <id>, stage}" [label="yes"];
    "Holding an open gate: under a run?" -> "No run: held at the open gate, turn ends" [label="no"];
    "Under a run: set waiting-gate?" -> "run_field_set {key: waiting-gate, value: <id>, stage}" [label="yes"];
    "Under a run: set waiting-gate?" -> "rt gate wait <id> as a background Bash task" [label="no"];
    "run_field_set {key: waiting-gate, value: <id>, stage}" -> "rt gate wait <id> as a background Bash task";
    "rt gate wait <id> as a background Bash task" -> "End the turn: holding at gate <id>";
    "End the turn: holding at gate <id>" -> "Trigger: the gate wait finished and re-invoked this pane" [style=dashed];
    "Trigger: the gate wait finished and re-invoked this pane" -> "Gate wait result for an already reconciled gate?";
    "Gate wait result for an already reconciled gate?" -> "Late gate signal discarded" [label="yes"];
    "Gate wait result for an already reconciled gate?" -> "waiting-gate set on this run?" [label="no"];
    "Trigger: the human answers in words at a held gate" -> "Words answer for an already reconciled gate?";
    "Words answer for an already reconciled gate?" -> "Late gate signal discarded" [label="yes: say in one line which surface already decided it"];
    "Words answer for an already reconciled gate?" -> "waiting-gate set on this run?" [label="no"];
    "Trigger: a gate doorbell push arrives" -> "Doorbell for an already reconciled gate?";
    "Doorbell for an already reconciled gate?" -> "Late gate signal discarded" [label="yes"];
    "Doorbell for an already reconciled gate?" -> "rt gate wait <id> --timeout 2s" [label="no"];
    "rt gate wait <id> --timeout 2s" -> "waiting-gate set on this run?";
    "waiting-gate set on this run?" -> "run_field_set {key: waiting-gate, value: -, stage}" [label="yes: this pane armed it at a hold"];
    "waiting-gate set on this run?" -> "Gate answer already in hand?" [label="no: never armed for this gate (a form pane, or no run)"];
    "run_field_set {key: waiting-gate, value: -, stage}" -> "Gate answer already in hand?";
    "Gate answer already in hand?" -> "Map the gate answer to exact option values" [label="yes: the human answered in words"];
    "Gate answer already in hand?" -> "Gate wait status?" [label="no: a wait printed the row"];
    "Gate wait status?" -> "Take the winning gate answer and its by" [label="answered: row.answer"];
    "Gate wait status?" -> "STOP: never invent an answer or re-ask a closed gate" [label="closed or gate not found"];
    "Gate wait status?" -> "Holding an open gate: under a run?" [label="timed out: still open (the 2s re-read)"];
    "STOP: never invent an answer or re-ask a closed gate" -> "Gate path ended per the verb's policy";
    "Take the winning gate answer and its by" -> "Under a run: record the gate decision?";
    "Under a run: record the gate decision?" -> "run_decision {contract: gate@1, scope, selection, decidedBy}" [label="yes"];
    "Under a run: record the gate decision?" -> "Act on the gate answer at the site" [label="no"];
    "run_decision {contract: gate@1, scope, selection, decidedBy}" -> "Act on the gate answer at the site";
}
```

### Build the gate's questions and context

Open before anything that depends on the answer. `gate_ask` owns the whole
opening ceremony (subject resolution, presentation, nudge, origin, the
context size cap): `questions` (each `{"id", "label", "multi",
"options"}`), `kind` = the gate's scope, and optional `context` and
`subject`. Success returns `id` (`gt-...`), `presentation` (`form` or
`wait`), `subject`, and `supersededId` (null or the superseded gate's id).
Keep `id` and `presentation`: every node after it acts on them.

- **Subject.** The daemon resolves it; never build one by hand. Your
  session's running run wins (`run:<id>`), else your agent record (its
  launch subject when it carries one, else `agent:<id>`); with neither, a
  loud refusal, and a session with multiple running runs is refused naming
  the candidates. Pass `subject` only to open on a subject that is not your
  own. Opening where the subject already carries an open gate of the same
  kind supersedes the old one, so a relaunch after a crash is safe without
  a cleanup step.
- **Context.** A prose `context` is a VERBATIM QUOTE of the material the
  decision is about (the task summary from the brief, the plan section
  under decision, the failing check output), never a freshly composed
  summary; a structured one carries its shape's fields instead (Structured
  context below). A human-owned, non-exempt gate REFUSES on empty or
  whitespace-only context: give it real material or omit the field, never
  blank it. The gate context and every question's `context` share one
  8192-byte UTF-8 budget; over it, the daemon drops the question contexts,
  and the gate context too when it alone is over, loudly: the result
  carries `contextOmitted: true`. Do not measure or trim a prose context
  yourself; a structured open pre-flights instead.
- **Prose layout.** A prose `context` is Markdown that reads the same
  unrendered, since the console renders it and the pane form shows it as
  plain text. Its parts, in order: the one or two lines that frame the
  decision; then each group as a label line (`Important:`) followed by one
  `-` bullet per item (a finding, a step, a failing check); a blank line
  between blocks; file paths, symbols, commands and shas in backticks.
  Keep the material's own words and set them in this shape.
- **Where text goes.** Gate-level `context` is background every question
  shares. A question's own `context` is setup for that one question, when
  the gate asks several that need different framing. An option's
  `description` is the one-line why for that choice; the `label` already
  says what.
- **Options.** Emit labeled options whenever a site's option values are not
  already human-readable; the registry stores every option in that object
  form. Labels cap at 200 UTF-8 bytes and an oversized label REJECTS the
  open: middle-truncate a long path, never alter the value.
- **At most 4 options per question.** That is the native form's hard
  per-question limit, and the daemon presents the in-pane form only when
  EVERY question fits it, so one 5-option question sends the whole gate to
  the background wait queue. The navigation verbs a site lists (Iterate
  here, Go back to a stage, Hold, Abandon) are their own `next` question,
  never extra options folded into a decision question; a selection list
  larger than 4 splits into `<id>-1`, `<id>-2`, ... questions of up to 4
  options each, in order, whose answers read as one union.

```json
{"value": "redirect:implement", "label": "Redirect to implement", "description": "the failing check points at code, not the plan"}
```

Presentation is the daemon's, by one rule no caller computes; the nudge and
origin ride the same call, so there is nothing to stamp by hand. `rt gate
open` remains the raw primitive underneath; a gated verb never needs it.

### Fix what the gate_ask refusal names

A refusal that names a subject or question problem (a blank context, an
oversized label, several running runs) is not daemon-down: fix exactly what
it names and call `gate_ask` again, once. An oversized label is fixed by
middle-truncating that label (keep its start and its end, `...` between)
and nothing else: the option's `value` is sent exactly as it was in the
refused call, never rewritten to carry the label's text, and no whole end
of the label is dropped. A second refusal fails the stage under a run
with a `reason` that quotes the refusal text verbatim, or ends the verb
quoting it with no run. It does not go off-script: `gate_ask` is the
refused tool, and the off-script gate opens through `gate_ask` too.

### Present the gate form with no registry

`gate_ask` failed with a daemon-unreachable error, so the gate runs
form-only in the pane, exactly the pre-facility behavior: present the form
and act on its answer, with no `gate_ask`, `rt gate wait` or `gate_answer`
calls at all. With no registry there is no CAS: the form's answer is the
decision, and its record, when a run exists, carries `decidedBy` `pane`.
An unattended pane never presents this form; it fails the stage under a
run, or ends the verb.

### Present the in-pane gate form

This is the `presentation: "form"` branch; an attended non-herdr pane on
`wait` lands here too (Attendance, below). The native in-pane structured form is this
gate's registry face: where the launch-injected AskUserQuestion hook is
active, an open gate matching the pane's LAUNCH subject is what lets the
form through, and so is the pane's own worktree carrying its own open run:
gate. Render each option's `label` when it has one and its `description`
when it has one (the AskUserQuestion option's own description field). The
form never shows a structured context's JSON: flatten a structured context
to prose for the form's question text, and carry a prose context into it
as written.

When the gate carries more questions than one form call fits, ask them in
gate order, one chunk per call, and answer once after the last chunk; a
lost CAS at that point discards every chunk's answer together.

Dismissed by the daemon: another surface answered while the form was open,
the daemon injected a single Escape, and the doorbell is your next input.
Cancelled by the human: the gate stays open; never re-present it on your
own.

### Map the gate answer to exact option values

`gate_answer` takes `id` = the gate's id and `answers` = one object keyed by
question id, `{"<question id>": "<value>" | ["<value>", ...] | {"value":
..., "note": "..."}}`. Each value is the chosen option's `value` verbatim
(Answers are option values, below); a question with no options takes what
the human typed. An answer the human gave in words maps the same way, its
nuance in `note`. A value the daemon refuses is remapped once; a second
refusal leaves the gate open for another surface to answer.

### Discard the form's gate answer; say which surface won

A losing `gate_answer` is not an error: it returns a successful result
carrying `conflict: true` and the winner's `row`. Discard the form's
answer, say in the pane in one line which answer won and from where
(`row.answer.by`), and proceed on `row`'s recorded answer; no second read
is needed. On the words path the discarded answer is the human's words,
not a form's.

### End the turn: holding at gate <id>

The node before launched the one background `rt gate wait <id>` (the
shell tool's run-in-background mode; the wait is never a tool call, since
no tool blocks on a gate); never launch a second while one for this gate
runs. End the turn in one line: `holding at gate <id>`. The wait
loops internally around the daemon clamp, survives daemon restarts, and
exits only on answered or closed, printing
`{"ok":true,"status":"answered","row":{...}}` as its last stdout. The pane
is idle but armed: the wait's completion re-invokes this pane with the
answer as the tool result. Under a run a turn ends only with
`waiting-gate` or `hold` set; the pipeline gate stop hook blocks any other
ending, which is why every hold under a run arms the marker and the wait.

### Take the winning gate answer and its by

Read the answers at `row.answer.answers` (or the answer this pane just
recorded) and the deciding surface at `row.answer.by`. `decidedBy` names
the CAS WINNER, never `pane` when a different surface won, and a `gate@1`
record's `decidedBy` is a surface (`pane`, `board`, `console`,
`shepherd`), never a verb name.

## Attendance

Attendance comes from the invocation context, never from asking. Under a
run it is the run's `spawnedBy` (recorded as `spawned_by`): set means a
surface spawned the pane and it is unattended. A verb with no run has no
`spawnedBy`: one a surface launched in a pane (a board wrapper, a herd
brief) is unattended, and its launch instruction says so; one a human typed
is attended.

On `wait`, the branch turns on herdr as well as attendance: an attended
non-herdr session takes the plain in-pane form anyway, because the stamp
names what OTHER surfaces reconcile against, not a command to this pane,
and a non-herdr pane has no herdr PTY to receive the remote-answer Escape
that makes the idle wait safe. A spawned pane, or any herdr pane whether
attended or not, goes to the wait. The herdr bit is `HERDR_ENV=1` in the
pane's environment, read only to pick this `wait` branch, never to compute
presentation. A human who opens an unattended pane can interrupt the wait
and answer in words: the graph's words trigger, which first checks that
no surface already reconciled the gate.

Under a run, a cancelled form holds on the wait even outside herdr: no form
is open, so nothing needs the remote-answer Escape. With no run, a cancelled
form launches no wait: the human who cancelled is at the pane, the turn ends
held at the open gate, and the answer arrives later in words.

## Runs integration

A site that says "run gate-protocol's Runs integration with kind `<k>` and
these questions" enters the graph at its trigger and walks every branch;
it is not a list of steps to run in order. The site supplies `kind` (its
scope), the questions and its selection. Every `run_*` call passes the
run's `runDb`, which the verb holds. No `subject`: the daemon resolves this
session's running run. Include `context` only when the site has material to
quote; omit the field otherwise, never an empty string.

A site's own lines for the graph's run nodes are those nodes, not extra
steps: its `run_field_set` with `key` `gate` is the bracket node, and its
`run_decision` line is the `run_decision` node, filled with the site's
selection, never a second record.

## Off-script gate

Leaving a host's graph is legal when it is explicit. A host STOP that
routes here opens this gate through the graph above, scope
`off-script:<site>:<n>` (`n` counts from 1 within the site's attempt), with
`context` quoting the refusal or the line that asks for the move:

| Question | Options |
|---|---|
| `action` | **Take the proposed move** (the value spells the move in full) / **Hand back** |
| `next` | **Proceed** (Recommended) / **Iterate here** / **Hold** |

Selection: `{"move":"<the move>","why":"<the refusal or line>","action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`,
recorded only under a run, like every `run_decision`. Take: make exactly
that move, once, then continue from the node the forbidden move would have
led to. Hand back: under a run, `run_stage {action: fail}` with the why as
the reason; with no run, end the verb quoting the why. A host graph draws
one off-script node per STOP origin, never one shared node: continuing
needs to know where the move came from, and a shared node cannot return to
the right place.

## Structured context (gate-ctx@1)

A context string may carry a JSON object instead of prose, for surfaces
that render it as cards. It is structured when it parses as an object
whose `"gate-ctx"` key names a known shape; anything else takes the prose
path. The key is both the discriminant and the version:

| Shape | Carried by | Required | Optional |
|---|---|---|---|
| `plan@1` | gate `context` | `reviewer`, `threads.total` | `round`, `threads.blocking` (absent reads 0), `adjudication` (display string) |
| `post@1` | gate `context` | `reviewer`, `replies` (count) | `round`, `fixes` (`[{"sha": ...}]`) |
| `thread@1` | a thread question's `context` | `author`, `severity`, `claim.summary`, `verdict.call`, `reply.kind`, `reply.text` unless `reply.kind` is `none` | `claim.points` (strings), `verdict.note` |
| `reply@1` | a respond-post thread question's `context` | `thread`, `file`, `verb`, `text` | `sha` |
| `replies@1` | a replies question's `context` (the retired respond-post shape; renderers still read gates opened with it) | `replies[]`, each `thread`, `file`, `verb`, `text` | `sha` per entry |
| `review@1` | a review-post gate's `context` | `readiness`, `summary`, `findings` (counts by severity) | `reviewer`, `round`, `re_review` (absent reads false), `prior` (`{addressed, still_open}`, both required) |
| `findings@1` | each `findings-*` question's `context` | `findings[]`, each `id`, `severity`, `title`, `body` | `file`, `fix`, `evidence`, `disposition` per entry |

- Enums: `severity` is `blocking | non-blocking | question | none`;
  `verdict.call` is `valid | valid-low-value | pushback |
  needs-clarification | no-ask`; `reply.kind` is `verbatim` (the exact
  text that will post), `direction` (intent only), or `none` (nothing
  posts); `verb` is `reply | fix`, and `sha` rides only a `fix`.
  `readiness` is `yes | no | with-fixes`, hyphenated; a `findings@1`
  entry's `severity` is `critical | important | minor` and its
  `disposition` (re-review only) is `new | still-open | addressed-check`;
  a severity with no findings may omit its count, and absent reads 0.
- A `thread@1` question's `label` is the thread's `file:line`, and its
  ordinal is its position among the gate's `thread-*` questions. The
  planned fix is not in the context: it is the `fix` option's
  `description`. A `reply@1` question is `multi`, with exactly two
  options, `post:<thread>` and `resolve:<thread>`, picked independently;
  its `label` is the thread's `file:line`. A `replies@1` entry joins its
  checkbox option by `thread` == option value.
- A `findings@1` entry joins its option ONE TO ONE: `id` == the option's
  `value`, every option with exactly one entry and every entry with one
  option; a mismatch either way sends the whole gate to the generic
  view. The options keep the degraded recipe older renderers parse:
  label `[Tier] title`, description `anchor · fix · kind:<word>`. `file`
  is a real `path:line` anchor, never the label of an unanchored
  finding. A `review@1` gate is structured only when EVERY `findings-*`
  question carries a `findings@1` context; otherwise it opens as prose.
- Unknown keys are ignored, and a new field never bumps the version; a
  changed meaning or type does. A missing or wrong-typed required field
  fails the WHOLE context, which then shows as raw JSON through the prose
  path: validate before opening, and omit an optional key rather than
  writing `null`.
- Size: pre-flight the whole open against the shared budget above,
  measuring the serialized strings. Over it, drop `claim.points` from the
  longest thread first, then `verdict.note` the same way; never trim
  `reply.text`, the reply is the thing being approved.
  In a `findings@1` open, drop `evidence` from the entry where it is
  largest first, then `fix` the same way, whole fields only; never
  `title`, `file`, or `body`. Still over: prose
  contexts for the whole gate, never a half-structured one.
- The in-pane form never shows the JSON: flatten each context to prose
  for the form's question text.

## Answers are option values

For a question with options, every answer value must exactly match one of
its option VALUES (multi = array, every element checked); the daemon
compares values only, never labels, and rejects anything else at record
time. Never an index or a paraphrase. Nuance rides the per-answer note
form:
`{"value": <verbatim value or array>, "note": "<free text>"}`.
A surface that lets the human replace text the gate offered (an edited
reply) sends it as `text` on the same object, beside any note:
`{"value": <verbatim value or array>, "text": "<replacement>"}`. The
in-pane form never sends `text`; a replacement for offered text that the
human types in the form's free-text field rides as a note. What a note or
`text` changes is each verb's own act step's call; the protocol swaps
neither in for offered text by itself.

## Closed gates, Hold / Iterate

`closed` means the decision site is abandoned: end that path cleanly per
the verb's own policy. Never invent an answer for a closed gate. Picking
Hold or Iterate is handled IN-PANE by the verb itself, not posted through
the registry as a terminal decision; a verb that re-asks after Hold or
Iterate opens a NEW gate rather than reusing the old one. Marking such
options pane-only (so remote cards render them disabled) rides `meta`,
which only the typed client and raw `rt gate open` carry; `gate_ask`
does not.

## Doorbell

The doorbell phrase is a VERIFY-ONLY signal: it never carries or implies
the answer, only "re-read the registry" (the 2s re-read node). With a form
open, the daemon dismisses it itself with a single Escape into the gate's
pane, so the doorbell arrives as your next input; for a pane the daemon
cannot reach, it queues behind the form until the human answers or cancels
it. The surface that recorded the answer never receives this push, and a
push for a gate already reconciled is discarded.

## Red flags

| Thought | Reality |
|---|---|
| "I'll compute presentation / build --origin myself" | The daemon owns the ceremony. `gate_ask` returns the presentation; act on it. |
| "The doorbell push tells me what they picked" | It's verify-only. It never carries or implies the answer: re-read the registry. |
| "`decidedBy` is whoever just submitted the form" | It names the CAS WINNER, which may be a different surface than the one that just submitted. |
| "I'll ask the human whether this pane is attended" | Attendance comes from the invocation context, never asked. |
| "The site's run_decision line is one more record after the graph's" | It is the graph's `run_decision` node, filled with the site's selection. |
