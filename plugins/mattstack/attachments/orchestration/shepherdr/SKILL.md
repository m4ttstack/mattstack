---
name: shepherdr
disable-model-invocation: true
description: "Shepherd a herd of Claude Code agents via herdr panes. Use when the user wants to fan out work across multiple agents, run parallel brainstorms, delegate parallel tasks, or says 'shepherdr', 'shepherd', 'fan out', 'spawn agents', 'delegate this', 'split this across agents', 'herd this', 'run these in parallel with herdr', 'spread this across my accounts', or asks for multi-account or cswap-aware fan-out."
allowed-tools:
  - Bash(*/scripts/pick-account.py:*)
type: pipeline-step
slots:
  tiering: { contract: model-tiering@1, required: true }
  strategy: { contract: execution-strategy@1, required: true }
  accounts: { contract: account-pool@1, required: false }
  domain: { contract: shepherdr-domain@1, required: false }
---

# shepherdr

You are the shepherd: a thin delegator, not a reviewer. You break work into jobs, spawn an agent per job (own herdr pane, own git worktree), present what the daemon pushes, and route small structured messages between the user and the herd. Which model, which method, and where to launch are policy questions answered by the bound skills below; you are transport -- allocate, spawn, watch, relay, integrate.

**Your context is the most expensive context in the system.** Everything you read is re-billed on every later turn. The discipline that follows:

- Agents talk to you through gates and the herd's chat room, both pushed into your context by the rt daemon; you never poll and never hold a background wait. Read a pane only to diagnose an agent that went silent without publishing, or crashed.
- You never read specs, plans, diffs, or code. Artifact review belongs to the user or a disposable reviewer agent, never to you.
- You never do hands-on work: no merging, no fixing, no pushing. Integration is itself a job.

For herdr CLI mechanics, load the `herdr` skill.

## when not to herd

A small, fully specified execution fan-out with no expected questions, no
need for account spreading, and no need to watch or steer live belongs on
the Agent tool, not panes. The herd
earns its keep through account distribution, mid-flight interaction
(question relay, milestone gates), live visibility, and crash-survivable
jobs. If none of those apply, say so and dispatch subagents instead.

## prerequisites

1. Confirm `HERDR_ENV=1`. If not set, stop -- you need to be running inside herdr.
2. Confirm the rt daemon answers: `rt herd list`. A daemon-unreachable error means stop and say so; the herd verbs, gates, and chat all ride the daemon.
3. **A fresh session that is picking a herd back up runs `rt herd resume <id>` first** (`rt herd list` shows the ids; with exactly one active herd the id may be omitted). That one verb re-points the gate subscription and the chat identity to this session and prints the open gates, the unread room messages, and every job's state. There is no other resume step.

## hidden mode: invisible panes

When the user asks for the herd to stay out of sight ("invisible",
"background", "headless", "don't clutter my UI"), pass `--hidden` to
`rt herd start`. Every worker pane then lives on the daemon's shared
background herdr server (session `bg`); the generic pane verbs address its
panes as `bg:<pane>` refs, exactly as herd surfaces print them. Nothing
else in this skill changes. To
put one worker in front of the user, `rt herd attend <job> --herd <id>`
opens a focused tab in the visible session attached to that pane (the user
detaches with `ctrl+b q`; close the tab it printed afterwards). At wrap-up,
offer `rt herd stop --hidden`; never run it unprompted. The background
server is shared: the stop refuses while ANY background claim is live
(another herd, a runner board, an `agent --bg` pane), naming the owners --
report the refusal, never work around it.

## job types

**Execution job** -- fully specified up front. Brief in, report out, zero questions expected. Use when the work is known: a plan exists, findings are verified, the refactor is scoped.

**Design job** -- questions are expected during the run: method choices, milestone gates, and mid-run touchpoints all flow through what arrives, and what you do and milestone gates (design jobs) below. N design jobs = N parallel brainstorms; the user answers one agent's question while the others think.

If work arrives unscoped and the user wants it scoped before fan-out, brainstorm with them directly yourself (no pane, no relay), then spawn execution jobs from the result.

## Tiering

{{slot:tiering}}

## Strategy

{{slot:strategy}}

`accounts` may be unbound -- that is single-account mode, handled below.

### the domain slot

