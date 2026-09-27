---
name: "shepherdr"
description: "Use when fanning work out across parallel Claude Code agents in herdr panes in a repo no team pack covers -- 'shepherdr', 'fan out', 'spawn agents', 'split this across agents', 'run these in parallel', 'spread this across my accounts'. Domain-unbound: where a team pack compiles its own shepherdr, that verb wins. Requires a running herdr instance and the rt daemon."
allowed-tools:
  - "Bash(*/scripts/pick-account.py:*)"
metadata:
  compiled: "mattstack@0.26.1 + mattstack:model-tiering@0.26.1 + mattstack:execution-strategy@0.26.1 + mattstack:cswap-accounts@0.26.1"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: step source=mattstack:shepherdr version=0.26.1 path=attachments/orchestration/shepherdr/SKILL.md lines=15-870 -->

# shepherdr

You are the shepherd: a thin delegator, not a reviewer. You break work into jobs, spawn an agent per job (own herdr pane, own git worktree), present what the daemon pushes, and route small structured messages between the user and the herd. Which model, which method, and where to launch are policy questions answered by the bound skills below; you are transport -- allocate, spawn, watch, relay, integrate.

**Your context is the most expensive context in the system.** Everything you read is re-billed on every later turn. The discipline that follows:

- Agents talk to you through gates and the herd's chat room, both pushed into your context by the rt daemon; you never poll and never hold a background wait. Read a pane only to diagnose an agent that went silent without publishing, or crashed.
- You never read specs, plans, diffs, or code. Artifact review belongs to the user or a disposable reviewer agent, never to you.
- You never do hands-on work: no merging, no fixing, no pushing. Integration is itself a job.

For herdr CLI mechanics, load the `herdr` skill.

## Tiering

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

<!-- part: slot:tiering binding=mattstack:model-tiering version=0.26.1 path=attachments/model-tiering/SKILL.md lines=8-117 -->
# Model Tiering

Use the least capable model tier **and effort** that can succeed at each unit
of work. An omitted model flag inherits the parent's model -- usually the most
expensive one -- which silently defeats tiering.

## The tier table

Tiers are **aliases**, not model IDs. Aliases point to the provider's
recommended version and update over time, so the table survives model
releases; resolution is provider-dependent (Bedrock, Foundry, and Google
Cloud resolve `opus` and `sonnet` differently from the first-party API). A
rejected alias exits 1 at launch -- a bad entry is a visible failure, not a
silent downgrade.

| Work shape | Tier |
|---|---|
| Transcription plus testing (the plan carries the literal code), or a single-file mechanical fix | `haiku` |
| Mechanical execution -- complete spec, 2-3 files, existing pattern to follow | `sonnet` |
| Design / triage -- multiple valid approaches, cross-layer, product decisions | `opus` |
| Long-horizon autonomous work -- larger than one sitting | `fable` |
| Integration -- merge branches, run verification, report | `sonnet` |
| Review -- disposable artifact or diff reviewer | `sonnet` |
| Simple, high-volume, or disposable lookup | `haiku` |

**Cost floor.** Cheapest models take 2-3x the turns on multi-step work and
cost more overall. `sonnet` is the floor for reviewers and for prose
implementers. `haiku` is only for work where the input already contains the
answer: transcription plus testing, single-file mechanical fixes, simple lookups.

**Excluded aliases.** `opusplan` upgrades only inside Claude Code's plan
permission mode, which skill-driven workers never enter -- do not re-add it.
`best` and `default` resolve by org entitlement, not work shape. `[1m]`
variants pick a context window, not a tier; when used, quote them
(`'opus[1m]'`) -- brackets are zsh glob characters.

## Two dispatch surfaces

| | Spawn-time (`claude` CLI) | Delegation-time (Agent tool) |
|---|---|---|
| Model | alias or full ID | enum: `sonnet`, `opus`, `haiku`, `fable` |
| Effort | `--effort` flag | no effort parameter exists |
| `best` / `default` / `[1m]` | accepted | rejected |
| Billing account | selectable at launch | inherits the caller's session |

The four tier words are valid on both surfaces. Effort and account decisions
are spawn-time only; a delegation-time answer names a model and nothing
else.

## Effort (spawn-time only)

Use the model's **default** effort; deviate only for a named reason. Tuning
effort is often a better lever than switching models.

- Claude Code **clamps** an unsupported level to the highest supported level
  at or below it. No per-model matrix is needed, and models without effort
  support are a non-event.
- Organization effort caps clamp **silently** in background agents and JSON
  output modes; a pane may run below the requested level with no warning.
- `ultracode` is a Claude Code setting (xhigh plus workflow orchestration),
  not a level in the ladder.

## The two discriminators

- **Wrong conclusion despite full context** -> next tier up.
- **Right idea, sloppy execution** (skipped a file, did not run the tests,
  did not double-check) -> higher effort. Spawn-time only.

## Escalation

- Never retry a stuck agent **unchanged**.
- Missing context -> same tier, re-dispatched with the context.
- Wrong despite full context -> next tier up.

## Complexity signals

Use these to place a unit of work in the table:

- **File count and isolation.** A single file with the fix fully specified =
  cheapest tier. 2-3 files with a clear spec = mechanical. Multi-file with
  integration concerns = design tier.
- **Spec completeness.** Brief contains the exact code or precise
  instructions = mechanical. Brief describes intent and constraints = design
  tier.
- **Decision load.** Zero design decisions left = mechanical. Any product,
  architecture, or pattern decision = design tier.
- **Existing pattern.** Adding a field along an existing pattern, renaming,
  copy tweak = mechanical. New pattern, new component, new abstraction =
  design tier.

When in doubt, use the higher tier. A capable model on simple work wastes
money; a simple model on complex work wastes everything.

## Tiering is recursive

A design-tier agent that runs the superpowers chain (brainstorming, spec,
plan, implement) should in turn dispatch its implementer sub-agents on
cheaper models. The plan's task descriptions carry the complexity signals: a
task touching 1-2 files with complete code in the spec is mechanical; a task
requiring broad codebase understanding is design tier.

This recursion is how tiering saves the most: the expensive model does
judgment and orchestration; the cheap models do the volume work.

## Domain overrides

