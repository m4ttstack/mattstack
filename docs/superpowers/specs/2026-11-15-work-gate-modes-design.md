# Work gate modes

Status: draft for review, 2026-11-15

## Why

An audit of ten weeks of one team pack's work runs (686 gates across about
100 feature runs) found the operator took the recommended option on 94% of
gate questions. 76% of gates were a plain "take the recommendation and
continue" with no note. Every one of those gates still interrupted the
operator, in a pane, on the board, in the console or through the shepherd's
relay form.

The 6% where the operator stepped in fell into three groups:

- setup and tool failures (evidence capture, push and post refusals, CI
  watch timeouts), where the operator filled a missing capability;
- product and people calls that need information from outside the repo;
- review voice (out of scope here; review and respond runs are launched
  from the board and get their own design).

The goal is for work runs to interrupt the operator only where the operator
adds something, and to make every decision taken without them visible and
reversible.

A second finding shapes phase 3. A herd today opens with several rounds of
questions from the shepherd (strategy, model and effort, account), then each
worker asks its own plan, clarify and evidence-plan questions. The operator
wants these combined into one moment: an agent does the analysis, raises one
form with every question and its recommendation, the operator answers once,
and the work goes. The interaction pattern is the board's: a UI launches
agents into Claude Code panes, and the agents raise gates back to the UI.

## Goals

- An rt setting picks how much a work run interrupts the operator, as one
  of a fixed set of modes.
- In the chosen mode, a gate whose every question has a recommendation, and
  whose reach the mode allows, answers itself the moment it opens.
- Decisions made by a mode are recorded as the mode's, never as the
  operator's or the shepherd's.
- The operator sees each such decision as it happens and can pause the run
  or send it back to that gate.
- The last gate the operator does see in a run lists everything decided
  without them.

## Non-goals

- Review, review-post, respond-plan and respond-post gates (board-launched
  review and respond runs). Their gates are untouched by this design.
- Making the agent's recommendations better. This design trusts the
  recommendation the step already writes.
- Changing how board-launched review and respond runs ask. The operator
  ruled those out of gate modes on 2026-11-15.

## Anti-goals (this fails even if it works if...)

- An evidence board or redaction gate (whether a capture may go public)
  ever answers itself.
- A failure, off-script or doctor gate answers itself. Those were where the
  operator's real interventions happened.
- The record cannot tell a mode's decision from a human one. The next audit
  must be able to separate them.
- A mode silently rewrites a branch teammates can see.

## Modes

One setting, user scope, with a per-run override:

| Mode | Gates that may answer themselves |
|---|---|
| `every-gate` | none (today's behavior; the default) |
| `worktree` | reach `worktree` |
| `draft-mr` | reach `worktree` and `draft` |
| `checkpoint-free` | reach `worktree`, `draft` and `teammates` |

A gate's **reach** is how far its outcome travels:

| Reach | Meaning | Typical gates in a work pipeline |
|---|---|---|
| `worktree` | stays in the operator's tree | plan, clarify, evidence plan, self-review, CI fix, close |
| `draft` | reaches the forge as a draft only | ship (push, open the draft MR) |
| `teammates` | teammates see or are notified | mark-ready |
| `public` | may become public | evidence boards, evidence redaction |

`public` never answers itself in any mode.

### Setting and override

- The setting is a user-scope rt setting holding the operator's usual mode
  (registered through the settings resolver; key name is the builder's
  call, e.g. `rt.work.gateMode`).
- A run can carry its own mode, chosen when it starts (pane, shepherd spawn,
  a future launcher). It is stored on the run as a field, so it survives a
  resume and a respawn. The run's field wins over the setting.
- A **shadow** switch, separate from the mode, records what the mode would
  have answered while every gate still asks. It exists so the operator can
  trial a mode before trusting it. Shadow decisions are recorded but never
  applied.

## When a gate answers itself

`askGate` (the shared path behind `gate_ask` and `gate_open`) decides,
after the run is resolved and before the gate is sent to the daemon. A
gate answers itself only when all of these hold:

1. it is opened under a run of a work pipeline;
2. the run's effective mode allows the gate's reach;
3. the gate's reach is declared on this open (see below); an undeclared
   reach never answers itself;
4. every question has a recommended option (multi-select questions: the
   recommended set), and no question needs a write-in to be answered. A
   recommendation is either form the pipelines use today: `recommended:
   true` on the option, or a label ending "(Recommended)" in any case;
5. the recommendation moves the run forward: no question recommends hand
   back, abandon, iterate, go back or hold, and a `next` question, if the
   gate has one, recommends proceed or done (most work gates have none; the
   protocol reads a missing `next` as proceed);
6. the gate does not carry a "needs the operator" flag;
7. its context is not an evidence-board context, and its reach is not
   `public`.

Kinds have no registry (a work gate's kind is the scope string the pack
writes, such as `ci:<stage>:<attempt>` or `off-script:<site>:<n>`), so rt
does not keep a list of kind names. Failure, off-script and hand-back cases
are kept with the operator by rules 3 and 5: the pack declares no reach on
off-script and failure opens, and a gate whose recommendation hands back or
stops never answers itself. One CI gate therefore behaves both ways: a
recommended "fix and re-push" may answer itself, a recommended "hand back"
after a timeout asks.

The answer is the recommended option for every question the gate asked,
and nothing else (the daemon refuses a key the gate did not ask). It is
written to the gates table as a
normal answered gate, so every surface that reads gates (pane, console,
board, shepherd) sees an answered gate.

### Recording

- The gate's answer carries `by: "mode:<mode>"`.
- The run's `gate@1` decision carries the same decider.
- The gate row records the branch's head commit at open (also used by Redo,
  phase 2).
- Shadow mode writes the would-be answer to the gate row (e.g. a
  `shadowAnswer` field) and leaves the gate open for the operator.

### Declaring reach and "needs the operator"

- `gate_ask` / `gate_open` take two new optional inputs: `reach` (one of the
  four values) and `needsOperator` (a short reason string).
- The pack's work pipeline sets `reach` on each gate it opens, per open, not
  per gate kind. Both the generic work pipeline in this repo and the audited
  team pack (in its own org repo) get labels in this plan; without the team
  pack's labels the operator's runs would not change. Where the label lives
  in a pack (stage fill text versus a manifest field) is the builder's call.
- `ship` declares `draft` while the MR is still a draft, including a
  re-ship that force-pushes with lease after a CI fix round. Once the MR is
  marked ready, a ship that would force-push declares `teammates`.
- A step sets `needsOperator` when its decision turns on a product or
  people call (what a PM meant, a flag key from a conversation, a
  follow-up ticket), even when it has a recommendation. The step's
  guidance says when; the gate then asks in every mode, and the form shows
  the reason.

## The digest

Every gate that reaches the operator in a run opens with what the mode
decided since the operator last answered a gate in that run: the step, the
question, the option taken, and for self-review the findings fixed and
waived. The gate where the mode stops (mark-ready under `draft-mr`, ship
under `worktree`) therefore carries the run's full list. Because the digest
belongs on every asking gate, it is a gate-protocol feature: rt supplies the
decisions (run snapshot, `mode:` decider, since the last human answer) and
the shared gate protocol renders them, rather than each step rendering its
own. Under `checkpoint-free`, the full list goes into the run's close
report.

## Phase 2: live feed, Pause and Redo

- **Feed.** The console's Gates view lists gates answered by a mode, marked
  as such, with the choice made, under their run. For herd runs, the herd
  room also gets one line per such decision.
- **Pause.** A feed row's Pause holds the run at its next step (today's
  `hold` run control).
- **Redo.** A feed row's Redo sends the run back to that gate's step with the
  operator's note (today's `go-back` run control) and the commit recorded
  when the gate opened. The worker decides what to do with code written
  since (revert, rework or keep), with normal commits. rt gains no branch
  reset verb; history keeps what happened. Steps that change code commit
  before opening their gate, so the recorded commit is a clear reference
  point.

