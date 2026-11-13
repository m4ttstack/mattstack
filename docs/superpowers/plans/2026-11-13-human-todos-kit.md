# human-todos on the Mod Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** human-todos is authored in `mods/human-todos/` and built against `@mattstack/mod-kit`. It takes the kit look on terminal and desktop, keeps today's look on VS Code and mobile, and draws both from one shared pane model.

**Architecture:** A pure `paneModel` decides every row, button and count. A kit drawer (a `kitClient` body) and a plain drawer (engine elements) each map that model to elements, and both send presses to the existing `press`. Before that, the build learns to carry a plugin's root files and whole `harness/`, and the kit measures widths in terminal cells.

**Tech Stack:** TypeScript, Claude Code mod API 2.1.322 (`claude-code`, `claude-code/testing`), Bun 1.4.4, `@mattstack/mod-kit`, `scripts/mods/build.ts`.

**Spec:** `docs/superpowers/specs/2026-11-12-human-todos-kit-design.md` (and the kit's `packages/mod-kit/README.md`)

## Global Constraints

- Kit and engine scan rules (kit README "Rules"):
  - `register` is `export function register(on: On): void`
  - one matcherless `on(event)` per event
  - `$` is passed only to top-of-file function declarations
  - state is touched only in the mod's own files, through literal `atom({ plugin: 'human-todos', key })` refs
  - Client `module` is a string literal listed in `mod.json` `clients`
  - no `import(`
  - never declare `h`/`Fragment` or write `@jsx`
- Surfaces: `terminal` and `desktop` get the kit drawer, `vscode` and `mobile` the plain drawer. Pick by `e.surface`.
- Focus: as gate-form. An unfocused pane draws dimmed, and the first click only focuses it. A focus atom `atom({ plugin: 'human-todos', key: 'keysInPane' } as const, false)` is set on an `{ type: 'engaged' }` post and cleared on `prompt.edit`, `prompt.submit` and `ui.focus`. Adding an item opens the pane without focus (`openPane`, not `showPane`).
- What human-todos does stays the same: the tool contract, the reports Claude gets, runners, the spinner, saved lists. The `todos` atom shape stays `todos-1`.
- Button tones:
  - `primary`: run, open, confirm, show
  - `secondary`: done, skip
  - `neutral`: cancel, copy, openLog, "Show all", "Show less", "Clear finished"
  - `caution`: stop, forceStop
- Band, kit drawer: label `Human Todos waiting`, title `1 to-do` / `N to-dos` (open plus confirming items). Band, plain drawer: today's.
- Copy stays today's: "Nothing for you right now.", "You've reached the end of the list.", "Are you sure you want to run this script?", "… +N more", "Show all"/"Show less", "Running"/"Stopping…", " (exit N)".
- Version: `mod.json` `plugin.version` `0.2.0` (main has `0.1.3`).
- Tests:
  - pure tests are bun tests under `src/`, run by `bun run mods:test`
  - harness tests live in `mods/human-todos/harness/`, run by `claude plugin test plugins/human-todos`
  - run `bun test` from the repo root
- Bash in this repo's sessions refuses git in complex forms: plain separate git commands, `git commit -F <file>`.

## Review Focus

- **A press while output streams:** live output or the spinner redraws the pane between pointer down and up on Stop. The stop must still happen (Task 6).
- **Emoji and wide text at 30 columns:** no kit-drawer line is wider than the pane, and clicks land on the clicked button (Tasks 3 and 6).
- **A saved list from 0.1.3:** a list saved by today's plugin (shape `todos-1`) loads in 0.2.0 with every item intact (Task 4).
- **Clear finished while something runs:** only finished items go, and the running item and its spinner stay (Task 5).
- **An empty list with finished items:** "Nothing for you right now.", a blank row, the finished list and Clear finished, in that order, on both drawers (Task 5).

---

### Task 1: Live check, can the mod own scrolling?

**Files:**
- Create: a throwaway mod under the session's dev-mods folder (not committed)
- Modify: `docs/superpowers/specs/2026-11-12-human-todos-kit-design.md` (the "Scroll hints" bullet records the answer)

The controller runs this with Matt. No subagent.

- [ ] **Step 1:** Write the probe:
  - a Pane whose hook draws a Client with 200 numbered rows
  - an `on('ui.scroll', { requestId }, ...)` hook that returns `{}` without `next`
  - the offset kept in an atom, moved by `e.by` and clamped to `[0, rows - bodyRows]`
  - the Client drawing only rows `offset .. offset + e.props.scroll.bodyRows`
- [ ] **Step 2:** Matt scrolls with the wheel and arrows, and clicks a row after scrolling. Record two things: does only the probe's window move (the engine doesn't also move it)? Does the click land?
- [ ] **Step 3:** Record the answer in the spec. **Owns** means the mod owns scrolling and keeps the "↑/↓ N more" hints. **Engine** means the engine scrolls the Client, the hints go and the end-of-list line stays. Delete the probe and commit `spec: record the scroll check`.

