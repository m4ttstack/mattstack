# Console settings rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the settings row's three trailing controls and the explain modal with one disclosure per row that opens a Value | Where it's set panel, and keep a thin modal around the same panel for run detail.

**Architecture:** The explain modal's body moves into a new `KeyPanel` (tabs, the layer list, issues, diverged, repos). `SettingRow` becomes a clickable disclosure that hosts `KeyPanel` inline; `ExplainModal` shrinks to a header plus `KeyPanel` for run detail. The row's control and editor body are computed once by a new `useRowParts` hook that both hosts share. The page keeps one open row, mirrored to `?explain=` with `replace`.

**Tech Stack:** React 19, Mantine 9.5 through `@mattstack/app-kit`, CSS modules, wouter, vitest + Testing Library, Storybook 10, Fast Browser for parity.

**Spec:** `docs/superpowers/specs/2026-10-01-console-settings-row-design.md`. Boards: `docs/apps/design/console/settings.pen` (`B · Expand in place (approved row)`, `B4 · Tabs back, calmer (approved 2026-10-01)`, `R · Run detail keeps a thin modal`), renders in `docs/apps/design/console/renders/`.

## Global Constraints

- Follow `docs/apps/ui-authoring.md` strictly. Kit component first; the ladder is props (`size` `sm` or larger) then a CSS module through `classNames` for layout only, then stop and ask. No NEW inline `style` or `styles` objects, no `.mantine-*` selectors. On a kit control, colour comes only from `color` / `variant`.
- Hover is the guide's `.row` pattern: `--row-hover` is `var(--mantine-color-gray-1)` in light and `var(--mantine-color-dark-5)` in dark, `:hover` inside `@media (hover: hover)`, `:focus-within` outside it. Never React hover state.
- Tokens by role only. Muted text uses the file's existing `useSchemeColors()` roles (`text.muted`); status text `var(--tk-text-ok-small)` with a `var(--tk-text-ok-vivid)` glyph, `var(--tk-text-warn-small)`, `var(--tk-text-bad-small)`. No `c="dimmed"`, no raw values.
- Font weights 400 / 500 / 700 only. Every `Text` states its size (`fz`).
- Before using a Mantine component or prop you have not used in this session, look it up (Mantine MCP `get_item_props` / `get_item_doc`, or the installed `@mantine/core` `.d.ts`). Never guess a prop.
- Scope names stay `default / team / user / machine`.
- Keep these accessible names and test ids stable (other suites depend on them): `layer-<scope>`, `layer-value-<scope>`, `set <key> at <layer>`, `cancel editing <key> at <layer>`, `remove <key> from <layer>`, `open <file>`, `Close modal`, `data-key` on each row.
- Comments only for constraints the code cannot show (`~/.claude/rules/clean-code-comments.md`). No em or en dashes anywhere, code comments included.
- Commit after each task with the message given, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run everything from the worktree root `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/luthien`. Console tests: `bun run console:test`; one file: `cd apps/console && bunx vitest run src/app/settings/<File>.test.tsx`.

## Review Focus

1. A click inside a row's own control (typing in an input, toggling a switch, picking an option from a select whose dropdown renders in a portal) must not open or close the row. Pinned in Task 3.
2. Escape inside an editor, a menu or a listbox in the open panel abandons that edit and leaves the row open; Escape anywhere else in the panel closes the row. Pinned in Task 3.
3. A `?explain=` link to a key the current filter hides must still show that key (the filter clears). Pinned in Task 4.
4. A write that rt refuses while a row is open keeps the row open and shows the refusal. Pinned in Task 3.
5. Opening a second row closes the first, and closing a row after a Fix that switched repo keeps that repo picked. Pinned in Task 4.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `apps/console/src/app/settings/PanelToolbar.tsx` | create | Slot context: an editor header rendered inside the Value tab moves onto the tab bar |
| `apps/console/src/app/settings/ModeToggle.tsx` | modify | Form \| JSON at `size="sm"` |
| `apps/console/src/app/settings/DraftEditor.tsx` | modify | Header row wrapped in `PanelToolbar` |
| `apps/console/src/app/settings/CompositeControls.tsx` | modify | `LiveHeader` in `PanelToolbar` (Task 1); summary text instead of toggle, body always built, unframed `Body` (Task 3) |
| `apps/console/src/app/settings/view.ts` | modify | `ROW_CONTROLS`, `ESCAPE_OWNERS`, `moveTargets` |
| `apps/console/src/app/settings/ScopeBadge.tsx` | modify | A grey `default` badge and dot |
| `apps/console/src/app/settings/rowParts.tsx` | create | `useRowParts` (control column + editor body) and `ValueContent` |
| `apps/console/src/app/settings/KeyPanel.tsx` + `.module.css` | create | Tabs, Where it's set (layer lines, actions, issues, diverged, repos) |
| `apps/console/src/app/settings/ExplainModal.tsx` + `.module.css` | rewrite | Thin modal: header (key, badge, close on one line, description) + `KeyPanel` |
| `apps/console/src/app/settings/SettingRow.tsx` + `.module.css` | rewrite | Clickable disclosure hosting `KeyPanel` |
| `apps/console/src/app/settings/RowMenu.tsx`, `ExpandToggle.tsx` | delete | Replaced by the panel |
| `apps/console/src/app/settings/explainParam.ts` | rewrite | `useOpenRow`: the one open row in `?explain=` / `?tab=` / `?fix=` |
| `apps/console/src/app/settings/SettingsSection.tsx`, `SettingsPage.tsx` | modify | Open-row wiring, deep-link reveal, no modal |
| `apps/console/src/app/settings/SettingsRows.stories.tsx` | create | Board fixtures for the parity pass |
| tests | create / migrate | see each task |

---

### Task 1: The Value tab's toolbar slot

**Files:**
- Create: `apps/console/src/app/settings/PanelToolbar.tsx`
- Create: `apps/console/src/app/settings/PanelToolbar.test.tsx`
- Modify: `apps/console/src/app/settings/ModeToggle.tsx` (the `size` prop)
- Modify: `apps/console/src/app/settings/DraftEditor.tsx` (the header `Group` at the top of the returned `Stack`)
- Modify: `apps/console/src/app/settings/CompositeControls.tsx` (`LiveHeader`)

**Interfaces:**
- Produces: `PanelToolbarSlot` (React context of `HTMLElement | null`), `PanelToolbar({ children })`.

- [ ] **Step 1: Write the failing test**

`apps/console/src/app/settings/PanelToolbar.test.tsx`:

```tsx
import { useState } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PanelToolbar, PanelToolbarSlot } from './PanelToolbar';

function WithSlot() {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div ref={setSlot} data-testid="slot" />
      <div data-testid="body">
        <PanelToolbarSlot.Provider value={slot}>
          <PanelToolbar>
            <span>Editing the machine layer</span>
          </PanelToolbar>
        </PanelToolbarSlot.Provider>
      </div>
    </>
  );
}

describe('PanelToolbar', () => {
  it('renders in place with no slot', () => {
    renderWithProviders(
      <div data-testid="body">
        <PanelToolbar>
          <span>Editing the machine layer</span>
        </PanelToolbar>
      </div>
    );
    expect(
      within(screen.getByTestId('body')).getByText('Editing the machine layer')
    ).toBeInTheDocument();
  });

  it('moves into the slot when one is provided', () => {
    renderWithProviders(<WithSlot />);
    expect(
      within(screen.getByTestId('slot')).getByText('Editing the machine layer')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('body')).queryByText('Editing the machine layer')
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/console && bunx vitest run src/app/settings/PanelToolbar.test.tsx`
Expected: FAIL, cannot resolve `./PanelToolbar`.

- [ ] **Step 3: Implement**

`apps/console/src/app/settings/PanelToolbar.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The tab bar's right end while the Value tab shows. Null everywhere
    else, so an editor's header stays where the editor draws it. */
export const PanelToolbarSlot = createContext<HTMLElement | null>(null);

export function PanelToolbar({ children }: { children: ReactNode }) {
  const slot = useContext(PanelToolbarSlot);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
```

In `ModeToggle.tsx` change `size="xs"` to `size="sm"` (the guide raises an `xs` in a touched file to `sm`).

In `DraftEditor.tsx`, import `PanelToolbar` and wrap the header row so the returned tree starts:

```tsx
    <Stack ref={root} gap={10} onKeyDown={onKeyDown}>
      <PanelToolbar>
        <Group justify="space-between" wrap="nowrap" gap={8}>
          {/* existing hint, fit message, replaceWith button and ModeToggle, unchanged */}
        </Group>
      </PanelToolbar>
```

In `CompositeControls.tsx`, wrap `LiveHeader`'s returned `Group` the same way:

```tsx
function LiveHeader({ row, onJson }: { row: Row; onJson: () => void }) {
  const { text } = useSchemeColors();
  const team = useSettingsTeam();
  return (
    <PanelToolbar>
      <Group justify="space-between" wrap="nowrap" gap={8} pt={4} pb={6}>
        <Text fz={12} c={text.muted}>
          {`Editing the ${targetLabel(row.target, team)} layer`}
        </Text>
        <ModeToggle value="form" onChange={m => m === 'json' && onJson()} />
      </Group>
    </PanelToolbar>
  );
}
```

React events still bubble through the portal to the editor's `onKeyDown`, so Escape handling is unchanged.

- [ ] **Step 4: Run the new test and the editor suites**

Run: `cd apps/console && bunx vitest run src/app/settings/PanelToolbar.test.tsx src/app/settings/JsonEditor.test.tsx src/app/settings/CompositeControls.test.tsx src/app/settings/ItemCards.test.tsx src/app/settings/NamedSections.test.tsx`
Expected: PASS (no slot is provided anywhere yet, so every editor renders as before).

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/settings/PanelToolbar.tsx apps/console/src/app/settings/PanelToolbar.test.tsx apps/console/src/app/settings/ModeToggle.tsx apps/console/src/app/settings/DraftEditor.tsx apps/console/src/app/settings/CompositeControls.tsx
git commit -m "console settings: editor headers can move onto a panel tab bar"
```

---

### Task 2: KeyPanel, and the thin run-detail modal around it

**Files:**
- Modify: `apps/console/src/app/settings/view.ts` (append helpers)
- Modify: `apps/console/src/app/settings/ScopeBadge.tsx`
- Create: `apps/console/src/app/settings/rowParts.tsx`
- Modify: `apps/console/src/app/settings/SettingRow.tsx` (use `useRowParts`; behaviour unchanged)
- Create: `apps/console/src/app/settings/KeyPanel.tsx`, `KeyPanel.module.css`
- Rewrite: `apps/console/src/app/settings/ExplainModal.tsx`; create `ExplainModal.module.css`
- Create: `apps/console/src/app/settings/KeyPanel.test.tsx`
- Migrate: `ExplainModal.test.tsx`, `Diverged.test.tsx`, `FixFlow.test.tsx` (its "Fix in the explain modal" block), `JsonEditor.test.tsx` (its modal cases)

**Interfaces:**
- Consumes: `PanelToolbarSlot` (Task 1).
- Produces:
  - `view.ts`: `ROW_CONTROLS: string`, `ESCAPE_OWNERS: string`, `moveTargets(def: SettingDefWire): StoreScope[]`.
  - `ScopeBadge.tsx`: `ScopeBadge({ scope }: { scope: LayerScope | 'default'; bare?: boolean })`, `ScopeDot({ scope }: { scope: StoreScope | 'default' })`.
  - `rowParts.tsx`: `interface RowParts { control: ReactNode; body: ReactNode; perRepo: boolean }`, `useRowParts(def, row, opts: { suggestions?: string[]; open: boolean; onToggle: () => void; asJson: boolean; setAsJson: (on: boolean) => void }): RowParts` (Task 3 removes `open` and `onToggle`), `ValueContent({ def, parts }: { def: SettingDefWire; parts: RowParts })`.
  - `KeyPanel.tsx`: `type PanelTab = 'value' | 'where'`, `type PanelStore = RowStore & Pick<ConsoleStore, 'prune'>`, `Suggested`, `KeyPanel(props: { def: SettingDefWire; store: PanelStore; tab: PanelTab; onTab: (tab: PanelTab) => void; value: ReactNode; fix?: string | null; onChanged?: () => void; onPickRepo?: (repo: string) => void })`.
  - `ExplainModal.tsx`: same exported props as today (`settingKey`, `store?`, `fix?`, `onClose`, `onChanged?`, `onPickRepo?`) and `ExplainStore`.

- [ ] **Step 1: Helpers in `view.ts`**

Append to `apps/console/src/app/settings/view.ts`:

```ts
/** A click that starts inside one of these belongs to the control it hit,
    never to the row around it. Options and listboxes render in a portal but
    still bubble through React to the row. */
