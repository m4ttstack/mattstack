# Harness Integrations F1 Follow-up Gating Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the runtime evidence gaps left by the October 4 compatibility spike, then re-plan the four provisional packages from the combined evidence.

**Architecture:** Reuse the earlier protocol sequences and evidence. Build only the small recorder, correlation and failure-handling extensions needed for the unanswered questions. Run disposable Codex workers against the user's existing services and regular authenticated HOME; this follow-up does not build an alternate-home lab or a production integration.

**Tech Stack:** Repository-pinned Bun/TypeScript and `bun:test`, existing redaction, installed Codex control protocol and Herdr. October 4 tested Codex 0.160.0, Claude Code 2.1.289 and Herdr 0.9.3; record actual versions at execution instead of treating these as minimum versions.

**Spec:** [Harness integrations design](../specs/2026-10-04-harness-integrations-design.md). Parent: [plan index](2026-10-04-harness-integrations.md).

**Status:** Executed after Matt's 2026-10-05 go-ahead. See the [exit report](../spikes/2026-10-05-harness-gate-spike-report.md): its original G5 block is superseded by the [focused hook follow-up](../spikes/2026-10-05-codex-hooks-followup.md), which proves scoped question refusal and Stop continuation. G1/G2/G3/G5 now pass; incorporate the hook loading/trust lifecycle in the spec and re-plan. F2 and later remain provisional and unexecuted. The original task checklist below is retained as the execution contract; the report records completed work and unproven observations.

**Follow-up authorization:** Matt separately approved temporary trust for one exact disposable folder and its two reviewed hook hashes. That focused run removed all three entries afterward; the original no-global-config rule below remains the default for other probes. No shared daemon restart or trust bypass was authorized.

## Global Constraints

- “Unknown state must remain unknown.” Missing or ambiguous observations never pass.
- “Transport submission is not proof of consumption or action.”
- “This spec does not treat an environment-variable rename as a solution to that issue.”
- Preserve the user's regular HOME and existing Codex authentication/configuration. Do not override HOME or CODEX_HOME for live probes, copy credentials, create another authentication profile, or build a `/tmp` lab. Normal isolated unit-test fixtures and the repository's test preload remain unchanged.
- Work from the existing `harness-integrations` rt worktree. Put live probe working directories, policy fixtures and evidence under an ignored `.harness-spike/<run-id>/` in that worktree. Check that Git ignores the directory before writing live artifacts; if needed add only this pattern to the worktree's local Git exclude file, not a tracked file. Do not create sockets there.
- Connect to existing rt, Herdr and Codex endpoints using their supported discovery. Create only disposable worker sessions/workspaces owned by this run. rt access in F1 is read-only `ping`; stored gate answers and chat reads were already proven.
- Do not start, stop, restart or reconfigure a shared daemon. Never attach, resume, answer, interrupt or close another session. Filter server events to the exact owned thread IDs before recording them, and validate server requests against those IDs before responding.
- Configure probe MCP tools/hooks only through verified worker/session-scoped options. Do not edit global Codex configuration or reload shared services to make a probe work. If a required option cannot be scoped, record the limitation rather than changing another session's behavior.
- G7's daemon-restart portion is deferred in this regular-home pass. Mark it unobserved and carry it into acceptance planning. A shared daemon restart requires a separately agreed disruption window; this plan does not authorize it. Connection reconnect in G3 is still in scope.
- No new dependencies or production changes. Tracked changes stay under `scripts/probes/harness/` and `docs/superpowers/`. Do not rebuild or deploy rt or an app bundle for this spike.
- Every evidence row, including CLI, MCP, hook and error rows, passes through `redactDeep` from `lib/mcp/redact.ts` before writing. Keep an environment allowlist; never dump the environment or authentication files.
- Run unit tests from the repo root. Preserve the repository's `no-*.test.ts` naming for tests that read source text or spawn `cli.ts`.

## Evidence already established — do not repeat as a feasibility suite

Read the [October 4 report](../spikes/2026-10-04-codex-compatibility-spike.md) and its [committed evidence](../spikes/2026-10-04-codex-compatibility-evidence.json) first. Retain their versions and scope limits when citing them; historical evidence is not a fresh result.

