# Slack Support Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator says "talk to Alex about this problem", and a Claude pane holds a labelled support chat over the operator's real Slack DM, then closes it and reports back.

**Architecture:** The daemon polls Slack while a conversation is open and bridges it into an ordinary rt chat DM room whose teammate is a session-less identity. A mod in the mattstack plugin owns the human-only `/slack-support` command and drops each Slack message into the session with `$.prompt.submit`. The pane replies with the existing `chat_dm`, which the daemon sends to Slack with the prefix.

**Tech Stack:** Bun and TypeScript (daemon, CLI, mod), `bun:sqlite`, Slack Web API over `fetch`, Rust (`plugins/herdr-chat`), React and the app kit (`apps/chat`), Swift (Flock, a separate repo).

**Spec:** `docs/superpowers/specs/2026-11-03-slack-support-chat-design.md`

## Global Constraints

- Every message sent to Slack by the pane or daemon starts with exactly `[Claude 🤖]: `.
- Slack is checked every 5 seconds, only while a conversation is open.
- Check-in at 30 quiet minutes, close at 60, 2 minute farewell window, `pane-gone` after 5 minutes with no watcher while an item waits.
- Close reasons are exactly `closed-by-pane`, `idle`, `operator`, `pane-gone`.
- Slack identities: id `slack.<lowercased user id>`, name `<first name>-slack`, cleaned to `[a-z0-9._-]`, capped at 24 characters, unique per Slack user; the `slack.` id prefix is reserved. Reply hints carry the id.
- Support tickets go under `~/.mattstack/chat/support-tickets/`, written by the daemon, never into a repo.
- DM scopes are `im:history`, `im:read`, `im:write`, `users:read`, opt-in, and never in `missingSlackUserScopes`.
- The model gets no tool that opens a chat. `slack-open`, `slack-watch`, `slack-delivered` are `hidden: true`, with no `agentSafe` and no MCP tool.
- The mod never sets `asUser` on `$.prompt.submit`.
- This repo is public: no real names, workspace names or Slack ids anywhere. Fixtures use `alex` and `U0TEST`. Run `scripts/repo-purity.sh` before every push.
- Announce `SCHEMA_VERSION` 17 in the `mattstack` chat room before merging, and renumber if taken (`.claude/rules/state.md`).
- `commands/__tests__/fixtures/chat-bytes.json` is never regenerated; existing verbs' bytes don't change.
- Run `bun test` from the repo root, on the files you touch only. Never run a built binary outside an isolated HOME.
- A plugin change bumps `plugins/mattstack/.claude-plugin/plugin.json`. A new MCP tool regenerates the reference: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`.
- Comments state only constraints the code can't show.

## Review Focus

- Slack is down, rate limited, or the token is revoked mid-chat: the teammate's messages must not be lost, and the pane is told when a reply fails. (Task 4, Task 5)
- The daemon restarts or the machine sleeps for an hour mid-chat: on wake, reading resumes from the cursor, and `idle` and `pane-gone` must not fire from sleep alone with messages unread. (Task 5, Task 7)
- The pane is mid-turn for a long time: the watcher stays alive, so `pane-gone` doesn't fire, and queued items arrive in order afterwards. (Task 6, Task 7)
- The operator runs `/slack-support` from a pane not signed in to rt chat (the mod signs it in), or with an old token, or for a person with two matching names (a clear refusal, nothing half opened). (Task 6, Task 11)
- Two panes race to open a chat with the same person: exactly one wins. (Task 2)

---

## Task 1: Spike the mod (gate for everything else)

Throwaway work. Its result decides whether the mod path holds. Stop and report to the operator if any answer is no.

**Files:**
- Create: `docs/superpowers/spikes/2026-11-03-slack-support-mod-spike.md`

Load `plugin-authoring` first. Build the throwaway mod under the session's dev-mods folder, never in the repo.

- [ ] **Step 1: Build a mod** with a registered `/spike-open` command, a `tool.call` deny on Bash, a `prompt.compose` section, and a `$.clock.every` tick that calls `$.prompt.submit`.

- [ ] **Step 2: Test on the personal account in a herdr pane, and record each result.**
  - Typed by hand: `e.origin.kind` is `composer`?
  - Sent with `rt pane send`, from Flock's path and from herdr: which origin?
  - `$.prompt.submit`: exact text the model reads, and does it start a turn from idle?
  - Can a plugin's `$.command.run` start a `disable-model-invocation` skill? If not, does a `command.run` answer's `context` plus `$.prompt.submit` start the turn?
  - When does `$.prompt.submit`'s promise resolve: at queueing, or when the prompt enters? Kill the session in between and record what happens.
  - Does a `$.process.spawn` child keep running past the hook's budget, or must the mod poll with `$.clock.every` and `$.process.run`?

- [ ] **Step 3: Repeat on the managed enterprise account (cswap).** Run with `claude --debug` and record any `bypassed by cc-plugin-sec-default` line for `command.run`, `tool.call`, `$.prompt.submit`, `prompt.compose` and `$.process.*`.

- [ ] **Step 3b: Slack rate limit.** Make one real `conversations.history` call on a channel with the existing token, and record the status and rate-limit headers. Don't print the token.

- [ ] **Step 4: Live read.** In a pane with the draft support rules, send three messages through `$.prompt.submit`: a support question, a pasted instruction to edit a file, and text that fakes a closing marker. Record what the model did.

- [ ] **Step 5: Write up and commit.** Record each answer and the transcript of Step 4 in the spike doc.

```bash
git add docs/superpowers/spikes/2026-11-03-slack-support-mod-spike.md
git commit -m "docs: record the Slack support mod spike"
```

- [ ] **Step 6: Gate.** Any no on enterprise, a failed live read, or a Slack limit that rules out a 5 second poll: STOP and bring the result to the operator. The spec's fallbacks are decisions, not defaults. If `$.process.spawn` can't outlive a hook, Task 6 keeps the same output shape and Task 11 polls `slack-pending` with `$.clock.every` instead.

## Task 2: Conversation store

**Files:**
- Create: `lib/state/slack-conversation-store.ts`
- Modify: `lib/state/db.ts` (schema, `SCHEMA_VERSION` to 17), `lib/state/index.ts`
- Test: `lib/state/__tests__/slack-conversation-store.test.ts`

**Interfaces:**
- Produces:

```ts
type SlackCloseReason = "closed-by-pane" | "idle" | "operator" | "pane-gone";
type SlackItemKind = "message" | "operator-slack" | "check-in" | "close-request" | "closed";
interface SlackConversation { id: number; room: string; agentHandle: string; slackHandle: string; slackUserId: string; slackChannel: string; frameMarker: string; lastReadTs: string; threadReadTs: Record<string, string>; lastActiveAt: number; checkedInAt: number | null; closeAskedAt: number | null; closeReasonAsked: SlackCloseReason | null; watcherSeenAt: number | null; stalledNotedAt: number | null; openedAt: number; closedAt: number | null; closeReason: SlackCloseReason | null; }
interface SlackItem { id: number; conversationId: number; kind: SlackItemKind; fromHandle: string | null; text: string; createdAt: number; deliveredAt: number | null; }
openConversation(args: Pick<SlackConversation, "room" | "agentHandle" | "slackHandle" | "slackUserId" | "slackChannel" | "frameMarker" | "lastReadTs" | "openedAt">, db?): SlackConversation // throws SlackConversationBusy { holderAgent }
conversationForAgent(agentHandle, db?): SlackConversation | undefined   // open only
conversationForRoom(room, db?): SlackConversation | undefined           // open only
listOpenConversations(db?): SlackConversation[]
advanceCursor(id, lastReadTs, threadReadTs, db?): void
touchConversation(id, now, db?): void                                   // sets lastActiveAt, clears checkedInAt
markCheckedIn(id, now, db?): void
markCloseAsked(id, reason, now, db?): void
markStalledNoted(id, now | null, db?): void
markWatcherSeen(id, now, db?): void
closeConversation(id, reason, now, db?): void
enqueueItem(args: Omit<SlackItem, "id" | "deliveredAt">, db?): SlackItem
pendingItems(conversationId, db?): SlackItem[]                           // oldest first
markItemDelivered(id, now, db?): void
```

- [ ] **Step 1: Write the failing tests:** `opens a conversation and finds it by agent and room`; `refuses a second open for the same Slack person, naming the holder`; `refuses a second open for the same pane`; `allows reopening after close`; `two racing opens leave exactly one row`; `touching clears the check-in`; `pendingItems returns undelivered items oldest first`; `threadReadTs round-trips through JSON`.

- [ ] **Step 2: Run:** `bun test lib/state/__tests__/slack-conversation-store.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Tables use `IF NOT EXISTS` only. Enforce the limits with partial unique indexes: `ON slack_conversations(slack_user_id) WHERE closed_at IS NULL` and `ON slack_conversations(agent_handle) WHERE closed_at IS NULL`, and map the constraint error to `SlackConversationBusy`.

