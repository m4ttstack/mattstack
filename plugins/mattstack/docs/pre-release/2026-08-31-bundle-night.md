# Bundle night — 2026-08-31 (overnight session)

Ledger of the overnight push toward a working mattstack.app bundle. Matt
granted standing publish/dispatch authorization for the night (~23:34) and
went to bed. Companion to `2026-08-31-dependency-audit.md` (same day,
earlier); together these are the brief for the author-level pre-release
skill.

Actors: max (repo-tools session, this ledger), ida (fable peer, chat-lane
investigations, reported via DM).

## What shipped, in order

| # | What | Where |
|---|------|-------|
| 1 | fast-browser 0.1.0-alpha.17 published public; deps.lock bumped | npm; rt `03a8673b` |
| 2 | Self-hosted Renovate (daily 09:00 UTC + dispatch, 9 repos, @mattstack/* + @soribashi/* only, grouped) | rt `0e58f9aa`, `ab2db08c` |
| 3 | PAT gained Issues read+write (Matt, in place) → all 9 repos green in dry run | run 33468287949 |
| 4 | MARKETPLACE_TOKEN secret set (release-token value reused) | repo secret |
| 5 | app-server 0.1.2: `--version` prints bare semver + exit 0 | app-kit `bb4f77a`, npm |
| 6 | console bundle-ready (bundle node, app-server ^0.1.2) | console `e904df9` |
| 7 | chat bundle-ready (build:binary + embedded assets + pkg.version + tsconfig exclude + bundle node) | chat `f6a9b5b` |
| 8 | home.init: fallback identity for the initial commit (supersedes R043) + failureDetail header-carry | rt `48036ad1` |
| 9 | console v0.1.0 + chat v0.1.0 REAL bundle builds: releases published, pins landed | runs 33470429589 / 33470564380; PR #147 merged, #148 applied by hand |
| 10 | chat plugin shipped inline in the marketplace + added to BASE_PLUGINS; marketplace PUBLISHED | rt `18d9b3a3`; m4ttstack/mattstack-marketplace |
| 11 | fetch-deps gh fallback for private release assets + GH_TOKEN on release.yml's fetch step | rt `3e4ec2d7` |
| 12 | Maintainer docs: bundle checklist + two-skills-channels | rt `144bb25d` |

## Findings a future pre-release skill must encode

1. **`--version` is a hard contract.** The build leg's smoke and
   check-bundle both run `<binary> --version`; an app-server app without
   the 0.1.2 handling starts a real server and hangs CI. The version must
   come from package.json (chat had `'0.0.0'` hardcoded — tag/binary
   disagreement).
2. **The clean-room script only runs in release.yml.** e2e.yml compiles rt
   from source and runs `e2e/` tests — it never exercises
   `e2e-cleanroom.sh`. The home-repo work (PR #44) shipped a week after
   the last green clean-room run, and its no-git-identity hard-stop was
   invisible until tonight's release dry run. Any change to install-path
   code needs a release dry run before it's called proven.
3. **Two real dispatches back-to-back conflict on the deps.lock PR.**
   Merge the first, apply the second's row by hand from its PR diff
   (re-verify the sha from the release asset yourself), close it.
4. **Private app repos (console, chat) refuse bare curl on release
   assets.** fetch-deps now falls back to `gh release download`;
   release.yml's fetch step carries `GH_TOKEN: MATTSTACK_RELEASE_TOKEN`.
   A green dry run BEFORE the private rows flipped to `bundled` proved
   nothing about this path — pending rows are skipped.
5. **The marketplace publish is destructive by design.** marketplace.sh
   replaces the published repo's tree wholesale from rt's `marketplace/`
   dir. The chat plugin lived only in the local dev marketplace (which
   has NO git remote) — one publish away from being unreachable, and it
   had never been published at all. Inline plugins belong under rt's
   `marketplace/plugins/`.
6. **A plugin reaches users only via BOTH wires**: published in the
   marketplace AND listed in `BASE_PLUGINS`. The `chat:` namespace is a
   wire contract (`rt chat invite` types `/chat:join`), and hooks never
   ride the skills-link channel — so namespace'd/hooked skill sets must
   be plugins, not tarball skills.
7. **Renovate + fine-grained PATs**: the init GraphQL queries
   `repository.issues`; public repos allow it permissionless, private
   return FORBIDDEN → `platform-unknown-error`. The PAT needs Issues
   read+write. Fine-grained PATs are editable in place (no rotation).
8. **npm prepublishOnly gates bite at publish time**: fast-browser's
   macro-hashes check required a regen commit before alpha.17 would go.

## Peer verdicts (ida, via DM)

- **herdr-chat**: own repo (m4ttstack/herdr-chat), a Rust/ratatui herdr
  plugin installed by `herdr plugin install` (cargo-built at install
  time). NOT a bundle concern: no deps.lock row, not in chat's artifact.
  Caveat parked: install-time cargo build implies a Rust toolchain on
  user machines — a herdr plugin-manager (prebuilt artifacts) question.
- **chat: skills**: live in the chat marketplace plugin (4 skills +
  presence hooks). Must STAY a plugin (namespace + hooks + double-install
  drift). Chat's tarball legitimately ships no skills.

## State at ledger time (~23:50)

- deps.lock: 14/17 rows `bundled` — console 0.1.0 and chat 0.1.0 now real.
  Pending: deck, board (gated on Matt eyeballing deck's board UI — his
  ratification, held overnight), mattstack-proxy-install (ruled: leave
  pending; portless helper never built, degrades gracefully).
- Release dry run #3 (33471075414) running: first build with console+chat
  inside the signed bundle — proves the private fetch, check-bundle's
  `--version` on both, and the clean-room install with the identity fix.
- Next after green: golden-VM walkthrough (`walkthrough.sh --ver 26
  --dmg <artifact> --scenario headless --no-graphics`) against
  mattstack-golden-26 — the real clean-room proof.
- Console real dispatch was classifier-blocked until Matt's standing
  authorization; dispatches then went via `gh api ...(dispatches)`.

## Walkthrough saga (00:00-00:35, after the ledger above)

The golden-VM walkthrough ran 5 times against the ci83 DMG; each run got
one phase further. All harness+product fixes committed on rt main:

1. Boot failed: ssh key drift — the golden trusts a key regenerated later
   in vm/.cache (goldens are never re-provisioned). Fix `696223ab` +
   `35d922f8`: the walkthrough re-trusts the current key in the CLONE via
   the admin password bootstrap, for tester AND admin. Goldens stay
   unbooted. (--no-graphics was a red-herring first hypothesis; the retry
   with graphics failed identically.)
2. Install+launch+tray asserts then PASSED: Gatekeeper accepts the
   notarized ci83 DMG in the VM, tray answers /version, daemon registers.
3. Headless recipe hit the gitless golden's tool.clt block — the parked
   "full-green" scenario. Fix `35d922f8`+: walkthrough now drives
   `rt tools install apple-clt` (as admin) before the cleanroom.
   **PROVEN: "installed Command Line Tools for Xcode 26.6-26.6 headlessly
   — git 2.50.1"** — the first time the full gitless-Mac journey ran.
4. Next blocker: home.init found a lone machine profile (created by the
   app's own launch moments earlier) and non-interactive init refused to
   choose. RULING (`50881408`, TDD'd): exactly one profile whose key
   equals this machine's hostname slug auto-adopts; anything else still
   refuses. This also fixes the retry-after-partial-install trap.
5. The fix ships INSIDE rt in the DMG → release dry run #4 (33473738271,
   green in 12 min on warm caches) → ci84 DMG.
6. ci84 walkthrough: profile adopt worked; next wall was the ssh session's
   LOCKED login keychain (age-key store failed). Harness fix: unlock the
   tester keychain before the recipe — real installs run in a GUI session
   where it's already unlocked.
7. **PRODUCT GAP found (morning ticket material): setup app-needs ride the
   app's own stdout pipe.** A standalone `rt setup apply`/`--post-install`
   with the app RUNNING waits ~10 min at services.register then dies — the
   running app never learns about the need (only an app-DRIVEN apply
   services them; app ABSENT degrades gracefully, which is why CI passes).
   Fix direction: deliver needs via tray.sock POST too. Harness works
   around it: quit the app for the recipe, relaunch for asserts.
8. **FINAL: 8/10 phases green (run 20260901-005726).** The screens phase —
   the full 21-step post-install + `rt verify --ci` "all critical checks
   passed" + daemon install — ran GREEN inside the VM: Gatekeeper accept,
   headless CLT install, home init with fallback identity + profile adopt,
   tools linked (rt, fast-browser, gitq), services degrade, verify.
   The 2 remaining assert failures share one root that headless cannot
   clear: the daemon's Login Items (BTM) approval is a human click, so
   plain `rt verify` and the daemon-running probe fail by design in a
   fresh VM. Options for later: golden-side BTM pre-approval (hard:
   per-app identity), an interactive walkthrough leg, or a headless
   allowance in the assert phase.

## Morning session (2026-09-01): the daemon was never broken by BTM

The 8/10 "headless ceiling" diagnosis was WRONG, and the golden-VM
walkthrough earned its keep: ssh'd into a kept clone and found the daemon
had run 15 times, each killed SIGKILL "Code Signature Invalid" /
CODESIGNING "Invalid Page" on an r-x MALLOC_SMALL region. BTM had
auto-allowed the login item all along (the notification even says so).

**Root cause: bun's JIT emits code into plain malloc'd pages (not
MAP_JIT), which `allow-jit` does not cover.** Long-running bun binaries
need `com.apple.security.cs.allow-unsigned-executable-memory` under the
hardened runtime. Short invocations (version checks) never warm the JIT,
so every smoke test passes without it — the whole `--version` smoke
lattice is structurally blind to this class. Proven by re-signing the
guest binary with the entitlement: 15 crash-loops → survives.

Pre-release lessons this adds:
1. **A smoke test proves launch, not life.** Every bun-compiled service
   in the bundle (rt daemon, console, chat, deck) shares this crash
   class; the fix went into the shared `scripts/entitlements.plist`.
   A soak assertion (daemon still up after 30s of real work) belongs in
   the walkthrough.
2. **CI's clean room tolerates a dead daemon** ("not booted (expected in
   CI)"), and the author machine runs the dev daemon from source — so
   bundled-daemon-under-launchd had never executed anywhere before the
   VM walkthrough. Gates that fail open hide entire subsystems.
3. **AMFI's entitlements parser rejects a double hyphen inside XML
   comments** where plutil says OK — a plist can lint clean and still
   fail at codesign time.

Also this morning (separate lanes, all shipped): the deck grandfather
path removed (bundle shape must live in Contents/Helpers; register slims
records), drawer reworked (source screen owns the dev link; Unlink out of
the table), forge-leaderboard renamed to boxscore end to end, the
rt apply-hang fixed (fast refusal when the app is running), welcome-screen
copy updated, and the CLT git-stub dialog suppressed (probe gates on
xcode-select before ever invoking git).

## FULLY GREEN (2026-09-01 10:21): 9 passed, 0 failed, 1 skipped

Walkthrough run 20260901-101853 on ci87: the whole gitless-Mac journey —
Gatekeeper, install, launch, headless CLT, 21-step post-install, daemon
ALIVE under launchd, verify --ci, all asserts. The one skip is the Sparkle
update leg (needs a first published release; unproven by design until
tag #1). The morning's chain to get here, each proven by the next run:

1. bun-JIT entitlement (allow-unsigned-executable-memory) + check-bundle
   contract flipped to require-it-with-jit (rt 54fb5de7 + follow-up).
2. Second git-stub dialog source: home-git.ts (the tray polls setup
   status from launch, whose rt-health rows probe the home repo with
   git). Now gated on xcode-select, positive-only cache (387f1745).
3. VM assert holds rt to the --ci verify contract; the daemon stays
   strictly asserted via launchctl (harness).

Also fixed on ida's morning flag: chat/console CI npm auth (NPM_READ_TOKEN
secret + npmrc step, the bundle-apps pattern), and app-kit's probe now
repoints its vendor refs at freshly packed tarballs (version bumps stop
breaking it).

## Still open for the morning

- deck + board real dispatches (Matt's eyeball gate).
- Walkthrough result (or its failure log) — see the session report.
- console manifest port 11001 vs server code 11011 drift (unfixed, noted).
- `lib/setup/steps/deck.ts`: list is hardcoded but now covers all four
  apps (verified tonight); the no-author-gate concern stands.
- release.yml still grandfathered from actionlint (style findings only).
- Local dev marketplace working copy now DIVERGES from the generator
  source (rt's marketplace/ is canonical for chat plugin); Matt should
  rule on where chat-plugin edits happen from now on.

## Close-out 2026-09-01: v2.8.0 shipped

The bundle night's tag #1 is out. deck 1.0.1 + board 0.1.3 dispatched real
and merged in the morning; the publish then wedged SIX times before landing.
Root cause, exposed only by a verbose bounded `swift package resolve` step:
SPM's own download of Sparkle's binary-artifact zip hangs indefinitely on
GitHub macOS runners (git resolution took seconds; curl fetches the same
zip in 2s). Fix: Sparkle vendored through deps.lock (`sparkle-xcframework`
row) as a local `.binaryTarget`, zero SPM network left in the build (rt
9739e6f2). Release object verified (dmg/zip/appcast/SHA256SUMS, curated
notes as body), rt.cool redeployed, mattstack.dev live with the download
button resolving the release dmg. The Sparkle update leg (the walkthrough's
one designed skip) is now provable against a real appcast on the next tag.
The mattstack-release skill was rewritten the same day: release.yml and
deps.lock are the record; the skill carries by-hand deltas and footguns
only.
