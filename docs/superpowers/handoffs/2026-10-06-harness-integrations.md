# Handoff: Mattstack harness integrations

Resume this project from the existing isolated worktree. Read this file and the
linked records before taking action. This is a handoff prompt for the next agent,
not authorization to expand the implementation scope.

## Objective and product decisions

Deliver full Codex support by making Mattstack harness-neutral. Mattstack owns
workflow state, identity, policy and orchestration; integrations implement native
operations. Claude and Codex are the first implementations, with room for others.
Herdr's integrations are a model for the software philosophy, not a dependency
that should own all Mattstack integration behavior.

Preserve today's Claude behavior. Extract it behind the shared contracts rather
than replacing it wholesale. RT Chat, gates and continuation enforcement are core
features. Shepherdr should select among enabled, ready integrations, including a
mix of Claude and Codex workers. Explicit user selection wins; resume/retry keeps
that selection. Missing capabilities must refuse the workflow, not silently
weaken enforcement or switch to Claude. Codex-only installation must be supported.

## Workspace and git state

- Worktree: `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/huan`
- Branch: `harness-integrations`
- Canonical checkout: `/Users/matt/Documents/GitHub/repo-tools`
- **User instruction: all edits and builds in isolated worktrees; do not touch
  the canonical checkout.** It may contain other agents' changes.
- Always set the tool's working directory explicitly; the session default may
  still be canonical. If this worktree needs a sandbox escalation, request the
  narrow tool escalation for the already-authorized action, not a new product
  approval.
- Latest implementation/evidence commit at handoff creation: `f92b81c00`
  (`test: isolate watcher bookkeeping and record remaining F2a blockers`).
- Previous checkpoint: `9e3d77e36` (five-file foundation plus reviewed, then
  unapplied watcher proposal).
- Rebased cleanly at the user's request onto `origin/main` at `7a62b66d2`;
  post-rebase execution base was `21bace497`. Main has advanced since then.
- Branch was clean before this handoff document. Local branch was ahead 68 /
  behind 7 relative to `origin/harness-integrations`, largely because of the
  rebase. Do not reset to that remote or interpret divergence as lost work.
- No push, merge, deployment, or shared-service restart was performed or is
  authorized by the narrow implementation approvals.
- Recovery branch `backup/harness-integrations-before-f2a-rebase-20261006` and
  owned stash `eebf6b26634e958f4b9ed35840b86cbb41e17b9c` were retained. Do not
  apply or delete them merely to tidy up. Recovery copies are under
  `.harness-spike/f2a/pre-rebase/`.

Start by inspecting current status and log; another agent may have advanced this
worktree after handoff. Read its actual `AGENTS.md` and nested instructions.

## Roadmap: where we are

| Stage | Current state |
| --- | --- |
| Design, 28-area Claude-coupling audit, spec and plans | Completed and documented |
| F1 feasibility spike and focused hook follow-up | Required initial gates proven; async-answer and restart/recovery gaps remain explicit |
| B0 regression baseline | Extensive characterization and evidence added; general admission remains open/blocked |
| Foundation | Only F2a implemented: disconnected contracts, registry, capability/readiness admission and tests |
| Remaining foundation (F2b, F3–F6) | Not started: runtime wiring, persistence, caller resolution, native adapters, launch and discovery |
| Messaging and gates (M tasks) | Planned; not implemented |
| Orchestration (H tasks) | Planned; not implemented |
| Skills, setup, apps and release (S tasks) | Planned; some prerequisites come early; distributed acceptance comes last |

Most product implementation is still ahead. The recent delay is in regression
verification. Do not describe the whole project as complete or all implementation
as absent: F2a code exists, but its completion gate is not green.

## Read these records, in this order

Paths below are relative to this handoff file.

1. [Roadmap/index](../plans/2026-10-04-harness-integrations.md)
2. [Approved design](../specs/2026-10-04-harness-integrations-design.md)
3. [Latest F2a checkpoint](../spikes/2026-10-05-harness-foundation-f2a.md)
   and [evidence manifest](../spikes/2026-10-05-harness-foundation-f2a-evidence.json)
4. [Exact F2a approval and stop conditions](../plans/2026-10-05-harness-integrations-b0-admission-decision.md)
5. [Approved watcher prerequisite](../plans/2026-10-05-f2a-watcher-test-proposal.md)
6. [Baseline plan](../plans/2026-10-05-harness-integrations-0-regression-baseline.md)
   and [baseline report](../spikes/2026-10-05-harness-regression-baseline.md)
7. The relevant child plan when needed: [foundation](../plans/2026-10-04-harness-integrations-1-foundation.md),
   [messaging](../plans/2026-10-04-harness-integrations-2-messaging.md),
   [orchestration](../plans/2026-10-04-harness-integrations-3-orchestration.md),
   [adoption](../plans/2026-10-04-harness-integrations-4-adoption.md).

F1 evidence is linked by the index. Reuse it; do not rerun completed feasibility
experiments merely to get newer timestamps. The plan index also maps overlap
with the Claude Code mods project/RT-384 tree and records punted work.

