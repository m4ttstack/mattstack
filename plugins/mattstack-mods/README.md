# mattstack-mods

The Claude Code mod for mattstack's harness integrations: a plugin of
function hooks that gives Claude Code sessions a direct path for chat
delivery, gates, presence, policy and supervision. rt installs it only when
`agent.integrations.enabled` is on. Each feature falls back to its existing
hook or CLI path when its block is not live.

It needs Claude Code 2.1.293 or newer (`MIN_CLAUDE_CODE` in
`src/core/version.ts`). On an older engine, or in a session with no person
at the prompt (`claude -p`, the SDK), the plugin loads but starts no block,
so every feature takes its existing path.

## Layout

| Path | What it is |
| --- | --- |
| `hooks/register.ts` | The one module `hooks/hooks.json` names. It builds the hub and the link and registers the blocks. |
| `src/core/hub.ts` | The hub. It owns every engine hook and fans each event out to the blocks. |
| `src/core/link.ts` | The daemon link: register, heartbeat, `/clear`, end, waits and pushed commands. |
| `src/core/rpc.ts` | One call to a daemon verb over `rt.sock`, capped at 25 s. |
| `src/core/blocks.ts` | The block names. It imports nothing, so an rt-side bun test can compare it with rt's copy. |
| `src/core/version.ts` | The minimum engine version, the check against it, and the plugin version the link reports. |
| `src/blocks/` | One file per feature block (none yet). |
| `types/index.d.ts` | The plugin's own contract: the `$.state` values it keeps. |
| `tests/` | `claude plugin test` cases. They drive the hub and link with the stubbed `$` in `tests/stub.ts`. |

## Blocks only see the facade

The engine follows `$` only into top-level functions of the file that
received it. It never follows `$` across an import or into a stored callback,
and `claude plugin validate` refuses a module that tries. So blocks never
receive `$`. `hub.ts` builds a narrow facade, `ModApi`, from `$` in the same
file that registers the engine hooks, and hands blocks that instead. A block
that needs another engine call adds a member to `ModApi` in `hub.ts`. A
`$.state` or `$.env` member names its key as a literal, since the engine only
accepts literal keys.

A block registers with `hub.block(name, start)`. `start` receives the facade
and a scope, and everything it subscribes to through that scope (tool rules,
delivery receivers, stop handlers, lifecycle events, render sites, prompt
sections) belongs to it. If one of those throws, the hub logs it to the debug
log, clears the block for the session and passes the event through as if the
mod were not there. What is subscribed on the hub itself belongs to the core
and never lapses. A `start` that has not settled after 3 s counts as failed,
and the next block starts.

Tool rules run in five stages:

- `fill` returns the call's input, edited or not.
- `guard` returns `{ refuse }` to stop the call.
- `permit` wraps the call as middleware.
- `tap` sees the result after the call.
- `check` answers `tool.check` with a decision.

## The daemon link

`createLink(hub).start()` in `register.ts` subscribes the link before any
block, so it sees deliveries first. Once the blocks have started, it calls
`session:register` over `rt.sock` (`RT_DAEMON_SOCK`, else
`$HOME/.mattstack/rt/rt.sock`) with the live blocks, keeps only the blocks the
daemon answers, and heartbeats every 10 s. A `/clear` re-registers under the
new session id, naming the old id and link. Any other session end sends
`session:end` and turns every block off. An `unknown-link` answer (the daemon
restarted) registers again with the same session id; a refused register turns
every block off for the session. A register the daemon could not take is sent
again, unchanged, on the next beat. When the hub clears a block, the link
re-registers the same session with the blocks still live, so the daemon stops
counting it; clears within 50 ms share one re-register. A SessionStart from a
resume or a compaction of the linked session sends `session:report` with the
event and the session's cwd, root and pane; rt treats that context as a hint.
An `unknown-link` answer re-registers and sends the report once more.

A block reaches the daemon through the link:

- `link.wait(pattern, after, until, signal)` long-polls `events:wait` in
  20 s rounds, passing the cursor, and retries a dropped round with the same
  cursor.
- `link.onCommand(kind, handler, block)` takes the commands rt sends with
  `pushModCommand`. Each arrives as an inbox delivery that is exactly
  `<rt-mod-command id="..." kind="..." link="<link id>">json</rt-mod-command>`.
  Any inbox writer can send that text, so the link takes it only when `link`
  is its own current link id, which only the daemon holding the link knows;
  any other envelope passes through untouched. The link consumes a matching
  envelope before the model sees it, acks it with `session:ack` at once
  (the ack means the mod owns it), then runs the handler. A command with no
  handler, or whose block is not live, is not acked, so rt takes its fallback.

The core answers two diagnostic commands, the only kinds `rt.sock`'s
`session:push` will send: `probe.ping` logs and acks, and `probe.wait` (`{ pattern, after }`)
runs a wait of up to 5 minutes and logs where it ended. Every link line goes to
the debug log, prefixed `mattstack-mods:`.

## Checks

```bash
claude plugin validate plugins/mattstack-mods
(cd plugins/mattstack-mods && claude plugin test)
```

CI runs both, pinned to Claude Code 2.1.293, in the `plugin-mattstack-mods`
job. A pull request that changes this folder has to bump the version in
`.claude-plugin/plugin.json`.

To type-check, load the folder once (`claude --plugin-dir plugins/mattstack-mods`)
so the engine writes its types into `.claude-plugin/types/` (git ignores
them), then run `tsc -p plugins/mattstack-mods`.
