---
name: shepherdr
disable-model-invocation: true
description: "Shepherd a herd of Claude Code agents via herdr panes. Use when the user wants to fan out work across multiple agents, run parallel brainstorms, delegate parallel tasks, or says 'shepherdr', 'shepherd', 'fan out', 'spawn agents', 'delegate this', 'split this across agents', 'herd this', 'run these in parallel with herdr', 'spread this across my accounts', or asks for multi-account fan-out."
type: pipeline-step
slots:
  tiering: { contract: model-tiering@1, required: true }
  strategy: { contract: execution-strategy@1, required: true }
  accounts: { contract: account-pool@1, required: false }
  domain: { contract: shepherdr-domain@1, required: false }
---

# shepherdr

You are the shepherd: a thin delegator, not a reviewer. You break work into jobs, spawn an agent per job (own herdr pane, own git worktree), present what the daemon pushes, and route small messages between the user and the herd. Model, method and account are policy, answered by the bound skills below; you are transport.

**Your context is the most expensive in the system**: everything you read is re-billed every later turn.

- Gates and the herd's chat room are pushed to you by the rt daemon; you never poll or hold a background wait. `herd_diagnose` is the only diagnosis of a silent or stuck agent; you never read pane text.
- You never read specs, plans, diffs or code. Artifact review belongs to the user or a disposable reviewer agent.
- You never merge, fix or push. Integration is itself a job.

For herdr CLI mechanics, load the `herdr` skill.

## Tiering

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{slot:tiering}}

## Strategy

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{slot:strategy}}

`accounts` may be unbound (single-account mode, handled below).

## Domain rules

`domain` is optional. A bound domain part's rules win over this engine's
default only at the **Domain hook** paragraphs below: intake, the model
floor and strategy pin, provisioning (the `Domain provisions the tree?`
branch), the Method copy, conventions, what follows a job's report, and
wrap-up. It never changes the herd contract: questions and reports still
flow through the herd tools and the gate registry.

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{slot:domain}}

When nothing is inlined above, every engine default stands as written.

## Accounts

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{slot:accounts}}

When the section above is non-empty, follow it: it owns the pool
question, the per-spawn pick (passed as `account` on `herd_spawn` or
`herd_respawn`), and the exhaustion decision tree. Accounts in use are each
job's `account` in `herd_status`, never memory. Empty: single-account mode
-- no account question, spawns omit the account, workers launch as plain
`claude`.

## Start and spawn

Walk this graph from the trigger; a move it does not show goes to the shepherd off-script gate.

```dot
digraph shepherdr_start {
    rankdir=TB;

    "Trigger: fan this work out across agents" [shape=ellipse];
    "HERDR_ENV=1 in this session?" [shape=diamond];
    "STOP: a herd needs herdr; say so" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "herd_list {}" [shape=plaintext];
    "Daemon answered?" [shape=diamond];
    "STOP: the herd rides the daemon; report its error" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Picking up an existing herd?" [shape=diamond];
    "herd_resume {herd}: pick the herd up" [shape=plaintext];
    "Does the work need a herd?" [shape=diamond];
    "Dispatched as Agent-tool subagents" [shape=doublecircle];
    "Specify the jobs" [shape=box];
    "Exactly one job, no live herd, and no domain single-worker exception?" [shape=diamond];
    "worktree_provision {repoName, branch: <job>, disposal: job}" [shape=plaintext];
    "EnterWorktree {path}" [shape=plaintext];
    "Worked here in a tree, no herd" [shape=doublecircle];
    "Ask the strategy and model per job" [shape=box];
    "Accounts section non-empty?" [shape=diamond];
    "Ask the account pool question" [shape=box];
    "Collect the repo conventions" [shape=box];
    "A herd is already live for this work?" [shape=diamond];
    "herd_start {name, repo, hidden?}" [shape=plaintext];
    "herd_brief {job, template, strategy, strategies, fill, out}" [shape=plaintext];
    "herd_brief result?" [shape=diamond];
    "Brief retries = 2?" [shape=diamond];
    "Fix what the refusal names" [shape=box];
    "STOP: fix the refusal; never copy the template or strategies file elsewhere" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Domain provisions the tree?" [shape=diamond];
    "herd_spawn {herd, job, brief, model, effort, account?}" [shape=plaintext];
    "herd_spawn {herd, job, brief, model, effort, account?, tree: <the domain's tree>}" [shape=plaintext];
    "STOP: spawn only with herd_spawn" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Spawn result?" [shape=diamond];
    "STOP: never hand-roll a tree, a pane or a launch" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Shepherd off-script gate: ask the user" [shape=box];
    "Off-script answer?" [shape=diamond];
    "Make the recorded move once" [shape=box];
    "More jobs in this batch (cap 6)?" [shape=diamond];
    "Go to the watch loop" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: fan this work out across agents" -> "HERDR_ENV=1 in this session?";
    "HERDR_ENV=1 in this session?" -> "STOP: a herd needs herdr; say so" [label="no"];
    "HERDR_ENV=1 in this session?" -> "herd_list {}" [label="yes"];
    "herd_list {}" -> "Daemon answered?";
    "Daemon answered?" -> "STOP: the herd rides the daemon; report its error" [label="no"];
    "Daemon answered?" -> "Picking up an existing herd?" [label="yes"];
    "Picking up an existing herd?" -> "herd_resume {herd}: pick the herd up" [label="yes: a fresh session"];
    "Picking up an existing herd?" -> "Does the work need a herd?" [label="no: new work"];
    "Picking up an existing herd?" -> "Specify the jobs" [label="yes: a later job for this session's live herd"];
    "herd_resume {herd}: pick the herd up" -> "Go to the watch loop";
    "Does the work need a herd?" -> "Dispatched as Agent-tool subagents" [label="no: no accounts, questions, live view or crash survival needed"];
    "Does the work need a herd?" -> "Specify the jobs" [label="yes"];
    "Specify the jobs" -> "Exactly one job, no live herd, and no domain single-worker exception?";
    "Exactly one job, no live herd, and no domain single-worker exception?" -> "worktree_provision {repoName, branch: <job>, disposal: job}" [label="yes: push back, do it here"];
    "Exactly one job, no live herd, and no domain single-worker exception?" -> "Ask the strategy and model per job" [label="no"];
    "worktree_provision {repoName, branch: <job>, disposal: job}" -> "EnterWorktree {path}";
    "EnterWorktree {path}" -> "Worked here in a tree, no herd";
    "Ask the strategy and model per job" -> "Accounts section non-empty?";
    "Accounts section non-empty?" -> "Ask the account pool question" [label="yes"];
    "Accounts section non-empty?" -> "Collect the repo conventions" [label="no: single account"];
    "Ask the account pool question" -> "Collect the repo conventions";
    "Collect the repo conventions" -> "A herd is already live for this work?";
    "A herd is already live for this work?" -> "herd_start {name, repo, hidden?}" [label="no"];
    "A herd is already live for this work?" -> "herd_brief {job, template, strategy, strategies, fill, out}" [label="yes: brief it into this herd"];
    "herd_start {name, repo, hidden?}" -> "herd_brief {job, template, strategy, strategies, fill, out}";
    "herd_brief {job, template, strategy, strategies, fill, out}" -> "herd_brief result?";
    "herd_brief result?" -> "Domain provisions the tree?" [label="ok: the out path is the brief"];
    "herd_brief result?" -> "Brief retries = 2?" [label="refused"];
    "herd_brief result?" -> "STOP: fix the refusal; never copy the template or strategies file elsewhere" [label="tempted to copy the template past a root refusal"];
    "STOP: fix the refusal; never copy the template or strategies file elsewhere" -> "Fix what the refusal names";
    "Brief retries = 2?" -> "Fix what the refusal names" [label="no"];
    "Brief retries = 2?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "Fix what the refusal names" -> "herd_brief {job, template, strategy, strategies, fill, out}";
    "Domain provisions the tree?" -> "herd_spawn {herd, job, brief, model, effort, account?}" [label="no: herd_spawn provisions"];
    "Domain provisions the tree?" -> "herd_spawn {herd, job, brief, model, effort, account?, tree: <the domain's tree>}" [label="yes: its tree, by name"];
    "Domain provisions the tree?" -> "STOP: spawn only with herd_spawn" [label="tempted to spawn from the shell"];
    "STOP: spawn only with herd_spawn" -> "herd_spawn {herd, job, brief, model, effort, account?, tree: <the domain's tree>}";
    "herd_spawn {herd, job, brief, model, effort, account?}" -> "Spawn result?";
    "herd_spawn {herd, job, brief, model, effort, account?, tree: <the domain's tree>}" -> "Spawn result?";
    "Spawn result?" -> "More jobs in this batch (cap 6)?" [label="ok"];
    "Spawn result?" -> "Shepherd off-script gate: ask the user" [label="error: quote it"];
    "Spawn result?" -> "STOP: never hand-roll a tree, a pane or a launch" [label="tempted to build the tree or pane yourself"];
    "STOP: never hand-roll a tree, a pane or a launch" -> "Shepherd off-script gate: ask the user";
    "Shepherd off-script gate: ask the user" -> "Off-script answer?";
    "Off-script answer?" -> "Make the recorded move once" [label="take the proposed move"];
    "Off-script answer?" -> "More jobs in this batch (cap 6)?" [label="hand back or hold: skip this job"];
    "Make the recorded move once" -> "More jobs in this batch (cap 6)?";
    "More jobs in this batch (cap 6)?" -> "herd_brief {job, template, strategy, strategies, fill, out}" [label="yes: the next job, one at a time"];
    "More jobs in this batch (cap 6)?" -> "Go to the watch loop" [label="no"];
}
```

