# Board Review Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When anyone in the org starts a board review of a teammate's MR, every other org member's board shows "<reviewer> is reviewing" with a cloud spinner, and starting a second review asks first.

**Architecture:** The board already sends a `review-state` envelope to the MR author on each review transition. This plan fans that same envelope out to every enrolled org member (one envelope each, never `'*'`), stores the relay's `receivedAt` on receipt, renders a quiet presence line on non-author boards with a 2h stale cutoff, and guards interactive and bulk review launches. A pure module (`src/peer/presence.ts`) holds the addressing, envelope building and freshness rules so server and client share them.

**Tech Stack:** Bun + TypeScript, bun:sqlite state db, React 19 client with happy-dom tests, `@mattstack/tui-kit` `ConfirmDialog`.

**Spec:** `docs/superpowers/specs/2026-10-14-board-review-presence-design.md` (read it before starting; motion reference `docs/apps/design/board/cloud-spinners.html`, option F; mock `docs/apps/design/board/board.pen`, board B12).

## Global Constraints

- All paths below are relative to `apps/board/` unless they start with `docs/`.
- Run tests from `apps/board` (`cd apps/board && bun test <file>`); a run from the repo root skips the board's preload.
- Run only the targeted test files for files you touch; CI runs the full suite.
- Never address an envelope to `'*'`: the relay has no org scoping.
- The author's `review-state` copy is always sent, unfiltered, and is the only copy that carries `nudgeId`.
- Stale cutoff: `PEER_REVIEW_STALE_MS = 2 * 60 * 60 * 1000`, judged on `receivedAt` (fallback `updatedAt`).
- The non-author presence line is tone `quiet` (never `work`), word `<reviewer> is reviewing` (no ellipsis), verb `view-peer`, `spin: 'cloud'`.
- Cloud spinner timing: fill pulse 1.8s ease-in-out infinite; outline dash 30% of path length, 1.6s linear infinite; both stop under `prefers-reduced-motion`.
- Confirm copy: title `<Name> is already reviewing this`, confirm label `Review anyway`, cancel `Cancel`.
- Bulk toast fragment: `skipped !<iid>, <reviewer> is reviewing` (comma-joined per MR), separate from `N didn't need it`.
- Colours come from existing CSS tokens (`--text-3`, `--border`, `--border-soft`, `--text-accent`); no raw hex in `src/style.css`.
- This repo is public: tests and fixtures use invented names only (pat, kim, mira, ada, grace).
- Comments state only constraints the code cannot show.
- Commit after each task; messages start `board: `, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A roster member who is not enrolled on the switchboard: no envelope is sent to them when the enrolled list is known (pinned in Task 1).
2. The author themselves is in the org roster: they get exactly one envelope, the one with `nudgeId` (pinned in Task 1).
3. A board whose seat is `'all'`: it relays nothing, and on receipt it treats every MR as non-author (pinned in Task 6 for rendering; the existing `'all'` guards stay untouched in Tasks 4 and 5).
4. Two peers reviewing the same MR at once: the row shows one presence line per fresh reviewer and the confirm names the first (pinned in Task 6 and Task 8).
5. A redelivered older `review-state` after a newer one: last-write-wins on `updatedAt` still holds with `receivedAt` added (pinned in Task 3).

---

### Task 1: Pure presence core

**Files:**
- Create: `src/peer/presence.ts`
- Test: `src/__tests__/peer-presence.test.ts`

