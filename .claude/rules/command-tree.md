---
paths:
  - "lib/command-tree*.ts"
  - "lib/module-registry.ts"
  - "scripts/lib/picker-conformance.ts"
  - "cli.ts"
---

# Command tree

## Command descriptions are plain language

A node's `description` in `lib/command-tree-def.ts` is what a user reads in
the picker, `--help` and the reference pages. Write it as a short, plain
sentence about what the command does for them: "Jump to a repo or worktree",
"See what's running on your ports and kill it", "Undo the last commit, keep
its changes".

Leave out what belongs in `args` hints or the reference page: flags
(`--json`, `--force-with-lease`), picker behavior ("no target + TTY →
picker"), implementation ("daemon-powered", "from git-core"), parenthetical
lists of subcommands, and internal names (registry, index, on-deck pool). A
verb that is only for the apps, skills or daemon goes in the
`rt.picker.hidden` default rather than getting a description that warns
people off it. After editing descriptions, run `bun run docs:gen`.

The same style governs every message a command prints: say what happened for
the person in a short plain sentence, speak to "you" and "this", leave out
flags, store names, file paths and step ids, and put the command to run in a
`next` callout rather than mid-sentence. Name only verbs that exist.

### Module registry

When adding a new command module referenced by `cli.ts` (any file with a `module:` entry in the command tree), you **must** also register it in `lib/module-registry.ts`. `bun build --compile` cannot resolve dynamic `import()` with runtime-constructed paths, so the compiled binary relies entirely on this registry to discover and bundle every command module. Running from source (`bun run cli.ts`) works fine without the registry entry because the dynamic import fallback succeeds, so you won't catch this locally -- it only breaks in the distributed binary.

Every registry value is a thunk (`() => import("../commands/x.ts")` with the path spelled out literally), not an eagerly-evaluated namespace import. That's what keeps `rt --version` and every other dispatch from paying for the whole command surface: the bundler still statically discovers all 30 modules, but none of them evaluate until a command actually dispatches to it. Adding a static (non-thunked) `import` of a command module to `lib/module-registry.ts`, or a static value import of `lib/rt-render.ts`/`ink` to `lib/command-tree.ts`, is a startup regression. `scripts/bench-startup.ts` gates this in the release workflow (`.github/workflows/release.yml`), and `lib/__tests__/no-eager-tui.test.ts` gates the command-tree and command-module cases directly.

### A required-positional leaf must declare `omitBehavior`

rt's convention is that omitting the next subcommand OR a required arg shows a
picker, never a bare error. Branch-node subcommand pickers are structural (the
dispatcher). The leaf *argument* picker lives in each handler, so it is enforced
by a declaration: every visible leaf with a required positional (flagless,
non-`optional`, text/select arg) must set `omitBehavior` on its node in
`lib/command-tree-def.ts` (`"picker" | "list" | "prompt" | { exempt: "why" }`).
`bun run picker:check` (`scripts/lib/picker-conformance.ts`) and
`lib/__tests__/picker-conformance.test.ts` fail otherwise; the check gates
`.github/workflows/checks.yml` and the preflight node of the `rt:release` skill
(`skills/rt-release/SKILL.md`). Adding a command that just errors on a missing
positional breaks CI, not review.

The picker itself is the other half: rt is driven non-interactively by agents and
scripts as much as by humans, so **every leaf picker must gate `process.stdin.isTTY
&& !json && !process.env.RT_BATCH`** and leave the non-TTY / `--json` path exactly
as it was (same usage message, same exit code, same JSON). An empty candidate set
falls through to that existing error, never an empty picker. Tag `{ exempt }` only
when the value genuinely cannot be enumerated (free-text topic/glob/name/new path)
or the verb is agent-facing by contract.