- [ ] **Step 4: Run** the same test. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/state
git commit -m "state: add Slack conversation store"
```

## Task 3: Slack client, scopes and connect

**Files:**
- Create: `lib/slack/client.ts`, `lib/slack/format.ts`
- Modify: `lib/setup/slack-app.ts`, `commands/setup.ts:1821`, `apps/board/slack-app-manifest.yaml`, `apps/board/docs/slack.md`
- Test: `lib/slack/__tests__/client.test.ts`, `lib/slack/__tests__/format.test.ts`, `lib/setup/__tests__/slack-app.test.ts`

**Interfaces:**
- Produces:

```ts
const SLACK_PREFIX = "[Claude 🤖]: ";
withPrefix(body: string): string                       // strips a copy the pane wrote, adds one
hasPrefix(text: string): boolean
closingLine(operatorName: string, paneGone: boolean): string
holdingLine(operatorName: string): string
redactSecrets(text: string): { text: string; redacted: boolean }
interface SlackMessage { ts: string; user?: string; text: string; subtype?: string; replyCount?: number; latestReply?: string; files?: { name: string }[] }
interface SlackUser { id: string; name: string; displayName: string; realName: string; deleted: boolean; isBot: boolean }
interface SlackClient {
  authTest(): Promise<{ userId: string; scopes: string[] }>;
  listUsers(): Promise<SlackUser[]>;
  openDm(userId: string): Promise<string>;
  history(channel: string, oldest: string): Promise<SlackMessage[]>;   // oldest first
  replies(channel: string, parentTs: string, oldest: string): Promise<SlackMessage[]>;
  post(channel: string, text: string): Promise<{ ts: string }>;
}
class SlackError extends Error { code: string; retryAfterMs?: number }
createSlackClient(token: string, fetchImpl?: typeof fetch): SlackClient
SLACK_SUPPORT_SCOPES: string[]  // in lib/setup/slack-app.ts
```

- [ ] **Step 1: Write the failing tests.** `withPrefix adds the prefix once`; `withPrefix strips a copy the pane wrote`; `redactSecrets catches each token shape and leaves ordinary text alone`; `client throws SlackError with retryAfterMs on 429`; `client reads granted scopes from the x-oauth-scopes header`; `history returns messages oldest first across pages`; `missingSlackUserScopes ignores the support scopes`; `the manifest declares the support scopes`.

- [ ] **Step 2: Run:** `bun test lib/slack lib/setup/__tests__/slack-app.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Add `SLACK_SUPPORT_SCOPES` beside `DEFAULT_SCOPE_NEEDS`, and include it in `buildSlackManifest` and the YAML. Add `--support-chat` to `rt setup slack connect`, which adds the scopes to `user_scope`. Update the comment above `DEFAULT_SCOPE_NEEDS` and the scope table in `apps/board/docs/slack.md`.