Skills layered on top of this one may set a floor ("never use model X in
this repo") or a default ("ticket-driven work defaults to Opus because
triage happens inside the worker"). Those overrides are domain-specific;
this skill is the generic framework they override.

## Strategy

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

<!-- part: slot:strategy binding=mattstack:execution-strategy version=0.26.1 path=attachments/execution-strategy/SKILL.md lines=8-93 -->
# Execution Strategy

Given a unit of work and the surface it will execute on, name the method
the executor runs and the report contract that method produces. A brief
that names no method leaves its executor to improvise one.

## The five strategies

| Strategy | Executor runs |
|---|---|
| `trivial` | the change directly; no test, because there is no runtime behavior to test |
| `direct-tdd` | superpowers:test-driven-development inline: RED -> GREEN -> REFACTOR, failing test named before code |
| `resume` | the superpowers chain entered at the supplied artifact: spec in hand -> writing-plans onward; plan in hand -> subagent-driven-development |
| `superpowers` | the full chain: brainstorming -> spec -> writing-plans -> subagent-driven-development |
| `delegate` | triages against this table, picks one of the other four, runs it |

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
- `resume` -- a completed spec or plan is already supplied.
- `delegate` -- the dispatcher is not triaging; the executor triages
  against this section and picks one of the other four.

When in doubt between `direct-tdd` and `superpowers`, go `superpowers`;
between `trivial` and `direct-tdd`, go `direct-tdd`.

TDD is the floor, never a tier: any path that writes production code
writes its failing test first. `trivial` is the single escape hatch and it
is tight -- "it's simple", "it's small", or "I'll test after" is the
`direct-tdd` tell, not a `trivial` pass.

## Surface support

| Surface | `trivial` | `direct-tdd` | `resume` | `superpowers` | `delegate` |
|---|---|---|---|---|---|
| Pane worker with a question relay | yes | yes | yes | yes | yes |
| Agent-tool subagent | yes | yes | yes | **no** | yes |

`superpowers` starts with brainstorming, which needs a human in the loop
throughout; an Agent-tool subagent cannot stop and wait for one.

When the picking rules land on `superpowers` and the surface is an
Agent-tool subagent, the unit fails on this surface: report the conflict
to the dispatcher rather than recording a strategy the surface cannot
run (not `superpowers`-and-continue, not a downgraded tier to fit the
surface). Name the two re-dispatch paths in the report: a pane worker
with a question relay, or a supplied spec/plan that re-enters the work
as `resume`, which this surface supports.

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
| `resume`, `superpowers` | milestone lines (`spec: <path>`, `plan: <path>`) as they land, then commit range and final-review verdict |
| `delegate` | the chosen strategy's shape, with the choice named first |

## Briefing an executor

When the caller has no brief-assembly verb, copy the assigned strategy's
body from `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md` verbatim into the
brief and fill its `<angle-bracket>` slots yourself. A caller that has one
(the `herd_brief` tool and its `strategy`/`strategies` fields) does this copy
for you -- name the strategy and pass it, nothing more. Either way, do not
compose method prose per job; the bodies carry the worker-boundary rules
and the report contract.

`accounts` may be unbound -- that is single-account mode, handled below.

## Domain rules

`domain` is optional. A bound domain part's rules win over this engine's
default only at these hooks: intake (`Specify the jobs`), the model floor
and strategy pin (`Ask the strategy and model per job`), provisioning (the
`Domain provisions the tree?` branch), the brief's Method copy (brief
assembly), conventions (`Collect the repo conventions`), what follows a
job's report, and wrap-up (both in `What the lanes graph cannot show`,
after the `Lanes and wrap-up` graph). A domain part never changes the
herd contract itself -- questions and reports still flow through the herd
tools and the gate registry, and what arrives is still yours to present.

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*



When nothing is inlined above, every default in this engine stands as written.

## Accounts

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

<!-- part: slot:accounts binding=mattstack:cswap-accounts version=0.26.1 path=attachments/cswap-accounts/SKILL.md lines=9-76 -->
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

When the section above is non-empty, follow it: it owns the pool
question (asked once per herd, AFTER models are chosen), the per-spawn
pick, and the exhaustion decision tree. Pass the account it picks as
`account` on `herd_spawn` (`--account <A>` on a Bash spawn). Empty:
single-account mode -- no account question, spawns omit the account, and
workers launch as plain `claude`.

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
    "herd_spawn {herd, job, brief, model, effort?, account?}" [shape=plaintext];
    "rt herd spawn --herd <id> --job <job> --brief <brief> --model <model> --dir <its tree> [--account <A>]" [shape=plaintext]; // <!-- mcp-lint: allow -->
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
    "Domain provisions the tree?" -> "herd_spawn {herd, job, brief, model, effort?, account?}" [label="no: herd_spawn provisions"];
    "Domain provisions the tree?" -> "rt herd spawn --herd <id> --job <job> --brief <brief> --model <model> --dir <its tree> [--account <A>]" [label="yes: its tree, its Bash line"]; // <!-- mcp-lint: allow -->
    "herd_spawn {herd, job, brief, model, effort?, account?}" -> "Spawn result?";
    "rt herd spawn --herd <id> --job <job> --brief <brief> --model <model> --dir <its tree> [--account <A>]" -> "Spawn result?"; // <!-- mcp-lint: allow -->
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

**Domain hook -- intake.** Unbound: the jobs come from what the user
hands you; invoked with nothing, ask what to fan out. A bound domain part
may define a default intake for the empty invocation (a ticket queue, a
board column) -- follow it and make one job per item it yields.

Decompose into independent jobs:

- Disjoint file ownership per job -- the write fence.
- Item-coded task lists (A1, A2...) where the strategy produces items, so those reports are checkable at a glance.
- Each job has a clear deliverable and can run without another job's output. Sequential work (B needs A) joins the live herd later: once A's report arrives, walk the start graph from its trigger, take `Picking up an existing herd?` as a later job for this session's live herd, and brief B into that herd; never start a second herd for it.

Two kinds of job come out of this. An **execution job** is fully specified
up front: brief in, report out, zero questions expected (a plan exists,
findings are verified, the refactor is scoped). A **design job** expects
questions during the run: method choices, milestone gates, mid-run
touchpoints. N design jobs are N parallel brainstorms; the user answers one
agent's question while the others think. If work arrives unscoped and the
user wants it scoped before fan-out, brainstorm with them directly yourself
(no pane, no relay), then specify execution jobs from the result.

**Does the work need a herd?** The herd earns its keep through account
distribution, mid-flight interaction (question relay, milestone gates),
live visibility, and crash-survivable jobs. A small, fully specified
execution fan-out with none of those belongs on the Agent tool: say so and
dispatch subagents instead.

**Exactly one job, no live herd?** Push back: tell the user "this is
probably not the right skill for this" and do the work yourself, here in
the main pane. One agent behind a relay is pure overhead. The graph's
`worktree_provision` and `EnterWorktree` moves keep that work isolated from
the user's checkout; after them, the delegator rules above do not apply and
you work hands-on as normal. A bound domain part may name the one
legitimate single-worker exception; apply it. A later job for a live herd
is never this case: it joins the herd.

