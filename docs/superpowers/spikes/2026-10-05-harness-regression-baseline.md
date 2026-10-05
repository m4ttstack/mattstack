# Harness regression baseline — 2026-10-05

**Status: current automated suites GREEN; B0 admission still BLOCKED.** The inventory and added characterizations are complete. The final root run passed 14,400 tests, the compiled selection passed 42, and all 12 static tasks passed. Historical deadline-only failures still lack complete causal disposition, so production extraction remains blocked under the approved B0 rule. Test inventory is not a GREEN result. This records B0 in the [baseline plan](../plans/2026-10-05-harness-integrations-0-regression-baseline.md).

## Reference

- Worktree: `harness-integrations`, starting commit `10d4cdc366b54a35b7af487a77a16dfaff2372fb`.
- Production merge-base: `bbd55bae1e41699047b2b7114ad0962810de4214`.
- `git diff --name-only <base> <start>` contains only planning/spike documents and `scripts/probes/harness/`. Existing production code/tests are unchanged. This is source provenance, not proof that any failure predates the branch.
- Bun 1.4.2; root command `bun run test`, started 2026-10-05T17:47:41Z. Full run metadata/log: `.harness-spike/baseline-01/root-tests.{json,log}`. Repository preload/isolation unchanged; no manual HOME override.
- Earlier spike root run: 14,356 pass, 13 fail, 5 errors, 3 skip. No established base/control comparison; it is not a green baseline.

## Coverage inventory

Read-only audits inspected assertion bodies. Paths below are relative to the repo. This table records the initial inventory; completed native follow-ups appear in the Actual Claude reference section below. Unless marked otherwise, these listed suites use controlled native transports/launchers; real files/SQLite do not establish native model execution. Exact task ownership remains in the parent's A01–A28 mapping.

