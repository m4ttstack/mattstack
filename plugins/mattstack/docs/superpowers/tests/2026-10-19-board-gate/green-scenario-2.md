# Scenario 2 (describe only: run no tools other than reading this file)

You are the evidence stage of a pipeline run in a pane a herd shepherd
spawned: the run's spawnedBy is "herd:h1", and the human answers gates in
the console. Run id 20261019-060000-ef56-1, runDb
/runs/app/20261019-060000-ef56-1/state.db, stage "evidence", worktree
/repo/wt, home /home/u. The domain attaches evidence to an MR here.

Case "badge" (label "Badge overflows") is a browser case. The driver
returned its board /home/u/.fast-browser/screenshots/20261019-060000-ef56-1-badge-before.png,
the brief's claim was "The badge text overflows its pill", and the board
reads right. /home/u/.fast-browser/screenshots/20261019-060000-ef56-1-badge-before.redactions.json
lists two crops: /home/u/.fast-browser/screenshots/20261019-060000-ef56-1-badge-before.redact-1.png
and /home/u/.fast-browser/screenshots/20261019-060000-ef56-1-badge-before.redact-2.png.
It is the only case. Every gate call you make returns paneAction "wait".

Task, three parts:
(a) the exact tool call (name and full input) that opens the redaction gate for this board;
(b) assume the redaction gate was confirmed, compose --confirm exited clean, every case is
    captured, and the lookup found open MR https://gitlab.example/acme/app/-/merge_requests/58:
    the exact tool call (name and full input) that opens the evidence-attach gate;
(c) whether you run any Bash command before either gate's answer arrives, and why.
For (a) and (b) also say what the human sees in the console. Nothing else.


---- SKILL: stage-evidence ----
---
name: stage-evidence
description: "Pipeline stage: capture the before-state evidence the plan committed to, while the before still exists. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: evidence-domain@1, required: false }
metadata:
  stage: "evidence"
  stage-consumes: "evidence-plan worktree"
  stage-produces: "evidence"
---

# stage: evidence

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. `evidence_record` writes `evidence`;
never write it with `run_field_set`. A `<slug> spent?` diamond reads its
`run_budget` as the evidence record below says. `detailPath` on a failure
is whatever was captured so far.

Capture the BEFORE now, before implementation changes the surface.

```dot
digraph evidence {
    evidence_entered [label="Evidence stage entered" shape=ellipse];
    run_field_get_plan [label="run_field_get {key: evidence-plan}" shape=plaintext];
    run_field_get_worktree [label="run_field_get {key: worktree}" shape=plaintext];
    plan_is_none [label="evidence-plan starts with none?" shape=diamond];
    evidence_record_none [label="evidence_record {runDb, stage: evidence, plan: \"none\"}" shape=plaintext];
    domain_steps_before_gate [label="Run the domain steps before the gate (none when unbound)" shape=box];
    needs_dev_servers [label="Domain needs dev servers or another rt read?" shape=diamond];
    dev_endpoints [label="dev_endpoints {tree: <worktree>, roles: <the domain's roles>}" shape=plaintext];
    stop_guessed_ports [label="STOP: ports come only from dev_endpoints" shape=octagon style=filled fillcolor=red fontcolor=white];
    role_waiting [label="Any role waiting or unclaimed?" shape=diamond];
    rt_verb [label="rt_verb {args: [<verb>, ...]}" shape=plaintext];
    stop_shell_rt_read [label="STOP: rt reads go through rt_verb, never rt on Bash" shape=octagon style=filled fillcolor=red fontcolor=white];
    intake_needed [label="Intake questions declared, or source not local?" shape=diamond];
    gate_evidence [label="Gate evidence (table below)" shape=box];
    evidence_answer [label="evidence answer?" shape=diamond];
    ticket_shows_before [label="Ticket already shows the broken state?" shape=diamond];
    save_ticket_image [label="Save the ticket image as the BEFORE" shape=box];
    ticket_image_saved [label="Ticket image saved?" shape=diamond];
    record_ticket_before [label="Record the ticket's location as the BEFORE" shape=box];
    browser_case [label="Browser screenshot for this case?" shape=diamond];
    capture_browser [label="Capture with the browser (browser-evidence)" shape=box];
    capture_before_case [label="Capture the BEFORE for the next case" shape=box];
    captured [label="Captured?" shape=diamond];
    run_budget_capture_attempts [label="run_budget {runDb, key: evidence:capture-attempts:<case>, limit: 3, stage: evidence}" shape=plaintext];
    capture_attempts_spent [label="capture-attempts spent?" shape=diamond];
    every_case_captured [label="Every planned case captured or located?" shape=diamond];
    pick_next_source [label="Pick the next source or view" shape=box];
    same_source [label="Same source the gate recorded?" shape=diamond];
    stop_new_source [label="STOP: a new data source is an off-script move" shape=octagon style=filled fillcolor=red fontcolor=white];
    gate_new_source [label="Off-script gate: a new data source" shape=box];
    off_script_answer [label="off-script answer?" shape=diamond];
    run_budget_source_off_script [label="run_budget {runDb, key: evidence:source-off-script, limit: 2, stage: evidence}" shape=plaintext];
    source_off_script_spent [label="source-off-script spent?" shape=diamond];
    run_budget_gate_iterates [label="run_budget {runDb, key: evidence:gate-iterates, limit: 3, stage: evidence}" shape=plaintext];
    gate_iterates_spent [label="gate-iterates spent?" shape=diamond];
    domain_attaches_mr [label="Domain attaches evidence to an MR here?" shape=diamond];
    run_field_get_branch [label="run_field_get {key: branch}" shape=plaintext];
    git_remote_origin [label="git -C <worktree> remote get-url origin" shape=plaintext];
    forge_host [label="Forge host?" shape=diamond];
    mr_for_branch [label="mr_for_branch {repoName: <worktree>, branches: [<branch>]}" shape=plaintext];
    gh_pr_view_branch [label="gh pr view <branch> --json number,url,state" shape=plaintext];
    open_mr_on_branch [label="Open MR or PR on the branch?" shape=diamond];
    gate_evidence_attach [label="Gate evidence-attach (table below)" shape=box];
    attach_answer [label="attach answer?" shape=diamond];
    record_evidence [label="Record the evidence (evidence-record)" shape=box];
    record_outcome [label="Record outcome?" shape=diamond];
    attach_answered [label="Attach now answered?" shape=diamond];
    attach_evidence [label="Attach the evidence (evidence-record)" shape=box];
    attach_outcome [label="Attach outcome?" shape=diamond];
    run_stage_fail [label="run_stage {action: fail, stage: evidence, reason, detailPath}" shape=plaintext];
    run_hold [label="run_hold {runDb, stage: evidence, reason, decidedBy}" shape=plaintext];
    held_end_turn [label="Held: end the turn naming run and stage" shape=doublecircle];
    stage_failed [label="Stage failed" shape=doublecircle];
    evidence_done [label="Evidence done: return to the orchestrator" shape=doublecircle style=filled fillcolor=lightgreen];

    evidence_entered -> run_field_get_plan -> run_field_get_worktree -> plan_is_none;
    plan_is_none -> evidence_record_none [label="yes"];
    plan_is_none -> domain_steps_before_gate [label="no"];
    evidence_record_none -> evidence_done [label="written"];
    evidence_record_none -> run_stage_fail [label="errored"];
    domain_steps_before_gate -> needs_dev_servers;
    needs_dev_servers -> dev_endpoints [label="dev servers"];
    needs_dev_servers -> rt_verb [label="another rt read"];
    needs_dev_servers -> stop_guessed_ports [label="tempted to look up or probe ports on Bash"];
    needs_dev_servers -> stop_shell_rt_read [label="tempted to run rt on Bash"];
    needs_dev_servers -> intake_needed [label="no"];
    stop_guessed_ports -> dev_endpoints;
    stop_shell_rt_read -> rt_verb;
    dev_endpoints -> role_waiting;
    role_waiting -> gate_evidence [label="yes: name it in the gate's sentence"];
    role_waiting -> rt_verb [label="no, and another rt read"];
    role_waiting -> intake_needed [label="no"];
    rt_verb -> intake_needed;
    intake_needed -> gate_evidence [label="yes"];
    intake_needed -> ticket_shows_before [label="no"];
    gate_evidence -> evidence_answer;
    evidence_answer -> ticket_shows_before [label="proceed: intake and source recorded"];
    evidence_answer -> gate_evidence [label="iterate: re-ask with their note"];
    evidence_answer -> run_budget_gate_iterates [label="iterate, a role was waiting or unclaimed"];
    run_budget_gate_iterates -> gate_iterates_spent;
    gate_iterates_spent -> dev_endpoints [label="no: re-check"];
    gate_iterates_spent -> run_stage_fail [label="yes: hand back, the roles named"];
    evidence_answer -> run_stage_fail [label="hand back"];
    evidence_answer -> every_case_captured [label="go on without this BEFORE: reopened from an unfixable Not drawn"];
    ticket_shows_before -> save_ticket_image [label="yes: an image"];
    ticket_shows_before -> record_ticket_before [label="yes: a link or text, no image"];
    ticket_shows_before -> browser_case [label="no"];
    save_ticket_image -> ticket_image_saved;
    ticket_image_saved -> every_case_captured [label="yes"];
    ticket_image_saved -> record_ticket_before [label="no: no tool can fetch it, keep the link"];
    record_ticket_before -> every_case_captured;
    every_case_captured -> ticket_shows_before [label="no"];
    every_case_captured -> domain_attaches_mr [label="yes"];
    browser_case -> capture_browser [label="yes"];
    browser_case -> capture_before_case [label="no: the domain's own method"];
    capture_browser -> captured;
    capture_before_case -> captured;
    captured -> every_case_captured [label="yes, or Board ready: keep its board and claim for the record"];
    captured -> run_budget_capture_attempts [label="no, or Not drawn: a failed brief or spent re-renders"];
    captured -> gate_evidence [label="Not drawn, a reason no retry can fix: reopen with what was tried"];
    captured -> run_hold [label="Held at evidence-redaction"];
    run_budget_capture_attempts -> capture_attempts_spent;
    capture_attempts_spent -> pick_next_source [label="no"];
    capture_attempts_spent -> gate_evidence [label="yes: reopen with what was tried"];
    pick_next_source -> same_source;
    same_source -> browser_case [label="yes"];
    same_source -> stop_new_source [label="no"];
    stop_new_source -> gate_new_source -> off_script_answer;
    off_script_answer -> browser_case [label="proceed + take: the proposed source"];
    off_script_answer -> run_stage_fail [label="proceed + hand back"];
    off_script_answer -> run_budget_source_off_script [label="iterate: the human fixed the recorded source"];
    run_budget_source_off_script -> source_off_script_spent;
    source_off_script_spent -> browser_case [label="no: the recorded source"];
    source_off_script_spent -> run_stage_fail [label="yes: hand back"];
    domain_attaches_mr -> run_field_get_branch [label="yes"];
    domain_attaches_mr -> record_evidence [label="no: ship attaches"];
    run_field_get_branch -> git_remote_origin -> forge_host;
    forge_host -> mr_for_branch [label="GitLab"];
    forge_host -> gh_pr_view_branch [label="GitHub"];
    forge_host -> record_evidence [label="another host: ship attaches"];
    {mr_for_branch gh_pr_view_branch} -> open_mr_on_branch;
    open_mr_on_branch -> gate_evidence_attach [label="yes (a PR's state is OPEN): keep its url"];
    open_mr_on_branch -> record_evidence [label="no, or a PR not OPEN: ship attaches later"];
    gate_evidence_attach -> attach_answer;
    attach_answer -> record_evidence [label="attach now, or hand back the markdown"];
    attach_answer -> gate_evidence_attach [label="iterate, or hide: revise each drawn board their words name, re-ask with their note"];
    {evidence_answer off_script_answer attach_answer} -> run_hold [label="hold"];
    record_evidence -> record_outcome;
    record_outcome -> attach_answered [label="Recorded"];
    attach_answered -> attach_evidence [label="yes"];
    attach_answered -> evidence_done [label="no"];
    attach_evidence -> attach_outcome;
    attach_outcome -> evidence_done [label="Attached, or Taken: ship's attach sends the refused files"];
    {record_outcome attach_outcome} -> run_hold [label="Record held, or Attach held"];
    {record_outcome attach_outcome} -> run_stage_fail [label="Record failed, or Attach failed: the reason quoted"];
    run_hold -> held_end_turn;
    run_stage_fail -> stage_failed;
}
```

