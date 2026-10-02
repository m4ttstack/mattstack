# Board Row Menu Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten the board's own-MR right-click menu to about 8 top-level rows by moving rare actions into flyouts, without any action becoming unreachable.

**Architecture:** `rowActions()` (pure data) assigns every action one of six sections and marks state-blocked rows with the existing `blocked` reason instead of omitting them. `ActionMenu` renders `top` and `agent` inline and the other four sections as flyouts, built on two new tui-kit `ContextMenu` parts (`Sub`, `Row`). The bulk menu keeps today's flat rendering. A baseline test pins every action key today's code offers, so nothing can silently disappear.

**Tech Stack:** React 19, Bun test + happy-dom (board), Vitest browser tier + Playwright (tui-kit), soribashi `defineCompound` (kit recipes), glance (MR view model).

**Spec:** `docs/superpowers/specs/2026-10-01-board-row-menu-redesign-design.md` (BOARD-51). Read it before starting; its "Placement of every action" table is the source of truth for every section and blocked reason below.

## Global Constraints

- Sections are exactly `'top' | 'agent' | 'sessions' | 'gitlab' | 'slack' | 'more'`.
- Role gates (`env.local`, own vs teammate, seat, `env.slackEnabled`) omit a row; MR and lane state blocks it with `blocked: '<reason>'`.
- Blocked reasons are lowercase, short, and exactly the strings in the spec table.
- The review and respond lanes each render exactly one primary row in `agent`.
- No em dashes or en dashes in code, comments, copy or commit messages.
- Comments only for constraints the code cannot show (no narration, no ticket ids in code).
- Run board tests from `apps/board` (`bun test`), never from the repo root (bunfig preload).
- After touching `packages/glance/src`, run `bun run build` in `packages/glance` (consumers read its `dist/`).
- The tui-kit browser tests need `bun run browsers` once per machine.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A reaction toggled in the reaction row must keep the menu open and flip mark/unmark, as today (`keepOpen`, `RowMenu`'s live reactions). Pinned in Task 6.
2. Escape with a flyout open closes only the flyout; a second Escape closes the menu. Pinned in Task 3.
3. A blocked row must never run, by click or by bulk: the bulk menu must not count a blocked row as a target. Pinned in Tasks 5 and 6.
4. A remote board must not offer `stand-down` or `dismiss-*` (their routes 403), and must show the local hint instead of an empty agent section. Pinned in Task 5.
5. A flyout opened near the right edge of the window must stay on screen. Pinned in Task 3.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/board/src/client/board/__tests__/menu-states.ts` | create | The table of MR states every menu test walks |
| `apps/board/src/client/board/__tests__/menu-key-baseline.test.ts` | create | Today's keys per state; fails if any goes missing |
| `packages/glance/src/MRDashboard.ts` | modify | `mergeBlockedReason()` |
| `packages/glance/src/index.ts` | modify | export it |
| `packages/glance/tests/merge-blocked-reason.test.ts` | create | its tests |
| `packages/tui-kit/src/recipes/ContextMenu/ContextMenu.tsx` | modify | `Sub` and `Row` parts |
| `packages/tui-kit/src/recipes/ContextMenu/ContextMenu.module.css` | modify | their styles |
| `packages/tui-kit/src/recipes/ContextMenu/ContextMenu.test.tsx` | modify | their browser tests |
| `packages/tui-kit/src/index.ts` | modify | export the new prop types |
| `apps/board/src/server.ts`, `apps/board/src/client/types.ts`, `apps/board/src/client/board/Board.tsx` | modify | `triageEnabled` on the payload and the action env |
| `apps/board/src/client/board/format.ts` | modify | `askOutstanding`, `respondAskBlock`; delete `gitlabMenuItems` |
| `apps/board/src/client/board/row-actions.ts` | modify | sections, blocked rows, role gates, bulk filter |
| `apps/board/src/client/board/ActionMenu.tsx` | modify | flyout rendering, reaction row, `flat` |
| `apps/board/src/client/board/__tests__/row-menu-harness.tsx` | modify | open flyouts when looking for an item |

---

### Task 1: Pin today's action keys

**Files:**
- Create: `apps/board/src/client/board/__tests__/menu-states.ts`
- Create: `apps/board/src/client/board/__tests__/menu-key-baseline.test.ts`

**Interfaces:**
- Produces: `MENU_STATES: Record<string, { mr: BoardMRWithReview; env: MenuEnv }>` (used by Tasks 5 and 6), `BASELINE`, `DELIBERATE_DROPS`.

- [ ] **Step 1: Create the state table**

`apps/board/src/client/board/__tests__/menu-states.ts`:

```ts
import type { BoardMRWithReview } from '../../types.ts';
import {
  busyEnv,
  failedEnv,
  failedLanes,
  type MenuEnv,
  mrx,
  ownBusy,
  ownEnv,
  ownIdle,
  ROSTER,
  teammateReviewed,
} from './menu-fixtures.ts';

const FOUND = {
  status: 'found',
  reactions: [] as string[],
  permalink: 'https://slack.example.com/archives/C1/p2',
  posted: true,
};

/** The MR states the row menu is checked against: a role (own, teammate,
    remote, seatless, Slack off) crossed with the lane and GitLab state that
    changes what the menu offers. */
export const MENU_STATES: Record<
  string,
  { mr: BoardMRWithReview; env: MenuEnv }
> = {
  'own fresh': {
    mr: mrx(2001, {
      mergeButton: { visible: true, disabled: false, loading: false },
      autoMergeButton: { visible: true, isActive: false },
      behindTarget: 0,
      slack: FOUND,
    }),
    env: ownEnv,
  },
  'own mid-flow': {
    mr: mrx(2002, {
      mergeButton: { visible: true, disabled: true, loading: false },
      autoMergeButton: { visible: true, isActive: true },
      behindTarget: 3,
      review: { status: 'reviewing', sessionId: 'rev-9' },
      respond: { status: 'done', sessionId: 'resp-9', reportReady: true },
      slack: { ...FOUND, reactions: ['eyes'] },
    }),
    env: ownEnv,
  },
  'own broken': {
    mr: mrx(2003, {
      blockers: { any: true, pipelineFailing: true, hasConflicts: true },
      reviews: { isApproved: false, required: 0, given: 1, reviewers: [] },
      respond: { status: 'error', sessionId: 'resp-8' },
      slack: FOUND,
    }),
    env: ownEnv,
  },
  'own no thread': { mr: ownIdle, env: ownEnv },
  'own draft': {
    mr: mrx(2004, { isDraft: true, behindTarget: 0, slack: FOUND }),
    env: ownEnv,
  },
  'own busy draft': { mr: ownBusy, env: busyEnv },
  'own failed lanes': { mr: failedLanes, env: failedEnv },
  teammate: { mr: teammateReviewed, env: ownEnv },
  'teammate fresh': {
    mr: mrx(2005, { author: { username: 'kim', name: 'Kim' }, slack: FOUND }),
    env: ownEnv,
  },
  remote: { mr: ownIdle, env: { ...ownEnv, local: false } },
  seatless: {
    mr: ownIdle,
    env: { self: null, slackEnabled: true, roster: ROSTER },
  },
  'slack off': { mr: ownIdle, env: { ...ownEnv, slackEnabled: false } },
};
```

- [ ] **Step 2: Write the baseline test**

`apps/board/src/client/board/__tests__/menu-key-baseline.test.ts`. The `BASELINE` literal is what `rowActions` returns on the commit before this plan (captured while writing the plan; sorted):

```ts
import { expect, test } from 'bun:test';

import { rowActions } from '../row-actions.ts';
import { actionEnvOf } from './menu-fixtures.ts';
import { MENU_STATES } from './menu-states.ts';

const BASELINE: Record<string, string[]> = {
  'own fresh': ['copy', 'mark-draft', 'merge', 'note', 'open-gitlab', 'open-slack-post', 'react-eyes', 'react-speech_balloon', 'react-white_check_mark', 'request-review', 'respond', 'review', 'setAutoMerge', 'stand-down'],
  'own mid-flow': ['cancelAutoMerge', 'copy', 'focus-review', 'mark-draft', 'note', 'open-gitlab', 'open-slack-post', 'react-speech_balloon', 'react-white_check_mark', 'rebase', 'rebase-local', 'request-review', 'respond', 'resume-respond', 'resume-review', 'stand-down', 'unreact-eyes', 'view-respond'],
  'own broken': ['copy', 'dismiss-respond', 'doctor', 'mark-draft', 'note', 'open-gitlab', 'open-slack-post', 're-review', 'react-eyes', 'react-speech_balloon', 'react-white_check_mark', 'rebase-local', 'request-review', 'respond', 'resume-respond', 'review', 'stand-down'],
  'own no thread': ['copy', 'find-thread', 'mark-draft', 'merge', 'note', 'open-gitlab', 'post-slack', 'rebase', 'rebase-local', 'request-review', 'respond', 'review', 'setAutoMerge', 'stand-down'],
  'own draft': ['copy', 'mark-ready', 'note', 'open-gitlab', 'open-slack-post', 'react-eyes', 'react-speech_balloon', 'react-white_check_mark', 'request-review', 'respond', 'review', 'stand-down'],
  'own busy draft': ['copy', 'doctor', 'focus-respond', 'focus-review', 'mark-ready', 'note', 'open-gitlab', 'request-review', 'resume-respond', 'resume-review', 'stand-down'],
  'own failed lanes': ['copy', 'dismiss-doctor', 'dismiss-review', 'doctor', 'find-thread', 'mark-draft', 'note', 'nudge-kim', 'open-gitlab', 'post-slack', 'rebase-local', 'request-review', 'respond', 'resume-respond', 'review', 'stand-down'],
  teammate: ['ask-respond', 'copy', 'note', 'open-gitlab', 'open-slack-post', 're-review', 'react-eyes', 'react-speech_balloon', 'resume-review', 'unreact-white_check_mark', 'view-review'],
  'teammate fresh': ['copy', 'note', 'open-gitlab', 'open-slack-post', 'react-eyes', 'react-speech_balloon', 'react-white_check_mark', 'review'],
  remote: ['copy', 'note', 'open-gitlab', 'stand-down'],
  seatless: ['copy', 'find-thread', 'note', 'open-gitlab', 'review', 'seat-hint'],
  'slack off': ['copy', 'mark-draft', 'merge', 'note', 'open-gitlab', 'rebase', 'rebase-local', 'request-review', 'respond', 'review', 'setAutoMerge', 'stand-down'],
};

/** Keys the redesign removes on purpose, per state. A remote board cannot
    run them: their server routes refuse non-local requests. */
const DELIBERATE_DROPS: Record<string, string[]> = {
  remote: ['stand-down'],
};

for (const [name, { mr, env }] of Object.entries(MENU_STATES)) {
  test(`${name}: every action offered before is still offered`, () => {
    const now = new Set(rowActions(mr, actionEnvOf(env, mr)).map(a => a.key));
    const dropped = new Set(DELIBERATE_DROPS[name] ?? []);
    const missing = (BASELINE[name] ?? []).filter(
      k => !now.has(k) && !dropped.has(k)
    );
    expect(missing).toEqual([]);
  });
}

test('every state in the table has a baseline', () => {
  expect(Object.keys(BASELINE).sort()).toEqual(Object.keys(MENU_STATES).sort());
});
```

- [ ] **Step 3: Run it; it passes on today's code**

Run (from `apps/board`): `bun test src/client/board/__tests__/menu-key-baseline.test.ts`
Expected: 13 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add apps/board/src/client/board/__tests__/menu-states.ts apps/board/src/client/board/__tests__/menu-key-baseline.test.ts
git commit -m "board: pin every row-menu action key per MR state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Merge-blocked reasons in glance

**Files:**
- Modify: `packages/glance/src/MRDashboard.ts` (add after `getMRDashboardProps`)
- Modify: `packages/glance/src/index.ts:77`
- Create: `packages/glance/tests/merge-blocked-reason.test.ts`

**Interfaces:**
- Produces: `mergeBlockedReason(mr: Pick<MRDashboardProps, 'isDraft' | 'statusDetail' | 'mergeButton'>): string | null`, exported from `@mattstack/glance`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';

import { mergeBlockedReason } from '../src/MRDashboard.ts';

const mr = (
  over: Partial<{
    isDraft: boolean;
    statusDetail: string;
    disabled: boolean;
    loading: boolean;
  }> = {}
) => ({
  isDraft: over.isDraft ?? false,
  statusDetail: over.statusDetail ?? 'mergeable',
  mergeButton: {
    visible: true,
    disabled: over.disabled ?? false,
    loading: over.loading ?? false,
    label: 'Merge',
  },
});

test('a mergeable MR has no reason', () => {
  expect(mergeBlockedReason(mr())).toBeNull();
});

test('draft wins over every other reason', () => {
  expect(
    mergeBlockedReason(mr({ isDraft: true, disabled: true, statusDetail: 'conflict' }))
  ).toBe('draft');
});

test('a merge in flight reads merging', () => {
  expect(mergeBlockedReason(mr({ loading: true, disabled: true }))).toBe('merging');
});

test.each([
  ['ci_still_running', 'pipeline running'],
  ['ci_must_pass', 'pipeline must pass'],
  ['draft_status', 'draft'],
  ['need_rebase', 'needs rebase'],
  ['conflict', 'conflicts'],
  ['not_approved', 'needs approval'],
  ['requested_changes', 'changes requested'],
  ['discussions_not_resolved', 'open threads'],
  ['checking', 'checking'],
  ['unchecked', 'checking'],
  ['preparing', 'checking'],
  ['approvals_syncing', 'checking'],
  ['blocked_status', 'not mergeable yet'],
  ['', 'not mergeable yet'],
])('a disabled merge with status %s reads %s', (statusDetail, reason) => {
  expect(mergeBlockedReason(mr({ disabled: true, statusDetail }))).toBe(reason);
});
```

- [ ] **Step 2: Run it to see it fail**

Run (from `packages/glance`): `bun test tests/merge-blocked-reason.test.ts`
Expected: FAIL, `mergeBlockedReason` is not exported.

- [ ] **Step 3: Implement**

In `packages/glance/src/MRDashboard.ts`, after `getMRDashboardProps`:

```ts
const MERGE_STATUS_REASON: Record<string, string> = {
  ci_still_running: 'pipeline running',
  ci_must_pass: 'pipeline must pass',
  draft_status: 'draft',
  need_rebase: 'needs rebase',
  conflict: 'conflicts',
  not_approved: 'needs approval',
  requested_changes: 'changes requested',
  discussions_not_resolved: 'open threads',
  checking: 'checking',
  unchecked: 'checking',
  preparing: 'checking',
  approvals_syncing: 'checking',
};

/** Why the merge action cannot run, in a few words for a menu row, or null
    when it can. */
export function mergeBlockedReason(
  mr: Pick<MRDashboardProps, 'isDraft' | 'statusDetail' | 'mergeButton'>
): string | null {
  if (mr.isDraft) return 'draft';
  if (mr.mergeButton.loading) return 'merging';
  if (!mr.mergeButton.disabled) return null;
  return MERGE_STATUS_REASON[mr.statusDetail] ?? 'not mergeable yet';
}
```

In `packages/glance/src/index.ts`, change line 77 to:

```ts
export { getMRDashboardProps, createDashboard, mergeBlockedReason } from './MRDashboard.ts';
```

- [ ] **Step 4: Run the test, the glance suite, and rebuild dist**

Run (from `packages/glance`): `bun test tests/merge-blocked-reason.test.ts && bun test tests && bun run build`
Expected: all PASS, build writes `dist/`.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/src/MRDashboard.ts packages/glance/src/index.ts packages/glance/tests/merge-blocked-reason.test.ts
git commit -m "glance: mergeBlockedReason for menu rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `ContextMenu.Sub` and `ContextMenu.Row` in tui-kit

**Files:**
- Modify: `packages/tui-kit/src/recipes/ContextMenu/ContextMenu.tsx`
- Modify: `packages/tui-kit/src/recipes/ContextMenu/ContextMenu.module.css`
- Modify: `packages/tui-kit/src/recipes/ContextMenu/ContextMenu.test.tsx`
- Modify: `packages/tui-kit/src/index.ts:42-55`

**Interfaces:**
- Produces: `<ContextMenu.Sub label={ReactNode} ariaLabel={string} disabled?>{items}</ContextMenu.Sub>` and `<ContextMenu.Row {...divAttrs}>{items}</ContextMenu.Row>`; types `ContextMenuSubProps`, `ContextMenuRowProps`; `CONTEXTMENU_PARTS.sub | submenu | chevron | row`.

Behaviour (from the spec's "Kit change"): hover opens; click opens (never closes); Right arrow, Enter or Space on the focused Sub row opens and focuses the first enabled item; Left arrow or Escape inside the panel closes only the panel and refocuses the row; leaving the Sub with the pointer closes it; the panel flips left when it would overflow the right edge; a mousedown inside the panel does not close the menu (the panel is a DOM descendant of the root).

- [ ] **Step 1: Write the failing browser tests**

Append to `ContextMenu.test.tsx`:

```tsx
describe("ContextMenu.Sub (browser)", () => {
  const menu = (x = 40, onClose = noop) => (
    <ContextMenu x={x} y={40} ariaLabel="m" onClose={onClose}>
      <ContextMenu.Item label="review" onClick={noop} />
      <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions">
        <ContextMenu.Item label="merge" onClick={noop} />
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu.Sub>
    </ContextMenu>
  );

  it("opens its panel on hover and closes it when the pointer leaves", async () => {
    const screen = await renderWithTheme(menu());
    const row = screen.getByRole("menuitem", { name: "gitlab" });
    await userEvent.hover(row);
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();
    await userEvent.hover(screen.getByRole("menuitem", { name: "review" }));
    expect(screen.container.querySelector(`[data-part="${CONTEXTMENU_PARTS.submenu}"]`)).toBeNull();
  });

  it("marks the row as a menu opener", async () => {
    const screen = await renderWithTheme(menu());
    const row = screen.getByRole("menuitem", { name: "gitlab" }).element();
    expect(row.getAttribute("aria-haspopup")).toBe("menu");
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes only the submenu, a second Escape closes the menu", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(menu(40, onClose));
    await screen.getByRole("menuitem", { name: "gitlab" }).click();
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.container.querySelector(`[data-part="${CONTEXTMENU_PARTS.submenu}"]`)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowRight opens and focuses the first item; ArrowLeft closes and refocuses the row", async () => {
    const screen = await renderWithTheme(menu());
    const row = screen.getByRole("menuitem", { name: "gitlab" }).element() as HTMLButtonElement;
    row.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByRole("menuitem", { name: "merge" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.container.querySelector(`[data-part="${CONTEXTMENU_PARTS.submenu}"]`)).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("a mousedown inside the submenu does not close the menu", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(menu(40, onClose));
    await screen.getByRole("menuitem", { name: "gitlab" }).click();
    const merge = screen.getByRole("menuitem", { name: "merge" }).element();
    merge.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("flips to the left of the row when there is no room on the right", async () => {
    const screen = await renderWithTheme(menu(window.innerWidth));
    await screen.getByRole("menuitem", { name: "gitlab" }).click();
    const panel = screen.container.querySelector<HTMLElement>(`[data-part="${CONTEXTMENU_PARTS.submenu}"]`)!;
    const box = await settledBox(panel);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth - MARGIN + 0.5);
    expect(box.left).toBeGreaterThanOrEqual(MARGIN - 0.5);
  });

  it("a disabled Sub never opens", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions" disabled>
          <ContextMenu.Item label="merge" onClick={noop} />
        </ContextMenu.Sub>
      </ContextMenu>,
    );
    const row = screen.getByRole("menuitem", { name: "gitlab" }).element() as HTMLButtonElement;
    row.click();
    row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(screen.container.querySelector(`[data-part="${CONTEXTMENU_PARTS.submenu}"]`)).toBeNull();
  });
});

describe("ContextMenu.Row (browser)", () => {
  it("lays its items out on one line, as a labelled group", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Row aria-label="slack reactions">
          <ContextMenu.Item label="👀" aria-label="mark as looking" onClick={noop} />
          <ContextMenu.Item label="💬" aria-label="mark as commented" onClick={noop} />
        </ContextMenu.Row>
      </ContextMenu>,
    );
    await expect.element(screen.getByRole("group", { name: "slack reactions" })).toBeVisible();
    const a = screen.getByRole("menuitem", { name: "mark as looking" }).element().getBoundingClientRect();
    const b = screen.getByRole("menuitem", { name: "mark as commented" }).element().getBoundingClientRect();
    expect(Math.abs(a.top - b.top)).toBeLessThan(1);
    expect(b.left).toBeGreaterThan(a.right - 1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (from `packages/tui-kit`): `bunx vitest run --project browser src/recipes/ContextMenu/ContextMenu.test.tsx`
Expected: FAIL, `ContextMenu.Sub` / `ContextMenu.Row` undefined.

- [ ] **Step 3: Implement the parts**

In `ContextMenu.tsx`:

1. Imports: add `useCallback` to the `react` import.
2. Replace the slot keys and parts map:

```ts
const CONTEXTMENU_SLOT_KEYS = [
  "root", "item", "label", "separator", "hint", "sub", "submenu", "chevron", "row",
] as const;

export const CONTEXTMENU_PARTS = {
  root: "contextmenu",
  item: "contextmenu-item",
  label: "contextmenu-label",
  separator: "contextmenu-separator",
  hint: "contextmenu-hint",
  sub: "contextmenu-sub",
  submenu: "contextmenu-submenu",
  chevron: "contextmenu-chevron",
  row: "contextmenu-row",
} as const;
```

3. After the `Separator` prop types, add:

```ts
/** The `Sub` part's own props: a row that opens a nested menu. */
export interface ContextMenuSubOwnProps {
  label: ReactNode;
  /** The nested menu's accessible name. */
  ariaLabel: string;
  disabled?: boolean;
  children?: ReactNode;
}

type ContextMenuSubProps_ = ContextMenuSubOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

type ContextMenuRowProps_ = Omit<HTMLAttributes<HTMLDivElement>, "ref">;

/** Mounted only while open, so its `useEscapeClose` sits above the root's on
    the layer stack and Escape closes this panel first. */
function SubPanel({
  anchorRef,
  onClose,
  focusFirst,
  styleProps,
  label,
  children,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  focusFirst: boolean;
  styleProps: { className?: string; style?: CSSProperties };
  label: string;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEscapeClose(onClose);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const fitsRight = r.right + width + VIEWPORT_MARGIN <= window.innerWidth;
    setPos({
      left: fitsRight ? r.right : Math.max(VIEWPORT_MARGIN, r.left - width),
      top: Math.max(VIEWPORT_MARGIN, Math.min(r.top, window.innerHeight - height - VIEWPORT_MARGIN)),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (pos && focusFirst)
      panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [pos, focusFirst]);

  const anchored: CSSProperties = pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" };
  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      {...styleProps}
      style={{ ...styleProps.style, ...anchored }}
      data-part={CONTEXTMENU_PARTS.submenu}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}
```

4. In the `parts` map, after `separator`, add:

```tsx
    sub: {
      render: ({ props, getStyles, ref }: Ctx<ContextMenuSubProps_>) => {
        const { label, ariaLabel, disabled, children, ...rest } = stripFrameworkKeys(props);
        const [open, setOpen] = useState<null | "pointer" | "keyboard">(null);
        const buttonRef = useRef<HTMLButtonElement | null>(null);
        const close = useCallback(() => {
          setOpen(null);
          buttonRef.current?.focus();
        }, []);
        return (
          <div
            ref={ref as Ref<HTMLDivElement>}
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.sub}
            onMouseEnter={() => {
              if (!disabled) setOpen((o) => o ?? "pointer");
            }}
            onMouseLeave={() => setOpen(null)}
          >
            <button
              ref={buttonRef}
              role="menuitem"
              type="button"
              aria-haspopup="menu"
              aria-expanded={open !== null}
              disabled={disabled}
              {...getStyles({ part: "item" })}
              data-part={CONTEXTMENU_PARTS.item}
              onClick={() => setOpen((o) => o ?? "pointer")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen("keyboard");
                }
              }}
            >
              <span>{label}</span>
              <span {...getStyles({ part: "chevron" })} data-part={CONTEXTMENU_PARTS.chevron} aria-hidden="true">
                ›
              </span>
            </button>
            {open && (
              <SubPanel
                anchorRef={buttonRef}
                onClose={close}
                focusFirst={open === "keyboard"}
                styleProps={getStyles({ part: "submenu" })}
                label={ariaLabel}
              >
                {children}
              </SubPanel>
            )}
          </div>
        );
      },
    },
    row: {
      render: ({ props, getStyles, children, ref }: Ctx<ContextMenuRowProps_>) => {
        const { children: _children, ...rest } = stripFrameworkKeys(props);
        return (
          <div
            ref={ref as Ref<HTMLDivElement>}
            role="group"
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.row}
          >
            {children}
          </div>
        );
      },
    },
