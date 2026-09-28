# mattstack estate dependency audit and normalization ledger

Started 2026-08-31 late evening. Goal: every internal dependency across the
estate is either a **public npm package** or a **private npm package** under
the `@mattstack` / `@soribashi` scopes ... no `file:` sibling paths, no
vendored tarballs, no `workspace:` specs leaking into published manifests ...
and every app consumes the **latest published version** of each internal
package. This ledger is the raw material for the future author-level
pre-release skills; record decisions and traps here, not just outcomes.

## Why (the whack-a-mole this ends)

The app-bundle CI (rt PR #143) builds each app from a single-repo clone, so
any dependency outside the repo cannot resolve. Fixing deck surfaced
tui-kit (`file:../tui-kit`), fixing tui-kit surfaced npm org billing, fixing
app-kit surfaced a dangling peer on an unpublished mantine-tokyo version.
One audit, then one normalization pass, instead of discovering each edge at
dispatch time.

## Account / registry facts (hard-won tonight)

- `@mattstack` is an npm ORG; the m4ttheweric USER's paid plan does not
  grant it private packages. The org needed its own paid plan (upgraded
  2026-08-31) before `--access restricted` stopped answering
  `402 Payment Required`.
- Granular npm tokens grant read and write SEPARATELY. A write-capable token
  404'd on install exactly like no token; the fix was a second READ-only
  token. Both live in Bitwarden item "mattstack secrets" (fields
  "npm mattstack read/write token", "npm mattstack read only token").
- The read token is on this machine's `~/.npmrc` and in the `NPM_READ_TOKEN`
  Actions secret on m4ttstack/rt (bundle-apps writes it to the runner's
  npmrc; read-only on purpose, the app recipe runs afterwards and can read
  the file).
- A fresh private package takes ~5 minutes after publish to become
  resolvable; a 404 in that window is propagation, not failure.
- npm is deprecating 2FA-bypassing tokens for direct publishing (account
  changes Aug 2026, publishing Jan 2027); the publish flow will need
  granular automation tokens configured for it.

## Done before the audit (2026-08-31)

| package | action | state |
| --- | --- | --- |
| @mattstack/tui-kit 0.1.0 | published PRIVATE | installable, verified |
| @mattstack/app-kit 0.1.9 | published PRIVATE | resolvable, but standalone install fails: dangling peer `@mattstack/mantine-tokyo@^0.2.0` (npm only has 0.1.2, public) |
| deck | `file:../tui-kit` -> `^0.1.0` (99c20f8) | builds green in CI |
| board | `file:../tui-kit` -> `^0.1.0` (f184922) | builds green in CI; dev loop doc rewritten for `bun link` |

## Open decisions

- mantine-tokyo 0.2.0: publishing inherits PUBLIC access (0.1.2 is already
  public). Uniform-private would mean flipping an already-public package.
- console vendors app-kit 0.1.7 while chat vendors 0.1.9: moving console to
  the registry is a real two-minor upgrade, not a swap.

## Audit findings (fan-out of 4 read-only agents + central registry check, 2026-08-31 ~21:45)

### Registry state, every internal package

| package | npm latest | access | local repo | verdict |
| --- | --- | --- | --- | --- |
| @mattstack/rt-client | 0.11.0 | public | 0.11.0 | ok |
| @mattstack/fast-browser | 0.1.0-alpha.15 | public | 0.1.0-alpha.17 | LOCAL AHEAD, unpublished |
| @mattstack/gitq | 0.2.1 | public | 0.2.1 | ok |
| @mattstack/settings-kit | 0.1.3 | public | 0.1.3 | ok |
| @mattstack/glance | 0.20.0 | public | (repo not in this pass) | ok |
| @mattstack/glance-react | 0.4.2 | public | (same) | ok |
| @mattstack/tui-kit | 0.1.0 | private | 0.1.0 | ok (tonight) |
| @mattstack/app-kit | 0.1.9 | private | 0.1.9 | published, DANGLING PEER on tokyo ^0.2.0 |
| @mattstack/app-server | none | - | 0.1.1 | NEEDS PUBLISH |
| @mattstack/mantine-tokyo | 0.1.2 | public | 0.2.0 | NEEDS 0.2.0 PUBLISH (inherits public) |
| @soribashi/core | 0.4.0 | public | 0.4.0 | ok |
| @soribashi/codegen, factory, theme | none | - | GONE from repo (only core/ui/workshop remain) | nothing needs them; historical |

### Consumers vs latest

| consumer | dep | current | latest | gap |
| --- | --- | --- | --- | --- |
| deck | tui-kit | ^0.1.0 | 0.1.0 | ok (but see tui-kit core pin) |
| deck (transitive) | @soribashi/core | 0.3.0 via tui-kit ^0.3.0 | 0.4.0 | tui-kit pins core to 0.3.x; needs tui-kit bump+republish |
| board | glance | ^0.19.0 | 0.20.0 | stale minor |
| board | settings-kit | ^0.1.2 | 0.1.3 | stale patch |
| board (transitive) | @soribashi/core | 0.3.0 | 0.4.0 | same tui-kit pin |
| gitq | glance | ^0.19.0 | 0.20.0 | stale minor |
| console | app-kit | vendored 0.1.7 tgz | 0.1.9 private | 2-minor upgrade + vendor->registry swap |
| console | app-server | vendored 0.1.1 tgz | unpublished | publish then swap |
| console | mantine-tokyo | vendored 0.2.0 tgz | 0.1.2 public | publish 0.2.0 then swap |
| chat | app-kit / app-server / tokyo | vendored 0.1.9 / 0.1.1 / 0.2.0 | same as console | swap only, no version jump |
| repo-tools | rt-client (workspace) | pkg.json 0.11.0, bun.lock resolved 0.10.1 | - | STALE LOCKFILE |
| repo-tools ext rt-context | rt-client ^0.3.0, glance ^0.19.0 | 0.11.0 / 0.20.0 | badly stale pins in the vscode extension |
| tui-kit | @soribashi/core | ^0.3.0 | 0.4.0 | bump + republish as 0.1.1 |
| tui-kit workshop (private ws) | @soribashi/core | ^0.1.0 | 0.4.0 | internal-only, fix alongside |
| app-kit probe (private ws) | vendored tgzs | by design (install probe) | - | leave; it exists to test tarball installs |

### Traps caught by the audit

- **tui-kit's package.json carries `publishConfig: public`.** Tonight's
  `--access restricted` flag overrode it, but any future bare `npm publish`
  would flip it PUBLIC silently. Must change to `restricted` before the next
  publish.
- app-kit repo root devDeps include `@mattstack/app-kit@workspace:*`
  (self-reference); harmless for publishing (root is private) but confusing.
- boxscore has zero internal deps and no bundle/dev nodes; genuinely out of
  scope until its bundling work.

### Worktree / clone inventory (requested mid-audit)

Safe to remove (merged or git-prunable, all clean):
- `repo-tools-post-wt` (docs/viewer-name, merged, 5d idle)
- `repo-tools-rt-94` (feat/rt-94-deck-dev-mode, MERGED as rt #145)
- `chat/.claude/worktrees/chat-qol` (git reports prunable)
- scratchpad `purity-fix` worktree + `fix/purity-board-comment` branch (rt #144 merged)

Likely done, verify before removing (squash-merges make ancestry checks
useless; memory says the work shipped):
- `repo-tools/.claude/worktrees/daemon-stability-audit` (audit complete + deployed)
- `repo-tools/.claude/worktrees/rt-63-68-locate` (PR #99 merged)
- `repo-tools/.claude/worktrees/compile-native-pipeline` (KEEP: phases B/C not started)

Active, keep: repo-tools-chat-invite, repo-tools-chat-qol,
repo-tools-rt-runner, repo-tools-tab-desc, deck-push-to-remote (deck-24,
active tonight), console-cfg (config-lens SDD).

`mr-board` and `local-apps` looked like stale full clones in the first pass
but are SYMLINKS to board and deck (old-name compat, kept deliberately). The
"unpushed" counts were the canonical repos' own local branches. Audit lesson:
check `ls -la` before classifying a directory as a clone.
- `console-archive/` is a real directory: 1.2 years idle, 21 dirty files,
  branch "my-last-commit"; left alone pending Matt.

Nothing points at the stale clones: deck's live registry references only the
canonical paths (board/console/chat via dev.workingDirectory, deck itself,
gitq, forge-leaderboard, mattari, mantine-kit, training-plan).

## Normalization actions (full pass, executed 2026-08-31 ~22:00-22:10)

Publish order (each verified by install before moving on):

1. `@mattstack/mantine-tokyo 0.2.0` published PUBLIC (0.1.2 was already
   public; access inherited, Matt ratified keeping it).
2. `@mattstack/app-server 0.1.1` published PRIVATE.
3. tui-kit: `publishConfig.access` public -> **restricted** (the trap),
   `@soribashi/core` ^0.3.0 -> ^0.4.0 (workshop's ^0.1.0 too), version
   0.1.1; gates + typecheck green; published via a BARE `npm publish`
   which came out restricted ... proving the publishConfig fix. tui-kit
   8728e30.

Consumers:

| repo | change | verification | commit |
| --- | --- | --- | --- |
| board | glance ^0.20, settings-kit ^0.1.3, tui-kit ^0.1.1 | typecheck + build:client + 819 tests green | 7abf385 |
| gitq | glance ^0.20 | 940 tests green | f20097c |
| deck | tui-kit ^0.1.1, board assets regenerated | build:board + 727 tests green | d9ef2e4 |
| chat | vendored tgzs -> registry (^0.1.9/^0.1.1/^0.2.0), vendor/ deleted | build green; Roster.test.tsx fails 4/4 IDENTICALLY pre- and post-swap (worktree A/B) = pre-existing | 2d79493 |
| console | vendored -> registry incl. app-kit 0.1.7 -> 0.1.9, vendor/ deleted | typecheck + build green; clean-install A/B: committed pre-swap state failed 285 TESTS on a fresh install (stale node_modules had been masking it), post-swap fails 1-3 pre-existing | 5bcf9cd |
| repo-tools ext rt-context | rt-client ^0.3 -> ^0.11, glance ^0.19 -> ^0.20 | builds | 3e274cb0 |

### Traps for the pre-release skill (new tonight)

- **Same version, different bytes**: chat's vendored app-kit-0.1.9.tgz
  shasum != the 0.1.9 published from repo HEAD. A kit that moves without a
  bump makes "the version matches" meaningless. The skill must diff
  shasums, not versions, when replacing a vendored dep.
- **Stale node_modules masks a broken committed state**: console's
  committed state failed 285 tests on a CLEAN install. Verification must
  run from a fresh worktree + install, never the working checkout.
- **bun workspace version metadata sticks in bun.lock**: repo-tools'
  packages/rt-client bumped to 0.11.0 but bun.lock still records 0.10.1
  even after `bun install --force` (cached-manifest behavior, same as
  board's dev-loop doc). Harmless to resolution (workspace links by dir).
  Cure is `rm -rf node_modules bun.lock && bun install`, deliberately NOT
  run tonight: repo-tools main is the live dev daemon's checkout and
  yanking node_modules under it is not a 11pm move. Do it in a maintenance
  window.

### Worktree cleanup (executed)

Removed 6: repo-tools-post-wt, repo-tools-rt-94 (#145 merged),
chat-qol (prunable), purity-fix scratchpad (+branch), and after verifying
each branch tip was EXACTLY a merged PR head (#136, #99):
daemon-stability-audit and rt-63-68-locate. Kept: compile-native-pipeline
(phases B/C pending) and the 5 active sibling lanes. New CLAUDE.md rule
going forward: worktrees live in `.claude/worktrees/`, never as siblings.

### End state

Every internal dependency in the estate is now a registry package:
PUBLIC rt-client 0.11.0, fast-browser alpha.15, gitq 0.2.1, settings-kit
0.1.3, glance 0.20.0, glance-react 0.4.2, mantine-tokyo 0.2.0,
soribashi/core 0.4.0. PRIVATE tui-kit 0.1.1, app-kit 0.1.9, app-server
0.1.1. Zero file:/vendored internal deps outside app-kit's install-probe
(which exists to test tarballs). All consumers on latest.

Still open, deliberately: fast-browser local alpha.17 unpublished (deps.lock
pins alpha.15; publish when fast-browser lane wants it); repo-tools lock
metadata (above); chat Roster tests + console palette/route tests
(pre-existing failures, owners' lanes); Renovate + changesets adoption
(recommended, not started).

## Cross-repo release orchestration (tool assessment)

The estate's shape: ~11 repos, 3 of them kit monorepos (tui-kit, app-kit,
soribashi) publishing 5 packages, 5 apps consuming them, mixed
public/private, bun everywhere. What fits and what does not:

- **Renovate** (best single addition): watches the registries and opens
  bump PRs in every consumer when an internal package publishes. Handles
  private npm (host rules with the read token), groups related bumps,
  works across separate repos ... which none of the monorepo release tools
  do. This directly kills the "apps drift behind the kits" half of the
  problem. Dependabot is the weaker same-idea (no cross-repo grouping, npm
  private support clunkier).
- **Changesets** (per kit monorepo): intent files recorded at PR time;
  `changeset version` + `changeset publish` handle bump/changelog/publish
  order within a workspace, including dependent-package ordering
  (app-kit's peer on tokyo). rt-client already publishes by hand-rolled
  discipline; changesets would encode it. Per-repo only ... it does not
  coordinate ACROSS repos.
- **release-please**: per-repo release PRs from conventional commits.
  Overlaps changesets; pick one. Changesets fits bun workspaces better.
- **Monorepo consolidation (Nx/Turborepo)**: the structural answer would be
  merging the three kit repos into one kit monorepo; then one changesets
  run versions core->tokyo->app-kit->tui-kit in order. Real option, big
  churn; apps should stay separate regardless.
- **Not recommended**: Lerna (monorepo-only, legacy), meta/git-meta
  meta-repos (operationally painful), GitHub Packages (scope must equal the
  org name, and `@mattstack` != `m4ttstack`).

**Recommended shape**: changesets inside each kit repo for
version+publish, Renovate across the estate for propagation, and the
author-level pre-release SKILL (this ledger's purpose) as the orchestrator
that runs the publish order (soribashi/core -> tokyo -> app-kit/app-server
-> tui-kit -> apps) and verifies each hop the way tonight's session did by
hand: publish, wait out propagation (~5 min for a new private package),
install-test in a temp dir, then move consumers.

