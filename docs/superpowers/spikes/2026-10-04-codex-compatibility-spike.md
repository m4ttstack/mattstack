# Mattstack Codex compatibility spike

**Date:** 2026-10-04. **Source:** `7538cfe5c`. **Tested:** Codex 0.160.0,
Claude Code 2.1.289, Herdr 0.9.3.

Mattstack can support Codex chat and gates while keeping the interactive CLI
inside Herdr. Live tests demonstrated message delivery, reading an rt chat
message, consuming an externally stored gate answer, answering a native Codex
question, and resuming the same thread in another pane. Production integration
still needs provider-neutral session identity, delivery and question adapters.
Changing the herd launcher alone would leave those dependencies broken.

These are spike findings and recommendations, not a new governing architecture
or a claim that production Codex workers are supported.

The follow-up [integration design](../specs/2026-10-04-harness-integrations-design.md)
develops the suite-wide architecture from these results and the
[dependency audit](2026-10-04-codex-dependency-audit.md).

## Earlier work recovered

- The September 21 Codex session “Compare Codex agent protocols,” ID
  `01a0c475-60bc-7c51-9971-0ded7d7a6f1d`, contains the broader discussion.
  Its direction was to retain Herdr and avoid requiring a separately managed
  App Server merely to launch a worker.
- The narrower [Codex provider design](../specs/2026-09-15-rt-agent-codex-provider-design.md)
  and [implementation plan](../plans/2026-09-15-rt-agent-codex-provider.md)
  cover `rt agent`; that launch capability already exists.
