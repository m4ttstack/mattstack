# Support Host (backbone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A roster member's daemon can send a help request that opens a Maude chat on the org's designated host, with status back, host control and tickets, ready for the UI to sit on.

**Architecture:** The switchboard gains a support queue separate from the board inbox. Each daemon polls it outbound, proves org membership with an HMAC keyed from the org's members secrets, and keeps requests in `state.db`. The host's daemon opens chats through `approveSlackOpen`.

**Tech Stack:** Bun, TypeScript, bun:sqlite, bun:test, node:crypto.

**Spec:** `docs/superpowers/specs/2026-11-24-support-host-design.md`

**Not in this plan:** the spec's UI section (floating button, form, row menu entry, app menu and window, Settings > Team, the viewer's Stop button). It is mocked in pen.dev and built live with the operator once this lands, on the verbs in Task 9. This plan ships dark: no org has support on.

## Global Constraints

- Public repo: invented names only (Alex, acme). No employer names and no ticket ids in code or tests.
- Every key, copy string and comment follows `.claude/rules/*` for its area. No em dashes or en dashes. A comment states only a constraint the code cannot show.
- A request's text is capped at 8000 characters, a context part's value at 2000, and parts at 12. A relay body is capped at 64 KiB.
- Relay retention 7 days. Away after 2 minutes. Stop holds the person's next request for 24 hours. Cap 2 open chats, 1 per person.
- No CLI verb, MCP tool or `rt_verb` route sends a request, accepts, or stops.
- The host check order is: MAC, roster, support on and this person is the host, this Mac accepts, Slack account, already open, already waiting, stop hold, cap.
- A MAC or roster failure never gets a reply.
- `slack-open` gates never appear on the board.
- Run `bun test` from the repo root, targeted files only. After editing `packages/rt-client/src`, rebuild as `.claude/rules/workspace-packages.md` says.
- `SCHEMA_VERSION` becomes 19. Announce it in `#mattstack` before merging, and renumber if second.
- Commit after each task, ending with the attribution line from the session.

## Review Focus

- A request signed just before the key rotated, or by a Mac that has not pulled the rotation: it still opens (previous key accepted for 7 days). Task 2.
- The daemon restarts between storing a request and starting the agent: the request resumes once, never twice. Task 6.
- The host's Mac wakes to ten queued requests: two open in arrival order and the rest become gates. Task 6.
- Support is turned off, or the host changes, while a request waits as a gate: the gate closes and the sender reads `not-accepting`. Task 7.
- A teammate with two Macs: a status reaches the Mac that sent the request, whichever polls first. Task 5.

## File Structure

| File | Responsibility |
|---|---|
| `apps/board/switchboard/support.ts` (new) | Relay store and routes for support |
| `packages/rt-client/src/support.ts` (new) | Wire types, limits, statuses |
| `lib/support/proof.ts` (new) | Canonical bytes and MAC |
| `lib/support/org-key.ts` (new) | Read, create and rotate the org's support key |
| `lib/support/config.ts` (new) | Resolved support settings and this Mac's role in them |
| `lib/support/relay.ts` (new) | Outbound relay client |
| `lib/state/support-store.ts` (new) | `support_requests`, `support_outbox`, `support_stops` |
| `lib/support/sync.ts` (new) | Poll, verify, store, ack, flush the outbox |
| `lib/support/host.ts` (new) | Host-side decisions and progress |
| `lib/support/stop.ts` (new) | Immediate stop |
| `lib/support/readiness.ts` (new) | Host readiness |
| `lib/daemon/handlers/support.ts` (new) | `support:*` daemon verbs |

---

### Task 1: Relay support queue

**Files:**
- Create: `apps/board/switchboard/support.ts`, `apps/board/switchboard/__tests__/support.test.ts`, `packages/rt-client/src/support.ts`
- Modify: `apps/board/switchboard/server.ts` (mount routes after the bearer check, prune hourly), `apps/board/switchboard/store.ts` (`deleteBoard` clears support rows), `packages/rt-client/src/index.ts` (export)