```

5. After the existing exported prop types at the bottom, add:

```ts
/** Everything a call site may pass to `<ContextMenu.Sub>`. */
export type ContextMenuSubProps = ComponentProps<typeof ContextMenu.Sub>;
/** Everything a call site may pass to `<ContextMenu.Row>`. */
export type ContextMenuRowProps = ComponentProps<typeof ContextMenu.Row>;
```

6. In `packages/tui-kit/src/index.ts`, add `ContextMenuSubOwnProps`, `ContextMenuSubProps` and `ContextMenuRowProps` to the type export list from `./recipes/ContextMenu/ContextMenu.tsx`.

In `ContextMenu.module.css`, inside the layer, after `.separator`:

```css
  .sub {
    display: block;
  }

  /* Same box as `.root`. `--sb-contextmenu-min-w` is inherited: the panel is
     a DOM descendant of the root even though it is positioned fixed. */
  .submenu {
    box-sizing: border-box;
    position: fixed;
    z-index: 201;
    min-width: var(--sb-contextmenu-min-w);
    padding: var(--spacing-px4);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-menu);
  }

  .chevron {
    font-size: var(--font-size-px11);
    color: var(--text-4);
  }

  .row {
    display: flex;
    gap: var(--spacing-px4);
  }

  .row > .item {
    width: auto;
    flex: 1;
    justify-content: center;
  }

  .row > .item[aria-pressed="true"] {
    background: var(--surface-wash-accent-16);
  }
