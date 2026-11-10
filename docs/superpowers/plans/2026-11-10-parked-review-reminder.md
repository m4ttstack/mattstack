# Parked Review Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reviewer's parked review gate shows on the MR author's board as "waiting on <name>", and the author can remind them with one click as a Slack DM sent as `[Maude 🤖]`; the persona setting moves to `agent.persona` with a deprecation alias for its old name.

**Architecture:** The reviewer's board sends two new `review-state` statuses over the switchboard (`parked`, `stopped`); the author's board stores them like any peer status and renders a `parked` band with a Remind action. Remind calls a new rt daemon verb, `chat:slack-dm`, which opens a DM with the board's Slack token and posts with the persona prefix. The settings resolver learns to answer a renamed key's old name through its `RENAMES` heir, flagged `deprecated`.

**Tech Stack:** Bun, TypeScript, zod (settings registry), React + Mantine (board client), bun:test.

**Spec:** `docs/superpowers/specs/2026-11-10-parked-review-reminder-design.md`

## Global Constraints

- Statuses on the wire: `parked` (with `parkedAt`), `stopped` (with `reason`). The local `ReviewStatus` type stays `'queued' | 'reviewing' | 'done' | 'error'`.
- A parked peer review stays live for `NUDGE_NO_RESPONSE_MS` (48h), not `PEER_REVIEW_STALE_MS` (2h).
- Remind rate limit: once per 15 minutes per MR and reviewer.
- Remind is click-only. No board-to-board reminder envelope and no desktop push.
- Slack text (the verb adds the prefix): `<author name> is waiting on your review of !<iid> (<title>). It's parked at your approval gate: <MR web URL>`. Bare URL, no `<url|text>` markup (`post` escapes).
- `agent.persona`: `{ name, emoji }`, scopes user/team/org, merge deep, default `{ name: "Maude", emoji: "🤖" }`. `chat.slackSupport.trigger`: string, scope user/team/org, merge replace, defaultNote "Not set, so the trigger is @ and the persona name."
- `RENAMES["agent.persona"] = ["chat.slackSupport.persona"]`. A stored `trigger` is dropped, not carried over.
- No `ORG_LAYOUT` bump: the `RENAMES` + store-version path is the designed way to rename; older apps keep reading the old name.
- `chat:slack-dm` is daemon-only: no command-tree node, not `agentSafe`, no MCP tool.
- An older board on either side must not break. Accepted loss: an old author board shows nothing for a parked review.
- Copy goes through rt:ui-copy. No `·` separators.
- Board visual changes: Storybook stories, `capture:baseline` only for intended changes, a Fast Browser look in both schemes at http://localhost:<port> (never a `*.mattstack` URL).
- Run board tests from `apps/board`; rt tests from the worktree root.
- Commit after each task.

## Review Focus

1. A reviewer resumes a parked gate, the run reaches a second gate and parks again: the author's band must come back (a second `parked` after a `reviewing`). Pinned in Task 5.
2. The author clicks Remind twice inside 15 minutes: the second is refused with the time left, and nothing is sent. Pinned in Task 7.
3. The reviewer has no Slack match: Remind is disabled with a reason, and the endpoint refuses with 422 if called anyway. Pinned in Task 7.
4. A board viewing as "all", or the reviewer's own MR: no `parked` or `stopped` envelope goes out. Pinned in Task 5.
5. Retired setting keys (`mattstack.mode`, `board.switchboardUrl`, `rt.doesNotExist`) must still throw; only `RENAMES` old names get the alias. Pinned in Task 2.

---