| Audit / tasks | Existing test protection | Evidence and remaining gap |
| --- | --- | --- |
| A01 / F2,F5,F6 | `lib/__tests__/agent-argv.test.ts`; `lib/daemon/__tests__/agent-handlers.test.ts`; `e2e/tests/agent.test.ts` | Argv, account, resume session/pane, private prompt; changed-default resume characterization now added and green. Native launch faked. |
| A02 / F4,M6,S4 | agent argv/handlers; `lib/mcp/__tests__/whoami-tool.test.ts` | Generated identity, env validation, 0600/0700 modes and add-dir ordering; native enforcement remains separate. |
| A03 / F4,H1,H2 | `lib/mcp/__tests__/herd-tools.test.ts`; `lib/daemon/__tests__/gate-owner-router.test.ts`; `e2e/tests/gate-answer.test.ts` | Shepherd mutation and gate-answer authority; worker-report session fencing is NEW H1 behavior. |
| A04 / H1,H2 | daemon `herd-handlers.test.ts`, `herd-store.test.ts`; `e2e/tests/herd.test.ts` | Spawn persistence/failure/respawn with fresh worker identity. H1 corrected to preserve predecessor DM separation. |
| A05 / H3 | daemon `agent-status-poller`, `herd-watchdog-adapters`, `herd-watchdog`, `herd-lifecycle` tests | Poll failure/backoff, spawning exemption, exit cleanup, duplicate suppression. Current adapter maps unreachable to gone and unknown Claude status to idle; normalized unknown is a deliberate change. |
| A06 / F5,H3 | daemon watchdog, inject, trust-accept, relocation-announce tests | Background footer vs transcript, caps, matching trust screen, draft restoration; native screen fixtures only. |
| A07 / F3,F4,F5 | `lib/__tests__/claude-registry.test.ts`, `chat-session.test.ts`; agents store/chat handlers | Stale bindings, UUID/traversal/duplicate checks; reused pane gets fresh identity. Profile-qualified IDs and generations are new. |
| A08 / F3,M3 | daemon chat handlers/delivery/identity incident; state identity incident; chat SessionStart/End shell suites | Continuation/rooms, anti-takeover, recycled names, failed welcome cursor. Native resume now proven below; compaction retains the F3/M3 task gate. |
| A09 / M1–M3 | daemon `inbox.test.ts`, `chat-delivery.test.ts`, `inject.test.ts`; `e2e/tests/chat-inbox-delivery.test.ts` | Exact frames, serialization, retry, batching, cursors, wake filtering; ordinary delivery registry-state and sweep saturation/reset cases now green. |
| A10 / F6,S6 | daemon pane handlers/inject; agent E2E | Presence, foreground fallback, quoting, timeout no-work, abort. Current discovery intentionally Claude-only. |
| A11 / M4,M5,S5 | daemon gate ask/store/e2e/push/escape/answer-executor; compiled gate ask/answer/herd E2E | First answer wins, answer-before-wait, store reopen, notification-before-Escape, stale pane/refusal, single-flight relaunch. Native form and external answer now proven below; rendered Board flows retain the S5 gate. |
| A12 / M6 | `lib/__tests__/gate-fork-hook.test.ts`; daemon fork-check/router; compiled fork-check E2E | Ownership/session/pane guards. Native hook currently allows missing/nonzero/malformed rt; do not call that fail-closed. |
| A13 / F4,H4 | `lib/runs/__tests__/{resolve-db,identity,attention,liveness,write}.test.ts`; runs E2E | Session matches/ambiguity, timestamps and liveness. Current explicit RT_RUN_DB bypass/newest-cwd selection are baseline behavior; replacement authority is new. |
| A14 / M6,H4 | `plugins/mattstack/hooks/tests/test-pipeline-gate-stop.sh`; `plugins/mattstack/tests/test-gate-stop-hook.sh` | Real shell/stub rt: running/repeated Stop blocks; fresh held/waiting and missing/bad rt allow. Native Stop/hold/wait and nine-block escape now proven below. |
| A15 / H5 | `lib/mcp/__tests__/ci-tools.test.ts` | Session ownership, foreign heartbeat/release refusal, TTL, lease loss and read-only board lookup. Attempt fencing is new. |
| A16 / M6,S1 | MCP temp-root guard/herd tools; daemon upload guard | Real files: traversal, foreign root, symlink/hardlink/FIFO, UID/signature/size, zero calls on refusal. Native grants separate. |
| A17 / S1,S2,S11 | `lib/skills/__tests__/` sources/installed-plugins/compile/expand/native compile; commands skills compile/check | Real temporary compiler orchestration and fake inventory; discovery-to-output characterization now green. |
| A18 / S1,S12 | lib skills init/sync/link/materialize/writing-style; corresponding commands tests | Temp filesystem/git and injected Claude runner, exact audit argv/readonly/stdin/errors. No actual native skill audit. |
| A19 / S11,H2 | plugin certify/test-certify; Board skills review/respond; no-board-skills-drift | Artifact/source assertions plus actual native question/wait/delegation/model/account evidence below. Native child effort is not configurable. Paid `desc-test.ts` excluded from offline tests. |
| A20 / S3,S4,S9 | setup steps-c/validators/tools-install/apply/finish-gate/contract | Fake probes/child/tray results pin install/retry/state; native auth and artifact execution separate. |
| A21 / M6,S4 | setup linear-mcp/base-permissions/steps-c | Preserve unrelated config/order/defaults/symlinks and reject collisions; external connection faked. |
| A22 / S3,S10,S9 | setup update/update-safe/uninstall/skills-materialize/steps-c | Ownership removal/retry and choices; explicit apply re-enables trusted Mattstack, while update preserves disabled trusted/team packs. Joined update/plugin-uninstall characterization now green; restore/native lifecycle separate. |
| A23 / S5 | Board agent/review-launch/herdr/skill-path/gates-resume/status suites | Fake launcher plus temporary stores/executable; account/model/effort/resume/dedup. Native review/respond/doctor not established. |
| A24 / F6,S6 | Chat server panes/chat/inbox + PanePicker; Herdr-chat Rust tests | Mock rt routes and fake Rust runners pin argv/identity/jump/delivery. No real pane/invite. |
| A25 / S7 | gitq board-herdr/job-state/gitq-status/install-skills | Command quoting, launch/dedup, real state/status/install; joined action→launch→report characterization now green with mocked native launch. |
| A26 / S3,S6,S8 | Console agent-models/panes; tray MattstackCoreChecks | Routes and Swift model/runner tests; native process discovery/rendered defaults separate. |
| A27 / H6 | worktree claude-hook; command worktree-hook; daemon/compiled relocation | Provision/fallback/refusal/removal and trust ownership; native lifecycle/caller-bound disposal new. |
| A28 / S9 | release preflight/apps/verify; VM helper tests | Local policies/helper checks only; actual distributed three-profile lifecycle remains S9 acceptance. |

## Run ledger

[Committed command metadata and hashes](2026-10-05-harness-regression-baseline-evidence.json)
identify the runs. Raw logs remain under `.harness-spike/baseline-01/` and
`.harness-spike/baseline-02/` in this worktree and are not committed. Run metadata records each starting HEAD; pre-commit runs can include the
subsequently committed changes identified in the prerequisite sections. A
starting HEAD is not a claim that uncommitted new cases existed at that revision.


