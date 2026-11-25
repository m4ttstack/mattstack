# Switchboard sealed text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Text people write to each other through the switchboard is readable only on the recipient's Mac.

**Architecture:** A small sealing module in rt wraps the bundled `age` with each recipient's roster key and binds the text to its message. The daemon exposes it as two commands; support and `rt` announcements call it directly, the board through rt-client. Boards store the sealed string and open it when a card is drawn.

**Tech Stack:** Bun, TypeScript, `age` 1.3.2 (bundled), macOS keychain via `AgeKeySeam`.

**Spec:** docs/superpowers/specs/2026-11-25-switchboard-sealed-text-design.md

## Global Constraints

- Never fall back to plain text, whatever fails.
- The private key never reaches argv, a file or a log. It is read only through `AgeKeySeam`.
- Sealed text is `age` output only. No cryptography of our own, no shared key.
- Usernames match through `canonicalHandle` (rt) or `canonicalUsername` (board).
- No new dependency and no `SCHEMA_VERSION` change: use existing JSON rows and kv.
- `lib/` stays UI-free; `lib/` never calls `console.*`; daemon handlers do not log outcomes.
- Copy follows `rt:ui-copy`. Exact strings below are fixed.
- Run only the named test files. CI runs the rest.
- `#` comments and tests carry no org, person or forge names from a real team.
- Tasks 7 and 9 change the look only where named; Matt looks at that live in Task 9.

## Review Focus

- A recipient named in a different case, or with a trailing space, than the roster: sealed all the same. (Task 1)
- A note of only emoji or 500 multi-byte characters: opens exactly as typed. (Task 1)
- Daemon restarts between a support send and its retry: the retry sends the same bytes and is not refused. (Task 4)
- A review-state to an author who is not on the roster plus ten who are: the ten read it, the author still gets the state. (Task 6)
- An older board's plain ask arriving after the upgrade: still shows its title and note. (Task 5)

---

### Task 1: The sealing module

**Files:**
- Create: `lib/team/sealed-text.ts`
- Test: `lib/team/__tests__/sealed-text.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SealBinding { type: string; from: string; subject: string }
export type SealFields = Record<string, string>;
export type SealResult =
  | { ok: true; sealed: string; unreachable: string[] }   // unreachable: named people with no usable key
  | { ok: false; reason: "no-recipients" | "unavailable" };
export type OpenResult =
  | { ok: true; fields: SealFields }
  | { ok: false; reason: "unavailable" | "not-for-this-key" | "mismatch" | "damaged" };
export interface SealedTextDeps {
  ageBin(): string | null;
  ageKey: AgeKeySeam;
  roster(): { username: string; agePublicKey?: unknown }[];
  now(): number;
}
export interface SealedText {
  seal(to: readonly string[], binding: SealBinding, fields: SealFields): Promise<SealResult>;
  open(sealed: string, binding: SealBinding): Promise<OpenResult>;
  /** This Mac's key is the one the roster holds for `username`. */
  holdsKeyOf(username: string): Promise<boolean>;
  /** Roster usernames with a usable key. */
  reachable(): string[];
}
export function createSealedText(deps: SealedTextDeps): SealedText;
export function realSealedText(): SealedText;   // readOrgRoster(currentOrg()), findBundledTool("age"), createRealAgeKeySeam()
```

