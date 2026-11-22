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
  its own, so a slash command works. Left out, the fresh context holds the
  ledger and waits for something else (a pending wakeup, a chat message) to
  start its next turn.

The call returns at once. The reset runs just after the turn ends, then the
mod adds the ledger to the fresh context and submits `then`.

## The command

`/fresh [clear|compact] [note]` asks the session to write its ledger and call
the tool. A bare `/fresh` clears. The note becomes `then`.

## Busy sessions

A clear would cut off background work, so `clear` refuses while a subagent,
a background shell, a monitor or a workflow is still running, and names each
one. It checks again when the turn ends and abandons the reset if work
started in the meantime. A pending wakeup is not busy: it survives a clear.
`compact` never refuses.

## rt chat

A session signed in to rt chat keeps its chat name across a clear. Before the
reset the mod runs `rt chat handoff begin`; the next session runs
`rt chat handoff complete`, takes over the name, its status, rooms and any
Slack chat, and gets the usual welcome with whatever arrived meanwhile. The
name never shows offline. If the clear does not happen, the mod cancels and
the session signs out as it always did.

## Files

The mod keeps one working file per reset, `carry-<session id>.json`, in its
plugin data folder, so a reload of the mod mid-reset still finishes the job.
It is deleted once the ledger is handed over.
