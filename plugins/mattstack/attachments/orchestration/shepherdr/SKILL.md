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
2. Confirm the rt daemon answers: call `herd_list {}`. A daemon-unreachable error means stop and say so; the herd tools, gates, and chat all ride the daemon.
3. **A fresh session that is picking a herd back up calls `herd_resume {herd}` first** (`herd_list` shows the ids). That one call re-points the gate subscription and the chat identity to this session and returns the open gates, the unread room messages, and every job's state. There is no other resume step.

## hidden mode: invisible panes

When the user asks for the herd to stay out of sight ("invisible",
"background", "headless", "don't clutter my UI"), pass `hidden: true` to
`herd_start`. Every worker pane then lives on the daemon's shared
background herdr server (session `bg`); the generic pane verbs address its
panes as `bg:<pane>` refs, exactly as herd surfaces print them. Nothing
else in this skill changes. To
put one worker in front of the user, `herd_attend {job, herd}`
opens a focused tab in the visible session attached to that pane (the user
detaches with `ctrl+b q`; close the tab it returned afterwards). At wrap-up,
offer the Bash command `rt herd stop --hidden` (no tool runs it); never run it unprompted. The background <!-- mcp-lint: allow -->
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
herd tools and the gate registry, and what arrives is still yours to present.

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
Pass `model` on every spawn (`--model <model>` on a Bash spawn) and
`effort` only when an override was chosen. A spawn without a model
launches on the default model, which silently defeats tiering.

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
`account` on `herd_spawn` (`--account <A>` on a Bash spawn). Empty:
single-account mode -- no account question, spawns omit the account, and
workers launch as plain `claude`.

If a worker stalls on a rate limit mid-job (the diagnose read shows a
limit banner): the accounts rules above decide whether to respawn
automatically or ask the user; the respawn itself is one command. Obtain
the new account, then run in Bash:

```bash
rt herd spawn --herd <id> --job <same job> --dir <its worktree> --account <A> --model <its model>  # <!-- mcp-lint: allow -->
```

**The respawn is this Bash line, never `herd_spawn`:** the tool never
takes a dir, and a dir-less respawn of a job whose tree is still attached
fails `branch-attached`. The daemon closes the old pane, reuses the stored
brief, and relaunches in the same tree. Announce the respawn to the user afterward. With the
accounts section above empty there is nowhere else to launch; report the
stall to the user instead.

## the herd contract

Every herd is a row in the rt daemon's registry plus one chat room and one
gate subscription, all created by `herd_start`. Workers ask through gates
(`herd_ask`, `herd_milestone`) and the daemon pushes each open gate
into this session; workers report and the daemon posts lifecycle notices
into the room, which is also pushed here. You answer gates with
`rt gate answer` in Bash, you talk to a worker with `rt chat dm <handle>`, and the
daemon records job state as a side effect of every call. There is no herd
DB, no script, and no background wait. `herd_status {herd}` is the whole
picture at any moment.

### job.md: assembled by herd_brief

Every brief is assembled by the `herd_brief` tool, never composed. Call
`herd_brief {job, template, strategy, strategies, fill, out}` with:

- `template`: `${CLAUDE_SKILL_DIR}/references/job-template.md`
- `strategy`: the job's chosen strategy name
- `strategies`: `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md`
- `fill`: one `"<slot>=<value>"` string per slot
- `out`: an absolute path in this session's scratchpad, one file per job

`${CLAUDE_SKILL_DIR}` is the base directory this skill was loaded from,
written as an absolute path. Both paths come from that directory and
nothing else; the tool accepts them because it is an installed plugin or
pack root, and rt never guesses skill paths.

A refusal that a path is outside every root means the loaded skill dir is
stale (the plugin updated while this session ran) or a dev checkout. Run
`/reload-plugins` (in a herdr pane, queue it on yourself with
`rt pane send self --text "/reload-plugins" --then "Continue: ..."` and end
the turn), then retry from the reloaded base directory; if it still
refuses, report the refusal. Never copy the template or the strategies
file elsewhere to get past it.

