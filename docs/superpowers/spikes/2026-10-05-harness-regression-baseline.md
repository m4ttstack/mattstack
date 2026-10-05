# Harness regression baseline — 2026-10-05

**Status: BASELINE NOT GREEN; production extraction blocked.** The inventory and added characterizations are complete; the admission blockers below remain. Test inventory is not a GREEN result. This records B0 in the [baseline plan](../plans/2026-10-05-harness-integrations-0-regression-baseline.md).

## Reference

- Worktree: `harness-integrations`, starting commit `10d4cdc366b54a35b7af487a77a16dfaff2372fb`.
- Production merge-base: `bbd55bae1e41699047b2b7114ad0962810de4214`.
- `git diff --name-only <base> <start>` contains only planning/spike documents and `scripts/probes/harness/`. Existing production code/tests are unchanged. This is source provenance, not proof that any failure predates the branch.
- Bun 1.4.2; root command `bun run test`, started 2026-10-05T17:47:41Z. Full run metadata/log: `.harness-spike/baseline-01/root-tests.{json,log}`. Repository preload/isolation unchanged; no manual HOME override.
- Earlier spike root run: 14,356 pass, 13 fail, 5 errors, 3 skip. No established base/control comparison; it is not a green baseline.

## Coverage inventory

Read-only audits inspected assertion bodies. Paths below are relative to the repo. Unless marked otherwise, native transports/launchers are controlled fakes; real files/SQLite do not establish native model execution. Exact task ownership remains in the parent's A01–A28 mapping.

| Audit / tasks | Existing test protection | Evidence and remaining gap |
| --- | --- | --- |
| A01 / F2,F5,F6 | `lib/__tests__/agent-argv.test.ts`; `lib/daemon/__tests__/agent-handlers.test.ts`; `e2e/tests/agent.test.ts` | Argv, account, resume session/pane, private prompt; changed-default resume characterization now added and green. Native launch faked. |
| A02 / F4,M6,S4 | agent argv/handlers; `lib/mcp/__tests__/whoami-tool.test.ts` | Generated identity, env validation, 0600/0700 modes and add-dir ordering; native enforcement remains separate. |
| A03 / F4,H1,H2 | `lib/mcp/__tests__/herd-tools.test.ts`; `lib/daemon/__tests__/gate-owner-router.test.ts`; `e2e/tests/gate-answer.test.ts` | Shepherd mutation and gate-answer authority; worker-report session fencing is NEW H1 behavior. |
| A04 / H1,H2 | daemon `herd-handlers.test.ts`, `herd-store.test.ts`; `e2e/tests/herd.test.ts` | Spawn persistence/failure/respawn with fresh worker identity. H1 corrected to preserve predecessor DM separation. |
| A05 / H3 | daemon `agent-status-poller`, `herd-watchdog-adapters`, `herd-watchdog`, `herd-lifecycle` tests | Poll failure/backoff, spawning exemption, exit cleanup, duplicate suppression. Current adapter maps unreachable to gone and unknown Claude status to idle; normalized unknown is a deliberate change. |
| A06 / F5,H3 | daemon watchdog, inject, trust-accept, relocation-announce tests | Background footer vs transcript, caps, matching trust screen, draft restoration; native screen fixtures only. |
| A07 / F3,F4,F5 | `lib/__tests__/claude-registry.test.ts`, `chat-session.test.ts`; agents store/chat handlers | Stale bindings, UUID/traversal/duplicate checks; reused pane gets fresh identity. Profile-qualified IDs and generations are new. |
| A08 / F3,M3 | daemon chat handlers/delivery/identity incident; state identity incident; chat SessionStart/End shell suites | Continuation/rooms, anti-takeover, recycled names, failed welcome cursor. Native hook firing/compaction not established. |
| A09 / M1–M3 | daemon `inbox.test.ts`, `chat-delivery.test.ts`, `inject.test.ts`; `e2e/tests/chat-inbox-delivery.test.ts` | Exact frames, serialization, retry, batching, cursors, wake filtering; ordinary delivery registry-state and sweep saturation/reset cases now green. |
| A10 / F6,S6 | daemon pane handlers/inject; agent E2E | Presence, foreground fallback, quoting, timeout no-work, abort. Current discovery intentionally Claude-only. |
| A11 / M4,M5,S5 | daemon gate ask/store/e2e/push/escape/answer-executor; compiled gate ask/answer/herd E2E | First answer wins, answer-before-wait, store reopen, notification-before-Escape, stale pane/refusal, single-flight relaunch. No actual native form execution. |
| A12 / M6 | `lib/__tests__/gate-fork-hook.test.ts`; daemon fork-check/router; compiled fork-check E2E | Ownership/session/pane guards. Native hook currently allows missing/nonzero/malformed rt; do not call that fail-closed. |
| A13 / F4,H4 | `lib/runs/__tests__/{resolve-db,identity,attention,liveness,write}.test.ts`; runs E2E | Session matches/ambiguity, timestamps and liveness. Current explicit RT_RUN_DB bypass/newest-cwd selection are baseline behavior; replacement authority is new. |
| A14 / M6,H4 | `plugins/mattstack/hooks/tests/test-pipeline-gate-stop.sh`; `plugins/mattstack/tests/test-gate-stop-hook.sh` | Real shell/stub rt: running/repeated Stop blocks; fresh held/waiting and missing/bad rt allow. Native escape cap not proven. |
| A15 / H5 | `lib/mcp/__tests__/ci-tools.test.ts` | Session ownership, foreign heartbeat/release refusal, TTL, lease loss and read-only board lookup. Attempt fencing is new. |
| A16 / M6,S1 | MCP temp-root guard/herd tools; daemon upload guard | Real files: traversal, foreign root, symlink/hardlink/FIFO, UID/signature/size, zero calls on refusal. Native grants separate. |
| A17 / S1,S2,S11 | `lib/skills/__tests__/` sources/installed-plugins/compile/expand/native compile; commands skills compile/check | Real temporary compiler orchestration and fake inventory; discovery-to-output characterization now green. |
| A18 / S1,S12 | lib skills init/sync/link/materialize/writing-style; corresponding commands tests | Temp filesystem/git and injected Claude runner, exact audit argv/readonly/stdin/errors. No actual native skill audit. |
| A19 / S11,H2 | plugin certify/test-certify; Board skills review/respond; no-board-skills-drift | Artifact/source assertions only; actual question/wait/delegation/model/account workflow is GAP. Paid `desc-test.ts` excluded from offline tests. |
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
identify the runs. Raw logs remain under `.harness-spike/baseline-01/` in this
worktree and are not committed. Runs after the initial root baseline include
the test-only changes in this commit; the metadata's reference commit is their
starting HEAD, not a claim the new tests existed at that earlier revision.


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
| Uncached source formatting | FAIL: 184 untouched source files | `format-source-02.{json,log}`; both repository ignore rules retained, only untracked ignored spike evidence additionally excluded; zero changed files among warnings |
| Diagram and MCP artifacts | GREEN | `skill-artifacts.{json,log}`; 35 diagrams across 26 documents, zero warnings; generated MCP reference byte-identical |
| Current native Claude workflow reference | GAP | Need exact scenario/version evidence, distinct from synthetic F1 Codex evidence |
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

