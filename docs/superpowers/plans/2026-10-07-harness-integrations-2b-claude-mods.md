# Claude Mods Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Claude's side of the harness-neutral layer on a Claude Code mod, rebuild the finished Claude adapters on it, and keep today's mechanisms as the per-feature fallback.

**Architecture:** One plugin, `plugins/mattstack-mods`, whose core owns every engine hook and links to the daemon over `rt.sock`. Feature blocks subscribe to the core. The daemon keeps an in-memory registry of live mod links and the blocks each one reports; every Claude adapter checks its block before choosing the mod path or today's path.

**Tech Stack:** Claude Code mods API (2.1.293 types), TypeScript, Bun/TypeScript daemon and CLI, SQLite session store, Bun tests, `claude plugin validate` and `claude plugin test`.

**Spec:** [Claude mods design](../specs/2026-10-07-harness-integrations-claude-mods-design.md), which amends the [main design](../specs/2026-10-04-harness-integrations-design.md). Evidence: [mods-01](../spikes/2026-10-07-mods-01-results.md), [mods-02](../spikes/2026-10-07-mods-02-results.md).

## Global Constraints

Inherit the [parent plan](2026-10-04-harness-integrations.md), its shared
types and every finished F and M task. This package runs after M5c and before
M6a.

- With `agent.integrations.enabled` off, nothing loads: "today's bytes and timing".
- "Every Claude adapter contract has a mod path, proven live in a real pane"; "each feature falls back to today's path on its own".
- "older Claude Code, `claude -p`, Codex panes and sessions outside the tested Claude Code range behave as today".
- A block counts as live only while the link is: heartbeat every 10 s, blocks clear after 30 s without one.
- Long waits are chained `events:wait` rounds of 25 s or less carrying a cursor; `$.http.fetch` is cut off at 30 s.
- The mod's context record "is a hint to the shared resolver and never grants authority".
- "Errors inside a block pass the call through, as if the mod were not there, and clear that block for the session."
- Mod block names, exactly: `delivery`, `gate-form`, `gate-wait`, `gate-panel`, `presence`, `policy`, `stop-gate`, `relocation`, `observe`. They are Claude-internal; the shared `Capability` type does not change.
- No `SCHEMA_VERSION` bump: link and block state is in-memory in the daemon. Persisted changes are C2's session-store operation, C6's delivery evidence and C9's completion `path` column (a guarded `ALTER` in `gates-store.ts`'s own migration block, in `gates.db`).
- Every live check from C3 on runs against a sandboxed foreground rt daemon under its own HOME, with the pane's `RT_DAEMON_SOCK` and `rt` pointed at it, as in `.harness-spike/live-01/report.md`. Never the real daemon.
- A shell hook never decides whether the mod owns a feature. The rt verb the hook already calls checks `modPath` in-process and no-ops when the block is live. With the switch off that check is a settings read inside a process that already runs, so nothing new is spawned.
- Frozen fixtures (`chat-bytes.json`, `agent-verbs-bytes.json`, `herd-pane-agent-bytes.json`) are never regenerated.
- Every task's live check runs in a dedicated `claude --plugin-dir plugins/mattstack-mods` pane under Matt's login in a throwaway repo, with the mods-01 rules: no plugin installs, no settings edits, Matt accepts any trust prompt himself, and the controller removes that trust key afterwards.
- Targeted tests only, from the repo root. Run `bun run typecheck` before each commit.

## Review Focus

- A daemon restart mid-wait: the round fails with ECONNRESET, and the link must resume from its cursor without losing or repeating an event (C3).
- A daemon restart drops every in-memory link: the next heartbeat answers "unknown link", and the mod must re-register with the same session id and blocks rather than fall back for good (C3).
- `/clear` while a gate form is up or a wait is armed: the new session id must keep the gate, the binding key and the sign-in (C2, C8).
- The mod hangs without throwing: no heartbeat, so blocks clear within 30 s and every adapter falls back (C2, C5).
- A board answer and a pane answer arrive within milliseconds: the gate service picks one winner and the dialog shows that one (C9).
- The switch is turned off while sessions are running: the daemon refuses and clears, and loaded mods pass everything through (C2, C4).

## File structure

`plugins/mattstack-mods/` is the plugin. `src/core/` holds the hub (hook
ownership and block registry), the link (daemon client, heartbeat, rounds) and
the version gate. `src/blocks/` holds one file per block. `hooks/register.ts`
is the only module `hooks.json` names; it builds the hub and registers blocks.
`tests/` holds `claude plugin test` cases with a stubbed `$`.

