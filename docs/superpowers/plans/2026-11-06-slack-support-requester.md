# Slack Support Requester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any Claude pane can request a Slack support chat that a background agent holds, with operator approval through a board-invisible gate, lifecycle milestones pushed to the requester, a `!!claude` resume window, and tickets filed straight into Linear SUPPORT.

**Architecture:** The rt daemon owns the lifecycle. A `slack-open` gate carries requests and resumes. On approval, the daemon starts a background agent and opens the conversation with requester columns. The mattstack mod starts `rt:slack-support` in that agent with the conversation id only. Milestones are DMs from a reserved `rt.support` identity. The Slack bridge also sweeps conversations in their 60 minute grace window. Three related fixes land first: rt refuses long injected slash commands, and Flock gets two owner fixes.

**Tech Stack:** Bun + TypeScript (rt CLI, daemon, MCP); Claude Code mods (`plugins/mattstack/hooks`); React + Hono (console); Swift/SwiftUI (Flock, sibling repo `~/Documents/GitHub/flock`, worked on its `main`).

**Spec:** `docs/superpowers/specs/2026-11-06-slack-support-requester-design.md` (read it with this plan). It builds on `docs/superpowers/specs/2026-11-03-slack-support-chat-design.md`.

## Global Constraints

- **Paste threshold:** 800 characters. An injected line whose first line starts with `/` and whose length is over 800 is refused.
- **Trigger phrase:** the `chat.slackSupport.persona` setting's `trigger` (`@<name>` when unset, so `@Maude` by default) at the start of the teammate's message. Leading whitespace is allowed, the match is case-insensitive, and it ends at whitespace, the end of the text or one of `, : ! ?`.
- **Grace window:** `closed_at + 60 min`. The graced sweep runs every 30 s.
- **Gate:** an unanswered `slack-open` gate expires after 30 min. Its subject prefix is `slack:`. Its kind is `slack-open`.
- **Agent open deadline:** an agent that never reaches the chat within 60 s produces an `open-failed` milestone.
- **Fixed closing line:**
  `[<name> <emoji>]: This chat with <name> is closed. Anything you send now goes to <operator>. To add something for <name> in the next hour, start your message with <trigger>`, from the `chat.slackSupport.persona` setting, default `{ name: "Maude", emoji: "🤖" }`
- **Linear secret:** `readSecret("rt", "linearSupportApiKey", seams)`. Never put the key in settings, and the tool takes no team argument.
- **Ticket ids in Slack:** no SUPPORT id or URL is ever sent to Slack. The teammate only hears that the agent wrote it up.
- **work org id refusal:** checks for `!` followed by digits, URLs on the `mattstack.integrations` `forge.host`, and keys from `mattstack.directory` `teams[*].linear.team`. When those settings are missing, it fails closed.
- **The board:** never shows a `slack-open` gate.
- **Approval bar:** stop accidents and misled panes. No model-issued tool call answers a `slack-open` gate.
- **Tests:** run rt tests from the repo root with `bun test <path>`. Board tests run from `apps/board`. Console tests run with `cd apps/console && npx vitest run <path>`. Flock tests use `xcodebuild` with a scratch `-derivedDataPath`. Run only the targeted tests locally; CI runs the full suite.
- **Plugin:** every change under `plugins/mattstack` bumps `.claude-plugin/plugin.json` one past `main` at merge.
- **Skills:** every skill edit goes through superpowers:writing-skills.
- **Copy:** UI and milestone copy goes through rt:ui-copy. No `·` separators, and no em or en dashes.
- **Comments:** follow the clean-code rule. A comment only states a constraint the code can't show.

## Review Focus

1. **A `!!claude` message variant.** The cases are `  !!Claude can you also check X`, a bare `!!claude`, `ok !!claude`, and `!!claudeX`. Expected: the first two offer a resume, and the last two are ordinary DMs to the operator. Pinned in Task 11.
2. **The requester pane is gone when a milestone fires.** Expected: the operator gets a desk notification with the same text, and nothing throws. Pinned in Task 9.
3. **A second request for a person who already has an open chat.** Expected: the `open-failed` milestone names the busy chat, no agent is left running, and no row is half-written. Pinned in Task 8.
4. **The agent fails to start after approval.** This covers an `agent:start` error, or an agent that never signs in. Expected: an `open-failed` milestone with the reason, no conversation row, and no orphan agent. Pinned in Task 8.
5. **A ticket that mentions a mattstack id such as `RT-123` or `SUPPORT-4`.** Expected: it is accepted when that key is not in the org directory. The same text with a directory key, a `!1234` reference, or a forge-host URL is refused, naming the hit. Pinned in Task 6.

---

### Task 1: rt refuses an injected slash command over the paste threshold

**Files:**
- Modify: `lib/daemon/inject.ts` (`injectIntoPane`, :123)
- Test: `lib/daemon/__tests__/inject.test.ts`

**Interfaces:**
- Produces: `export const PASTE_COMMAND_LIMIT = 800` and `export function pastesAsText(text: string): boolean` in `lib/daemon/inject.ts`.

- [ ] **Step 1: Write failing tests**