### Task 2: The build carries root files and the whole harness

**Files:**
- Modify:
  - `scripts/mods/build-lib.ts` (`ModManifest`, `readManifest`, the copy step around :187-191)
  - `scripts/mods/__tests__/build-lib.test.ts`
  - `packages/mod-kit/test/fixture-mod/` (add `LICENSE`, `docs/note.md` and `harness/helper.ts`, and list `files` in `mod.json`)
  - `packages/mod-kit/README.md` ("Start a new mod": `files`)

**Interfaces:**
- Produces: `ModManifest` gains `files?: string[]`. Each entry is a path relative to the mod folder, file or folder, copied to the plugin root. Every file under `harness/` is copied into `hooks/`.

- [ ] **Step 1: Failing tests** in `build-lib.test.ts`:
  - building the fixture gives `<out>/LICENSE`, `<out>/docs/note.md` and `<out>/hooks/helper.ts` next to `hooks/fixture.test.tsx`
  - a `files` entry with `..` or an absolute path rejects with `/files entry/`
  - a `files` entry that doesn't exist rejects naming it
- [ ] **Step 2:** `bun test scripts/mods`: FAIL.
- [ ] **Step 3:** Implement it. Validate `files` in `readManifest`, copy them with `cpSync(..., { recursive: true })`, and copy `harness/` whole. Update the README's "Start a new mod" with one line on `files`.
- [ ] **Step 4:** `bun test scripts/mods`, `bun run mods:build --no-validate` (`plugins/` unchanged), `bun run mods:check-readme`: PASS.
- [ ] **Step 5:** Commit `mods build: copy root files and the whole harness`.

### Task 3: The kit measures terminal cells

**Files:**
- Create: `packages/mod-kit/src/draw/cells.ts`, `packages/mod-kit/src/draw/cells.test.ts`
- Modify:
  - `packages/mod-kit/src/draw/text.ts` (`widthOf`, `hitAt`, `wrap`, `hang`)
  - `packages/mod-kit/src/widgets/{brand-bar,buttons,tab-strip,select-list,input-field}.ts`, wherever they pad, cut or measure with `.length`
  - `packages/mod-kit/src/index.ts`, README

**Interfaces:**
- Produces, exported from the kit:
  - `cellWidth(text: string): number`
  - `cutCells(text: string, cells: number): string` (never splits a grapheme, and never leaves a wide character half in)
  - `padCells(text: string, cells: number): string`

- [ ] **Step 1: Failing tests** in `cells.test.ts`:
  - `cellWidth('abc') === 3`
  - `cellWidth('日本') === 4`
  - `cellWidth('🚀') === 2`
  - `cellWidth('👨‍👩‍👧') === 2`
  - `cellWidth('🇺🇸') === 2`
  - `cellWidth('é') === 1` (e plus a combining acute)
  - `cutCells('a🚀b', 2) === 'a'`
  - `padCells('🚀', 4)` has `cellWidth` 4

  In `width.test.ts`, at width 30:
  - `brandBar('🚀 mattstack 日本語 gate', 30, hide)` has `widthOf === 30`
  - a `tabStrip` with a tab labelled `'🚀 Feature flags'` stays at or under 30

  In `text.test.ts`, `hitAt` on a line `[sp('🚀'), sp('x', { action: 'go' })]` at `x = 2` returns `'go'`.
