# Agent docs routing

Date: 2026-10-12
Status: approved for planning (Matt delegated the design choices)

## Problem

A new Claude Code session in this repo loads the whole root `AGENTS.md`
before it does anything: 74 KB, 1,155 lines, roughly 18K tokens. Reading any
file under `apps/` adds `apps/AGENTS.md` (56 KB, 928 lines), and a per-app
file after that. A session fixing a bug in `apps/board` carries about 134 KB
of instructions, most of them about code it will never open.

Anthropic's guidance is a target of under 200 lines per instruction file,
because longer files "consume more context and reduce adherence", and a
bloated file causes Claude "to ignore your actual instructions". An `@path`
import does not help: imported files load at launch too. The ETH Zurich
AGENTS.md study (arXiv 2602.11988) found context files raise inference cost
by over 20% on average without generally improving task success, and that
they earn their place only for non-standard practices.

Two more faults in the current layout:

- `apps/AGENTS.md` is the kit contract for `packages/ui`, `packages/server`
  and four other packages, but it loads only when a file under `apps/` is
  read. An agent editing `packages/ui/src` never sees it. Board and deck
  sessions, which use tui-kit, load the whole Mantine contract for nothing.
- `plugins/herdr-chat/AGENTS.md` has no `CLAUDE.md` beside it. Claude Code
  reads a nested `AGENTS.md` on its own only when no `CLAUDE.md` exists at
  or above the working directory, and the repo root has one.

## Goal

An agent starts with a small always-on file and receives each area's rules
when it opens a file in that area. No rule is lost.

Success, measured:

- Root `AGENTS.md` is at most 200 lines.
- `apps/AGENTS.md` is at most 200 lines.
- A session that reads only `apps/board` files loads under 25 KB of
  instruction files (today about 134 KB).
- After phases 1 and 2, every non-blank line of the two old files exists in
  exactly one new home.

## Decisions

| Question | Decision |
|---|---|
| Which agents must this serve | Claude Code only |
| Scope | Root file, `apps/AGENTS.md`, per-app files, herdr-chat, and a dedupe pass against the rt skills |
| Fidelity | Move text unchanged first; dedupe in a separate, reviewable step. Nothing is pruned |
| Mechanism | Path-scoped rules in `.claude/rules/` by default; per-app `AGENTS.md` files stay where they are |
| New skills | None. Skill descriptions are always in context and the list is already long |

## Mechanism

A file under `.claude/rules/` with `paths:` frontmatter loads when Claude
reads, writes or edits a file matching one of its globs. It costs nothing
until then. One rule can name several directories, which most root sections
need: the output layer spans `commands/`, `lib/` and `cli.ts`.

Three properties shape the design:

- **Grep does not trigger a rule.** Only a read or edit of a matching file
  does. The root file therefore keeps an index, one line per rule, so an
  agent that plans a change before opening a file knows the rule exists.
- **After compaction only the root file is re-injected.** A rule reloads on
  the next matching read. Anything that must hold at every moment stays in
  root; that is the "Operating on this machine" section.
- **A rule without `paths:` loads at launch.** Every rule in this repo
  carries `paths:`; the guard test fails one that does not.

`.claude/` is ignored today (`.gitignore` line 2). It becomes `.claude/*`
plus `!.claude/rules/`, so the rules directory is tracked and worktrees,
local commands and local settings stay ignored.

## Phase 1: the root file

### What root keeps

- The opening paragraph and "Architecture docs live in Linear".
- "Repo identity" and "Release & distribution", which are already pointers.
- "Monorepo layout".
- "Operating on this machine", whole.
- From "Footguns": the opening of "`bun run test` is one of three suites"
  (which suites exist, and the instruction to run `test:all` or the one
  covering file) and "Run `bun test` from the repo root".
- A new section, "Rules that load with the code", holding the index.

### Where the rest goes

Each rule keeps its source headings, so a reference such as "see the Output
layer rules" still resolves by search.

