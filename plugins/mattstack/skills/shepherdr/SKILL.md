---
name: "shepherdr"
description: "Use when fanning work out across parallel Claude Code agents in herdr panes in a repo no team pack covers -- 'shepherdr', 'fan out', 'spawn agents', 'split this across agents', 'run these in parallel', 'spread this across my accounts'. Domain-unbound: where a team pack compiles its own shepherdr, that verb wins. Requires a running herdr instance."
allowed-tools:
  - "Bash(*/scripts/pick-account.py:*)"
metadata:
  compiled: "mattstack@0.11.0 + mattstack:model-tiering@0.11.0 + mattstack:execution-strategy@0.11.0 + mattstack:cswap-accounts@0.11.0"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: step source=mattstack:shepherdr version=0.11.0 path=attachments/orchestration/shepherdr/SKILL.md lines=15-431 -->

# shepherdr

You are the shepherd: a thin delegator, not a reviewer. You break work into jobs, spawn an agent per job (own herdr pane, own git worktree), watch status transitions, and route small structured messages between the user and the herd. Which model, which method, and where to launch are policy questions answered by the bound skills below; you are transport -- allocate, spawn, watch, relay, integrate.

**Your context is the most expensive context in the system.** Everything you read is re-billed on every later turn. The discipline that follows:

- Agents talk to you through rows in the herd DB (read via the herd-* scripts), never through scrollback; the only job-dir file is job.md, the brief. Read a pane only to diagnose an agent that went silent without publishing, or crashed.
- You never read specs, plans, diffs, or code. Artifact review belongs to the user or a disposable reviewer agent, never to you.
- You never do hands-on work: no merging, no fixing, no pushing. Integration is itself a job.

For herdr CLI mechanics, load the `herdr` skill.

## when not to herd

A small, fully specified execution fan-out with no expected questions, no
need for account spreading, and no need to watch or steer live belongs on
the Agent tool, not panes. The herd
earns its keep through account distribution, mid-flight interaction
(question relay, artifact gates), live visibility, and crash-survivable
jobs. If none of those apply, say so and dispatch subagents instead.

## prerequisites

1. Confirm `HERDR_ENV=1`. If not set, stop -- you need to be running inside herdr.
2. Load the `herdr` skill from `~/.claude/skills/herdr/SKILL.md`. If missing, install:
   ```bash
   mkdir -p ~/.claude/skills/herdr
   curl -fsSL https://raw.githubusercontent.com/ogulcancelik/herdr/master/skills/herdr/SKILL.md -o ~/.claude/skills/herdr/SKILL.md
   ```
3. Run `herdr pane list` to find your own pane id and layout.
4. Scripts referenced below live in this skill's `scripts/` directory.

## herd session: invisible panes

When the user asks for the herd to stay out of sight ("invisible",
"background", "headless"), read `references/herd-session.md` and follow
it. Do not load it otherwise.

## job types

**Execution job** -- fully specified up front. Brief in, report out, zero questions expected. Use when the work is known: a plan exists, findings are verified, the refactor is scoped.

**Design job** -- questions are expected during the run: method choices, artifact gates, and mid-run touchpoints all flow through the question contract below. N design jobs = N parallel brainstorms; the user answers one agent's question while the others think.

If work arrives unscoped and the user wants it scoped before fan-out, brainstorm with them directly yourself (no pane, no relay), then spawn execution jobs from the result.

## Tiering

<!-- part: slot:tiering binding=mattstack:model-tiering version=0.11.0 path=attachments/model-tiering/SKILL.md lines=8-117 -->
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

<!-- part: slot:strategy binding=mattstack:execution-strategy version=0.11.0 path=attachments/execution-strategy/SKILL.md lines=8-90 -->
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

Copy the assigned strategy's body from `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md` verbatim
into the brief and fill its `<angle-bracket>` slots. Do not compose method
prose per job; the bodies carry the worker-boundary rules and the report
contract.

`accounts` may be unbound -- that is single-account mode, handled below.

