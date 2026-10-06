# Board peer ask consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teammate's ask for your board's agent (review, re-review, respond) waits in a header inbox for your go-ahead unless you always allow them, arrives as a push that lands on the ask, and reports back to the asker as waiting, started, declined or expired.

**Architecture:** The wire gains a `pending` outcome and decline fields. The receiving triage pass holds asks from senders not on a new `board.peerAsksAlwaysAllow` list, notifies once and publishes `pending`; new board routes accept or decline through the launcher the triage pass already uses. The relay learns which boards accept asks so pickers drop the rest. The client gets a header inbox (a new tui-kit `Popover`), an `?ask=` deep link with a slow flash, a send dialog with a note, and new ask-band states; inbound asks leave the MR row.

**Tech Stack:** Bun, TypeScript, bun:sqlite, React 19 on `@mattstack/tui-kit` (Base UI underneath), `bun test`, Storybook, Fast Browser for visual checks.

**Spec:** `docs/superpowers/specs/2026-10-06-board-peer-ask-consent-design.md`. Boards: `docs/apps/design/board/board.pen` (R1 option C, R2, R3, R4) and `docs/apps/design/board/renders/R*.light.png`.

## Global Constraints

- Run every `bun test` for board from `apps/board` (its `bunfig.toml` preload isolates HOME); rt-client tests from the repo root.
- Locally run only the targeted test files a task names; CI runs the full suites.
- Never open a `*.mattstack` URL; drive the board at `http://localhost:<port>` (live board 11006, fixture board `PORT=7941`, Storybook 6006).
- Board UI comes from `@mattstack/tui-kit` recipes first; never hand-draw what a recipe does. Colours and type follow `docs/apps/ui-authoring.md` role tokens; no raw hex in components.
- Every name in fixtures, stories and tests is invented (Rae Marlow, Tom Clearwater, Bea Finch, Mira Holt, Dani Oliveira, Joel Vasquez, Pia Quist). The repo is public; run `scripts/repo-purity.sh` before pushing.
- Never infer pronouns for a teammate in copy; use the name ("Tell Rae why?").
- Comments state only a constraint the code cannot show.
- Settings writes go through `setSetting` from `@mattstack/rt-client`; never edit a store by hand. `board.*` rows carry no `default:`.
- Wire compatibility: an older peer must keep working. New payload fields are optional; an unknown `result` is dropped by old parsers, never crashes.
- Ask kinds and verbs: review → "Review" (review lane blue), re-review → "Re-review" (review lane blue), respond → "Respond" (respond lane green).
- Copy, verbatim: dropdown head "Asks for your agent", foot "Asks run on this Mac with your Claude usage.", empty "No one has asked for your agent.", decline label "Decline {First}'s ask. Tell {First} why? (optional)", chips "busy right now" / "not my area" / "ask me later", push body second line "Your agent waits for your go ahead.", send dialog body "It runs on {First}'s Mac with {First}'s Claude usage, once {First} says go ahead.", note label "Note for {First} (optional)", confirm "Send ask".
- `NUDGE_FRESH_MS` stays 48h; ask history keeps 14 days (`ASK_HISTORY_MS = 14 * 24 * 60 * 60_000`).
- UI milestones end with Fast Browser screenshots in light and dark compared against the boards; say plainly what reads wrong.

## Review Focus

1. A teammate sends two asks for the same MR before you answer: both cards show, accepting one must not leave the other startable into a duplicate run (the second accept hits the in-flight refusal and says so). Test in Task 6.
2. Accept clicked on an ask that expired or was handled between render and click: the route answers 409 with a plain reason and the dropdown reloads, never launching. Test in Task 6.
3. `board.peerAsks` turned off with asks already waiting: the next pass declines them with `asks-off` so askers are not left on "waiting" for 48h. Test in Task 4.
4. A relay that predates `PUT /boards/self/asks` (404): the board logs once and stops retrying each tick, and asks still flow. Test in Task 7.
5. An ask whose MR is not on the receiver's board (review asks on an MR outside the team view): the card renders from the payload's title, and pruning does not delete it before it is answered or expires. Tests in Tasks 2 and 3.

---

### Task 1: Wire format: pending outcome, decline fields, richer ask payload

**Files:**
- Modify: `apps/board/src/peer/envelope.ts`
- Test: `apps/board/src/__tests__/peer-envelope.test.ts`

**Interfaces:**
- Produces:
  - `type NudgeResult = 'pending' | 'launched' | 'rejected' | 'expired'`
  - `interface ReReviewRequestPayload { mrUrl: string; iid: number; note?: string; title?: string; sourceBranch?: string }`
  - `interface NudgeOutcomePayload { mrUrl: string; iid: number; nudgeId: string; result: NudgeResult; reason?: string; declined?: true; declineNote?: string }`
  - `const DECLINE_REASONS: { busy: 'busy right now'; 'not-my-area': 'not my area'; later: 'ask me later' }`, `type DeclineReason = keyof typeof DECLINE_REASONS`

- [ ] **Step 1: Write the failing tests** (append to `peer-envelope.test.ts`)

```ts
import {
  DECLINE_REASONS,
  parseNudgeOutcomePayload,
  parseReReviewRequestPayload,
} from '../peer/envelope.ts';

describe('ask consent wire', () => {
  test('a pending outcome parses', () => {
    expect(
      parseNudgeOutcomePayload({ mrUrl: 'u', iid: 1, nudgeId: 'n', result: 'pending' })
    ).toEqual({ mrUrl: 'u', iid: 1, nudgeId: 'n', result: 'pending', reason: undefined });
  });
  test('a decline carries its flag and note', () => {
    expect(
      parseNudgeOutcomePayload({
        mrUrl: 'u', iid: 1, nudgeId: 'n', result: 'rejected',
        reason: 'busy right now', declined: true, declineNote: 'after standup',
      })
    ).toMatchObject({ declined: true, declineNote: 'after standup', reason: 'busy right now' });
  });
  test('a non-boolean declined or non-string note is malformed', () => {
    const base = { mrUrl: 'u', iid: 1, nudgeId: 'n', result: 'rejected' };
    expect(parseNudgeOutcomePayload({ ...base, declined: 'yes' })).toBeNull();
    expect(parseNudgeOutcomePayload({ ...base, declineNote: 3 })).toBeNull();
  });
  test('an unknown result is still dropped', () => {
    expect(
      parseNudgeOutcomePayload({ mrUrl: 'u', iid: 1, nudgeId: 'n', result: 'snoozed' })
    ).toBeNull();
  });
  test('an ask carries title and branch when the sender knows them', () => {
    expect(
      parseReReviewRequestPayload({
        mrUrl: 'u', iid: 1, note: 'mostly the retry path',
        title: 'debounce the claim search input', sourceBranch: 'acme-1388-debounce',
      })
    ).toEqual({
      mrUrl: 'u', iid: 1, note: 'mostly the retry path',
      title: 'debounce the claim search input', sourceBranch: 'acme-1388-debounce',
    });
  });
  test('an older ask without them still parses', () => {
    expect(parseReReviewRequestPayload({ mrUrl: 'u', iid: 1 })).toEqual({
      mrUrl: 'u', iid: 1, note: undefined, title: undefined, sourceBranch: undefined,
    });
  });
  test('decline reasons read as the chips do', () => {
    expect(Object.values(DECLINE_REASONS)).toEqual([
      'busy right now', 'not my area', 'ask me later',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/peer-envelope.test.ts`
Expected: FAIL (`DECLINE_REASONS` not exported; `pending` rejected).

- [ ] **Step 3: Implement**

In `envelope.ts`:

```ts
export type NudgeResult = 'pending' | 'launched' | 'rejected' | 'expired';

export const DECLINE_REASONS = {
  busy: 'busy right now',
  'not-my-area': 'not my area',
  later: 'ask me later',
} as const;
export type DeclineReason = keyof typeof DECLINE_REASONS;

export interface ReReviewRequestPayload {
  mrUrl: string;
  iid: number;
  note?: string;
  title?: string;
  sourceBranch?: string;
}

export interface NudgeOutcomePayload {
  mrUrl: string;
  iid: number;
  nudgeId: string;
  result: NudgeResult;
  reason?: string;
  /** A person declined, as opposed to a board rule refusing. */
  declined?: true;
  declineNote?: string;
}
```

`parseReReviewRequestPayload`: read `note`, `title`, `sourceBranch`; each must be `undefined` or a string, else return `null`; return all three keys.

`NUDGE_RESULTS` becomes `['pending', 'launched', 'rejected', 'expired']`. `parseNudgeOutcomePayload` reads `declined` (must be `undefined` or `true`) and `declineNote` (`undefined` or string), and spreads them only when present:

```ts
  return {
    ...base,
    nudgeId,
    result: result as NudgeResult,
    reason: reason as string | undefined,
    ...(declined === true ? { declined: true as const } : {}),
    ...(typeof declineNote === 'string' ? { declineNote } : {}),
  };
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/__tests__/peer-envelope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer/envelope.ts apps/board/src/__tests__/peer-envelope.test.ts
git commit -m "board: pending outcome and decline fields on the peer wire"
```

---

### Task 2: Asker side: pending and declined resolutions

**Files:**
- Modify: `apps/board/src/peer/nudges.ts` (SentNudgeResolution, resolveSentNudge, finishSentNudge, SentNudgeView, sentNudgeView, SentNudgeDisplay, sentNudgeDisplay)
- Modify: `apps/board/src/peer/inbox.ts` (MaterializeDeps.resolveSentNudge type, nudge-outcome branch)
- Modify: `apps/board/src/peer/materialize-deps.ts` (pass the new fields through)
- Modify: `apps/board/src/client/types.ts` (`SentNudgeInfo`)
- Test: `apps/board/src/__tests__/peer-state.test.ts`, `apps/board/src/__tests__/peer-inbox.test.ts`

**Interfaces:**
- Consumes: Task 1's `NudgeResult` with `pending`, `NudgeOutcomePayload.declined/declineNote`.
- Produces:
  - `SentNudgeResolution { result: NudgeResult | 'confirmed' | 'done' | 'failed'; reason?: string; outcome?: string; at: number; declined?: true; declineNote?: string }`
  - `SentNudgeDisplay` adds `'pending'`
  - `SentNudgeView` adds `declined?: true; declineNote?: string`
  - client `SentNudgeInfo.display` adds `'pending'`, plus `declined?: boolean; declineNote?: string`

- [ ] **Step 1: Write the failing tests**

