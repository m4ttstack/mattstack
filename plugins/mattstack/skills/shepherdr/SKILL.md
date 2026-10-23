---
name: "shepherdr"
description: "Use when fanning work out across parallel Claude Code agents in herdr panes in a repo no team pack covers -- 'shepherdr', 'fan out', 'spawn agents', 'split this across agents', 'run these in parallel', 'spread this across my accounts'. Domain-unbound: where a team pack compiles its own shepherdr, that verb wins. Requires a running herdr instance and the rt daemon."
allowed-tools:
  - "Bash(*/scripts/pick-account.py:*)"
metadata:
  compiled: "mattstack@0.32.21 + mattstack:model-tiering@0.32.21 + mattstack:execution-strategy@0.32.21 + mattstack:cswap-accounts@0.32.21"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: block:shepherdr source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/index.block.md lines=25-78 -->
# shepherdr

You are the shepherd: a thin delegator, not a reviewer. You break work into jobs, spawn an agent per job (own herdr pane, own git worktree), present what the daemon pushes, and route small messages between the user and the herd. Model, method and account are policy, answered by the bound skills below; you are transport.

**Your context is the most expensive in the system**: everything you read is re-billed every later turn.

- Gates and the herd's chat room are pushed to you by the rt daemon; you never poll or hold a background wait. `herd_diagnose` is the only diagnosis of a silent or stuck agent; you never read pane text.
- You never read specs, plans, diffs or code. Artifact review belongs to the user or a disposable reviewer agent.
- You never merge, fix or push. Integration is itself a job.

For herdr CLI mechanics, load the `herdr` skill.

## Tiering

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

<!-- part: prop:shepherdr.tiering binding=mattstack:model-tiering version=0.32.21 path=skills/model-tiering/SKILL.md lines=8-164 -->
Prop tiering is bound to `mattstack:model-tiering` (mattstack:model-tiering@0.32.21) -- invoke that skill when this flow needs it.

<!-- part: block:shepherdr source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/index.block.md lines=43-78 -->
## Strategy

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

<!-- part: prop:shepherdr.strategy binding=mattstack:execution-strategy version=0.32.21 path=attachments/execution-strategy/SKILL.md lines=8-96 -->
# Execution Strategy

Given a unit of work and the surface it will execute on, name the method
the executor runs and the report contract that method produces. A brief
that names no method leaves its executor to improvise one.

## The six strategies

| Strategy | Executor runs |
|---|---|
| `trivial` | the change directly; no test, because there is no runtime behavior to test |
| `direct-tdd` | superpowers:test-driven-development inline: RED -> GREEN -> REFACTOR, failing test named before code |
| `from-spec` | the superpowers chain entered at the supplied spec: writing-plans, then subagent-driven-development |
| `from-plan` | superpowers:subagent-driven-development on the supplied plan |
| `superpowers` | the full chain: brainstorming -> spec -> writing-plans -> subagent-driven-development |
| `delegate` | triages against this table, picks one of the other five, runs it |

`delegate` never picks itself, must respect the surface table below, and
names its choice in its report so the dispatcher knows which report
contract applies.

Excluded: superpowers:executing-plans -- it defers to
subagent-driven-development wherever subagents are available, and
dispatched workers are full Claude Code sessions, so it is dominated.

## Picking the strategy

- `trivial` -- no runtime behavior to test: pure docs, comments, config,
  or a mechanical rename with zero logic change.
- `direct-tdd` -- real code with clear criteria and an existing pattern.
- `superpowers` -- everything else: new features, multiple valid
  approaches, vague criteria, cross-layer work, product decisions.
- `from-spec` -- a completed spec is already supplied.
- `from-plan` -- a completed plan is already supplied.
- `delegate` -- the dispatcher is not triaging; the executor triages
  against this section and picks one of the other five.

When in doubt between `direct-tdd` and `superpowers`, go `superpowers`;
between `trivial` and `direct-tdd`, go `direct-tdd`.

TDD is the floor, never a tier: any path that writes production code
writes its failing test first. `trivial` is the single escape hatch and it
is tight -- "it's simple", "it's small", or "I'll test after" is the
`direct-tdd` tell, not a `trivial` pass.

## Surface support

| Surface | `trivial` | `direct-tdd` | `from-spec` | `from-plan` | `superpowers` | `delegate` |
|---|---|---|---|---|---|---|
| Pane worker with a question relay | yes | yes | yes | yes | yes | yes |
| Agent-tool subagent | yes | yes | yes | yes | **no** | yes |

`superpowers` starts with brainstorming, which needs a human in the loop
throughout; an Agent-tool subagent cannot stop and wait for one.

When the picking rules land on `superpowers` and the surface is an
Agent-tool subagent, the unit fails on this surface: report the conflict
to the dispatcher rather than recording a strategy the surface cannot
run (not `superpowers`-and-continue, not a downgraded tier to fit the
surface). Name the two re-dispatch paths in the report: a pane worker
with a question relay, or a supplied spec or plan that re-enters the work
as `from-spec` or `from-plan`, which this surface supports.

## One plan, one executor

A plan is never sliced across parallel executors: it has one sequential
controller, its tasks chain by Consumes/Produces interfaces, and its
ledger is keyed by plan identity within one worktree. Fan out one level
up: 1 job = 1 sub-project = 1 spec = 1 plan = 1 branch = 1 worktree =
1 ledger.

## Report shape is per strategy

| Strategy | Report |
|---|---|
| `trivial`, `direct-tdd` | item-coded: one line per task item, plus verification results |
| `from-spec`, `superpowers` | milestone lines (`spec: <path>`, `plan: <path>`) as they land, then commit range and final-review verdict |
| `from-plan` | commit range and final-review verdict |
| `delegate` | the chosen strategy's shape, with the choice named first |

## Briefing an executor

When the caller has no brief-assembly verb, copy the assigned strategy's
body from `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md` verbatim into the
brief and fill its `<angle-bracket>` slots yourself. A caller that has one
(the `herd_brief` tool and its `strategy`/`strategies` fields) does this copy
for you -- name the strategy and pass it, nothing more. Either way, do not
compose method prose per job; the bodies carry the worker-boundary rules
and the report contract.

<!-- part: block:shepherdr source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/index.block.md lines=49-78 -->
`accounts` may be unbound (single-account mode, handled below).

## Domain rules

