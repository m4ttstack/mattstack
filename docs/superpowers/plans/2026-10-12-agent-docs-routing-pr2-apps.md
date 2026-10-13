# Agent Docs Routing, PR 2 (Apps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `apps/AGENTS.md` from 928 lines to under 200 by moving the numbered kit contract, text unchanged, into path-scoped rules under `.claude/rules/apps/`, and make `plugins/herdr-chat/AGENTS.md` load in Claude Code.

**Architecture:** The same one-off split and verify scripts as PR 1, with a new manifest. The guard from PR 1 gains `apps/AGENTS.md` in its capped list; rule files in the `apps/` subdirectory are already found and indexed by full path.

**Tech Stack:** Bun, `bun:test`, Markdown.

**Spec:** `docs/superpowers/specs/2026-10-12-agent-docs-routing-design.md` (Phase 2)

## Global Constraints

- Moved text is unchanged. New lines are frontmatter, one `# ` title per rule, the pointer section in `apps/AGENTS.md`, and eight index rows in root `AGENTS.md`.
- Frontmatter form, 200-line caps and the no-dash rule are as in PR 1; the guard enforces the first two.
- Section numbers stay in the moved headings, so "see §2" still resolves by search.
- Per-app `AGENTS.md` files are not edited.
- Run each `git` command as its own plain command in this worktree session.

## Review Focus

- A board or deck session must not load the Mantine kit rules: no kit rule may match `apps/board/**` or `apps/deck/**`. (Task 1, step 6.)
- A `packages/ui/src` edit must load the kit rules, which it never did before. (Task 1, live check.)
- Brace globs (`apps/{chat,console,boxscore}/...`) must count as matching in the guard and in Claude Code. (Guard on the real tree; live check on an `apps/chat` file.)
- The root file must stay under 200 lines after eight more index rows. (Guard.)
- `plugins/herdr-chat/AGENTS.md` must load when a file there is read. (Task 2.)

---

### Task 1: Split `apps/AGENTS.md`

**Files:**
- Modify: `apps/AGENTS.md` (rebuilt), `AGENTS.md` (eight index rows)
- Create: `.claude/rules/apps/*.md` (8 files)
- Modify: `lib/__tests__/no-agent-docs-bloat.test.ts`, `lib/__tests__/no-nested-team-pack.test.ts`
- Scratch, not committed: `split-apps.ts`, `verify-apps.ts`, `apps.before.md`

- [ ] **Step 1: Make the guard cover the apps file**

In `lib/__tests__/no-agent-docs-bloat.test.ts`:

```ts
const ALWAYS_LOADED = ["AGENTS.md", "apps/AGENTS.md"];
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test lib/__tests__/no-agent-docs-bloat.test.ts`
Expected: FAIL with `apps/AGENTS.md is 928 lines; the cap is 200.`

- [ ] **Step 3: Snapshot and split**

Copy `apps/AGENTS.md` to the scratchpad as `apps.before.md` and confirm `wc -l` prints 928. The split script slices these line ranges (each range runs to the line before the next heading):

| Destination | Ranges | `paths` |
|---|---|---|
| `apps/AGENTS.md` (kept) | 1-76, 121-166 | n/a |
| `apps-ci-and-publishing.md` | 77-120, 167-191 | `turbo.json`, `scripts/turbo.sh`, `scripts/set-platform-version.ts`, `packages/*/package.json`, `apps/*/package.json` |
| `kit-import-walls.md` | 192-308 | `apps/{chat,console,boxscore}/src/**`, `packages/ui/src/**`, `packages/ui/presets/**`, `eslint.config.mjs`, `apps/*/eslint.config.js` |
| `kit-components.md` | 309-456 | `packages/ui/src/core/**`, `packages/ui/src/icons/**`, `packages/ui/scripts/**` |
| `kit-theme.md` | 457-606 | `packages/ui/src/design-system/**`, `packages/ui/src/styles/**`, `packages/tokyo/**`, `packages/tokens/**` |
| `kit-recipes.md` | 607-698, 924-928 | `apps/{chat,console,boxscore}/src/**`, `packages/ui/src/hooks/**` |
| `kit-app-layer.md` | 699-815 | `packages/ui/src/app/**`, `packages/ui/src/router/**`, `packages/ui/src/boot/**`, `apps/{chat,console,boxscore}/index.html`, `apps/{chat,console,boxscore}/src/app/**` |
| `app-server.md` | 816-846 | `packages/server/**`, `apps/*/src/server/**` |
| `kit-consumer-requirements.md` | 847-923 | `apps/{chat,console,boxscore}/package.json`, `apps/{chat,console,boxscore}/vite.config.ts`, `apps/{chat,console,boxscore}/src/app/**`, `apps/{chat,console,boxscore}/src/main.tsx` |