| Established observation | What this follow-up adds |
| --- | --- |
| Herdr/native delivery works for idle and busy Codex; queued input eventually produces a marker | G7 seeks the native consumption event/field, not another idle/busy delivery matrix |
| A worker receives its own `CODEX_THREAD_ID` while inheriting incorrect Herdr variables, including after pane replacement | G1 checks two simultaneous callers; the existing single-worker result is the baseline |
| Native synchronous question completion works when the bridge is attached before the question | G3 disconnects while the question is pending, then recovers it on a new connection |
| Async steering wakes the worker; queue acceptance is not question completion | G4 seeks native async completion; do not re-prove steering as the fallback |
| CLI access to rt is denied in the default tested sandbox and succeeds with network access enabled | G6 tests MCP without widening; rerun a CLI control only when current configuration/version differences require it |
| Stored rt answers and chat messages are read by Codex; first-answer-wins, wait behavior and rt restart durability work | Reuse these results; no new rt rooms/gates or rt restart in F1 |
| Same-thread resume and chat identity continuity work; Claude inbox baseline works | Reuse these results; no new Claude baseline or pane-replacement experiment in F1 |

A control is allowed only to establish a prerequisite for a new question: creating the pending question for G3, an allowed tool call for G5, and queued delivery for G7. Record why each repeated control was needed. Do not rerun established cases just because a new runner exists. Version/configuration changes justify only the affected controls.

## Reuse the earlier probes

The earlier scripts were still present at `/tmp/mcs-pr43afb6` when this revision was written. Read them as source material, not as commands to run unchanged:

- `rpc.py`, `ws.py`: working initialization, transport and request/notification sequences.
- `native-form.py`: synchronous question setup, including the explicit collaboration mode used in the successful run.
- `queue-live.py`, `gate-bridge.py`, `finish-gate.py`: queue and question observations.
- `control.py`, `worker.py`, `launch-worker.py`: worker launch and marker recording.

They embed the old thread ID, old state paths and isolated-service assumptions. Do not reuse those identities, load old credentials, or execute their top-level actions. Port only the necessary sequences into the small Bun probe files below, using Bun's transport rather than reproducing a Python WebSocket implementation. If the temporary files have disappeared, use the committed report/evidence and inspect the installed protocol for the missing operations; their absence does not invalidate the prior results or justify rebuilding the old suite.

Tasks 1–6 describe extensions needed for this follow-up, not a general reusable harness framework. Group helper changes with the case that first needs them where practical. Do not require six separate scaffolding commits before the first live case; commit each tested extension with its consumer.

## Review Focus

1. Concurrent calls must name their real thread, not a pane hint or a thread ID found anywhere in metadata (Tasks 4, 5, 7).
2. A reconnect can change request ID; question correlation uses thread + turn + item, and no response may reach a different question (Tasks 1, 5, 8).
3. A configured hook may not load or enforce. Observe hook inventory, refusal and the absence of the forbidden action, then actual continuation after a blocked stop (Tasks 5, 9).
4. A shared control endpoint can expose unrelated sessions. Ownership checks apply to mutations and evidence; current user configuration is preserved (Tasks 1, 3, 6).
5. Failed pane reads or cleanup actions must not skip remaining cleanup or the exit report. Recorder metadata and hook payloads must be redacted before disk (Tasks 2, 3, 4, 6).

## Questions and exit criteria

| Id | Remaining question | Proven means | Consequence if not proven |
| --- | --- | --- | --- |
| G1 | Are two concurrent CLI callers attributed correctly on the existing shared Codex service? | Each observed command carries that worker's exact native thread ID; pane hints are recorded separately | F4 cannot rely on concurrent CLI attribution; revise the spec |
| G2 | Can MCP calls be attributed to their actual thread? | Each call has an exact thread value at one identified, consistent host-provided metadata field, or an independently bound per-thread MCP process | F4 needs another supported binding mechanism; revise the spec |
| G3 | Can a pending synchronous question be recovered after a control-client reconnect? | The same thread/turn/item is rediscovered, answered on the new connection and completed with the answer | M5 lacks recovery; revise the spec |
| G4 | Can an async question be completed natively? | An identified async question item completes through its native answer path | Async questions stay unsupported for unattended gates |
| G5 | Can worker-scoped hooks enforce tool and stop policy? | Relevant hooks load, a refused tool produces no forbidden action, and a blocked stop causes continuation before an allowed stop | M6 cannot enforce the required policy; revise the spec |
| G6 | Can MCP reach rt without widening the worker sandbox? | The worker's MCP server successfully pings rt with the worker sandbox unchanged; effective settings are recorded | S4 needs another supported arrangement |
| G7 | Is consumed delivery observable, and what restart evidence is missing? | Consumption is correlated by exact client/thread/item IDs; restart subresults are reported independently | M1 reports queued at best without consumption evidence; restart stays an explicit acceptance gap |