### Run the domain steps before the gate (none when unbound)

The domain's gathering steps: the running app's dev servers, its data
source, and any fact the gate's sentence or the `source` question needs.
Their result decides whether `source` fires. A role `dev_endpoints` lists
in `waiting` (claimed, never answered), or reports unclaimed or with an
`error`, goes in the evidence gate's sentence, so the gate opens with no
intake question.

### Reading a GitLab fact no read tool returns

At any step, a GitLab fact no read tool returns is read with
`gitlab_get {repoName, path}`: `repoName` = the tree this stage targets,
`path` relative to the API root with `:id` for this project (for example
`projects/:id/merge_requests/<iid>/notes`). It is part of the step, not
an off-script move. Quote a GitLab error as written; its refusal of a
credential path is final.

### Save the ticket image as the BEFORE

When the ticket embeds the broken state as an image, that image is the
before. Give the case its `id` and `label` first: the file name needs the
id. Save it in the session temp root as `<run id>-<case id>-ticket.<ext>`,
`<ext>` the image's own extension, lowercased: `png`, `jpg`, `jpeg`, `gif`
or `webp`. An image of any other type is not saved: `Ticket image saved?`
is no. Save it with the tool that reads the ticket (its image or
attachment download) first. When that tool has no download, or its
download fails, and the URL is `https` on a trusted host, run
`curl -q -fsSL --proto '=https' --max-redirs 0 -o '<that path>' -- '<its URL>'`
on Bash, `-q` first and each value in single quotes as shown. Keep the
link either way: it is the record's `url`.

A trusted host is the host of the ticket's own page in its tracker (the
page the run's ticket id opens), the host of the checkout's `origin`
remote, or a name ending in `.` plus either one (`uploads.example.app`
for a ticket on `example.app`). A host named inside the ticket's text is
never trusted for that. Hosts compare in lowercase, without a port,
userinfo or trailing dot. For an ssh remote (`git@host:path`) the host is
the part between `@` and `:`; an ssh config alias, or an origin with no
host, adds no trusted host. curl never fetches a URL that is not `https`,
that holds a single quote, whose host part holds `@`, `\`, `%` or a port,
or whose host is not trusted. Once the ticket tool's download has failed,
or it has none, a URL curl refuses, or one that redirects, is one no tool
can fetch, and it is never fetched another way: the case takes the
link-only branch.

The saved file is the case's BEFORE `path`, and every `evidence_record`
call that names it carries `source: "ticket"` on that image, the first by
this path and each later one by its run-folder copy's path: the record then
refuses a waiver on it and the upload refuses its own path, so only its
board ever leaves the machine. Once that call returns the image's run-folder
copy in `value`, delete the saved original from the session temp root
(`rm '<the saved path>'`): the copy is the one the record governs, and no
unredacted original is left in an upload root. Its board is drawn inside
`Record the evidence`, at its annotate-or-waive pass, as a browser-evidence
`import:` brief of its `value` path from the link with `state: FOUND`, so a
run that also has a live browser case spawns the driver twice by design.
A ticket image is the likeliest to come from production, so `hide` names
every personal detail on it that is not being verified.

### Record the ticket's location as the BEFORE

When the ticket shows the broken state only as a link or as text (a
failing output pasted in), with no image to save, that is the before:
keep where it sits for the record's `url` instead of recapturing. That
case has no BEFORE image; ship records it with its AFTER.

### Capture with the browser (browser-evidence)

`Browser screenshot for this case?` is yes when the domain has a
`## Browser target` section (in its rules, or in the file they point at
for it) and either its What proves a change names a view for this case's
kind of change, or it has no What proves a change block and the plan's
evidence for the case is a screenshot of a web page. A bound domain with
no browser target always answers no. Unbound, it is yes when the plan's
evidence for the case is a screenshot of a web page.

