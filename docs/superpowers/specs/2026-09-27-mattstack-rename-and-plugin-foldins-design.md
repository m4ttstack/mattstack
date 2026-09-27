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

## Stages

Four stages, in order, each its own PR (or, for the machine steps, its own
checked list) with CI green and an Opus review before it merges.

### Stage 1: prove the update redirect

Every installed mattstack.app carries the Sparkle feed
`https://github.com/m4ttstack/rt/releases/latest/download/appcast.xml`
(`rt-tray/project.yml`, `rt-tray/Info.plist`, `rt-tray/build.sh`). After a
rename GitHub redirects the old URL, and Sparkle's URLSession follows
redirects; this stage proves it before anything irreversible happens.

- Create a throwaway public repo in the org with one release carrying a small
  `appcast.xml` asset; rename it; confirm
  `https://github.com/<org>/<old>/releases/latest/download/appcast.xml` still
  answers 200 after following redirects (`curl -sSL -o /dev/null -w '%{http_code} %{url_effective}'`),
  and that `api.github.com/repos/<org>/<old>/releases/latest` answers with a
  redirect to the new name; delete the throwaway.
- Gate: both resolve. If either does not, stop and bring it back to Matt; the
  rename does not happen.

### Stage 2: rename the repo and the folder

**The rename itself.** `gh repo rename mattstack --repo m4ttstack/rt`.

**The code sweep (one PR).** About forty files name `m4ttstack/rt` or its
identity forms (`github.com/m4ttstack/rt`, `m4ttstack%2Frt`,
`gh-m4ttstack-rt`); twenty-four name `Documents/GitHub/repo-tools`. The sweep
updates every live one:
- the Sparkle feed in `rt-tray/project.yml`, `Info.plist` and `build.sh`, so
  builds after this release use the new URL (old installs keep the old URL and
  follow the redirect)
- release scripts and verbs (`lib/release/*`, `scripts/release/*`,
  `scripts/update-docs.ts`, `scripts/gen-docs.ts`, `scripts/build-dev-app.ts`,
  `scripts/e2e-cleanroom.sh`, `commands/update.ts`, `lib/team/invite.ts`)
- `update-machine`'s shared checkout path and `commands/settings.ts`'s
  checkout candidates (keep `repo-tools` as a fallback candidate so a machine
  that has not moved its folder still resolves)
- `.github/renovate-global.json5`, `marketplace/README.md`, every
  `package.json` `repository` field, AGENTS.md, `docs/`, the skills under
  `skills/`, and the READMEs of mattstack-skills and fast-browser
- tests that pin the literal names follow the code
- dated superpowers specs and plans, changelogs and imported history stay as
  written

**This machine (a checked list, run by the controller after the PR merges).**
1. Announce in #rt: the shared checkout folder moves; sessions with their cwd
   in it must `/cd` afterwards.
2. `git remote set-url origin https://github.com/m4ttstack/mattstack.git` in
   the shared checkout and in every rt pool worktree.