G1, G2, G3 and G5 are gates: anything other than `proven` requires a spec revision before package re-planning. G4/G6/G7 shape re-planning without independently stopping it. This does not waive release requirements. G7 is at most `partial` while restart is unobserved, even if consumption is proven. There is no implied queue persistence or deduplication guarantee.

## Files and shared interfaces

Only introduce a file when its case needs it:

```text
scripts/probes/harness/
  codex-control.ts       owned-thread RPC, event buffering and reconnect
  evidence.ts            redaction, prior/new provenance and report assembly
  lab.ts                 existing-service connections and owned worker lifecycle
  probe-cli.ts           allowlisted environment recorder; optional CLI control
  probe-mcp.ts           per-call metadata recorder and read-only rt ping
  probe-hook.ts          worker-scoped allow/block recorder
  verdicts.ts            evidence judges
  cases/attribution.ts   G1/G2
  cases/questions.ts     G3/G4
  cases/policy.ts        G5
  cases/sockets.ts       G6
  cases/delivery.ts      G7 consumption only
  run.ts                explicit live entry point and case selection
  __tests__/             focused protocol, evidence and lifecycle tests
```

Use these types consistently across the kit:

```ts
type QuestionId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7';
type Verdict = 'proven' | 'partial' | 'blocked' | 'not-run';
type CaseResult = {
  question: QuestionId; verdict: Verdict; observations: string[];
  consequence: string; evidenceRefs: string[];
};
type QuestionRef = {
  requestId: string | number; threadId: string; turnId: string; itemId: string;
};
type Worker = { name: string; pane: string; cwd: string; threadId: string };
type CleanupRow = { resource: string; ok: boolean; detail?: string };
```

### Task 1: Reuse baseline sequences and extend the control client

**Files:** `scripts/probes/harness/codex-control.ts`, `__tests__/codex-control.test.ts`; initialize the exit report's evidence/reuse section in `docs/superpowers/spikes/2026-10-05-harness-gate-spike-report.md`.

**Interfaces:** `CodexControl.connect({ socketPath, ownedThreads, experimentalApi }): Promise<CodexControl>`; `call(method, params)`, `respond(id, result)`, `next(match, timeoutMs)`, `close()`. `ownedThreads` is the shared `Set<string>` maintained by Task 3. Preserve numeric request ID zero. Each inbound request carries its connection identity and full question reference.

- [ ] Read the prior report, evidence and available source scripts. Record exact reusable sequences, their provenance, installed versions and which missing operations need protocol inspection. Do not run the prior suite.
- [ ] Write tests for request ID zero, RPC error/timeout handling, a request arriving during initialization before the consumer attaches, rejection on close, and refusal of an unowned thread mutation or question response. Assert buffered owned events are delivered and foreign events never reach the evidence sink.
- [ ] Run `bun test scripts/probes/harness/__tests__/codex-control.test.ts`; new assertions must fail before implementation.
- [ ] Implement only the required protocol operations. Read installed schema before selecting fields/methods. Buffer early events; resolve pending requests exactly once. Discovery may read minimal thread IDs/cwds, but never record unrelated histories. Bind `respond` to an owned request on the current connection.
- [ ] Rerun the focused test. Commit the tested client/reuse notes with its first consuming case; no live work until authorized.

### Task 2: Preserve prior evidence and record new observations

**Files:** `scripts/probes/harness/evidence.ts`, `__tests__/evidence.test.ts`.

**Interfaces:** `requireLive(argv): void`; `createEvidence(dir, versions): Evidence` with `record(kind, data)`, `addCase(CaseResult)`, `addCleanup(CleanupRow)`, `write(): string`; `readJsonl(file): unknown[]`; `assembleReport(reportPaths: string[]): unknown`.