- [ ] **Step 1: Write failing tests** (real `age` and `age-keygen`; a fake `AgeKeySeam` returning a key made by `age-keygen`; `test.skipIf(!findBundledTool("age"))`):
  - `seals for every recipient and each opens it`: two keys, one seal, both open to equal fields.
  - `matches a recipient by canonical username`: roster `Ada`, sealed to `" ADA "`.
  - `keeps text exactly`: fields `{ note: "👩‍🚀".repeat(100) + "é\u0000x\n" }` round-trips `toEqual`.
  - `names people with no key`: roster has Ada (key), Bob (none); sealing to Ada, Bob, Cy gives `unreachable: ["bob", "cy"]`.
  - `refuses with no recipients`: only Bob gives `{ ok: false, reason: "no-recipients" }`.
  - `ignores a malformed roster key`: `agePublicKey: "age1nope"` counts as unreachable (use `isValidAgePublicKey` from `lib/team/members.ts`).
  - `another person's key cannot open`: `not-for-this-key`.
  - `any binding difference is a mismatch`: for each of `type`, `from`, `subject` changed, `mismatch`; `from` differing only in case opens.
  - `damaged text`: `"nope"` and a truncated string give `damaged`.
  - `no age, no key, a locked keychain and a timeout are unavailable`: `ageBin` null, seam absent result, seam exit 36, seam throwing `AgeKeyTimeoutError`.
  - `the private key reaches no argv or file`: record spawns through a wrapper `ageBin` script; assert no argv holds `AGE-SECRET-KEY` and the temp folder is empty afterwards, after a success and after a failure.
  - `the key is read at most once per 5 minutes`: 3 opens, one seam read; `now` + 300_001, a second read. A failed read is not held.
- [ ] **Step 2: Run** `bun test lib/team/__tests__/sealed-text.test.ts`; expected FAIL, module missing.
- [ ] **Step 3: Implement.** Plaintext is `JSON.stringify({ v: 1, type, from: canonicalHandle(from), subject, fields })`. Seal: `age -r <key>…`, plaintext on stdin, stdout base64. Open: ciphertext to a 0600 file in a fresh `mkdtempSync` folder removed in `finally`; `age -d -i /dev/stdin <file>` with the identity on stdin. Kill after 10 s and treat as `unavailable`. `age` stderr matching `no identity matched` is `not-for-this-key`; any other non-zero open is `damaged`. Spawn with `env: childEnv()`.
- [ ] **Step 4: Run** the same command; expected PASS.
- [ ] **Step 5: Commit** `seal text for one person's key`.

### Task 2: Daemon commands and client