## Exact approved implementation scope

The user approved F2a as a narrow exception while broader B0 admission was held:

- `packages/rt-client/src/agent-integrations.ts` — portable types
- `lib/agent-integrations/contracts.ts` — runtime adapter contracts
- `lib/agent-integrations/registry.ts` — pure immutable registry facade
- `lib/agent-integrations/admission.ts` — pure readiness/capability admission
- `lib/agent-integrations/__tests__/registry.test.ts` — 11 runtime cases,
  plus compile-time contract fixtures

These have no existing runtime callers, package entrypoint exposure, built-in
registration or native I/O. The registry preserves supplied integration identity;
factory/capability consistency is checked at the type boundary. Runtime native
report validation remains future work. There are nine negative compile fixtures.

The user separately approved the exact watcher-test patch saved at `9e3d77e36`,
replying “approved”. It is now applied and committed in `f92b81c00`:
`lib/daemon/__tests__/hooks-guard.test.ts` uses controlled watchers in two
bookkeeping tests, retains original assertions and adds cleanup/lifetime checks.
It deliberately removes native watcher registration from those two unit tests.
It changes no production behavior or test deadlines. Both focused and full-run
watcher tests pass. This approval is already granted; do not ask for it again.

**F2b/live wiring and additional API/marketplace source changes are not covered
by these narrow approvals.** Read-only diagnosis and preparation of a concrete
reviewed proposal can proceed. Follow the explicit plan boundary before applying
additional source changes; do not invent approvals beyond it.

## Latest verification: exact outcome

All ran serially in huan at base `9e3d77e36` with the approved watcher patch applied.
The final source hashes match the evidence manifest. Frozen output fixtures are
unchanged. Results:

| Check | Result |
| --- | --- |
| Watcher focused suite | 5 pass, 26 assertions |
| Existing launch compatibility | 130 pass, 419 assertions |
| New foundation tests | 11 pass, 27 assertions |
| rt-client build | Pass |
| Static check | Pass; 12/12 final tasks, 8 cached |
| Compiled CLI selection | 42 pass, 189 assertions |
| Full root suite | **14,573 pass, 3 skip, 3 fail**, 41,018 assertions, 882 files |

Full run: `.harness-spike/baseline-01/f2a-approved-root-01.{json,log}`.
It took about 938 seconds. Do not rerun it just to hope for green. The previous
root run's watcher failure and previous stale-dependency static failure remain
preserved too. The stale Board dependency was corrected with a frozen,
ignore-scripts install; source/lock were unchanged and static then passed.

### Failure 1: API server bind collision

`lib/daemon/__tests__/api-server.test.ts`:
`startApiServer: WS origin guard > a foreign Origin on the /ws path is rejected before any upgrade is attempted`.

Startup threw `ApiPortInUseError` for port 49364 after six attempts, before the
security assertion. Duration 2,607.46ms. Test and production server source were
unchanged from the run base and inspected main.

The helper probes an ephemeral port, stops the probe without awaiting its
promise, then binds the real server to the released port. It also does not await
final server shutdown. Probe hostname metadata differs from production's explicit
`127.0.0.1`; the original socket address family was not recorded.

One reviewed diagnostic was executed, once. The first command lacked `./` before
the ignored test path and ran no tests; its error log is preserved. Corrected
execution passed 10 tests / 35 assertions with no bind retry: **not reproduced**.
All settings resolved correctly; RT_API_PORT was unset. Probe stop settlement
callbacks were observed after API startup began. This does not prove the socket
remained bound until callback execution or explain the original collision.

A later socket observation showed OrbStack local port 49320 connected to remote
49364. It does not prove OrbStack owned the failed listening endpoint. Do not
attribute the failure to OrbStack, IPv6 or delayed shutdown without new evidence.

Artifacts:
- `.harness-spike/f2a/api-port/api-server-diagnostic.test.ts`
- `.harness-spike/f2a/api-port/events-01.jsonl`
- `.harness-spike/f2a/api-port/diagnostic-notes.md`
- `.harness-spike/f2a/api-port-failure-observation.json`
- `.harness-spike/baseline-01/f2a-api-diagnostic-01.{json,log}` (no tests)
- `.harness-spike/baseline-01/f2a-api-diagnostic-02.{json,log}` (one actual run)

Rejected candidate: setting RT_API_PORT=0 would let production claim its own
port, but production embeds the requested port in the 404 docs URL. The original
assertion expects the actual bound port, so this candidate requires changing an
assertion or production behavior. Do not quietly make that change. A narrower
same-address probe plus awaited shutdown would still leave a release/rebind race;
it is not yet a demonstrated fix.

### Failures 2–3: marketplace timeouts

`scripts/__tests__/release-marketplace.test.ts`:
- `publishes the catalog into an empty repo`: 7,164.78ms, empty child output,
  failed expected message, normal 5,000ms deadline exceeded.
- `a file dropped from the source is dropped from the published tree`:
  5,001.18ms, final git ls-tree failed, same normal deadline.

