---
paths:
  - "commands/chat.ts"
  - "commands/herd.ts"
  - "commands/pane.ts"
  - "commands/agent*.ts"
  - "commands/gate.ts"
  - "commands/events.ts"
  - "commands/ci.ts"
  - "commands/mcp.ts"
  - "commands/runs*.ts"
  - "commands/worktree-hook.ts"
  - "commands/cd.ts"
  - "commands/nav.ts"
---

# Output layer: verbs agents read

`rt chat` is read by agents as often as by a person, so its stdout off a
terminal is frozen. Every verb writes the text it always wrote through
`out.payload` (`say` in `commands/chat.ts`) and its `--json` through
`out.json`, and `commands/__tests__/fixtures/chat-bytes.json` pins the bytes;
never regenerate that fixture to make a change pass. Chat's `--json`
envelopes carry the daemon's words and are not reworded, unlike the
envelope sentences above. Only `rooms`, `read`,
`who`, `buddies`, `sign-in` and `--help` draw blocks, and only when
`out.isHuman()` says a person is at the terminal (`show`). Chat failures are
ordinary `failure` blocks on stderr; where chat declines on purpose (a long
one-line message, a second identity in one session) it is a `refused` note
(`refuse`), with the same exit code.

The agent-only verbs the spec leaves unconverted (`gate`, `events`, `ci`,
`mcp`, `runs find` and the run-tracking writes, `worktree claude-hook`)
still write through the layer, with no change of bytes: stdout through
`out.json`, `out.jsonFlushed` or `out.payload`, stderr through
`out.diagnostic`, which is the stderr twin of `out.payload` and is for
agent-facing verbs only (these, and the herd, pane and agent verbs).
`commands/__tests__/fixtures/agent-verbs-bytes.json` pins them; never
regenerate it to make a change pass. A file that must
touch a stream directly (the loggers, an escape parser) goes on
`lib/__tests__/raw-output-exemptions.json` with its reason and its exact
count of raw lines, and the guard fails if that count moves.

`rt herd`, `rt pane` and `rt agent` follow chat's rule: off a terminal
every verb writes the bytes it always wrote (`say` and `out.json` on
stdout, `out.diagnostic` on stderr), pinned by
`commands/__tests__/fixtures/herd-pane-agent-bytes.json`; only `herd
list`, `herd status`, `herd gates`, `pane list` and `agent list` draw
blocks, and only when a person is at the terminal.

`rt cd` and `rt nav` print a path for the shell wrapper. They call
`out.holdStdout()` while their pickers run, which sends any stray write and
all human text to stderr, then release it and write the path with
`out.payload`. A child they start gets the terminal on stdout through
stderr's descriptor (`stdio: ["inherit", 2, "inherit"]`), never the
wrapper's pipe. Neither erases rows on exit.