### Specify the jobs

**Domain hook -- intake.** Unbound: the jobs are what the user hands you;
invoked with nothing, ask what to fan out. A bound domain part may define a
default intake for the empty invocation (a ticket queue, a board column):
one job per item it yields.

Decompose into independent jobs:

- Disjoint file ownership per job -- the write fence.
- Item-coded task lists (A1, A2...) where the strategy produces items, so reports check at a glance.
- A deliverable that needs no other job's output. Sequential work (B needs A) joins later: after A's report, walk the start graph and brief B into this session's live herd as a later job; never start a second herd.

An **execution job** is fully specified: brief in, report out, no
questions. A **design job** expects questions mid-run; N design jobs are N
parallel brainstorms. Unscoped work the user wants scoped first, brainstorm
with them directly (no pane, no relay), then specify execution jobs.

**Does the work need a herd?** Only for account distribution, mid-flight
questions or milestone gates, live visibility, or crash survival; without
those, say so and dispatch Agent-tool subagents.

**Exactly one job, no live herd?** Push back ("this is probably not the
right skill for this") and do it yourself in the main pane; one agent
behind a relay is pure overhead. `worktree_provision` and `EnterWorktree`
keep it out of the user's checkout, and the delegator rules then do not
apply. Apply a bound domain part's single-worker exception if it names one.
A later job for a live herd is never this case.

### Ask the strategy and model per job

Strategy predicts the work shape, and the shape predicts the tier: one
choice. Recommend per job (strategy from the bound strategy table, model
from the tier table), then ask one AskUserQuestion per job (single choice,
up to 4 jobs per call): the recommendation first, marked "(Recommended)",
then 2-3 alternates across the tiers.

A half is fixed when every option would carry it: a completed plan
(`from-plan`) or spec (`from-spec`), or a domain pin. State it once in the
question ("Runtime job (6-task plan in hand, so from-plan): which model?")
and label only the open half ("opus" / "fable" / "sonnet"); with both
open, labels carry both ("superpowers, opus" / "direct-tdd, sonnet").

**Effort rides with the model, not as a question.** Take it from the tier
table's row, or its escalation rule on a respawn, unless the user names a
reason. Every `herd_spawn` passes `model` and `effort`, or it launches on
defaults and defeats tiering. A respawn inherits model, effort
and account from the job row; pass one only to change it.

**Domain hook -- model floor and strategy pin.** Unbound: both halves are
open. A bound domain part may set a model floor for a class of work and pin
the strategy (its method skill is the brief's Method); the recommendation
starts at the floor, the pin is a fixed half, and a spawn below the floor
is wrong.

### Ask the account pool question

Ask it once per herd, after the models are chosen: per-model pools
hide headroom until the model mix is known. A later job for a live herd keeps the herd's pool answer.

### Collect the repo conventions

A herd pane is a real `claude` session in a git worktree: user-level
plugins and tracked repo conventions load, untracked state (`node_modules`,
`.env`, `settings.local.json`) does not, and a gate skill nobody names may
never load. Collect conventions from the workflow rules loaded in your
session and the repo's convention docs (CLAUDE.md, AGENTS.md,
CONTRIBUTING); this read is orchestration input, not artifact review.

Each brief's `Repo conventions` section carries exactly three things: the
gate skills that bind the job, by absolute path; task A0 for untracked
state (dependency install, env or secrets sync); and the branch, which is
the job name (with ticket-derived branches, resolve the ticket first and
name the job for it). The shipping process (target branch, MR conventions,
CI) goes in the integration job's brief; the rest lives in the skill that
owns it.

**Domain hook -- conventions.** Unbound: as above. When the bound domain
part's method skill owns the conventions, `Repo conventions` names only the
branch; a brief that restates gates, process or evidence competes with the
worker's skill chain.

### Fix what the refusal names

- **An unfilled marker**: the refusal lists the leftover slots; add a `fill` entry for each.
- **A path outside every root**: the loaded skill dir is stale (the plugin updated mid-session) or a dev checkout. Run `/reload-plugins` (in a herdr pane, queue it on yourself with `rt pane send self --text "/reload-plugins" --then "Continue: ..."` and end the turn), then retry from the reloaded base directory.
- **Any other refusal**: correct the input it names and retry.

Never copy the template or the strategies file elsewhere to get past a
refusal; the retry budget hands a stubborn one to the off-script gate.

### Shepherd off-script gate: ask the user

Every unresolved refusal and spent budget, in all three graphs, lands
here. Ask with AskUserQuestion: one sentence quoting the refusal or naming
the budget, then three options:

- **Take the proposed move**: its value spells the move in full (the exact tool call or Bash line), so the answer is the record.
- **Hand it back to you**: the user deals with it.
- **Hold**: nothing moves on this job for now.

"Hand it back" and "Hold" return to the gate's loop: here the job is
skipped and the batch goes on; in the other two graphs you end the turn.
One job's spent budget never ends the herd.

A `... spent?` diamond reads the daemon budget fetched in this decision,
never a count from memory. A
`... = 2?` diamond (`Brief retries = 2?`, `Answer retries = 2?`) is a
same-turn retry count kept in your head, since no daemon budget covers it;
it answers yes once two retries have run.

### Make the recorded move once

Make exactly the move the user took, once, as its value spells it. If it
fails too, that is a new off-script gate, never a retry of your own.

## What the start graph cannot show

**The herd contract.** Every herd is an rt daemon registry row plus one
chat room and one gate subscription, all made by `herd_start`. Workers ask
through gates (`herd_ask`, `herd_milestone`) and report into the room,
where the daemon also posts `<job> blocked` and `<job> exited`; every call
records job state. Talk to a worker with `chat_dm {to: <the job's handle
from herd_status>, body}`. `herd_status {herd}` is the whole picture; there
is no herd DB or script.

**Resuming.** `herd_resume {herd}` (ids from `herd_list`) re-points the
gate subscription here, continues the shepherd's chat identity with its DMs
and unread (a plain sign-in starts an empty one), and returns the open
gates, the unread count and every job's state (a pre-identity herd may
resume on a fresh identity, leaving old DMs behind). There is no other
resume step; handle each
unread line as if new (a report goes to the lanes graph).