It copies `references/job-template.md` verbatim, copies the named
strategy body verbatim from `parts/strategy/references/strategies.md`
into `## Method`, and fills the template's literal `<angle-bracket>`
slots from the `fill` entries; an unfilled marker in the output is an
error listing the leftovers, so nothing is retyped from memory and no
slot goes silently empty. The `out` path is the brief you hand to
`herd_spawn`.

**Domain hook -- the Method copy.** Unbound: the assembly as written. A
bound domain part may supply the `## Method` block itself (its team's
pipeline skill is the method); then pass `methodFile: <path>` instead
of `strategy`/`strategies` (they are mutually exclusive), the
strategies-file slots are not filled, and the report contract is
whatever that method skill produces. The template's remaining sections
still come from the template verbatim -- the question and report
channels never change.

The Method body's `<question-file>`/`<report-file>` slots get pointers
to the brief's 'Asking the user a question' / 'Publishing a report'
sections (the draft path is `.superpowers/report-draft.md`). A
`<strategies-file>` slot gets the absolute path of the strategy bodies
file itself: `parts/strategy/references/strategies.md` under this
skill's directory. A `<strategy-skill-file>` slot gets the absolute
path of the file carrying the strategy TABLE: this skill's own
SKILL.md, whose strategy part carries it. The strategy skill stays
medium-agnostic. Each of these is supplied as a `fill` entry.

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

- **Branch naming**: the branch is the job name (`herd_spawn` provisions on it); if branches derive from tickets, resolve the ticket first and name the job accordingly, or a provisioning domain part spawns with `--dir` on a tree it named itself (the Bash spawn under step 2). No repo rule = any name; branches that never ship are ephemeral.
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

Write each brief to the scratchpad, one file per job, with `herd_brief` as above.

**Single-job case:** if decomposition yields exactly one job, push back: tell the user "this is probably not the right skill for this" and do the work yourself, here in the main pane. Never spawn a single pane -- one agent behind a relay is pure overhead. Still create the worktree so the work stays isolated from the user's checkout: call `worktree_provision {repoName, branch: <job>, disposal: "job"}`, then `EnterWorktree` with `path` set to the result's `path`. The delegator rules above don't apply -- work hands-on as normal. A bound domain part may name the one legitimate single-worker exception; apply it.

## step 2: spawn

**Herd start**, once: call `herd_start {name: <short-name>, repo, hidden}`,
where `repo` is the repo's checkout path, identity or label, and
`hidden: true` only in hidden mode.

It returns the herd id, the room, the workspace label, and the subscription
id. Every pane the herd creates is a tab in that one workspace; the user's
own workspace is never touched.

**Domain hook -- provisioning.** Unbound: `herd_spawn` provisions the
tree itself (branch `<job>`, disposal `job`). A bound domain part that
owns provisioning replaces that flow: it provisions the tree its own way,
then spawns in that tree with this Bash line in place of `herd_spawn`
(the tool never takes a dir):

```bash
rt herd spawn --herd <id> --job <job> --brief <path-to-brief.md> --model <model> --dir <its tree> [--effort <effort>] [--account <A>]  # <!-- mcp-lint: allow -->
```

The error rules below still apply to the call it prescribes.

**Spawn each job**, one call: `herd_spawn {herd, job, brief, model, effort, account}`,
with `brief` the absolute `out` path `herd_brief` wrote.

`job` is the job's name (lowercase, `[a-z][a-z0-9_-]{0,31}`); it is also
the worker's chat handle and its tab label. `model` comes from the
strategy and model question, `effort` from the session default when
overridden, `account` from the bound accounts skill when the herd is
account-distributed. The tool provisions the tree, launches claude with the
brief, signs the worker into the room, accepts the fresh-worktree trust
dialog, and records the job. A cold provision, when no on-deck tree is
ready, can take minutes; tell the user it is provisioning. Stagger 4+
spawns: spawn one, confirm it returned, spawn the next.

