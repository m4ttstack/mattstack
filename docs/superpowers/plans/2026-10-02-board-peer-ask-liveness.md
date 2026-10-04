# Board Peer Ask Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A review asked of a teammate's agent never spins on "reviewing" forever: a closed pane is reported back, a quiet ask says so after 30 minutes, and peer review state survives in `state.db`.

**Architecture:** Three independent changes inside `apps/board`. (1) `peer/peer-reviews.ts` swaps its JSON-file storage for the existing `kv` table, with a one-shot import of leftover files at server start. (2) The asker side derives a new `no-update` display for a launched or confirmed ask that has been quiet for 30 minutes, and lets progress updates refresh a launched ask. (3) The reviewer side gains a pure `closedPaneReports` core plus a sweep that sends the asker a `review-state` `error` with `reason: 'pane closed'` when a review lane's pane is gone; the asker shows "stopped: pane closed", and a later `done` can still replace it.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `bun:test`, React (board client), Storybook.

**Spec:** `docs/superpowers/specs/2026-10-02-board-peer-ask-liveness-design.md`

## Global Constraints

- No new table and no `SCHEMA_VERSION` bump: everything new lives in the existing `kv` table.
- kv namespaces: `peer-review` (key `<mrUrl>\n<reviewer>`), `peer-closed-reported` (key `mrUrl`, value the run's `runStartedAt` or `0`); marker `meta` / `peer-reviews-imported`.
- `NUDGE_QUIET_MS = 30 * 60_000`.
- Wire change is additive only: `ReviewStatePayload.reason?: string`. Old boards must still parse every envelope we send.
- Copy: "no update", "stopped: <reason>", trail "No update" / "<name>'s agent has been quiet for 30m". Never an em dash or en dash in copy, comments or commit messages.
- Comments state constraints only (no narration, no review/process references).
- Run every test from `apps/board` (`cd apps/board && bun test <path>`); bun reads `bunfig.toml` only from the cwd.
- Never run the board server or any built binary against the real `~/.mattstack` during this work; the running dev board serves from this same checkout, so do not `deck restart board` without asking Matt.
- UI is not done until the band is rendered in Fast Browser in light and dark.

## Review Focus

- A pane that dies while its lane is still `queued` (before `reviewing`) is reported like a `reviewing` one. Test in Task 5.
- The reviewer's own MR (author is this board's member) is never reported, even with a gone pane. Test in Task 5.
- The same run swept twice sends one report; a fresh run on the same MR (new `runStartedAt`) reports again. Test in Task 5.
- An unreadable peer-review file during import is skipped; the others still import and the marker is set. Test in Task 2.
- An unanswered (`requested`) ask never reads `no-update`; it keeps the 48-hour `no-response` rule. Test in Task 3.

---

### Task 1: Peer reviews stored in `kv`

**Files:**
- Modify: `apps/board/src/peer/peer-reviews.ts`
- Test: `apps/board/src/__tests__/peer-state.test.ts` (the `writePeerReview`, `readPeerReviews`, `prunePeerReviews` describe blocks)

