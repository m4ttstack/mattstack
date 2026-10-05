# Harness integrations: mandatory regression baseline

**Goal:** Establish executable evidence of current Claude behavior before F2 or any production extraction. A future-feature test that starts red does not replace this baseline.

**Scope:** B0 adds tests and evidence, diagnoses failures, and changes planning documents. It does not implement F2–S12. Use the existing `harness-integrations` worktree and repository test isolation. The [parent plan](2026-10-04-harness-integrations.md) and [spec](../specs/2026-10-04-harness-integrations-design.md) govern compatibility.

## B0.1 — Inventory behavior and evidence

- [x] Create `docs/superpowers/spikes/2026-10-05-harness-regression-baseline.md` mapping every A01–A28 row to actual test assertions, implementation tasks, suite command, evidence level, result and remaining gap.
- [x] Distinguish unit/fake transport, actual filesystem/SQLite, compiled CLI/daemon with fake native sockets, actual native workflow, and distributed lifecycle evidence. A file name containing e2e is not sufficient evidence of a native workflow.
- [x] Record commit, production merge-base, Bun/tool versions, command/cwd, exit status, counts, log path/hash and isolation. Preserve failures from initial runs alongside successful diagnostic reruns.
- [x] Treat existing behavior and deliberate new guarantees separately. Current tests allow newest-run lookup, session-free herd reports, and some fail-open hooks; future fencing/refusal behavior must be an explicit reviewed migration. Do not silently rewrite compatibility expectations.

## B0.2 — Run existing protection before edits

Run suites sequentially to avoid test load contaminating timing evidence. First run `bun run test` at the root. It excludes apps, plugin shell checks, Rust, Swift, and compiled CLI E2E. Then run the affected suites below after inspecting their fixtures; preserve their preload and cwd.

| Surface | Command / execution rule |
| --- | --- |
| Root | `bun run test` |
| Board | `bun run --cwd apps/board test` |
| Chat | `bun run --cwd apps/chat test` |
| Console | `bun run --cwd apps/console test` |
| Gitq | In `apps/gitq`, unset ambient `GITQ_CONFIG_DIR`; run `bun test tests/board-herdr.test.ts tests/job-state.test.ts tests/gitq-status.test.ts tests/install-skills.test.ts` plus any new lifecycle characterization |
| Herdr chat | `cargo test --locked --manifest-path plugins/herdr-chat/Cargo.toml` |
| Mattstack hooks | Run the existing gate Stop, pipeline Stop, fork and relocation shell test scripts; enumerate exact script paths and results in the report |
| Skill certification | Mirror the `plugin-mattstack` job in `.github/workflows/checks.yml`, using its explicit disposable compilation directory; run `skills:check:board`, never regenerate vendored artifacts to make verification pass |
| Compiled CLI/daemon | `bun test --preload ./e2e/setup.ts --timeout 60000` with the agent, chat-inbox-delivery, chat-presence-roster, gate-ask-cli, gate-answer, gate-fork-check-cli, herd, herd-watchdog, runs and relocation-announce test files under `e2e/tests/`; inspect each for isolation first |
| Tray | `swift run --package-path rt-tray mattstack-checks`; missing macOS/toolchain/Sparkle prerequisites are blocked evidence, not a pass |
| Static | `bun run check` after baseline changes |

- [x] Record the initial results without changing timeouts, assertions or production behavior.
- [ ] Diagnose every failure: exact file/assertion, standalone reproduction, relevant source/test equality with the production merge-base, and base/control execution where necessary to establish provenance. Unchanged source alone is not proof of a pre-existing test failure.
- [ ] A passing rerun does not erase a flaky full-suite failure. Document and resolve affected instability before granting GREEN. Do not mark a failed command green because unrelated assertions passed.
- [x] Fix confirmed test infrastructure defects in a separately reviewed change. Production bugs discovered by B0 stay explicit blockers for the affected extraction until a separate reviewed fix is green. Never fold an unreviewed behavior change into characterization.

## B0.3 — Close gaps in current-behavior protection

Read the assertion inventory before adding tests. Add only meaningful missing composition/race coverage; existing complete coverage needs a recorded run, not a duplicate test.