### Ask the strategy and model per job

Strategy predicts the work shape, and the work shape predicts the tier, so
they are one choice. Derive a per-job recommendation (strategy from the
bound strategy table, model from the bound tier table), then ask one
AskUserQuestion per job (single choice, batched up to 4 jobs per call): the
recommendation first, marked "(Recommended)" with both halves in the label
("superpowers, opus" / "direct-tdd, sonnet"), then 2-3 curated alternates
spanning the tiers.

**Effort is a session default, not a question.** Per the bound tiering
skill, use the model's default effort and deviate only when the user names
a reason. Every spawn carries the chosen model (`model` on `herd_spawn`,
`--model` on a Bash spawn) and carries effort only when overridden; a spawn
without a model launches on the default model and silently defeats tiering.

**Domain hook -- model floor and strategy pin.** Unbound: both halves are
open and the tier table's recommendation stands. A bound domain part may
set a model floor for a class of work and pin the strategy half (its own
method skill is the brief's Method); then the recommendation starts at
that floor, the question carries only the half still open, and a spawn
below the floor is wrong.

### Ask the account pool question

Ask it once per herd, as the Accounts section above says. It comes after
the models are chosen: some providers budget per-model pools separately,
so account headroom cannot be presented honestly until the herd's model mix
is known. A later job for a live herd keeps the pool answer the herd already
has; do not ask again.

### Collect the repo conventions

A herd pane is a real `claude` session in a real git worktree: user-level
plugins, skills, rules, and the repo's tracked conventions (CLAUDE.md,
AGENTS.md, tracked `.claude/skills/`) load normally. What does NOT survive
is untracked state (`node_modules`, `.env`, `settings.local.json`,
gitignored directories), and skills fire by description match, not by
path, so a gate nobody names may never load.

Collect the repo's development conventions from two places: workflow rules
already loaded in your session, and the repo's convention docs (CLAUDE.md,
AGENTS.md, CONTRIBUTING or equivalent). This read is orchestration input,
not artifact review; specs, plans, diffs, and code stay off limits.

Each brief's `Repo conventions` section carries exactly three things: the
gate skills that bind this job, named with absolute paths; task A0 for
untracked state (dependency install, env or secrets sync); and the branch
name. Everything else a convention says lives in the skill that owns it.

- **Branch naming**: the branch is the job name (`herd_spawn` provisions on it). If branches derive from tickets, resolve the ticket first and name the job accordingly, or a provisioning domain part spawns on a tree it named itself. No repo rule = any name; branches that never ship are ephemeral.
- **Shipping process** (target branch, MR conventions, CI): goes in the integration job's brief, including where shipped work must land if the repo's workflow dictates it.

**Domain hook -- conventions.** Unbound: the three items above. When the
bound domain part's method skill owns the repo's conventions, the `Repo
conventions` section names only the branch; gates, process, and evidence
come from the skill chain the worker loads, and a brief that restates them
competes with that chain.

### Fix what the refusal names

- **An unfilled marker**: the refusal lists the leftover slots; add a `fill` entry for each.
- **A path outside every root**: the loaded skill dir is stale (the plugin updated while this session ran) or a dev checkout. Run `/reload-plugins` (in a herdr pane, queue it on yourself with `rt pane send self --text "/reload-plugins" --then "Continue: ..."` and end the turn), then retry from the reloaded base directory.
- **Any other refusal**: correct the input it names and retry.

Never copy the template or the strategies file elsewhere to get past a
refusal; the retry budget hands a stubborn refusal to the off-script gate.

### Shepherd off-script gate: ask the user

Every refusal the graph does not resolve and every spent budget lands here,
in all three graphs. Ask with AskUserQuestion: one sentence quoting the
refusal or naming the budget spent, then three options:

- **Take the proposed move**: its value spells the move in full (the exact tool call or Bash line), so the answer is the record.
- **Hand it back to you**: the user deals with it.
- **Hold**: nothing moves on this job for now.

"Hand it back" and "Hold" route straight back into the loop the gate came
from: in this graph the job is skipped and the batch goes on; in the watch
loop and the lanes graph you end the turn until something arrives. One
job's spent budget never ends the herd.

A counter names what has already happened: `Brief retries = 2?` answers
yes once two retries have run, so two are allowed before this gate.

### Make the recorded move once

Make exactly the move the user took, once, as its value spells it. If that
move fails too, that is a new off-script gate, never a retry of your own.

## What the start graph cannot show

**The herd contract.** Every herd is a row in the rt daemon's registry plus
one chat room and one gate subscription, all created by `herd_start`.
Workers ask through gates (`herd_ask`, `herd_milestone`) and report into
the room, where the daemon also posts lifecycle notices (`<job> blocked`,
`<job> exited`); the daemon pushes all of it into this session and records
job state as a side effect of every call. You talk to a worker with the
`chat_dm` tool (`{to: <handle>, body}`). There is no herd DB, no script,
and no background wait; `herd_status {herd}` is the whole picture at any
moment.

**Resuming.** `herd_list` shows the herd ids. `herd_resume {herd}`
re-points the gate subscription and the chat identity to this session and
returns the open gates, the unread room messages, and every job's state.
There is no other resume step. After `herd_resume`, handle each unread room
line as if it had just arrived (a report goes to the lanes graph).

**Brief assembly.** Every brief is assembled by `herd_brief`, never
composed. Its inputs:

- `template`: `${CLAUDE_SKILL_DIR}/references/job-template.md`
- `strategy`: the job's chosen strategy name
- `strategies`: `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md`
- `fill`: one `"<slot>=<value>"` string per slot
- `out`: an absolute path in this session's scratchpad, one file per job

`${CLAUDE_SKILL_DIR}` is the base directory this skill was loaded from,
written as an absolute path. Both paths come from that directory and
nothing else; the tool accepts them because it is an installed plugin or
pack root, and rt never guesses skill paths.

It copies `references/job-template.md` verbatim, copies the named strategy
body verbatim from `parts/strategy/references/strategies.md` into
`## Method`, and fills the template's literal `<angle-bracket>` slots from
the `fill` entries; an unfilled marker in the output is a refusal listing
the leftovers, so nothing is retyped from memory and no slot goes silently
empty. The `out` path is the brief you hand to the spawn.

**Domain hook -- the Method copy.** Unbound: the assembly as written. A
bound domain part may supply the `## Method` block itself (its team's
pipeline skill is the method); then pass `methodFile: <path>` instead of
`strategy`/`strategies` (they are mutually exclusive), the strategies-file
slots are not filled, and the report contract is whatever that method skill
produces. The template's remaining sections still come from the template
verbatim; the question and report channels never change.