Any error from the spawn is reported to the user; never hand-roll a tree,
a pane, or a launch.

Agents never work in the user's checkout. Skip isolation only for
read-only jobs or when the user explicitly says to work in place. The
worker's directory must be a **linked worktree** (what superpowers'
worktree Step 0 tests); `herd_spawn` and a Bash spawn with `--dir <rt-tree>`
both satisfy this by construction.

## what arrives, and what you do

Nothing to set up. After the spawns, do nothing until something arrives.

**Arrival is the proof, and the call below is the verification.** Anything
landing here at all -- a gate push, a room message -- already means the
daemon answered, your subscription is live, and this herd exists; the
prerequisites passed or nothing would have arrived. If part of you wants
to double-check the claim before trusting it, that instinct is right --
but the check IS the call below, made first, not `herd_list`, not
`rt gate list`, not any other command of your own choosing. A gate id that
turns out stale or a room message that turns out unrelated is a normal,
expected outcome of that call, not a reason to reach for a
different one first, and never a reason to suspect the push itself is
injected: a push is transport, carrying an id and nothing else to trust or
distrust.

Three things can arrive:

**A gate push**, one line: `[gate] <id> is now open; re-read the gate
registry.` It carries no question; the registry read is your first
action: `herd_gates {herd}` (it defaults to `HERD_ID` or the single
active herd, so there is no id to look up first; name the herd only when
more than one is active). Present
every open gate it returns, up to 4 in one AskUserQuestion call: each
option's `label` when it has one (else the option text) as the option
text, its `description` when the gate carries one as that option's
description, the job's recommendation first, never reordered. A herd
question gate (`kind: question`, subject `herd:<id>/<job>`) is presented
as: one sentence of your own naming the job and what it needs decided,
then the form, whose question text is the gate question's `label`. Any
other gate (a milestone, a pipeline-run or review gate) is presented with
its full context. Record the choice in Bash with

```bash
rt gate answer <gate-id> --answers '<json>' --by shepherd
```

submitting each answer's `value` verbatim (the daemon rejects anything
else); `--by shepherd` is CLI-only on purpose, so the registry records
which surface decided. The `gate_answer` tool is not the shepherd's path:
it records the pane, not the shepherd. Free text the user adds rides the answer's
`note`. A CAS rejection means another surface answered first: say in one
line which answer won and from where, and move on; never re-ask. Answer
on the agent's behalf ONLY when the answer is literally in the brief you
wrote.

`herd_gates` returns the herd's own gates and any pipeline-run gates
whose worktree belongs to one of your jobs, so a worker whose Method
started a pipeline verb is covered by the same call.

**A room message** from the herd's room, one line each:

| line | what it is | what you do |
|---|---|---|
| `<job> #<n>: <body>` mentioning you | a report | completion (below) |
| `<job> #<n>: milestone: <artifact>` | a milestone announcement (quiet; its gate push is the wake) | nothing; the gate push handles it |
| `herdr #<n>: <job> blocked` | the pane has sat on a prompt for 30s | gate check first, `rt_verb {args: ["pane", "peek", "<pane>"]}` only when that comes back empty (see "diagnosing a blocked worker" below); if a human is needed, the attend flow (hidden mode) or the pane id |
| `herdr #<n>: <job> exited` | the pane died with the job live | report the crash to the user with the job and pane; never silently respawn |

**A relaunch or compaction.** `herd_resume {herd}`; nothing else.

Never read scrollback when the registry or the room has the answer.

## diagnosing a blocked worker

The `blocked` room message already names the check: `herd_gates {herd}`
first -- it returns every open question and pipeline-run
gate scoped to your jobs, and rows now carry `presentation` and `owner`.
Only when that call comes back empty does
`rt_verb {args: ["pane", "peek", "<ref>"]}` earn its read (`bg:` refs work for hidden herds too); "blocked, no open question,
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
fixed by `herd_milestone`: **Approve** / **Revise** / **Spawn a reviewer**.
Present it like any gate. On **Revise**, ask the user for the feedback in
the same form (or "see pane" if they left it there) and submit it as the
answer's `note`. On **Spawn a reviewer**, spawn a disposable reviewer in
the same herd and in the job's own worktree, with this Bash line:

```bash
rt herd spawn --herd <id> --job review-<job> --brief <review-brief.md> --dir <the job's worktree> --disposable --model <model>  # <!-- mcp-lint: allow -->
```

**The reviewer spawn is this Bash line, never `herd_spawn`:** the tool
never takes a dir, so it would land the reviewer in a fresh tree instead
of the job's. Give it a brief that reads the artifact, sends its findings with
`rt chat dm <job-handle>`, and reports a verdict; the daemon closes the
reviewer's pane on that report. The job revises and opens a fresh
milestone gate when it is ready; every round is gate, DM, gate. You do not
read the artifact.

## completion

On a report line from `<job>`:

1. Two objective checks: the commits, with
   `rt_verb {args: ["git", "log"], cwd: <worktree>}`; the changed files,
   with `cd <worktree>` as its own Bash call, then the bare
   ```bash
   git diff --stat
   ```
   Compare against the write fence. Files outside the fence = drift; flag it to the user.
2. Cross-job overlap: for every other active job, the same `cd <its worktree>` then bare `git diff --stat`, and compare changed-file sets. A file two jobs both changed is a collision; flag it now, not at integration.
3. Update the status table (`herd_status {herd}` is its source).

**Relay only what you measured.** A worker's report is its own account of
its environment (servers up, ports free, processes running, CI green) and
is routinely stale or wrong; forwarding it to the user as fact launders an
unverified claim into something they read as checked. Measure it yourself
before you assert it
(`rt_verb {args: ["endpoint", "lookup", "<role>", "--path", "<the job's worktree>"]}`,
a `curl`, `lsof`, a CI status call); when you are not going to measure it, attribute it out loud -- "the
worker reports X" -- rather than state it as your own finding.

The daemon marked the job `done` when the report was published; nothing
to record. When all jobs are done, **integration is its own job**: spawn an
agent whose brief is to merge/cherry-pick the job branches, run full
verification, and report. Its brief carries the repo's shipping
conventions. You never merge, fix failures, or push with your own hands.

**Closing the lane is yours.** Nothing closes a done job's pane but you.
When the lane's merge is confirmed (the integration job's report, or the
domain hook's own ship step) and its ticket flipped, call
`herd_close {job, herd}` in the same breath: it retires the row
and closes the pane as part of processing that completion, not as a later
chore. A report is a claim, not a merge: before closing, spot-check it
against the repo itself (`gh pr view --json state,mergeCommit`, or the sha
on `origin/main`), never on the report alone. Past `herd.watchdog.nagMins`
(default 30) the watchdog nags you about a done job whose pane is still
open; that nag means this step was skipped, and the answer is the same
call.

**A job parked at a modal.** The watchdog accepts a worker's trust and
relocation dialogs itself and parks a job that stays stuck
(`stuck-at-modal` in `herd_status`). For a parked job: `herd_attend {job, herd}`
it so the user answers the dialog by hand, or `herd_close {job, herd}` and
respawn it in Bash, reusing the stored brief:

```bash
rt herd spawn --herd <id> --job <job> --dir <its worktree> --model <model> [--effort <effort>] [--account <A>]  # <!-- mcp-lint: allow -->
```

**Every respawn of an existing job is this Bash form, never `herd_spawn`:**
`herd_close` leaves the job's tree attached, so a dir-less respawn fails
`branch-attached`, and the tool never takes a dir. Pass the job's
`--effort` and `--account` again: a respawn keeps neither from the prior
spawn.

**Domain hook -- after the report.** Unbound: integration as above. A
bound domain part may define what follows an approved report -- telling
the worker to ship through its own skill chain, how several jobs feeding
one deliverable integrate -- and whether that step waits for the user to
ask. Either way the hands-on work stays with workers, never with you.