- [x] Runtime: use the audit to identify any unprotected joins among caller identity, chat continuation/delivery, gate answer/wait races, herd assignment/recovery, CI ownership and worktree relocation. Add bounded tests at existing seams with real stores and controlled native transport.
- [x] Skills: characterize installed-Claude discovery through actual compiler/check and generated resources using a fake plugin-list executable. Preserve current inventory/source/version selection and recovery after discovery failure.
- [x] Gitq: characterize the action route through captured launch and the actual temporary job/status store; pin today's launch failure, existing-tab and reporting behavior before S7. If today's behavior exposes a bug, record it rather than inventing a desired green assertion.
- [x] Setup: characterize update and ownership-driven uninstall over the same fixture with a disabled team plugin, trusted baseline plugin and unrelated MCP/permission keys. Explicit apply deliberately re-enables trusted Mattstack while retaining the team pack's choice; update preserves disabled trusted and team packs. Pin each entry point separately.
- [x] Each added characterization must pass against unchanged production code. Test the real joining seam rather than duplicating helper calls in the test. Do not change production code merely to obtain a green baseline. If a joining seam cannot be exercised without changing production, document the exact boundary as GAP and keep its task blocked; resolve the testability approach in a separate reviewed prerequisite, never silently waive it.
- [x] Preserve frozen chat/agent/gate/herd/pane/CI/runs bytes and stderr contracts. Never regenerate the frozen fixtures. Source-reading or `cli.ts`-spawning tests must use the `no-*.test.ts` naming convention.

## B0.4 — Native reference and exit decision

- [x] Record an owned Claude reference workflow for chat delivery/continuation, native gate question and external answer, Stop/continuation policy, shepherd/worker reporting and skill delegation/model/account selection. Use the regular authenticated HOME only for owned live workers; never disable unit-test HOME isolation. Reuse prior evidence only when it demonstrates the exact scenario against the relevant code/artifact version.
- [ ] Actual native execution and distributed setup/update/restore/uninstall cannot be replaced by mocks or certification. Prepare reproducible acceptance scenarios now; disruptive or destructive cases remain in the explicitly scoped S9 environment, not shared services. Record any unavailable prerequisite as BLOCKED with an exact affected task.
- [x] Publish results as GREEN, FAIL, BLOCKED, NOT RUN or GAP, with separate evidence levels. No global green claim while a required baseline row remains unresolved.
- [x] Run the same plan reviewer loop, then record the baseline decision and local commit. A reviewed plan is not evidence that its tests ran.

**Admission:** F2 and all production extraction remain blocked until B0's offline coverage is complete and green, required current-runtime reference scenarios are proven, and every affected task has a named before/after suite. Distribution-only S9 acceptance may remain pending without blocking pure extraction, but blocks a full-support/release claim. Missing native evidence for a changed boundary blocks that boundary even if other tasks are green. No implicit waiver for known failures; any exception requires an explicit reviewed decision naming its scope and rationale.

**Per-task rule after admission:** Run the mapped unchanged compatibility suite before editing, add separate red tests for new behavior, implement, then run both suites plus applicable static/app/plugin gates. Carry the evidence forward by commit and exact command. A new failure or changed compatibility assertion stops that task. Re-run the broader integrated baseline at phase boundaries and the distributed three-profile matrix at S9.

## Plan review record

2026-10-05: the existing plan reviewer re-read B0, parent/spec gates, the
coverage report and H1 identity correction. Status: Approved. Clarifications
aligned explicit apply versus update plugin choices and fresh replacement
identity across H1/spec. This approves the instructions only; B0 evidence is
still incomplete and production extraction is blocked.


2026-10-05 evidence review: the built-in reviewer became unavailable, and Matt
explicitly approved a read-only Claude review of the relevant source and evidence.
The same native reviewer approved the hydration fixture fix and, after a separate
document loop, approved the report version committed as `345e2177e`. The later
timeout follow-up has its own review record. Current root, compiled and static
commands are green. **B0 admission remains BLOCKED**, with no exception granted,
because historical deadline-only triggers are not all causally resolved. The
last prerequisite fix is local commit `af1c9ecd0`; the evidence report and manifest
record all four prerequisite commits, commands, controls and review artifacts.


2026-10-05 timeout follow-up review: the same native reviewer approved the
investigation report in round two. The measured Git-launch cost is a candidate
mitigation target, not proof of every historical timeout cause. Neither the
launcher optimization nor a passing rerun alone clears B0. The report now names
the causal-verification route and the explicit-reviewed-exception route; no
exception or production extraction is authorized by this review.