Domain rules are optional: a pack binds them to the `rules` prop, here or
on a step's own block. A bound domain part's rules win over this engine's
default only at the **Domain hook** paragraphs below: intake, the model
floor and strategy pin, provisioning (the `Domain provisions the tree?`
branch), the Method copy, conventions, what follows a job's report, and
wrap-up. It never changes the herd contract: questions and reports still
flow through the herd tools and the gate registry.

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*



<!-- part: block:shepherdr source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/index.block.md lines=65-78 -->
When nothing is inlined above, every engine default stands as written.

## Accounts

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

<!-- part: prop:shepherdr.accounts binding=mattstack:cswap-accounts version=0.32.21 path=attachments/cswap-accounts/SKILL.md lines=11-78 -->
# cswap account pool

Given the herd's model mix and the accounts already assigned this run,
name where to launch the next worker, or report that no pool account
qualifies. **Spawn-time only:** an Agent-tool subagent runs in-process on
the caller's credentials and exposes no account dimension, so this
contract can only be honored where workers launch as their own sessions.

Paths below are relative to this skill's directory; the compiler inlines
this fill under `shepherdr`'s `## Accounts` section at compile time.

## The pool question

If `cswap` is installed and `cswap list --json` shows two or more
accounts, ask ONE structured question (AskUserQuestion, single choice)
before spawning anything: how should this herd use accounts?

1. Smart distribute across all accounts (recommended)
2. Smart distribute across a subset -- follow-up multi-select of accounts
3. Single account -- follow-up single-select

Build each account's option description from headroom mode, passing the
herd's chosen models:

```bash
"${CLAUDE_SKILL_DIR}/parts/accounts/scripts/pick-account.py" --headroom --pool 1,2,3 --model fable,sonnet
```

It prints one line per account (email, per-model scoped pcts with
EXHAUSTED callouts, 5h/7d, binding for that model mix). Use those lines
verbatim -- a scoped pool can be exhausted while overall headroom looks
fine, and the user must see that before choosing.

The selection is the session pool: record it, and never spawn or respawn
outside it without explicit approval. No cswap or a single account: skip
all of this; workers launch on the default `claude` command.

## Per-spawn pick

Before each spawn in a smart-distribute herd:

```bash
ACCT=$("${CLAUDE_SKILL_DIR}/parts/accounts/scripts/pick-account.py" --pool 2,3 --model <model> --assigned <accounts-already-assigned>)
```

`--assigned` lists the account of every worker already launched this run,
one entry per worker. The picker excludes accounts near their limits and
answers with the healthiest account for that worker's model; a nonzero
exit means no pool account qualifies -- surface that to the user as a
structured question, never spawn anyway.

The launch command this provider hands to transport:
`cswap run <account> --` (model and effort arguments are appended to it).

## Exhaustion mid-run

In smart-distribute mode with a qualifying account left in the pool,
respawn automatically; the wrapper owns the respawn mechanics. In
single-account mode, or with the pool exhausted, ask instead: 1. wait for
reset (show the countdown from `cswap list --json`), 2. switch to an
out-of-pool account, 3. abandon.

## Quirk

cswap sessions share plugins along with settings and skills (the plugin
cache is a shared symlink), so a worker pane missing a plugin's tools is a
real failure: check the pane's plugin list and the shared cache instead of
dismissing it.

<!-- part: block:shepherdr source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/index.block.md lines=73-78 -->
When the section above is non-empty, follow it: it owns the pool
question, the per-spawn pick (passed as `account` on `herd_spawn` or
`herd_respawn`), and the exhaustion decision tree. Accounts in use are each
job's `account` in `herd_status`, never memory. Empty: single-account mode
-- no account question, spawns omit the account, workers launch as plain
`claude`.

<!-- part: block:shepherdr/start-and-spawn source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/start-and-spawn/index.block.md lines=5-98 -->
## Start and spawn

Walk this graph from the trigger; a move it does not show goes to the shepherd off-script gate.