- [RT-405](https://linear.app/mattstack/issue/RT-405),
  [RT-406](https://linear.app/mattstack/issue/RT-406) and
  [RT-408](https://linear.app/mattstack/issue/RT-408) track related session
  handlers, session context and delivery routing. Extend those seams across
  providers rather than creating a parallel Codex subsystem.
- [Architecture](../../architecture.md) links the governing Linear documents.
  The [September gate spike](2026-09-03-gate-delivery-spike.md) remains useful
  evidence for Claude's form-blocked inbox behavior.

## Live results

The experiment used an isolated rt daemon and Herdr server. Agent processes
used the user's regular HOME and authentication. Claude used an existing
authenticated cswap profile without switching the default account. All messages
and gates belonged to disposable workers. No production daemon was restarted.

| Experiment | Observed result |
| --- | --- |
| Herdr prompt to idle Codex | Worker executed the requested marker command. |
| Herdr prompt during a Codex tool call | Input queued and was consumed at a subsequent tool boundary. |
| Herdr prompt with a pending async question | Herdr refused with `agent_blocked`. |
| Native queue to idle Codex | Started work and produced the marker. |
| Native queue during a tool call | Queue contained the submission; worker later produced its marker. |
| Native queue with a pending async question | Accepted but remained queued. It ran after the blocked turn was released. |
| Native steering during that async wait | Woke the worker. Initial gate read then failed on sandbox socket access. |
| External rt answer read by Codex | With network access enabled in its workspace sandbox, worker read stored `Beta` and recorded the corresponding marker. |
| Native synchronous Codex question | Attached bridge received `item/tool/requestUserInput` with `isBlocking: true`; committed `Beta` to rt, read it back, answered that request ID, and observed final answer `Beta.` and turn completion. |
| Stored rt chat message plus native notification | Worker read the isolated room through rt and recorded the marker found in the stored message. |
| CLI replacement and resume | Closed original test pane, resumed the explicit thread ID in a new pane, and verified the same `CODEX_THREAD_ID`. Signing into rt again returned the same chat identity. |
| rt gate durability | First answer won; answer-before-wait returned immediately; a blocking wait returned after answering; stored answer survived an isolated rt daemon restart. |
| Claude baseline | Real inbox frame reached the authenticated worker and produced its marker. |

The native client connected to the existing Codex control socket using the
documented WebSocket upgrade over Unix sockets. This did not require replacing
the Herdr terminal UI or starting another authenticated App Server. A probe
sending JSONL directly to that socket failed; JSONL is the stdio framing.
[Official transport documentation](https://learn.chatgpt.com/docs/app-server).

The tested `thread/queue/*` methods appear in the installed CLI's experimental
schema and require experimental API opt-in. Acceptance is distinct from
consumption: an idle thread drains immediately, a busy thread defers work, and a
pending question can hold it. No queue persistence or deduplication guarantee
was established.

## Two additional integration problems

**Session identity cannot depend on inherited pane variables.** In this shared
Codex server configuration, the test worker's commands correctly received their
own `CODEX_THREAD_ID`, but received the controller's `HERDR_PANE_ID` and
`HERDR_SOCKET_PATH`. The mismatch persisted after resuming in another pane.
Claude's command received its actual test pane and socket. Herdr detected the
Codex worker and status but did not return `agent_session` in the observed
responses. This is an observed environment mismatch, not a claim about every
Codex deployment or a proven internal cause.

The adapter should maintain an explicit binding from provider session to rt
agent/job and Herdr pane/socket, with a generation updated on replacement.
`HERD_ID`, `HERD_JOB`, gate context and MCP session context need the same audit;
this experiment did not establish that arbitrary launch variables reach each
shared-server worker correctly.

**Workspace write access does not imply socket access.** The default test
sandbox denied the Unix connection to rt. Enabling network access in that
worker's workspace sandbox allowed the same command to succeed. Production
needs a supported MCP or socket permission arrangement; changing the prompt
cannot fix this. The experiment did not select a production permission policy.

## Recommended integration

Keep Herdr as the worker surface. Put provider-specific operations behind the
session and delivery seams already planned in Linear:

1. **Session context and binding.** Resolve Claude sessions and Codex threads
   into a common context containing provider, session ID, rt agent/job and
   current pane binding. Reserve a herd worker identity before launch, then
   bind the real provider session once known. Resume retains identity; a new
   session does not silently inherit it.
2. **Message delivery.** Retain Claude's inbox adapter. Add a version-checked
   Codex adapter using its native control protocol, with explicit queued,
   accepted, consumed and unavailable distinctions. Use Herdr prompt as a
   capability-limited fallback: the test proves idle/working delivery, but
   also its refusal at a question. Keep peer-message provenance in the input;
   a message does not grant authority.
3. **Gate presentation and completion.** Keep rt's gate row authoritative.
   Bind a gate to the Codex thread, native request and question IDs. Commit
   and read the winning rt answer before completing the native request.
   Separate this from ordinary chat delivery. Async question steering worked
   as a wake mechanism here, but was not proof of native question dismissal.
4. **Mixed herd workers.** Add and persist a per-job provider, preserving it on
   retries and respawns. Route launch, identity, model/effort validation and
   gate hooks through the selected adapter. Enable Codex jobs only after
   those capabilities are available. Both CLIs ran concurrently in Herdr in
   this spike; the production shepherdr lifecycle was not exercised.
5. **Skills, plugins and permissions.** Audit Claude-specific question tools,
   background-command completion assumptions, hook names, skill-path
   variables and installation flow. Do not infer incompatibility merely
   from a Claude plugin manifest: current OpenAI documentation describes
   [submitting Claude Code plugins](https://developers.openai.com/plugins/guides/submit-claude-plugin).

Concrete implementation locations:

| Location | Current coupling |
| --- | --- |
| `lib/daemon/handlers/herd.ts` | Worker launch explicitly pins `provider: "claude"`. |
| `lib/daemon/handlers/agent.ts` | Codex session capture is delayed; Claude gate hook injection is skipped for Codex. |
| `lib/mcp/shared.ts` | Worker and chat context read `CLAUDE_CODE_SESSION_ID`. |
| `lib/claude-registry.ts`, `lib/daemon/inbox.ts` | Session discovery and delivery assume Claude registry rows and inbox frames. |
| `lib/daemon/inject.ts` | Refuses non-Claude panes and uses Claude composer handling. |
| `lib/daemon/gate-push.ts` | Gate notices and form handling use Claude transport assumptions. |

## Remaining acceptance work

- Reconnect the adapter while a native question is already pending. The
  successful synchronous test attached before creating the question; replay
  and ownership after reconnect remain unproven.
- Exercise duplicate deliveries, racing console/pane answers through the
  complete adapter, dead sessions, stale pane bindings and backpressure.
- Verify recovery across a Codex server restart. This spike replaced a CLI
  pane and restarted rt separately, but deliberately retained the normal
  Codex server.
- Validate background wait completion in Codex, attended and unattended skill
  flows, MCP context isolation, and fork/clear semantics.
- Run an actual mixed shepherdr workload through assignment, reporting,
  retry, gate completion and teardown.
- Test the console UI. This spike called its `gate:answer` daemon operation
  with `by: "console"` and `override: true`; it did not click through a browser.

## Evidence and cleanup

[Evidence summary](2026-10-04-codex-compatibility-evidence.json) preserves the
verified markers, versions and scope limits. The verifier checked eleven
markers, native form completion, blocked Herdr refusal, chat identity
continuity and four daemon assertions. Raw scripts and traces remain locally
under `/tmp/mcs-pr43afb6`; those temporary files are not the durable record.

Disposable worker workspaces and isolated rt/Herdr servers were stopped. No
production implementation, account switch, commit or release was made.