- [ ] **Step 2:** `bun run mods:test`: FAIL.
- [ ] **Step 3:** Implement `cells.ts` by grapheme segmentation (`Intl.Segmenter`) plus an East Asian Wide/Fullwidth and emoji-presentation range check. No dependency. Switch every `.length`-based measure in the files above to it.
- [ ] **Step 4:** `bun run mods:test`, `bun run mods:typecheck`, `bun run mods:build --no-validate` (`git status --porcelain -- plugins/` empty, since ASCII output is unchanged), `bun run mods:check-readme`: PASS.
- [ ] **Step 5:** Commit `mod-kit: measure terminal cells`.

### Task 4: Move human-todos to `mods/human-todos/` (same pane)

**Files:**
- Create:
  - `mods/human-todos/{mod.json,package.json,tsconfig.json}`, `types/index.d.ts` (copied, plus the `keysInPane: boolean` key)
  - `LICENSE`, `README.md`, `docs/human-todos.png` (moved from the plugin)
  - `src/**`: today's hooks files, minus tests and `test-world.ts`
  - `harness/**`: today's harness tests and `test-world.ts`
  - `src/items.test.ts`, `src/contract.test.ts`, `src/report.test.ts`
- Modify:
  - `src/register.tsx` becomes `export function register(on: On): void`
  - `plugins/human-todos/**` becomes build output
  - `bun.lock`
- Delete: the hand-written `plugins/human-todos/hooks/*.ts(x)`

**Interfaces:**
- Consumes: Task 2 (`files`, whole `harness/`).
- Produces: `mods/human-todos/mod.json` with:
  - `plugin` = today's `plugin.json` with version `0.2.0`
  - `clients: []` (Task 6 adds the Client)
  - `files: ["LICENSE", "README.md", "docs"]`

- [ ] **Step 1: Move the pure tests.**
  - `items.test.ts` moves to `src/` as a bun test, unchanged apart from imports (`bun:test` for `expect`/`test`).
  - The `addDescription` cases of `contract.test.ts` become `src/contract.test.ts`, and its harness cases stay in `harness/contract.test.ts`.
  - The `settle` cases of `actions.test.ts` become `src/report.test.ts`.
- [ ] **Step 2: Saved-list test** (Review Focus), in `harness/store.test.ts`. Seed `list:<session>` with a 0.1.3-shaped entry `{ todos: [<3 todos: open, running-local, done>], nextId: 4, savedAt }` (atom shape `todos-1`). Start the session. `listTodos` returns all 3 with the same fields.
- [ ] **Step 3:** Move the source and switch `register`. Run `bun install` and `bun run mods:build human-todos`.
- [ ] **Step 4:**
  - `bun run mods:test` passes.
  - `claude plugin test plugins/human-todos` passes with the same count as before the move, minus the moved pure tests.
  - `claude plugin validate plugins/human-todos` passes.
  - `bunx tsc -p mods/human-todos` is clean.
  - `bun run mods:typecheck` names the new tsconfig, so add it.
- [ ] **Step 5:** Commit `human-todos: build from mods/human-todos`.

### Task 5: One pane model, with the plain drawer on it

**Files:**
- Create:
  - `mods/human-todos/src/pane/model.ts`
  - `mods/human-todos/src/pane/model.test.ts`
  - `mods/human-todos/src/pane/plain-view.tsx`
- Modify:
  - `mods/human-todos/src/pane.tsx`: the hooks stay; the drawing moves into `plain-view.tsx`; `LABELS`, `PRIMARY`, `markFor` and the wrapping move into `model.ts`
  - `mods/human-todos/harness/pane.test.tsx`

**Interfaces:**
- Produces, from `model.ts`:

  ```ts
  type Tone = 'title' | 'dim' | 'warning' | 'script' | 'link' | 'success' | 'error' | 'inactive' | 'plain'
  type PaneButton = { id: ButtonId | 'more' | 'clear'; label: string; tone: ButtonTone; todoId?: string }
  type PaneRow =
    | { kind: 'text'; text: string; tone: Tone; indent: boolean; spin?: true }
    | { kind: 'buttons'; buttons: PaneButton[]; lead?: { text: string; tone: Tone } }
    | { kind: 'finished'; mark: string; tone: Tone; title: string; exit?: number }
    | { kind: 'blank' }
  type PaneModel = { rows: PaneRow[]; spans: { first: number; last: number }[]; hasFinished: boolean }
  function paneModel(input: { list: Todo[]; expanded: string[]; spin: string; width: number }): PaneModel
  function bandModel(list: Todo[]): { waiting: number; title: string } | undefined   // undefined when nothing waits
  ```

  - `rows` is everything below the header, in today's order.
  - The end-of-list line is added by the drawer, which knows whether the list overflows.