On the rt side, `lib/agent-integrations/claude/mod-links.ts` is the daemon's
in-memory link registry, `lib/daemon/handlers/mod-session.ts` exposes its
verbs, and `lib/agent-integrations/claude/mod-path.ts` is the one helper every
Claude adapter calls to choose a path.

### C1: Scaffold the plugin, its core hub and its CI job

**Files:** Create `plugins/mattstack-mods/.claude-plugin/plugin.json`,
`plugins/mattstack-mods/hooks/hooks.json`, `plugins/mattstack-mods/hooks/register.ts`,
`plugins/mattstack-mods/src/core/hub.ts`, `plugins/mattstack-mods/src/core/blocks.ts`,
`plugins/mattstack-mods/src/core/version.ts`, `plugins/mattstack-mods/types/index.d.ts`,
`plugins/mattstack-mods/tests/hub.test.ts`, `plugins/mattstack-mods/README.md`;
modify `marketplace/marketplace.json`, `.github/workflows/checks.yml`.

**Interfaces:**
- `type ModBlock = "delivery" | "gate-form" | "gate-wait" | "gate-panel" | "presence" | "policy" | "stop-gate" | "relocation" | "observe"` in `blocks.ts`, also exported for rt as described in C2.
- `createHub(): Hub` with `block(name: ModBlock, start: ($) => Promise<void>)`, `onToolCall(rule: ToolRule)`, `onReceive(kind: string, handler: ReceiveHandler)`, `onStop(handler: StopHandler)`, `onLifecycle(event: "session-start" | "session-clear" | "turn-start" | "turn-end" | "session-end", handler)`, `onRender(component: string, handler)`, `section(id: string, text: () => string | null)`, and `liveBlocks(): ModBlock[]`.
- `ToolRule = { stage: "fill" | "guard" | "permit" | "tap"; tool: string | RegExp; run($, e) }`, applied in the order fill, guard, permit, call, tap.
- `MIN_CLAUDE_CODE = "2.1.293"` and `supportedEngine(version: string): boolean` in `version.ts`.

- [ ] Write `hub.test.ts` cases: `a throwing block is cleared and the call passes through`; `rules run fill, guard, permit, call, tap`; `a guard refusal returns its reason`; `an unmatched delivery reaches next unchanged`; `liveBlocks lists only blocks whose start resolved`; `an engine below MIN_CLAUDE_CODE starts no block`. Assert, for the throwing block, that `next(e)` was called with the original event and `liveBlocks()` no longer lists it.
- [ ] Run `claude plugin validate plugins/mattstack-mods` and `(cd plugins/mattstack-mods && claude plugin test)`; expect the new cases to fail.
- [ ] Implement the hub so it owns one engine hook per event (`tool.call`, `tool.check`, `session.receive`, `classic.Stop`, `session.start`, `classic.SessionStart`, the turn events, `ui.render`, `prompt.compose`) and fans out to subscribers. Wrap every subscriber in try/catch: on a throw, log through `$.ui.log` in debug only, clear that block and pass the event through. Read the engine version from the field the 2.1.293 types expose on `$.session` (look it up in the laid-in types; record which field in the README).
- [ ] Add `{"name": "mattstack-mods", "source": "./plugins/mattstack-mods", "description": "Claude Code mod for the mattstack harness integrations; installed by rt only when agent integrations are on."}` to `marketplace/marketplace.json`. Add a `plugin-mattstack-mods` job to `checks.yml`, gated like `plugin-mattstack` on `,plugins/mattstack-mods,`, running the version-bump check, an install of Claude Code pinned to 2.1.293, `claude plugin validate` and `claude plugin test`. No workflow installs Claude Code today, so first confirm on an ubuntu runner (a draft PR) that validate and test run without a login; if they need one, run them on the macOS CI path instead and record why. Add it to the `checks` gate's `needs` and its result check; `scripts/__tests__/no-plugin-ci-jobs.test.ts` enforces both.
- [ ] Rerun the plugin checks and `bun test scripts/__tests__/no-plugin-ci-jobs.test.ts`; expect green.
- [ ] Live check: load the plugin in a pane, confirm the session starts, a tool call and a delivery pass through unchanged, and a deliberately throwing test block is cleared without breaking the session. Record it in `.harness-spike/mods-c1/report.md`.
- [ ] Commit `feat: scaffold the mattstack-mods plugin and its core hub`.

### C2: Daemon link registry and session verbs