| Command | Result | Evidence |
| --- | --- | --- |
| Root `bun run test` | FAIL: 14,366 pass, 7 fail, 3 skip; 1,423 seconds | `root-tests.{json,log}`; worktree timeout, five flavor takeover assertions and legacy Logdy cleanup |
| Four changed root test files | GREEN: 325 pass, 0 fail | `characterization-root-02.{json,log}`; includes 13 new cases after fixture type corrections |
| Focused Gitq (five files) | GREEN: 30 pass, 0 fail | `gitq.{json,log}`; includes new route/status composition |
| Full Gitq under static gate | GREEN: 528 unit + 431 integration pass; 22 live tests skipped | `static-check-03.log`; skipped live forge scenarios are not acceptance evidence |
| Original failing root files, selected together | GREEN in isolated selection: 36 pass, 0 fail | `root-failures-isolated.{json,log}`; does NOT clear the full-suite failures |
| Board | GREEN: 3,069 pass, 0 fail | `board.{json,log}` |
| Chat | GREEN: 375 pass | `chat.{json,log}` |
| Console | GREEN: 1,581 pass | `console.{json,log}` |
| Herdr-chat Rust | GREEN: 177 pass | `rust.{json,log}`; locked, offline dependencies |
| Mattstack/chat shell hooks and skill checks | GREEN | `hooks-skills.{json,log}`; five hook scripts, certify/digraph cases, strict check, dry compile, Board drift and 52 certified directories |
| Compiled CLI/daemon selected E2E | GREEN: 42 pass, 0 fail | `cli-e2e.{json,log}`; 10 files, real isolated daemon and fake native endpoints |
| Swift checks | GREEN: 660 pass, 0 fail | `swift-02.{json,log}`; initial missing Sparkle artifact hydrated from main checkout after identical pinned record/version check |
| Static gate | FAIL at format only; typechecks and preceding gates passed | `static-check-03.{json,log}`; 44 warnings solely in ignored `.harness-spike/` artifacts; initial test-only type errors corrected |
| Noncanonical Bun formatting diagnostic | 184 warnings; not canonical source-format failures | `format-source-02.{json,log}` ran Prettier under Bun; follow-up proved runtime-specific builtin import ordering. Canonical Node cached and uncached checks pass after excluding only ignored evidence. |
| Diagram and MCP artifacts | GREEN | `skill-artifacts.{json,log}`; 35 diagrams across 26 documents, zero warnings; generated MCP reference byte-identical |
| Current native Claude workflow reference | GREEN for listed reference scenarios | Actual Claude 2.1.289, normal authenticated HOME; detailed scenarios below. Earlier synthetic F1 Codex probes are separate. |
| Second root run | FAIL: 14,370 pass, 18 fail, 5 errors, 3 skip | `root-tests-02.{json,log}`; individual disposition below |
| Third root run | FAIL: 14,392 pass, 5 fail, 3 errors, 3 skip | `root-tests-03.{json,log}`; preload and worktree follow-up below |
| Fourth root attempt | Interrupted partial FAIL; not a completed baseline | `root-tests-04.{json,log}`; native Git timing and concurrent-suite evidence below |
| Final root run | GREEN: 14,400 pass, 0 fail, 3 skip | `root-tests-05.{json,log}`; all 24 historically failed cases pass |
| Final compiled CLI/daemon selection | GREEN: 42 pass, 0 fail | `cli-e2e-final.{json,log}`; fresh build of the prerequisite fixes |
| Final static gate | GREEN: 12 successful tasks of 12; 7 cached | `static-check-final.{json,log}`; canonical formatter passes |
| Distributed three-profile lifecycle | NOT RUN | Required S9; never run destructive cases against shared services |

## Added characterization coverage

All 14 new cases pass against unchanged production code. Existing suites remain intact:

- `lib/daemon/__tests__/agent-handlers.test.ts`: four launch/resume cases retain provider/account/model/effort/extraArgs and explicit yolo false/true after defaults change, on Herdr/headless surfaces. Native trust transport is explicitly fake; no keys, and no Herdr calls for headless.
- `lib/daemon/__tests__/chat-delivery.test.ts`: four ordinary-inbox registry states (idle/busy/shell/unknown), zero pane calls, exact recipient/frame/cursor; sweep saturation at 120 skipped ticks still recovers, and newer messages reset failure/backoff while retaining unread backlog.
- `lib/skills/__tests__/no-claude-discovery-compile.test.ts`: malformed inventory followed by successful actual discovery/compile/check, selected installed engine resource execution and current source-pack policy retention. The Claude executable is fake.
- `lib/setup/__tests__/steps-c.test.ts`: enabled/disabled team variants across actual update orchestration, repeated update and plugin-only owned uninstall; unrelated configuration and pre-existing pack ownership preserved.
- `apps/gitq/tests/no-agent-action-lifecycle.test.ts` and child fixture: actual action route, generated state/status command handoff and status CLI; identity retained through starting/working/done, live dedup and failed launch. Native launch/discovery/assets/config are mocked inside a separate child process.

The same reviewer approved the plan and then reviewed test code. One Important
finding (missing explicit Herdr fake) was fixed before execution; rereview:
Approved. This is not native acceptance evidence. Follow-up command environments
also direct Herdr socket/executable fallback to nonexistent owned paths. Initial
root run used the existing preload unchanged; its rt socket guard does not itself
block ambient Herdr fallback, an additional test-isolation limitation to retain.

## Compatibility decisions requiring explicit treatment

Current behavior is not identical to every desired future protection. Preserve fresh worker identities on replacement, existing frozen output, current apply/update and trusted-plugin/team-choice distinction, native fail-open escapes and held/waiting behavior. Profile/attempt fences, newest-run refusal, normalized unknown and shared-readiness withdrawal are explicit new contracts with separate tests. The baseline must expose these transitions rather than silently rewriting assertions during extraction.

## Initial failure diagnosis

The first root command remains a retained **FAIL**. Its six path failures led
to prerequisite `e1eb61336`: valid HOME leaked from the reconciler fixture, while
module-load RT_DIR/TRAY_SOCK_PATH disagreed with call-time paths. The no-service
`home-split.{json,log}` diagnostic confirmed divergent paths and an untouched
legacy file. The separate create-case timeout passed in the next full run;
its interrupted Git stage was not captured. These observations do not imply a
green baseline.

