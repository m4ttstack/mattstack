# Editor Terminal Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt setup` installs JetBrainsMono NL Nerd Font when missing and adds it as a fallback to the integrated terminal font of every installed VS Code, Cursor and Antigravity.

**Architecture:** A pure core decides the new `terminal.integrated.fontFamily` value per editor, a probes-based module installs the font and edits each settings file with `jsonc-parser`, and one setup step plus one optional checklist row wire it into `rt setup` and `rt setup update`.

**Tech Stack:** Bun/TypeScript, `jsonc-parser` (already a dependency), rt setup (`lib/setup`).

**Spec:** `docs/superpowers/specs/2026-11-16-editor-terminal-font-design.md`

## Global Constraints

- Font family name, verbatim: `JetBrainsMonoNL Nerd Font`; files `JetBrainsMonoNLNerdFont-*.ttf`.
- Font installed into `~/Library/Fonts` from the pinned Nerd Fonts release `JetBrainsMono.zip` (pinned version + sha256); never Homebrew.
- Font detected only by `JetBrainsMonoNLNerdFont-*.ttf` in `~/Library/Fonts` or `/Library/Fonts`.
- Already-Nerd value: any family containing `Nerd Font` or ending ` NF` (case-insensitive) is left alone.
- Set value: append `, 'JetBrainsMonoNL Nerd Font'`. Unset value: `editor.fontFamily` if set, else `Menlo, Monaco, 'Courier New', monospace`, then the append.
- Editors and settings paths, verbatim from the spec table (VS Code `Code`, `Cursor`, `Antigravity`, `Antigravity IDE`, each `~/Library/Application Support/<dir>/User/settings.json`).
- Edits keep comments and formatting (`jsonc-parser` `modify` + `applyEdits`), written atomically (`Probes` atomic replace).
- An undo sticks: when the key no longer holds the font and differs from what rt last wrote, never write it again.
- The row is optional: never `required`, never blocks Install or Finish.
- No tests touch the real `~/Library`; everything goes through `Probes` seams and temp dirs.
- Repo rules: targeted tests only; `bunx tsc --noEmit -p .` clean; setup copy snapshots updated deliberately; output only via setup emitters.

## Review Focus

1. A `settings.json` with comments, trailing commas or odd indentation: the edit keeps every other byte (Task 2 test).
2. A `settings.json` that does not parse: leave it untouched and report the editor as skipped with the reason, never rewrite it (Task 2 test).
3. The member removed the fallback after rt added it: update runs leave it removed (Task 3 test).
4. Offline or failed font download on `rt setup update`: a quiet `skipped`, editors still edited only once the font exists (Task 3 test).
5. An editor installed but never opened (no `User/` dir): create `User/settings.json` with only this key (Task 2 test).

---

### Task 1: Pure font-family core

**Files:**
- Create: `lib/setup/editor-font.ts`
- Test: `lib/setup/__tests__/editor-font.test.ts`

**Interfaces:**
- Produces:
  - `export const NERD_FAMILY = "JetBrainsMonoNL Nerd Font"`
  - `export const EDITOR_DEFAULT_FONT = "Menlo, Monaco, 'Courier New', monospace"`
  - `export function hasNerdFont(family: string): boolean`
  - `export function nextTerminalFont(input: { terminal: string | undefined; editor: string | undefined; lastWritten: string | undefined }): { action: "keep" | "write"; value?: string; reason: "has-nerd" | "member-undid" | "appended" | "seeded" }`

- [ ] **Step 1: Write failing tests**: `hasNerdFont` true for `"JetBrainsMonoNL Nerd Font"`, `"Hack Nerd Font Mono"`, `"FiraCode NF"`; false for `"Fira Code, Menlo"`. `nextTerminalFont`: set `"Fira Code"` → write `"Fira Code, 'JetBrainsMonoNL Nerd Font'"`/appended; unset with editor `"SF Mono"` → `"SF Mono, 'JetBrainsMonoNL Nerd Font'"`/seeded; unset, no editor → `"Menlo, Monaco, 'Courier New', monospace, 'JetBrainsMonoNL Nerd Font'"`; already Nerd → keep/has-nerd; `lastWritten` set, terminal differs and lacks the font → keep/member-undid; terminal equal to `lastWritten` → keep/has-nerd.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/editor-font.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the three exports in `lib/setup/editor-font.ts`.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit** `setup: decide an editor terminal's Nerd Font fallback`.

### Task 2: Install the font and edit editor settings