```ts
test("a slash command over 800 characters is refused before herdr is asked", async () => {
  const calls: string[] = [];
  const herdr = async (method: string) => { calls.push(method); return { ok: true, result: {} } as never; };
  const res = await injectIntoPane({ paneId: "w1:p1", text: "/rename " + "x".repeat(800), herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: expect.stringContaining("800") } });
  expect(calls).toEqual([]);
});
test("plain text over 800 characters still goes through", async () => { /* idle pane fake as the existing accept test; expect delivered "accepted" */ });
test("pastesAsText: 800 is fine, 801 starting with / is not, multiline checks the first line's slash", () => {
  expect(pastesAsText("/" + "x".repeat(799))).toBe(false);
  expect(pastesAsText("/" + "x".repeat(800))).toBe(true);
  expect(pastesAsText("hello\n/" + "x".repeat(900))).toBe(false);
});
```

- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/daemon/__tests__/inject.test.ts`. Expected: FAIL, because `pastesAsText` is not exported.
- [ ] **Step 3: Implement.** `pastesAsText(text)` is true when `text.length > PASTE_COMMAND_LIMIT` and the first line starts with `/`. `injectIntoPane` checks it right after the self-pane check and returns `ok("refused", "a slash command over 800 characters arrives as a paste and never runs; shorten it")`.
- [ ] **Step 4: Run them and see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "inject: refuse slash commands over the paste threshold"`

### Task 2: Flock keeps a chat's owner while its agent lives

Repo: `~/Documents/GitHub/flock`, on `main`.

**Files:**
- Modify: `Sources/Flock/Chat/ChatStore.swift` (`noteSlackChats` :355, `retire` :373)
- Test: `Tests/FlockChromeRender/ChatStoreSlackTests.swift`

**Interfaces:**
- Produces: `ChatSlackAgentChat.timedOut: Bool` (Codable, default false).

- [ ] **Step 1: Write failing tests.**
  - `testAChatThatOpensLateKeepsItsOwner`: an agent passes `openDeadline` with no chat, then appears in `open`. `slackOwner(ofAgent:)` still returns the starting pane. The "didn't open" toast showed once, and no `/exit` was typed.
  - `testARefusedChatStillRetires`: a refusal read from the agent's screen still retires and exits, as today.
- [ ] **Step 2: Run them and see them fail.** Run: `xcodebuild test -scheme FlockChromeRender -destination 'platform=macOS' -skipPackagePluginValidation -derivedDataPath /tmp/flock-dd -only-testing:FlockChromeRender/ChatStoreSlackTests`. Expected: the new test fails.
- [ ] **Step 3: Implement.** Past `openDeadline`, set `timedOut = true` and show the toast once, without calling `retire`. A `timedOut` entry whose chat later appears clears `timedOut` and takes the name. `endSlackChat` still retires.
- [ ] **Step 4: Run them and see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** on flock main: `git commit -m "chat: keep a slack chat's owner past the open deadline"`

### Task 3: Flock shows an unowned background chat on no tab

Repo: `~/Documents/GitHub/flock`, on `main`.

**Files:**
- Modify: `Sources/FlockCore/Chat/ChatSidebar.swift` (`isLinked(toTab:)` :57)
- Test: `Tests/FlockCoreTests/ChatSidebarTests.swift`

- [ ] **Step 1: Replace the test.** `testAnUnlinkedBackgroundChatShowsOnEveryTab` becomes `testAnUnlinkedBackgroundChatShowsOnNoTab`, which does `XCTAssertFalse(selection.isLinked(toTab: ["w2:p3"]))`. Add `testAChatWithNoPaneShowsOnNoTab`, which builds `chat("a", pane: nil)` and asserts false.
- [ ] **Step 2: Run them and see them fail.** Run: `xcodebuild test -scheme Flock -destination 'platform=macOS' -only-testing:FlockCoreTests -skipPackagePluginValidation -derivedDataPath /tmp/flock-dd`
- [ ] **Step 3: Implement.** Use `guard let pane = chat.homePane, !pane.hasPrefix("bg:") else { return false }`, then fix the doc comment.
- [ ] **Step 4: Run them and see them pass. Render check:** build the dev app and look at a background chat started outside Flock. It must show on no tab. Take screenshots in both color schemes and open them for Matt.
- [ ] **Step 5: Commit** on flock main: `git commit -m "chat: an unowned background chat shows on no tab"`

### Task 4: Schema 18, the conversation columns and the `rt.support` identity

**Files:**
- Modify: `lib/state/db.ts` (`SCHEMA_VERSION` → 18, plus an `addSlackRequesterColumnsIfMissing` guard called in `runMigrations`, following `addAdoptedColumnIfMissing`)
- Modify: `lib/state/slack-conversation-store.ts` (row type, `toConversation`, `OpenConversationArgs`, new writers)
- Modify: `lib/state/identity-store.ts` (reserved support identity)
- Test: `lib/state/__tests__/slack-conversation-store.test.ts`, `lib/state/__tests__/db-schema-convergence.test.ts`, `lib/state/__tests__/slack-identity.test.ts`

Announce the schema claim in #mattstack before starting, per `.claude/rules/state.md`.