| Rule file | Source | `paths` |
|---|---|---|
| `output-layer.md` | Output layer: the opening, the five rules, the plain-output and callout-row rules, the failure shape, the raw-output guard, `out.note` and `warn`, usage errors, report builders, print seams, warn sinks, fix commands and failure lists. Also "The TypeScript CLI is UI-free" | `cli.ts`, `commands/**`, `lib/**` |
| `output-rendering.md` | Output layer: breadcrumb, transient step, bidi and wrapping, `lib/ui/steps.ts`, the secret prompt, stacked tables, multiline `why` | `lib/ui/**`, `ui/**`, `lib/command-tree.ts` |
| `output-git-verbs.md` | Output layer: the git verb, `rt sync` and `rt git rebase` paragraphs | `commands/git/**`, `commands/sync.ts`, `lib/mcp/git-tools.ts` |
| `output-agent-verbs.md` | Output layer: `rt chat`, the agent-only verbs, `rt herd`/`rt pane`/`rt agent`, `rt cd`/`rt nav` | `commands/chat.ts`, `commands/herd*`, `commands/pane*`, `commands/agent*`, `commands/gate*`, `commands/events*`, `commands/ci*`, `commands/mcp*`, `commands/cd*`, `commands/nav*` |
| `output-setup-and-services.md` | Output layer: the setup emitter, `home init` steps, sdm, release rows, `rt daemon`, the service verbs | `lib/setup/**`, `commands/setup*`, `commands/sdm*`, `commands/daemon*`, `commands/services*`, `commands/apps*`, `commands/bg*`, `commands/cron*`, `commands/home*`, `lib/release/**` |
| `rt-ui.md` | rt-ui, "Shared rt-ui primitives" | `ui/**`, `lib/ui/**`, `lib/runner/**`, `lib/pick-wrappers.ts`, `commands/runner.ts` |
| `glitter.md` | "GitHub Desktop is the authority", "Mission adopts GitHub Desktop's staging model" | `lib/mission/**`, `ui/internal/views/mission/**`, `docs/design/mission/**` |
| `settings.md` | Settings architecture | `packages/rt-client/src/settings/**`, `lib/team/**`, `packages/settings-kit/**`, `scripts/move-*.ts` |
| `team-switchboard.md` | Switchboard and `rt team join` | `lib/team/**`, `packages/rt-client/src/switchboard.ts`, `lib/setup/validators/accounts.ts`, `commands/team*` |
| `setup.md` | Setup checklist rows, Setup after an update, Writing-style presets | `lib/setup/**`, `lib/skills/writing-style.ts`, `commands/setup*`, `rt-tray/Sources-core/Contract/PlanModels.swift` |
| `mcp-and-gates.md` | Gates and the `rt_verb` MCP tool, Baseline Claude permissions | `lib/mcp/**`, `commands/mcp*`, `commands/gate*`, `lib/setup/base-permissions.ts`, `lib/setup/claude-permissions.ts`, `lib/daemon/forge-reads.ts`, `lib/daemon/upload-guard.ts` |
| `command-tree.md` | Command descriptions are plain language, "A required-positional leaf must declare `omitBehavior`", Module registry | `lib/command-tree*.ts`, `lib/module-registry.ts`, `scripts/lib/picker-conformance.ts`, `cli.ts` |
| `daemon.md` | Logging architecture, the relocation prompt parser | `lib/daemon/**`, `lib/daemon.ts`, `lib/daemon-logger.ts`, `rt-tray/Sources/TrayLog.swift`, `rt-tray/Sources/TrayServer.swift` |
| `state.md` | State backup, "`SCHEMA_VERSION` is claimed across sessions" | `lib/state/**`, `commands/state-backup-*` |
| `worktree-pool.md` | Worktree pool: the golden tree | `lib/worktree/**` |
| `chat.md` | rt chat | `commands/chat.ts`, `lib/state/chat-store.ts`, `lib/chat-viewer-url.ts`, `lib/daemon/handlers/chat*` |
| `workspace-packages.md` | The private workspace packages footgun, "`packages/rt-client/dist/` goes stale" | `packages/rt-client/**`, `packages/glance/**`, `packages/settings-kit/**`, `packages/tui-kit/**` |
| `build-and-plugin.md` | Bytecode compile footgun, `plugins/mattstack` | `scripts/build*`, `.github/workflows/release.yml`, `plugins/mattstack/**`, `lib/skills/**` |
| `ci-and-tests.md` | The CI shard, scope and timings paragraphs of the three-suites footgun | `scripts/ci/**`, `.github/workflows/checks.yml`, `test-timings.json`, `lib/__tests__/no-*.test.ts`, `commands/__tests__/no-*.test.ts`, `scripts/__tests__/no-*.test.ts`, `e2e/**` |
| `dev-app.md` | Getting a change into the running dev app | `rt-tray/**`, `apps/deck/**`, `apps/*/mattstack.deck.json`, `lib/release/update-machine.ts` |