**Files:**
- Modify: `lib/setup/editor-font.ts`
- Modify: `lib/editors.ts` (add a `settingsDir` per supported editor, or a separate table beside `EDITOR_PATTERNS`)
- Modify: `lib/setup/tools-install.ts` (pinned font zip entry beside `VENDOR_INSTALLERS`; host allowlist gets `github.com`'s release host if not already)
- Modify: `lib/setup/state.ts` (`SetupState.editorFontWritten?: Record<string, string>`, settings path → value rt wrote; parse tolerates it missing)
- Test: `lib/setup/__tests__/editor-font.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `export function nerdFontInstalled(p: Probes): boolean`
  - `export async function installNerdFont(p: Probes, log: (line: string) => void): Promise<{ ok: true } | { ok: false; detail: string }>` (download pinned zip, verify sha256, copy only `JetBrainsMonoNLNerdFont-*.ttf` into `~/Library/Fonts`, clean temp)
  - `export type EditorFontResult = { editor: string; path: string; outcome: "written" | "kept" | "member-undid" | "unreadable" | "not-installed"; value?: string }`
  - `export function applyEditorFonts(p: Probes, written: Record<string, string>): EditorFontResult[]` (per supported editor: skip if app not installed; read settings, `parse` with errors; parse errors → `unreadable`, untouched; else `nextTerminalFont`; write via `modify`/`applyEdits` + atomic replace; create `User/settings.json` when missing)

- [ ] **Step 1: Write failing tests** (temp-dir `Probes`): comments and trailing commas survive the edit byte-for-byte except the one key; an unparseable file is left untouched and reported `unreadable`; a missing `User/` dir gets a new `settings.json` holding only the key; an editor whose app is absent is `not-installed`; `installNerdFont` with a fake fetch serving a zip of two `JetBrainsMonoNLNerdFont-*.ttf` plus one other font copies only the two; a sha256 mismatch returns `{ ok: false }` and copies nothing.
- [ ] **Step 2: Run** the test file. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the exports; reuse `detectEditors`/`EDITOR_PATTERNS` for "installed"; reuse the vendor download helper's fetch + host allowlist.
- [ ] **Step 4: Run** the test file and `bunx tsc --noEmit -p .`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `setup: install the Nerd Font and add it to editor terminals`.

### Task 3: Setup step and checklist row

**Files:**
- Create: `lib/setup/steps/editor-font.ts`
- Modify: `lib/setup/contract.ts` (`STEP_IDS` gets `"editor.terminal-font"` after `"claude.permissions"`), `lib/setup/steps/index.ts` (register), `lib/setup/__tests__/update-safe.test.ts` (add it to the pinned set)
- Modify: `lib/setup/validators/tools.ts` (row `editor.terminal-font` after `tool.editor`), `lib/setup/expectations.ts` (`ROW_TARGETS["editor.terminal-font"] = "install"`), `lib/setup/regroup.ts` (`"editor.terminal-font": "agents"`)
- Check: `rt-tray/Sources-core/Contract/PlanModels.swift` and any tray step-id list; add the id only if the tray pins step or row ids
- Test: `lib/setup/__tests__/steps-editor-font.test.ts` (copy the twin of an existing step test), `commands/__tests__/setup-copy.test.ts` snapshot

**Interfaces:**
- Consumes: Task 2.
- Produces: `export const editorFontStep: StepDef` (`id: "editor.terminal-font"`, `kind: "rt"`, `updateSafe: true`, `applies: () => true`) whose run: font missing → `installNerdFont` (on an update run a failure is `skipped` with the detail; on a full run `failed` with a Retry remedy); then `applyEditorFonts`, record each `written` value in `SetupState.editorFontWritten`; outcome detail names the editors written.

Row: `ready` when every installed supported editor's terminal font has a Nerd Font (member-undid counts as ready, by choice); `missing` with `runAction("editor.terminal-font")` otherwise; `skipped` when no supported editor is installed; `required: false`; `recheck: "on-activate"`.

- [ ] **Step 1: Write failing tests**: a full run with no font and two editors installs the font and writes both; an update run with the fetch failing returns `skipped` and writes nothing; a second update run after the member removed the font from one editor leaves that file unchanged; the row reads `missing` with the run action before and `ready` after; `skipped` with no editors; `update-safe.test.ts` includes the id.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/steps-editor-font.test.ts lib/setup/__tests__/update-safe.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the step, registration and row; copy in command-description style (`rt:ui-copy`).
- [ ] **Step 4: Run** those tests, the setup validators' tests touched, `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` (review the diff: only the new row's lines), and `bunx tsc --noEmit -p .`. Expected: PASS.
- [ ] **Step 5: Commit** `setup: an editor terminal font step and row`.