### Task 1: `agent.persona` and `chat.slackSupport.trigger` keys

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts:911-919` (replace the persona row; add the two rows, `agent.persona` in the `agent.*` block ~934)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts:370-380`
- Modify: `packages/rt-client/src/settings/migrations/index.ts` (step above `// @draft-steps`, rename under `// @draft-renames`)
- Modify: `packages/rt-client/src/settings/migrations/schemas.ts` (v1 source schema above `// @draft-schemas`)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts:24-36`
- Modify: `packages/rt-client/src/settings/__tests__/registry.test.ts:31,~389`
- Regenerate: `packages/rt-client/src/settings/schema.lock.json`
- Modify: `apps/console/src/app/settings/groups.ts:~124` (chat blurb: the persona moved to Agents)

**Interfaces:**
- Produces: `Value<"agent.persona">` = `{ name: string; emoji: string }`; `Value<"chat.slackSupport.trigger">` = `string`.

- [ ] **Step 1: Write the failing tests** in `registry.test.ts`:

```ts
test("agent.persona replaces chat.slackSupport.persona", () => {
  const def = getDef("agent.persona")!;
  expect(def.scopes).toEqual(["user", "team", "org"]);
  expect(def.default).toEqual({ name: "Maude", emoji: "🤖" });
  expect(def.renamedFrom).toEqual(["chat.slackSupport.persona"]);
  expect(getDef("chat.slackSupport.persona")).toBeUndefined();
  expect(getDef("chat.slackSupport.trigger")?.type).toBe("string");
});
test("the v1 step drops trigger", () => {
  const step = getDef("agent.persona")!.migrateFrom!.find(s => s.version === 1)!;
  expect(step.up({ name: "Ada", emoji: "🦊", trigger: "!!ada" })).toEqual({ name: "Ada", emoji: "🦊" });
});
```

Update the scopes assertion at :31 and the ordered key list at ~389 to the new keys.

- [ ] **Step 2: Run** `bun test packages/rt-client/src/settings/__tests__/registry.test.ts`. Expected: FAIL (no `agent.persona`).

- [ ] **Step 3: Implement.** Registry rows per Global Constraints. Schema: `agent.persona` is `z.looseObject({ name, emoji })` with the same `.regex(/\S/)` and `.meta` titles as today; `chat.slackSupport.trigger` is `z.string().regex(/\S/)`. Hand-write `RENAMES` and a `MIGRATION_STEPS` entry `{ key: "chat.slackSupport.persona", version: 1, up: v => deleteProperty(v, [], "trigger") }`, and its `MIGRATION_SCHEMAS` entry with today's v1 schema (trigger included) and examples. `schema diff --draft` will not draft this rename because the schemas differ. Move the examples to `agent.persona` (drop `trigger`) and add `chat.slackSupport.trigger` examples (`good: ["!!ada"]`, `bad: [""]`). Then `bun run cli.ts settings schema lock`; the lock records `agent.persona` at storeVersion 2.

- [ ] **Step 4: Run** `bun test packages/rt-client/src/settings/__tests__/` and `bun run console:test`. Expected: PASS, including `registry-console-ready`, `schema-examples`, `schema-lock` and `groups.test.ts`. If `release-preflight.test.ts` or `breaking-schema-changes.json` objects, the rename-plus-step chain is the answer, not a reason entry: the key shipped.

- [ ] **Step 5: Commit** `settings: move the persona to agent.persona, trigger to chat.slackSupport.trigger`

### Task 2: Deprecation alias for renamed keys

**Files:**
- Modify: `packages/rt-client/src/settings/resolve.ts:113` (`Resolved`), `:806-808` (`getSetting`)
- Modify: `commands/settings-keys.ts:212-247` (`settingsGet`)
- Test: `packages/rt-client/src/settings/__tests__/resolve.test.ts`, `commands/__tests__/settings-get.test.ts`, `commands/__tests__/settings-json-frozen.test.ts` (new fixture), `e2e/tests/settings.test.ts`

**Interfaces:**
- Consumes: `renamedHeir(key)` from `migrate.ts:30` (move it or inline the lookup if the import is circular).
- Produces: `Resolved<T>.deprecated?: { use: string }`. `rt settings get <old> --json` adds `"deprecated": { "use": "<new key>" }` and `"key"` stays the name asked for.

- [ ] **Step 1: Write the failing tests** in `resolve.test.ts`:

```ts
test("a renamed key's old name resolves through its heir", () => {
  const r = getSetting<{ name: string }>("chat.slackSupport.persona");
  expect(r.value).toEqual({ name: "Maude", emoji: "🤖" });
  expect(r.deprecated).toEqual({ use: "agent.persona" });
});
test("the alias warns once", () => { /* bind setSettingsWarnSink, read twice, expect one message naming agent.persona */ });
test.each(["rt.doesNotExist", "mattstack.mode", "board.switchboardUrl"])("%s still throws", k => {
  expect(() => getSetting(k)).toThrow(/unknown setting/);
});
```

In `settings-get.test.ts`: `--json` for the old name has `deprecated.use === "agent.persona"` and stderr has one warn line; for `agent.persona`, `deprecated` is absent.

- [ ] **Step 2: Run** `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts commands/__tests__/settings-get.test.ts`. Expected: FAIL (throws unknown setting).

- [ ] **Step 3: Implement.** In `getSetting`, when `getDef(key)` is missing and `renamedHeir(key)` exists, resolve the heir with the same opts, `emitSettingsWarning` once per old key (model: `warnTeamAlias`, resolve.ts:283-298), and return `{ ...resolved, deprecated: { use: heir.key } }`. No reverse projection: the old shape's `trigger` was optional. `explainSetting` keeps throwing. In `settingsGet`, check the heir before the `No setting is called` refusal (:224), use the heir's def for `isMigrated`, add `deprecated` to the envelope, and print `out.note(out.line("warn", "<old> is now <new>", "rt settings get <new>"))` (copy via rt:ui-copy).

- [ ] **Step 4: Add the frozen fixture** with `RT_UPDATE_SETTINGS_JSON_FIXTURES=1 bun test commands/__tests__/settings-json-frozen.test.ts`, and an e2e case in `e2e/tests/settings.test.ts` beside ~405-425 asserting `deprecated.use`. Run `bun test commands/__tests__/settings-json-frozen.test.ts` and `bun test --preload ./e2e/setup.ts e2e/tests/settings.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `settings: answer a renamed key's old name with a deprecation notice`