## Phase 3: start work from the console, one launch moment

The console becomes where the operator starts and watches work herds. It
replaces the shepherd's role for work herds: the shepherd's opening
questions move into one launch gate, its lane watching moves to the console,
and cross-lane problems go to a helper agent started on demand.

### The ticket picker

- A "Start work" entry on the console's Runs page lists the team's Linear
  project tickets the operator could take (Todo, assigned to them or
  unassigned), by priority. It opens instantly.
- The daemon keeps that list fresh in the background, and also keeps a
  ranked suggestion fresh: the existing pick-tickets ranking (ready or needs
  a decision, size, someone else's lane, a parallel batch of 4-6) run as one
  bounded agent call. "Suggest a batch" pre-ticks the latest suggested batch
  with its flags. Refresh cadence must be measured against Linear's rate
  limits before it is set.
- Start work picks a repo first. A per-repo setting names that repo's
  Linear project (and so its workspace). One batch is one repo and one herd.
- Ticking one ticket or several and pressing Start starts a herd. A single
  ticket is a herd of one, so there is one launch path, through rt's
  existing herd verbs.
- The background suggestion reruns only when the ticket list changed, at
  most hourly, on Sonnet and the operator's default account.

### Herd ownership

Today a herd belongs to the Claude Code session that started it: the herd
row stores its session and chat handle, the daemon subscribes that session
to the herd's gates, and every control tool refuses a caller that is not
that session. A console-started herd is instead owned by the operator:

- rt gains an operator owner for a herd beside the session owner. The
  console calls the daemon's herd verbs directly as the operator. Agents in
  the herd cannot call its controls.
- The Get help agent gets a narrow grant on the herd it was started for:
  read the herd, post in its room. Whether it may also nudge or pause a lane
  is the builder's call, defaulting to no.
- With no shepherd session subscribed, the console's Gates view is the
  inbox. When a gate needs the operator and the console is not open, the
  operator is notified (desktop notification or tray badge; the builder
  picks, following the existing gate notification routing).
- Session-owned herds (shepherdr) keep working unchanged.

### The launch gate

1. Start opens an analysis agent in a Claude Code pane. It shows on the
   Runs page as a launch run. It reads each ticket, and enough of the code,
   to recommend per ticket: approach (direct-tdd, superpowers, trivial),
   evidence plan, open product questions, model and effort, account, and
   gate mode (defaulting to the operator's setting). It honors the team
   pack's shepherd hooks (intake, method file, provisioning) and folds the
   pack's own plan questions into the launch gate.
   For a ticket it recommends the superpowers path, it also asks that
   ticket's first round of brainstorm questions in the launch gate.
2. It raises one launch gate covering every ticket in the batch. The gate
   is drawn with the kit gate form (the gate-form mod), which has no
   four-question cap, and is listed in the console's Gates view like any
   gate, so it can be answered from either place. The launch gate always
   asks, in every mode.
3. After the answer, the console starts the herd's workers with their plan
   already decided: each work run starts past its plan, clarify and
   evidence-plan gates, with those decisions recorded as the operator's
   launch answers.
4. A worker that reads the code and finds its launch plan wrong does not
   re-plan quietly. It raises an exception gate (needs the operator)
   naming what it found.

### Superpowers tickets

- A direct-tdd or trivial ticket runs straight from launch to its mode's
  stopping gate.
- A superpowers ticket's worker starts its brainstorm from the launch
  answers. Follow-up brainstorm questions, the spec approval and the plan
  approval still reach the operator, and they always ask in every mode
  (marked needs the operator), because brainstorm questions usually carry a
  recommendation and a mode would otherwise answer them.

### Watching and helping

- The herd's lanes are runs on the console's Runs page. Their gates arrive
  in the Gates view, filtered by each run's mode, with the phase 2 feed,
  Pause and Redo.
- The console shows the daemon's stuck-worker verdicts with Nudge and
  Respawn, and offers wrap-up (close panes, dispose trees) once each lane's
  merge state is final.
- A problem that spans lanes (a broken base branch, port or database
  contention, wedged installs) gets a "Get help" action: it starts an agent
  in a pane with the herd's context, which fixes or coordinates and then
  exits. No agent sits in the shepherd's seat for the life of the herd.

### The shepherd's other duties

| Duty today | In the first version |
|---|---|
| Lane overlap: shared files, branch drift | Console shows it per lane, with Get help |
| A new account when one runs out mid-run | A daemon rule picks the next account |
| Moving Linear tickets on | Stays in the work pipeline |
| Asking whether to merge a lane | Stays at mark-ready and on the board |
| Integration jobs | Not in the first version |
| Reviewer-guest rounds | Not in the first version |

Both shepherdr skills (generic and team pack) stay for now. Whether to
retire them for work herds is decided once the console has proven itself.

### Boundary

Judgment stays with agents: the analysis agent recommends, workers do the
work, the helper agent handles cross-lane problems. The console starts
agents, shows their gates and offers deterministic controls, which is the
board's existing pattern for review runs. (My reading of the operator's
direction; confirm.)

## Approaches considered

- **A. rt decides at gate open (chosen).** One rule in `askGate` covers solo,
  herd, console and future launchers; the gates table holds every decision,
  so the feed and the audit come free. The cost is work in rt plus pack
  labels.
- **B. Each pipeline step decides.** A pack-only change, but every step
  carries its own copy of the rule, nothing reaches the gates table, so
  there is no feed, and the shepherd learns it separately. Rejected for
  drift and the missing record.
- **C. The shepherd decides.** Covers herd runs only and bends the
  shepherd's rule that it never answers a worker's gate. Rejected.

## Decided with the operator

- Scope is work runs only; review and respond runs are separate.
- The operator's chosen everyday line is `draft-mr`.
- Modes are an rt setting with a per-run override, not a one-off rollout.
- Decisions answer instantly, and also post to a live feed.
- The feed can Pause and Redo; on Redo the worker decides what to do with
  code written since, and rt gains no branch reset.
- rt decides at gate open (approach A).
- Combine questions into single moments. The herd opens with one launch
  gate that covers setup and every ticket's plan.
- The picker and the herd's lanes live in the console.
- The ticket list opens instantly; Suggest pre-ticks a ranked batch; the
  daemon keeps both fresh in the background.
- Cross-lane problems go to an on-demand helper agent, not a standing
  shepherd.
- Console-started herds are owned by the operator through the console.
- The shepherd's other duties are placed as in the table above.
- Superpowers tickets: first-round brainstorm questions in the launch
  gate; follow-ups, spec and plan approvals still ask, in every mode.

## My calls (marked for review)

- The four mode names and the reach vocabulary above.
- The shadow switch being separate from the mode.
- Reach declared per open; both the generic pipeline and the team pack get
  labels.
- Forward-only recommendations (rule 5) instead of a kind denylist.
- Re-ship may force-push a draft; after mark-ready a force-push asks.
- The digest on every asking gate, as a gate-protocol feature.
- Recording the head commit at gate open rather than committing per gate.
- A single ticket is a herd of one.
- The boundary paragraph in phase 3.
- Phase 3 launches team-pack herds, honoring the pack's shepherd hooks;
  both shepherdr skills stay for now.
- One batch is one repo; a per-repo setting names its Linear project.
- The launch gate always asks; the analysis agent shows as a launch run.
- The suggestion reruns on list change, at most hourly, on Sonnet.
- The Get help agent may read the herd and post in its room, not control
  lanes, unless the builder finds it needs to.

## Left to the builder

- Setting key name, where a pack declares reach, and exact field names.
- How the analysis agent's launch answers are handed to each worker's run.
- The daemon's refresh cadence for the ticket list and suggestion, once
  measured.