**Files:** Create `lib/agent-integrations/claude/mod-links.ts`,
`lib/daemon/handlers/mod-session.ts`,
`lib/agent-integrations/__tests__/mod-links.test.ts`,
`lib/daemon/__tests__/mod-session-handlers.test.ts`,
`lib/agent-integrations/__tests__/mods-plugin-parity.test.ts`;
modify `lib/agent-integrations/session-store.ts`,
`lib/daemon/command-router.ts`, `packages/rt-client/src/commands.ts`,
`packages/rt-client/src/agent-integrations.ts`.

**Interfaces:**
- `MOD_BLOCKS` and `type ModBlock` in `packages/rt-client/src/agent-integrations.ts`, identical to C1's list. `lib/agent-integrations/__tests__/mods-plugin-parity.test.ts` (created here; C7 extends it) imports the plugin's `blocks.ts` and asserts the two lists match.
- `TESTED_CLAUDE_CODE = { min: "2.1.293", max: "2.1.293" }`.
- `createModLinks(deps: { now(): number; integrationsEnabled(): boolean; store: SessionStore }): ModLinks`, with:
  - `register(input: { sessionId: string; previousSessionId?: string; cwd: string; root: string; pane?: string; claudeCode: string; plugin: string; blocks: ModBlock[] }): Outcome<{ linkId: string; blocks: ModBlock[] }>`
  - `heartbeat(linkId: string): Outcome<void>`
  - `end(linkId: string): void`
  - `live(sessionId: string, block: ModBlock): boolean`
  - `linkOf(sessionId: string): ModLinkView | null`
  - `sweep(): number`
- `continueNative(key: string, expectedGeneration: number, next: NativeSessionRef): Outcome<SessionBinding>` on `SessionStore`: changes `native_value`, keeps `key` and `identity`, and advances `generation`.
- Daemon verbs: `session:register`, `session:heartbeat`, `session:end`, `session:ack`. Payload types go in `Commands`.

- [ ] Write `mod-links.test.ts`:
  - `blocks clear 30 s after the last heartbeat`;
  - `switch off refuses register and clears existing links`;
  - `an engine outside the tested range registers with no blocks`;
  - `a link-reported id change keeps the binding key and identity and advances the generation`;
  - `an id change without a live link from the old id registers fresh, with no continuation`;
  - `two links for one session id: the newer wins and the older stops counting`.
  Assert with an injected clock: `live(id, "delivery")` is true at 29 s and false at 31 s.
- [ ] Write `mod-session-handlers.test.ts`: each verb validates its payload, returns `{ ok: false }` for an unknown link, and `session:register` with the switch off returns `failure: { code: "refused" }`.
- [ ] Run `bun test lib/agent-integrations/__tests__/mod-links.test.ts lib/daemon/__tests__/mod-session-handlers.test.ts lib/agent-integrations/__tests__/session-store.test.ts`; expect red.
- [ ] Implement. `sweep()` runs on the daemon's existing reconcile interval and on every `live()` read. `register` with `previousSessionId` calls `continueNative` only when a live link already holds the previous id. A session with no binding still registers: blocks are keyed by native session id, and adapters only ask about sessions they hold a binding for.
- [ ] Rerun the suites; expect green. Run `bun run typecheck`, then `bun run build` in `packages/rt-client`.
- [ ] Commit `feat: daemon registry for Claude mod links`.

### C3: The core's daemon link

**Files:** Create `plugins/mattstack-mods/src/core/link.ts`,
`plugins/mattstack-mods/src/core/rpc.ts`, `plugins/mattstack-mods/tests/link.test.ts`;
modify `plugins/mattstack-mods/hooks/register.ts`, `plugins/mattstack-mods/types/index.d.ts`.

**Interfaces:**
- `daemonSocket($): Promise<string>` returns `RT_DAEMON_SOCK` or `$HOME/.mattstack/rt/rt.sock`, the rule in `packages/rt-client/src/transport.ts:48`.
- `call<T>($, verb: string, payload: unknown, timeoutMs?: number): Promise<Outcome<T>>` does `POST http://localhost/<verb>` with `socketPath`, with timeouts capped at 25 000 ms.
- `createLink($, hub): Link` with `start()`, `onCommand(kind: string, handler: (cmd: { id: string; kind: string; data: unknown }) => Promise<void>)`, `wait(pattern: string, after: number, until: (events) => boolean, signal: AbortSignal): Promise<{ cursor: number; events: unknown[] }>` and `linkId(): string | null`.
- `$.state` keys under `mattstack-mods`: `linkId`, `context`, `sectionComposed`.

