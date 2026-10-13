# rt (repo tools)

Personal developer CLI built with Bun. Compiled to a standalone binary via `bun build --compile` and shipped inside the mattstack.app bundle, which installs it (there is no separate CLI tarball asset).

## Architecture docs live in Linear, not this repo

rt is one piece of a plan spanning five repos, so the governing design docs are
not in any single repo. Before proposing anything about rt's scope, board,
glance, gitq, or the acme skills, read `docs/architecture.md` for the links.

## Rules that load with the code

Most of this repo's rules live in `.claude/rules/`. Each file loads by
itself when you read or edit a file matching its paths; a search does not
load it. Planning a change in an area before you have opened a file
there? Read its rule file first.

| Rule | Covers | Loads for |
|---|---|---|
| `.claude/rules/settings.md` | Settings stores, the org clone and its layout, org naming | `packages/rt-client/src/settings/**`, `lib/team/**`, `packages/settings-kit/**`, more in the file |
| `.claude/rules/worktree-pool.md` | The golden tree and hydration traps | `lib/worktree/**` |
| `.claude/rules/chat.md` | Reading order before touching chat | `commands/chat.ts`, `lib/state/chat-store.ts`, `lib/chat-viewer-url.ts`, more in the file |
| `.claude/rules/build-and-plugin.md` | The mattstack plugin's checks, the bytecode compile fallback | `plugins/mattstack/**`, `lib/skills/**`, `scripts/build*`, more in the file |
| `.claude/rules/rt-ui.md` | The Go helper, pickers, the runner, shared primitives | `ui/**`, `lib/ui/**`, `lib/runner/**`, more in the file |
| `.claude/rules/glitter.md` | GitHub Desktop as the authority, the staging model | `lib/mission/**`, `ui/internal/views/mission/**`, `docs/design/mission/**`, more in the file |
| `.claude/rules/output-layer.md` | Everything rt prints: the five rules, failures, the raw-output guard, warnings, UI-free CLI | `cli.ts`, `commands/**`, `lib/**` |
| `.claude/rules/output-rendering.md` | Breadcrumb, transient steps, wrapping, steps, stacked tables | `lib/ui/**`, `ui/**`, `lib/command-tree.ts` |
| `.claude/rules/output-git-verbs.md` | How the git verbs, `rt sync` and `rt git rebase` fail and refuse | `commands/git/**`, `commands/sync.ts`, `lib/mcp/git-tools.ts` |
| `.claude/rules/output-agent-verbs.md` | Frozen bytes for chat, herd, pane, agent and the agent-only verbs; `rt cd` and `rt nav` | `commands/chat.ts`, `commands/herd.ts`, `commands/pane.ts`, more in the file |
| `.claude/rules/output-setup-and-services.md` | The setup emitter, streamed child output, daemon and service verb output | `lib/setup/**`, `commands/setup.ts`, `commands/uninstall.ts`, more in the file |
| `.claude/rules/command-tree.md` | Plain-language descriptions, the module registry, `omitBehavior` | `lib/command-tree*.ts`, `lib/module-registry.ts`, `scripts/lib/picker-conformance.ts`, more in the file |
| `.claude/rules/daemon.md` | Logging seams, the relocation prompt parser | `lib/daemon/**`, `lib/daemon.ts`, `lib/daemon-logger.ts`, more in the file |
| `.claude/rules/mcp-and-gates.md` | `rt_verb`, the tool roster and its guards, decision gates, baseline permissions | `lib/mcp/**`, `commands/mcp.ts`, `commands/gate.ts`, more in the file |
| `.claude/rules/team-switchboard.md` | Invite, join, peer and the board-peering row | `lib/team/**`, `packages/rt-client/src/switchboard.ts`, `lib/setup/validators/accounts.ts`, more in the file |
| `.claude/rules/setup.md` | Writing-style presets, checklist rows, setup after an update, migrations | `lib/setup/**`, `lib/skills/writing-style.ts`, `commands/setup.ts`, more in the file |
| `.claude/rules/state.md` | State backup, claiming `SCHEMA_VERSION` | `lib/state/**`, `commands/state*.ts` |
| `.claude/rules/dev-app.md` | How a change reaches the dev app: served apps, manifests, tray rebuilds | `rt-tray/**`, `apps/deck/**`, `apps/*/mattstack.deck.json`, more in the file |
| `.claude/rules/ci-and-tests.md` | How CI shards and scopes the unit suite, `no-*` naming, timings | `scripts/ci/**`, `.github/workflows/checks.yml`, `test-timings.json`, more in the file |
| `.claude/rules/workspace-packages.md` | Private packages, stale `dist/` in rt-client and glance | `packages/rt-client/**`, `packages/glance/**`, `packages/settings-kit/**`, more in the file |
| `.claude/rules/apps/apps-ci-and-publishing.md` | Turborepo gates and cache, the bun pin, which packages publish | `turbo.json`, `scripts/turbo.sh`, `scripts/set-platform-version.ts`, more in the file |
| `.claude/rules/apps/kit-import-walls.md` | §1: the Mantine import walls and token namespace lint | `apps/{chat,console,boxscore}/src/**`, `packages/ui/src/**`, `packages/ui/presets/**`, more in the file |
| `.claude/rules/apps/kit-components.md` | §2 and §3: kit vs app components, tree-shaking, the icon registry | `packages/ui/src/core/**`, `packages/ui/src/icons/**`, `packages/ui/scripts/**` |
| `.claude/rules/apps/kit-theme.md` | §4: theme files, overrides, surface slots, where raw hex lives | `packages/ui/src/design-system/**`, `packages/ui/src/styles/**`, `packages/tokyo/**`, more in the file |
| `.claude/rules/apps/kit-recipes.md` | §5 and §6: shells, modals, notifications, forms, storage and scheme hooks, text slots | `apps/{chat,console,boxscore}/src/**`, `packages/ui/src/hooks/**` |
| `.claude/rules/apps/kit-app-layer.md` | §7 and §8: the boot family, `mountMattstackApp`, `MattstackShell`, router, app icons | `packages/ui/src/app/**`, `packages/ui/src/router/**`, `packages/ui/src/boot/**`, more in the file |
| `.claude/rules/apps/app-server.md` | §9: `@mattstack/app-server` subpaths, `/ws`, the error envelope | `packages/server/**`, `apps/*/src/server/**` |
| `.claude/rules/apps/kit-consumer-requirements.md` | §10: traps for an app consuming the kit | `apps/{chat,console,boxscore}/package.json`, `apps/{chat,console,boxscore}/vite.config.ts`, `apps/{chat,console,boxscore}/src/app/**`, more in the file |

