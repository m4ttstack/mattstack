# mattstack-mods

The Claude Code mod for mattstack's harness integrations: a plugin of
function hooks that gives Claude Code sessions a direct path for chat
delivery, gates, presence, policy and supervision. rt installs it only when
`agent.integrations.enabled` is on. Each feature falls back to its existing
hook or CLI path when its block is not live.

It needs Claude Code 2.1.293 or newer (`MIN_CLAUDE_CODE` in
`src/core/version.ts`). On an older engine the plugin loads but starts no
block, so every feature takes its existing path.

## Layout

| Path | What it is |
| --- | --- |
| `hooks/register.ts` | The one module `hooks/hooks.json` names. It builds the hub and registers the blocks. |
| `src/core/hub.ts` | The hub. It owns every engine hook and fans each event out to the blocks. |
| `src/core/blocks.ts` | The block names. It imports nothing, so an rt-side bun test can compare it with rt's copy. |
| `src/core/version.ts` | The minimum engine version and the check against it. |
| `src/blocks/` | One file per feature block (none yet). |
| `types/index.d.ts` | The plugin's own contract: the `$.state` values it keeps. |
| `tests/` | `claude plugin test` cases. They drive the hub with a stubbed `$`. |

## Blocks only see the facade

The engine follows `$` only into top-level functions of the file that
received it. It never follows `$` across an import or into a stored callback,
and `claude plugin validate` refuses a module that tries. So blocks never
receive `$`. `hub.ts` builds a narrow facade, `ModApi`, from `$` in the same
file that registers the engine hooks, and hands blocks that instead. A block
that needs another engine call adds a member to `ModApi` in `hub.ts`. A
`$.state` or `$.env` member names its key as a literal, since the engine only
accepts literal keys.

A block registers with `hub.block(name, start)`. Everything it subscribes to
while `start` runs (tool rules, delivery receivers, stop handlers, lifecycle
events, render sites, prompt sections) belongs to it. If one of those throws,
the hub logs it to the debug log, clears the block for the session and passes
the event through as if the mod were not there.

Tool rules run in five stages:

- `fill` returns the call's input, edited or not.
- `guard` returns `{ refuse }` to stop the call.
- `permit` wraps the call as middleware.
- `tap` sees the result after the call.
- `check` answers `tool.check` with a decision.

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