These use local bare remotes. No real marketplace publish occurred. Trace
analysis found substantial intervals outside recorded native Git calls. Empty
publish has an approximately 7,059ms uninstrumented interval after stage init;
part of the mapping is inferred from sequential test order. In the deletion
case both pushes exited zero, recorded top-level Git calls total about 321ms,
and two stage-init-to-remote gaps total about 4,281ms. The failed final ls-tree
has no native start event. Git tracing does not cover all script work, process
dispatch or Bun cancellation. Neither Git nor optional Claude validation is a
proven culprit. No marketplace test was rerun.

Artifacts:
- `.harness-spike/f2a/approved-root-git-trace.jsonl` (large; parse selectively)
- `.harness-spike/f2a/api-port/marketplace-analysis.md`
- `.harness-spike/f2a/api-port/marketplace-analysis.json`

## What to do next

1. Confirm workspace/commit state and read the latest evidence; do not reopen
   the resolved watcher approval or reimplement F2a.
2. Prepare a bounded baseline-reliability investigation and obtain independent
   review of its hypotheses, instrumentation, stop conditions and scope.
   API capture should observe actual bound addresses/families and port ownership
   at the first failed bind. Marketplace capture should time script phases and
   child PID/start/exit, plus parent cancellation/cleanup, and capture a stalled
   owned child's stack where feasible. Preserve assertions, deadlines, normal
   Git selection and optional-native selection.
3. Use the results to prepare a concrete minimal fix or explicit unresolved
   disposition. A passing repetition is not a cause or mitigation. The watcher
   approval does not authorize additional source files; present any required
   scope decision with the reviewed result and explain that precise boundary.
4. Only resume required verification after a reviewed disposition. Preserve
   failed evidence and unique run names. F2a completes only when its required
   gates pass. Completing F2a does not automatically admit F2b; review the wider
   B0/task prerequisites before wiring runtime behavior.

The next product milestone after admission is finishing foundation: shared
launch/resume, persisted identities, caller resolution, and Claude/Codex session
adapters. Then RT Chat/gates, mixed-worker orchestration, and adoption/lifecycle.

## Test accounting and execution rules

The user specifically asked how much permanent CI load was added. Relative to
rebased main `7a62b66d2`, this branch adds **64 runtime test cases** (parameterized
cases counted separately): 28 existing-behavior regression cases, 11 foundation
cases, 25 spike/probe-tooling cases. 63 enter the normal root suite; one enters
Gitq's suite. Existing-test edits and ignored diagnostics are excluded. The 25
spike-tooling tests currently participate in CI; the user has not asked to remove
them. Compile-time fixtures are additional typechecking assertions, not runtime
test cases. Do not quote a root-suite count increase across rebases as our added
case count: main also added tests.

Permanent tests are committed. Ignored `.harness-spike/` artifacts are local to
this machine/worktree and are NOT transferred by git. Their hashes and results
are committed in the manifest. A new clone will lack raw logs and instruments;
use this huan worktree when possible, and report unavailable evidence honestly.

Recorder: `.harness-spike/baseline-01/run.py NAME CWD COMMAND...`. Check proposed
log/JSON paths do not already exist: the recorder itself can overwrite them.
It forces HERDR_BIN/HERDR_SOCKET_PATH to owned nonexistent paths. The repository
Bun preload isolates HOME, guards daemon access and suppresses real auth fallback.
**Never disable test HOME isolation.** The user's regular-HOME preference is for
owned native harness work using existing authentication, not unit test state.

The exact compiled selection and all commands are in the manifest. Root tests
run through `bun run test`; static through `bun run check`. Broad commands run
serially so one suite does not change shared test state while another observes it.
Do not raise deadlines, regenerate frozen fixtures, remove assertions or skip
failing checks to declare green. Do not modify shared service sockets/config or
restart rt/Herdr/Codex services as a test convenience.

## Review and communication expectations

The user explicitly requested subagent review loops. Prior independent reviewer
`/root/f2a_review` approved the foundation scope, applied watcher diff, API
diagnostic interpretation and final blocked checkpoint. `/root/f2a_implement`
prepared diagnostics and read-only trace analysis. Those session agent handles
may not exist in your session; use a fresh reviewer with a precise brief when
needed rather than claiming access to an old agent. Follow applicable local
mattstack/rt and superpowers skills; discover/read them, do not assume a named
skill is available just because it existed in a previous harness.

The user is frustrated by vague status and repeated permission loops. Explain
what is implemented, exactly which check failed, and the next concrete action.
Say “F2a verification and runtime wiring are held,” not merely “everything is
blocked.” Use form-based questions when input is actually needed. Do not ask
again for approvals already recorded. Do not end a turn with an unclear next
step, and do not present planning/diagnostics as delivered product functionality.

The ignored execution ledger is
`.superpowers/sdd/2026-10-05-harness-integrations-b0-admission-decision/progress.md`.
Committed records are authoritative for another machine; local evidence adds
reproducibility where available.