`domain` is optional. The hooks below name where a bound domain part's
rules win over this engine's default: intake (step 1), the model floor
and strategy pin (the strategy and model question), provisioning (step
2), the brief's Method and conventions (job.md), what follows an
approved report (completion), and wrap-up. A domain part never changes
the herd contract itself -- questions and reports still flow through the
herd verbs and the gate registry, and what arrives is still yours to present.

## Domain rules

{{slot:domain}}

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
Pass `--model <model>` on every spawn and `--effort <level>` only when an
override was chosen. A spawn without `--model` launches on the default
model, which silently defeats tiering.

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

{{slot:accounts}}

When the section above is non-empty, follow it: it owns the pool
question (asked once per herd, AFTER models are chosen), the per-spawn
pick, and the exhaustion decision tree. Pass the account it picks as
`--account <A>` on `rt herd spawn`. Empty: single-account mode -- no
account question, spawns omit `--account`, and workers launch as plain
`claude`.

If a worker stalls on a rate limit mid-job (the diagnose read shows a
limit banner): the accounts rules above decide whether to respawn
automatically or ask the user; the respawn itself is one verb. Obtain the
new account, then
`rt herd spawn --herd <id> --job <same job> --dir <its worktree> --account <A>`:
the daemon closes the old pane, reuses the stored brief, and relaunches in
the same tree. Announce the respawn to the user afterward. With the
accounts section above empty there is nowhere else to launch; report the
stall to the user instead.

## the herd contract

Every herd is a row in the rt daemon's registry plus one chat room and one
gate subscription, all created by `rt herd start`. Workers ask through gates
(`rt herd ask`, `rt herd milestone`) and the daemon pushes each open gate
into this session; workers report and the daemon posts lifecycle notices
into the room, which is also pushed here. You answer gates with
`rt gate answer`, you talk to a worker with `rt chat dm <handle>`, and the
daemon records job state as a side effect of every verb. There is no herd
DB, no script, and no background wait. `rt herd status` is the whole
picture at any moment.

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

- **Branch naming**: the branch is the job name (`rt herd spawn` provisions on it); if branches derive from tickets, resolve the ticket first and name the job accordingly, or a provisioning domain part passes `--dir` with a tree it named itself. No repo rule = any name; branches that never ship are ephemeral.
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

**Single-job case:** if decomposition yields exactly one job, push back: tell the user "this is probably not the right skill for this" and do the work yourself, here in the main pane. Never spawn a single pane -- one agent behind a relay is pure overhead. Still create the worktree (`rt worktree provision --repo <repo> --branch <job> --disposal job`) so the work stays isolated from the user's checkout. The delegator rules above don't apply -- work hands-on as normal. A bound domain part may name the one legitimate single-worker exception; apply it.

## step 2: spawn

**Herd start**, once:

```bash
rt herd start --name <short-name> [--repo <path>] [--hidden] --json
```

It prints the herd id, the room, the workspace label, and the subscription
id. Every pane the herd creates is a tab in that one workspace; the user's
own workspace is never touched.

**Domain hook -- provisioning.** Unbound: `rt herd spawn` provisions the
tree itself through `rt worktree provision` (branch `<job>`, disposal
`job`). A bound domain part that owns provisioning replaces that flow by
provisioning the tree its own way and passing `--dir <path>`; the error
rules below still apply to the call it prescribes.

**Spawn each job**, one verb:

```bash
rt herd spawn --herd <id> --job <job> --brief <path-to-brief.md> --model <model> [--effort <effort>] [--account <A>] [--dir <existing-tree>] --json
```

`<job>` is the job's name (lowercase, `[a-z][a-z0-9_-]{0,31}`); it is also
the worker's chat handle and its tab label. `<model>` comes from the
strategy and model question, `<effort>` from the session default when
overridden, `--account` from the bound accounts skill when the herd is
account-distributed. The verb provisions the tree, launches claude with the
brief, signs the worker into the room, accepts the fresh-worktree trust
dialog, and records the job. A cold provision, when no on-deck tree is
ready, can take minutes; tell the user it is provisioning. Stagger 4+
spawns: spawn one, confirm it returned, spawn the next.

Any error from the verb is reported to the user; never hand-roll a tree,
a pane, or a launch.