**Interfaces:**
- Produces:
  - `SlackConversation` gains `requesterSession: string | null`, `requesterHandle: string | null`, `requesterPane: string | null`, `brief: string | null`, `resumedFrom: number | null`, `graceUntil: number | null`, `assignedAgent: string | null`, `assignedSession: string | null`, `assignedPane: string | null`.
  - The spec lists six columns. `requester_pane` (for Flock's owner) and `assigned_session` (for the mod's lookup) are this plan's additions; `assigned_pane` is the operator's tracking amendment (spec "Session, pane and ticket tracking").
  - New table `slack_support_tickets (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, issue_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL)`, created with `CREATE TABLE IF NOT EXISTS` in the same guard.
  - `recordSupportTicket(conversationId: number, t: { id: string; title: string; url: string }, now: number, db): void`
  - `listSupportTickets(conversationId: number, db): SupportTicket[]` (`SupportTicket = { id: string; title: string; url: string; createdAt: number }`, oldest first)
  - `ticketsForChain(conversationId: number, db): SupportTicket[]`: this conversation's tickets plus those of every conversation it `resumed_from`, transitively.
  - `OpenConversationArgs` gains the same fields, all optional.
  - `startGrace(id: number, until: number, db): void`
  - `endGrace(id: number, db): void`
  - `listGracedConversations(now: number, db): SlackConversation[]`, which returns `closed_at IS NOT NULL AND grace_until > now`.
  - `conversationForAssignedSession(sessionId: string, db): SlackConversation | null`, which returns the open conversation only.
  - `SUPPORT_ID = "rt.support"` and `isSupportIdentity(id)` in `identity-store.ts`. `isFixedChatName` and `fixedIdentityRefusal` include it.

- [ ] **Step 1: Write failing tests.**
  - "open stores the requester, brief and assigned agent and reads them back"
  - "listGracedConversations returns a closed row until grace_until, then not"
  - "endGrace drops a row from the graced list"
  - "conversationForAssignedSession ignores closed rows"
  - "a v17 db gains the nine columns and the slack_support_tickets table on open" (the convergence test)
  - "recordSupportTicket then listSupportTickets returns them oldest first"
  - "ticketsForChain follows resumed_from back through two conversations"
  - "rt.support cannot be signed in to or chosen as a name" (`slack-identity.test.ts`)
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/state/__tests__/slack-conversation-store.test.ts lib/state/__tests__/db-schema-convergence.test.ts lib/state/__tests__/slack-identity.test.ts`
- [ ] **Step 3: Implement.**
  - Columns: `requester_session TEXT, requester_handle TEXT, requester_pane TEXT, brief TEXT, resumed_from INTEGER, grace_until INTEGER, assigned_agent TEXT, assigned_session TEXT, assigned_pane TEXT`.
  - Each column is added through a `PRAGMA table_info` guard, never inside a `V*_SCHEMA` block.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "state: schema 18, slack requester columns and the rt.support identity"`

### Task 5: Milestones from `rt.support`

**Files:**
- Create: `lib/slack/milestones.ts`
- Test: `lib/slack/__tests__/milestones.test.ts`

**Interfaces:**
- Consumes: `SUPPORT_ID` (Task 4), the daemon's chat DM post path (`dmRoomFor` + post, as `chat:dm` does) and the desk notifier the base design's close uses.
- Produces:
  - `type SlackMilestone =`
    - `{ kind: "declined" | "expired"; person: string }`
    - `| { kind: "opened"; person: string; room: string; agentPane: string }`
    - `| { kind: "open-failed"; person: string; reason: string }`
    - `| { kind: "ticket"; id: string; title: string; url: string }`
    - `| { kind: "closed"; person: string; reason: SlackCloseReason; summary: string | null }`
    - `| { kind: "resume-offered"; person: string; text: string }`
    - `| { kind: "resumed"; person: string; agent: "same" | "fresh" }`
  - `renderMilestone(m: SlackMilestone): string`
  - `sendMilestone(deps: MilestoneDeps, to: { handle: string | null; session: string | null }, m: SlackMilestone): Promise<"dm" | "desk">`
  - `MilestoneDeps = { isOnline(handle: string): boolean; postDm(from: string, to: string, body: string): Promise<void>; desk(body: string): Promise<void> }`

- [ ] **Step 1: Write failing tests.**
  - "a milestone to an online requester is a DM from rt.support"
  - "an offline or missing requester falls back to the desk notification with the same text" (Review Focus 2)
  - "a ticket milestone carries id and url"
  - "renderMilestone never contains a dash or a dot separator" (assert no `—`, `–` or `·` across all kinds)
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/slack/__tests__/milestones.test.ts`
- [ ] **Step 3: Implement.** Write the copy with rt:ui-copy: one short line per kind, starting with the person's name.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "slack: milestones from rt.support with a desk fallback"`

### Task 6: The Linear SUPPORT client and the work org id refusal

**Files:**
- Create: `lib/linear/support.ts`
- Create: `lib/linear/org-ids.ts`
- Test: `lib/linear/__tests__/support.test.ts`, `lib/linear/__tests__/org-ids.test.ts`

