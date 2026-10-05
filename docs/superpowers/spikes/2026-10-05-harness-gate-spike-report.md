# Harness integrations: F1 follow-up exit report

**Decision: stop before F2. G5 is not proven, so revise the spec before re-planning the provisional packages.** This spike establishes several missing native contracts; it does not establish full Codex support. No production integration was implemented.

Executed October 5, 2026, following Matt's explicit go-ahead, in the existing `harness-integrations` worktree with his regular HOME and authentication. All services were already running. No shared daemon was started, restarted, stopped or reconfigured; no global Codex settings or hook trust were changed.

[Sanitized evidence](2026-10-05-harness-gate-spike-evidence.json) contains all seven selected verdicts, prior failed attempts, source commits, exact owned correlation fields, cleanup, and hashes of ignored raw artifacts. Selected cases used Codex CLI/server **0.160.0**, Herdr **0.9.3**, Bun **1.4.2**, and native worker model **gpt-6.1-sol**. The live source commits were `24bb99935` (G1), `c2bccb2db` (G2/G6), and `633c217a9` (G3/G4/G5/G7). These are evidence points, not a supported version range.

## Prior evidence reused

The [October 4 report](2026-10-04-codex-compatibility-spike.md) and [evidence](2026-10-04-codex-compatibility-evidence.json) remain unchanged. They establish the previous idle/busy delivery matrix, single-worker identity behavior, initial synchronous question completion, steering behavior, rt gate/chat reads and persistence, same-thread resume, and Claude inbox baseline. Those experiments were not rerun as a feasibility suite.

The available earlier `rpc.py`, `ws.py`, `native-form.py`, queue and marker scripts supplied initialization, question collaboration-mode, queue submission and recording sequences. Only their protocol sequences were ported; their old identities, authentication and isolated-service setup were not executed. The installed 0.160.0 schema supplied the current method and field shapes.

## New evidence by question

| Question | Verdict | What was observed |
| --- | --- | --- |
| G1: concurrent CLI identity | **proven** | Two concurrently driven native threads produced their own exact `CODEX_THREAD_ID`; both inherited the controller's incorrect Herdr pane hint. |
| G2: MCP identity | **proven** | Both workers' MCP `tools/call` requests carried their exact native ID at `_meta.threadId`. |
| G3: synchronous question reconnect | **proven** | A new control connection received the same thread/turn/item, answered it, observed request resolution and turn completion with `Beta`. |
| G4: native async answer completion | **partial** | An async question was emitted, but no answerable server request or correlated native answer completion was observed. |
| G5: tool/stop enforcement | **blocked** | The attempted thread-scoped hook overrides produced no probe hook records. Tool refusal and blocked-stop continuation could not be exercised. |
| G6: restricted MCP socket access | **proven** | The MCP server pinged rt successfully while the native worker reported `workspaceWrite` with `networkAccess: false`. |
| G7: delivery and restart | **partial** | Native consumption matched the submitted client ID on an owned thread and item. Restart and survival remain unobserved. |

### G1 and G2: caller binding

G1 selects `attribution-05`; G2/G6 select `attribution-06`. Workers were created through `thread/start` on the existing control endpoint and attached to disposable Herdr panes using `codex --remote unix://<control-socket> resume <thread-id>`. This proves that managed launch arrangement; default CLI launches are not assumed equivalent.

CLI calls carried distinct native IDs despite identical inherited pane hints. Herdr environment values remain hints, not caller identity.

For MCP, the stdio recorder read `tools/call.params._meta` directly. Its tool input schema accepts only `marker`, with additional properties disallowed. The exact `_meta.threadId` equals the independently recorded `thread/start` ID for each worker; native MCP item events separately corroborate the thread and tool call. The process environments contained no `CODEX_THREAD_ID`, so environment-only MCP binding is not established, even though the two MCP processes had distinct PIDs.

The first automated G2 result was conservatively `partial` because no metadata path had yet been identified. Inspecting those same raw calls established host provenance and the exact `threadId` key; the pure judge reclassified that evidence as `proven`. The original result remains in `runs`; the explicit selection is in `selectedResults`. No additional live attribution run was performed for that reclassification.

The adapter may consume this host transport field. That does not authorize trusting a thread ID supplied in ordinary tool arguments, nor does it settle cross-client spoofing/security acceptance for the future production MCP endpoint.

### G3: reconnect and resolution

The initial blocking request and the replay had the same `threadId`, `turnId` and `itemId`, with `isBlocking: true`. The connection UUID changed. The native numeric request ID happened to remain `1`; numeric-ID changes are covered by the probe regression test, not claimed as a live observation.

After `thread/resume`, status included `waitingOnUserInput`. The new connection sent the answer using the replayed request, not the stale connection's request object. `serverRequest/resolved`, the exact turn's final `Beta` agent message and `turn/completed` were observed. The synchronous question was not emitted as a separate completed item in this stream; its completion evidence is request resolution plus the correlated answer and completed turn.

Other owned observers and the attached terminal remained connected. This proves recovery of the bridge connection, not recovery after all clients disappear or the server restarts.

### G4: async emission is not answer completion

The worker emitted an `agentMessage` with `delivery: "async"`, `questions`, and a native item ID. That item's `item/completed` event happened before any answer. It signifies emission, not completion of the user's answer workflow.

No `item/tool/requestUserInput` server request was exposed for this async question during the 90-second observation window. The installed client-request schema contains no dedicated question-answer client method. No answer was sent through steering or queueing to manufacture a pass. A native UI-specific answer path may exist; this experiment does not prove its absence. Unattended async gates remain unsupported until a correlated completion path is demonstrated.