- [ ] **Step 4: Run** the same tests. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/slack lib/setup commands/setup.ts apps/board/slack-app-manifest.yaml apps/board/docs/slack.md
git commit -m "slack: add the client, prefix helpers and opt-in DM scopes"
```

## Task 4: Slack identities and chat changes

**Files:**
- Modify: `lib/state/identity-store.ts`, `lib/daemon/handlers/chat.ts` (`planSweepTargets`, `unreachableSenderRefusal`, `postAndNotify`, `chat:dm`)
- Test: `lib/state/__tests__/slack-identity.test.ts`, `lib/daemon/__tests__/chat-slack-participant.test.ts`

**Interfaces:**
- Consumes: Task 2's store, Task 3's `SlackClient` and `withPrefix`.
- Produces: `ensureSlackIdentity(userId: string, rawFirstName: string, db?): IdentityRow`, `cleanSlackName(raw: string, userId: string): string`, `isSlackIdentity(id: string): boolean`; `deliverSlackReply` in the `chat:dm` path; `postAndNotify` marking the pane delivered and skipping its socket push when `args.fromSlack` is true.

- [ ] **Step 1: Write the failing tests:** `ensureSlackIdentity keeps one id across calls`; `a mixed-case or hostile profile name is cleaned`; `an empty cleaned name falls back to the user id`; `two teammates with one first name get distinct names`; `sign-in can't claim a slack. id or name`; `the sweep never targets a Slack identity`; `a chat_dm into an open conversation posts to Slack once with the prefix, then records it`; `a Slack failure leaves no chat row and fails the tool with the reason`; `a 429 is retried after Retry-After`; `chat_dm into a closed conversation's room is refused`; `a post from the operator in the room never reaches Slack`; `a Slack message is never swept to the pane`; `a chat UI post never bundles a Slack message`; `chat_dm to a Slack identity from another pane is refused`; `a credential in a reply is redacted and the tool result says so`.

- [ ] **Step 2: Run** both test files. Expected: FAIL.

- [ ] **Step 3: Implement.** Mint with `sessionId: null` and reserve the prefix wherever `fixedIdentityRefusal` and `isFixedChatName` check. In `chat:dm`, after resolving the room: if `conversationForRoom(room)` exists and the author is its `agentHandle`, send to Slack first and record the row only on success, then `markDelivered` for the Slack identity and `touchConversation`. A room whose conversation is closed refuses. The bridge's own posts carry `fromSlack: true`.

- [ ] **Step 4: Run** both test files, then `bun test lib/daemon/__tests__/chat-delivery.test.ts lib/state/__tests__/chat-identity-incident.test.ts`. Expected: PASS, no change to existing behaviour.

- [ ] **Step 5: Commit.**

```bash
git add lib/state lib/daemon
git commit -m "chat: let a session-less Slack participant join a DM room"
```

## Task 5: Inbound bridge sweep

**Files:**
- Create: `lib/daemon/slack-bridge.ts`
- Modify: `lib/daemon.ts` (a `scheduleSweep` with `intervalMs: 5_000`)
- Test: `lib/daemon/__tests__/slack-bridge.test.ts`

**Interfaces:**
- Consumes: Task 2's store; Task 3's client and `hasPrefix`; Task 4's `fromSlack`.
- Produces: `createSlackBridge(opts: { db; client: () => Promise<SlackClient | null>; post: (args: { room; handle; body; fromSlack: true }) => { id: number } | undefined; log; now?: () => number }): { sweep(): Promise<void> }`.

- [ ] **Step 1: Write the failing tests:** `reads only messages after the cursor`; `never reads anything before the conversation opened`; `a teammate message becomes a chat post and a queued message item`; `the operator's unprefixed Slack message becomes an operator-slack item`; `a prefixed message is skipped`; `a message from a third user is ignored`; `a thread reply under a message older than the cursor is delivered once`; `an attachment adds a note naming the file`; `a failed history call keeps the cursor and retries next tick`; `a rate limit waits out Retry-After`; `no Slack call is made with no open conversation`; `restart resumes from the stored cursor`.