**Interfaces:**
- Produces, in `packages/rt-client/src/support.ts`:

```ts
export type SupportKind = "request" | "status";
export interface SupportDraft { id: string; to: string; kind: SupportKind; sentAt: number; body: string; mac: string }
export interface SupportMessage extends SupportDraft { from: string; receivedAt: number }
export interface SupportHostState { accepting: boolean; lastSeenAt: number | null }
export const SUPPORT_BODY_MAX_BYTES = 64 * 1024;
export const SUPPORT_TTL_MS = 7 * 24 * 60 * 60_000;
export const SUPPORT_TEXT_MAX = 8000;
export const SUPPORT_PART_MAX = 2000;
export const SUPPORT_PARTS_MAX = 12;
export const SUPPORT_AWAY_MS = 2 * 60_000;
export function parseSupportDraft(v: unknown): SupportDraft | null;
export function parseSupportMessage(v: unknown): SupportMessage | null;
```

- Produces, in `switchboard/support.ts`: `class SupportStore { constructor(db: Database) }` with `publish(from, draft, now): { ok: true } | { ok: false; error: "unknown-recipient" | "full" }`, `list(username, kind, limit?)`, `newestAfter(username, kind, since)`, `ack(username, keys: { from: string; id: string }[])`, `setHost(username, machine, accepting, now): "ok" | "other-machine"`, `host(username): SupportHostState`, `seen(username, machine, now)`, `clear(username)`, `prune(now)`; and `makeSupportHandler(store: SupportStore, waiters: InboxWaiters, now: () => number): (req: Request, pathname: string, username: string) => Promise<Response | null>`.
- Routes, all under the board token: `POST /support/messages` (201), `GET /support/messages?kind=`, `GET /support/wait?kind=&since=&timeout=`, `POST /support/ack` `{ keys }`, `PUT /support/host` `{ accepting, machine }`, `GET /support/host/<username>`. A list or wait for `kind=request` carries `machine` and records last seen.

- [ ] **Step 1: Write the failing tests** (copy `setup()` from `server.test.ts`)

```ts
test("a request reaches only its recipient, with the sender taken from the token")
  // ada posts { id: "r1", to: "alex", kind: "request", ... }; alex lists from === "ada"; bo lists []
test("the board inbox never holds a support message")        // GET /inbox for alex → envelopes: []
test("the same id from two senders is two messages")         // ada r1 and bo r1 both listed
test("a repeat of one sender's id is one message")           // 201 twice, list length 1
test("ack removes only the named sender's message")          // ack {from: ada, id: r1} leaves bo's r1
test("listing by kind keeps requests and statuses apart")
test("a body over 64 KiB is 413")
test("21 pending from one sender to one recipient is 429")
test("an unknown recipient is 422 and a bad token 401")
test("host defaults to not accepting")                       // { accepting: false, lastSeenAt: null }
test("a second machine is refused while the first was seen within 10 minutes") // PUT → 409
test("a second machine takes over after 10 minutes")         // PUT → 200
test("only a request poll from the accepting machine moves lastSeenAt")
test("a parked wait wakes when a message arrives")
test("messages older than 7 days are pruned")
test("deleting a board drops its messages and host flag")
```

- [ ] **Step 2: Run:** `bun test apps/board/switchboard/__tests__/support.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Tables `support_messages` with primary key `(recipient, from_user, id)` and `support_hosts (username PRIMARY KEY, machine, accepting, last_seen_at)`, created with `IF NOT EXISTS`. Give support its own `InboxWaiters`, keyed `<kind>:<username>`, so a support wait never evicts a board wait. Cap reading of the body the way `readCappedText` does, with the cap as a parameter.
- [ ] **Step 4: Run** the new file and `bun test apps/board/switchboard`. Expected: PASS.
- [ ] **Step 5: Commit** `switchboard: support queue and host flag`

### Task 2: Org support key and proof

**Files:**
- Create: `lib/support/proof.ts`, `lib/support/org-key.ts`, `lib/support/__tests__/proof.test.ts`, `lib/support/__tests__/org-key.test.ts`
- Modify: `lib/team/members.ts` (`membersRemove` rotates after the sops recipients change), `lib/team/__tests__/members.test.ts`

**Interfaces:**
- Consumes: `SupportDraft`, `SupportKind` (Task 1); `readTeamSecret`, `writeTeamSecret`, `createRealTeamSecretsSeams`.
- Produces:

```ts
export interface ProofInput { kind: SupportKind; id: string; org: string; from: string; to: string; sentAt: number; body: string }
export function supportMac(key: string, input: ProofInput): string;                       // hex
export function verifySupportMac(keys: readonly string[], input: ProofInput, mac: string): boolean;