### G5: attempted scoped configuration did not enforce

The disposable thread received `features.hooks: true` and `hooks.PreToolUse`, `hooks.Stop`, `hooks.SessionStart` through `thread/start.config`. Hook commands pointed only at probe scripts and policy files in its ignored run directory.

`hooks/list({cwds: [workerCwd]})` returned no matching probe hooks and no errors. This API accepts cwd, not thread ID; its inventory alone cannot establish whether per-thread overrides loaded. More decisively, the allowed CLI control completed with its marker while no probe hook recorded any event. Existing user SessionStart activity was observed, showing that the service had hook activity, but it does not establish the requested scoped policy.

Therefore the forbidden-tool and blocked-stop tests were not attempted; their false flags mean **unobserved**, not that denial was tested and failed. G5 is blocked at its loading/configuration prerequisite. Do not conclude that Codex lacks hooks generally. The [official hook documentation](https://learn.chatgpt.com/docs/hooks) describes config-layer discovery and exact-definition trust; this run changed neither global configuration nor persisted trust and did not bypass trust. The supported worker-scoped loading/trust arrangement still needs proof.

### G6 and G7: socket boundary and consumption

G6 used the host-launched stdio MCP process, outside the worker's shell sandbox. It performed only a read-only rt ping. `thread/resume` returned effective `workspaceWrite` settings with network disabled and the owned run directory as the additional writable root. This establishes an MCP route without broadening the worker sandbox; it does not assert that MCP children themselves run under that sandbox.

The only tools approved in thread-scoped MCP configuration were `probe_whoami` and `probe_rt_ping`. This was needed because the earlier run refused MCP calls under approval policy `never`. No global approval policy was changed.

G7 submitted `thread/queue/add` with `clientUserMessageId`. The consumed `userMessage` arrived through `item/started`, carrying that exact value as `item.clientId`, plus native thread, turn and item IDs. Queue acceptance alone was not used as proof. The resulting turn was interrupted during cleanup after consumption; completed model action is not a G7 claim.

## Controls repeated and why

- A READY turn initialized each new native thread. A freshly started thread has no readable/resumable rollout before its first turn in the tested build.
- G3 created a pending synchronous question so the bridge could disconnect and recover it.
- G5 ran one harmless allowed CLI command to check hook activity and identify the actual native tool name if the hook executed.
- G7 queued one message to observe consumption. The idle/busy delivery matrix and rt restart tests were not repeated.
- Initial setup failures were retained: Herdr returns empty stdout for a successful pane run; the default CLI thread was not loaded on the inspected shared endpoint; `--add-dir` is rejected with `--remote`; reading a new thread before its first rollout fails; and MCP tools needed explicit scoped approval. A failure to set up a probe was not classified as a native capability failure.

## Native fields and configuration available to re-planning

- CLI caller: exact `CODEX_THREAD_ID`; MCP caller: host `tools/call.params._meta.threadId`.
- Native launch: `thread/start` with owned cwd, supported config, runtime workspace roots; first turn before terminal attach. Explicit remote CLI attach is the tested arrangement.
- Synchronous form: `item/tool/requestUserInput`, `threadId/turnId/itemId`, connection-local request ID, `thread/resume` replay, native response, then `serverRequest/resolved` and completed turn.
- Delivery: experimental `thread/queue/add.clientUserMessageId` → owned `item/started` user message → `item.clientId` and native item ID.
- MCP permissions: `mcp_servers.harness_probe.tools.<tool>.approval_mode = "approve"`, limited to the two disposable probe tools; effective sandbox was inspected.

The [app-server documentation](https://learn.chatgpt.com/docs/app-server) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) supplement the installed schema and recorded behavior. Inferred production adapter choices still require implementation and acceptance tests.

## Deferred restart acceptance

Daemon restart, queued-message survival, pending-question survival, replay deduplication and recovery after all consumers disconnect remain unobserved. G7 is intentionally at most `partial`. A separately agreed disruption window or explicitly scoped acceptance environment is required before testing a daemon restart. No persistence guarantee follows from the consumption event.

## Cleanup

All **16 owned Herdr workspaces** from successful and failed attempts were closed and independently absent from the workspace listing. All **11 identified native threads** were inspected: idle, not loaded, or explicitly reported as not loaded. No inspected owned thread was active. The G7 turn was interrupted using its exact owned thread/turn pair. Earlier diagnostic pane-read failures remain visible in their original reports; they did not prevent workspace closure.

Normal native session history and ignored run artifacts remain for inspection. Existing user sessions and shared daemon processes were left running. The spike does not claim exhaustive discovery of native IDs from failed default-CLI startup attempts before explicit thread binding; their owned workspaces were closed.

## Verification and decision

Probe unit tests: **21 passed, 0 failed**. TypeScript check and repository purity check passed. The full root test suite is being recorded separately; final outcome will be appended before handoff. No production source or dependency changed.

G1/G2/G3 passed; **G5 did not pass**. Revise the spec's **Capabilities and compatibility**, **Questions and gates**, **Setup and application adoption**, and **Verification and release criteria** to make the supported scoped policy-loading/trust mechanism and its enforcement proof explicit. M6/S4 require that evidence before managed Codex can satisfy the full workflow profile. G4's async limitation and G7's restart gaps must remain explicit in the next planning pass. F2 and later remain provisional and unexecuted.
