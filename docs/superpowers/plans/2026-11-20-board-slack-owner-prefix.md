# Board code owner post prefix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team-shared `board.slack.ownerPrefix` template, prepended to the board's posts in other teams' code owner channels and shown in the post dialog.

**Architecture:** The setting is a new optional string field on the existing `board.slack` team object. The board server renders it per code owner channel (MR placeholders plus `{sections}`), returns it with the preview, and prepends it at post time; the team review post is untouched. The dialog shows each channel's rendered prefix under its switch.

**Tech Stack:** Bun, TypeScript, zod (settings schemas), React (board client), bun:test with happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-20-board-slack-owner-prefix-design.md`

## Global Constraints

- Field name `ownerPrefix`, default `""`; an unset or blank prefix leaves every post byte-identical to today.
- Prefix and body join with exactly one space.
- `{sections}` is the channel's sections through `sectionLabel(section, channel)`, joined with `", "`.
- The team review post (`team.channel`) never gets the prefix.
- Run board tests from `apps/board` (`cd apps/board && bun test <file>`); run rt-client and root tests from the repo root. Targeted tests only; CI runs the rest.
- Never run a built binary or a second board against the real HOME.
- Docs and examples use placeholder names only (acme, widgets).

## Review Focus

- A blank or whitespace-only `ownerPrefix` must not add a leading space: covered in Task 2's render tests.
- An edited message body still gets the prefix in owner channels: Task 3 posts with a `text` override.
- The team row carrying our own sections gets no prefix even when owner channels do: Task 3's team-plus-owner post test.
- A section name with no `#channel` suffix renders whole in `{sections}`: Task 2's render tests.
- An unknown placeholder like `{foo}` in the prefix is left as typed, the same as the other templates: Task 2's render tests.

---

### Task 1: Declare `ownerPrefix` on `board.slack`