- [ ] Write tests that missing `--live` prevents any connection/launch, nested token-bearing fields are redacted before disk, and failed/missing cases cannot become proven. Test assembly of G1/G2/G6, G3/G4/G7 and G5 reports yields all seven results, retains each run's versions/provenance and refuses conflicting duplicate results without an explicit selection.
- [ ] Run `bun test scripts/probes/harness/__tests__/evidence.test.ts`; expect the new assertions to fail.
- [ ] Record baseline references separately from fresh results. Each new report includes run ID, source commit, versions, effective non-secret configuration, case results, owned resources and cleanup. Pass every record through `redactDeep`; final sanitization is additional verification, not the first redaction.
- [ ] Rerun the tests and commit with the first consuming case. Do not rerun every live case solely to obtain one combined JSON file.

### Task 3: Use regular HOME and manage only owned workers

**Files:** `scripts/probes/harness/lab.ts`, `__tests__/lab.test.ts`.

**Interfaces:** `startLab({ repo, runDir, ev }): Promise<Lab>` where `Lab` has `workers: Worker[]`, `ownedThreads: Set<string>`, `launchWorker(name, scopedOptions?): Promise<Worker>`, `herdr(...args): Promise<unknown>`, `rtPing(): Promise<unknown>`, and `stop(): Promise<CleanupRow[]>`. No daemon lifecycle operation, alternate home, credential copy or global-config writer exists on this interface. Native endpoint paths are discovered, not constructed beneath `runDir`.

- [ ] Write tests with injected process/service dependencies: HOME/CODEX_HOME remain inherited; launch options stay worker-scoped; partial launch failure closes already-owned resources; one close failure still attempts the remaining closes; shared daemon stop/restart and foreign pane closure are never called. Use fake endpoints, not the user's services, for unit tests.
- [ ] Run `bun test scripts/probes/harness/__tests__/lab.test.ts`; expect the new assertions to fail.
- [ ] Connect to existing services and launch disposable workers in owned Herdr workspaces without focus changes. Match each new native thread to its unique worker cwd, then add it to the ownership set. Track owned workspaces before starting workers so a partial launch can still clean up. Read existing services without launching a competing rt daemon.
- [ ] Preserve existing Codex defaults/auth. Inspect installed CLI/schema for supported per-worker MCP/hook overrides and record their effective scope. An unsupported scoped option becomes a case limitation. Do not change global configuration or force a daemon restart. For G1 record actual inherited pane variables; never poison the shared daemon's environment to reproduce the earlier mismatch.
- [ ] Rerun tests. A live startup check, after go-ahead, is limited to read-only service reachability and one worker needed by the first selected case. Reuse that worker where the case allows; no standalone new-lab smoke project.

### Task 4: Add only the missing CLI, MCP and hook recorders

**Files:** `scripts/probes/harness/probe-cli.ts`, `probe-mcp.ts`, `probe-hook.ts`, `__tests__/recorders.test.ts`.

**Interfaces:** `envSnapshot(env): Record<string, string>`; `handleMcpMessage(state, msg, record, env): unknown`; `decideHook(event, payload, policy): { exitCode: number; stdout: string; stderr: string; consumeOnce: boolean }`; `hookRow(event, payload, decision, env): unknown`.

- [ ] Write tests for an allowlist limited to native session and Herdr identity keys; MCP initialize/call records containing pid, metadata and environment; hook allow/block and one-shot stop refusal. Assert tokens nested in initialize metadata and hook payloads are absent from the rows written. Use the existing redactor, never a parallel implementation.
- [ ] Run `bun test scripts/probes/harness/__tests__/recorders.test.ts`; expect new assertions to fail.
- [ ] Extend the old marker approach for simultaneous workers. CLI records exact native IDs; MCP provides `probe_whoami` and `probe_rt_ping` only. Constrain ping to the configured rt socket and a read-only ping request. Caller markers aid comparison but never establish authority. Redact CLI/MCP/hook rows before both disk and diagnostic output.
- [ ] Implement hook block formats only from the installed protocol. Keep policy fixtures under the run directory, with scoped config pointing to them. Test both supported block styles only if the first does not establish enforcement.
- [ ] Rerun the tests. Commit each recorder with the case that first consumes it.

### Task 5: Judge the new evidence without false passes

**Files:** `scripts/probes/harness/verdicts.ts`, `__tests__/verdicts.test.ts`.

**Interfaces:** `judgeCliAttribution(workers, rows)`, `judgeMcpAttribution(workers, rows)`, `judgeQuestionRecovery(observation)`, `judgeAsyncQuestion(observation)`, `judgePolicy(observation)`, `judgeSockets(observation)`, `judgeDelivery(observation)`, all returning `CaseResult`. Observations carry the named evidence fields in the tests below; retain absent values as unknown.