The first static command failed on 44 ignored spike artifacts. Excluding only
`/.harness-spike/` fixed the canonical cached and uncached Node checks. The
retained 184-warning follow-up explicitly ran Prettier under Bun, changing the
sort-imports plugin's builtin classification; it was not a canonical source
format failure. No tracked source was reformatted to hide it.

No production-base/control full execution was performed. Source equality alone
is not used to declare a failure pre-existing. Subsequent deterministic controls,
separately reviewed fixes and full-run results appear below. The initially missing
native workflows now have the actual-Claude evidence below; distribution-only
S9 acceptance remains pending and blocks full-support/release claims.

## B0 prerequisite fixes — e1eb61336

The existing reviewer read the seven-file diff and returned **Approved**, with
no findings. This review covers the prerequisite fixes, not B0 admission.

- Reconciler and worktree-create fixtures now close their database and restore
  their incoming HOME. An external HOME-restoration assertion failed before
  each fix and passed afterward (18 reconciler and 13 create cases).
- Flavor takeover now resolves one tray socket at call time for health,
  retirement and shutdown polling. A real temporary Unix-socket regression
  with `RT_APP_SOCKET` failed before the change and passed afterward.
- Legacy Logdy cleanup follows current HOME, matching config creation. A
  regression that changes HOME after import failed before and passed after.
- The combined reconciler/flavor/Logdy run passed 43 tests, 131 assertions.
- The formatter correction is described above.

The next canonical root run (`root-tests-02`) is retained separately. Its
original create case passed at 1,196ms; several adjacent unchanged disposal
fixtures then timed out during heavy shared disk activity. Read-only
diagnostics measured 10,000–15,000 disk transfers/sec and 7–12x longer Git
fixture times. No test deadline or assertion was changed. A quieter complete
verification is required; this diagnosis does not turn that run green.


## Follow-up prerequisites — 2ca753783

A separate reviewer approved the five-file correction. The final combined run
passed **204 tests, 600 assertions**, with zero failures
(`baseline-01/prerequisite-final.{json,log}`).

- Flavor takeover's fake server now binds the same explicit, short socket that
  the command uses, even when a prior import happened under another HOME.
- The liveness PATH fixture temporarily removes and then restores `HERDR_BIN`;
  the suite's native-execution guard can no longer override its fake executable.
  An import-before-HOME-change diagnostic reproduced six failures before these
  fixture changes; afterward all 29 cases passed. No deadlines changed.
- The OAuth rejection test installs its catch before making the real callback
  request. A delayed-response probe failed before and passed after this change;
  all 42 OAuth cases passed. Production OAuth code is unchanged.
- Actual native herd execution exposed a production race: a fast worker's report
  persisted `lastReport`, but spawn completion overwrote its `done` status with
  `spawning`. The handler now attaches launch metadata to the still-owned job
  without reverting its status, including across the later chat awaits. An early
  disposable report also closes its pane once that pane becomes known. Nine
  regressions failed before and passed after; the broader focused selection
  passed 511 tests. Replacement identities and frozen output stay intact.

The complete second root run remains **FAIL: 14,370 pass, 18 fail, 5 errors,
3 skip**, over 879 files (`root-tests-02`). Its five flavor failures, PATH
fixture failure and OAuth rejection are addressed above. Ten failures are explicit timeouts in unchanged Git/worktree or subprocess
fixtures, coincident with measured shared host I/O contention; the measurement
does not prove each timeout's root cause. One additional non-timeout assertion
is unresolved. Timed-out asynchronous work demonstrably spilled into following
cases, but that alone does not establish the additional assertion's cause. A fresh complete run must pass before admission. No known failure has
been waived, no assertion weakened and no timeout increased.

## Actual Claude reference

These are owned live workflows, using `/Users/matt` and existing authentication,
Claude **2.1.289**, Mattstack plugin **0.30.18**, Sonnet with parent effort `low`,
and normal permissions (`yolo: false`). The shared daemon reports source
`9612dc825d9e01e138b9311498195da2726974c9`; per-file source hashes as captured **before `2ca753783`** are retained in
`baseline-02/native-source-comparison.json`. Relevant delivery/gate/launch paths
matched that capture, except the chat handler's typed-refusal additions; this
reference covers its successful delivery path. The native herd race was observed
on that daemon; branch-specific correction evidence is recorded separately.
The installed pipeline Stop hook is byte-identical to the worktree version.