- [ ] **Step 1: Failing tests** in `model.test.ts`, one per behaviour today's `pane.tsx` draws, asserted on `rows`:
  - **Open run item:** the title row starts with `○ `. A 5-row script shows 2 cyan rows, then a `buttons` row whose `lead` is `… +3 more` and whose button is `more` "Show all". Then cwd `in /tmp`, a blank row, and buttons Run (primary), Copy (neutral), Done (secondary), Skip (secondary). The buttons follow `buttonsFor`.
  - **Expanded:** the same item with its id in `expanded` shows all 5 script rows and "Show less".
  - **Confirming:** every script row shows, no more button, the confirm prompt, and Confirm (primary) / Cancel (neutral).
  - **Running:** the title starts with the spin frame. The tail is capped at 15 rows for a local run and 3 for herdr. Then a `buttons` row whose `lead` is `Running` (warning) or `Stopping…` (error) when `isStopping`.
  - **Finished:**
    - only the last 8 show
    - the marks are `✓` (success), `✗` (error) and `–` (inactive)
    - `exit` is set only when the code isn't 0
    - a `clear` button "Clear finished" (neutral) comes last
  - **Empty with finished** (Review Focus): `Nothing for you right now.`, blank, the finished rows, blank, clear.
  - **Clear finished while running** (Review Focus): the model's clear button carries no todo id. The running item's rows come before the finished rows.
  - **`spans`:** one span per actionable item and one per finished row, matching today's `spans`.
  - **`bandModel`:** gives `{ waiting: 2, title: '2 to-dos' }` for one open and one confirming item, `'1 to-do'` for one, and `undefined` for none.
- [ ] **Step 2:** `bun run mods:test`: FAIL.
- [ ] **Step 3:** Implement `model.ts`, and `plain-view.tsx` as `drawPlainPane($, e, model, scroll): RenderElement`. It maps each row to today's exact `Box`/`Text`/`Button` and keeps today's keys (`run-1`, `more-1`, `clear`, ...), header, hints and padding. The Pane hook calls `paneModel` then `drawPlainPane`.
- [ ] **Step 4:** `bun run mods:test`, `bun run mods:build human-todos`, `claude plugin test plugins/human-todos`: PASS with `pane.test.tsx` unchanged (look parity).
- [ ] **Step 5:** Commit `human-todos: one pane model; the plain drawer reads it`.

### Task 6: The kit drawer on terminal and desktop