**Interfaces:**
- Consumes: `makeEnvelope`, `canonicalUsername`, `DraftEnvelope`, `ReviewStatePayload` from `src/peer/envelope.ts`.
- Produces:
  - `PEER_REVIEW_STALE_MS: number`
  - `reviewPresenceRecipients(input: { orgMembers: readonly string[]; self: string; author: string; enrolled: readonly string[] | null }): string[]` (author first, canonical, deduped)
  - `presenceEnvelopes(recipients: readonly string[], author: string, payload: ReviewStatePayload, now?: number): DraftEnvelope[]` (only the author's copy keeps `nudgeId`)
  - `isFreshPeerReview(s: { status: string; updatedAt: number; receivedAt?: number }, now: number): boolean`
  - `activePeerReviewer(mr: { peerReviews?: ReadonlyArray<{ reviewer: string; status: string; updatedAt: number; receivedAt?: number }> }, self: string | null, now: number): string | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'bun:test';

import {
  activePeerReviewer,
  isFreshPeerReview,
  PEER_REVIEW_STALE_MS,
  presenceEnvelopes,
  reviewPresenceRecipients,
} from '../peer/presence.ts';

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

describe('reviewPresenceRecipients', () => {
  test('every org member but me, author first, filtered to enrolled boards', () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['Pat', 'kim', 'mira', 'me', 'ada'],
        self: 'me',
        author: 'kim',
        enrolled: ['pat', 'kim', 'mira', 'me'],
      })
    ).toEqual(['kim', 'pat', 'mira']);
  });

  test('the author is sent even when not enrolled or not on the roster', () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['pat'],
        self: 'me',
        author: 'grace',
        enrolled: ['pat'],
      })
    ).toEqual(['grace', 'pat']);
  });

  test('an unknown enrolled list does not filter', () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['pat', 'mira'],
        self: 'me',
        author: 'kim',
        enrolled: null,
      })
    ).toEqual(['kim', 'pat', 'mira']);
  });

  test('the author on the roster gets exactly one copy', () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['kim', 'KIM ', 'pat'],
        self: 'me',
        author: 'Kim',
        enrolled: null,
      })
    ).toEqual(['kim', 'pat']);
  });
});

describe('presenceEnvelopes', () => {
  const payload = {
    mrUrl: URL_A,
    iid: 4821,
    status: 'reviewing',
    updatedAt: 500,
    nudgeId: 'ask-1',
  };

  test('one review-state per recipient; only the author keeps nudgeId', () => {
    const out = presenceEnvelopes(['kim', 'pat'], 'Kim', payload, 900);
    expect(out.map(e => [e.to, e.type])).toEqual([
      ['kim', 'review-state'],
      ['pat', 'review-state'],
    ]);
    expect((out[0]!.payload as { nudgeId?: string }).nudgeId).toBe('ask-1');
    expect('nudgeId' in (out[1]!.payload as object)).toBe(false);
    expect(new Set(out.map(e => e.id)).size).toBe(2);
  });

  test('never addresses everyone', () => {
    const out = presenceEnvelopes(['kim'], 'kim', payload);
    expect(out.every(e => e.to !== '*')).toBe(true);
  });
});

describe('isFreshPeerReview', () => {
  const NOW = 10 * PEER_REVIEW_STALE_MS;

  test('reviewing within the cutoff is fresh, past it is stale', () => {
    expect(
      isFreshPeerReview(
        { status: 'reviewing', updatedAt: 0, receivedAt: NOW - 1000 },
        NOW
      )
    ).toBe(true);
    expect(
      isFreshPeerReview(
        {
          status: 'reviewing',
          updatedAt: NOW,
          receivedAt: NOW - PEER_REVIEW_STALE_MS - 1,
        },
        NOW
      )
    ).toBe(false);
  });

  test('a legacy row without receivedAt is judged on updatedAt', () => {
    expect(
      isFreshPeerReview({ status: 'queued', updatedAt: NOW - 1000 }, NOW)
    ).toBe(true);
    expect(
      isFreshPeerReview(
        { status: 'queued', updatedAt: NOW - PEER_REVIEW_STALE_MS - 1 },
        NOW
      )
    ).toBe(false);
  });

  test('done and error are never fresh', () => {
    for (const status of ['done', 'error'])
      expect(isFreshPeerReview({ status, updatedAt: NOW }, NOW)).toBe(false);
  });
});

describe('activePeerReviewer', () => {
  const NOW = 10 * PEER_REVIEW_STALE_MS;
  const r = (reviewer: string, status = 'reviewing', receivedAt = NOW) => ({
    reviewer,
    status,
    updatedAt: receivedAt,
    receivedAt,
  });

  test('names the first fresh reviewer who is not me', () => {
    expect(
      activePeerReviewer(
        { peerReviews: [r('me'), r('pat', 'done'), r('mira'), r('ada')] },
        'me',
        NOW
      )
    ).toBe('mira');
  });

  test('null when nobody else is reviewing or the state is stale', () => {
    expect(activePeerReviewer({}, 'me', NOW)).toBeNull();
    expect(
      activePeerReviewer(
        { peerReviews: [r('pat', 'reviewing', NOW - PEER_REVIEW_STALE_MS - 1)] },
        'me',
        NOW
      )
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/__tests__/peer-presence.test.ts`
Expected: FAIL, cannot find module `../peer/presence.ts`.

- [ ] **Step 3: Write the implementation**

```ts
import {
  canonicalUsername,
  makeEnvelope,
  type DraftEnvelope,
  type ReviewStatePayload,
} from './envelope.ts';

/** Past this, a reviewing state whose board went quiet stops counting:
    nothing else retires a review whose board went offline mid-run. */
export const PEER_REVIEW_STALE_MS = 2 * 60 * 60 * 1000;

export function reviewPresenceRecipients(input: {
  orgMembers: readonly string[];
  self: string;
  author: string;
  enrolled: readonly string[] | null;
}): string[] {
  const author = canonicalUsername(input.author);
  const self = canonicalUsername(input.self);
  const enrolled = input.enrolled
    ? new Set(input.enrolled.map(canonicalUsername))
    : null;
  const out = [author];
  for (const raw of input.orgMembers) {
    const u = canonicalUsername(raw);
    if (!u || u === self || out.includes(u)) continue;
    if (enrolled && !enrolled.has(u)) continue;
    out.push(u);
  }
  return out;
}

export function presenceEnvelopes(
  recipients: readonly string[],
  author: string,
  payload: ReviewStatePayload,
  now: number = Date.now()
): DraftEnvelope[] {
  const authorKey = canonicalUsername(author);
  const { nudgeId, ...rest } = payload;
  return recipients.map(to =>
    makeEnvelope(
      to,
      'review-state',
      canonicalUsername(to) === authorKey && nudgeId
        ? { ...rest, nudgeId }
        : rest,
      now
    )
  );
}

export function isFreshPeerReview(
  s: { status: string; updatedAt: number; receivedAt?: number },
  now: number
): boolean {
  if (s.status !== 'queued' && s.status !== 'reviewing') return false;
  return now - (s.receivedAt ?? s.updatedAt) <= PEER_REVIEW_STALE_MS;
}

export function activePeerReviewer(
  mr: {
    peerReviews?: ReadonlyArray<{
      reviewer: string;
      status: string;
      updatedAt: number;
      receivedAt?: number;
    }>;
  },
  self: string | null,
  now: number
): string | null {
  const me = self === null ? null : canonicalUsername(self);
  for (const p of mr.peerReviews ?? []) {
    if (me !== null && canonicalUsername(p.reviewer) === me) continue;
    if (isFreshPeerReview(p, now)) return p.reviewer;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/__tests__/peer-presence.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer/presence.ts apps/board/src/__tests__/peer-presence.test.ts
git commit -m "board: presence core for review fan-out and freshness"
```

---

### Task 2: Org members and the enrolled list

**Files:**
- Modify: `src/config.ts` (`BoardConfig` near line 198, `loadConfig` return near line 740, new `orgMembersFromStore` beside `orgTeamsFromStore` near line 629)
- Modify: `src/peer/client.ts` (interface and `makeSwitchboardClient`)
- Modify: `src/peer/runtime.ts` (`PeerRuntime`, `runTick`, `start`)
- Modify fakes: `src/__tests__/peer-runtime.test.ts`, `src/__tests__/peer-closed-pane.test.ts`, `src/__tests__/peer-tick.test.ts`, `src/__tests__/peer-outbox.test.ts` (every object literal typed `SwitchboardClient` gains `enrolled: async () => null`)
- Test: `src/__tests__/config-store.test.ts`, `src/__tests__/peer-outbox.test.ts`, `src/__tests__/peer-runtime.test.ts`

**Interfaces:**
- Produces:
  - `BoardConfig.orgMembers?: string[]` (canonical usernames of every `mattstack.roster` entry, teams or not)
  - `SwitchboardClient.enrolled(): Promise<string[] | null>` (the `/peers` body's `peers` field, never `askable`)
  - `PeerRuntime.enrolled(): string[] | null` (last good list, refreshed each tick like `peers()`)

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/config-store.test.ts`, beside the `orgTeams` test (around line 330), add:

```ts
  test('orgMembers lists every roster entry, teamed or not', () => {
    teamView.team = () => 'widgets';
    const cfg = loadConfig(
      withRoster([
        { username: 'Dev1', name: 'Dev One', teams: ['widgets'] },
        { username: 'dev3', teams: ['gadgets'] },
        { username: 'dev5' },
      ])
    );
    expect(cfg.orgMembers).toEqual(['dev1', 'dev3', 'dev5']);
  });
```

In `src/__tests__/peer-outbox.test.ts`, after the `makeSwitchboardClient.peers askable` describe, add:

```ts
describe('makeSwitchboardClient.enrolled', () => {
  const clientFor = (body: unknown, status = 200) =>
    makeSwitchboardClient(
      'https://relay.example',
      'tok-1',
      (async () =>
        new Response(JSON.stringify(body), {
          status,
        })) as unknown as typeof fetch
    );

  test('reads peers, never askable', async () => {
    expect(
      await clientFor({ peers: ['ada', 'grace'], askable: ['ada'] }).enrolled()
    ).toEqual(['ada', 'grace']);
  });

  test('null on a bad body or a failed call', async () => {
    expect(await clientFor({}).enrolled()).toBeNull();
    expect(await clientFor({ peers: ['ada'] }, 404).enrolled()).toBeNull();
  });
});
```

In `src/__tests__/peer-runtime.test.ts`, beside the `peers()` caching test (around line 134), add a test that builds the fake client with `enrolled: async () => ['ada', 'grace', 'kim']`, starts the runtime, awaits `peering.tickNow()`, and asserts `rt.enrolled()` equals `['ada', 'grace', 'kim']`; then makes `enrolled` return `null`, ticks again, and asserts the list is unchanged. Before any tick lands, `rt.enrolled()` is `null`. Follow the exact shape of the existing `peers()` tests in that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/__tests__/config-store.test.ts src/__tests__/peer-outbox.test.ts src/__tests__/peer-runtime.test.ts`
Expected: FAIL (`orgMembers` undefined, `enrolled` is not a function).

- [ ] **Step 3: Implement**

`src/config.ts`, in `BoardConfig` after `orgTeams`:

```ts
  /** Every roster member's canonical username, teamless ones included. */
  orgMembers?: string[];
```

Beside `orgTeamsFromStore`:

```ts
function orgMembersFromStore(resolve: GetSettingFn): string[] {
  return boardSetting<StoredMember[]>('mattstack.roster', resolve).map(m =>
    m.username.trim().toLowerCase()
  );
}
```

In `loadConfig`'s return, after `orgTeams: orgTeamsFromStore(resolve),` add `orgMembers: orgMembersFromStore(resolve),`.

`src/peer/client.ts`, in the interface after `peers()`:

```ts
  /** Every enrolled board, asks on or off; null when the relay can't say. */
  enrolled(): Promise<string[] | null>;
```

and in the returned object:

```ts
    async enrolled() {
      try {
        const res = await fetchFn(`${base}/peers`, { headers });
        if (!res.ok) return null;
        const body = (await res.json()) as { peers?: unknown };
        if (
          !Array.isArray(body.peers) ||
          body.peers.some(p => typeof p !== 'string')
        )
          return null;
        return body.peers as string[];
      } catch {
        return null;
      }
    },
```

`src/peer/runtime.ts`: add `enrolled(): string[] | null;` to `PeerRuntime` with a doc line matching `peers()`; add `let enrolled: string[] | null = null;` beside `let peers`; in `runTick` after `if (fetched) peers = fetched;` add:

```ts
      const all = await runtime.client.enrolled();
      if (all) enrolled = all;
```

and in `start`'s runtime object add `enrolled: () => enrolled,`.

Add `enrolled: async () => null,` to every `SwitchboardClient` fake in the four test files listed above.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/__tests__/config-store.test.ts src/__tests__/peer-outbox.test.ts src/__tests__/peer-runtime.test.ts src/__tests__/peer-tick.test.ts src/__tests__/peer-closed-pane.test.ts`
Expected: PASS. Then `cd .. && cd .. && bun run board:typecheck` from the repo root: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/peer/client.ts apps/board/src/peer/runtime.ts apps/board/src/__tests__
git commit -m "board: org member list and the switchboard's enrolled boards"
```

---

### Task 3: Store the relay's receivedAt on peer reviews

**Files:**
- Modify: `src/peer/peer-reviews.ts` (`PeerReviewState`)
- Modify: `src/peer/inbox.ts:61`
- Modify: `src/client/types.ts:120` (`PeerReviewInfo`)
- Test: `src/__tests__/peer-inbox.test.ts`, `src/__tests__/peer-state.test.ts` (or whichever file holds `writePeerReview` tests; `grep -ln writePeerReview src/__tests__`)

**Interfaces:**
- Produces: `PeerReviewState.receivedAt?: number` and `PeerReviewInfo.receivedAt?: number`, set from `Envelope.receivedAt`.

- [ ] **Step 1: Write the failing tests**

In `peer-inbox.test.ts`, update the expectation of `'writes a peer review with reviewer merged from envelope.from'` to include `receivedAt: 200` (the `envelope()` helper's default), and add:

```ts
    test('a non-author peer review leaves sent nudges alone', () => {
      const deps = fakeDeps();
      materializeEnvelope(
        envelope({
          from: 'mira',
          payload: { mrUrl: URL_A, iid: 4821, status: 'done', updatedAt: 500 },
        }),
        deps,
        1000
      );
      expect(deps.peerReviews).toHaveLength(1);
      expect(deps.nudges).toEqual([]);
    });
```

Check how `fakeDeps()` records `finishSentNudge` and `resolveSentNudge` calls (the existing `'status reviewing also confirms...'` test shows it) and assert the recorded resolve/finish calls carry `'mira'` as the reviewer filter, so the real store's reviewer gate makes them no-ops.

In the `writePeerReview` test file, add a last-write-wins test: write `{ ...s, updatedAt: 500, receivedAt: 900 }`, then `{ ...s, updatedAt: 400, receivedAt: 1000 }`; the stored state keeps `updatedAt: 500, receivedAt: 900`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/peer-inbox.test.ts`
Expected: FAIL (`receivedAt` missing from the written state).

- [ ] **Step 3: Implement**

`PeerReviewState` gains:

```ts
  /** The relay's clock when this state arrived; freshness is judged on it. */
  receivedAt?: number;
```

`PeerReviewInfo` in `src/client/types.ts` gains `receivedAt?: number;`.

`inbox.ts` line 61 becomes:

```ts
    deps.writePeerReview({ ...p, reviewer: e.from, receivedAt: e.receivedAt });
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/__tests__/peer-inbox.test.ts src/__tests__/peer-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer/peer-reviews.ts apps/board/src/peer/inbox.ts apps/board/src/client/types.ts apps/board/src/__tests__
git commit -m "board: keep the relay's receivedAt on peer review states"
```

---

### Task 4: Fan the review sync out to the org

**Files:**
- Modify: `src/server.ts` (the `signal.kind === 'review'` block that calls `makeEnvelope(authorUsername, 'review-state', ...)`, around lines 4556-4585)

**Interfaces:**
- Consumes: `reviewPresenceRecipients`, `presenceEnvelopes` (Task 1); `config.orgMembers` (Task 2); `peering.current()?.enrolled()` (Task 2).

- [ ] **Step 1: Replace the single enqueue**

Inside the existing `if (authorUsername && canonicalUsername(authorUsername) !== canonicalUsername(config.defaultMember))` block, keep the `askId` computation and replace the `enqueueOutbox(makeEnvelope(authorUsername, 'review-state', {...}))` call with:

```ts
      const recipients = reviewPresenceRecipients({
        orgMembers: config.orgMembers ?? [],
        self: config.defaultMember,
        author: authorUsername,
        enrolled: peering.current()?.enrolled() ?? null,
      });
      for (const envelope of presenceEnvelopes(recipients, authorUsername, {
        mrUrl: signal.mrUrl,
        iid: signal.iid,
        status: signal.status,
        outcome: signal.outcome,
        updatedAt: emittedAt,
        ...(askId ? { nudgeId: askId } : {}),
      }))
        enqueueOutbox(envelope);
```

Keep `kickOutbox(pc);` after it. Update the comment above the block from "tell the MR author's board" to "tell the org's boards, the author's included". Import the two helpers from `./peer/presence.ts`. Remove `ReviewStatePayload`'s `satisfies` only if it no longer has a use in that block.

- [ ] **Step 2: Verify**

Run: `bun run board:typecheck` (repo root). Expected: PASS.
Run: `cd apps/board && bun test src/__tests__/agent-signal.test.ts src/__tests__/server-own-mr.test.ts`. Expected: PASS (unchanged behaviour for the own-MR and `'all'` guards).

- [ ] **Step 3: Commit**

```bash
git add apps/board/src/server.ts
git commit -m "board: tell every org board when a review of a teammate's MR moves"
```

---

### Task 5: Fan the closed-pane report out the same way

**Files:**
- Modify: `src/peer/closed-pane.ts` (`ClosedPaneIO`, `persistClosedPaneReports`)
- Modify: `src/server.ts` (`closedPeerReviewIO()`, around line 4696)
- Test: `src/__tests__/peer-closed-pane.test.ts`

**Interfaces:**
- Consumes: `presenceEnvelopes` (Task 1), `reviewPresenceRecipients` (Task 1).
- Produces: `ClosedPaneIO.recipients: (author: string) => string[]`.

- [ ] **Step 1: Write the failing test**

In `peer-closed-pane.test.ts`'s `runtime()` helper (around line 175), add `recipients: (author: string) => [author, 'mira']` to `io`. Add:

```ts
test('a closed pane reports to every recipient in one commit, nudgeId only to the author', async () => {
  const { io, db } = runtime();
  await sweepClosedPeerReviews(io, db);
  const sent = readOutbox(db).map(e => ({
    to: e.envelope.to,
    nudgeId: (e.envelope.payload as { nudgeId?: string }).nudgeId,
  }));
  expect(sent).toEqual([
    { to: 'kim', nudgeId: 'ask-1' },
    { to: 'mira', nudgeId: undefined },
  ]);
  expect(listKvValues(CLOSED_REPORTED_NS, db).get(URL_A)).toBe(500);
});
```

Adapt the destructuring to what `runtime()` returns today (read its `return` before writing the test), and keep every existing test passing with the new `recipients` dependency.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/peer-closed-pane.test.ts`
Expected: FAIL (only the author's envelope is queued).

- [ ] **Step 3: Implement**

Add to `ClosedPaneIO`:

```ts
  /** Who hears about this author's MR, author first. */
  recipients: (author: string) => string[];
```

In `persistClosedPaneReports`, replace the per-report transaction body with:

```ts
    stateDb.transaction(() => {
      for (const envelope of presenceEnvelopes(
        io.recipients(report.to),
        report.to,
        report.payload
      ))
        enqueueOutbox(envelope, stateDb);
      setKvValue(
        CLOSED_REPORTED_NS,
        report.mrUrl,
        report.runStartedAt,
        stateDb
      );
    })();
```

Drop the now-unused `makeEnvelope` import if nothing else uses it. In `server.ts` `closedPeerReviewIO()` add:

```ts
    recipients: (author: string) =>
      reviewPresenceRecipients({
        orgMembers: config.orgMembers ?? [],
        self: config.defaultMember,
        author,
        enrolled: peering.current()?.enrolled() ?? null,
      }),
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/__tests__/peer-closed-pane.test.ts` and `bun run board:typecheck` (repo root).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer/closed-pane.ts apps/board/src/server.ts apps/board/src/__tests__/peer-closed-pane.test.ts
git commit -m "board: a closed review pane clears the presence line on every org board"
```

---

### Task 6: The presence line on non-author boards

**Files:**
- Modify: `src/client/board/row-status.ts` (`Candidate.spin`, `peerLines`, `candidateLines`)
- Test: `src/client/board/__tests__/row-status.test.ts`, `src/client/board/__tests__/needs-me.test.ts`

**Interfaces:**
- Consumes: `isFreshPeerReview` (Task 1), `isOwnMr` (`src/view.ts`).
- Produces: `Candidate.spin?: boolean | 'cloud'`; `peerLines(mr, now, self)`.

- [ ] **Step 1: Write the failing tests**

In `row-status.test.ts`, the existing peer tests (around lines 1125-1265) use `mr()`, authored by `pat`, so they run as a non-author board. Change `'a live peer review is a working line with the view verb'`, `'a peer review my own ask started is left to the ask band'`, `'a pending ask hides that peer's own reviewing line...'` and `'a finished peer review is a go line naming the outcome'` to build their MR with `own({...})` and a reviewer other than `me` (`mira`), so they keep pinning author-board behaviour. Then add:

```ts
  describe('on a board that is not the author', () => {
    const peer = (status: string, receivedAt = NOW) => ({
      mrUrl: 'u',
      iid: 1,
      reviewer: 'mira',
      status,
      updatedAt: receivedAt,
      receivedAt,
    });

    test('a fresh peer review is a quiet line with the cloud spinner', () => {
      const [line] = candidateLines(
        mr({ peerReviews: [peer('reviewing')] }),
        NOW,
        NONE,
        ME
      );
      expect(line).toMatchObject({
        tone: 'quiet',
        word: 'mira is reviewing',
        spin: 'cloud',
      });
      expect(line!.verbs[0]).toEqual({ kind: 'view-peer', label: 'view ↗' });
    });

    test('done, error and stale states fall through to the reviewer line', () => {
      const base = candidateLines(mr({}), NOW, NONE, ME);
      for (const p of [
        peer('done'),
        peer('error'),
        peer('reviewing', NOW - 2 * 60 * 60 * 1000 - 1),
      ])
        expect(candidateLines(mr({ peerReviews: [p] }), NOW, NONE, ME)).toEqual(
          base
        );
    });

    test('two peers reviewing show one line each', () => {
      const lines = candidateLines(
        mr({ peerReviews: [peer('reviewing'), { ...peer('queued'), reviewer: 'ada' }] }),
        NOW,
        NONE,
        ME
      );
      expect(lines.map(l => l.word)).toEqual([
        'mira is reviewing',
        'ada is reviewing',
      ]);
    });

    test('an all board (no seat) follows the non-author rule', () => {
      const [line] = candidateLines(
        own({ peerReviews: [peer('reviewing')] }),
        NOW,
        NONE,
        null
      );
      expect(line).toMatchObject({ tone: 'quiet', spin: 'cloud' });
    });
  });

  test('on the author board a stale reviewing state shows no line', () => {
    const stale = {
      mrUrl: 'u',
      iid: 1,
      reviewer: 'mira',
      status: 'reviewing',
      updatedAt: NOW - 3 * 60 * 60 * 1000,
    };
    expect(
      candidateLines(own({ peerReviews: [stale] }), NOW, NONE, ME)
    ).toEqual(candidateLines(own({}), NOW, NONE, ME));
  });
```

In `needs-me.test.ts`, add:

```ts
test('an MR waiting on my review stays in needs me while a peer reviews it', () => {
  const base = reviewing('unreviewed');
  const withPeer = reviewing('unreviewed', {
    peerReviews: [
      {
        mrUrl: 'u',
        iid: 1,
        reviewer: 'mira',
        status: 'reviewing',
        updatedAt: NOW,
        receivedAt: NOW,
      },
    ],
  });
  expect(need(base)).not.toBeNull();
  expect(need(withPeer)).toBe(need(base));
});
```

Read the top of `needs-me.test.ts` for the `reviewState` value an assigned, not-yet-reviewed reviewer carries, and use that instead of `'unreviewed'` if it differs.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/row-status.test.ts src/client/board/__tests__/needs-me.test.ts`
Expected: FAIL (tone `work`, word with ellipsis, done line shown).

- [ ] **Step 3: Implement**

`Candidate.spin` becomes `spin?: boolean | 'cloud';`.

`peerLines` takes `self: string | null` and branches on `isOwnMr(mr, self)`:

```ts
function peerLines(
  mr: BoardMRWithReview,
  now: number,
  self: string | null
): Candidate[] {
  const out: Candidate[] = [];
  const mine = isOwnMr(mr, self);
  const asked = mr.sentNudge;
  const askInFlight =
    asked?.display === 'requested' ||
    asked?.display === 'pending' ||
    asked?.display === 'confirmed' ||
    asked?.display === 'launched'
      ? asked.reviewer
      : undefined;
  for (const p of mr.peerReviews ?? []) {
    const live = p.status === 'queued' || p.status === 'reviewing';
    if (live && !isFreshPeerReview(p, now)) continue;
    if (!mine) {
      if (live)
        out.push({
          tone: 'quiet',
          word: `${p.reviewer} is reviewing`,
          spin: 'cloud',
          verbs: [{ kind: 'view-peer', label: 'view ↗' }],
        });
      continue;
    }
    if (live) {
      if (p.reviewer === askInFlight) continue;
      out.push({
        tone: 'work',
        word: `${p.reviewer} is reviewing…`,
        spin: true,
        verbs: [{ kind: 'view-peer', label: 'view ↗' }],
      });
    } else if (p.status === 'done') {
      out.push({
        tone: 'go',
        word: `${p.reviewer} ${verdictWord(p.outcome, 'reviewed')}`,
        verbs: [{ kind: 'view-peer', label: 'view ↗' }],
      });
    }
  }
  const humans = activeReviewers(mr);
  if (humans.length) {
    out.push({
      tone: 'quiet',
      word: `${humans.join(', ')} ${humans.length === 1 ? 'is' : 'are'} reviewing right now`,
      verbs: [],
    });
  }
  return out;
}
```

In `candidateLines`, call `...peerLines(mr, now, self),`. Import `isFreshPeerReview` from `'../../peer/presence.ts'` (check the relative depth from `src/client/board/`; the client already imports `../../view.ts`, so `../../peer/presence.ts` resolves to `src/peer/presence.ts`).

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/client/board/__tests__/row-status.test.ts src/client/board/__tests__/needs-me.test.ts`
Expected: PASS. Also `bun run board:typecheck` (repo root): PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/row-status.ts apps/board/src/client/board/__tests__
git commit -m "board: a quiet presence line when a teammate is reviewing someone else's MR"
```

---

### Task 7: The cloud spinner

**Files:**
- Modify: `src/client/board/icons.tsx` (new `CloudSpinner` beside `AgentCloudGlyph`)
- Modify: `src/client/board/StatusLine.tsx:139`
- Modify: `src/style.css` (beside `.tui-status-ring`, around line 820)
- Test: `src/client/board/__tests__/status-line-dom.test.tsx`

**Interfaces:**
- Consumes: `Candidate.spin === 'cloud'` (Task 6).
- Produces: `CloudSpinner()` React component; CSS classes `tui-cloud-spin`, `tui-cloud-fill`, `tui-cloud-dash`.

- [ ] **Step 1: Write the failing test**

```tsx
test('a cloud-spin line leads with the cloud spinner and no ring', async () => {
  await render(
    {
      line: {
        tone: 'quiet',
        word: 'mira is reviewing',
        spin: 'cloud',
        verbs: [{ kind: 'view-peer', label: 'view ↗' }],
      },
      more: [],
      bar: null,
    },
    ctx()
  );
  const status = container.querySelector('.tui-status')!;
  expect(status.querySelector('.tui-status-ring')).toBeNull();
  const spinner = status.querySelector('.tui-cloud-spin');
  expect(spinner).not.toBeNull();
  expect(status.firstElementChild).toBe(spinner);
  expect(spinner!.querySelector('.tui-cloud-fill')).not.toBeNull();
  expect(spinner!.querySelector('.tui-cloud-dash')).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/status-line-dom.test.tsx`
Expected: FAIL (no `.tui-cloud-spin`).

- [ ] **Step 3: Implement**

`icons.tsx`, after `AgentCloudGlyph`:

```tsx
const CLOUD_D = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z';
const CLOUD_T = 'translate(5.9 0) scale(0.5833)';

/** AgentCloudGlyph animated for a peer's review in flight: the cloud's
    inside pulses and a dash runs its outline; the bot never moves. */
export function CloudSpinner() {
  const maskId = useId();
  const clipId = useId();
  return (
    <svg
      className="tui-cloud-spin"
      width={19.5}
      height={15}
      viewBox="0 0 19.5 15"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="19.5"
          height="15"
        >
          <rect width="19.5" height="15" fill="white" />
          <rect x="0" y="6.3" width="11.1" height="8.7" rx="2.6" fill="black" />
        </mask>
        <clipPath id={clipId}>
          <path transform={CLOUD_T} d={CLOUD_D} />
        </clipPath>
      </defs>
      <g mask={`url(#${maskId})`}>
        <g clipPath={`url(#${clipId})`}>
          <rect className="tui-cloud-fill" x="6" y="2" width="14" height="10" />
        </g>
        <path
          className="tui-cloud-outline"
          transform={CLOUD_T}
          d={CLOUD_D}
          strokeWidth={2.6}
        />
        <path
          className="tui-cloud-dash"
          pathLength={100}
          transform={CLOUD_T}
          d={CLOUD_D}
          strokeWidth={2.8}
        />
      </g>
      <g
        transform="translate(0 4) scale(0.4583)"
        stroke="var(--text-accent)"
        strokeWidth={3.3}
      >
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
      </g>
    </svg>
  );
}
```

`StatusLine.tsx`: import `CloudSpinner`; render it first inside `.tui-status`, and keep the ring for `spin === true` only:

```tsx
    <div className="tui-status" data-tone={line.tone}>
      {line.spin === 'cloud' && <CloudSpinner />}
      <span className="tui-status-word" title={line.word}>
        {line.word}
      </span>
      {line.spin === true && <span className="tui-status-ring" aria-hidden />}
```

`style.css`, after the `.tui-status-ring` keyframes:

```css
.tui-cloud-spin {
  flex-shrink: 0;
  margin-right: 6px;
  align-self: center;
}
.tui-cloud-fill {
  fill: color-mix(in srgb, var(--text-3) 22%, transparent);
  animation: tui-cloud-pulse 1.8s ease-in-out infinite;
}
.tui-cloud-outline {
  stroke: var(--border);
}
.tui-cloud-dash {
  stroke: var(--text-2);
  stroke-dasharray: 30 70;
  animation: tui-cloud-dash 1.6s linear infinite;
}
@keyframes tui-cloud-pulse {
  50% {
    fill: color-mix(in srgb, var(--text-3) 8%, transparent);
  }
}
@keyframes tui-cloud-dash {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tui-cloud-fill,
  .tui-cloud-dash {
    animation: none;
  }
  .tui-cloud-dash {
    stroke: none;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/client/board/__tests__/status-line-dom.test.tsx`
Expected: PASS. Then from the repo root `bun run check` for the board's lint and contrast gates touched by `style.css`; fix any token the gates reject by switching to the nearest role token they accept.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/icons.tsx apps/board/src/client/board/StatusLine.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/status-line-dom.test.tsx
git commit -m "board: cloud spinner for a peer's review in flight"
```

---

### Task 8: Confirm before an interactive review on a peer-reviewed MR

**Files:**
- Create: `src/client/board/presence-guard.ts`
- Create: `src/client/board/PresenceConfirmDialog.tsx`
- Modify: `src/client/board/Board.tsx` (runner, `handleLaunch`, `handleReReview`, `runRowAction` redo branch, dialog render near line 1968)
- Test: `src/client/board/__tests__/presence-guard.test.ts`

**Interfaces:**
- Consumes: `activePeerReviewer` (Task 1); `LaunchFlow`, `LaunchOpts` from the client's existing types (`row-actions.ts` / `action-runner.ts`).
- Produces:
  - `presenceConfirmFor(flow: LaunchFlow, opts: LaunchOpts, mr: BoardMR, self: string | null, now: number): string | null` (the reviewer to warn about, or null)
  - `PendingPresence { reviewer: string; run: () => void }` and `PresenceConfirmDialog({ pending, nameOf, onDone })`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import type { BoardMR } from '../../types.ts';
import { presenceConfirmFor } from '../presence-guard.ts';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const mr = (reviewer?: string) =>
  ({
    author: { username: 'kim' },
    peerReviews: reviewer
      ? [
          {
            mrUrl: 'u',
            iid: 1,
            reviewer,
            status: 'reviewing',
            updatedAt: NOW,
            receivedAt: NOW,
          },
        ]
      : [],
  }) as unknown as BoardMR;

describe('presenceConfirmFor', () => {
  test('a fresh review or re-review on a peer-reviewed MR asks first', () => {
    expect(presenceConfirmFor('review', {}, mr('mira'), 'me', NOW)).toBe('mira');
    expect(presenceConfirmFor('re-review', {}, mr('mira'), 'me', NOW)).toBe(
      'mira'
    );
  });

  test('focus, quiet, resume and other lanes never ask', () => {
    expect(
      presenceConfirmFor('review', { intent: 'focus' }, mr('mira'), 'me', NOW)
    ).toBeNull();
    expect(
      presenceConfirmFor('review', { quiet: true }, mr('mira'), 'me', NOW)
    ).toBeNull();
    expect(
      presenceConfirmFor('resume-review', {}, mr('mira'), 'me', NOW)
    ).toBeNull();
    expect(presenceConfirmFor('respond', {}, mr('mira'), 'me', NOW)).toBeNull();
  });

  test('my own reviewing state, or nobody reviewing, never asks', () => {
    expect(presenceConfirmFor('review', {}, mr('me'), 'me', NOW)).toBeNull();
    expect(presenceConfirmFor('review', {}, mr(), 'me', NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/presence-guard.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the guard and dialog**

`presence-guard.ts`:

```ts
import { activePeerReviewer } from '../../peer/presence.ts';
import type { BoardMR } from '../types.ts';
import type { LaunchOpts } from './action-runner.ts';
import type { LaunchFlow } from './row-actions.ts';

export function presenceConfirmFor(
  flow: LaunchFlow,
  opts: LaunchOpts,
  mr: BoardMR,
  self: string | null,
  now: number
): string | null {
  if (flow !== 'review' && flow !== 're-review') return null;
  if (opts.quiet || opts.intent === 'focus') return null;
  return activePeerReviewer(
    mr as Parameters<typeof activePeerReviewer>[0],
    self,
    now
  );
}
```

Check where `LaunchOpts` and `LaunchFlow` are exported (`grep -n "export type LaunchOpts\|export type LaunchFlow\|export interface LaunchOpts" src/client/board/*.ts`) and fix the two imports to match.

`PresenceConfirmDialog.tsx`:

```tsx
import { ConfirmDialog } from '@mattstack/tui-kit';

export interface PendingPresence {
  reviewer: string;
  run: () => void;
}

/** Starting a review someone else is already running doubles the work;
    Cancel holds focus, so Enter backs out. */
export function PresenceConfirmDialog({
  pending,
  nameOf,
  onDone,
}: {
  pending: PendingPresence | null;
  nameOf: (username: string) => string;
  onDone: () => void;
}) {
  const name = pending ? nameOf(pending.reviewer) : '';
  return (
    <ConfirmDialog
      open={pending !== null}
      intent="accent"
      confirmVariant="filled"
      title={`${name} is already reviewing this`}
      confirmLabel="Review anyway"
      cancelLabel="Cancel"
      onConfirm={() => {
        pending?.run();
        onDone();
      }}
      onCancel={onDone}
    >
      <p>{name}'s board says their review is still running.</p>
    </ConfirmDialog>
  );
}
```

- [ ] **Step 4: Wire it into Board.tsx**

1. Beside `const [pendingRedo, setPendingRedo] = ...` (line 446) add `const [pendingPresence, setPendingPresence] = useState<PendingPresence | null>(null);` and `const seatRef = useRef<string | null>(null);`. Where `seat` is computed (line 1446, `const seat = effectiveSeat(...)`), add `seatRef.current = seat;` on the next line.
2. After the `launch` `useCallback`, add:

```tsx
  const guardedLaunch = useCallback(
    (flow: LaunchFlow, mr: BoardMR, opts: LaunchOpts = {}) => {
      const reviewer = presenceConfirmFor(
        flow,
        opts,
        mr,
        seatRef.current,
        Date.now()
      );
      if (!reviewer) return launch(flow, mr, opts);
      setPendingPresence({ reviewer, run: () => void launch(flow, mr, opts) });
      return Promise.resolve(undefined);
    },
    [launch]
  );
```

3. `handleLaunch` and `handleReReview` call `guardedLaunch` instead of `launch`. `handleResumeReview`, `handleRedo` and `handleFocusPane` keep `launch`.
4. In the `runner` `useMemo`, use `launch: guardedLaunch` (and swap the dependency). In `runRowAction`'s redo branch, dispatch with `{ ...runner, launch }` so a confirmed redo never asks twice:

```tsx
          run: () =>
            void dispatchRowAction(req, mr, opts, { ...runner, launch }, rowHandlers),
```

5. Render the dialog next to `RedoConfirmDialog`:

```tsx
        <PresenceConfirmDialog
          pending={pendingPresence}
          nameOf={u => firstName(rosterNames.get(u), u)}
          onDone={() => setPendingPresence(null)}
        />
```

- [ ] **Step 5: Verify and commit**

Run: `cd apps/board && bun test src/client/board/__tests__/presence-guard.test.ts src/client/board/__tests__/action-runner.test.ts` and `bun run board:typecheck` (repo root).
Expected: PASS.

```bash
git add apps/board/src/client/board/presence-guard.ts apps/board/src/client/board/PresenceConfirmDialog.tsx apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/presence-guard.test.ts
git commit -m "board: ask before reviewing an MR a teammate is already reviewing"
```

---

### Task 9: Bulk launches skip peer-reviewed MRs and say so

**Files:**
- Modify: `src/client/board/action-runner.ts` (`RunnerDeps`, `runMany`, `runBulk`)
- Modify: `src/client/board/Board.tsx` (`runner` gains `presence`)
- Test: `src/client/board/__tests__/action-runner.test.ts`

**Interfaces:**
- Consumes: `presenceConfirmFor` (Task 8).
- Produces: `RunnerDeps.presence: (flow: LaunchFlow, mr: BoardMR) => string | null`; `runMany(req, targets, deps, skipped?, presenceSkipped?: ReadonlyArray<{ mr: BoardMR; reviewer: string }>)`.

- [ ] **Step 1: Write the failing tests**

Add `presence: () => null` to both `RunnerDeps` objects in `action-runner.test.ts` (`fakeDeps()` at line 37 and the inline one at line 261). Then add:

```ts
test('a bulk review skips MRs a peer is reviewing and names them', async () => {
  const { deps, events } = fakeDeps();
  deps.presence = (_flow, m) => (m.iid === 2 ? 'mira' : null);
  await runBulk(
    {
      request: { kind: 'launch', flow: 'review' },
      targets: [mr(1), mr(2)],
      selected: 2,
    },
    {},
    deps
  );
  expect(events).toEqual([
    'launch review !1 {"quiet":true}',
    "toast review started on !1 · skipped !2, mira is reviewing",
    'reload false',
  ]);
});

test('the toast still shows when every selected MR was skipped for presence', async () => {
  const { deps, events } = fakeDeps();
  deps.presence = () => 'mira';
  await runBulk(
    {
      request: { kind: 'launch', flow: 'review' },
      targets: [mr(1)],
      selected: 1,
    },
    {},
    deps
  );
  expect(events).toEqual(['toast skipped !1, mira is reviewing']);
});

test('presence never filters a respond or doctor bulk run', async () => {
  const { deps, events } = fakeDeps();
  deps.presence = () => 'mira';
  await runBulk(
    { request: { kind: 'launch', flow: 'respond' }, targets: [mr(1)], selected: 1 },
    {},
    deps
  );
  expect(events[0]).toBe('launch respond !1 {"quiet":true}');
});
```

Match the event strings to `fakeDeps()`'s actual recording format (the existing `'launch review !1 {"quiet":true}'` / `'toast …'` / `'reload false'` lines at line 250 show it) and the existing `manyDone` wording.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/action-runner.test.ts`
Expected: FAIL (MR 2 launched; no skipped fragment).

- [ ] **Step 3: Implement**

`RunnerDeps` gains:

```ts
  /** The peer already reviewing this MR, for flows that would double it. */
  presence: (flow: LaunchFlow, mr: BoardMR) => string | null;
```

`runMany` gains a fifth parameter and moves its empty-target return below the presence check:

```ts
export async function runMany(
  req: RunnableRequest,
  targets: readonly BoardMR[],
  deps: RunnerDeps,
  skipped = 0,
  presenceSkipped: ReadonlyArray<{ mr: BoardMR; reviewer: string }> = []
): Promise<void> {
  const presenceNote = presenceSkipped
    .map(s => `skipped !${s.mr.iid}, ${s.reviewer} is reviewing`)
    .join(', ');
  if (targets.length === 0) {
    if (presenceNote) deps.addToast(presenceNote);
    return;
  }
```

and, after the `didn't need it` push:

```ts
  if (presenceNote) parts.push(presenceNote);
```

In `runBulk`, before the final `return runMany(req, entry.targets, ...)`:

```ts
  if (req.kind === 'launch') {
    const presenceSkipped: Array<{ mr: BoardMR; reviewer: string }> = [];
    const targets = entry.targets.filter(m => {
      const reviewer = deps.presence(req.flow, m);
      if (reviewer) presenceSkipped.push({ mr: m, reviewer });
      return !reviewer;
    });
    return runMany(
      req,
      targets,
      deps,
      Math.max(0, (entry.selected ?? entry.targets.length) - entry.targets.length),
      presenceSkipped
    );
  }
```

so the "didn't need it" count stays measured against `entry.targets`, never the presence-filtered list.

In `Board.tsx`'s `runner`, add:

```tsx
      presence: (flow, mr) =>
        presenceConfirmFor(flow, {}, mr, seatRef.current, Date.now()),
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/board && bun test src/client/board/__tests__/action-runner.test.ts src/client/board/__tests__/bulk-menu-dom.test.tsx` and `bun run board:typecheck` (repo root).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/action-runner.ts apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/action-runner.test.ts
git commit -m "board: a bulk review skips MRs a teammate is reviewing and says why"
```

---

### Task 10: See it in the real board

**Files:**
- Possibly modify: fixture data the fixture board serves (find with `grep -rn "peerReviews" apps/board/src/__tests__/fixture-mode.test.ts apps/board/scripts 2>/dev/null` and the board's `README.md` "fixture" section)
- Possibly modify: capture baselines (`bun run capture:baseline` in `apps/board`) only if the change to a captured row is intended

- [ ] **Step 1: Add a presence row to the fixture board**

Give one fixture MR authored by someone other than the fixture seat a `peerReviews` entry `{ reviewer: <invented name>, status: 'reviewing', updatedAt: <now>, receivedAt: <now> }` so a fixture board renders the presence line. Use an invented name.

- [ ] **Step 2: Render and look**

Start a fixture board on a free port (`PORT=<port>` per `apps/board/AGENTS.md`, "Browser checks"), and with Fast Browser:
- screenshot the row in light and in dark;
- start a review on that row from the row menu and screenshot the confirm;
- select it plus one other MR, run the bulk review, and screenshot the toast.
Say plainly what looks wrong. Compare the spinner against option F in `docs/apps/design/board/cloud-spinners.html`.

- [ ] **Step 3: Gates**

Run from the repo root: `bun run check`, then in `apps/board`: `bun run capture:compare`. If a capture diff is the intended presence row, regenerate with `bun run capture:baseline` and say so in the commit.

- [ ] **Step 4: Commit**

```bash
git add -A apps/board
git commit -m "board: presence row in the fixture board"
```