## Repo identity

Every per-repo store, daemon payload and REST path keys on a serialized repo
identity from rt-client, never a derived name, EXCEPT settings-store sections
(`repos.<identity>`), which key on the raw `host/path` form the resolver
expects. Before keying anything by repo, read `docs/repo-identity.md` and the
`rt-repo-identity` skill (`skills/rt-repo-identity/SKILL.md`), which carry
the two string forms, where each applies, and the identity-only verb guards.

## Monorepo layout

rt is the root package. `apps/*` (board, boxscore, chat, console, deck) and
the apps platform packages under `packages/*` keep their own contract in
`apps/AGENTS.md` (catalog rules, turbo, per-app scripts, UI authoring).
Turborepo (`turbo.json`, `scripts/turbo.sh`) runs
their gates and rt's static gates; `bun run check` is what `checks.yml`'s
`static` job runs. rt's unit suite is `bun run test` and never walks the apps'
vitest packages: the `test` script names rt's directories one by one, and
`scripts/ci/test-scope.ts` skips the macOS shards on a PR that touches only
apps trees or `plugins/` trees (each plugin has its own CI job, which
`scripts/__tests__/no-plugin-ci-jobs.test.ts` enforces). Deck serves the
apps from this checkout in dev mode
(`deck register --dir ~/Documents/GitHub/mattstack/apps/<name>`, or the
older `~/Documents/GitHub/repo-tools` folder on a machine that has not
moved it), and the release builds them at the tagged commit
(`scripts/build-apps.ts`, the `build-apps` job in `release.yml`); `rt-tray/deps.lock` lists them as
`source: "tree"` rows, which is deck's served-app catalog (the rows that
carry a `serve` port; `apps/deck/src/registry/bundle-catalog.ts`). gitq is
a tree row too, at `apps/gitq`, built the same way by `build-apps.ts` and
shipped as the plain `Contents/Helpers/gitq` CLI, but its row carries no
`serve`, so it is not in that catalog: deck never registers or serves it,
in dev mode or in the bundle, and gitq is a CLI tool only for now. gitq
releases on the same fast path as the others (`skills/rt-release/SKILL.md`) and also
publishes `@mattstack/gitq` to npm on its own schedule
(`apps/gitq/docs/releasing.md`), separate from the bundled CLI this repo
builds. `packages/glance` and `packages/glance-react` keep their own
contract in `packages/glance/AGENTS.md`.

## Release & distribution