3. Move the folder: `mv ~/Documents/GitHub/repo-tools ~/Documents/GitHub/mattstack`.
4. Re-point rt's state: `rt repos locate` for the new path, and migrate every
   store keyed on `github.com/m4ttstack/rt` to `github.com/m4ttstack/mattstack`
   (worktree pool `gh-m4ttstack-rt`, `rt.repoTracking`, per-repo settings
   sections, the daemon's run, herd and chat state) with rt's identity
   migration (`lib/state/identity-migrate.ts`), or an
   `rt.repoIdentityOverrides` entry where a store cannot be migrated.
5. Re-register deck's five apps from `~/Documents/GitHub/mattstack/apps/<name>`,
   rebuild their clients, and restart them (the step RT-344 automates).
6. Relink the eighteen `~/.claude/skills` symlinks that point into
   `repo-tools`, and update `rt.cron`'s board-triage path and `gitq.board`'s
   gitq entry.
7. Rebuild and replace the dev bundle through `rt release update-machine`'s
   dev-bundle leg if the dev app resolves the checkout by path.
8. Update Matt's global CLAUDE.md paths only with his approval (it is his file).
9. Verify: `rt daemon status` healthy, `rt worktree list` shows the rt pool
   under the new identity, `deck list` serves all five apps with 200s, a
   `grep -r repo-tools` over machine state finds nothing live.

Other machines (teammates on older installs) keep working through GitHub's
redirects; their clones re-point with `git remote set-url` when convenient,
and rt treats the new remote as the same repo once the identity migration
ships in a release.

**Release.** The next mattstack.app release carries the new feed URL. Nothing
forces an immediate release.

### Stage 3: fold in herdr-chat

herdr-chat is a Rust herdr plugin (`herdr-plugin.toml`, `Cargo.toml`), 39
commits, public, with its own purity workflow and one open PR (#14).

- Before import: #14 is merged or closed in the old repo, so no PR is open.
- Import with git-filter-repo into `plugins/herdr-chat` (drop `.github`; scan
  the clone with rt's purity pattern first; any scrub rules stay outside the
  repo), merge commit.
- CI: a path-scoped job builds and tests the plugin (`cargo build --release`,
  `cargo test`) only when `plugins/herdr-chat/` changes; `scripts/ci/test-scope.ts`
  treats the directory as a non-rt tree so it never runs rt's unit shards.
- Install path becomes `herdr plugin install m4ttstack/mattstack/plugins/herdr-chat`
  (herdr 0.9 accepts `OWNER/REPO/SUBDIR`); the README, rt's `rt-chat` skill and
  any setup row that installs it say so. The plugin id `m4ttstack.chat` does
  not change.
- This machine: reinstall or relink the plugin from the new path.
- Archive `m4ttstack/herdr-chat`; existing installs keep running and reinstall
  from the new path to get updates.

### Stage 4: fold in skills (after the RT-338 wave-1 lanes merge)

`m4ttstack/skills` is the `mattstack` Claude plugin (`plugin.json` version
0.25.2), 401 commits, public, with its own purity test and a CI job that
checks the process digraphs with graphviz.

- Gate: every RT-338 wave-1 lane has merged and the repo has no open PR.
- Import with git-filter-repo into `plugins/mattstack` (drop `.github`, purity
  scan first), merge commit. Its own `tests/repo-purity.sh` retires in favour
  of rt's gate, which then covers it; the graphviz digraph check becomes a
  path-scoped job.
- Publishing: the mattstack plugin publishes from the tree.
  `scripts/release/marketplace.sh` copies `plugins/mattstack` into the staged
  marketplace as `./plugins/mattstack`, the way the in-tree `chat` plugin
  already publishes, and the catalog's pinned URL entry and preflight's
  `catalog:mattstack` pin row go away. The plugin keeps its own semver in
  `plugin.json`, bumped whenever it changes so Claude Code refreshes caches.
- Dev marketplace (`~/Documents/GitHub/mattstack-marketplace`): the
  `mattstack` entry becomes a `git-subdir` source,
  `{ "source": "git-subdir", "url": "file:///Users/matt/Documents/GitHub/mattstack", "path": "plugins/mattstack", "ref": "main" }`;
  a probe confirms Claude Code installs from it before the switch, and the
  fallback is a script that copies the plugin into the dev marketplace.
- rt's own references to the skills repo move in-tree: the hash-pinned
  fixtures in `lib/mcp/__tests__/tools-payload-hash.test.ts` and
  `lib/skills/__tests__/mcp-lint-rules-hash.test.ts` read the plugin files
  directly, and `rt skills` verbs that address the skills checkout (compile,
  promote, sync) point at `plugins/mattstack`.
- This machine: the mattstack plugin reinstalls from the updated dev
  marketplace; run `/reload-plugins`.
- Archive `m4ttstack/skills`.

## Risks

| Risk | Guard |
|---|---|
| Installed apps stop seeing updates after the rename | Stage 1 proves the redirect before the rename; the next release moves the feed to the new URL |
| Someone recreates `m4ttstack/rt` and breaks every redirect | Written into AGENTS.md and the release skill: the old name is never reused |
| A store keyed on the old identity silently starts empty | Stage 2 step 4 migrates every store and step 9 verifies the rt pool and tracking survive |
| Sessions whose cwd is the shared checkout break on the folder move | Announce first; they `/cd`; worktrees under `~/.mattstack` are unaffected |
| herdr cannot build a plugin from a subdirectory on a user's machine | herdr's `OWNER/REPO/SUBDIR` form is checked on this machine before the old repo is archived |
| The dev marketplace cannot read a `git-subdir` file URL | Probe first; fallback copies the plugin into the dev marketplace |
| Plugin CI (cargo, graphviz) slows every rt PR | Both jobs are path-scoped; test-scope keeps rt's shards off plugin-only diffs |

## Verification

Each stage's PR: CI green, `scripts/repo-purity.sh` green over the imported
history, an Opus whole-branch review, CodeRabbit findings addressed, merge
commit. Stage 2's machine list ends with its verify step. Stages 3 and 4 end
with a real install from the new path (herdr plugin install; the mattstack
plugin from the dev marketplace) on this machine.