**Interfaces:**
- Consumes: `getStateDb`, `persistOrWarn` from `../state/index.ts`; `getKvValue`, `setKvValue`, `deleteKvValue`, `listKvValues` from `../state/kv-blob.ts`.
- Produces (unchanged names, new second parameter):
  - `writePeerReview(s: PeerReviewState, db?: Database): boolean`
  - `readPeerReviews(db?: Database): Map<string, PeerReviewState[]>`
  - `prunePeerReviews(keepUrls: ReadonlySet<string>, db?: Database): void`
  - `PEER_REVIEW_NS = 'peer-review'`, `peerReviewKey(mrUrl: string, reviewer: string): string`
  - `PEER_REVIEW_DIR` and `peerReviewFilePath` stay exported (Task 2's import uses them).

- [ ] **Step 1: Rewrite the peer-review tests against a temp db**

In `peer-state.test.ts`, the file already opens `db = openStateDb(join(dir, 'state.db'))` in `beforeEach`. Change the import list from `peer-reviews.ts` to:

```ts
import {
  attachPeerReviews,
  peerReviewFilePath,
  peerReviewKey,
  prunePeerReviews,
  readPeerReviews,
  writePeerReview,
  type PeerReviewState,
} from '../peer/peer-reviews.ts';
```

Replace every `describe` block from `describe('writePeerReview'` through the end of `describe('prunePeerReviews'` with:

```ts
describe('peerReviewKey', () => {
  test('separates MR and reviewer so the pair is unique', () => {
    expect(peerReviewKey(URL_A, 'grace')).toBe(`${URL_A}\ngrace`);
    expect(peerReviewKey(URL_A, 'grace')).not.toBe(peerReviewKey(URL_A, 'ada'));
  });
});

describe('writePeerReview', () => {
  const base = (over: Partial<PeerReviewState> = {}): PeerReviewState => ({
    mrUrl: URL_A,
    iid: 4821,
    reviewer: 'grace',
    status: 'reviewing',
    updatedAt: 1000,
    ...over,
  });

  test('first write returns true and persists', () => {
    expect(writePeerReview(base(), db)).toBe(true);
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('reviewing');
  });

  test('a newer state replaces an older one', () => {
    writePeerReview(base({ updatedAt: 1000, status: 'reviewing' }), db);
    expect(writePeerReview(base({ updatedAt: 2000, status: 'done' }), db)).toBe(
      true
    );
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('done');
  });

  test('an older or equal state is ignored', () => {
    writePeerReview(base({ updatedAt: 2000, status: 'done' }), db);
    expect(
      writePeerReview(base({ updatedAt: 1000, status: 'reviewing' }), db)
    ).toBe(false);
    expect(writePeerReview(base({ updatedAt: 2000, status: 'error' }), db)).toBe(
      false
    );
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('done');
  });

  test('writes nothing to the legacy folder', () => {
    writePeerReview(base(), db);
    expect(existsSync(peerReviewFilePath(URL_A, 'grace', dir))).toBe(false);
  });
});

describe('readPeerReviews', () => {
  test('groups one entry per reviewer under each MR', () => {
    writePeerReview(
      { mrUrl: URL_A, iid: 4821, reviewer: 'grace', status: 'done', updatedAt: 1 },
      db
    );
    writePeerReview(
      { mrUrl: URL_A, iid: 4821, reviewer: 'ada', status: 'reviewing', updatedAt: 1 },
      db
    );
    writePeerReview(
      { mrUrl: URL_B, iid: 1, reviewer: 'grace', status: 'done', updatedAt: 1 },
      db
    );
    const map = readPeerReviews(db);
    expect(map.get(URL_A)?.map(r => r.reviewer).sort()).toEqual(['ada', 'grace']);
    expect(map.get(URL_B)?.length).toBe(1);
  });

  test('returns an empty map on an empty db', () => {
    expect(readPeerReviews(db).size).toBe(0);
  });
});

describe('prunePeerReviews', () => {
  test('keeps states whose MR is kept, deletes the rest', () => {
    writePeerReview(
      { mrUrl: URL_A, iid: 4821, reviewer: 'grace', status: 'reviewing', updatedAt: 1 },
      db
    );
    writePeerReview(
      { mrUrl: URL_B, iid: 1, reviewer: 'grace', status: 'reviewing', updatedAt: 1 },
      db
    );
    prunePeerReviews(new Set([URL_A]), db);
    const map = readPeerReviews(db);
    expect(map.has(URL_A)).toBe(true);
    expect(map.has(URL_B)).toBe(false);
  });
});
```

Delete the old `describe('peerReviewFilePath'` block only if it now fails to compile; it should still pass as is (it tests a pure path function).

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/board && bun test src/__tests__/peer-state.test.ts`
Expected: FAIL (`peerReviewKey` is not exported; writes go to files, so reads from `db` come back empty).

- [ ] **Step 3: Implement the kv-backed store**

Replace the body of `apps/board/src/peer/peer-reviews.ts` with:

```ts
import { join } from 'path';
import type { Database } from 'bun:sqlite';

import { getStateDb, persistOrWarn } from '../state/index.ts';
import {
  deleteKvValue,
  getKvValue,
  listKvValues,
  setKvValue,
} from '../state/kv-blob.ts';

/** A peer's review status for one MR, as materialized from an inbound
    review-state envelope. Multiple reviewers can each have their own state
    for the same mrUrl -- see readPeerReviews' grouping. */
export interface PeerReviewState {
  mrUrl: string;
  iid: number;
  reviewer: string;
  status: string;
  outcome?: string;
  updatedAt: number;
}

export const PEER_REVIEW_NS = 'peer-review';

export function peerReviewKey(mrUrl: string, reviewer: string): string {
  return `${mrUrl}\n${reviewer}`;
}

/** Where peer reviews lived before state.db; read only by the one-shot
    import. */
export const PEER_REVIEW_DIR = join(
  import.meta.dir,
  '..',
  '..',
  'state',
  'peer-reviews'
);

export function peerReviewFilePath(
  mrUrl: string,
  reviewer: string,
  dir: string = PEER_REVIEW_DIR
): string {
  const slug = `${mrUrl}-${reviewer}`
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** Last-write-wins on the payload clock, not arrival order: at-least-once
    delivery and outbox retries can deliver an older state after a newer
    one. Returns whether this state was written. */
export function writePeerReview(
  s: PeerReviewState,
  db: Database = getStateDb()
): boolean {
  const key = peerReviewKey(s.mrUrl, s.reviewer);
  let wrote = false;
  persistOrWarn('peer review write', () => {
    db.transaction(() => {
      const prev = getKvValue<PeerReviewState | null>(
        PEER_REVIEW_NS,
        key,
        null,
        db
      );
      if (prev && prev.updatedAt >= s.updatedAt) return;
      setKvValue(PEER_REVIEW_NS, key, s, db);
      wrote = true;
    })();
  });
  return wrote;
}

/** Every peer review state, grouped by mrUrl. */
export function readPeerReviews(
  db: Database = getStateDb()
): Map<string, PeerReviewState[]> {
  const out = new Map<string, PeerReviewState[]>();
  for (const value of listKvValues(PEER_REVIEW_NS, db).values()) {
    const state = value as PeerReviewState;
    if (!state?.mrUrl) continue;
    const list = out.get(state.mrUrl);
    if (list) list.push(state);
    else out.set(state.mrUrl, [state]);
  }
  return out;
}

/** Callers gate this on a healthy snapshot so a failed fetch can't wipe
    live state. */
export function prunePeerReviews(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const stale = [...listKvValues(PEER_REVIEW_NS, db)].filter(
    ([, v]) => !keepUrls.has((v as PeerReviewState)?.mrUrl)
  );
  if (stale.length === 0) return;
  persistOrWarn('peer review prune', () => {
    db.transaction(() => {
      for (const [key] of stale) deleteKvValue(PEER_REVIEW_NS, key, db);
    })();
  });
}

/** Attach each MR's peer review states (matched by webUrl) as a
    `peerReviews` field. Non-mutating. */
export function attachPeerReviews<T extends { webUrl?: string | null }>(
  mrs: T[],
  peerReviews: Map<string, PeerReviewState[]>
): Array<T & { peerReviews?: PeerReviewState[] }> {
  return mrs.map(mr =>
    mr.webUrl && peerReviews.has(mr.webUrl)
      ? { ...mr, peerReviews: peerReviews.get(mr.webUrl) }
      : mr
  );
}
```

Check that `../state/index.ts` exports `persistOrWarn` (it does; `peer/nudges.ts` imports it from there).

- [ ] **Step 4: Run the tests to see them pass, plus typecheck**

Run: `cd apps/board && bun test src/__tests__/peer-state.test.ts src/__tests__/peer-inbox.test.ts src/__tests__/peer-tick.test.ts && bun run typecheck`
Expected: PASS, typecheck clean. `server.ts` and `materialize-deps.ts` compile unchanged because the new parameter is optional.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer/peer-reviews.ts apps/board/src/__tests__/peer-state.test.ts
git commit -m "board: keep peer review state in state.db"
```

---

### Task 2: One-shot import of leftover peer-review files

**Files:**
- Modify: `apps/board/src/peer/peer-reviews.ts` (add `importPeerReviewFiles`)
- Modify: `apps/board/src/server.ts` (call it once after `getStateDb('server')`, around line 372)
- Test: `apps/board/src/__tests__/peer-state.test.ts` (new `describe('importPeerReviewFiles')`)

**Interfaces:**
- Consumes: Task 1's `writePeerReview`, `PEER_REVIEW_DIR`.
- Produces: `importPeerReviewFiles(db: Database, dir?: string, now?: Date): { imported: number; skipped: number; renamed: boolean }`; marker `meta` / `peer-reviews-imported`.

- [ ] **Step 1: Write the failing tests**

Add to `peer-state.test.ts` (extend the `fs` import with `mkdirSync`, `writeFileSync`, `readdirSync`, and the `peer-reviews.ts` import with `importPeerReviewFiles`):

```ts
describe('importPeerReviewFiles', () => {
  const legacy = () => join(dir, 'peer-reviews');
  const put = (s: PeerReviewState) => {
    mkdirSync(legacy(), { recursive: true });
    writeFileSync(
      peerReviewFilePath(s.mrUrl, s.reviewer, legacy()),
      JSON.stringify(s)
    );
  };
  const NOW = new Date('2026-10-02T12:00:00');

  test('imports each file, sets the marker and renames the folder aside', () => {
    put({ mrUrl: URL_A, iid: 4821, reviewer: 'grace', status: 'done', updatedAt: 5 });
    put({ mrUrl: URL_B, iid: 1, reviewer: 'ada', status: 'reviewing', updatedAt: 5 });
    const result = importPeerReviewFiles(db, legacy(), NOW);
    expect(result).toEqual({ imported: 2, skipped: 0, renamed: true });
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('done');
    expect(existsSync(legacy())).toBe(false);
    expect(readdirSync(dir)).toContain('peer-reviews.imported-2026-10-02');
  });

  test('a newer db row wins over an older file', () => {
    writePeerReview(
      { mrUrl: URL_A, iid: 4821, reviewer: 'grace', status: 'done', updatedAt: 9 },
      db
    );
    put({ mrUrl: URL_A, iid: 4821, reviewer: 'grace', status: 'reviewing', updatedAt: 5 });
    importPeerReviewFiles(db, legacy(), NOW);
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('done');
  });

  test('skips an unreadable file and still imports the rest', () => {
    put({ mrUrl: URL_A, iid: 4821, reviewer: 'grace', status: 'done', updatedAt: 5 });
    writeFileSync(join(legacy(), 'broken.json'), '{not json');
    const result = importPeerReviewFiles(db, legacy(), NOW);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(readPeerReviews(db).has(URL_A)).toBe(true);
  });

  test('a second run is inert, and a missing folder just sets the marker', () => {
    expect(importPeerReviewFiles(db, legacy(), NOW)).toEqual({
      imported: 0,
      skipped: 0,
      renamed: false,
    });
    put({ mrUrl: URL_A, iid: 4821, reviewer: 'grace', status: 'done', updatedAt: 5 });
    expect(importPeerReviewFiles(db, legacy(), NOW).imported).toBe(0);
    expect(readPeerReviews(db).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/board && bun test src/__tests__/peer-state.test.ts -t importPeerReviewFiles`
Expected: FAIL (`importPeerReviewFiles` is not exported).

- [ ] **Step 3: Implement the import**

Add to `peer/peer-reviews.ts` (extend imports with `existsSync, readdirSync, readFileSync, renameSync` from `fs`):

```ts
const IMPORT_MARKER = 'peer-reviews-imported';

/** Moves pre-state.db peer review files into state.db exactly once, gated
    by a meta marker so a folder recreated later is never rescanned. */
export function importPeerReviewFiles(
  db: Database,
  dir: string = PEER_REVIEW_DIR,
  now: Date = new Date()
): { imported: number; skipped: number; renamed: boolean } {
  const result = { imported: 0, skipped: 0, renamed: false };
  if (getKvValue('meta', IMPORT_MARKER, false, db)) return result;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      let state: PeerReviewState;
      try {
        state = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      } catch {
        result.skipped++;
        continue;
      }
      if (!state?.mrUrl || !state.reviewer) {
        result.skipped++;
        continue;
      }
      writePeerReview(state, db);
      result.imported++;
    }
  }
  setKvValue('meta', IMPORT_MARKER, true, db);
  if (existsSync(dir)) {
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    try {
      renameSync(dir, `${dir}.imported-${stamp}`);
      result.renamed = true;
    } catch (err) {
      console.error(
        `peer review import: could not rename ${dir}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  return result;
}
```

- [ ] **Step 4: Wire it into server startup**

In `apps/board/src/server.ts`, add `importPeerReviewFiles` to the existing `./peer/peer-reviews.ts` import, and directly after the `getStateDb('server');` line:

```ts
if (!FIXTURE_DIR) {
  try {
    const peerImport = importPeerReviewFiles(getStateDb());
    if (peerImport.imported || peerImport.skipped || peerImport.renamed)
      console.error(
        `peer review import: imported=${peerImport.imported} skipped=${peerImport.skipped} renamed=${peerImport.renamed}`
      );
  } catch (err) {
    console.error(
      `peer review import failed: ${err instanceof Error ? err.message : err}`
    );
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd apps/board && bun test src/__tests__/peer-state.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/peer/peer-reviews.ts apps/board/src/server.ts apps/board/src/__tests__/peer-state.test.ts
git commit -m "board: import leftover peer review files into state.db once"
```

---

### Task 3: The asker's band says "no update" after 30 quiet minutes

**Files:**
- Modify: `apps/board/src/peer/nudges.ts` (`resolveSentNudge`, `SentNudgeDisplay`, `sentNudgeDisplay`, new `NUDGE_QUIET_MS`)
- Modify: `apps/board/src/client/types.ts` (`SentNudgeInfo.display`)
- Modify: `apps/board/src/client/board/format.ts` (`NUDGE_RETRYABLE`)
- Modify: `apps/board/src/client/board/ask-band.ts` (`no-update` case)
- Test: `apps/board/src/__tests__/peer-state.test.ts`, `apps/board/src/client/board/__tests__/ask-band.test.ts`

**Interfaces:**
- Produces: `NUDGE_QUIET_MS: number` (30 minutes); `SentNudgeDisplay` and `SentNudgeInfo['display']` include `'no-update'`.

- [ ] **Step 1: Write the failing store tests**

In `peer-state.test.ts`, import `NUDGE_QUIET_MS` from `../peer/nudges.ts`. In `describe('sentNudgeDisplay')`, the existing assertion that a `launched` resolution at `NUDGE_NO_RESPONSE_MS + 1` reads `'launched'` is now wrong; change its `now` to `6` (so it stays a fresh launch). Then add:

```ts
  test('a launched or confirmed ask quiet past NUDGE_QUIET_MS reads no-update', () => {
    const base: SentNudge = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'matt',
      sentAt: 0,
    };
    for (const result of ['launched', 'confirmed'] as const) {
      const n = { ...base, resolution: { result, at: 100 } };
      expect(sentNudgeDisplay(n, 100 + NUDGE_QUIET_MS)).toBe(result);
      expect(sentNudgeDisplay(n, 100 + NUDGE_QUIET_MS + 1)).toBe('no-update');
    }
  });

  test('an unanswered ask never reads no-update', () => {
    const base: SentNudge = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'matt',
      sentAt: 0,
    };
    expect(sentNudgeDisplay(base, NUDGE_QUIET_MS + 1)).toBe('requested');
  });

  test('finished, declined and expired asks never read no-update', () => {
    const base: SentNudge = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'matt',
      sentAt: 0,
    };
    for (const result of ['done', 'failed', 'rejected', 'expired'] as const)
      expect(
        sentNudgeDisplay({ ...base, resolution: { result, at: 0 } }, NUDGE_QUIET_MS * 10)
      ).toBe(result);
  });
