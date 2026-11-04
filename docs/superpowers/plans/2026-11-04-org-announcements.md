# Org Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org owners and admins send a macOS notification to teammates' Macs through the existing switchboard messages.

**Architecture:** `rt team announce` posts an `announcement` envelope to `to: '*'` with the sender's board token. Each board handles it in `materializeEnvelope`, drops it unless the relay-stamped sender is an org owner or admin, and posts to the tray. rt and the board share one payload parser from rt-client.

**Tech Stack:** Bun, TypeScript, bun:test, `@mattstack/rt-client`, the board's peer runtime, the rt command tree.

**Spec:** `docs/superpowers/specs/2026-11-03-org-announcements-design.md`

## Global Constraints

- No changes under `apps/board/switchboard/**`, and none to `apps/board/src/peer/envelope.ts`: the relay imports that file, and editing either triggers a relay deploy.
- No daemon change and no tray app change.
- Envelope type: `announcement`. Notification category: `announcement`.
- Title at most 80 characters, message at most 500.
- A board drops an announcement when `now - e.receivedAt` is over 24 hours.
- Run board tests from `apps/board`. Run every other `bun test` from the repo root.
- Printed text follows `.claude/rules/output-layer.md` and the rt:ui-copy skill. No em or en dashes.

## Review Focus

1. A Mac in no org gets an announcement: it is dropped, nothing throws, and the batch is still acked. Pinned in Task 1.
2. The relay lowercases `from` while the roster says `Alice`: the announcement is still accepted. Pinned in Task 1.
3. Reading org roles throws on a malformed store: the announcement is logged and dropped, and the other envelopes in the batch still materialize and ack. Pinned in Task 1.
4. The server tick and the triage pass fetch the same envelope before either acks: macOS shows one notification, because the envelope id is the notification id. Pinned in Task 1.
5. No other board is registered, so `delivered` is 0: the sender is told nobody will get it instead of seeing a success line. Pinned in Task 2.

---

### Task 1: Shared payload and board receive

**Files:**
- Create: `packages/rt-client/src/announcement.ts`
- Modify: `packages/rt-client/src/index.ts`
- Modify: `apps/board/src/peer/inbox.ts`
- Modify: `apps/board/src/peer/materialize-deps.ts`
- Modify: `apps/board/src/triage/notify.ts`
- Test: `packages/rt-client/test/announcement.test.ts`
- Test: `apps/board/src/__tests__/peer-inbox.test.ts`
- Test: `apps/board/src/__tests__/peer-org-admin.test.ts` (create)

**Interfaces:**
- Produces, from `@mattstack/rt-client`:
  - `ANNOUNCEMENT_TYPE = 'announcement'`
  - `ANNOUNCEMENT_TITLE_MAX = 80`, `ANNOUNCEMENT_MESSAGE_MAX = 500`
  - `interface AnnouncementPayload { title: string; message: string }`
  - `parseAnnouncementPayload(p: unknown): AnnouncementPayload | null`
- Produces, in `MaterializeDeps`:
  - `isOrgAdmin(username: string): boolean`
  - `notifyAnnouncement(id: string, payload: AnnouncementPayload, from: string): void`
- Produces, in `triage/notify.ts`:
  - `announcementNotice(p: AnnouncementPayload, from: string): { title: string; message: string }`
  - `notifyEscalation` gains `opts.id?: string`, used in place of the random id.
- Produces, in `materialize-deps.ts`: exported `senderIsOrgAdmin(username: string, org: string | null, roles: (org: string) => OrgRoles): boolean`.

- [ ] **Step 1: Write the failing parser tests in `packages/rt-client/test/announcement.test.ts`**

```ts
test('accepts a title and message', () => {
  expect(parseAnnouncementPayload({ title: 'Update rt', message: 'Today please' }))
    .toEqual({ title: 'Update rt', message: 'Today please' });
});
test('rejects non-objects, missing fields and non-strings', () => {
  for (const bad of [null, 'x', {}, { title: 'a' }, { title: 1, message: 'b' }])
    expect(parseAnnouncementPayload(bad)).toBeNull();
});
test('rejects whitespace-only text', () => {
  expect(parseAnnouncementPayload({ title: '   ', message: 'b' })).toBeNull();
  expect(parseAnnouncementPayload({ title: 'a', message: ' \n ' })).toBeNull();
});
test('caps at 80 and 500 characters', () => {
  expect(parseAnnouncementPayload({ title: 'a'.repeat(80), message: 'b'.repeat(500) })).not.toBeNull();
  expect(parseAnnouncementPayload({ title: 'a'.repeat(81), message: 'b' })).toBeNull();
  expect(parseAnnouncementPayload({ title: 'a', message: 'b'.repeat(501) })).toBeNull();
});
```

