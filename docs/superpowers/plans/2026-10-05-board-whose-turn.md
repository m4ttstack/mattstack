# Board: whose turn, and a Show menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution order:** Tasks 1-8, then 10, then 9.

**Goal:** One configurable "whose turn" rule set (`board.turn`) drives a new
Show menu on the board's toolbar, a whose-turn summary line in the header,
and the Needs me tab.

**Architecture:** A browser-safe `src/turn.ts` holds the signal lists and two
predicates (`authorTurn`, `reviewerTurn`). The server resolves `board.turn`
on every `/data.json` and ships it. `needs-me.ts` maps the predicates onto
its existing `Need` values. `view.ts` replaces the Slack and drafts filters
with one `show` set and `filterByShow`. The header's toolbar becomes three
labeled menu buttons (Group, Sort, Showing N of M) plus an "Also show" line.

**Tech Stack:** Bun, TypeScript, React, `@mattstack/tui-kit` (ContextMenu,
LabeledSeg), `@mattstack/rt-client` settings registry (zod), bun:test,
Storybook.

**Spec:** `docs/superpowers/specs/2026-10-05-board-whose-turn-design.md`.
Design mock: `docs/apps/design/board/board.pen`, frame "Toolbar redesign ·
filters, group, sort", Option B (light and dark).

## Global Constraints

- `board.*` registry rows never carry `default:`. The fallback lives in the board reader.
- `board.turn` scopes are exactly `["team", "user"]`, `merge: "replace"`.
- An absent signal list means every signal. An explicit empty list means none.
- Author signals, in this order: `threads`, `changesRequested`, `conflicts`, `rebase`, `ciFailing`, `readyToMerge`.
- Reviewer signals, in this order: `assigned`, `approvalReset`, `repliedThreads`.
- Copy is positive: "Show on the board", "Showing N of M", "Also show", "show everything". Never "hide" in new UI copy.
- Show item labels, verbatim: `Posted to #<channel>`, `Not Posted`, `Waiting on author`, `My drafts`.
- Show item descriptions, verbatim: `announced for review`, `not posted to #<channel> yet`, `comments, red CI, conflicts, ready to merge`, `your own draft MRs`.
- Surfaces (header, MR panels, sidebar, selection bar, tabs) use `--card` like deck's services table; highlights on them are washes, never white.
- The theme control (`ThemeControl`) is unchanged. The header "copy summary for Slack" button is removed. The drawer keeps "post summary to slack".
- Storybook stories and test fixtures use invented data only (the repo is public). No real names, channels or MR numbers.
- Comments only state a constraint the code cannot show (repo clean-code rule).
- UI color and type follow `docs/apps/ui-authoring.md`; reuse existing `tui-*` classes and tokens.
- Browser checks go through `http://localhost:11006`, never `*.mattstack`.

## Review Focus

- An unassigned reviewer whose threads are all **resolved** (none replied) must NOT get a Needs me row. Only an answered thread (`replied > 0`) puts an unassigned reviewer on the hook. Pinned in Task 3.
- An old URL or stored state carrying `slack=posted` / `drafts=hide` must keep filtering the same rows after the upgrade. Pinned in Task 5.
- Slack disabled, or an "all" (seatless) board: the Slack items, or My drafts, are not offered, and a stored "off" for them must not hide rows behind a control that is not rendered. Pinned in Task 5.
- A malformed `board.turn` (a string, unknown signal names) must not break `/data.json`. It falls open to "every signal", and unknown names are dropped. Pinned in Task 2.
- Unchecking Not Posted must still trigger the out-of-band Slack refresh the old "posted only" toggle did, so stale Slack refs don't hide rows. Pinned in Task 7 (manual check step).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/rt-client/src/settings/registry-defs.ts` | `board.turn` registry row |
| `packages/rt-client/src/settings/registry-schemas.ts` | `board.turn` zod schema |
| `packages/rt-client/src/settings/__tests__/schema-examples.ts` | good/bad examples |
| `packages/rt-client/src/settings/schema.lock.json` | regenerated lock |
| `apps/board/src/turn.ts` (new) | signal lists, `resolveTurnConfig`, `authorTurn`, `reviewerTurn` (browser-safe) |
| `apps/board/src/turn-setting.ts` (new) | server-only fail-open read of `board.turn` |
| `apps/board/src/client/board/needs-me.ts` | maps turn predicates to `Need` |
| `apps/board/src/server.ts` | ships `turn` in `/data.json` |
| `apps/board/src/client/types.ts` | `BoardData.turn` |
| `apps/board/src/view.ts` | `ShowItem`, `ViewState.show`, `filterByShow`, parse/serialize |
| `apps/board/src/client/board/turn-summary.ts` (new) | header summary buckets |
| `apps/board/src/client/board/Controls.tsx` | Group/Sort/Show menu buttons, Show menu, drawer variant |
| `apps/board/src/client/board/AlsoShow.tsx` (new) | the "Also show" pill line |
| `apps/board/src/client/board/TurnSummary.tsx` (new) | the header summary line |
| `apps/board/src/client/board/Board.tsx` | wiring, removes hidden note, footer, copy button |
| `apps/board/src/client/board/config-shapes.ts`, `ConfigModal.tsx` | "Whose turn" editor |
| `apps/board/src/client/board/Toolbar.stories.tsx` (new) | stories |
| `apps/board/src/style.css` | styles for the new pieces; card surfaces and highlight washes (Task 10) |

---

### Task 1: Register the `board.turn` setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (board team block, after `board.tabs`)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (next to `"board.hiddenMembers"`)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts` (next to `"board.hiddenMembers"`)
- Regenerate: `packages/rt-client/src/settings/schema.lock.json`

**Interfaces:**
- Produces: setting key `board.turn` with value shape `{ author?: string[]; reviewer?: string[] }`, signal names validated by enum.

- [ ] **Step 1: Add the failing schema example**

In `schema-examples.ts`, after the `"board.hiddenMembers"` entry:

```ts
  "board.turn": {
    good: [
      {},
      { author: [] },
      { author: ["threads", "ciFailing"], reviewer: ["assigned", "repliedThreads"] },
    ],
    bad: [
      { value: { author: ["ci"] }, path: ["author", 0] },
      { value: { reviewer: "assigned" }, path: ["reviewer"] },
    ],
  },
```

- [ ] **Step 2: Run the example suite to see it fail**

Run: `cd packages/rt-client && bun test src/settings/__tests__`
Expected: FAIL, naming `board.turn` as having no schema / unknown key.

- [ ] **Step 3: Add the schema and the registry row**

`registry-schemas.ts`, after `"board.hiddenMembers"`:

```ts
  "board.turn": z.looseObject({
    author: z.array(z.enum(["threads", "changesRequested", "conflicts", "rebase", "ciFailing", "readyToMerge"])).optional(),
    reviewer: z.array(z.enum(["assigned", "approvalReset", "repliedThreads"])).optional(),
  }),
```

`registry-defs.ts`, after the `board.tabs` row (team block):

```ts
  {
    key: "board.turn",
    type: "object",
    scopes: ["team", "user"],
    merge: "replace",
    description: "What makes an open MR someone's turn. author: blockers that make it the author's move (the board's 'Waiting on author' Show item, Needs me respond/fix/merge). reviewer: what puts it in a reviewer's Needs me queue. An absent list means every signal (fallback lives in the board reader).",
  },
```

- [ ] **Step 4: Regenerate the lock, rebuild, run tests**

Run:
```bash
bun run cli.ts settings schema lock
cd packages/rt-client && bun run build && bun test src/settings
```
Expected: lock gains a `board.turn` entry; all settings tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/settings
git commit -m "settings: register board.turn"
```

---

### Task 2: `src/turn.ts` — signals and predicates

**Files:**
- Create: `apps/board/src/turn.ts`
- Test: `apps/board/src/__tests__/turn.test.ts`

**Interfaces:**
- Produces:
  - `AUTHOR_SIGNALS: readonly AuthorSignal[]`, `REVIEWER_SIGNALS: readonly ReviewerSignal[]`
  - `type AuthorSignal = 'threads' | 'changesRequested' | 'conflicts' | 'rebase' | 'ciFailing' | 'readyToMerge'`
  - `type ReviewerSignal = 'assigned' | 'approvalReset' | 'repliedThreads'`
  - `interface TurnConfig { author: AuthorSignal[]; reviewer: ReviewerSignal[] }`
  - `ALL_TURN: TurnConfig`
  - `resolveTurnConfig(raw: unknown): TurnConfig`
  - `authorTurn(mr: BoardMR, cfg: TurnConfig): AuthorSignal | null`
  - `reviewerTurn(mr: BoardMR, self: string, cfg: TurnConfig): ReviewerSignal | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'bun:test';