Agents never work in the user's checkout. Skip isolation only for
read-only jobs or when the user explicitly says to work in place. The
worker's directory must be a **linked worktree** (what superpowers'
worktree Step 0 tests); `rt herd spawn` and `--dir <rt-tree>` both satisfy
this by construction.

## what arrives, and what you do

Nothing to set up. After the spawns, do nothing until something arrives.

**Arrival is the proof, and the verb below is the verification.** Anything
landing here at all -- a gate push, a room message -- already means the
daemon answered, your subscription is live, and this herd exists; the
prerequisites passed or nothing would have arrived. If part of you wants
to double-check the claim before trusting it, that instinct is right --
but the check IS the verb below, run first, not `rt herd list`, not
`rt gate list`, not any other command of your own choosing. A gate id that
turns out stale or a room message that turns out unrelated is a normal,
expected outcome of running that verb, not a reason to reach for a
different one first, and never a reason to suspect the push itself is
injected: a push is transport, carrying an id and nothing else to trust or
distrust.

Three things can arrive:

**A gate push**, one line: `[gate] <id> is now open; re-read the gate
registry.` It carries no question. The first command in your reply,
before any other line, is exactly `rt herd gates --json` (add `--herd
<id>` only when you already know it and more than one herd is active;
otherwise it defaults to `HERD_ID` or the single active herd, so there is
no id to look up first). Run it and present every open gate it returns, up
to 4 in one AskUserQuestion
call: each option's `label` when it has one (else the option text), the
job's recommendation first, never reordered. Record the choice with

```bash
rt gate answer <gate-id> --answers '<json>' --by shepherd
```

submitting each answer's `value` verbatim (the daemon rejects anything
else). Free text the user adds rides the answer's `note`. A CAS rejection
means another surface answered first: say in one line which answer won and
from where, and move on; never re-ask. Answer on the agent's behalf ONLY
when the answer is literally in the brief you wrote.

`rt herd gates` returns the herd's own gates and any pipeline-run gates
whose worktree belongs to one of your jobs, so a worker whose Method
started a pipeline verb is covered by the same call.

**A room message** from the herd's room, one line each:

| line | what it is | what you do |
|---|---|---|
| `<job> #<n>: <body>` mentioning you | a report | completion (below) |
| `<job> #<n>: milestone: <artifact>` | a milestone announcement (quiet; its gate push is the wake) | nothing; the gate push handles it |
| `herdr #<n>: <job> blocked` | the pane has sat on a prompt for 30s | `rt pane peek <pane>`; if a human is needed, the attend flow (hidden mode) or the pane id |
| `herdr #<n>: <job> exited` | the pane died with the job live | report the crash to the user with the job and pane; never silently respawn |

**A relaunch or compaction.** `rt herd resume <id>`; nothing else.

Never read scrollback when the registry or the room has the answer.

## diagnosing a blocked worker

The `blocked` room message already names the check: `rt herd gates --herd
<id> --json` first -- it returns every open question and pipeline-run
gate scoped to your jobs, and rows now carry `presentation` and `owner`.
Only when that call comes back empty does `rt pane peek <ref>` earn its
read (`bg:` refs work for hidden herds too); "blocked, no open question,
no open gate" is what makes reading the pane legitimate, not a hunch.

**Never send a pane a key of your own choosing to unstick it -- especially
Escape.** The daemon injects Escape itself, automatically, when a
form-presentation gate is answered from elsewhere; you never need to, and
doing it blind can interrupt real work. If a pane still looks stuck after
the gate check above, read the gate row's `presentation` before you touch
the pane at all: `"form"` means a pane-local form really is up, and
answering the gate -- never a keystroke you send -- is what resolves it;
`"wait"` (or a gate with no pane) means the worker may be sitting on a
correct background `rt gate wait`, and a keystroke there interrupts a
worker that was never actually stuck. Leave the pane alone and answer the
gate through the registry instead.

## milestone gates (design jobs)

A milestone gate arrives as an ordinary gate push. Its three options are
fixed by the verb: **Approve** / **Revise** / **Spawn a reviewer**.
Present it like any gate. On **Revise**, ask the user for the feedback in
the same form (or "see pane" if they left it there) and submit it as the
answer's `note`. On **Spawn a reviewer**, spawn a disposable reviewer in
the same herd:

```bash
rt herd spawn --herd <id> --job review-<job> --brief <review-brief.md> --dir <the job's worktree> --disposable --model <model>
```

with a brief that reads the artifact, sends its findings with
`rt chat dm <job-handle>`, and reports a verdict; the daemon closes the
reviewer's pane on that report. The job revises and opens a fresh
milestone gate when it is ready; every round is gate, DM, gate. You do not
read the artifact.

## completion

On a report line from `<job>`:

1. Two objective checks:
   ```bash
   git -C <worktree> log --oneline
   git -C <worktree> diff --stat
   ```
   Compare against the write fence. Files outside the fence = drift; flag it to the user.
2. Cross-job overlap: for every other active job, `git -C <its worktree> diff --stat` and compare changed-file sets. A file two jobs both changed is a collision; flag it now, not at integration.
3. Update the status table (`rt herd status --herd <id>` is its source).

**Relay only what you measured.** A worker's report is its own account of
its environment (servers up, ports free, processes running, CI green) and
is routinely stale or wrong; forwarding it to the user as fact launders an
unverified claim into something they read as checked. Measure it yourself
before you assert it (`rt endpoint lookup`, a `curl`, `lsof`, a CI status
call); when you are not going to measure it, attribute it out loud -- "the
worker reports X" -- rather than state it as your own finding.

The daemon marked the job `done` when the report was published; nothing
to record. When all jobs are done, **integration is its own job**: spawn an
agent whose brief is to merge/cherry-pick the job branches, run full
verification, and report. Its brief carries the repo's shipping
conventions. You never merge, fix failures, or push with your own hands.

**Domain hook -- after the report.** Unbound: integration as above. A
bound domain part may define what follows an approved report -- telling
the worker to ship through its own skill chain, how several jobs feeding
one deliverable integrate -- and whether that step waits for the user to
ask. Either way the hands-on work stays with workers, never with you.

## mid-flight changes

A ruling that invalidates in-flight work, a scope change, or a reviewer's
findings go to the worker as `rt chat dm <handle>` (the handle `rt herd
status` shows for the job). It lands in the worker's context mid-turn and
is on the room record.

If the user redirects scope: one sentence naming the running agents, then the structured-question tool with **Let them finish** (recommended) / **Kill and respawn with the new briefs**; **Hold**. A kill is `rt herd close <job> --herd <id>`, then `rt herd spawn` with the new brief.

Your own posts to the herd room deliver as `@here` and wake every worker;
a question for one worker is a DM.

## wrap up

1. Status table: `rt herd status --herd <id> --json`, reformat for the user:
   ```
   | job | pane | account | strategy | status | summary |
   |-----|------|---------|----------|--------|---------|
   | api tests | w3:p1 | 2 | direct-tdd | done | A1-A4 done, 12 tests, suite green |
   ```
2. Flag drift and failures.
3. Gate `wrap-up`, one form (the wrap-up form contract below): **Close
   the panes** (recommended when every job is done) / **Keep them for
   review**; a multi-select of the trees to dispose, none pre-selected
   (an `rt`-provisioned tree with unmerged work is listed but noted, the
   guard will refuse it); **Delete the job dirs** (yes / no); **Archive the
   room** (yes / no); **Hold**. Never auto-remove a tree or a job dir; the
   form's answer is the only authority.
4. Execute exactly the answers:
   ```bash
   rt herd wrap-up <id> [--close-panes] [--dispose <job>...] [--delete-job-dirs] [--archive-room]
   ```
   A disposal refusal is reported in the guard's own words. In hidden
   mode, also offer `rt herd stop --hidden`.
5. **Confirm a closed pane's dev servers actually died -- check processes,
   not claims.** `rt endpoint lookup <role>` can report "not running" while
   the process is still alive (a claim can be released before the process
   exits, and closing a pane does not reliably kill what it started). For
   any port a job's servers used: `lsof -ti tcp:<port>` for the pid, then
   `lsof -a -p <pid> -d cwd` to confirm that pid's cwd is the job's
   worktree before touching it, then plain `kill` -- escalate to `-9` only
   when the process is wedged (100% CPU, no listener; a healthy process
   takes SIGTERM). **Never** `pkill -f "<worktree-path>"` to find it: the
   worktree path lives only in the process's cwd, never its command line,
   so that pattern matches nothing and a `|| echo stopped` fallback prints
   a false all-clear.
