# Monorepo follow-ups (TDD)

Six review follow-ups from the monorepo fold-in, each fixed test-first, one
commit per task, one PR at the end. The Linear tickets carry the problem
statements and acceptance criteria; this plan adds the order, the test to
write first, and the rules.

Worktree: `~/.mattstack/rt/worktrees/gh-m4ttstack-rt/treebeard`, branch
`followups-tdd` off main. Controller: eli (reviews each task with an Opus
reviewer). Implementer: ida.

## Global rules

- Test first for every task: write the failing test, run it and record the
  RED output, implement, run it GREEN, then run the package's suite. The
  report for each task carries both outputs.
- rt code uses double quotes; glance and gitq keep their own style (single
  quotes). Never reformat one package's code with another's rules.
- No em dashes or en dashes anywhere, including comments and commit messages.
- Comments state constraints the code cannot show; never ticket numbers,
  review findings or history.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  (or the implementer's own model line). Subject names the package and the
  change, and the body ends with `Fixes <TICKET>` so Linear links it.
- Run glance tests from `packages/glance`, gitq tests from `apps/gitq` (their
  `bunfig.toml` preloads apply only from their own directory). rt's unit suite
  is `bun run test` from the root; do not run it per task, only once at the end.
- Never run a built `rt` binary outside `env -i HOME=<temp>`.
- After touching `packages/glance/src`, run `bun run build` in
  `packages/glance` (its `dist/` feeds root typecheck and rt-client).
- This worktree session's Bash guard refuses compound commands that touch git
  (`cd X && git ...`, `git -C`); run git as separate plain commands.

## Task 1: GLANCE-36, GitHubEventsPoller commits state before the tick succeeds

File: `packages/glance/src/GitHubEventsPoller.ts` (`tick()`). Model:
`packages/glance/src/EventsPoller.ts`, which stages `hasTicked` and its cursor
in locals and commits them at the end (around line 221 and 293), and its test
"cold tick that throws stays cold".

Tests first (next to the existing GitHubEventsPoller tests):
- a cold tick whose first page fetch throws leaves the poller cold, so the
  retry takes the cold path (no burst of historical invalidations)
- a tick whose page 2 fetch throws keeps the previous etag, so the next tick
  refetches rather than 304ing past unseen events

Then stage `hasTicked` and the etag in locals and commit both only after every
page fetched.

## Task 2: GLANCE-37, the single MR dashboard never leaves `connecting`

File: `packages/glance/src/MRDashboard.ts`, `createSingleDashboard` (around
line 500). The `statusListener` it builds is never handed to the watcher:
`onStatusChange` is a top-level parameter of `createRealtimeWatcher`, not a
field of `RealtimeWatcherOptions`.

Test first, through the public dashboard API with a fake cable or watcher:
the dashboard reports `connected` after the watcher connects and
`disconnected` after it drops. Then wire the listener through.

## Task 3: GLANCE-38, the group dashboard drops shared-cable events

File: `packages/glance/src/MRDashboard.ts`, the group dashboard (around line
721). It subscribes per MR through `watchMR`, which runs a fetch and poll loop
per MR and never forwards events.

This one needs a design first. Before writing code, DM the controller a design
of at most ten lines: how the shared cable's events and status transitions
reach the group watcher, what replaces the per-MR `watchMR` subscriptions, and
which public types change. Wait for an OK.

Tests first, covering the ticket's acceptance:
- a cable event for any MR in the group reaches the group's `onEvent` once
- connect and disconnect on the shared cable update the group's
  `connectionState`
- one fetch and poll loop per group, not per MR (count the fetch or poll seam
  calls for a group of three MRs)

Tasks 2 and 3 touch the same file; do them in order and keep them separate
commits.

## Task 4: GLANCE-39, the live integration script mutates real MRs

File: `packages/glance/tests/integration.live.ts` (three mutating call sites
around line 85 pick targets from the token user's own list).

Add a required sandbox target (one env var naming the repo and MR to mutate;
pick a name in the `GLANCE_HARNESS_*` family and document it in the file's
header and `packages/glance/harness_credentials.example.json`'s readme).
Mutating steps refuse with a clear message and send no request when it is
unset; read-only probes keep their fallback.

Test first: extract the target selection into a small pure function and unit
test it (unset: refusal, no target; set: exactly that target; read-only: the
fallback still works). The ticket's live-run acceptance needs
`packages/glance/harness_credentials.json`, which is currently missing on this
machine; stop after the unit-tested change and tell the controller, who will
get it restored and run the live check.

## Task 5: GITQ-27, `gitq undo` restores by checkout and reset --hard

File: `apps/gitq/src/core/undo.ts` (and `undoCommand` in
`apps/gitq/src/cli/commands/`). Model for moving refs:
`finalizeBranchRef` (compare-and-swap), which the rest of gitq already uses.

Tests first, as integration tests under `apps/gitq/tests/integration/` using
the sandbox helpers in `helpers.ts` (they init with `-b main`):
- undo on a dirty launch tree exits with the dirty-tree error and moves no refs
- undo never checks out or moves the stack root (trunk)
- undo from a secondary worktree restores every stack branch while trunk stays
  checked out elsewhere
- a branch whose head moved since the snapshot fails the CAS with an error
  naming the branch, and the branches restored before it are reported

Then refuse a dirty tree up front, skip the root, and move each branch ref by
CAS from its current head to the snapshot sha without a checkout. Keep the
store update consistent with what was actually restored.

## Task 6: RT-327, the VS Code extension bundle does not load in Node

Files: `extensions/vscode/rt-context/package.json` (`build` is esbuild, CJS,
`--external:vscode`), `packages/rt-client` (its `createRequire(import.meta.url)`
becomes `createRequire(undefined)` in CJS output), `.github/workflows/release.yml`
("Build extension" step, around line 229).

Test first: a test in the extension package that runs the build and then
loads `dist/extension.js` in a plain `node` process with a stub `vscode`
module on the require path (the bundle marks `vscode` external). It must fail
today on the jsonc-parser `require('./impl/format')` or the `createRequire`
shim. Then:
- bundle jsonc-parser from its ESM entry (esbuild `--main-fields=module,main`
  or an alias), and make rt-client's require shim CJS-safe (guard
  `import.meta.url` and fall back to the CJS `require` when it is undefined);
  keep rt-client's ESM behaviour unchanged and cover the shim in rt-client's
  own tests
- add the same load smoke to the release job right after `bun run package`, so
  the release fails when the bundle cannot load

Acceptance also asks that a `.vsix` installs and activates in VS Code; record
in the report whether you could check that locally (`code --install-extension`)
and how.

## Task 7: gitq nits

- `apps/gitq/mattstack.deck.json`: remove the `dev.deploy` entry that runs
  `deck restart gitq` (deck neither registers nor serves gitq; the manifest
  stays for its `bundle` recipe)
- `apps/gitq/src/core/git-shell.ts` `hasStagedDiff`: drop the unused `stdout`
  destructure

No test needed beyond gitq's typecheck and suite staying green.

## Finish

Run `bun run check` (turbo), `bun run typecheck`, `bun run test` once,
`scripts/repo-purity.sh`, then hand back to the controller for the whole-branch
review and PR.
