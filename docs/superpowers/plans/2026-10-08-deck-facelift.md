# Deck Facelift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace deck's per-app drawer with a one-page settings modal, rework the main table (version column, quiet icon actions, hover gear, update strip with Redeploy all), and lift the board app's tooltip into tui-kit, with zero regressions.

**Architecture:** Page-only change in `apps/deck/core/board/**` plus one tui-kit recipe (Tooltip) and the board app's CSS. No server route, request or response changes. New pure functions in `core/board/logic.ts` carry every rule (version cell, strip, Redeploy all targets, modal gates) and are unit-tested first; the UI is driven by DOM specs (`test/dom/*.spec.ts`, Playwright against the `DECK_FIXTURE` server) written or ported before the code they guard.

**Tech Stack:** Bun, React, `@mattstack/tui-kit` (soribashi recipes), Playwright DOM specs, bun:test unit tests, vitest in tui-kit.

**Spec:** `docs/superpowers/specs/2026-10-08-deck-facelift-design.md` (read it in full before any task). Boards: `docs/apps/design/deck/` (README + `renders/*.png`).

## Global Constraints

- No change to anything under `apps/deck/src/**`. No new status field. No new endpoint.
- Every UI string uses the spec's copy. No em dashes or en dashes anywhere (code, comments, copy, commits).
- Comments only state a constraint the code cannot show (repo rule).
- Colours and lengths only through tokens or recipe scalars; no raw hex/rgb/px in tui-kit `.module.css` (`packages/tui-kit/test/no-hardcoded-values.test.ts`). Deck CSS uses kit tokens (`--text-*`, `--card`, `--border`...) and `light-dark()` for any scheme pair, per `apps/deck/AGENTS.md`.
- Hover reveals use CSS (`:hover` inside `@media (hover: hover)` plus `:focus-within`), never JS hover.
- After ANY edit under `apps/deck/core/board/`, run `cd apps/deck && bun run build:board` and commit `core/generated/board.{js,css}` with the source (`core/generated-fresh.test.ts` byte-compares).
- Run `bun test` only from the directory whose `bunfig.toml` applies: deck suites from `apps/deck` (`bun run test`, `bun run test:dom`), board suite from `apps/board`.
- Never deploy, restart or touch the live deck, `~/.mattstack`, or the shared checkout at `~/Documents/GitHub/mattstack` / `~/Documents/GitHub/repo-tools`. All work happens in this worktree. Screenshots come from the fixture server only.
- DOM bar per task: `bun run test:dom` has no failure outside the 11 pre-existing ones listed below, and pass count never drops below the previous task's except for tests the plan deletes by name. Unit bar: `bun run test` 0 failures.
- The 11 pre-existing DOM failures on main (f54729aaf), by name: board.spec "renders one row per fixture app; site cell links name + suffix", "every row carries a focusable chevron with a details aria-label", "ownership chip: this board vs managed by", "strays section and tunnel section render", "subline matches logic.subline of the fixture", "subline: healthy fraction renders in bad tone when an app is down (3/4 fixture)"; commands.spec "no command buttons when the row omits commands"; drawer.spec "↑/↓ move the drawer to the adjacent row, resetting to its root", "root screens render per row kind: app (public+nav+actions+danger), service (reduced), tunnel (facts+restart)", "edit app: an external row shows only name and base port"; remote.spec "a live-remote row shows a public: railway marker and a Push to Railway button". A task that touches one of these either fixes it or leaves it failing for the same pre-existing reason; it never adds a new failure.
- Notes and screenshots that are not committed go in `/private/tmp/deck-facelift-scratch/` (outside the worktree, so `prettier --check .` never sees them).
- Before every commit, run `bunx prettier --write` on every file you touched (the root `format:check` gate runs `prettier --check .`).
- DOM selectors for anything inside the modal are always scoped to the dialog (`const dlg = page.getByRole('dialog', { name: 'settings for <name>' })`, then `dlg.getByRole(...)`): the table behind it carries the same aria-labels (`publish <name>`, `deploy <name>`, `restart <short>`), and page-wide selectors hit Playwright strict-mode errors.
- Any DOM test that waits on polls or runs several deploys passes an explicit timeout as the test's third argument (existing specs do this, e.g. `}, 12000)`); bun:test's default is 5s.
- Commit after every task (and inside tasks where marked). Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Branches (stacked)

The controller creates each branch at the start of its step from the previous step's tip:

| step | branch | base | tasks |
| --- | --- | --- | --- |
| 1 | `deck-facelift/1-tooltip` | `deck-facelift` (spec commits) | 1, 2 |
| 2 | `deck-facelift/2-main-page` | step 1 tip | 3, 4, 5, 6 |
| 3 | `deck-facelift/3-modal` | step 2 tip | 7, 8, 9, 10, 11, 12, 13 |
| 4 | `deck-facelift/4-redeploy-all` | step 3 tip | 14, 15 |
| end | (PR assembly) | | 16 |

## Modal DOM contract (shared by every step-3 task)

Tests and implementation both use exactly these hooks:

- Row gear: kit `Button` `iconOnly`, `aria-label="settings for <name>"`, `className="row-gear"`. Select with `page.getByRole('button', { name: 'settings for <name>' })`.
- Modal: kit `Modal` with `ariaLabel="settings for <name>"`, `title={<name>}`, `className="app-settings-modal"`, `overlayClassName="app-settings-overlay"`. Its root carries the kit's `data-part="modal"`. Select with `page.getByRole('dialog', { name: 'settings for <name>' })`; if the kit Modal does not render `role="dialog"`, add `role="dialog"` and `aria-modal="true"` on the deck wrapper element `div.app-settings` inside it and select that.
- Blocks: every block is `<section data-block="<id>" aria-label="<heading>">`. Ids: `status`, `issues`, `code`, `app`, `port`, `errors`, `reach`, `gates`, `danger`, `tunnel`, `service`.
- Status pill: `[data-block="status"] [data-part="status-pill"]`, with `data-tone="ok|bad|warn|muted"` and text per spec.
- Inputs keep today's aria-labels: `dev port override`, `new password`, `add email` / `add domain`, `source path for <name>`; App block inputs: `name`, `base port`, `command`, `directory`.
- Switches keep today's aria-labels: `publish <name>` / `make <name> private`; `push <name> to Railway` / `turn off remote for <name>`; `require google sign-in` / `turn google sign-in off`; `serve <name>'s dev port publicly` / `stop serving <name>'s dev port publicly`.
- Buttons (accessible names): `Route to it`, `revert to <base>`, `Push to Railway`, `Save` (password), `replace password`, `remove password`, `Apply`, `relink`, `unlink`, `Remove app…`, `restart <service short>` (today's restart label), `Copy`, `Save changes`, `give it a route…`, segmented `These people` / `Anyone at these domains`, close `close`.
- Command buttons keep `<command> <app>` aria-labels everywhere (table and modal).
- Update strip: `[data-block="update-strip"]`; its button's accessible name is `Redeploy all` (idle) or `Redeploying…` (running).

## Review Focus

- A poll that removes or changes the open app while the modal is open: the modal must close or update without throwing, and focus must land on the page fallback (pinned in Task 9).
- The dev port input: typing then closing the modal must release `board.editing`, or polling freezes for the rest of the session (pinned in Task 10).
- A public host (`canManage: false`): no write control may render anywhere, including inside the modal and the strip (pinned in Tasks 5, 9, 10, 11, 15).
- Redeploy all while a per-row deploy for one target is already running: that row is skipped, not double-run, and the run still completes (pinned in Task 14).
- Escape pressed inside an input in the modal (dev port, password, add email): it cancels that input's draft and leaves the modal open; a second Escape closes the modal (pinned in Tasks 8 and 10).

---

## Step 1: shared tooltip (`deck-facelift/1-tooltip`)

### Task 1: Lift the board app's tooltip recipe into tui-kit's Tooltip

**Model:** opus (cross-package, gate-constrained CSS).

**Files:**
- Modify: `packages/tui-kit/src/recipes/Tooltip/Tooltip.module.css`
- Create or modify: `packages/tui-kit/src/recipes/Tooltip/Tooltip.keyframes.css` (follow whatever existing `*.keyframes.css` sibling the kit has, e.g. search `packages/tui-kit/src/recipes/*/*.keyframes.css`, for import and naming conventions)
- Modify: `packages/tui-kit/src/recipes/Tooltip/Tooltip.tsx` (extend `TOOLTIP_SCALARS` only if a value needs a recipe scalar)
- Modify: `packages/tui-kit/src/recipes/Tooltip/TooltipCard.tsx` only if the gap must change from the current `--sb-tooltip-gap` resolution (it already exposes `--tooltip-arrow-x` and positions `top: rect.bottom + gap`)
- Modify: `apps/board/src/style.css` (delete the block that starts with the comment "Tooltips read as an inverted label" through the `prefers-reduced-motion` rule for `[data-part='tooltip-card']`, about lines 4979-5028)
- Test: `packages/tui-kit/src/recipes/Tooltip/Tooltip.test.tsx`, `Tooltip.visual.test.tsx` and its `__screenshots__`, the ramps matrix test that covers tooltip pairs (`packages/tui-kit/test/ramps.matrix.test.tsx` or the a11y matrix the kit uses; search for `tooltip` in `packages/tui-kit/test/`)

**Interfaces:** Produces the styled `[data-part='tooltip-card']` every tui-kit app uses. No prop or export changes.

Target look (from `apps/board/src/style.css`, the recipe being lifted): background `color-mix(in srgb, var(--fg) 92%, var(--card))` light / `88%` dark via `light-dark()`; text `var(--card)`; no border; radius 6px; padding 6px 10px; 12px, weight 500, line-height 1.4; max-width 280px; shadow `0 1px 2px` 18% black plus `0 6px 16px -4px` 28% black; 8px gap below the trigger; a 12x6 triangle arrow at `top: -6px`, `left: clamp(6px, calc(var(--tooltip-arrow-x, 50%) - 6px), calc(100% - 18px))`, `clip-path: polygon(50% 0, 100% 100%, 0 100%)`; animation `translateY(-4px) scale(0.97)` to rest over 140ms `cubic-bezier(0.2, 0.8, 0.3, 1)`, `transform-origin: var(--tooltip-arrow-x, 50%) top`; no animation under `prefers-reduced-motion: reduce`.

- [ ] **Step 1: Capture the board app's tooltips before any change.** From the worktree root, start the board app's dev server per `apps/board/AGENTS.md` (or its Storybook/fixture mode if it has one; read `apps/board/package.json` scripts) on a free port, never the live board. With Fast Browser (`fast-browser:fast-browsing` skill), hover two different Tooltip triggers (e.g. a ShowChips chip and the StatusLine no-pack tooltip), in light and dark, and save PNGs to `/private/tmp/deck-facelift-scratch/tooltip-before/`. If the board cannot be served from the worktree without touching real state, instead render the kit's own Tooltip visual-test states before the change (`bun run tui-kit:oracles` from the root, then copy the current `__screenshots__` PNGs for Tooltip to `/private/tmp/deck-facelift-scratch/tooltip-before/`) and note in the commit message which path was used.
- [ ] **Step 2: Write the failing kit test.** In `Tooltip.test.tsx`, add a test that renders a `Tooltip`, opens it (hover or focus, as the file's existing tests do), and asserts the card's computed style: `border-top-width` is `0px`, `font-weight` is `500`, and `max-width` is `280px`. Run `cd packages/tui-kit && bunx vitest run src/recipes/Tooltip/Tooltip.test.tsx`. Expected: FAIL on border width (the current card has a 1px border).
- [ ] **Step 3: Implement.** Move the values above into `Tooltip.module.css` through tokens and scalars only. Use the kit's existing tokens where one matches (search `packages/tui-kit/src/generated/theme.css` for `--radius-md` (6px), `--font-size-px12`, spacing tokens for 6px/10px/8px); for anything with no token (280px, the shadow, the arrow geometry, the 92%/88% mix), add an entry to `TOOLTIP_SCALARS` in `Tooltip.tsx` (as `MODAL_PARTS`/`MODAL_SCALARS` style does in `Modal.tsx`) and read it with `var(--sb-tooltip-...)`. The card is portaled to `document.body`, so vars spread on `root` never reach it: declare the card's vars under a `card:` key in the recipe's `vars` (`vars: () => ({ root: {...}, card: { ...TOOLTIP_CARD_SCALARS } })`); `getStyles('card')` already flows into the card's style. The gap must equal the board app's effective gap today: the kit gap it already resolves (`--sb-tooltip-gap`, `--spacing-xxs`) plus the board's `margin-top: 8px`; set the kit's value so the total matches. Put `@keyframes` and the `animation` declaration in `Tooltip.keyframes.css` following the existing keyframes-sibling convention. Draw the arrow with a `::before` on the card. Keep the `@layer soribashi.recipes {` first statement. `Tooltip.keyframes.css` is swept by the same no-hardcoded-values rules, so its `translateY(-4px)` and `scale(0.97)` must come from a var or token too. Register the new keyframe ident in the hard-coded list in `packages/tui-kit/test/bun-build-keyframes.test.ts`.
- [ ] **Step 4: Run the kit gates.** `cd packages/tui-kit && bunx vitest run src/recipes/Tooltip test/no-hardcoded-values.test.ts`, plus `test/bun-build-keyframes.test.ts` with whichever runner its imports require (`bun test` for a bun:test file), then the ramps/contrast matrix test file(s) found above. Expected: PASS. If the contrast matrix has no tooltip pair, add one: text `--card` on the tooltip background, both schemes, bar 4.5, following the file's existing pair format, and update the Tooltip entry's `exempt` reason in `packages/tui-kit/src/a11y/matrix-classification.ts` to match.
- [ ] **Step 5: Delete the board app's local block** in `apps/board/src/style.css` (the `[data-part='tooltip-card']` rules, its `::before`, `@keyframes tui-tip-in`, and the reduced-motion rule for it). Leave every other rule untouched.
- [ ] **Step 6: Regenerate kit visual baselines deliberately.** From the worktree root: `bun run tui-kit:oracles`. If the Tooltip visual test fails only because of the intended new look, update its baselines with the command the oracle script prints for updating (read `packages/tui-kit/package.json` `test:oracles` and the vitest browser config for the update flag) and inspect every changed PNG with the Read tool: it must show the inverted label with an arrow. Any other recipe's baseline changing is a failure to investigate, not to accept.
- [ ] **Step 7: Board app after-screenshots.** Repeat Step 1's captures after the change into `/private/tmp/deck-facelift-scratch/tooltip-after/` and compare each pair with the Read tool: the board's tooltips must look the same (same colours, arrow, size, position). Run the board app's suite from `apps/board` (`bun test` or its `test` script) and confirm no new failures versus a run on the step's base commit.
- [ ] **Step 8: Run `bun run check` from the worktree root.** Expected: green. Fix anything this task caused.
- [ ] **Step 9: Commit** (`git add packages/tui-kit apps/board/src/style.css`; nothing outside the worktree is committed): `tui-kit: Tooltip takes the board app's inverted label recipe`.

### Task 2: Step 1 gate

**Model:** sonnet. Runs the bars and writes a short gate note; changes no product code.

- [ ] **Step 1:** From `apps/deck`: `bun run test` (0 fail) and `bun run test:dom` (only the 11 listed failures). Record counts.
- [ ] **Step 2:** From the root: `bun run check` and `bun run tui-kit:oracles` green. If `check` fails, reproduce it on the step's base commit in a throwaway checkout under `/private/tmp/deck-facelift-base` (a second worktree of this repo at the base sha, with `bun install --frozen-lockfile`), and record which failures are inherited (the rt unit suite has known rotating flakes); only a failure that does not reproduce on the base is this step's to fix. Remove that throwaway checkout after.
- [ ] **Step 3:** Start the deck fixture server the way `test/dom/rig.ts` does (`PORT=<free> DECK_FIXTURE=$PWD/test/fixture LOCAL_STATE_DIR=$(mktemp -d) LOCAL_APPS_NO_GATEWAY=1 LOCAL_APPS_AUTO_HEAL=0 bun run src/main.ts serve` from `apps/deck`), hover the header settings button and one health badge with Fast Browser in light and dark, save PNGs to `/private/tmp/deck-facelift-scratch/step1/`, and confirm with the Read tool that deck's tooltips now use the new look. Stop the server.
- [ ] **Step 4:** Append the counts and screenshot paths to `/private/tmp/deck-facelift-scratch/gates.md` (untracked). No commit.

---

## Step 2: main page (`deck-facelift/2-main-page`)

### Task 3: Pin every request the board page makes (written first, against today's UI)

**Model:** sonnet.

**Files:**
- Create: `apps/deck/test/dom/requests.spec.ts`

**Interfaces:** Produces the `EXPECTED_REQUESTS` list later tasks keep green.

- [ ] **Step 1: Write the test.** It boots `withBoard`, records every request to `/api/` with `page.on('request')`, then drives today's flows that reach every endpoint the board page calls, using today's selectors (they are in `test/dom/drawer.spec.ts`, `access.spec.ts`, `remote.spec.ts`, `commands.spec.ts`, `proxy.spec.ts`): publish toggle, restart, a command button, reload proxy, open the drawer and use dev port save + revert + public-follows, password set and remove, google sign-in on + who save, remote toggle and push (on `status-remote.json`), source unlink, edit save (on a user row), remove confirm. Intercept every mutation with `page.route` returning the same success bodies those spec files use, so nothing depends on fixture inertness. Normalize each recorded request to `METHOD path` with the app name replaced by `:app` and run ids by `:id`, dedupe, sort, and assert it equals a literal `EXPECTED_REQUESTS` array that you fill in from the first run's output (print it, read it, paste it). Add a comment-free assertion message naming any missing or extra entry.
- [ ] **Step 2: Run it.** `cd apps/deck && bun test test/dom/requests.spec.ts`. Expected: PASS against today's code (this test guards, it is not red first). If a flow cannot be driven with today's selectors, drive the endpoint via its table control instead, or leave it out and list it in the commit message.
- [ ] **Step 3: Commit:** `deck: pin the board page's request set before the facelift`.

Later tasks MUST keep this test green, updating only its flow-driving selectors (never `EXPECTED_REQUESTS`) as the UI moves into the modal. One carve-out: in Tasks 9 and 10 it may fail only for flows whose modal block is not built yet (Task 9 replaces the drawer before Tasks 10 and 11 add the blocks); it must be fully green again by Task 11 Step 3 and stay green after.

### Task 4: Pure logic for the version cell, update strip and Redeploy all targets

**Model:** sonnet.

**Files:**
- Modify: `apps/deck/core/board/logic.ts` (append)
- Test: `apps/deck/core/board/logic.test.ts` (append)

**Interfaces:** Produces:

```ts
export type VersionCell =
  | { kind: 'behind'; deployed: string; head: string }
  | { kind: 'current' }
  | { kind: 'untracked' };
export function versionCell(row: Row): VersionCell;
export function showVersionColumn(data: StatusData): boolean;
export function behindRows(rows: Row[]): Row[];
export function updateStripText(count: number): string;
export function redeployAllTargets(rows: Row[], runs: CommandRuns): Row[];
```

- [ ] **Step 1: Write the failing tests** (append to `logic.test.ts`; build rows with the file's existing row-factory helper if it has one, else a minimal object cast `as Row` with only the fields used):

```ts
test('versionCell: behind when newCode is set', () => {
  const row = { name: 'a', devLink: 'linked', newCode: { deployed: 'a3f19c2', head: 'e81d4b0' } } as Row;
  expect(versionCell(row)).toEqual({ kind: 'behind', deployed: 'a3f19c2', head: 'e81d4b0' });
});
test('versionCell: current when linked with no newCode', () => {
  expect(versionCell({ name: 'a', devLink: 'linked' } as Row)).toEqual({ kind: 'current' });
});
test('versionCell: untracked for unlinked, broken, undefined devLink', () => {
  for (const devLink of ['unlinked', 'broken', undefined])
    expect(versionCell({ name: 'a', devLink } as Row)).toEqual({ kind: 'untracked' });
});
test('showVersionColumn follows data.devMode', () => {
  expect(showVersionColumn({ devMode: true } as StatusData)).toBe(true);
  expect(showVersionColumn({ devMode: false } as StatusData)).toBe(false);
  expect(showVersionColumn({} as StatusData)).toBe(false);
});
test('behindRows: newCode and a deploy command, off rows excluded', () => {
  const nc = { deployed: 'x', head: 'y' };
  const rows = [
    { name: 'a', newCode: nc, commands: ['build', 'deploy'] },
    { name: 'b', newCode: nc, commands: ['build'] },
    { name: 'c', commands: ['deploy'] },
    { name: 'd', newCode: nc, commands: ['deploy'], enabled: false },
  ] as Row[];
  expect(behindRows(rows).map(r => r.name)).toEqual(['a']);
});
test('updateStripText', () => {
  expect(updateStripText(1)).toBe('New code for 1 app since its last deploy');
  expect(updateStripText(5)).toBe('New code for 5 apps since their last deploy');
});
test('redeployAllTargets: table order, self last, in-flight skipped', () => {
  const nc = { deployed: 'x', head: 'y' };
  const rows = [
    { name: 'deck', self: true, newCode: nc, commands: ['deploy'] },
    { name: 'board', newCode: nc, commands: ['build', 'deploy'] },
    { name: 'chat', newCode: nc, commands: ['deploy'] },
    { name: 'console', newCode: nc, commands: ['deploy'] },
  ] as Row[];
  const runs = { [commandKey('chat', 'deploy')]: 'running' } as CommandRuns;
  expect(redeployAllTargets(rows, runs).map(r => r.name)).toEqual(['board', 'console', 'deck']);
});
```

- [ ] **Step 2: Run** `cd apps/deck && bun test core/board/logic.test.ts`. Expected: FAIL (functions not exported).
- [ ] **Step 3: Implement** in `logic.ts`:

```ts
export type VersionCell =
  | { kind: 'behind'; deployed: string; head: string }
  | { kind: 'current' }
  | { kind: 'untracked' };

export function versionCell(row: Row): VersionCell {
  if (row.newCode)
    return { kind: 'behind', deployed: row.newCode.deployed, head: row.newCode.head };
  return row.devLink === 'linked' ? { kind: 'current' } : { kind: 'untracked' };
}

export function showVersionColumn(data: StatusData): boolean {
  return data.devMode === true;
}

export function behindRows(rows: Row[]): Row[] {
  return rows.filter(
    r => r.enabled !== false && r.newCode != null && (r.commands ?? []).includes('deploy')
  );
}

export function updateStripText(count: number): string {
  return count === 1
    ? 'New code for 1 app since its last deploy'
    : `New code for ${count} apps since their last deploy`;
}

export function redeployAllTargets(rows: Row[], runs: CommandRuns): Row[] {
  const idle = behindRows(rows).filter(r => !runs[commandKey(r.name, 'deploy')]);
  return [...idle.filter(r => !r.self), ...idle.filter(r => r.self)];
}
```

- [ ] **Step 4: Run** the same command. Expected: PASS. Then `bun run test`: 0 fail.
- [ ] **Step 5: Commit:** `deck: version cell, update strip and redeploy-all target logic`.

### Task 5: Main table rework

**Model:** opus.

**Files:**
- Create: `apps/deck/core/board/icons.ts` (path data: `HAMMER`, `ROCKET`, `HELP`, `COPY`, `SETTINGS_GEAR` only if `ICONS.settings` is not usable at icon size; lucide paths joined with explicit `M`, same convention as `RAILWAY_GLOBE`)
- Create: `apps/deck/core/board/UpdateStrip.tsx`
- Create: `apps/deck/test/fixture/status-newcode.json`
- Modify: `apps/deck/core/board/AppsTable.tsx`, `Board.tsx`, `board.css`, `logic.ts` (only to remove `deployPill` if no longer used; keep `commandButtonLabel`)
- Modify tests: `test/dom/board.spec.ts`, `test/dom/commands.spec.ts`, `test/dom/drawer.spec.ts` (only the row-click and chevron tests named below), `test/dom/requests.spec.ts` (selectors only), `core/board/logic.test.ts` (deployPill tests), `test/capture.ts` and `test/baselines/board-*.png`
- Regenerate: `core/generated/board.{js,css}`

**Interfaces:** Consumes Task 4's functions. Produces the row gear (`settings for <name>`), which in this step opens the existing drawer: `onOpenRow(row.name)` on gear click, and the gear's element is what `registerChevron` registers (rename the prop to `registerGear` and the map in `Board.tsx` to `gearRefs`, keeping AppDrawer's focus-return behaviour).

- [ ] **Step 1: Fixture.** Copy `test/fixture/status.json` to `status-newcode.json` and edit only: top-level `"devMode": true`; `atlas` gets `"newCode": {"deployed": "a3f19c2", "head": "e81d4b0"}` (it is already linked with `build|deploy`); `forecast` (self) gets `"devLink": "linked"`, `"commands": ["deploy"]`, `"newCode": {"deployed": "4c1e0a2", "head": "9b7f3d1"}`; `ledger` stays unlinked; add one more managed row `meridian` copied from `atlas` with a new port (11007), `"newCode": {"deployed": "b2c3d4e", "head": "f5a6b7c"}`, and add one managed linked row `zenith` copied from `atlas` with port 11009 and no `newCode`. Update `up`/`total` to stay consistent with the rows.
- [ ] **Step 2: Update the deliberately changing tests first (red).** In each, change the assertion to the new behaviour, keep the test name's intent, and rename the test where its name describes the old behaviour:
  - `board.spec` "leading health dot..." becomes "no leading health dot; the health badge carries tone": assert no `[data-part="statusdot"]` inside the first cell of a row, and the Health cell's badge has the ok/bad intent.
  - `board.spec` "service column shows dim pid N..." becomes "no service column: header cells are site, port, health, public (plus version in dev mode)": assert header texts on `status.json` are exactly `['site','port','health','public']` (ignoring empty header cells) and on `status-newcode.json` `['site','port','health','version','public']`.
  - `board.spec` "every row carries a focusable chevron..." becomes "every row carries a settings gear in the tab order": for each fixture row, `getByRole('button', { name: 'settings for <name>' })` exists and `focus()` lands on it.
  - `board.spec` "an off app: muted off badge..." : keep every assertion about the off badge, restart, commands and the count; change cell lookups from fixed `.nth()` indices to the Health cell found by header text, and open its drawer via the gear instead of the chevron.
  - `drawer.spec` "row click opens the drawer, titled by the app name" becomes "the row gear opens the drawer; a plain row click does not": click the row's site text area (not a link) and assert no `[data-part="sidedrawer"]`; click the gear and assert it opens.
  - `drawer.spec` "switch, restart, and site-link clicks do not open the drawer": keep; it must still pass.
  - `drawer.spec` "closing the drawer returns focus to the row's chevron" becomes "... to the row's gear".
  - `logic.test.ts` `deployPill` tests: delete them with `deployPill` if Step 4 removes it; keep `commandButtonLabel` tests unchanged.
  - `commands.spec` "renders a button per command and POSTs on click": keep selecting by aria-label `<command> <app>`; add an assertion that `build` and `deploy` buttons render an `svg` and no visible text.
  - Every helper that opens the drawer through the chevron switches to the gear (`page.getByRole('button', { name: 'settings for <name>' })`) with no other change: `test/dom/access.spec.ts` (around line 20), `test/dom/logs.spec.ts` (around line 20), `test/dom/remote.spec.ts` (around line 23), the `chevronFor` helper in `test/dom/drawer.spec.ts` (around line 24, rename to `gearFor`), and `openDrawerFor` in `test/capture.ts` (around line 199). Every drawer, access, logs and remote test must still pass (or fail only as one of the 11) after this switch.
  Run `bun run test:dom` and `bun run test`: the edited tests FAIL for the expected reasons.
- [ ] **Step 3: New tests (red).** Add to `board.spec.ts` using `withBoard(fn, { fixture: 'status-newcode.json' })`:
  - "version column: behind shows deployed → head, linked-current shows current, others not tracked" (atlas: text contains `a3f19c2` and `e81d4b0`; zenith: `current`; ledger: `not tracked`).
  - "deploy icon carries the warn role when the row has new code": atlas's `deploy atlas` button has class `t-warn` (or the class you choose in Step 4; assert that exact class) and zenith's does not.
  - "update strip shows the behind count and hides when none": newcode fixture shows `[data-block="update-strip"]` with text `New code for 3 apps since their last deploy` (atlas, meridian, forecast); default fixture shows no strip.
  - "row gear is hidden until hover or focus": on a non-hovered row the gear's computed `opacity` is `0`; after `row.hover()` it is `1`; after focusing the gear with the keyboard it is `1`.
  - "header settings button is icon-only with its tooltip": the header button `settings` (rename aria-label to `Deck settings`) has a bounding box at least as large as its svg's and shows tooltip text `Deck settings` on hover.
  - "a running command shows busy, its tooltip reads the phase, and a second click does not post again": on the default fixture, intercept atlas's `POST .../commands/deploy` to return a run id and hold its run-status poll open (never fulfil it until the end of the test); click `deploy atlas`; assert the button shows the kit Button's busy state (read `packages/tui-kit/src/recipes/Button/Button.tsx` for the attribute it sets when `busy`), hovering it shows a tooltip containing `deploy`, the button is disabled (the kit Button sets `disabled` while `busy`), and a second click sent with `dispatchEvent('click')` (Playwright's `click()` waits for an enabled element and would hang) sends no second POST.
  - "public host: no write controls in the table": on a fixture copy with `canManage: false` (create `status-readonly.json` from `status.json` with `canManage: false`, `canRestart: false`), assert no publish switch, no restart, no `Link source`, and the gear still opens (read-only drawer for now).
  Run: FAIL.
- [ ] **Step 4: Implement.**
  - `AppsTable.tsx`: remove the `StatusDot` from `SiteCell`; delete `ServiceCell` and its column and header; add the Version column only when `showVersionColumn(data)` (render `deployed → head` with the head in `t-warn`, or `current`, or `not tracked` muted) and adjust `COL_WIDTHS` so both section tables share one colgroup (compute widths per column set; keep the shared-colgroup rule documented at `COL_WIDTHS`); merge the restart and commands cells into one actions cell, ordered: command buttons, restart, gear; render `build` and `deploy` as kit `Button variant="subtle" size="sm" iconOnly` with `<Icon d={HAMMER|ROCKET} />`, `aria-label` `<command> <app>`, `busy={phase != null}`, wrapped in `Tooltip` whose tip is: build, the Tooltips board copy for Build; deploy, the Redeploy copy, prefixed by `New code since last deploy: X to Y. ` when `row.newCode`; while `phase` is set, the tip is `commandButtonLabel(name, phase)`. Give the deploy button `className="t-warn"` when `row.newCode`. Any other command keeps today's text button. Keep `Link source` / `fix link` exactly as today. Replace `ChevronCell` with a gear: kit `Button variant="subtle" size="sm" iconOnly className="row-gear" aria-label={`settings for ${row.name}`}` that calls `onOpenRow(row.name)` and registers its element via `registerGear`. Remove the row `onClick` and `isDrawerClick` (delete the function and its unit test if any), and the `row-selected` class.
  - `board.css`: `.row-gear { opacity: 0; transition: opacity 120ms; }` then `@media (hover: hover) { .apps-grid [data-part="table-row"]:hover .row-gear { opacity: 1; } }` and `.apps-grid [data-part="table-row"]:focus-within .row-gear { opacity: 1; }`; under `prefers-reduced-motion: reduce` no transition. Remove now-dead rules (`.row-chevron`, `.row-selected`, service column).
  - `UpdateStrip.tsx`: renders nothing when `behindRows(mattstackSectionRows).length === 0`; else `<div data-block="update-strip" className="update-strip">` with the circle-arrow-up glyph (kit `ICONS` if present, else add `CIRCLE_ARROW_UP` to `icons.ts`), the `updateStripText(n)` text, and no button in this step. Style: `background: color-mix(in srgb, var(--amber) 7%, transparent)`, bottom border `var(--border-soft-on-card)` (or the on-card soft border token deck already uses), padding using the kit spacing tokens, matching the board render. Render it as the first child inside the mattstack section's panel; if `Table` cannot take a leading child, render it immediately above the table inside a wrapper that carries the panel's border and radius so the two read as one card.
  - `Board.tsx`: header gear becomes `<Tooltip tip="Deck settings"><Button size="sm" iconOnly aria-label="Deck settings" ...>{ICONS.settings}</Button></Tooltip>`; pass `registerGear`; render `UpdateStrip` for the mattstack section.
  - Delete `deployPill` from `logic.ts` if unused.
  - `board.css` has `.t-ok` and `.t-bad` but no `.t-warn`: add `.t-warn` with the kit's warn text role (`color: var(--text-warn)`; `--text-warn-small` where the text is under 12.5px), written the way `.t-bad` is.
- [ ] **Step 5: Keep `requests.spec.ts` green** by updating its flow selectors (gear instead of chevron/row click). `EXPECTED_REQUESTS` must not change.
- [ ] **Step 6: Run** `cd apps/deck && bun run build:board && bun run test && bun run test:dom`. Expected: unit 0 fail; DOM no failures outside the 11 (some of the 11 may now pass; note which).
- [ ] **Step 7: Capture baselines.** Add `board-newcode` (light and dark) states to `test/capture.ts` using the newcode fixture the way it uses `status-stale.json`, run `bun run capture:baseline`, and Read every changed PNG in `test/baselines/`: it must match the FINAL main page board in layout, colour roles and states (data differs). Commit the baselines.
- [ ] **Step 8: Commit** (source, tests, fixtures, generated bundle, baselines): `deck: version column, icon actions, hover gear and update strip`.

### Task 6: Step 2 gate

**Model:** sonnet. Same as Task 2, plus: on the fixture server with `status-newcode.json` (copy it to a temp dir as `status.json` and point `DECK_FIXTURE` there), take Fast Browser screenshots of the main page in light and dark and of a hovered row, Read them next to `docs/apps/design/deck/renders/01-main-page.{dark,light}.png`, and list any difference in layout, spacing, type, colour role or shown state in `/private/tmp/deck-facelift-scratch/gates.md`. A difference is reported back to the controller as a failure; the controller sends it to a fix subagent before step 3 starts.

---

## Step 3: settings modal (`deck-facelift/3-modal`)

### Task 7: Pure logic for modal forms and block gates

**Model:** sonnet.

**Files:** Modify `apps/deck/core/board/logic.ts`; Test `apps/deck/core/board/logic.test.ts`.

**Interfaces:** Produces:

```ts
export type SettingsForm = 'app' | 'service' | 'tunnel';
export function settingsFormFor(row: Row): SettingsForm;
export interface SettingsBlocks {
  code: boolean; app: boolean; port: boolean; portInput: boolean;
  overrideControls: boolean; errors: boolean; reach: boolean; gates: boolean;
  remove: boolean; giveRoute: boolean; restart: boolean; relink: boolean;
}
export function settingsBlocks(row: Row, data: StatusData): SettingsBlocks;
```

Rules (from the spec and today's drawer gates; cite the drawer line in a test name when porting a gate):

- `settingsFormFor`: `row.isTunnel` -> `tunnel`; `row.port == null` -> `service`; else `app`.
- For `app` form, with `m = data.canManage`, `on = row.enabled !== false`, `managed = isMattstack(row)`:
  - `code`: `managed && !row.self && row.devLink !== undefined`
  - `relink`: `code && m`
  - `app`: `!managed && m` (today: edit app is user rows only, under canManage, and the drawer still shows it on an off user row)
  - `port`: `true`; `portInput`: `m && !row.self && !override(row, data)`; `overrideControls`: `m && !row.self && override(row, data)` where override is `row.override && data.canManage && !row.self`
  - `errors`: `true`
  - `reach`: `m && on`; `gates`: `m`
  - `remove`: `m && !row.self`
  - `restart`: `on && data.canRestart && row.service != null`
  - `giveRoute`: `false`
- For `service` form: everything false except `errors`, `restart` (`data.canRestart && row.service != null`), `giveRoute` (`data.canManage`).
- For `tunnel` form: everything false except `errors` and `restart` (`data.canRestart && row.service != null`).

- [ ] **Step 1: Failing tests:** one test per rule line above, plus a table-driven test over the four rows of `test/fixture/status.json` (import it like the DOM specs do) asserting the full `SettingsBlocks` object for each, and one with `canManage: false` asserting every write flag (`relink`, `app`, `portInput`, `overrideControls`, `reach`, `gates`, `remove`, `giveRoute`) is false.
- [ ] **Step 2: Run** `bun test core/board/logic.test.ts`: FAIL.
- [ ] **Step 3: Implement** exactly the rules above.
- [ ] **Step 4: Run:** PASS; `bun run test` 0 fail.
- [ ] **Step 5: Commit:** `deck: settings modal form and block gates`.

### Task 8: Port the drawer's tests to the modal contract (red)

**Model:** opus.

**Files:**
- Create: `apps/deck/test/dom/settings.spec.ts` (ported from `drawer.spec.ts`), `test/dom/settings-access.spec.ts` (from `access.spec.ts`), `test/dom/settings-remote.spec.ts` (from `remote.spec.ts`), `test/dom/settings-logs.spec.ts` (from `logs.spec.ts`)
- Do not delete the drawer specs yet.

**Interfaces:** Consumes the Modal DOM contract above. Produces the red tests Tasks 9-12 make green.

For every test in the spec's "Drawer feature parity" table, write its modal twin: same setup, same intercepted requests and asserted request bodies, same asserted copy where the copy still exists in the modal (spec section 2), selectors from the Modal DOM contract. Tests marked † in the spec assert the intended behaviour. Drop only the ↑/↓ test and the selected-row test. Add these new at-risk tests:

- "the modal opens only from the row gear; esc, close and backdrop close it; focus returns to the gear".
- "initial focus lands on the close button".
- "polling continues while the modal is open with the dev port input empty": count `GET /api/v1/status` requests over 11 seconds with the modal open (`REFRESH_MS` is 5000): at least 2.
- "typing in the dev port input then closing the modal releases the draft": type `5173`, press Escape once and assert the modal is still open and the input is empty, press Escape again and assert the modal closed, then count status polls over 11s: at least 2.
- "closing with the close button while the dev port draft has text releases the draft": type `5173`, click close, count status polls over 11s: at least 2.
- "blur with text keeps the draft until submit": type `5173`, click elsewhere in the modal, `Route to it` posts the override (assert the PUT body the drawer spec asserts today).
- "public host shows no write control in the modal": on `status-readonly.json` (from Task 5), open each fixture row's modal and assert none of the contract's write controls exist (switches, inputs, `relink`, `unlink`, `Remove app…`, `give it a route…`), while restart follows `canRestart`.
- "an apply error does not survive closing the modal": port of the who-error-does-not-survive test with close instead of the back chevron.
- "a row vanishing while its modal is open closes the modal and focus lands on the page fallback": port of the drawer's data-vanishes test.

- [ ] **Step 1:** Write the four spec files.
- [ ] **Step 2:** Run each: `bun test test/dom/settings*.spec.ts`. Expected: every new test FAILS because no modal exists (assert that the failure is a missing dialog or control, not a syntax or fixture error; fix any test that fails for another reason).
- [ ] **Step 3: Commit** the red tests: `deck: settings modal tests ported from the drawer (red)`.

### Task 9: Modal shell, header, status, errors, reduced forms

**Model:** opus.

**Files:**
- Create: `apps/deck/core/board/settings/AppSettingsModal.tsx` (host: picks the form via `settingsFormFor`, owns open/close/focus, row-vanished guard, calls `board.openAccess(row)` on open and `board.closeAccess()` + `board.cancelEdit()` + `board.closeEdit()` on close), `settings/Header.tsx` (identity, status pill from `RootStatusStrip`'s logic moved into `logic.ts` as a pure `statusPill(row, restarting)` with unit tests, issues alerts), `settings/RecentErrors.tsx`, `settings/TunnelForm.tsx`, `settings/ServiceForm.tsx`, `settings/settings.css` (imported by `board.css` or the board bundle the way other CSS is)
- Modify: `apps/deck/core/board/Board.tsx` (render `AppSettingsModal` instead of `AppDrawer`; gear and tunnel badge open it), `logic.ts` + `logic.test.ts` (`statusPill`)

**Interfaces:** `AppSettingsModal({ row, data, board, onClose, returnFocusTo, fallbackFocusRef })`. Block components share props `{ row: Row; data: StatusData; board: BoardState; blocks: SettingsBlocks }`.

Also create `settings/Help.tsx`: a help icon (`HELP` path from `icons.ts`, 13px, `--text-2`-role colour via the existing muted text token) wrapped in the kit `Tooltip`, with `aria-label` equal to its tip. Tasks 10 and 11 place it next to Deployed, Assigned, Dev override, Public follows dev, Public through the tunnel, Railway, Password and Google sign-in, with this copy, verbatim (from the FINAL Tooltips board), except that Dev override names the row's own host and assigned port instead of `board.mattstack` and `11006`:

| anchor | tip |
| --- | --- |
| Redeploy (button) | Runs this app's deploy command from its linked checkout, so the running app picks up the new code. |
| Build (button) | Runs the build command only. The running app does not change until you redeploy. |
| Deployed | Left is the commit running now. Right is the newest commit in the linked checkout. |
| relink | Point deck at a different checkout of this app. |
| unlink | Serve from the installed bundle instead of source. Build and deploy disappear until you relink. |
| Assigned | The port deck gave this app. The route points here unless an override is set. |
| Dev override | Send board.mattstack to a dev server you are running on another port. Revert to go back to 11006. |
| Public follows dev | On: tunnel visitors also see your dev server. Off: they keep getting the assigned port. |
| Public, through the tunnel | Publishes this app on your public domain through deck's Cloudflare tunnel. Off: visitors get the tunnel's 404 page. |
| Railway | Pushes this app to Railway so it keeps serving when this Mac is off. Needs Google sign-in; a password alone does not protect it there. |
| Password | Tunnel visitors enter this before the gateway lets them through. |
| Google sign-in | Visitors sign in with Google at Cloudflare's edge before they reach the app. Choose the people or domains allowed in. |
| Restart (modal header) | Restarts the service. The app is unavailable for a moment. |
| Redeploy all (strip button) | Runs deploy for every app with new code. |

Task 5's table tooltips use the Build and Redeploy rows; Task 14 uses the Redeploy all row.

- [ ] **Step 1:** Unit-test `statusPill(row, restarting)` first (red then green) with the states Healthy, Down (unreachable, exit N), Restarting…, Off, No route, mirroring every branch of today's `RootStatusStrip` and `TunnelStatusStrip`.
- [ ] **Step 2:** Implement the host and the listed blocks with kit components (`Modal`, `Badge`, `Alert`, `Button`, `Tooltip`, `CopyButton` if it fits `Copy`, else `Button` + `navigator.clipboard.writeText` as today). Width ~1000px via `className`; two-column grid in `settings.css` using kit spacing tokens; stack to one column under 760px.
- [ ] **Step 3:** Run `bun test test/dom/settings*.spec.ts`: the open/close/focus, status, issues, errors, tunnel and service tests PASS; the rest still fail.
- [ ] **Step 4:** `bun run build:board`, `bun run test`, `bun run test:dom` (drawer specs now fail where they open the drawer; that is expected in this task only, list them in the commit message; they are deleted in Task 12).
- [ ] **Step 5: Commit:** `deck: settings modal shell, header, errors and reduced forms`.

### Task 10: Left column: Code, App, Port

**Model:** opus.

**Files:** Create `settings/CodeBlock.tsx`, `settings/AppBlock.tsx`, `settings/PortBlock.tsx`; modify `AppSettingsModal.tsx` to place them.

- Code reuses the table's command button component (extract it from `AppsTable.tsx` into `core/board/CommandButton.tsx` so table and modal share one implementation, same aria-labels, guard and phases), relink via the existing `SourceLinkInput` behaviour (move it out of `drawer/SourceScreen.tsx` into `settings/SourceLinkInput.tsx` unchanged), unlink via `board.onUnlink(row)` (today's `UnlinkConfirm`), help icon tooltips with the Tooltips board copy.
- App uses `board.openEdit(row)` when the block mounts and `board.updateEditModal` / `board.submitEdit` exactly as `drawer/EditScreen.tsx` does; validation via `NAME_PATTERN`; API error inline on `name`.
- Port: input `dev port override` calls `board.startEdit(row)` on the first keystroke only, then `board.setEditValue`; `Route to it` and Enter call `board.submitPort()`; Escape in the input calls `board.cancelEdit()`, clears the input and stops the event's propagation (`ev.stopPropagation()`, plus `ev.nativeEvent.stopImmediatePropagation()` if the kit Modal listens on `document`) so the modal stays open; blur while empty calls `board.cancelEdit()`; the same Escape rule applies to the password and add-entry inputs (a small change from the drawer, where Escape in those inputs closed the drawer: list it in the PR's deliberate changes); override state shows the override port (`t-warn`), `revert to <base>` (`board.clearPort(row)`) and the public-follows switch (`board.onPublicFollows(row)`, today's aria-labels); `self` shows "overrides don't apply to deck itself".

- [ ] **Step 1:** Run the Code/App/Port tests in `settings.spec.ts`: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run them: PASS. Run `requests.spec.ts` after moving its dev port / edit / unlink flows to the modal selectors: PASS with `EXPECTED_REQUESTS` unchanged.
- [ ] **Step 4:** `bun run build:board && bun run test` (0 fail).
- [ ] **Step 5: Commit:** `deck: settings modal code, app and port blocks`.

### Task 11: Right column and footer: Reach, Gates, Remove

**Model:** opus.

**Files:** Create `settings/ReachBlock.tsx`, `settings/GatesBlock.tsx`, `settings/DangerFooter.tsx`; modify `AppSettingsModal.tsx`.

- Reach: This Mac (always), publish switch (`OptimisticToggleRow` semantics via the existing `optimistic.tsx` component that fits a block row, today's aria-labels and copy), Railway switch (`OptimisticGatedToggleRow` semantics, today's disabled tooltip via `remoteToggleTip` moved into `logic.ts` unchanged), remote status and `Push to Railway` (`board.onPushRemote(row)`, disabled while deploying or verifying).
- Gates: Password from `drawer/AccessScreens.tsx`'s password screen logic (`board.updateAccessModal`, `board.savePassword`, `board.removePassword`), shown inline: not set shows input `new password` + `Save`; set shows `replace password` (reveals the input) and `remove password`; errors via kit `Alert`. Google sign-in switch (`board.onOauthSwitch`), kit `Segmented` for mode (`board.updateAccessModal({ mode })` then `board.onOauthMode()`), entries as kit `Chip`s with a remove button (`board.removeAccessEntry(i)`), input `add email`/`add domain` committing on Enter or blur (`board.addAccessEntry(draft)`), `Apply` (`board.applyOauth()`), `oauthError` alert. The open note when no gate is on. Today's timing is untouched because the same board functions are called.
- Danger footer: `Remove app…` (`board.onRemove(row)`, today's `RemoveConfirm`) and the "Switches save as you flip them" note.

- [ ] **Step 1:** Run the reach, access and remove tests in the settings specs: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run all `settings*.spec.ts`: PASS. Update `requests.spec.ts` flow selectors for access, remote, publish-in-modal and remove: PASS, `EXPECTED_REQUESTS` unchanged.
- [ ] **Step 4:** `bun run build:board && bun run test`.
- [ ] **Step 5: Commit:** `deck: settings modal reach, access and remove`.

### Task 12: Delete the drawer

**Model:** sonnet.

**Files:** Delete `apps/deck/core/board/drawer/` (after moving anything still imported elsewhere), `test/dom/drawer.spec.ts`, `access.spec.ts`, `remote.spec.ts` drawer-only tests (keep any test that asserts table behaviour by moving it to `board.spec.ts`), `logs.spec.ts` drawer tests; remove `AppDrawer`, `registerGear`'s drawer wiring, drawer CSS in `board.css`; update `test/capture.ts` drawer states to modal states (`modal-app`, `modal-app-override`, `modal-user-app`, `modal-tunnel`, `modal-service`, `modal-readonly`, `modal-access-on`) and regenerate baselines; remove `test/baselines/drawer-*.png`; update `apps/deck/AGENTS.md`, whose "Board surface" section mentions `.drawer-toggle-row`, so it describes the code as it now is (no drawer).

- [ ] **Step 1:** Before deleting, run the spec's parity table as a checklist: for each row, name the `settings*.spec.ts` test that covers it in `/private/tmp/deck-facelift-scratch/parity.md`. A row with no passing test blocks this task: report it to the controller.
- [ ] **Step 2:** Delete and clean up; `rg -n "drawer|Drawer" apps/deck/core apps/deck/test` must return only intentional leftovers (none expected).
- [ ] **Step 3:** `bun run build:board && bun run test && bun run test:dom`: unit 0 fail; DOM no failures except the pre-existing ones whose tests still exist (the drawer ones are deleted with their files; the † behaviours are covered by passing modal tests).
- [ ] **Step 4:** `bun run capture:baseline`; Read every new modal baseline against `renders/02-app-settings-modal.*.png` and `renders/03-modal-states.dark.png`.
- [ ] **Step 5: Commit:** `deck: remove the drawer; the settings modal replaces it`.

### Task 13: Step 3 gate

**Model:** sonnet. Same as Task 6, for the modal: open the modal for a linked managed row, a user row, the tunnel and a service on the fixture server, in light and dark, plus one hovered help-icon tooltip; compare with renders 02, 03 and 04; record differences; run every bar (unit, DOM, `check`, oracles not needed unless tui-kit changed, `LOCAL_E2E=1 bun run test:e2e` from `apps/deck` only if it runs fully isolated: read `test/e2e.smoke.test.ts` first and skip with a note if it touches real launchd or `~/.mattstack`).

---

## Step 4: Redeploy all (`deck-facelift/4-redeploy-all`)

### Task 14: `onRunCommand` outcomes and Redeploy all

**Model:** opus.

**Files:** Modify `apps/deck/core/board/useBoardState.ts`, `UpdateStrip.tsx`, `logic.ts` (add `type CommandOutcome`), `Board.tsx`; Test `test/dom/redeploy-all.spec.ts`, `core/board/logic.test.ts` if any new pure helper.

**Interfaces:**

```ts
export type CommandOutcome =
  | 'ok' | 'failed' | 'timeout' | 'busy' | 'not-started'
  | 'skipped' | 'reloading' | 'no-return';
// useBoardState
onRunCommand: (row: Row, cmd: string) => Promise<CommandOutcome>;
redeployAll: () => Promise<void>;
redeployAllRun: { index: number; total: number; app: string } | null;
```

- `onRunCommand` returns: `skipped` at the in-flight guard; `busy` when the start answers `error: 'busy'`; `not-started` for any other non-ok start; `reloading` right before `location.reload()`; `no-return` after the 60s toast; `timeout` / `failed` / `ok` from the poll outcome (`failed` when exit code is non-zero). Every existing toast, phase and refresh call stays exactly where it is.
- `redeployAll`: guard against a second concurrent run with a ref; `targets = redeployAllTargets(mattstackRows, commandRunsRef.current)`; for each, set `redeployAllRun`, `await onRunCommand(row, 'deploy')`; continue on `ok` or `skipped`; on anything else add one toast `Redeploy all stopped at <app>` and stop; on `reloading` stop without a toast; finally clear `redeployAllRun`.
- Strip: button `Redeploy all` (kit `Button`, warn intent filled, rocket icon), disabled `Redeploying…` while `redeployAllRun` is set; text `Redeploying i of N · <app>` while running; hidden on a public host (`!data.canManage`).

- [ ] **Step 1: Failing DOM tests** in `redeploy-all.spec.ts` on `status-newcode.json`, intercepting `POST /api/v1/apps/:app/commands/deploy` and the run-status poll route (read `useBoardState.ts` `pollCommandRun` for its path and success body shape; reuse the shapes `commands.spec.ts` intercepts):
  - "runs deploys one at a time in order, deck itself last": record POST order; with all succeeding except the self row (intercept its start to return the busy body so the page does not reload), order is atlas, meridian, then forecast.
  - "stops at the first failure and names the app": meridian's run polls to a non-zero exit; assert atlas then meridian were posted, forecast never; exactly one toast contains `Redeploy all stopped at meridian`.
  - "skips a row whose deploy is already running": start atlas's deploy from its row (hold its poll open), then click Redeploy all; atlas is not posted twice.
  - "the button disables while running and a second run cannot start": the button is disabled while running, and a second click sent with `dispatchEvent('click')` (never `click()`, which waits for an enabled element) posts nothing extra: each target is posted once.
  - "deck's own deploy, last, waits for deck and reloads the page with no stop toast": atlas and meridian succeed; forecast's (self) start returns a run id, its run-status poll answers 404 (the server restarted), and the endpoint `waitForBoard` polls (read it in `useBoardState.ts` or `api.ts`) answers 200; assert the page navigates (reload) and that no toast containing `Redeploy all stopped` appeared before it.
  - "hidden on a public host": `canManage: false` copy of the newcode fixture shows no Redeploy all button.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `redeploy-all.spec.ts` and `commands.spec.ts`: PASS. `requests.spec.ts`: PASS (no new endpoint; Redeploy all reuses the deploy endpoint already listed).
- [ ] **Step 5:** `bun run build:board && bun run test && bun run test:dom`.
- [ ] **Step 6: Commit:** `deck: Redeploy all runs behind apps one at a time, deck last`.

### Task 15: Step 4 gate

**Model:** sonnet. Same as Task 6 for the strip in idle and running states (hold a deploy poll open with Fast Browser's network interception or a fixture tweak in a temp dir), light and dark, compared with render 01.

---

## Task 16: Assemble the stack and open the single PR

**Model:** the controller does this itself.

- [ ] **Step 1:** Final full bars on the step-4 tip: deck unit and DOM, board suite, `bun run check`, `bun run tui-kit:oracles`, `bun run purity` from the root.
- [ ] **Step 2:** Push the four branches. Open stacked draft PRs: `1-tooltip` -> `main`, `2-main-page` -> `1-tooltip`, `3-modal` -> `2-main-page`, `4-redeploy-all` -> `3-modal`, each with a short body naming its step.
- [ ] **Step 3:** Collapse the stack: merge PR 4 into `3-modal`, PR 3 into `2-main-page`, PR 2 into `1-tooltip` (merge commits, not squash, so each step's commits stay revertible). PR 1 (`1-tooltip` -> `main`) now carries everything: retitle it "Deck facelift: settings modal, main page and shared tooltip", rewrite its body (what changed per step, the deliberate changes table, the overnight decisions from the spec, test counts before and after, screenshot paths), mark it ready for review. Never merge it.
- [ ] **Step 4:** Wait for CodeRabbit and CI on PR 1; address every actionable finding with commits on `1-tooltip`; if CodeRabbit is rate limited, run one Opus review subagent on the branch diff instead.