### Task 3: Move the persona readers

**Files:**
- Modify: `lib/slack/persona.ts` (`SlackPersona = Value<"agent.persona">`, `slackPersona()` reads `agent.persona`, `resumeTrigger(persona)` reads `chat.slackSupport.trigger` then `@<name>`)
- Modify: `apps/chat/src/server/chat.ts:288-295`, `apps/console/src/server/gates.ts:210-214`, `apps/console/src/shared/slack-gate.ts:82-88`
- Modify tests: `lib/slack/__tests__/persona.test.ts`, `apps/chat/src/server/chat.test.ts:1476,1728`, `apps/console/src/shared/slack-gate.test.ts`, `lib/daemon/__tests__/slack-bridge*.test.ts` (types only)
- Modify docs: `sites/docs/docs/rt/guides/slack-support-chat.mdx:10`, `sites/docs/docs/apps/chat.mdx:40`, `.claude/rules/chat.md:49`, `skills/rt-slack-support/SKILL.md:187` (skill edit: load superpowers:writing-skills first)
- Create: `lib/__tests__/no-slack-support-persona-reads.test.ts`

**Interfaces:**
- Produces: `resumeTrigger(persona: SlackPersona, trigger?: string): string`. Call sites pass `getSetting<string>("chat.slackSupport.trigger").value` when set (check provenance, not `undefined`).
- `personaTrigger({ name }, trigger?)` in console mirrors it.

- [ ] **Step 1: Write the failing tests.** `persona.test.ts`: with `agent.persona` `{name:"Ada",emoji:"🦊"}` and `chat.slackSupport.trigger` `"!!ada"`, `resumeTrigger` is `"!!ada"`; with no trigger it is `"@Ada"`. The lint test, modelled on `lib/__tests__/no-switchboard-url-setting.test.ts`, scans `lib`, `commands`, `packages`, `apps/*/src` for `/["']chat\.slackSupport\.persona["']/`, skipping `node_modules`, `dist`, `__tests__`, `fixtures`, and allowing `packages/rt-client/src/settings/migrations/`, `packages/rt-client/src/settings/schema.lock.json` and the alias tests.

