# fresh-context

Lets a Claude Code session clear or compact itself and pick up where it left
off, without anyone typing `/clear` for it.

## The tool

`fresh_context({ mode, ledger, then })`

- `mode`: `clear` starts a brand-new conversation; `compact` runs Claude
  Code's own compaction, steered by the ledger.
- `ledger`: free text the session wrote about where it is. The mod carries it
  as is; each skill decides what its ledger holds.
- `then`: optional. The instruction the fresh context starts on, submitted on
  its own. It can name a plugin skill as `/plugin:skill args`, which goes in as a
  request to use that skill; any other slash command is refused. Left out, the fresh context holds the
  ledger and waits for something else (a pending wakeup, a chat message) to
  start its next turn.

The call returns at once. The reset runs just after the turn ends, then the
mod adds the ledger to the fresh context and submits `then`.

## The command

`/fresh [clear|compact] [note]` asks the session to write its ledger and call
the tool. A bare `/fresh` clears. The note becomes `then`.

## Busy sessions

`clear` refuses while a subagent, a background shell, a monitor or a workflow
is still running, and names each one. It checks again when the turn ends and
abandons the reset, with a notice, if work started in the meantime. A
`/clear` does not stop a background shell (checked on Claude Code 2.1.330):
the process keeps running, but the fresh context no longer knows why it was
started or what to do with its output. A pending wakeup is not busy: it
survives a clear and fires once, into the fresh context. `compact` never
refuses, and keeps the session id.

## rt chat

A session signed in to rt chat keeps its chat name across a clear. As the
clear runs, the mod starts `rt chat handoff begin`; the next session runs
`rt chat handoff complete`, takes over the name, its status, rooms and any
Slack chat. The chat welcome, with everything that arrived during the reset
(messages the old session saw included), lands in the fresh context after
the ledger without starting a turn, unless a message arrived during the reset
(that wakes the session, like any delivery) or Claude Code refuses the quiet
append (then it goes in as a prompt). The name never shows offline. If the
clear does not happen, the mod cancels and the session stays signed in as it
was. A session that exits instead signs out as it always did.

## Reloads

The queued reset lives in the mod's session state as well as in memory, so a
reload of the mod before the clear still runs it, and a reload after the
clear still hands the ledger over.
