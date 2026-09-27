# Rename rt to mattstack, and fold in herdr-chat and skills

## Why

`m4ttstack/rt` now builds the whole suite: the CLI, every bundled app, glance,
gitq and the release. The name describes one binary inside it. The two
plugins that move in lockstep with rt (the `mattstack` Claude plugin in
`m4ttstack/skills`, and the herdr plugin in `m4ttstack/herdr-chat`) still live
in their own repos, so a change that spans rt and a plugin takes paired PRs and
a pinned catalog entry that preflight has to watch for drift. Folding both in
makes cross-project work one PR, and the rename makes the repo's name match
what it ships.

## Decisions (Matt, 2026-09-27)

- The repo becomes `m4ttstack/mattstack`. `m4ttstack/rt` is never recreated.
- The local checkout folder moves from `~/Documents/GitHub/repo-tools` to
  `~/Documents/GitHub/mattstack`.
- The plugins land at `plugins/mattstack` (from `m4ttstack/skills`) and
  `plugins/herdr-chat` (from `m4ttstack/herdr-chat`), each imported with full
  history as a merge commit, the same way apps, glance and gitq were.
- skills folds in only after the RT-338 wave-1 lanes (tom's herd, skills PR
  #41 among them) have merged; nothing in flight is stranded.
- flock stays its own repo. Renaming the `rt` binary, the npm scope or the
  Linear projects is out of scope.

## How rt keys state on a repo, and why the rename needs new code

rt keys every per-repo store on a serialized identity derived from the
repo's remote (`github.com/m4ttstack/rt`): the repo index, the worktree
registry and pool (`~/.mattstack/rt/repos/remote:github.com%2Fm4ttstack%2Frt/`,
`~/.mattstack/rt/worktrees/gh-m4ttstack-rt/`), `rt.repoTracking`, per-repo
settings sections (`repos.github.com/m4ttstack/rt`), and the daemon's run,
herd and chat rows. When the remote changes, the derived identity changes and
every one of those stores reads as empty.

Neither existing tool moves state between two identities:
`lib/state/identity-migrate.ts` only re-keys legacy plain-name rows onto
identities (it skips keys that already parse as one), and `rt repos locate`
re-points a repo that moved on disk under the same identity (it refuses an
identity mismatch). The one mechanism today, an `rt.repoIdentityOverrides`
entry, maps a remote to a chosen identity per machine; it would keep this
machine on the old identity forever while every fresh clone elsewhere derives
the new one.

So Stage 2 builds a real re-key: an `rt repos reidentify <old> <new>` verb
that moves every identity-keyed store from one serialized identity to
another, verify-persisted row by row (the same write-then-reread discipline
as `identity-migrate.ts`), with a `--dry-run` that prints per-store counts. Like `rt repos locate`
(`lib/repo-locate-dispatch.ts`), it runs through the daemon when one answers
and locally when none is present, since Stage 2b runs it with the daemon
stopped.
It works store by store and is idempotent: a store with rows under the old
identity and none under the new moves; a store with nothing under the old
and rows under the new is already done; a store holding rows under both
refuses and names the store. The run exits 0 when every store is moved or
already done. This matters because the settings live in two scopes: the user
store (`~/.mattstack/user/settings.user.jsonc`) is re-keyed once and reaches
Matt's other machines through the home repo, while the machine store is per
machine.

What moves: the repo index row, `~/.mattstack/rt/repos/<identity>/` (worktree
registry, endpoint claims, run history), `rt.repoTracking`, the `repos.<identity>`
settings sections in each store, `herds.repo` in `~/.mattstack/rt/herds.db`,
and every identity-keyed table and kv namespace in `state.db`: the
`events-cursor` namespace, `run_history`, `endpoint_claims`, `project_mrs`,
`project_mrs_meta`, `project_mr_demands`, `project_mr_sections`,
`discussions` and `agents`. `branch_cache` and `git_badges` are regenerable
caches and are dropped for the old identity rather than moved. Pipeline runs
under `~/.mattstack/runs/<label>/` and `chat_presence.repo` key on display
labels, not identities, and do not move.
What does not: the worktree pool directory. `gh-m4ttstack-rt` is a derived
directory name, never parsed back and never a key (`lib/rt-paths.ts`); the
registry stores absolute tree paths, so existing trees keep working where
they are and new trees land under `gh-m4ttstack-mattstack/`. Moving the pool
directory would break every live pane in those trees.

The verb ships in a release before the rename, so every machine running that
release can re-key itself. The daemon runs it on its own for a tracked repo
whose remote, read fresh from `git config --get remote.origin.url` (the
derived identity is memoized per process, so a cached derivation never sees
a `set-url`), now derives a different identity while GitHub reports the old
name redirecting to the new one. On this machine the controller runs it by
hand as part of Stage 2b, with the daemon stopped.

The new node sets `omitBehavior: { exempt: "agent-facing; identities are not enumerable" }`
for the picker-conformance gate, and a new command module is registered in
`lib/module-registry.ts`.

## Stages

Stages run in order, each PR with CI green and an Opus review before it
merges; the machine steps are checked lists run by the controller after the
PR they depend on merges. Stage 2 has three parts because the release code
itself talks to the repo by name: 2a ships the re-key and everything that is
safe before the rename, 2b renames, and 2c flips the names the release uses
once the new name exists.

### Stage 1: prove the update redirect

Every installed mattstack.app carries the Sparkle feed
`https://github.com/m4ttstack/rt/releases/latest/download/appcast.xml`
(`rt-tray/project.yml:73`, `rt-tray/Info.plist:56`, `rt-tray/build.sh:418`,
asserted by `rt-tray/check-bundle.sh:552`). After a rename GitHub redirects
the old URL, and Sparkle's URLSession follows redirects; this stage proves it
before anything irreversible happens.

- Create a throwaway public repo in the org with one release carrying a small
  `appcast.xml` asset; rename it; confirm
  `https://github.com/<org>/<old>/releases/latest/download/appcast.xml` still
  answers 200 after following redirects, and that
  `api.github.com/repos/<org>/<old>/releases/latest` answers with a redirect
  to the new name; also PATCH a throwaway ref through the old name
  (`gh api -X PATCH repos/<org>/<old>/git/refs/heads/<ref>`) and record
  whether GitHub's 307 is followed for writes; delete the throwaway.
- Gate: the asset and the API read resolve. The write result decides whether
  a release may be cut between 2b and 2c; the plan assumes none is. If either does not, stop and bring it back to Matt; the
  rename does not happen.

### Stage 2a: the re-key verb and the folder paths (one PR, one release)

Nothing in this PR names the repo `m4ttstack/mattstack`; the repo does not
have that name yet, and the release that ships this PR runs through the old
name.

**The re-key.** `rt repos reidentify <old> <new>` as described above, with
tests that seed every store under one identity and assert every row reads
under the other and none under the old; the per-store idempotence cases
(moved, already done, both populated refuses); the daemon's automatic
trigger reading the remote fresh and gated on the redirect check.

**The folder paths.** 31 files name `Documents/GitHub/repo-tools` outside
dated superpowers docs:
- `commands/settings.ts:412-416` gains `~/Documents/GitHub/mattstack` first and
  keeps `repo-tools` as a fallback candidate, so a machine that has not moved
  its folder still resolves
- `commands/release.ts:139` (`sharedCheckoutPath`) and
  `lib/release/update-machine.ts` resolve the shared checkout the same way
  (new path, then the fallback) rather than hard-coding either
- `lib/command-tree-def.ts` placeholders, AGENTS.md, `docs/*.md`, the skills
  under `skills/` and tests that pin the path follow

**One doc line.** AGENTS.md and the rt-release skill gain: the old name
`m4ttstack/rt` is never recreated.

This PR ships in a mattstack.app release before Stage 2b.

### Stage 2b: rename the repo and the folder (machine list)

Run by the controller after the Stage 2a release is installed on this machine.

1. Announce in #rt: the shared checkout folder moves; sessions whose cwd is
   in it must `/cd` afterwards. Worktrees under `~/.mattstack` stay where
   they are.
2. Stop the dev daemon through the dev app or `rt daemon stop` (never by
   killing it, which can leave `rt.sock` behind), before the remote changes so
   its own trigger cannot race the by-hand run; confirm `rt daemon status`
   reports it absent.
3. `gh repo rename mattstack --repo m4ttstack/rt`, then
   `git remote set-url origin https://github.com/m4ttstack/mattstack.git` in
   the shared checkout (linked pool worktrees share its config).
4. `rt repos reidentify github.com/m4ttstack/rt github.com/m4ttstack/mattstack --dry-run`,
   read the per-store counts, then run it for real.
5. Move the folder: `mv ~/Documents/GitHub/repo-tools ~/Documents/GitHub/mattstack`;
   repoint the source path from source first, since the dev `rt` wrapper still
   names the old folder (`bun run ~/Documents/GitHub/mattstack/cli.ts settings
   source-path ~/Documents/GitHub/mattstack`, which also rewrites the wrapper
   the dev app and dev daemon read); then `rt repos locate
   ~/Documents/GitHub/mattstack` (same identity now, new path).
6. Start the dev daemon.
7. Re-register deck's five apps from `~/Documents/GitHub/mattstack/apps/<name>`,
   rebuild their clients and restart them; this rewrites the four
   `com.mattstack.deck.<app>.plist` launchd files that embed the old path.
8. Relink the eighteen `~/.claude/skills` symlinks that point into
   `repo-tools`; update `rt.cron`'s board-triage path and `gitq.board`'s gitq
   entry.
9. Prune the legacy name-keyed `~/.mattstack/rt/repos/mattstack` directory if
   `rt repos status` shows it as a stale row, so `--repo mattstack` is not
   ambiguous.
10. Matt's global CLAUDE.md paths change only with his approval.
11. Verify: `rt daemon status` healthy with the source path under
    `mattstack`; `rt worktree list` shows the rt pool under
    `github.com/m4ttstack/mattstack`; `deck list` serves all five apps with
    200s; `grep -r repo-tools` over `~/.mattstack`, the launchd plists and
    `~/.claude/skills` finds nothing live (the settings fallback candidate in
    code is expected).

### Stage 2c: flip the repo name in code (one PR, after 2b; ships in the next release)

330 files name the repo (`m4ttstack/rt`, `m4ttstack%2Frt`, `m4ttstack-rt`)
outside dated superpowers docs. About 220 are the generated
`website/docs/reference/**` "See code" links from `scripts/gen-docs.ts:29`:
change the generator and regenerate, never hand-edit. The rest, by kind:
- update feed: `rt-tray/project.yml:73`, `Info.plist:56`, `build.sh:418` and
  the `check-bundle.sh:552` assertion move to the new URL together, so builds
  from the next release use it; old installs keep the old URL and follow the
  redirect Stage 1 proved
- release code: `RT_REPO` in `lib/release/release-app.ts`, `GH_REPO` in
  `lib/release/verify.ts`, `RELEASE_REPO` in `lib/release/update-machine.ts`,
  `scripts/release/appcast.sh:28`'s default, `RELEASES_URL`,
  `lib/team/invite.ts:69`, `scripts/update-docs.ts`, `scripts/build-dev-app.ts`,
  `scripts/e2e-cleanroom.sh`, `commands/update.ts`
- site and packages: `website/docusaurus.config.ts`,
  `apps/gitq/website/docusaurus.config.ts`, `extensions/vscode/rt-context/package.json`,
  every `package.json` `repository` field, `README.md`, `rt-tray/vm/README.md`,
  `marketplace/README.md`, `.github/renovate-global.json5`, `docs/*.md`, the
  skills under `skills/`, and the READMEs of mattstack-skills and fast-browser
- tests that pin literal names follow the code
- dated superpowers docs, `RELEASE_NOTES.md` history, changelogs and imported
  commit history stay as written

Reads of these names work through GitHub's redirect between 2b and this
PR. No mattstack.app release is cut between 2b and 2c unless Stage 1 showed
redirected writes work, because `rt release app` writes trees, commits and
refs under the repo name.

### Stage 3: fold in herdr-chat

herdr-chat is a Rust herdr plugin (`herdr-plugin.toml`, `Cargo.toml`), 39
commits, public, with its own purity workflow and one open PR (#14).

- Before import: #14 is merged or closed in the old repo, so no PR is open.
- Purity: diff herdr-chat's fragment list against `scripts/repo-purity.sh`;
  any term rt's global list lacks is added scoped to `plugins/herdr-chat/`
  inside `scripts/repo-purity.sh`, never globally.
- Import with git-filter-repo into `plugins/herdr-chat` (drop `.github`; scan
  the clone with both purity lists first; any scrub rules stay outside the
  repo), merge commit.
- CI: a path-scoped job on `macos-latest` (the plugin declares
  `platforms = ["macos"]`) builds and tests it (`cargo build --release --locked`,
  `cargo test --locked`) only when `plugins/herdr-chat/` changes;
  `scripts/ci/test-scope.ts` gets an explicit `plugins/` rule so a
  herdr-chat-only diff skips rt's unit shards.
- Install path becomes `herdr plugin install m4ttstack/mattstack/plugins/herdr-chat`
  (herdr 0.9 accepts `OWNER/REPO/SUBDIR`). The proof on this machine records
  how long the install takes and how much herdr clones, and the README says
  so. The README, `AGENTS.md`, rt's `rt-chat` skill and any setup row that
  installs it say the new path. The plugin id `m4ttstack.chat` does not change.
- This machine: reinstall or relink the plugin from the new path; carry or
  drop each herdr-chat pool worktree, `rt worktree dispose` them, drop the
  `rt.repoTracking` entry, `rt repos prune`, remove the identity directory.
- Archive `m4ttstack/herdr-chat`; existing installs keep running and reinstall
  from the new path to get updates.

### Stage 4: fold in skills (after the RT-338 wave-1 lanes merge)

`m4ttstack/skills` is the `mattstack` Claude plugin (`plugin.json` version
0.25.2), 401 commits, public.

- Gate: every RT-338 wave-1 lane has merged and the repo has no open PR.
- Purity: the skills list bans three terms rt's does not, and two of them are
  legitimate rt vocabulary, so they are added scoped to `plugins/mattstack/`
  inside `scripts/repo-purity.sh`, never globally.
- Import with git-filter-repo into `plugins/mattstack` (drop `.github`, scan
  with both lists first), merge commit.
- CI: all five of the skills repo's checks become one path-scoped plugin job
  that runs when `plugins/mattstack/` changes: purity (via rt's scoped gate),
  the graphviz digraph check, `tests/certify.sh`, `rt skills check --pack-dir
  plugins/mattstack --strict --mattstack-dir <empty root>` (the form the skills
  workflow uses today, since the runner has no Claude CLI; now against the
  same tree, no pinned rt checkout), and the `cmp` of
  `attachments/mcp-tools/reference.md` against `rt mcp tools --json`. In-tree,
  that `cmp` covers what `lib/mcp/__tests__/tools-payload-hash.test.ts` pinned
  across repos, so the payload pin retires;
  `lib/skills/__tests__/mcp-lint-rules-hash.test.ts` stays in rt's suite
  because it guards strict-lint packs outside the tree.
  `scripts/ci/test-scope.ts`'s `plugins/` rule sends a `plugins/mattstack`-only
  diff to this job and not to the unit shards; a diff that also touches rt
  code runs both.
- Publishing: `scripts/release/marketplace.sh` copies only `$SRC/plugins` (the
  in-tree `chat` plugin lives at `marketplace/plugins/chat`) and refuses
  symlinks, so it gains a second copy from `$ROOT/plugins/mattstack` into the
  staged tree as `./plugins/mattstack`. The catalog's pinned URL entry becomes
  that relative path; preflight's `catalog:mattstack` row then reports the
  in-tree plugin as nothing to drift, as it already does for `chat`. The
  plugin keeps its own semver in `plugin.json`, bumped whenever it changes so
  Claude Code refreshes caches.
- Dev marketplace (`~/Documents/GitHub/mattstack-marketplace`): the
  `mattstack` entry becomes a `git-subdir` source,
  `{ "source": "git-subdir", "url": "file:///Users/matt/Documents/GitHub/mattstack", "path": "plugins/mattstack", "ref": "main" }`.
  A probe confirms Claude Code installs from it before the switch (the
  installed Claude Code supports `git-subdir` with a sparse checkout); if the
  probe fails, Stage 4 stops and goes back to Matt.
- `rt skills` follows the new shape. `lib/skills/packs.ts` (`pluginDirOf`)
  learns `git-subdir` sources: the pack's directory is the `file://` URL's
  path joined with `path`, not a path relative to the marketplace.
  `lib/skills/sync.ts` treats an engine whose directory lies inside the
  shared mattstack checkout as in-tree: it never runs `git status`, the
  main-branch check or `git pull --ff-only` there (that checkout is the dev
  daemon's deployed code and is kept in sync by `update-machine`), and only
  refreshes the installed plugin from the marketplace. `compile` already reads
  engines from installed plugins and needs no change.
- READMEs: the skills README's clone and install lines (`README.md:387-388`)
  move to the monorepo.
- This machine: carry or drop each skills pool worktree, `rt worktree
  dispose` them, drop the `rt.repoTracking` entry, `rt repos prune`, remove
  the identity directory; reinstall the mattstack plugin from the updated dev
  marketplace and run `/reload-plugins`.
- Archive `m4ttstack/skills`.

## Risks

| Risk | Guard |
|---|---|
| Installed apps stop seeing updates after the rename | Stage 1 proves the redirect first; the release after Stage 2c moves the feed to the new URL |
| Someone recreates `m4ttstack/rt` and breaks every redirect | AGENTS.md and the rt-release skill say the old name is never reused |
| Per-repo state reads as empty after the remote changes | `rt repos reidentify` moves every store, ships before the rename, and runs automatically on other machines; Stage 2b verifies the rt pool and tracking survive |
| The dev app and daemon point at a missing folder | Stage 2b step 5 moves `rt settings source-path` with the folder |
| Sessions whose cwd is the shared checkout break on the folder move | Announce first; they `/cd` |
| A plugin-only PR skips a check that pins plugin content | The plugin job runs the reference `cmp` and strict check; test-scope routes `plugins/` diffs there |
| The 2a release, or an app installed from it, reaches for a repo name that does not exist yet | 2a changes no repo name; the name flips land in 2c after the rename |
| Moving the pool directory breaks live panes | reidentify leaves `gh-m4ttstack-rt/` in place; new trees go under the new segment |
| A plugin's purity terms turn rt's own gate red | Extra terms are scoped to the plugin's directory |
| `rt skills sync` pulls the shared checkout | In-tree engines skip every git step in sync |
| herdr cannot build from a subdirectory, or the clone is too heavy | Proved on this machine before the old repo is archived; cost recorded in the README |
| Archived repos leave ghost worktrees and tracking | Stages 3 and 4 dispose pools, drop tracking and prune the index |

## Verification

Each stage's PR: CI green, `scripts/repo-purity.sh` green over the imported
history, an Opus whole-branch review, CodeRabbit findings addressed, merge
commit. Stage 2b's machine list ends with its verify step. Stages 3 and 4 end
with a real install from the new path on this machine (herdr plugin install;
the mattstack plugin from the dev marketplace) and a clean `rt skills sync`.
