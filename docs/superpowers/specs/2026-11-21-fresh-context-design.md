# fresh-context: clear or compact a session and keep its place

## Why

A long-running agent (the pr-usher above all) carries every earlier tick in
its context: merged PRs, resolved threads, CI runs from an hour ago. It all
goes stale, because each tick re-reads the forge anyway. Compaction keeps a
lossy summary of that stale material, costs a full pass, and fires whenever
it likes. A clean start each tick, carrying only a ledger the agent wrote,
is cheaper and more predictable.

Today a session can only reset itself through herdr: `matt:self-compact`
queues `/compact` with `rt pane send self`, and a `/clear` signs the
session out of rt chat, so the next session is a stranger to the rooms it
was in. Outside a herdr pane the human has to type the lines.

## What it is

A standalone Claude Code mod, `mods/fresh-context`, giving:

1. A tool the model calls: `fresh_context({ mode, ledger, then })`.
2. A command the human types: `/fresh [clear|compact] [note]`.
3. A new rt chat CLI hand-off, so a signed-in session keeps its chat
   identity across the reset with no moment offline.

### Goals

- Any session, herdr or not, can reset itself and pick up where it left off.
- The fresh context starts on the ledger and the `then` instruction, with
  nothing else carried over.
- A signed-in session keeps its identity, status, rooms and any Slack
  conversation it holds, and never shows offline.
- `matt:self-compact` and `mattstack:pr-usher` move onto it.

### Non-goals

- The mod does not define what a ledger contains. Each skill owns its own.
- No change to how a plain `/clear`, `/compact` or exit behaves. Default
  behaviour stays as it is.
- No change to the chat identity model
  (`2026-09-27-chat-identity-design.md`): the hand-off keeps the same id.

### Anti-goals

- A timer anywhere in the hand-off. Every step is tied to an event.
- Losing background work by clearing over it.
- An MCP tool that lets one session take another's chat identity. The
  hand-off is a CLI verb only the session itself (through its mod) runs.

## Approaches

| Approach | Trade-off | Verdict |
|---|---|---|
| **Standalone mod** (`mods/fresh-context`) | One process sees the whole reset: it runs `/clear` or the compaction, sees `session.end` with `reason: "clear"`, outlives it, and knows the new session id. No herdr needed. | **Picked** |
| rt hooks plus a note in the daemon | Needs a herdr pane to queue `/clear`, and spreads the hand-off across SessionEnd, SessionStart and the daemon. | Dropped |
| Inside the mattstack plugin's hooks | Can't be turned on or off on its own; standalone mods won that call on 2026-11-20. | Dropped |

## What the spike proved (2026-11-21, Claude Code 2.1.330)

A throwaway mod in a herdr probe session showed:

- `$.command.run({ command: "clear" })` runs `/clear` when called from a
  `$.clock.after` shortly after the tool returns. Called inside the turn it
  would be refused.
- `session.end` arrives with `reason: "clear"` and the old `sessionId`. The
  mod's module keeps running, and `$.session.id()` returns the new id about
  200 ms later.
- `rt chat sign-in --as <handle> --status <text>`, run with
  `$.process.hookEnv()` (which carries the new `CLAUDE_CODE_SESSION_ID`),
  continued the same identity with its status and room membership.
- The identity was offline for about 0.2 to 0.4 s between the existing
  sign-out and that sign-in. The hand-off verb below removes that gap.
- `$.prompt.submit({ text })` started the fresh context's first turn.
- A registered tool's arguments sit at the top level of the `tool.run`
  event (`e.then`), not under `e.input`.
- A hot reload of the mod re-runs `register` and `session.start` and resets
  module variables.

The spike source is throwaway and is not the starting point for the code.

## The tool: `fresh_context`

Registered at `session.start` with `isDeferred: false`, so it is always in
the tool list.

| Field | Type | Meaning |
|---|---|---|
| `mode` | `"clear"` or `"compact"` | `clear`: a brand-new conversation. `compact`: the engine's compaction, a summary plus recent turns. |
| `ledger` | string, required | Free text the caller wrote. Carried as is. |
| `then` | string, optional | The instruction the fresh context starts on. |

### What a call does

1. **Refuse while busy.** If a subagent or background task is still running
   in this session, return an error naming each one and do nothing else.
   The caller tries again later.
2. **Save the carry.** Write `{ mode, ledger, then, oldSessionId, chat? }`
   to the mod's data folder (`CLAUDE_PLUGIN_DATA`), keyed by the old
   session id, and also hold it in memory. The file is what survives a hot
   reload; the in-memory copy is the fast path.