import type { BoardMR } from '../data.ts';
import {
  ALL_TURN,
  authorTurn,
  resolveTurnConfig,
  reviewerTurn,
  type TurnConfig,
} from '../turn.ts';

type Over = Record<string, unknown>;
const NO_BLOCKERS = {
  any: false,
  isDraft: false,
  hasConflicts: false,
  needsRebase: false,
  pipelineFailing: false,
  pipelineRunning: false,
  awaitingApprovals: false,
  hasUnresolvedDiscussions: false,
  hasMergeError: false,
  mergeError: null,
};
function mr(over: Over = {}): BoardMR {
  return {
    iid: 7,
    title: 'ACME-12 Tidy the widget',
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/7',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 1, given: 0, reviewers: [] },
    blockers: { ...NO_BLOCKERS },
    threadSummary: { awaiting: 0, replied: 0, resolved: 0 },
    myThreads: { awaiting: 0, replied: 0, resolved: 0 },
    ...over,
  } as unknown as BoardMR;
}
const blocked = (b: Over) => mr({ blockers: { ...NO_BLOCKERS, any: true, ...b } });
const only = (author: TurnConfig['author']): TurnConfig => ({ ...ALL_TURN, author });

describe('resolveTurnConfig', () => {
  test('absent or malformed means every signal', () => {
    expect(resolveTurnConfig(undefined)).toEqual(ALL_TURN);
    expect(resolveTurnConfig('nope')).toEqual(ALL_TURN);
    expect(resolveTurnConfig({ author: 'threads' })).toEqual(ALL_TURN);
  });
  test('an explicit empty list means none', () => {
    expect(resolveTurnConfig({ author: [] }).author).toEqual([]);
    expect(resolveTurnConfig({ author: [] }).reviewer).toEqual(ALL_TURN.reviewer);
  });
  test('unknown names are dropped, order follows the canonical list', () => {
    expect(resolveTurnConfig({ author: ['ciFailing', 'bogus', 'threads'] }).author)
      .toEqual(['threads', 'ciFailing']);
  });
});

describe('authorTurn', () => {
  test('each signal fires on its own', () => {
    expect(authorTurn(mr({ threadSummary: { awaiting: 1, replied: 0, resolved: 0 } }), ALL_TURN)).toBe('threads');
    expect(authorTurn(blocked({ hasConflicts: true }), ALL_TURN)).toBe('conflicts');
    expect(authorTurn(blocked({ needsRebase: true }), ALL_TURN)).toBe('rebase');
    expect(authorTurn(blocked({ pipelineFailing: true }), ALL_TURN)).toBe('ciFailing');
    expect(authorTurn(mr({ reviews: { isApproved: true, required: 1, given: 1, reviewers: [] } }), ALL_TURN)).toBe('readyToMerge');
  });
  test('changes requested by a reviewer', () => {
    const m = mr({
      reviews: {
        isApproved: false, required: 1, given: 0,
        reviewers: [{ username: 'sam', name: 'Sam', reviewState: 'REQUESTED_CHANGES' }],
      },
    });
    expect(authorTurn(m, ALL_TURN)).toBe('changesRequested');
  });
  test('a signal switched off does not fire', () => {
    expect(authorTurn(blocked({ pipelineFailing: true }), only(['threads']))).toBeNull();
  });
  test('a running pipeline and an untouched MR are nobody\'s turn', () => {
    expect(authorTurn(blocked({ pipelineRunning: true }), ALL_TURN)).toBeNull();
    expect(authorTurn(mr(), ALL_TURN)).toBeNull();
  });
  test('approved but still blocked is not ready to merge', () => {
    const m = mr({
      reviews: { isApproved: true, required: 1, given: 1, reviewers: [] },
      blockers: { ...NO_BLOCKERS, any: true, pipelineRunning: true },
    });
    expect(authorTurn(m, ALL_TURN)).toBeNull();
  });
});