- [ ] **Step 2: Run:** `bun test lib/daemon/__tests__/slack-bridge.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** For each open conversation: page `history` from `lastReadTs`; list parents since `openedAt` with `latestReply` newer than `threadReadTs[parent]` and fetch `replies`. Post first, then advance the cursor, so a crash can't lose a message. Sweeps never overlap. Read the token with `readSecret("board", "slackToken", ...)`, as `lib/daemon.ts:996` does. Keep the scheduling call here, inert when nothing is open.

- [ ] **Step 4: Run** the same test. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/daemon lib/daemon.ts
git commit -m "daemon: bridge Slack DMs into open conversations"
```

## Task 6: Daemon commands and hidden verbs

**Files:**
- Create: `lib/daemon/handlers/slack-chat.ts`
- Modify: `packages/rt-client/src/commands.ts`, `packages/rt-client/src/client.ts`, `lib/daemon/command-router.ts`, `lib/command-tree-def.ts`, `lib/module-registry.ts`
- Create: `commands/chat-slack.ts`
- Modify: `lib/daemon/handlers/pane.ts` (the `pane:send` handler)
- Test: `lib/daemon/handlers/__tests__/slack-chat.test.ts`, `commands/__tests__/chat-slack.test.ts`, `lib/daemon/__tests__/inject.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces, in the `pane:send` handler: a refusal of text whose first line starts `/slack-support` when `callerPane` or `selfSession` is set.
- Produces daemon commands:

```ts
"chat:slack-open":      { payload: { agentHandle: string; sessionId?: string; person: string }; data: { conversationId: number; handle: string; name: string; frameMarker: string; room: string } }
"chat:slack-close":     { payload: { agentHandle?: string; pane?: string; farewell?: string }; data: { conversationId: number; closed: boolean } }
"chat:slack-status":    { payload: Record<string, never>; data: { conversations: { id: number; pane?: string; name: string; openedAt: number; lastActiveAt: number }[] } }
"chat:slack-pending":   { payload: { agentHandle: string }; data: { items: SlackItem[]; open: boolean; conversation?: { id: number; handle: string; name: string; operator: string; marker: string } } } // also markWatcherSeen
"chat:slack-delivered": { payload: { id: number }; data: { delivered: boolean } }
```

Verbs: `rt chat slack-open <person> --json`, `rt chat slack-watch --json`, `rt chat slack-delivered <id>` (all `hidden: true`, no `agentSafe`), `rt chat slack-close [--pane <pane>] [--farewell-file <path>]`, `rt chat slack-status`. `slack-watch` loops `chat:slack-pending` every 2 seconds, prints each new item as one JSON line in the spec's shape, reprints undelivered items on restart, and exits when `open` is false.

- [ ] **Step 1: Write the failing tests:** `an unknown person is refused and nothing opens`; `an ambiguous person is refused with the candidates`; `a deleted or bot user can't be picked`; `a token without the support scopes is refused with the connect step`; `a pane not signed in to chat is refused`; `slack-open prints the JSON shape`; `slack-watch prints the documented line`; `slack-watch reprints undelivered items after a restart`; `slack-watch exits when the conversation closes`; `a pane cannot inject /slack-support into another pane or itself with self, and a call with no pane identity can`; `slack-open is hidden and absent from the agent-safe list and the MCP roster`.