The Method body's `<question-file>`/`<report-file>` slots get pointers to
the brief's 'Asking the user a question' / 'Publishing a report' sections
(the draft path is `.superpowers/report-draft.md`). A `<strategies-file>`
slot gets the absolute path of the strategy bodies file itself:
`parts/strategy/references/strategies.md` under this skill's directory. A
`<strategy-skill-file>` slot gets the absolute path of the file carrying
the strategy TABLE: this skill's own SKILL.md, whose strategy part carries
it. The strategy skill stays medium-agnostic. Each of these is supplied as
a `fill` entry.

**Hidden mode.** When the user asks for the herd to stay out of sight
("invisible", "background", "headless", "don't clutter my UI"), pass
`hidden: true` to `herd_start`. Every worker pane then lives on the
daemon's shared background herdr server (session `bg`); the generic pane
verbs address its panes as `bg:<pane>` refs, exactly as herd surfaces print
them. Nothing else in this skill changes. To put one worker in front of the
user, `herd_attend {job, herd}` opens a focused tab in the visible session
attached to that pane (the user detaches with `ctrl+b q`; close the tab it
returned afterwards). At wrap-up, offer the Bash command
`rt herd stop --hidden` (no tool runs it); never run it unprompted. The <!-- mcp-lint: allow -->
background server is shared: the stop refuses while ANY background claim
is live (another herd, a runner board, an `agent --bg` pane), naming the
owners; report the refusal, never work around it.

**The domain-provisioned spawn.** Unbound, `herd_spawn` provisions the tree
itself (branch `<job>`, disposal `job`). A bound domain part that owns
provisioning provisions the tree its own way, then spawns in it with this
Bash line in place of `herd_spawn` (the tool never takes a dir):

```bash
rt herd spawn --herd <id> --job <job> --brief <path-to-brief.md> --model <model> --dir <its tree> [--effort <effort>] [--account <A>]  # <!-- mcp-lint: allow -->
```

**Spawn facts.**

- `herd_start {name: <short-name>, repo, hidden?}` runs once per herd; `repo` is the repo's checkout path, identity or label. It returns the herd id, the room, the workspace label, and the subscription id. Every pane the herd creates is a tab in that one workspace; the user's own workspace is never touched.
- `job` is the job's name (lowercase, `[a-z][a-z0-9_-]{0,31}`); it is also the worker's chat handle and its tab label. `brief` is the absolute `out` path `herd_brief` wrote.
- `herd_spawn` provisions the tree, launches claude with the brief, signs the worker into the room, accepts the fresh-worktree trust dialog, and records the job.
- A cold provision, when no on-deck tree is ready, can take minutes; tell the user it is provisioning.
- **Stagger 4+ spawns**: spawn one, confirm it returned, spawn the next.
- Agents never work in the user's checkout. Skip isolation only for read-only jobs or when the user explicitly says to work in place. The worker's directory must be a **linked worktree**; `herd_spawn` and a Bash spawn on an rt tree both satisfy this by construction.

## The watch loop

After the spawns, do nothing until something arrives; arrival is the proof the daemon and your subscription are live.