describe('reviewerTurn', () => {
  const asReviewer = (reviewState: string, over: Over = {}) =>
    mr({
      reviews: {
        isApproved: false, required: 1, given: 0,
        reviewers: [{ username: 'me', name: 'Me', reviewState }],
      },
      ...over,
    });
  test('assigned and not finished', () => {
    expect(reviewerTurn(asReviewer('UNREVIEWED'), 'me', ALL_TURN)).toBe('assigned');
    expect(reviewerTurn(asReviewer('REVIEW_STARTED'), 'me', ALL_TURN)).toBe('assigned');
  });
  test('approval reset by a push', () => {
    expect(reviewerTurn(asReviewer('UNAPPROVED'), 'me', ALL_TURN)).toBe('approvalReset');
  });
  test('already approved is never my turn', () => {
    expect(reviewerTurn(asReviewer('APPROVED', { myThreads: { awaiting: 0, replied: 2, resolved: 0 } }), 'me', ALL_TURN)).toBeNull();
  });
  test('my thread still awaiting the author is the author\'s turn', () => {
    expect(reviewerTurn(asReviewer('REVIEWED', { myThreads: { awaiting: 1, replied: 1, resolved: 0 } }), 'me', ALL_TURN)).toBeNull();
  });
  test('assigned: replied or resolved threads mean re-review', () => {
    expect(reviewerTurn(asReviewer('REVIEWED', { myThreads: { awaiting: 0, replied: 0, resolved: 2 } }), 'me', ALL_TURN)).toBe('repliedThreads');
  });
  test('unassigned: an answered thread is my turn', () => {
    expect(reviewerTurn(mr({ myThreads: { awaiting: 0, replied: 1, resolved: 3 } }), 'me', ALL_TURN)).toBe('repliedThreads');
  });
  test('unassigned: only resolved threads are not my turn', () => {
    expect(reviewerTurn(mr({ myThreads: { awaiting: 0, replied: 0, resolved: 3 } }), 'me', ALL_TURN)).toBeNull();
  });
  test('signals switched off', () => {
    const cfg: TurnConfig = { ...ALL_TURN, reviewer: [] };
    expect(reviewerTurn(asReviewer('UNREVIEWED'), 'me', cfg)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/board && bun test src/__tests__/turn.test.ts`
Expected: FAIL, cannot resolve `../turn.ts`.

- [ ] **Step 3: Implement `src/turn.ts`**

```ts
import { hasChangesRequested, type BoardMR } from './data.ts';

export const AUTHOR_SIGNALS = [
  'threads',
  'changesRequested',
  'conflicts',
  'rebase',
  'ciFailing',
  'readyToMerge',
] as const;
export type AuthorSignal = (typeof AUTHOR_SIGNALS)[number];

export const REVIEWER_SIGNALS = [
  'assigned',
  'approvalReset',
  'repliedThreads',
] as const;
export type ReviewerSignal = (typeof REVIEWER_SIGNALS)[number];

export interface TurnConfig {
  author: AuthorSignal[];
  reviewer: ReviewerSignal[];
}

export const ALL_TURN: TurnConfig = {
  author: [...AUTHOR_SIGNALS],
  reviewer: [...REVIEWER_SIGNALS],
};

function pick<T extends string>(v: unknown, all: readonly T[]): T[] {
  if (!Array.isArray(v)) return [...all];
  return all.filter(s => v.includes(s));
}

/** board.turn as stored; anything malformed falls open to every signal so a
    bad team write can never empty the board. */
export function resolveTurnConfig(raw: unknown): TurnConfig {
  const r =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    author: pick(r.author, AUTHOR_SIGNALS),
    reviewer: pick(r.reviewer, REVIEWER_SIGNALS),
  };
}

export function authorTurn(mr: BoardMR, cfg: TurnConfig): AuthorSignal | null {
  const on = (s: AuthorSignal) => cfg.author.includes(s);
  const b = mr.blockers;
  if (on('threads') && (mr.threadSummary?.awaiting ?? 0) > 0) return 'threads';
  if (on('changesRequested') && hasChangesRequested(mr)) return 'changesRequested';
  if (on('conflicts') && b.hasConflicts) return 'conflicts';
  if (on('rebase') && b.needsRebase) return 'rebase';
  if (on('ciFailing') && b.pipelineFailing) return 'ciFailing';
  if (on('readyToMerge') && mr.reviews.isApproved && !b.any) return 'readyToMerge';
  return null;
}

/** A reset approval outranks my own awaiting thread: GitLab dropped the
    approval, so the reviewer owes a look regardless. An unassigned reviewer
    is only on the hook once the author has answered (replied), not for
    threads that were simply resolved. */
export function reviewerTurn(
  mr: BoardMR,
  self: string,
  cfg: TurnConfig
): ReviewerSignal | null {
  const on = (s: ReviewerSignal) => cfg.reviewer.includes(s);
  const me = mr.reviews.reviewers.find(r => r.username === self);
  const state = me?.reviewState;
  if (state === 'APPROVED') return null;
  if (state === 'UNAPPROVED') return on('approvalReset') ? 'approvalReset' : null;
  const mine = mr.myThreads;
  if (mine && mine.awaiting > 0) return null;
  const answered = me
    ? (mine?.replied ?? 0) + (mine?.resolved ?? 0) > 0
    : (mine?.replied ?? 0) > 0;
  if (on('repliedThreads') && answered) return 'repliedThreads';
  if (on('assigned') && (state === 'UNREVIEWED' || state === 'REVIEW_STARTED'))
    return 'assigned';
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/board && bun test src/__tests__/turn.test.ts`
Expected: PASS. If `hasChangesRequested` reads a field the fixture lacks, add that field to the `changesRequested` fixture (read `hasChangesRequested` in `src/data.ts:367` for the exact field) rather than changing `turn.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/turn.ts apps/board/src/__tests__/turn.test.ts
git commit -m "board: turn signals and predicates"
```

---

### Task 3: Needs me uses the turn predicates

**Files:**
- Modify: `apps/board/src/client/board/needs-me.ts:61-108`
- Test: `apps/board/src/client/board/__tests__/needs-me.test.ts`

**Interfaces:**
- Consumes: `authorTurn`, `reviewerTurn`, `ALL_TURN`, `TurnConfig` from `../../turn.ts`
- Produces: `needOf(mr, self, now, resolved, cfg: TurnConfig = ALL_TURN): Need | null` (new trailing param, default keeps every existing call site working)

- [ ] **Step 1: Add the failing tests** (append to `needs-me.test.ts`; it already has `mr`, `reviewing`, `need`, `NOW`, `NONE`, `ME`)

```ts
import { ALL_TURN, type TurnConfig } from '../../../turn.ts';

describe('needOf: driven by board.turn', () => {
  test('unassigned reviewer whose thread the author answered: re-review', () => {
    expect(need(mr({ myThreads: { awaiting: 0, replied: 1, resolved: 2 } }))).toBe('re-review');
  });
  test('unassigned reviewer with only resolved threads: nothing', () => {
    expect(need(mr({ myThreads: { awaiting: 0, replied: 0, resolved: 2 } }))).toBeNull();
  });
  test('ciFailing switched off: my red-CI MR is not a fix', () => {
    const cfg: TurnConfig = { ...ALL_TURN, author: ALL_TURN.author.filter(s => s !== 'ciFailing') };
    const m = own({ blockers: { any: true, pipelineFailing: true } });
    expect(needOf(m, ME, NOW, NONE)).toBe('fix');
    expect(needOf(m, ME, NOW, NONE, cfg)).toBeNull();
  });
  test('assigned switched off: an unstarted review is not mine', () => {
    const cfg: TurnConfig = { ...ALL_TURN, reviewer: [] };
    expect(needOf(reviewing('UNREVIEWED'), ME, NOW, NONE, cfg)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd apps/board && bun test src/client/board/__tests__/needs-me.test.ts`
Expected: the first and last two new tests FAIL (unassigned replied returns null; `cfg` is ignored).

- [ ] **Step 3: Replace `authorNeed`, `reviewerNeed` and `needOf`**

Replace the import of `hasChangesRequested` with the turn import, and replace lines 61-108 with:

```ts
import {
  ALL_TURN,
  authorTurn,
  reviewerTurn,
  type AuthorSignal,
  type ReviewerSignal,
  type TurnConfig,
} from '../../turn.ts';

const AUTHOR_NEED: Record<AuthorSignal, Need> = {
  threads: 'respond',
  changesRequested: 'respond',
  conflicts: 'fix',
  rebase: 'fix',
  ciFailing: 'fix',
  readyToMerge: 'merge',
};

const REVIEWER_NEED: Record<ReviewerSignal, Need> = {
  assigned: 'review',
  approvalReset: 're-review',
  repliedThreads: 're-review',
};

export function needOf(
  mr: BoardMRWithReview,
  self: string,
  now: number,
  resolved: Resolved,
  cfg: TurnConfig = ALL_TURN
): Need | null {
  // A merge in flight spins like an agent's run, but it is the seat's own
  // move: the row keeps its place in the merge group until it leaves.
  if (mr.mergeButton.loading && mr.author.username === self) return 'merge';
  const fromLine = lineNeed(mr, now, resolved, self);
  if (fromLine === 'busy') return null;
  if (fromLine) return fromLine;
  if (mr.author.username === self) {
    const s = authorTurn(mr, cfg);
    return s && AUTHOR_NEED[s];
  }
  const s = reviewerTurn(mr, self, cfg);
  return s && REVIEWER_NEED[s];
}
```

Delete the now-unused `authorNeed` and `reviewerNeed` functions and the `hasChangesRequested` import.

- [ ] **Step 4: Run the whole needs-me suite**

Run: `cd apps/board && bun test src/client/board/__tests__/needs-me.test.ts`
Expected: PASS, including every pre-existing test (the defaults reproduce today's behaviour except the unassigned-replied case).

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/needs-me.ts apps/board/src/client/board/__tests__/needs-me.test.ts
git commit -m "board: Needs me reads board.turn; unassigned replied threads count"
```

---

### Task 4: Ship the resolved config in `/data.json`

**Files:**
- Create: `apps/board/src/turn-setting.ts`
- Test: `apps/board/src/__tests__/turn-setting.test.ts`
- Modify: `apps/board/src/server.ts:1543` (the `/data.json` body, next to `staleAfterDays`)
- Modify: `apps/board/src/client/types.ts:231` (`BoardData`)

**Interfaces:**
- Consumes: `resolveTurnConfig`, `TurnConfig` from `./turn.ts`
- Produces: `readTurnConfig(resolve?: typeof getSetting): TurnConfig`; `BoardData.turn: TurnConfig` (absent from an older server, so clients read `data.turn ?? ALL_TURN`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import { ALL_TURN } from '../turn.ts';
import { readTurnConfig } from '../turn-setting.ts';

const resolver = (value: unknown) =>
  ((key: string) => {
    if (key !== 'board.turn') throw new Error(`unexpected ${key}`);
    return { value };
  }) as never;

describe('readTurnConfig', () => {
  test('unset resolves to every signal', () => {
    expect(readTurnConfig(resolver(undefined))).toEqual(ALL_TURN);
  });
  test('a stored value is resolved', () => {
    expect(readTurnConfig(resolver({ author: ['threads'] })).author).toEqual(['threads']);
  });
  test('a resolver that throws (unregistered key on an old pin) falls open', () => {
    const throwing = (() => { throw new Error('unknown key'); }) as never;
    expect(readTurnConfig(throwing)).toEqual(ALL_TURN);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/board && bun test src/__tests__/turn-setting.test.ts`
Expected: FAIL, cannot resolve `../turn-setting.ts`.

- [ ] **Step 3: Implement `src/turn-setting.ts`**

```ts
import { getSetting } from '@mattstack/rt-client';

import { ALL_TURN, resolveTurnConfig, type TurnConfig } from './turn.ts';

/** Read per request, never cached: a `rt settings set` from the shell must
    land on the next poll without a board restart. */
export function readTurnConfig(
  resolve: typeof getSetting = getSetting
): TurnConfig {
  try {
    return resolveTurnConfig(resolve<unknown>('board.turn').value);
  } catch (err) {
    console.warn('board: board.turn unavailable, using every signal', err);
    return ALL_TURN;
  }
}
```

- [ ] **Step 4: Wire it**

`server.ts`: import `readTurnConfig` from `./turn-setting.ts` and add `turn: readTurnConfig(),` directly after `staleAfterDays: config.staleAfterDays,` in the `/data.json` response.

`client/types.ts`, inside `BoardData` after `staleAfterDays`:

```ts
  /** Resolved board.turn. Absent from an older server: read it as
      `data.turn ?? ALL_TURN`. */
  turn?: TurnConfig;
```

with `import type { TurnConfig } from '../turn.ts';` at the top.

`Board.tsx`: in `boardView`, pass the config into `need`:

```ts
    const turnCfg = data.turn ?? ALL_TURN;
    const need = (mr: BoardMRWithReview) =>
      self === null ? null : needOf(mr, self, now, draftResolved, turnCfg);
```

(import `ALL_TURN` from `../../turn.ts`).

- [ ] **Step 5: Run tests and typecheck**

Run: `cd apps/board && bun test src/__tests__/turn-setting.test.ts && bunx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/turn-setting.ts apps/board/src/__tests__/turn-setting.test.ts apps/board/src/server.ts apps/board/src/client/types.ts apps/board/src/client/board/Board.tsx
git commit -m "board: ship resolved board.turn in /data.json"
```

---

### Task 5: The Show model in `view.ts`

**Files:**
- Modify: `apps/board/src/view.ts` (types at :12-24, filters at :430-447, `ViewState`/`DEFAULT_VIEW` at :730-746, `parseViewState` at :753, `serializeViewState` at :852)
- Test: `apps/board/src/__tests__/view.test.ts` (replace the `filterBySlack` and `filterByDraft` describes at :85-118; extend `parseViewState` :1106 and `serializeViewState` :1208)

**Interfaces:**
- Consumes: `authorTurn`, `TurnConfig` from `./turn.ts`
- Produces:
  - `type ShowItem = 'posted' | 'notPosted' | 'authorTurn' | 'myDrafts'`
  - `SHOW_ITEMS: readonly ShowItem[]` (in that order)
  - `ViewState.off: ShowItem[]` (replaces `slack` and `drafts`; empty = everything shown)
  - `filterByShow<T extends BoardMR>(mrs: T[], off: readonly ShowItem[], offered: readonly ShowItem[], cfg: TurnConfig): { rows: T[]; counts: Record<ShowItem, number> }`
  - `matchesShowItem(mr: BoardMR, item: ShowItem, cfg: TurnConfig): boolean`
  - Removes: `SlackFilter`, `DraftFilter`, `SLACK_FILTER_KEYS`, `DRAFT_FILTER_KEYS`, `filterBySlack`, `filterByDraft`

- [ ] **Step 1: Write the failing tests** (replace the two old describes; reuse the file's `mr()` helper)

```ts
import { ALL_TURN } from '../turn.ts';

describe('filterByShow', () => {
  const posted = mr({ iid: 1, slack: { status: 'found', reactions: [], posted: true } } as any);
  const notPosted = mr({ iid: 2, slack: { status: 'found', reactions: [], posted: false } } as any);
  const unresolved = mr({ iid: 3 });
  const draft = mr({ iid: 4, isDraft: true, slack: { status: 'found', reactions: [], posted: true } } as any);
  const authorsTurn = mr({
    iid: 5,
    slack: { status: 'found', reactions: [], posted: true },
    threadSummary: { awaiting: 2, replied: 0, resolved: 0 },
  } as any);
  const list = [posted, notPosted, unresolved, draft, authorsTurn];
  const ALL = ['posted', 'notPosted', 'authorTurn', 'myDrafts'] as const;

  test('nothing off shows everything, and counts cover every row', () => {
    const r = filterByShow(list, [], ALL, ALL_TURN);
    expect(r.rows).toHaveLength(5);
    expect(r.counts).toEqual({ posted: 3, notPosted: 2, authorTurn: 1, myDrafts: 1 });
  });
  test('Not Posted off keeps only posted rows (old slack=posted)', () => {
    expect(filterByShow(list, ['notPosted'], ALL, ALL_TURN).rows.map(m => m.iid)).toEqual([1, 4, 5]);
  });
  test('a row is dropped when any item that matches it is off', () => {
    expect(filterByShow(list, ['authorTurn'], ALL, ALL_TURN).rows.map(m => m.iid)).toEqual([1, 2, 3, 4]);
    expect(filterByShow(list, ['myDrafts', 'notPosted'], ALL, ALL_TURN).rows.map(m => m.iid)).toEqual([1, 5]);
  });
  test('an item that is not offered never filters, even if stored off', () => {
    const offered = ['authorTurn', 'myDrafts'] as const;
    expect(filterByShow(list, ['notPosted'], offered, ALL_TURN).rows).toHaveLength(5);
  });
  test('waiting on author follows the turn config', () => {
    const cfg = { ...ALL_TURN, author: [] };
    expect(filterByShow(list, ['authorTurn'], ALL, cfg).rows).toHaveLength(5);
  });
});
```

Add to the `parseViewState` describe:

```ts
  test('off: url wins, unknown items dropped', () => {
    expect(parseViewState('?off=notPosted,bogus', null, []).off).toEqual(['notPosted']);
  });
  test('legacy slack=posted and drafts=hide map onto off', () => {
    expect(parseViewState('?slack=posted&drafts=hide', null, []).off).toEqual(['notPosted', 'myDrafts']);
    expect(parseViewState('', { slack: 'posted' } as any, []).off).toEqual(['notPosted']);
  });
  test('an explicit off param outranks legacy keys', () => {
    expect(parseViewState('?off=authorTurn&slack=posted', null, []).off).toEqual(['authorTurn']);
  });
```

Add to the `serializeViewState` describe:

```ts
  test('off serializes in canonical order and drops when empty', () => {
    expect(serializeViewState({ ...DEFAULT_VIEW, off: ['myDrafts', 'notPosted'] })).toBe('?off=notPosted%2CmyDrafts');
    expect(serializeViewState(DEFAULT_VIEW)).toBe('');
  });
```

Delete any remaining assertions in `view.test.ts` that reference `slack:` / `drafts:` on `ViewState` and replace them with the `off` equivalents.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/view.test.ts`
Expected: FAIL, `filterByShow` is not exported.

- [ ] **Step 3: Implement**

In `view.ts`, replace the `SlackFilter`/`DraftFilter` types and key arrays with:

```ts
export type ShowItem = 'posted' | 'notPosted' | 'authorTurn' | 'myDrafts';
export const SHOW_ITEMS: readonly ShowItem[] = [
  'posted',
  'notPosted',
  'authorTurn',
  'myDrafts',
];
```

Replace `filterBySlack` and `filterByDraft` with:

```ts
export function matchesShowItem(
  mr: BoardMR,
  item: ShowItem,
  cfg: TurnConfig
): boolean {
  switch (item) {
    case 'posted':
      return !!mr.slack?.posted;
    case 'notPosted':
      return !mr.slack?.posted;
    case 'authorTurn':
      return authorTurn(mr, cfg) !== null;
    case 'myDrafts':
      return !!mr.isDraft;
  }
}

/** `offered` is what the toolbar renders on this board: a stored "off" for
    an item that isn't offered (Slack disabled, seatless board) must not hide
    rows behind a control nobody can see. */
export function filterByShow<T extends BoardMR>(
  mrs: T[],
  off: readonly ShowItem[],
  offered: readonly ShowItem[],
  cfg: TurnConfig
): { rows: T[]; counts: Record<ShowItem, number> } {
  const counts: Record<ShowItem, number> = {
    posted: 0,
    notPosted: 0,
    authorTurn: 0,
    myDrafts: 0,
  };
  const active = off.filter(i => offered.includes(i));
  const rows = mrs.filter(mr => {
    let shown = true;
    for (const item of SHOW_ITEMS) {
      if (!matchesShowItem(mr, item, cfg)) continue;
      counts[item]++;
      if (active.includes(item)) shown = false;
    }
    return shown;
  });
  return { rows, counts };
}
```

Add `import { authorTurn, type TurnConfig } from './turn.ts';`.

`ViewState` / `DEFAULT_VIEW`: replace `slack` and `drafts` with `off: ShowItem[]` and `off: []`.

`parseViewState`: change the `stored` parameter type to `(Partial<ViewState> & { slack?: unknown; drafts?: unknown }) | null`, and replace the `slack`/`drafts` lines with `off: resolveOff(params, stored),` plus this helper above the function:

```ts
function resolveOff(
  params: URLSearchParams,
  stored: (Partial<ViewState> & { slack?: unknown; drafts?: unknown }) | null
): ShowItem[] {
  const canon = (items: readonly unknown[]) =>
    SHOW_ITEMS.filter(i => items.includes(i));
  const fromUrl = params.get('off');
  if (fromUrl !== null) return canon(fromUrl.split(','));
  const legacyUrl = params.has('slack') || params.has('drafts');
  if (!legacyUrl && Array.isArray(stored?.off)) return canon(stored.off);
  const slack = params.get('slack') ?? stored?.slack;
  const drafts = params.get('drafts') ?? stored?.drafts;
  const off: ShowItem[] = [];
  if (slack === 'posted') off.push('notPosted');
  if (drafts === 'hide') off.push('myDrafts');
  return off;
}
```

`serializeViewState`: replace the `slack`/`drafts` lines with:

```ts
  const off = SHOW_ITEMS.filter(i => v.off.includes(i));
  if (off.length > 0) params.set('off', off.join(','));
```

- [ ] **Step 4: Run tests**

Run: `cd apps/board && bun test src/__tests__/view.test.ts`
Expected: PASS. `Board.tsx` will not typecheck until Task 7; that is expected.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/view.ts apps/board/src/__tests__/view.test.ts
git commit -m "board: Show items replace the slack and drafts filters in view state"
```

---

### Task 6: Turn summary buckets

**Files:**
- Create: `apps/board/src/client/board/turn-summary.ts`
- Test: `apps/board/src/client/board/__tests__/turn-summary.test.ts`

**Interfaces:**
- Consumes: `authorTurn`, `TurnConfig` from `../../turn.ts`
- Produces:
  - `type TurnBucket = 'needYou' | 'waitingOnAuthor' | 'readyToMerge' | 'needReviewer'`
  - `turnSummary<T extends BoardMR>(rows: T[], cfg: TurnConfig, needsMe: ((mr: T) => boolean) | null): Record<TurnBucket, number>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import type { BoardMR } from '../../../data.ts';
import { ALL_TURN } from '../../../turn.ts';
import { turnSummary } from '../turn-summary.ts';

const base = {
  author: { username: 'pat' },
  reviews: { isApproved: false, required: 1, given: 0, reviewers: [] },
  blockers: { any: false },
  threadSummary: { awaiting: 0, replied: 0, resolved: 0 },
};
const mr = (iid: number, over: Record<string, unknown> = {}) =>
  ({ ...base, iid, ...over }) as unknown as BoardMR;

describe('turnSummary', () => {
  const rows = [
    mr(1),
    mr(2, { threadSummary: { awaiting: 1, replied: 0, resolved: 0 } }),
    mr(3, { reviews: { ...base.reviews, isApproved: true } }),
    mr(4),
  ];
  test('every row lands in exactly one bucket', () => {
    const s = turnSummary(rows, ALL_TURN, m => m.iid === 4);
    expect(s).toEqual({ needYou: 1, waitingOnAuthor: 1, readyToMerge: 1, needReviewer: 1 });
  });
  test('need you wins over an author signal', () => {
    const s = turnSummary(rows, ALL_TURN, m => m.iid === 2);
    expect(s.needYou).toBe(1);
    expect(s.waitingOnAuthor).toBe(0);
  });
  test('a seatless board has no need-you bucket', () => {
    expect(turnSummary(rows, ALL_TURN, null).needYou).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/turn-summary.test.ts`
Expected: FAIL, cannot resolve `../turn-summary.ts`.

- [ ] **Step 3: Implement**

```ts
import type { BoardMR } from '../../data.ts';
import { authorTurn, type TurnConfig } from '../../turn.ts';

export type TurnBucket =
  | 'needYou'
  | 'waitingOnAuthor'
  | 'readyToMerge'
  | 'needReviewer';

/** First matching bucket wins, in this order, so the four counts add up to
    the row count. */
export function turnSummary<T extends BoardMR>(
  rows: T[],
  cfg: TurnConfig,
  needsMe: ((mr: T) => boolean) | null
): Record<TurnBucket, number> {
  const out: Record<TurnBucket, number> = {
    needYou: 0,
    waitingOnAuthor: 0,
    readyToMerge: 0,
    needReviewer: 0,
  };
  for (const mr of rows) {
    if (needsMe?.(mr)) {
      out.needYou++;
      continue;
    }
    const s = authorTurn(mr, cfg);
    if (s === 'readyToMerge') out.readyToMerge++;
    else if (s) out.waitingOnAuthor++;
    else out.needReviewer++;
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/board && bun test src/client/board/__tests__/turn-summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/turn-summary.ts apps/board/src/client/board/__tests__/turn-summary.test.ts
git commit -m "board: whose-turn summary buckets"
```

---

### Task 7: The toolbar, Show menu, Also show line and summary line

**Files:**
- Modify: `apps/board/src/client/board/Controls.tsx` (whole `Controls` component; `ThemeControl` untouched)
- Create: `apps/board/src/client/board/AlsoShow.tsx`
- Create: `apps/board/src/client/board/TurnSummary.tsx`
- Modify: `apps/board/src/client/board/Board.tsx` (:160-220 copy helpers, :925-1010 `boardView`, :1160-1176, :1280-1335 control props, :1360-1390 header, :1480-1522 empty state, hidden note, footer)
- Modify: `apps/board/src/style.css`
- Create: `apps/board/src/client/board/Toolbar.stories.tsx`

**Interfaces:**
- Consumes: `ShowItem`, `SHOW_ITEMS`, `filterByShow` (Task 5); `turnSummary`, `TurnBucket` (Task 6); `ALL_TURN` (Task 2)
- Produces: `Controls` props `show: ShowMenuModel | null` replacing `slackFilter`, `draftFilter`, `canCopy`, `summaryText`, where

```ts
export interface ShowMenuModel {
  offered: readonly ShowItem[];
  off: readonly ShowItem[];
  counts: Record<ShowItem, number>;
  channel: string | null;
  shown: number;
  total: number;
  toggle: (item: ShowItem) => void;
}
```

- [ ] **Step 1: Shared copy for the Show items**

At the top of `Controls.tsx`:

```ts
export function showLabel(item: ShowItem, channel: string | null): string {
  switch (item) {
    case 'posted':
      return `Posted to #${channel}`;
    case 'notPosted':
      return 'Not Posted';
    case 'authorTurn':
      return 'Waiting on author';
    case 'myDrafts':
      return 'My drafts';
  }
}

export function showDescription(item: ShowItem, channel: string | null): string {
  switch (item) {
    case 'posted':
      return 'announced for review';
    case 'notPosted':
      return `not posted to #${channel} yet`;
    case 'authorTurn':
      return 'comments, red CI, conflicts, ready to merge';
    case 'myDrafts':
      return 'your own draft MRs';
  }
}
```

- [ ] **Step 2: A labeled menu button**

In `Controls.tsx`, a small `MenuButton` that opens a tui-kit `ContextMenu` under itself, reusing the anchor logic `ThemeControl` already uses:

```tsx
function MenuButton({
  icon,
  label,
  value,
  ariaLabel,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  ariaLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setAt(null);
    triggerRef.current?.focus();
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="tui-menu-button"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-controls={at ? menuId : undefined}
        data-open={at ? true : undefined}
        onMouseDown={e => {
          if (at) e.nativeEvent.stopImmediatePropagation();
        }}
        onClick={e => {
          if (at) return setAt(null);
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <span className="tui-menu-button-icon">{icon}</span>
        <span className="tui-menu-button-label">{label}</span>
        <span className="tui-menu-button-value">{value}</span>
        <span className="tui-menu-button-chevron">{ICONS.chevronDown}</span>
      </button>
      {at && (
        <ContextMenu id={menuId} x={at.x} y={at.y} ariaLabel={ariaLabel} onClose={close}>
          {children(close)}
        </ContextMenu>
      )}
    </>
  );
}
```

If `ICONS` has no `chevronDown`, use the `Icon` component with the chevron path the kit's `ContextMenu.Sub` already renders (search `packages/tui-kit/src` for `CHEVRON`), and do not add a new icon set.

- [ ] **Step 3: Group, Sort and Show menus in the header**

Replace the header (non-`stacked`) return in `Controls` with:

```tsx
  return (
    <>
      <button
        className={`tui-copy tui-refresh${refreshing ? ' spinning' : ''}`}
        onClick={onRefresh}
        disabled={refreshing}
        title="refresh now"
        aria-label="refresh now"
      >
        {ICONS.refresh}
      </button>
      <MenuButton icon={ICONS.layers} label="Group" value={GROUP_LABEL[state.group]} ariaLabel="group by">
        {close =>
          groupKeys.map(k => (
            <ContextMenu.Item
              key={k}
              role="menuitemradio"
              aria-checked={state.group === k}
              label={GROUP_LABEL[k]}
              trailing={state.group === k ? <Icon d={CHECK_ICON} /> : null}
              onClick={() => {
                update({ group: k });
                close();
              }}
            />
          ))
        }
      </MenuButton>
      <MenuButton icon={ICONS.sort} label="Sort" value={SORT_LABEL[state.sort]} ariaLabel="sort by">
        {close =>
          SORT_KEYS.map(k => (
            <ContextMenu.Item
              key={k}
              role="menuitemradio"
              aria-checked={state.sort === k}
              label={SORT_LABEL[k]}
              trailing={state.sort === k ? <Icon d={CHECK_ICON} /> : null}
              onClick={() => {
                update({ sort: k });
                close();
              }}
            />
          ))
        }
      </MenuButton>
      {show && (
        <MenuButton
          icon={ICONS.eye}
          label="Showing"
          value={`${show.shown} of ${show.total}`}
          ariaLabel="show on the board"
        >
          {() => <ShowMenuItems show={show} />}
        </MenuButton>
      )}
    </>
  );
```

and the menu body:

```tsx
function ShowMenuItems({ show }: { show: ShowMenuModel }) {
  return (
    <>
      <ContextMenu.Label>Show on the board</ContextMenu.Label>
      {show.offered.map(item => {
        const on = !show.off.includes(item);
        return (
          <ContextMenu.Item
            key={item}
            role="menuitemcheckbox"
            aria-checked={on}
            label={
              <span className="tui-show-item">
                <span className="tui-show-check" data-on={on || undefined}>
                  {on && <Icon d={CHECK_ICON} />}
                </span>
                <span className="tui-show-text">
                  <span className="tui-show-label">{showLabel(item, show.channel)}</span>
                  <span className="tui-show-desc">{showDescription(item, show.channel)}</span>
                </span>
              </span>
            }
            trailing={<span className="tui-show-count">{show.counts[item]}</span>}
            onClick={() => show.toggle(item)}
          />
        );
      })}
      <ContextMenu.Separator />
      <ContextMenu.Item
        label="What counts as “waiting on author”…"
        onClick={() => window.dispatchEvent(new CustomEvent('board:open-config', { detail: 'board.turn' }))}
      />
    </>
  );
}
```

For the footer item, use whatever the board already uses to open the settings modal (search `Board.tsx` for `openConfig`). Pass an `onOpenTurnSettings` prop into `Controls` and call it, rather than a window event, if `openConfig` is reachable. Use the window event only if it is not.

If `ICONS.layers`, `ICONS.sort` or `ICONS.eye` don't exist in tui-kit's `ICONS`, use the closest existing glyph from `ICONS` (list it with `rg -n "export const ICONS" -A40 packages/tui-kit/src`). Do not add icons to tui-kit in this task.

- [ ] **Step 4: Drawer (stacked) variant**

In the `stacked` branch, keep the group/sort `LabeledSeg` rows, theme row and refresh. Replace the two filter buttons and the `CopyButton` with a "show" block:

```tsx
        {show && (
          <div className="tui-ctl-row tui-ctl-show">
            <span className="tui-ctl-label">show</span>
            {show.offered.map(item => {
              const on = !show.off.includes(item);
              return (
                <button
                  key={item}
                  className="tui-drawer-action"
                  role="checkbox"
                  aria-checked={on}
                  data-active={on || undefined}
                  onClick={() => show.toggle(item)}
                >
                  {on ? '✓' : '+'} {showLabel(item, show.channel)} · {show.counts[item]}
                </button>
              );
            })}
          </div>
        )}
```

Keep the drawer's "post summary to slack" button. Remove `canCopy`, `summaryText`, `slackFilter` and `draftFilter` from the props type, and the unused imports (`CopyButton`, `SlackPostedMark`, `FlagGlyph` if now unused).

- [ ] **Step 5: `AlsoShow.tsx`**

```tsx
import type { ShowItem } from '../../view.ts';
import { showLabel, type ShowMenuModel } from './Controls.tsx';

export function AlsoShow({ show }: { show: ShowMenuModel }) {
  const missing = show.offered.filter(
    i => show.off.includes(i) && show.counts[i] > 0
  );
  if (missing.length === 0) return null;
  return (
    <div className="tui-also-show">
      <span className="tui-also-show-lead">Also show:</span>
      {missing.map((item: ShowItem) => (
        <button key={item} className="tui-also-show-pill" onClick={() => show.toggle(item)}>
          + {showLabel(item, show.channel)}{' '}
          <span className="tui-show-count">{show.counts[item]}</span>
        </button>
      ))}
      <button className="tui-config-link" onClick={() => missing.forEach(show.toggle)}>
        show everything
      </button>
    </div>
  );
}
```

`show everything` must re-check every unchecked item, including ones with a zero count. Implement it with `show.off.filter(i => show.offered.includes(i)).forEach(show.toggle)` instead of `missing.forEach`, and note why in a comment only if it isn't obvious from the line.

- [ ] **Step 6: `TurnSummary.tsx`**

```tsx
import type { TurnBucket } from './turn-summary.ts';

const ORDER: { key: TurnBucket; label: string; tone: string }[] = [
  { key: 'needYou', label: 'need you', tone: 'accent' },
  { key: 'needReviewer', label: 'need a reviewer', tone: 'warn' },
  { key: 'waitingOnAuthor', label: 'waiting on author', tone: 'dim' },
  { key: 'readyToMerge', label: 'ready to merge', tone: 'ok' },
];

export function TurnSummary({
  counts,
  synced,
  onNeedsMe,
}: {
  counts: Record<TurnBucket, number>;
  synced: { text: string; stale: boolean };
  onNeedsMe: (() => void) | null;
}) {
  const parts = ORDER.filter(o => counts[o.key] > 0);
  return (
    <p className="tui-sub tui-turn-summary">
      {parts.length === 0 && <span>nothing open</span>}
      {parts.map(o => (
        <span key={o.key} className="tui-turn-part" data-tone={o.tone}>
          <span className="tui-turn-dot" />
          <b>{counts[o.key]}</b>{' '}
          {o.key === 'needYou' && onNeedsMe ? (
            <button className="tui-config-link" onClick={onNeedsMe}>{o.label}</button>
          ) : (
            o.label
          )}
        </span>
      ))}
      <span className="tui-turn-synced" data-stale={synced.stale || undefined}>
        · {synced.text.replace(/^data as of /, 'synced ')}
      </span>
    </p>
  );
}
```

The summary's visual order is need you → need a reviewer → waiting on author → ready to merge, matching the mock. The *bucketing* order in `turnSummary` stays as Task 6 defines it.

- [ ] **Step 7: Wire `Board.tsx`**

In `boardView`, replace the slack/draft block (:965-979) with:

```ts
    const turnCfg = data.turn ?? ALL_TURN;
    const offered: ShowItem[] = [
      ...(data.slackEnabled ? (['posted', 'notPosted'] as const) : []),
      ...(isSeatTab ? [] : (['authorTurn'] as const)),
      ...(data.defaultMember !== 'all' ? (['myDrafts'] as const) : []),
    ];
    const memberFiltered = filterByMember(tabFiltered, state.member);
    const { rows: filtered, counts: showCounts } = filterByShow(
      memberFiltered,
      state.off,
      offered,
      turnCfg
    );
    const summary = turnSummary(
      memberFiltered,
      turnCfg,
      self === null ? null : mr => need(mr) !== null
    );
```

and return `offered`, `showCounts`, `memberFiltered`, `summary`, `turnCfg` instead of `slackFilter`, `slackHidden`, `draftFilter`, `draftsHidden`.

Delete `emptyQueueCopy`, `slackHiddenCopy`, `draftsHiddenCopy`, `hiddenRowsNote`, the `hiddenNote` const, the `<p className="tui-hidden-note">` block and the `<footer>` block. Replace the empty-state text with:

```tsx
          <p className="tui-empty">
            {state.off.some(i => offered.includes(i))
              ? 'nothing to show with these picks'
              : 'nothing waiting on review ✓'}
          </p>
```

Replace `toggleSlackFilter` / `toggleDraftFilter` with one toggle that keeps the Slack refresh:

```ts
  // Refs go stale between sweeps, so taking Not Posted off re-checks Slack
  // (forced sweep, server-side); newly found rows land on the reload.
  const toggleShow = (item: ShowItem) => {
    const turningOff = !state.off.includes(item);
    update({
      off: turningOff
        ? [...state.off, item]
        : state.off.filter(i => i !== item),
    });
    if (!(turningOff && item === 'notPosted' && data.local)) return;
    const toast = startToast('refreshing slack status…');
    postAction('/slack/refresh', {}).then(result => {
      if (!result.ok)
        return toast.fail(`slack refresh failed (${result.status})`);
      toast.done('slack status refreshed');
      load();
    });
  };
```

In `controlProps`, drop `canCopy`, `summaryText`, `slackFilter`, `draftFilter`, and add:

```ts
    show:
      offered.length > 0
        ? {
            offered,
            off: state.off,
            counts: showCounts,
            channel: activeTab.slackChannel ?? data.slackChannel ?? null,
            shown: filtered.length,
            total: memberFiltered.length,
            toggle: toggleShow,
          }
        : null,
```

For `channel`: the board-wide default lives in config `slack.channel`. If `/data.json` doesn't already carry it, read it from any row's resolved `slackChannel` (`filtered[0]?.slackChannel`) rather than adding a server field. Check `BoardData` for an existing channel field first.

Keep `summaryText` only if `onPostSummary` still uses it (the drawer's post button). Otherwise delete it.

Header: replace the `<p className="tui-sub">…pick one, it opens in gitlab…</p>` with:

```tsx
            <TurnSummary
              counts={summary}
              synced={dataAge}
              onNeedsMe={self === null ? null : () => update({ tab: NEEDS_ME_TAB.id })}
            />
```

Directly after the header's controls `div`, inside `<header>`, render `{controlProps.show && <AlsoShow show={controlProps.show} />}` so it sits under the menu buttons.

- [ ] **Step 8: Styles**

Append to `apps/board/src/style.css`, using the existing tokens (read `docs/apps/ui-authoring.md` for names; the ones below are the board's own):

```css
.tui-menu-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  background: var(--card);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.tui-menu-button[data-open] { border-color: var(--accent); background: var(--hover); }
.tui-menu-button-label { color: var(--muted); }
.tui-menu-button-value { font-weight: 600; }
.tui-menu-button-icon, .tui-menu-button-chevron { color: var(--dim); display: inline-flex; }
.tui-show-item { display: flex; gap: 9px; align-items: flex-start; }
.tui-show-check {
  width: 15px; height: 15px; border-radius: 4px;
  border: 1px solid var(--border); background: var(--card);
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
}
.tui-show-check[data-on] { background: var(--accent); border-color: var(--accent); }
.tui-show-text { display: flex; flex-direction: column; gap: 2px; }
.tui-show-desc { color: var(--dim); font-size: 11px; }
.tui-show-count { color: var(--dim); font-family: var(--font-mono); font-size: 11px; }
.tui-also-show { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; }
.tui-also-show-lead { color: var(--dim); }
.tui-also-show-pill {
  border: 1px solid var(--border); border-radius: 12px; padding: 3px 9px 3px 6px;
  background: transparent; color: var(--accent-text); font: inherit; font-weight: 500; cursor: pointer;
}
.tui-turn-summary { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.tui-turn-part { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }
.tui-turn-part b { color: var(--fg); }
.tui-turn-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dim); }
.tui-turn-part[data-tone='accent'] .tui-turn-dot { background: var(--accent); }
.tui-turn-part[data-tone='warn'] .tui-turn-dot { background: var(--dot-warn); }
.tui-turn-part[data-tone='ok'] .tui-turn-dot { background: var(--dot-ok); }
.tui-turn-synced { color: var(--dim); font-size: 12px; }
.tui-turn-synced[data-stale] { color: var(--dot-warn); }
```

If any `var(--…)` above doesn't exist in `style.css`, use the name `style.css` actually defines for that role. Grep `:root` in the stylesheet before writing. Remove now-dead rules for `.tui-hidden-note`, `.tui-slack-filter`, `.tui-draft-filter` and `.tui-footer*` only if nothing else references them (grep first).

- [ ] **Step 9: Typecheck and run the board suite**

Run: `cd apps/board && bunx tsc --noEmit -p . && bun test`
Expected: no type errors; all tests PASS. Fix any test that asserted the removed footer, hidden note or filter buttons by pointing it at the new elements.

- [ ] **Step 10: Stories**

`Toolbar.stories.tsx`, with invented data only: four stories. (1) header with everything shown. (2) Not Posted and Waiting on author off, so the Also show line renders. (3) the Show menu open (render `ShowMenuItems` inside a static `ContextMenu` at a fixed x/y). (4) the turn summary with a zero bucket omitted and a stale sync. Follow the setup of an existing story file in the same folder (for example `AskBand.stories.tsx`) for decorators and theme.

Run: `cd apps/board && bun run storybook` (or the repo's story build script per `package.json`), and confirm the four stories render.

- [ ] **Step 11: Manual Slack refresh check (Review Focus)**

With the board running, open `http://localhost:11006`, uncheck **Not Posted**, and confirm a "refreshing slack status…" toast appears and resolves. Checking it again must not refresh.

- [ ] **Step 12: Commit**

```bash
git add apps/board/src/client apps/board/src/style.css
git commit -m "board: Group, Sort and Show menus, Also show line, whose-turn summary"
```

---

### Task 8: "Whose turn" editor in the settings modal

**Files:**
- Modify: `apps/board/src/client/board/config-shapes.ts:55-112`
- Modify: `apps/board/src/client/board/ConfigModal.tsx` (`SettingRow`, next to the `kind === 'tabs'` branch at :1080)
- Test: `apps/board/src/client/board/__tests__/config-shapes.test.ts` (create if absent; else append)

**Interfaces:**
- Consumes: `AUTHOR_SIGNALS`, `REVIEWER_SIGNALS`, `resolveTurnConfig` from `../../turn.ts`; `useRowSave(store, def).save(value)`
- Produces: `CompositeShape` gains `{ kind: 'turn' }`; `rowKind` returns `'turn'` for `board.turn`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from 'bun:test';

import { matchesShape, rowKind, shapeOf } from '../config-shapes.ts';

const def = { key: 'board.turn', type: 'object', schema: {}, writable: true, secret: false } as never;

describe('board.turn row', () => {
  test('gets the board-owned turn editor', () => {
    expect(shapeOf(def)).toEqual({ kind: 'turn' });
    expect(rowKind(def)).toBe('turn');
  });
  test('any object value matches; arrays and strings do not', () => {
    expect(matchesShape({ kind: 'turn' }, {})).toBe(true);
    expect(matchesShape({ kind: 'turn' }, { author: ['threads'] })).toBe(true);
    expect(matchesShape({ kind: 'turn' }, 'threads')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/config-shapes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the shape**

In `config-shapes.ts`: add `| { kind: 'turn' }` to `CompositeShape`. Add `'board.turn': { kind: 'turn' },` to `BOARD_EDITORS`. In `rowKind`, add `if (shape?.kind === 'turn') return 'turn';` next to the tabs line. In `matchesShape`, add:

```ts
  if (shape.kind === 'turn')
    return typeof value === 'object' && value !== null && !Array.isArray(value);
```

- [ ] **Step 4: The control**

In `ConfigModal.tsx`, add:

```tsx
const AUTHOR_LABEL: Record<AuthorSignal, string> = {
  threads: 'unanswered comments',
  changesRequested: 'changes requested',
  conflicts: 'merge conflicts',
  rebase: 'needs a rebase',
  ciFailing: 'CI failing',
  readyToMerge: 'approved, ready to merge',
};
const REVIEWER_LABEL: Record<ReviewerSignal, string> = {
  assigned: "assigned and haven't finished",
  approvalReset: 'a push reset my approval',
  repliedThreads: 'the author answered my comment',
};

function TurnControl({
  value,
  busy,
  onSave,
}: {
  value: unknown;
  busy: boolean;
  onSave: (next: TurnConfig) => void;
}) {
  const cfg = resolveTurnConfig(value);
  const flip = <K extends 'author' | 'reviewer'>(side: K, s: TurnConfig[K][number]) => {
    const list = cfg[side] as string[];
    const next = list.includes(s) ? list.filter(x => x !== s) : [...list, s];
    onSave({ ...cfg, [side]: next });
  };
  const group = <K extends 'author' | 'reviewer'>(
    side: K,
    title: string,
    all: readonly TurnConfig[K][number][],
    labels: Record<string, string>
  ) => (
    <fieldset className="tui-config-turn" disabled={busy}>
      <legend>{title}</legend>
      {all.map(s => (
        <label key={s}>
          <input type="checkbox" checked={(cfg[side] as string[]).includes(s)} onChange={() => flip(side, s)} />{' '}
          {labels[s]}
        </label>
      ))}
    </fieldset>
  );
  return (
    <div className="tui-config-control">
      {group('author', "Author's turn when", AUTHOR_SIGNALS, AUTHOR_LABEL)}
      {group('reviewer', 'My turn as a reviewer when', REVIEWER_SIGNALS, REVIEWER_LABEL)}
    </div>
  );
}
```

In `SettingRow`, next to the `kind === 'tabs'` branch:

```tsx
  } else if (kind === 'turn' && !malformed) {
    control = <TurnControl value={value} busy={row.busy} onSave={next => void row.save(next)} />;
```

`useRowSave` writes to `targetScope(def)`: the scope the effective value already lives in, else the first registry scope (`team`). So a person with a user override edits their own override, and everyone else edits the team value.

Add minimal CSS for `.tui-config-turn` (stacked labels, 4px gap) next to the other `.tui-config-*` rules.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd apps/board && bun test src/client/board/__tests__/config-shapes.test.ts && bunx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Wire the Show menu footer**

Make the Show menu's "What counts as “waiting on author”…" item (Task 7, Step 3) open the settings modal scrolled to the `board.turn` row, using the same mechanism the modal uses to open a row (`openConfig` in `Board.tsx`; pass the key if it accepts one, otherwise just open the modal).

- [ ] **Step 7: Commit**

```bash
git add apps/board/src/client apps/board/src/style.css
git commit -m "board: Whose turn editor in settings"
```

---

### Task 10: Lighter surfaces, matching deck (run before Task 9)

Board surfaces move from the grey `--chrome` to `--card`, the surface deck's
services table uses (`apps/deck/core/board/board.css:274-291`). Any highlight
that was "paint it `--card`" becomes a colored wash, because white on white
disappears.

**Files:**
- Modify: `apps/board/src/style.css`

**Interfaces:**
- Consumes: kit tokens `--card`, `--text-muted-on-card`, `--border-on-card`, `--border-soft-on-card`, `--surface-wash-fg-5`, `--surface-wash-fg-4-card`, `--surface-wash-accent-14`, `--fill-accent` (all in `packages/tui-kit/src/generated/theme.css`)
- Produces: no API; visual only

- [ ] **Step 1: Swap the four surfaces and set on-card inks**

Change `background: var(--chrome)` to `background: var(--card)` at the header (`style.css:56`), the MR group panels (`[data-part='panel']`, :65), the sidebar (:1499), and in the selection bar's mix (:240, `color-mix(in srgb, var(--card) 94%, transparent)`). Then add, once, a rule giving those containers deck's on-card inks:

```css
.tui-header,
[data-part='panel'],
.tui-selbar,
.tui-sidebar {
  --muted: var(--text-muted-on-card);
  --border: var(--border-on-card);
  --border-soft: var(--border-soft-on-card);
}
```

Use the real selectors at those four line numbers (read them first), not the guesses above, if they differ.

- [ ] **Step 2: Tabs**

At `.tui-tab` (:3373): idle `background: var(--card)`. Hover: `background: var(--surface-wash-fg-4-card)`. Active keeps today's rule, accent underline plus `--text-1` and no lighter fill, per the comment above `.tui-tab:hover`.

- [ ] **Step 3: Highlight audit**

List every highlight that paints `var(--card)`:

Run: `rg -n "background: var\(--card\)" apps/board/src/style.css`

For each hit, read its selector and decide:
- **Highlight on one of the five surfaces above** (`:hover`, `.active`, `[data-active]`, `[aria-selected]`, `[aria-checked]`, a selected row): hover becomes `var(--surface-wash-fg-5)`; active or selected becomes `var(--surface-wash-accent-14)` with `border-color: var(--fill-accent)`. The sidebar's `.tui-side-item:hover` (:1555) and `.tui-side-item.active` (:1558) are known cases.
- **Floating layer** (menu, modal, popover, toast, drawer, tooltip, sheet): leave as `--card`.
- **A card nested in a surface on purpose** (an inset callout): change to `var(--surface-wash-fg-4-card)` so it still reads as a separate box.
- **A control on a surface** (inputs and buttons, e.g. the selection bar's header input and its copy / actions / clear buttons): keep the fill, and make sure its border uses `--border-on-card` (or `--border-control-on-card` where the kit offers it) so the edge stays visible on white. Include the selection bar with a live selection in Step 4's screenshots.

Then widen the audit past `var(--card)`: every control drawn inside one of the five surfaces was tuned for a grey ground. Run `rg -n "var\(--(panel|surface-overlay|surface-raised|chrome)\)|background: (#fff|white)" apps/board/src/style.css` and check each hit that sits inside a surface (`.tui-copy`, `.tui-drawer-action`, inputs, segmented controls, chips, pills, count badges, the selection bar's controls). A fill of `--panel` or `--surface-overlay` is `#f9f9fb` in light mode, which is invisible on white. Give such controls `--surface-wash-fg-4-card` or rely on an on-card border, whichever the kit's own controls do (match `packages/tui-kit` Button/Input on a card).

Also re-check `--ask-base` (:4727), which mixes `--card` with `--chrome`. Change `var(--chrome)` there to `var(--surface-wash-fg-5)` only if the ask band no longer stands out against its row in Step 4. Otherwise leave it.

Write the classification as a short list in the commit message body (selector → decision).

- [ ] **Step 4: Look at it**

On `http://localhost:11006` through the `fast-browser:browser-driver` agent, in light and then dark: hover and select a sidebar member, hover a tab and switch tabs, hover an MR row, select two rows (selection bar), open a row menu and the Show menu, and open the comments drawer. Take a screenshot of each state. Every highlight must be visible against its surface, and no text may read washed out. Name anything that looks wrong and fix it before moving on.

Then run a contrast sweep in the same session, as one `browser_run_code_unsafe` script per scheme. For every `button`, `input`, `select`, `[role=tab]` and `[role=checkbox]` inside `.tui-header`, the sidebar, `[data-part='panel']`, the selection bar and `.tui-tabs`:
- find the nearest ancestor with a non-transparent background (the surface);
- compute the WCAG contrast of the control's background against the surface, of its border color against the surface, and of its text color against its own background (or the surface if transparent);
- return only the failures: text below 4.5:1 (3:1 at 18px+ or 14px bold), or a control whose background *and* border are both below 1.3:1 against the surface (an invisible control).

Expected: an empty failure list in both light and dark. Fix every failure, re-run until it's empty, and paste the final (empty) result into the task report.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/style.css
git commit -m "board: card surfaces like deck; highlights become washes"
```

Task 9's baseline refresh runs after this task, so the baselines are regenerated once.

---

### Task 9: Visual verification and baselines

**Files:**
- Modify: `apps/board/tests/baselines/*` (regenerated)

- [ ] **Step 1: Run the board from the worktree**

Run the board dev server the way `apps/board/AGENTS.md` describes, so `http://localhost:11006` serves this worktree's build.

- [ ] **Step 2: Fast Browser check, both schemes**

Through the `fast-browser:browser-driver` agent, on `http://localhost:11006`:
- Light, then dark: the header shows the turn summary, the three menu buttons, and the theme icon unchanged.
- Open each menu: Group and Sort show a check on the current pick; Show lists only the items offered on this board, with counts.
- Uncheck Not Posted and Waiting on author: the "Showing N of M" value drops, and Also show lists both pills. Clicking a pill brings its rows back. "show everything" restores all.
- Needs me tab: the Show menu has no Waiting on author item.
- Narrow the window to phone width: the drawer shows the show block, and nothing overflows horizontally.

Take a screenshot of each scheme, compare it against the `board.pen` Option B mock, and write down anything that looks wrong.

- [ ] **Step 3: Baselines**

The toolbar change is intentional, so:

```bash
cd apps/board && bun run capture:baseline && bun run capture:compare
```

Expected: compare passes against the new baselines. Spot-check the regenerated baseline images before committing.

- [ ] **Step 4: Commit**

```bash
git add apps/board/tests/baselines
git commit -m "board: refresh visual baselines for the new toolbar"
```