| Scenario | Observed result | Local evidence in `baseline-02/` |
| --- | --- | --- |
| Fresh and resumed managed Claude | Same session and chat identity after resume; retained nonce, account `1`, Sonnet, low parent effort and `yolo: false` | `native-managed-start.json`, `native-managed-resume.json`, `native-resumed-ready-02.json` |
| Ordinary idle delivery | Model consumed unique DM nonce and acknowledged it | `native-idle-dm-02.json`, `native-idle-result.json` |
| Busy delivery | Registry sampled busy during a foreground command; model consumed the queued nonce afterward | `native-busy-registry.json`, `native-busy-result.json` |
| Native question, blocked delivery and external answer | Real form open; DM queued; external registry answer dismissed the form; model consumed answer and nonce | `native-blocked-screen.json`, `native-blocked-dm.json`, `native-gate-result.json` |
| Registry consumption | Both owned gates answered, delivery confirmed and non-null consumption timestamps; reading the list alone did not consume the first gate | `native-gate-consumed.json` |
| Stop and hold | Two actual Stop refusals while running, then holding the run allowed the turn to end | `native-stop-result.json` |
| Background waiting | Fresh waiting marker and actual background wait permitted the turn to end; external answer resumed the model and was re-read/consumed | `native-wait-armed.json`, `native-wait-result.json` |
| Native Stop escape cap | Nine consecutive hook blocks, then Claude forcibly ended the turn | `native-cap-valid-result.json`, `native-cap-hook-events.json` |
| Worker question enforcement | A launch-injected PreToolUse hook refused one bare native question; no bypass/retry | `native-fork-result.json` |
| Actual skill delegation | Mattstack review skill loaded; explicit Sonnet child read the owned fixture documents and returned Approved | `native-delegation-progress.json`, `native-delegation-invocation.json` |
| Shepherd/worker reporting before correction | Actual worker report reached the shepherd, but final stored job incorrectly remained spawning | `native-herd-progress.json`, `native-herd-status-02.json` |

The Stop cap is version-specific: the observed **nine** differs from the hook
comment's eight. The first cap attempt was inconclusive because of a slow global
run scan and a repeated gate push; it remains retained and is not counted as a
pass. The clean repeat narrowed only `RT_RUNS_ROOT` to an owned fixture while
retaining normal HOME/auth and the installed hook. Its first incorrectly located
fixture was abandoned before the corrected probe. Hook fail-open behavior remains
part of the baseline; this is not a claim of unconditional enforcement.

The native Agent tool has no child effort parameter. The retained Agent invocation requested `sonnet`, its matching launch result
resolved `claude-sonnet-5-5`, and its matched child completion records three tool
uses in 6,699ms (`native-delegation-invocation.json`, with transcript hash).
Explicit child model selection was verified; enforcement of `low` on that child was not. Resume is
proven; transcript compaction, native audits of arbitrary third-party skills,
Board's full rendered flows and distributed lifecycle remain their separately
mapped acceptance scenarios. Native fixture evidence does not establish those.


### Corrected native herd result

`baseline-02/native-herd-isolated-e9930f89a52d/native-result.json` records the
corrected worktree handler (`2ca753783`, SHA256
`9476ea7d2739697f4bb41f8e0ef5f43887027d3787243f92220d1f026390ac3c`).
A private test daemon launched two real Claude workers through the normal Herdr
server. A shell probe established worker `HOME=/Users/matt` with no profile
override; only the daemon's state was isolated. No shared daemon was restarted.
The report arrived **2,462.55ms before spawn returned**. The stored job remained
`done`, with the matching report, agent and session, and the real shepherd
printed the exact incoming nonce. This exercises the native race window, beyond
the nine deterministic controlled regressions.

The first harness attempt stopped before daemon/Claude launch because `pane run`
returns empty stdout. The second captured the correct native result but its
receipt comparator expected no space after a colon. Independent verification
normalized only that separator whitespace, required an actual assistant output
line and exact nonce, and captured final state before interrupting the stale
waiter. That process's exit 130 is not presented as a successful test exit;
`native-result.json` and the captured daemon state are the success evidence.
Both attempts' logs remain retained.

Cleanup verified both private workspaces closed, the private daemon exited, its
socket disappeared and its registry symlink was removed. Earlier shared probes
were also scoped down: both synthetic runs abandoned, the herd wrapped, its room
archived, five sessions signed out and both owned workspaces removed. Answered,
consumed gates and all historical run/chat evidence remain; no active probe is
left. See `native-cleanup-{before,actions,after,residuals}.json` and the private
run's `cleanup-verification.json`.

### Exact hook commands and remaining task gates

The recorded shell-hook run executed:

```sh
bash plugins/mattstack/hooks/tests/test-pipeline-gate-stop.sh
sh plugins/mattstack/tests/test-gate-stop-hook.sh
sh plugins/mattstack/tests/test-relocation-hook.sh
bash marketplace/plugins/chat/hooks/tests/test-session-start.sh
bash marketplace/plugins/chat/hooks/tests/test-session-end.sh
```

Fork-hook coverage runs through `bun test lib/__tests__/gate-fork-hook.test.ts`
inside the root suite, plus `e2e/tests/gate-fork-check-cli.test.ts` in the selected
compiled suite. The live bare-question refusal is separate native evidence.

These unproven scenarios retain explicit task gates; they cannot be inferred from
a passing baseline or quietly treated as acceptance of those later tasks:

| Boundary / tasks | Existing executable before/after suite | Additional evidence before changing / accepting that boundary |
| --- | --- | --- |
| Compaction continuity — F3/M3 (A08) | `bun run test` includes registry, chat session, identity and delivery suites; the two SessionStart/End shell commands above | Native compaction must retain identity, rooms and delivery, in addition to the resume reference already captured |
| Native skill audit — S1/S12 (A18) | `bun run test` includes skills discovery/compiler, init/sync/link/audit/writing-style suites; `bun cli.ts skills check --pack-dir plugins/mattstack --strict` | Run an owned native audit through the selected integration; compiler/certification or the review-skill child is not a substitute |
| Rendered Board review/respond/doctor — S5 (A23) | `bun run --cwd apps/board test`, then `bun run check` | Exercise actual rendered launch, gate answer and resumed workflow on an owned fixture; server mocks alone do not clear S5 |
| Distributed lifecycle — S9 (A28), with S3/S4/S10 acceptance | `bun run test`, `swift run --package-path rt-tray mattstack-checks`, then the S9 manifest in plan 4 | Claude-only, Codex-only and mixed install/update/restore/uninstall profiles in the disposable acceptance environment; no shared-service destructive tests |

All other A01–A28 before/after commands are the complete root command plus the
app/plugin/compiled/Swift commands named by surface in B0.2 and the inventory
above. Run the mapped unchanged suites before each task, separately add red
new-contract tests, and run both afterward. Broad integration suites repeat at
phase boundaries. The task gates above are additional to those compatibility
checks, not waivers.


### Exact second-root-run failure disposition

`R2` line numbers refer to `baseline-01/root-tests-02.log`. Prior successful
runs establish prior success only. The ten timeout cases and the drifted-tree
assertion use sources byte-identical across the production base and both B0
prerequisite commits. That equality does not prove failure provenance.

| # | Exact test (within file) | R2 outcome / log lines | Disposition before final full rerun |
| --- | --- | --- | --- |
| 1 | `lib/worktree/__tests__/dispose.test.ts`: declared generated file with a substantive edit is a blocker | 5011.68ms; beforeEach clone/remote/fetch timeout; 3055–3071 | Setup failed before body; previous full run 428.05ms; cause not individually proven |
| 2 | Same: undeclared modified file is a blocker even when whitespace-only | 5005.02ms; beforeEach worktree creation timeout; 3072–3087 | Setup failed before body; previous 480.98ms; cause not individually proven |
| 3 | Same: commits made after the merged MR's head are not covered — the anchor refuses | 7174.10ms; test timeout; 3101–3103 | Previous 1119.20ms; intended assertion never logged |
| 4 | Same: a rebased-and-merged HEAD never lets dispose delete a branch holding a commit the MR lacks | 6247.17ms; test timeout; 3109–3134 | Previous 1540.04ms; late error E1 at line 574 received dirty, expected unpushed |
| 5 | `lib/daemon/__tests__/worktree-handlers.test.ts`: local branches report existing-clean, behind, or diverged and are never reconciled | 5010.30ms; test timeout; 10089–10108 | Previous 2820.24ms; late E2 at line 339 dereferenced missing plain.data |
| 6 | Same: a failure after the claim rolls the tree back to on-deck | 5021.55ms; test timeout; 10092–10126 | Previous 784.76ms; late E3 at line 364 received disposable, expected on-deck |
| 7 | Same: a tree that has already left its on-deck branch flips disposable on failure | **1524.53ms; not a timeout**; line 402 error-prefix assertion false; 10128–10141 | **Unresolved:** actual res.error not logged. Previous 702.54ms. Prior bodies continued across HOME/DB replacement, but interference is only a candidate cause |
| 8 | Same, hydration: no golden: cold-creates as before, with no hydratedFrom | 5021.59ms; timeout; 10154–10173 | Previous 1450.78ms; late E4 at line 672 received res.ok false |
| 9 | Same, hydration: a hydrate failure still returns a usable tree, via cold create | 5016.78ms; timeout; 10175–10194 | Previous 1874.44ms; late E5 at line 687 received res.ok false |
| 10 | `lib/runs/__tests__/liveness.test.ts`: probeAgents runs the herdr found on the live PATH, not the PATH the process started with | 0.32ms; wrong executable; 12185–12198 | Independently reproduced HERDR_BIN precedence; fixed in 2ca753783 |
| 11 | `commands/__tests__/flavor-takeover.test.ts`: dev over a running prod app | 365.06ms; fallback instead of retire; 13434–13453 | Independently reproduced stale fake socket; fixed in 2ca753783 |
| 12 | Same: prod over a running dev app | 430.62ms; wrong fallback; 13455–13475 | Same reproduced and fixed socket defect |
| 13 | Same: a failed retire boots the other daemon out directly | 380.84ms; fake endpoint not reached; 13478–13491 | Same reproduced and fixed socket defect |
| 14 | Same: a retire that takes longer than a quick request is waited for, not booted out from under | 370.52ms; retired null; 13492–13505 | Same socket defect, not a slow-retire timeout; fixed |
| 15 | Same: --json reports what was done | 303.65ms; retired null; 13513–13541 | Same reproduced and fixed socket defect |
| 16 | `commands/__tests__/setup-connect.test.ts`: a mismatched state rejects instead of resolving with the code | 3.57ms; unobserved expected rejection; 13894–13903 | Delayed-response diagnostic red then green; early rejection observation fixed in 2ca753783 |
| 17 | `scripts/__tests__/release-marketplace.test.ts`: an in-tree plugin publishes tracked files only, never untracked, ignored, .git or .worktrees | 5016.96ms; timeout, killed child exit −1; 17070–17085 | Previous 1167.13ms; timeout interrupted child |
| 18 | `scripts/__tests__/no-repo-purity-scoped.test.ts`: the built-in plugins/mattstack entry bans each of the pack's three terms | 5016.01ms; fixture git commit timeout; 17196–17209 | Previous 922.37ms; body assertions not reached |