Before touching the release workflow, the app bundle, signing, Sparkle, the
marketplace, or the VM clean room, read `docs/release-and-distribution.md`.
It carries the release flow, the bundle/signing rules, and the traps only
real runs surfaced (translocation, VM Gatekeeper policy, headless CLT).

The GitHub repo is `m4ttstack/mattstack`. The old repo name `m4ttstack/rt`
is never recreated after the rename: every app installed before it fetches
its Sparkle feed through GitHub's redirect from the old name, and a new repo
under that name would capture those requests.

## Operating on this machine

This repo's tooling runs as live services on the developer's own machine. Six
rules, each written after it cost real damage:

- **A built binary is only ever run under an isolated HOME** (`env -i HOME=<temp> …`),
  every invocation, not just tests. The daemon shim and the compiled `rt` both
  read `~/.mattstack` and will act on it: a single unisolated run started a real
  daemon that spent minutes creating worktrees and running installs.
- **Never rebuild, re-sign, or reinstall an app bundle macOS has blessed**
  (`/Applications/mattstack.app`, `rt-tray/mattstack-dev.app`). Build into a
  scratch directory instead. Re-signing invalidates Login Items and TCC grants,
  and the failure is silent.
- **Check `git branch --show-current` before syncing the main checkout.** It is
  shared with other sessions and is what the dev app's `rt` wrapper executes;
  it is not always on `main`. That second half makes it operational, not
  hygiene: **the branch that checkout sits on is the dev daemon's deployed
  code.** A daemon that has been up for hours is running whatever was checked
  out when it started (another lane's branch, quite possibly), so a merge
  changes nothing in service until the checkout syncs AND the daemon restarts.
- **Diagnose live services without starting competing instances.** An extra
  daemon squats `rt.sock` and produces exactly the symptom (starts, binds
  nothing, logs nothing) that then gets misdiagnosed as a permissions problem.
- **Re-read a ticket immediately before acting on it.** Tickets here are
  written by other live sessions while you work, so the copy you read at the
  start of a task is a snapshot, not the current state. A prune ran against a
  ticket that had, in the meantime, grown a section explaining that the very
  row being removed was being kept deliberately. The eviction orphaned a
  daemon registry and silently stopped worktree reconciliation. The same
  applies to any shared artifact a peer session can edit underneath you.

A claimed recovery path (self-heal, fallback, retry) is load-bearing: trace the
code that performs it before documenting it, or the docs will tell users to run
something that does nothing.

## Footguns

### `bun run test` is one of three suites, and CI runs all three on main

The `test` script in `package.json` is the one source of truth for which
directories this suite covers. CI also runs `test:e2e`
(`e2e/tests/`, needs `--preload ./e2e/setup.ts`) and `test:pty` (`e2e/pty/`,
the termwright gate that drives the compiled binary in a real pty, 120s
timeout). `test:all` runs all three. A green local `bun run test` says nothing
about either of the others, and the difference is invisible in the output.

It matters most for anything asserted verbatim end to end (the chat delivery
frame, a CLI's `--json` envelope, a usage string) and for anything glitter or
rt-ui paints: those have exact-string or screen assertions no unit suite
covers. Run `bun run test:all`, or at least the one e2e or pty file covering
the surface, before calling a change verified. The pty gate skips in CI unless
the diff touches a path in `GLITTER_TRIGGERS` (`scripts/ci/test-scope.ts`); a
change to socket setup, `test-setup.ts` or `e2e/socket-path.ts` must be in that
list or the gate never runs (macOS caps a unix socket path at 104 bytes, and the gate
is what catches a path that grew past it).

The apps' packages under `packages/*` and `apps/*` are vitest or their own
bun suites and are never in the unit dirs; run them with `bun run
<app>:test` or `bun run check`.

### Run `bun test` from the repo root

bun reads `bunfig.toml` only from the cwd, never a parent, so a run started
anywhere else (a subdirectory, `packages/rt-client`, an absolute test path
from another directory) skips `test-setup.ts` and keeps the real HOME. Two
more ways a run reaches the real home with the preload loaded: a test that
leaves HOME unset, since paths then fall back to bun's `os.homedir()`, which
is frozen at the HOME the process started with; and a child started by
`Bun.spawn`/`Bun.spawnSync` without `env`, which gets that startup
environment, real HOME included (pass `childEnv()` from `lib/subprocess.ts`).
`setSetting`/`unsetSetting`, `rt team create`/`join` and the home-repo init
seam refuse a test-run write into the account's real `~/.mattstack` settings
stores (`packages/rt-client/src/test-isolation.ts`); nothing guards the rest
of `~/.mattstack` (state db, logs, runtime files) the same way.