- [ ] **Step 2: Run** `bun test lib/slack/__tests__/persona.test.ts lib/__tests__/no-slack-support-persona-reads.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the reader moves and the doc rows (`agent.persona`: name and emoji every agent surface uses; `chat.slackSupport.trigger`: words that call the support bot back).

- [ ] **Step 4: Run** the two tests above, `bun test lib/daemon/__tests__/slack-bridge.test.ts lib/daemon/__tests__/slack-bridge-triggers.test.ts lib/daemon/__tests__/slack-lifecycle.test.ts`, `bun run chat:test`, `bun run console:test`. Expected: PASS.

- [ ] **Step 5: Commit** `slack: read the persona from agent.persona`

### Task 4: `chat:slack-dm` daemon verb

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (`Commands` near :1101-1111, `COMMAND_NAMES` :1442)
- Modify: `packages/rt-client/src/client.ts` (wrapper beside `chatSlackAvatars` :437)
- Modify: `lib/daemon/handlers/slack-chat.ts` (`SLACK_CHAT_COMMANDS` :61, handler beside `chat:slack-people` :431)
- Test: `lib/daemon/handlers/__tests__/slack-chat.test.ts`

**Interfaces:**
- Produces: `"chat:slack-dm": { payload: { userId: string; text: string }; data: { ts: string } }` and `chatSlackDm(a, o?): Promise<RtResponse<{ ts: string }>>` (timeout 10s).

- [ ] **Step 1: Write the failing tests** with the file's fake `SlackClient` and `MAUDE`:

```ts
test("chat:slack-dm opens the DM and posts with the persona prefix", async () => {
  const res = await handlers["chat:slack-dm"]({ userId: "U0MIRA0001", text: "Matt is waiting on your review of !7 (Fix it). It's parked at your approval gate: https://gitlab.example/x/-/merge_requests/7" });
  expect(res.ok).toBe(true);
  expect(fake.opened).toEqual(["U0MIRA0001"]);
  expect(fake.posted[0].text.startsWith(slackPrefix(MAUDE))).toBe(true);
});
test("refuses a malformed user id", ...);       // userId "nope" → ok:false, nothing opened
test("refuses when no Slack token", ...);       // slackClient: async () => null → ok:false
```

- [ ] **Step 2: Run** `bun test lib/daemon/handlers/__tests__/slack-chat.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Validate `userId` with `SLACK_ID_SHAPE` (:59) and `text` non-empty; `openDm`, then `post(channel, slackPrefix(slackPersona()) + text)`; failures return `slackRefusal(msg)` and `log.warn({ err }, ...)`. No logging wrapper (daemon rule).

- [ ] **Step 4: Run** the handler test and `bun test lib/daemon/__tests__/rt-client-commands.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `daemon: add chat:slack-dm for sending a DM as the user`

### Task 5: Reviewer's board sends `parked` and `stopped`

**Files:**
- Modify: `apps/board/src/peer/envelope.ts:36-48,142-162` (`parkedAt?: number` on `ReviewStatePayload`, parsed as a finite number when present)
- Modify: `apps/board/src/gates/execute-sweep-action.ts` (new io hook)
- Create: `apps/board/src/peer/park-report.ts`
- Modify: `apps/board/src/peer/closed-pane.ts` (skip parked lanes)
- Modify: `apps/board/src/server.ts` (`sweepActionIo` ~5162, `closedPeerReviewIO` ~5652, relay handler ~5829)
- Test: `apps/board/src/__tests__/gates-execute-sweep-action.test.ts`, `apps/board/src/__tests__/peer-park-report.test.ts` (new), `apps/board/src/__tests__/peer-closed-pane.test.ts`

**Interfaces:**
- Consumes: `reviewSyncEnvelopes`, `presenceRecipientsFor`, `askIdForRun`, `enqueueOutbox`, `kickOutbox`.
- Produces:
  - `ExecuteSweepActionIo.onReviewParked?(mrUrl: string, parkedAt: number): Promise<void>`, called after a successful review-domain park, errors logged, never thrown.
  - In `park-report.ts`: `parkedPayload(lane: { iid: number }, mrUrl: string, now: number): ReviewStatePayload` → `{ mrUrl, iid, status: 'parked', parkedAt: now, updatedAt: now }`, and `stoppedPayload(row: { status: string; kind: string }, mrUrl: string, iid: number, reason: string, now: number): ReviewStatePayload | null` → `{ status: 'stopped', reason, ... }` only when the row was `parked` and `domainForKind(row.kind) === 'review'`, else null.
  - `closedPaneReports` input gains `isParked: (mrUrl: string) => boolean`.
  - Server helper `sendReviewState(mrUrl: string, payload: ReviewStatePayload): Promise<void>`, extracted from the `handleAgentSignal` block (~5433-5467) so the signal path, park and stop share it.

- [ ] **Step 1: Write the failing tests.**
  - execute-sweep-action: a review park with `gatePark` ok calls `onReviewParked(mrUrl, now)`; a refused park or a respond-domain park does not.
  - park-report: `stoppedPayload` returns null for an `open` row, a respond-kind row, and returns `reason: 'abandoned'` for a parked review row.
  - closed-pane: a gone executor on a lane where `isParked` is true yields no report; the same lane with `isParked` false yields today's `pane closed` error.
  - Review Focus 4: `sendReviewState` sends nothing when `config.defaultMember === 'all'` or the MR is the board's own (covered by `reviewSyncEnvelopes`; add a case to `peer-presence.test.ts` with `status: 'parked'`).
  - Review Focus 1: in `gates-execute-sweep-action.test.ts`, a second park after a resume calls `onReviewParked` again (no dedupe across parks).

- [ ] **Step 2: Run** `cd apps/board && bun test src/__tests__/gates-execute-sweep-action.test.ts src/__tests__/peer-park-report.test.ts src/__tests__/peer-closed-pane.test.ts src/__tests__/peer-presence.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `sweepActionIo` wires `onReviewParked` to look up `readReviewStates().get(mrUrl)` and call `sendReviewState` with `parkedPayload`.
  - `closedPeerReviewIO` passes `isParked` as `gateCache.rowsFor('mr:' + mrUrl).some(r => domainForKind(r.kind) === 'review' && r.status === 'parked')`.
  - In the relay handler, for `gate/closed/` topics, read the row by id before `ingestRelayFrame` applies it, build `stoppedPayload` with the frame's `closedReason`, and send it after apply. Writer-only, like the `gate/answered/` branch beside it.