```dot
digraph shepherdr_watch {
    rankdir=TB;

    "Trigger: the herd is spawned or resumed" [shape=ellipse];
    "End the turn until something arrives" [shape=box];
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
    "rt gate park <id>" [shape=plaintext];
    "rt gate answer <id> --answers <json> --by shepherd" [shape=plaintext];
    "Answer recorded?" [shape=diamond];
    "Say which answer won, in one line" [shape=box];
    "Answer retries = 2?" [shape=diamond];
    "Fix the answers: each value verbatim" [shape=box];
    "Spawn a reviewer chosen?" [shape=diamond];
    "Reviewer rounds on this milestone = 2?" [shape=diamond];
    "rt herd spawn --herd <id> --job review-<job> --brief <review brief> --dir <the job's tree> --disposable --model <model> [--account <A>]" [shape=plaintext]; // <!-- mcp-lint: allow -->
    "rt_verb {args: [pane, peek, <pane>]}: the unconsumed lane" [shape=plaintext];
    "Is the lane alive?" [shape=diamond];
    "Smart-distribute pool in use?" [shape=diamond];
    "Nudges for this gate?" [shape=diamond];
    "An idle prompt, and no form on screen?" [shape=diamond];
    "chat_dm {to: <job>, body: call herd_answer for <gate>}" [shape=plaintext];
    "rt pane send <pane> --text <the same nudge>" [shape=plaintext];
    "Blocked notices for this job = 3?" [shape=diamond];
    "herd_gates {herd}: the blocked job" [shape=plaintext];
    "Open gate for the blocked job?" [shape=diamond];
    "rt_verb {args: [pane, peek, <pane>]}" [shape=plaintext];
    "What does the pane show?" [shape=diamond];
    "STOP: never press keys into a modal or form; answer its gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Accounts section non-empty?" [shape=diamond];
    "Pick the account per the accounts rules" [shape=box];
    "Report the stall to the user" [shape=box];
    "Ask: attend or close and respawn" [shape=box];
    "herd_attend {job, herd}: the parked dialog" [shape=plaintext];
    "herd_close {job, herd}: parked, respawning" [shape=plaintext];
    "herd_attend {job, herd}: a human is needed" [shape=plaintext];
    "Report the crash with its job and pane" [shape=box];
    "chat_dm {to: <job>, body: the ruling or findings}" [shape=plaintext];
    "Ask: let them finish, kill and respawn, or hold" [shape=box];
    "herd_close {job, herd}: killed for new scope" [shape=plaintext];
    "herd_brief {job, template, strategy, strategies, fill, out}: the new brief" [shape=plaintext];
    "Respawns of this job = 2?" [shape=diamond];
    "STOP: herd_spawn never respawns; it takes no dir" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "rt herd spawn --herd <id> --job <job> --dir <its tree> --model <model> [--brief <new brief>] [--effort <e>] [--account <A>]" [shape=plaintext]; // <!-- mcp-lint: allow -->
    "Shepherd off-script gate: ask the user" [shape=box];
    "Off-script answer?" [shape=diamond];
    "Make the recorded move once" [shape=box];
    "Go to lanes and wrap-up" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: the herd is spawned or resumed" -> "End the turn until something arrives";
    "End the turn until something arrives" -> "Something arrives" [style=dashed];
    "End the turn until something arrives" -> "STOP: the gates and the room report progress; never read a pane for it" [label="tempted to read a pane to see how it goes"];
    "End the turn until something arrives" -> "STOP: nothing arms; no background wait, watcher or sweep" [label="tempted to arm a wait or a sweep"];
    "STOP: the gates and the room report progress; never read a pane for it" -> "End the turn until something arrives";
    "STOP: nothing arms; no background wait, watcher or sweep" -> "End the turn until something arrives";
    "Something arrives" -> "What arrived?";
    "What arrived?" -> "herd_gates {herd}: the gate push" [label="a gate push"];
    "What arrived?" -> "STOP: answer from the registry, never from the push text" [label="tempted to answer from the push text"];
    "STOP: answer from the registry, never from the push text" -> "herd_gates {herd}: the gate push";
    "What arrived?" -> "End the turn until something arrives" [label="a milestone announcement: its gate push wakes you"];
    "What arrived?" -> "herd_resume {herd}: after a relaunch" [label="a relaunch or compaction"];
    "What arrived?" -> "rt_verb {args: [pane, peek, <pane>]}: the unconsumed lane" [label="gate <id> UNCONSUMED in herd_status, or the watchdog's answered-and-unconsumed line"];
    "What arrived?" -> "Blocked notices for this job = 3?" [label="<job> blocked"];
    "What arrived?" -> "Report the crash with its job and pane" [label="<job> exited"];
    "What arrived?" -> "chat_dm {to: <job>, body: the ruling or findings}" [label="a ruling or findings for one worker"];
    "What arrived?" -> "Ask: let them finish, kill and respawn, or hold" [label="the user redirects scope"];
    "What arrived?" -> "Respawns of this job = 2?" [label="the user asks for a respawn"];
    "What arrived?" -> "Go to lanes and wrap-up" [label="a report line, or a nag about a done job's open pane"];
    "herd_gates {herd}: the gate push" -> "Open gates returned?";
    "herd_resume {herd}: after a relaunch" -> "Open gates returned?";
    "Open gates returned?" -> "Answer literally in the brief you wrote?" [label="yes"];
    "Open gates returned?" -> "End the turn until something arrives" [label="none: a stale id is normal"];
    "Answer literally in the brief you wrote?" -> "rt gate answer <id> --answers <json> --by shepherd" [label="yes"];
    "Answer literally in the brief you wrote?" -> "Present the open gates" [label="no"];
    "Present the open gates" -> "rt gate answer <id> --answers <json> --by shepherd" [label="the user answers"];
    "Present the open gates" -> "rt gate park <id>" [label="the user parks it"];
    "rt gate park <id>" -> "End the turn until something arrives";
    "rt gate answer <id> --answers <json> --by shepherd" -> "Answer recorded?";
    "Answer recorded?" -> "Spawn a reviewer chosen?" [label="recorded"];
    "Answer recorded?" -> "Say which answer won, in one line" [label="conflict: another surface answered first"];
    "Answer recorded?" -> "Answer retries = 2?" [label="refused"];
    "Say which answer won, in one line" -> "End the turn until something arrives";
    "Answer retries = 2?" -> "Fix the answers: each value verbatim" [label="no"];
    "Answer retries = 2?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "Fix the answers: each value verbatim" -> "rt gate answer <id> --answers <json> --by shepherd";
    "Spawn a reviewer chosen?" -> "End the turn until something arrives" [label="no"];
    "Spawn a reviewer chosen?" -> "Reviewer rounds on this milestone = 2?" [label="yes"];
    "Reviewer rounds on this milestone = 2?" -> "rt herd spawn --herd <id> --job review-<job> --brief <review brief> --dir <the job's tree> --disposable --model <model> [--account <A>]" [label="no"]; // <!-- mcp-lint: allow -->
    "Reviewer rounds on this milestone = 2?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "rt herd spawn --herd <id> --job review-<job> --brief <review brief> --dir <the job's tree> --disposable --model <model> [--account <A>]" -> "End the turn until something arrives"; // <!-- mcp-lint: allow -->
    "rt_verb {args: [pane, peek, <pane>]}: the unconsumed lane" -> "Is the lane alive?";
    "Is the lane alive?" -> "Nudges for this gate?" [label="alive"];
    "Is the lane alive?" -> "Smart-distribute pool in use?" [label="dead: a login expired, or no claude on it"];
    "Smart-distribute pool in use?" -> "Pick the account per the accounts rules" [label="yes"];
    "Smart-distribute pool in use?" -> "Respawns of this job = 2?" [label="no: relaunch on the same account"];
    "Nudges for this gate?" -> "chat_dm {to: <job>, body: call herd_answer for <gate>}" [label="0"];
    "Nudges for this gate?" -> "An idle prompt, and no form on screen?" [label="1: the DM was lost too"];
    "An idle prompt, and no form on screen?" -> "rt pane send <pane> --text <the same nudge>" [label="yes"];
    "An idle prompt, and no form on screen?" -> "Shepherd off-script gate: ask the user" [label="no: a form is up, or the pane is busy"];
    "Nudges for this gate?" -> "Shepherd off-script gate: ask the user" [label="2: budget spent"];
    "chat_dm {to: <job>, body: call herd_answer for <gate>}" -> "End the turn until something arrives";
    "rt pane send <pane> --text <the same nudge>" -> "End the turn until something arrives";
    "Blocked notices for this job = 3?" -> "herd_gates {herd}: the blocked job" [label="no"];
    "Blocked notices for this job = 3?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "herd_gates {herd}: the blocked job" -> "Open gate for the blocked job?";
    "Open gate for the blocked job?" -> "Present the open gates" [label="yes"];
    "Open gate for the blocked job?" -> "rt_verb {args: [pane, peek, <pane>]}" [label="none: the peek is now legitimate"];
    "rt_verb {args: [pane, peek, <pane>]}" -> "What does the pane show?";
    "What does the pane show?" -> "Accounts section non-empty?" [label="a rate-limit banner"];
    "What does the pane show?" -> "Ask: attend or close and respawn" [label="a dialog the watchdog parked"];
    "What does the pane show?" -> "herd_attend {job, herd}: a human is needed" [label="something only a human can answer"];
    "What does the pane show?" -> "End the turn until something arrives" [label="working after all"];
    "What does the pane show?" -> "STOP: never press keys into a modal or form; answer its gate" [label="tempted to send Escape or another key"];
    "STOP: never press keys into a modal or form; answer its gate" -> "herd_gates {herd}: the blocked job";
    "Accounts section non-empty?" -> "Pick the account per the accounts rules" [label="yes"];
    "Accounts section non-empty?" -> "Report the stall to the user" [label="no: nowhere else to launch"];
    "Pick the account per the accounts rules" -> "Respawns of this job = 2?" [label="an account picked"];
    "Pick the account per the accounts rules" -> "End the turn until something arrives" [label="wait or abandon"];
    "Report the stall to the user" -> "End the turn until something arrives";
    "Ask: attend or close and respawn" -> "herd_attend {job, herd}: the parked dialog" [label="attend"];
    "Ask: attend or close and respawn" -> "herd_close {job, herd}: parked, respawning" [label="close and respawn"];
    "herd_attend {job, herd}: the parked dialog" -> "End the turn until something arrives";
    "herd_close {job, herd}: parked, respawning" -> "Respawns of this job = 2?";
    "herd_attend {job, herd}: a human is needed" -> "End the turn until something arrives";
    "Report the crash with its job and pane" -> "End the turn until something arrives";
    "chat_dm {to: <job>, body: the ruling or findings}" -> "End the turn until something arrives";
    "Ask: let them finish, kill and respawn, or hold" -> "End the turn until something arrives" [label="let them finish, or hold"];
    "Ask: let them finish, kill and respawn, or hold" -> "herd_close {job, herd}: killed for new scope" [label="kill and respawn"];
    "herd_close {job, herd}: killed for new scope" -> "herd_brief {job, template, strategy, strategies, fill, out}: the new brief";
    "herd_brief {job, template, strategy, strategies, fill, out}: the new brief" -> "Respawns of this job = 2?";
    "Respawns of this job = 2?" -> "rt herd spawn --herd <id> --job <job> --dir <its tree> --model <model> [--brief <new brief>] [--effort <e>] [--account <A>]" [label="no"]; // <!-- mcp-lint: allow -->
    "Respawns of this job = 2?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "Respawns of this job = 2?" -> "STOP: herd_spawn never respawns; it takes no dir" [label="tempted to respawn through herd_spawn"];
    "STOP: herd_spawn never respawns; it takes no dir" -> "rt herd spawn --herd <id> --job <job> --dir <its tree> --model <model> [--brief <new brief>] [--effort <e>] [--account <A>]"; // <!-- mcp-lint: allow -->
    "rt herd spawn --herd <id> --job <job> --dir <its tree> --model <model> [--brief <new brief>] [--effort <e>] [--account <A>]" -> "End the turn until something arrives"; // <!-- mcp-lint: allow -->
    "Shepherd off-script gate: ask the user" -> "Off-script answer?";
    "Off-script answer?" -> "Make the recorded move once" [label="take the proposed move"];
    "Off-script answer?" -> "End the turn until something arrives" [label="hand back or hold"];
    "Make the recorded move once" -> "End the turn until something arrives";
}
```

