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
- A Linear ticket picker. It is a later launcher and only needs to pass a
  per-run mode.

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
3. the gate's reach is declared (see below); an undeclared reach never
   answers itself;
4. every question has exactly one option marked `recommended: true`
   (multi-select questions: the recommended set), and no question needs a
   write-in to be answered;
5. the gate does not carry a "needs the operator" flag;
6. its kind is not a failure, off-script, doctor or escalation kind, and its
   context is not an evidence-board context.

The answer is the recommended option for every question, plus `proceed`
for the step's continue question. It is written to the gates table as a
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
- The pack's work pipeline sets `reach` on each gate it opens. Where it
  lives in the pack (stage fill text versus a manifest field) is the
  builder's call; the rule is that each work gate declares one.
- A step sets `needsOperator` when its decision turns on a product or
  people call (what a PM meant, a flag key from a conversation, a
  follow-up ticket), even when it has a recommendation. The step's
  guidance says when; the gate then asks in every mode, and the form shows
  the reason.

## The mark-ready digest

The gate where a mode stops (mark-ready under `draft-mr`, ship under
`worktree`) opens with a digest of every decision the mode made in this run:
the step, the question, the option taken, and for self-review the findings
fixed and waived. rt supplies the decisions (run snapshot, filtered on a
`mode:` decider); the pack's step renders them into the gate context. Under
`checkpoint-free`, the digest goes into the run's close report instead.

## Phase 2: live feed, Pause and Redo

- **Feed.** The console's Gates view lists gates answered by a mode, marked
  as such, with the choice made, under their run. For herd runs, the herd
  room also gets one line per such decision.
- **Pause.** A feed row's Pause holds the run at its next step (today's
  `hold` run control).
- **Redo.** A feed row's Redo sends the run back to that gate's step with the
  operator's note (today's `go-back` run control), and resets the branch to
  the commit recorded when the gate opened. Steps that change code commit
  before opening their gate, so that commit is a clean rewind point.
- **Redo past ship** would rewrite a pushed branch. It asks for confirmation
  first ("this rewrites the pushed draft branch"), never silently.

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
- The feed can Pause and Redo.
- rt decides at gate open (approach A).

## Left to the builder (marked as my calls)

- The four mode names and the reach vocabulary above.
- The shadow switch being separate from the mode.
- The digest at the stopping gate and its fallback to the close report.
- Recording the head commit at gate open rather than committing per gate.
- Confirmation before Redo past ship.
- Setting key name, where the pack declares reach, and the exact field names.