export const ROW_CONTROLS =
  'input, textarea, select, button, a, label, [role="switch"], [role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"], [contenteditable="true"]';

/** Escape here abandons an edit or closes a menu, never the row or modal
    around it. */
export const ESCAPE_OWNERS =
  'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]';

/** Where the value in effect may move. settings-kit moves global layers
    only, and a move re-sets the value at its target, which would reject a
    value rt already refused. */
export function moveTargets(def: SettingDefWire): StoreScope[] {
  const from = def.effective.scope;
  const base = rungBase(from);
  const stored =
    def.key !== APPROVAL_KEY &&
    Boolean(def.writable && base && def.scopes.includes(base));
  if (!stored || def.effective.invalid !== undefined || isRung(from)) return [];
  return (def.scopes as StoreScope[]).filter(
    s => s !== from && isStoreScope(s)
  );
}
```

Add a test to `view.test.ts`:

```ts
describe('moveTargets', () => {
  const base = {
    key: 'board.agent.model',
    type: 'string',
    scopes: ['team', 'user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: '',
    hasDefault: false,
    defaultValue: null,
    storeVersion: 1,
  } as const;
  it('offers the other allowed store layers', () => {
    expect(
      moveTargets({ ...base, scopes: [...base.scopes], effective: { scope: 'user', file: '/u', value: 'x' } })
    ).toEqual(['team', 'machine']);
  });
  it('offers nothing for a rejected value, a repo rung, or nothing stored', () => {
    const at = (effective: SettingDefWire['effective']) =>
      moveTargets({ ...base, scopes: [...base.scopes], effective });
    expect(at({ scope: 'user', file: '/u', invalid: 'bad' })).toEqual([]);
    expect(at({ scope: 'machine.repo', file: '/m', value: 'x' })).toEqual([]);
    expect(at({ scope: null, file: null })).toEqual([]);
  });
});
```

Run: `cd apps/console && bunx vitest run src/app/settings/view.test.ts` (add the `moveTargets` and `SettingDefWire` imports). Expected: PASS.

- [ ] **Step 2: A `default` badge**

Rewrite `ScopeBadge.tsx` so `default` draws like the others in grey. The two existing inline style objects are pre-existing; hoist them to constants so no new inline object appears:

```tsx
import { Badge, Box } from '@mattstack/app-kit/core';

import { useSettingsTeam } from './useConsoleSettings';
import { layerLabel, rungBase, type LayerScope, type StoreScope } from './view';

export const SCOPE_COLOR: Record<StoreScope, string> = {
  team: 'purple',
  user: 'cyan',
  machine: 'accent',
};

type BadgeBase = StoreScope | 'default';

const hueOf = (s: BadgeBase) => (s === 'default' ? 'gray' : SCOPE_COLOR[s]);
const textOf = (s: BadgeBase) =>
  s === 'default'
    ? 'var(--tk-text-3)'
    : `var(--tk-text-${SCOPE_COLOR[s]}-small)`;

const BADGE_STYLE = {
  '--badge-height': '17px',
  '--badge-fz': '12px',
  '--badge-padding-x': '6px',
  paddingInlineStart: 5,
};
const BADGE_STYLES = { section: { marginInlineEnd: 4 } };

export function ScopeDot({ scope }: { scope: BadgeBase }) {
  return (
    <Box
      component="span"
      w={6}
      h={6}
      style={{
        display: 'inline-block',
        borderRadius: '50%',
        flex: 'none',
        background: `var(--mantine-color-${hueOf(scope)}-filled)`,
      }}
    />
  );
}

/** `bare` leaves the team's name off, for a fixed-width column a long slug
    would truncate. */
export function ScopeBadge({
  scope,
  bare = false,
}: {
  scope: LayerScope | 'default';
  bare?: boolean;
}) {
  const base: BadgeBase = scope === 'default' ? 'default' : rungBase(scope)!;
  const named = useSettingsTeam();
  const team = bare ? null : named;
  return (
    <Badge
      variant="light"
      color={hueOf(base)}
      radius="sm"
      tt="none"
      fw={500}
      lts={0}
      c={textOf(base)}
      leftSection={<ScopeDot scope={base} />}
      style={BADGE_STYLE}
      styles={BADGE_STYLES}
    >
      {scope === 'default' ? 'default' : layerLabel(scope, team)}
    </Badge>
  );
}
```

(`ScopeDot`'s inline style is pre-existing and unchanged apart from the hue lookup. List it, `BADGE_STYLE` and `BADGE_STYLES` in the task report as authoring-guide stragglers for Matt; do not restyle them here.)

- [ ] **Step 3: Extract `useRowParts`**

Create `apps/console/src/app/settings/rowParts.tsx` by MOVING the control/body computation out of `SettingRow.tsx` (today's `let control ... let body ... if (perRepo) ... else { compositeParts(...) }` block) unchanged in behaviour:

```tsx
import type { ReactNode } from 'react';
import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  formatValue,
  rowKind,
  SHAPES,
  summarize,
} from '@mattstack/settings-kit/shapes';

import { compositeParts } from './CompositeControls';
import { ScalarControl } from './ScalarControl';
import { useSettingsRepo } from './useConsoleSettings';
import type { useRowSave } from './useRowSave';
import { APPROVAL_KEY, rungBase, rungOf } from './view';

type Row = ReturnType<typeof useRowSave>;

export interface RowParts {
  control: ReactNode;
  body: ReactNode;
  perRepo: boolean;
}

export function useRowParts(
  def: SettingDefWire,
  row: Row,
  opts: {
    suggestions?: string[];
    open: boolean;
    onToggle: () => void;
    asJson: boolean;
    setAsJson: (on: boolean) => void;
  }
): RowParts {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  const kind = rowKind(def);
  // With no repo picked, every write here would be a global one, which a
  // repo-only key refuses; the repo reach beside the name says where it is set.
  const perRepo = def.repoOnly === true && repo === null;

  let control: ReactNode;
  let body: ReactNode = null;
  if (perRepo) {
    control = (
      <Text fz={12} c={text.muted}>
        set per repo
      </Text>
    );
  } else if (def.key === APPROVAL_KEY) {
    const hash =
      typeof def.effective.value === 'string' ? def.effective.value : null;
    const at = rungBase(def.effective.scope) ? def.effective.scope : null;
    control = (
      <Group gap={8} wrap="nowrap">
        {hash && (
          <Text fz={12} ff="monospace" c={text.muted}>
            {hash.slice(0, 12)}
          </Text>
        )}
        {hash && at && def.writable && (
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => void row.clear(at)}
          >
            Revoke
          </Button>
        )}
      </Group>
    );
  } else if (kind === 'scalar' || kind === 'enum') {
    control = (
      <ScalarControl
        def={def}
        writeScope={rungOf(row.target.scope, row.target.repo ?? null)}
        onSave={v => void row.save(v)}
        suggestions={opts.suggestions}
      />
    );
  } else if (kind === 'external') {
    const shape = SHAPES[def.key];
    const owner = shape?.kind === 'external' ? shape.app : 'another app';
    control = (
      <Text fz={12} c={text.muted}>
        {def.effective.value === undefined
          ? `edited in ${owner}`
          : `${summarize(def)} · edited in ${owner}`}
      </Text>
    );
  } else if (
    kind === 'readonly' &&
    def.type !== 'object' &&
    def.type !== 'array'
  ) {
    // An unset or rejected value is already said by the source text or the
    // error line; the control repeats nothing.
    const shown = def.secret
      ? def.effective.scope === null
        ? null
        : '•••'
      : def.effective.value === undefined
        ? null
        : formatValue(def.effective.value);
    control =
      shown === null ? null : (
        <Text fz={12} c={text.muted} ff="monospace">
          {shown}
        </Text>
      );
  } else {
    const composite = compositeParts(
      def,
      kind,
      row,
      opts.open,
      opts.onToggle,
      opts.asJson,
      () => opts.setAsJson(false),
      () => opts.setAsJson(true)
    );
    control = composite.control;
    body = composite.body;
  }
  return { control, body, perRepo };
}

/** The Value tab: a composite's editor, or the full description and the
    same control the header shows (the only control inside the modal). */
export function ValueContent({
  def,
  parts,
}: {
  def: SettingDefWire;
  parts: RowParts;
}) {
  const { text } = useSchemeColors();
  if (parts.body) return <>{parts.body}</>;
  return (
    <Stack gap={10} px={8}>
      <Text fz={12} c={text.muted}>
        {def.description}
      </Text>
      <Group gap={8} wrap="nowrap">
        {parts.control}
      </Group>
    </Stack>
  );
}
```

Note the Revoke button moves from `compact-xs` to `compact-sm` (guide rung 1). In `SettingRow.tsx`, delete the moved block and its now-unused imports, and replace it with:

```tsx
  const parts = useRowParts(def, row, {
    suggestions,
    open,
    onToggle: () => setOpen(o => !o),
    asJson,
    setAsJson,
  });
  const control = parts.control;
  const body = parts.body;
  const perRepo = parts.perRepo;
  // A global source label ("unset", "default") says nothing about a key
  // that only lives in repo sections; the repo reach carries it instead.
  const plain = perRepo ? null : sourceText(def);
```

Run: `cd apps/console && bunx vitest run src/app/settings/SettingRow.test.tsx src/app/settings/SpecialRows.test.tsx src/app/settings/CompositeControls.test.tsx`
Expected: PASS, except any assertion on the Revoke button size if one exists (update it to `compact-sm`).

- [ ] **Step 4: Write the KeyPanel tests (failing)**

`apps/console/src/app/settings/KeyPanel.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeyPanel, type PanelStore, type PanelTab } from './KeyPanel';
import { PanelToolbar } from './PanelToolbar';
import { schemaFields } from './testSchemas';
import { SettingsRepoContext, SettingsTeamContext } from './useConsoleSettings';

const explainGet = vi.fn();
vi.stubGlobal('fetch', (url: string) =>
  url.startsWith('/api/settings/explain/')
    ? explainGet(url)
    : Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not found' }) })
);
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
afterEach(() => explainGet.mockReset());

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key,
    type: 'string',
    scopes: ['team', 'user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'What it does.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: '/stores/user.jsonc', value: 'm-user' },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