The plan fixes each glob against the tree: a glob that matches no tracked
file fails the guard, so a wrong guess above is corrected there, not here.

### The index

One row per rule in the root file: what it covers and which paths load it.
Its closing line tells an agent to read the rule file directly when it is
planning a change in that area and has not opened a matching file yet.

## Phase 2: the apps

### `apps/AGENTS.md`

It keeps its scope note, its opening paragraph and "Working in this repo"
without the "CI shape" and "Publishing" subsections. The numbered kit
contract moves to `.claude/rules/apps/`, section numbers kept in the
headings so "see §2" still resolves.

| Rule file | Source | `paths` |
|---|---|---|
| `kit-import-walls.md` | §1 | `apps/chat/src/**`, `apps/console/src/**`, `apps/boxscore/src/**`, `packages/ui/src/**`, `packages/ui/presets/**`, `eslint.config.js` |
| `kit-components.md` | §2, §3 | `packages/ui/src/core/**`, `packages/ui/src/icons/**`, `packages/ui/scripts/**` |
| `kit-theme.md` | §4 | `packages/ui/src/design-system/**`, `packages/ui/src/styles/**`, `packages/tokyo/**`, `packages/tokens/**` |
| `kit-recipes.md` | §5, §6, "Text slots and sizes" | `apps/chat/src/**`, `apps/console/src/**`, `apps/boxscore/src/**`, `packages/ui/src/hooks/**` |
| `kit-app-layer.md` | §7, §8 | `packages/ui/src/app/**`, `packages/ui/src/router/**`, `packages/ui/src/boot/**`, `apps/chat/index.html`, `apps/console/index.html`, `apps/boxscore/index.html`, `apps/*/src/app/**` |
| `kit-consumer-requirements.md` | §10 | `apps/{chat,console,boxscore}/package.json`, `apps/{chat,console,boxscore}/vite.config.ts`, `apps/{chat,console,boxscore}/src/app/**`, `apps/{chat,console,boxscore}/src/main.tsx` |
| `app-server.md` | §9 | `packages/server/**`, `apps/*/src/server/**` |
| `apps-ci-and-publishing.md` | "CI shape", "Publishing" | `turbo.json`, `scripts/turbo.sh`, `scripts/set-platform-version.ts`, `packages/*/package.json`, `apps/*/package.json` |

This also repairs the first fault above: the kit contract now loads for
`packages/ui` and `packages/server` work, and no longer for board or deck.

### Per-app files

`apps/<app>/AGENTS.md`, `packages/glance/AGENTS.md` and `website/AGENTS.md`
stay as they are: each is 3 to 14 KB, loads only in its own directory, and
already has a `CLAUDE.md` beside it. `plugins/herdr-chat/` gains a
`CLAUDE.md` holding `@AGENTS.md`, like the others.

## Phase 3: dedupe

Phase 3 runs after phases 1 and 2 have merged, on rule files only.

- A sentence leaves a rule only when an rt skill or a doc the rule already
  cites states the same fact. The rule keeps a pointer to that skill or doc.