export interface SupportKeys { current: string; previous: string | null; rotatedAt: number | null }
export function readSupportKeys(org: string, seams: SecretsSeams): Promise<SupportKeys | null>;
export function ensureSupportKey(org: string, seams: SecretsSeams): Promise<void>;
export function rotateSupportKey(org: string, seams: SecretsSeams, now: number): Promise<boolean>; // false when none exists
export function usableKeys(keys: SupportKeys, now: number): string[];                     // previous only within SUPPORT_TTL_MS
```

- Secret: domain `support`, key `requestKey`, one JSON string `{ current, previous, rotatedAt }`. Each key is 32 random bytes, base64.

- [ ] **Step 1: Write the failing tests**

```ts
test("a MAC verifies for the same input and fails when any one field changes") // loop kind,id,org,from,to,sentAt,body
test("a MAC does not depend on how field boundaries fall")  // {id:"ab",org:"c"} differs from {id:"a",org:"bc"}
test("a wrong-length or non-hex mac is false, not a throw")
test("the same usernames with another org's key do not verify")
test("rotation keeps the old key usable for 7 days and not after")
test("rotate with no key writes nothing and returns false")
test("ensure keeps an existing key")
test("removing a member rotates the support key")            // members.test.ts
test("a rotation that fails warns and leaves the removal done") // members.test.ts
```

- [ ] **Step 2: Run** `bun test lib/support/__tests__ lib/team/__tests__/members.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** HMAC-SHA256 over `JSON.stringify(["support-v1", kind, id, org, from, to, sentAt, body])`, usernames through `canonicalUsername`, compared with `timingSafeEqual`. `org` is the normalized remote of the org clone (`parseOriginUrl`), which survives a folder rename.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `support: org key and request proof`

### Task 3: Settings, config and `rt team support`

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts`, `registry-schemas.ts`, `settings/__tests__/schema-examples.ts`, `apps/console/src/app/settings/groups.ts`, `commands/team.ts`, `lib/command-tree-def.ts`, plus any lock file the registry tests name
- Create: `lib/support/config.ts`, `lib/support/__tests__/config.test.ts`, `commands/__tests__/team-support.test.ts`

**Interfaces:**
- Produces keys: `support.enabled` (boolean, org, default `false`), `support.host` (string, org, `defaultNote: "Not set, so no one answers support requests."`), `support.acceptRequests` (boolean, machine, default `false`). Set none of them `repoScoped`.
- Produces:

```ts
export interface SupportConfig { org: string; orgRemote: string; enabled: boolean; host: string | null; me: string | null; isHost: boolean; acceptHere: boolean; roster: { username: string; name?: string }[] }
export function supportConfig(p?: Probes): SupportConfig | null;   // null with no org
export function onRoster(cfg: SupportConfig, username: string): boolean; // canonical compare
```

- CLI: `rt team support on --host <username> [--json]`, `rt team support off [--json]`, `rt team support status [--json]`. `on` refuses a host not on the roster, runs `ensureSupportKey`, then writes `support.host` and `support.enabled`. `off` writes only `support.enabled`. `status` is read-only. Reads follow `assertMayWrite`.

- [ ] **Step 1: Write the failing tests**

```ts
test("no org is null")
test("enabled with no host, or a host off the roster, has isHost false")
test("host compare ignores case")
test("acceptHere is false unless this person is the host and the org has support on")
test("support on writes the key before the settings")     // recorded call order
test("support on refuses a name that is not on the roster")
test("a member is refused with the org's admins named")
test("support off leaves the key and host in place")
```

- [ ] **Step 2: Run** `bun test lib/support/__tests__/config.test.ts commands/__tests__/team-support.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement,** following rt:settings' checklist, `.claude/rules/command-tree.md` and rt:ui-copy.
- [ ] **Step 4: Run** those two, `bun test packages/rt-client/src/settings`, and `bun run console:test`. Expected: PASS.
- [ ] **Step 5: Commit** `support: settings and rt team support`