3. **Start the chat hand-off** if the session is signed in (see below).
4. **Return at once**, saying what will happen.
5. **Just after the turn ends** (`$.clock.after`), run the reset:
   - `clear`: `$.command.run({ command: "clear" })`.
   - `compact`: `$.session.compact({ instructions })`, with the ledger as
     the instructions, so the summary keeps what the caller cares about.
6. **On `session.end` with `reason: "clear"`** for the saved old id (clear
   mode), or when the compaction resolves (compact mode): finish the chat
   hand-off under the current session id, then submit the first prompt.
7. **First prompt** (`$.prompt.submit`): the ledger inline, the path of the
   saved ledger file, then the `then` text. Inline, so the session doesn't
   need a read before it can act.
8. Delete the carry file once the first prompt is submitted.

If the reset is refused or the session ends any other way (exit, resume,
logout), the carry is dropped and the hand-off cancelled, so the identity
signs out as it does today.

## The command: `/fresh`

`/fresh [clear|compact] [note]`. A bare `/fresh` means `clear`.

The command does not reset anything itself. Its `command.run` hook submits
one prompt to the session: write your ledger, then call `fresh_context`
with this mode and the note as `then`. Which ledger: the one the session's
current skill keeps; with none, the sections `matt:self-compact` uses
(Goal, Where, Done, In progress, Next step, Decisions, Learned, Waiting on
Matt).

## The chat hand-off (rt)

A new CLI-only pair under `rt chat`, used by the mod, never exposed as an
MCP tool:

- **Begin**, run by the old session before the reset: marks its identity
  as handing off from this session id.
- **Complete**, run by the new session after the reset: moves the identity,
  status, room memberships and any held Slack conversation from the old
  session id to the new one.
- **Cancel**, run by the mod when the reset does not happen.

While an identity is handing off, the sign-out that fires when the old
session ends (the spike saw it fire on `/clear`) leaves the presence row
live and does not close a held Slack conversation (today's
`chat:sign-out` handler calls `finishClose` with `pane-gone`). It still
deletes the old session's local session file.

The hand-off ends in exactly one of three ways, with no clock:

- **Completed** by the new session's call.
- **Cancelled** by the mod.
- **The old session ended for a reason other than `clear`**, or the process
  died: the existing liveness rules treat the row like any other session
  that went away.

Complete is refused unless the caller is a session in the same process
lineage (same pane where there is one) and the identity is handing off
from the given old session id. This follows the identity spec's rule that
inheriting an identity is CLI-typed or daemon-internal.

## Who uses it

- **pr-usher**: ends each tick with
  `fresh_context({ mode: "clear", ledger: <its PR ledger>, then: "/mattstack:pr-usher" })`,
  only when no Opus review is in flight. Its ledger moves out of the
  scratchpad, whose path changes with the session id. Its existing
  `ScheduleWakeup` still paces the ticks: the spike showed a pending wakeup
  firing on time after a `/clear`.
- **matt:self-compact**: keeps steps 1 to 3 (read state, commit, write the
  ledger) and replaces step 4's `rt pane send self` with a
  `fresh_context({ mode: "compact", ... })` call. The "type these two
  lines" fallback goes away.

These two skill edits ship separately from the mod and the rt verb.

## Constraints

- Mods follow the `human-todos` layout: `mod.json`,
  `src/`, `harness/`, README (checked by `mods:check-readme`), LICENSE, and
  entries in `mods:test` and `mods:typecheck`.
- `$.command.run` and `$.session.compact` are refused inside a hook the
  turn waits on, so the reset always runs from a timer after the tool
  returns.
- `session.end` hooks share a 1.5 s budget. Work after the clear runs from
  a timer, not inside the hook.
- The rt verb's output goes through the output layer
  (`.claude/rules/output-agent-verbs.md`); its bytes join the chat fixture.

## Left to the builder

- Where the SessionEnd sign-out that fired on `/clear` is wired (a hook,
  the daemon's session watch, or both), and making the hand-off check sit
  there.
- The verb names and flags (`rt chat handoff begin|complete|cancel` is a
  placeholder).
- How the mod detects running subagents and background tasks (`$.agent`,
  `$.session` reads).
- Whether `/clear` kills background work. The busy refusal makes this
  moot for correctness, but the answer belongs in the mod's README.
- The carry file's exact shape and name.
- Testing a DM sent to the identity during the reset, to show none is lost.