**Brief assembly.** Every brief is assembled by `herd_brief`, never
composed. Its inputs:

- `template`: `${CLAUDE_SKILL_DIR}/references/job-template.md`
- `strategy`: the job's chosen strategy name
- `strategies`: `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md`
- `fill`: one `"<slot>=<value>"` string per slot
- `out`: an absolute path in this session's scratchpad, one file per job

`${CLAUDE_SKILL_DIR}` is the absolute directory this skill loaded from;
both paths come from it alone (an installed plugin or pack root). The tool copies the template
and the named strategy body (into `## Method`) verbatim and fills the
`<angle-bracket>` slots from `fill`; an unfilled marker is a refusal
listing the leftovers. `<shepherd handle>` and `<shepherd id>` pass through for
`herd_spawn` to fill from the herd row; never `fill` them. The `out` path
is the brief.

**Domain hook -- the Method copy.** Unbound: as written. A bound domain
part may supply `## Method` (its team's pipeline skill): pass `methodFile:
<path>` instead of `strategy`/`strategies` (mutually exclusive); the
strategies-file slots go unfilled, the report contract is that skill's, and
the rest of the template and both channels stay as they are.

The Method slots are `fill` entries too: `<question-file>`/`<report-file>`
point to the brief's 'Asking the user a question' / 'Publishing a report'
sections (draft path `.superpowers/report-draft.md`); `<strategies-file>`
is `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md`;
`<strategy-skill-file>` is `${CLAUDE_SKILL_DIR}/SKILL.md`, whose strategy
part carries the strategy TABLE.

**Hidden mode.** For a herd out of sight ("invisible", "background",
"headless", "don't clutter my UI"), pass `hidden: true` to `herd_start`.
Worker panes live on the daemon's shared background herdr server (session
`bg`) as `bg:<pane>` refs; nothing else changes. `herd_attend {job, herd}`
opens a tab on one worker (the user detaches with `ctrl+b q`; close the
tab afterwards). At wrap-up, offer the Bash command
`rt herd stop --hidden` (no tool runs it); never run it unprompted. The <!-- mcp-lint: allow -->
server is shared: the stop refuses while ANY background claim is live
(another herd, a runner board, an `agent --bg` pane), naming the owners;
report the refusal, never work around it.

**The domain-provisioned spawn.** Unbound, `herd_spawn` provisions the
tree itself (branch `<job>`, disposal `job`). A domain part that owns
provisioning makes the tree its own way and passes its registered name
(the `tree` that `worktree_provision` returns), never a directory, as
`tree`. `herd_spawn` admits only an rt ephemeral tree in state `claimed`
and refuses any other with its kind and state; that refusal goes to the
off-script gate.

**Spawn facts.**

- `herd_start {name: <short-name>, repo, hidden?}` runs once per herd; `repo` is the checkout path, identity or label. Every herd pane is a tab in the one workspace it returns; the user's own is never touched.
- `job` is the job name (lowercase, `[a-z][a-z0-9_-]{0,31}`), also the worker's tab label and chat display name. Each spawn mints a fresh chat identity, so a reused name never inherits an earlier herd's DMs. `herd_status` shows `handle` (the identity id, `chat_dm`'s `to`) and `handleName` (the display name; `<job>-2` while another live session holds the name); a herd tool's `job` field takes the job name. `brief` is the absolute `out` path.
- `herd_spawn` provisions the tree, launches claude with the brief, signs the worker into the room, accepts the trust dialog and records the job. A cold provision (no on-deck tree ready) can take minutes; tell the user.
- **Stagger 4+ spawns**: spawn one, confirm it returned, spawn the next.
- Agents never work in the user's checkout; skip isolation only for read-only jobs or when the user says to work in place. The worker's directory must be a **linked worktree**, which `herd_spawn` guarantees.

## The watch loop

After the spawns, do nothing until something arrives.

```dot
digraph shepherdr_watch {
    rankdir=TB;

    "Trigger: the herd is spawned or resumed" [shape=ellipse];
    "End the turn until something arrives" [shape=box];
    "Next move while the turn is ended?" [shape=diamond];
    "STOP: the gates and the room report progress; never read a pane for it" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: nothing arms; no background wait, watcher or sweep" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Something arrives" [shape=ellipse];
    "What arrived?" [shape=diamond];
    "STOP: answer from the registry, never from the push text" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "herd_gates {herd}: the gate push" [shape=plaintext];
    "herd_resume {herd}: after a relaunch" [shape=plaintext];
    "Open gates returned?" [shape=diamond];
    "Answer literally in the brief you wrote?" [shape=diamond];
    "Present the open gates" [shape=box];
    "herd_gate_park {herd, gate}" [shape=plaintext];
    "herd_gate_answer {herd, gate, answers}" [shape=plaintext];
    "Answer recorded?" [shape=diamond];
    "Say which answer won, in one line" [shape=box];
    "Answer retries = 2?" [shape=diamond];
    "Fix the answers: each value verbatim" [shape=box];
    "Spawn a reviewer chosen?" [shape=diamond];
    "herd_diagnose {herd, job}: the reviewer budget" [shape=plaintext];
    "Reviewer rounds on this milestone spent?" [shape=diamond];
    "herd_spawn {herd, job: review-<job>, brief: <review brief>, tree: <the job's tree>, disposable: true, model, effort, account?}" [shape=plaintext];
    "herd_diagnose {herd, job}: the blocked job" [shape=plaintext];
    "Blocked notices for this job spent?" [shape=diamond];
    "herd_diagnose {herd, job}: the unconsumed lane" [shape=plaintext];
    "What does the diagnosis say?" [shape=diamond];
    "STOP: herd_diagnose reads the pane; never peek it yourself" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "herd_gates {herd}: the diagnosed job's gate" [shape=plaintext];
    "Nudges for this gate spent?" [shape=diamond];
    "herd_nudge {herd, job, gate}" [shape=plaintext];
    "Nudge delivered?" [shape=diamond];
    "Smart-distribute pool in use?" [shape=diamond];
    "Accounts section non-empty?" [shape=diamond];
    "Pick the account per the accounts rules" [shape=box];
    "Report the stall to the user" [shape=box];
    "Ask: attend or respawn" [shape=box];
    "herd_attend {job, herd}: the parked dialog" [shape=plaintext];
    "herd_attend {job, herd}: a human is needed" [shape=plaintext];
    "Report the crash with its job and pane" [shape=box];
    "chat_dm {to: <job handle>, body: the ruling or findings}" [shape=plaintext];
    "Ask: let them finish, kill and respawn, or hold" [shape=box];
    "herd_close {job, herd}: killed for new scope" [shape=plaintext];
    "herd_brief {job, template, strategy, strategies, fill, out}: the new brief" [shape=plaintext];
    "herd_diagnose {herd, job}: the respawn budget" [shape=plaintext];
    "Respawns of this job spent?" [shape=diamond];
    "STOP: a respawn goes through herd_respawn" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "herd_respawn {herd, job, brief?, model?, effort?, account?}" [shape=plaintext];
    "Respawn result?" [shape=diamond];
    "Shepherd off-script gate: ask the user" [shape=box];
    "Off-script answer?" [shape=diamond];
    "Make the recorded move once" [shape=box];
    "Go to lanes and wrap-up" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: the herd is spawned or resumed" -> "End the turn until something arrives";
    "End the turn until something arrives" -> "Next move while the turn is ended?";
    "Next move while the turn is ended?" -> "Something arrives" [label="none: the daemon pushes the next arrival" style=dashed];
    "Next move while the turn is ended?" -> "STOP: the gates and the room report progress; never read a pane for it" [label="tempted to read a pane to see how it goes"];
    "Next move while the turn is ended?" -> "STOP: nothing arms; no background wait, watcher or sweep" [label="tempted to arm a wait or a sweep"];
    "STOP: the gates and the room report progress; never read a pane for it" -> "End the turn until something arrives";
    "STOP: nothing arms; no background wait, watcher or sweep" -> "End the turn until something arrives";
    "Something arrives" -> "What arrived?";
    "What arrived?" -> "herd_gates {herd}: the gate push" [label="a gate push"];
    "What arrived?" -> "STOP: answer from the registry, never from the push text" [label="tempted to answer from the push text"];
    "STOP: answer from the registry, never from the push text" -> "herd_gates {herd}: the gate push";
    "What arrived?" -> "End the turn until something arrives" [label="a milestone announcement: its gate push wakes you"];
    "What arrived?" -> "herd_resume {herd}: after a relaunch" [label="a relaunch or compaction"];
    "What arrived?" -> "herd_diagnose {herd, job}: the unconsumed lane" [label="gate <id> UNCONSUMED in herd_status, or the watchdog's answered-and-unconsumed line"];
    "What arrived?" -> "herd_diagnose {herd, job}: the blocked job" [label="<job> blocked"];
    "What arrived?" -> "Report the crash with its job and pane" [label="<job> exited"];
    "What arrived?" -> "chat_dm {to: <job handle>, body: the ruling or findings}" [label="a ruling or findings for one worker"];
    "What arrived?" -> "Ask: let them finish, kill and respawn, or hold" [label="the user redirects scope"];
    "What arrived?" -> "herd_diagnose {herd, job}: the respawn budget" [label="the user asks for a respawn"];
    "What arrived?" -> "herd_gate_answer {herd, gate, answers}" [label="the user answers a parked gate"];
    "What arrived?" -> "Go to lanes and wrap-up" [label="a report line, or a nag about a done job's open pane"];
    "herd_gates {herd}: the gate push" -> "Open gates returned?";
    "herd_resume {herd}: after a relaunch" -> "Open gates returned?";
    "herd_gates {herd}: the diagnosed job's gate" -> "Open gates returned?";
    "Open gates returned?" -> "Answer literally in the brief you wrote?" [label="yes"];
    "Open gates returned?" -> "End the turn until something arrives" [label="none: a stale id is normal"];
    "Answer literally in the brief you wrote?" -> "herd_gate_answer {herd, gate, answers}" [label="yes"];
    "Answer literally in the brief you wrote?" -> "Present the open gates" [label="no"];
    "Present the open gates" -> "herd_gate_answer {herd, gate, answers}" [label="the user answers"];
    "Present the open gates" -> "herd_gate_park {herd, gate}" [label="the user parks it"];
    "herd_gate_park {herd, gate}" -> "End the turn until something arrives";
    "herd_gate_answer {herd, gate, answers}" -> "Answer recorded?";
    "Answer recorded?" -> "Spawn a reviewer chosen?" [label="recorded"];
    "Answer recorded?" -> "Say which answer won, in one line" [label="conflict: another surface answered first"];
    "Answer recorded?" -> "Answer retries = 2?" [label="refused: invalid values"];
    "Answer recorded?" -> "Shepherd off-script gate: ask the user" [label="error: closed, not this herd's, or gone"];
    "Say which answer won, in one line" -> "End the turn until something arrives";
    "Answer retries = 2?" -> "Fix the answers: each value verbatim" [label="no"];
    "Answer retries = 2?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "Fix the answers: each value verbatim" -> "herd_gate_answer {herd, gate, answers}";
    "Spawn a reviewer chosen?" -> "End the turn until something arrives" [label="no"];
    "Spawn a reviewer chosen?" -> "herd_diagnose {herd, job}: the reviewer budget" [label="yes"];
    "herd_diagnose {herd, job}: the reviewer budget" -> "Reviewer rounds on this milestone spent?";
    "Reviewer rounds on this milestone spent?" -> "herd_spawn {herd, job: review-<job>, brief: <review brief>, tree: <the job's tree>, disposable: true, model, effort, account?}" [label="no"];
    "Reviewer rounds on this milestone spent?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "herd_spawn {herd, job: review-<job>, brief: <review brief>, tree: <the job's tree>, disposable: true, model, effort, account?}" -> "End the turn until something arrives";
    "herd_diagnose {herd, job}: the blocked job" -> "Blocked notices for this job spent?";
    "Blocked notices for this job spent?" -> "What does the diagnosis say?" [label="no"];
    "Blocked notices for this job spent?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "herd_diagnose {herd, job}: the unconsumed lane" -> "What does the diagnosis say?";
    "What does the diagnosis say?" -> "herd_gates {herd}: the diagnosed job's gate" [label="at-gate"];
    "What does the diagnosis say?" -> "Nudges for this gate spent?" [label="idle, and the arrival named an answered gate it has not read"];
    "What does the diagnosis say?" -> "End the turn until something arrives" [label="working, or idle with nothing waiting"];
    "What does the diagnosis say?" -> "Accounts section non-empty?" [label="rate-limited"];
    "What does the diagnosis say?" -> "Smart-distribute pool in use?" [label="dead, gone, no-pane or login-expired"];
    "What does the diagnosis say?" -> "Ask: attend or respawn" [label="parked-modal"];
    "What does the diagnosis say?" -> "herd_attend {job, herd}: a human is needed" [label="needs-human"];
    "What does the diagnosis say?" -> "STOP: herd_diagnose reads the pane; never peek it yourself" [label="tempted to peek the pane or send a key"];
    "STOP: herd_diagnose reads the pane; never peek it yourself" -> "Shepherd off-script gate: ask the user";
    "Nudges for this gate spent?" -> "herd_nudge {herd, job, gate}" [label="no"];
    "Nudges for this gate spent?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "herd_nudge {herd, job, gate}" -> "Nudge delivered?";
    "Nudge delivered?" -> "End the turn until something arrives" [label="delivered"];
    "Nudge delivered?" -> "End the turn until something arrives" [label="refused: already consumed, the worker read it"];
    "Nudge delivered?" -> "Shepherd off-script gate: ask the user" [label="needsHuman, or another refusal: quote it"];
    "Smart-distribute pool in use?" -> "Pick the account per the accounts rules" [label="yes"];
    "Smart-distribute pool in use?" -> "Respawns of this job spent?" [label="no, and not login-expired: relaunch on the same account"];
    "Smart-distribute pool in use?" -> "Report the stall to the user" [label="no, and login-expired: only a login fixes it"];
    "Accounts section non-empty?" -> "Pick the account per the accounts rules" [label="yes"];
    "Accounts section non-empty?" -> "Report the stall to the user" [label="no: nowhere else to launch"];
    "Pick the account per the accounts rules" -> "Respawns of this job spent?" [label="an account picked"];
    "Pick the account per the accounts rules" -> "End the turn until something arrives" [label="wait or abandon"];
    "Report the stall to the user" -> "End the turn until something arrives";
    "Ask: attend or respawn" -> "herd_attend {job, herd}: the parked dialog" [label="attend"];
    "Ask: attend or respawn" -> "Respawns of this job spent?" [label="respawn"];
    "herd_attend {job, herd}: the parked dialog" -> "End the turn until something arrives";
    "herd_attend {job, herd}: a human is needed" -> "End the turn until something arrives";
    "Report the crash with its job and pane" -> "End the turn until something arrives";
    "chat_dm {to: <job handle>, body: the ruling or findings}" -> "End the turn until something arrives";
    "Ask: let them finish, kill and respawn, or hold" -> "End the turn until something arrives" [label="let them finish, or hold"];
    "Ask: let them finish, kill and respawn, or hold" -> "herd_close {job, herd}: killed for new scope" [label="kill and respawn"];
    "herd_close {job, herd}: killed for new scope" -> "herd_brief {job, template, strategy, strategies, fill, out}: the new brief";
    "herd_brief {job, template, strategy, strategies, fill, out}: the new brief" -> "herd_diagnose {herd, job}: the respawn budget";
    "herd_diagnose {herd, job}: the respawn budget" -> "Respawns of this job spent?";
    "Respawns of this job spent?" -> "herd_respawn {herd, job, brief?, model?, effort?, account?}" [label="no"];
    "Respawns of this job spent?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "Respawns of this job spent?" -> "STOP: a respawn goes through herd_respawn" [label="tempted to respawn with herd_spawn or the shell"];
    "STOP: a respawn goes through herd_respawn" -> "herd_respawn {herd, job, brief?, model?, effort?, account?}";
    "herd_respawn {herd, job, brief?, model?, effort?, account?}" -> "Respawn result?";
    "Respawn result?" -> "End the turn until something arrives" [label="ok: announce it"];
    "Respawn result?" -> "Shepherd off-script gate: ask the user" [label="error: quote it"];
    "Shepherd off-script gate: ask the user" -> "Off-script answer?";
    "Off-script answer?" -> "Make the recorded move once" [label="take the proposed move"];
    "Off-script answer?" -> "End the turn until something arrives" [label="hand back or hold"];
    "Make the recorded move once" -> "End the turn until something arrives";
}
```

### End the turn until something arrives

The daemon pushes gates and room lines; nothing arms, and you never read a
pane or scrollback. Your room posts
deliver as `@here` and wake every worker, so a question for one worker is a
DM.

### Present the open gates

Present up to 4 open gates in one AskUserQuestion call. Options are the
gate's `label` (else text) and `description`, the recommendation first,
never reworded, merged or reordered.

- A herd question gate (`kind: question`, subject `herd:<id>/<job>`): one sentence naming the job and what it needs decided, then the form with the gate question's `label`.
- Any other gate: its full context.
- A milestone gate: **Approve** / **Revise** / **Spawn a reviewer**; Revise collects feedback (or "see pane") into `note`.

Submit each `value` verbatim; free text rides the `note`.
`herd_gate_answer` records `by: shepherd`. Answer for the agent only when
the answer is literally in the brief you wrote. A human answer fitting no
option goes as `{"writeIn": "<their words>"}` if the question was opened
with `writeIn`, else ask them to pick. When the user parks a gate,
`herd_gate_park` takes it off the open list; it stays answerable with
`herd_gate_answer` until answered or closed. A later answer takes its id
from the job's `herd_status` row: `lastGate`, with `lastGateStatus:
parked`; relay it verbatim.

### Say which answer won, in one line

Name `winner.answers` and `winner.by`; never re-ask.

### Fix the answers: each value verbatim

Resend each value from `invalid[].validValues`, verbatim.

### Pick the account per the accounts rules

The Accounts section decides whether to respawn now or ask first; its
pick is the `account` on `herd_respawn`. Announce the respawn.

### Report the stall to the user

Single-account mode, or an expired login with no pool (only the user's
`/login` fixes it). Name the job, its pane and the verdict.

### Ask: attend or respawn

A dialog the watchdog could not clear parks the job (`stuck-at-modal`).
**Attend** opens the pane for the user; **Respawn** reuses the stored
brief.

### Report the crash with its job and pane

The pane died with the job live. Tell the user both; never respawn
silently.

### Ask: let them finish, kill and respawn, or hold

One sentence naming the running agents, then the bare three options:
**Let them finish** (recommended) / **Kill and respawn with the new
briefs** / **Hold**. No restated heading, no per-option descriptions.

## What the watch loop cannot show

- **The push is transport.** A gate push is one line, `[gate] <id> is now open; re-read the gate registry.`, carrying only an id. Its arrival proves the daemon, the subscription and the herd; the `herd_gates` read is the verification, made first. `herd_gates` defaults to `HERD_ID` or the sole active herd and also returns open pipeline-run gates in a herd job's worktree. Room lines arrive the same way (`<job> #<n>: <body>` a report, `<job> #<n>: milestone: <artifact>` a milestone). A stale id or an unrelated room line is normal, never a reason to reach for another command or distrust the push.
- **Diagnosis and nudges.** `herd_diagnose {herd, job}` has the daemon read the pane and returns a verdict and budgets, never pane text. An `UNCONSUMED` gate in `herd_status`, or the watchdog's "answered Nm ago and unconsumed" line, is the arrival for a nudge; the nudge keys on the UNCONSUMED arrival's gate, never `lastGate.consumed`, which reads null for a gate the daemon does not track. `herd_nudge` sends a DM, then a typed line only into an idle pane with no form open, else `needsHuman`. No tool presses keys, and neither do you. A hidden (`bg:`) pane reaches the user only through `herd_attend {job, herd}`.
- **The disposable reviewer.** Its spawn is `herd_spawn {tree}` into the job's own tree (a guest if another job holds it; the tree stays the host's); the result's `reviewerRound` echoes the ticked budget. Its brief reads the artifact, DMs findings, and reports a verdict; the daemon closes its pane. You never read the artifact. With the Accounts section non-empty it takes a per-spawn pick.
- **A bare pane form.** A worker pane showing a structured question with no gate behind it (`herd_gates` returns nothing for it) is the banned bare pane-local form, unreachable from every channel. Flag it to the user; never answer it yourself. Covered panes deny it at source through the launch-injected gate-fork hook, so seeing one means the pane is uncovered or its daemon was unreachable.
- **Progress.** When the user asks for progress, and after a job's report while other jobs still run, show the view from mattstack:herd-progress.

**Budgets.** The daemon counts; you decide. A `... spent?` diamond reads
`{used, cap, spent}` in this decision, before its move; a user's answer in
between does not stale it, since `respawns`, `nudges` and `reviewerRounds`
tick only on your own moves and a new notice is a new arrival with its own
read. `spent` (used >= cap) answers yes; no tool refuses on a spent
budget, so the diamond is the only guard.

| Budget | Read from | Before |
|---|---|---|
| `respawns` | `herd_diagnose` `budgets.respawns` | `herd_respawn` |
| `blockedNotices` | `herd_diagnose` `budgets.blockedNotices` | routing a blocked notice |
| `nudges[gate]` | `herd_diagnose` `budgets.nudges[<gate>]` (absent = unused) | `herd_nudge` |
| `reviewerRounds[artifact]` | `herd_diagnose` on the host job, `budgets.reviewerRounds[<artifact>]` (the milestone line's artifact; absent = unused) | the reviewer `herd_spawn` |
| `unmergedReports` | `herd_lanes` row's `unmergedReports` | the "measured merge state" DM |

**The respawn.** `herd_respawn {herd, job, brief?, model?, effort?, account?}` never
provisions, closes the old pane, relaunches in the job's tree on the stored
brief unless `brief` is new, and keeps the job's model, effort and account
unless passed. The old session's open and parked gates close as abandoned so the new
worker re-asks; answered ones are marked consumed.

## Lanes and wrap-up

```dot
digraph shepherdr_lanes {
    rankdir=TB;

    "Trigger: a job's report, or a nag about a done job's open pane" [shape=ellipse];
    "herd_lanes {herd}: the report's lanes" [shape=plaintext];
    "Drift outside the fence, or a file two jobs changed?" [shape=diamond];
    "Flag the drift or collision to the user" [shape=box];
    "Relay only what you measured" [shape=box];
    "herd_status {herd}: the status table" [shape=plaintext];
    "Does the report claim a merge?" [shape=diamond];
    "Who merges this lane?" [shape=diamond];
    "STOP: never merge, fix or push by hand; route by who merges" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Every lane job done?" [shape=diamond];
    "Integration job spawned already?" [shape=diamond];
    "Ask the integration job's strategy and model" [shape=box];
    "herd_brief {job: integration-<n>, template, strategy, strategies, fill, out}" [shape=plaintext];
    "herd_spawn {herd, job: integration-<n>, brief, model, effort, account?}" [shape=plaintext];
    "chat_dm {to: <job handle>, body: ship through your skill chain}" [shape=plaintext];
    "Gate: merge this lane?" [shape=box];
    "Forge?" [shape=diamond];
    "mr_merge {mrUrl}" [shape=plaintext];
    "gh pr merge <pr>" [shape=plaintext];
    "herd_lanes {herd, job}: after the merge call" [shape=plaintext];
    "Merged on the repo?" [shape=diamond];
    "Did this lane claim the merge itself?" [shape=diamond];
    "Unmerged reports for this lane spent?" [shape=diamond];
    "chat_dm {to: <job handle>, body: the measured merge state}" [shape=plaintext];
    "Flip the lane's ticket, when it has one" [shape=box];
    "herd_close {job, herd}: the merged lane" [shape=plaintext];
    "More merged lanes to close?" [shape=diamond];
    "Every job done and closed?" [shape=diamond];
    "Show the status table" [shape=box];
    "Gate wrap-up: the form contract" [shape=box];
    "Any panes closing or trees disposed?" [shape=diamond];
    "worktree_stop_holders {repoName, tree}" [shape=plaintext];
    "More closing trees to stop?" [shape=diamond];
    "Measure what still runs" [shape=box];
    "herd_wrap_up {herd, closePanes, dispose, deleteJobDirs, archiveRoom}" [shape=plaintext];
    "herd_wrap_up refused?" [shape=diamond];
    "Report the refusal in the guard's words" [shape=box];
    "Shepherd off-script gate: ask the user" [shape=box];
    "Off-script answer?" [shape=diamond];
    "Make the recorded move once" [shape=box];
    "Back to the watch loop: end the turn" [shape=doublecircle];
    "Herd held" [shape=doublecircle];
    "Herd wrapped up, refusal reported" [shape=doublecircle];
    "Herd wrapped up" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a job's report, or a nag about a done job's open pane" -> "herd_lanes {herd}: the report's lanes";
    "herd_lanes {herd}: the report's lanes" -> "Drift outside the fence, or a file two jobs changed?";
    "Drift outside the fence, or a file two jobs changed?" -> "Flag the drift or collision to the user" [label="yes"];
    "Drift outside the fence, or a file two jobs changed?" -> "Relay only what you measured" [label="no"];
    "Flag the drift or collision to the user" -> "Relay only what you measured";
    "Relay only what you measured" -> "herd_status {herd}: the status table";
    "herd_status {herd}: the status table" -> "Does the report claim a merge?";
    "Does the report claim a merge?" -> "Merged on the repo?" [label="yes, or a nag about an open pane"];
    "Does the report claim a merge?" -> "Who merges this lane?" [label="no"];
    "Who merges this lane?" -> "Every lane job done?" [label="no domain rule: the integration job merges"];
    "Who merges this lane?" -> "chat_dm {to: <job handle>, body: ship through your skill chain}" [label="domain: the worker ships its own lane"];
    "Who merges this lane?" -> "Gate: merge this lane?" [label="domain: the shepherd merges after a gate"];
    "Does the report claim a merge?" -> "STOP: never merge, fix or push by hand; route by who merges" [label="tempted to merge, fix or push it yourself"];
    "STOP: never merge, fix or push by hand; route by who merges" -> "Who merges this lane?";
    "Every lane job done?" -> "Back to the watch loop: end the turn" [label="no"];
    "Every lane job done?" -> "Integration job spawned already?" [label="yes"];
    "Integration job spawned already?" -> "Ask the integration job's strategy and model" [label="no"];
    "Integration job spawned already?" -> "Unmerged reports for this lane spent?" [label="yes: it reported no merge"];
    "Integration job spawned already?" -> "Ask the integration job's strategy and model" [label="yes, it has reported and this lane joined after it spawned: a new one for it"];
    "Integration job spawned already?" -> "Back to the watch loop: end the turn" [label="yes, and it is still running: wait for its report"];
    "Ask the integration job's strategy and model" -> "herd_brief {job: integration-<n>, template, strategy, strategies, fill, out}";
    "herd_brief {job: integration-<n>, template, strategy, strategies, fill, out}" -> "herd_spawn {herd, job: integration-<n>, brief, model, effort, account?}";
    "herd_spawn {herd, job: integration-<n>, brief, model, effort, account?}" -> "Back to the watch loop: end the turn";
    "chat_dm {to: <job handle>, body: ship through your skill chain}" -> "Back to the watch loop: end the turn";
    "Gate: merge this lane?" -> "Forge?" [label="merge"];
    "Gate: merge this lane?" -> "Back to the watch loop: end the turn" [label="not yet, or hold"];
    "Forge?" -> "mr_merge {mrUrl}" [label="GitLab"];
    "Forge?" -> "gh pr merge <pr>" [label="GitHub"];
    "mr_merge {mrUrl}" -> "herd_lanes {herd, job}: after the merge call";
    "gh pr merge <pr>" -> "herd_lanes {herd, job}: after the merge call";
    "herd_lanes {herd, job}: after the merge call" -> "Merged on the repo?";
    "Merged on the repo?" -> "Flip the lane's ticket, when it has one" [label="yes"];
    "Merged on the repo?" -> "Did this lane claim the merge itself?" [label="no: open, closed or none"];
    "Merged on the repo?" -> "Shepherd off-script gate: ask the user" [label="unknown: quote the read's error"];
    "Merged on the repo?" -> "Shepherd off-script gate: ask the user" [label="no row: quote the skipped reason"];
    "Did this lane claim the merge itself?" -> "Unmerged reports for this lane spent?" [label="yes"];
    "Did this lane claim the merge itself?" -> "Back to the watch loop: end the turn" [label="no: it waits on the integration job or the gate"];
    "Did this lane claim the merge itself?" -> "Shepherd off-script gate: ask the user" [label="no: your own merge call did not land"];
    "Unmerged reports for this lane spent?" -> "chat_dm {to: <job handle>, body: the measured merge state}" [label="no"];
    "Unmerged reports for this lane spent?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "chat_dm {to: <job handle>, body: the measured merge state}" -> "Back to the watch loop: end the turn";
    "Flip the lane's ticket, when it has one" -> "herd_close {job, herd}: the merged lane";
    "herd_close {job, herd}: the merged lane" -> "More merged lanes to close?";
    "More merged lanes to close?" -> "Flip the lane's ticket, when it has one" [label="yes"];
    "More merged lanes to close?" -> "Every job done and closed?" [label="no"];
    "Every job done and closed?" -> "Back to the watch loop: end the turn" [label="no"];
    "Every job done and closed?" -> "Show the status table" [label="yes"];
    "Show the status table" -> "Gate wrap-up: the form contract";
    "Gate wrap-up: the form contract" -> "Herd held" [label="hold"];
    "Gate wrap-up: the form contract" -> "Any panes closing or trees disposed?" [label="close, keep or dispose answers"];
    "Any panes closing or trees disposed?" -> "worktree_stop_holders {repoName, tree}" [label="yes"];
    "Any panes closing or trees disposed?" -> "herd_wrap_up {herd, closePanes, dispose, deleteJobDirs, archiveRoom}" [label="no: every pane kept, nothing disposed"];
    "worktree_stop_holders {repoName, tree}" -> "More closing trees to stop?";
    "More closing trees to stop?" -> "worktree_stop_holders {repoName, tree}" [label="yes"];
    "More closing trees to stop?" -> "Measure what still runs" [label="no"];
    "Measure what still runs" -> "herd_wrap_up {herd, closePanes, dispose, deleteJobDirs, archiveRoom}";
    "herd_wrap_up {herd, closePanes, dispose, deleteJobDirs, archiveRoom}" -> "herd_wrap_up refused?";
    "herd_wrap_up refused?" -> "Herd wrapped up" [label="no"];
    "herd_wrap_up refused?" -> "Report the refusal in the guard's words" [label="yes"];
    "Report the refusal in the guard's words" -> "Herd wrapped up, refusal reported";
    "Shepherd off-script gate: ask the user" -> "Off-script answer?";
    "Off-script answer?" -> "Make the recorded move once" [label="take the proposed move"];
    "Off-script answer?" -> "Back to the watch loop: end the turn" [label="hand back or hold"];
    "Make the recorded move once" -> "Back to the watch loop: end the turn";
}
```

### Flag the drift or collision to the user

Files outside the job's write fence are drift; a file two jobs changed is
a collision. Flag it now, not at integration.

### Relay only what you measured

A worker's claims about its environment (servers up, ports free, CI green)
are routinely stale. Measure first
(`rt_verb {args: ["endpoint", "lookup", "<role>", "--path", "<the job's worktree>"]}`,
`curl`, `lsof`, a CI status call), or attribute it: "the worker reports X".

### Ask the integration job's strategy and model

One AskUserQuestion like every job's: the tier table's integration row is
the recommendation, the strategy half from the strategy table. With the
Accounts section non-empty, keep the herd's pool answer and pass the
per-spawn pick as `account`.

### Gate: merge this lane?

Only when a bound domain part gives the shepherd the merge. One sentence
with the PR or MR link, its state and its CI, then **Merge** / **Not yet** /
**Hold**.

### Flip the lane's ticket, when it has one

Flip it just before `herd_close`, for each lane an integration report
merges. Only you close a done job's pane. The watchdog nags past
`herd.watchdog.nagMins` (default 30): for a merged lane this step was
skipped; for a lane awaiting the integration job or a merge gate it is
normal, so end the turn.

### Show the status table

Reformat `herd_status {herd}`, flagging failures and the latest
`herd_lanes` drift:

```
| job | pane | account | strategy | status | summary |
|-----|------|---------|----------|--------|---------|
| api tests | w3:p1 | 2 | direct-tdd | done | A1-A4 done, 12 tests, suite green |
```

### Gate wrap-up: the form contract

One form, per the wrap-up form contract below:

- **Close the panes** (recommended when every job is done) / **Keep them for review**.
- A multi-select of the trees to dispose, none pre-selected. An rt-provisioned tree with unmerged work is listed but noted: the guard will refuse it.
- **Delete the job dirs** (yes / no).
- **Archive the room** (yes / no).
- **Hold**.

Never auto-remove a tree or job dir; `herd_wrap_up` executes exactly the
form's answer.

### Measure what still runs

The stop calls cover every job in the dispose list or with a closing pane:
`repoName` is the herd's repo, `tree` the job's `tree` from `herd_status`
(a registry name, never a path). A null
tree (a job spawned in a given dir) is skipped unless that dir is an rt
tree; then pass the name
`rt_verb {args: ["worktree", "list", "--repo", "<the herd's repo>"]}` prints for it.
They run first: a disposed tree leaves rt's registry.

`not-held` means rt recorded no hold, not that nothing runs: a hold is
recorded only when a tree's MR merges or closes with a process inside, so a
normal tree answers `not-held` with its dev servers up. The call ends only
processes tied to a held tree; there is no general kill.

Measure before you say a job's servers stopped (`lsof -ti tcp:<port>` or
the endpoint lookup). Report a survivor as still running, never kill it by
hand, and anything unmeasured as "not verified".

### Report the refusal in the guard's words

Quote the disposal refusal as the guard gave it. In hidden mode, also offer
the Bash command `rt herd stop --hidden` (no tool runs it); never run it unprompted. <!-- mcp-lint: allow -->

## What the lanes graph cannot show

- **The two objective checks.** `herd_lanes {herd}` returns a row per active job (`commits`; `drift.files`, committed and uncommitted work since the merge base; `collidesWith`) plus herd-wide `collisions`. Compare each job's `drift.files` against its write fence yourself; no fence is stored. A job whose tree is gone has no row (it is in `skipped` with a reason), and the drift check skips it.
- **A report is a claim, not a merge.** Answer "Merged on the repo?" from the job's row `merge.state`, on GitHub or GitLab, never from the report: `merged` is yes; `open`, `closed` or `none` is no; `unknown` goes to the off-script gate with the read's error. A lane with no row (a merge can dispose its tree) goes there with its `skipped` reason, and the proposed move closes the lane once the user confirms the merge. The row's `unmergedReports` feeds `Unmerged reports for this lane spent?` (see **Budgets**).
- **Job state is the daemon's.** It marks a job `done` when its report is published.
- **The integration job.** Its brief merges or cherry-picks the job branches, runs full verification, carries the shipping conventions, and reports. The first is `integration-1`; a lane that joined after it spawned gets the next number, and that brief covers only the lanes no integration job has merged.
- **Domain hook: after the report.** Unbound: the integration job merges. A bound domain part may define what follows a report (the worker ships through its own skill chain, or the shepherd merges after a gate; how jobs feeding one deliverable integrate) and whether it waits for the user to ask. Fixing and pushing stay with workers.
- **Domain hook: wrap-up.** Unbound: as drawn. A bound domain part may state its own tree lifecycle (trees that dispose themselves on merge, what a disposal refusal means); follow it over the defaults here.

## wrap-up form contract

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{include:wrap-up-form}}