**Interfaces:**
- Produces:
  - `type SupportIssueInput = { kind: "bug" | "feature"; title: string; problem: string; idea: string; acceptance: string[]; source: { person: string; date: string; room: string } }`
  - `renderSupportBody(input): string`: sections `## Problem`, `## Fix`, `## Acceptance` (as bullets) and `## Source`. Source says the text came from a Slack chat.
  - `createSupportIssue(input, opts: { apiKey: string; fetchImpl?: typeof fetch }): Promise<{ id: string; title: string; url: string }>`: a GraphQL `issueCreate` against `https://api.linear.app/graphql`. The team is resolved by querying `teams` (the scoped key sees only SUPPORT), with a 15 s timeout. It throws `LinearSupportError` carrying Linear's message.
  - `findOrgIds(fields: string[], ctx: { forgeHost: string | null; teamKeys: string[] | null }): { ok: true } | { ok: false; hit: string; reason: string }`
  - `orgIdContext(): { forgeHost: string | null; teamKeys: string[] | null }`: reads `getSetting("mattstack.integrations").value?.forge?.host` and the `teams[*].linear.team` keys of `getSetting("mattstack.directory")`.

- [ ] **Step 1: Write failing tests.**
  - `org-ids.test.ts`:
    - "a !digits MR ref is refused"
    - "a URL on the forge host is refused"
    - "a ticket id with a directory key is refused, case-sensitive key match on a word boundary"
    - "RT-123 and SUPPORT-4 pass when RT and SUPPORT are not directory keys" (Review Focus 5)
    - "a null forgeHost or teamKeys fails closed with a reason naming the missing setting"
    - "an exclamation mark in prose (`works!`) passes"
  - `support.test.ts`, with a fake `fetchImpl`:
    - "issueCreate sends the rendered body and returns identifier, title, url"
    - "a GraphQL error throws LinearSupportError with Linear's message"
    - "a timeout throws LinearSupportError"
    - "renderSupportBody matches the section order"
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/linear/__tests__/`
- [ ] **Step 3: Implement.** Follow `lib/linear.ts`'s `linearGraphql` call shape. Keep it a separate client, because `linearGraphql` is not exported and is read-only by design.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "linear: SUPPORT issue client and the work org id refusal"`

### Task 7: `chat:slack-ticket` files in Linear

**Files:**
- Modify: `lib/daemon/handlers/slack-chat.ts` (`chat:slack-ticket` :347, `validTicket` :111)
- Modify: `packages/rt-client/src/commands.ts` (`chat:slack-ticket` data :1108 becomes `{ id: string; title: string; url: string }`)
- Delete: `lib/slack/support-ticket.ts`'s `writeTicket` path, with its tests moved or removed
- Modify: `commands/chat-slack.ts` (`slackTicket` prints id and url)
- Modify: `lib/mcp/chat-tools.ts` (`chat_slack_ticket` description)
- Test: `lib/daemon/handlers/__tests__/slack-chat.test.ts`, `commands/__tests__/chat-slack.test.ts`

**Interfaces:**
- Consumes: `createSupportIssue`, `findOrgIds`, `orgIdContext` (Task 6); `sendMilestone` (Task 5).
- Produces: `chat:slack-ticket` returns `{ id, title, url }`. The handler takes a `linear` seam: `{ apiKey(): Promise<string | null>; create: typeof createSupportIssue; context: typeof orgIdContext }`.

- [ ] **Step 1: Write failing tests.**
  - "slack-ticket files in SUPPORT and returns id and url"
  - "slack-ticket refuses text with a work org id and names it; nothing is sent to Linear"
  - "slack-ticket with no key stored fails with a reason naming rt.linearSupportApiKey"
  - "slack-ticket sends the requester a ticket milestone"
  - "slack-ticket writes no file under support-tickets"
  - "slack-ticket records the issue against the caller's conversation"
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/daemon/handlers/__tests__/slack-chat.test.ts commands/__tests__/chat-slack.test.ts`
- [ ] **Step 3: Implement.** Order: validate, check work org ids across title, problem, idea and acceptance, create the issue, `recordSupportTicket` (Task 4), then send the milestone. A Linear error fails the call with Linear's message.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "slack-ticket: file in Linear SUPPORT"`

### Task 8: Requests, the `slack-open` gate and the approved open

**Files:**
- Create: `lib/slack/request.ts` (request and approve logic)
- Modify: `lib/daemon/handlers/slack-chat.ts` (new commands `chat:slack-request`, `chat:slack-start`, `chat:slack-assignment`; add them to `SLACK_CHAT_COMMANDS` :54)
- Modify: `lib/daemon/handlers/gate.ts` (`gate:answer` :559: kind refusal, and an approved `slack-open` dispatches to `lib/slack/request.ts`; also expiry)
- Modify: `packages/rt-client/src/commands.ts`, `packages/rt-client/src/client.ts` (payloads and wrappers)
- Test: `lib/slack/__tests__/request.test.ts`, `lib/daemon/__tests__/gates-handlers.test.ts`, `lib/daemon/handlers/__tests__/slack-chat.test.ts`

**Interfaces:**
- Consumes:
  - `openConversation` with the new fields and `conversationForAssignedSession` (Task 4)
  - `sendMilestone` (Task 5)
  - the in-process `agent:start` (as `lib/daemon/handlers/herd.ts:378` calls it)
  - `findPerson`/`readPeople` (slack-chat.ts :83 and :169)