```

- [ ] **Step 4: Run the kit tests and gates**

Run (from `packages/tui-kit`): `bunx vitest run --project browser src/recipes/ContextMenu/ContextMenu.test.tsx && bun run test && bun run gates && bun run typecheck && bun run build`
Expected: all PASS, `gates` shows no codegen drift. If `gates` flags a hardcoded value or unknown token in the new CSS, use the nearest token the existing rules already use.

- [ ] **Step 5: Commit**

```bash
git add packages/tui-kit/src
git commit -m "tui-kit: ContextMenu.Sub and ContextMenu.Row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `triageEnabled` reaches the action env

**Files:**
- Modify: `apps/board/src/server.ts` (the data payload near `slackEnabled: !!slackToken`, line ~1495)
- Modify: `apps/board/src/client/types.ts:189` (the payload type)
- Modify: `apps/board/src/client/board/row-actions.ts` (`ActionEnv`)
- Modify: `apps/board/src/client/board/Board.tsx:1208` (`actionEnv`)
- Modify: `apps/board/src/client/board/__tests__/menu-fixtures.ts` (`MenuEnv`, `actionEnvOf`)

**Interfaces:**
- Produces: `ActionEnv.triageEnabled?: boolean` (undefined from an older server means unknown, which never blocks); `MenuEnv.triageEnabled?: boolean`.