### Task 4: Support store

**Files:**
- Create: `lib/state/support-store.ts`, `lib/state/__tests__/support-store.test.ts`
- Modify: `lib/state/db.ts` (`SCHEMA_VERSION = 19`, `V19_SCHEMA` with `IF NOT EXISTS` only), `lib/state/index.ts`

**Interfaces:**
- Produces:

```ts
export type SupportState = "sent" | "received" | "opening" | "opened" | "waiting" | "already-waiting" | "already-open" | "declined" | "not-accepting" | "failed" | "expired";
export interface SupportPart { key: "versions" | "setup" | "mr"; label: string; value: string }
export interface SupportRequest { id: string; direction: "in" | "out"; peer: string; org: string; text: string; parts: SupportPart[]; slackUserId: string; state: SupportState; reason: string | null; dmLink: string | null; conversationId: number | null; gateId: string | null; sentAt: number; receivedAt: number; updatedAt: number }
export function insertRequest(r: Omit<SupportRequest, "updatedAt">, db?): boolean;            // false for a repeat
export function getRequest(direction, peer, id, db?): SupportRequest | null;
export function listRequests(direction, states?: SupportState[], db?): SupportRequest[];      // oldest receivedAt first
export function moveRequest(r: Pick<SupportRequest, "direction" | "peer" | "id">, from: SupportState[], patch: Partial<Pick<SupportRequest, "state" | "reason" | "dmLink" | "conversationId" | "gateId">>, now: number, db?): boolean; // CAS on state
export function requestForConversation(conversationId: number, db?): SupportRequest | null;
export function requestForGate(gateId: string, db?): SupportRequest | null;
export function queueStatus(o: { id: string; to: string; body: string }, now: number, db?): void;
export function pendingStatuses(db?): { id: string; to: string; body: string; createdAt: number }[];
export function dropStatus(id: string, to: string, db?): void;
export function recordStop(slackUserId: string, now: number, db?): void;
export function stoppedSince(slackUserId: string, since: number, db?): boolean;
export function pruneSupport(now: number, db?): void;   // terminal rows past CHAT_RETENTION_MS
```

- [ ] **Step 1: Write the failing tests**

```ts
test("a repeat insert is false and changes nothing")
test("two peers may use the same id")
test("moveRequest moves only from a named state")          // second caller gets false
test("a queued status and its state move commit together") // throw inside the transaction leaves neither
test("stoppedSince is true inside the window and false after")
test("prune keeps open and waiting rows")
test("a v18 db gains the tables and keeps its rows")
```

- [ ] **Step 2: Run** `bun test lib/state/__tests__/support-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Primary key `(direction, peer, id)`.
- [ ] **Step 4: Run** `bun test lib/state/__tests__`. Expected: PASS.
- [ ] **Step 5: Commit** `state: support requests (schema 19)`

### Task 5: Relay client and sync

**Files:**
- Create: `lib/support/relay.ts`, `lib/support/sync.ts`, `lib/support/__tests__/relay.test.ts`, `lib/support/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4, `readBoardSwitchboardToken`, `switchboardUrl`. Follow `lib/daemon/peer-waker.ts` for the long-poll's backoff, abort and wake handling.
- Produces:

```ts
export interface SupportRelay {
  send(d: SupportDraft): Promise<"ok" | "unknown-recipient" | "full" | "unauthorized" | "unreachable">;
  list(kind: SupportKind): Promise<SupportMessage[] | null>;
  wait(kind: SupportKind, since: number, signal: AbortSignal): Promise<{ woke: boolean; cursor: number } | null>;
  ack(keys: { from: string; id: string }[]): Promise<boolean>;
  setHost(accepting: boolean): Promise<"ok" | "other-machine" | "failed">;
  host(username: string): Promise<SupportHostState | null>;
}
export function createSupportRelay(o: { url: string; token: string; machine: string; fetch?: typeof fetch }): SupportRelay;

export interface StatusBody { requestId: string; state: SupportState; reason?: string; dmLink?: string }
export interface RequestBody { text: string; parts: SupportPart[]; slackUserId: string }
export interface SyncDeps { db: Database; relay(): Promise<SupportRelay | null>; config(): SupportConfig | null; keys(): Promise<SupportKeys | null>; onRequest(r: SupportRequest): void; onStatus(r: SupportRequest): void; now(): number; log: Pick<Logger, "info" | "warn" | "debug"> }
export function createSupportSync(deps: SyncDeps): { pull(kind: SupportKind): Promise<void>; flush(): Promise<void> };
```

- [ ] **Step 1: Write the failing tests**

```ts
test("a request is stored before it is acked")                        // ack sees the row
test("a request whose store write throws is not acked, and the next message still is")
test("a bad MAC, another org's key, or a sender off the roster is acked, logged and never stored or answered")
test("unreadable keys ack nothing")                                   // key arrives later, request opens then
test("a request signed with the previous key inside 7 days is stored")
test("a repeat delivery calls onRequest once")
test("a Mac that is not the accepting host pulls no requests")
test("a status for a request this Mac did not send is left unacked")
test("a status from anyone but the request's host is acked and ignored")
test("a late status never moves a terminal request back")
test("flush keeps a status the relay did not take and drops one it did")
```

- [ ] **Step 2: Run** `bun test lib/support/__tests__`. Expected: FAIL.
- [ ] **Step 3: Implement.** Statuses get id `<requestId>:<state>`. Sign at send time. Compute the request's `org` from `SupportConfig.orgRemote`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `support: relay client and sync`

### Task 6: Opening a chat on the host

**Files:**
- Create: `lib/support/host.ts`, `lib/support/__tests__/host.test.ts`
- Modify: `lib/slack/request.ts`, `lib/slack/__tests__/request.test.ts`, `lib/slack/client.ts` (`authTest` also returns `teamId`)

**Interfaces:**
- Produces, in `request.ts`, an options argument on the existing function:

```ts
export interface SupportOpenOptions { firstItem: string; maxOpen: number | null }
export function approveSlackOpen(deps, meta, options?: SupportOpenOptions): Promise<{ ok: true; conversation: number } | { ok: false; reason: string; code?: "cap" | "busy" }>;
```

  With `options`, the open transaction first counts open conversations (`maxOpen` null skips it, code `cap`), then inserts the row, the `message` item and the room post under the teammate's handle. A loss stops the started agent, as today. `tell` runs only for a failure.
- Produces, in `host.ts`:

```ts
export interface HostDeps extends SlackOpenDeps { config(): SupportConfig | null; defaultRepo(): string | null; notifyOpening(r: SupportRequest, room: string): void; dmLink(): Promise<string | null>; chain: { run<T>(f: () => Promise<T>): Promise<T> } }
export const SUPPORT_MAX_OPEN = 2;
export const SUPPORT_STOP_HOLD_MS = 24 * 60 * 60_000;
export function takeRequest(deps: HostDeps, r: SupportRequest): Promise<void>;
export function tickRequests(deps: HostDeps): Promise<void>;
export function renderRequest(r: SupportRequest): string;        // text, then each part as "<label>: <value>"
```