Give the case its `id` and `label` first: the brief's stem needs the id.
Walk browser-evidence's `Draw the boards` (Browser evidence below) for
this case's before board, one brief built from the browser target:
`state: FOUND`, `page:` from Reach the view, `show` and `point at` from
What proves a change, the wording from Captions and `hide` from Personal
data. Unbound, every block takes its default.

Its terminals answer `Captured?`:

- **Board ready** is yes. Keep the capture, the board
  (`~/.fast-browser/screenshots/<stem>.png`) and the brief's claim for
  `Record the evidence`.
- **Held at evidence-redaction** is the stage's hold.
- **Not drawn** for a reason no retry can fix (the developer left it
  uncaptured, the doctor stayed red, no compose on PATH, sign-in asks
  spent, no driver to spawn, redaction rounds or openings spent, confirm
  refused twice) reopens the evidence gate with what was tried, which then
  offers **Hand back** and **Go on without this BEFORE** in place of
  **Proceed**, since the same pass would end Not drawn again.
- **Not drawn** for a failed brief or spent re-renders takes the no edge,
  counted against `capture-attempts`.

A yes case follows browser-evidence alone. The domain's own capture steps
(its Capture the BEFORE text, any preview capture, any draw or annotate
step) apply only to its other evidence kinds: on a browser case, the
domain's browser target supplies facts, never steps.

### Capture the BEFORE for the next case

The plan names the cases; give each an `id` and a `label` now. Follow the
domain's capture method for the plan's evidence type. Never reconstruct a
before by reverting code on a running dev server: it produces stale,
false befores. Unbound, capture what a generic toolchain can (the failing
test output, a CLI transcript, a screenshot the user provides). Leave
each capture where it was written. A text capture goes to a file in the
session temp root; that path is the record's `transcript`.

### Pick the next source or view

A failed capture (a blank page, a missing record, a wrong route) gets one
different attempt per round: another view, another record, the same
source.

### Off-script gate: a new data source

Scope `off-script:evidence:<n>`, `n` counting this stage pass's
off-script gates from 1, the upload gate inside `Attach the evidence`
included. `context` names the recorded source and the proposed one. Read
`next` first: Hold ends the turn with no capture made; Iterate (which
ignores `action`) retries the recorded source after the human's fix; only
Take uses the proposed source.

### Record the evidence (evidence-record)

Run `Record the evidence` below for every BEFORE: each image by the
`path` the capture wrote, with `case`, `slot: before` and `label`; the
text capture as `transcript`; the ticket location or a saved image's link
as `url`; `tree` the worktree. A browser case's board that is ready rides
on the first call: `path` its capture (`<stem>.c1.png`), `annotated` the
board, `caption` the brief's claim (browser-evidence, Record the board).
A saved ticket image carries `source: "ticket"` on this call and on every
later call that names its copy, and once the first call
returns its copy in `value`, delete the temp-root original (Save the ticket
image as the BEFORE). The attach gate's `annotations` answers feed the annotate-or-waive pass
for every other image. **Hand back the markdown** ends here, nothing
attached.

### Attach the evidence (evidence-record)

Run `Attach the evidence` below with `mrUrl` = the url the lookup kept.
Taken is not a failure: ship's attach sends the refused files later.

## Gate `evidence` (before any capture)

One sentence above the form: what the plan asks for and what is unknown,
naming any dev-server role left waiting or unclaimed. Iterate on such a
role re-runs `dev_endpoints` twice at most (`gate-iterates`); the third
fails the stage, naming the roles.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| the domain's intake | as the domain words them; an open-ended one is free text in the form | the domain declares them |
| `source` (write-in) | **Proceed with `<source>` (Recommended)** / **Switch to local** | the data source is not local |
| `next` | **Proceed** / **Iterate here** / **Hold**, plus **Hand back** once three captures have failed; when the gate reopens from an unfixable Not drawn, **Hand back** / **Go on without this BEFORE** / **Iterate here** / **Hold** (no **Proceed**) | always |

Selection: `{"intake":{<answers>},"source":"<as confirmed>","next":"proceed|iterate|hold|handback|goon","note":"<their words or null>"}`.

Go on without this BEFORE goes to `Every planned case captured or
located?` with no BEFORE image for the case, as a ticket-link case has
none: ship captures its AFTER, and the description names the gap.

## Gate `evidence-attach` (the domain attaches here and the lookup found an open MR or PR)