- [ ] Write the following focused assertions, then run `bun test scripts/probes/harness/__tests__/verdicts.test.ts` and confirm they fail:
  - G1: two commands with their exact thread IDs pass even with wrong pane hints; crossed IDs fail; a missing worker row is `not-run`.
  - G2: a single consistent `_meta` key path with exact caller values passes only after its host-provided provenance is identified. Report the path. Metadata containing both threads, substring matches, different key paths, or model-supplied arguments do not prove identity. Independently bound per-thread MCP pids/env may pass instead.
  - G3: changed request ID with the same thread/turn/item, completed question and observed answer passes; changed item, missing correlation fields or merely sending a response does not. Pending status without an answer path is `partial`.
  - G4: the exact async item completes after its native answer; steering, a synchronous substitute, or an unrelated request cannot pass.
  - G5: zero relevant loaded hooks fails; an executed forbidden action fails; stop refusal without observed continuation is not proven.
  - G6: MCP ping with unchanged effective sandbox passes; CLI-only success or an absent probe row does not. Distinguish a denied connection from a probe that never ran.
  - G7: exact client ID on an owned thread's consumed user-message item proves only consumption. Queue acceptance alone does not. Restart fields remain `unobserved`; the aggregate verdict is `partial`, with a named follow-up acceptance requirement.
- [ ] Implement these judges as pure functions; protocol field names must come from observations/schema rather than fabricated metadata. Do not use serialized substring search as positive attribution evidence.
- [ ] Rerun the suite and commit the judges with their consumers.

### Task 6: Run only selected gaps; always attempt cleanup

**Files:** `scripts/probes/harness/run.ts`, case modules listed above, `__tests__/run.test.ts`.

**Interfaces:** `parseArgs(argv): { live: boolean; cases: QuestionId[]; out: string }` (require explicit `--cases` and `--out`); each case exports `run(lab, ev, selected): Promise<CaseResult[]>`; `collectPaneTails(lab, ev): Promise<void>`; `finalizeRun(lab, ev): Promise<void>`.

- [ ] Write tests for invalid/missing case selection, no live actions without `--live`, exact case filtering (G3 must not implicitly run G4), and no daemon-restart action in G7. Test failed pane reads and failed diagnostic writes still lead to cleanup, and a partial case report is written on failure. Test that shared-server events from foreign threads are discarded before evidence recording.
- [ ] Run `bun test scripts/probes/harness/__tests__/run.test.ts`; expect the new assertions to fail.
- [ ] Implement case modules from Tasks 7–9, creating only helpers they need. Subscribe before initiating an operation so immediate replies/completion events are retained. Preserve owned correlation data across reconnect.
- [ ] Require an ignored output directory inside the existing worktree and preserve regular HOME. Read existing effective non-secret settings; pass only supported scoped overrides. `finally` must attempt diagnostic collection, resource cleanup and report writing independently. A diagnostic failure never bypasses `stop()`; one cleanup failure never bypasses the next resource.
- [ ] Run `bun test scripts/probes/harness` and `bun run typecheck`. Fix errors in the probe kit. Commit the tested kit; passing unit tests do not prove any native capability.

### Task 7: Concurrent attribution and MCP socket access (G1, G2, G6)

**Files:** `cases/attribution.ts`, `cases/sockets.ts`; evidence in the run directory.

- [ ] Start two disposable workers using normal HOME on the same existing Codex service. Each runs one CLI identity recorder and one `probe_whoami` call concurrently. Record exact thread IDs, recorder pids, allowlisted inherited variables and request metadata, excluding unrelated sessions. Compare with the earlier single-worker result, not with model-authored identity arguments.
- [ ] Ping rt through the probe MCP server with the worker's effective sandbox unchanged. Record whether any existing network permission is already enabled. If the user's default differs from the earlier baseline, test the restricted worker-scoped setting explicitly when supported; do not call a widened baseline proof of restricted access. Only rerun a CLI control if needed to explain a version/configuration difference.
- [ ] Run from the worktree: `bun scripts/probes/harness/run.ts --live --cases G1,G2,G6 --out .harness-spike/attribution-<run-id>`. Substitute a unique run ID at execution. Inspect results and cleanup; fix probe bugs without broadening to already-proven scenarios.
- [ ] Record G1/G2/G6 results with evidence references. An MCP identity path must identify its actual field and transport provenance. Working calls alone never prove caller attribution.