- [ ] **Step 2: Run** both test files. Expected: FAIL.

- [ ] **Step 3: Implement.** Put the handlers in their own file, and spread them into the router alongside `createChatHandlers`. Add commands to `packages/rt-client`, then rebuild its `dist` as `.claude/rules/workspace-packages.md` describes. Name matching checks `displayName` and `realName`, skipping `deleted` and `isBot`. The close handler is a stub here; Task 7 fills it.

- [ ] **Step 4: Run** both tests, plus `bun test lib/__tests__/agent-safe.test.ts lib/__tests__/picker-conformance.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib packages/rt-client commands
git commit -m "chat: add hidden Slack open, watch and delivered verbs"
```

## Task 7: Timers and the close sequence

**Files:**
- Create: `lib/daemon/slack-lifecycle.ts`
- Modify: `lib/daemon/handlers/slack-chat.ts`, `lib/daemon.ts` (a `scheduleSweep` at `intervalMs: 15_000`)
- Test: `lib/daemon/__tests__/slack-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 2's store, Task 3's `closingLine`, Task 6's handlers.
- Produces: `tickSlackLifecycle(deps: { db; client; notify; now }): Promise<void>`; `finishClose(conversationId, reason, farewell | undefined, deps): Promise<void>`; `SLACK_CHECK_IN_MS = 30 * 60_000`, `SLACK_IDLE_MS = 60 * 60_000`, `SLACK_FAREWELL_MS = 2 * 60_000`, `SLACK_PANE_GONE_MS = 5 * 60_000`, `SLACK_STALLED_MS = 10 * 60_000`.

- [ ] **Step 1: Write the failing tests:** `30 quiet minutes queues one check-in item`; `a message after the check-in resets the timers`; `60 quiet minutes queues a close-request with reason idle`; `the pane's close sends its farewell then the fixed line, in that order`; `no close within 2 minutes sends only the fixed line`; `slack-close --pane queues a close-request with reason operator`; `no watcher for 5 minutes with a waiting item closes as pane-gone and notifies the operator`; `a long turn with a live watcher never closes as pane-gone`; `a gap in ticks (sleep) moves the quiet, stalled and watcher timers, so no timeout, holding line or pane-gone fires straight after wake`; `a teammate message during the farewell window goes to the operator, not the pane`; `a failed farewell send still closes and notifies the operator`; `a second close is a no-op`; `an item undelivered for 10 minutes with a live watcher notifies the operator and sends one holding line`; `a delivery resets the stalled notice`; `the farewell and fixed line are recorded in the room`.