One sentence above the form: what was captured and where it sits. Once a
board is drawn, open the gate with `gate_open` (gate-protocol, Structured
context): the source's `context` is a `boards@1` object whose `summary` is
that sentence and whose `boards` are every board drawn so far, each browser
case's Board ready board by its absolute path in the screenshots folder
(the home directory written out, never `~`), with `slot: before`, its
`theme` when it has one and the brief's claim as `caption`. With no board
drawn yet (a ticket image's board is drawn at Record), it opens through
`gate_ask` with the sentence as its context.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `boards` (write-in) | **Nothing here should stay private** / **Hide something first**, with free text naming the board and what shows; no option recommended, since only the human, looking at the boards, can say | a board is drawn |
| `annotations` | the proposed labels per board, each written `<TAG> \| <title> \| <description>` (browser-evidence, Labels), multi-select, all pre-selected; an image left with nothing selected goes to the waiver question (evidence record below); split `annotations-1`, ... over 4 | always |
| `attach` (write-in) | **Hand back the markdown (Recommended)** (ship attaches) / **Attach to the MR now** | always |
| `next` | **Proceed** / **Iterate here** / **Hold** | always |

Selection: `{"boards":"clear|hide|<their words>|null","annotations":[...],"attach":"now|handback"}`.

**Hide something first**, or words naming a board, is a revision of that
board as under Iterate here, adding a `redact` mark over what they name;
then this gate is asked again. A board answered `clear` here needs no
second look when `Attach the evidence` runs; a board drawn after this
answer (a ticket image's, at Record) is shown at that step's
evidence-boards gate.

For a board not yet drawn (a ticket image, a non-browser image), the kept
labels are its brief's `point at`. A browser case's board is already
drawn: kept labels that differ from its `point at` are a revision, as
under Iterate here, and an image left with nothing selected keeps its
board unless the note asks to waive it.

**Iterate here** with a drawn board the note names is a revision. The
board is not recorded yet and still sits in `~/.fast-browser/screenshots/`,
so walk browser-evidence's Revise a board steps 3 to 5 on it, then re-ask
this gate; `Record the evidence` records the revised board. A Hold at its
redaction gate (step 5) is the stage's hold (`run_hold`); a refused
confirm re-asks this gate with the output quoted.

| Thought | Reality |
|---|---|
| "I have no concrete case ids to offer, so I'll explain the gap after the form" | An open-ended intake question needs no invented options: it is free text inside the form. Prose after the form is what the gate forbids. |

## Domain rules

The domain rules below supply the capture method, the intake questions
and the attach heading. Where a domain step names a move the graph marks
STOP (an rt command or a port probe on Bash, a different data source),
the STOP node wins.

A domain that takes browser screenshots adds a `## Browser target`
section with four blocks (Reach the view, What proves a change, Captions,
Personal data) and no procedure: browser-evidence below does the capture,
the board, the gates and the bundle. Its other evidence kinds stay its own
method. On a browser case the domain's capture steps (preview, draw,
annotate) do not run; its browser target supplies facts, never steps.

{{slot:domain}}

When nothing is inlined above, the graph and the Capture section are the
whole flow. Ship adds the AFTERs to the same record.

## Browser evidence

{{include:browser-evidence}}

## Evidence record

{{include:evidence-record}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}

---- SKILL: browser-evidence ----
---
name: browser-evidence
description: "Use when a pipeline verb takes browser screenshot evidence or turns an image into a composed evidence board: the pack's browser target, the brief, delegating to the Fast Browser driver, the redaction gate, recording a board, or revising one later. Not for direct invocation."
---

# Browser evidence

Fast Browser captures pages and composes boards; this page owns that
evidence inside a run, and the pack's browser target says how to reach its
app. A board is one cropped, labelled image: this verb writes the words, the
driver measures and draws. Each board is a bundle (board, spec, captures,
and for a gated board its redaction record and crops) under one stem in
`~/.fast-browser/screenshots/`, and `evidence_record` copies the whole
bundle into the run's evidence folder, so any later session re-renders it
without a browser. A `<slug> spent?` diamond is yes when the `run_budget`
before it returns `exhausted: true` (`spent >= limit`: the count that
reaches `limit` takes yes).

A case enters this page only when the domain's fill picks a browser
screenshot for it, or when evidence-record composes a board over any other
image. Evidence that is not a browser screenshot (script output, backend
data) is captured by the domain's own method.

## The browser target

The four blocks come from the `## Browser target` section in this verb's
domain rules, or from the file those rules point at for it. A missing block
takes its default:

| Block | Feeds | Default when the block is missing |
|---|---|---|
| Reach the view | Get ready, the brief's `page:` | the URL the plan or intake gives; the developer signs in |
| What proves a change | `show`, `point at`, intake | the plan's words for the case |
| Captions | the claim and every label's wording | plain words |
| Personal data | `hide` | every personal detail on screen that is not being verified |

The pack's block wins over this page only on facts about its app, never on a
STOP below.

## Draw the boards

```dot
digraph browser_evidence {
    boards_to_draw [label="Boards to draw" shape=ellipse];
    get_ready_ran [label="Get ready already ran this stage pass?" shape=diamond];
    get_ready [label="Get ready" shape=box];
    fast_browser_doctor [label="fast-browser doctor" shape=plaintext];
    doctor_green [label="Doctor green?" shape=diamond];
    run_budget_doctor [label="run_budget {runDb, key: evidence:doctor-reds, limit: 2, stage}" shape=plaintext];
    doctor_reds_spent [label="doctor-reds spent?" shape=diamond];
    fix_doctor [label="Fix what the doctor reports" shape=box];
    fast_browser_compose_help [label="fast-browser compose --help" shape=plaintext];
    compose_usage [label="Compose usage shown?" shape=diamond];
    write_briefs [label="Write one brief per board" shape=box];
    agent_driver [label="Agent {subagent_type: fast-browser:browser-driver, model: sonnet, effort: medium, prompt: <the briefs>}" shape=plaintext];
    driver_result [label="Driver result?" shape=diamond];
    stop_draw_yourself [label="STOP: the driver captures and composes; never drive the browser, draw or place marks yourself" shape=octagon style=filled fillcolor=red fontcolor=white];
    run_budget_sign_in [label="run_budget {runDb, key: evidence:sign-in-asks, limit: 3, stage}" shape=plaintext];
    sign_in_asks_spent [label="sign-in-asks spent?" shape=diamond];
    stop_credential [label="STOP: never type or ask for a credential; only a saved login" shape=octagon style=filled fillcolor=red fontcolor=white];
    ask_sign_in [label="Ask the developer to sign in" shape=box];
    sign_in_answer [label="Sign-in answer?" shape=diamond];
    read_board [label="Read the board yourself" shape=box];
    reads_right [label="Reads right?" shape=diamond];
    run_budget_rerender [label="run_budget {runDb, key: evidence:rerenders:<stem>, limit: 3, stage}" shape=plaintext];
    rerenders_spent [label="rerenders spent?" shape=diamond];
    crops_listed [label="Crops listed?" shape=diamond];
    stop_self_confirm [label="STOP: confirming is the human's answer, never the agent's" shape=octagon style=filled fillcolor=red fontcolor=white];
    run_budget_redaction_gate [label="run_budget {runDb, key: evidence:redaction-openings:<stem>, limit: 4, stage}" shape=plaintext];
    redaction_openings_spent [label="redaction-openings spent?" shape=diamond];
    gate_evidence_redaction [label="Gate evidence-redaction (below)" shape=box];
    redaction_answer [label="Redaction answer?" shape=diamond];
    fast_browser_confirm [label="fast-browser compose --confirm ~/.fast-browser/screenshots/<stem>.spec.json" shape=plaintext];
    confirm_result [label="Confirm result?" shape=diamond];
    run_budget_confirm [label="run_budget {runDb, key: evidence:confirm-refusals:<stem>, limit: 2, stage}" shape=plaintext];
    confirm_refusals_spent [label="confirm-refusals spent?" shape=diamond];
    run_budget_redaction [label="run_budget {runDb, key: evidence:redaction-rounds:<stem>, limit: 3, stage}" shape=plaintext];
    redaction_rounds_spent [label="redaction-rounds spent?" shape=diamond];
    board_ready [label="Board ready" shape=doublecircle style=filled fillcolor=lightgreen];
    not_drawn [label="Not drawn" shape=doublecircle];
    held_redaction [label="Held at evidence-redaction" shape=doublecircle];

    boards_to_draw -> get_ready_ran;
    get_ready_ran -> get_ready [label="no"];
    get_ready_ran -> write_briefs [label="yes: the doctor was green and compose showed its usage"];
    get_ready_ran -> not_drawn [label="yes: it ended red or without compose; every board of this hand-off, that output quoted"];
    get_ready -> fast_browser_doctor -> doctor_green;
    doctor_green -> fast_browser_compose_help [label="yes"];
    doctor_green -> run_budget_doctor [label="no"];
    run_budget_doctor -> doctor_reds_spent;
    doctor_reds_spent -> fix_doctor [label="no"];
    doctor_reds_spent -> not_drawn [label="yes: every board this pass, the output quoted"];
    fix_doctor -> fast_browser_doctor;
    fast_browser_compose_help -> compose_usage;
    compose_usage -> write_briefs [label="yes"];
    compose_usage -> not_drawn [label="no: an older fast-browser first on PATH; every board this pass, the output quoted"];
    write_briefs -> agent_driver -> driver_result;
    driver_result -> read_board [label="a board"];
    driver_result -> run_budget_sign_in [label="failed: needs-login"];
    driver_result -> not_drawn [label="failed for another reason, or no driver to spawn"];
    driver_result -> stop_draw_yourself [label="tempted to capture, mark up or compose it yourself"];
    driver_result -> stop_credential [label="tempted to sign in by hand"];
    stop_draw_yourself -> agent_driver;
    stop_credential -> run_budget_sign_in;
    run_budget_sign_in -> sign_in_asks_spent;
    sign_in_asks_spent -> ask_sign_in [label="no"];
    sign_in_asks_spent -> not_drawn [label="yes: the reason quoted"];
    ask_sign_in -> sign_in_answer;
    sign_in_answer -> agent_driver [label="Logged in, retry"];
    sign_in_answer -> not_drawn [label="Leave it uncaptured"];
    read_board -> reads_right;
    reads_right -> crops_listed [label="yes"];
    reads_right -> run_budget_rerender [label="no"];
    run_budget_rerender -> rerenders_spent;
    rerenders_spent -> agent_driver [label="no: the brief and what reads wrong"];
    rerenders_spent -> not_drawn [label="yes"];
    crops_listed -> run_budget_redaction_gate [label="yes: <stem>.redactions.json lists a crop"];
    crops_listed -> board_ready [label="no: no record, or a record with no crop"];
    crops_listed -> stop_self_confirm [label="tempted to run --confirm without a yes"];
    stop_self_confirm -> run_budget_redaction_gate;
    run_budget_redaction_gate -> redaction_openings_spent;
    redaction_openings_spent -> gate_evidence_redaction [label="no"];
    redaction_openings_spent -> not_drawn [label="yes: redaction openings spent"];
    gate_evidence_redaction -> redaction_answer;
    redaction_answer -> fast_browser_confirm [label="proceed: confirm"];
    redaction_answer -> run_budget_redaction [label="proceed: widen it"];
    redaction_answer -> held_redaction [label="hold"];
    fast_browser_confirm -> confirm_result;
    confirm_result -> board_ready [label="ok"];
    confirm_result -> run_budget_confirm [label="refused"];
    run_budget_confirm -> confirm_refusals_spent;
    confirm_refusals_spent -> run_budget_redaction [label="no: re-render with the refusal quoted"];
    confirm_refusals_spent -> not_drawn [label="yes: confirm refused twice, the output quoted"];
    run_budget_redaction -> redaction_rounds_spent;
    redaction_rounds_spent -> agent_driver [label="no: the brief, and their words or the refusal"];
    redaction_rounds_spent -> not_drawn [label="yes: redaction rounds spent"];
}
```

Each hand-off from the verb is one pass and one spawn for the boards it
hands over (a verb that walks cases one at a time spawns once per case);
each returned board then walks the rest of the graph on its own. Get ready
runs once per stage pass, before the first spawn.

`Board ready` returns the board to the box that called this flow, which
records it (Record the board, below). `Not drawn` returns with the reason;
it is never a board drawn by hand. No retry can fix these reasons: the
developer left it uncaptured, the doctor stayed red, no compose on PATH,
the sign-in asks were spent, no driver to spawn, redaction rounds or
openings spent, or confirm refused twice. A failed brief (the driver's
other failures) or spent re-renders may draw on a retry. `Held at
evidence-redaction` is the verb's hold path.

## Get ready

Once per stage pass, before the first spawn:

- Start what Reach the view says must run (its servers), for this worktree
  only.
- Build each case's URL from Reach the view.
- Never reconstruct a before by reverting code on a running server.
- Run `fast-browser doctor` on Bash.

### Fix what the doctor reports

Follow the fix the doctor prints, then run it again: at most two runs in
all. Still red, every board this pass is not drawn, with the doctor's
output quoted.

`fast-browser compose --help` that does not print compose's usage (an
older `fast-browser` earlier on PATH says "expected a command") leaves
every board this pass not drawn, with that output quoted and the advice
to update Fast Browser.