**Files:**
- Create: `lib/daemon/handlers/sealed-text.ts`
- Modify: `lib/daemon/command-router.ts`, `packages/rt-client/src/commands.ts` (type and list), `packages/rt-client/src/client.ts`, `packages/rt-client/src/index.ts`
- Test: `lib/daemon/handlers/__tests__/sealed-text.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: commands `text:seal` `{ payload: { to: string[]; binding: SealBinding; fields: SealFields }; data: SealResult }`, `text:open` `{ payload: { sealed: string; binding: SealBinding }; data: OpenResult }`; `textSeal(a, o?)`, `textOpen(a, o?)` in rt-client. The types move to `packages/rt-client/src/sealed-text.ts` and Task 1's module re-exports them.

- [ ] **Step 1: Write failing tests**: both commands pass through; malformed payloads (`to` not an array of strings, over 200 names, a field over 16 KB, a missing binding key, `sealed` over 256 KB) answer `ok: false` with `failure.code` `text-invalid`; neither appears as an `rt_verb` route or MCP tool (assert on the roster the way `support:send` is guarded).
- [ ] **Step 2: Run** `bun test lib/daemon/handlers/__tests__/sealed-text.test.ts`; expected FAIL.
- [ ] **Step 3: Implement**; add both to every list `support:mine` is in. Rebuild rt-client's `dist` the way `.claude/rules/workspace-packages.md` says.
- [ ] **Step 4: Run** it again plus `bun test packages/rt-client`; expected PASS.
- [ ] **Step 5: Commit** `daemon: text:seal and text:open`.

### Task 3: Announcements

**Files:**
- Modify: `lib/team/announce.ts`, `packages/rt-client/src/announcement.ts`, `commands/team.ts` (the announce report)
- Test: the existing `sendAnnouncement` and announcement parser test files

**Interfaces:**
- Consumes: Task 1 (`AnnounceSeams` gains `sealedText: SealedText`).
- Produces: `AnnouncementPayload` gains `sealed?: string`; `ANNOUNCEMENT_PLACEHOLDER = { title: "Announcement", message: "Update mattstack to read this." }`; `announcementBinding(id: string, from: string): SealBinding` = `{ type: "announcement", from, subject: id }`; `sendAnnouncement` returns `{ delivered: number; unreadable: number }`.

- [ ] **Step 1: Write failing tests**: the posted body holds neither the title nor the message and parses with today's `parseAnnouncementPayload` to the placeholder; `unreadable` counts roster members with no key; a seal result `ok: false` throws `announce-not-sealed` ("This Mac could not lock the announcement, so nothing was sent") and posts nothing. The sender is included in the recipients. `from` is `readTeamLocal(p, slug).forgeUsername`; with none, the same throw.
- [ ] **Step 2: Run** them; expected FAIL.
- [ ] **Step 3: Implement.** Recipients are the whole org roster. The human report adds "3 people cannot read it yet" when `unreadable > 0`; `--json` gains `unreadable`.
- [ ] **Step 4: Run**; expected PASS.
- [ ] **Step 5: Commit** `announcements: sealed to the people who read them`.

### Task 4: Support requests and statuses

**Files:**
- Modify: `lib/support/sync.ts`, `lib/daemon/handlers/support.ts`, `lib/support/service.ts`, `lib/support/readiness.ts`
- Test: `lib/support/__tests__/{sync,readiness,end-to-end}.test.ts`, `lib/daemon/handlers/__tests__/support.test.ts`

**Interfaces:**
- Consumes: Task 1 (`SupportSeams`, `SyncDeps` and `SupportHandlerDeps` gain `sealedText: SealedText`).
- Produces: `supportBinding(kind: SupportKind, id: string, from: string): SealBinding` = `{ type: "support-" + kind, from, subject: id }` in `lib/support/proof.ts`.

- [ ] **Step 1: Write failing tests**
  - `the relay holds none of the text`: end to end, after a send and each status, the relay's stored rows contain no request text, part value, Slack id, reason, persona or link.
  - A request body is `JSON.stringify({ sealed })`; text, parts and `slackUserId` travel as one field `body` holding today's JSON.
  - A host opens only after `judge` says `proved`; a forged message never reaches `open`.
  - `open` `unavailable` leaves the request unacked and unstored, then takes it on a later pull. `not-for-this-key` likewise: the person's other Mac may hold the key. `mismatch` and `damaged` answer today's `UNREADABLE` status and ack.
  - A plain (unsealed) request body answers `UNREADABLE`.
  - A status keeps `requestId`, `state`, `at` readable and seals `reason`, `persona`, `dmLink`. When sealing is not `ok`, it sends the state alone. When a received status's text cannot open, the state still applies and the text fields are null.
  - `support:send`: host with no key refuses `no-host-key` "<Host> can't receive requests yet."; `unavailable` refuses `not-sealed` "This Mac could not lock your request, so nothing was sent. Try again." `support:availability` is `disabled` with "<Host> can't receive requests yet" in the first case.
  - `a retry after a lost answer sends the same bytes`: first `relay.send` is `unreachable`, handlers rebuilt on the same db, second send posts an identical body. Different text for the id seals anew. The stored body is deleted on `ok` and `changed`, and after `SUPPORT_TTL_MS`.
  - Readiness adds "This Mac's key is not the one your org has for you" when `holdsKeyOf(me)` is false, with `command: "rt team members sync"`.
- [ ] **Step 2: Run** the four files; expected FAIL.
- [ ] **Step 3: Implement.** `takeRequest` and `takeStatus` become async. Kept bodies use kv namespace `support-sealed`, key the request id, value `{ to, text, parts, body, at }`. Statuses are sealed in `flushNow` as they leave. The body size check runs on the sealed body.
- [ ] **Step 4: Run**; expected PASS.
- [ ] **Step 5: Commit** `support: the relay cannot read a request`.

### Task 5: Board receives sealed text

**Files:**
- Create: `apps/board/src/peer/sealed.ts`
- Modify: `apps/board/src/peer/{envelope,inbox,nudges,peer-reviews,ask-inbox,materialize-deps}.ts`, `apps/board/src/server.ts` (the places that draw asks, sent asks and peer reviews)
- Test: beside the existing tests for those modules in `apps/board`

**Interfaces:**
- Consumes: `textOpen` (Task 2); Task 3's announcement binding and placeholder.
- Produces, in `sealed.ts`:

```ts
export const askBinding = (e: { type: string; from: string; id: string }, mrUrl: string): SealBinding
  // { type, from, subject: `${mrUrl} ${id}` }