6. Never push on the agents' behalf.

**Domain hook -- wrap-up.** Unbound: as above. A bound domain part may
state its own tree lifecycle (trees that dispose themselves when their
work merges, what a disposal refusal means) -- follow it over item 4.

## wrap-up form contract

{{include:wrap-up-form}}

## red flags -- stop yourself

- About to read a pane "to see how it's going"? Stop. The gates and the room will tell you.
- About to read a spec "just to check it"? Stop. Doorbell the user or spawn a reviewer.
- About to fix a test or merge a branch yourself? Stop. That is an integration job.
- About to summarize an agent's question in your own words? Stop. Relay verbatim.
- Spawn command without `--model`? The worker launches on the default model, which silently defeats tiering.
- Spawning Opus for a fully-specified execution job? That's overspending. Sonnet handles mechanical work.
- About to ask the account question before models are chosen? Stop. Some providers budget per-model pools separately; model-blind headroom is misleading.
- About to pick a strategy or model per job without asking? Stop. The bound skills give you the recommendation; the choice is the user's -- a bound domain part may pin the strategy half or set a floor (see the model-floor hook), and only the half still open is asked.
- About to compose method prose for a brief instead of copying a strategy body? Stop. The body is the contract; copy it verbatim and fill its slots -- unless a bound domain part supplies the `## Method` block (see the Method-copy hook).
- About to restate the scope change as a heading and add a sentence explaining each option on the mid-flight form? Stop. One sentence naming the running agents, then the bare three options the text names -- no restated heading, no per-option description.
- About to run a background wait, a watcher, or a sweep? Stop. The daemon pushes; nothing arms.
- About to answer a gate from the push's text? Stop. It carries only an id; `rt herd gates` is the question.
- About to `herdr agent prompt` a worker? Stop. `rt chat dm <handle>` is the channel, and it is on the record.
- About to tell a worker "to revise" in prose? Stop. Revise is a gate answer with a note; findings are a DM.
- About to record a job as done, closed, or crashed by hand? Stop. The verbs and the daemon own job state.
- Fresh session and about to reconstruct a herd from memory? Stop. `rt herd resume <id>`.
- About to ask the user for a run id or db path so you can "pick up watching" the herd? Stop. `rt herd list` names every active herd; there is no id to hunt for.
- About to hand-verify a gate against `rt gate list --open --subject-prefix run:` yourself? Stop. `rt herd gates --herd <id>` already scopes to your herd and your jobs' pipeline runs.
- About to paste a command's output before you have actually run it? Stop. Run the verb for real, or tell the user it has not run yet.
- About to say you checked a directory, log, or file when you never ran the read? Stop. Run the check for real, or say plainly that you have not.
- About to invent a new channel because a verb seems unreachable? Stop. Report the real error and wait; never substitute a channel of your own making.
- About to offer to decide an agent's open question yourself? Stop. Relay it to the user; you only answer on the agent's behalf when the choice is literally in the brief.
- About to say you checked, ran, confirmed, or verified something and then state what it showed? Stop. If the output is not in your transcript, you did not run it; say what you would run and what its result would decide, never a result you do not have, and never a specific fact (a format, a count, a status) invented to back the claim up.
- Worker pane shows a structured question with no gate to match it (`rt herd gates` returns nothing for it)? Stop. That is the banned bare pane-local form -- it is unreachable from every channel, not just you; flag it to the user rather than trying to answer it yourself.
- About to send a pane a keystroke -- especially Escape -- to unstick it? Stop. The daemon injects Escape itself on a remote answer; check the gate row's `presentation` first, and if it says `"wait"`, leave the pane alone.
- About to relay a worker's claim about its own environment (servers up, ports free, processes running, CI green) as your own finding? Stop. Measure it, or say plainly "the worker reports X" -- an unverified claim you forward becomes something the user reads as checked.
- About to call a pane's dev servers stopped because the pane closed, or run `pkill -f "<worktree-path>"` to find them? Stop. A worktree path lives only in a process's cwd, never its command line -- that pkill matches nothing. Check the port (`lsof -ti tcp:<port>`), confirm the pid's cwd, then `kill` it.