## Write one brief per board

One entry per board, in plain words, with exactly these fields:

```
case: <evidence case id>
stem: <run id>-<case id>-<before|after>[-<theme>]
claim: one sentence, what this board proves (the board's title and every image's caption)
show: the region, named in words ("the job row's header")
point at: one line per label: <TAG> | <title> | <description>
hide: what Personal data names, plus every other personal detail on screen that is not being verified; never "nothing"
state: FOUND | AFTER | BEFORE → AFTER | FLOW
page: the URL, the sign-in Reach the view names, and the steps to the state (a live page), or
import: <absolute path of a saved image> from <its link> (a ticket before, or any image that is not a browser capture)
before: <the before board's folder>/<its stem>.spec.json (BEFORE → AFTER only)
```

- `stem`: the theme (`light` or `dark`) only for an image in a
  `{light, dark}` slot, so the two themes never share a stem.
- `state`: a before alone is `FOUND`; an after alone is `AFTER`; a pair
  built from the case's before bundle is `BEFORE → AFTER`; several screens
  are `FLOW` (a `steps` board).
- `point at`: the labels the operator kept at an annotations question, or
  the ones you propose from What proves a change when no such question ran.
  On a `FLOW` board, one line per step.
- `import:` an image already in the record names its `value` path. A
  ticket that embeds the before as an image: save the image and brief it
  as `import:` with the ticket link; its board is the case's before.
- `before:` names the before board's spec where the record holds it: the
  folder of that image's `annotated` path in the record's `value`.

## Labels

The pipeline's rule, stricter than the composing skill: every label carries
a tag and a description, and the description asserts the outcome in one
line. On `single` and `pair` boards a label is a mark (every mark except
`redact`); on a `steps` board a label is a step, and a mark inside a step
may carry no text. The brief says what each label carries; the driver's
composing skill decides where it goes.

- **After**: what was added that was not there before, or which bug is
  fixed that did not work before, and whether verification is complete.
  Tags `NEW`, `CHANGED`, `REMOVED`, `OK`; `PENDING` when verification is
  not complete, and the description names what is left. Examples:
  - `NEW | Retries | Added: the badge counts every retry, which it did not before. Verified.`
  - `OK | Totals row | Fixed: the export total now matches the rows; it was off by one before. Verified.`
  - `PENDING | Dark theme | Added in light theme; dark theme not verified yet.`
- **Before**: what is broken or missing, and that it was reproduced. Tags
  `ISSUE` for a bug, `PENDING` for something not built yet. Examples:
  - `ISSUE | Retries | Bug reproduced: the badge reads 0 after a retry.`
  - `PENDING | Export button | Not there before the change: no export on this page.`

A label never just repeats the board's title. The Captions block's wording
applies to the claim and to every label.

## Delegate to the driver

The `Agent` node: one call per hand-off from the verb, for the boards it
hands over, with `description: "Capture and compose evidence boards"` and
as `prompt` this text followed by the briefs:

> Follow the fast-browser:composing-evidence skill to turn each brief below into one board. For a brief with page:, open it and sign in only with a saved login for that origin (fast-browser:fast-browsing); if signing in needs a person, stop that brief and return it failed with reason needs-login; never type or ask for a credential. Follow the page's steps to the state, then capture. Name files by the brief's stem in ~/.fast-browser/screenshots/: captures <stem>.c1, <stem>.c2, and so on, numbering only the captures you take for this brief and starting at <stem>.c1 (captures copied in for before: keep their own names, so a pair's after capture is <stem>.c1), the spec <stem>.spec.json, the board <stem>.png. Use the brief's claim as the board's title, word for word. Give every label the tag and description its point at line gives, word for word, wherever the composing skill puts them for this layout. For a brief with import:, import that file as <stem>.c1 with its link as the origin. For a brief with before:, copy every capture that spec names, with its PNG, from the before's folder into ~/.fast-browser/screenshots/ unchanged and use them as the BEFORE panel; never recapture the before. Hide what hide: names. Read every board you render. Never run fast-browser compose --confirm. Close every tab you opened. Return one JSON line per brief: {"case", "board", "spec", "captures", "crops", "warnings"}, where crops is the list of redaction crop paths compose printed, or [] when it printed none, or {"case", "failed": true, "reason"}.

A re-render is the same call with that board's brief and what read wrong,
or the human's words from the redaction gate. When the `Agent` tool or that
agent type is missing, every board is not drawn, never drawn by hand.

## Ask the developer to sign in

A clarify question through gate-protocol, scope `clarify:browser-login:<n>`.
The question says the saved login could not sign in, and offers exactly two
options, each with one sentence and no free text and no Hold:

- **Logged in, retry**: the developer has signed in for this origin;
  spawn the driver again for these briefs.
- **Leave it uncaptured**: the board is not drawn.

At most two asks per stage pass (`sign-in-asks`, counted at each
needs-login before the ask).

## Read the board yourself

Read each returned PNG with the image-reading tool. It reads right when:

- the crop shows what `show` names;
- each label sits on what its `point at` line names and shows its tag and
  description (on a `steps` board, each step shows its tag and outcome);
- nothing `hide` names, and no other personal detail, is readable;
- the title is the brief's `claim`, word for word.

A wrong view (a blank page, the change missing from the page) is a Reach
the view problem: apply that block's fixes, then re-render. At most two
re-renders per board (`rerenders:<stem>`).

`Crops listed?` reads the record compose wrote,
`~/.fast-browser/screenshots/<stem>.redactions.json`, never the driver's
`crops` list: yes when that record lists one or more crops, no when there
is no record or its `redactions` is empty. An empty record (compose may
warn that a redact mark lies outside the board) means that mark hides
nothing that shows: the board has no crop to confirm, and the record stays
in the bundle as is. The upload accepts an empty record whose board hash
matches.

## Gate evidence-redaction (below)

Scope `evidence-redaction:<stage>:<n>`, where `<n>` counts this gate's
openings in this stage pass from 1; `redaction-openings:<stem>` budgets
the openings per board. Open it with `gate_open` (gate-protocol,
Structured context): the source's `context` is a `boards@1` object, so the
human sees the whole board, not only its crops.

- `summary`: one sentence asking the human to look at each board and each
  of its crops, and check that no hidden letter or digit is readable.
- `boards`: for each board with crops, the board itself, then each crop
  `<stem>.redactions.json` lists. Every entry's `path` is absolute (the
  home directory written out, never `~`) and its `case` is the brief's
  case. The board's `slot` is its stem's `before` or `after`, its `theme`
  the stem's when it has one, and its `caption` the brief's claim; each
  crop's `slot` is `crop` and its `caption` names the crop and its board
  (`Crop 1 of the badge board`).

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `redaction-<case>` | **Confirmed: nothing hidden is readable (Recommended)** / **Widen it**, with free text naming the crop and what shows | per board with crops |
| `next` | **Proceed** / **Hold** | always |