- [ ] **Step 4: Run** the Step 2 command plus `bun test src/__tests__/peer-inbox.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `board: report a parked review gate to the author's board`

### Task 6: Author's board stores and shows `parked`

**Files:**
- Modify: `apps/board/src/peer/presence.ts:76-100` (`isFreshPeerReview`)
- Modify: `apps/board/src/peer/inbox.ts:72-107` (status mapping)
- Modify: `apps/board/src/peer/nudges.ts:238-454` (resolution results, `sentNudgeDisplay`, `sentNudgeView`)
- Modify: `apps/board/src/client/types.ts:147,162` (`PeerReviewInfo.parkedAt?`, `remindedAt?`; `SentNudgeInfo.display` gains `'parked'`)
- Modify: `apps/board/src/client/board/ask-band.ts` (`parked` model, `peerParkedBandModel`, `bandSource`, `AskAction` gains `'remind'`)
- Modify: `apps/board/src/client/board/AskBand.tsx:17-18,~91` (Remind label and dispatch)
- Modify: `apps/board/src/client/board/AskBand.stories.tsx` (Parked, Parked and reminded, Parked with no Slack match)
- Test: `apps/board/src/__tests__/peer-presence.test.ts`, `peer-inbox.test.ts`, `apps/board/src/client/board/__tests__/ask-band.test.ts`, `ask-band-dom.test.tsx`

**Interfaces:**
- Consumes: wire statuses from Task 5.
- Produces:
  - `isFreshPeerReview` treats `parked` as live within `NUDGE_NO_RESPONSE_MS`.
  - SentNudge resolution `result` gains `'parked'` (via `resolveSentNudge`) and `'stopped'` (via `finishSentNudge`); `sentNudgeDisplay` returns `'parked'` for a parked resolution, ahead of the 30-minute `no-update`, and `'no-response'` past 48h; `sentNudgeView` returns null for `'stopped'`.
  - `peerParkedBandModel(peer: PeerReviewInfo, name: string, now: number): AskBand`.
  - `bandSource` peer branch takes the first undismissed peer with status `'error'` or `'parked'`.
  - `ctx.onAskRemind(mr: BoardMRWithReview): Promise<void>` on the band context (implemented in Task 7).

- [ ] **Step 1: Write the failing tests.**

```ts
test("a parked sent ask reads parked, not no-update", () => {
  const n = sentAsk({ resolution: { result: 'parked', at: T0 } });
  expect(sentNudgeDisplay(n, T0 + 45 * 60_000)).toBe('parked');
  expect(sentNudgeDisplay(n, T0 + 49 * 3_600_000)).toBe('no-response');
});
test("a stopped sent ask leaves the row", () => {
  expect(sentNudgeView(sentAsk({ resolution: { result: 'stopped', at: T0 } }), T0)).toBeNull();
});
test("the parked band", () => {
  const b = askBandModel({ ...sent, display: 'parked', resolvedAt: T0 }, T0 + 40 * 60_000, 'Rowan');
  expect(b.tone).toBe('warn');
  expect(b.icon).toBe('hourglass');
  expect(b.label).toBe('waiting on Rowan');
  expect(b.actions).toEqual(['remind', 'dismiss']);
  expect(b.steps.map(s => s.name)).toEqual(['Requested', 'Started', 'Parked']);
});
test("bandSource shows a parked peer review on the author's own MR", ...);
test("isFreshPeerReview keeps parked past 2h and drops it past 48h", ...);
test("inbox: parked resolves the sent ask; a later reviewing puts it back to confirmed", ...);
```