- [ ] Write `link.test.ts` with a stubbed `$.http.fetch`:
  - `registers on start with the live blocks`;
  - `re-registers after classic.SessionStart source clear with previousSessionId`;
  - `heartbeats every 10 s from $.clock.every`;
  - `ends on session end`;
  - `a wait chains rounds of at most 25 s and passes the cursor`;
  - `ECONNRESET retries the round with the same cursor`;
  - `an unknown-link answer to a heartbeat or a wait re-registers with the same session id and blocks`;
  - `a refused register leaves every block off`;
  - `a command delivery is consumed, routed to its handler and acked with session:ack`.
- [ ] Run `(cd plugins/mattstack-mods && claude plugin test)`; expect red.
- [ ] Implement. Recognise command deliveries by an envelope the daemon writes (`<rt-mod-command id="…" kind="…">json</rt-mod-command>` inside the inbox frame) and consume them in `session.receive` before the delivery router sees anything. Add `pushModCommand(sessionId, kind, data): Promise<Outcome<{ acked: boolean }>>` on the rt side in `mod-links.ts`. It writes that envelope through `deliverToInbox` and waits up to 5 s for `session:ack`.
- [ ] Rerun the plugin tests and the C2 suites with a `pushModCommand` case added.
- [ ] Live check: launch the pane with `RT_DAEMON_SOCK` pointing at a sandboxed foreground daemon (own HOME; never the real daemon). Confirm the pane registers, heartbeats, re-registers after `/clear`, consumes a pushed test command with no model turn, and survives a restart of that sandboxed daemon, both by retrying a wait with its cursor and by re-registering after the "unknown link" answer. Report in `.harness-spike/mods-c3/report.md`.
- [ ] Commit `feat: core daemon link for the mattstack-mods plugin`.

### C4: Install and remove the plugin with the switch

**Files:** Modify `lib/setup/steps/plugins.ts`, `lib/setup/base-plugins.ts`;
create `lib/setup/__tests__/mods-plugin-install.test.ts`.

**Interfaces:** `modsPluginWanted(): boolean` returns `integrationsEnabled()`, so `plugins.install` adds `mattstack-mods@mattstack` while it is true. When it is false, the step removes the plugin only if setup-state records that rt installed it.

- [ ] Write the cases:
  - `switch on installs and enables mattstack-mods`;
  - `switch off removes it when rt installed it`;
  - `switch off leaves a user-installed copy alone`;
  - `a user who disabled it is not re-enabled`;
  - `repeat runs are idempotent`.
- [ ] Run `bun test lib/setup/__tests__/mods-plugin-install.test.ts lib/setup/__tests__/update-safe.test.ts`; expect red on the new file.
- [ ] Implement inside the existing update-safe `plugins.install` step. Do not add a new step id, so `UPDATE_SAFE` is unchanged.
- [ ] Rerun both suites, plus the plugins step's existing tests and `commands/__tests__/setup-copy.test.ts`. Update snapshots only if a row's copy legitimately changed, and say so in the commit.
- [ ] Commit `feat: install the mods plugin only while agent integrations are on`.

### C5: Choose the mod path per feature; sessions and attribution

**Files:** Create `lib/agent-integrations/claude/mod-path.ts`,
`lib/agent-integrations/__tests__/claude-mod-path.test.ts`;
modify `lib/agent-integrations/claude/sessions.ts`, `lib/agent-integrations/context.ts`,
`lib/daemon/handlers/mod-session.ts`.

**Interfaces:**
- `modPath(binding: SessionBinding, block: ModBlock): boolean` is true only for a Claude binding whose native id has a live link reporting that block. Every Claude adapter calls it, and nothing else reads `mod-links.ts`.
- `session:report` carries `{ linkId, event: "resume" | "compact", context: { cwd, root, pane } }`, and C5 adds it to the handler. A session end is `session:end` only (C2, C3); later tasks add `turn-start`, `turn-end` and `observation` events.

- [ ] Write the cases:
  - `lifecycle comes from the link when live and from the shell path otherwise`;
  - `the mod's context record is a hint: a mismatch with the binding is ignored and logged`;
  - `a cleared block falls back on the next call`;
  - `switch off: resolveCallerContext output is byte-identical to before`.
- [ ] Run `bun test lib/agent-integrations/__tests__/claude-mod-path.test.ts lib/agent-integrations/__tests__/context.test.ts`; expect red.
- [ ] Implement. `session:report` applies lifecycle through the same `applySessionPresence` path `reportClaudeLifecycle` uses, verified against the link instead of process ancestry. `resolveCallerContext` may use the link's `root` and `pane` only to choose among bindings it would already accept; it never adds a binding.
- [ ] Rerun the suites, plus `lib/daemon/__tests__/chat-harness-continuity.test.ts`.
- [ ] Commit `feat: per-feature mod path for Claude sessions and attribution`.

