The Claude target's native fragments. A skills expand or compile for the
claude harness places each `## <name>` section where a source writes
`{{harness:<name>}}` on a line of its own. Each name here has
a twin in `codex.md`. A fragment holds only the native sequence; the rule it
carries out stays in the source that places it.

## status-writes

When your tool list has `mcp__mattstack-mods__status`, every
`<status-bin> review-status`, `respond-status` or `doctor-status` write in
this skill is a call to that tool instead of a Bash command: `verb` is the
word after `<status-bin>`, and `args` is every word after the verb, in
order, with a message of several words as one string. If the tool answers
that it is not live, run the same write with `<status-bin>` in Bash. Without
that tool, run `<status-bin>` as written. Every other `<status-bin>` verb
(`gate`, `review-ledger`) always runs in Bash.

## questions

Ask with the AskUserQuestion tool: at most 4 questions per call and 4
options per question, each option's `label` as its label and its
`description` as its description. Questions past one call's 4 go in order,
one call per chunk. The picks come back as the tool result; whatever the
human types in the tool's free-text field rides as a note.

## wait

Start the wait command this step names once, with the Bash tool and
`run_in_background: true`, and never a second while one for the same wait
runs. Then end the turn in the one line the step gives. When the command
exits, Claude Code re-invokes this session with its output as the tool
result: that is the step's wait-finished trigger. Words the human types
meanwhile arrive as an ordinary message.

## delegation

Start the helper with the Agent tool: the prompt the step gives, and
`model` set to the alias the models fragment gives for its tier. It returns
its report as the tool result. To talk to the same helper again, use
SendMessage with the agent id the Agent call returned; a new Agent call is a
new helper with none of the earlier context.

## models

| Tier | Claude Code alias |
|---|---|
| light | `haiku` |
| standard | `sonnet` |
| deep | `opus` |
| long-horizon | `fable` |

Aliases track the provider's recommended version (Bedrock, Foundry and
Google Cloud resolve `opus` and `sonnet` differently from the first-party
API). A rejected alias exits 1 at launch: a visible failure, not a silent
downgrade.

| | Spawn-time (`claude` CLI, `herd_spawn`) | Delegation-time (Agent tool) |
|---|---|---|
| Model | alias or full ID | enum: `haiku`, `sonnet`, `opus`, `fable` |
| Effort | `--effort` flag (`effort` on `herd_spawn`) | no effort parameter exists |
| `best` / `default` / `[1m]` | accepted | rejected |

So an effort change is spawn-time only here. `opusplan` upgrades only inside
Claude Code's plan permission mode, which skill-driven workers never enter:
never pick it. `best` and `default` resolve by org entitlement, not work
shape. `[1m]` variants pick a context window, not a tier; quote them
(`'opus[1m]'`), since brackets are zsh glob characters.

Claude Code clamps an unsupported effort level to the highest supported
level at or below it, so no per-model matrix is needed. Organization effort
caps clamp silently in background agents and JSON output modes. `ultracode`
is a Claude Code setting (xhigh plus workflow orchestration), not a level.

## accounts

Accounts are cswap accounts. A spawned worker takes one at launch: pass it
as `account` on `herd_spawn` (`--account <A>` on a Bash spawn), and rt
launches Claude Code under that account's config dir. A delegated helper
(the Agent tool) always runs on this session's account.

## resources

A path that starts with `${CLAUDE_SKILL_DIR}` names this skill's own files:
Claude Code expands the variable to this skill's folder, so run or read it
as written. When this skill runs a `resolve-args.sh`, run it with no options:
its defaults read `~/.claude/skills` and `claude plugin list`.