## mid-flight changes

A ruling that invalidates in-flight work, a scope change, or a reviewer's
findings go to the worker as `rt chat dm <handle>` (the handle
`herd_status` shows for the job). It lands in the worker's context mid-turn and
is on the room record.

If the user redirects scope: one sentence naming the running agents, then the structured-question tool with **Let them finish** (recommended) / **Kill and respawn with the new briefs**; **Hold**. A kill is `herd_close {job, herd}`, then the Bash respawn with the new brief (the tree stays attached after the close, so never `herd_spawn`):

```bash
rt herd spawn --herd <id> --job <job> --brief <new brief> --dir <its worktree> --model <model> [--effort <effort>] [--account <A>]  # <!-- mcp-lint: allow -->
```

Your own posts to the herd room deliver as `@here` and wake every worker;
a question for one worker is a DM.

## wrap up

1. Status table: `herd_status {herd}`, reformat for the user:
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
4. **Stop what the jobs left running, before any disposal:** for every
   job in the form's dispose list, plus every job whose pane is closing
   (nothing on **Hold**), call
   `worktree_stop_holders {repoName: <the herd's repo>, tree: <the job's tree>}`
   before `herd_wrap_up`. `tree` is the job's `tree` field from
   `herd_status`, a registry name, never a path. When that field is null
   (a `--dir` job), skip the job unless its dir is an rt tree; then pass
   that tree's name as
   `rt_verb {args: ["worktree", "list", "--repo", "<the herd's repo>"]}`
   prints it. An error of `not-held` means rt has no recorded hold on that
   tree, not that nothing is running there: rt records a process hold only
   after the tree's MR merges or closes with a process still inside, so a
   normal wrap-up tree answers `not-held` with its dev servers still up.
   The call ends only the processes rt tied to a held tree. There is no
   general kill. It runs before the next step because a disposed tree is
   no longer in rt's registry, and the call then fails.
   Before you tell the user a job's servers are stopped, measure it: a
   port read (`lsof -ti tcp:<port>`) or
   `rt_verb {args: ["endpoint", "lookup", "<role>", "--path", "<the job's worktree>"]}`.
   Report a survivor to the user as still running; never kill it by hand.
   Anything you did not measure, report as "not verified".
5. Execute exactly the answers: call
   `herd_wrap_up {herd, closePanes, dispose: [<job>...], deleteJobDirs, archiveRoom}`.
   A disposal refusal is reported in the guard's own words. In hidden
   mode, also offer the Bash command `rt herd stop --hidden`. <!-- mcp-lint: allow -->
6. Never push on the agents' behalf.

**Domain hook -- wrap-up.** Unbound: as above. A bound domain part may
state its own tree lifecycle (trees that dispose themselves when their
work merges, what a disposal refusal means) -- follow it over item 5.

## wrap-up form contract

{{include:wrap-up-form}}

## red flags -- stop yourself