### Task 8: Question recovery, async completion and consumed delivery (G3, G4, G7)

**Files:** `cases/questions.ts`, `cases/delivery.ts`; evidence in the run directory.

- [ ] G3: reuse the proven synchronous question setup (including its required collaboration mode). Establish one pending question on an owned worker, record its thread/turn/item and request ID, disconnect only the probe client, reconnect and rediscover that same question through supported replay/discovery. Answer on the new connection and observe native completion plus the chosen answer. Do not repeat rt gate durability or rebuild the rt answer bridge.
- [ ] G4: use a separate clean owned turn/thread if G3 remains blocked. Request the actual async variant, verify it is async from native evidence, and attempt the supported native answer path. Correlate the completed item. If unavailable, record the limitation; do not rerun the already-proven steering workaround as a substitute.
- [ ] G7: reuse one known queue submission sequence and seek the native consumed user-message event with exact client/thread/item correlation. Do not run the full Herdr/native idle/busy/blocked delivery matrix. Record daemon restart, queue survival and pending-question survival as `unobserved — shared daemon restart deferred`; never invoke a daemon restart.
- [ ] Run: `bun scripts/probes/harness/run.ts --live --cases G3,G4,G7 --out .harness-spike/questions-<run-id>`. Inspect native correlation and cleanup. A failed probe is not a native incompatibility finding until its setup is verified.
- [ ] Record separate consumption and restart subresults. Full release acceptance still requires the deferred restart evidence even if re-planning can proceed.

### Task 9: Native policy enforcement (G5)

**Files:** `cases/policy.ts`; evidence in the run directory.

- [ ] Configure probe hooks only on a disposable worker using installed, supported scoped options. Read `hooks/list` (or its installed equivalent) for that worker and record the actual loaded PreToolUse/Stop hooks. If a feature flag is required, apply it only to the worker and verify scope; never enable it globally for this test.
- [ ] Run one harmless allowed tool call to identify the actual native tool name. Refuse the next call and verify both a hook refusal and absence of the forbidden marker. Then refuse one stop, observe continuation and a subsequent allowed stop on that same owned turn. Record native payload field names and the block format actually honored.
- [ ] Run: `bun scripts/probes/harness/run.ts --live --cases G5 --out .harness-spike/policy-<run-id>`. If configuration cannot be scoped or hooks do not load/enforce, record G5 as unproven with the exact limitation; do not modify regular user configuration to manufacture a pass.
- [ ] Inspect the result and all owned-resource cleanup. Record the settings M6/S4 would need, without applying production settings.

### Task 10: Combine the evidence and stop for re-planning

**Files:** `docs/superpowers/spikes/2026-10-05-harness-gate-spike-report.md`, `2026-10-05-harness-gate-spike-evidence.json`; update the parent plan's planning status.

- [ ] Assemble the selected reports from Tasks 7–9. Do not copy only the last group's report or require another full live run. Retain baseline references, each run's versions/configuration, all seven verdicts and cleanup results. Resolve conflicting reruns explicitly, preserving the earlier failed observations.
- [ ] Write the report with these sections: prior evidence reused; new evidence by G1–G7; controls repeated and why; native fields/configuration the re-plan may use; deferred restart acceptance; cleanup; decision. Name the source commit and native versions. Distinguish observed facts from inferred implementation choices.
- [ ] If any of G1/G2/G3/G5 is not `proven`, name the affected spec sections and stop for revision. Otherwise say `Gating questions proven: re-plan plan 1 next`, while explicitly retaining G4/G6 limitations and G7's deferred restart coverage. Do not describe full Codex support as proven.
- [ ] Sanitize the combined artifact before committing: no credentials, emails, unrelated thread data or real-home configuration contents. Use relative evidence paths and endpoint roles rather than committing private absolute paths. Keep the original October 4 report/evidence unchanged.
- [ ] Update the parent index with the report link and decision. Run `bun run purity` and `git diff --check`; inspect the public report and JSON in full. Commit only probe sources/tests and sanitized planning/evidence artifacts, with accurate authorship.
- [ ] Stop and report the verdicts to Matt. Neither this edit nor spike completion authorizes F2+. Re-planning and any spec revision happen in a new planning pass.