Selection: `{"redactions":{"<case>":"confirm|<their words>"},"next":"proceed|hold","note":"<their words or null>"}`.

- Confirm runs `fast-browser compose --confirm` on Bash on the spec that
  rendered the board, `~/.fast-browser/screenshots/<stem>.spec.json`, and
  only a board that passed it is recorded.
- `Confirm result?`: a confirm that exits clean is ok. The first refusal
  for a board re-renders it through the driver with the refusal quoted,
  counted against `redaction-rounds:<stem>`; a second refusal for the
  same board is not drawn, with the output quoted.
- Widen re-renders, and the new render opens this gate again.
- Every render of a gated board that a verb records, during a run or in
  a revision, passes this gate first.

## Record the board

A board ready goes into the record through evidence-record's
`evidence_record` call, which copies its whole bundle from
`~/.fast-browser/screenshots/` into the run's evidence folder:

- `annotated` is the board, `~/.fast-browser/screenshots/<stem>.png`, on
  every image the board shows, and `caption` is the brief's `claim` on each
  of them. A pair board covers both the before and the after image of its
  case.
- Each image's `path` is its own capture: `<stem>.c1.png` for a single
  board, each panel's own capture for a pair, the last step's capture for a
  steps board, and for an import the image the brief imported (its `value`
  path when the record already holds it).
- An import's link goes on the record as run-level `url`.
- The domain's own preview, if any, is never a record path.

Draw on, brief and revise from the paths in the returned `value`, never
the screenshots folder, once a board is recorded.

## Revise a board

A change that needs a recapture (a new crop, new targets) goes back
through `Draw the boards` with the edited brief. Never a browser tool
yourself. Every other change needs no browser, and works in
`~/.fast-browser/screenshots/`; the run's evidence folder is never written
by hand:

1. Find the image in the record's `value`; its `annotated` path's folder
   holds the bundle. No `<stem>.spec.json` there: say so and offer a new
   capture.
2. Bring the recorded bundle back into the screenshots folder, then clear
   its redaction files there so no stale record rides into the new render,
   each as its own command (a glob that matches nothing stops a whole zsh
   command):
   `cp <bundle folder>/<stem>.* ~/.fast-browser/screenshots/`
   then, for a pair, each capture the spec's `panels` name, with its PNG,
   from the bundle folder, then
   `find ~/.fast-browser/screenshots -maxdepth 1 \( -name '<stem>.redact-*.png' -o -name '<stem>.redactions.json' \) -delete`
3. Edit `~/.fast-browser/screenshots/<stem>.spec.json`: the wording, tags,
   marks or redactions asked for, keeping the Labels rule, and append
   `{ "asked": "<their words>", "changed": "<what you changed>" }` to its
   top-level `revisions` list (create it if absent).
4. `fast-browser compose ~/.fast-browser/screenshots/<stem>.spec.json`, and
   read the board as in Read the board yourself.
5. Gated (`<stem>.redactions.json` lists a crop): Gate evidence-redaction,
   then `fast-browser compose --confirm` on that spec. A Hold there holds
   the revision with nothing recorded; a refused confirm ends the
   revision, the output quoted.