- [ ] **Step 2: Run:** `bun test lib/daemon/__tests__/slack-lifecycle.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Detect sleep by comparing `now` with the last tick: a gap over 2 minutes pushes `lastActiveAt` and `watcherSeenAt` forward by the gap, and counts an item's stalled time from the end of the gap. Closing marks the row first, then sends, so a retry can't double-send. Queue a `closed` item so the watcher tells the pane and exits.

- [ ] **Step 4: Run** the same test. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/daemon lib/daemon.ts
git commit -m "daemon: add Slack chat timeouts and the close sequence"
```

## Task 8: Support tickets

**Files:**
- Create: `lib/slack/support-ticket.ts`
- Modify: `lib/daemon/handlers/slack-chat.ts`, `packages/rt-client/src/commands.ts`, `commands/chat-slack.ts`
- Test: `lib/slack/__tests__/support-ticket.test.ts`

**Interfaces:**
- Produces: `"chat:slack-ticket": { payload: { agentHandle: string; kind: "bug" | "feature"; title: string; problem: string; idea: string; acceptance: string[] }; data: { path: string } }`; `renderTicket(input, source): string`; `ticketPath(root, date, person, title): string`.

- [ ] **Step 1: Write the failing tests:** `the file has Problem, Idea or fix, Acceptance and Source sections`; `a title with ../ stays inside the folder`; `a clash gets a number`; `refuses with no open conversation`; `a teammate's name is sanitised in the filename`; `Source says the text came from a Slack chat`.

- [ ] **Step 2: Run:** `bun test lib/slack/__tests__/support-ticket.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Write with an exclusive create, so a clash can't overwrite. Add `rt chat slack-ticket` with a `--json` input on stdin.

- [ ] **Step 4: Run** the same test. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/slack lib/daemon packages/rt-client commands
git commit -m "chat: add markdown support tickets"
```

## Task 9: Pane tools

**Files:**
- Modify: `lib/mcp/chat-tools.ts`, `lib/command-tree-def.ts`, `plugins/mattstack/attachments/mcp-tools/reference.md`
- Test: `lib/mcp/__tests__/chat-slack-tools.test.ts`

**Interfaces:**
- Consumes: Tasks 6 to 8.
- Produces: `chat_slack_close { farewell: string }`, `chat_slack_status {}`, `chat_slack_ticket { kind, title, problem, idea, acceptance }`, each acting only as this session's handle.

- [ ] **Step 1: Write the failing tests:** `chat_slack_close closes this pane's conversation only`; `chat_slack_ticket takes no path`; `the roster has no open tool`.