- [ ] **Step 2: Write the failing board tests**

Add `isOrgAdmin` (default: `u => u === 'admin1'`) and `notifyAnnouncement` (records to `deps.announced`) to `fakeDeps()` in `peer-inbox.test.ts`, and to any other fake that builds a `MaterializeDeps`. Add these tests to `peer-inbox.test.ts`, with `now = 1_000_000_000` and `DAY = 86_400_000`:

```ts
test('an announcement from an org admin notifies with the envelope id', () => {
  materializeEnvelope(announcement({ id: 'a1', from: 'admin1', receivedAt: now }), deps, now);
  expect(deps.announced).toEqual([
    { id: 'a1', payload: { title: 'Update rt', message: 'Today please' }, from: 'admin1' },
  ]);
});
test('an announcement from anyone else is dropped and logged', () => {
  materializeEnvelope(announcement({ from: 'member1', receivedAt: now }), deps, now);
  expect(deps.announced).toEqual([]);
  expect(deps.logs).toHaveLength(1);
});
test('an announcement over a day old is dropped', () => {
  materializeEnvelope(announcement({ from: 'admin1', receivedAt: now - DAY - 1 }), deps, now);
  expect(deps.announced).toEqual([]);
});
test('an announcement exactly a day old still shows', () => {
  materializeEnvelope(announcement({ from: 'admin1', receivedAt: now - DAY }), deps, now);
  expect(deps.announced).toHaveLength(1);
});
test('a malformed announcement is logged', () => {
  materializeEnvelope(announcement({ from: 'admin1', receivedAt: now, payload: { title: '' } }), deps, now);
  expect(deps.announced).toEqual([]);
  expect(deps.logs).toHaveLength(1);
});
test('a throwing role read does not stop the batch', async () => {
  deps.isOrgAdmin = () => { throw new Error('bad store'); };
  const client = fakeClient([announcement({ id: 'a1', from: 'admin1', receivedAt: Date.now() }), reviewState({ id: 'r1' })]);
  await runPeerTick(client, deps);
  expect(deps.peerReviews).toHaveLength(1);
  expect(client.acked).toEqual(['a1', 'r1']);
});
```

In the new `peer-org-admin.test.ts`:

```ts
const roles = () => ({ owners: ['Alice'], admins: ['bob'], teams: {} });
test('accepts owners and admins, ignoring case', () => {
  expect(senderIsOrgAdmin('alice', 'acme', roles)).toBe(true);
  expect(senderIsOrgAdmin('bob', 'acme', roles)).toBe(true);
});
test('refuses a plain member', () => {
  expect(senderIsOrgAdmin('carol', 'acme', roles)).toBe(false);
});
test('refuses on a Mac in no org', () => {
  expect(senderIsOrgAdmin('alice', null, roles)).toBe(false);
});
```

Also add to the board's notify tests:

```ts
test('announcementNotice ends with the sender', () => {
  expect(announcementNotice({ title: 'Update rt', message: 'Today please' }, 'alice'))
    .toEqual({ title: 'Update rt', message: 'Today please\nFrom alice' });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test packages/rt-client/test/announcement.test.ts`
Run: `cd apps/board && bun test src/__tests__/peer-inbox.test.ts src/__tests__/peer-org-admin.test.ts`
Expected: FAIL, the new exports are missing.

- [ ] **Step 4: Implement `packages/rt-client/src/announcement.ts` and export it from `index.ts`**

`parseAnnouncementPayload` checks the trimmed text is non-empty and the raw length is within the caps, and returns the strings unchanged.

- [ ] **Step 5: Add the `announcement` branch to `materializeEnvelope` in `inbox.ts`**

Order: parse, then the age check with `ANNOUNCEMENT_MAX_AGE_MS = 24 * 60 * 60_000`, then `deps.isOrgAdmin(e.from)`, then `deps.notifyAnnouncement(e.id, payload, e.from)`. Each drop logs one line. Keep the wording of the existing `peer: malformed ...` log.

- [ ] **Step 6: Implement `announcementNotice` and `opts.id` in `triage/notify.ts`**

- [ ] **Step 7: Wire `boardMaterializeDeps` in `materialize-deps.ts`**

`senderIsOrgAdmin` returns false for a null org, otherwise `isOrgAdmin(roleOf(username, roles(org)))`. The deps call it with `currentOrg()` and `readOrgRoles`. `notifyAnnouncement` calls `notifyEscalation` with mode `'rt'`, `category: 'announcement'` and `id`, as `void`: it never rejects. It ignores the board's escalation mode, since an announcement is not a board escalation.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test packages/rt-client/test/announcement.test.ts`
Run: `cd apps/board && bun test src/__tests__/peer-inbox.test.ts src/__tests__/peer-org-admin.test.ts src/__tests__/peer-tick.test.ts src/__tests__/peer-runtime.test.ts`
Expected: PASS