### End the turn until something arrives

Nothing arms: no background wait, watcher or sweep. The daemon pushes gates
and room lines into this session. Never read a pane or scrollback when the
registry or the room has the answer. Your own posts to the herd room
deliver as `@here` and wake every worker, so a question for one worker is a
DM.

### Present the open gates

Present up to 4 open gates in one AskUserQuestion call:

- Each option's `label` (else its text) is the option text; its `description`, when the gate carries one, is the option description. The job's recommendation stays first. Never reword, merge or reorder options.
- A herd question gate (`kind: question`, subject `herd:<id>/<job>`): one sentence of your own naming the job and what it needs decided, then the form, whose question text is the gate question's `label`.
- Any other gate (a milestone, a pipeline-run or review gate): its full context.
- A milestone gate's options are fixed: **Approve** / **Revise** / **Spawn a reviewer**. On Revise, collect the user's feedback in the same form (or "see pane") into the answer's `note`.

Submit each answer's `value` verbatim; free text the user adds rides the
`note`. `--by shepherd` records which surface decided; the `gate_answer`
tool records the pane, so it is not your path. Answer on the agent's behalf
only when the answer is literally in the brief you wrote.

When the user parks a gate, `rt gate park <id>` pauses it: it leaves the
open list until reopened.

### Say which answer won, in one line

A conflict means another surface answered first. Name the winning answer
and the surface it came from; never re-ask.

### Fix the answers: each value verbatim

The refusal names the bad value or shape. Resend with each option's `value`
string exactly as the gate row gives it.

### Pick the account per the accounts rules

The Accounts section decides whether to respawn now or ask the user first.
Its pick is the `--account` on the shared respawn. Announce the respawn to
the user afterward. When the user chooses to wait or to abandon the job,
end the turn. A dead lane with a smart-distribute pool takes the same pick
before its respawn.

### Report the stall to the user

Single-account mode has nowhere else to launch. Name the job, its pane and
the limit banner.

### Ask: attend or close and respawn

The watchdog accepts trust and relocation dialogs itself and parks a job
that stays stuck (`stuck-at-modal` in `herd_status`). **Attend** opens the
pane so the user answers the dialog by hand. **Close and respawn** reuses
the stored brief. A respawn keeps neither `--effort` nor `--account` from
the prior spawn; pass them again.

### Report the crash with its job and pane

The pane died with the job live. Tell the user the job and the pane; never
respawn silently.

### Ask: let them finish, kill and respawn, or hold

One sentence naming the running agents, then the bare three options:
**Let them finish** (recommended) / **Kill and respawn with the new
briefs** / **Hold**. No restated heading, no per-option descriptions.

## What the watch loop cannot show

- **The push is transport.** A gate push is one line, `[gate] <id> is now open; re-read the gate registry.`, carrying only an id. Its arrival already proves the daemon, the subscription and the herd; the `herd_gates` read is the verification, made first, before any command of your own choosing. `herd_gates` defaults to `HERD_ID` or the single active herd (name the herd only when more than one is active), and also returns pipeline-run gates whose worktree belongs to one of your jobs. Room lines are pushed the same way: a report is `<job> #<n>: <body>` and a milestone is `<job> #<n>: milestone: <artifact>`. A stale id or an unrelated room line is a normal outcome of that read, never a reason to reach for another command first or to distrust the push.
- **Blocked diagnosis.** `<job> blocked` means the pane sat on a prompt for 30s. `herd_gates` comes first; its rows carry `presentation` and `owner`. Only "blocked, no open question, no open gate" makes the pane peek legitimate, never a hunch. `bg:` refs work for hidden herds.
- **Typing versus keys.** Typing a text nudge into a lane's prompt with `rt pane send <pane> --text <nudge>` is allowed when the prompt is idle and no form is on screen. Pressing keys into a modal or form (Escape, Enter, an option number) is forbidden: the daemon injects Escape itself when a form-presentation gate is answered elsewhere, and a keystroke into a pane on a background `rt gate wait` interrupts a worker that was never stuck. A gate row's `presentation` says which you face: `"form"` means answering the gate clears the form; `"wait"` means leave the pane alone.
- **Unconsumed answers.** The daemon already re-nudges the worker itself; what reaches you is `gate <id> UNCONSUMED` on a job in `herd_status`, or the watchdog's "answered Nm ago and unconsumed" line. Read the lane's pane first: a dead lane (a login expired, no claude on it) is a respawn, not a nudge. Nudge 0 is the DM. Nudge 1 types the same nudge, under the Typing versus keys rule above. After that, the off-script gate.
- **The disposable reviewer.** Its spawn line is the graph's node, in the job's own tree (`herd_spawn` would land it in a fresh one). Its brief reads the artifact, DMs the findings to the job's handle with `chat_dm`, and reports a verdict; the daemon closes its pane on that report. The job revises and opens a fresh milestone gate: every round is gate, DM, gate. You never read the artifact. With the Accounts section non-empty, it takes a per-spawn pick like any other spawn.
- **A bare pane form.** A worker pane showing a structured question with no gate behind it (`herd_gates` returns nothing for it) is the banned bare pane-local form, unreachable from every channel. Flag it to the user; never answer it yourself. Covered panes deny it at source through the launch-injected gate-fork hook, so seeing one means the pane is uncovered or its daemon was unreachable.