In `peer-state.test.ts` (use the file's existing temp-db helper for `writeSentNudge`/`resolveSentNudge`):

```ts
test('pending is replaced by any later answer', () => {
  const db = freshDb();
  writeSentNudge({ nudgeId: 'n1', mrUrl: 'u', iid: 1, reviewer: 'mira', sentAt: 0, kind: 'review' }, db);
  resolveSentNudge('u', { result: 'pending', at: 1 }, db);
  resolveSentNudge('u', { result: 'launched', at: 2 }, db);
  expect(readSentNudges(db).get('u')?.resolution?.result).toBe('launched');
});
test('a decline keeps its flag and note', () => {
  const db = freshDb();
  writeSentNudge({ nudgeId: 'n1', mrUrl: 'u', iid: 1, reviewer: 'mira', sentAt: 0 }, db);
  resolveSentNudge('u', { result: 'pending', at: 1 }, db);
  resolveSentNudge('u', { result: 'rejected', reason: 'busy right now', declined: true, declineNote: 'after standup', at: 2 }, db);
  const view = sentNudgeView(readSentNudges(db).get('u')!, 3);
  expect(view).toMatchObject({ display: 'rejected', reason: 'busy right now', declined: true, declineNote: 'after standup' });
});
test('pending reads no-response after 48h like an unanswered ask', () => {
  const n = { nudgeId: 'n', mrUrl: 'u', iid: 1, reviewer: 'mira', sentAt: 0, resolution: { result: 'pending' as const, at: 10 } };
  expect(sentNudgeDisplay(n, 10 + NUDGE_NO_RESPONSE_MS - 1)).toBe('pending');
  expect(sentNudgeDisplay(n, 10 + NUDGE_NO_RESPONSE_MS + 1)).toBe('no-response');
});
test('a pending ask can still finish when the run reports done', () => {
  const db = freshDb();
  writeSentNudge({ nudgeId: 'n1', mrUrl: 'u', iid: 1, reviewer: 'mira', sentAt: 0 }, db);
  resolveSentNudge('u', { result: 'pending', at: 1 }, db);
  finishSentNudge('u', { result: 'done', outcome: 'comment', at: 5 }, 9, db, 'n1');
  expect(readSentNudges(db).get('u')?.resolution?.result).toBe('done');
});
```

In `peer-inbox.test.ts`:

```ts
test('a nudge-outcome passes decline fields to the resolver', () => {
  const calls: unknown[] = [];
  materializeEnvelope(
    { id: 'e', to: 'rae', from: 'mira', type: 'nudge-outcome', sentAt: 1, receivedAt: 1,
      payload: { mrUrl: 'u', iid: 1, nudgeId: 'n', result: 'rejected', reason: 'not my area', declined: true, declineNote: 'ask Tom' } },
    { ...noopDeps, resolveSentNudge: (_u, r) => calls.push(r) },
    5
  );
  expect(calls).toEqual([{ result: 'rejected', reason: 'not my area', declined: true, declineNote: 'ask Tom', at: 5 }]);
});
```

(`noopDeps` is the file's existing no-op `MaterializeDeps`; add it if the file builds deps inline.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/peer-state.test.ts src/__tests__/peer-inbox.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`nudges.ts`:
- `SentNudgeResolution` gains `declined?: true; declineNote?: string`.
- `resolveSentNudge`: replace the guard with `if (was && was !== 'confirmed' && was !== 'pending' && !refreshesLaunch) return;`.
- `finishSentNudge`: allow `r === 'pending'` alongside `confirmed`/`launched`.
- `SentNudgeDisplay` adds `'pending'`. `sentNudgeDisplay`: when `r.result === 'pending'`, return `now - r.at > NUDGE_NO_RESPONSE_MS ? 'no-response' : 'pending'`; the rest unchanged.
- `SentNudgeView` adds `declined?: true; declineNote?: string`; `sentNudgeView` spreads `...(r?.declined ? { declined: true } : {})` and `...(r?.declineNote ? { declineNote: r.declineNote } : {})`.

`inbox.ts`: `MaterializeDeps.resolveSentNudge`'s resolution type becomes `{ result: NudgeResult | 'confirmed'; reason?: string; declined?: true; declineNote?: string; at: number }`; the `nudge-outcome` branch passes `{ result: p.result, reason: p.reason, ...(p.declined ? { declined: true as const } : {}), ...(p.declineNote ? { declineNote: p.declineNote } : {}), at: now }`.

`materialize-deps.ts`: forward the widened resolution unchanged to `resolveSentNudge`.

`client/types.ts` `SentNudgeInfo`: add `'pending'` to `display`; add `declined?: boolean; declineNote?: string`.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/__tests__/peer-state.test.ts src/__tests__/peer-inbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer apps/board/src/client/types.ts apps/board/src/__tests__/peer-state.test.ts apps/board/src/__tests__/peer-inbox.test.ts
git commit -m "board: the asker tracks pending and declined asks"
```

---

### Task 3: Receiver store: richer nudge rows, notified marker, inbox view, 14-day history

**Files:**
- Modify: `apps/board/src/peer/nudges.ts` (NudgeState, markNudgeHandled, new markNudgeNotified, pruneNudges)
- Modify: `apps/board/src/peer/inbox.ts` (write title, sourceBranch)
- Create: `apps/board/src/peer/ask-inbox.ts`
- Test: `apps/board/src/__tests__/peer-ask-inbox.test.ts` (new), `apps/board/src/__tests__/peer-state.test.ts`, `apps/board/src/__tests__/peer-inbox.test.ts`

**Interfaces:**
- Consumes: Task 1 payload fields.
- Produces:
  - `NudgeState` adds `title?: string; sourceBranch?: string; notifiedAt?: number`, and `handled?: { at: number; result: NudgeResult; reason?: string; note?: string }`
  - `markNudgeHandled(id: string, result: NudgeResult, reason?: string, db?: Database, now?: number, note?: string): void`
  - `markNudgeNotified(id: string, db?: Database, now?: number): void`
  - `pruneNudges(keepUrls: ReadonlySet<string>, db?: Database, now?: number): void`
  - `ASK_HISTORY_MS = 14 * 24 * 60 * 60_000` (exported from `ask-inbox.ts`)
  - `interface AskView { id: string; from: string; kind: AskKind; mrUrl: string; iid: number; title?: string; sourceBranch?: string; note?: string; receivedAt: number; handled?: { at: number; result: NudgeResult; reason?: string; note?: string } }`
  - `buildAskInbox(nudges: NudgeState[], now: number): { pending: AskView[]; history: AskView[] }` — pending oldest first; history newest first, handled within `ASK_HISTORY_MS`.

- [ ] **Step 1: Write the failing tests**

`peer-ask-inbox.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { ASK_HISTORY_MS, buildAskInbox } from '../peer/ask-inbox.ts';
import type { NudgeState } from '../peer/nudges.ts';

const ask = (id: string, over: Partial<NudgeState> = {}): NudgeState => ({
  id, mrUrl: `https://x/mr/${id}`, iid: 1, from: 'rae', receivedAt: 100, ...over,
});

describe('buildAskInbox', () => {
  test('waiting asks oldest first, kind defaults to re-review', () => {
    const { pending } = buildAskInbox([ask('b', { receivedAt: 200, kind: 'review' }), ask('a')], 300);
    expect(pending.map(p => [p.id, p.kind])).toEqual([['a', 're-review'], ['b', 'review']]);
  });
  test('handled asks are history, newest first, inside 14 days', () => {
    const now = 10 * ASK_HISTORY_MS;
    const { pending, history } = buildAskInbox([
      ask('old', { handled: { at: now - ASK_HISTORY_MS - 1, result: 'launched' } }),
      ask('x', { handled: { at: now - 10, result: 'rejected', reason: 'busy right now', note: 'later' } }),
      ask('y', { handled: { at: now - 5, result: 'expired', reason: 'stale' } }),
    ], now);
    expect(pending).toEqual([]);
    expect(history.map(h => h.id)).toEqual(['y', 'x']);
    expect(history[1]?.handled).toEqual({ at: now - 10, result: 'rejected', reason: 'busy right now', note: 'later' });
  });
  test('a view carries what the card shows', () => {
    const { pending } = buildAskInbox([ask('a', { title: 'debounce the claim search', sourceBranch: 'acme-1388-x', note: 'retry path' })], 300);
    expect(pending[0]).toMatchObject({ title: 'debounce the claim search', sourceBranch: 'acme-1388-x', note: 'retry path', from: 'rae' });
  });
});
```

`peer-state.test.ts`:

```ts
test('notified marker and handled note persist', () => {
  const db = freshDb();
  writeNudge({ id: 'n', mrUrl: 'u', iid: 1, from: 'rae', receivedAt: 1 }, db);
  markNudgeNotified('n', db, 7);
  markNudgeHandled('n', 'rejected', 'busy right now', db, 9, 'after standup');
  expect(readNudges(db)[0]).toMatchObject({ notifiedAt: 7, handled: { at: 9, result: 'rejected', reason: 'busy right now', note: 'after standup' } });
});
test('prune keeps a waiting ask off the board, drops history past 14 days', () => {
  const db = freshDb();
  const now = 30 * 24 * 60 * 60_000;
  writeNudge({ id: 'wait', mrUrl: 'off', iid: 1, from: 'rae', receivedAt: now - 60_000 }, db);
  writeNudge({ id: 'old', mrUrl: 'on', iid: 2, from: 'rae', receivedAt: 1, handled: { at: now - ASK_HISTORY_MS - 1, result: 'launched' } }, db);
  writeNudge({ id: 'recent', mrUrl: 'off', iid: 3, from: 'rae', receivedAt: 1, handled: { at: now - 1000, result: 'launched' } }, db);
  writeNudge({ id: 'lost', mrUrl: 'off', iid: 4, from: 'rae', receivedAt: now - ASK_HISTORY_MS - 1 }, db);
  pruneNudges(new Set(['on']), db, now);
  expect(readNudges(db).map(n => n.id).sort()).toEqual(['recent', 'wait']);
});
```

`peer-inbox.test.ts`: an inbound `review-request` with `title` and `sourceBranch` writes both onto the nudge row.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/peer-ask-inbox.test.ts src/__tests__/peer-state.test.ts src/__tests__/peer-inbox.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`nudges.ts`:
- Extend `NudgeState` as listed.
- `markNudgeHandled(id, result, reason?, db = getStateDb(), now = Date.now(), note?)`: build `handled: { at: now, result, ...(reason ? { reason } : {}), ...(note ? { note } : {}) }`.
- `markNudgeNotified(id, db = getStateDb(), now = Date.now())`: read-merge-write like `markNudgeHandled`, setting `notifiedAt: now`; no-op without a row.
- `pruneNudges(keepUrls, db = getStateDb(), now = Date.now())`: a row is stale when `(n.handled && now - n.handled.at > ASK_HISTORY_MS) || (!n.handled && !keepUrls.has(n.mrUrl) && now - n.receivedAt > ASK_HISTORY_MS)`. Import `ASK_HISTORY_MS` from `./ask-inbox.ts`. Update the doc comment to say why: history outlives the MR, and a waiting ask need not be on this board.

`inbox.ts` request branch: add `title: p.title, sourceBranch: p.sourceBranch` to the written nudge (omit undefined keys with spreads, matching `note`'s style).

`ask-inbox.ts`:

```ts
import type { AskKind, NudgeResult } from './envelope.ts';
import type { NudgeState } from './nudges.ts';

export const ASK_HISTORY_MS = 14 * 24 * 60 * 60_000;

export interface AskView {
  id: string;
  from: string;
  kind: AskKind;
  mrUrl: string;
  iid: number;
  title?: string;
  sourceBranch?: string;
  note?: string;
  receivedAt: number;
  handled?: { at: number; result: NudgeResult; reason?: string; note?: string };
}

function view(n: NudgeState): AskView {
  return {
    id: n.id,
    from: n.from,
    kind: n.kind ?? 're-review',
    mrUrl: n.mrUrl,
    iid: n.iid,
    receivedAt: n.receivedAt,
    ...(n.title ? { title: n.title } : {}),
    ...(n.sourceBranch ? { sourceBranch: n.sourceBranch } : {}),
    ...(n.note ? { note: n.note } : {}),
    ...(n.handled ? { handled: n.handled } : {}),
  };
}

export function buildAskInbox(
  nudges: NudgeState[],
  now: number
): { pending: AskView[]; history: AskView[] } {
  const pending = nudges
    .filter(n => !n.handled)
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .map(view);
  const history = nudges
    .filter(n => n.handled && now - n.handled.at <= ASK_HISTORY_MS)
    .sort((a, b) => b.handled!.at - a.handled!.at)
    .map(view);
  return { pending, history };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/__tests__/peer-ask-inbox.test.ts src/__tests__/peer-state.test.ts src/__tests__/peer-inbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer apps/board/src/__tests__/peer-ask-inbox.test.ts apps/board/src/__tests__/peer-state.test.ts apps/board/src/__tests__/peer-inbox.test.ts
git commit -m "board: the receiver keeps asks with title, note and 14 days of history"
```

---

### Task 4: Settings and the triage hold

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (new row; reword `board.peerAsks` description)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (`"board.peerAsksAlwaysAllow": z.array(z.string())`)
- Modify: `apps/board/src/triage/config.ts` (new `loadPeerAsksAlwaysAllow`)
- Modify: `apps/board/src/triage/nudge.ts` (hold, asks-off, plainReason)
- Test: `apps/board/src/__tests__/triage-nudge.test.ts`, `apps/board/src/__tests__/triage-config.test.ts` (create if absent; follow `config.test.ts`'s resolve-stub style)

**Interfaces:**
- Produces:
  - `loadPeerAsksAlwaysAllow(resolve?: GetSettingFn): Set<string>` — canonical (lowercased, trimmed) usernames; a missing or malformed value is an empty set, warned once like `storeValue`.
  - `NudgePassDeps` adds `alwaysAllow: ReadonlySet<string>`, `markNudgeNotified(id: string): void`, `notifyAsk(nudge: NudgeState): Promise<void>`.
  - `runNudgePass` result adds `held: number`.
  - `plainReason('asks-off')` → `'Asks are turned off'`.

- [ ] **Step 1: Write the failing tests**

In `triage-nudge.test.ts`, first make the existing suite keep its meaning: in `deps()`'s `base`, add `alwaysAllow: new Set(['alice'])`, `markNudgeNotified: id => notified.push(id)` (declare `const notified: string[] = []` and return it), and `notifyAsk: async n => asked.push(n.id)` (declare `const asked: string[] = []` and return it). Every existing `toEqual` on the pass result gains `held: 0`.

Then add:

```ts
describe('runNudgePass consent', () => {
  test('an ask from someone not always-allowed is held, published pending and notified once', async () => {
    const d = deps({ alwaysAllow: new Set() });
    const r = await runNudgePass(d);
    expect(r).toEqual({ dispatched: 0, rejected: 0, expired: 0, skipped: 0, held: 1 });
    expect(d.published).toEqual([{ to: 'alice', payload: { mrUrl: nudge.mrUrl, iid: 1, nudgeId: 'n1', result: 'pending' } }]);
    expect(d.asked).toEqual(['n1']);
    expect(d.notified).toEqual(['n1']);
    expect(d.handled).toEqual([]);
  });
  test('a held ask already notified stays quiet', async () => {
    const d = deps({ alwaysAllow: new Set(), readNudges: () => [{ ...nudge, notifiedAt: NOW - 1 }] });
    const r = await runNudgePass(d);
    expect(r.held).toBe(1);
    expect(d.published).toEqual([]);
    expect(d.asked).toEqual([]);
  });
  test('budget and cooldown never hold back a human decision', async () => {
    const d = deps({ alwaysAllow: new Set() });
    d.memory.mrs[nudge.mrUrl] = { ...emptyMrMemory('1970-01-12'), attemptsToday: cfg.dailyAttemptBudget };
    expect((await runNudgePass(d)).held).toBe(1);
  });
  test('a kind rule still refuses a held ask outright', async () => {
    const d = deps({ alwaysAllow: new Set(), readReviewStates: () => new Map([[nudge.mrUrl, { ...commentedReview, status: 'reviewing' }]]) });
    const r = await runNudgePass(d);
    expect(r.rejected).toBe(1);
    expect(d.published[0]?.payload).toMatchObject({ result: 'rejected', reason: 'review-in-flight' });
  });
  test('asks off declines a waiting ask with asks-off', async () => {
    const d = deps({ cfg: { ...cfg, enabled: false } });
    const r = await runNudgePass(d);
    expect(r.rejected).toBe(1);
    expect(d.handled).toEqual([{ id: 'n1', result: 'rejected', reason: 'asks-off' }]);
    expect(d.published[0]?.payload).toMatchObject({ result: 'rejected', reason: 'asks-off' });
  });
  test('asks off leaves already-handled asks alone', async () => {
    const d = deps({ cfg: { ...cfg, enabled: false }, readNudges: () => [{ ...nudge, handled: { at: 1, result: 'launched' } }] });
    expect((await runNudgePass(d)).skipped).toBe(1);
  });
});
```

Delete the existing `'disabled config skips'` decideNudge test only if it now contradicts; it does not (`decideRequest` still skips on disabled; `runNudgePass` intercepts before calling it).

`triage-config.test.ts`:

```ts
test('always-allow reads canonical usernames, empty when unset or malformed', () => {
  const resolve = (v: unknown) => (() => ({ value: v })) as never;
  expect([...loadPeerAsksAlwaysAllow(resolve([' Rae ', 'tom']))]).toEqual(['rae', 'tom']);
  expect(loadPeerAsksAlwaysAllow(resolve(undefined)).size).toBe(0);
  expect(loadPeerAsksAlwaysAllow(resolve('rae')).size).toBe(0);
});
```

(Match the real `GetSettingFn` stub shape used in `config.test.ts`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/triage-nudge.test.ts src/__tests__/triage-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Registry row in `registry-defs.ts`, beside `board.peerAsks`:

```ts
  {
    key: "board.peerAsksAlwaysAllow",
    type: "array",
    scopes: ["user"],
    merge: "replace",
    description:
      "Teammates (usernames) whose asks for this board's agent start without waiting for a go-ahead. Everyone else's ask waits in the asks inbox.",
  },
```

Reword `board.peerAsks`'s description: "Whether teammates' boards can ask this board's agent for a review, re-review or replies ({enabled}). On, asks wait in the asks inbox for a go-ahead unless the asker is in board.peerAsksAlwaysAllow; off, this board leaves every ask picker and declines what still arrives. rt's cron.triage step installs the board-peer trigger only while this is on."

Schema line: `"board.peerAsksAlwaysAllow": z.array(z.string()),`. Run `bun run build` in `packages/rt-client` afterwards (its `dist/` feeds the board).

`triage/config.ts`:

```ts
export function loadPeerAsksAlwaysAllow(
  resolve: GetSettingFn = getSetting
): Set<string> {
  const raw = storeValue<unknown>('board.peerAsksAlwaysAllow', resolve, 'treating as empty');
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw.filter((u): u is string => typeof u === 'string' && !!u.trim()).map(canonicalUsername)
  );
}
```

(Import `canonicalUsername` from `../peer/envelope.ts`; match `storeValue`'s real signature.)

`triage/nudge.ts`:
- `plainReason`: `case 'asks-off': return 'Asks are turned off';`.
- `NudgePassDeps`: add the three members.
- In `runNudgePass`'s loop, before `decideNudge`:

```ts
    if (!deps.cfg.enabled) {
      if (nudge.handled) {
        result.skipped++;
        continue;
      }
      deps.markNudgeHandled(nudge.id, 'rejected', 'asks-off');
      deps.publishOutcome(nudge.from, { mrUrl: nudge.mrUrl, iid: nudge.iid, nudgeId: nudge.id, result: 'rejected', reason: 'asks-off' });
      result.rejected++;
      continue;
    }
    const allowed = deps.alwaysAllow.has(nudge.from);
    const decideCfg = allowed
      ? deps.cfg
      : { ...deps.cfg, dailyAttemptBudget: Number.POSITIVE_INFINITY, cooldownMinutes: 0 };
```

  and pass `decideCfg` to `decideNudge`. After the expire/reject branch and before the launch, add the hold:

```ts
    if (!allowed) {
      result.held++;
      if (nudge.notifiedAt) continue;
      deps.publishOutcome(nudge.from, { mrUrl: nudge.mrUrl, iid: nudge.iid, nudgeId: nudge.id, result: 'pending' });
      await deps.notifyAsk(nudge);
      deps.markNudgeNotified(nudge.id);
      continue;
    }
```

  The audit line above it records `decision: 'dispatch'` today; for a held ask write `decision: 'hold'` instead (widen `AuditEntry['decision']` in `triage/audit.ts` if it is a union), and only on the first pass (`!nudge.notifiedAt`), so a waiting ask does not grow the log every run.
- The result object starts `{ dispatched: 0, rejected: 0, expired: 0, skipped: 0, held: 0 }`.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/__tests__/triage-nudge.test.ts src/__tests__/triage-config.test.ts` and, from the repo root, `bun test packages/rt-client/test` filtered to the registry tests (`bun test packages/rt-client/test/registry`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/settings apps/board/src/triage apps/board/src/__tests__/triage-nudge.test.ts apps/board/src/__tests__/triage-config.test.ts
git commit -m "board: hold asks for consent unless the asker is always allowed"
```

---

### Task 5: Shared launcher and the ask notification

**Files:**
- Create: `apps/board/src/peer/launch-ask.ts`
- Modify: `apps/board/bin/triage.ts` (use the launcher; wire `alwaysAllow`, `markNudgeNotified`, `notifyAsk`; print `held`)
- Modify: `apps/board/src/triage/notify.ts` (`category` option, `boardAskLink`, `askNotice`)
- Test: `apps/board/src/__tests__/triage-notify.test.ts` (create if absent)

**Interfaces:**
- Consumes: Task 3 `markNudgeNotified`, Task 4 `NudgePassDeps` additions and `loadPeerAsksAlwaysAllow`.
- Produces:
  - `makeAskLauncher(boardConfig: BoardConfig): (mrUrl: string, iid: number, kind: AskKind) => Promise<ReReviewLaunch>` — the exact closure `bin/triage.ts` passes as `launchAsk` today, moved verbatim with its imports (`launchRespondAsk`, `launchReReview`, `repoForMrUrl`, `resolveLaunchSkill`, `packForLaunch`, `loadAgentSettings`, `reviewLaunchForTab`).
  - `boardAskLink(boardUrl: string, askId: string): string` → `${boardUrl}/?ask=${encodeURIComponent(askId)}`
  - `askNotice(n: { kind?: AskKind; iid: number; title?: string }, fromName: string): { title: string; message: string }`
  - `notifyEscalation(..., opts: { url?: string | null; traySock?: string; category?: string })`, category default `'mr-doctor'`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'bun:test';
import { askNotice, boardAskLink } from '../triage/notify.ts';

describe('ask notification', () => {
  test('the link opens the board on that ask', () => {
    expect(boardAskLink('http://localhost:11006', 'a/b')).toBe('http://localhost:11006/?ask=a%2Fb');
  });
  test('copy per kind', () => {
    expect(askNotice({ kind: 'review', iid: 1388, title: 'debounce the claim search input' }, 'Rae Marlow')).toEqual({
      title: 'Rae Marlow asked for a review',
      message: '!1388 debounce the claim search input\nYour agent waits for your go ahead.',
    });
    expect(askNotice({ iid: 1391 }, 'Tom Clearwater').title).toBe('Tom Clearwater asked for a re-review');
    expect(askNotice({ kind: 'respond', iid: 1366 }, 'Bea Finch')).toEqual({
      title: 'Bea Finch asked your agent to respond',
      message: '!1366\nYour agent waits for your go ahead.',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/triage-notify.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`notify.ts`:

```ts
export function boardAskLink(boardUrl: string, askId: string): string {
  return `${boardUrl}/?ask=${encodeURIComponent(askId)}`;
}

const ASKED: Record<AskKind, string> = {
  review: 'asked for a review',
  're-review': 'asked for a re-review',
  respond: 'asked your agent to respond',
};

export function askNotice(
  n: { kind?: AskKind; iid: number; title?: string },
  fromName: string
): { title: string; message: string } {
  const mr = n.title ? `!${n.iid} ${n.title}` : `!${n.iid}`;
  return {
    title: `${fromName} ${ASKED[n.kind ?? 're-review']}`,
    message: `${mr}\nYour agent waits for your go ahead.`,
  };
}
```

`notifyEscalation`'s event uses `category: opts.category ?? 'mr-doctor'`.

`launch-ask.ts`: move the `launchAsk` closure body from `bin/triage.ts` (lines ~300-326 today) into `makeAskLauncher(boardConfig)`, computing `launchPack = packForLaunch(boardConfig, undefined)` inside. `bin/triage.ts` then passes `launchAsk: makeAskLauncher(boardConfig)`.

`bin/triage.ts` nudge pass wiring adds:

```ts
        alwaysAllow: loadPeerAsksAlwaysAllow(),
        markNudgeNotified: id => markNudgeNotified(id),
        notifyAsk: async n => {
          boardUrl ??= deckAppUrl('board');
          const base = await boardUrl;
          const fromName = memberDisplayName(boardConfig, n.from) ?? n.from;
          const { title, message } = askNotice(n, fromName);
          await notifyEscalation(title, message, 'rt', {
            url: base ? boardAskLink(base, n.id) : null,
            category: 'peer-ask',
          });
        },
```

`memberDisplayName` is the roster lookup the server already does with `reviewerDisplayName(username, config.members, memberNames)`; reuse `reviewerDisplayName` with the config's members and an empty `memberNames` map. Note the ask notification always uses `'rt'` mode: it is not gated by `triage.notify`. Add `held` to the `nudges:` console line.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/__tests__/triage-notify.test.ts src/__tests__/triage-nudge.test.ts`, then `cd apps/board && bunx tsc --noEmit -p .` (or the app's `typecheck` script via `bun run board:typecheck` from the repo root).
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer/launch-ask.ts apps/board/bin/triage.ts apps/board/src/triage/notify.ts apps/board/src/__tests__/triage-notify.test.ts
git commit -m "board: one ask launcher, and a push that lands on the ask"
```

---

### Task 6: Board routes: accept, decline, always-allow, the asks payload, the ask's title

**Files:**
- Create: `apps/board/src/peer/ask-actions.ts` (pure orchestration)
- Modify: `apps/board/src/server.ts` (three routes; `/data.json` `asks`; `/nudge` fills title, sourceBranch, note; `attachPeerState` drops inbound `nudges`; `peerAsksEnabled` and `pendingNudgesByMr` go)
- Modify: `apps/board/src/peer/nudges.ts` (delete `PendingNudge`, `pendingNudgesByMr`)
- Test: `apps/board/src/__tests__/peer-ask-actions.test.ts` (new)

**Interfaces:**
- Consumes: Task 3 `buildAskInbox`, `AskView`, `markNudgeHandled(…, note)`; Task 4 `decideNudge`, `plainReason`, `loadPeerAsksAlwaysAllow`; Task 5 `makeAskLauncher`; Task 1 `DECLINE_REASONS`, `DeclineReason`.
- Produces:
  - `acceptAsk(id: string, deps: AskActionDeps): Promise<{ ok: true } | { ok: false; status: 404 | 409 | 502; message: string }>`
  - `declineAsk(id: string, input: { reason?: DeclineReason; note?: string }, deps: AskActionDeps): { ok: true } | { ok: false; status: 404 | 409; message: string }`
  - `interface AskActionDeps { readNudges(): NudgeState[]; markNudgeHandled(id: string, result: NudgeResult, reason?: string, note?: string): void; publishOutcome(to: string, p: NudgeOutcomePayload): void; readReviewStates(): Map<string, ReviewState>; readRespondStates(): Map<string, { status: string }>; isOwnMr(mrUrl: string): boolean; launchAsk(mrUrl: string, iid: number, kind: AskKind): Promise<ReReviewLaunch>; cfg: TriageConfig; now(): number }`
  - `/data.json` gains `asks: { pending: AskCardData[]; history: AskCardData[]; alwaysAllow: string[] }` where `AskCardData = AskView & { fromName?: string }`, and `title` falls back to the board's own snapshot of the MR when the row has none.
  - Routes: `POST /asks/accept {id, alwaysAllow?}`, `POST /asks/decline {id, reason?, note?}`, `POST /asks/always-allow {username, allow}`, all `isLocalRequest`-guarded and `requireJsonBody`-checked like `/nudge`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'bun:test';
import { acceptAsk, declineAsk, type AskActionDeps } from '../peer/ask-actions.ts';
import type { NudgeState } from '../peer/nudges.ts';
import { parseTriageBlock } from '../triage/config.ts';

const NOW = 1_000_000;
const ask: NudgeState = { id: 'n1', mrUrl: 'https://x/mr/1', iid: 1, from: 'rae', receivedAt: NOW - 1000, kind: 'review' };

function deps(over: Partial<AskActionDeps> = {}) {
  const handled: unknown[] = [];
  const published: unknown[] = [];
  const launched: unknown[] = [];
  const d: AskActionDeps = {
    readNudges: () => [ask],
    markNudgeHandled: (id, result, reason, note) => handled.push({ id, result, reason, note }),
    publishOutcome: (to, p) => published.push({ to, p }),
    readReviewStates: () => new Map(),
    readRespondStates: () => new Map(),
    isOwnMr: () => false,
    launchAsk: async (mrUrl, iid, kind) => (launched.push({ mrUrl, iid, kind }), { kind: 'launched' }),
    cfg: parseTriageBlock({ enabled: true, cooldownMinutes: 30, dailyAttemptBudget: 0 }),
    now: () => NOW,
    ...over,
  };
  return Object.assign(d, { handled, published, launched });
}

describe('acceptAsk', () => {
  test('launches, marks accepted, publishes launched, ignoring budget', async () => {
    const d = deps();
    expect(await acceptAsk('n1', d)).toEqual({ ok: true });
    expect(d.launched).toEqual([{ mrUrl: ask.mrUrl, iid: 1, kind: 'review' }]);
    expect(d.handled).toEqual([{ id: 'n1', result: 'launched', reason: 'accepted', note: undefined }]);
    expect(d.published).toEqual([{ to: 'rae', p: { mrUrl: ask.mrUrl, iid: 1, nudgeId: 'n1', result: 'launched' } }]);
  });
  test('an unknown id is 404, a handled one 409, and nothing launches', async () => {
    const d = deps({ readNudges: () => [{ ...ask, handled: { at: 1, result: 'expired' } }] });
    expect(await acceptAsk('nope', d)).toMatchObject({ ok: false, status: 404 });
    expect(await acceptAsk('n1', d)).toMatchObject({ ok: false, status: 409 });
    expect(d.launched).toEqual([]);
  });
  test('a second ask for an MR already reviewing refuses with the reason', async () => {
    const d = deps({ readReviewStates: () => new Map([[ask.mrUrl, { mrUrl: ask.mrUrl, iid: 1, status: 'reviewing', startedAt: 0, updatedAt: 0 }]]) });
    expect(await acceptAsk('n1', d)).toEqual({ ok: false, status: 409, message: 'A review is already running' });
    expect(d.handled).toEqual([{ id: 'n1', result: 'rejected', reason: 'review-in-flight', note: undefined }]);
    expect(d.launched).toEqual([]);
  });
  test('an ask that went stale while open expires instead', async () => {
    const d = deps({ readNudges: () => [{ ...ask, receivedAt: NOW - 49 * 3_600_000 }] });
    expect(await acceptAsk('n1', d)).toMatchObject({ ok: false, status: 409 });
    expect(d.published[0]).toMatchObject({ p: { result: 'expired' } });
  });
  test('a failed launch is 502 and tells the asker', async () => {
    const d = deps({ launchAsk: async () => ({ kind: 'error', message: 'no pane' }) as never });
    expect(await acceptAsk('n1', d)).toMatchObject({ ok: false, status: 502 });
    expect(d.published[0]).toMatchObject({ p: { result: 'rejected', reason: 'launch-failed' } });
  });
});

describe('declineAsk', () => {
  test('publishes the chip words, the flag and the note', () => {
    const d = deps();
    expect(declineAsk('n1', { reason: 'busy', note: 'after standup' }, d)).toEqual({ ok: true });
    expect(d.handled).toEqual([{ id: 'n1', result: 'rejected', reason: 'busy right now', note: 'after standup' }]);
    expect(d.published).toEqual([{ to: 'rae', p: { mrUrl: ask.mrUrl, iid: 1, nudgeId: 'n1', result: 'rejected', reason: 'busy right now', declined: true, declineNote: 'after standup' } }]);
  });
  test('no reason picked sends none', () => {
    const d = deps();
    declineAsk('n1', {}, d);
    expect(d.published[0]).toEqual({ to: 'rae', p: { mrUrl: ask.mrUrl, iid: 1, nudgeId: 'n1', result: 'rejected', declined: true } });
  });
  test('a handled ask cannot be declined', () => {
    const d = deps({ readNudges: () => [{ ...ask, handled: { at: 1, result: 'launched' } }] });
    expect(declineAsk('n1', {}, d)).toMatchObject({ ok: false, status: 409 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/peer-ask-actions.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `ask-actions.ts`**

```ts
import { DECLINE_REASONS, type AskKind, type DeclineReason, type NudgeOutcomePayload, type NudgeResult } from './envelope.ts';
import type { NudgeState } from './nudges.ts';
import type { ReReviewLaunch } from '../review-launch.ts';
import type { ReviewState } from '../review-state.ts';
import type { TriageConfig } from '../triage/config.ts';
import { emptyMrMemory } from '../triage/memory.ts';
import { decideNudge, plainReason } from '../triage/nudge.ts';

export interface AskActionDeps { /* as listed in Interfaces */ }

type Fail<S extends number> = { ok: false; status: S; message: string };

function find(id: string, deps: AskActionDeps): NudgeState | Fail<404 | 409> {
  const n = deps.readNudges().find(x => x.id === id);
  if (!n) return { ok: false, status: 404, message: 'That ask is gone' };
  if (n.handled) return { ok: false, status: 409, message: 'That ask was already answered' };
  return n;
}

function outcome(n: NudgeState, result: NudgeResult, extra: Partial<NudgeOutcomePayload> = {}): NudgeOutcomePayload {
  return { mrUrl: n.mrUrl, iid: n.iid, nudgeId: n.id, result, ...extra };
}

export async function acceptAsk(id: string, deps: AskActionDeps): Promise<{ ok: true } | Fail<404 | 409 | 502>> {
  const n = find(id, deps);
  if ('ok' in n) return n;
  const now = deps.now();
  const cfg = { ...deps.cfg, enabled: true, dailyAttemptBudget: Number.POSITIVE_INFINITY, cooldownMinutes: 0 };
  const decision = decideNudge(
    n, deps.readReviewStates().get(n.mrUrl), emptyMrMemory(new Date(now).toISOString().slice(0, 10)),
    cfg, now, deps.readRespondStates().get(n.mrUrl), deps.isOwnMr(n.mrUrl)
  );
  if (decision.action === 'expire' || decision.action === 'reject') {
    const result: NudgeResult = decision.action === 'expire' ? 'expired' : 'rejected';
    deps.markNudgeHandled(n.id, result, decision.reason);
    deps.publishOutcome(n.from, outcome(n, result, { reason: decision.reason }));
    return { ok: false, status: 409, message: plainReason(decision.reason, deps.cfg) };
  }
  const kind: AskKind = n.kind ?? 're-review';
  const launch = await deps.launchAsk(n.mrUrl, n.iid, kind);
  if (launch.kind === 'error') {
    deps.markNudgeHandled(n.id, 'rejected', 'launch-failed');
    deps.publishOutcome(n.from, outcome(n, 'rejected', { reason: 'launch-failed' }));
    return { ok: false, status: 502, message: launch.message };
  }
  deps.markNudgeHandled(n.id, 'launched', 'accepted');
  deps.publishOutcome(n.from, outcome(n, 'launched'));
  return { ok: true };
}

export function declineAsk(
  id: string,
  input: { reason?: DeclineReason; note?: string },
  deps: AskActionDeps
): { ok: true } | Fail<404 | 409> {
  const n = find(id, deps);
  if ('ok' in n) return n;
  const words = input.reason ? DECLINE_REASONS[input.reason] : undefined;
  const note = input.note?.trim() || undefined;
  deps.markNudgeHandled(n.id, 'rejected', words, note);
  deps.publishOutcome(
    n.from,
    outcome(n, 'rejected', { ...(words ? { reason: words } : {}), declined: true, ...(note ? { declineNote: note } : {}) })
  );
  return { ok: true };
}
```

(The `decideNudge` "skip" result cannot occur here: `enabled` is forced true and the row is unhandled.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/__tests__/peer-ask-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the routes and payload in `server.ts`**

- Build one `askDeps(): AskActionDeps` in `server.ts` from: `readNudges`, `markNudgeHandled(id, r, reason, getStateDb(), Date.now(), note)`, `publishOutcome: (to, p) => { enqueueOutbox(makeEnvelope(to, 'nudge-outcome', p)); void peering.tickNow(); }`, `readReviewStates`, `readRespondStates`, `isOwnMr` from the current snapshot (`ownedHere` on the matching MR, `false` when the MR is absent), `launchAsk: makeAskLauncher(config)`, `cfg: loadTriageConfig()`, `now: Date.now`.
- `case '/asks/accept'`: parse `{ id: string; alwaysAllow?: boolean }`; on `alwaysAllow === true`, before accepting, add the sender: read the nudge's `from`, then `setSetting('board.peerAsksAlwaysAllow', [...loadPeerAsksAlwaysAllow(), from], { scope: 'user' })` (match rt-client's real `setSetting` signature; see the `rt-settings` skill). Return `{ ok: true }` (200) or the failure's `status` with its `message` as text.
- `case '/asks/decline'`: parse `{ id: string; reason?: DeclineReason; note?: string }`; reject an unknown `reason` key or a note over 500 characters with 400.
- `case '/asks/always-allow'`: parse `{ username: string; allow: boolean }`; write the set with the username added or removed (canonicalized).
- `/data.json` (where `peers` is set, ~line 1516): add `asks: asksPayload(snapshot)`, where `asksPayload` runs `buildAskInbox(readNudges(), Date.now())`, maps each view to `{ ...v, fromName: reviewerDisplayName(v.from, config.members, memberNames), title: v.title ?? snapshot.mrs.find(m => m.webUrl === v.mrUrl)?.title, sourceBranch: v.sourceBranch ?? snapshot.mrs.find(m => m.webUrl === v.mrUrl)?.sourceBranch }`, and adds `alwaysAllow: [...loadPeerAsksAlwaysAllow()]`.
- `/nudge`: `buildAskDraft(reviewer, kind, { mrUrl, iid, title: mr.title, ...(mr.sourceBranch ? { sourceBranch: mr.sourceBranch } : {}), ...(note ? { note } : {}) })`, where `note` is the body's optional `note` string, trimmed, max 500 characters (400 above that).
- `attachPeerState`: drop the inbound map and the `nudges` field; delete `peerAsksEnabled`. Delete `PendingNudge` and `pendingNudgesByMr` from `nudges.ts` and their tests.
- `pruneNudges(onBoard)` at ~line 1455 now runs with its new `now` default; no call change.

- [ ] **Step 6: Typecheck and run the touched tests**

Run: `bun run board:typecheck` (repo root), then `cd apps/board && bun test src/__tests__/peer-ask-actions.test.ts src/__tests__/peer-state.test.ts`.
Expected: no type errors (the compiler lists every remaining `nudges`/`awaitsClick` reader; Task 12 removes the client ones, so for now keep `InboundNudgeInfo` in `client/types.ts` and leave client readers compiling against an always-absent field), tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/board/src/peer/ask-actions.ts apps/board/src/peer/nudges.ts apps/board/src/server.ts apps/board/src/__tests__/peer-ask-actions.test.ts
git commit -m "board: accept, decline and always-allow routes, and the asks payload"
```

---

### Task 7: Relay: a board can leave the ask pickers

**Files:**
- Modify: `apps/board/switchboard/store.ts` (`asks_off` table, `setAsksEnabled`, `listAskableUsernames`, `deleteBoard` clears it)
- Modify: `apps/board/switchboard/server.ts` (`PUT /boards/self/asks`; `/peers` filters)
- Modify: `apps/board/src/peer/client.ts` (`setAsksEnabled`)
- Modify: `apps/board/src/peer/runtime.ts` (send on tick when changed; stop on unsupported)
- Modify: `apps/board/src/server.ts` (pass `asksEnabled` to `makePeering`)
- Test: `apps/board/switchboard/__tests__/server.test.ts`, `apps/board/switchboard/__tests__/store.test.ts`, `apps/board/src/__tests__/peer-runtime.test.ts`

**Interfaces:**
- Produces:
  - `SwitchboardStore.setAsksEnabled(username: string, enabled: boolean): void`, `SwitchboardStore.listAskableUsernames(): string[]`
  - `SwitchboardClient.setAsksEnabled(enabled: boolean): Promise<'ok' | 'unsupported' | 'failed'>` (404 → `unsupported`)
  - `PeeringHost.asksEnabled?: () => boolean`

- [ ] **Step 1: Write the failing tests**

`server.test.ts`:

```ts
test('a board with asks off leaves /peers; turning them on brings it back', async () => {
  const { call } = setup();
  const reg = async (u: string) => ((await (await call('/boards', { token: ADMIN, body: { username: u } })).json()) as { token: string }).token;
  const ada = await reg('ada');
  const grace = await reg('grace');
  expect((await call('/boards/self/asks', { method: 'PUT', token: grace, body: { enabled: false } })).status).toBe(200);
  const peers = async () => ((await (await call('/peers', { token: ada })).json()) as { peers: string[] }).peers.sort();
  expect(await peers()).toEqual(['ada']);
  await call('/boards/self/asks', { method: 'PUT', token: grace, body: { enabled: true } });
  expect(await peers()).toEqual(['ada', 'grace']);
});
test('asks toggle needs a board token and a boolean', async () => {
  const { call } = setup();
  expect((await call('/boards/self/asks', { method: 'PUT', body: { enabled: false } })).status).toBe(401);
  const t = ((await (await call('/boards', { token: ADMIN, body: { username: 'ada' } })).json()) as { token: string }).token;
  expect((await call('/boards/self/asks', { method: 'PUT', token: t, body: { enabled: 'no' } })).status).toBe(400);
  expect((await call('/boards/self/asks', { method: 'GET', token: t })).status).toBe(405);
});
```

`store.test.ts`: `deleteBoard` removes the board's `asks_off` row (re-register the same name: it is askable again).

`peer-runtime.test.ts` (fake client counting `setAsksEnabled` calls):

```ts
test('the tick sends asks state only when it changes, and stops on an old relay', async () => {
  let enabled = true;
  const sent: boolean[] = [];
  let answer: 'ok' | 'unsupported' = 'ok';
  const client = { ...fakeClient(), setAsksEnabled: async (e: boolean) => (sent.push(e), answer) };
  const p = makePeering({ makeClient: () => client, deps: noopDeps, asksEnabled: () => enabled, outboxDb: tempDb() });
  p.start('http://relay', 't');
  await p.tickNow(); await p.tickNow();
  expect(sent).toEqual([true]);
  enabled = false; await p.tickNow();
  expect(sent).toEqual([true, false]);
  answer = 'unsupported'; enabled = true; await p.tickNow(); enabled = false; await p.tickNow();
  expect(sent).toEqual([true, false, true]);
  p.stop();
});
```

(`fakeClient`, `noopDeps`, `tempDb` are the file's existing helpers; add any that are missing.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test switchboard/__tests__/server.test.ts switchboard/__tests__/store.test.ts src/__tests__/peer-runtime.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`store.ts` constructor adds:

```ts
    db.run(`CREATE TABLE IF NOT EXISTS asks_off (username TEXT PRIMARY KEY)`);
```

```ts
  setAsksEnabled(username: string, enabled: boolean): void {
    const u = canonicalUsername(username);
    if (enabled) this.db.run(`DELETE FROM asks_off WHERE username = ?`, [u]);
    else this.db.run(`INSERT OR IGNORE INTO asks_off (username) VALUES (?)`, [u]);
  }

  listAskableUsernames(): string[] {
    return this.db
      .query<{ username: string }, []>(
        `SELECT username FROM boards WHERE username NOT IN (SELECT username FROM asks_off) ORDER BY username`
      )
      .all()
      .map(r => r.username);
  }
```

`deleteBoard`'s transaction also runs `DELETE FROM asks_off WHERE username = ?`.

`server.ts` (relay), after the bearer check: `/peers` returns `{ peers: store.listAskableUsernames() }`; new branch:

```ts
    if (pathname === '/boards/self/asks') {
      if (req.method !== 'PUT') return new Response('method not allowed', { status: 405 });
      let body: unknown;
      try { body = await req.json(); } catch { return new Response('invalid json', { status: 400 }); }
      const enabled = (body as { enabled?: unknown })?.enabled;
      if (typeof enabled !== 'boolean') return new Response('expected { enabled: boolean }', { status: 400 });
      store.setAsksEnabled(username, enabled);
      return json(200, { ok: true });
    }
```

`client.ts`:

```ts
    async setAsksEnabled(enabled) {
      try {
        const res = await fetchFn(`${base}/boards/self/asks`, { method: 'PUT', headers, body: JSON.stringify({ enabled }) });
        if (res.status === 404) return 'unsupported';
        return res.ok ? 'ok' : 'failed';
      } catch {
        return 'failed';
      }
    },
```

`runtime.ts`: `PeeringHost` gains `asksEnabled?: () => boolean`. Inside `makePeering` keep `let asksSent: boolean | null = null; let asksUnsupported = false;`. In `runTick`, after the peers fetch:

```ts
      const want = host.asksEnabled?.();
      if (want !== undefined && !asksUnsupported && want !== asksSent) {
        const r = await runtime.client.setAsksEnabled(want);
        if (r === 'ok') asksSent = want;
        if (r === 'unsupported') {
          asksUnsupported = true;
          host.deps.log('peer: this switchboard cannot take boards off ask pickers; update the relay');
        }
      }
```

`start()` resets `asksSent = null` (a new token may be a new board).

Board `server.ts`'s `makePeering({...})` call adds `asksEnabled: () => { try { return loadPeerAsksConfig().enabled; } catch { return true; } }`.

The relay ships on merge to main (Railway); note it in the PR body.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test switchboard/__tests__/server.test.ts switchboard/__tests__/store.test.ts src/__tests__/peer-runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/switchboard apps/board/src/peer/client.ts apps/board/src/peer/runtime.ts apps/board/src/server.ts apps/board/src/__tests__/peer-runtime.test.ts
git commit -m "switchboard: a board with asks off leaves every ask picker"
```

---

### Task 8: tui-kit Popover recipe

**Files:**
- Create: `packages/tui-kit/src/recipes/Popover/Popover.tsx`, `Popover.module.css`, `Popover.test.tsx`, `Popover.visual.test.tsx`
- Modify: `packages/tui-kit/src/index.ts` (export)
- Read first: `packages/tui-kit/src/recipes/ContextMenu/ContextMenu.tsx` (how a recipe wraps Base UI's positioner and stamps parts), `packages/tui-kit/docs/development.md`, `packages/tui-kit/docs/css-contract.md`

**Interfaces:**
- Produces:

```ts
export interface PopoverOwnProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger element: Base UI's Popover.Trigger renders it. */
  trigger: ReactElement;
  side?: 'bottom' | 'top';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  ariaLabel: string;
  children?: ReactNode;
}
export const POPOVER_PARTS: { root: 'popover'; positioner: 'popover-positioner'; popup: 'popover-popup' };
```

- [ ] **Step 1: Write the failing test** (`Popover.test.tsx`, in the style of `ContextMenu.test.tsx`)

```tsx
test('opens below its trigger, closes on Escape and on an outside click', async () => {
  const user = userEvent.setup();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button">outside</button>
        <Popover open={open} onOpenChange={setOpen} ariaLabel="Asks" align="end" sideOffset={6}
          trigger={<button type="button">inbox</button>}>
          <p>Asks for your agent</p>
        </Popover>
      </>
    );
  }
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'inbox' }));
  expect(screen.getByRole('dialog', { name: 'Asks' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Asks' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'inbox' }));
  await user.click(screen.getByRole('button', { name: 'outside' }));
  expect(screen.queryByRole('dialog', { name: 'Asks' })).toBeNull();
});
test('stamps its parts for app CSS', async () => {
  render(<Popover open onOpenChange={() => {}} ariaLabel="Asks" trigger={<button type="button">t</button>}><p>x</p></Popover>);
  expect(document.querySelector('[data-part="popover-popup"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @mattstack/tui-kit test -- Popover` (or `cd packages/tui-kit && bun run test Popover`, whichever the package's `test` script supports)
Expected: FAIL (no module).

- [ ] **Step 3: Implement**

Build `Popover` with `defineComponent` (category 2, transient overlay, like `ConfirmDialog`) over `@base-ui/react`'s `Popover.Root` (controlled `open`/`onOpenChange`), `Popover.Trigger` (`render={trigger}`), `Popover.Portal`, `Popover.Positioner` (`side`, `align`, `sideOffset` defaults `bottom`/`center`/`4`), `Popover.Popup` (`aria-label={ariaLabel}`). Stamp `root`, `positioner`, `popup` parts exactly the way `ContextMenu` stamps its positioner and root. `Popover.module.css` gives the popup the panel surface, border, radius and shadow tokens `ContextMenu`'s root uses (copy the token names from `ContextMenu.module.css`; no new raw values). Export `Popover`, `POPOVER_PARTS`, `type PopoverProps` from `src/index.ts`. Add the visual test mirroring `ContextMenu.visual.test.tsx` (one open popover with a paragraph, both schemes) and run the package's codegen/manifest step if `development.md` says new recipes need it.

- [ ] **Step 4: Run to verify pass**

Run: the Step 2 command, then `bun run tui-kit:typecheck` and `bun run --filter @mattstack/tui-kit build` (root scripts per `apps/AGENTS.md`).
Expected: PASS; build writes `dist/`.

- [ ] **Step 5: Commit**

```bash
git add packages/tui-kit
git commit -m "tui-kit: Popover recipe for anchored panels"
```

---

### Task 9: Client inbox: header button, dropdown, cards, decline form, states, history

**Files:**
- Create: `apps/board/src/client/board/asks/ask-copy.ts`, `AsksButton.tsx`, `AsksDropdown.tsx`, `AskCard.tsx`, `AskDeclineForm.tsx`, `AskHistory.tsx`, `AsksDropdown.stories.tsx`, `asks.fixtures.ts`
- Create: `apps/board/src/client/board/asks/__tests__/ask-copy.test.ts`
- Modify: `apps/board/src/client/types.ts` (`AskCardData`, `BoardData.asks`)
- Modify: `apps/board/src/client/api.ts` (`acceptAsk`, `declineAsk`, `setAlwaysAllow`)
- Modify: `apps/board/src/client/board/Controls.tsx` (button left of `RefreshControl`)
- Modify: `apps/board/src/style.css` (asks block: card, flash, decline form)

**Interfaces:**
- Consumes: Task 6 `/data.json` `asks` and routes; Task 8 `Popover`; `MrLinks` (`client/board/MrLinks.tsx`), roster avatars (whatever `Sidebar.tsx` renders per member: reuse that component).
- Produces:
  - client `AskCardData { id; from; fromName?; kind: 'review' | 're-review' | 'respond'; mrUrl; iid; title?; sourceBranch?; note?; receivedAt; handled?: { at; result: 'pending' | 'launched' | 'rejected' | 'expired'; reason?; note? } }`
  - `BoardData.asks?: { pending: AskCardData[]; history: AskCardData[]; alwaysAllow: string[] }`
  - `ask-copy.ts`: `askedPhrase(kind)`, `verbLabel(kind)` ('Review' | 'Re-review' | 'Respond'), `verbLane(kind)` ('review' | 'respond'), `firstName(fromName | from)`, `historyOutcome(view)` → `{ text: string; tone: 'ok' | 'quiet' | 'warn' }`, `confirmLine(kind, iid)` → 'Your agent is reviewing !1388' / 're-reviewing' / 'is responding on'.
  - `AsksDropdown` props: `{ asks: NonNullable<BoardData['asks']>; flashId: string | null; onAccept(id: string, alwaysAllow: boolean): Promise<void>; onDecline(id: string, reason: DeclineReason | null, note: string): Promise<void>; onAllow(username: string, allow: boolean): Promise<void>; onFocus(mrUrl: string): void }`
  - `AsksButton` props: `{ asks: BoardData['asks']; open: boolean; onOpenChange(open: boolean): void; flashId: string | null; ...the AsksDropdown handlers }`; it renders the `Popover` with `align="end"`, `sideOffset={6}`.

- [ ] **Step 1: Write the failing copy tests**

```ts
import { describe, expect, test } from 'bun:test';
import { askedPhrase, confirmLine, firstName, historyOutcome, verbLabel, verbLane } from '../ask-copy.ts';

describe('ask copy', () => {
  test('phrases and verbs per kind', () => {
    expect([askedPhrase('review'), askedPhrase('re-review'), askedPhrase('respond')]).toEqual([
      'asked for a review', 'asked for a re-review', 'asked your agent to respond',
    ]);
    expect([verbLabel('review'), verbLabel('re-review'), verbLabel('respond')]).toEqual(['Review', 'Re-review', 'Respond']);
    expect([verbLane('re-review'), verbLane('respond')]).toEqual(['review', 'respond']);
  });
  test('first name from the roster name, else the username capitalized', () => {
    expect(firstName('Rae Marlow', 'rae')).toBe('Rae');
    expect(firstName(undefined, 'tom')).toBe('Tom');
  });
  test('history outcome words', () => {
    const h = (result: string, reason?: string) => historyOutcome({ handled: { at: 0, result, reason } } as never);
    expect(h('launched', 'accepted')).toEqual({ text: 'reviewed', tone: 'ok' });
    expect(h('launched', undefined)).toEqual({ text: 'reviewed · always allowed', tone: 'ok' });
    expect(h('rejected', 'busy right now')).toEqual({ text: 'declined: busy right now', tone: 'quiet' });
    expect(h('rejected', undefined)).toEqual({ text: 'declined', tone: 'quiet' });
    expect(h('expired', 'stale')).toEqual({ text: 'expired, no answer in 48h', tone: 'warn' });
  });
  test('the brief confirm line', () => {
    expect(confirmLine('review', 1388)).toBe('Your agent is reviewing !1388');
    expect(confirmLine('respond', 1366)).toBe('Your agent is responding on !1366');
  });
});
```

(For respond history, `historyOutcome` reads `responded` instead of `reviewed`; add that case to the test with `{ kind: 'respond', handled: {...} }`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/asks/__tests__/ask-copy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the copy module, then the components**

`ask-copy.ts` implements the functions above; the "always allowed" history case is a `launched` row whose `reason` is not `accepted` (the triage pass marks those with no reason).

Components, matching boards R1 C and R3 exactly (open `board.pen` in Pen or the renders before writing CSS):
- `AsksButton`: tui-kit `Icon` button in the header icon group, same classes as `RefreshControl` (`tui-theme-control`), inbox glyph (lucide `inbox` path; add the path constant beside the file's other lucide constants), count badge with the accent fill while `pending.length > 0`, tinted when open. `aria-label` "Asks for your agent, N waiting".
- `AsksDropdown`: head ("Asks for your agent", "N waiting" or "nothing waiting", a "history" link that swaps the body to `AskHistory` with a back chevron), the list of `AskCard`s or the empty state ("No one has asked for your agent." with the inbox glyph), and the foot ("Asks run on this Mac with your Claude usage." with a cpu glyph). Width 424px.
- `AskCard` (`data-ask-id={id}`): row 1 avatar + bold name + `askedPhrase` + `· !iid` + age right (reuse the row's age formatter); row 2 title with `MrLinks` on the right (build the minimal `BoardMRWithReview`-compatible object `MrLinks` needs from `mrUrl`, `iid`, `sourceBranch`, `title`, or widen `MrLinks` to take `{ webUrl, iid, sourceBranch, title, provider? }`); row 3 the note band when `note`; row 4 tui-kit `Button` with the bot mark in `verbLane`'s colour and `verbLabel`, a quiet `Button` "Decline", and a tui-kit checkbox "always allow {First}" (local state, sent with accept). After a successful accept, the card renders the one-line confirm (`confirmLine`, circle-check glyph, a "focus" link calling `onFocus`) for 4 seconds, then disappears (the next `/data.json` reload moves it to history). A failed accept shows the route's text as a tui-kit `Alert` line on the card and reloads.
- `AskDeclineForm`: replaces row 4 while declining: label "Decline {First}'s ask. Tell {First} why? (optional)", tui-kit `Chip`s for the three reasons (single choice, click again to clear), a one-line input "add a note for {First}" (tui-kit `Field`), Cancel (restores row 4) and a destructive `Button` "Decline" with the ban glyph.
- `AskHistory`: rows of who + kind, `!iid` + title, outcome in its tone, age; then "Always allowed" with one removable `Chip` per username (display name from the roster) and the hint "Their asks start without waiting for you. Remove someone to confirm theirs again."; empty list hides the section.
- Flash: when `flashId` matches a card, add `tui-ask-flash`; CSS:

```css
@keyframes tui-ask-flash {
  0%, 100% { background: var(--surface-panel); outline-color: transparent; }
  50% { background: var(--surface-wash-accent-14); outline-color: var(--fill-accent); }
}
.tui-ask-flash {
  outline: 2px solid transparent;
  outline-offset: -2px;
  animation: tui-ask-flash 1.2s ease-in-out 2;
}
@media (prefers-reduced-motion: reduce) {
  .tui-ask-flash {
    animation: tui-ask-fade 1.5s ease-out 1;
  }
  @keyframes tui-ask-fade {
    from { background: var(--surface-wash-accent-14); }
    to { background: var(--surface-panel); }
  }
}
```

  These are the tokens `.tui-row-flash` and the row bands already use (`--fill-accent` for the ring, `--surface-wash-accent-14` for the tint), so they pass the token-namespace lint as written.
- `api.ts`: `acceptAsk(id, alwaysAllow)`, `declineAsk(id, reason, note)`, `setAlwaysAllow(username, allow)` via `postAction`.
- `Controls.tsx`: render `AsksButton` before `RefreshControl` when `data.asks` is present; the open state lives in `Board.tsx` (Task 10 drives it from the deep link) and is passed down through `controlProps`.

Stories (`AsksDropdown.stories.tsx`, title `Board/Asks`), from `asks.fixtures.ts` with invented names: three kinds waiting (one with a note), decline form open, brief confirm, nothing waiting, history with two always-allowed chips, and one card mid-flash.

- [ ] **Step 4: Run tests and check in Storybook**

Run: `cd apps/board && bun test src/client/board/asks/__tests__/ask-copy.test.ts`, `bun run board:typecheck`, `bun run board:lint` if it exists.
Then `bun run storybook` (repo root) and, with Fast Browser, screenshot each `Board/Asks` story in light and dark at `http://localhost:6006/iframe.html?id=board-asks--<story>&globals=theme:<scheme>`. Compare against `renders/R3-dropdown-states.light.png` and R1 C; list every difference and fix it before committing.
Expected: PASS; stories match the boards in light; dark reads correctly.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client packages apps/board/src/style.css
git commit -m "board: the asks inbox in the header"
```

---

### Task 10: Landing on the ask: `?ask=` deep link and the flash

**Files:**
- Modify: `apps/board/src/client/board/deep-link.ts` (`askParam`, `LINK_PARAMS`)
- Modify: `apps/board/src/client/board/Board.tsx` (open the dropdown, scroll, flash, strip)
- Test: `apps/board/src/__tests__/deep-link.test.ts`

**Interfaces:**
- Consumes: Task 9 `AsksButton` open state, `data-ask-id`, `tui-ask-flash`.
- Produces: `askParam(search: string): string | null`; `stripDeepLinkParams` also strips `ask`.

- [ ] **Step 1: Write the failing tests**

```ts
test('ask param reads and strips', () => {
  expect(askParam('?ask=n%2F1&member=all')).toBe('n/1');
  expect(askParam('?ask=')).toBeNull();
  expect(stripDeepLinkParams('?ask=n1&member=all')).toBe('?member=all');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/deep-link.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`deep-link.ts`: `LINK_PARAMS = ['gate', 'mr', 'ask']`; `askParam` mirrors `gateParam`.

`Board.tsx`: alongside the existing `?gate`/`?mr` effect, once data has loaded: if `askParam(location.search)` is set, open the asks dropdown and set `flashId` to the id only when it is in `data.asks.pending`; after the popup mounts, `document.querySelector('[data-ask-id="..."]')?.scrollIntoView({ block: 'nearest' })`; clear `flashId` after 2.6s; replace the URL with `stripDeepLinkParams` via `history.replaceState`, as the gate link does. A stale id opens the dropdown and flashes nothing.

- [ ] **Step 4: Run to verify pass, then check by hand**

Run: `cd apps/board && bun test src/__tests__/deep-link.test.ts`.
Then with the fixture board (Task 13 adds asks to the fixture; until then, a temporary local edit of `tests/fixture/state.db` is fine but must not be committed) open `http://localhost:7941/?member=all&ask=<id>` with Fast Browser and record a short GIF of the flash (fast-browser:capturing-flows) in light and dark.
Expected: PASS; the dropdown opens under its button and the card pulses twice.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/deep-link.ts apps/board/src/client/board/Board.tsx apps/board/src/__tests__/deep-link.test.ts
git commit -m "board: a push lands on its ask with a slow flash"
```

---

### Task 11: Sending an ask: the confirm dialog with a note, and the agent glyph

**Files:**
- Modify: `apps/board/src/client/board/row-actions.ts` (ask request gains `note`; request-review glyph)
- Modify: `apps/board/src/client/board/action-runner.ts` (payload includes `note`)
- Create: `apps/board/src/client/board/AskConfirmDialog.tsx`
- Modify: `apps/board/src/client/board/Board.tsx` (intercept asks; one dialog per row or bulk ask)
- Modify: `apps/board/src/client/board/icons.tsx` (`AgentCloudGlyph`), `ActionMenu.tsx` (render the new glyph kind)
- Test: `apps/board/src/__tests__/client-api.test.ts` or the action-runner test file that covers `/nudge` payloads (find it with `grep -rln "'/nudge'" apps/board/src/client`)

**Interfaces:**
- Consumes: Task 6 `/nudge` accepting `note`.
- Produces:
  - `ActionRequest` ask variant: `{ kind: 'ask'; ask: 'review' | 're-review' | 'respond'; reviewer?: string; note?: string }`
  - `ActionGlyph` adds `{ kind: 'agent-cloud' }`
  - `AskConfirmDialog` props: `{ open: boolean; kind: AskKind; reviewerName: string; subject: string /* "!1271" or "3 MRs" */; onSend(note: string): void; onCancel(): void }`

- [ ] **Step 1: Write the failing test**

```ts
test('an ask carries its note to /nudge', async () => {
  const posts: Array<{ path: string; payload: unknown }> = [];
  const deps = fakeRunnerDeps({ post: async (path, payload) => (posts.push({ path, payload }), { ok: true, status: 200, body: {}, text: '' }) });
  await runOne({ kind: 'ask', ask: 'review', reviewer: 'mira', note: 'mostly the retry path' }, mr, deps);
  expect(posts[0]).toEqual({ path: '/nudge', payload: { mrUrl: mr.webUrl, iid: mr.iid, reviewer: 'mira', kind: 'review', note: 'mostly the retry path' } });
});
```

(Use the action-runner test file's existing fake deps and MR fixture; name them as that file does.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test <that test file>`
Expected: FAIL (no `note` in payload).

- [ ] **Step 3: Implement**

- `action-runner.ts` ask payload: `({ mrUrl: url, iid: mr.iid, reviewer, kind: req.ask, ...(req.note ? { note: req.note } : {}) })`.
- `row-actions.ts`: add `note?: string` to the ask variant; the request-review item and its pick options use `{ kind: 'agent-cloud' }` instead of `CLOUD`.
- `icons.tsx` `AgentCloudGlyph`: an inline 19×15 SVG, the lucide cloud at 14px with the lucide bot at 11px over its lower right on a rounded knockout filled `currentColor`-independent with the menu's surface token (match R4 exactly: cloud stroke muted, bot stroke the review lane's accent text). The hovered row's knockout uses the menu's hover surface token so the overlap stays clean.
- `ActionMenu.tsx`: render `agent-cloud` with `AgentCloudGlyph`.
- `AskConfirmDialog`: tui-kit `ConfirmDialog` with `intent="accent"`, `title` "Ask {First}'s agent to {review|re-review|respond on} {subject}?", `confirmLabel` "Send ask", `cancelLabel` "Cancel", children: the body line from the Global Constraints and a tui-kit `Field` labelled "Note for {First} (optional)" around a one-line input (max 500 characters); Enter in the input sends.
- `Board.tsx`: in `runRowAction` and the bulk `onRun`, when the request is an ask, store `{ request, opts, targets }` in a `pendingAsk` state and return; the dialog's `onSend(note)` calls the original dispatch with `{ ...request, note: note.trim() || undefined }`; `onCancel` clears it. One dialog covers a bulk ask.

- [ ] **Step 4: Run to verify pass, then check in the browser**

Run: the Step 2 command and `bun run board:typecheck`.
Then on the fixture board, right-click the seat's own MR (`!1236`, reach it with `?member=rmarlow` and the filters that show it), open "request review from…", screenshot the submenu and the dialog in light and dark with Fast Browser, and compare to `renders/R4-sending-an-ask.light.png`.
Expected: PASS; menu glyph and dialog match R4.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client
git commit -m "board: every ask confirms with an optional note"
```

---

### Task 12: The asker's band, and asks off the MR row

**Files:**
- Modify: `apps/board/src/client/board/ask-band.ts` (pending, declined, asks-off)
- Modify: `apps/board/src/client/board/row-status.ts` (drop the inbound-nudge loop in `peerLines`)
- Modify: `apps/board/src/client/types.ts` (delete `InboundNudgeInfo`, `nudges`)
- Modify: any reader the compiler then names (`StatusLine.tsx`'s `awaitsClick` verbs, `needs-me.ts`, `AskBand.stories.tsx`, gallery fixtures)
- Test: `apps/board/src/client/board/__tests__/ask-band.test.ts` (or the file that tests `askBandModel`; find it with `grep -rln askBandModel apps/board/src`), `apps/board/src/client/board/__tests__/row-status.test.ts`

**Interfaces:**
- Consumes: Task 2 `SentNudgeInfo` with `pending`, `declined`, `declineNote`.
- Produces: `askBandModel` handles `display: 'pending'` and declined/asks-off rejections.

- [ ] **Step 1: Write the failing tests**

```ts
const sent = (over: Partial<SentNudgeInfo>): SentNudgeInfo => ({ display: 'requested', reviewer: 'mira', reviewerName: 'Mira Holt', sentAt: 0, kind: 'review', ...over });

test('pending waits for the go ahead', () => {
  const b = askBandModel(sent({ display: 'pending', resolvedAt: 10 }), 20);
  expect(b).toMatchObject({ tone: 'neutral', icon: 'hourglass', label: "waiting for Mira's go ahead", actions: ['dismiss'] });
  expect(b.steps.map(s => s.name)).toEqual(['Requested', 'Waiting']);
});
test('a decline names the reason, keeps the note in the trail, offers only dismiss', () => {
  const b = askBandModel(sent({ display: 'rejected', declined: true, reason: 'busy right now', declineNote: 'after standup' }), 20);
  expect(b).toMatchObject({ tone: 'bad', icon: 'ban', label: 'Mira declined: busy right now', actions: ['dismiss'] });
  expect(b.steps.at(-1)).toMatchObject({ name: 'Declined', detail: 'after standup' });
});
test('a decline with no reason reads bare', () => {
  expect(askBandModel(sent({ display: 'rejected', declined: true }), 20).label).toBe('Mira declined');
});
test('asks off has its own words', () => {
  expect(askBandModel(sent({ display: 'rejected', reason: 'asks-off' }), 20)).toMatchObject({ label: 'Mira has asks turned off', actions: ['dismiss'] });
});
test('a board refusal still offers retry', () => {
  expect(askBandModel(sent({ display: 'rejected', reason: 'review-in-flight' }), 20).actions).toEqual(['retry', 'dismiss']);
});
```

`row-status.test.ts`: an MR carrying an inbound ask no longer produces a status-line candidate for it (delete the old `awaitsClick` / "asked for a review" expectations and assert `peerLines` ignores the field).

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test <ask-band test> src/client/board/__tests__/row-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ask-band.ts`'s switch gains:

```ts
    case 'pending':
      return band(
        { tone: 'neutral', icon: 'hourglass', label: `waiting for ${name}'s go ahead`, actions: ['dismiss'],
          ...(sent.sentAt ? { note: `Sent ${clock(sent.sentAt, now)}` } : {}) },
        { name: 'Waiting', detail: `for ${name}'s go ahead`, at: sent.resolvedAt }
      );
```

and the `rejected` case becomes:

```ts
    case 'rejected': {
      if (sent.declined)
        return band(
          { tone: 'bad', icon: 'ban', label: sent.reason ? `${name} declined: ${sent.reason}` : `${name} declined`, actions: ['dismiss'] },
          { name: 'Declined', detail: sent.declineNote ?? sent.reason ?? `${name} said no`, at: sent.resolvedAt }
        );
      if (sent.reason === 'asks-off')
        return band(
          { tone: 'bad', icon: 'ban', label: `${name} has asks turned off`, actions: ['dismiss'] },
          { name: 'Declined', detail: `${name}'s board takes no asks` }
        );
      return band(/* today's rejected band, unchanged */);
    }
```

`row-status.ts`: delete the `for (const n of nudges)` loop in `peerLines` and its `verb` helper if unused. Delete `InboundNudgeInfo` and `nudges` from `types.ts`, then fix every reader the compiler names; update `AskBand.stories.tsx` with a `pending` and two `rejected` (declined, asks-off) entries.

- [ ] **Step 4: Run to verify pass, then check in Storybook**

Run: the Step 2 command and `bun run board:typecheck`. Screenshot `Board/AskBand` (all states) in light and dark with Fast Browser; compare against R2 step 4 in `renders/R2-push-lands-on-ask.light.png`.
Expected: PASS; bands match.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client
git commit -m "board: the asker sees waiting and declined; asks leave the MR row"
```

---

### Task 13: Fixture, captures, and the end-to-end check

**Files:**
- Modify: `apps/board/tests/fixture/data.json` (or wherever the fixture server serves `/data.json` from; see `tests/fixture/README.md`) to include `asks` with three pending (one of each kind, invented names, one with a note) and three history rows
- Modify: `apps/board/tests/fixture/README.md` (document the asks)
- Modify: `apps/board/tests/capture.ts` (one shot of the header with the badge, one of the open dropdown)
- Regenerate: `apps/board/tests/baselines/*` for the new shots only (`bun run capture:baseline` in `apps/board`, intentional change)

- [ ] **Step 1: Add the fixture asks and the capture shots**

Follow the README's "Editing it" rules: invented names only, pinned timestamps relative to `meta.json`'s `now`.

- [ ] **Step 2: Run the gates**

Run, from `apps/board`: `bun run capture:baseline` (new shots only; inspect each PNG), then `bun run capture:compare`.
Expected: compare passes; the new baselines show the badge and the dropdown as R1 C draws them.

- [ ] **Step 3: End-to-end visual pass with Fast Browser, both schemes**

On the fixture board (`BOARD_FIXTURE=$(pwd)/tests/fixture PORT=7941 bun run src/server.ts` from `apps/board`): header badge, dropdown open with three kinds, decline form, history view, `?ask=` landing with the flash, row menu submenu glyph, send dialog, and the asker's bands. Screenshot each in light and dark; compare against R1 C, R2, R3, R4. Write down every mismatch and fix it; a mismatch is a failure, not a note.

- [ ] **Step 4: Purity and the two other suites**

Run from the repo root: `scripts/repo-purity.sh`, `bun run check` scoped by turbo to board and tui-kit if the full run is too slow locally (CI runs all of it).
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/board/tests
git commit -m "board: fixture asks and captures for the inbox"
```

---

## Self-review notes

- Spec coverage: ask kinds (Tasks 4, 9, 11), receiving and decision (3, 4), accept/decline/always-allow (6), `board.peerAsks` meaning and relay opt-out (4, 7), notification (5), landing and flash (10), inbox and states (9), off the row (12), sending with a note (11), asker's band (2, 12), versions in the field (1, 2, 7 compat tests), testing (all). No tray change, per the spec.
- Every new name appears with its signature in the task that produces it, and later tasks use the same names: `buildAskInbox`, `AskView`, `markNudgeNotified`, `loadPeerAsksAlwaysAllow`, `makeAskLauncher`, `askNotice`, `boardAskLink`, `acceptAsk`, `declineAsk`, `setAsksEnabled`, `listAskableUsernames`, `askParam`, `AgentCloudGlyph`, `AskConfirmDialog`.
- Task 9's flash CSS uses the tokens the row flash already uses, so no token is invented.
