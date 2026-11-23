# herdr fork, Plan 1: the fork and its build list

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `m4ttstack/herdr` with flock's four herdr patches as separate commits, a mattstack version string, `herdr update` pointed at the fork, signed builds published by CI with a build list, and a nightly upstream check; then publish `0.9.5-ms.1`.

**Architecture:** One branch per upstream base (`mattstack/0.9.5`), upstream tag plus one commit per feature. A release workflow on the self-hosted Mac signs and publishes each build to a GitHub release with two manifests: `herdr-builds.json` (read by rt setup and flock) and `latest.json` (herdr's own update format, read by `herdr update`). A nightly workflow on GitHub-hosted macOS rebases onto new upstream tags and reports.

**Tech Stack:** Rust (herdr, zig 0.16.0 for build.rs), GitHub Actions, bash + jq, `gh`, `codesign`.

**Spec:** `docs/superpowers/specs/2026-11-23-herdr-fork-design.md` (mattstack repo). This plan covers spec §1, §2, §3 and the "herdr's own updates" outcome from §4. Plans 2 to 5 cover setup, flock, the flock row, and gate state.

## Plan series

1. **This plan:** the fork, builds, build list, nightly job, `0.9.5-ms.1`.
2. Mattstack setup's herdr row on the build list (removes stock/Homebrew herdr, handoff, old backups, `rt:release` check, minimum build), plus the fork-readmes rule commit `451265a97`.
3. Flock reads the build list, installs from nothing, drops Revert and the patch scripts.
4. The required flock row in `rt setup`.
5. Gate blocked state: fork commit, `0.9.5-ms.2`, gate-form change.

## Global Constraints

- Fork repo: `m4ttstack/herdr`. Branch per base: `mattstack/<upstream version>`.
- Version string: `<upstream version>-ms.<n>`, e.g. `0.9.5-ms.1`. Release tags: `v<version>` (e.g. `v0.9.5-ms.1`).
- Builds: macOS arm64 and x86_64 only. Asset names `herdr-macos-aarch64`, `herdr-macos-x86_64`.
- Signing: Developer ID Application, `codesign --force --options runtime --timestamp`, then `codesign --verify --strict`. Signing happens only on the self-hosted Mac runner; the certificate never goes into a GitHub secret.
- License: Apache-2.0, same as upstream. Release notes say the build is not made or endorsed by herdr's maintainers.
- README follows the house rule `plugins/mattstack/rules/fork-readmes.md` (suffix `ms`), updated in the same commit as each feature commit.
- Every new manifest field name below is fixed: later plans read them.
- Never run a built herdr outside an isolated HOME: `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin ./herdr …`.

## Review Focus

1. A stock herdr manifest entry or herdr.dev URL left reachable from a mattstack build, so `herdr update` installs stock herdr. Task 3 tests that every URL the update path fetches is the fork's.
2. `0.9.5-ms.1` and `0.9.5-ms.2` comparing equal, so a same-base revision never updates. Task 3 tests revision ordering.
3. The cumulative build list losing earlier builds when a release appends, so installers stop recognising older fork builds as outdated. Task 4 tests append keeps every prior build.
4. An unsigned or wrong-architecture binary published. Task 5's workflow fails the job on `codesign --verify` and `lipo -archs` mismatches.
5. The nightly job publishing on its own. It must only push a candidate branch and open an issue; publishing is a separate, manual run. Task 6 checks the workflow has no release permissions.

---

### Task 1: Create the fork and split flock's patch into commits

**Files:**
- Create repo `m4ttstack/herdr` (fork of `herdrdev/herdr`), branch `mattstack/0.9.5` from tag `v0.9.5`.
- Source patches: `git -C ~/Documents/GitHub/flock show <commit>:patches/herdr/0.9.5.patch` at `f6607d11` (r1 mouse), `5cf80370` (r2 host theme), `b8435c93` (r3 theme timing and handoff restart), `41b95974` (r4 kitty images).

**Interfaces:**
- Produces: branch `mattstack/0.9.5` with four commits whose final tree equals `v0.9.5` + r4 patch.

- [ ] **Step 1: Fork and clone**

```bash
gh repo fork herdrdev/herdr --org m4ttstack --fork-name herdr --clone=false
git clone https://github.com/m4ttstack/herdr ~/Documents/GitHub/herdr-ms
cd ~/Documents/GitHub/herdr-ms && git fetch --tags && git switch -c mattstack/0.9.5 v0.9.5
```

- [ ] **Step 2: Disable every upstream workflow in the fork**

Run: `gh workflow list -R m4ttstack/herdr --all --json id --jq '.[].id' | xargs -n1 gh workflow disable -R m4ttstack/herdr`
Expected: `gh workflow list -R m4ttstack/herdr` shows none active. Disabling (a repo setting) instead of deleting the files keeps rebases conflict-free.

- [ ] **Step 3: Make one commit per revision**

For each revision N in r1..r4 in order: restore the upstream tree (`git checkout v0.9.5 -- .` then `git clean -fd`), `git apply` revision N's patch, `git add -A`, commit. Each commit then holds exactly that revision's delta over the previous one. Messages: `mouse: accept flock's terminal.mouse shape and report mouse capture`, `host theme: terminal.host_theme on terminal session control`, `theme timing and live-handoff server restart fixes`, `kitty images in session-control frames`.

- [ ] **Step 4: Verify the tree equals v0.9.5 + r4**

```bash
git switch -c verify-r4 v0.9.5 && git apply /tmp/r4.patch && git add -A && git commit -qm r4
git diff --stat verify-r4 mattstack/0.9.5   # Expected: empty
git switch mattstack/0.9.5 && git branch -D verify-r4
```

- [ ] **Step 5: Run herdr's tests**

Run: `cargo test --locked` (zig 0.16.0 on PATH)
Expected: PASS, same failures-or-none as `v0.9.5` on this Mac.

- [ ] **Step 6: Push**

Run: `git push -u origin mattstack/0.9.5 && gh repo edit m4ttstack/herdr --default-branch mattstack/0.9.5`

### Task 2: Fork identity: version string, README

**Files:**
- Create: `ms/build.sh` (builds one arch with the fork's version baked in)
- Create: `README.md` (replaces upstream's; per the house rule)
- Test: `ms/tests/version.sh`

**Interfaces:**
- Produces: `ms/build.sh --arch arm64|x86_64 --revision N --out DIR` writes `DIR/herdr-macos-<aarch64|x86_64>`; the binary's `herdr --version` prints `herdr <base>-ms.<N>`. Base comes from `Cargo.toml`'s `version`.

- [ ] **Step 1: Write the failing test** `ms/tests/version.sh`: builds for this Mac's arch with `--revision 7` into a temp dir, runs `--version` under an isolated HOME, asserts the output is exactly `herdr 0.9.5-ms.7`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bash ms/tests/version.sh`
Expected: FAIL, `ms/build.sh` not found.

- [ ] **Step 3: Implement `ms/build.sh`**

Sets `HERDR_BUILD_CHANNEL=ms` and `HERDR_BUILD_ID=<N>` for `cargo build --release --locked --target <aarch64|x86_64>-apple-darwin`; `build_info::version()` already formats `<base>-<channel>.<build_id>`. Checks zig is 0.16.0 and the Rust target is installed, with the same messages as flock's `Scripts/build-herdr-patch.sh`. Copies the binary to the `--out` name. No signing here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash ms/tests/version.sh`
Expected: PASS.

- [ ] **Step 5: Write `README.md`** per `fork-readmes.md`: title "herdr (mattstack fork)"; one line naming `herdrdev/herdr` 0.9.5 and that mattstack and flock run it; "What's different" with one bullet each for mouse, host theme, theme timing and handoff restart, kitty images, and "updates come from this fork"; "Installation" (`rt setup` and flock install it; by hand: download the asset for your Mac from the latest release to `~/.local/bin/herdr`, `chmod +x`); version scheme `<upstream version>-ms.<n>`; "Everything else" linking `https://github.com/herdrdev/herdr/blob/v0.9.5/README.md` and `https://github.com/herdrdev/herdr#readme`; "License" Apache-2.0, see `LICENSE`.

- [ ] **Step 6: Commit**

```bash
git add ms/build.sh ms/tests/version.sh README.md
git commit -m "fork identity: <base>-ms.<n> version and a fork README"
```

### Task 3: Updates come from the fork

**Files:**
- Modify: `src/update.rs` (manifest URL, revision field, install decision, preview refusal)
- Modify: `src/build_info.rs` (fork revision accessor)
- Modify: `README.md` ("What's different" bullet already added in Task 2; adjust wording if needed)
- Test: `src/update.rs` tests module, `src/build_info.rs` tests module

**Interfaces:**
- Produces:
  - `build_info::fork_revision() -> Option<u32>`: `Some(n)` when channel is `ms` and the build id parses as `u32`, else `None`.
  - `build_info::is_fork() -> bool`: channel is `ms`.
  - Manifest field `fork_revision: Option<u32>` on `UpdateManifest` (serde default `None`).
  - `fn fork_should_install(latest: &Version, latest_rev: u32, current: &Version, current_rev: u32) -> bool`: true when `(latest, latest_rev) > (current, current_rev)` lexicographically.
  - Constant `FORK_UPDATE_MANIFEST_URL = "https://github.com/m4ttstack/herdr/releases/latest/download/latest.json"`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn fork_revision_orders_within_a_base() {
    let v = Version::parse("0.9.5").unwrap();
    assert!(fork_should_install(&v, 2, &v, 1));
    assert!(!fork_should_install(&v, 1, &v, 1));
    assert!(!fork_should_install(&v, 1, &v, 2));
}
#[test] fn fork_newer_base_wins_over_revision() {
    assert!(fork_should_install(&Version::parse("0.9.6").unwrap(), 1, &Version::parse("0.9.5").unwrap(), 9));
}
#[test] fn fork_build_fetches_only_the_fork_manifest() {
    assert_eq!(update_manifest_url(true), FORK_UPDATE_MANIFEST_URL);
    assert!(!update_manifest_url(true).contains("herdr.dev"));
}
#[test] fn fork_build_refuses_the_preview_channel() {
    let err = preview_channel_allowed(true).unwrap_err();
    assert_eq!(err, "This herdr is the mattstack fork. It updates only from m4ttstack/herdr, which has no preview channel.");
}
#[test] fn manifest_reads_fork_revision() {
    let m: UpdateManifest = serde_json::from_str(r#"{"version":"0.9.5","fork_revision":3,"notes":"","assets":{},"sha256":{}}"#).unwrap();
    assert_eq!(m.fork_revision, Some(3));
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --locked --lib update::tests::fork_ build_info::`
Expected: FAIL, functions not defined.

- [ ] **Step 3: Implement**

- `update_manifest_url(is_fork: bool) -> &'static str`: fork URL when `is_fork`, else today's stable URL; `fetch_update_manifest` uses it with `build_info::is_fork()`.
- `preview_channel_allowed(is_fork: bool) -> Result<(), String>` with the exact message above; `check_latest` skips the preview manifest for a fork build, and `herdr channel set preview` prints the message and exits 1 on a fork build.
- In the stable install decision, a fork build uses `fork_should_install` with the manifest's `fork_revision.unwrap_or(0)` and `build_info::fork_revision().unwrap_or(0)`; a fork build never offers the Homebrew or mise update commands.
- `build_info::fork_revision` and `is_fork` as in Interfaces.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --locked --lib update:: build_info::`
Expected: PASS, including the existing update tests.

- [ ] **Step 5: Commit**

```bash
git add src/update.rs src/build_info.rs README.md
git commit -m "updates come from the fork: fork manifest, revision ordering, no preview channel"
```

### Task 4: Manifest writer

**Files:**
- Create: `ms/manifests.sh`
- Test: `ms/tests/manifests.sh`, fixtures in `ms/tests/fixtures/`

**Interfaces:**
- Consumes: the signed binaries from Task 5's job (paths passed in).
- Produces: `ms/manifests.sh --version 0.9.5-ms.N --base 0.9.5 --revision N --arm64 PATH --x86_64 PATH --previous PREV_BUILDS_JSON|none --notes FILE --out DIR` writes `DIR/herdr-builds.json` and `DIR/latest.json`.

`herdr-builds.json` (fields fixed; Plans 2 and 3 read them):

```json
{
  "schema": 1,
  "newest": "0.9.5-ms.1",
  "builds": [
    {
      "version": "0.9.5-ms.1", "herdr": "0.9.5", "revision": 1,
      "changesServer": true,
      "assets": {
        "arm64":  { "url": "https://github.com/m4ttstack/herdr/releases/download/v0.9.5-ms.1/herdr-macos-aarch64", "sha256": "…" },
        "x86_64": { "url": "https://github.com/m4ttstack/herdr/releases/download/v0.9.5-ms.1/herdr-macos-x86_64", "sha256": "…" }
      },
      "supersedes": ["<every sha256 of every earlier build in this list>"]
    }
  ],
  "flockPatchSha256": ["<the twelve sha256 values pinned in flock's HerdrMousePatchCatalog.swift>"]
}
```

`changesServer` is `true` for every build: every build replaces the binary the server runs. `latest.json` uses herdr's own manifest shape (`version` = base, `fork_revision`, `notes`, `protocol` from `src/protocol/wire.rs` `PROTOCOL_VERSION`, `assets` and `sha256` keyed `macos-aarch64` and `macos-x86_64`).

- [ ] **Step 1: Write the failing tests** in `ms/tests/manifests.sh`, using two dummy binaries:
  - first build with `--previous none`: `newest` is `0.9.5-ms.1`, one build, `supersedes` empty, `flockPatchSha256` has 12 entries, each asset sha256 equals `shasum -a 256` of its dummy.
  - second build with `--previous` = the first output: two builds in order, `newest` is `0.9.5-ms.2`, second build's `supersedes` holds both of the first build's sha256s, first build unchanged.
  - `latest.json`: `version` `0.9.5`, `fork_revision` 2, both `macos-*` keys present in `assets` and `sha256`, no URL containing `herdr.dev`.

- [ ] **Step 2: Run to verify it fails**

Run: `bash ms/tests/manifests.sh`
Expected: FAIL, `ms/manifests.sh` not found.

- [ ] **Step 3: Implement `ms/manifests.sh`** with `jq`; the twelve flock SHA-256 values live in the script as a constant list copied from flock's catalog (lines 107 to 127).

- [ ] **Step 4: Run to verify it passes**

Run: `bash ms/tests/manifests.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ms/manifests.sh ms/tests
git commit -m "ms: write herdr-builds.json and latest.json for a build"
```

### Task 5: Signed release workflow on the Mac runner

**Files:**
- Create: `.github/workflows/ms-release.yml`
- Create: `ms/runner/README.md` (how the signing runner is set up)

**Interfaces:**
- Consumes: `ms/build.sh` (Task 2), `ms/manifests.sh` (Task 4).
- Produces: `workflow_dispatch` with input `branch` (default the repo's default branch). Publishes release `v<base>-ms.<N>` marked latest, with assets `herdr-macos-aarch64`, `herdr-macos-x86_64`, their `.sha256`, `LICENSE`, `herdr-builds.json`, `latest.json`. `N` = highest published `ms` revision for this base + 1.

- [ ] **Step 1: Set up the signing runner (Matt, by hand)**

Add a Human Todo: on the Mac mini, in a real terminal, import the Developer ID Application certificate into the CI user's login keychain, and register one runner for `m4ttstack/herdr` named `herdr-signer-<LocalHostName>` with label `herdr-signer`, using the same CI user and launchd pattern as `scripts/ci/mac-runner/install.sh` in mattstack. `ms/runner/README.md` records the exact commands. Verify: `gh api repos/m4ttstack/herdr/actions/runners --jq '.runners[]|.name+" "+.status'` lists it online, and on the mini `security find-identity -v -p codesigning` as the CI user lists the identity.

- [ ] **Step 2: Write the workflow**

One job on `runs-on: [self-hosted, herdr-signer]`, `permissions: contents: write`, triggered only by `workflow_dispatch`. Steps: check out `inputs.branch`; compute `N` from `gh release list`; `ms/build.sh` both arches; sign each; fail the job unless `codesign --verify --strict` passes and `lipo -archs` prints `arm64` and `x86_64` respectively; download the current `herdr-builds.json` from the latest release (`none` when there is none); run `ms/manifests.sh`; `gh release create v<base>-ms.<N> --latest --title "herdr <base>-ms.<N> (mattstack fork)"` with notes naming the branch commit and the not-endorsed line; if `<base>` is the newest base published, set it as the default branch.

- [ ] **Step 3: Dry run**

Run: `gh workflow run ms-release.yml -R m4ttstack/herdr -f branch=mattstack/0.9.5` on a throwaway branch copy first if preferred, then watch with `gh run watch`.
Expected: release `v0.9.5-ms.1` exists with all seven assets.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ms-release.yml ms/runner/README.md
git commit -m "ms: signed release workflow on the herdr-signer runner"
```

### Task 6: Nightly upstream check

**Files:**
- Create: `.github/workflows/ms-upstream.yml`
- Create: `ms/rebase-onto.sh`
- Test: `ms/tests/rebase-onto.sh`

**Interfaces:**
- Produces: `ms/rebase-onto.sh <upstream-tag>`: from the default branch, creates `mattstack/<version>` by rebasing every commit after the old base tag onto `<upstream-tag>`, bumping nothing else. Exit 0 clean; exit 3 on conflict with the conflicting commit's subject on stderr.

- [ ] **Step 1: Write the failing test** `ms/tests/rebase-onto.sh` in a temp repo: base tag `v1.0.0`, two fork commits, new tag `v1.0.1` touching an unrelated file → exit 0, branch `mattstack/1.0.1` has both fork commits on `v1.0.1`. Second case: `v1.0.2` edits the same line as fork commit 2 → exit 3, stderr names commit 2's subject.

- [ ] **Step 2: Run to verify it fails**

Run: `bash ms/tests/rebase-onto.sh`
Expected: FAIL, script not found.

- [ ] **Step 3: Implement `ms/rebase-onto.sh`** with `git rebase --onto <tag> <old-base-tag>`; the old base tag is `v` + the default branch's `Cargo.toml` version before rebasing.

- [ ] **Step 4: Run to verify it passes**

Run: `bash ms/tests/rebase-onto.sh`
Expected: PASS.

- [ ] **Step 5: Write the workflow**: `schedule: cron "0 9 * * *"` plus `workflow_dispatch`; `runs-on: macos-latest`; `permissions: contents: write, issues: write` (no release step). Find the newest `herdrdev/herdr` stable tag (`v<x.y.z>`, no suffix); stop if `mattstack/<x.y.z>` exists. Run `ms/rebase-onto.sh`, then `cargo test --locked` and `bash ms/tests/*.sh`. Clean and green: push `mattstack/<x.y.z>` and open an issue "herdr <x.y.z> ready to publish" with the compare link and the command `gh workflow run ms-release.yml -R m4ttstack/herdr -f branch=mattstack/<x.y.z>`. Conflict or red: open an issue "herdr <x.y.z> needs a hand" naming the failing commit or tests; one issue per tag, later runs comment on it.

- [ ] **Step 6: Commit and trigger once**

```bash
git add .github/workflows/ms-upstream.yml ms/rebase-onto.sh ms/tests/rebase-onto.sh
git commit -m "ms: nightly check for new upstream herdr releases"
git push && gh workflow enable ms-upstream.yml -R m4ttstack/herdr && gh workflow run ms-upstream.yml -R m4ttstack/herdr
```

Expected: the run finds no tag newer than 0.9.5 (or opens the right issue if upstream has released since).

### Task 7: Publish 0.9.5-ms.1 and check it end to end

- [ ] **Step 1: Publish**

Run: `gh workflow run ms-release.yml -R m4ttstack/herdr -f branch=mattstack/0.9.5 && gh run watch -R m4ttstack/herdr`
Expected: release `v0.9.5-ms.1`, marked latest.

- [ ] **Step 2: Check the build list**

Run: `curl -sL https://github.com/m4ttstack/herdr/releases/latest/download/herdr-builds.json | jq '.newest, (.builds|length), (.flockPatchSha256|length)'`
Expected: `"0.9.5-ms.1"`, `1`, `12`.

- [ ] **Step 3: Check the binary for this Mac under an isolated HOME**

Download this Mac's asset to a temp dir, compare `shasum -a 256` with the list, then `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin ./herdr-macos-<arch> --version`.
Expected: `herdr 0.9.5-ms.1`; `codesign --verify --strict` passes.

- [ ] **Step 4: Check `herdr update` on a fork build** under the same isolated HOME, against the temp copy (it can only replace that copy): `./herdr-macos-<arch> update`.
Expected: `already up to date (0.9.5-ms.1)`. That the request goes to the fork, not herdr.dev, is pinned by Task 3's unit tests.