### C6: Delivery router and hidden chat rows

**Files:** Create `plugins/mattstack-mods/src/blocks/delivery.ts`,
`plugins/mattstack-mods/tests/delivery.test.ts`;
modify `lib/agent-integrations/claude/messaging.ts`,
`lib/agent-integrations/delivery-store.ts`, `lib/daemon/handlers/mod-session.ts`,
`lib/agent-integrations/__tests__/messaging.test.ts`.

**Interfaces:**
- `recordConsumedByDeliveryId(db: Database, deliveryId: string, sessionKey: string, generation: number, now: number): Outcome<void>` maps the envelope's `delivery-id` to its frame and calls `settleEvidence` with `consumed`. The handler verb is `session:delivered`.
- `onReceive("rt-delivery", handler)` in the block, matched on the `wrapCrossSession` envelope (`<cross-session-message from-name=… delivery-id=…>`).

- [ ] First, before any production code, run the live check the spec names: in a pane, a test mod passes an envelope through `next` with its text edited. Record whether the model reads the edited text in `.harness-spike/mods-c6/edited-pass-through.md`.
  - If it does, proceed as written.
  - If it does not, switch the router to consume, then `$.prompt.submit` (with `asUser` off). Record that branch in the ledger before continuing, and run the mid-turn check the spec requires.
- [ ] Write `delivery.test.ts`:
  - `an rt delivery is reported delivered once under its delivery id`;
  - `a non-rt delivery passes through untouched`;
  - `a chat delivery row renders hidden and the model text is unchanged`;
  - `with the block off nothing is reported`.
- [ ] Write in `messaging.test.ts`:
  - `a consumed report upgrades submitted to consumed`;
  - `a report for another session or generation is refused`;
  - `a consumed row never reverts`.
- [ ] Run `(cd plugins/mattstack-mods && claude plugin test)` and `bun test lib/agent-integrations/__tests__/messaging.test.ts lib/agent-integrations/__tests__/delivery.test.ts`; expect red.
- [ ] Implement. Hide chat delivery rows through `onRender("UserMessage")` by returning an empty tree for rows the router marked. The transport and `wrapCrossSession` stay unchanged, so `inbox.test.ts` stays green untouched.
- [ ] Rerun the suites, plus `lib/daemon/__tests__/inbox.test.ts` and `lib/daemon/__tests__/chat-delivery.test.ts`.
- [ ] Live check: chat deliveries in a pane are hidden, still answered by the model, visible in ctrl+o, and reported `consumed`. Report in `.harness-spike/mods-c6/report.md`.
- [ ] Commit `feat: Claude delivery router with consumed evidence and hidden rows`.

### C7: Prompt sections and the chat reply rule