- `takeRequest` applies the check order from the Global Constraints, from "support on" on. `received` becomes `opening` by CAS before the agent starts. `notifyOpening` fires once the conversation row exists.
- `tickRequests`: `opening` with a conversation becomes `opened` once `agentHasPosted`, with `dmLink` (`slack://user?team=<team>&id=<host user id>`); becomes `failed` when that conversation closed without a post. `opening` with no conversation past 3 minutes becomes `failed`. `received` rows are taken again in arrival order.
- The brief is `<name> asked for help from mattstack at <ISO time>. Their message arrives first.`, plus `It was sent over a day ago, so ask whether they still need help.` past 24 hours.

- [ ] **Step 1: Write the failing tests**

```ts
test("under the cap it opens with no gate and the request is the first item, framed as a message")
test("the teammate's text is not in the brief")
test("received, then opened only after the agent posts, each queued once")
test("the notification fires when the chat is created, before the agent posts")
test("an agent that never posts sends failed")
test("a start failure sends failed with its reason, and the host is told")
test("support off, not the host, or not accepting sends not-accepting")
test("a Slack id that is missing, deleted, a bot or the host itself sends failed and opens nothing")
test("already open sends already-open and starts no agent")
test("a second request while one waits sends already-waiting")
test("ten requests at once open two, in arrival order, and eight wait")
test("two requests racing for the last place open one")           // loser's agent stopped
test("an operator-started chat counts toward the cap")
test("a restart in received opens once; a restart in opening never starts a second agent")
test("a request inside the closed chat's grace window opens a new chat and ends the window")
test("a request over a day old says so in the brief")
```

- [ ] **Step 2: Run** `bun test lib/support/__tests__/host.test.ts lib/slack/__tests__`. Expected: FAIL.
- [ ] **Step 3: Implement.** Serialize `takeRequest` through `chain`; the transaction's count stays the guarantee.
- [ ] **Step 4: Run** the same command plus `bun test lib/daemon/handlers/__tests__/slack-open-seams.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `support: open a chat for a roster member's request`

### Task 7: Waiting requests as gates

**Files:**
- Modify: `lib/support/host.ts`, `lib/slack/request.ts` (`answerSlackOpen` routes `meta.action === "support"`), `apps/console/src/shared/slack-gate.ts` (`expiresAt` from `meta.expiresAt` when it is a number; days in `leftLabel`), `apps/console/src/shared/slack-gate.test.ts`
- Create: `lib/support/__tests__/host-gates.test.ts`

**Interfaces:**
- Produces: `SlackSupportMeta = { action: "support"; requestId: string; peer: string; person: string; personName: string; why: "cap" | "stopped"; expiresAt: number }`; `answerSupportGate(deps: HostDeps, row: GateRow): Promise<void>`. Gate subject `support:<peer>:<requestId>`. `meta.triggerTs` and `meta.brief` stay unset, so the console shows the teammate's words from `context`.
- Approve opens with `maxOpen: null`.

- [ ] **Step 1: Write the failing tests**

```ts
test("over the cap raises a gate and sends waiting")
test("a stop within 24 hours raises a gate below the cap, and after 24 hours does not")
test("approve opens past the cap")
test("decline sends declined")
test("the gate outlives 30 minutes and expires with the request at 7 days, sending expired")
test("expireSlackOpenGates leaves a support gate alone")
test("a typed @Maude gate and a support gate for one person coexist")   // neither superseded
test("a waiting request does not block chat_slack_request or a resume offer for that person")
test("a chat opened another way settles the waiting request as already-open and closes its gate")
test("turning support off, or changing the host, closes the gate and sends not-accepting")
test("gate_answer by an agent is still refused")
test("the board's badge and ingest skip it")                             // apps/board/src/gates tests
test("an answer recorded while the daemon was down is applied on the next tick")
```