This accounts for all **18 failures and five separately counted errors**. E1–E5
are the late continuations identified in rows 4–6 and 8–9, not five new test
cases. The earlier `root-failures-isolated` run covered flavor, Logdy and create;
it provides no focused evidence for rows 1–9, 17 or 18. The final full run and
any controlled follow-up must be recorded separately; no row is silently cleared.


### Third complete root run and follow-up

`root-tests-03` ran at `2ca753783` with no concurrent owned native tests:
**14,392 pass, five fail, three errors, three skip**, 879 files, 1,266.9s.
The prior socket, liveness, OAuth and herd regressions passed. Four worktree
handler tests timed out: refreshing a hydrated tree's default ref, cold creation
without a golden, hydrate-failure fallback, and freshen. Three later errors came
from the timed-out hydration bodies. This run also exposed one remaining frozen
preload path: the prod takeover left the current HOME's dev preload in place.
It remains a retained failed run, not replaced by focused results.

The preload path in `commands/settings.ts` was captured at import time while
binary installation used current HOME. Three independent HOME-switch regressions
pin wrapper rendering, preload creation and removal. Alongside the existing
flavor assertion they produced four deterministic failures; the call-time path
fix passed 41 focused cases and review. The config-store fixture also now removes
only its own HOME rather than deleting artifacts at an earlier importing HOME.
The separately reviewed correction and fixture lifetime fix are committed as
`ec8a48d42`. The final preload/store rerun passed 21 tests, 48 assertions; the
worktree handler file passed 63 tests, 241 assertions, and typecheck passed.
The complete rerun is still required for admission.

The controlled worktree diagnostic paused an old provision in identity lookup,
changed HOME/database to the next fixture, and released the old work. The old
handler selected the new fixture's tree and made it disposable; the new handler
then returned `create-failed`, reproducing the error-prefix mismatch in R2 row 7.
Draining before the HOME switch retained the expected `checkout-failed` outcomes
and correct registry states. This proves a concrete corruption mechanism and
reproduces the observed assertion; R2 did not capture its actual returned error,
so it is not retrospective proof of that exact scheduling sequence.

The fixture-lifetime control preserves the original deliberate timeout as a
failure while making the subsequent fixture pass. Its hook-timeout variant also
shows the next beforeEach awaiting the same cleanup before changing HOME/DB.
This is protection against the demonstrated within-file race; it does not claim
cross-file isolation if work stalls indefinitely and Bun advances past multiple
failed hooks. No deadline is increased, and ordinary test rejections still reach
Bun. Separate Git timing evidence is used to investigate the initial timeout,
which fixture drainage alone does not cure.


The isolated Git timing run used native Trace2 (no executable wrapper), recorded
1,449 completed Git calls and found the slowest fetch at 193ms. No inherited
XDG/Git configuration overrides were present in that run. Thirteen nested
upload-pack traces lacked exit events while their parents completed; these are
not reported as hanging processes. The measurements establish this isolated
run's timing, not the earlier full run's cause. The fourth full run therefore
retains native Git timestamps and safe HOME/config-path fields for diagnosis;
test assertions, deadlines and production commands remain unchanged.


### Fourth attempt: traced setup latency and concurrent full suites

The fourth attempt was interrupted after its initial failures, at 520.52s, with
exit -2. It is a **partial failed diagnostic**, not a completed baseline. A
second full root suite in the separate `radagast` worktree started at 20:18:45Z
and overlapped this attempt from its 20:23:29Z start. Process IDs, start times,
commands and working directories are retained in
`baseline-02/root04-concurrent-suite.json`. Only the owned `huan` test process
was stopped. Separate worktrees do not isolate CPU or disk load.

The first traced failure was an asynchronous hydration **beforeEach**, before
hydration or clone execution. Nine successful Git commands consumed 2,486ms
inside a 3,652ms native-command span; clone, fetch and push took 415ms, 725ms
and 930ms. The previous fixture's 19 Git calls consumed 522ms over 1,061ms.
Setup exhausted the hook's five-second budget through cumulative preparation
latency, not a stalled hydration clone. The trace then shows the old repository
executing under the next fixture's HOME, proving setup-continuation spillover.
See `root04-hydrate-timeout-analysis.json`. Concurrent disk-heavy suites are an
observed contaminant; the trace does not attribute every OS/process delay to one
specific competing process.