**Files:**
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (`"board.slack"` object, ~line 283)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`board.slack` row, ~line 622)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts` (`"board.slack"`, ~line 361)
- Regenerate: `packages/rt-client/src/settings/schema.lock.json`

**Interfaces:**
- Produces: `board.slack.ownerPrefix?: string`, resolved default `""`.

- [ ] **Step 1: Add examples.** In `schema-examples.ts`, add `ownerPrefix: "Code owner review ({sections}):"` to the full good example, and a bad entry `{ value: { ownerPrefix: 1 }, path: ["ownerPrefix"] }`.
- [ ] **Step 2: Run, expect fail.** `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts` fails on the bad `ownerPrefix` entry (loose object accepts it).
- [ ] **Step 3: Schema.** Add `ownerPrefix: z.string().optional().meta({ title: "Code owner prefix", description: "Put before posts in other teams' code owner channels. {sections} names the sections asked; MR placeholders like {title} work too." })`.
- [ ] **Step 4: Registry row.** Add `ownerPrefix: ""` to the row's `default`, and mention it in the description: `"... templates, the code owner prefix, callback port, reviewKind ..."`.
- [ ] **Step 5: Regenerate the lock.** From the repo root: `bun run cli.ts settings schema lock`.
- [ ] **Step 6: Run, expect pass.** `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts` passes, and `bun test apps/console/src/app/settings/groups.test.ts` if that path exists (find it with `rg -l groups.test apps/console`).
- [ ] **Step 7: Rebuild rt-client dist** so the board sees the field: `bun install` at the root (its postinstall rebuilds `packages/rt-client/dist`).
- [ ] **Step 8: Commit.** `git commit -m "settings: board.slack.ownerPrefix for code owner posts"`

### Task 2: Board config and prefix rendering

**Files:**
- Modify: `apps/board/src/config.ts` (`SlackConfig` ~285, `DEFAULT_SLACK` ~301, the slack parser ~550-580)
- Modify: `apps/board/src/codeowner-posts.ts` (receive `sectionLabel`)
- Modify: `apps/board/src/client/board/OwnersPostModal.tsx` (import `sectionLabel` instead of defining it)
- Modify: `apps/board/src/template.ts`
- Test: `apps/board/src/__tests__/config-store.test.ts`, `apps/board/src/__tests__/template.test.ts`

**Interfaces:**
- Produces:
  - `SlackConfig.ownerPrefix: string` (default `''`).
  - `export function sectionLabel(section: string, channel?: string): string` in `codeowner-posts.ts`, body moved unchanged from the modal.
  - `export function renderOwnerPrefix(template: string, facts: MrFacts, sections: string): string` in `template.ts`: `{sections}` plus every `MrFacts` key, result trimmed.
  - `export function withOwnerPrefix(prefix: string, body: string): string`: `body` when `prefix` is `''`, else `` `${prefix} ${body}` ``.

- [ ] **Step 1: Failing tests.**
  - `config-store.test.ts`: in "a partial store slack object gets the default fill…", add `ownerPrefix: ''` to the expected object; add a test that `'board.slack': { ownerPrefix: 'CO ({sections}):' }` yields `cfg.slack.ownerPrefix === 'CO ({sections}):'`, and one that `ownerPrefix: 3` throws `"slack.ownerPrefix" must be a string`.
  - `template.test.ts`, with `facts` = `{ iid: 7, title: 'ACME-1 Add refunds', url: 'https://gitlab.example.com/a/b/-/merge_requests/7', ticket: 'ACME-1', author: 'dev1', sourceBranch: 'f', targetBranch: 'main' }`:
    - `renderOwnerPrefix('Code owner review ({sections}) for {ticket}:', facts, 'Acme, Acme Jobs')` → `'Code owner review (Acme, Acme Jobs) for ACME-1:'`
    - `renderOwnerPrefix('', facts, 'Acme')` → `''`; `renderOwnerPrefix('   ', facts, 'Acme')` → `''`
    - `renderOwnerPrefix('{foo} {sections}', facts, 'Acme')` → `'{foo} Acme'`
    - `withOwnerPrefix('', 'body')` → `'body'`; `withOwnerPrefix('CO:', 'body')` → `'CO: body'`
  - A `sectionLabel` test beside the existing codeowner-posts tests (find with `rg -l codeowner-posts apps/board/src/__tests__`): `sectionLabel('Acme - #pod-acme', 'pod-acme')` → `'Acme'`; `sectionLabel('Docs', undefined)` → `'Docs'`; `sectionLabel('Docs', 'pod-acme')` → `'Docs'`.
- [ ] **Step 2: Run, expect fail.** `cd apps/board && bun test src/__tests__/config-store.test.ts src/__tests__/template.test.ts <codeowner-posts test>`
- [ ] **Step 3: Implement.** Config: `ownerPrefix` must be a string when set (empty allowed, unlike the templates); default `''`. Move `sectionLabel` and import it in the modal. Add the two template helpers; `renderOwnerPrefix` reuses `replace` with the `renderMr` values plus `sections`.
- [ ] **Step 4: Run, expect pass.** Same command, plus `src/client/board/__tests__/owners-post-modal-dom.test.tsx` to prove the move broke nothing.
- [ ] **Step 5: Commit.** `git commit -m "board: ownerPrefix config and code owner prefix rendering"`

### Task 3: Prefix on owner channel posts and in the preview

**Files:**
- Modify: `apps/board/src/server.ts` (`mrPostText` ~1422, `ownersPreviewOrPost` ~1746)
- Test: `apps/board/src/__tests__/server-slack-owners.test.ts`

**Interfaces:**
- Consumes: `config.slack.ownerPrefix`, `renderOwnerPrefix`, `withOwnerPrefix`, `sectionLabel` (Task 2).
- Produces: the preview's `channels` entries gain `prefix?: string`, present only when the rendered prefix is non-empty.

- [ ] **Step 1: Failing tests.** Give `bootBoard` an optional `teamSettings` written to `teams/web/settings.team.jsonc` (today `'{}'`), and boot the main `board` with `{ 'board.slack': { ownerPrefix: 'Code owner review ({sections}) for {ticket}:' } }`. Then:
  - In "preview groups unapproved sections…", expect `channels` to equal `[{ channel: 'acme-channel', sections: [...as today], prefix: 'Code owner review (Acme, Acme Jobs) for ACME-1:' }]`.
  - In "post sends once per confirmed channel…", expect `messages[0]!.text` to equal `` `Code owner review (Acme, Acme Jobs) for ACME-1: ACME-1 An MR: ${url('g/p', 701)}` ``.
  - New test on an unposted MR whose plan has both the team row and an owner channel (reuse the MR from "posting only the team row…" or add one to `APPROVAL_BY_IID`): post `{ team: true, channels: [<owner channel>], text: 'please look' }`; the team channel's message is exactly `'please look'` and the owner channel's is `'Code owner review (<its sections>) for ACME-1: please look'`.
  - `lateDirectoryBoard` keeps the empty team store: add a check that its preview channels carry no `prefix` key, if its directory allows a preview; otherwise rely on Task 2's blank-prefix test.
- [ ] **Step 2: Run, expect fail.** `cd apps/board && bun test src/__tests__/server-slack-owners.test.ts`
- [ ] **Step 3: Implement.** Extract `mrFacts(m: BoardMR): MrFacts` from `mrPostText` and reuse it there. In `ownersPreviewOrPost`, `prefixFor(c: { channel: string; sections: string[] })` renders `config.slack.ownerPrefix` with `c.sections.map(s => sectionLabel(s, c.channel)).join(', ')`. The preview maps `plan.channels` to add `prefix` when non-empty; the owner loop posts `withOwnerPrefix(prefixFor(planned channel), text)`. The team post is unchanged.
- [ ] **Step 4: Run, expect pass.** Same command.
- [ ] **Step 5: Commit.** `git commit -m "board: prefix code owner channel posts with ownerPrefix"`

### Task 4: Show the prefix in the dialog, document it

> Superseded during build: the dialog shipped as design D. See the spec's "Superseded during build" section.

**Files:**
- Modify: `apps/board/src/client/board/OwnersPostModal.tsx` (`SlackPostPreview` ~12, channel rows ~189)
- Test: `apps/board/src/client/board/__tests__/owners-post-modal-dom.test.tsx`
- Modify: `apps/board/docs/slack.md` (field table ~84), `sites/docs/docs/apps/board.mdx` (dialog list ~256)

**Interfaces:**
- Consumes: preview `channels[].prefix?: string` (Task 3).

- [ ] **Step 1: Failing DOM test.** `'a code owner channel shows the prefix it will get'`: open with `PREVIEW` whose `pod-acme` channel has `prefix: 'Code owner review (Acme, Acme Jobs):'`; expect that text inside the `pod-acme` row (the toggle's label element), and expect no prefix text in the `code-review` row or the `pod-docs` row (no `prefix`).
- [ ] **Step 2: Run, expect fail.** `cd apps/board && bun test src/client/board/__tests__/owners-post-modal-dom.test.tsx`
- [ ] **Step 3: Implement.** `SlackPostPreview`'s channel entries take `prefix?: string`. Under a channel's sections line, render the prefix in muted text when present, styled like `tui-owners-sections` (reuse that class or a sibling in the same stylesheet; colour by role per `docs/apps/ui-authoring.md`, no raw values).
- [ ] **Step 4: Run, expect pass.** Same command.
- [ ] **Step 5: Look at it.** Render the dialog with a prefixed preview through the `initial` prop in a throwaway, uncommitted story (or the board's fixture mode, if it reaches the dialog), and screenshot it in light and dark with Fast Browser. Say plainly anything that reads wrong. If `capture:compare` (in `apps/board`) changes, regenerate baselines only for this intended change.
- [ ] **Step 6: Docs.** `apps/board/docs/slack.md`: a table row, `` | `ownerPrefix` | put before posts in other teams' code owner channels. `{sections}` names the sections asked; the MR placeholders work too. Default empty | ``. `board.mdx`: after "One switch for each other team's code owners channel still to ask.", add that a channel's switch shows the prefix from the `ownerPrefix` key of `board.slack` that its post starts with, and that the team channel post never gets it. Gate per `sites/docs/AGENTS.md`: `python3 skills/doc-standards/scripts/check_docs.py sites/docs/docs/apps/board.mdx --no-vale`, `bun run docs:check`, `bun run docs:build`.
- [ ] **Step 7: Commit.** `git commit -m "board: show the code owner prefix in the post dialog; docs"`