- [ ] **Step 2: Run** `bun test lib/support/__tests__/host-gates.test.ts` and `bun run console:test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `tickRequests` reconciles every `waiting` row against its gate.
- [ ] **Step 4: Run** both, `bun test lib/daemon/__tests__/gates-handlers.test.ts`, and `bun run board:test`. Expected: PASS.
- [ ] **Step 5: Commit** `support: requests that wait for the host`

### Task 8: Stop and close outcome

**Files:**
- Create: `lib/support/stop.ts`, `lib/support/__tests__/stop.test.ts`
- Modify: `lib/slack/format.ts` (`stoppedLine(operatorName: string, persona: SlackPersona): string`), `lib/daemon/slack-lifecycle.ts` (the `closed` milestone also fires when `requestForConversation` finds one), `lib/daemon/__tests__/slack-lifecycle.test.ts`

**Interfaces:**
- Produces: `stopSlackChat(conversationId: number, deps: SlackLifecycleDeps): Promise<{ ok: true; told: boolean } | { ok: false; reason: string }>`.
- `stoppedLine` is `<prefix>This chat with <persona> is closed. <operator> will follow up with you.` with no trigger.
- Order: close the row (reason `operator`, no grace, other grace windows expired) and `recordStop` in one transaction, close the pane, send the line, then the `closed` milestone.

- [ ] **Step 1: Write the failing tests**

```ts
test("stop closes the row before the pane, so a late chat_dm is refused")
test("one fixed line reaches the teammate, with no farewell and no trigger")
test("there is no grace window, and a trigger right after does not offer a resume")
test("a second stop says the chat is already closed and sends nothing")
test("a pane that will not close, or a Slack failure, still leaves the chat closed and tells the host")
test("the stop is recorded for that Slack user only")
test("a pending close-request does not add its own closing lines")
test("a support chat's close milestone carries the outcome and tickets with no requester")
test("a manual chat with no requester still sends no close milestone")
```

- [ ] **Step 2: Run** `bun test lib/support/__tests__/stop.test.ts lib/daemon/__tests__/slack-lifecycle.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** When the pane will not close, the notification says the agent may still be running and names its pane.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `support: stop a chat at once`

### Task 9: Readiness, daemon verbs and wiring

**Files:**
- Create: `lib/support/readiness.ts`, `lib/daemon/handlers/support.ts`, `lib/support/__tests__/readiness.test.ts`, `lib/daemon/handlers/__tests__/support.test.ts`
- Modify: `packages/rt-client/src/commands.ts`, `client.ts`, `lib/daemon/command-router.ts`, `lib/daemon.ts` (sync loops and a 5s `support-tick` sweep beside `slack-bridge`), `plugins/mattstack/hooks/slack-support-text.ts` and its test, the mattstack `plugin.json` version

**Interfaces:**
- Produces, in `Commands`:

```ts
"support:availability": { payload: {}; data: { state: "hidden" } | { state: "disabled"; reason: string; host: string } | { state: "ready"; host: string; away: boolean } }
"support:context": { payload: { mr?: { url: string; state: string }; board?: string; app?: string }; data: { parts: SupportPart[] } }
"support:send": { payload: { id: string; text: string; parts: SupportPart[] }; data: { request: SupportRequest } }
"support:mine": { payload: {}; data: { requests: (SupportRequest & { away: boolean })[] } }
"support:host": { payload: {}; data: { isHost: boolean; accepting: boolean; missing: string[] } }
"support:accept": { payload: { on: boolean }; data: { accepting: boolean } }
"support:stop": { payload: { conversation: number }; data: { told: boolean } }
```

- `readiness(deps): Promise<string[]>` returns plain sentences, one for each missing item in the spec's **Ready** list, empty when ready. `support:accept { on: true }` refuses with them, and with "Another of your Macs is already accepting" on `other-machine`.
- Away for `availability`: `lastSeenAt` null or older than 2 minutes. Away for `mine`: state `sent` and `sentAt` older than 2 minutes. A `sent` row past 7 days moves to `expired`.

- [ ] **Step 1: Write the failing tests**

