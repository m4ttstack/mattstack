# mattstack.app release reference

Setup and footgun knowledge for `rt:mattstack-release` (`SKILL.md`). The diagnose steps read the
footguns first.

## Distribution reality

- The pipeline is proven: its first shipped release was `v2.8.0` (2026-09-01), a signed,
  notarized `mattstack.app` as dmg + zip + `appcast.xml` + `SHA256SUMS`, release body from the
  committed `RELEASE_NOTES.md`. For the newest tag, ask `gh release list -R m4ttstack/mattstack`,
  not this document.
- There is no homebrew tap and no standalone CLI tarball. `rt` is the binary at
  `Contents/MacOS/rt` inside the bundle; updates flow through Sparkle.
- Users install from **mattstack.dev**: its download button resolves the latest release's dmg from
  the GitHub API at view time, so no site change is needed per release. Any other install path
  exists only if the site or release assets show it.
- Bundling status lives in `rt-tray/deps.lock` and nowhere else. Read the lock for what ships
  (`status: "bundled"`); never trust a table in a doc. Before editing a row, re-verify its
  org-qualified URL with `gh repo view <owner>/<repo> --json visibility,isPrivate`; these repos
  have moved orgs and rewritten history before.

## Key material (verify, don't assume)

- Secrets on `m4ttstack/mattstack`: check with `gh secret list -R m4ttstack/mattstack`
  (`APPLE_CERT_P12_BASE64`, `APPLE_CERT_P12_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASSWORD`,
  `APPLE_TEAM_ID`, `SPARKLE_ED_KEY`, `MARKETPLACE_TOKEN`).
- Sparkle EdDSA: public key committed at `rt-tray/SUPublicEDKey`; private key in the login
  keychain (`security find-generic-password -s "Sparkle EdDSA Private Key"`) and the gh secret.
  `generate_keys` never regenerates an existing key; `-x <file>` re-exports it. If every copy is
  lost, installed apps can no longer verify updates and need manual reinstalls; confirm an offline
  backup exists before assuming one does.

## Footguns

- **SPM binary-artifact downloads hang on GitHub macOS runners.** Six tag runs wedged silently
  inside `swift build`/`resolve` on Sparkle's zip while curl fetched the same URL in 2s. That is
  why Sparkle is vendored. Diagnose any future hang the same way: a separate `swift package
  resolve --verbose` step bounded by `/usr/bin/perl -e 'alarm N; exec @ARGV'` (no GNU timeout on
  macOS runners), `GIT_TERMINAL_PROMPT=0`, never piped (`if cmd | sed` swallows the exit code).
- **`RT_SANDBOX_PRESIGN` must never appear on the release path**: it defeats the inside-out
  signing pass; sandboxed-dev-machines only.
- **Stale `dist/rt` poisons e2e**: `e2e/setup.ts` only rebuilds when absent. `rm -f dist/rt`
  before a `bun run test:all` you intend to trust.
- **Stale `packages/rt-client/dist/`**: rebuild after touching or merging rt-client;
  `dist-freshness.test.ts`'s failure message is the fix.
- **The deps-lock TSV emitter is materialized to a file, never process substitution**, in all
  three consumers (`build.sh`, `check-bundle.sh`, `fetch-deps.sh`), so an emitter crash can't
  iterate zero rows and report success. Touching `split_tsv` means updating three hand-synced
  copies.
- **Never populate a worktree's `deps/` by copying another checkout's**: the copy carries whatever
  stale versions that checkout last fetched (a dev bundle shipped fast-browser 0.1.0-alpha.1 this
  way while deps.lock pinned 0.1.3's era). `scripts/fetch-deps.sh arm64` is the only populate
  path: it downloads per deps.lock and verifies the sha256.
- **Never add StandardOutPath/StandardErrorPath to the bundle's LaunchAgent plists.**
  BundleProgram plists are one shared file for all users, absolute log paths collide across users,
  and launchd treats a failed log-file open as a spawn failure. A bundled service instruments
  itself in-process (the daemon's `redirectNativeStderr` pattern; deck writes
  `~/.mattstack/deck/logs/agent.log` this way since 1.0.3).
- **Diagnosing deck in a guest**: `launchctl print`'s last-exit 78 on com.mattstack.deck appears
  in HEALTHY runs too; it is spawn noise, not a diagnostic. Read deck's state files and `lsof` on
  7940/7950 in the guest instead. Deck's gateway port 7950 is hardcoded (no env override), so a
  host-side repro on a machine running a real deck contaminates: observe in the guest. On a failed
  bind deck 1.0.4+ logs the port holder itself before exiting for launchd's retry.