const LAYERS: ExplainRowWire[] = [
  { scope: 'default', file: null, present: true, value: 'm-default' },
  { scope: 'team', file: '/stores/team.jsonc', present: false },
  { scope: 'user', file: '/stores/user.jsonc', present: true, value: 'm-user' },
  { scope: 'machine', file: '/stores/local.jsonc', present: false },
];

function store(over: Partial<PanelStore> = {}): PanelStore {
  return {
    set: vi.fn(async () => null as string | null),
    unset: vi.fn(async () => null as string | null),
    move: vi.fn(async () => null as string | null),
    prune: vi.fn(async () => null as string | null),
    ...over,
  };
}

function renderPanel(
  d: SettingDefWire,
  rows: ExplainRowWire[],
  opts: { s?: PanelStore; tab?: PanelTab; team?: string; repo?: string; value?: React.ReactNode } = {}
) {
  explainGet.mockResolvedValue(ok({ def: d, rows }));
  const s = opts.s ?? store();
  const onTab = vi.fn();
  renderWithProviders(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsTeamContext.Provider value={opts.team ?? null}>
        <SettingsRepoContext.Provider value={opts.repo ?? null}>
          <KeyPanel
            def={d}
            store={s}
            tab={opts.tab ?? 'where'}
            onTab={onTab}
            value={opts.value ?? <div>value tab</div>}
          />
        </SettingsRepoContext.Provider>
      </SettingsTeamContext.Provider>
    </QueryClientProvider>
  );
  return { s, onTab };
}