- [ ] **Step 9: Run the board's type check**

Run: `bun run check --filter=board` from the repo root, or the board's typecheck script if that filter does not exist.
Expected: no errors, which confirms every `MaterializeDeps` fake was updated.

- [ ] **Step 10: Commit**

```bash
git add packages/rt-client apps/board/src
git commit -m "board: show org announcements from owners and admins"
```

### Task 2: `rt team announce`

**Files:**
- Create: `lib/team/announce.ts`
- Modify: `commands/team.ts`
- Modify: `lib/command-tree-def.ts`
- Modify: `apps/board/docs/peer-boards.md`
- Test: `lib/team/__tests__/announce.test.ts`
- Test: `commands/__tests__/team.test.ts`

`commands/team.ts` is already registered in `lib/module-registry.ts`, so no registry change is needed.

**Interfaces:**
- Consumes: `ANNOUNCEMENT_TYPE`, `parseAnnouncementPayload` from Task 1.
- Produces:
  - `interface AnnounceSeams { readLocalSecret: ReadLocalSecret }`
  - `sendAnnouncement(p: Probes, slug: string, input: { title: string; message: string }, seams?: AnnounceSeams): Promise<{ delivered: number }>`
  - `teamAnnounce(args: string[], ctx?: CommandContext, deps?: TeamDeps): Promise<void>`

- [ ] **Step 1: Write the failing tests in `lib/team/__tests__/announce.test.ts`**

Use `fakeProbes` from `lib/setup/__tests__/fakes.ts`, with an org store that lists the Mac's recorded username as an owner, and a fetch fake that records calls.

```ts
test('an owner posts an announcement to every board', async () => {
  const r = await sendAnnouncement(p, 'acme', { title: 'Update rt', message: 'Today' }, seams);
  expect(r).toEqual({ delivered: 3 });
  expect(posted.url).toBe(`${SWITCHBOARD_URL}/envelopes`);
  expect(posted.headers.Authorization).toBe('Bearer board-token');
  expect(JSON.parse(posted.body)).toMatchObject({
    to: '*', type: 'announcement', payload: { title: 'Update rt', message: 'Today' },
  });
});
test('a plain member is refused before anything is sent', async () => {
  await expect(sendAnnouncement(memberProbes, 'acme', input, seams)).rejects.toMatchObject({ code: 'announce-not-admin' });
  expect(calls).toHaveLength(0);
});
test('text over the cap is refused before anything is sent', async () => {
  await expect(sendAnnouncement(p, 'acme', { title: 'a'.repeat(81), message: 'b' }, seams)).rejects.toMatchObject({ code: 'announce-invalid' });
  expect(calls).toHaveLength(0);
});
test('no board token is refused', async () => {
  await expect(sendAnnouncement(p, 'acme', input, noToken)).rejects.toMatchObject({ code: 'announce-no-board-token' });
});
test('a 401 reads as a rejected token', async () => {
  await expect(sendAnnouncement(p401, 'acme', input, seams)).rejects.toMatchObject({ code: 'announce-token-rejected' });
});
test('any other failure reads as a failed send', async () => {
  await expect(sendAnnouncement(p500, 'acme', input, seams)).rejects.toMatchObject({ code: 'announce-send-failed' });
  await expect(sendAnnouncement(pThrows, 'acme', input, seams)).rejects.toMatchObject({ code: 'announce-send-failed' });
});
```

- [ ] **Step 2: Write the failing command tests in `commands/__tests__/team.test.ts`**

Follow that file's existing `deps` pattern, stubbing the send.

```ts
test('team announce reports the queued count in json', ...);   // envelope data { delivered: 3 }
test('team announce says when nobody will get it', ...);       // delivered 0: a needs-you line, not done
test('team announce without --message is a usage error', ...);
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test lib/team/__tests__/announce.test.ts commands/__tests__/team.test.ts`
Expected: FAIL, `sendAnnouncement` and `teamAnnounce` are missing.

- [ ] **Step 4: Implement `lib/team/announce.ts`**

Order: `isOrgAdmin(roleFor(p, slug))`, then `parseAnnouncementPayload`, then `readBoardSwitchboardToken(p, () => seams.readLocalSecret('switchboardToken').catch(() => null))`, then `p.fetch` to `${switchboardUrl(p.env)}/envelopes` with `timeoutMs: 10_000`. The body is `{ id: crypto.randomUUID(), to: '*', type: ANNOUNCEMENT_TYPE, sentAt: Date.now(), payload }`. `delivered` comes from the reply. Default `seams` to `{ readLocalSecret: realReadLocalSecret }`.