```dot
digraph shepherdr_start {
    rankdir=TB;

    trigger_fan_out [label="Trigger: fan this work out across agents" shape=ellipse];
    herdr_env_session [label="HERDR_ENV=1 in this session?" shape=diamond];
    stop_herdr_needed [label="STOP: a herd needs herdr; say so" shape=octagon style=filled fillcolor=red fontcolor=white];
    herd_list [label="herd_list {}" shape=plaintext];
    daemon_answered [label="Daemon answered?" shape=diamond];
    stop_daemon_error [label="STOP: the herd rides the daemon; report its error" shape=octagon style=filled fillcolor=red fontcolor=white];
    picking_up_herd [label="Picking up an existing herd?" shape=diamond];
    herd_resume_pick_up [label="herd_resume {herd}: pick the herd up" shape=plaintext];
    needs_herd [label="Does the work need a herd?" shape=diamond];
    dispatched_subagents [label="Dispatched as Agent-tool subagents" shape=doublecircle];
    specify_jobs [label="Specify the jobs" shape=box];
    single_job_no_herd [label="Exactly one job, no live herd, and no domain single-worker exception?" shape=diamond];
    worktree_provision [label="worktree_provision {repoName, branch: <job>, disposal: job}" shape=plaintext];
    enter_worktree [label="EnterWorktree {path}" shape=plaintext];
    worked_in_tree [label="Worked here in a tree, no herd" shape=doublecircle];
    ask_strategy_model [label="Ask the strategy and model per job" shape=box];
    accounts_section_filled [label="Accounts section non-empty?" shape=diamond];
    ask_account_pool [label="Ask the account pool question" shape=box];
    collect_repo_conventions [label="Collect the repo conventions" shape=box];
    herd_already_live [label="A herd is already live for this work?" shape=diamond];
    herd_start [label="herd_start {name, repo, hidden?}" shape=plaintext];
    herd_brief [label="herd_brief {job, template, strategy, strategies, fill, out}" shape=plaintext];
    herd_brief_result [label="herd_brief result?" shape=diamond];
    brief_retries_spent [label="Brief retries = 2?" shape=diamond];
    fix_refusal [label="Fix what the refusal names" shape=box];
    stop_copy_template [label="STOP: fix the refusal; never copy the template or strategies file elsewhere" shape=octagon style=filled fillcolor=red fontcolor=white];
    domain_provisions_tree [label="Domain provisions the tree?" shape=diamond];
    herd_spawn [label="herd_spawn {herd, job, brief, model, effort, account?}" shape=plaintext];
    herd_spawn_domain_tree [label="herd_spawn {herd, job, brief, model, effort, account?, tree: <the domain's tree>}" shape=plaintext];
    stop_hand_spawn [label="STOP: spawn only with herd_spawn" shape=octagon style=filled fillcolor=red fontcolor=white];
    spawn_result [label="Spawn result?" shape=diamond];
    stop_hand_roll [label="STOP: never hand-roll a tree, a pane or a launch" shape=octagon style=filled fillcolor=red fontcolor=white];
    shepherd_off_script [label="Shepherd off-script gate: ask the user" shape=box];
    off_script_answer [label="Off-script answer?" shape=diamond];
    make_recorded_move [label="Make the recorded move once" shape=box];
    more_jobs_in_batch [label="More jobs in this batch (cap 6)?" shape=diamond];
    go_to_watch_loop [label="Go to the watch loop" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_fan_out -> herdr_env_session;
    herdr_env_session -> stop_herdr_needed [label="no"];
    herdr_env_session -> herd_list [label="yes"];
    herd_list -> daemon_answered;
    daemon_answered -> stop_daemon_error [label="no"];
    daemon_answered -> picking_up_herd [label="yes"];
    picking_up_herd -> herd_resume_pick_up [label="yes: a fresh session"];
    picking_up_herd -> needs_herd [label="no: new work"];
    picking_up_herd -> specify_jobs [label="yes: a later job for this session's live herd"];
    herd_resume_pick_up -> go_to_watch_loop;
    needs_herd -> dispatched_subagents [label="no: no accounts, questions, live view or crash survival needed"];
    needs_herd -> specify_jobs [label="yes"];
    specify_jobs -> single_job_no_herd;
    single_job_no_herd -> worktree_provision [label="yes: push back, do it here"];
    single_job_no_herd -> ask_strategy_model [label="no"];
    worktree_provision -> enter_worktree;
    enter_worktree -> worked_in_tree;
    ask_strategy_model -> accounts_section_filled;
    accounts_section_filled -> ask_account_pool [label="yes"];
    accounts_section_filled -> collect_repo_conventions [label="no: single account"];
    ask_account_pool -> collect_repo_conventions;
    collect_repo_conventions -> herd_already_live;
    herd_already_live -> herd_start [label="no"];
    herd_already_live -> herd_brief [label="yes: brief it into this herd"];
    herd_start -> herd_brief;
    herd_brief -> herd_brief_result;
    herd_brief_result -> domain_provisions_tree [label="ok: the out path is the brief"];
    herd_brief_result -> brief_retries_spent [label="refused"];
    herd_brief_result -> stop_copy_template [label="tempted to copy the template past a root refusal"];
    stop_copy_template -> fix_refusal;
    brief_retries_spent -> fix_refusal [label="no"];
    brief_retries_spent -> shepherd_off_script [label="yes: budget spent"];
    fix_refusal -> herd_brief;
    domain_provisions_tree -> herd_spawn [label="no: herd_spawn provisions"];
    domain_provisions_tree -> herd_spawn_domain_tree [label="yes: its tree, by name"];
    domain_provisions_tree -> stop_hand_spawn [label="tempted to spawn from the shell"];
    stop_hand_spawn -> herd_spawn_domain_tree;
    herd_spawn -> spawn_result;
    herd_spawn_domain_tree -> spawn_result;
    spawn_result -> more_jobs_in_batch [label="ok"];
    spawn_result -> shepherd_off_script [label="error: quote it"];
    spawn_result -> stop_hand_roll [label="tempted to build the tree or pane yourself"];
    stop_hand_roll -> shepherd_off_script;
    shepherd_off_script -> off_script_answer;
    off_script_answer -> make_recorded_move [label="take the proposed move"];
    off_script_answer -> more_jobs_in_batch [label="hand back or hold: skip this job"];
    make_recorded_move -> more_jobs_in_batch;
    more_jobs_in_batch -> herd_brief [label="yes: the next job, one at a time"];
    more_jobs_in_batch -> go_to_watch_loop [label="no"];
}
```

<!-- part: block:shepherdr/start-and-spawn/specify-jobs source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/start-and-spawn/specify-jobs.block.md lines=9-38 -->
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

<!-- part: block:shepherdr/start-and-spawn/ask-strategy-model source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/start-and-spawn/ask-strategy-model.block.md lines=9-35 -->
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

<!-- part: block:shepherdr/start-and-spawn/ask-account-pool source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/start-and-spawn/ask-account-pool.block.md lines=5-8 -->
### Ask the account pool question

Ask it once per herd, after the models are chosen: per-model pools
hide headroom until the model mix is known. A later job for a live herd keeps the herd's pool answer.

<!-- part: block:shepherdr/start-and-spawn/collect-repo-conventions source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/start-and-spawn/collect-repo-conventions.block.md lines=9-31 -->
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

<!-- part: block:shepherdr/start-and-spawn/fix-refusal source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/start-and-spawn/fix-refusal.block.md lines=5-12 -->
### Fix what the refusal names

- **An unfilled marker**: the refusal lists the leftover slots; add a `fill` entry for each.
- **A path outside every root**: the loaded skill dir is stale (the plugin updated mid-session) or a dev checkout. Run `/reload-plugins` (in a herdr pane, queue it on yourself with `rt pane send self --text "/reload-plugins" --then "Continue: ..."` and end the turn), then retry from the reloaded base directory.
- **Any other refusal**: correct the input it names and retry.

Never copy the template or the strategies file elsewhere to get past a
refusal; the retry budget hands a stubborn one to the off-script gate.

<!-- part: block:shepherdr/start-and-spawn/shepherd-off-script source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/start-and-spawn/shepherd-off-script.block.md lines=5-23 -->
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

<!-- part: block:shepherdr/start-and-spawn/make-recorded-move source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/start-and-spawn/make-recorded-move.block.md lines=5-8 -->
### Make the recorded move once

Make exactly the move the user took, once, as its value spells it. If it
fails too, that is a new off-script gate, never a retry of your own.

<!-- part: block:shepherdr/what-the-start-graph-cannot-show source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/what-the-start-graph-cannot-show.block.md lines=9-84 -->
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
`mattstack-bg`) as `bg:<pane>` refs; nothing else changes. `herd_attend {job, herd}`
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

<!-- part: block:shepherdr/the-watch-loop source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/index.block.md lines=5-171 -->
## The watch loop

After the spawns, do nothing until something arrives.