describe('KeyPanel', () => {
  it('shows the tab it is given and reports a switch', async () => {
    const { onTab } = renderPanel(def('board.agent.model'), LAYERS, { tab: 'value' });
    expect(screen.getByText('value tab')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: "Where it's set" }));
    expect(onTab).toHaveBeenCalledWith('where');
  });

  it('puts the Value tab’s editor header on the tab bar', () => {
    renderPanel(def('board.agent.model'), LAYERS, {
      tab: 'value',
      value: <PanelToolbar><span>Editing the user layer</span></PanelToolbar>,
    });
    expect(
      within(screen.getByTestId('panel-toolbar')).getByText('Editing the user layer')
    ).toBeInTheDocument();
  });

  it('marks the winner in effect and mutes what it overrides', async () => {
    renderPanel(def('board.agent.model'), LAYERS);
    expect(await screen.findByText('Weakest first. The last layer set wins.')).toBeInTheDocument();
    const user = await screen.findByTestId('layer-user');
    expect(within(user).getByText('in effect')).toBeInTheDocument();
    expect(screen.getByTestId('layer-value-user')).toHaveAttribute('data-role', 'winner');
    expect(screen.getByTestId('layer-value-default')).toHaveAttribute('data-role', 'overridden');
  });

  it('a deep-merge key marks every contributing layer merged', async () => {
    const d = def('rt.homeSnapshot', {
      type: 'object',
      merge: 'deep',
      effective: { scope: 'machine', file: '/stores/local.jsonc', value: { enabled: true } },
    });
    renderPanel(d, [
      { scope: 'default', file: null, present: true, value: { enabled: false } },
      { scope: 'team', file: '/stores/team.jsonc', present: false },
      { scope: 'user', file: '/stores/user.jsonc', present: true, value: { debounceSec: 5 } },
      { scope: 'machine', file: '/stores/local.jsonc', present: true, value: { enabled: true } },
    ]);
    expect(await screen.findByText('Merged key by key. Lists replace whole.')).toBeInTheDocument();
    expect(within(screen.getByTestId('layer-user')).getByText('merged')).toBeInTheDocument();
    expect(within(screen.getByTestId('layer-machine')).getByText('merged')).toBeInTheDocument();
    expect(screen.getByTestId('layer-value-machine')).not.toHaveTextContent('{');
  });

  it('hides a layer the key does not allow', async () => {
    renderPanel(def('board.agent.model', { scopes: ['user', 'machine'] }), LAYERS);
    await screen.findByTestId('layer-user');
    expect(screen.queryByTestId('layer-team')).toBeNull();
  });

  it('a stray value at a layer the key does not allow says so and offers no actions', async () => {
    const d = def('board.agent.model', { scopes: ['user', 'machine'] });
    renderPanel(d, [
      ...LAYERS.slice(0, 1),
      { scope: 'team', file: '/stores/team.jsonc', present: true, value: 'stray' },
      ...LAYERS.slice(2),
    ]);
    const team = await screen.findByTestId('layer-team');
    expect(within(team).getByText('not allowed here')).toBeInTheDocument();
    expect(within(team).queryByRole('button', { name: /^remove / })).toBeNull();
  });

  it('offers moves from the value in effect to the other layers the key allows', async () => {
    const { s } = renderPanel(def('board.agent.model'), LAYERS);
    const user = await screen.findByTestId('layer-user');
    await userEvent.click(within(user).getByRole('button', { name: 'move board.agent.model from user' }));
    expect(screen.getByRole('menuitem', { name: 'Move to team' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to machine' }));
    expect(s.move).toHaveBeenCalledWith('board.agent.model', 'user', 'machine');
    expect(within(screen.getByTestId('layer-default')).queryByRole('button', { name: /^move / })).toBeNull();
  });

  it('a rejected stored value can be removed but not moved', async () => {
    renderPanel(
      def('board.agent.model', { effective: { scope: 'user', file: '/stores/user.jsonc', invalid: 'bad' } }),
      [LAYERS[0]!, LAYERS[1]!, { ...LAYERS[2]!, invalid: 'bad' }, LAYERS[3]!]
    );
    const user = await screen.findByTestId('layer-user');
    expect(within(user).queryByRole('button', { name: /^move / })).toBeNull();
    expect(within(user).getByRole('button', { name: 'remove board.agent.model from user' })).toBeInTheDocument();
  });

  it('names the team in Remove and Move when the page knows it', async () => {
    renderPanel(
      def('board.agent.model', { effective: { scope: 'team', file: '/stores/team.jsonc', value: 'm-team' } }),
      [LAYERS[0]!, { scope: 'team', file: '/stores/team.jsonc', present: true, value: 'm-team' }, LAYERS[3]!],
      { team: 'acme' }
    );
    const team = await screen.findByTestId('layer-team');
    expect(within(team).getByRole('button', { name: 'remove board.agent.model from team (acme)' })).toBeInTheDocument();
  });

  it('labels Remove from a global layer "(all repos)" when a repo is picked', async () => {
    renderPanel(
      def('rt.worktreeCwd', { repoScoped: true, effective: { scope: 'machine', file: '/stores/local.jsonc', value: '/x' } }),
      [{ scope: 'default', file: null, present: false }, { scope: 'machine', file: '/stores/local.jsonc', present: true, value: '/x' }],
      { repo: 'gitlab.example.com/acme/app' }
    );
    expect(
      await screen.findByRole('button', { name: 'remove rt.worktreeCwd from machine (all repos)' })
    ).toBeInTheDocument();
  });

  it('a value from a repo rung can be removed but not moved', async () => {
    renderPanel(
      def('rt.worktreeCwd', { repoScoped: true, effective: { scope: 'machine.repo', file: '/stores/local.jsonc', value: '/x' } }),
      [{ scope: 'default', file: null, present: false }, { scope: 'machine.repo', file: '/stores/local.jsonc', present: true, value: '/x' }],
      { repo: 'gitlab.example.com/acme/app' }
    );
    const rung = await screen.findByTestId('layer-machine.repo');
    expect(within(rung).queryByRole('button', { name: /^move / })).toBeNull();
    expect(within(rung).getByRole('button', { name: 'remove rt.worktreeCwd from machine · repo' })).toBeInTheDocument();
  });

  it("shows rt's refusal of a move under the layers", async () => {
    renderPanel(def('board.agent.model'), LAYERS, { s: store({ move: vi.fn(async () => 'store is read-only') }) });
    const user = await screen.findByTestId('layer-user');
    await userEvent.click(within(user).getByRole('button', { name: 'move board.agent.model from user' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to machine' }));
    expect(await screen.findByText('store is read-only')).toBeInTheDocument();
  });

  it('links each set layer to its file; the registry default has no link', async () => {
    renderPanel(def('board.agent.model'), LAYERS);
    const user = await screen.findByTestId('layer-user');
    expect(within(user).getByRole('link', { name: 'open /stores/user.jsonc' })).toBeInTheDocument();
    expect(within(screen.getByTestId('layer-default')).queryByRole('link')).toBeNull();
  });

  it('re-reads the stack after a remove', async () => {
    const { s } = renderPanel(def('board.agent.model'), LAYERS);
    await userEvent.click(await screen.findByRole('button', { name: 'remove board.agent.model from user' }));
    expect(s.unset).toHaveBeenCalledWith('board.agent.model', 'user');
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
  });
});
```

Run: `cd apps/console && bunx vitest run src/app/settings/KeyPanel.test.tsx`
Expected: FAIL, cannot resolve `./KeyPanel`.

- [ ] **Step 5: Implement `KeyPanel`**

`apps/console/src/app/settings/KeyPanel.module.css`:

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.caption {
  padding: 0 8px 6px;
}

.line {
  border-radius: var(--mantine-radius-md);
}

:where([data-mantine-color-scheme='light']) .line {
  --row-hover: var(--mantine-color-gray-1);
}

:where([data-mantine-color-scheme='dark']) .line {
  --row-hover: var(--mantine-color-dark-5);
}

.actions {
  width: 0;
  overflow: hidden;
  opacity: 0;
}

@media (hover: hover) {
  .line:hover {
    background-color: var(--row-hover);
  }
  .line:hover .actions {
    width: auto;
    overflow: visible;
    opacity: 1;
  }
}

.line:focus-within {
  background-color: var(--row-hover);
}

.line:focus-within .actions,
.line[data-editing] .actions {
  width: auto;
  overflow: visible;
  opacity: 1;
}

@media (hover: none) {
  .actions {
    width: auto;
    overflow: visible;
    opacity: 1;
  }
}

.scope {
  flex: none;
  width: 132px;
}

.value {
  flex: 1;
  min-width: 0;
}

.sub {
  padding: 0 8px 8px 152px;
}

.reposHead {
  padding: 22px 8px 6px;
}
```

`apps/console/src/app/settings/KeyPanel.tsx`: move `modelProvider`, `Catalog`, `Suggested` (now exported), `layerDef`, `RepoSection` and `ExplainBody` out of `ExplainModal.tsx`. `ExplainBody` becomes `WhereTab`: drop the `SettingRow` at its top, the verdict sentence, the `onRead`/"as of" plumbing and the `>_` title; keep every other line (the fresh-def merge, `written`/`tracked`, `roleOf`, `diverged`, `onLayer`, `replaceWithFor`, `stale`, `reportedFor`, the prune flow, the secret alert, the Repos section). Replace `LayerLine` and add `Status`, `KeyPanel`:

```tsx
export type PanelTab = 'value' | 'where';
export type PanelStore = RowStore & Pick<ConsoleStore, 'prune'>;

type Role = 'winner' | 'overridden' | 'contributor' | 'inert';

const STATUS: Partial<Record<Role, string>> = {
  winner: 'in effect',
  contributor: 'merged',
};

function Status({ role, row }: { role: Role; row: ExplainRowWire }) {
  const said = STATUS[role];
  return (
    <Group gap={8} wrap="nowrap">
      {row.shadowed && (
        <Text fz={12} c="var(--tk-text-warn-small)">
          ignored, teamLocked
        </Text>
      )}
      {row.invalid && (
        <Text fz={12} c="var(--tk-text-bad-small)">
          refused
        </Text>
      )}
      {said && (
        <Group gap={4} wrap="nowrap">
          <Icons.check size={12} color="var(--tk-text-ok-vivid)" />
          <Text fz={12} c="var(--tk-text-ok-small)">
            {said}
          </Text>
        </Group>
      )}
    </Group>
  );
}

function LayerLine({
  def,
  row,
  role,
  busy,
  onSet,
  onRemove,
  onMove,
  startEditing = false,
  replaceWith,
  reported,
}: {
  def: SettingDefWire;
  row: ExplainRowWire;
  role: Role;
  busy: boolean;
  onSet: (scope: string, value: unknown) => Promise<boolean>;
  onRemove: (scope: string) => Promise<boolean>;
  onMove: (from: string, to: string) => Promise<boolean>;
  startEditing?: boolean;
  replaceWith?: { label: string; value: unknown };
  reported?: SchemaIssue[];
}) {
  const { text } = useSchemeColors();
  const editorHref = useEditorHref();
  const team = useSettingsTeam();
  const repo = useSettingsRepo();
  const scope = row.scope;
  const store = rungBase(scope);
  const label = store ? layerLabel(scope as LayerScope, team) : null;
  const removeLabel = `${label}${
    repo && def.repoScoped && isStoreScope(scope) ? ' (all repos)' : ''
  }`;
  const allowed = store !== null && def.scopes.includes(store);
  const writable = allowed && def.writable && !def.secret;
  const kind = rowKind(def);
  const edit = editorKind(def);
  const composite = def.type === 'object' || def.type === 'array';
  // console never edits this key here: it is revoked from /settings, not
  // set through a free-text control.
  const editable =
    def.key !== APPROVAL_KEY &&
    !(def.repoOnly && !isRung(scope)) &&
    writable &&
    (composite ? EDITOR_KINDS.has(edit) : kind === 'scalar' || kind === 'enum');
  const moves = writable && scope === def.effective.scope ? moveTargets(def) : [];
  // Fix seeds editing open only when the row is editable; a row with no
  // console control keeps Remove as its only remedy.
  const [editing, setEditing] = useState(startEditing && editable);
  // Only the editor Fix opened scrolls to its bad field; a reopen does not.
  const [reveal, setReveal] = useState(startEditing);
  useEffect(() => {
    if (!editing) setReveal(false);
  }, [editing]);
  const [saved, setSaved] = useState(false);
  // Close on the re-read, not the write, so the old value never flashes.
  useEffect(() => {
    if (!saved) return;
    setSaved(false);
    setEditing(false);
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  let value: ReactNode;
  if (editing && store && !composite)
    value = (
      <Suggested settingKey={def.key}>
        {suggestions => (
          <ScalarControl
            def={layerDef(def, row)}
            writeScope={scope}
            suggestions={suggestions}
            onSave={v =>
              void (v === undefined ? onRemove(scope) : onSet(scope, v)).then(
                ok => ok && setSaved(true)
              )
            }
          />
        )}
      </Suggested>
    );
  else if (editing && composite)
    value = (
      <Text fz={12} c={text.muted}>
        editing below
      </Text>
    );
  else if (!row.present)
    value = (
      <Text fz={13} c={text.muted}>
        not set
      </Text>
    );
  else if (def.secret)
    value = (
      <Text fz={13} c={text.muted}>
        present, never shown here
      </Text>
    );
  else
    value = (
      <Text
        fz={13}
        ff="monospace"
        truncate
        fw={role === 'winner' ? 500 : undefined}
        c={role === 'overridden' || role === 'inert' ? text.muted : undefined}
        data-role={role}
        data-testid={`layer-value-${scope}`}
      >
        {composite ? rowSummary(layerDef(def, row)) : shortValue(row.value)}
      </Text>
    );

  const issues = editing && composite ? [] : (reported ?? row.nonconforming ?? []);
  const stray = row.present && store !== null && !allowed;
  const offerOlder = replaceWith && !composite && editable && store;
  const subs = Boolean(row.invalid) || issues.length > 0 || stray || Boolean(offerOlder);

  return (
    <Box className={classes.line} mod={{ editing }} data-testid={`layer-${scope}`}>
      <Group gap={12} wrap="nowrap" mih={38} px={8}>
        <Box className={classes.scope}>
          {store ? (
            <ScopeBadge scope={scope as LayerScope} bare />
          ) : scope === 'default' ? (
            <ScopeBadge scope="default" />
          ) : (
            <Text fz={12} fw={500} c={text.muted}>
              {scope}
            </Text>
          )}
        </Box>
        <Box className={classes.value}>{value}</Box>
        <Status role={role} row={row} />
        <Group gap={2} wrap="nowrap" className={classes.actions}>
          {row.file !== null && (
            <Tooltip label={`Open ${row.file}`}>
              <ActionIcon
                component="a"
                href={editorHref(row.file)}
                variant="subtle"
                color="gray"
                aria-label={`open ${row.file}`}
              >
                <Icons.externalLink size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          {editable && store && (
            <Tooltip label={editing ? 'Cancel' : `Set at ${label}`}>
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={busy}
                aria-label={
                  editing
                    ? `cancel editing ${def.key} at ${label}`
                    : `set ${def.key} at ${label}`
                }
                onClick={() => setEditing(e => !e)}
              >
                {editing ? <Icons.close size={14} /> : <Icons.edit size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
          {moves.length > 0 && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  disabled={busy}
                  aria-label={`move ${def.key} from ${label}`}
                >
                  <Icons.arrowRight size={14} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {moves.map(to => (
                  <Menu.Item
                    key={to}
                    leftSection={<ScopeDot scope={to} />}
                    onClick={() => void onMove(scope, to)}
                  >
                    {`Move to ${scopeLabel(to, team)}`}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
          {writable && store && row.present && (
            <Tooltip label={`Remove from ${removeLabel}`}>
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={busy}
                aria-label={`remove ${def.key} from ${removeLabel}`}
                onClick={() => void onRemove(scope)}
              >
                <Icons.trash size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      {subs && (
        <Stack gap={2} className={classes.sub}>
          {row.invalid && (
            <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
              {row.invalid}
            </Text>
          )}
          {issues.map((issue, i) => (
            <Text key={i} fz={12} ff="monospace" c="var(--tk-text-warn-small)">
              {issueText(issue)}
            </Text>
          ))}
          {stray && (
            <Text fz={12} c={text.muted}>
              not allowed here
            </Text>
          )}
          {offerOlder && (
            <Group gap={8} wrap="nowrap" py={2}>
              <Text fz={12} c={text.muted}>
                older value{' '}
                <Text span inherit ff="monospace">
                  {JSON.stringify(replaceWith.value)}
                </Text>
              </Text>
              <Button
                size="compact-sm"
                variant="default"
                disabled={busy}
                onClick={() =>
                  void onSet(scope, replaceWith.value).then(ok => ok && setSaved(true))
                }
              >
                {replaceWith.label}
              </Button>
            </Group>
          )}
        </Stack>
      )}
      {editing && composite && store && (
        <Box className={classes.sub}>
          <DraftEditor
            def={def}
            form={formOf(def)}
            initial={row.present ? row.value : undefined}
            targetLabel={layerLabel(scope as LayerScope, team)}
            saving={busy}
            replaceWith={replaceWith}
            reported={reported}
            reveal={reveal}
            onCancel={() => setEditing(false)}
            onSave={v =>
              onSet(scope, v).then(ok => {
                if (ok) setSaved(true);
                return ok;
              })
            }
          />
        </Box>
      )}
    </Box>
  );
}
```

Check before writing: the Mantine 9.5 `Tooltip` + `Menu.Target` pairing is not used here (the move button has no tooltip; its menu says where it goes). Check `ActionIcon` accepts `component="a"` with `href` (polymorphic) in the installed `.d.ts`.

In `WhereTab`'s return, keep the existing order but start with the caption and filter disallowed layers:

```tsx
  const shown = (r: ExplainRowWire) => {
    const base = rungBase(r.scope);
    if (base === null) return true;
    if (!def.scopes.includes(base)) return r.present;
    // A repo-only key's global layers only matter when one holds a stray
    // value to remove.
    return !def.repoOnly || r.present || isRung(r.scope);
  };

  return (
    <Stack gap={0}>
      <Text fz={12} c={text.muted} className={classes.caption}>
        {verdict?.kind === 'composite'
          ? 'Merged key by key. Lists replace whole.'
          : 'Weakest first. The last layer set wins.'}
      </Text>
      {def.secret && (/* the existing secret Alert, unchanged */)}
      {explained.error ? (
        <Alert color="bad" variant="light" mt="md">
          <Text fz={12}>{explained.error}</Text>
        </Alert>
      ) : rows.length === 0 ? (
        <Stack gap={10} pt={12}>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} h={36} />
          ))}
        </Stack>
      ) : (
        rows.filter(shown).map(r => (
          <LayerLine
            key={`${r.scope}:${r.file ?? 'default'}`}
            def={def}
            row={r}
            role={roleOf(r)}
            busy={layers.status === 'saving'}
            onSet={(scope, v) => layers.setAt(scope, v)}
            onRemove={scope => layers.clear(scope)}
            onMove={(from, to) => layers.move(from, to)}
            startEditing={r.scope === fix && r.present}
            replaceWith={replaceWithFor(r)}
            reported={reportedFor(r)}
          />
        ))
      )}
      {/* layers.error, diverged panels, pruneError: unchanged */}
      {/* Repos: the existing block, with the heading Group's inline
          borderBottom style replaced by className={classes.reposHead}
          and the RepoSection's inline borderBottom moved to the same
          module (add a .repo class with border-bottom: 1px solid
          var(--tk-border-soft); padding: 10px 8px) */}
    </Stack>
  );
```

`KeyPanel` itself:

```tsx
export function KeyPanel({
  def,
  store,
  tab,
  onTab,
  value,
  fix,
  onChanged,
  onPickRepo,
}: {
  def: SettingDefWire;
  store: PanelStore;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  value: ReactNode;
  fix?: string | null;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <Stack gap={10}>
      <Group justify="space-between" wrap="nowrap" gap={12}>
        <SegmentedControl
          size="sm"
          aria-label={`${def.key} panel`}
          value={tab}
          onChange={v => onTab(v === 'value' ? 'value' : 'where')}
          data={[
            { value: 'value', label: 'Value' },
            { value: 'where', label: "Where it's set" },
          ]}
        />
        <div ref={setSlot} className={classes.toolbar} data-testid="panel-toolbar" />
      </Group>
      {tab === 'value' ? (
        <PanelToolbarSlot.Provider value={slot}>{value}</PanelToolbarSlot.Provider>
      ) : (
        <WhereTab
          key={def.key}
          def={def}
          store={store}
          fix={fix}
          onChanged={onChanged}
          onPickRepo={onPickRepo}
        />
      )}
    </Stack>
  );
}
```

Imports for `KeyPanel.tsx`: `useEffect, useState, type ReactNode` from react; `ActionIcon, Alert, Box, Button, Group, Menu, SegmentedControl, Skeleton, Stack, Text, Tooltip` from `@mattstack/app-kit/core`; `useSchemeColors`; `Icons`; `ExplainRowWire, SettingDefWire`; `rowKind, type SchemaIssue`; `analyzeChain, shortValue` from `../config/chain`; `useAgentModels` from `../config/useSettings`; `useEditorHref` from `../editorHref`; `rowSummary` from `./CompositeControls`; `DivergedPanel`; `DraftEditor`; `editorKind, formOf`; `isDiverged, issueText, type WireIssue`; `JsonBlock`; `classes from './KeyPanel.module.css'`; `PanelToolbarSlot`; `ScalarControl`; `ScopeBadge, ScopeDot`; `useKeyExplain, useSettingsRepo, useSettingsTeam, type ConsoleStore`; `useRowSave, type RowStore`; from `./view`: `APPROVAL_KEY, EDITOR_KINDS, isRung, isStoreScope, layerLabel, moveTargets, repoLabel, rungBase, scopeLabel, type LayerScope`.

- [ ] **Step 6: Rewrite `ExplainModal` as the thin shell (board R)**

`apps/console/src/app/settings/ExplainModal.module.css`:

```css
.head {
  flex: 1;
  min-width: 0;
}
```

`apps/console/src/app/settings/ExplainModal.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Divider,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import classes from './ExplainModal.module.css';
import { KeyPanel, Suggested, type PanelStore, type PanelTab } from './KeyPanel';
import { useRowParts, ValueContent } from './rowParts';
import { ScopeBadge } from './ScopeBadge';
import {
  SettingsTeamContext,
  useConsoleSettings,
  type ConsoleStore,
} from './useConsoleSettings';
import { useRowSave } from './useRowSave';
import { badgeScope, ESCAPE_OWNERS, splitKey } from './view';

export type ExplainStore = Pick<
  ConsoleStore,
  'defs' | 'loading' | 'error' | 'set' | 'unset' | 'move' | 'prune'
>;

const MODAL_WIDTH = 760;

function notifying(store: PanelStore, onChanged?: () => void): PanelStore {
  if (!onChanged) return store;
  const then = (err: string | null) => {
    onChanged();
    return err;
  };
  return {
    set: (...a: Parameters<PanelStore['set']>) => store.set(...a).then(then),
    unset: (...a: Parameters<PanelStore['unset']>) => store.unset(...a).then(then),
    move: (...a: Parameters<PanelStore['move']>) => store.move(...a).then(then),
    prune: (...a: Parameters<PanelStore['prune']>) => store.prune(...a).then(then),
  };
}

function Header({ settingKey, def }: { settingKey: string; def?: SettingDefWire }) {
  const { text } = useSchemeColors();
  const [ns, name] = splitKey(settingKey);
  const scope = def ? badgeScope(def, null) : null;
  return (
    <Modal.Header>
      <Stack gap={4} className={classes.head}>
        <Group gap={8} wrap="nowrap">
          <Modal.Title>
            <Text span fz={15} ff="monospace">
              <Text span inherit c={text.muted}>
                {ns}
              </Text>
              <Text span inherit fw={500}>
                {name}
              </Text>
            </Text>
          </Modal.Title>
          {scope && <ScopeBadge scope={scope} />}
          <Modal.CloseButton ml="auto" aria-label="Close modal" />
        </Group>
        {def && (
          <Text fz={12} c={text.muted}>
            {def.description}
          </Text>
        )}
      </Stack>
    </Modal.Header>
  );
}

function Detail({
  def,
  store,
  suggestions,
  fix,
  onChanged,
  onPickRepo,
}: {
  def: SettingDefWire;
  store: PanelStore;
  suggestions?: string[];
  fix?: string | null;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const writes = useMemo(() => notifying(store, onChanged), [store, onChanged]);
  const row = useRowSave(writes, def);
  const [asJson, setAsJson] = useState(false);
  const [tab, setTab] = useState<PanelTab>('where');
  const parts = useRowParts(def, row, {
    suggestions,
    open: true,
    onToggle: () => {},
    asJson,
    setAsJson,
  });
  return (
    <KeyPanel
      def={def}
      store={store}
      tab={tab}
      onTab={setTab}
      value={<ValueContent def={def} parts={parts} />}
      fix={fix}
      onChanged={onChanged}
      onPickRepo={onPickRepo}
    />
  );
}

function Resolved({
  settingKey,
  store,
  fix,
  onChanged,
  onPickRepo,
}: {
  settingKey: string;
  store: ExplainStore;
  fix?: string | null;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const def = store.defs.find(d => d.key === settingKey);
  return (
    <>
      <Header settingKey={settingKey} def={def} />
      <Divider />
      <Modal.Body pt="md">
        {def ? (
          <Suggested settingKey={def.key}>
            {suggestions => (
              <Detail
                key={def.key}
                def={def}
                store={store}
                suggestions={suggestions}
                fix={fix}
                onChanged={onChanged}
                onPickRepo={onPickRepo}
              />
            )}
          </Suggested>
        ) : store.error ? (
          <Alert color="bad" variant="light">
            <Text fz={12}>{store.error}</Text>
          </Alert>
        ) : store.loading ? (
          <Stack gap={10}>
            <Skeleton h={36} />
            <Skeleton h={36} />
            <Skeleton h={36} />
          </Stack>
        ) : (
          <Text fz={14} c={text.muted}>
            {`No setting named ${settingKey} is registered.`}
          </Text>
        )}
      </Modal.Body>
    </>
  );
}

function OwnStore(props: {
  settingKey: string;
  fix?: string | null;
  onChanged?: () => void;
}) {
  const store = useConsoleSettings(null, props.settingKey);
  return (
    <SettingsTeamContext.Provider value={store.team}>
      <Resolved {...props} store={store} />
    </SettingsTeamContext.Provider>
  );
}

/** Keeps the last open key through the close transition, so the modal
    fades out with its content instead of emptying first. */
function useLastKey(key: string | null): string | null {
  const last = useRef(key);
  if (key !== null) last.current = key;
  return last.current;
}

/** One key's panel over another page (run detail). With a `store`, writes
    land in the caller's store; without one it loads the key itself and
    reports writes through `onChanged`. */
export function ExplainModal({
  settingKey,
  store,
  fix,
  onClose,
  onChanged,
  onPickRepo,
}: {
  settingKey: string | null;
  store?: ExplainStore;
  fix?: string | null;
  onClose: () => void;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const key = useLastKey(settingKey);
  const opened = settingKey !== null;
  // Mantine's own Escape fires first, from any focused field or open menu;
  // there Escape abandons the edit or closes the menu, not the modal.
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(ESCAPE_OWNERS)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, onClose]);

  return (
    <Modal.Root
      opened={opened}
      onClose={onClose}
      closeOnEscape={false}
      size={MODAL_WIDTH}
    >
      <Modal.Overlay />
      <Modal.Content>
        {key !== null &&
          (store ? (
            <Resolved
              settingKey={key}
              store={store}
              fix={fix}
              onChanged={onChanged}
              onPickRepo={onPickRepo}
            />
          ) : (
            <OwnStore settingKey={key} fix={fix} onChanged={onChanged} />
          ))}
      </Modal.Content>
    </Modal.Root>
  );
}
```

Check the Mantine 9.5 compound names (`Modal.Root`, `Modal.Overlay`, `Modal.Content`, `Modal.Header`, `Modal.Title`, `Modal.CloseButton`, `Modal.Body`) and that `@mattstack/app-kit/core` re-exports `Modal` with them (Mantine MCP `get_item_doc` for Modal). If the kit's `Modal` is a shadow without them, stop and report.

- [ ] **Step 7: Run the new tests**

Run: `cd apps/console && bunx vitest run src/app/settings/KeyPanel.test.tsx`
Expected: PASS.

- [ ] **Step 8: Migrate the modal-based suites**

`ExplainModal.test.tsx`, `Diverged.test.tsx`, the "Fix in the explain modal" block of `FixFlow.test.tsx`, and the modal cases in `JsonEditor.test.tsx` keep rendering `ExplainModal`, which now opens on Where it's set. Apply these rules, test by test; never delete a test unless its subject is gone, and say which in the task report:

| Old assertion | New assertion |
|---|---|
| `>_ rt settings explain <key>` in the dialog | `within(dialog).getByText('<name part of key>')` (the header) |
| `findByTestId('explain-sentence')` and its text | delete the sentence assertion; assert the caption (`Weakest first. The last layer set wins.` or `Merged key by key. Lists replace whole.`) |
| `getByText('wins')` in a layer | `getByText('in effect')` |
| `getByText('contributes')` | `getByText('merged')` |
| `toHaveStyle({ textDecoration: 'line-through' })` on an overridden value | `toHaveAttribute('data-role', 'overridden')` |
| `'not allowed at this layer (allowed: ...)'` | the layer is absent: `queryByTestId('layer-<scope>')` is null (a stray value shows `not allowed here`) |
| a composite layer's full JSON (`JsonBlock`) | the layer's summary (`rowSummary` text, for example `2 entries`); the full value is reached with `set <key> at <layer>` |
| editing through the settings row at the top of the modal | first `await userEvent.click(screen.getByRole('radio', { name: 'Value' }))`, then the same control |
| `getByRole('link', { name: 'open <file>' })` | unchanged (the open-file action is a link) |

Example, the old "renders the settings row, the verdict and every layer" becomes:

```tsx
  it('renders the header and every layer', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    renderModal(store());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('model')).toBeInTheDocument();
    expect(within(dialog).getByText(DEF.description)).toBeInTheDocument();
    expect(
      await within(dialog).findByText('Weakest first. The last layer set wins.')
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId('layer-value-user')).toHaveAttribute(
      'data-role',
      'overridden'
    );
    expect(
      within(within(dialog).getByTestId('layer-machine')).getByText('in effect')
    ).toBeInTheDocument();
    expect(within(dialog).queryByTestId('layer-team')).toBeNull();
  });
```

Add one shell test to `ExplainModal.test.tsx`:

```tsx
  it('puts the key and the close button on one line, with the scope badge', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    renderModal(store());
    const close = await screen.findByRole('button', { name: 'Close modal' });
    const title = screen.getByText('model').closest('div');
    expect(title).toContainElement(close);
    expect(within(title as HTMLElement).getByText('machine')).toBeInTheDocument();
  });
```

Run: `cd apps/console && bunx vitest run src/app/settings`
Expected: PASS. `runs/EffectiveInputs.test.tsx` too: `cd apps/console && bunx vitest run src/app/runs/EffectiveInputs.test.tsx`, PASS.

- [ ] **Step 9: Typecheck and lint**

Run: `bun run console:typecheck && bun run console:lint`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add apps/console/src/app/settings
git commit -m "console settings: KeyPanel with Value | Where it's set; the explain modal is a thin shell around it"
```

---

### Task 3: The row is one disclosure

**Files:**
- Rewrite: `apps/console/src/app/settings/SettingRow.tsx`; create `SettingRow.module.css`
- Modify: `apps/console/src/app/settings/rowParts.tsx` (drop `open`, `onToggle`)
- Modify: `apps/console/src/app/settings/CompositeControls.tsx` (`compositeParts`, `Body`, `UnsetSummary`)
- Modify: `apps/console/src/app/settings/ExplainModal.tsx` (`Detail` drops `open`, `onToggle`)
- Delete: `apps/console/src/app/settings/RowMenu.tsx`, `apps/console/src/app/settings/ExpandToggle.tsx`
- Migrate: `SettingRow.test.tsx`, `CompositeControls.test.tsx`, `SpecialRows.test.tsx`, `ItemCards.test.tsx`, `NamedSections.test.tsx`, `JsonEditor.test.tsx`

**Interfaces:**
- Consumes: `KeyPanel`, `PanelStore`, `PanelTab` (Task 2); `useRowParts`, `ValueContent` (Task 2); `ROW_CONTROLS`, `ESCAPE_OWNERS` (Task 2).
- Produces: `interface RowOpen { tab: PanelTab; fix: string | null }`; `SettingRow` props `{ def; store: PanelStore; subhead; query; suggestions?; onFix?; open?: RowOpen | null; defaultOpen?: RowOpen | null; onOpenChange?: (next: RowOpen | null) => void; onPickRepo?: (repo: string) => void }` (no `onExplain`, `fullDescription`, `hideIssue`). `useRowParts(def, row, { suggestions?, asJson, setAsJson })`. `compositeParts(def, kind, row, asJson, onDoneJson, onEditJson)`.

- [ ] **Step 1: Write the failing row tests**

Add to `SettingRow.test.tsx` (update its `store()` helper to include `prune: vi.fn(async () => null as string | null)`, and stub `fetch` for `/api/settings/explain/` the way `KeyPanel.test.tsx` does, returning `{ def, rows: [] }`):

```tsx
describe('SettingRow disclosure', () => {
  const scalar = () =>
    def('board.agent.model', {
      effective: { scope: 'user', file: '/u', value: 'm-1' },
    });

  it('a click anywhere on the row opens it; a second click closes it', async () => {
    renderWithProviders(<SettingRow def={scalar()} store={store()} subhead={null} query="" />);
    await userEvent.click(screen.getByText('What it does.'));
    expect(screen.getByRole('radio', { name: "Where it's set" })).toBeChecked();
    await userEvent.click(screen.getByText('What it does.'));
    expect(screen.queryByRole('radio', { name: "Where it's set" })).toBeNull();
  });

  it('a click inside the control never toggles the row', async () => {
    renderWithProviders(<SettingRow def={scalar()} store={store()} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('textbox', { name: 'board.agent.model' }));
    expect(screen.queryByRole('radio', { name: 'Value' })).toBeNull();
  });

  it('picking an enum option from its dropdown does not toggle the row', async () => {
    renderWithProviders(
      <SettingRow
        def={def('agent.provider', { effective: { scope: null, file: null } })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'agent.provider' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }));
    expect(screen.queryByRole('radio', { name: 'Value' })).toBeNull();
  });

  it('the chevron is the keyboard door', async () => {
    renderWithProviders(<SettingRow def={scalar()} store={store()} subhead={null} query="" />);
    const chevron = screen.getByRole('button', { name: 'open board.agent.model' });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    chevron.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'close board.agent.model' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a composite row opens on Value and shows its summary as text, not a toggle', async () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: { scope: 'machine', file: '/m', value: { enabled: true, debounceSec: 5, pushDelaySec: 1, janitorThresholdHours: 2, janitorIntervalMin: 3 } },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'open rt.homeSnapshot' }));
    expect(screen.getByRole('radio', { name: 'Value' })).toBeChecked();
  });

  it('Escape in a field keeps the row open; Escape elsewhere in the panel closes it', async () => {
    renderWithProviders(<SettingRow def={scalar()} store={store()} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('button', { name: 'open board.agent.model' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Value' }));
    const inputs = screen.getAllByRole('textbox', { name: 'board.agent.model' });
    inputs[1]!.focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('radio', { name: 'Value' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'close board.agent.model' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('radio', { name: 'Value' })).toBeNull();
  });

  it('a refused write keeps the row open and shows the refusal', async () => {
    const s = { ...store(), set: vi.fn(async () => 'store is read-only') };
    renderWithProviders(<SettingRow def={scalar()} store={s} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('button', { name: 'open board.agent.model' }));
    const input = screen.getByRole('textbox', { name: 'board.agent.model' });
    await userEvent.clear(input);
    await userEvent.type(input, 'm-2{Enter}');
    expect(await screen.findByText('store is read-only')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: "Where it's set" })).toBeInTheDocument();
  });

  it('has no actions menu and no explain button', () => {
    renderWithProviders(<SettingRow def={scalar()} store={store()} subhead={null} query="" />);
    expect(screen.queryByRole('button', { name: /actions$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^explain / })).toBeNull();
  });

  it('a controlled row follows its prop and reports the next state', async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <SettingRow def={scalar()} store={store()} subhead={null} query="" open={null} onOpenChange={onOpenChange} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'open board.agent.model' }));
    expect(onOpenChange).toHaveBeenCalledWith({ tab: 'where', fix: null });
    expect(screen.queryByRole('radio', { name: 'Value' })).toBeNull();
  });
});
```

(The enum test needs `agent.provider` to render as a select in this suite; it already does in "labels the provider options by product name". If the option name differs, use the one that test uses.)

Run: `cd apps/console && bunx vitest run src/app/settings/SettingRow.test.tsx`
Expected: the new block FAILS (no disclosure yet).

- [ ] **Step 2: Composite rows show a summary and always build their body**

In `CompositeControls.tsx`:

```tsx
function Summary({ label }: { label: string }) {
  const { text } = useSchemeColors();
  return (
    <Text fz={12} c={text.muted}>
      {label}
    </Text>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <Stack gap={0} px={8}>
      {children}
    </Stack>
  );
}
```

Delete `UnsetSummary` (use `<Summary label="unset" />`) and the `ExpandToggle` import. Change `compositeParts` to drop `open` and `onToggle`:

```tsx
export function compositeParts(
  def: SettingDefWire,
  kind: RowKind,
  row: Row,
  asJson: boolean,
  onDoneJson: () => void,
  onEditJson: () => void
): { control: ReactNode; body: ReactNode } {
  const shape = recognize(def.schema);
  const value = def.effective.value;
  const summary = <Summary label={summarize(def)} />;
  const readonly =
    (value === undefined && !def.secret) || def.effective.scope === null
      ? { control: <Summary label="unset" />, body: null }
      : { control: summary, body: <ReadonlyBody def={def} /> };
  const summaryOf = () => (
    <Summary label={value === undefined ? 'unset' : rowSummary(def)} />
  );
  // ...the rest of the function unchanged, except:
  //   every `toggle` becomes `summary`,
  //   every `toggleOf(open)` becomes `summaryOf()`,
  //   every `open ? <X ... /> : null` becomes `<X ... />`.
}
```

In `rowParts.tsx`, drop `open` and `onToggle` from the options type and the `compositeParts` call. In `ExplainModal.tsx`'s `Detail`, drop `open: true` and `onToggle: () => {}`.

- [ ] **Step 3: Rewrite `SettingRow`**

`apps/console/src/app/settings/SettingRow.module.css`:

```css
.item {
  border-bottom: 1px solid var(--tk-border-soft);
}

.item[data-open] {
  margin-block: 8px;
  border: 1px solid var(--tk-border);
  border-radius: var(--mantine-radius-lg);
}

.header {
  cursor: pointer;
  border-radius: var(--mantine-radius-md);
}

:where([data-mantine-color-scheme='light']) .header {
  --row-hover: var(--mantine-color-gray-1);
}

:where([data-mantine-color-scheme='dark']) .header {
  --row-hover: var(--mantine-color-dark-5);
}

@media (hover: hover) {
  .item:not([data-open]) .header:hover {
    background-color: var(--row-hover);
  }
}

.item:not([data-open]) .header:focus-within {
  background-color: var(--row-hover);
}

.text {
  flex: 1;
  min-width: 0;
}

.control {
  flex: none;
}

.panel {
  padding: 0 12px 12px;
}
```

`apps/console/src/app/settings/SettingRow.tsx`:

```tsx
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ActionIcon,
  Box,
  Collapse,
  Group,
  Highlight,
  Stack,
  Text,
  type TextProps,
} from '@mattstack/app-kit/core';
import { useSchemeColors, useUncontrolled } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { IssueLines } from './IssueLines';
import type { WireIssue } from './issues';
import { KeyPanel, type PanelStore, type PanelTab } from './KeyPanel';
import { RepoReach } from './RepoReach';
import { useRowParts, ValueContent } from './rowParts';
import classes from './SettingRow.module.css';
import { ScopeBadge } from './ScopeBadge';
import { useRowSave } from './useRowSave';
import {
  APPROVAL_KEY,
  badgeScope,
  ESCAPE_OWNERS,
  firstSentence,
  ROW_CONTROLS,
  sourceText,
  splitKey,
  type StoreScope,
} from './view';