- Produces:
  - `chat:slack-request {person: string; brief: string; requesterSession: string; requesterHandle: string; repo: string}` returns `{gateId: string} | {candidates: SlackPerson[]}`. It opens a gate with `kind: "slack-open"`, `subject: "slack:<slackUserId>"`, one question ("Open a Slack support chat with <name>?", options Approve and Decline), and `context` holding the person and brief. The meta stores `{action: "open", person, brief, requesterSession, requesterHandle, repo}`.
  - `chat:slack-start {person: string; brief: string; requesterPane?: string; requesterSession?: string; requesterHandle?: string; repo: string}` runs the same open with no gate. It is used by the manual `/slack-support` and by a Flock tap.
  - `approveSlackOpen(deps, meta): Promise<{ok: true; conversation: number} | {ok: false; reason: string}>`. It starts the agent (`bg: true`, `label: "slack-support"`, `repo`), then calls `openConversation({..., agentHandle: record.handle, assignedAgent: record.id, assignedSession: record.sessionId, assignedPane: record.paneId, requesterSession, requesterHandle, requesterPane, brief})`. On `SlackConversationBusy` or an agent error, it stops any agent it started, sends `open-failed`, and writes no row.
  - `chat:slack-assignment {sessionId: string}` returns `{conversation: number | null}`.
  - `gate:answer` on a `slack-open` gate is refused with "a Slack chat is approved only by the operator, in the console or the pane's form" unless `by` is `"console"` or `"slack-mod"`.
  - An open `slack-open` gate past 30 min closes as expired and sends the `expired` milestone, swept with the existing gate timers.

- [ ] **Step 1: Write failing tests.**
  - "slack-request opens a slack-open gate with a slack: subject and returns its id"
  - "an ambiguous person returns candidates and opens no gate"
  - "gate:answer by pane on a slack-open gate is refused; by console is accepted" (`gates-handlers.test.ts`)
  - "approve starts a bg agent, opens the row with requester, assigned agent, session and pane, and sends opened"
  - "approve for a person with an open chat sends open-failed naming it and leaves no agent and no row" (Review Focus 3)
  - "an agent:start error sends open-failed with the reason and writes no row" (Review Focus 4)
  - "decline sends declined"
  - "a gate unanswered for 30 min expires and sends expired"
  - "slack-start opens with no gate"
  - "slack-assignment returns the open conversation for the session, else null"
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/slack/__tests__/request.test.ts lib/daemon/__tests__/gates-handlers.test.ts lib/daemon/handlers/__tests__/slack-chat.test.ts`
- [ ] **Step 3: Implement.** Keep the decision logic in `lib/slack/request.ts`, with deps injected. `gate.ts` only routes to it.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "slack: requests through a slack-open gate, approved opens start a bg agent"`

### Task 9: Lifecycle milestones and the open deadline

**Files:**
- Modify: `lib/daemon/slack-lifecycle.ts` (`finishClose` :117 sends `closed`; `tickSlackLifecycle` :232 sends `open-failed` for an assigned agent with no first message after 60 s)
- Modify: `lib/daemon/handlers/slack-chat.ts` (`chat:slack-close` passes the farewell as the `closed` summary)
- Test: `lib/daemon/__tests__/slack-lifecycle.test.ts`

**Interfaces:**
- Consumes: `sendMilestone` (Task 5), `listSupportTickets`, and `conversation.requesterHandle`, `requesterSession`, `assignedPane` (Task 4).
- Produces: `closeSupportPane(deps: { herdrRunnerFor(socket: string | null): HerdrRunner; log: Logger }, pane: string | null): Promise<boolean>` in `lib/slack/support-pane.ts`, shaped like `closePane` in `lib/daemon/handlers/herd.ts:329` (bare id via `parsePaneRef`, bg socket for a `bg:` ref, never throws, logs failure). The `closed` milestone kind gains `tickets: string[]` (issue ids) and renders them when non-empty.

- [ ] **Step 1: Write failing tests.**
  - "finishClose sends the requester a closed milestone with the reason, the farewell as summary, and the conversation's ticket ids"
  - "finishClose does not close the agent's pane (it must live through grace)"
  - "an assigned agent with no first message after 60 s closes the row as pane-gone, sends open-failed and closes its pane"
  - "closeSupportPane logs and returns false when herdr fails, and never throws"
  - "a closed milestone with the requester offline goes to the desk" (Review Focus 2)
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/daemon/__tests__/slack-lifecycle.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "slack: lifecycle milestones and the 60s open deadline"`

### Task 10: The mod starts the support skill from an assignment, and records gate answers

**Files:**
- Modify: `plugins/mattstack/hooks/slack-support.ts`
- Modify: `plugins/mattstack/hooks/slack-support-text.ts` (`touchesSlackSupport` :132)
- Test: `plugins/mattstack/hooks/slack-support.test.ts`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump)

**Interfaces:**
- Consumes: `chat:slack-assignment`, `chat:slack-start` (Task 8). It also consumes `gate:answer` with `by: "slack-mod"`.
- Produces:
  - **On `session.start`:** after registering, the mod calls `rt chat slack-assignment --session <await $.session.id()> --json`. With a conversation, it schedules `startSkill($, String(conversation))`.
  - **`command.run` on `slack-support`:** with a `composer` origin, it calls `rt chat slack-start <person> --brief - --requester-pane $HERDR_PANE_ID --json` with the problem on stdin, instead of `slack-open` plus a local skill start. It replies `Slack chat starting with <name>; I'll hear when it opens.`
  - **`tool.call` on `AskUserQuestion`:** it runs `const r = await next(e)`. When the question text carries the gate marker the request writes (`[slack-open <gateId>]`), it calls `rt gate answer <gateId> --answers <json> --by slack-mod`, then returns `r`.
  - **The shell deny:** it also denies `rt gate answer` with `--by slack-mod` or `--by console`, and `rt chat slack-(start|request|resume|assignment)`.