## Rationalizations

| Thought | Reality |
| --- | --- |
| "I'll read the spec just to check it." | Doorbell the user or spawn a reviewer; artifacts are never yours. |
| "These options read better reworded, merged or reordered." | Relay them exactly; only a herd question's context is yours to condense. |
| "This spawn can take the default model." | A modelless spawn silently defeats tiering. |
| "Opus is safer for this execution job." | A specified execution job is mechanical; Opus overspends. |
| "I'll ask the account question first to save a round." | Models first: model-blind headroom misleads. |
| "The recommendation is obvious; I'll pick the strategy and model." | The user picks; only a domain pin or floor closes a half. |
| "Writing the Method prose myself is faster." | `herd_brief` copies it; a domain Method goes in by `methodFile`. |
| "`herdr agent prompt` reaches the worker faster." | `chat_dm` is the channel, on the record. |
| "I'll tell the worker to revise." | Revise is a gate answer with a note; findings are a DM. |
| "I'll mark this job done, closed or crashed myself." | The daemon owns job state. |
| "I remember this herd, or need its run id to pick it up." | `herd_resume {herd}`; `herd_list` names every herd. |
| "I know what that check would show." | Output not in your transcript was never run; run it or say so. Never invent a fact. |
| "The tool seems unreachable; I'll use another channel." | Report the real error and wait. |
| "I could decide this question for the agent." | Relay it, unless the answer is literally in the brief. |
| "I remember how many respawns this job has had." | The daemon counts; read the budget from `herd_diagnose` or `herd_lanes` this turn. |
| "A quick pane peek is cheaper than a diagnosis." | Pane text is the most expensive read there is; `herd_diagnose` returns the verdict without it. |