- [ ] **Step 1: Add the field**

`server.ts`, next to `slackEnabled: !!slackToken,`:

```ts
            triageEnabled: triageEnabled(),
```

(`triageEnabled()` already exists in `server.ts` around line 543 and returns false when the config fails to parse.)

`client/types.ts`, after `slackEnabled: boolean;` in the payload interface (line 189):

```ts
  /** Whether auto-doctor (triage) is on for this board; absent on older
      servers. */
  triageEnabled?: boolean;
```

`row-actions.ts` `ActionEnv`, after `slackEnabled`:

```ts
  /** Auto-doctor on for this board; undefined = unknown. */
  triageEnabled?: boolean;
```

`Board.tsx` `actionEnv`, after `slackEnabled: data.slackEnabled,`:

```ts
    triageEnabled: data.triageEnabled,
```

`menu-fixtures.ts`: add `triageEnabled?: boolean;` to `MenuEnv`, and `triageEnabled: env.triageEnabled,` to `actionEnvOf`'s return.

- [ ] **Step 2: Typecheck and run the board suite**

Run (from repo root): `bun run board:typecheck`; then from `apps/board`: `bun test`
Expected: PASS (nothing reads the field yet).

- [ ] **Step 3: Commit**

```bash
git add apps/board/src/server.ts apps/board/src/client/types.ts apps/board/src/client/board/row-actions.ts apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/menu-fixtures.ts
git commit -m "board: send triageEnabled to the row menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `rowActions` sections, blocked rows and role gates

**Files:**
- Modify: `apps/board/src/client/board/format.ts` (add `askOutstanding`, `respondAskBlock`; delete `gitlabMenuItems` and its export)
- Modify: `apps/board/src/client/board/row-actions.ts`
- Modify: `apps/board/src/client/board/__tests__/row-actions.test.ts`

**Interfaces:**
- Consumes: `mergeBlockedReason` (Task 2), `ActionEnv.triageEnabled` (Task 4), `MENU_STATES` (Task 1).
- Produces: `Section = 'top' | 'agent' | 'sessions' | 'gitlab' | 'slack' | 'more'`; `rowActions` returns rows in the order top, agent, sessions, gitlab, slack, more; new keys `nudge-none`, `local-hint`; `bulkActions` entries only ever carry sections `agent | gitlab | slack`.

- [ ] **Step 1: Write the failing tests**

Replace the first three tests in `row-actions.test.ts` ("an idle own MR offers these actions...", "a teammate's reviewed MR...", "a remote board keeps...") with:

```ts
const sections = (mr: typeof ownIdle, env: typeof ownEnv) =>
  rowActions(mr, actionEnvOf(env, mr)).map(a => `${a.section}:${a.key}`);

test('an idle own MR: every action, by section, in menu order', () => {
  expect(sections(ownIdle, ownEnv)).toEqual([
    'top:find-thread',
    'agent:review',
    'agent:respond',
    'agent:rebase-local',
    'sessions:resume-review',
    'sessions:resume-respond',
    'sessions:view-review',
    'sessions:view-respond',
    'sessions:dismiss-review',
    'sessions:dismiss-respond',
    'sessions:dismiss-doctor',
    'sessions:nudge-none',
    'sessions:request-review',
    'gitlab:merge',
    'gitlab:rebase',
    'gitlab:setAutoMerge',
    'gitlab:mark-draft',
    'gitlab:open-gitlab',
    'slack:open-slack-post',
    'slack:post-slack',
    'slack:copy',
    'more:note',
    'more:stand-down',
  ]);
});

test('an idle own MR blocks what its state cannot run, with a reason', () => {
  const blocked = Object.fromEntries(
    rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle))
      .filter(a => a.blocked)
      .map(a => [a.key, a.blocked])
  );
  expect(blocked).toEqual({
    'resume-review': 'no session',
    'resume-respond': 'no session',
    'view-review': 'no report yet',
    'view-respond': 'no report yet',
    'dismiss-review': 'nothing to dismiss',
    'dismiss-respond': 'nothing to dismiss',
    'dismiss-doctor': 'nothing to dismiss',
    'nudge-none': 'no peer review',
    'open-slack-post': 'no thread',
  });
});

test("a teammate's reviewed MR with a found thread", () => {
  expect(sections(teammateReviewed, ownEnv)).toEqual([
    'top:react-eyes',
    'top:react-speech_balloon',
    'top:unreact-white_check_mark',
    'agent:re-review',
    'agent:ask-respond',
    'sessions:resume-review',
    'sessions:view-review',
    'sessions:dismiss-review',
    'gitlab:open-gitlab',
    'slack:open-slack-post',
    'slack:copy',
    'more:note',
  ]);
});

test('a remote board drops local-only rows and says why', () => {
  const actions = rowActions(ownIdle, actionEnvOf({ ...ownEnv, local: false }, ownIdle));
  expect(actions.map(a => `${a.section}:${a.key}`)).toEqual([
    'agent:local-hint',
    'sessions:view-review',
    'sessions:view-respond',
    'gitlab:open-gitlab',
    'slack:copy',
    'more:note',
  ]);
  expect(actions[0]?.blocked).toBe('need a local board');
});

test('review and re-review both stay; re-review is the primary', () => {
  const mr = MENU_STATES['own broken']!.mr;
  const actions = rowActions(mr, actionEnvOf(ownEnv, mr));
  expect(actions.find(a => a.key === 're-review')?.section).toBe('agent');
  const fresh = actions.find(a => a.key === 'review');
  expect(fresh?.section).toBe('sessions');
  expect(fresh?.label).toBe('review from scratch');
});