```

In `describe('resolveSentNudge')`, add:

```ts
  test('a progress confirmation refreshes a launched ask', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    resolveSentNudge(URL_A, { result: 'confirmed', at: 50 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'confirmed',
      at: 50,
    });
  });

  test('a confirmation never replaces a declined or expired ask', () => {
    for (const result of ['rejected', 'expired'] as const) {
      writeSentNudge(
        { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
        db
      );
      resolveSentNudge(URL_A, { result, at: 10 }, db);
      resolveSentNudge(URL_A, { result: 'confirmed', at: 50 }, db);
      expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe(result);
    }
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/board && bun test src/__tests__/peer-state.test.ts`
Expected: FAIL (`NUDGE_QUIET_MS` missing; launched not refreshed).

- [ ] **Step 3: Implement in `peer/nudges.ts`**

In `resolveSentNudge`, replace

```ts
      if (prev.resolution && prev.resolution.result !== 'confirmed') return;
```

with

```ts
      const was = prev.resolution?.result;
      const refreshesLaunch = was === 'launched' && resolution.result === 'confirmed';
      if (was && was !== 'confirmed' && !refreshesLaunch) return;
```

and update its doc comment's last sentence to: "Only a `confirmed` resolution may be replaced, and a `launched` one only by a fresh `confirmed`, so progress keeps resetting the quiet clock."

Next to `NUDGE_NO_RESPONSE_MS` add:

```ts
/** A launched or confirmed ask with nothing heard for this long reads
    "no-update" on the row, without a write. */
export const NUDGE_QUIET_MS = 30 * 60_000;
```

Add `| 'no-update'` to `SentNudgeDisplay`, and replace `sentNudgeDisplay` with:

```ts
export function sentNudgeDisplay(n: SentNudge, now: number): SentNudgeDisplay {
  const r = n.resolution;
  if (r) {
    const running = r.result === 'launched' || r.result === 'confirmed';
    return running && now - r.at > NUDGE_QUIET_MS ? 'no-update' : r.result;
  }
  return now - n.sentAt > NUDGE_NO_RESPONSE_MS ? 'no-response' : 'requested';
}
```

Update its doc comment to mention the 30-minute rule alongside the 48-hour one.

- [ ] **Step 4: Run store tests to see them pass**

Run: `cd apps/board && bun test src/__tests__/peer-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing band test**

In `client/board/__tests__/ask-band.test.ts`, add next to the "no answer" test:

```ts
  test('no update: warn tone, hourglass, retry and dismiss, a quiet trail step', () => {
    const m = askBandModel(
      sent({ display: 'no-update', kind: 'review', resolvedAt: NOW - 40 * MIN })
    );
    expect(m).toMatchObject({
      tone: 'warn',
      icon: 'hourglass',
      label: 'no update',
      actions: ['retry', 'dismiss'],
    });
    expect(m.steps.map(s => s.name)).toEqual(['Requested', 'Started', 'No update']);
    expect(m.steps[2]?.detail).toBe("Grace's agent has been quiet for 30m");
  });
```

(`sent`, `NOW` and `MIN` are the file's existing helpers; the fixture's reviewer resolves to "Grace". If the file's default reviewer name differs, use that name in the expected detail.)

- [ ] **Step 6: Run to see it fail**

Run: `cd apps/board && bun test src/client/board/__tests__/ask-band.test.ts`
Expected: FAIL (type error or no `no-update` case).

- [ ] **Step 7: Implement the client side**

`client/types.ts`, in `SentNudgeInfo.display`, add `| 'no-update'` after `'launched'`.

`client/board/format.ts`, add `'no-update',` to `NUDGE_RETRYABLE` (the ask menu items come back, matching the band's Retry).

`client/board/ask-band.ts`, add before `case 'requested':`:

```ts
    case 'no-update':
      return band(
        {
          tone: 'warn',
          icon: 'hourglass',
          label: 'no update',
          actions: ['retry', 'dismiss'],
        },
        { name: 'Started', detail: `${name}'s agent`, at: sent.resolvedAt },
        { name: 'No update', detail: `${name}'s agent has been quiet for 30m` }
      );
```

- [ ] **Step 8: Run all board tests and typecheck**

Run: `cd apps/board && bun test src && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add apps/board/src/peer/nudges.ts apps/board/src/client/types.ts apps/board/src/client/board/format.ts apps/board/src/client/board/ask-band.ts apps/board/src/__tests__/peer-state.test.ts apps/board/src/client/board/__tests__/ask-band.test.ts
git commit -m "board: a quiet peer ask reads no update after 30 minutes"
```

---

### Task 4: A reason rides `review-state`, and a finished run beats "stopped"

**Files:**
- Modify: `apps/board/src/peer/envelope.ts` (`ReviewStatePayload`, `parseReviewStatePayload`)
- Modify: `apps/board/src/peer/inbox.ts` (pass `reason` on `error`)
- Modify: `apps/board/src/peer/nudges.ts` (`finishSentNudge`)
- Modify: `apps/board/src/client/board/ask-band.ts` (`failed` label)
- Test: `apps/board/src/__tests__/peer-envelope.test.ts`, `apps/board/src/__tests__/peer-inbox.test.ts`, `apps/board/src/__tests__/peer-state.test.ts`, `apps/board/src/client/board/__tests__/ask-band.test.ts`

**Interfaces:**
- Produces: `ReviewStatePayload.reason?: string` (Task 5 sends it).

- [ ] **Step 1: Write the failing tests**

`peer-envelope.test.ts`, inside `describe('payload parsers')`:

```ts
  test('review-state carries an optional string reason', () => {
    expect(
      parseReviewStatePayload({
        mrUrl: 'u',
        iid: 1,
        status: 'error',
        updatedAt: 5,
        reason: 'pane closed',
      })?.reason
    ).toBe('pane closed');
    expect(
      parseReviewStatePayload({
        mrUrl: 'u',
        iid: 1,
        status: 'error',
        updatedAt: 5,
        reason: 7,
      })
    ).toBeNull();
  });
```

`peer-inbox.test.ts`, inside `describe('ask echo')`:

```ts
    test('an error review-state passes its reason to finish', () => {
      const deps = fakeDeps();
      materializeEnvelope(
        envelope({
          payload: {
            mrUrl: URL_A,
            iid: 4821,
            status: 'error',
            updatedAt: 500,
            reason: 'pane closed',
            nudgeId: 'ask-1',
          },
        }),
        deps,
        1000
      );
      expect(deps.finishes[0]?.finish).toEqual({
        result: 'failed',
        reason: 'pane closed',
        at: 1000,
      });
    });

    test('a done review-state never carries a reason into finish', () => {
      const deps = fakeDeps();
      materializeEnvelope(
        envelope({
          payload: {
            mrUrl: URL_A,
            iid: 4821,
            status: 'done',
            updatedAt: 500,
            reason: 'ignored',
          },
        }),
        deps,
        1000
      );
      expect(deps.finishes[0]?.finish.reason).toBeUndefined();
    });
```

`peer-state.test.ts`, inside `describe('finishSentNudge')`:

```ts
  test('done replaces failed; rejected, expired and done stay final', () => {
    const send = () =>
      writeSentNudge(
        { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
        db
      );
    send();
    finishSentNudge(URL_A, { result: 'failed', reason: 'pane closed', at: 10 }, 5, db, 'n1');
    finishSentNudge(URL_A, { result: 'done', outcome: 'comment', at: 20 }, 5, db, 'n1');
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'done',
      outcome: 'comment',
      at: 20,
    });
    finishSentNudge(URL_A, { result: 'failed', at: 30 }, 5, db, 'n1');
    expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe('done');
    for (const result of ['rejected', 'expired'] as const) {
      send();
      resolveSentNudge(URL_A, { result, at: 10 }, db);
      finishSentNudge(URL_A, { result: 'done', at: 20 }, 5, db, 'n1');
      expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe(result);
    }
  });
```

`client/board/__tests__/ask-band.test.ts`: the existing failed test asserts `label: 'failed to run: boom'`; change it to `label: 'stopped: boom'` (a failed ask with a reason now only comes from a stopped run). Keep its `'failed to run'` assertion for the reason-less case.

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/board && bun test src/__tests__/peer-envelope.test.ts src/__tests__/peer-inbox.test.ts src/__tests__/peer-state.test.ts src/client/board/__tests__/ask-band.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

`peer/envelope.ts`, in `ReviewStatePayload` after `nudgeId`:

```ts
  /** On an `error`: why the run ended, in words the asker's band shows. */
  reason?: string;
```

In `parseReviewStatePayload`, destructure `reason` too, add `if (reason !== undefined && typeof reason !== 'string') return null;`, and include `reason: reason as string | undefined` in the returned object.

`peer/inbox.ts`, in the `review-state` branch's `finishSentNudge` call, change the finish object to:

```ts
        {
          result: p.status === 'done' ? 'done' : 'failed',
          ...(p.status === 'done' && p.outcome ? { outcome: p.outcome } : {}),
          ...(p.status === 'error' && p.reason ? { reason: p.reason } : {}),
          at: now,
        },
```

`peer/nudges.ts`, in `finishSentNudge`, replace

```ts
      if (r && r !== 'confirmed' && r !== 'launched') return;
```

with

```ts
      const doneAfterStop = r === 'failed' && finish.result === 'done';
      if (r && r !== 'confirmed' && r !== 'launched' && !doneAfterStop) return;
```

and update the doc comment sentence "Only an unresolved, confirmed or launched ask finishes" to "Only an unresolved, confirmed or launched ask finishes, and a failed one only to done (a reviewer who resumed a stopped run); a rejected, expired or done one keeps its first verdict."

`client/board/ask-band.ts`, in `case 'failed':`, change the label to:

```ts
          label: sent.reason ? `stopped: ${sent.reason}` : 'failed to run',
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd apps/board && bun test src && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/peer/envelope.ts apps/board/src/peer/inbox.ts apps/board/src/peer/nudges.ts apps/board/src/client/board/ask-band.ts apps/board/src/__tests__/peer-envelope.test.ts apps/board/src/__tests__/peer-inbox.test.ts apps/board/src/__tests__/peer-state.test.ts apps/board/src/client/board/__tests__/ask-band.test.ts
git commit -m "board: carry a stop reason on review-state and let done replace it"
```

---

### Task 5: The reviewer's board reports a closed review pane

**Files:**
- Create: `apps/board/src/peer/closed-pane.ts`
- Modify: `apps/board/src/server.ts` (new `reportClosedPeerReviews`, call from the writer sweep timer near line 4188, prune markers in the prune block near line 1429)
- Test: `apps/board/src/__tests__/peer-closed-pane.test.ts`

**Interfaces:**
- Consumes: `lanesClearedByExecutor(agentId, sessionId, reviews, responds)` from `../data.ts`; `askIdForRun(nudges, mrUrl, author, runStartedAt, emittedAt)` from `./ask-echo.ts`; `canonicalUsername` from `./envelope.ts`; `ReviewStatePayload` with Task 4's `reason`; `NudgeState` from `./nudges.ts`; kv helpers from `../state/kv-blob.ts`.
- Produces:
  - `CLOSED_REPORTED_NS = 'peer-closed-reported'`
  - `interface ClosedPaneLane { iid: number; status?: string; agentId?: string; sessionId?: string | null; runStartedAt?: number }`
  - `interface ClosedPaneReport { to: string; mrUrl: string; runStartedAt: number; payload: ReviewStatePayload }`
  - `closedPaneReports(input: { reviews: Map<string, ClosedPaneLane>; executors: ReadonlyArray<{ agentId: string; sessionId: string; state: string }>; authorOf: (mrUrl: string) => string | undefined; self: string; reported: Map<string, unknown>; nudges: readonly NudgeState[]; now: number }): ClosedPaneReport[]`
  - `pruneClosedPaneMarkers(keepUrls: ReadonlySet<string>, db?: Database): void`

- [ ] **Step 1: Write the failing tests**

Create `apps/board/src/__tests__/peer-closed-pane.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import {
  closedPaneReports,
  type ClosedPaneLane,
} from '../peer/closed-pane.ts';
import type { NudgeState } from '../peer/nudges.ts';

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/9';
const NOW = 10_000;

const gone = (agentId: string, sessionId = '') => ({
  agentId,
  sessionId,
  state: 'gone',
});

function input(over: Partial<Parameters<typeof closedPaneReports>[0]> = {}) {
  const reviews = new Map<string, ClosedPaneLane>([
    [URL_A, { iid: 4821, status: 'reviewing', agentId: 'ag-1', runStartedAt: 500 }],
  ]);
  const nudges: NudgeState[] = [
    { id: 'ask-1', mrUrl: URL_A, iid: 4821, from: 'kim', receivedAt: 400, materializedAt: 400, kind: 'review' },
  ];
  return {
    reviews,
    executors: [gone('ag-1')],
    authorOf: (u: string) => (u === URL_A ? 'kim' : u === URL_B ? 'pat' : undefined),
    self: 'pat',
    reported: new Map<string, unknown>(),
    nudges,
    now: NOW,
    ...over,
  };
}

describe('closedPaneReports', () => {
  test('a gone pane on a teammate MR reports pane closed with the ask id', () => {
    expect(closedPaneReports(input())).toEqual([
      {
        to: 'kim',
        mrUrl: URL_A,
        runStartedAt: 500,
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          status: 'error',
          reason: 'pane closed',
          updatedAt: NOW,
          nudgeId: 'ask-1',
        },
      },
    ]);
  });

  test('a queued lane is reported too', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [URL_A, { iid: 4821, status: 'queued', agentId: 'ag-1', runStartedAt: 500 }],
    ]);
    expect(closedPaneReports(input({ reviews })).length).toBe(1);
  });

  test('a lane matched by session id when it has no agent id', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [URL_A, { iid: 4821, status: 'reviewing', sessionId: 's-1', runStartedAt: 500 }],
    ]);
    expect(
      closedPaneReports(input({ reviews, executors: [gone('ag-x', 's-1')] })).length
    ).toBe(1);
  });

  test('my own MR is never reported', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [URL_B, { iid: 9, status: 'reviewing', agentId: 'ag-1', runStartedAt: 500 }],
    ]);
    expect(closedPaneReports(input({ reviews }))).toEqual([]);
  });

  test('an author whose name differs only in case is still me', () => {
    expect(closedPaneReports(input({ self: 'KIM' }))).toEqual([]);
  });

  test('an MR with no known author is skipped', () => {
    expect(closedPaneReports(input({ authorOf: () => undefined }))).toEqual([]);
  });

  test('a live or hidden executor is not reported', () => {
    for (const state of ['live', 'hidden'])
      expect(
        closedPaneReports(
          input({ executors: [{ agentId: 'ag-1', sessionId: '', state }] })
        )
      ).toEqual([]);
  });

  test('a finished lane is not reported', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [URL_A, { iid: 4821, status: 'done', agentId: 'ag-1', runStartedAt: 500 }],
    ]);
    expect(closedPaneReports(input({ reviews }))).toEqual([]);
  });

  test('the same run is reported once; a fresh run reports again', () => {
    expect(
      closedPaneReports(input({ reported: new Map([[URL_A, 500]]) }))
    ).toEqual([]);
    expect(
      closedPaneReports(input({ reported: new Map([[URL_A, 200]]) })).length
    ).toBe(1);
  });

  test('a run with no start time reports once under 0', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [URL_A, { iid: 4821, status: 'reviewing', agentId: 'ag-1' }],
    ]);
    const [report] = closedPaneReports(input({ reviews }));
    expect(report?.runStartedAt).toBe(0);
    expect(report?.payload.nudgeId).toBeUndefined();
    expect(
      closedPaneReports(input({ reviews, reported: new Map([[URL_A, 0]]) }))
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/board && bun test src/__tests__/peer-closed-pane.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `peer/closed-pane.ts`**

```ts
import type { Database } from 'bun:sqlite';

import { lanesClearedByExecutor } from '../data.ts';
import { getStateDb, persistOrWarn } from '../state/index.ts';
import { deleteKvValue, listKvValues } from '../state/kv-blob.ts';
import { askIdForRun } from './ask-echo.ts';
import { canonicalUsername, type ReviewStatePayload } from './envelope.ts';
import type { NudgeState } from './nudges.ts';

/** mrUrl -> the runStartedAt (0 when unknown) already reported closed, so
    each run is reported once however many sweeps see the gone pane. */
export const CLOSED_REPORTED_NS = 'peer-closed-reported';

export interface ClosedPaneLane {
  iid: number;
  status?: string;
  agentId?: string;
  sessionId?: string | null;
  runStartedAt?: number;
}

export interface ClosedPaneReport {
  to: string;
  mrUrl: string;
  runStartedAt: number;
  payload: ReviewStatePayload;
}

/** The review-state envelopes to send for review lanes whose pane is gone
    on a teammate's MR. The lane itself is left as is, so the reviewer can
    still resume it. */
export function closedPaneReports(input: {
  reviews: Map<string, ClosedPaneLane>;
  executors: ReadonlyArray<{ agentId: string; sessionId: string; state: string }>;
  authorOf: (mrUrl: string) => string | undefined;
  self: string;
  reported: Map<string, unknown>;
  nudges: readonly NudgeState[];
  now: number;
}): ClosedPaneReport[] {
  const me = canonicalUsername(input.self);
  const seen = new Set<string>();
  const out: ClosedPaneReport[] = [];
  for (const executor of input.executors) {
    if (executor.state !== 'gone') continue;
    const { reviews } = lanesClearedByExecutor(
      executor.agentId,
      executor.sessionId || undefined,
      input.reviews,
      new Map()
    );
    for (const mrUrl of reviews) {
      if (seen.has(mrUrl)) continue;
      seen.add(mrUrl);
      const lane = input.reviews.get(mrUrl)!;
      const author = input.authorOf(mrUrl);
      if (!author || canonicalUsername(author) === me) continue;
      const runStartedAt = lane.runStartedAt ?? 0;
      if (input.reported.get(mrUrl) === runStartedAt) continue;
      const nudgeId = askIdForRun(
        input.nudges,
        mrUrl,
        author,
        lane.runStartedAt,
        input.now
      );
      out.push({
        to: author,
        mrUrl,
        runStartedAt,
        payload: {
          mrUrl,
          iid: lane.iid,
          status: 'error',
          reason: 'pane closed',
          updatedAt: input.now,
          ...(nudgeId ? { nudgeId } : {}),
        },
      });
    }
  }
  return out;
}

export function pruneClosedPaneMarkers(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const stale = [...listKvValues(CLOSED_REPORTED_NS, db).keys()].filter(
    url => !keepUrls.has(url)
  );
  if (stale.length === 0) return;
  persistOrWarn('closed pane marker prune', () => {
    db.transaction(() => {
      for (const url of stale) deleteKvValue(CLOSED_REPORTED_NS, url, db);
    })();
  });
}
```

If `lanesClearedByExecutor` is not exported from `data.ts`, export it (it is today, at `data.ts:482`). If its `reviews` parameter type (`Map<string, ClearableLane>`) rejects `ClosedPaneLane`, the shapes match field for field, so pass `input.reviews` as is; do not widen `ClearableLane`.

- [ ] **Step 4: Run to see them pass**

Run: `cd apps/board && bun test src/__tests__/peer-closed-pane.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the sweep into `server.ts`**

Add imports: `closedPaneReports`, `pruneClosedPaneMarkers`, `CLOSED_REPORTED_NS` from `./peer/closed-pane.ts`; `listKvValues`, `setKvValue` from `./state/kv-blob.ts` (skip any already imported). Next to `handleAgentSignal`, add:

```ts
/** Tells the MR author's board when a review this board was running for
    them lost its pane, since a closed pane emits no agent signal. */
async function reportClosedPeerReviews(): Promise<void> {
  const pc = peering.current()?.client;
  if (!pc || config.defaultMember === 'all') return;
  const reviews = readReviewStates();
  const inFlight = [...reviews.values()].some(
    r => r.status === 'queued' || r.status === 'reviewing'
  );
  if (!inFlight) return;
  const [view, snapshot] = await Promise.all([
    fetchReconcilerView(),
    cache.get(),
  ]);
  const authors = new Map(
    snapshot.mrs.map(m => [m.webUrl, m.author.username] as const)
  );
  const reports = closedPaneReports({
    reviews,
    executors: view.executors,
    authorOf: url => authors.get(url),
    self: config.defaultMember,
    reported: listKvValues(CLOSED_REPORTED_NS),
    nudges: readNudges(),
    now: Date.now(),
  });
  for (const report of reports) {
    enqueueOutbox(makeEnvelope(report.to, 'review-state', report.payload));
    setKvValue(CLOSED_REPORTED_NS, report.mrUrl, report.runStartedAt);
  }
  if (reports.length) kickOutbox(pc);
}
```

In the writer's sweep `setInterval` (near line 4188), after the `runGateSweep` call:

```ts
    void reportClosedPeerReviews().catch(err =>
      console.error(
        `closed pane report failed: ${err instanceof Error ? err.message : err}`
      )
    );
```

In the healthy-snapshot prune block (near line 1429), after `prunePeerReviews(onBoard);`:

```ts
          pruneClosedPaneMarkers(onBoard);
```

Confirm `cache`, `makeEnvelope`, `kickOutbox`, `readNudges`, `readReviewStates` and `enqueueOutbox` are the names `handleAgentSignal` already uses; reuse them exactly.

- [ ] **Step 6: Run the whole board suite and typecheck**

Run: `cd apps/board && bun run test && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add apps/board/src/peer/closed-pane.ts apps/board/src/server.ts apps/board/src/__tests__/peer-closed-pane.test.ts
git commit -m "board: report a closed review pane to the asker's board"
```

---

### Task 6: Render every band state and check it by eye

**Files:**
- Create: `apps/board/src/client/board/AskBand.stories.tsx`

**Interfaces:**
- Consumes: `AskBand` from `./AskBand.tsx`, `BoardMRWithReview`, `RowContext`, `SentNudgeInfo` from `../types.ts`.

- [ ] **Step 1: Write the stories**

Model the stage on `ReviewGateSheet.stories.tsx` (same imports of tui-kit theme CSS, `../../style.css`, `SoribashiProvider`, `registerTheme`, and the `scheme` global decorator). One story renders all states stacked:

```tsx
const NOW = Date.now();
const MIN = 60_000;
const states: Array<[string, SentNudgeInfo]> = [
  ['requested', { display: 'requested', reviewer: 'leath1', reviewerName: 'Leath', kind: 'review', sentAt: NOW - 2 * MIN }],
  ['reviewing', { display: 'launched', reviewer: 'leath1', reviewerName: 'Leath', kind: 'review', sentAt: NOW - 5 * MIN, resolvedAt: NOW - 5 * MIN }],
  ['no update', { display: 'no-update', reviewer: 'leath1', reviewerName: 'Leath', kind: 'review', sentAt: NOW - 45 * MIN, resolvedAt: NOW - 45 * MIN }],
  ['stopped', { display: 'failed', reviewer: 'leath1', reviewerName: 'Leath', kind: 'review', reason: 'pane closed', sentAt: NOW - 20 * MIN, resolvedAt: NOW - 3 * MIN, finishedAt: NOW - 3 * MIN }],
  ['done', { display: 'done', reviewer: 'leath1', reviewerName: 'Leath', kind: 'review', outcome: 'comment', sentAt: NOW - 30 * MIN, resolvedAt: NOW - 2 * MIN, finishedAt: NOW - 2 * MIN }],
];
const ctx = { local: true, onAskRetry: () => {}, onAskDismiss: () => {} } as unknown as RowContext;

export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, padding: 24, maxWidth: 680 }}>
      {states.map(([label, sentNudge]) => (
        <AskBand key={label} mr={{ webUrl: `https://example.invalid/${label}`, sentNudge } as unknown as BoardMRWithReview} ctx={ctx} />
      ))}
    </div>
  ),
};
```

with `meta = { title: 'Board/AskBand', decorators: [stage], parameters: { layout: 'fullscreen' } }`. Use only invented names and example URLs.

- [ ] **Step 2: Run Storybook and check both schemes**

Run (from the repo root, in the background): `bun run storybook`
Then, with Fast Browser, open the `Board/AskBand` All States story at `http://localhost:6006`, screenshot it in light and in dark (the toolbar's scheme global). Check: the five bands read "review requested", "reviewing", "no update", "stopped: pane closed", "reviewed: comments"; Retry and Dismiss show on "no update" and "stopped"; Dismiss shows on "reviewing" and "done"; the hourglass and warn tone read clearly in both schemes. Say plainly what looks wrong; fix it before committing.

- [ ] **Step 3: Commit**

```bash
git add apps/board/src/client/board/AskBand.stories.tsx
git commit -m "board: storybook coverage for every ask band state"
```