- [ ] **Step 1: Write failing tests** (with `claude-code/testing`).
  - "session.start with an assignment schedules rt:slack-support with the conversation id only"
  - "session.start without one starts nothing"
  - "/slack-support from composer calls slack-start with the problem on stdin, never on argv"
  - "an AskUserQuestion answer to a slack-open form is recorded by the mod as slack-mod"
  - "an ordinary AskUserQuestion records nothing"
  - "Bash running rt gate answer --by console is denied"
  - "Bash running rt chat slack-start is denied"
- [ ] **Step 2: Run them and see them fail.** Run: `claude plugin test plugins/mattstack`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "mattstack mod: start support from an assignment, record slack-open answers"`

### Task 11: The grace window and `!!claude`

**Files:**
- Modify: `lib/slack/format.ts` (`closingLine` :50)
- Modify: `lib/daemon/slack-lifecycle.ts` (`finishClose` calls `startGrace(id, closedAt + 3_600_000)`)
- Modify: `lib/daemon/slack-bridge.ts` (a graced sweep every 30 s)
- Modify: `lib/daemon.ts` (schedule `slack-grace` at :1074-1080, with `intervalMs: 30_000`)
- Create: `lib/slack/resume-phrase.ts`
- Test: `lib/slack/__tests__/resume-phrase.test.ts`, `lib/daemon/__tests__/slack-bridge.test.ts`, `lib/slack/__tests__/format.test.ts`

**Interfaces:**
- Consumes: `listGracedConversations`, `startGrace`, `endGrace` (Task 4); the gate open from Task 8 with meta `{action: "resume", conversation: number}`; `sendMilestone`.
- Produces:
  - `isResumePhrase(text: string): boolean`. The test is `/^\s*!!claude(\s|$)/i`.
  - `sweepGraced(now)` in the bridge. For each graced conversation, it reads history after `closed_at`, keeping only `msg.user === conv.slackUserId` and `isResumePhrase`. The first hit opens a resume gate and sends `resume-offered`. A later hit while that gate is open appends to the gate's context. Non-matching messages are never posted to the room.

- [ ] **Step 1: Write failing tests.**
  - `resume-phrase.test.ts`:
    - "`  !!Claude can you also check X` and a bare `!!claude` match"
    - "`ok !!claude` and `!!claudeX` do not" (Review Focus 1)
  - `format.test.ts`: "closingLine ends with the !!claude sentence, exactly as the spec's fixed line"
  - `slack-bridge.test.ts`:
    - "a graced conversation's !!claude message opens one resume gate and sends resume-offered"
    - "a second !!claude while the gate is open opens no second gate"
    - "an ordinary reply in grace opens nothing and posts nothing to the room"
    - "a conversation past grace_until is not read"
    - "declining the resume gate ends grace and closes the agent's pane"
    - "a conversation whose grace_until passes with no resume gets endGrace and its pane closed, once"
  - Grace end (expiry in the sweep, or a declined resume gate) calls `endGrace` then `closeSupportPane(conv.assignedPane)` (Task 9).
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/slack/__tests__/resume-phrase.test.ts lib/slack/__tests__/format.test.ts lib/daemon/__tests__/slack-bridge.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "slack: a 60 minute grace window with a !!claude resume offer"`

### Task 12: Resume, and room routing by conversation

**Files:**
- Modify: `lib/slack/request.ts` (`approveSlackResume`)
- Modify: `lib/daemon/handlers/slack-chat.ts` (`chat:slack-resume`)
- Modify: `lib/daemon/handlers/chat.ts` (`slackRoute` :938)
- Test: `lib/slack/__tests__/request.test.ts`, `lib/daemon/__tests__/chat-slack-participant.test.ts`

**Interfaces:**
- Produces:
  - `chat:slack-resume {conversation: number; requesterSession?: string; requesterHandle?: string; approved?: boolean}`. From a pane, it opens a resume gate. With `approved: true` (Flock or the console), it resumes at once.
  - `approveSlackResume(deps, {conversation, triggerTs?})`: opens a new row with `resumedFrom`, the old `room`, the old requester, and `last_read_ts` just before `triggerTs`.
    - Old agent alive (pane exists and is signed in as `agentHandle`): the new row is assigned to it, and a `resumed` item is enqueued ahead of the teammate's message.
    - Old agent gone: a fresh bg agent starts with a brief naming the old room and `ticketsForChain(oldConversation)` (Task 4). The new row records the fresh agent's id, session and pane.
    - It sends `resumed` with `agent: "same" | "fresh"` and calls `endGrace`.
  - `slackRoute`: when the sender is a conversation's `assignedAgent` handle, it routes by `conversation.room`, not `dmRoomName(fromId, toId)`.