**Files:** Create `plugins/mattstack-mods/src/blocks/sections.ts`,
`plugins/mattstack-mods/tests/sections.test.ts`;
modify `plugins/mattstack-mods/src/blocks/delivery.ts`; extend
`lib/agent-integrations/__tests__/mods-plugin-parity.test.ts` (the rt-side
bun test that imports the plugin's `sections.ts` and `blocks.ts`).

**Interfaces:**
- `REPLY_RULE_SECTION` is the rule text, held in the plugin's dependency-free `sections.ts`. An rt-side bun test imports that file and asserts it matches rt's copy, as C2 does for `MOD_BLOCKS`; plugin tests never import rt modules.
- `trimClaudeOnlyReply(text: string): string` removes exactly the `replySteer` tail "(never SendMessage; this arrived through rt chat)" and nothing else.

- [ ] Write the cases:
  - `the section is composed for a new conversation and sets sectionComposed`;
  - `a resumed conversation without the marker keeps the full reply line`;
  - `trim removes only the Claude-only tail`;
  - `Codex delivery bytes are unchanged`;
  - `a session without the block gets today's line`.
- [ ] Run the plugin tests and `bun test lib/agent-integrations/__tests__/mods-plugin-parity.test.ts`; expect red.
- [ ] Implement. The section provider sets the `$.state` marker when it composes for a conversation that starts with it. The router trims only while the marker is set. Keep `trimClaudeOnlyReply` in the plugin's `sections.ts`; the rt-side bun test asserts it removes exactly `replySteer`'s tail from a real `inbox.ts` envelope. Leave `replySteer` itself unchanged.
- [ ] Rerun the suites; `chat-bytes.json` must not change.
- [ ] Live check: after `/clear`, the model replies through chat without the per-delivery tail, and a session started before the plugin loaded keeps the tail. Report in `.harness-spike/mods-c7/report.md`.
- [ ] Commit `feat: reply rule as a prompt section for mod sessions`.

### C8: Presence and sign-in through the session

**Files:** Create `plugins/mattstack-mods/src/blocks/presence.ts`,
`plugins/mattstack-mods/tests/presence.test.ts`,
`lib/agent-integrations/__tests__/claude-mod-presence.test.ts`;
modify `lib/agent-integrations/claude/mod-links.ts`,
`lib/agent-integrations/claude/sessions.ts`, `lib/state/presence-store.ts`,
`lib/daemon/handlers/chat.ts`, `lib/daemon/handlers/mod-session.ts`,
`commands/chat.ts`.

**Interfaces:**
- The presence block reports `session:report { event: "turn-start" | "turn-end" }`; a session end arrives through `session:end` only (C3).
- `mod-links.ts` keeps `modExecution(sessionId): "working" | "idle" | null` in memory from those reports. `null` means no live `presence` block.
- `buddyStatus` (`lib/state/presence-store.ts:182`) derives live and idle from the registry binding's herdr `status` today. Its `RegistryDeps.resolve` consults `modExecution` first and uses herdr's status only when that is `null`. The store gets no new column.
- `session:end` with the presence block live applies `applySessionPresence(binding, "end")`, as the `--ended` path does today.
- Sign-in: when `modPath(binding, "presence")` holds, the Flock button path, `/chat:sign-in` and `rt chat sign-in` send `pushModCommand(sessionId, "chat-sign-in", { room? })`. The mod answers by calling `chat:sign-in` with its own session id and `root()`.
- The `--ended` path in `commands/chat.ts` (`endedSession`, which `session-end.sh` already calls) checks `modPath` in-process and returns quietly when the presence block is live. The chat plugin's hook script is not changed.

- [ ] Write the cases:
  - `turn start and end flip the buddy list between live and idle`;
  - `session end signs out`;
  - `sign-in through the mod uses the session's own id and root`;
  - `sign-in survives /clear through the link continuation`;
  - `an unacked sign-in command falls back once to today's daemon-side sign-in`;
  - `without the block, herdr status and the session-end path are used`;
  - `the --ended path no-ops only while the presence block is live, and is byte-identical otherwise`.
- [ ] Run `bun test lib/agent-integrations/__tests__/claude-mod-presence.test.ts lib/daemon/__tests__/chat-harness-continuity.test.ts lib/state/__tests__/presence-store.test.ts` and the plugin tests; expect red.
- [ ] Implement.
- [ ] Rerun the suites, the chat bytes test and `sh marketplace/plugins/chat/hooks/tests/test-session-end.sh` (unchanged, green).
- [ ] Live check: busy/idle within a second, sign-in from `rt chat sign-in`, the room following EnterWorktree, `/clear` keeping the sign-in, and closing the session signing out. Report in `.harness-spike/mods-c8/report.md`.
- [ ] Commit `feat: presence and sign-in through the Claude mod`.

### C9: The mod owns the gate form

**Files:** Create `plugins/mattstack-mods/src/blocks/gate-form.ts`,
`plugins/mattstack-mods/src/blocks/display.ts`, `plugins/mattstack-mods/tests/gate-form.test.ts`;
modify `lib/agent-integrations/claude/questions.ts`, `lib/daemon/gate-push.ts`,
`lib/daemon/handlers/gate.ts`, `lib/daemon/gates-store.ts`,
`lib/agent-integrations/question-store.ts`, `packages/rt-client/src/commands.ts`,
`lib/agent-integrations/__tests__/claude-questions.test.ts`.

**Interfaces:**
- **The asking session on every gate.** `gateAsk` records the caller's resolved native session id as `origin.session` for every presentation, not only `form`, which already sets `nudge`. `origin` is stored as JSON, so no column is added.
- **New `gate:list` filters.** The payload (`commands.ts:1091`) gains optional `session` (matches `origin.session`) and `presentation` (matches `origin.presentation`). They combine with the existing `open: true`, and every existing caller's results are unchanged.
- **Completion path.** The completion table in `gates.db` gains a `path` column (`"mod-result" | "doorbell"`), added by a guarded `ALTER` in `gates-store.ts`'s existing migration block.
- **The tool rule.** Today an agent opens a form gate with `gate_ask` and then draws AskUserQuestion, which the `rt gate fork-check` hook admits. The block never opens gates. Its tool rule on `AskUserQuestion` (stage `permit`):
  1. Links the call to the live form gate this session asked: `gate:list { open: true, session: <own id>, presentation: "form" }`, matched on the question text. With no match, it passes the call through untouched.
  2. Runs `next(e)` to show the dialog.
  3. Concurrently waits on `gate/answered/<id>` and `gate/closed/<id>` with `link.wait`.
- **Closing the dialog.** When a gate event wins, the block reads the authoritative row (`gate:list` filtered to that id) and returns `{ result: { questions: e.questions, answers } }` built from the row. A closed or superseded gate returns a `withdrawn` result. When the dialog answer wins, the block records it with `gate:answer { by: "pane" }`.
- **The confirmation handshake.** `onCommand("gate-complete", { id })` acks whenever `id` is a gate this block linked, whether or not its dialog is still up. The event path closes the dialog; the command only confirms ownership.
- **Display kit.** `display.ts` exports `formPane($, gate): Promise<Answer | null>`, used only where `next(e)` cannot draw the dialog.

- [ ] Write the cases:
  - `an AskUserQuestion with no matching live form gate passes through untouched`;
  - `gate:list session and presentation filters, and unfiltered results unchanged`;
  - `a pane answer goes through and is recorded as a pane answer`;
  - `a board answer committed first closes the dialog with that answer`;
  - `racing answers: the dialog shows the row's winner`;
  - `a superseded gate closes the dialog as withdrawn`;
  - `gate-complete is acked for a linked gate even after its dialog closed`;
  - `a session with gate-form live gets no doorbell and no Escape`;
  - `without the block, doorbell and Escape behave exactly as M5a`;
  - `an unacked mod completion falls back to the doorbell once and records doorbell`;
  - `leftover "[gate] answered" rows are hidden`.
- [ ] Run `bun test lib/agent-integrations/__tests__/claude-questions.test.ts lib/daemon/__tests__/gate-escape.test.ts lib/daemon/__tests__/gate-push.test.ts lib/daemon/__tests__/gates-store.test.ts lib/daemon/__tests__/gate-ask-handler.test.ts commands/__tests__/agent-verbs-bytes.test.ts` and the plugin tests. Expect the new cases red; the bytes test stays green.
- [ ] Implement `createClaudeQuestions().complete`. When `modPath(binding, "gate-form")` holds, push `gate-complete` with the gate id and return `completed` on ack, recording `mod-result`. On no ack within 5 s, run today's doorbell path and record `doorbell`. Without the block, run today's path unchanged.
- [ ] Rerun the suites.
- [ ] Live check: answer from the board while the dialog is up, answer in the pane, race the two, and supersede. Confirm no Escape is ever sent. Report in `.harness-spike/mods-c9/report.md`.
- [ ] Commit `feat: the Claude mod owns the gate form`.

### C10: Wait gates without a background `rt gate wait`

**Files:** Create `plugins/mattstack-mods/src/blocks/gate-wait.ts`,
`plugins/mattstack-mods/tests/gate-wait.test.ts`;
modify `lib/daemon/handlers/gate.ts`, `packages/rt-client/src/commands.ts`,
`lib/mcp/tools.ts`, `plugins/mattstack/attachments/gate-protocol/SKILL.md`,
`plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated),
`plugins/mattstack/.claude-plugin/plugin.json` (version bump),
`apps/board/skills` (regenerated by `bun run skills:expand:board`).

**Interfaces:**
- **The handover.** When `gate:ask` opens a wait gate for a caller whose binding has `gate-wait` live, the daemon pushes `pushModCommand(sessionId, "gate-wait", { id })` before replying. On ack, the reply carries `wake: "mod"`. With no ack, or no block, the key is omitted, so every existing reply's bytes are unchanged.
- **The wait.** The block's `onCommand("gate-wait")` acks, then waits on `gate/answered/<id>` and `gate/closed/<id>` with `link.wait`. On an answer it calls `$.prompt.submit({ text })` with the gate id and the answer; on a close it submits a short "gate <id> was withdrawn".
- **The skill.** No per-harness fragments exist yet (S2/S11 add them), so C10 edits the shared wait node in `plugins/mattstack/attachments/gate-protocol/SKILL.md`, in harness-neutral words:
  1. Set the `waiting-gate` run field first.
  2. If `gate_ask`'s reply has `wake: "mod"`, end the turn; the session is woken with the answer.
  3. Otherwise run `rt gate wait <id>` in the background and end the turn, as today.
  S11 later moves this into the Claude fragment.
- **The tool text.** The `gate_ask` description in `lib/mcp/tools.ts` changes the same way: run `rt gate wait` only when the reply has no `wake`.

- [ ] Write the cases:
  - `wake is present only with the block live and the handover acked`;
  - `an unacked handover omits wake`;
  - `an answer starts one turn with the answer`;
  - `a withdrawn gate starts one turn saying so`;
  - `/clear while waiting keeps the wait through the link continuation`;
  - `without the block the reply bytes and the skill path are today's`.
- [ ] Run `bun test lib/daemon/__tests__/gate-ask-handler.test.ts commands/__tests__/agent-verbs-bytes.test.ts` and the plugin tests. Expect the new cases red; the bytes test stays green.
- [ ] Implement. Then regenerate the mcp-tools reference with `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`. Bump `plugins/mattstack`'s version, run `bun run skills:expand:board`, and commit `apps/board/skills`.
- [ ] Rerun the suites, `rt skills check --strict` and the plugin-mattstack certification steps.
- [ ] Live check: a wait gate answered from the board starts the next turn with the answer, and no background Bash process exists. Report in `.harness-spike/mods-c10/report.md`.
- [ ] Commit `feat: wait gates wake the Claude session through the mod`.

### C11: Answer a quiet gate from the waiting session's pane (RT-458)

**Files:** Create `plugins/mattstack-mods/src/blocks/gate-panel.ts`,
`plugins/mattstack-mods/tests/gate-panel.test.ts`;
modify `lib/daemon/handlers/gate.ts`, `lib/daemon/gate-push.ts`.

**Interfaces:**
- The block finds its own open quiet gates with C9's filters: `gate:list { open: true, session: <own id>, presentation: "wait" }`. It never matches on pane, since herdr reuses pane ids.
- It draws an `AbovePrompt` band row: a plain `Button` with `hotkey: "1"` and the label "Waiting on your answer: <question>".
- Pressing it calls `$.ui.open({ id: "gate-panel", focus: true, closeOnEscape: true })`. The pane draws one `Button` per option and an `Input` for free text.
- An answer calls `gate:answer { id, answers, by: "pane-person" }`. `safeSurface` maps `"pane-person"` to "this session's pane, by a person", and the herd-owner check in `gate:answer` accepts it like `"pane"`.

- [ ] Write the cases:
  - `the row shows only the session's own open quiet gates`;
  - `a gate asked by another session on a reused pane id is not shown`;
  - `the row disappears when the gate is answered elsewhere or withdrawn`;
  - `an answer in the pane records by pane-person and wakes the session through its usual path`;
  - `the model cannot reach the answer path: no tool or delivery triggers gate:answer from this block`;
  - `a herd-owned gate answered here is accepted and the shepherd fan-out fires`.
- [ ] Run the plugin tests and `bun test lib/daemon/__tests__/gates-store.test.ts lib/daemon/__tests__/gate-answer-executor.test.ts lib/daemon/__tests__/gate-push.test.ts`; expect red.
- [ ] Implement. Refresh the row from `link.wait` on `gate/*/<id>` events, not on a timer.
- [ ] Rerun the suites.
- [ ] Live check: a herd worker pane in a sandboxed herd opens a quiet gate. Matt presses `1` in the worker pane and answers. The worker wakes, and the shepherd and board show the answer as Matt's. Run the UI check under the UI validation rule: screenshots of the band and the pane, in both terminal color schemes, with anything that reads wrong called out. Report in `.harness-spike/mods-c11/report.md`.
- [ ] Commit `feat: answer a quiet gate from the waiting session's pane`.

### C12: Diagnostics

**Files:** Modify `lib/daemon/handlers/agent-integrations.ts`,
`packages/rt-client/src/agent-integrations.ts`, `commands/agent.ts`,
`lib/command-tree-def.ts`; create `lib/daemon/__tests__/agent-integrations-diagnostics.test.ts`.

**Interfaces:**
- `IntegrationSummary` gains `diagnostics?: { claudeLinks?: { sessionId: string; claudeCode: string; plugin: string; blocks: ModBlock[]; lastHeartbeatAgoMs: number }[]; experimentalApi?: boolean }`.
- A new leaf, `rt agent integrations [--json]`, prints it.

- [ ] Write the cases:
  - `links and blocks are listed per Claude session`;
  - `Codex reports experimentalApi true when negotiated`;
  - `switch off lists no links`;
  - `existing agent:integrations fields are unchanged`.
- [ ] Run `bun test lib/daemon/__tests__/agent-integrations-diagnostics.test.ts commands/__tests__/herd-pane-agent-bytes.test.ts`; expect red on the new file only.
- [ ] Implement. The leaf's description is "Show which agent integrations are on and what each session supports". Run `bun run docs:gen` and `bun run picker:check`.
- [ ] Rerun the suites.
- [ ] Commit `feat: report Claude mod links and Codex experimental API use`.
