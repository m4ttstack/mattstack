The Codex target's native fragments. A skills expand or compile for the
codex harness places each `## <name>` section where a source writes
`{{harness:<name>}}` on a line of its own. Each name here has
a twin in `claude-code.md`. A fragment holds only the native sequence; the
rule it carries out stays in the source that places it.

## status-writes

Run every `<status-bin>` write in this skill in the shell, as written.

## questions

Codex gives a skill no form tool it can rely on: `request_user_input`
exists only in plan mode, and a question item Codex shows outside plan mode
is not an answer anyone gave. So:

- In plan mode, with `request_user_input` in your tools and no gate open
  for these questions, ask with it; its result is the answer.
- Otherwise ask in words: each question, then its options as a numbered
  list (the label, then the description after a dash), saying whether one
  or several may be picked. Words have no per-call limit, so every chunk
  goes in the one message. Record whatever the step says to record first,
  then make the questions this turn's last message and end the turn. The
  human's reply is the answer: map their words onto the options' values,
  and carry anything more they said as a note.

Never treat a question you showed as answered until a person's reply, or a
gate's recorded answer, says so.

## wait

Codex re-invokes nothing when a command finishes after the turn has ended,
so a wait never runs in the background here and the turn stays open while
it runs. Print the one line the step gives, then run the wait command this
step names in the shell and stay with it until it exits:

- When the shell call comes back while the command still runs (it handed
  back a running session, or hit the call's time limit), read that session
  again, or run the same command again: a wait only reads state.
- Its final output is the result: carry on from the step's wait-finished
  trigger in this same turn.
- A message the human sends while you wait is the step's words trigger,
  if it has one: stop waiting and handle it there. A step with none: answer
  the message in one line and keep waiting.

Never end the turn with the wait unfinished: nothing would bring you back.

## delegation

A helper is a separate `codex exec` run in the shell:

1. Start it with
   `codex exec --json --sandbox read-only -m <model> -c model_reasoning_effort=<effort> "<prompt>"`,
   with the model and effort the models fragment gives for its tier (leave
   out `-c ...` to keep the model's default effort, and use
   `--sandbox workspace-write` only when the helper must edit files). The
   run needs the network; when the sandbox blocks it, ask for the command
   to run with escalated permissions.
2. Its first `--json` event, `thread.started`, carries its `thread_id`:
   keep it. Its last `agent_message` item is its report.
3. To talk to the same helper again, run
   `codex exec resume <thread_id> --json "<message>"`; it keeps everything
   the helper read and said, and the model and sandbox it started with. A
   new `codex exec` is a new helper with none of it.

## models

Codex has no tier aliases: a tier is a model plus a reasoning effort.

| Tier | Codex model and effort |
|---|---|
| light | the smallest coding model Codex lists, `low` effort |
| standard | this profile's model, its default effort |
| deep | this profile's model, `high` effort |
| long-horizon | the most capable model Codex lists, `high` effort |

"This profile's model" is the one this session runs on, and naming it means
leaving the model out: a run on this profile with no `-m` (no `model` on
`herd_spawn`) takes it, so an omitted model is no tiering loss here. Name
any other model only when you can see that Codex lists it (its `/model`
list); when you cannot, use this profile's model with the tier's effort
from the table (`low` for light, `high` for long-horizon). Effort is one of `minimal`, `low`, `medium`, `high`, as the
model allows.

| | Spawn-time (`herd_spawn` with `harness: codex`) | Delegation-time (`codex exec`) |
|---|---|---|
| Model | `model` | `-m <model>` |
| Effort | `effort` | `-c model_reasoning_effort=<effort>` |

Effort applies on both surfaces here.

## accounts

Codex takes no account: a worker or helper runs on the Codex profile it
launches under, and `herd_spawn` refuses an `account` for a Codex worker.
Never pass one, and never ask the account question for a Codex worker.

## resources

`<skill-dir>` is this skill's own folder: the folder holding the SKILL.md
Codex loaded for this skill (the path Codex lists for it, or the SKILL.md
path the launch prompt names). Every `<skill-dir>/...` path is that folder
joined with the rest. Write it out as an absolute path before you run or
read it; the shell's working directory is the repository, never the skill.
When this skill runs a `resolve-args.sh`, run it with no options: a Codex
build of it reads `${CODEX_HOME:-$HOME/.codex}/skills` and lists no Claude
plugins on its own.