test('each lane shows exactly one primary row in agent, in every state', () => {
  const REVIEW = new Set(['review', 're-review', 'focus-review']);
  const RESPOND = new Set(['respond', 'focus-respond']);
  for (const [name, { mr, env }] of Object.entries(MENU_STATES)) {
    if (env.local === false) continue;
    const agent = rowActions(mr, actionEnvOf(env, mr)).filter(a => a.section === 'agent');
    expect([name, agent.filter(a => REVIEW.has(a.key)).length]).toEqual([name, 1]);
    const own = env.self !== null && mr.author.username === env.self;
    expect([name, agent.filter(a => RESPOND.has(a.key)).length]).toEqual([name, own ? 1 : 0]);
  }
});

test('every blocked row carries a reason', () => {
  for (const { mr, env } of Object.values(MENU_STATES))
    for (const a of rowActions(mr, actionEnvOf(env, mr)))
      if ('blocked' in a) expect(typeof a.blocked === 'string' && a.blocked.length > 0).toBe(true);
});

test('a draft blocks merge and auto-merge, and offers mark ready', () => {
  const mr = MENU_STATES['own draft']!.mr;
  const by = Object.fromEntries(rowActions(mr, actionEnvOf(ownEnv, mr)).map(a => [a.key, a]));
  expect(by.merge?.blocked).toBe('draft');
  expect(by.setAutoMerge?.blocked).toBe('draft');
  expect(by['mark-ready']?.blocked).toBeUndefined();
  expect(by.rebase?.blocked).toBe('up to date');
});

test('a running merge and rebase say so', () => {
  const mr = mrx(1418, {
    mergeButton: { visible: true, disabled: true, loading: true },
    rebaseButton: { visible: true, loading: true },
    autoMergeButton: { visible: true, isActive: false },
  });
  const by = Object.fromEntries(rowActions(mr, actionEnvOf(ownEnv, mr)).map(a => [a.key, a]));
  expect(by.merge?.blocked).toBe('merging');
  expect(by.rebase?.blocked).toBe('rebasing');
});

test('auto-doctor ignore is blocked when triage is off and no doctor runs', () => {
  const off = rowActions(ownIdle, actionEnvOf({ ...ownEnv, triageEnabled: false }, ownIdle));
  expect(off.find(a => a.key === 'stand-down')?.blocked).toBe('auto-doctor is off');
  const running = mrx(1418, { doctor: { status: 'diagnosing' } });
  const live = rowActions(running, actionEnvOf({ ...ownEnv, triageEnabled: false }, running));
  expect(live.find(a => a.key === 'stand-down')?.blocked).toBeUndefined();
  const unknown = rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle));
  expect(unknown.find(a => a.key === 'stand-down')?.blocked).toBeUndefined();
  const stood = mrx(1418, { standDown: true });
  const reenable = rowActions(stood, actionEnvOf({ ...ownEnv, triageEnabled: false }, stood));
  expect(reenable.find(a => a.key === 'stand-down')?.blocked).toBeUndefined();
});

test("a teammate's MR without my commented review blocks the respond ask", () => {
  const mr = MENU_STATES['teammate fresh']!.mr;
  const ask = rowActions(mr, actionEnvOf(ownEnv, mr)).find(a => a.key === 'ask-respond');
  expect(ask?.label).toBe("ask kim's agent to respond");
  expect(ask?.blocked).toBe('no finished review with comments');
});

test('an outstanding ask blocks request review and nudges with the same reason', () => {
  const mr = mrx(1418, { sentNudge: { display: 'sent' } });
  const by = Object.fromEntries(rowActions(mr, actionEnvOf(ownEnv, mr)).map(a => [a.key, a]));
  expect(by['request-review']?.blocked).toBe('ask already sent');
  expect(by['nudge-none']?.blocked).toBe('ask already sent');
});

test('the bulk menu never targets a blocked row and keeps its three headings', () => {
  const draft = MENU_STATES['own draft']!.mr;
  const entries = bulkActions([ownIdle, draft], actionEnvOf(ownEnv, ownIdle));
  expect(entries.some(e => e.key === 'setAutoMerge')).toBe(false);
  expect(new Set(entries.map(e => e.section))).toEqual(new Set(['agent', 'gitlab', 'slack']));
});
```

Add `MENU_STATES` to the imports: `import { MENU_STATES } from './menu-states.ts';`. Check `sentNudge.display` accepts `'sent'` in `SentNudgeInfo` (`apps/board/src/client/types.ts`); if the type names a different outstanding value, use that one.

- [ ] **Step 2: Run them to see them fail**

Run (from `apps/board`): `bun test src/client/board/__tests__/row-actions.test.ts`
Expected: the new tests FAIL (sections still `agent | gitlab | slack`).

- [ ] **Step 3: Add the format helpers**

In `format.ts`, after `nudgeTargets`:

```ts
/** An ask of ours on this MR still waits for an answer. */
function askOutstanding(mrx: BoardMRWithReview): boolean {
  return !!mrx.sentNudge && !NUDGE_RETRYABLE.has(mrx.sentNudge.display);
}

/** Why the respond ask cannot go to the author yet; mirrors the order of
    respondAskTarget's checks. */
function respondAskBlock(
  mrx: BoardMRWithReview,
  peers?: readonly string[]
): string {
  if (askOutstanding(mrx)) return 'ask already sent';
  const r = mrx.review;
  if (!r || r.status !== 'done' || r.outcome !== 'comment')
    return 'no finished review with comments';
  if (peers && !peers.includes(mrx.author.username))
    return 'author not enrolled';
  return 'not available';
}
```

Add both to the export list. Delete `gitlabMenuItems` (its function and its export line); if any test under `apps/board` imports it, delete that test too (`rowActions` covers the same rows now).

- [ ] **Step 4: Rewrite `rowActions` and adjust `bulkActions`**

In `row-actions.ts`:

1. Imports: remove `gitlabMenuItems`; add `askOutstanding`, `respondAskBlock` from `./format.ts`; add `import { mergeBlockedReason } from '@mattstack/glance';`.
2. `export type Section = 'top' | 'agent' | 'sessions' | 'gitlab' | 'slack' | 'more';`
3. Replace the `rowActions` doc comment and body:

```ts
const block = (reason: string | null | false | undefined): Partial<RowAction> =>
  reason ? { blocked: reason } : {};

/** Every action this MR offers, in menu order, each in one section. Who is
    looking (local board, own MR, seat, Slack on) decides whether a row
    exists; the MR's own state only blocks it, with a reason, so no action
    can vanish because of a wrong guess about state. */