- [ ] **Step 2: Run** `cd apps/board && bun test src/__tests__/peer-presence.test.ts src/__tests__/peer-inbox.test.ts src/client/board/__tests__/ask-band.test.ts src/client/board/__tests__/ask-band-dom.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** the mapping and models. Final copy through rt:ui-copy; the test strings above are the starting copy.

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit** `board: show a parked peer review as waiting on the reviewer`

### Task 7: Remind endpoint and button

**Files:**
- Modify: `apps/board/src/peer/peer-reviews.ts` (`markPeerReviewReminded`)
- Modify: `apps/board/src/server.ts` (route beside `/peer-review/dismiss` :4556)
- Modify: `apps/board/src/client/board/action-runner.ts:~291` and the band context (`onAskRemind`)
- Modify: `apps/board/src/client/board/AskBand.tsx` (disabled state, "reminded 5m ago")
- Test: `apps/board/src/__tests__/server-peer-remind.test.ts` (new, modelled on `server-nudge-dismiss.test.ts`), `ask-band-dom.test.tsx`

**Interfaces:**
- Consumes: `chatSlackDm` (Task 4), `matchSlackFaces(slackFaceNames(...), slackPeople)` (server.ts:1905), `PeerReviewInfo.remindedAt`.
- Produces:
  - `POST /peer-review/remind { mrUrl, reviewer }`: 200 `{ remindedAt }`; 409 `{ retryAt }` inside 15 minutes; 422 when the reviewer has no Slack match or the peer review is not `parked`; 502 with the daemon's message when the verb fails. `remindedAt` is recorded only after a 200.
  - `markPeerReviewReminded(mrUrl: string, reviewer: string, at: number, db?): void` (updates the stored row; the next status overwrites it).

- [ ] **Step 1: Write the failing tests** with an injected `sendDm` fake:
  - 200 sends once with the exact Global Constraints text, using the author's display name, `!<iid>`, title and web URL.
  - Review Focus 2: a second call 5 minutes later returns 409 and sends nothing.
  - Review Focus 3: no Slack match returns 422 and sends nothing; the DOM test shows Remind disabled with a reason when `slackFaces[reviewer]` is missing.
  - A non-parked peer review returns 422.
  - DOM: after a 200, the band shows "reminded" with the time.

- [ ] **Step 2: Run** `cd apps/board && bun test src/__tests__/server-peer-remind.test.ts src/client/board/__tests__/ask-band-dom.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** the route (pure handler with injected `sendDm`, `slackIdFor`, `now`, like the dismiss route) and the client action.

- [ ] **Step 4: Run** the Step 2 command, then `bun run board:test` and `bun run board:typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `board: remind a parked reviewer over Slack`

### Task 8: Look at it

**Files:**
- Modify: board capture baselines only if the band change is intended (`bun run capture:baseline` in `apps/board`)

- [ ] **Step 1:** `bun run storybook` from the root; open `Gates/Board` and the AskBand stories at http://localhost:6006.
- [ ] **Step 2:** Screenshot the Parked, Parked and reminded, and no-Slack-match stories in light and dark through Fast Browser (delegate to `fast-browser:browser-driver`). Say plainly what reads wrong; fix and repeat.
- [ ] **Step 3:** `cd apps/board && bun run capture:compare`. Expected: only the intended band differences; then `capture:baseline` and commit `board: capture baselines for the parked band`.
- [ ] **Step 4:** Run `bun run check` from the root. Expected: PASS.

## Follow-up outside this plan

- flock (`Sources/FlockCore/Chat/ChatSlackPersona.swift` in the flock repo): change `settingArguments` to read `agent.persona`, in a flock PR once this ships. Until then it works through the Task 2 alias.