Each failure is a `UserActionableError` with a `why`:

| Code | Message |
|---|---|
| `announce-not-admin` | Only org owners and admins can send announcements |
| `announce-invalid` | An announcement needs a title up to 80 characters and a message up to 500 |
| `announce-no-board-token` | This Mac has no board connection to send from |
| `announce-token-rejected` | The switchboard did not accept this Mac's board connection |
| `announce-send-failed` | rt could not send the announcement |

- [ ] **Step 5: Add `teamAnnounce` to `commands/team.ts`**

`rt team announce "<title>" --message "<text>" [--team <org>] [--json]`. Use `resolveTeamSlug` and `positional(args, ["--message", "--team"])`, and `usageError` when the title or message is missing. Add `announce-not-admin` to `REFUSAL_CODES`.

Human output:
- `delivered > 0`: `out.line("done", "Queued for 3 boards", "people see it within a minute if their board is running")`, with "1 board" for one.
- `delivered === 0`: `out.line("needs-you", "Nobody will get this", "no other boards are connected")`.

- [ ] **Step 6: Add the `announce` node under `team` in `lib/command-tree-def.ts`**

```ts
announce: {
  description: "As an org admin, send a notification to everyone in your org",
  module: "./commands/team.ts",
  fn: "teamAnnounce",
  omitBehavior: { exempt: "an announcement's words cannot be listed" },
  args: [
    { name: "Title", type: "text", placeholder: "Update rt today", hint: "A short headline, up to 80 characters" },
    { name: "Message", flag: "--message", type: "text", placeholder: "v2.29 fixes the sign-in bug", hint: "The details, up to 500 characters" },
    { name: "Team", flag: "--team", type: "text", placeholder: "acme", hint: "Which org clone; your only one when left out" },
    SETUP_JSON_ARG,
  ],
},
```

- [ ] **Step 7: Add one bullet to `apps/board/docs/peer-boards.md`**

Under "What it adds", in plain words: org owners and admins can send everyone a macOS notification with `rt team announce`, a running board shows it within a minute, and anything over a day old is dropped.

- [ ] **Step 8: Regenerate the reference docs**

Run: `bun run docs:gen`
Expected: a new `website/docs/rt/reference/team/announce.mdx` (or the sibling of the other `team` pages), and no other unrelated diff.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `bun test lib/team/__tests__/announce.test.ts commands/__tests__/team.test.ts lib/__tests__/command-tree.test.ts`
Expected: PASS. If `lib/__tests__/command-tree.test.ts` does not exist, drop it from the command.

- [ ] **Step 10: Commit**

```bash
git add lib/team/announce.ts lib/team/__tests__/announce.test.ts commands lib/command-tree-def.ts apps/board/docs/peer-boards.md website
git commit -m "team: add rt team announce"
```

### Task 3: End-to-end check

No code unless this finds a bug. Everything runs from source against a local relay, so no real teammate gets anything. Never run a compiled `rt` outside an isolated HOME.

**Files:** none.

- [ ] **Step 1: Start a local relay on a scratch database**

Run from the repo root, using a free port and a path in the scratchpad:
`SWITCHBOARD_ADMIN_TOKEN=local SWITCHBOARD_DB=<scratch>/sb.db PORT=<port> bun apps/board/switchboard/server.ts`
Expected: `curl http://127.0.0.1:<port>/healthz` prints `ok`. Read `server.ts` for the exact port variable.

- [ ] **Step 2: Register two boards, and post an announcement as the first**

`POST /boards` twice with the admin token, for `alice` and `bob`, then post the body from Task 2 Step 4 to `/envelopes` with alice's token.
Expected: `{ "ok": true, "delivered": 1 }`.

- [ ] **Step 3: Run the receive path on bob's envelope**

Fetch `GET /inbox` with bob's token, then pass it through `runPeerTick` in a short scratch script with real `boardMaterializeDeps`, and `isOrgAdmin` overridden to accept `alice`.
Expected: one macOS notification with title, message and "From alice" appears on this Mac. Run a second tick and confirm nothing new appears and `/inbox` is empty.

- [ ] **Step 4: Check the notification by eye, then stop the relay**

Confirm the text reads correctly, and say plainly if anything looks wrong.

- [ ] **Step 5: Note the rollout in the PR**

Merging deploys nothing to the relay. Members need the release before they can receive, because an older board discards announcements. Sending a real announcement to the org is Matt's call after the release.
