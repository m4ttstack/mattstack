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
| `then` | string, optional | The instruction the fresh context starts on. Left out, the fresh context holds the ledger and starts no turn; something else (a pending wakeup, a chat message) starts the next one. |

### What a call does

1. **Refuse while busy** (clear mode only; compaction never drops work, so
   compact mode never refuses). Busy means a running subagent, a
   `run_in_background` shell or a `Monitor` watcher: the call returns an
   error naming each one and does nothing else, and the caller tries again
   later. A pending `ScheduleWakeup` is not busy: the spike showed it firing
   on time after a `/clear`. *My call.*
2. **Save the carry.** Write `{ mode, ledger, then, oldSessionId, chat? }`
   to the mod's data folder (`CLAUDE_PLUGIN_DATA`), keyed by the old
   session id, and also hold it in memory. The file is what survives a hot
   reload: a `session.start` that finds a carry for a session id that is no
   longer current finishes the hand-off and the first prompt from it. The
   carry is the mod's working file only; the caller's durable ledger stays
   wherever its skill keeps it.
3. **Start the chat hand-off** if the session is signed in (see below).
4. **Return at once**, saying what will happen.
5. **Just after the turn ends** (`$.clock.after`), run the reset:
   - `clear`: `$.command.run({ command: "clear" })`.
   - `compact`: `$.session.compact({ instructions })`, with the ledger as
     the instructions, so the summary keeps what the caller cares about.
6. **On `session.end` with `reason: "clear"`** for the saved old id (clear
   mode), or when the compaction resolves (compact mode): finish the chat
   hand-off under the current session id, then submit the first prompt.
7. **Hand over the ledger.** Add the ledger to the fresh context with
   `$.session.append`, so it is there before any turn. Then, if `then` was
   given, submit it on its own with `$.prompt.submit`. A `then` that starts
   with `/` therefore runs as a slash command, which it would not if it were
   buried at the end of a longer prompt. *My call.*
8. Delete the carry file once the ledger is handed over.

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
  session id to the new one, then delivers the usual sign-in welcome frame
  with its unread catch-up (`deliverWelcome`). The fresh context learns its
  handle the normal way, and messages that arrived during the reset come in
  with the catch-up. *My call.*
- **Cancel**, run by the mod when the reset does not happen.

Begin records the Claude process (its pid) beside the old session id.
While an identity is handing off:

- The sign-out that fires when the old session ends (the spike saw it fire
  on `/clear`) leaves the presence row signed in and does not close a held
  Slack conversation (today's `chat:sign-out` handler calls `finishClose`
  with `pane-gone`). It still deletes the old session's local session file.
- The roster reads the row as live while that pid is alive. Today
  `buddyStatus` (`lib/state/presence-store.ts`) checks the row's session id
  against the Claude registry, which names the new id after a `/clear`, so
  without this the row would read offline until Complete.
- Messages to the identity are held for it as for any signed-in identity
  that isn't reachable, and come in with Complete's catch-up.

The hand-off ends in exactly one of these ways, with no clock:

- **Completed** by the new session's call.
- **Cancelled** by the mod.
- **The old session ended for a reason other than `clear`**, or the pid
  died: the existing liveness rules treat the row like any other session
  that went away.
- **The pid's registry entry moved past the expected hand-off**: it now
  names a session that signed in or out of chat on its own, or a third
  session id. The mod failed to complete, so the row signs out as today.
  *My call.*

A mod that loses its in-memory state mid-way finishes from the carry file
at its next `session.start` (step 2), so a hot reload does not strand the
hand-off.

Complete is refused unless the caller is a session in the same process
lineage (same pane where there is one) and the identity is handing off
from the given old session id. This follows the identity spec's rule that
inheriting an identity is CLI-typed or daemon-internal.

## Who uses it

- **pr-usher**: ends each tick with its `ScheduleWakeup`, then
  `fresh_context({ mode: "clear", ledger: <its PR ledger> })` with no
  `then`, only when no Opus review is in flight. The fresh context sits
  idle with the ledger until the wakeup fires `/mattstack:pr-usher`, so the
  5 to 20 minute pacing holds and no extra tick starts. The usher's durable
  ledger moves out of the scratchpad (whose path changes with the session
  id) to a stable path the usher skill names; each tick reads it from
  there. *My call.*
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
- How the mod detects running subagents, background shells and monitors
  (`$.agent`, `$.session` reads).
- Whether `/clear` kills background work. The busy refusal makes this
  moot for correctness, but the answer belongs in the mod's README.
- Confirming `$.session.append` puts text the model reads into the fresh
  context; if it does not, fall back to one submitted prompt holding the
  ledger, then `then` as a second prompt.
- The carry file's exact shape and name.
- Testing a DM sent to the identity during the reset, to show none is lost.