```dot
digraph shepherdr_watch {
    rankdir=TB;

    trigger_herd_spawned [label="Trigger: the herd is spawned or resumed" shape=ellipse];
    end_turn_wait [label="End the turn until something arrives" shape=box];
    end_turn_next_move [label="Next move while the turn is ended?" shape=diamond];
    stop_read_pane_progress [label="STOP: the gates and the room report progress; never read a pane for it" shape=octagon style=filled fillcolor=red fontcolor=white];
    stop_arm_watcher [label="STOP: nothing arms; no background wait, watcher or sweep" shape=octagon style=filled fillcolor=red fontcolor=white];
    something_arrives [label="Something arrives" shape=ellipse];
    what_arrived [label="What arrived?" shape=diamond];
    stop_push_text_answer [label="STOP: answer from the registry, never from the push text" shape=octagon style=filled fillcolor=red fontcolor=white];
    herd_gates_push [label="herd_gates {herd}: the gate push" shape=plaintext];
    herd_resume_relaunch [label="herd_resume {herd}: after a relaunch" shape=plaintext];
    open_gates_returned [label="Open gates returned?" shape=diamond];
    boards_gate [label="Gate context is boards@1?" shape=diamond];
    answer_literal_in_brief [label="Answer literally in the brief you wrote?" shape=diamond];
    present_open_gates [label="Present the open gates" shape=box];
    herd_gate_park [label="herd_gate_park {herd, gate}" shape=plaintext];
    herd_gate_answer [label="herd_gate_answer {herd, gate, answers}" shape=plaintext];
    answer_recorded [label="Answer recorded?" shape=diamond];
    say_which_answer [label="Say which answer won, in one line" shape=box];
    answer_retries_spent [label="Answer retries = 2?" shape=diamond];
    fix_answers_verbatim [label="Fix the answers: each value verbatim" shape=box];
    spawn_reviewer_chosen [label="Spawn a reviewer chosen?" shape=diamond];
    herd_diagnose_reviewer [label="herd_diagnose {herd, job}: the reviewer budget" shape=plaintext];
    reviewer_rounds_spent [label="Reviewer rounds on this milestone spent?" shape=diamond];
    herd_spawn_reviewer [label="herd_spawn {herd, job: review-<job>, brief: <review brief>, tree: <the job's tree>, disposable: true, model, effort, account?}" shape=plaintext];
    herd_diagnose_blocked [label="herd_diagnose {herd, job}: the blocked job" shape=plaintext];
    blocked_notices_spent [label="Blocked notices for this job spent?" shape=diamond];
    herd_diagnose_unconsumed [label="herd_diagnose {herd, job}: the unconsumed lane" shape=plaintext];
    diagnosis_verdict [label="What does the diagnosis say?" shape=diamond];
    stop_peek_pane [label="STOP: herd_diagnose reads the pane; never peek it yourself" shape=octagon style=filled fillcolor=red fontcolor=white];
    herd_gates_diagnosed [label="herd_gates {herd}: the diagnosed job's gate" shape=plaintext];
    nudges_spent [label="Nudges for this gate spent?" shape=diamond];
    herd_nudge [label="herd_nudge {herd, job, gate}" shape=plaintext];
    nudge_delivered [label="Nudge delivered?" shape=diamond];
    smart_distribute_pool [label="Smart-distribute pool in use?" shape=diamond];
    accounts_section_filled [label="Accounts section non-empty?" shape=diamond];
    pick_account_by_rules [label="Pick the account per the accounts rules" shape=box];
    report_stall [label="Report the stall to the user" shape=box];
    ask_attend_respawn [label="Ask: attend or respawn" shape=box];
    pane_bg_dialog [label="Job's pane a bg: ref (the parked dialog)?" shape=diamond];
    pane_bg_human [label="Job's pane a bg: ref (a human is needed)?" shape=diamond];
    herd_attend_dialog [label="herd_attend {job, herd}: the parked dialog" shape=plaintext];
    herd_attend_human [label="herd_attend {job, herd}: a human is needed" shape=plaintext];
    point_user_at_tab [label="Point the user at the job's tab" shape=box];
    report_crash [label="Report the crash with its job and pane" shape=box];
    chat_dm_ruling [label="chat_dm {to: <job handle>, body: the ruling or findings}" shape=plaintext];
    ask_finish_kill_hold [label="Ask: let them finish, kill and respawn, or hold" shape=box];
    herd_close_killed [label="herd_close {job, herd}: killed for new scope" shape=plaintext];
    herd_brief_respawn [label="herd_brief {job, template, strategy, strategies, fill, out}: the new brief" shape=plaintext];
    herd_diagnose_respawn [label="herd_diagnose {herd, job}: the respawn budget" shape=plaintext];
    respawns_spent [label="Respawns of this job spent?" shape=diamond];
    stop_hand_respawn [label="STOP: a respawn goes through herd_respawn" shape=octagon style=filled fillcolor=red fontcolor=white];
    herd_respawn [label="herd_respawn {herd, job, brief?, model?, effort?, account?}" shape=plaintext];
    respawn_result [label="Respawn result?" shape=diamond];
    shepherd_off_script [label="Shepherd off-script gate: ask the user" shape=box];
    off_script_answer [label="Off-script answer?" shape=diamond];
    make_recorded_move [label="Make the recorded move once" shape=box];
    go_lanes_wrap_up [label="Go to lanes and wrap-up" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_herd_spawned -> end_turn_wait;
    end_turn_wait -> end_turn_next_move;
    end_turn_next_move -> something_arrives [label="none: the daemon pushes the next arrival" style=dashed];
    end_turn_next_move -> stop_read_pane_progress [label="tempted to read a pane to see how it goes"];
    end_turn_next_move -> stop_arm_watcher [label="tempted to arm a wait or a sweep"];
    stop_read_pane_progress -> end_turn_wait;
    stop_arm_watcher -> end_turn_wait;
    something_arrives -> what_arrived;
    what_arrived -> herd_gates_push [label="a gate push"];
    what_arrived -> stop_push_text_answer [label="tempted to answer from the push text"];
    stop_push_text_answer -> herd_gates_push;
    what_arrived -> end_turn_wait [label="a milestone announcement: its gate push wakes you"];
    what_arrived -> herd_resume_relaunch [label="a relaunch or compaction"];
    what_arrived -> herd_diagnose_unconsumed [label="gate <id> UNCONSUMED in herd_status, or the watchdog's answered-and-unconsumed line"];
    what_arrived -> herd_diagnose_blocked [label="<job> blocked"];
    what_arrived -> report_crash [label="<job> exited"];
    what_arrived -> chat_dm_ruling [label="a ruling or findings for one worker"];
    what_arrived -> ask_finish_kill_hold [label="the user redirects scope"];
    what_arrived -> herd_diagnose_respawn [label="the user asks for a respawn"];
    what_arrived -> herd_gate_answer [label="the user answers a parked gate"];
    what_arrived -> go_lanes_wrap_up [label="a report line, or a nag about a done job's open pane"];
    herd_gates_push -> open_gates_returned;
    herd_resume_relaunch -> open_gates_returned;
    herd_gates_diagnosed -> open_gates_returned;
    open_gates_returned -> boards_gate [label="yes"];
    boards_gate -> present_open_gates [label="yes: only the human looks at boards"];
    boards_gate -> answer_literal_in_brief [label="no"];
    open_gates_returned -> end_turn_wait [label="none: a stale id is normal"];
    answer_literal_in_brief -> herd_gate_answer [label="yes"];
    answer_literal_in_brief -> present_open_gates [label="no"];
    present_open_gates -> herd_gate_answer [label="the user answers"];
    present_open_gates -> herd_gate_park [label="the user parks it"];
    herd_gate_park -> end_turn_wait;
    herd_gate_answer -> answer_recorded;
    answer_recorded -> spawn_reviewer_chosen [label="recorded"];
    answer_recorded -> say_which_answer [label="conflict: another surface answered first"];
    answer_recorded -> answer_retries_spent [label="refused: invalid values"];
    answer_recorded -> shepherd_off_script [label="error: closed, not this herd's, or gone"];
    say_which_answer -> end_turn_wait;
    answer_retries_spent -> fix_answers_verbatim [label="no"];
    answer_retries_spent -> shepherd_off_script [label="yes: budget spent"];
    fix_answers_verbatim -> herd_gate_answer;
    spawn_reviewer_chosen -> end_turn_wait [label="no"];
    spawn_reviewer_chosen -> herd_diagnose_reviewer [label="yes"];
    herd_diagnose_reviewer -> reviewer_rounds_spent;
    reviewer_rounds_spent -> herd_spawn_reviewer [label="no"];
    reviewer_rounds_spent -> shepherd_off_script [label="yes: budget spent"];
    herd_spawn_reviewer -> end_turn_wait;
    herd_diagnose_blocked -> blocked_notices_spent;
    blocked_notices_spent -> diagnosis_verdict [label="no"];
    blocked_notices_spent -> shepherd_off_script [label="yes: budget spent"];
    herd_diagnose_unconsumed -> diagnosis_verdict;
    diagnosis_verdict -> herd_gates_diagnosed [label="at-gate"];
    diagnosis_verdict -> nudges_spent [label="idle, and the arrival named an answered gate it has not read"];
    diagnosis_verdict -> end_turn_wait [label="working, or idle with nothing waiting"];
    diagnosis_verdict -> accounts_section_filled [label="rate-limited"];
    diagnosis_verdict -> smart_distribute_pool [label="dead, gone, no-pane or login-expired"];
    diagnosis_verdict -> ask_attend_respawn [label="parked-modal"];
    diagnosis_verdict -> pane_bg_human [label="needs-human"];
    pane_bg_human -> herd_attend_human [label="yes: a hidden herd"];
    pane_bg_human -> point_user_at_tab [label="no: the pane is already a tab"];
    diagnosis_verdict -> stop_peek_pane [label="tempted to peek the pane or send a key"];
    stop_peek_pane -> shepherd_off_script;
    nudges_spent -> herd_nudge [label="no"];
    nudges_spent -> shepherd_off_script [label="yes: budget spent"];
    herd_nudge -> nudge_delivered;
    nudge_delivered -> end_turn_wait [label="delivered"];
    nudge_delivered -> end_turn_wait [label="refused: already consumed, the worker read it"];
    nudge_delivered -> shepherd_off_script [label="needsHuman, or another refusal: quote it"];
    smart_distribute_pool -> pick_account_by_rules [label="yes"];
    smart_distribute_pool -> respawns_spent [label="no, and not login-expired: relaunch on the same account"];
    smart_distribute_pool -> report_stall [label="no, and login-expired: only a login fixes it"];
    accounts_section_filled -> pick_account_by_rules [label="yes"];
    accounts_section_filled -> report_stall [label="no: nowhere else to launch"];
    pick_account_by_rules -> respawns_spent [label="an account picked"];
    pick_account_by_rules -> end_turn_wait [label="wait or abandon"];
    report_stall -> end_turn_wait;
    ask_attend_respawn -> pane_bg_dialog [label="attend"];
    pane_bg_dialog -> herd_attend_dialog [label="yes: a hidden herd"];
    pane_bg_dialog -> point_user_at_tab [label="no: the pane is already a tab"];
    point_user_at_tab -> end_turn_wait;
    ask_attend_respawn -> respawns_spent [label="respawn"];
    herd_attend_dialog -> end_turn_wait;
    herd_attend_human -> end_turn_wait;
    report_crash -> end_turn_wait;
    chat_dm_ruling -> end_turn_wait;
    ask_finish_kill_hold -> end_turn_wait [label="let them finish, or hold"];
    ask_finish_kill_hold -> herd_close_killed [label="kill and respawn"];
    herd_close_killed -> herd_brief_respawn;
    herd_brief_respawn -> herd_diagnose_respawn;
    herd_diagnose_respawn -> respawns_spent;
    respawns_spent -> herd_respawn [label="no"];
    respawns_spent -> shepherd_off_script [label="yes: budget spent"];
    respawns_spent -> stop_hand_respawn [label="tempted to respawn with herd_spawn or the shell"];
    stop_hand_respawn -> herd_respawn;
    herd_respawn -> respawn_result;
    respawn_result -> end_turn_wait [label="ok: announce it"];
    respawn_result -> shepherd_off_script [label="error: quote it"];
    shepherd_off_script -> off_script_answer;
    off_script_answer -> make_recorded_move [label="take the proposed move"];
    off_script_answer -> end_turn_wait [label="hand back or hold"];
    make_recorded_move -> end_turn_wait;
}
```