The hydration fixture correction (then pending review) retains ownership of both its async
setup and its test body until settlement, then restores HOME/database state.
A next setup queues behind that cleanup before touching globals, even if the
previous hook timed out. Assertions and deadlines remain unchanged. This change
has now passed its controlled timeout verification and 77 normal focused tests
(289 assertions), with a successful typecheck. Independent review was
pending at that point; its approval is recorded in the fifth-run section below.
F2 remains blocked by the separate admission decision.

The actual-file control deliberately holds the first setup beyond the unchanged
five-second hook deadline. Before the fix, setup resumes under the next HOME and
the following test fails. With the fix, setup retains its HOME and the following
test passes. Both child processes still exit 1 for the intentional timeout; the
control driver validates that failure is retained. Evidence is
`baseline-02/hydrate-setup-control.json` and `hydrate-setup-02-{red,green}` logs
and metadata. The earlier long-sleep attempt did not observe setup resumption
before child exit and remains inconclusive; it is not counted as a passing
control.

The built-in reviewer service hit its usage limit. A read-only native Claude
review was proposed, but automatic approval review rejected sending the source,
diff and baseline evidence to that external service without specific approval.
The user subsequently approved that transfer. The read-only native Claude reviewer
found no code defect in the demonstrated setup path, but requested a controlled
test-body timeout case before approval. That follow-up was pending at this point
and is completed in the fifth-run section below. The code reviewer did not
assess B0 admission.


### Fifth complete root run and review follow-up

The final root command completed at 21:11:02Z: **14,400 passed, zero failed,
three skipped**, 879 files, 40,254 assertions and four snapshots, in 1,224.21s.
It ran at `ec8a48d42` plus the hydration-fixture guard later committed as
`af1c9ecd0`, whose file hash
is in the evidence manifest. All 24 distinct cases that failed in the retained
first through fourth attempts passed; `baseline-02/root-failure-comparison.json`
records the individual outcomes and timings. The 24 are unique file/test-name
pairs from the actual execution sections, excluding Bun's repeated end-of-run
failure summaries. Skips remain explicit: live browser
login and two appcast signing checks. Their skipped paths are not proven by this
command.

This was not an uncontended run. Full suites in `elrohir` appeared during it;
the raw 15-second process samples and corrected PID classification are retained.
The original monitor misclassified its own PID when a test temporarily changed
cwd; the correction recognizes that stable PID as owned without removing any
raw observations. The two other observed suite PIDs are real competing runs.
A passing run under that observed load establishes the current command's green
result, not a retrospective cause for every earlier timeout.

The reviewer-requested body-timeout control is now complete. The actual first
test body is paused for at least 5.1 seconds without changing its five-second
deadline. Old code resumes under the following HOME; fixed code retains the
original HOME and the following test passes. Both children still exit 1 for
the deliberate timeout. The stricter setup control likewise requires a pause
before release and an expired hook deadline; it no longer admits a trivial
no-wait control. In that repeat, the next test passed in both variants, while
only the fixed variant retained the paused operation's HOME. This directly
proves fixture ownership, not that every possible overlap always changes the
next test's result. See `hydrate-body-control.json` and
`hydrate-setup-control-03.json` and their named child logs.

The same read-only Claude reviewer approved the follow-up in round two, with no
remaining code issues. It accepted the bounded cleanup behavior and typechecked
wrapper signature; it explicitly did not assess B0 admission. The fix is committed
as `af1c9ecd0`. The final compiled selection passed **42 tests, zero failures,
189 assertions**; the final `bun run check` passed **12 of 12 tasks**, seven
from cache, including the canonical format check. Both commands ran against the
same source bytes as the green root run. Prior deadline-only failures without captured causal evidence
remain explicitly unresolved; neither the green full run nor the fixture
controls silently waive B0's admission rule.


### Current admission decision

**BLOCKED; no exception requested or granted.** The current automated commands
are green and all demonstrated semantic/fixture defects have separate reviewed
fixes. However, R1's create timeout, R2's deadline-only failures, and R3's initial
worktree deadlines lack enough captured evidence to identify each original
trigger. Controlled fixture races explain subsequent corruption, not all initial
deadlines. R4 captures cumulative setup latency and concurrent suites; it does
not retroactively prove R1–R3 had the same cause. This retains the approved B0
rule that a green rerun alone does not erase instability.

The remaining investigation is bounded to the deadline cases identified in
`root-failure-comparison.json` and the disposition table above. Its next useful
full-suite diagnostic requires a coordinated window without competing full
suites, preserving the normal deadlines and capturing native Git timing if a
failure recurs. No other agent's process may be stopped to obtain that window.
Alternatively, an explicit reviewed admission exception would need to name its
allowed extraction scope, rationale, unchanged before/after gates and still-held
boundaries; this report grants none. The named compaction, native skill audit,
rendered Board and S9 distribution gates remain as recorded above.

No integrations implementation, shared-daemon restart, push or merge was
performed by this baseline continuation. Raw native session history remains
local; the report records bounded artifacts and hashes. The same native Claude reviewer approved this document in round two on
2026-10-05. That approval confirms the report and its BLOCKED admission
decision; it does not grant F2 admission. The prerequisite code commit is
`af1c9ecd0`, following the other separately reviewed commits listed above.