```ts
test("hidden: no org, support off, no host, host not accepting, or this person is the host")
test("disabled with its reason: no board token, no Slack connection, support key unreadable")
test("a relay that does not answer is hidden, never an error")
test("context holds versions and unready row ids only; the mr part only when asked")
test("context refuses an mr url that is not https, or that carries credentials")
test("send refuses unknown part keys, 13 parts, and text of 8001 characters or only spaces")
test("send reads the Slack id from this Mac's own token, never from the payload")
test("send stores nothing when the relay is unreachable, and a retry with the same id sends once")
test("send refuses while the sender has a request in sent, received, opening or waiting")
test("mine reads away after 2 minutes and expired after 7 days")
test("a status that arrives after sending raises one desk notification")
test("each missing readiness item is named on its own")      // table over the spec's list
test("accept refuses for anyone but the host")
test("accept off publishes the flag and answers queued requests not-accepting")
test("a daemon restart publishes the accepting flag again")
test("stop refuses an unknown or closed conversation")
test("no command tree verb or MCP tool names support:send, support:accept or support:stop")
test("the mod denies curl and nc lines that name those three verbs")
```

- [ ] **Step 2: Run** `bun test lib/support/__tests__/readiness.test.ts lib/daemon/handlers/__tests__/support.test.ts plugins/mattstack/hooks/slack-support.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Unready setup row ids come from `rt setup status --json`, run with an explicit `cli.ts` path and never `rtSelfArgv` alone, which starts a competing daemon here. A failed run leaves the part out. The sync loops idle, with no relay call, when `supportConfig()` is null or support is off; a sender polls statuses only while it has a non-terminal request.
- [ ] **Step 4: Run** the same command, `bun test packages/rt-client lib/mcp/__tests__`, and `bun run check`. Expected: PASS.
- [ ] **Step 5: Commit** `support: daemon verbs and wiring`

### Task 10: Skill, setup row, docs, end to end

**Files:**
- Modify: `skills/rt-slack-support/SKILL.md`, `lib/setup/validators/slack-support.ts`, `lib/setup/__tests__/validators-slack-support.test.ts`, `sites/docs/docs/rt/guides/slack-support-chat.mdx`, `.claude/rules/chat.md`
- Create: `lib/support/__tests__/end-to-end.test.ts`

**Interfaces:**
- Produces: setup row `org.support-host`, on the host's Mac only. `ready` while accepting with nothing missing, `needs-you` while accepting with something missing (detail: the first), `skipped` while not accepting. `required: false`.

- [ ] **Step 1: Write the failing end to end test** with two state dbs, a real `makeFetchHandler`, and fake Slack and Linear:

```ts
test("ask, open, ticket, close: the sender reads opened and the host hears the ticket and outcome")
test("host away for two days, then back: the request opens once and the brief says it is old")
test("a same-named user in another org is never answered")
test("support turned off with two queued: both read not-accepting and nothing opens")
test("stop, ask again: the second request waits for the host")
test("no ticket id or link reaches Slack or any status body")
```

- [ ] **Step 2: Run** `bun test lib/support/__tests__/end-to-end.test.ts`. Expected: FAIL only on gaps the earlier tasks left. Fix each in its owning file.
- [ ] **Step 3: Edit the skill** through superpowers:writing-skills and mattstack:editing-skills: when the first item is a request from mattstack, the first DM greets them, restates the problem, and asks what is needed next. The "Only the operator starts one" row becomes "A new chat starts from Need help? or the operator."
- [ ] **Step 4: Write the setup row test and row, then the docs** (ask for help, host, turn it on for an org; what is sent and that it goes through the relay) and the chat rule. Load rt:docs first. Docs describe only what has shipped, so the Need help? steps wait for the UI plan.
- [ ] **Step 5: Run** the end to end test, `bun test lib/setup/__tests__/validators-slack-support.test.ts`, `bun run check`, and `bun run test:e2e`. Expected: PASS.
- [ ] **Step 6: Commit** `support: skill, setup row, docs and end to end test`

## Landing order

1. Task 1 as its own PR. The relay deploys on merge, so confirm `GET /support/host/<you>` answers 200 on the live relay before anything else merges.
2. Tasks 2 to 10 as one PR.
3. The UI, on its own plan, with the operator.