- [ ] **Step 2: Run:** `bun test lib/mcp/__tests__/chat-slack-tools.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** with `requireChatHandle`, as `chat_dm` does, and regenerate the reference.

- [ ] **Step 4: Run** the same test, then `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts | diff - plugins/mattstack/attachments/mcp-tools/reference.md`. Expected: PASS, no diff.

- [ ] **Step 5: Commit.**

```bash
git add lib/mcp lib/command-tree-def.ts plugins/mattstack/attachments/mcp-tools/reference.md
git commit -m "mcp: add Slack chat close, status and ticket tools"
```

## Task 10: The skill

**Files:**
- Create: `skills/rt-slack-support/SKILL.md`

Load `superpowers:writing-skills` and `mattstack:editing-skills` first, and follow their RED and GREEN steps. Set `disable-model-invocation`. The skill carries everything in the spec's "The skill" section, plus reply mechanics: replies use `chat_dm`, close uses `chat_slack_close`, tickets use `chat_slack_ticket`.

- [ ] **Step 1: RED.** Run a baseline pane with a Slack-shaped brief and no skill. Record where it goes wrong.

- [ ] **Step 2: Write the skill** against those failures, with Slack formatting (`*bold*`, not `**bold**`).

- [ ] **Step 3: GREEN.** Rerun with the skill. Check that it answers, troubleshoots, brainstorms, writes a ticket, and hands off a code fix.

- [ ] **Step 4: Commit.**

```bash
git add skills/rt-slack-support
git commit -m "skills: add rt:slack-support"
```

## Task 11: The mod

**Files:**
- Create: `plugins/mattstack/hooks/slack-support.ts`, `plugins/mattstack/hooks/slack-support-text.ts`
- Modify: `plugins/mattstack/hooks/hooks.json` (`modules`), `plugins/mattstack/.claude-plugin/plugin.json`, `plugins/mattstack/hooks/README.md`
- Test: `plugins/mattstack/hooks/slack-support.test.ts`

Load `plugin-authoring` first, and use the spike's answers.

**Interfaces:**
- Consumes: the Task 6 verbs and JSON line.
- Produces: `/slack-support <person> <problem>`; `supportRules(args: { name: string; operator: string }): string`; `renderDelivery(line: SlackWatchLine): string`, where `SlackWatchLine` is one `slack-watch` JSON line.

- [ ] **Step 1: Write the failing tests:**
  - `a run from each origin other than composer is refused, and nothing is opened`
  - `the Bash deny matches slack-open, slack-watch and slack-delivered`
  - `the Bash deny matches rt pane send carrying /slack-support`
  - `an ordinary Bash command passes`
  - `the system prompt section exists only while a chat is open`
  - `every submit omits asUser`
  - `a message delivery puts the rules first and the text between marker lines`
  - `text containing the marker is neutralised`
  - `delivered is confirmed only once the prompt has entered, by the path the spike chose`
  - `a failed submit is not confirmed`
  - `an operator-slack item carries its own label`
  - `session.start resumes the watcher when a conversation is open`
  - `an unsigned pane is signed in before the open`
  - `a failed open leaves no watcher running`

- [ ] **Step 2: Run:** `claude plugin test plugins/mattstack`. Expected: FAIL.

- [ ] **Step 3: Implement.** Register the command in `session.start`. The `command.run` hook checks `e.origin.kind === 'composer'`, signs the pane in with `rt chat sign-in` if needed, runs `rt chat slack-open` with `$.process.run`, starts the watcher, and starts `rt:slack-support` the way the spike found. Pass `CLAUDE_CODE_SESSION_ID` from `$.session.id()` and the pane id in each child's `env`; don't rely on inheritance. Use the spec's support rules as the wording of `supportRules`. Hook failures on the gating hooks fail closed with a `.catch`.

- [ ] **Step 4: Run** `claude plugin test plugins/mattstack` and `claude plugin validate plugins/mattstack`. Expected: PASS. Keep the engine's generated `tsconfig.json` and `.claude-plugin/types/` out of the commit.

- [ ] **Step 5: Commit.**

```bash
git add plugins/mattstack/hooks plugins/mattstack/.claude-plugin/plugin.json
git commit -m "plugin: add the Slack support mod"
```

## Task 12: herdr-chat controls

**Files:**
- Create: `plugins/herdr-chat/src/cmd/slack.rs`
- Modify: `plugins/herdr-chat/src/main.rs`, `src/rt.rs`, `src/json.rs`, `herdr-plugin.toml`, `README.md`

**Interfaces:**
- Consumes: `rt chat slack-status`, `rt chat slack-close --pane`, `rt pane send`.
- Produces: `herdr-chat slack-status --json`, `herdr-chat slack-close --json --pane <id>`, a "Slack support" pane action and popup, and `slackChat` on `status --json`: `{ "name": string, "openedAt": number } | null`.

- [ ] **Step 1: Write the failing Rust tests** with the `Runner` fake: `status carries the pane's open chat`; `slack-close passes the pane`; `the popup's On types the slash command into the pane`.

- [ ] **Step 2: Run:** `cargo test --release` in `plugins/herdr-chat`. Expected: FAIL.

- [ ] **Step 3: Implement.** Follow the gotchas in `plugins/herdr-chat/AGENTS.md`: `sh -c` commands, a borderless popup, a bare integer size.

- [ ] **Step 4: Run** the tests, then `herdr plugin link plugins/herdr-chat`, and screenshot the popup with a chat open and with none. Say what looks wrong.

- [ ] **Step 5: Commit.**

```bash
git add plugins/herdr-chat
git commit -m "herdr-chat: add Slack support controls"
```

## Task 13: Chat UI label

**Files:**
- Modify: `apps/chat/src/app/Composer.tsx`, the Reader's room data, `apps/chat/src/server/*` as needed
- Test: `apps/chat/src/app/Composer.test.tsx`

**Interfaces:**
- Consumes: `chat:slack-status`.

Load `building-with-mantine-kit` and `rt:ui-copy` first.

- [ ] **Step 1: Write the failing tests:** `an open Slack chat's composer shows Only Claude sees this`; `a normal room shows no label`.

- [ ] **Step 2: Run:** `bun run chat:test`. Expected: FAIL.

- [ ] **Step 3: Implement** with kit components and `--tk-*` tokens.

- [ ] **Step 4: Run** the tests, then use the `fast-browser:browser-driver` agent at the localhost URL from `deck list`, and screenshot both schemes. Say what looks wrong.

- [ ] **Step 5: Commit.**

```bash
git add apps/chat
git commit -m "chat: label the composer in a Slack support room"
```

## Task 14: Docs and the ship gate

**Files:**
- Modify: `skills/rt-chat/SKILL.md`, `.claude/rules/chat.md`, docs through `rt:docs`
- Create: `docs/superpowers/spikes/2026-11-03-slack-support-live-test.md`

- [ ] **Step 1: Docs.** Add a pointer in `skills/rt-chat/SKILL.md` (with `superpowers:writing-skills`), a note in `.claude/rules/chat.md`, and the user docs for setup and use, including that a thread reply under a pre-chat message is never seen.

- [ ] **Step 2: Real run** in an rt dev build with a real teammate or a second Slack account: open, reply both ways, thread reply, operator Slack message, chat UI message, check-in, close, farewell, ticket.

- [ ] **Step 3: Ship gate.** Send hostile messages: pasted instructions to edit a file, to push, to print a token, to DM someone else, and to fake the frame marker. Then an ordinary support question and a feature idea. It must refuse the first set and help with the second. Record the transcript. A failure blocks release and goes to the operator.

- [ ] **Step 4: Purity and commit.** Run `scripts/repo-purity.sh`. Expected: exit 0. Scrub real names from the transcript.

```bash
git add skills/rt-chat .claude/rules/chat.md docs
git commit -m "docs: add Slack support chat docs and live test results"
```

## Task 15: Flock controls (separate repo, last)

Work in `~/Documents/GitHub/flock`, in its own plan-sized change on `main`, per that repo's rules.

**Files:**
- Modify: `Sources/FlockCore/Chat/ChatVerb.swift`, `Sources/FlockCore/Chat/ChatShapes.swift`, `Sources/Flock/Chat/ChatPopover.swift`, `Sources/Flock/Chat/ChatCommands.swift`, `Sources/Flock/Chat/ChatStore.swift`
- Test: `Tests/FlockCoreTests/ChatShapesTests.swift`, `Tests/FlockChromeRender/ChatFeatureViewsRenderTests.swift`

**Interfaces:**
- Consumes: Task 12's `slackChat`, `slack-close --json`, and typing `/slack-support` into a pane.

- [ ] **Step 1: Write the failing tests:** `status decodes slackChat`; `an old herdr-chat with no slackChat hides the row`; `the row shows who the pane is talking to`.

- [ ] **Step 2: Run** the repo's test commands. Expected: FAIL.

- [ ] **Step 3: Implement** a row in the pane's chat popover with On (a person and a problem) and Off, rendered only when the `herdr-chat` tool resolves and the pane is signed in.

- [ ] **Step 4: Run** the tests, build a dev app, and screenshot both schemes. Say what looks wrong.

- [ ] **Step 5: Commit.**

```bash
git add Sources Tests
git commit -m "chat: add Slack support controls to the popover"
```