export function rowActions(
  mrx: BoardMRWithReview,
  env: ActionEnv
): RowAction[] {
  const own = isOwnMr(mrx, env.self);
  const top: RowAction[] = [];
  const agent: RowAction[] = [];
  const sessions: RowAction[] = [];
  const gitlab: RowAction[] = [];
  const slack: RowAction[] = [];
  const more: RowAction[] = [];

  if (env.local) {
    const reviewRunning =
      mrx.review?.status === 'queued' || mrx.review?.status === 'reviewing';
    const reviewItems = reviewMenuItems(
      mrx.review?.status,
      laneInterrupted(mrx.orphan, mrx.review),
      reviewLogged(mrx)
    );
    const reReviewOffered = reviewItems.some(it => it.kind === 're-review');
    for (const it of reviewItems) {
      if (reviewRunning)
        agent.push(
          agentItem('review', 'focus-review', it.label, {
            kind: 'launch',
            flow: 'review',
            intent: 'focus',
          })
        );
      else if (it.kind === 're-review')
        agent.push(
          agentItem(
            'review',
            're-review',
            it.label,
            { kind: 'launch', flow: 're-review' },
            { notable: true, bulk: 're-review' }
          )
        );
      else if (reReviewOffered)
        sessions.push(
          agentItem(
            'review',
            'review',
            'review from scratch',
            { kind: 'launch', flow: 'review' },
            { section: 'sessions', notable: true, bulk: 'review' }
          )
        );
      else
        agent.push(
          agentItem(
            'review',
            'review',
            it.label,
            { kind: 'launch', flow: 'review' },
            { notable: true, bulk: 'review' }
          )
        );
    }
    sessions.push(
      agentItem(
        'review',
        'resume-review',
        'resume review',
        { kind: 'launch', flow: 'resume-review' },
        {
          section: 'sessions',
          notable: true,
          ...block(!mrx.review?.sessionId && 'no session'),
        }
      )
    );
    if (own) {
      const label = respondItemLabel(
        mrx.respond?.status,
        laneInterrupted(mrx.orphan, mrx.respond)
      );
      // Both words ride the focus intent: the launch route already re-opens
      // a dead pane, the label only says which of the two it will do.
      const focuses =
        label === 'focus response' || label === 'relaunch response';
      agent.push(
        focuses
          ? agentItem('respond', 'focus-respond', label, {
              kind: 'launch',
              flow: 'respond',
              intent: 'focus',
            })
          : agentItem(
              'respond',
              'respond',
              label,
              { kind: 'launch', flow: 'respond' },
              { notable: true }
            )
      );
      sessions.push(
        agentItem(
          'respond',
          'resume-respond',
          'resume response',
          { kind: 'launch', flow: 'resume-respond' },
          {
            section: 'sessions',
            notable: true,
            ...block(!mrx.respond?.sessionId && 'no session'),
          }
        )
      );
    }
    if (own && (mrx.blockers?.pipelineFailing || mrx.blockers?.hasConflicts)) {
      const label = doctorItemLabel(mrx.doctor?.status);
      agent.push(
        label === 'focus doctor'
          ? agentItem('doctor', 'focus-doctor', label, {
              kind: 'launch',
              flow: 'doctor',
              intent: 'focus',
            })
          : agentItem(
              'doctor',
              'doctor',
              label,
              { kind: 'launch', flow: 'doctor' },
              { notable: true, bulk: 'call doctor' }
            )
      );
    }
    if (
      own &&
      (mrx.blockers?.hasConflicts ||
        mrx.rebaseButton.visible ||
        (mrx.behindTarget ?? 0) > 0)
    )
      agent.push(
        agentItem(
          'doctor',
          'rebase-local',
          'rebase locally',
          { kind: 'launch', flow: 'rebase-local' },
          { notable: true }
        )
      );
  }

  sessions.push(
    item(
      'sessions',
      'view-review',
      'view agent review',
      FILE,
      { kind: 'view-report', lane: 'review' },
      block(!mrx.review?.reportReady && 'no report yet')
    )
  );
  if (own)
    sessions.push(
      item(
        'sessions',
        'view-respond',
        'view agent response',
        FILE,
        { kind: 'view-report', lane: 'respond' },
        block(!mrx.respond?.reportReady && 'no report yet')
      )
    );
  if (env.local)
    for (const lane of ['review', 'respond', 'doctor'] as const) {
      if (lane !== 'review' && !own) continue;
      const state = mrx[lane];
      const live = state?.status === 'error' && !laneDismissed(state);
      sessions.push(
        item(
          'sessions',
          `dismiss-${lane}`,
          `dismiss ${lane} line`,
          DISMISS,
          { kind: 'dismiss', lane },
          block(!live && 'nothing to dismiss')
        )
      );
    }
  if (env.local && own) {
    const peers = nudgeTargets(mrx);
    for (const peer of peers)
      sessions.push(
        item(
          'sessions',
          `nudge-${peer.reviewer}`,
          `ask ${peer.reviewer}'s agent to re-review`,
          PEOPLE,
          { kind: 'ask', ask: 're-review', reviewer: peer.reviewer }
        )
      );
    if (!peers.length)
      sessions.push(
        item(
          'sessions',
          'nudge-none',
          "ask a reviewer's agent to re-review",
          PEOPLE,
          { kind: 'ask', ask: 're-review' },
          { blocked: askOutstanding(mrx) ? 'ask already sent' : 'no peer review' }
        )
      );
    const askTargets = firstReviewTargets(mrx, env.roster, env.peers);
    sessions.push(
      item(
        'sessions',
        'request-review',
        'request review from…',
        PEOPLE,
        { kind: 'ask', ask: 'review' },
        askTargets.length
          ? {
              pick: {
                title: 'request review from',
                aria: 'request review',
                options: askTargets.map(value => ({ value })),
              },
              bulk: 'request review from…',
            }
          : {
              blocked: askOutstanding(mrx)
                ? 'ask already sent'
                : 'everyone engaged',
            }
      )
    );
  }
  if (env.local && env.self !== null && !own) {
    const target = respondAskTarget(mrx, env.peers);
    const who = target ?? mrx.author.username;
    agent.push(
      item(
        'agent',
        'ask-respond',
        `ask ${who}'s agent to respond`,
        PEOPLE,
        { kind: 'ask', ask: 'respond', reviewer: who },
        target ? {} : { blocked: respondAskBlock(mrx, env.peers) }
      )
    );
  }
  if (env.local && env.self === null)
    agent.push(
      item(
        'agent',
        'seat-hint',
        'author actions',
        PEOPLE,
        { kind: 'open', url: '' },
        { blocked: SEAT_HINT }
      )
    );
  if (!env.local)
    agent.push(
      item(
        'agent',
        'local-hint',
        'agent actions',
        PEOPLE,
        { kind: 'open', url: '' },
        { blocked: 'need a local board' }
      )
    );

  if (env.local && own) {
    gitlab.push(
      item(
        'gitlab',
        'merge',
        'merge',
        GITLAB_GLYPH.merge,
        { kind: 'mr', action: 'merge' },
        {
          bulk: 'merge',
          confirm: 'really merge?',
          ...block(mergeBlockedReason(mrx)),
        }
      )
    );
    gitlab.push(
      item(
        'gitlab',
        'rebase',
        'rebase on target',
        GITLAB_GLYPH.rebase,
        { kind: 'mr', action: 'rebase' },
        {
          bulk: 'rebase on target',
          ...block(
            mrx.rebaseButton.loading
              ? 'rebasing'
              : !mrx.rebaseButton.visible &&
                  mrx.behindTarget === 0 &&
                  'up to date'
          ),
        }
      )
    );
    const autoMerge = mrx.autoMergeButton;
    gitlab.push(
      autoMerge.visible && autoMerge.isActive
        ? item(
            'gitlab',
            'cancelAutoMerge',
            'cancel auto-merge',
            GITLAB_GLYPH.cancelAutoMerge,
            { kind: 'mr', action: 'cancelAutoMerge' },
            { bulk: 'cancel auto-merge' }
          )
        : item(
            'gitlab',
            'setAutoMerge',
            'set auto-merge',
            GITLAB_GLYPH.setAutoMerge,
            { kind: 'mr', action: 'setAutoMerge' },
            { bulk: 'set auto-merge', ...block(!autoMerge.visible && 'draft') }
          )
    );
    gitlab.push(
      mrx.isDraft
        ? item(
            'gitlab',
            'mark-ready',
            'mark ready',
            DRAFT,
            { kind: 'draft', draft: false },
            { bulk: 'mark ready' }
          )
        : item(
            'gitlab',
            'mark-draft',
            'mark as draft',
            DRAFT,
            { kind: 'draft', draft: true },
            { bulk: 'mark as draft' }
          )
    );
  }
  gitlab.push(
    item(
      'gitlab',
      'open-gitlab',
      'open in gitlab',
      { kind: 'out' },
      { kind: 'open', url: mrx.webUrl ?? '' }
    )
  );

  const s = mrx.slack;
  if (env.local && env.slackEnabled) {
    const found = s?.status === 'found';
    if (found) {
      const reactions = s.reactions ?? [];
      for (const m of getSlackMarks()) {
        const marked = reactions.includes(m.emoji);
        const label = marked ? `unmark ${m.word}` : `mark as ${m.word}`;
        top.push(
          item(
            'top',
            `${marked ? 'unreact' : 'react'}-${m.emoji}`,
            label,
            { kind: 'emoji', glyph: m.glyph },
            { kind: 'react', emoji: m.emoji, glyph: m.glyph, remove: marked },
            { marked, keepOpen: true, bulk: label }
          )
        );
      }
    } else
      top.push(
        item(
          'top',
          'find-thread',
          s?.status === 'notfound'
            ? 'no thread, find it again'
            : 'find slack thread',
          SLACK,
          { kind: 'find-thread' },
          { bulk: 'find slack threads' }
        )
      );
    slack.push(
      item(
        'slack',
        'open-slack-post',
        'open MR post in slack',
        SLACK,
        { kind: 'open', url: (found && s.permalink) || '' },
        block(!found ? 'no thread' : !s.permalink && 'no link yet')
      )
    );
    if (own)
      slack.push(
        item(
          'slack',
          'post-slack',
          mrx.slackChannel ? `post to #${mrx.slackChannel}` : 'post to slack',
          SLACK,
          { kind: 'post-slack' },
          block(found && 'thread exists')
        )
      );
    if (own && !!mrx.rtRepo && env.ownerSlackRepos?.includes(mrx.rtRepo))
      slack.push(
        item('slack', 'post-owners', 'post to code owners…', SLACK, {
          kind: 'post-owners',
        })
      );
  }
  slack.push(item('slack', 'copy', 'copy for slack', COPY, { kind: 'copy' }));
  more.push(
    item('more', 'note', mrx.note ? 'edit note' : 'add a note', NOTE, {
      kind: 'note',
    })
  );
  if (env.local && own) {
    // Auto-doctor only ever acts on the seat's own MRs. Matched by url: the MR
    // handed in can be a copy (optimistic overlay, live slack marks), and the
    // stack walk compares objects.
    const onBoard = env.allMrs.find(m => m.webUrl === mrx.webUrl) ?? mrx;
    const doctorActive =
      !!mrx.doctor?.status &&
      mrx.doctor.status !== 'error' &&
      mrx.doctor.status !== 'done';
    more.push(
      item(
        'more',
        'stand-down',
        mrx.standDown
          ? 're-enable auto-doctor'
          : `auto-doctor: ignore this ${hasStackDescendants(onBoard, env.allMrs) ? 'stack' : 'MR'}`,
        DISMISS,
        { kind: 'stand-down', on: !mrx.standDown },
        block(
          !mrx.standDown &&
            env.triageEnabled === false &&
            !doctorActive &&
            'auto-doctor is off'
        )
      )
    );
  }

  return [...top, ...agent, ...sessions, ...gitlab, ...slack, ...more];
}
```

4. In `bulkActions`, change the per-row action list and fold sections onto the three bulk headings:

```ts
type BulkSection = 'agent' | 'gitlab' | 'slack';
const BULK_SECTION: Record<Section, BulkSection> = {
  top: 'slack',
  agent: 'agent',
  sessions: 'agent',
  gitlab: 'gitlab',
  slack: 'slack',
  more: 'slack',
};
const SECTION_RANK: Record<BulkSection, number> = { agent: 0, gitlab: 1, slack: 2 };
```

(replace the existing `SECTION_RANK` line), then in `bulkActions`:

```ts
    const actions = rowActions(mr, env).filter(a => !a.blocked);