**The shared respawn.** A rate-limit stall (a limit banner in the peek), a
parked dialog, a dead lane and a kill all respawn with this one Bash line,
the graph's node (`--brief` only for a kill and respawn):

```bash
rt herd spawn --herd <id> --job <job> --dir <its tree> --model <model> [--brief <new brief>] [--effort <e>] [--account <A>]  # <!-- mcp-lint: allow -->
```

It is never `herd_spawn`: the tool takes no dir, and the job's tree stays
attached, closed or not, so a dir-less respawn fails `branch-attached`. The
daemon closes the old pane, reuses the stored brief unless `--brief` names
a new one, and relaunches in the same tree.

## Lanes and wrap-up

```dot
digraph shepherdr_lanes {
    rankdir=TB;

    "Trigger: a job's report, or a nag about a done job's open pane" [shape=ellipse];
    "rt_verb {args: [git, log], cwd: <worktree>}" [shape=plaintext];
    "cd <an active job's tree>" [shape=plaintext];
    "git diff --stat" [shape=plaintext];
    "More active job trees to diff?" [shape=diamond];
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
    "herd_spawn {herd, job: integration-<n>, brief, model, account?}" [shape=plaintext];
    "chat_dm {to: <job>, body: ship through your skill chain}" [shape=plaintext];
    "Gate: merge this lane?" [shape=box];
    "Forge?" [shape=diamond];
    "mr_merge {mrUrl}" [shape=plaintext];
    "gh pr merge <pr>" [shape=plaintext];
    "Merged on the repo?" [shape=diamond];
    "Did this lane claim the merge itself?" [shape=diamond];
    "Unmerged reports for this lane = 2?" [shape=diamond];
    "chat_dm {to: <job>, body: the measured merge state}" [shape=plaintext];
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

    "Trigger: a job's report, or a nag about a done job's open pane" -> "rt_verb {args: [git, log], cwd: <worktree>}";
    "rt_verb {args: [git, log], cwd: <worktree>}" -> "cd <an active job's tree>";
    "cd <an active job's tree>" -> "git diff --stat";
    "git diff --stat" -> "More active job trees to diff?";
    "More active job trees to diff?" -> "cd <an active job's tree>" [label="yes: the next one, the reporting job's first"];
    "More active job trees to diff?" -> "Drift outside the fence, or a file two jobs changed?" [label="no"];
    "Drift outside the fence, or a file two jobs changed?" -> "Flag the drift or collision to the user" [label="yes"];
    "Drift outside the fence, or a file two jobs changed?" -> "Relay only what you measured" [label="no"];
    "Flag the drift or collision to the user" -> "Relay only what you measured";
    "Relay only what you measured" -> "herd_status {herd}: the status table";
    "herd_status {herd}: the status table" -> "Does the report claim a merge?";
    "Does the report claim a merge?" -> "Merged on the repo?" [label="yes, or a nag about an open pane"];
    "Does the report claim a merge?" -> "Who merges this lane?" [label="no"];
    "Who merges this lane?" -> "Every lane job done?" [label="no domain rule: the integration job merges"];
    "Who merges this lane?" -> "chat_dm {to: <job>, body: ship through your skill chain}" [label="domain: the worker ships its own lane"];
    "Who merges this lane?" -> "Gate: merge this lane?" [label="domain: the shepherd merges after a gate"];
    "Does the report claim a merge?" -> "STOP: never merge, fix or push by hand; route by who merges" [label="tempted to merge, fix or push it yourself"];
    "STOP: never merge, fix or push by hand; route by who merges" -> "Who merges this lane?";
    "Every lane job done?" -> "Back to the watch loop: end the turn" [label="no"];
    "Every lane job done?" -> "Integration job spawned already?" [label="yes"];
    "Integration job spawned already?" -> "Ask the integration job's strategy and model" [label="no"];
    "Integration job spawned already?" -> "Unmerged reports for this lane = 2?" [label="yes: it reported no merge"];
    "Integration job spawned already?" -> "Ask the integration job's strategy and model" [label="yes, it has reported and this lane joined after it spawned: a new one for it"];
    "Integration job spawned already?" -> "Back to the watch loop: end the turn" [label="yes, and it is still running: wait for its report"];
    "Ask the integration job's strategy and model" -> "herd_brief {job: integration-<n>, template, strategy, strategies, fill, out}";
    "herd_brief {job: integration-<n>, template, strategy, strategies, fill, out}" -> "herd_spawn {herd, job: integration-<n>, brief, model, account?}";
    "herd_spawn {herd, job: integration-<n>, brief, model, account?}" -> "Back to the watch loop: end the turn";
    "chat_dm {to: <job>, body: ship through your skill chain}" -> "Back to the watch loop: end the turn";
    "Gate: merge this lane?" -> "Forge?" [label="merge"];
    "Gate: merge this lane?" -> "Back to the watch loop: end the turn" [label="not yet, or hold"];
    "Forge?" -> "mr_merge {mrUrl}" [label="GitLab"];
    "Forge?" -> "gh pr merge <pr>" [label="GitHub"];
    "mr_merge {mrUrl}" -> "Merged on the repo?";
    "gh pr merge <pr>" -> "Merged on the repo?";
    "Merged on the repo?" -> "Flip the lane's ticket, when it has one" [label="yes"];
    "Merged on the repo?" -> "Did this lane claim the merge itself?" [label="no"];
    "Did this lane claim the merge itself?" -> "Unmerged reports for this lane = 2?" [label="yes"];
    "Did this lane claim the merge itself?" -> "Back to the watch loop: end the turn" [label="no: it waits on the integration job or the gate"];
    "Did this lane claim the merge itself?" -> "Shepherd off-script gate: ask the user" [label="no: your own merge call did not land"];
    "Unmerged reports for this lane = 2?" -> "chat_dm {to: <job>, body: the measured merge state}" [label="no"];
    "Unmerged reports for this lane = 2?" -> "Shepherd off-script gate: ask the user" [label="yes: budget spent"];
    "chat_dm {to: <job>, body: the measured merge state}" -> "Back to the watch loop: end the turn";
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

Files outside the job's write fence are drift. A file two jobs both changed
is a collision. Flag it now, not at integration.

### Relay only what you measured

A worker's claims about its environment (servers up, ports free, processes
running, CI green) are its own account, routinely stale or wrong;
forwarding one as fact turns an unverified claim into something the user
reads as checked. Measure before you assert it:
`rt_verb {args: ["endpoint", "lookup", "<role>", "--path", "<the job's worktree>"]}`,
a `curl`, `lsof`, a CI status call. When you will not measure it, attribute
it: "the worker reports X".

### Ask the integration job's strategy and model

The same question as every job's, one AskUserQuestion: the tier table's
integration row is the recommendation, with the strategy half filled from
the strategy table. When the Accounts section is non-empty, keep the herd's
pool answer and make the per-spawn pick; pass it as `account` on the spawn.

### Gate: merge this lane?

Only when a bound domain part gives the shepherd the merge. One sentence
with the PR or MR link, its state and its CI, then **Merge** / **Not yet** /
**Hold**. A merge call that does not land goes to the off-script gate.

### Flip the lane's ticket, when it has one

Flip it before `herd_close`, in the same breath as the close. An
integration report that merges several lanes closes each of them here.

Nothing but you closes a done job's pane. The watchdog nags about a done
job's open pane past `herd.watchdog.nagMins` (default 30). For a merged
lane the nag means this step was skipped; for a lane still waiting on the
integration job or a merge gate it is normal, and you end the turn.

### Show the status table

Reformat `herd_status {herd}` for the user, flagging drift and failures:

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

Never auto-remove a tree or a job dir; the form's answer is the only
authority, and `herd_wrap_up` executes exactly it.

### Measure what still runs

The stop calls before this step cover every job in the dispose list plus every
job whose pane is closing. Their `repoName` is the herd's repo, and their
`tree` is the job's `tree` field from `herd_status`, a registry name, never a
path. A null tree (a job spawned in a given dir) is skipped unless that dir is
an rt tree; then pass the name
`rt_verb {args: ["worktree", "list", "--repo", "<the herd's repo>"]}` prints for it.
They run before `herd_wrap_up` because a disposed tree leaves rt's registry
and the call then fails.

`not-held` means rt has no recorded hold on the tree, not that nothing runs
there: rt records a hold only after the tree's MR merges or closes with a
process still inside, so a normal wrap-up tree answers `not-held` with its
dev servers up. The call ends only processes rt tied to a held tree; there
is no general kill.

Before you tell the user a job's servers are stopped, measure it:
`lsof -ti tcp:<port>` or the endpoint lookup. Report a survivor as still
running, never kill it by hand, and report anything unmeasured as "not
verified".

### Report the refusal in the guard's words

Quote the disposal refusal as the guard gave it. In hidden mode, also offer
the Bash command `rt herd stop --hidden` (no tool runs it); never run it unprompted. <!-- mcp-lint: allow -->

## What the lanes graph cannot show

- **The two objective checks.** The commits come from the graph's `rt_verb` git log call on the job's worktree. The changed files come from two separate Bash calls per active job: the `cd` alone, then the bare `git diff --stat`; never chain them. Compare each job's files against its write fence and across jobs.
- **Job state is the daemon's.** It marked the job `done` when the report was published; `herd_status` is the status table's source. Nothing to record by hand.
- **A report is a claim, not a merge.** Answer "Merged on the repo?" from the repo itself (`gh pr view --json state,mergeCommit`, or the sha on `origin/main`), never from the report alone.
- **The integration job.** Its brief merges or cherry-picks the job branches, runs full verification, and reports; it carries the repo's shipping conventions. Never merge, fix or push on the agents' behalf. The first is `integration-1`; a lane that joined the herd after it spawned gets the next number, and its brief covers only the lanes no integration job has merged.
- **Domain hook: after the report.** Unbound: the integration job merges. A bound domain part may define what follows a job's report (the worker ships through its own skill chain, or the shepherd merges after a gate; how several jobs feeding one deliverable integrate) and whether that step waits for the user to ask. Fixing and pushing stay with workers either way.
- **Domain hook: wrap-up.** Unbound: as drawn. A bound domain part may state its own tree lifecycle (trees that dispose themselves when their work merges, what a disposal refusal means); follow it over the disposal defaults here.

## wrap-up form contract

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

<!-- part: include:wrap-up-form source=mattstack:wrap-up-form version=0.26.1 path=attachments/wrap-up-form/SKILL.md lines=7-33 -->
# Wrap-up

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

## Rationalizations

| Thought | Reality |
| --- | --- |
| "I'll read the spec just to check it." | Doorbell the user or spawn a reviewer; artifacts are never yours to read. |
| "These options read better reworded, merged or reordered." | Relay options and values exactly; only a herd question's context is yours to condense. |
| "This spawn can take the default model." | A spawn without a model launches on the default and silently defeats tiering. |
| "Opus is safer for this execution job." | A fully specified execution job is mechanical; Sonnet handles it and Opus overspends. |
| "I'll ask the account question first to save a round." | Models come first: some providers budget per-model pools, so model-blind headroom misleads. |
| "The recommendation is obvious; I'll pick the strategy and model." | The choice is the user's; only a bound domain pin or floor closes a half. |
| "Writing the Method prose myself is faster." | `herd_brief` copies the template and strategy body; `methodFile` is the only path for a domain Method. |
| "`herdr agent prompt` reaches the worker faster." | `chat_dm` is the channel, and it is on the record. |
| "I'll tell the worker to revise." | Revise is a gate answer with a note; findings are a DM. |
| "I'll mark this job done, closed or crashed myself." | The herd tools and the daemon own job state. |
| "I remember this herd, or I need its run id to pick it up." | `herd_resume {herd}`; `herd_list` names every active herd, so there is no id to hunt. |
| "I know what that check would show." | Output not in your transcript was never run; run it or say it has not run, and never invent a fact to back a claim. |
| "The tool seems unreachable; I'll use another channel." | Report the real error and wait; never substitute a channel of your own making. |
| "I could decide this question for the agent." | Relay it; answer for the agent only when the answer is literally in the brief. |
| "Event-driven, so the loop needs no budget." | The per-job counters (respawns, blocked notices, nudges, reviewer rounds, unmerged reports) are the budget. |