- [ ] **Step 1: Write failing tests.**
  - "resume with the old agent alive assigns the new row to it and delivers resumed before the message"
  - "resume with the old agent gone starts a fresh agent whose brief names the old room"
  - "a fresh agent's chat_dm to the teammate posts to the old room"
  - "resume from a pane opens a gate; approved: true resumes at once"
  - "resume ends grace"
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/slack/__tests__/request.test.ts lib/daemon/__tests__/chat-slack-participant.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "slack: resume a closed chat with the same or a fresh agent"`

### Task 13: MCP tools, CLI verbs and status fields

**Files:**
- Modify: `lib/mcp/chat-tools.ts` (`chat_slack_request` and `chat_slack_resume` next to :395-419, plus `ChatToolDeps` :21 and `realChatToolDeps` :38)
- Modify: `lib/mcp/__tests__/tools.test.ts` (`NAMES` :14), `lib/mcp/__tests__/chat-slack-tools.test.ts`
- Modify: `commands/chat-slack.ts`, `lib/command-tree-def.ts` (:1784-1840)
- Modify: `chat:slack-status` data (`packages/rt-client/src/commands.ts` :1101), which adds `requester`, `requesterPane`, `resumedFrom`, `graceUntil`, `assignedSession`, `assignedPane`, `tickets` (`SupportTicket[]` from `ticketsForChain`) on every row, and `brief` for the caller's own conversation only. `rt chat slack-status` prints the session, pane and ticket ids.
- Regenerate: `plugins/mattstack/attachments/mcp-tools/reference.md` with `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`
- Test: `commands/__tests__/chat-slack.test.ts`

**Interfaces:**
- Produces:
  - `chat_slack_request {person: string, brief: string}`. The handler fills `requesterSession`, `requesterHandle` and `repo` from env and cwd. Its shell form is `rt chat slack-request`.
  - `chat_slack_resume {conversation: number}`, with shell form `rt chat slack-resume`.
  - CLI verbs `slack-request`, `slack-resume`, `slack-start` and `slack-assignment` are all `hidden: true`.

- [ ] **Step 1: Write failing tests.**
  - "roster matches the published tool names" (updated `NAMES`)
  - "chat_slack_request sends the brief and the caller's session and handle"
  - "chat_slack_resume sends the conversation id"
  - "slack-status returns the brief only for the caller's own conversation"
  - "slack-status returns assignedSession, assignedPane and the chain's tickets"
  - "slack-request --json prints gateId"
- [ ] **Step 2: Run them and see them fail.** Run: `bun test lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/chat-slack-tools.test.ts commands/__tests__/chat-slack.test.ts`
- [ ] **Step 3: Implement, and regenerate the reference.** Then run `bash plugins/mattstack/tests/test-mcp-tools-reference.sh`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "chat: slack request and resume tools, status gains requester fields"`

### Task 14: The board never shows a `slack-open` gate

**Files:**
- Modify: `apps/board/src/gates/ingest.ts` (`isBoardGateFrame` :43, `buildQueueExtras` :267)
- Modify: `apps/board/src/gates/badge.ts` (`countsForBadge` :7)
- Test: `apps/board/src/__tests__/gates-ingest.test.ts`, `apps/board/src/__tests__/gates-badge.test.ts`

- [ ] **Step 1: Write failing tests.**
  - "a slack-open frame is ignored"
  - "buildQueueExtras skips slack-open rows"
  - "countsForBadge is false for slack-open"