export const outcomeBinding = (from: string, mrUrl: string, nudgeId: string): SealBinding
  // { type: "nudge-outcome", from, subject: `${mrUrl} ${nudgeId}` }
export const reviewStateBinding = (from: string, p: { mrUrl: string; status: string; updatedAt: number }): SealBinding
  // { type: "review-state", from, subject: `${mrUrl} ${status} ${updatedAt}` }
export type SealedRead = { state: "open"; fields: SealFields } | { state: "pending" } | { state: "unreadable" };
export interface SealedReader { read(sealed: string, binding: SealBinding): SealedRead }
export function createSealedReader(deps: { open: typeof textOpen; changed(): void; now(): number }): SealedReader;
export const WIRE_REASONS: ReadonlySet<string>;   // every code and display word the board itself writes
```

  `NudgeState`, `PeerReviewState` and `SentNudgeResolution` gain `sealed?: string` and the binding parts they lack (`type` for asks, the sender for outcomes). `AskView` gains `textState?: "pending" | "unreadable"`.

- [ ] **Step 1: Write failing tests**
  - Parsers accept `sealed` as a string and reject a non-string; `status`, `outcome`, ids unchanged.
  - An ask with `sealed` is stored and acked without opening anything.
  - `read` answers `pending` first, calls `open` once for concurrent reads, calls `changed` when it settles, and then answers from memory. `unavailable` or a failed daemon call stays `pending` and retries no sooner than 30 s later. `not-for-this-key`, `mismatch`, `damaged` become `unreadable` and never retry. Memory holds at most 500 entries.
  - `buildAskInbox` with a reader shows opened title, branch and note; `pending` and `unreadable` set `textState`.
  - A plain ask from an older board still shows title and note. An ask with both `sealed` and plain fields shows only the opened text.
  - A `reason` that is plain shows as today (older sender); `declineNote` likewise.
  - A sealed announcement that opens notifies with its text; while `unavailable` it is kept in kv namespace `sealed-announcement` and retried by the next tick; after `ANNOUNCEMENT_MAX_AGE_MS` it notifies with the placeholder once.
- [ ] **Step 2: Run** them from `apps/board`; expected FAIL.
- [ ] **Step 3: Implement.** One reader per server process; `changed` sends the existing `/events` nudge. Triage only materializes; it opens announcements through the same helper.
- [ ] **Step 4: Run**; expected PASS.
- [ ] **Step 5: Commit** `board: opens sealed text when it is shown`.

### Task 6: Board sends sealed text

**Files:**
- Modify: `apps/board/src/peer/{sealed,outbox,presence,ask-actions,closed-pane,park-report}.ts`, `apps/board/src/server.ts` (`/nudge`, `declineDeps`, `sendReviewState`, `/asks/decline`), `apps/board/bin/triage.ts`
- Test: beside the existing tests for those modules; create `apps/board/src/__tests__/no-plain-text-on-the-wire.test.ts`

**Interfaces:**
- Consumes: Task 5's bindings and `WIRE_REASONS`; `textSeal` (Task 2).
- Produces: `sealFields(deps: { seal: typeof textSeal }, to: readonly string[], binding: SealBinding, fields: SealFields): Promise<{ sealed?: string; unsent: boolean; unreachable: string[] }>` (never throws; empty fields give `{ unsent: false, unreachable: [] }`); `stripPlainText(d: DraftEnvelope): DraftEnvelope`. `publishOutcome` becomes `(to, p) => Promise<void>`, and its callers await it.

- [ ] **Step 1: Write failing tests**
  - `/nudge`: the published ask carries `mrUrl`, `iid`, `sealed` and nothing else. With no key or a dead daemon it is sent with no `sealed`, answers `{ ok: true, noteSent: false }` when a note was typed, and adds `noteReason: "no-key" | "unavailable"`. With no note typed, `noteSent` is absent.
  - Decline: the same two answers; a `reason` in `WIRE_REASONS` stays plain, `declineNote` never does. The outcome is sent either way.
  - `sendReviewState` with a free-text reason: one `seal` call for all recipients including the author, every envelope carries the same `sealed`; an author who is not on the roster still gets an envelope.
  - A reason that cannot be sealed is dropped and the state goes out.
  - `commitReviewState` and `persistClosedPaneReports` still commit envelopes and the park clear in one transaction; sealing happened before it. `ifSentBefore` dedupe is unchanged.
  - `drainOutbox` strips `title`, `sourceBranch`, `note`, `declineNote`, and any `reason` not in `WIRE_REASONS`, from a row queued by an older board.
  - `no-plain-text-on-the-wire`: builds one of every envelope through its real builder with the marker `SECRET-TEXT` in every text input and the seal stubbed, and fails if the marker or a payload key outside the allowlist appears. The allowlist is the spec's "Stays readable" column plus `sealed`. A second case seals with real `age`, posts to a real `SwitchboardStore`, and greps its rows for the marker.
- [ ] **Step 2: Run** them from `apps/board`; expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**; expected PASS.
- [ ] **Step 5: Commit** `board: titles, branches, notes and reasons leave sealed`.

### Task 7: Docs

**Files:**
- Modify: `apps/board/docs/peer-boards.md` (Privacy), `sites/docs/docs/rt/guides/slack-support-chat.mdx`, `apps/board/switchboard/server.ts` and `support.ts` header comments, `.claude/rules/team-switchboard.md`, `docs/superpowers/specs/2026-11-24-support-host-design.md` (one line pointing here)

- [ ] **Step 1:** Privacy says what the relay sees (the spec's "Stays readable" column, who, when), that text is sealed to its recipients' keys, and the four limits under the spec's Non-goals. Load `rt:docs` for the site page.
- [ ] **Step 2: Run** `bun run check` for the docs site's own check if one covers it; expected PASS.
- [ ] **Step 3: Commit** `docs: what the switchboard can read`.

### Task 8: Pings (its own PR)

**Files:**
- Modify: `lib/telemetry/{ping,clone-health}.ts`, `apps/board/switchboard/{telemetry,telemetry-page}.ts`, `commands/telemetry.ts`, the docs page for `rt telemetry`
- Test: `lib/telemetry/__tests__/*`, the switchboard telemetry tests

**Interfaces:**
- Produces: `CloneHealth.onDataBranch?: boolean | null`; `packs[].staleCount?: number | null`.

- [ ] **Step 1: Write failing tests**: `collectPing` sends `branch`, `dataBranch`, `head`, `upstream` null, `dirty` `[]`, `stale` null, true `dirtyCount`, `staleCount` and `onDataBranch`; a marker in a file name, branch or skill name is nowhere in the ping; today's `parsePing` (copied into the test as a fixture) still accepts it. The relay: `parsePing` keeps the two new fields; the page's stale column uses `staleCount`, else `stale.length`; opening a store over old rows empties the old values in `telemetry_macs.ping` and `telemetry_clone_events.state`, once, and leaves the counts.
- [ ] **Step 2: Run** them; expected FAIL.
- [ ] **Step 3: Implement**; fix both "no repos, hostnames, paths or commands" comments to name the org as the exception; `rt telemetry clones` hint becomes "Run with --json for each clone's counts and timeline".
- [ ] **Step 4: Run**; expected PASS.
- [ ] **Step 5: Commit** `telemetry: pings carry counts, not names`.

### Task 9: What people see (live with Matt, last)

**Files:**
- Modify: `apps/board/src/client/board/asks/{AskCard,AskHistory,AsksDropdown}.tsx`, the ask sender's toast, `AskDeclineForm` result

- [ ] **Step 1:** Not for a subagent. With Matt, in the running board, both colour schemes: an ask whose text is `pending` ("Reading the note…"), `unreadable` ("This note could not be read on this Mac"), and the sender's line "Sent without your note. <name> can't receive notes yet." or "Sent without your note. This Mac could not lock it."
- [ ] **Step 2:** Update the affected stories and tests once the look is agreed, and commit `board: what an unread note looks like`.

### Before release

- [ ] An admin runs `rt team members sync` and checks `rt team status` for who still has no key. Matt's step.
- [ ] Two real Macs exchange an ask, a decline note and a support request.