6. Record the board (above) for every image the board shows, the claim as
   `caption` (changed or not), through evidence-record's `Record the
   evidence`. The changed bundle lands in a content folder beside the old
   one and the record moves to it.
7. Attach the evidence (evidence-record): `evidence_attach` uploads the
   changed board and rewrites the evidence section.

A revision counts its own budgets and gates: every `evidence:*` key used
while walking it (re-renders, redaction openings and rounds, confirm
refusals, and on a recapture sign-in asks and doctor reds, and
evidence-record's `redaction-repairs:<stem>` in step 7) ends in `:r<k>`,
and its redaction gate's scope is `evidence-redaction:<stage>:r<k>:<n>`,
where `<k>` is the length of the spec's `revisions` list after step 3. A
run that already spent them drawing the board still gets a fresh
allowance, and no earlier gate answer reads as this one.

---- SKILL: gate-protocol ----
---
name: gate-protocol
description: "Use when a gated pane or wrapper publishes a human decision point and carries it to an answer. Not for direct invocation; a gated verb includes this part."
disable-model-invocation: true
---

# Gate protocol

The daemon's gate registry is the single arbiter; under a run the gate
tools record the decision.

If a site's questions or a rule in the including verb ask for a move this
graph marks STOP, open the Off-script gate (below) instead.

```dot
digraph gate_protocol {
    trigger_site_reaches [label="Trigger: a site reaches its gate" shape=ellipse];
    trigger_site_opened [label="Trigger: a site opened its gate with gate_open" shape=ellipse];
    build_questions [label="Build the gate's questions and context" shape=box];
    gate_ask [label="gate_ask {questions, kind: <scope>, context?, subject?, runDb?, stage?}" shape=plaintext];
    gate_ask_result [label="gate_ask result?" shape=diamond];
    ask_under_run [label="Under a run (gate_ask fix)?" shape=diamond];
    run_budget_fix [label="run_budget {key: gate-fix:<scope>, limit: 2, stage}" shape=plaintext];
    fixed_ask_once [label="Fixed this gate_ask call once already?" shape=diamond];
    fix_refusal [label="Fix what the gate_ask refusal names" shape=box];
    daemon_down_unattended [label="Daemon down: is the gated pane unattended?" shape=diamond];
    fail_stage_at_gate [label="Under a run: fail the stage at the gate?" shape=diamond];
    run_stage_fail [label="run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" shape=plaintext];
    present_form_no_registry [label="Present the gate form with no registry" shape=box];
    no_registry_under_run [label="Under a run (no-registry answer)?" shape=diamond];
    gate_record [label="gate_record {runDb, stage, scope, shape: answers, answers, decidedBy: pane}" shape=plaintext];
    pane_action [label="paneAction?" shape=diamond];
    boards_to_open [label="A boards@1 context in an attended session, with a board not yet opened?" shape=diamond];
    open_board [label="open <board path>" shape=plaintext];
    present_pane_form [label="Present the in-pane gate form" shape=box];
    form_result [label="Gate form result?" shape=diamond];
    map_answer [label="Map the gate answer to exact option values" shape=box];
    gate_answer [label="gate_answer {id, answers, runDb?, stage?}" shape=plaintext];
    gate_answer_result [label="gate_answer result?" shape=diamond];
    remap_under_run [label="Under a run (answer remap)?" shape=diamond];
    run_budget_remap [label="run_budget {key: gate-remap:<scope>, limit: 2, stage}" shape=plaintext];
    resubmitted_once [label="Resubmitted this gate_answer once already?" shape=diamond];
    say_surface [label="Say which surface won" shape=box];
    hold_under_run [label="Holding an open gate: under a run?" shape=diamond];
    run_field_set [label="run_field_set {key: waiting-gate, value: <id>, stage}" shape=plaintext];
    rt_gate_wait [label="rt gate wait <id> as a background Bash task" shape=plaintext];
    end_turn_holding [label="End the turn: holding at gate <id>" shape=box];
    trigger_wait_finished [label="Trigger: the gate wait finished" shape=ellipse];
    trigger_human_words [label="Trigger: the human answers in words" shape=ellipse];
    trigger_doorbell [label="Trigger: a doorbell push arrives" shape=ellipse];
    gate_reconcile [label="gate_reconcile {id, runDb?, stage?}" shape=plaintext];
    reconcile_status [label="gate_reconcile status?" shape=diamond];
    write_in_to_act [label="A write-in to act on (actOnWriteIn)?" shape=diamond];
    act_write_in [label="Act on a write-in" shape=box];
    stop_no_invented_answer [label="STOP: never invent an answer or re-ask a closed gate" shape=octagon style=filled fillcolor=red fontcolor=white];
    stage_failed [label="Gate stage failed" shape=doublecircle];
    verb_ends [label="Verb ends quoting the refusal" shape=doublecircle];
    held_no_run [label="No run: held at the open gate" shape=doublecircle];
    late_signal [label="Late gate signal discarded" shape=doublecircle];
    path_ended [label="Path ended per the verb's policy" shape=doublecircle];
    write_in_new_gate [label="Write-in acted on: a new gate opens" shape=doublecircle];
    act_on_answer [label="Act on the gate answer at the site" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_site_reaches -> build_questions -> gate_ask -> gate_ask_result;
    gate_ask_result -> pane_action [label="ok"];
    gate_ask_result -> daemon_down_unattended [label="refused: daemon unreachable"];
    gate_ask_result -> ask_under_run [label="refused: other"];
    ask_under_run -> run_budget_fix [label="yes"];
    ask_under_run -> fixed_ask_once [label="no"];
    run_budget_fix -> fixed_ask_once;
    fixed_ask_once -> fix_refusal [label="no"];
    fixed_ask_once -> fail_stage_at_gate [label="yes"];
    fix_refusal -> gate_ask;
    daemon_down_unattended -> present_form_no_registry [label="no"];
    daemon_down_unattended -> fail_stage_at_gate [label="yes"];
    fail_stage_at_gate -> run_stage_fail [label="yes"];
    fail_stage_at_gate -> verb_ends [label="no"];
    run_stage_fail -> stage_failed;
    present_form_no_registry -> no_registry_under_run;
    no_registry_under_run -> gate_record [label="yes"];
    no_registry_under_run -> write_in_to_act [label="no"];
    gate_record -> write_in_to_act;
    trigger_site_opened -> pane_action;
    pane_action -> boards_to_open [label="form"];
    boards_to_open -> open_board [label="yes: the next board"];
    boards_to_open -> present_pane_form [label="no, or every board opened"];
    open_board -> boards_to_open;
    pane_action -> rt_gate_wait [label="wait"];
    present_pane_form -> form_result;
    form_result -> map_answer [label="answered"];
    form_result -> trigger_doorbell [label="dismissed" style=dashed];
    form_result -> hold_under_run [label="cancelled"];
    map_answer -> gate_answer -> gate_answer_result;
    gate_answer_result -> write_in_to_act [label="this answer won"];
    gate_answer_result -> say_surface [label="conflict: true"];
    gate_answer_result -> remap_under_run [label="refused: not an option"];
    gate_answer_result -> stop_no_invented_answer [label="refused: closed or not found"];
    remap_under_run -> run_budget_remap [label="yes"];
    remap_under_run -> resubmitted_once [label="no"];
    run_budget_remap -> resubmitted_once;
    resubmitted_once -> map_answer [label="no"];
    resubmitted_once -> hold_under_run [label="yes"];
    say_surface -> write_in_to_act;
    hold_under_run -> run_field_set [label="yes"];
    hold_under_run -> held_no_run [label="no"];
    run_field_set -> rt_gate_wait -> end_turn_holding;
    end_turn_holding -> trigger_wait_finished [style=dashed];
    trigger_wait_finished -> gate_reconcile -> reconcile_status;
    trigger_human_words -> gate_reconcile;
    trigger_doorbell -> gate_reconcile;
    reconcile_status -> late_signal [label="late: reconciled, stale, or acted on"];
    reconcile_status -> say_surface [label="answered"];
    reconcile_status -> stop_no_invented_answer [label="closed or not found"];
    reconcile_status -> map_answer [label="open, words"];
    reconcile_status -> end_turn_holding [label="open, no words"];
    reconcile_status -> daemon_down_unattended [label="refused: daemon unreachable"];
    stop_no_invented_answer -> path_ended;
    write_in_to_act -> act_write_in [label="yes"];
    write_in_to_act -> act_on_answer [label="no"];
    act_write_in -> write_in_new_gate;
}
```

### Build the gate's questions and context

Open before anything that depends on the answer. A question is `{"id",
"label", "multi", "options"}`, plus `"writeIn": true` where the site marks
`(write-in)`; `kind` is the gate's scope. Pass `subject` only for a subject
not your own.

- **Context** is a VERBATIM QUOTE of the material under decision (the
  brief's task, the plan section, the failing output), never a fresh
  summary, and never sent empty. Lay it out as Markdown that reads the same
  unrendered: a framing line, then label lines (`Important:`) with one `-`
  bullet per item. Never trim it; the daemon drops what overflows. A
  question's own `context` sets up that question alone; an option's
  `description` is its one-line why.
- **Options** are `{value, label}` objects when values are not
  human-readable; a recommended pick's `label` ends ` (Recommended)`, its
  `value` bare. In a site table headed `Options (recommended first)`, mark
  the option the table writes; a row with none, such as the stage-end
  `next`, marks none.
- **`next` values** are exactly `proceed`, `iterate`, `go-back`, `hold`,
  and `abandon` or `done` where offered; the tools read `proceed` and
  `iterate`.
- **Write-ins** go only on a decision question whose free text you can act
  on, never on `next` or a review-post, respond, doctor or pane-attention
  question.
- **At most 4 options per question**, or the whole gate goes to the wait.
  Navigation (Iterate here, Go back, Hold, Abandon) is its own `next`
  question; a longer list splits into `<id>-1`, `<id>-2`, ... read as one
  union.

### Trigger: a site opened its gate with gate_open

A site opening a structured gate calls `gate_open` itself and enters here.
Its result carries what `gate_ask`'s does (see gate_ask result?), and under
a run it has already written `gate` and, on `wait`, armed `waiting-gate`.

### gate_ask result?

**ok:** keep `id`, `paneAction`, `formContext` and `formChunks`;
`labelsTruncated` lists labels the tool shortened, so never shorten one
yourself. **`runErrors`:** the gate is open but a run write failed: quote it
in one line and carry on at `paneAction?`, never re-asking the gate or
writing that field yourself.

### Fix what the gate_ask refusal names

Fix exactly what it names (a blank context, several running runs, a bad
`runDb`) and ask again, once. Under a run each counter diamond reads
`run_budget`'s `exhausted` and a `run_budget` error counts as exhausted;
with no run, count in context. A second refusal fails the stage or ends the
verb, quoting it verbatim; never off-script, which opens through `gate_ask`
too.

### Present the gate form with no registry

Form-only, with no other gate call: the answer is the decision (no CAS),
`decidedBy` `pane`, and under a run `gate_record` records it.

### A boards@1 context in an attended session, with a board not yet opened?

A terminal form cannot show an image, so in an attended session (see
Attendance) a gate whose context is `boards@1` opens each board on Bash
before its form: `open '<path>'`, once per entry, the path as the entry
gives it. Unattended, the human answers in the console, which shows every
board as a thumbnail, so nothing opens on this machine's screen.

### Present the in-pane gate form

The `paneAction: form` branch (older sites say the
`presentation: "form"` branch). Show `formContext`, when present, in the
pane before the first chunk, then ask `formChunks` in order, one
AskUserQuestion call per chunk, rendering each chunk as given; answer once,
after the last. Dismissed: another surface answered, and the doorbell is
your next input. Cancelled: the gate stays open; never re-present it
yourself.

### Map the gate answer to exact option values

`answers` is one object keyed by question id, values per Answers are option
values (below); a question with no options takes the human's text, and
words at a held gate map the same way. On a `writeIn` question, "Other"
text with nothing ticked is `{"writeIn": "<text>"}`, never the nearest
option; beside ticks on a multi it is `{"value": [<ticks>], "note":
"<text>"}`. A refused value is remapped once, counted as in Fix what the
gate_ask refusal names, then left open for another surface.

### Say which surface won

Say in one line which answer won and from where (`decidedBy`), drop the
pane's own answer or words, and go on with the result's `answers`.

### End the turn: holding at gate <id>

Never launch a second wait for this gate. End the turn in one line,
`holding at gate <id>`. Under a run a turn ends only with `waiting-gate`
set.

### gate_reconcile status?

It re-reads the gate (up to 2 seconds), records the answer under a run and
clears `waiting-gate`; never a timed `rt gate wait` or a hand record. Late
means `alreadyReconciled`, a `skipped` naming a stale gate, or, with no run,
a gate this pane already acted on. Otherwise `answered` is the decision, and
words in hand lose to it. `open` with words: map them and let
`gate_answer`'s CAS decide; with none, end the turn again (the wait and
marker stand). A daemon-unreachable refusal takes the daemon-down branch,
quoting it.

### A write-in to act on (actOnWriteIn)?

Read `actOnWriteIn` off the tool result: it is the deliberate-pick rule. A
write-in is acted on only when `next` is absent, Proceed or Iterate here;
any other `next` (Hold, Go back, Abandon) was picked on purpose, and the
site takes it with the write-in as its note. With no tool result, apply the
rule yourself.

### Act on a write-in

Handle the gate like Iterate here: skip the site's own branch (a Proceed
beside it is the form's preselection), do what the write-in asks, reading
the whole answer set, then open a NEW gate at the same site so the human
sees the result first. One too unclear to act on goes straight to that new
gate, which asks about it.

## Attendance

Attendance comes from the invocation context, never from asking: under a
run, `spawnedBy` set means unattended; with no run, the launch instruction
says (a pane a surface launched is unattended).

## Runs integration

A site that says "run gate-protocol's Runs integration with kind `<k>` and
these questions" enters at the trigger and walks every branch. Under a run
every gate tool call passes `runDb` and the site's `stage`: the tools
bracket the gate, arm `waiting-gate` on a wait, record the answers map
(`decidedBy` the CAS winner) and clear the marker. Without them the stop
hook bounces the turn. With no run, omit both; nothing here calls a `run_*`
tool.

- **Every site is on the tools.** No host brackets a gate with
  `run_field_set {key: gate}` or records its answer with a `run_decision`
  gate@1 line: the tools record the answers map (a write-in as `{"writeIn": "<their
  words>"}` in that question's slot), and `Selection:` lines only name its
  keys. The board's wrappers run under no run, so they pass neither.
- **Review shapes.** `gate_answer` and `gate_reconcile` record nothing on a
  review gate (`respond-plan`, `respond-post`, `review-post`, scope `post`)
  unless passed `record: true`; the site records with `gate_record`.

## Off-script gate

A host STOP opens it through the graph: scope `off-script:<site>:<n>` (`n`
from 1 within the site's attempt), `context` quoting the refusal or the
line asking for the move.

| Question | Options |
|---|---|
| `action` | **Take the proposed move** (its value spells the whole move) / **Hand back** |
| `next` | **Proceed** (Recommended) / **Iterate here** / **Hold** |

Take: make exactly that move once, then continue from the node it led to.
Hand back: under a run, `run_stage {action: fail}` with the why as reason;
with no run, end the verb quoting it.

## Structured context (gate-ctx@1)

A site that opens a structured gate builds its source per
`${CLAUDE_SKILL_DIR}/structured-context.txt` and opens it with
`gate_open {kind: <scope>, source: {context: <the object>, questions}, runDb?, stage?}`:
the context is the object itself, never a string of it. A gate that asks the human about evidence boards (`evidence-attach`,
`evidence-boards`, `evidence-redaction`) carries them as a `boards@1`
context, so the console shows each board itself rather than its path.

## Answers are option values

An answer to a question with options is one of its option VALUES verbatim
(an array on a multi), never an index, label or paraphrase. Nuance rides
`{"value": ..., "note": "..."}`; an edited replacement for offered text
rides `text`, which the in-pane form never sends. The verb's act step
decides what either changes. A `writeIn: true` question may instead take
`{"writeIn": "<their words>"}` alone.

## Closed gates, Hold / Iterate

`closed` ends that path per the verb's policy. The verb handles Hold and
Iterate in the pane once the answer is recorded; a re-ask opens a NEW gate.

## Doorbell

Verify-only: it never carries the answer, only "re-read the registry",
which is `gate_reconcile`.

## Red flags

| Thought | Reality |
|---|---|
| "The doorbell says what they picked" | Call `gate_reconcile`. |

---- gate-protocol/structured-context.txt ----
# Structured context (gate-ctx@1)

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
| `findings@1` | each `findings-*` question's `context` | `findings[]`, each `id`, `severity`, `title`, `body` | `file`, `fix`, `evidence`, `disposition`, `kind` per entry |
| `carryover@1` | a review-post gate's `thread-<n>` question's `context`, one question per earlier thread, each its own question and never a chunk of one. The question is `multi` with exactly two options, `post:<thread>` and `resolve:<thread>`; an option label ending ` (recommended)` is a default. An answer is the picked values, or `{value: [...], text}` when the human edited the reply, and `text` replaces `reply` | `thread`, `round`, `call` (`fixed`, `not-fixed`, `pushback-accepted` or `pushback-rejected`), `original`, `reply` | `file` (the thread's anchor), `authorReply`, `note` |
| `skipped@1` | a review-post gate's `skipped-<n>` questions' `context`, chunked at four after the findings questions. Each question is `multi` with one option per entry, its value `restore:<id>`, joined one to one like `findings@1`. Nothing is recommended: a skipped finding comes back only when the human ticks it. Answers read back as one union across the chunks | `skipped[]`, each `id`, `round`, `severity`, `title`, `changed` (boolean: the code it pointed at moved since that round) | `file` per entry (the finding's `path:line` anchor) |
| `boards@1` | an evidence gate's `context` (`evidence-attach`, `evidence-boards`, `evidence-redaction`): every board the human must look at before it goes up | `boards[]`, each `case`, `slot` (`before`, `after`, or `crop` for a redaction crop), `path` (absolute, a `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` file, no `..`), `caption` (the board's claim) | `summary` (the sentence above the form), `theme` (`light` or `dark`) per entry |

- Enums: `severity` is `blocking | non-blocking | question | none`;
  `verdict.call` is `valid | valid-low-value | pushback |
  needs-clarification | no-ask`; `reply.kind` is `verbatim` (the exact
  text that will post), `direction` (intent only), or `none` (nothing
  posts); `verb` is `reply | fix`, and `sha` rides only a `fix`.
  `readiness` is `yes | no | with-fixes`, hyphenated; a `skipped@1`
  entry's `severity` is `critical | important | minor`, as is a
  `findings@1` entry's, and a `findings@1` entry's
  `disposition` is `new` on a re-review, or absent (`still-open` and
  `addressed-check` are read, never written);
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
  finding. `kind` is the description's `kind:<word>` word, lowercase
  and hyphenated, and absent when the finding has none. A `review@1`
  gate is structured only when EVERY `findings-*` question carries a
  `findings@1` context; otherwise it opens as prose.
- Unknown keys are ignored, and a new field never bumps the version; a
  changed meaning or type does. A missing or wrong-typed required field
  fails the WHOLE context, which then shows as raw JSON through the prose
  path: validate before opening, and omit an optional key rather than
  writing `null`.
- Size: pre-flight the whole open against the shared 8192-byte budget,
  measuring the serialized strings. Over it, drop `claim.points` from the
  longest thread first, then `verdict.note` the same way; never trim
  `reply.text`, the reply is the thing being approved.
  In a `findings@1` open, drop `evidence` from the entry where it is
  largest first, then `fix` the same way, whole fields only; never
  `title`, `file`, or `body`. Still over: prose
  contexts for the whole gate, never a half-structured one.
- The in-pane form never shows the JSON: flatten each context to prose
  for the form's question text.
- A `boards@1` entry carries paths only, never image bytes. The console
  shows each board as a thumbnail and serves only a path an open gate's
  `boards@1` names, inside the screenshots folder or the evidence folders;
  the form's prose lists each board's path, and an attended form opens
  each one first.