<!-- part: block:shepherdr/the-watch-loop/end-turn-wait source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/end-turn-wait.block.md lines=5-10 -->
### End the turn until something arrives

The daemon pushes gates and room lines; nothing arms, and you never read a
pane or scrollback. Your room posts
deliver as `@here` and wake every worker, so a question for one worker is a
DM.

<!-- part: block:shepherdr/the-watch-loop/present-open-gates source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/present-open-gates.block.md lines=5-26 -->
### Present the open gates

Present up to 4 open gates in one AskUserQuestion call. Options are the
gate's `label` (else text) and `description`, the recommendation first,
never reworded, merged or reordered.

- A herd question gate (`kind: question`, subject `herd:<id>/<job>`): one sentence naming the job and what it needs decided, then the form with the gate question's `label`.
- Any other gate: its full context.
- A milestone gate: **Approve** / **Revise** / **Spawn a reviewer**; Revise collects feedback (or "see pane") into `note`.

Submit each `value` verbatim; free text rides the `note`.
`herd_gate_answer` records `by: shepherd`. Answer for the agent only when
the answer is literally in the brief you wrote, and never a gate whose
context is `boards@1`: whether an evidence board may go public is decided
by a human looking at it, so that gate is presented whatever the brief
says. A human answer fitting no
option goes as `{"writeIn": "<their words>"}` if the question was opened
with `writeIn`, else ask them to pick. When the user parks a gate,
`herd_gate_park` takes it off the open list; it stays answerable with
`herd_gate_answer` until answered or closed. A later answer takes its id
from the job's `herd_status` row: `lastGate`, with `lastGateStatus:
parked`; relay it verbatim.

<!-- part: block:shepherdr/the-watch-loop/say-which-answer source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/say-which-answer.block.md lines=5-7 -->
### Say which answer won, in one line

Name `winner.answers` and `winner.by`; never re-ask.

<!-- part: block:shepherdr/the-watch-loop/fix-answers-verbatim source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/fix-answers-verbatim.block.md lines=5-7 -->
### Fix the answers: each value verbatim

Resend each value from `invalid[].validValues`, verbatim.

<!-- part: block:shepherdr/the-watch-loop/pick-account-by-rules source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/pick-account-by-rules.block.md lines=5-8 -->
### Pick the account per the accounts rules

The Accounts section decides whether to respawn now or ask first; its
pick is the `account` on `herd_respawn`. Announce the respawn.

<!-- part: block:shepherdr/the-watch-loop/report-stall source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/report-stall.block.md lines=5-8 -->
### Report the stall to the user

Single-account mode, or an expired login with no pool (only the user's
`/login` fixes it). Name the job, its pane and the verdict.

<!-- part: block:shepherdr/the-watch-loop/ask-attend-respawn source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/ask-attend-respawn.block.md lines=5-9 -->
### Ask: attend or respawn

A dialog the watchdog could not clear parks the job (`stuck-at-modal`).
**Attend** opens the pane for the user; **Respawn** reuses the stored
brief.

<!-- part: block:shepherdr/the-watch-loop/point-user-at-tab source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/point-user-at-tab.block.md lines=5-11 -->
### Point the user at the job's tab

The job's pane in `herd_status` has no `bg:` prefix: the herd is visible,
so the pane is already a tab in the herd's workspace and `herd_attend`,
which opens tabs only for a hidden herd's panes, would refuse. Tell the
user in one message which job, its pane ref and tab, and what waits on
them (the diagnosis reason, or the parked dialog).

<!-- part: block:shepherdr/the-watch-loop/report-crash source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/report-crash.block.md lines=5-8 -->
### Report the crash with its job and pane

The pane died with the job live. Tell the user both; never respawn
silently.

<!-- part: block:shepherdr/the-watch-loop/ask-finish-kill-hold source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/the-watch-loop/ask-finish-kill-hold.block.md lines=5-9 -->
### Ask: let them finish, kill and respawn, or hold

One sentence naming the running agents, then the bare three options:
**Let them finish** (recommended) / **Kill and respawn with the new
briefs** / **Hold**. No restated heading, no per-option descriptions.

<!-- part: block:shepherdr/what-the-watch-loop-cannot-show source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/what-the-watch-loop-cannot-show.block.md lines=5-32 -->
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

<!-- part: block:shepherdr/lanes-and-wrap-up source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/index.block.md lines=5-118 -->
## Lanes and wrap-up

```dot
digraph shepherdr_lanes {
    rankdir=TB;

    trigger_job_report [label="Trigger: a job's report, or a nag about a done job's open pane" shape=ellipse];
    herd_lanes_report [label="herd_lanes {herd}: the report's lanes" shape=plaintext];
    drift_outside_fence [label="Drift outside the fence, or a file two jobs changed?" shape=diamond];
    flag_drift_collision [label="Flag the drift or collision to the user" shape=box];
    relay_measured_only [label="Relay only what you measured" shape=box];
    herd_status [label="herd_status {herd}: the status table" shape=plaintext];
    report_claims_merge [label="Does the report claim a merge?" shape=diamond];
    who_merges_lane [label="Who merges this lane?" shape=diamond];
    stop_hand_merge [label="STOP: never merge, fix or push by hand; route by who merges" shape=octagon style=filled fillcolor=red fontcolor=white];
    all_lane_jobs_done [label="Every lane job done?" shape=diamond];
    integration_job_spawned [label="Integration job spawned already?" shape=diamond];
    ask_integration_strategy [label="Ask the integration job's strategy and model" shape=box];
    herd_brief_integration [label="herd_brief {job: integration-<n>, template, strategy, strategies, fill, out}" shape=plaintext];
    herd_spawn_integration [label="herd_spawn {herd, job: integration-<n>, brief, model, effort, account?}" shape=plaintext];
    chat_dm_ship_chain [label="chat_dm {to: <job handle>, body: ship through your skill chain}" shape=plaintext];
    gate_merge_lane [label="Gate: merge this lane?" shape=box];
    forge_host [label="Forge?" shape=diamond];
    mr_merge [label="mr_merge {mrUrl}" shape=plaintext];
    gh_pr_merge [label="gh pr merge <pr>" shape=plaintext];
    herd_lanes_after_merge [label="herd_lanes {herd, job}: after the merge call" shape=plaintext];
    merged_on_repo [label="Merged on the repo?" shape=diamond];
    lane_claimed_merge [label="Did this lane claim the merge itself?" shape=diamond];
    unmerged_reports_spent [label="Unmerged reports for this lane spent?" shape=diamond];
    chat_dm_merge_state [label="chat_dm {to: <job handle>, body: the measured merge state}" shape=plaintext];
    flip_lane_ticket [label="Flip the lane's ticket, when it has one" shape=box];
    herd_close_merged [label="herd_close {job, herd}: the merged lane" shape=plaintext];
    more_merged_lanes [label="More merged lanes to close?" shape=diamond];
    all_jobs_closed [label="Every job done and closed?" shape=diamond];
    show_status_table [label="Show the status table" shape=box];
    gate_wrap_up_form [label="Gate wrap-up: the form contract" shape=box];
    panes_or_trees_closing [label="Any panes closing or trees disposed?" shape=diamond];
    worktree_stop_holders [label="worktree_stop_holders {repoName, tree}" shape=plaintext];
    more_closing_trees [label="More closing trees to stop?" shape=diamond];
    measure_running [label="Measure what still runs" shape=box];
    herd_wrap_up [label="herd_wrap_up {herd, closePanes, dispose, deleteJobDirs, archiveRoom}" shape=plaintext];
    herd_wrap_up_refused [label="herd_wrap_up refused?" shape=diamond];
    report_refusal [label="Report the refusal in the guard's words" shape=box];
    shepherd_off_script [label="Shepherd off-script gate: ask the user" shape=box];
    off_script_answer [label="Off-script answer?" shape=diamond];
    make_recorded_move [label="Make the recorded move once" shape=box];
    back_to_watch_loop [label="Back to the watch loop: end the turn" shape=doublecircle];
    herd_held [label="Herd held" shape=doublecircle];
    herd_wrapped_refusal [label="Herd wrapped up, refusal reported" shape=doublecircle];
    herd_wrapped_up [label="Herd wrapped up" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_job_report -> herd_lanes_report;
    herd_lanes_report -> drift_outside_fence;
    drift_outside_fence -> flag_drift_collision [label="yes"];
    drift_outside_fence -> relay_measured_only [label="no"];
    flag_drift_collision -> relay_measured_only;
    relay_measured_only -> herd_status;
    herd_status -> report_claims_merge;
    report_claims_merge -> merged_on_repo [label="yes, or a nag about an open pane"];
    report_claims_merge -> who_merges_lane [label="no"];
    who_merges_lane -> all_lane_jobs_done [label="no domain rule: the integration job merges"];
    who_merges_lane -> chat_dm_ship_chain [label="domain: the worker ships its own lane"];
    who_merges_lane -> gate_merge_lane [label="domain: the shepherd merges after a gate"];
    report_claims_merge -> stop_hand_merge [label="tempted to merge, fix or push it yourself"];
    stop_hand_merge -> who_merges_lane;
    all_lane_jobs_done -> back_to_watch_loop [label="no"];
    all_lane_jobs_done -> integration_job_spawned [label="yes"];
    integration_job_spawned -> ask_integration_strategy [label="no"];
    integration_job_spawned -> unmerged_reports_spent [label="yes: it reported no merge"];
    integration_job_spawned -> ask_integration_strategy [label="yes, it has reported and this lane joined after it spawned: a new one for it"];
    integration_job_spawned -> back_to_watch_loop [label="yes, and it is still running: wait for its report"];
    ask_integration_strategy -> herd_brief_integration;
    herd_brief_integration -> herd_spawn_integration;
    herd_spawn_integration -> back_to_watch_loop;
    chat_dm_ship_chain -> back_to_watch_loop;
    gate_merge_lane -> forge_host [label="merge"];
    gate_merge_lane -> back_to_watch_loop [label="not yet, or hold"];
    forge_host -> mr_merge [label="GitLab"];
    forge_host -> gh_pr_merge [label="GitHub"];
    mr_merge -> herd_lanes_after_merge;
    gh_pr_merge -> herd_lanes_after_merge;
    herd_lanes_after_merge -> merged_on_repo;
    merged_on_repo -> flip_lane_ticket [label="yes"];
    merged_on_repo -> lane_claimed_merge [label="no: open, closed or none"];
    merged_on_repo -> shepherd_off_script [label="unknown: quote the read's error"];
    merged_on_repo -> shepherd_off_script [label="no row: quote the skipped reason"];
    lane_claimed_merge -> unmerged_reports_spent [label="yes"];
    lane_claimed_merge -> back_to_watch_loop [label="no: it waits on the integration job or the gate"];
    lane_claimed_merge -> shepherd_off_script [label="no: your own merge call did not land"];
    unmerged_reports_spent -> chat_dm_merge_state [label="no"];
    unmerged_reports_spent -> shepherd_off_script [label="yes: budget spent"];
    chat_dm_merge_state -> back_to_watch_loop;
    flip_lane_ticket -> herd_close_merged;
    herd_close_merged -> more_merged_lanes;
    more_merged_lanes -> flip_lane_ticket [label="yes"];
    more_merged_lanes -> all_jobs_closed [label="no"];
    all_jobs_closed -> back_to_watch_loop [label="no"];
    all_jobs_closed -> show_status_table [label="yes"];
    show_status_table -> gate_wrap_up_form;
    gate_wrap_up_form -> herd_held [label="hold"];
    gate_wrap_up_form -> panes_or_trees_closing [label="close, keep or dispose answers"];
    panes_or_trees_closing -> worktree_stop_holders [label="yes"];
    panes_or_trees_closing -> herd_wrap_up [label="no: every pane kept, nothing disposed"];
    worktree_stop_holders -> more_closing_trees;
    more_closing_trees -> worktree_stop_holders [label="yes"];
    more_closing_trees -> measure_running [label="no"];
    measure_running -> herd_wrap_up;
    herd_wrap_up -> herd_wrap_up_refused;
    herd_wrap_up_refused -> herd_wrapped_up [label="no"];
    herd_wrap_up_refused -> report_refusal [label="yes"];
    report_refusal -> herd_wrapped_refusal;
    shepherd_off_script -> off_script_answer;
    off_script_answer -> make_recorded_move [label="take the proposed move"];
    off_script_answer -> back_to_watch_loop [label="hand back or hold"];
    make_recorded_move -> back_to_watch_loop;
}
```

<!-- part: block:shepherdr/lanes-and-wrap-up/flag-drift-collision source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/flag-drift-collision.block.md lines=5-8 -->
### Flag the drift or collision to the user

Files outside the job's write fence are drift; a file two jobs changed is
a collision. Flag it now, not at integration.

<!-- part: block:shepherdr/lanes-and-wrap-up/relay-measured-only source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/relay-measured-only.block.md lines=5-10 -->
### Relay only what you measured

A worker's claims about its environment (servers up, ports free, CI green)
are routinely stale. Measure first
(`rt_verb {args: ["endpoint", "lookup", "<role>", "--path", "<the job's worktree>"]}`,
`curl`, `lsof`, a CI status call), or attribute it: "the worker reports X".

<!-- part: block:shepherdr/lanes-and-wrap-up/ask-integration-strategy source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/ask-integration-strategy.block.md lines=5-10 -->
### Ask the integration job's strategy and model

One AskUserQuestion like every job's: the tier table's integration row is
the recommendation, the strategy half from the strategy table. With the
Accounts section non-empty, keep the herd's pool answer and pass the
per-spawn pick as `account`.

<!-- part: block:shepherdr/lanes-and-wrap-up/gate-merge-lane source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/gate-merge-lane.block.md lines=5-9 -->
### Gate: merge this lane?

Only when a bound domain part gives the shepherd the merge. One sentence
with the PR or MR link, its state and its CI, then **Merge** / **Not yet** /
**Hold**.

<!-- part: block:shepherdr/lanes-and-wrap-up/flip-lane-ticket source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/flip-lane-ticket.block.md lines=5-11 -->
### Flip the lane's ticket, when it has one

Flip it just before `herd_close`, for each lane an integration report
merges. Only you close a done job's pane. The watchdog nags past
`herd.watchdog.nagMins` (default 30): for a merged lane this step was
skipped; for a lane awaiting the integration job or a merge gate it is
normal, so end the turn.

<!-- part: block:shepherdr/lanes-and-wrap-up/show-status-table source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/show-status-table.block.md lines=5-14 -->
### Show the status table

Reformat `herd_status {herd}`, flagging failures and the latest
`herd_lanes` drift:

```
| job | pane | account | strategy | status | summary |
|-----|------|---------|----------|--------|---------|
| api tests | w3:p1 | 2 | direct-tdd | done | A1-A4 done, 12 tests, suite green |
```

<!-- part: block:shepherdr/lanes-and-wrap-up/gate-wrap-up-form source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/gate-wrap-up-form.block.md lines=5-16 -->
### Gate wrap-up: the form contract

One form, per the wrap-up form contract below:

- **Close the panes** (recommended when every job is done) / **Keep them for review**.
- A multi-select of the trees to dispose, none pre-selected. An rt-provisioned tree with unmerged work is listed but noted: the guard will refuse it.
- **Delete the job dirs** (yes / no).
- **Archive the room** (yes / no).
- **Hold**.

Never auto-remove a tree or job dir; `herd_wrap_up` executes exactly the
form's answer.

<!-- part: block:shepherdr/lanes-and-wrap-up/measure-running source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/measure-running.block.md lines=5-22 -->
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

<!-- part: block:shepherdr/lanes-and-wrap-up/report-refusal source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/lanes-and-wrap-up/report-refusal.block.md lines=5-8 -->
### Report the refusal in the guard's words

Quote the disposal refusal as the guard gave it. In hidden mode, also offer
the Bash command `rt herd stop --hidden` (no tool runs it); never run it unprompted. <!-- mcp-lint: allow -->

<!-- part: block:shepherdr/what-the-lanes-graph-cannot-show source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/what-the-lanes-graph-cannot-show.block.md lines=9-18 -->
## What the lanes graph cannot show

- **The two objective checks.** `herd_lanes {herd}` returns a row per active job (`commits`; `drift.files`, committed and uncommitted work since the merge base; `collidesWith`) plus herd-wide `collisions`. Compare each job's `drift.files` against its write fence yourself; no fence is stored. A job whose tree is gone has no row (it is in `skipped` with a reason), and the drift check skips it.
- **A report is a claim, not a merge.** Answer "Merged on the repo?" from the job's row `merge.state` (GitHub or GitLab) alone, never the report or a forge read of your own: `merged` is yes; `open`, `closed` or `none` is no; `unknown` goes to the off-script gate with the read's error. A lane with no row (a merge can dispose its tree) goes there with its `skipped` reason, and the proposed move closes the lane once the user confirms the merge. The row's `unmergedReports` feeds `Unmerged reports for this lane spent?` (see **Budgets**).
- **Job state is the daemon's.** It marks a job `done` when its report is published.
- **The integration job.** Its brief merges or cherry-picks the job branches, runs full verification, carries the shipping conventions, and reports. The first is `integration-1`; a lane that joined after it spawned gets the next number, and that brief covers only the lanes no integration job has merged.
- **Domain hook: after the report.** Unbound: the integration job merges. A bound domain part may define what follows a report (the worker ships through its own skill chain, or the shepherd merges after a gate; how jobs feeding one deliverable integrate) and whether it waits for the user to ask. Fixing and pushing stay with workers.
- **Domain hook: wrap-up.** Unbound: as drawn. A bound domain part may state its own tree lifecycle (trees that dispose themselves on merge, what a disposal refusal means); follow it over the defaults here.

<!-- part: block:shepherdr/wrap-up-form-contract source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/wrap-up-form-contract.block.md lines=5-9 -->
## wrap-up form contract

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

<!-- part: block:wrap-up-form source=mattstack:wrap-up-form version=0.32.21 path=attachments/wrap-up-form/index.block.md lines=7-33 -->
### Wrap-up

The reply is one optional sentence of context, then a form, then stop. Wait
for the answers before doing more work.

The form is this runtime's structured-question tool (`AskUserQuestion` in
Claude Code). One question per open item, in three buckets; omit an empty
bucket:

| Bucket | The question is | Options |
|---|---|---|
| Important details | a confirmation or pick among facts that still matter | concrete values |
| Decisions | a choice only the user can make | the real alternatives, recommended first and labelled `(Recommended)` |
| Next steps | whether or in what order to do remaining work | do now / later / skip |

Single or multiple choice as the item needs. If the tool caps how many
questions fit in one call, fill the first call and wait; the rest go in the
next call after the answers return, never into the context sentence.

| Thought | Reality |
|---|---|
| "A summary with the options listed is just as clear" | A list is text the user has to type back. The form is the answer channel. |
| "They asked me to be quick, so a compact list" | The form is the quick version: one tap per item. |
| "The options are obvious, prose is faster" | Obvious to you. The form records which one they picked. |
| "Next steps can go in prose after the form" | Next steps are questions: do now / later / skip. |
| "I can hand them a default to save them answering" | Recommended options already do that in the form; a typed reply still costs more than a tap and leaves no record of the pick. |
| "The context sentence, then a line introducing the form" | Two sentences. The form needs no introduction; the sentence is the whole preamble. |

<!-- part: block:shepherdr/rationalizations source=mattstack:shepherdr version=0.32.21 path=attachments/orchestration/shepherdr/rationalizations.block.md lines=5-24 -->
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