- [ ] **Step 2: Run them and see them fail.** Run: `cd apps/board && bun test src/__tests__/gates-ingest.test.ts src/__tests__/gates-badge.test.ts`
- [ ] **Step 3: Implement.** Add one shared `const SLACK_OPEN_KIND = 'slack-open'` exclusion. Check it in all three places.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "board: never show slack-open gates"`

### Task 15: Console Slack gates, mocked first

**Files:**
- Mock: a new frame in the console's pen.dev design file. Measure the console's live tokens first, and save before copying.
- Modify: `apps/console/src/server/gates.ts` (add `listSlackGates()` with the filter `{kind: 'slack-open'}`, plus a route `GET /api/gates/slack`; the existing `/api/gates/:id/answer` already answers with `by: "console"`)
- Modify: `apps/console/src/server/event-bridge.ts` (a second rule: `gate/opened/*`, `kind: 'slack-open'`, url `${consoleUrl}/gates/{id}`)
- Modify: `apps/console/src/app/gates/GateRedirect.tsx` (a `slack:` subject routes to `/slack-gates?gate=<id>`)
- Create: `apps/console/src/app/gates/SlackGates.tsx`, plus a route in `app/routes.ts` and `App.tsx`, and a nav badge with the open count
- Test: `apps/console/src/server/gates.test.ts`, `apps/console/src/server/event-bridge.test.ts`, `apps/console/src/app/gates/GateRedirect.test.tsx`, `apps/console/src/app/gates/SlackGates.test.tsx`

- [ ] **Step 1: Mock.** Draw a list of open Slack gates. Each row shows the person, the first lines of the brief, the age, and Approve and Decline. Include an empty state. Show it to Matt and iterate until he approves, per the live UI rule (no spec changes).
- [ ] **Step 2: Write failing tests.**
  - "listSlackGates pages slack-open gates"
  - "the bridge notifies slack-open gates at /gates/{id}"
  - "GateRedirect sends a slack: gate to /slack-gates?gate=id"
  - "SlackGates approve posts answers to /api/gates/:id/answer"
- [ ] **Step 3: Run them and see them fail.** Run: `cd apps/console && npx vitest run src/server/gates.test.ts src/server/event-bridge.test.ts src/app/gates/`
- [ ] **Step 4: Implement to the approved mock,** using the kit's components and tokens only.
- [ ] **Step 5: Run them and see them pass. Render check:** look at it in Fast Browser at the console's `deck list` localhost URL. Take screenshots in both color schemes and open them for Matt. Say what looks wrong.
- [ ] **Step 6: Commit.** `git commit -m "console: Slack gates list for slack-open approvals"`

### Task 16: Flock reads the owner from the requester and starts through `slack-start`

Repo: `~/Documents/GitHub/flock`, on `main`, after Task 13 has merged in rt.

**Files:**
- Modify: `Sources/FlockCore/Chat/ChatSidebar.swift` (`ChatSidebarChat` decodes `requesterPane`; `homePane` becomes `linkedPane ?? requesterPane ?? pane`)
- Modify: `Sources/FlockCore/Chat/ChatSlackSupport.swift` and `Sources/Flock/Chat/ChatStore.swift` (`startSlackChat` calls `rt chat slack-start <person> --brief - --requester-pane <pane> --json` instead of starting an agent and typing a line; the local `slackAgents` map is kept for one release only to read old entries)
- Test: `Tests/FlockCoreTests/ChatSidebarTests.swift`, `Tests/FlockChromeRender/ChatStoreSlackTests.swift`

rt side: `requesterPane` already comes back from `chat:slack-status` (Task 13). It is stored from `chat:slack-start`'s `requesterPane`, or, for a request, from the requester session's presence at approval.

- [ ] **Step 1: Write failing tests.**
  - "a chat with requesterPane shows on that pane's tab"
  - "startSlackChat runs slack-start with the problem on stdin and types nothing into any pane"
- [ ] **Step 2: Run them and see them fail.** Run both xcodebuild commands from Tasks 2 and 3.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass. Render check:** start a chat from a pane's button in the dev app. It must show only in that pane's sidebar. Take screenshots in both schemes.
- [ ] **Step 5: Commit** on flock main: `git commit -m "chat: owner from rt's requester, start through slack-start"`

### Task 17: Skill updates

**Files:**
- Modify: `skills/rt-slack-support/SKILL.md`. At :5 the argument becomes `<conversation>`. At :11-15 the skill reads the brief with `chat_slack_status`. At :37-38 the rule becomes "tickets go through `chat_slack_ticket` only, which files them in Linear; tell the teammate you wrote it up, never an id or link". Add: a resumed chat with no history in context starts with `rt chat read <room>`.
- Modify: `skills/rt-chat/SKILL.md` (:19-24 and :553-555). It documents `chat_slack_ticket` as returning id and url, and adds a short "Asking for a support chat" section: write the brief, call `chat_slack_request`, expect milestones from `rt.support`, report them, and don't act on leftovers unless the operator asks.

- [ ] **Step 1:** Load superpowers:writing-skills. Run a RED baseline: a subagent given the old skill and a ticket scenario, recording what it tells the teammate.
- [ ] **Step 2:** Make the edits.
- [ ] **Step 3:** GREEN. Rerun the scenario: the agent files through the tool and never names an id. Then run `bun test lib/__tests__/no-unlinkable-skills.test.ts`.
- [ ] **Step 4: Commit.** `git commit -m "skills: slack support reads its brief, files in Linear, requester section"`

### Task 18: Live test with the operator

No code. Run it after everything above has merged and the dev app has been rebuilt (rt:build-dev-app).

- [ ] **Step 1:** From a pane, Matt says "start a slack support session with <teammate>". Check that the gate shows in the pane and the console, and nothing shows on the board.
- [ ] **Step 2:** Approve in the pane. The requester gets `opened`, and Flock shows the chat on that pane's tab only.
- [ ] **Step 3:** The support agent files a ticket. The requester gets the `ticket` milestone with a SUPPORT id, and the Slack DM shows no id.
- [ ] **Step 4:** Close. The closing line carries the `!!claude` sentence, and the requester gets `closed`.
- [ ] **Step 5:** The teammate sends an ordinary reply, and nothing happens. Then they send `!!claude one more thing`, and the resume gate appears. Approve it: `resumed` arrives and the agent answers. Close again.
- [ ] **Step 6:** Record the results in the PR body.
