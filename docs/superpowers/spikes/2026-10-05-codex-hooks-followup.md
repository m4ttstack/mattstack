# Codex hooks: focused follow-up

**G5 is now proven for the tested native mechanism:** a project-scoped hook refused a synchronous question before it reached the native question API, and a Stop hook forced continuation within the same turn. The original F1 failure remains in its historical evidence. No production integration was implemented; F2 and later still require re-planning.

Executed October 5, 2026 with Codex CLI/server 0.160.0, Herdr 0.9.3, Bun 1.4.2 and gpt-6.1-sol. [Sanitized evidence](2026-10-05-codex-hooks-evidence.json) records exact thread/turn IDs, selected native events, hook decisions, cleanup and raw-artifact hashes. Source base: `e21285af1`, with the remote-resume launcher fix described below. Live controllers and diagnostics remain under ignored `.harness-spike/hooks-followup-01/` and `.harness-spike/hooks-review-01/`.

## What prevented the earlier probes from working

- Earlier pane captures for the attribution, question and policy probes showed native folder-trust prompts. API-driven native turns still ran, but those runs did not establish successful TUI attachment. The original report now states that limit.
- Explicit `codex --remote ... resume <id>` rejects `-s`/`-a` permission overrides. The launcher now omits those flags only for remote resume; `thread/start` still sets the worker sandbox. The regression failed before the fix and passed afterward. The owned terminal successfully attached and displayed this follow-up's history and blocked-stop continuation.
- Project hook discovery required a trusted project boundary. Adding trust for the exact disposable cwd alone left the inventory empty while it was nested in the surrounding Git worktree. Initializing an empty Git repository in that cwd, without broadening trust, made both hooks appear as untrusted. This establishes a working narrow arrangement; it does not fully characterize Codex's project-root selection rules.
- Trusting each discovered exact hook hash made both inventory entries enabled and trusted. The already-loaded worker still produced no hook records after resume. A fresh owned thread in the same cwd loaded and executed both hooks. Production setup must verify actual execution and define when workers must be recreated; inventory alone is insufficient.

Codex documents project-layer discovery and trust of exact hook definitions in its [hook reference](https://learn.chatgpt.com/docs/hooks). Malformed scoped values for `hooks`, `hooks.Stop`, `hooks.state` and `features.hooks` produced native type errors during diagnosis; these keys were recognized. The earlier empty inventory was not evidence that Codex lacked hooks.

## What ran

The user explicitly approved temporary trust for the exact disposable folder and two reviewed definitions in `.harness-spike/hooks-review-01/worker/.codex/hooks.json`. Those definitions invoke `scripts/probes/harness/probe-hook.ts`, log locally and read controller-owned test policies. Only three marked blocks were appended to the regular Codex config: one exact folder trust and two exact hook hashes. No hook-trust bypass or shared-service reload/restart was used.

The fresh worker retained `workspaceWrite`, network access disabled and the owned run directory as its additional writable root. Its native approval policy remained `never`. Hooks execute through Codex's host hook mechanism; this does not imply hook processes inherit the worker shell sandbox.

| Probe | Recorder and native evidence | Result |
| --- | --- | --- |
| Allowed synchronous question | `PreToolUse` saw `tool_name: request_user_input`, exit 0; native blocking request arrived; controller answered Beta; same-connection request resolution, final Beta and completed turn followed | Passed |
| Refused synchronous question | Same native tool name, exit 2; native `hook/completed` reported `preToolUse: blocked`; no `item/tool/requestUserInput` request occurred in that turn; worker emitted REFUSED and completed | Passed |
| Blocked Stop | DONE → native Stop blocked → CONTINUED → native Stop completed → turn completed, all on one exact owned thread/turn; recorder exits were 2 then 0 | Passed |

Hook stdin supplied both `session_id` and `turn_id`, so recorder decisions bind directly to the native thread/turn. This follow-up's assertions use the exact IDs. The historical helper retains its timestamp checks; its comment was corrected to avoid claiming hook stdin lacks a turn binding.

The native question refused here is `request_user_input`. This does not establish interception or completion of the distinct asynchronous question path. The policy was synthetic: real Mattstack gate creation, gate-state lookup, authoritative resolution, pipeline state and hostile worker behavior still need integration acceptance tests. The hook loader and refusal/continuation mechanism, rather than that production policy, are what G5 now proves.

## Consequences for the implementation plan

G1, G2 and G3 from F1 plus this G5 result clear the spike's four runtime gates. Re-plan the provisional packages from the combined evidence before executing F2. Incorporate the proven hook installation/trust lifecycle into the spec and M6/S4; do not assume `thread/start.config` overrides or a resume alone install policy.

- Keep shared Mattstack workflow policy separate from the Claude and Codex hook/transport adapters.
- Verify required hooks are trusted and actually execute before assigning managed work; refuse readiness when that prerequisite is missing.
- Treat native confirmed turn completion as authoritative. A final-looking DONE message can precede a blocked Stop and continuation.
- Use synchronous native questions for the proven gate path. G4 async answer completion remains partial, and G7 daemon-restart/persistence acceptance remains deferred.
- Preserve exact thread/turn binding and reconnect semantics. This run does not settle all-client disconnect, restart recovery, general default-CLI equivalence or policy tamper resistance.

## Cleanup and verification

All three temporary trust blocks were removed. The exact project entry and both hook-state entries were confirmed absent; other config bytes were preserved. The one owned Herdr workspace was closed and independently absent. The original thread was `notLoaded`; the fresh thread was `idle`, and the final inspection connection unsubscribed. No owned turn remained active. Regular HOME/authentication were used throughout, and shared services and unrelated sessions were left running.

Verification: **25 focused tests passed, 0 failed, 81 assertions**. TypeScript, repository purity and `git diff --check` passed. The follow-up evidence assertions independently checked the allowed/refused question outcomes and exact Stop sequence against raw native events and hook stdin IDs. The earlier full root suite's unrelated failures remain documented in the F1 report; this follow-up does not certify that suite as green.

Independent review approved the focused follow-up with no outstanding Critical, Important or Minor findings. The reviewer matched every published raw-artifact hash, checked both question outcomes and the exact Stop sequence, confirmed the temporary trust entries were absent, and verified the historical attachment/status corrections. Preservation of unrelated pre-run config bytes rests on the cleanup script's exact-block removal assertion; no full config snapshot was retained. Production enforcement/tamper resistance and deferred restart acceptance were outside the review verdict.
