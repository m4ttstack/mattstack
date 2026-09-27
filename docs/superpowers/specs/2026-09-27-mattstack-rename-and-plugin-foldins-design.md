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
that moves every store listed above from one serialized identity to another,
verify-persisted row by row (the same write-then-reread discipline as
`identity-migrate.ts`), refusing when the new identity already holds rows,
with a `--dry-run` that prints the per-store counts. It ships in a release
before the rename, so every machine running that release can re-key itself.
The daemon runs it on its own the first time it sees a tracked repo whose
remote now derives a different identity and GitHub reports the old name
redirecting to the new one; on this machine the controller runs it by hand
as part of Stage 2.

## Stages

Four stages, in order, each its own PR with CI green and an Opus review
before it merges; the machine steps are checked lists run by the controller
after the PR they depend on merges.

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
  to the new name; delete the throwaway.
- Gate: both resolve. If either does not, stop and bring it back to Matt; the
  rename does not happen.

### Stage 2a: the re-key verb and the sweep (one PR, one release)

**The re-key.** `rt repos reidentify <old> <new>` as described above, with
tests that seed every store under one identity, run the verb, and assert
every row reads under the other and none under the old; a refusal test when
the new identity already holds rows; the daemon's automatic trigger behind
the redirect check.

**The sweep.** 330 files name the repo (`m4ttstack/rt`, `m4ttstack%2Frt`,
`m4ttstack-rt`) and 31 name the folder (`Documents/GitHub/repo-tools`),
outside dated superpowers docs. About 220 of the first are the generated
`website/docs/reference/**` "See code" links from `scripts/gen-docs.ts:29`:
change the generator and regenerate, never hand-edit. The rest, by kind:
- update feed: `rt-tray/project.yml`, `Info.plist`, `build.sh` and the
  `check-bundle.sh` assertion move to the new URL together, so builds after
  this release use it; old installs keep the old URL and follow the redirect
- release code: `lib/release/release-app.ts`, `lib/release/verify.ts`,
  `lib/release/update-machine.ts`, `scripts/release/appcast.sh`,
  `scripts/update-docs.ts`, `scripts/gen-docs.ts`, `scripts/build-dev-app.ts`,
  `scripts/e2e-cleanroom.sh`, `commands/update.ts`, `commands/release.ts:139`
  (`sharedCheckoutPath`), `lib/team/invite.ts`
- checkout lookup: `commands/settings.ts:412-416` gains
  `~/Documents/GitHub/mattstack` first and keeps `repo-tools` as a fallback
  candidate, so a machine that has not moved its folder still resolves;
  `lib/command-tree-def.ts` placeholders follow
- site and packages: `website/docusaurus.config.ts`,
  `apps/gitq/website/docusaurus.config.ts`, `extensions/vscode/rt-context/package.json`,
  every `package.json` `repository` field, `README.md`, `rt-tray/vm/README.md`,
  `marketplace/README.md`, `.github/renovate-global.json5`, AGENTS.md,
  `docs/*.md`, the skills under `skills/`, and the READMEs of mattstack-skills
  and fast-browser
- AGENTS.md and the rt-release skill gain one line: `m4ttstack/rt` is never
  recreated
- tests that pin literal names follow the code
- dated superpowers docs, `RELEASE_NOTES.md` history, changelogs and imported
  commit history stay as written

This PR ships in a mattstack.app release before Stage 2b.

### Stage 2b: rename the repo and the folder (machine list)

Run by the controller after the Stage 2a release is installed on this machine.

1. Announce in #rt: the shared checkout folder moves; sessions whose cwd is
   in it must `/cd` afterwards. Worktrees under `~/.mattstack` are unaffected.
2. `gh repo rename mattstack --repo m4ttstack/rt`.
3. `git remote set-url origin https://github.com/m4ttstack/mattstack.git` in
   the shared checkout and in every rt pool worktree.
4. Stop the dev daemon; `rt repos reidentify github.com/m4ttstack/rt github.com/m4ttstack/mattstack --dry-run`,
   read the counts, then run it for real.
5. Move the folder: `mv ~/Documents/GitHub/repo-tools ~/Documents/GitHub/mattstack`;
   `rt repos locate ~/Documents/GitHub/mattstack` (same identity now, new path);
   `rt settings source-path ~/Documents/GitHub/mattstack` (the dev app's `rt`
   wrapper and dev daemon read this row).
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
- CI: a path-scoped job builds and tests the plugin (`cargo build --release`,
  `cargo test`) only when `plugins/herdr-chat/` changes;
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
  plugins/mattstack --strict` (now against the same tree, no pinned rt
  checkout), and the `cmp` of `attachments/mcp-tools/reference.md` against
  `rt mcp tools --json`. The job also runs the two rt tests that hash-pin
  plugin content (`lib/mcp/__tests__/tools-payload-hash.test.ts`,
  `lib/skills/__tests__/mcp-lint-rules-hash.test.ts`), which read the plugin
  files in-tree. `scripts/ci/test-scope.ts`'s `plugins/` rule sends a
  `plugins/mattstack`-only diff to this job and not to the unit shards; a diff
  that also touches rt code runs both.
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
  A probe confirms Claude Code installs from it before the switch.
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
| Installed apps stop seeing updates after the rename | Stage 1 proves the redirect first; the Stage 2a release moves the feed to the new URL |
| Someone recreates `m4ttstack/rt` and breaks every redirect | AGENTS.md and the rt-release skill say the old name is never reused |
| Per-repo state reads as empty after the remote changes | `rt repos reidentify` moves every store, ships before the rename, and runs automatically on other machines; Stage 2b verifies the rt pool and tracking survive |
| The dev app and daemon point at a missing folder | Stage 2b step 5 moves `rt settings source-path` with the folder |
| Sessions whose cwd is the shared checkout break on the folder move | Announce first; they `/cd` |
| A plugin-only PR skips a test that pins plugin content | The plugin job runs the hash-pin tests; test-scope routes `plugins/` diffs there |
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