- A constraint, a trap or a "never" stays in the rule even when a skill
  repeats it. Skills load by judgment; rules load by path.
- No skill is edited in this work.
- The PR description lists every removed passage with the place that still
  states it.

Candidates, to be confirmed by comparison: `settings.md` against the
`rt:settings` skill and `docs/settings-architecture.md`; `dev-app.md`
against `rt:build-dev-app`; `command-tree.md` against `rt:ui-copy`;
`chat.md` against `rt:chat`; `build-and-plugin.md` against
`mattstack:editing-skills`.

### Result

The comparison found two duplicated passages, because the rules already
point at the skills and docs: the gitq serving sentence in `dev-app.md`
(root `AGENTS.md`, "Monorepo layout") and the `${org}` alias description in
`settings.md` (`docs/settings-architecture.md`, the `rt-settings` skill).
`command-tree.md`, `chat.md` and `build-and-plugin.md` repeat nothing.

The same PR corrects two moved sentences against the code: `dev-app.md`
deploys a served app with `deck cmd <app> deploy`, and `setup.md` says
`org.pull` leaves the clone on its checked-out branch. With Matt's
go-ahead it also repoints one citation in the `rt:release` skill at
`.claude/rules/setup.md`.

## The guard

`lib/__tests__/no-agent-docs-bloat.test.ts`, named `no-*` so the `guards`
job runs it on every PR. It fails when:

- root `AGENTS.md` or `apps/AGENTS.md` is over 200 lines;
- a file under `.claude/rules/` is over 200 lines;
- a rule has no `paths:` frontmatter, or the frontmatter does not parse;
- a `paths` glob matches no file in the tree;
- a rule file is missing from the root index, or the index names a file
  that does not exist.

Each failure message names the fix.

Two existing checks change with it:

- `lib/__tests__/no-nested-team-pack.test.ts` adds `.claude/rules` and
  `apps/AGENTS.md` to `DOC_SCAN`, so moved text stays under the same scan
  the root file had.
- `scripts/ci/test-scope.ts` already treats any `.md` outside `skills/` as
  a doc. A test case pins that a PR touching only `.claude/rules/*.md`
  skips the shards and still runs the guards.

## Verifying the move

- **No line lost.** A one-off script, not committed, compares the non-blank
  lines of the old file (from `main`) with the union of the new root file
  and the rules that came from it. Frontmatter, the new index and the new
  shim are the only allowed additions; nothing may be missing. It runs at
  the end of phases 1 and 2.
- **Rules really load.** In a fresh session started in the worktree, read
  one matching file per rule group and confirm with `/context` or an
  `InstructionsLoaded` hook that the rule loaded, and that it did not load
  before. One check for a root rule, one for an apps rule, one for
  herdr-chat.
- **Sizes.** Record the byte and line counts of the always-loaded files
  before and after in the PR description.

## Out of scope

- Matt's user-level files (`~/.claude/CLAUDE.md`, `~/.claude/rules/`, the
  auto-memory index). They are a separate cost and a separate change.
- Rewriting, shortening or re-ordering any rule's wording beyond phase 3's
  dedupe.
- New skills, hooks, or subagent definitions.
- Other agents (Codex, Cursor). They will read the slim root file and none
  of the rules.

## Risks

| Risk | Answer |
|---|---|
| An agent changes an area without opening a matching file first | The root index names every rule; the guard keeps the index complete |
| A rule's globs rot as files move | The guard fails a glob that matches nothing |
| `lib/**` on `output-layer.md` still loads it for most rt work | Accepted: it is the contract for everything rt prints. The verb-specific two thirds no longer ride along |
| Un-ignoring `.claude/rules/` exposes a local file someone kept there | The directory does not exist in the main checkout today |
| A long session loses a rule at compaction | It reloads on the next matching read; the rules that cannot wait stay in root |

## Sources

- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/large-codebases
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/best-practices
- https://arxiv.org/abs/2602.11988