- About to read a pane "to see how it's going"? Stop. The gates and the room will tell you.
- About to read a spec "just to check it"? Stop. Doorbell the user or spawn a reviewer.
- About to fix a test or merge a branch yourself? Stop. That is an integration job.
- About to reword, merge or reorder an agent's options? Stop. Options and their values are relayed exactly; only a herd question's context is yours to condense.
- Spawn without a model (`model` on `herd_spawn`, `--model` on a Bash spawn)? The worker launches on the default model, which silently defeats tiering.
- About to spawn through `herd_spawn` for any respawn of an existing job (rate limit, parked modal, kill and respawn), a disposable reviewer in a job's worktree, or a domain-provisioned tree? Stop. Those spawns need `--dir`, which the tool never takes; run the Bash `rt herd spawn ... --dir <tree>` line their section gives. <!-- mcp-lint: allow -->
- Spawning Opus for a fully-specified execution job? That's overspending. Sonnet handles mechanical work.
- About to ask the account question before models are chosen? Stop. Some providers budget per-model pools separately; model-blind headroom is misleading.
- About to pick a strategy or model per job without asking? Stop. The bound skills give you the recommendation; the choice is the user's -- a bound domain part may pin the strategy half or set a floor (see the model-floor hook), and only the half still open is asked.
- About to compose method prose for a brief instead of calling `herd_brief`? Stop. The tool copies the template and the strategy body; `methodFile` is the only path for a domain-supplied `## Method` block (see the Method-copy hook).
- About to restate the scope change as a heading and add a sentence explaining each option on the mid-flight form? Stop. One sentence naming the running agents, then the bare three options the text names -- no restated heading, no per-option description.
- About to run a background wait, a watcher, or a sweep? Stop. The daemon pushes; nothing arms.
- About to answer a gate from the push's text? Stop. It carries only an id; the registry read (`herd_gates`) is the question.
- About to `herdr agent prompt` a worker? Stop. `rt chat dm <handle>` is the channel, and it is on the record.
- About to tell a worker "to revise" in prose? Stop. Revise is a gate answer with a note; findings are a DM.
- About to record a job as done, closed, or crashed by hand? Stop. The herd tools and the daemon own job state.
- Fresh session and about to reconstruct a herd from memory? Stop. `herd_resume {herd}`.
- About to ask the user for a run id or db path so you can "pick up watching" the herd? Stop. `herd_list` names every active herd; there is no id to hunt for.
- About to hand-verify a gate against `rt gate list --open --subject-prefix run:` yourself? Stop. `herd_gates {herd}` already scopes to your herd and your jobs' pipeline runs.
- About to paste a command's output before you have actually run it? Stop. Run it for real, or tell the user it has not run yet.
- About to say you checked a directory, log, or file when you never ran the read? Stop. Run the check for real, or say plainly that you have not.
- About to invent a new channel because a tool or command seems unreachable? Stop. Report the real error and wait; never substitute a channel of your own making.
- About to offer to decide an agent's open question yourself? Stop. Relay it to the user; you only answer on the agent's behalf when the choice is literally in the brief.
- About to say you checked, ran, confirmed, or verified something and then state what it showed? Stop. If the output is not in your transcript, you did not run it; say what you would run and what its result would decide, never a result you do not have, and never a specific fact (a format, a count, a status) invented to back the claim up.
- Worker pane shows a structured question with no gate to match it (`herd_gates` returns nothing for it)? Stop. That is the banned bare pane-local form -- it is unreachable from every channel, not just you; flag it to the user rather than trying to answer it yourself. In covered panes (any `rt agent` launch carrying a subject, herd spawns included) the launch-injected gate-fork hook denies the bare form at source, so seeing one means the pane is uncovered or its daemon was unreachable.
- About to send a pane a keystroke -- especially Escape -- to unstick it? Stop. The daemon injects Escape itself on a remote answer; check the gate row's `presentation` first, and if it says `"wait"`, leave the pane alone.
- About to relay a worker's claim about its own environment (servers up, ports free, processes running, CI green) as your own finding? Stop. Measure it, or say plainly "the worker reports X" -- an unverified claim you forward becomes something the user reads as checked.
- About to call a pane's dev servers stopped because the pane closed, or because `worktree_stop_holders` answered `not-held`, or to kill them by port or process name? Stop. For every job in the dispose list plus every job whose pane is closing (nothing on Hold), call `worktree_stop_holders {repoName: <the herd's repo>, tree: <the job's tree name from herd_status>}` before `herd_wrap_up` (a null tree: skip it unless the dir is an rt tree, then pass that tree's name from `rt_verb {args: ["worktree", "list", "--repo", "<the herd's repo>"]}`). `not-held` means rt has no recorded hold on the tree, not that nothing runs there; it ends only the processes rt tied to a held tree, and there is no general kill. Measure before you say stopped (`lsof -ti tcp:<port>`, or `rt_verb {args: ["endpoint", "lookup", ...]}`): a survivor is reported as still running, never killed by hand, and anything unmeasured is "not verified".