```

and in the entry builder `section: BULK_SECTION[g.first.section],`, and the sort comparator `SECTION_RANK[x.section as BulkSection] - SECTION_RANK[y.section as BulkSection]`.

5. If `doctor.status` has no value named `'diagnosing'` in `DoctorStatus` (`apps/board/src/client/types.ts`), use any running status the type does declare in the stand-down test.

- [ ] **Step 5: Run the row-actions and baseline tests**

Run (from `apps/board`): `bun test src/client/board/__tests__/row-actions.test.ts src/client/board/__tests__/menu-key-baseline.test.ts`
Expected: the new tests and the baseline PASS. Older tests in `row-actions.test.ts` that asserted today's omissions or flat order may fail: for each, check the expected row against the spec's placement table and update the expectation to the table (for example a test that expected `request-review` absent now expects it present with `blocked: 'ask already sent'`). Never change `rowActions` to satisfy an old expectation that contradicts the table.

- [ ] **Step 6: Typecheck and commit**

Run (from repo root): `bun run board:typecheck`
Expected: PASS.

```bash
git add apps/board/src/client/board/format.ts apps/board/src/client/board/row-actions.ts apps/board/src/client/board/__tests__/row-actions.test.ts
git commit -m "board: row menu sections, blocked rows instead of hidden ones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Render the flyouts in `ActionMenu`

**Files:**
- Modify: `apps/board/src/client/board/ActionMenu.tsx`
- Modify: `apps/board/src/client/board/Board.tsx:1557` (bulk call site)
- Modify: `apps/board/src/client/board/__tests__/row-menu-harness.tsx`
- Modify: `apps/board/src/client/board/__tests__/row-menu-ask-dom.test.tsx`, `row-menu-pins-dom.test.tsx`, `bulk-menu-dom.test.tsx` (expectations)
- Create: `apps/board/src/client/board/__tests__/row-menu-flyouts-dom.test.tsx`

**Interfaces:**
- Consumes: `ContextMenu.Sub`, `ContextMenu.Row` (Task 3), sections (Task 5).
- Produces: `ActionMenu` prop `flat?: boolean`; harness `openSub(title)`.

- [ ] **Step 1: Teach the harness about flyouts**

In `row-menu-harness.tsx`:

```tsx
const SUB = '[aria-haspopup="menu"]';

function labelOf(el: Element): string {
  return el.getAttribute('aria-label') ?? el.textContent ?? '';
}

export async function openSub(title: string): Promise<void> {
  const row = [...document.querySelectorAll<HTMLElement>(SUB)].find(el =>
    el.textContent?.includes(title)
  );
  if (!row) throw new Error(`no flyout "${title}"`);
  if (row.getAttribute('aria-expanded') === 'true') return;
  await React.act(async () => {
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function closeSub(row: HTMLElement): Promise<void> {
  await React.act(async () => {
    row.parentElement?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  });
}

function findItem(text: string): HTMLElement | undefined {
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  return (
    items.find(el => labelOf(el) === text) ??
    items.find(el => labelOf(el).includes(text))
  );
}

/** Every item label, flyout contents included, top to bottom. */
export async function allItemLabels(): Promise<string[]> {
  const out: string[] = [];
  for (const el of [...document.querySelectorAll<HTMLElement>('[data-part="contextmenu"] > [role="menuitem"], [data-part="contextmenu"] > [data-part="contextmenu-row"] > [role="menuitem"], [data-part="contextmenu"] > [data-part="contextmenu-sub"]')]) {
    if (el.getAttribute('data-part') !== 'contextmenu-sub') {
      out.push(labelOf(el));
      continue;
    }
    const row = el.querySelector<HTMLElement>(SUB)!;
    await openSub(row.textContent ?? '');
    for (const item of el.querySelectorAll<HTMLElement>('[data-part="contextmenu-submenu"] [role="menuitem"]'))
      out.push(labelOf(item));
  }
  return out;
}
```

Change `itemTexts()` to map with `labelOf`. Change `clickItem` to look up with `findItem(text)`, and when nothing matches, open each flyout in turn and look again before throwing:

```tsx
  let hit = findItem(text);
  if (!hit)
    for (const row of [...document.querySelectorAll<HTMLElement>(SUB)]) {
      await openSub(row.textContent ?? '');
      hit = findItem(text);
      if (hit) break;
    }
```

In `menuLines()`, map the two new parts:

```tsx
    if (part === 'contextmenu-row')
      return `[${[...el.querySelectorAll('[role="menuitem"]')].map(labelOf).join(' | ')}]`;
    if (part === 'contextmenu-sub')
      return `> ${el.querySelector(SUB)?.firstElementChild?.textContent ?? ''}`;
```

In `clickEach`, take the labels from `await allItemLabels()` instead of `itemTexts()`.

If `closeSub` ends up unused after the tests below, delete it.

- [ ] **Step 2: Write the failing flyout tests**

`row-menu-flyouts-dom.test.tsx`:

```tsx
import { expect, test } from 'bun:test';

import { mrx, ownEnv, ownIdle, teammateReviewed } from './menu-fixtures.ts';
import {
  clickItem,
  harness,
  menuLines,
  openMenu,
  openSub,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

test('an own MR shows the short top level, flyouts last', async () => {
  await openMenu(ownIdle, ownEnv);
  expect(menuLines()).toEqual([
    '# !1418',
    'no thread, find it again',
    '---',
    '# agent actions',
    'review',
    'respond',
    'rebase locally',
    '---',
    '> sessions and reports',
    '> gitlab',
    '> slack',
    '> more',
  ]);
});

test('the reaction row toggles a mark and keeps the menu open', async () => {
  await openMenu(teammateReviewed, ownEnv, { reactionsReply: ['white_check_mark', 'eyes'] });
  expect(menuLines()[1]).toBe('[mark as looking | mark as commented | unmark approved]');
  await clickItem('mark as looking');
  expect(harness.effects.map(e => e.effect)).toEqual(['react:eyes:false']);
  expect(harness.closed).toBe(false);
});

test('a blocked row in a flyout shows its reason and does not run', async () => {
  await openMenu(ownIdle, ownEnv);
  await openSub('slack');
  const post = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(el =>
    el.textContent?.includes('open MR post in slack')
  )!;
  expect(post.disabled).toBe(true);
  expect(post.textContent).toContain('no thread');
  await clickItem('open MR post in slack');
  expect(harness.effects).toEqual([]);
});

test('a one-row section renders inline, not as a flyout', async () => {
  await openMenu(mrx(1418, { author: { username: 'kim', name: 'Kim' } }), ownEnv);
  const lines = menuLines();
  expect(lines).toContain('open in gitlab');
  expect(lines).not.toContain('> gitlab');
  expect(lines).toContain('add a note');
  expect(lines).not.toContain('> more');
});

test('merge in the gitlab flyout still asks for a second click', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('merge');
  expect(harness.effects).toEqual([]);
  await clickItem('really merge?');
  expect(harness.effects.map(e => e.effect)).toEqual(['mr:merge']);
});
```