## Failure diagnosis and remaining blockers

The original root command remains FAIL. Its seven failures are not replaced by
the 36 passing tests in the small rerun:

1. **Six path-isolation failures:** five flavor takeover cases and legacy Logdy cleanup. `lib/daemon/reconciler/__tests__/reconcile.test.ts` leaves a valid `rtstrand-home-*` HOME behind. The failed flavor envelope actually contains that path. The preload repairs invalid HOME, not a changed valid one. `daemon-config.ts` retains module-load RT_DIR/TRAY_SOCK_PATH; `trayRequest` uses call-time `rtDir()`, so health reaches the fake tray but retirement uses another path. Logdy's legacy removal similarly uses frozen RT_DIR while its fixture creates under current HOME. The no-service `home-split.ts` diagnostic confirmed path divergence and the untouched legacy file (`home-split.{json,log}`). This establishes the mechanism, not a green suite or a reviewed fix.
2. **Worktree timeout:** `create.test.ts`'s out-of-repo root case timed out at 5,796.75ms with a 5,000ms limit; it passed at 888.98ms in the isolated selection. The blocked git stage is unrecorded. Do not widen the timeout or label it harmless without a cause.
3. **Native reference gaps:** actual Claude fresh/resume, busy/blocked consumption, external answer dismissal, Stop/hold/wait/escape behavior and skill delegation/account/model execution remain distinct from passing fake-transport tests. Record owned native workflows before changing those boundaries.
4. **Static formatting:** raw `bun run check` failed at format with 44 warnings in ignored local spike evidence. An uncached follow-up preserving `.gitignore` and `.prettierignore`, plus excluding only that untracked evidence directory, found 184 untouched source files with style issues. None is changed by this branch. Both failures are retained; no unrelated source or evidence was reformatted. Do not claim the static command passed.
5. **Distributed lifecycle:** S9's three profiles remain unrun and block a full-support/release claim.

No base/control execution was performed. Production/test blob equality at the
starting commit is recorded, but failure provenance is not claimed from that
alone. Fix isolation/timing separately, preserve all assertions, rerun the full
root command, then complete native reference evidence before B0 admission.

## Exit

The plan and applied test changes passed the existing reviewer loop after the isolation/type corrections. B0 is not complete. F2 and production refactoring remain blocked. Successful individual commands will be recorded with their scope; they cannot cancel failed or missing required evidence. No production source or frozen fixture was changed. No shared daemon restart, trust/configuration change or installed-binary replacement was performed.