export interface RowOpen {
  tab: PanelTab;
  fix: string | null;
}

function Marked({
  text,
  query,
  ...props
}: { text: string; query: string } & Omit<TextProps, 'color'>) {
  return query.trim() === '' ? (
    <Text {...props}>{text}</Text>
  ) : (
    <Highlight
      {...props}
      highlight={query.trim()}
      highlightStyles={{
        backgroundColor: 'var(--mantine-color-warn-light)',
        color: 'inherit',
      }}
    >
      {text}
    </Highlight>
  );
}

export function SettingRow({
  def,
  store,
  subhead,
  query,
  suggestions,
  onFix,
  open: openProp,
  defaultOpen = null,
  onOpenChange,
  onPickRepo,
}: {
  def: SettingDefWire;
  store: PanelStore;
  subhead: StoreScope | null;
  query: string;
  suggestions?: string[];
  onFix?: (key: string, issue: WireIssue | null) => void;
  open?: RowOpen | null;
  defaultOpen?: RowOpen | null;
  onOpenChange?: (next: RowOpen | null) => void;
  onPickRepo?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const row = useRowSave(store, def);
  const [open, setOpen] = useUncontrolled<RowOpen | null>({
    value: openProp,
    defaultValue: defaultOpen,
    finalValue: null,
    onChange: onOpenChange,
  });
  const [asJson, setAsJson] = useState(false);
  // A closed row starts fresh: JSON mode chosen in one opening must not
  // resurface on the next.
  useEffect(() => {
    if (!open) setAsJson(false);
  }, [open]);
  const parts = useRowParts(def, row, { suggestions, asJson, setAsJson });
  const [ns, name] = splitKey(def.key);
  const badge = badgeScope(def, subhead);
  const plain = parts.perRepo ? null : sourceText(def);

  const toggle = () =>
    setOpen(open ? null : { tab: parts.body ? 'value' : 'where', fix: null });
  const onHeader = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(ROW_CONTROLS)) return;
    toggle();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest(ESCAPE_OWNERS)) return;
    e.preventDefault();
    setOpen(null);
  };

  return (
    <Box
      data-key={def.key}
      className={classes.item}
      mod={{ open: open !== null }}
      onKeyDown={onKey}
    >
      <Group
        gap={24}
        wrap="nowrap"
        py={12}
        px={12}
        className={classes.header}
        onClick={onHeader}
      >
        <Stack gap={4} className={classes.text}>
          <Group gap={8} wrap="nowrap">
            <Text fz={14} lh="18px" ff="monospace" span>
              <Text span inherit c={text.muted}>
                {ns}
              </Text>
              <Marked text={name} query={query} span inherit fw={500} />
            </Text>
            {badge ? (
              <ScopeBadge scope={badge} />
            ) : plain ? (
              <Text fz={12} c={text.muted}>
                {plain}
              </Text>
            ) : null}
            <RepoReach def={def} />
          </Group>
          {def.key === APPROVAL_KEY ? (
            <Text fz={12} lh="15px" c={text.muted} data-testid="approval-note">
              {"approves the team's worktree "}
              <Text span inherit ff="monospace">
                ready
              </Text>
              {' commands by their hash; approve with '}
              <Text span inherit ff="monospace">
                rt worktree ready-approve
              </Text>
            </Text>
          ) : (
            <Marked
              text={firstSentence(def.description)}
              query={query}
              fz={12}
              lh="15px"
              c={text.muted}
              lineClamp={1}
            />
          )}
        </Stack>
        <Group w={260} gap={8} wrap="nowrap" className={classes.control}>
          {parts.control}
          {row.status === 'saving' && (
            <Text fz={12} c={text.muted}>
              saving…
            </Text>
          )}
          {row.status === 'saved' && (
            <Group gap={4} wrap="nowrap">
              <Text fz={12} c="var(--tk-text-ok-small)">
                saved
              </Text>
              <Icons.check size={12} color="var(--tk-text-ok-vivid)" />
            </Group>
          )}
        </Group>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-expanded={open !== null}
          aria-label={`${open ? 'close' : 'open'} ${def.key}`}
          onClick={toggle}
        >
          {open ? <Icons.chevronUp size={16} /> : <Icons.chevronDown size={16} />}
        </ActionIcon>
      </Group>
      {(row.error || (def.effective.invalid && def.issues === undefined)) && (
        <Stack gap={4} px={12} pb={12}>
          {row.error && (
            <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
              {row.error}
            </Text>
          )}
          {def.effective.invalid && def.issues === undefined && (
            <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
              stored value rejected: {def.effective.invalid}
            </Text>
          )}
        </Stack>
      )}
      <IssueLines def={def} onFix={onFix && (issue => onFix(def.key, issue))} />
      <Collapse expanded={open !== null}>
        {open && (
          <Box className={classes.panel}>
            <KeyPanel
              def={def}
              store={store}
              tab={open.tab}
              onTab={tab => setOpen({ ...open, tab })}
              value={<ValueContent def={def} parts={parts} />}
              fix={open.fix}
              onPickRepo={onPickRepo}
            />
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
```

Check before writing: `useUncontrolled`'s option names in the installed `@mantine/hooks` (`value`, `defaultValue`, `finalValue`, `onChange`), `Collapse`'s open prop in 9.5 (`expanded`, as today's code uses), and `Box`'s `mod`. An `IssueLines` without `hide` must still render as it did for the page.

Delete `RowMenu.tsx` and `ExpandToggle.tsx`.

- [ ] **Step 4: Run the new tests**

Run: `cd apps/console && bunx vitest run src/app/settings/SettingRow.test.tsx`
Expected: the disclosure block PASSES; older cases that used the menu or the explain button fail until Step 5.

- [ ] **Step 5: Migrate the row suites**

| Old | New |
|---|---|
| `getByRole('button', { name: '<key> actions' })` then a menu item | open the row (`open <key>` chevron), switch to Where it's set if it opened on Value, then the layer's action: `move <key> from <layer>` + `Move to <layer>`, or `remove <key> from <layer>`. The move/remove semantics tests already live in `KeyPanel.test.tsx` (Task 2); a `SettingRow` test that only re-checked them is deleted and named in the report. |
| `queryByRole('button', { name: /actions$/ })` is null | delete (no menu exists); where the test meant "no remove offered", assert in the panel that `remove <key> from` is absent |
| `explain <key>` button present / absent | delete both cases (covered by "has no actions menu and no explain button") |
| clicking the composite toggle (`2 fields`, `3 of 3 set`, `1 entry`, `unset`) to expand | click `open <key>`; the Value tab is already selected |
| `Edit as JSON` from the menu | open the row, then `getByRole('radio', { name: 'JSON' })` in the Form \| JSON toggle |
| `aria-expanded` on the summary toggle | `aria-expanded` on the `open <key>` / `close <key>` chevron |
| `fullDescription` / `hideIssue` props | remove them from the render call |

Run: `cd apps/console && bunx vitest run src/app/settings`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `bun run console:typecheck && bun run console:lint`
Expected: clean.

```bash
git add -A apps/console/src/app/settings
git commit -m "console settings: each row is one disclosure that opens its panel; no row menu or explain chevron"
```

---

### Task 4: The page keeps one open row

**Files:**
- Rewrite: `apps/console/src/app/settings/explainParam.ts`
- Modify: `apps/console/src/app/settings/SettingsSection.tsx`, `apps/console/src/app/settings/SettingsPage.tsx`
- Migrate: `SettingsPage.test.tsx`, the page-level cases of `FixFlow.test.tsx`

**Interfaces:**
- Consumes: `RowOpen`, `SettingRow` props (Task 3); `PanelTab`, `PanelStore` (Task 2).
- Produces: `interface OpenRow { key: string; tab: PanelTab; fix: string | null }`, `useOpenRow(): { open: OpenRow | null; set: (next: OpenRow | null, opts?: { repo?: string }) => void }`, `explainHref(key)` (unchanged).

- [ ] **Step 1: Write the failing page tests**

Add to `SettingsPage.test.tsx` (it already resets the URL with `window.history.replaceState` and renders through `renderPage()`; add `Element.prototype.scrollIntoView = vi.fn()` in its `beforeEach`, and make its fetch stub answer `/api/settings/explain/` with `{ def, rows: [] }` for the key asked):

```tsx
describe('open rows', () => {
  it('?explain=<key> opens that row on Where it\'s set and scrolls it into view', async () => {
    window.history.replaceState(null, '', '/settings?explain=agent.claude.effort');
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'close agent.claude.effort' })).toBeInTheDocument()
    );
    expect(screen.getByRole('radio', { name: "Where it's set" })).toBeChecked();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('opening a second row closes the first', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'open agent.claude.effort' }));
    await userEvent.click(screen.getByRole('button', { name: 'open agent.claude.model' }));
    expect(screen.getByRole('button', { name: 'open agent.claude.effort' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close agent.claude.model' })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('explain')).toBe('agent.claude.model');
  });

  it('opening a row is not navigation: the history entry is replaced', async () => {
    renderPage();
    const before = window.history.length;
    await userEvent.click(await screen.findByRole('button', { name: 'open agent.claude.effort' }));
    expect(window.history.length).toBe(before);
    await userEvent.click(screen.getByRole('button', { name: 'close agent.claude.effort' }));
    expect(new URLSearchParams(window.location.search).get('explain')).toBeNull();
  });

  it('a link to a key the filter hides clears the filter', async () => {
    window.history.replaceState(null, '', '/settings?q=Prune&explain=agent.claude.effort');
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'close agent.claude.effort' })).toBeInTheDocument()
    );
    expect(screen.getByRole('textbox', { name: 'filter settings' })).toHaveValue('');
  });

  it('mounts no modal', async () => {
    window.history.replaceState(null, '', '/settings?explain=agent.claude.effort');
    renderPage();
    await screen.findByRole('button', { name: 'close agent.claude.effort' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

The key names must exist in this suite's fixture defs; use the keys its other tests use if these differ.

Run: `cd apps/console && bunx vitest run src/app/settings/SettingsPage.test.tsx`
Expected: the new block FAILS.

- [ ] **Step 2: `useOpenRow`**

`apps/console/src/app/settings/explainParam.ts`:

```ts
import { useSearchParams } from 'wouter';

import type { PanelTab } from './KeyPanel';

const PARAM = 'explain';
const TAB = 'tab';
const FIX = 'fix';

export interface OpenRow {
  key: string;
  tab: PanelTab;
  fix: string | null;
}

/** The one open settings row, kept in `?explain=` (with `?tab=value` and
    `?fix=<layer>` when they apply) so a reload or a shared link reopens it.
    Every write replaces the history entry: opening a row is not a page. */
export function useOpenRow() {
  const [params, setParams] = useSearchParams();
  const key = params.get(PARAM);
  const open: OpenRow | null = key
    ? {
        key,
        tab: params.get(TAB) === 'value' ? 'value' : 'where',
        fix: params.get(FIX),
      }
    : null;
  const set = (next: OpenRow | null, opts: { repo?: string } = {}) =>
    setParams(
      prev => {
        const p = new URLSearchParams(prev);
        p.delete(TAB);
        p.delete(FIX);
        if (next) {
          p.set(PARAM, next.key);
          if (next.tab === 'value') p.set(TAB, 'value');
          if (next.fix) p.set(FIX, next.fix);
        } else p.delete(PARAM);
        if (opts.repo) p.set('repo', opts.repo);
        return p;
      },
      { replace: true }
    );
  return { open, set };
}

export function explainHref(key: string): string {
  return `/settings?${PARAM}=${encodeURIComponent(key)}`;
}
```

- [ ] **Step 3: Wire the section and the page**

`SettingsSection.tsx`: replace the `onExplain` prop (in `AgentsSection` and `SettingsSection`) with

```ts
  open: OpenRow | null;
  onOpenChange: (key: string, next: RowOpen | null) => void;
  onPickRepo?: (repo: string) => void;
```

type `store` as `PanelStore`, and render each row with

```tsx
        <SettingRow
          key={def.key}
          def={def}
          store={store}
          subhead={sub.scope}
          query={query}
          onFix={onFix}
          open={open?.key === def.key ? { tab: open.tab, fix: open.fix } : null}
          onOpenChange={next => onOpenChange(def.key, next)}
          onPickRepo={onPickRepo}
        />
```

(the Agents row keeps its `suggestions` prop).

`SettingsPage.tsx`:

- Replace `import { ExplainModal } from './ExplainModal';` and `useExplainParam` with `import { useOpenRow } from './explainParam';`, and `const explain = useExplainParam();` with `const openRow = useOpenRow();`.
- After `clearAll` is declared, add the reveal (a link or a Fix scrolls its row into view; a click on a row does not):

```tsx
  const [reveal, setReveal] = useState<string | null>(
    () => openRow.open?.key ?? null
  );
  useEffect(() => {
    if (store.loading || reveal === null) return;
    const target = Array.from(
      frame.current?.querySelectorAll<HTMLElement>('[data-key]') ?? []
    ).find(el => el.dataset.key === reveal);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      setReveal(null);
    } else if (filtering) clearAll();
    else setReveal(null);
  }, [store.loading, reveal, filtering, sections]); // eslint-disable-line react-hooks/exhaustive-deps
```

- Pass to every `SettingsSection`:

```tsx
                        open={openRow.open}
                        onOpenChange={(key, next) =>
                          openRow.set(next ? { key, ...next } : null)
                        }
                        onPickRepo={setRepo}
                        onFix={(key, issue) => {
                          openRow.set(
                            { key, tab: 'where', fix: issue?.scope ?? null },
                            { repo: issue?.repo }
                          );
                          setReveal(key);
                        }}
```

- Delete the `<ExplainModal ... />` element.

- [ ] **Step 4: Migrate the page-level Fix tests**

In `FixFlow.test.tsx`'s page cases: "Fix ... opens the modal" now asserts the row opened (`close <key>` chevron present, `Where it's set` checked) and the same URL params (`explain`, `fix`, `repo`); "closing the modal after a Fix ..." now clicks `close <key>` and asserts `explain` is gone while `repo` stays. Keep the "Fix in the explain modal" block as migrated in Task 2.

Run: `cd apps/console && bunx vitest run src/app/settings`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run console:typecheck && bun run console:lint`

```bash
git add apps/console/src/app/settings
git commit -m "console settings: one open row on the page, kept in ?explain= with replace; Fix and links reveal it"
```

---

### Task 5: Stories with the boards' content

**Files:**
- Create: `apps/console/src/app/settings/SettingsRows.stories.tsx`

**Interfaces:**
- Consumes: `SettingRow`, `RowOpen` (Task 3), `ExplainModal` (Task 2).
- Produces: stories `Console/Settings/Rows` with ids `console-settings-rows--expand-in-place`, `--where-its-set`, `--run-detail-modal`, used by Task 6.

- [ ] **Step 1: Write the stories**

Every key, description, value, layer and path below is copied from boards B, B4 and R. Do not invent different content: Task 6 compares these renders with the boards.

```tsx
import type { ReactNode } from 'react';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ExplainModal } from './ExplainModal';
import type { PanelStore } from './KeyPanel';
import { SettingRow, type RowOpen } from './SettingRow';
import { TEST_SCHEMAS } from './testSchemas';

const USER = '~/.mattstack/user/settings.user.jsonc';
const LOCAL = '~/.mattstack/user/local/studio-mac/settings.local.jsonc';

const base = {
  type: 'string',
  scopes: ['user', 'machine'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  hasDefault: false,
  defaultValue: null,
  storeVersion: 1,
} as const;

const GITQ_BOARD_SCHEMA = {
  type: 'object',
  properties: {
    repos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, name: { type: 'string' } },
        required: ['path', 'name'],
      },
    },
    port: { type: 'number' },
  },
} as NonNullable<SettingDefWire['schema']>;

const BOARD_VALUE = {
  repos: [
    { path: '~/code/acme/storefront', name: 'storefront' },
    { path: '~/code/mattstack', name: 'gitq' },
  ],
  port: 11008,
};

const DEFS: SettingDefWire[] = [
  { ...base, scopes: [...base.scopes], key: 'agent.claude.model', description: 'Default --model for claude rt agent launches; unset omits the flag.', effective: { scope: 'user', file: USER, value: 'claude-opus-5-5[1m]' } },
  { ...base, scopes: [...base.scopes], key: 'agent.claude.yolo', type: 'boolean', description: 'Default --yolo (--dangerously-skip-permissions) for claude rt agent launches; unset behaves as false.', effective: { scope: null, file: null } },
  { ...base, scopes: ['team', 'user', 'machine'], key: 'rt.worktreeApp', type: 'object', merge: 'deep', description: 'Worktree pool on/off switch (enabled, killProcesses, claudeHook), merged per field.', schema: { type: 'object', properties: { enabled: { type: 'boolean' }, killProcesses: { type: 'boolean' }, claudeHook: { type: 'boolean' } } } as NonNullable<SettingDefWire['schema']>, effective: { scope: 'machine', file: LOCAL, value: { enabled: true, killProcesses: true, claudeHook: true } } },
  { ...base, scopes: [...base.scopes], key: 'gitq.forges', type: 'object', description: "gitq's host-keyed forge config, tokenEnv names only, never a live token.", schema: TEST_SCHEMAS['gitq.forges'], effective: { scope: null, file: null } },
  { ...base, scopes: ['machine'], key: 'gitq.board', type: 'object', merge: 'deep', description: 'gitq checkout-board config: tracked repos, local port, and the herdr workspace it launches into.', schema: GITQ_BOARD_SCHEMA, effective: { scope: 'machine', file: LOCAL, value: BOARD_VALUE } },
  { ...base, scopes: [...base.scopes], key: 'gitq.workspace', description: "Herdr workspace gitq's board launches agent panes into.", hasDefault: true, defaultValue: 'gitq', effective: { scope: 'default', file: null, value: 'gitq' } },
  { ...base, scopes: [...base.scopes], key: 'rt.daemonPath', description: 'Absolute colon-separated PATH the daemon uses for every child it spawns.', effective: { scope: null, file: null } },
  { ...base, scopes: [...base.scopes], key: 'rt.logLevel', description: 'Daemon log level (trace | debug | info | warn | error).', hasDefault: true, defaultValue: 'info', schema: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error'] } as NonNullable<SettingDefWire['schema']>, effective: { scope: 'machine', file: LOCAL, value: 'warn' } },
  { ...base, scopes: [...base.scopes], key: 'rt.runsPruneDays', type: 'number', description: 'Age floor in days for pruning finished pipeline run directories (default 30).', hasDefault: true, defaultValue: 30, effective: { scope: 'default', file: null, value: 30 } },
];

const ROWS: Record<string, ExplainRowWire[]> = {
  'rt.logLevel': [
    { scope: 'default', file: null, present: true, value: 'info' },
    { scope: 'user', file: USER, present: true, value: 'debug' },
    { scope: 'machine', file: LOCAL, present: true, value: 'warn' },
  ],
  'gitq.board': [
    { scope: 'default', file: null, present: false },
    { scope: 'machine', file: LOCAL, present: true, value: BOARD_VALUE },
  ],
};

const store: PanelStore = {
  set: async () => null,
  unset: async () => null,
  move: async () => null,
  prune: async () => null,
};

const def = (key: string) => DEFS.find(d => d.key === key)!;

function stubFetch(real: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const m = /\/api\/settings\/explain\/([^?]+)/.exec(String(input));
    if (!m) return real(input, init);
    const key = decodeURIComponent(m[1]!);
    return new Response(JSON.stringify({ def: def(key), rows: ROWS[key] ?? [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** The settings page's content column at the boards' width. */
function Stage({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <div data-testid="stage" style={{ width: 1040, padding: 0, background: 'var(--tk-card)' }}>
        {children}
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Console/Settings/Rows',
  parameters: { layout: 'padded' },
  beforeEach: () => {
    const real = globalThis.fetch;
    globalThis.fetch = stubFetch(real);
    return () => {
      globalThis.fetch = real;
    };
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const row = (key: string, open: RowOpen | null = null) => (
  <SettingRow key={key} def={def(key)} store={store} subhead={null} query="" defaultOpen={open} />
);

export const ExpandInPlace: Story = {
  render: () => (
    <Stage>
      {row('agent.claude.model')}
      {row('agent.claude.yolo')}
      {row('rt.worktreeApp')}
      {row('gitq.forges')}
      {row('gitq.board', { tab: 'value', fix: null })}
      {row('gitq.workspace')}
    </Stage>
  ),
};

export const WhereItsSet: Story = {
  render: () => (
    <Stage>
      {row('rt.daemonPath')}
      {row('rt.logLevel', { tab: 'where', fix: null })}
      {row('rt.runsPruneDays')}
      {row('gitq.board', { tab: 'value', fix: null })}
      {row('gitq.forges')}
    </Stage>
  ),
};

export const RunDetailModal: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <ExplainModal
        settingKey="rt.logLevel"
        store={{ defs: DEFS, loading: false, error: null, ...store }}
        onClose={() => {}}
      />
    </QueryClientProvider>
  ),
};
```

The `Stage` wrapper's inline `style` is story scaffolding, not app UI (the guide governs app code); keep it, as `GateQuestionnaire.stories.tsx` does. If `gitq.forges` is not in `TEST_SCHEMAS`, take its schema from `testSchemas.ts` by the same key it lists.

- [ ] **Step 2: Check the stories build and render**

Run: `bun run build-storybook 2>&1 | tail -5`
Expected: build succeeds. Then run `bun run storybook` in the background and open `http://localhost:6006/iframe.html?id=console-settings-rows--where-its-set&viewMode=story` once to confirm it renders without a console error (Fast Browser `browser_console_messages`).

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/settings/SettingsRows.stories.tsx
git commit -m "console settings: stories with the boards' content for the parity pass"
```

---

### Task 6: Strict visual parity (controller only, never a subagent)

Visual judgement stays with the controller. Each step below runs in this session.

**Files:**
- Modify (code fixes): whichever files a mismatch points to
- Modify (board fixes): `docs/apps/design/console/settings.pen`, `docs/apps/design/console/renders/*`
- Create: `docs/apps/design/console/parity/*.png` (the comparison captures), `docs/apps/design/console/parity/README.md`

- [ ] **Step 1: Capture the stories, both schemes**

With Storybook running, one Fast Browser `browser_run_code_unsafe` script per story: set the viewport to 1280 x 1000, load `iframe.html?id=<id>&globals=scheme:light`, wait for `[data-testid="stage"]` (or the dialog for R), screenshot that element to `docs/apps/design/console/parity/<board>.light.png`; repeat with `scheme:dark`. For B also capture hover: `page.hover('[data-key="gitq.forges"]')` then screenshot (`B-hover.light.png`). For B4, hover the `user` layer line of `rt.logLevel` and capture (`B4-layer-hover.light.png`).

- [ ] **Step 2: Export the boards at the same scale**

Pen `execute`: `Export([<B list>, <B4 list>, <R modal>], "png", "<worktree>/docs/apps/design/console/parity/boards", {scale: 1})`, using the `List` frame ids inside boards B and B4 and the `Modal` frame inside R so the crops match the story stages.

- [ ] **Step 3: Compare, side by side and by number**

Read each story capture beside its board export. Then measure: in the story, collect `getBoundingClientRect()` for each row (`[data-key]`), the open card, the tab bar, each layer line (`[data-testid^="layer-"]`), the badges and the chevrons, plus `getComputedStyle` font size, weight and colour of the key, the description, the layer values and the status text. From pen, collect the same nodes' bounds with `Get(listId, (n, c) => ...)`. Write both into `parity/README.md` as a table (element, board, build, delta).

Any delta in page content (row heights, paddings, gaps, column widths, text sizes and weights, which elements show, their order and wording) is a failure: fix the code, re-capture, re-measure, until the table has no content deltas.

- [ ] **Step 4: Correct the board where the kit decides**

Where the delta is a kit control's shipped geometry (the `SegmentedControl` at `size="sm"`, `ActionIcon` size, `Badge`, `Modal` header), the guide says the board is wrong: update the board node to the measured build value in pen, re-export the renders, and list each change in `parity/README.md` under "Board corrections". Known in advance: the composite summary reads `2 fields` (from `rowSummary`), not the board's `2 repos · port 11008`; the layer column is 132px wide (rung labels need it), not 88px; the gitq.board Value tab shows today's editor for that schema, which the boards drew freehand.

- [ ] **Step 5: Dark scheme**

Boards are light only. For each dark capture, check by eye that every surface, border, badge and status reads (no control blending into the card, no text below the guide's contrast roles), and say plainly in `parity/README.md` what looks wrong, if anything. Fix code, never by branching on scheme.

- [ ] **Step 6: Live data**

From the worktree: `cd apps/console && PORT=11011 bun run dev:server` and `bun run dev` (both in the background). Load the vite URL's `/settings` in Fast Browser at 1440 x 1000, both schemes: screenshot the page with `gitq.board` open on Value, `rt.logLevel` (or any key set on two layers) open on Where it's set, and a hovered row; then a run detail page with its configuration modal open. Read only: click no Save, Remove or Move. Note anything that reads wrong in `parity/README.md`.

- [ ] **Step 7: Ask Matt to save Pen, then commit**

Pen's MCP cannot save: ask Matt to press Cmd+S in Pen, confirm the file's mtime moved, then:

```bash
git add docs/apps/design/console apps/console/src
git commit -m "console settings: parity pass against boards B, B4 and R; board corrections where the kit decides"
```

---

### Task 7: Gates, review, PR

- [ ] **Step 1: Full gates**

Run: `bun run console:test && bun run console:typecheck && bun run console:lint && bun run check`
Expected: all green. `bun run check` includes `build-storybook`, `treeshake`, `purity` and the token-namespace lint.

- [ ] **Step 2: Whole-branch review**

Dispatch a fresh reviewer (Opus) over `git diff main...HEAD` with the spec, this plan and `docs/apps/ui-authoring.md`: correctness, every row in the spec's sections covered, authoring-guide compliance (kit component first, no new inline `style`/`styles`, hover pattern, tokens by role, weights, sizes), and "is there a kit component for this behaviour?" for anything custom. Fix confirmed findings.

- [ ] **Step 3: Push and open the PR**

Run the purity gate on the PR body before posting. Push the branch and open a PR to `m4ttstack/mattstack` following `.github/pull_request_template.md` and the MR writing style; embed the parity captures (story vs board, both schemes). Then follow the CodeRabbit and CI loop in Matt's instructions; merge only on his word.