**Files:**
- Create:
  - `mods/human-todos/src/pane/kit-view.tsx` (the Client)
  - `mods/human-todos/src/band.tsx` (re-exports the kit's `bandClient`)
  - `mods/human-todos/harness/kit-pane.test.tsx`
- Modify:
  - `mods/human-todos/src/pane.tsx`: the surface switch, a single `ui.message` hook, focus hooks, the band, and the scroll hook if Task 1 found "owns"
  - `mod.json` (`clients: ["pane/kit-view.tsx", "band.tsx"]`)
  - `harness/test-world.ts`: a `press(pane, id, button)` helper that posts `{ type: 'press', id, button }`
  - `harness/{actions,herdr,local,pane}.test.ts(x)`: `pane.press({ key })` calls become the helper
  - `types/index.d.ts` (`keysInPane`, plus `scrollOffset: number` if "owns")

**Interfaces:**
- Consumes:
  - Task 5's `paneModel` and `bandModel`
  - kit: `kitClient`, `Panel`, `BrandBar`, `Lines`/`Row`/`Span`, `ButtonRow`/`Button`, `isEngaged`, `paneMessage`, `bandAbovePrompt`, `registerPaneRedraw`
  - existing: `press`, `toggleExpanded`, `removeTodos` + `cleanup`
- Produces:
  - Client props `{ model: PaneModel; focused: boolean; width: number; offset?: number; bodyRows?: number }`
  - posts:
    - `{ type: 'press'; id: string; button: ButtonId }`
    - `{ type: 'toggle'; id: string }`
    - `{ type: 'clear' }`
    - `{ type: 'hide' }`
    - `{ type: 'reopen' }`
    - `{ type: 'engaged' }`

- [ ] **Step 1: Failing harness tests** in `kit-pane.test.tsx`. Mount the Pane on `terminal` and `desktop` with one open run item:
  - A `Client` is drawn.
  - Pointer down/up on Run moves the item to `confirming`.
  - With `isFocused: false` and the focus atom false, the first down/up on Run leaves it `open` and sets focus. A second click confirms.
  - Each of `prompt.edit`, `prompt.submit` and `ui.focus` clears focus.
  - Hide closes the pane, and the band's Open reopens it.
  - Mounting on `vscode` draws no `Client` and shows the plain `run-1` button.
  - **A press while output streams** (Review Focus): start a local run that prints a line every tick. Pointer down on Stop, two output lines and a spinner tick arrive, then pointer up on Stop. The item goes to `isStopping`.
  - **30 columns** (Review Focus): an item titled `🚀 Deploy 日本 build` with a long script. No row of the Client is wider than the pane: assert through the drawn row text widths, or through the model width the Client is given. A click on Done reports done.
- [ ] **Step 2:** `bun run mods:build human-todos && claude plugin test plugins/human-todos`: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `kit-view.tsx`:
    - `kitClient` with `<Panel>`
    - `<BrandBar title="Human Todos" onHide>`, then the model's rows
    - text rows go through `<Lines>`, using the kit's `wrap` at `width`
    - `buttons` rows use `<ButtonRow>` with `<Button tone>` per `PaneButton`
    - finished rows use `<Row>`/`<Span>`
    - the end-of-list line goes last when the list overflows
    - "↑/↓ N more" plus windowing only if Task 1 recorded "owns"
  - `pane.tsx`:
    - the Pane hook passes `focused = e.props.isFocused || keysInPane`
    - one matcherless `ui.message` hook dispatches the posts. `press` gets `e.surface`; `toggle` goes to `toggleExpanded`; `clear` runs today's clear path; `hide`/`reopen` go to `paneMessage`; `engaged` sets focus.
    - the AbovePrompt hook uses `bandAbovePrompt` with `bandModel` on terminal and desktop, and today's band elsewhere
  - Switch the harness presses to the helper.
- [ ] **Step 4:**
  - `bun run mods:test`, `bun run mods:build human-todos`, `claude plugin test plugins/human-todos` and `claude plugin validate plugins/human-todos` pass.
  - `bunx tsc -p mods/human-todos` is clean.
  - Freshness is empty.
- [ ] **Step 5:** Commit `human-todos: kit drawer on terminal and desktop`.

### Task 7: Live check with Matt

- [ ] **Step 1:** `bun run mods:watch human-todos --into <session dev-mods dir>`. That shadows the installed human-todos in this session, so tell Matt first.
- [ ] **Step 2:** Matt checks:
  - each item kind: task, run (local and herdr), terminal, link, image
  - confirm, stop, force stop, skip and Clear finished
  - focus-first clicks and Hide/Open
  - a list long enough to scroll
  - an emoji title

  Fixes go in small commits.
- [ ] **Step 3:** Take a new screenshot for `mods/human-todos/docs/human-todos.png`, rebuild and commit `human-todos: live check`.

### Task 8: Land on main

- [ ] **Step 1:**
  - Rebase on `origin/main`.
  - Run `bun run mods:build --no-validate`, then confirm `git status --porcelain -- plugins/` is empty.
  - Run `bun run mods:typecheck`, `bun run mods:test`, `bun run mods:check-readme` and `bun test scripts/mods scripts/ci scripts/__tests__/no-plugin-ci-jobs.test.ts`.
  - Run `claude plugin test` on all three mods.
  - Run `bun run purity` and `bun run format:check`.
- [ ] **Step 2:** Open the PR (title `human-todos on the mod kit (RT-565)`). Wait for CodeRabbit (or the Opus fallback) and green CI. Merge with `mr_merge` only after Matt confirms.