Run (from `apps/board`): `bun test src/client/board/__tests__/row-menu-flyouts-dom.test.tsx`
Expected: FAIL (no flyouts rendered yet).

- [ ] **Step 3: Implement the rendering**

In `ActionMenu.tsx`:

1. Replace `SECTIONS` with:

```tsx
const FLAT_SECTIONS: Array<[Section, string]> = [
  ['agent', 'agent actions'],
  ['gitlab', 'gitlab'],
  ['slack', 'slack'],
];

const FLYOUTS: Array<[Section, string, ActionGlyph]> = [
  ['sessions', 'sessions and reports', { kind: 'menu', name: 'file' }],
  ['gitlab', 'gitlab', { kind: 'menu', name: 'branch' }],
  ['slack', 'slack', { kind: 'slack' }],
  ['more', 'more', { kind: 'menu', name: 'note' }],
];

const isReaction = (e: MenuEntry) => /^(un)?react-/.test(e.key);
```

2. Add `flat?: boolean` to the props (documented as "Render every section inline under its heading, as the bulk menu does").
3. Replace the final `return (...)` with a shared item renderer and the two layouts:

```tsx
  const renderItem = (e: MenuEntry) => (
    <ContextMenu.Item
      key={e.key}
      label={entryLabel(e, e.confirm && armed === armKey(e) ? e.confirm : e.label)}
      hint={hintOf(e)}
      trailing={trailingOf(e)}
      disabled={!!e.blocked || pending.includes(e.key)}
      onClick={click(e)}
    />
  );
  const shell = (body: React.ReactNode) => (
    <ContextMenu key="items" x={x} y={y} ariaLabel={`actions for ${subject}`} onClose={onClose}>
      <ContextMenu.Label>{subject}</ContextMenu.Label>
      {entries.length === 0 && empty && (
        <div className="tui-menu-empty" aria-live="polite">
          {emptyNote}
        </div>
      )}
      {body}
    </ContextMenu>
  );

  if (flat)
    return shell(
      FLAT_SECTIONS.map(([section, title]) => {
        const items = entries.filter(e => e.section === section);
        if (!items.length) return null;
        return (
          <Fragment key={section}>
            {section !== 'agent' && <ContextMenu.Separator />}
            <ContextMenu.Label>{title}</ContextMenu.Label>
            {items.map(renderItem)}
          </Fragment>
        );
      })
    );

  const top = entries.filter(e => e.section === 'top');
  const reactions = top.filter(isReaction);
  const agentItems = entries.filter(e => e.section === 'agent');
  const flyouts = FLYOUTS.map(([section, title, glyph]) => ({
    section,
    title,
    glyph,
    items: entries.filter(e => e.section === section),
  })).filter(f => f.items.length);

  return shell(
    <>
      {reactions.length > 0 && (
        <ContextMenu.Row aria-label="slack reactions">
          {reactions.map(e => (
            <ContextMenu.Item
              key={e.key}
              label={e.glyph ? glyphNode(e.glyph) : e.label}
              aria-label={e.label}
              title={e.label}
              aria-pressed={!!e.marked}
              trailing={
                pending.includes(e.key) ? (
                  <span className="tui-menu-spin" aria-label="working" />
                ) : undefined
              }
              disabled={pending.includes(e.key)}
              onClick={click(e)}
            />
          ))}
        </ContextMenu.Row>
      )}
      {top.filter(e => !isReaction(e)).map(renderItem)}
      {agentItems.length > 0 && (
        <>
          {top.length > 0 && <ContextMenu.Separator />}
          <ContextMenu.Label>agent actions</ContextMenu.Label>
          {agentItems.map(renderItem)}
        </>
      )}
      {flyouts.length > 0 && (top.length > 0 || agentItems.length > 0) && (
        <ContextMenu.Separator />
      )}
      {flyouts.map(f =>
        f.items.length === 1 ? (
          renderItem(f.items[0]!)
        ) : (
          <ContextMenu.Sub
            key={f.section}
            label={iconLabel(glyphNode(f.glyph), f.title)}
            ariaLabel={`${f.title} for ${subject}`}
          >
            {f.items.map(renderItem)}
          </ContextMenu.Sub>
        )
      )}
    </>
  );
```

4. Update the component's doc comment: "draws a list of entries as a short top level (reactions, agent actions) with the rest in flyouts, or every section inline when `flat`".
5. In `Board.tsx`, add `flat` to the bulk `<ActionMenu ... />` (the one with `subject={`${selectedMrs.length} selected`}`).
6. If `apps/board/src/client` has CSS that styles `.tui-menu-emoji` for the old full-width rows, check the reaction row still reads right; adjust only spacing there.

- [ ] **Step 4: Run every menu test, then fix the old expectations**

Run (from `apps/board`): `bun test src/client/board/__tests__/`
Expected: `row-menu-flyouts-dom.test.tsx` PASS. `row-menu-pins-dom.test.tsx`, `row-menu-ask-dom.test.tsx` and `bulk-menu-dom.test.tsx` may fail where they pinned the old flat layout or an omitted row. Update each failing expectation to the new layout, one test at a time, checking each against the spec's placement table:

- `row-menu-ask-dom.test.tsx` "engaged peers and an outstanding ask hide the item": rename to "...block the item" and assert the `request review from…` row is present, disabled, and contains `ask already sent`.
- `row-menu-ask-dom.test.tsx` "no respond ask without a commented review of mine": assert the row is present, disabled, and contains `no finished review with comments`.
- Pins in `row-menu-pins-dom.test.tsx` (`clickEach` output): the new order is the flattened top level then each flyout; blocked rows now appear and report `(nothing) (stays open)`.
- `bulk-menu-dom.test.tsx`: a single-row right-click now shows flyouts, so open the flyout (or call `clickItem`, which opens it) before clicking a gitlab or slack item. The bulk menu itself must be unchanged; if a bulk expectation changes, that is a bug in Task 5's bulk fold, not an expectation to update.

- [ ] **Step 5: Run the full board suite and typecheck**

Run (from `apps/board`): `bun test`; then from repo root: `bun run board:typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/client/board/ActionMenu.tsx apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__
git commit -m "board: row menu flyouts and the reaction row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verify in the browser and refresh captures

**Files:**
- Modify (only if the capture compare flags the menu): `apps/board/tests/baselines/*`

- [ ] **Step 1: Run the repo gates**

Run (from repo root): `bun run check`
Expected: PASS. Fix anything it flags in the files this plan touched.

- [ ] **Step 2: Serve a fixture board**

Run (from `apps/board`): `bun run build`, then start the fixture board on a free port the way `tests/capture.ts` does (read its header for the command and the `PORT=` variable). Never open a `*.mattstack` URL.

- [ ] **Step 3: Look at it in both schemes**

With Fast Browser (`fast-browser:browser-driver` agent), on `http://localhost:<port>`:

1. Right-click one of your own MRs. Screenshot the top level, then hover each flyout (sessions and reports, gitlab, slack, more) and screenshot each.
2. Right-click a teammate's MR and screenshot it.
3. Right-click an MR near the right edge of the window, open a flyout, and confirm it flips left and stays on screen.
4. Toggle a reaction in the reaction row and confirm the menu stays open and the toggle shows as pressed.
5. Repeat 1 and 2 in dark mode.

Say plainly what looks wrong (contrast of disabled rows and their reasons, the chevron, the pressed reaction, alignment of the reaction row, flyout overlap with the menu border). Fix and re-shoot until nothing does.

- [ ] **Step 4: Refresh capture baselines if the menu is in them**

Run (from `apps/board`): `bun run capture:compare`. If only the row menu changed, run `bun run capture:baseline` and commit the new baselines; any other diff is a regression to fix first.

- [ ] **Step 5: Commit**

```bash
git add apps/board/tests/baselines
git commit -m "board: refresh captures for the row menu flyouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Skip this commit if no baseline changed.)
