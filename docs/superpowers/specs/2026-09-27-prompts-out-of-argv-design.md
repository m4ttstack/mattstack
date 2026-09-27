# Agent prompts never ride argv

## Problem

`rt herd spawn` and `rt agent start/resume` launch claude (or codex) with the
whole prompt as a positional argument. A herd brief is several kilobytes of
instructions, so every worker's brief sits in the command line of its
`claude` process, its `cswap run` wrapper, the transient `herdr pane run`
call, and the pane shell's history. A worker that ran
`pkill -f "bun run test"` matched four other lanes' claude processes, because
their briefs mention that command, and killed them.

## Goal

No agent rt launches carries its prompt text in any process's argv. Success
test: a spawned worker's `ps -o args` shows no brief text.

Every current behavior is kept: the prompt is what the agent acts on first,
the trust dialog is still driven, the cswap account wrapper still applies,
and resume (with or without a new prompt) still works.

## Decision (ratified at gate 2d7e22c1)

- **Interactive launches** (the herdr surface: herd workers, `rt agent start`,
  `rt agent resume`, rebase escalation): the prompt is written to an
  owner-only file, and the agent is launched with a short pointer prompt
  naming that file. The pointer is the only prompt text in argv.
- **Headless launches** (`rt agent start --headless`, headless resume,
  `rt skills audit`): the prompt is fed on stdin. `claude -p` and
  `codex exec` both read the prompt from stdin when no positional prompt is
  given, so the text stays the literal first message.

Interactive claude has no stdin prompt path (`claude --help`, 2.1.283), and
typing the brief in after launch would make spawn wait for the pane to
settle and race the chat welcome frame, so it was rejected.

## Design

### Prompt file helper (`lib/agent-argv/prompt-file.ts`)

- `writePromptFile(dir, name, text): string` creates `dir` with mode 0700
  (and chmods it to 0700 if it already existed), writes `<dir>/<name>` with
  mode 0600 (chmod after write so an existing file is tightened too), and
  returns the absolute path.
- `pointerPrompt(path): string` returns the fixed one-line pointer:
  `Your instructions for this session are in <path>. Read that whole file now and follow it as your task.`

The helper is pure fs plus string; no daemon state.

### Launch seam (`lib/daemon/handlers/agent.ts`, `launch()`)

The one place every herdr and headless agent launch passes through.

- herdr surface, prompt starts with `/`: passed through unchanged into
  `inv.prompt`, no prompt file, no pointer. Claude Code only expands a slash
  command when it is the literal first message it receives, so wrapping a
  `/board:review ...`-shaped prompt (the board app's slash-command dispatch;
  see "Out of scope" below) in a pointer would break the expansion. The
  passthrough keys on the first character, so any herdr prompt starting with
  `/` stays in argv in full; herd briefs and rt agent prompts are not slash
  commands in practice. The residual argv exposure this accepts: a board
  operator note appended to the slash command, capped at 2000 characters by
  the board.
- herdr surface, any other prompt: write it with
  `writePromptFile(join(rtDir(), "agent-prompts", rec.id), "prompt.md", prompt)`
  and put `pointerPrompt(path)` in `inv.prompt`. The per-agent directory
  (rather than a flat `agent-prompts/<id>.md`) means the launch can also grant
  read access to exactly that directory, and nothing else, via `addDirs:
  [dir]` on the invocation -- `claudeArgs` emits this as `--add-dir <dir>`
  immediately before `--session-id`/`--resume`, so an unattended pane (a herd
  worker under non-auto permissions) can read its own pointer's target with
  no permission prompt. `agent-prompts` itself is also kept 0700. A resume
  with a new prompt overwrites the same file; the previous launch has already
  read it.
- headless surface: `inv.prompt` still carries the text (the builders use it
  to validate that a headless launch has a prompt), and `launch()` passes the
  same text to `spawnHeadless` as its stdin. `defaultSpawnHeadless` writes it
  to the child's stdin instead of `"ignore"`.

### Builders (`lib/agent-argv/claude.ts`, `codex.ts`)

- `buildClaudeArgv` / `buildCodexArgv` with `headless: true` never append the
  prompt; the prompt-required check stays. The doc comment states the
  contract: a headless prompt is the caller's stdin.
- `buildPaneCommand` / `buildCodexPaneCommand` are unchanged: they quote
  whatever `inv.prompt` holds, which is now always a pointer when it comes
  from `launch()`.

### Herd (`lib/daemon/handlers/herd.ts`)

`job.md` already holds the brief; it is now written through
`writePromptFile` so the job dir is 0700 and the file 0600. The brief still
reaches `agent:start` as `prompt`, which turns it into the per-agent pointer
file above. Two owner-only copies is accepted over widening `agent:start`'s
payload with a caller-supplied path.

### Rebase escalation (`lib/rebase-escalation.ts`)

Already launches with a pointer. `writeTaskFile` moves onto
`writePromptFile` so its task file is owner-only too.

### `rt skills audit` (`commands/skills-audit.ts`)

Its prompt lists every file in the pack plus every MCP tool description, all
in argv today. It builds a headless invocation, so the builder change drops
the prompt from argv; `runCapture` gains an optional `stdin?: string` and the
audit passes the prompt there.

### Out of scope

- `pane:spawn` already types its prompt into the pane after launch; nothing
  reaches argv.
- The board app (`apps/board/src/agent-launch.ts`, `herdr.ts`'s
  `dispatchPrompt`) does call `agent:start`/`agent:resume` with `surface:
  "herdr"`, same as any other herdr caller; it is not outside this change's
  write fence. Some board prompts are `/board:review`/`/board:respond`/`/board:doctor`-shaped
  slash commands that stay in argv via the passthrough above. Others, like
  the reopen path's bare "Operator note ..." prompt, go through the pointer file.
  The gitq app launches panes with short slash commands; those invocations lie
  outside this change's write fence.
- Pruning old `agent-prompts/<id>/` directories: they live beside the
  existing `agents/<id>.json` result files, which are not pruned either.

## Error handling

A failed prompt-file write throws inside `launch()`, which `agent:start`
already turns into `{ ok: false }` and a rolled-back record. Nothing is
launched without its prompt.

## Testing (test-first)

- `lib/__tests__/agent-argv*.test.ts` (and a new `prompt-file.test.ts`): `writePromptFile` sets 0700/0600 on fresh and
  pre-existing paths; the pointer names the path; headless builders never
  emit the prompt.
- `agent-handlers.test.ts`: a herdr launch's pane command (captured from the
  fake herdr runner) contains no prompt text and the pointer's file holds
  the prompt at 0600; a headless launch's argv holds no prompt and its stdin
  is the prompt; resume with a prompt behaves the same.
- `herd-handlers.test.ts`: `herd:spawn`'s `agent:start` call still carries
  the brief, `job.md` is 0600 in a 0700 dir.
- `skills-audit` test: the argv carries no prompt; stdin does.
- Manual, isolated HOME: launch a pane command built by `launch()` through a
  real shell with a stand-in `claude` on PATH that sleeps, and confirm
  `ps -o args` for that PID shows the pointer and no brief text.