### the domain slot

`domain` is optional. The hooks below name where a bound domain part's
rules win over this engine's default: intake (step 1), the model floor
and strategy pin (the strategy and model question), provisioning (step
2), the brief's Method and conventions (job.md), what follows an
approved report (completion), and wrap-up. A domain part never changes
the herd contract itself -- questions and reports still flow through the
herd DB, and the watch in step 3 is still yours.

## Domain rules



When nothing is inlined above, every default in this engine stands as
written.

### the strategy and model question (per job)

Strategy predicts the work shape, and the work shape predicts the tier,
so they are one choice. Derive a per-job recommendation -- strategy from
the bound strategy table, model from the bound tier table -- then ASK: one
structured question per job (AskUserQuestion, single choice, batched up
to 4 jobs per call), the recommendation first and marked "(Recommended)"
with both halves in the label ("superpowers, opus" / "direct-tdd,
sonnet"), then 2-3 curated alternates spanning the tiers. One keystroke
accepts; "Other" free-text is automatic.

**Effort is a session default, not a question.** Per the bound tiering
skill, use the model's default effort and deviate only when the user
names a reason.
Pass `-m <model>` on every spawn and `-e <effort>` only when an override
was chosen. A spawn without `-m` inherits your session model, which
silently defeats tiering.

This question comes BEFORE the account question: some providers budget
per-model pools separately, so account headroom cannot be presented
honestly until the herd's model mix is known.

**Domain hook -- model floor and strategy pin.** Unbound: both halves are
open and the tier table's recommendation stands. A bound domain part may
set a model floor for a class of work and pin the strategy half (its own
method skill is the brief's Method); then the recommendation starts at
that floor, the question carries only the half still open, and a spawn
below the floor is wrong.

## Accounts

<!-- part: slot:accounts binding=mattstack:cswap-accounts version=0.11.0 path=attachments/cswap-accounts/SKILL.md lines=9-74 -->
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
${CLAUDE_SKILL_DIR}/parts/accounts/scripts/pick-account.py --headroom --pool 1,2,3 --model fable,sonnet
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
ACCT=$(${CLAUDE_SKILL_DIR}/parts/accounts/scripts/pick-account.py --pool 2,3 --model <model> --assigned <accounts-already-assigned>)
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

cswap sessions share settings and skills but not plugin caches, so
missing-plugin symptoms in worker panes are expected -- do not chase them.

When the section above is non-empty, follow it: it owns the pool
question (asked once per herd, AFTER models are chosen), the per-spawn
pick, and the exhaustion decision tree. Pass the launch command it
prescribes to spawn-agent.sh via `-L`. Empty: single-account mode -- no
account question, spawns omit `-L`, and workers launch as plain `claude`.

If a worker stalls on a rate limit mid-job (the diagnose read shows a
limit banner): the accounts rules above decide whether to respawn
automatically or ask the user; the respawn itself is yours. Run
`herd-job.py --db <db> <job> --status closed` before closing the pane,
then obtain the new launch command, and respawn into the SAME worktree
with `spawn-agent.sh -d <original worktree> -D <db> -R <run>`. `-d` mode
derives its job dir from the directory's basename, which is wrong for a
respawn (`-d ~/.mattstack/shepherdr/worktrees/<repo>/<job>` computes job dir
`~/.mattstack/shepherdr/jobs/<job>/<job>`, not the original
`~/.mattstack/shepherdr/jobs/<repo>/<job>`), so always pass `-k` yourself with a
kickoff that names the ORIGINAL job dir explicitly, adapting
spawn-agent.sh's default kickoff: "Your job directory is <original job
dir> -- it is outside the repo, and holds only job.md, the brief;
questions and reports go through the herd DB, never files in the repo or
worktree. A previous agent
started this job and hit a rate limit; check git log and the job
directory, then continue and complete the brief in <original job
dir>/job.md; its ## Method section names the method to run, and its
verification must pass. Work only inside this worktree and write only
within the brief's write fence. To ask the user a question, run the
exact command in the brief's 'Asking the user a question' section, then
stop and wait; the answer arrives as your next message. Every question
is multiple choice; the first option is your recommendation. To publish
a report (at completion, or at a Method milestone), follow the brief's
'Publishing a report' section, then stop. If a publish command fails,
stop and wait -- never invent another channel. Commit incrementally on
this branch; never push." Announce the respawn to the
user afterward. With the accounts section above empty there is nowhere
else to launch; report the stall to the user instead.

## the herd contract

All shepherd-agent communication flows through the run's herd DB
(`~/.mattstack/shepherdr/runs/<run>/herd.db`) plus one file:
`~/.mattstack/shepherdr/jobs/<repo>/<job>/job.md`, the brief, copied in by
spawn -- outside every repo. Workers publish questions and reports with
the scripts named in their brief; each publish rings an rt event doorbell
so you wake only for real messages. Mechanics, schema, and every command:
`references/herd-bus.md` (REQUIRED read at herd start).

### job.md: two verbatim copies

Every brief is assembled from two verbatim copies, never composed:

1. Copy `references/job-template.md` (in this skill's directory) verbatim
   and fill its slots.
2. Copy the job's strategy body verbatim from
   `parts/strategy/references/strategies.md` in this skill's directory
   into `## Method` and fill its slots.

Do not retype either from memory: the question format the template embeds
and the report contract the body embeds are the workers' only guaranteed
copy of the contract.

**Domain hook -- the Method copy.** Unbound: the two-copy assembly as
written. A bound domain part may supply the `## Method` block itself (its
team's pipeline skill is the method); then no strategy body is copied in,
the strategies-file slots are not filled, and the report contract is
whatever that method skill produces. The template's remaining sections
still copy verbatim -- the question and report channels never change.

Fill the Method body's `<question-file>`/`<report-file>` slots with
pointers to the brief's 'Asking the user a question' / 'Publishing a
report' sections (the draft path is `.superpowers/report-draft.md`). A
`<strategies-file>` slot gets the absolute path of the strategy bodies
file itself: `parts/strategy/references/strategies.md` under this
skill's directory. A `<strategy-skill-file>` slot gets the absolute path
of the file carrying the strategy TABLE: this skill's own SKILL.md,
whose strategy part carries it. The strategy skill stays
medium-agnostic.

## repo conventions travel in the brief

A herd pane is a real `claude` session in a real git worktree: user-level
plugins, skills, rules, and the repo's tracked conventions (CLAUDE.md,
AGENTS.md, tracked `.claude/skills/`) load normally. What does NOT
survive is untracked state -- `node_modules`, `.env`,
`settings.local.json`, gitignored directories -- and skills fire by
description match, not by path, so a gate nobody names may never load.

Before writing briefs, collect the repo's development conventions from two places: workflow rules already loaded in your session, and the repo's convention docs (CLAUDE.md, AGENTS.md, CONTRIBUTING or equivalent). This read is orchestration input, not artifact review -- it is permitted; specs, plans, diffs, and code stay off limits.

The `Repo conventions` section contains exactly three things: the gate
skills that bind this job, named with absolute paths; task A0 for
untracked state (dependency install, env or secrets sync); and the
branch name. Everything else a convention says lives in the skill that
owns it.

- **Branch naming**: the name you pass to spawn's `-b`. If branches derive from tickets, resolve the ticket first. No repo rule = any name; branches that never ship are ephemeral.
- **Shipping process** (target branch, MR conventions, CI): goes in the integration job's brief, including where shipped work must land if the repo's workflow dictates it.

**Domain hook -- conventions.** Unbound: the three items above. When the
bound domain part's method skill owns the repo's conventions, the `Repo
conventions` section names only the branch; gates, process, and evidence
come from the skill chain the worker loads, and a brief that restates
them competes with that chain.

## step 1: specify jobs

**Domain hook -- intake.** Unbound: the jobs come from what the user
hands you; invoked with nothing, ask what to fan out. A bound domain part
may define a default intake for the empty invocation (a ticket queue, a
board column) -- follow it and spawn one job per item it yields.

Decompose into independent jobs. Good decomposition:

- Disjoint file ownership per job -- the write fence.
- Item-coded task lists (A1, A2...) where the strategy produces items, so those reports are checkable at a glance.
- Each job has a clear deliverable and can run without another job's output. Sequential work (B needs A) spawns B after A's report event arrives.
- Cap ~6 agents per batch.

Write each brief to the scratchpad, one file per job, using the two-copy assembly above.

**Single-job case:** if decomposition yields exactly one job, push back: tell the user "this is probably not the right skill for this" and do the work yourself, here in the main pane. Never spawn a single pane -- one agent behind a relay is pure overhead. Still create the worktree (`~/.mattstack/shepherdr/worktrees/<repo>/<job>/`, same creation steps) so the work stays isolated from the user's checkout. The delegator rules above don't apply -- work hands-on as normal. A bound domain part may name the one legitimate single-worker exception; apply it.

## step 2: spawn

Placement, auto-decided: 1-2 agents same repo = split panes; 3+ = tab per agent; different repos = workspace per repo. `--no-focus` on everything.

Labels carry location: the sidebar label is the only thing that tells the user where a pane's files live. Job tabs are labeled `<worktree-name>: <job>` (spawn-agent.sh builds this itself); any tab you create by hand in an existing workspace follows the same form, `<worktree-name>: <purpose>`.

**Herd start:** run `scripts/herd-init.py --repo <repo>` once; it prints
`{run, db, mode, cursor}`. `mode: "degraded"` = run today's watch loop
(see herd-bus.md) -- everything else below is identical. Resuming an
interrupted herd? `herd-init.py --resume <run-dir>` instead -- see
herd-bus.md's resume procedure.

**Domain hook -- provisioning.** Unbound: the rt-first flow below. A
bound domain part that owns provisioning (how the unit of work is
resolved, the exact `rt worktree provision` invocation, which spawn flags
and placement follow) replaces that flow; the error rules below still
apply to the call it prescribes.

**Worktree acquisition: try `rt` first.** Before spawning, try:

```bash
rt worktree provision --repo <repo> --branch job/<job> --disposal job --owner <run-id> --json
```

- `ok`: pass `-d <data.path>` to spawn-agent.sh below (existing-dir mode,
  no `git worktree add`). A cold create (`wasOnDeck:false`) can take
  minutes -- tell the user it's provisioning.
- `command not found` (rt absent): fall back to the legacy flow -- pass
  `-b <branch>` and let spawn-agent.sh run `git worktree add` at
  `~/.mattstack/shepherdr/worktrees/<repo>/<job>/` itself.
- Any other rt error: report it, don't hand-roll a tree.

Spawn each agent with the script (worktree + tab + claude + readiness wait + kickoff in one call):

```bash
OUT=$(scripts/spawn-agent.sh -j my-job (-d <rt-tree-path> | -b <branch>) -m <model> [-e <effort>] -J /path/to/brief.md -w <workspace-id> -D <db> -R <run> [-S <strategy>] [-A <account>] [-L "<launch command>"])
PANE=${OUT%% *}; TARGET=${OUT##* }
```

`<model>` comes from the strategy and model question, `<effort>` from the
session default when overridden, and the `-L` launch command from the
bound accounts skill's picker when the herd is account-distributed. `-D`
and `-R` are the DB path and run id from herd-init.py; `-S`/`-A` record
this job's strategy and account on its jobs row.

It prints the pane id and the agent's name; use the name (`$TARGET`) for
every later agent command. Readiness and kickoff submission are native
(`agent wait`, `agent prompt`); a spawn that cannot reach a ready agent
fails loudly. Stagger launches for 4+ agents: spawn
one, confirm it returned, spawn the next.

Agents never work in the user's checkout. Skip isolation only for
read-only jobs or when the user explicitly says to work in place. The
member's working directory must be a **linked worktree** -- that is what
superpowers' worktree Step 0 tests, and what makes the member skip
creating another. Both `-d <rt-tree-path>` and `-b <branch>` satisfy this
by construction; a `-d` pointed at a plain clone leaves the member asking
to create a worktree with nobody to answer.

## step 3: watch

Set up immediately after spawning; then do nothing until an event fires.

**The bus wait** (background Bash):

```bash
scripts/herd-wait.sh --db <db>
```

**The bridge** (background Bash), watching active jobs and turning pane
lifecycle into `blocked`/`gone` events:

```bash
scripts/herd-bridge.py --db <db>
```

`herd-wait.sh` exits tell you what happened:

| exit | meaning | act |
|---|---|---|
| 0 | events (stdout JSON) | handle each by topic, re-arm |
| 124 | 15m sweep | `hrd pane list`; cross-check settled panes against open questions / unhandled reports; a blocked pane the bus never announced = bridge sick (respawn it, say so); re-arm |
| 1 | bus unrecoverable (CLI could not reach or restart the daemon) | announce, switch to degraded |

### when an event fires

| Topic | Action |
|---|---|
| question | `herd-read.py --db <db> question <qid>`, relay (below) |
| report | `herd-read.py --db <db> report <rid>`, completion (below) |
| blocked | Check open questions first (`herd-read.py --db <db> open-questions`); only then read the pane |
| gone | Active jobs row = crash: report to user with pane id, `herd-job.py --db <db> <job> --status crashed`. Non-active (already closed) = deliberate close, skip |

Never read scrollback when the DB has the answer.

## question relay

1. `herd-read.py --db <db> question <qid>`. Skip unless `status: open`.
2. If `needs: pane`: doorbell the user -- "agent <job> needs you in pane <id>" -- and do not relay. In a herd session the pane is invisible, so put it in front of them: `scripts/attend.sh <pane-id> -l <job>`, tell them to detach with `ctrl+b q`, and close the tab it prints once they are done. Afterwards, `herd-answer.py --db <db> --qid <id> --pane-handled`.
3. Doorbell before relaying: `herdr notification show "<job> needs you" --body "<one-line question>" --sound request` (plain herdr, never the hrd shim -- notifications target the attached UI even when the herd is invisible). On full-herd completion at wrap-up, send one with `--sound done`.
4. Batch: if other agents also have pending questions, present up to 4 together in one AskUserQuestion call. Options verbatim, agent's recommendation first.
5. If an agent wrote an open-ended question anyway, synthesize the options yourself (its recommendation first, then the obvious alternatives) so the user can navigate and hit enter.
6. Relay the answer in the exact shape the agent expects -- bare number ("2"), bare letter, "yes". Free-text answers relay verbatim, never interpreted or expanded:
   ```bash
   scripts/herd-answer.py --db <db> --qid <id> --target $TARGET "2"
   ```
7. Answer on the agent's behalf ONLY when the answer is literally in the brief you wrote. Everything else goes to the user.

## artifact gates (design jobs)

When a report announces `spec:` or `plan:`, doorbell the user with a multiple-choice question: 1. Approved, tell it to proceed / 2. I left feedback in the pane, tell it to revise / 3. Spawn a reviewer agent first. You do not read the artifact. If the user picks 3, spawn a disposable reviewer agent in a new pane whose report is a verdict.

## completion

On a report:

1. `herd-read.py --db <db> report <rid>`. Skip if it renders `(handled)` --
   a replayed or duplicate event for a report already handled.
2. Two objective checks:
   ```bash
   git -C <worktree> log --oneline
   git -C <worktree> diff --stat
   ```
   Compare against the write fence. Files outside the fence = drift; flag it to the user.
3. `herd-job.py --db <db> <job> --status done --handled <rid>`.
4. Update the status table.

When all jobs are done, **integration is its own job**: spawn an agent whose brief is to merge/cherry-pick the job branches, run full verification, and report. Its brief carries the repo's shipping conventions. You never merge, fix failures, or push with your own hands.

**Domain hook -- after the report.** Unbound: integration as above. A
bound domain part may define what follows an approved report -- telling
the worker to ship through its own skill chain, how several jobs feeding
one deliverable integrate -- and whether that step waits for the user to
ask. Either way the hands-on work stays with workers, never with you.

## mid-flight changes

If the user redirects scope: ask whether to let running agents finish or kill them. Before any kill, `herd-job.py --db <db> <job> --status closed`, then `scripts/hrd pane close <pane-id>`; respawn with updated briefs.

## wrap up

1. Status table: `herd-read.py --db <db> log`, reformat for the user:
   ```
   | job | pane | account | strategy | status | summary |
   |-----|------|---------|----------|--------|---------|
   | api tests | 1-3 | 2 | direct-tdd | done | A1-A4 done, 12 tests, suite green |
   ```
2. Flag drift and failures.
3. Gate `wrap-up`, one form (the wrap-up form contract below): **Close
   the panes** (recommended when every job is done) / **Keep them for
   review**; a multi-select of the trees to dispose, none pre-selected
   (an `rt`-provisioned tree with unmerged work is listed but noted, the
   guard will refuse it); **Delete the job dirs** (yes / no); **Hold**.
   For each pane you close, run `herd-job.py --db <db> <job> --status
   closed` first. Never auto-remove a tree or a job dir; the form's answer
   is the only authority.
4. Cleanup mechanics, on the answers:
   For an `rt`-provisioned tree: `rt worktree dispose --owner <run-id>`
   (the guard refuses real unmerged work; a `remove-failed` refusal is
   transient -- retry). For a legacy `-b` tree: `git worktree remove
   <path>`. Job dirs: `rm -r ~/.mattstack/shepherdr/jobs/<repo>/<job>`. In a herd
   session, also offer `scripts/herd-session.sh stop`. The run dir
   `~/.mattstack/shepherdr/runs/<run>` is the run log -- retain it; deleting
   it is only ever an explicit user ask.
5. Never push on the agents' behalf.

**Domain hook -- wrap-up.** Unbound: as above. A bound domain part may
state its own tree lifecycle (trees that dispose themselves when their
work merges, what a disposal refusal means) -- follow it over item 4.

## wrap-up form contract

<!-- part: include:wrap-up-form source=mattstack:wrap-up-form version=0.11.0 path=attachments/wrap-up-form/SKILL.md lines=7-32 -->
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

## red flags -- stop yourself

- About to read a pane "to see how it's going"? Stop. The wait will tell you.
- About to read a spec "just to check it"? Stop. Doorbell the user or spawn a reviewer.
- About to fix a test or merge a branch yourself? Stop. That is an integration job.
- About to summarize an agent's question in your own words? Stop. Relay verbatim.
- Spawn command without `-m`? The worker inherits your model -- probably the most expensive one.
- Spawning Opus for a fully-specified execution job? That's overspending. Sonnet handles mechanical work.
- Target agents by job name; if a name fails to resolve, re-read herdr agent list -- never guess.
- Prioritize responding to the user over monitoring.
- About to compose method prose for a brief instead of copying a strategy body? Stop. The body is the contract; copy it verbatim and fill its slots -- unless a bound domain part supplies the `## Method` block (see the Method-copy hook).
- About to ask the account question before models are chosen? Stop. Some providers budget per-model pools separately; model-blind headroom is misleading.
- About to pick a strategy or model per job without asking? Stop. The bound skills give you the recommendation; the choice is the user's -- a bound domain part may pin the strategy half or set a floor (see the model-floor hook), and only the half still open is asked.
- About to compose SQL against herd.db? Stop -- herd-read/herd-answer/herd-job are the only DB surface.
- About to close a pane without `herd-job.py --status closed`? Stop -- the bridge will report a phantom crash.
- Sweep found a blocked pane the bus never announced? The bridge is sick -- respawn it and say so.