The script throws unless the ranges cover lines 1 to 928 exactly once. It appends this section to the kept file:

```markdown
## Where the numbered sections live

Sections 1 to 10, "CI shape" and "Publishing" are rule files under
`.claude/rules/apps/`. Each loads by itself when you read or edit a file
matching its paths; the root `AGENTS.md` index lists them.
```

and inserts one index row per rule after the last `.claude/rules/` row in root `AGENTS.md`, in the same three-column form.

- [ ] **Step 4: Prove no line was lost**

Run the verify script against `apps.before.md`, the new `apps/AGENTS.md` and `.claude/rules/apps/`.
Expected: `missing: 0`, `unexpected additions: 0`.

- [ ] **Step 5: Run the guard**

Run: `bun test lib/__tests__/no-agent-docs-bloat.test.ts`
Expected: PASS. A glob that matches nothing is corrected in the manifest and the split rerun from the snapshot.

- [ ] **Step 6: Check no kit rule reaches board or deck**

Run: `grep -n -E 'apps/(\*|board|deck)/' .claude/rules/apps/kit-*.md`
Expected: only `apps/*/eslint.config.js` in `kit-import-walls.md`. Board and deck have no `eslint.config.js` that the wall applies to; if either has that file, replace the glob with `apps/{chat,console,boxscore}/eslint.config.js`.

- [ ] **Step 7: Keep the apps file under the team-pack doc scan**

In `lib/__tests__/no-nested-team-pack.test.ts`, add `"apps/AGENTS.md"` to `DOC_SCAN`.

Run: `bun test lib/__tests__/no-nested-team-pack.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/AGENTS.md AGENTS.md .claude/rules/apps lib/__tests__/no-agent-docs-bloat.test.ts lib/__tests__/no-nested-team-pack.test.ts
```
```bash
git commit -m "docs: move the apps kit contract into path-scoped .claude/rules/apps"
```

---

### Task 2: The herdr-chat shim

**Files:**
- Create: `plugins/herdr-chat/CLAUDE.md`

- [ ] **Step 1: Write the shim**

`plugins/herdr-chat/CLAUDE.md`, the same one line the other nested shims hold:

```markdown
@AGENTS.md
```

- [ ] **Step 2: Confirm it loads**

Read `plugins/herdr-chat/AGENTS.md`'s neighbour (any source file in `plugins/herdr-chat/`) in a live session and confirm the plugin's instructions arrive as a loaded instruction file.

- [ ] **Step 3: Check the plugin's own CI job accepts the new file**

Run the checks the `plugin-herdr-chat` job runs (named in `.github/workflows/checks.yml`).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/herdr-chat/CLAUDE.md
```
```bash
git commit -m "herdr-chat: load AGENTS.md in Claude Code"
```

---

### Task 3: Sizes, gates, PR

- [ ] **Step 1:** Record `wc -l -c` for `apps/AGENTS.md` before and after, and the root file's new line count.
- [ ] **Step 2:** Run `bun run purity`, then the three touched test files (`no-agent-docs-bloat`, `no-nested-team-pack`, `scripts/ci/__tests__/test-scope.test.ts`), then `bunx prettier --check apps/AGENTS.md`. `apps/AGENTS.md` is prettier-checked (only root Markdown and `.claude` are ignored), so the kept ranges and the pointer section must pass as written.
- [ ] **Step 3:** Push, open the PR titled `docs: route the apps kit contract by path`, wait for CodeRabbit and CI, address findings, and merge on Matt's confirmation.
