# mattstack docs (docs.mattstack.dev) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the rt.cool Docusaurus site into the mattstack docs at docs.mattstack.dev, styled like mattstack.dev, with a current README and release skills that check and deploy the whole site.

**Architecture:** One Docusaurus project in `website/` with one docs plugin and five sidebars (start, apps, rt, gitq, skills) behind navbar tabs. rt's generated reference moves under `docs/rt/reference/`, and gitq's site folds in under `docs/gitq/`. A single moves table (`scripts/lib/docs-moves.ts`) drives the link rewrite, the rt.cool `_redirects` file and the pre-cutover sitemap check.

**Tech Stack:** Docusaurus 3 (classic preset, theme-mermaid), Bun, TypeScript, `bun:test`, Cloudflare Pages via wrangler, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-06-mattstack-docs-design.md`

## Global Constraints

- Base branch: PR #667 (`org-teams-1-resolver`). Rebase `mattstack-docs` onto `origin/org-teams-1-resolver` before each PR. Once #667 merges, rebase onto `origin/main`.
- Site URL `https://docs.mattstack.dev`, `baseUrl: "/"`. Cloudflare Pages project `mattstack-docs`.
- Tabs and folders: Get started `website/docs/start/`, Apps `website/docs/apps/`, rt CLI `website/docs/rt/`, gitq `website/docs/gitq/`, Skills `website/docs/skills/`.
- rt reference root: `website/docs/rt/reference/`. Generated pages are never hand-edited.
- `onBrokenLinks`, `onBrokenAnchors` and `markdown.hooks.onBrokenMarkdownLinks` stay `"throw"`.
- Accent `#e64980`. Font Inter 400 to 700 from Google Fonts. Tokens are copied from `~/Documents/GitHub/mattstack.dev/index.html` `:root` and its light `@media` block.
- No em dashes or en dashes in any new copy, comment or commit message.
- New copy is written from source. A claim that cannot be traced to code or an existing doc is left out.
- Comments state only constraints the code cannot show (clean-code comment rule).
- Run `bun test` from the worktree root only (bunfig preload). Run targeted tests for the files you touch; CI runs the full suite.
- Every skill edit goes through superpowers:writing-skills (RED baseline, then GREEN).
- Nothing deploys, creates a Cloudflare project or touches DNS before Task 17, and Task 17 runs only on Matt's go.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A trailing-slash or anchored rt.cool URL** (`rt.cool/guides/daemon/`, `rt.cool/reference/git/rebase#flags`). A person expects to land on the same page at docs.mattstack.dev. Pinned in Task 1 (`resolveRedirect` trailing-slash and anchor tests) and Task 5 (both `from` and `from/` rules emitted).
2. **A hand-written reference file after regeneration at the new root.** `_partials/`, `_category_.json` and `global.mdx` must survive `docs:gen`. Pinned in Task 2 (`docs-clean` survival test at `website/docs/rt/reference`).
3. **A gitq page linking to another gitq page by its old absolute path** (`/concepts/cascade`). It must resolve to `/gitq/concepts/cascade`, not to an rt page or a 404. Pinned in Task 1 (`rewriteLink` with `{ gitq: true }`) and by the build's `throw` in Task 3.
4. **A changed file that maps to no docs area** (`lib/daemon/x.ts`, `README.md`). The impact list must stay empty for it rather than invent a page. Pinned in Task 13.
5. **A redirect that answers 301 but to the wrong host or path.** The smoke check must fail on a wrong `Location`, not only on a wrong status. Pinned in Task 14 (`evaluate` with a mismatched location).

---

## Phase A: structure (PR 1)

### Task 1: The moves table

One table maps every old rt.cool route to its new docs route. Three later consumers read it: the link rewrite, the `_redirects` file and the sitemap check.

**Files:**
- Create: `scripts/lib/docs-moves.ts`
- Test: `scripts/__tests__/docs-moves.test.ts`

**Interfaces:**
- Produces:
  - `type DocsMove = { from: string; to: string; prefix?: boolean }`
  - `const DOCS_MOVES: readonly DocsMove[]`
  - `const DOCS_HOST = "https://docs.mattstack.dev"`
  - `function resolveRedirect(path: string): string` (an old rt.cool path to a new path; a path with no rule maps to `/`)
  - `function rewriteLink(href: string, opts?: { gitq?: boolean }): string` (rewrites an internal absolute href; anything else comes back unchanged)

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/docs-moves.test.ts
import { describe, expect, test } from "bun:test";
import { DOCS_MOVES, resolveRedirect, rewriteLink } from "../lib/docs-moves.ts";

describe("resolveRedirect", () => {
  test("old home goes to the rt tab", () => {
    expect(resolveRedirect("/")).toBe("/rt");
  });
  test("reference pages keep their path under /rt", () => {
    expect(resolveRedirect("/reference/git/rebase")).toBe("/rt/reference/git/rebase");
    expect(resolveRedirect("/reference")).toBe("/rt/reference");
  });
  test("a trailing slash resolves like the bare path", () => {
    expect(resolveRedirect("/guides/daemon/")).toBe("/start/daemon");
    expect(resolveRedirect("/reference/cd/")).toBe("/rt/reference/cd");
  });
  test("guides split between tabs", () => {
    expect(resolveRedirect("/guides/common-flags")).toBe("/rt/guides/common-flags");
    expect(resolveRedirect("/guides/teams-and-invites")).toBe("/start/teams");
    expect(resolveRedirect("/guides/gates")).toBe("/skills/gates");
  });
  test("getting-started pages are renamed explicitly", () => {
    expect(resolveRedirect("/getting-started/just-me")).toBe("/start/setup");
    expect(resolveRedirect("/getting-started/first-commands")).toBe("/rt/first-commands");
  });
  test("an unknown path falls back to the docs home", () => {
    expect(resolveRedirect("/nope")).toBe("/");
  });
});

describe("rewriteLink", () => {
  test("keeps the anchor", () => {
    expect(rewriteLink("/reference/git/rebase#flags")).toBe("/rt/reference/git/rebase#flags");
    expect(rewriteLink("/guides/tray#quit")).toBe("/start/menu-bar-app#quit");
  });
  test("leaves external, relative and already-moved links alone", () => {
    expect(rewriteLink("https://github.com/m4ttstack")).toBe("https://github.com/m4ttstack");
    expect(rewriteLink("run")).toBe("run");
    expect(rewriteLink("/rt/reference/cd")).toBe("/rt/reference/cd");
  });
  test("gitq links are prefixed with /gitq, not mapped through rt's moves", () => {
    expect(rewriteLink("/concepts/cascade", { gitq: true })).toBe("/gitq/concepts/cascade");
    expect(rewriteLink("/guides/publish#draft", { gitq: true })).toBe("/gitq/guides/publish#draft");
    expect(rewriteLink("/", { gitq: true })).toBe("/gitq");
    expect(rewriteLink("/gitq/intro", { gitq: true })).toBe("/gitq/intro");
  });
});

test("every from is unique and every to is under a tab folder", () => {
  const froms = DOCS_MOVES.map((m) => m.from);
  expect(new Set(froms).size).toBe(froms.length);
  for (const m of DOCS_MOVES) expect(m.to).toMatch(/^\/(start|apps|rt|gitq|skills)(\/|$)/);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test scripts/__tests__/docs-moves.test.ts`
Expected: FAIL, cannot find module `../lib/docs-moves.ts`

- [ ] **Step 3: Implement**

```ts
// scripts/lib/docs-moves.ts
export type DocsMove = { from: string; to: string; prefix?: boolean };

export const DOCS_HOST = "https://docs.mattstack.dev";

const RT_GUIDES = [
  "chat", "common-flags", "context-extension", "glitter", "logging",
  "picker", "plugins", "proxy", "runner", "strongdm",
];

export const DOCS_MOVES: readonly DocsMove[] = [
  { from: "/", to: "/rt" },
  { from: "/reference", to: "/rt/reference", prefix: true },
  { from: "/getting-started/install", to: "/start/install" },
  { from: "/getting-started/just-me", to: "/start/setup" },
  { from: "/getting-started/onboard-a-repo", to: "/start/onboard-a-repo" },
  { from: "/getting-started/first-commands", to: "/rt/first-commands" },
  { from: "/guides/teams-and-invites", to: "/start/teams" },
  { from: "/guides/tray", to: "/start/menu-bar-app" },
  { from: "/guides/daemon", to: "/start/daemon" },
  { from: "/guides/state-backup", to: "/start/state-backup" },
  { from: "/guides/gates", to: "/skills/gates" },
  { from: "/guides/mcp", to: "/skills/mcp" },
  ...RT_GUIDES.map((g) => ({ from: `/guides/${g}`, to: `/rt/guides/${g}` })),
];

function strip(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function mapPath(path: string): string | undefined {
  const p = strip(path);
  for (const m of DOCS_MOVES) {
    if (p === m.from) return m.to;
    if (m.prefix && p.startsWith(`${m.from}/`)) return m.to + p.slice(m.from.length);
  }
  return undefined;
}

export function resolveRedirect(path: string): string {
  return mapPath(path) ?? "/";
}

export function rewriteLink(href: string, opts: { gitq?: boolean } = {}): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const hash = href.indexOf("#");
  const path = hash >= 0 ? href.slice(0, hash) : href;
  const anchor = hash >= 0 ? href.slice(hash) : "";
  if (opts.gitq) {
    if (path === "/gitq" || path.startsWith("/gitq/")) return href;
    return (path === "/" ? "/gitq" : `/gitq${strip(path)}`) + anchor;
  }
  if (/^\/(start|apps|rt|gitq|skills)(\/|$)/.test(path)) return href;
  const to = mapPath(path);
  return to ? to + anchor : href;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test scripts/__tests__/docs-moves.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/docs-moves.ts scripts/__tests__/docs-moves.test.ts
git commit -m "docs site: moves table for the docs.mattstack.dev layout"
```

### Task 2: Move the generator to the new reference root

**Files:**
- Modify: `scripts/lib/docs-hand.ts`, `scripts/lib/docs-render.ts:117`, `scripts/gen-docs.ts`, `scripts/check-docs.ts`
- Test: `scripts/__tests__/docs-render.test.ts`, `scripts/__tests__/docs-clean.test.ts`

**Interfaces:**
- Produces: `export const REFERENCE_ROOT = "website/docs/rt/reference"` from `scripts/lib/docs-hand.ts`. The rendered partial import becomes `@site/docs/rt/reference/_partials/<rel>.mdx`, and the common-flags href becomes `/rt/guides/common-flags`.

- [ ] **Step 1: Update the render test expectations to the new paths**

In `scripts/__tests__/docs-render.test.ts`, replace every `"/guides/common-flags"` with `"/rt/guides/common-flags"`, and change line 110's expectation to:

```ts
  expect(withPartial).toContain("import Notes from '@site/docs/rt/reference/_partials/run.mdx'");
```

- [ ] **Step 2: Add the survival test at the real root**

Append to `scripts/__tests__/docs-clean.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HAND_WRITTEN_REFERENCE, REFERENCE_ROOT } from "../lib/docs-hand.ts";
import { cleanGenerated } from "../lib/docs-clean.ts";

test("the reference root is the rt tab's reference folder", () => {
  expect(REFERENCE_ROOT).toBe("website/docs/rt/reference");
});

test("hand-written reference files survive a clean at the reference root", () => {
  const home = mkdtempSync(join(tmpdir(), "docs-clean-"));
  const root = join(home, REFERENCE_ROOT);
  mkdirSync(join(root, "_partials", "gate"), { recursive: true });
  writeFileSync(join(root, "_partials", "gate", "ask.mdx"), "x");
  writeFileSync(join(root, "_category_.json"), "{}");
  writeFileSync(join(root, "global.mdx"), "x");
  writeFileSync(join(root, "cd.mdx"), "generated");
  cleanGenerated(root, HAND_WRITTEN_REFERENCE);
  expect(existsSync(join(root, "_partials", "gate", "ask.mdx"))).toBe(true);
  expect(existsSync(join(root, "_category_.json"))).toBe(true);
  expect(existsSync(join(root, "global.mdx"))).toBe(true);
  expect(existsSync(join(root, "cd.mdx"))).toBe(false);
  rmSync(home, { recursive: true, force: true });
});
```

Merge the imports with any the file already has, without duplicating them.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `bun test scripts/__tests__/docs-render.test.ts scripts/__tests__/docs-clean.test.ts`
Expected: FAIL on the import path, the href and the missing `REFERENCE_ROOT` export.

- [ ] **Step 4: Implement**

`scripts/lib/docs-hand.ts`:

```ts
export const REFERENCE_ROOT = "website/docs/rt/reference";

/**
 * Files under REFERENCE_ROOT that are hand-written, not generated.
 * The generator must never delete them, and the drift check must ignore them.
 */
export const HAND_WRITTEN_REFERENCE = ["_partials", "_category_.json", "global.mdx"];
```

`scripts/lib/docs-render.ts` line 117:

```ts
        `import Notes from '@site/docs/rt/reference/_partials/${relPath}.mdx';`,
```

`scripts/gen-docs.ts`: import `REFERENCE_ROOT` with `HAND_WRITTEN_REFERENCE`, then set:

```ts
const OUT = (outIdx >= 0 ? args[outIdx + 1] : undefined) ?? REFERENCE_ROOT;
const PARTIALS_DIR = `${REFERENCE_ROOT}/_partials`;
```

and `common: { flags: COMMON_FLAGS, href: "/rt/guides/common-flags" }`.

`scripts/check-docs.ts`: import `REFERENCE_ROOT` and set `const COMMITTED = REFERENCE_ROOT;`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `bun test scripts/__tests__/docs-render.test.ts scripts/__tests__/docs-clean.test.ts scripts/__tests__/docs-walk.test.ts scripts/__tests__/docs-coverage.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/docs-hand.ts scripts/lib/docs-render.ts scripts/gen-docs.ts scripts/check-docs.ts scripts/__tests__/docs-render.test.ts scripts/__tests__/docs-clean.test.ts
git commit -m "docs site: generate rt's reference under docs/rt/reference"
```

`docs:check` fails between this commit and Task 3, because the committed pages haven't moved yet. Task 3 fixes that, and the PR ships both together.

### Task 3: Move the content into five tabs and fold gitq in

**Files:**
- Move (with `git mv`): every page listed in the table in Step 1
- Create: `website/docs/start/_category_.json`, `website/docs/rt/_category_.json`, `website/docs/rt/guides/_category_.json`, `website/docs/apps/index.mdx`, `website/docs/skills/_category_.json`
- Modify: `website/sidebars.ts`, `website/docusaurus.config.ts`, `website/package.json`, `website/bun.lock`, `turbo.json` (`//#docs:check` inputs need no change, since `website/docs/**` still covers them)
- Create (scratch, not committed): `$SCRATCH/relink.ts`

**Interfaces:**
- Consumes: `rewriteLink` from Task 1, `REFERENCE_ROOT` from Task 2.
- Produces: the five folders and their routes, which later tasks link to: `/start/...`, `/apps/<app>`, `/rt/...`, `/gitq/...`, `/skills/...`.

- [ ] **Step 1: Move the files**

```bash
cd website/docs
mkdir -p start rt/guides skills apps gitq
git mv getting-started/install.mdx start/install.mdx
git mv getting-started/just-me.mdx start/setup.mdx
git mv getting-started/onboard-a-repo.mdx start/onboard-a-repo.mdx
git mv getting-started/first-commands.mdx rt/first-commands.mdx
git mv guides/teams-and-invites.mdx start/teams.mdx
git mv guides/tray.mdx start/menu-bar-app.mdx
git mv guides/daemon.mdx start/daemon.mdx
git mv guides/state-backup.mdx start/state-backup.mdx
git mv guides/gates.mdx skills/gates.mdx
git mv guides/mcp.mdx skills/mcp.mdx
for g in chat common-flags context-extension glitter logging picker plugins proxy runner strongdm; do git mv guides/$g.mdx rt/guides/$g.mdx; done
git mv intro.mdx rt/index.mdx
git mv reference rt/reference
git rm -q getting-started/_category_.json guides/_category_.json
cd ../..
git mv apps/gitq/website/docs/* website/docs/gitq/
```

- [ ] **Step 2: Fix frontmatter for the moved pages**

- `website/docs/rt/index.mdx`: replace `slug: /` with `slug: /rt` and set `sidebar_position: 1`.
- `website/docs/gitq/intro.mdx`: if it carries `slug: /`, change it to `slug: /gitq`.
- `website/docs/start/setup.mdx`: set `title: "Setup: just you, or a team"`.
- `website/docs/start/menu-bar-app.mdx`: keep its title, "The menu bar app".
- Any moved page whose `id` or `slug` frontmatter names its old path gets the new one.

- [ ] **Step 3: Write the category files and the Apps index**

```json
// website/docs/start/_category_.json
{ "label": "Get started", "position": 1 }
```

```json
// website/docs/rt/_category_.json
{ "label": "rt CLI", "position": 1 }
```

```json
// website/docs/rt/guides/_category_.json
{ "label": "Guides", "position": 3 }
```

```json
// website/docs/skills/_category_.json
{ "label": "Skills", "position": 1 }
```

`website/docs/rt/reference/_category_.json` keeps its generated-index link and gets `"position": 4`.

`website/docs/apps/index.mdx` is the tab's landing page until Task 10 adds the per-app pages. It holds one line per app, taken from the mattstack.dev landing copy and each app's README, and nothing invented:

```mdx
---
title: Apps
sidebar_position: 1
---

# Apps

mattstack.app runs these apps for you. Each one shares rt's daemon and your settings.

- **board** reviews merge requests.
- **deck** hosts your local apps.
- **console** edits your settings.
- **chat** is the viewer for agent chat.
- **boxscore** shows team stats.
- **fast-browser** drives your real Chrome for agents.
- **flock** arranges your terminal panes.
```

Check each one-liner against the app's README and the landing page, and rewrite any line that doesn't match its source.

- [ ] **Step 4: Rewrite internal links**

Write `$SCRATCH/relink.ts` (`$SCRATCH` is the session scratchpad):

```ts
import { readFileSync, writeFileSync } from "fs";
import { Glob } from "bun";
import { rewriteLink } from "<worktree>/scripts/lib/docs-moves.ts";

const root = process.argv[2]!;
const LINK = /(\]\(|href="|to=")(\/[^)"\s]*)/g;
let changed = 0;
for (const rel of new Glob("website/docs/**/*.{md,mdx}").scanSync(root)) {
  if (rel.startsWith("website/docs/rt/reference/") && !rel.includes("/_partials/")) continue;
  const gitq = rel.startsWith("website/docs/gitq/");
  const path = `${root}/${rel}`;
  const before = readFileSync(path, "utf8");
  const after = before.replace(LINK, (_, lead, href) => lead + rewriteLink(href, { gitq }));
  if (after !== before) { writeFileSync(path, after); changed++; }
}
console.log(`relinked ${changed} files`);
```

Run: `bun $SCRATCH/relink.ts "$PWD"`, then `bun run docs:gen`.
Expected: a "relinked N files" line, then `gen-docs: wrote ... pages to website/docs/rt/reference`.

- [ ] **Step 5: Five sidebars**

```ts
// website/sidebars.ts
import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  start: [{ type: "autogenerated", dirName: "start" }],
  apps: [{ type: "autogenerated", dirName: "apps" }],
  rt: [{ type: "autogenerated", dirName: "rt" }],
  gitq: [{ type: "autogenerated", dirName: "gitq" }],
  skills: [{ type: "autogenerated", dirName: "skills" }],
};

export default sidebars;
```

- [ ] **Step 6: Site config**

In `website/docusaurus.config.ts`:
- `title: "mattstack"`, `tagline: "An agentic application stack for engineers."` (the landing h1)
- `url: "https://docs.mattstack.dev"`, `projectName: "mattstack"`
- `markdown: { mermaid: true, hooks: { onBrokenMarkdownLinks: "throw" } }`, `themes: ["@docusaurus/theme-mermaid"]`
- `navbar.title: "mattstack"`, with items:

```ts
      items: [
        { type: "docSidebar", sidebarId: "start", label: "Get started", position: "left" },
        { type: "docSidebar", sidebarId: "apps", label: "Apps", position: "left" },
        { type: "docSidebar", sidebarId: "rt", label: "rt CLI", position: "left" },
        { type: "docSidebar", sidebarId: "gitq", label: "gitq", position: "left" },
        { type: "docSidebar", sidebarId: "skills", label: "Skills", position: "left" },
        { href: "https://github.com/m4ttstack/mattstack", label: "GitHub", position: "right" },
        { href: "https://github.com/m4ttstack/mattstack/releases", label: "Releases", position: "right" },
        { href: "https://github.com/m4ttstack/mattstack/releases/latest", label: "Download", position: "right", className: "nav-dl" },
      ],
```

- `footer.copyright: "mattstack"`

In `website/package.json`: `"name": "mattstack-docs"`. Add `@docusaurus/theme-mermaid` at the same version as `@docusaurus/core` (`cd website && bun add @docusaurus/theme-mermaid@<core version>`).

Get started needs a home at `/` until Task 9 writes the real one. Task 9 owns `website/docs/start/index.mdx`, so this task only adds the minimum that builds:

```mdx
---
slug: /
title: What is mattstack
sidebar_position: 1
---

# What is mattstack

mattstack is an agentic application stack for engineers, shipped as mattstack.app for macOS. Start with [Install mattstack.app](/start/install).
```

- [ ] **Step 7: Build**

Run: `cd website && bun install && bun run build`
Expected: `[SUCCESS] Generated static files in "build".` A broken link fails the build and names the file and link. Fix each one at its source, through `DOCS_MOVES` if it's a missing move, and rebuild until it's green.

- [ ] **Step 8: Run the docs checks**

Run: `bun run docs:check && bun test scripts/__tests__/`
Expected: `✓ command reference is in sync with the tree`, and the tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -A website apps/gitq/website
git commit -m "docs site: five tabs (start, apps, rt, gitq, skills), gitq folded in"
```

### Task 4: Retire gitq's own site

**Files:**
- Delete: `apps/gitq/website/` (whatever remains after Task 3: config, `serve.ts`, `package.json`, `bun.lock`, `sidebars.ts`, `src/`, `static/`)
- Modify: `apps/gitq/tests/docs-coverage.test.ts:6-7`, `apps/gitq/.gitignore`, `turbo.json` (new `@mattstack/gitq#test` entry), `apps/gitq/README.md` (the docs paragraph at line 340, and line 346)

- [ ] **Step 1: Point the coverage test at the new folder**

```ts
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const REFERENCE_DIR = join(REPO_ROOT, 'website', 'docs', 'gitq', 'reference');
```

- [ ] **Step 2: Run it and confirm it passes against the moved pages**

Run: `cd apps/gitq && bun test tests/docs-coverage.test.ts`
Expected: PASS. Every command still has a page, because Task 3 only moved them.

- [ ] **Step 3: Declare the root input so turbo rehashes on a docs edit**

Add to `turbo.json` `tasks`:

```json
    "@mattstack/gitq#test": {
      "dependsOn": ["^build"],
      "inputs": [
        "$TURBO_DEFAULT$",
        "$TURBO_ROOT$/website/docs/gitq/**",
        "!$TURBO_ROOT$/**/node_modules/**"
      ]
    },
```

- [ ] **Step 4: Delete the old site and its ignores**

```bash
git rm -rq apps/gitq/website
```

In `apps/gitq/.gitignore`, remove the `website/build/` and `website/.docusaurus/` lines.

- [ ] **Step 5: README paragraph**

Replace `apps/gitq/README.md`'s docs paragraph (line 340) with:

```markdown
The full documentation (getting started, concepts, guides, and a reference page per command) is the gitq tab of the mattstack docs at [docs.mattstack.dev/gitq](https://docs.mattstack.dev/gitq). Its source lives in the monorepo's `website/docs/gitq/`.
```

On line 346, change `website/docs/reference/<category>/<command>.mdx` to `website/docs/gitq/reference/<category>/<command>.mdx` (in the monorepo root).

- [ ] **Step 6: Verify**

Run: `cd apps/gitq && bun test tests/docs-coverage.test.ts && cd ../.. && bun test scripts/__tests__/turbo-inputs.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A apps/gitq turbo.json
git commit -m "gitq: docs live in the mattstack docs; retire its own Docusaurus site"
```

### Task 5: rt.cool redirects and the sitemap check

**Files:**
- Create: `scripts/gen-rt-cool-redirects.ts`, `website/redirects/rt-cool/_redirects` (generated, committed), `scripts/deploy-rt-cool-redirects.sh`, `scripts/check-rt-cool-redirects.ts`
- Modify: `scripts/lib/docs-moves.ts` (adds `rtCoolRedirects`), `package.json` (scripts)
- Test: `scripts/__tests__/docs-moves.test.ts`, `scripts/__tests__/no-rt-cool-redirects-drift.test.ts`

**Interfaces:**
- Consumes: `DOCS_MOVES`, `DOCS_HOST`, `resolveRedirect` from Task 1.
- Produces: `function rtCoolRedirects(): string`, and the npm scripts `docs:redirects` (regenerate the file) and `docs:redirects:check` (the sitemap check).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/docs-moves.test.ts`:

```ts
import { rtCoolRedirects } from "../lib/docs-moves.ts";

test("redirects cover bare and trailing-slash forms, end with a catch-all", () => {
  const lines = rtCoolRedirects().trim().split("\n");
  expect(lines).toContain("/guides/daemon https://docs.mattstack.dev/start/daemon 301");
  expect(lines).toContain("/guides/daemon/ https://docs.mattstack.dev/start/daemon 301");
  expect(lines).toContain("/reference/* https://docs.mattstack.dev/rt/reference/:splat 301");
  expect(lines).toContain("/ https://docs.mattstack.dev/rt 301");
  expect(lines.at(-1)).toBe("/* https://docs.mattstack.dev/ 301");
});
```

Create `scripts/__tests__/no-rt-cool-redirects-drift.test.ts`:

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { rtCoolRedirects } from "../lib/docs-moves.ts";

test("the committed rt.cool _redirects matches the moves table", () => {
  const committed = readFileSync(join(import.meta.dir, "..", "..", "website", "redirects", "rt-cool", "_redirects"), "utf8");
  expect(committed).toBe(rtCoolRedirects());
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test scripts/__tests__/docs-moves.test.ts scripts/__tests__/no-rt-cool-redirects-drift.test.ts`
Expected: FAIL, because `rtCoolRedirects` isn't exported yet.

- [ ] **Step 3: Implement**

Append to `scripts/lib/docs-moves.ts`:

```ts
export function rtCoolRedirects(): string {
  const lines: string[] = [];
  for (const m of DOCS_MOVES) {
    const to = `${DOCS_HOST}${m.to}`;
    if (m.prefix) {
      lines.push(`${m.from} ${to} 301`, `${m.from}/* ${to}/:splat 301`);
    } else if (m.from === "/") {
      lines.push(`/ ${to} 301`);
    } else {
      lines.push(`${m.from} ${to} 301`, `${m.from}/ ${to} 301`);
    }
  }
  lines.push(`/* ${DOCS_HOST}/ 301`);
  return lines.join("\n") + "\n";
}
```

`scripts/gen-rt-cool-redirects.ts`:

```ts
import { mkdirSync, writeFileSync } from "fs";
import { rtCoolRedirects } from "./lib/docs-moves.ts";

mkdirSync("website/redirects/rt-cool", { recursive: true });
writeFileSync("website/redirects/rt-cool/_redirects", rtCoolRedirects());
console.log("wrote website/redirects/rt-cool/_redirects");
```

Run `bun scripts/gen-rt-cool-redirects.ts`.

`scripts/check-rt-cool-redirects.ts` reads a sitemap (a URL or a file), resolves each path, and fails when a target has no built page:

```ts
/**
 * Before cutover: every page rt.cool ever served must redirect to a page the
 * new build has. Usage:
 *   bun scripts/check-rt-cool-redirects.ts [--sitemap <url|file>] [--build website/build]
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { resolveRedirect } from "./lib/docs-moves.ts";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]! : dflt;
};
const sitemap = opt("--sitemap", "https://rt.cool/sitemap.xml");
const build = opt("--build", "website/build");

const xml = sitemap.startsWith("http") ? await (await fetch(sitemap)).text() : readFileSync(sitemap, "utf8");
const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);

const built = (p: string) =>
  p === "/" ? existsSync(join(build, "index.html"))
    : existsSync(join(build, p, "index.html")) || existsSync(join(build, `${p}.html`));

const misses = paths.filter((p) => !built(resolveRedirect(p)));
for (const p of misses) console.error(`  ${p} -> ${resolveRedirect(p)} (no page)`);
console.log(`${paths.length - misses.length}/${paths.length} rt.cool pages land on a built page`);
process.exit(misses.length ? 1 : 0);
```

`scripts/deploy-rt-cool-redirects.sh`:

```bash
#!/usr/bin/env bash
# Deploys only the redirect file to the rt-cool Pages project, which then
# answers every rt.cool request with a 301 into docs.mattstack.dev.
# `bunx --bun wrangler` silently uploads nothing; run wrangler on Node.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bunx wrangler pages deploy "$ROOT/website/redirects/rt-cool" --project-name rt-cool --branch main "$@"
```

`chmod +x scripts/deploy-rt-cool-redirects.sh`. In the root `package.json` scripts, add `"docs:redirects": "bun scripts/gen-rt-cool-redirects.ts"` and `"docs:redirects:check": "bun scripts/check-rt-cool-redirects.ts"`.

- [ ] **Step 4: Run the tests and the live sitemap check**

Run: `bun test scripts/__tests__/docs-moves.test.ts scripts/__tests__/no-rt-cool-redirects-drift.test.ts`
Expected: PASS

Run: `(cd website && bun run build) && bun run docs:redirects:check`
Expected: `N/N rt.cool pages land on a built page`. For each miss, add a row to `DOCS_MOVES`, regenerate and rerun until it's clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/docs-moves.ts scripts/gen-rt-cool-redirects.ts scripts/check-rt-cool-redirects.ts scripts/deploy-rt-cool-redirects.sh website/redirects package.json scripts/__tests__/docs-moves.test.ts scripts/__tests__/no-rt-cool-redirects-drift.test.ts
git commit -m "docs site: rt.cool redirect file, its deploy script and the sitemap check"
```

### Task 6: CI builds the site

**Files:**
- Modify: `scripts/ci/test-scope.ts` (adds `websiteChanged` and the `website=` output), `.github/workflows/checks.yml` (new `website` job, added to `checks.needs` and the gate)
- Test: `scripts/ci/__tests__/test-scope.test.ts`

**Interfaces:**
- Produces: `export function websiteChanged(changed: string[]): boolean`, and a `website=true|false` line in `$GITHUB_OUTPUT`.

The spec also listed `apps/gitq/**` as a trigger. It is dropped here: gitq's source doesn't feed the site build, and the gitq docs pages themselves are under `website/`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/ci/__tests__/test-scope.test.ts`:

```ts
import { websiteChanged } from "../test-scope.ts";

describe("websiteChanged", () => {
  test("site, generator and command tree changes build the site", () => {
    expect(websiteChanged(["website/docs/rt/index.mdx"])).toBe(true);
    expect(websiteChanged(["scripts/gen-docs.ts"])).toBe(true);
    expect(websiteChanged(["scripts/lib/docs-render.ts"])).toBe(true);
    expect(websiteChanged(["lib/command-tree-def.ts"])).toBe(true);
    expect(websiteChanged([".github/workflows/checks.yml"])).toBe(true);
  });
  test("unrelated changes skip it", () => {
    expect(websiteChanged(["lib/daemon.ts", "apps/board/src/a.ts", "README.md"])).toBe(false);
  });
});
```

(`describe`, `test` and `expect` are already imported there; extend the import if they aren't.)

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test scripts/ci/__tests__/test-scope.test.ts`
Expected: FAIL, `websiteChanged` isn't exported.

- [ ] **Step 3: Implement**

In `scripts/ci/test-scope.ts`, after `prPluginDirs`:

```ts
const WEBSITE_TRIGGERS = [
  "website/",
  "scripts/gen-docs.ts",
  "scripts/check-docs.ts",
  "scripts/lib/docs-",
  "lib/command-tree-def.ts",
  ...ALL_PLUGIN_TRIGGERS,
];

export function websiteChanged(changed: string[]): boolean {
  return changed.some((f) => WEBSITE_TRIGGERS.some((t) => f.startsWith(t)));
}
```

In the `import.meta.main` block, after `plugins`:

```ts
  const website = event === "pull_request" ? websiteChanged(changed) : true;
  console.log(`website=${website}`);
```

and add `website=${website}\n` to the `appendFileSync` payload.

- [ ] **Step 4: The job**

In `.github/workflows/checks.yml`, add `website: ${{ steps.scope.outputs.website }}` to `scope.outputs`. Add the job before `checks:`:

```yaml
  # Docusaurus fails the build on a broken link, but only a build catches it.
  website:
    needs: scope
    if: needs.scope.outputs.website == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - name: Build the docs site
        working-directory: website
        run: bun install --frozen-lockfile && bun run build
```

Add `website` to `checks.needs`, add `WEBSITE: ${{ needs.website.result }}` to its env, include `website=$WEBSITE` in its echo, and add this gate line next to the plugin lines, written the way they are:

```bash
          [ "$WEBSITE" = success ] || [ "$WEBSITE" = skipped ] || { echo "website did not succeed"; exit 1; }
```

- [ ] **Step 5: Verify**

Run: `bun test scripts/ci/__tests__/test-scope.test.ts && bun scripts/ci/test-scope.ts --explain`
Expected: PASS, and the explain output includes a `website=` line.

- [ ] **Step 6: Commit and open PR 1**

```bash
git add scripts/ci/test-scope.ts scripts/ci/__tests__/test-scope.test.ts .github/workflows/checks.yml
git commit -m "ci: build the docs site when it or its generator changes"
```

Rebase onto `origin/org-teams-1-resolver` (or main once #667 has merged), push, and open PR 1 with base `org-teams-1-resolver`. Follow the CodeRabbit and CI rule from CLAUDE.md.

## Phase B: look and feel (PR 2)

### Task 7: Docs shell design board (gate)

**Files:**
- Create: `~/Documents/GitHub/mattstack.dev/docs/design/docs/docs-shell.pen` (pen.dev, through the pencil MCP tools only)

- [ ] **Step 1:** Read the pencil MCP schema and `mattstack.dev/docs/design/landing/landing.pen` for its tokens and nav.
- [ ] **Step 2:** Draw four frames in each scheme (eight in all): the navbar with its five tabs and right-side links; the sidebar with an active item; a guide page (h1, body, code block, admonition, table); a generated reference page (breadcrumb, usage, flag table). Use the landing tokens exactly.
- [ ] **Step 3:** Open it for Matt and ask for sign-off with a form (AskUserQuestion). Don't start Task 8 until he approves. Apply any changes and ask again.
- [ ] **Step 4:** Commit the `.pen` file in the mattstack.dev repo (`git add docs/design/docs/docs-shell.pen && git commit -m "design: docs shell"`). Don't push without asking.

### Task 8: Theme

**Files:**
- Create: `website/src/css/tokens.css`, `website/src/theme/Navbar/Logo/index.tsx`, `website/static/img/app-icon.png`
- Modify: `website/src/css/custom.css`, `website/docusaurus.config.ts`
- Delete: `website/static/img/favicon.svg`

- [ ] **Step 1: Tokens**

`website/src/css/tokens.css` (copied from the landing page, renamed `--ms-*` so they don't collide with Infima):

```css
:root {
  --ms-bg: #fafafa;
  --ms-bg-alt: #f3f3f5;
  --ms-surface: #fff;
  --ms-border: #e3e3e8;
  --ms-border-soft: #eaeaee;
  --ms-fg: #16161b;
  --ms-muted: #5f5f6a;
  --ms-dim: #767680;
  --ms-accent: #e64980;
  --ms-accent-wash: rgba(230, 73, 128, 0.1);
  --ms-accent-line: rgba(230, 73, 128, 0.22);
  --ms-nav-bg: rgba(250, 250, 250, 0.78);
  --ms-raised: #ffffff;
  --ms-raised-border: #8f8f9c;
}

[data-theme="dark"] {
  --ms-bg: #0e0e14;
  --ms-bg-alt: #14141b;
  --ms-surface: #21212b;
  --ms-border: #383846;
  --ms-border-soft: #26262f;
  --ms-fg: #f4f4f5;
  --ms-muted: #9d9da6;
  --ms-dim: #7a7a85;
  --ms-accent-wash: rgba(230, 73, 128, 0.14);
  --ms-accent-line: rgba(230, 73, 128, 0.25);
  --ms-nav-bg: rgba(14, 14, 20, 0.72);
  --ms-raised: #262631;
  --ms-raised-border: rgba(255, 255, 255, 0.36);
}
```

Before committing, diff these values against the landing page's current `:root` block. The landing page is the source of truth.

- [ ] **Step 2: Map Infima**

`website/src/css/custom.css`:

```css
@import "./tokens.css";

:root {
  --ifm-color-primary: #e64980;
  --ifm-color-primary-dark: #e22e6d;
  --ifm-color-primary-darker: #e12164;
  --ifm-color-primary-darkest: #ba1a52;
  --ifm-color-primary-light: #ea6493;
  --ifm-color-primary-lighter: #eb719c;
  --ifm-color-primary-lightest: #f199b8;
  --ifm-font-family-base: "Inter", system-ui, -apple-system, "Segoe UI", Helvetica, sans-serif;
  --ifm-font-family-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
  --ifm-heading-font-weight: 700;
  --ifm-code-font-size: 92%;
  --ifm-background-color: var(--ms-bg);
  --ifm-background-surface-color: var(--ms-bg);
  --ifm-font-color-base: var(--ms-fg);
  --ifm-color-emphasis-300: var(--ms-border);
  --ifm-toc-border-color: var(--ms-border-soft);
  --ifm-hr-border-color: var(--ms-border-soft);
  --ifm-table-border-color: var(--ms-border);
  --ifm-code-background: var(--ms-surface);
  --ifm-navbar-background-color: var(--ms-nav-bg);
  --ifm-navbar-link-color: var(--ms-muted);
  --ifm-navbar-link-hover-color: var(--ms-fg);
  --ifm-menu-color: var(--ms-muted);
  --ifm-menu-color-active: var(--ms-fg);
  --ifm-menu-color-background-active: var(--ms-accent-wash);
  --ifm-footer-background-color: var(--ms-bg-alt);
  --docusaurus-highlighted-code-line-bg: var(--ms-accent-wash);
}

body {
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 {
  letter-spacing: -0.035em;
}

.navbar {
  border-bottom: 1px solid var(--ms-border-soft);
  box-shadow: none;
  backdrop-filter: saturate(140%) blur(12px);
}

.navbar__link {
  font-size: 13.5px;
  font-weight: 500;
}

.navbar__link.nav-dl {
  margin-left: 8px;
  padding: 8px 14px;
  border: 1px solid var(--ms-raised-border);
  border-radius: 8px;
  background: var(--ms-raised);
  color: var(--ms-fg);
  font-size: 13px;
  font-weight: 600;
}

.navbar__link.nav-dl:hover {
  border-color: var(--ms-accent-line);
}

.menu__link--active:not(.menu__link--sublist) {
  box-shadow: inset 2px 0 0 var(--ms-accent);
}

.theme-code-block,
.alert {
  border: 1px solid var(--ms-border);
}

.brand-name em {
  font-style: normal;
  color: var(--ms-accent);
}
```

The spec said "pink Download pill". The landing page's `.nav-dl` is actually a neutral raised button whose border turns pink on hover, so this copies the landing page, which is what the spec meant by "the landing's `.nav-dl`".

- [ ] **Step 3: Font, favicon, logo**

`cp ~/Documents/GitHub/mattstack.dev/assets/app-icon.png website/static/img/app-icon.png`, then `git rm website/static/img/favicon.svg`. In `docusaurus.config.ts`:

```ts
  favicon: "img/app-icon.png",
  headTags: [
    { tagName: "link", attributes: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
    { tagName: "link", attributes: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" } },
    { tagName: "link", attributes: { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" } },
  ],
```

Navbar: `logo: { alt: "", src: "img/app-icon.png", width: 26, height: 26 }`, and drop `title`, since the swizzled logo renders the name. The footer gets one links row:

```ts
    footer: {
      style: "light",
      links: [
        { label: "mattstack.dev", href: "https://mattstack.dev" },
        { label: "GitHub", href: "https://github.com/m4ttstack/mattstack" },
        { label: "Releases", href: "https://github.com/m4ttstack/mattstack/releases" },
      ],
      copyright: "mattstack",
    },
    colorMode: { respectPrefersColorScheme: true },
```

- [ ] **Step 4: Swizzle the logo (wrap)**

Run: `cd website && bunx docusaurus swizzle @docusaurus/theme-classic Navbar/Logo --wrap --typescript`

Replace the generated file with:

```tsx
import React from "react";
import Logo from "@theme-original/Navbar/Logo";

export default function LogoWrapper(): React.JSX.Element {
  return (
    <div className="navbar__brand-wrap" style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Logo />
      <span className="brand-name" style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.3px" }}>
        matt<em>stack</em>
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Prism**

Try `prismThemes.oneLight` and `prismThemes.oneDark`. Keep whichever pair reads best against `#fafafa` and `#0e0e14`, judged in Step 6.

- [ ] **Step 6: Build, serve and screenshot both schemes**

Run: `cd website && bun run build && bun run serve --port 3311` (in the background).
Use the `fast-browser:browser-driver` agent to screenshot `http://localhost:3311/`, `/rt/guides/picker`, `/rt/reference/git/rebase` and `/gitq/concepts/cascade` with `prefers-color-scheme` emulated light and dark, and `https://mattstack.dev/` in both schemes for comparison. Put the screenshots next to the Task 7 board and list plainly anything that reads wrong (contrast, spacing, nav alignment, code block tint, admonitions, mermaid diagrams). Fix it and screenshot again.

- [ ] **Step 7: Commit and open PR 2**

```bash
git add website
git commit -m "docs site: mattstack.dev look (tokens, Inter, nav, logo)"
```

Push and open PR 2 on top of PR 1, with the screenshots in the body.

## Phase C: content (PR 3)

Every content task follows the same rules. Read the named sources first. Write only what they state. Use no em or en dashes (`grep -rn "[—–]" <files>` must print nothing). Build with `cd website && bun run build` (it must be green). Afterwards, a reviewer subagent traces each factual sentence back to its source.

### Task 9: Get started

**Files:**
- Modify: `website/docs/start/index.mdx` (the home), `website/docs/start/setup.mdx`, `website/docs/rt/index.mdx`
- Create: `website/docs/start/settings.mdx`
- Set `sidebar_position` frontmatter in `website/docs/start/*.mdx` to: index 1, install 2, setup 3, teams 4, onboard-a-repo 5, menu-bar-app 6, daemon 7, settings 8, state-backup 9

- [ ] **Step 1: The home page.** Sources: the mattstack.dev landing copy (`index.html` hero and tools sections), today's `rt/index.mdx` "Part of mattstack" section, `README.md`. Content, in order:
  - h1 "What is mattstack", then one paragraph: what it is and who it's for
  - "What you get": one line per tab, each linking to it (Apps, rt CLI, gitq, Skills)
  - "How it fits together": mattstack.app installs, updates and supervises the suite; rt's daemon and the settings store are shared by every app
  - "Start here": links to `/start/install`, `/start/setup`, `/start/teams`
- [ ] **Step 2: Setup page.** Merge the setup wizard's own copy into `start/setup.mdx`. Sources: `lib/setup/` row titles and `detail` strings that a person sees, and the existing just-me page. Cover what setup asks, the just-you path, and the team path (link to `/start/teams` for orgs and roles). Don't name internal row ids.
- [ ] **Step 3: Settings page.** Sources: `docs/settings-architecture.md` (the scope model only), the `rt settings` reference pages, and #667's org layer. Content: where settings live (`~/.mattstack`), the user, team, org and machine scopes and which one wins, how to read one (`rt settings get`, `explain`) and how to change one (console, `rt settings set`). Leave out the resolver internals, latches and sops.
- [ ] **Step 4: Trim the rt home.** In `rt/index.mdx`, swap "Part of mattstack" for one sentence linking to `/`, and keep the mental model, zero footprint and reference sections.
- [ ] **Step 5: Build, check dashes, commit.**

```bash
cd website && bun run build && cd .. && ! grep -rn "[—–]" website/docs/start website/docs/rt/index.mdx
git add website/docs/start website/docs/rt/index.mdx
git commit -m "docs: Get started tab (home, setup, settings)"
```

### Task 10: Apps pages

**Files:**
- Create: `website/docs/apps/{board,deck,console,chat,boxscore,fast-browser,flock}.mdx`
- Modify: `website/docs/apps/index.mdx` (each line links to its page)

Every page uses the same outline: a one-paragraph "What it is"; "Open it" (where it lives: a deck URL, the menu bar, a CLI); "What you do in it" (three to five tasks, each a short paragraph); "Settings that matter" (keys from the settings registry, each with a one-line meaning); "Related" (links into the rt CLI and Skills tabs).

| Page | Sources |
|---|---|
| board | `apps/board/README.md`, `apps/board/AGENTS.md`, `apps/board/mattstack.deck.json`, `board.*` keys in `packages/rt-client/src/settings/` |
| deck | `apps/deck/README.md`, `apps/deck/AGENTS.md`, the `deck` CLI help |
| console | `apps/console/README.md`, `apps/console/AGENTS.md`, `docs/settings-architecture.md` |
| chat | `apps/chat/ARCHITECTURE.md`, `apps/chat/README.md`, `skills/rt-chat/SKILL.md` (only what a person does) |
| boxscore | `apps/boxscore/AGENTS.md`, `apps/boxscore/docs/`, `apps/boxscore/mattstack.deck.json` |
| fast-browser | `https://github.com/m4ttstack/fast-browser` README (`gh api repos/m4ttstack/fast-browser/readme --jq .content \| base64 -d`) |
| flock | `https://github.com/m4ttstack/flock` README, the mattstack.dev flock section |

- [ ] **Step 1:** Write board, deck and console. Build.
- [ ] **Step 2:** Write chat and boxscore. Build.
- [ ] **Step 3:** Write fast-browser and flock (README-sourced only). Link `apps/index.mdx` lines to each page. Build.
- [ ] **Step 4:** Check dashes, then commit: `git add website/docs/apps && git commit -m "docs: Apps tab overview pages"`.

### Task 11: Skills pages

**Files:**
- Create: `website/docs/skills/index.mdx`, `website/docs/skills/review.mdx`, `website/docs/skills/shepherdr.mdx`, `website/docs/skills/wrap-up.mdx`, `website/docs/skills/writing-styles.mdx`, `website/docs/skills/packs.mdx`, `website/docs/skills/herdr-chat.mdx`, `website/docs/skills/gitq-skills.mdx`
- Modify: `website/docs/skills/mcp.mdx` (link to `https://github.com/m4ttstack/mattstack/blob/main/plugins/mattstack/attachments/mcp-tools/reference.md` for the tool list)

| Page | Sources |
|---|---|
| index | `plugins/mattstack/README.md`, the `rt skills sync` reference, the `/reload-plugins` rule |
| review, shepherdr, wrap-up | each `plugins/mattstack/skills/<name>/SKILL.md` (what a person asks for and gets, never the internal graph) |
| writing-styles | the three `writing-style-*` skills, the `rt skills writing-style` reference, AGENTS.md "Writing-style presets" |
| packs | `lib/skills/` per #667, the creating-a-pack and extending-a-pack skills, `/start/teams` |
| herdr-chat | `plugins/herdr-chat/README.md` |
| gitq-skills | one paragraph and a link to `/gitq/guides/agent-skills` |

Sidebar positions: index 1, review 2, shepherdr 3, wrap-up 4, writing-styles 5, packs 6, gates 7, mcp 8, herdr-chat 9, gitq-skills 10.

- [ ] **Step 1:** index, review, shepherdr, wrap-up. Build.
- [ ] **Step 2:** writing-styles, packs. Build.
- [ ] **Step 3:** herdr-chat, gitq-skills, the mcp link, positions. Build.
- [ ] **Step 4:** Check dashes, commit: `git add website/docs/skills && git commit -m "docs: Skills tab"`. Push and open PR 3 on top of PR 2.

## Phase D: README (PR 4)

### Task 12: README and side fixes

**Files:**
- Modify: `README.md`, `packages/rt-client/README.md:3`, `packages/rt-client/package.json:47`, `website/docs/gitq/reference/configuration.mdx:8`, `skills/.skillsignore:13`

- [ ] **Step 1:** Invoke the `github-readme` skill and follow it for `README.md`, built on #667's version. Sections, in this order: opening paragraph plus screenshot plus links to docs.mattstack.dev and mattstack.dev; "What's inside" table (piece, what it is, docs link, folder), with rows for mattstack.app (`rt-tray/`), rt (root), board, deck, console, chat, boxscore (`apps/*`), gitq (`apps/gitq`), glance (`packages/glance`), rt-client (`packages/rt-client`), the mattstack plugin (`plugins/mattstack`), herdr-chat (`plugins/herdr-chat`), fast-browser and flock (their repos); Install (DMG, setup, requirements line copied from `website/docs/start/install.mdx`); Repo layout (one line each for root, `apps/`, `packages/`, `plugins/`, `rt-tray/`, `ui/`, `website/`); Development (`bun install`, `bun run check`, `bun run test`, links to `docs/development.md`, `apps/AGENTS.md`, `docs/release-and-distribution.md`); Contributing and License (kept). Remove the rt feature tour, everyday commands, configuration and plugins sections.
- [ ] **Step 2:** Side fixes. Change `https://rt.cool` to `https://docs.mattstack.dev/rt` in `packages/rt-client/README.md` and `package.json` `homepage`, and in `configuration.mdx` line 8 change `[rt](https://rt.cool)` to `[rt](/rt)`. In `.skillsignore` line 13, change the comment's "rt.cool docs site" to "mattstack docs site".
- [ ] **Step 3:** Run: `cd website && bun run build && cd .. && ! grep -n "[—–]" README.md`. The build must be green and the grep must print nothing. Every README link must resolve; check with `grep -oE "\]\([^)]+\)" README.md` and open each relative path.
- [ ] **Step 4:** Commit: `git add README.md packages/rt-client website/docs/gitq skills/.skillsignore && git commit -m "README: describe the mattstack monorepo"`. Push and open PR 4.

## Phase E: release conformance (PR 5)

### Task 13: Docs impact list

**Files:**
- Create: `scripts/lib/docs-impact.ts`
- Modify: `scripts/update-docs.ts`
- Test: `scripts/__tests__/docs-impact.test.ts`

**Interfaces:**
- Produces:
  - `type DocsArea = "start" | "apps" | "rt" | "gitq" | "skills"`
  - `type DocsImpact = { area: DocsArea; page?: string }`
  - `function docsImpact(changed: string[]): DocsImpact[]` (deduplicated, sorted by area then page)
  - `function formatImpact(impacts: DocsImpact[]): string`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/docs-impact.test.ts
import { expect, test } from "bun:test";
import { docsImpact, formatImpact } from "../lib/docs-impact.ts";

test("command changes point at the rt tab", () => {
  expect(docsImpact(["commands/sync.ts", "lib/command-tree-def.ts"])).toEqual([{ area: "rt" }]);
});

test("an app change points at its own page, gitq at its tab", () => {
  expect(docsImpact(["apps/board/src/x.ts", "apps/gitq/src/cli/main.ts"])).toEqual([
    { area: "apps", page: "website/docs/apps/board.mdx" },
    { area: "gitq" },
  ]);
});

test("plugins point at Skills; tray, setup, team and settings at Get started", () => {
  expect(docsImpact(["plugins/mattstack/skills/review/SKILL.md"])).toEqual([{ area: "skills" }]);
  expect(docsImpact(["rt-tray/Sources/A.swift", "lib/setup/x.ts", "lib/team/y.ts", "packages/rt-client/src/settings/z.ts"])).toEqual([{ area: "start" }]);
});

test("a path that maps to no docs area adds nothing", () => {
  expect(docsImpact(["lib/daemon/x.ts", "README.md", "website/docs/rt/index.mdx", "apps/AGENTS.md"])).toEqual([]);
});

test("formatImpact names each area once, pages under it", () => {
  const out = formatImpact(docsImpact(["apps/deck/a.ts", "apps/board/b.ts", "commands/x.ts"]));
  expect(out).toBe(
    "docs to review:\n  apps: website/docs/apps/board.mdx, website/docs/apps/deck.mdx\n  rt: website/docs/rt/\n",
  );
  expect(formatImpact([])).toBe("docs to review: none\n");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test scripts/__tests__/docs-impact.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// scripts/lib/docs-impact.ts
export type DocsArea = "start" | "apps" | "rt" | "gitq" | "skills";
export type DocsImpact = { area: DocsArea; page?: string };

const APPS = new Set(["board", "boxscore", "chat", "console", "deck"]);
const ORDER: DocsArea[] = ["start", "apps", "rt", "gitq", "skills"];
const TAB_DIR: Record<DocsArea, string> = {
  start: "website/docs/start/",
  apps: "website/docs/apps/",
  rt: "website/docs/rt/",
  gitq: "website/docs/gitq/",
  skills: "website/docs/skills/",
};

function impactOf(f: string): DocsImpact | undefined {
  if (f.startsWith("apps/gitq/")) return { area: "gitq" };
  const app = /^apps\/([^/]+)\//.exec(f)?.[1];
  if (app && APPS.has(app)) return { area: "apps", page: `website/docs/apps/${app}.mdx` };
  if (f.startsWith("commands/") || f === "lib/command-tree-def.ts") return { area: "rt" };
  if (f.startsWith("plugins/")) return { area: "skills" };
  if (["rt-tray/", "lib/setup/", "lib/team/", "packages/rt-client/src/settings/"].some((p) => f.startsWith(p))) {
    return { area: "start" };
  }
  return undefined;
}

export function docsImpact(changed: string[]): DocsImpact[] {
  const seen = new Map<string, DocsImpact>();
  for (const f of changed) {
    const i = impactOf(f);
    if (i) seen.set(`${i.area}:${i.page ?? ""}`, i);
  }
  return [...seen.values()].sort(
    (a, b) => ORDER.indexOf(a.area) - ORDER.indexOf(b.area) || (a.page ?? "").localeCompare(b.page ?? ""),
  );
}

export function formatImpact(impacts: DocsImpact[]): string {
  if (impacts.length === 0) return "docs to review: none\n";
  const lines = ["docs to review:"];
  for (const area of ORDER) {
    const hits = impacts.filter((i) => i.area === area);
    if (hits.length === 0) continue;
    const pages = hits.some((h) => !h.page) ? [TAB_DIR[area]] : hits.map((h) => h.page!);
    lines.push(`  ${area}: ${pages.join(", ")}`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `bun test scripts/__tests__/docs-impact.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into update-docs.ts**

In `scripts/update-docs.ts`:
- `import { docsImpact, formatImpact } from "./lib/docs-impact.ts";` and `import { REFERENCE_ROOT } from "./lib/docs-hand.ts";`
- After `subjects`: `const changedPaths = sh("git", ["diff", "--name-only", base ? `${base}..HEAD` : "HEAD"]).split("\n").filter(Boolean); const impact = formatImpact(docsImpact(changedPaths));`
- The agent prompt becomes: `` `Read and follow ${SKILL_PATH}. Update the mattstack docs (docs.mattstack.dev) for the release covering ${base || "(root)"}..HEAD. Review these first:\n${impact}Regenerate the reference, update only the hand-written pages that changed behavior requires, leave everything staged, and do not commit.` ``
- Print `impact` in both the dry run and the real run, right after the notes line.
- Stage: `spawnSync("git", ["add", REFERENCE_ROOT, NOTES_FILE], { stdio: "inherit" });`

Run: `bun scripts/update-docs.ts --dry-run --no-agent`
Expected: the base, the commit count, a `docs to review:` block, and no writes.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/docs-impact.ts scripts/__tests__/docs-impact.test.ts scripts/update-docs.ts
git commit -m "release: list the docs pages each change touches"
```

### Task 14: Deploy target and smoke check

**Files:**
- Modify: `scripts/deploy-docs.sh`
- Create: `scripts/lib/docs-smoke.ts`, `scripts/docs-smoke.ts`
- Modify: `package.json` (`docs:smoke`)
- Test: `scripts/__tests__/docs-smoke.test.ts`

**Interfaces:**
- Produces:
  - `type SmokeCheck = { url: string; status: number; location?: string }`
  - `const SMOKE_CHECKS: SmokeCheck[]`
  - `function evaluate(check: SmokeCheck, got: { status: number; location: string | null }): string | null` (null means pass; otherwise a one-line reason)
  - `bun run docs:smoke` (exit 0 on pass, 1 with one line per failure)

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/docs-smoke.test.ts
import { expect, test } from "bun:test";
import { SMOKE_CHECKS, evaluate } from "../lib/docs-smoke.ts";

test("checks the docs home, an rt page, a gitq page and an rt.cool redirect", () => {
  expect(SMOKE_CHECKS.map((c) => c.url)).toEqual([
    "https://docs.mattstack.dev/",
    "https://docs.mattstack.dev/rt/reference/cd",
    "https://docs.mattstack.dev/gitq",
    "https://rt.cool/reference/cd",
  ]);
});

test("a page passes on 200", () => {
  expect(evaluate({ url: "u", status: 200 }, { status: 200, location: null })).toBeNull();
  expect(evaluate({ url: "u", status: 200 }, { status: 404, location: null })).toBe("u: expected 200, got 404");
});

test("a redirect must name the right location, not only the right status", () => {
  const c = { url: "r", status: 301, location: "https://docs.mattstack.dev/rt/reference/cd" };
  expect(evaluate(c, { status: 301, location: "https://docs.mattstack.dev/rt/reference/cd" })).toBeNull();
  expect(evaluate(c, { status: 301, location: "https://docs.mattstack.dev/" })).toBe(
    "r: redirects to https://docs.mattstack.dev/, expected https://docs.mattstack.dev/rt/reference/cd",
  );
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test scripts/__tests__/docs-smoke.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// scripts/lib/docs-smoke.ts
import { DOCS_HOST } from "./docs-moves.ts";

export type SmokeCheck = { url: string; status: number; location?: string };

export const SMOKE_CHECKS: SmokeCheck[] = [
  { url: `${DOCS_HOST}/`, status: 200 },
  { url: `${DOCS_HOST}/rt/reference/cd`, status: 200 },
  { url: `${DOCS_HOST}/gitq`, status: 200 },
  { url: "https://rt.cool/reference/cd", status: 301, location: `${DOCS_HOST}/rt/reference/cd` },
];

export function evaluate(check: SmokeCheck, got: { status: number; location: string | null }): string | null {
  if (got.status !== check.status) return `${check.url}: expected ${check.status}, got ${got.status}`;
  if (check.location && got.location !== check.location) {
    return `${check.url}: redirects to ${got.location}, expected ${check.location}`;
  }
  return null;
}
```

```ts
// scripts/docs-smoke.ts
import { SMOKE_CHECKS, evaluate } from "./lib/docs-smoke.ts";

const failures: string[] = [];
for (const c of SMOKE_CHECKS) {
  const res = await fetch(c.url, { redirect: "manual" });
  const why = evaluate(c, { status: res.status, location: res.headers.get("location") });
  if (why) failures.push(why);
}
for (const f of failures) console.error(f);
console.log(`docs smoke: ${SMOKE_CHECKS.length - failures.length}/${SMOKE_CHECKS.length} ok`);
process.exit(failures.length ? 1 : 0);
```

Add `"docs:smoke": "bun scripts/docs-smoke.ts"` to `package.json`.

If Pages answers `/rt/reference/cd` with a 308 to the trailing-slash form, change that check to the URL Docusaurus actually emits (read it from `website/build/sitemap.xml`) rather than accepting any 3xx.

- [ ] **Step 4: deploy-docs.sh**

Header comment: "Build the mattstack docs site and deploy it to Cloudflare Pages." One-time setup: "Create the Pages project mattstack-docs, add docs.mattstack.dev as its custom domain." Then `PROJECT="${CF_PAGES_PROJECT:-mattstack-docs}"`, and the final echo becomes `==> Deployed. Run bun run docs:smoke to confirm docs.mattstack.dev is live.`

- [ ] **Step 5: Verify**

Run: `bun test scripts/__tests__/docs-smoke.test.ts && bash scripts/deploy-docs.sh --check`
Expected: PASS, then `--check: build OK, wrangler available, project=mattstack-docs. Not deploying.`

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/docs-smoke.ts scripts/docs-smoke.ts scripts/__tests__/docs-smoke.test.ts scripts/deploy-docs.sh package.json
git commit -m "release: deploy the docs to mattstack-docs and smoke-check it"
```

### Task 15: Release skills (writing-skills)

**Files:**
- Modify: `skills/rt-docs/SKILL.md`, `skills/rt-release/prepare.md`, `skills/rt-release/fast-path.md`, `skills/rt-release/publish-and-finish.md`, `skills/rt-release/SKILL.md`, `skills/mattstack-release/SKILL.md`

- [ ] **Step 1:** Invoke `superpowers:writing-skills` and `mattstack:process-digraphs`. Record RED baselines with subagents on the current skills, one scenario each:
  - (a) "release has an apps/board change on the fast path; update docs": expected failure, no docs step happens.
  - (b) "update docs after a `commands/sync.ts` change": expected failure, it targets `website/docs/reference` and rt.cool.
  - (c) "publish-and-finish deploy": expected failure, it deploys rt-cool and runs no smoke check.
- [ ] **Step 2: rt:docs.** Retitle it "Updating the mattstack docs". Update the description (the mattstack docs at docs.mattstack.dev, the five tabs). Context covers the five folders, with generated `website/docs/rt/reference/` and hand-written everything else including `website/docs/gitq/reference/` (gitq's reference is hand-written and checked by `apps/gitq/tests/docs-coverage.test.ts`). In the graph, a new first node after `bun run docs:gen` is `bun scripts/update-docs.ts --dry-run --no-agent`, which prints the impact list. `Read the diff of each behavior change` reads the listed areas first. Update the URL facts: `/rt/reference/<path>`, `/rt/guides/<name>`, `/start/<page>`, `/apps/<app>`, `/gitq/...`, `/skills/<page>`, and the partial import `@site/docs/rt/reference/_partials/<relpath>.mdx`. "Update the hand-written pages" gains the per-area rule: an app change updates `website/docs/apps/<app>.mdx`, a plugin change the Skills page for that skill, a setup/team/settings change the Get started page.
- [ ] **Step 3: prepare.md.** No change to `git add website RELEASE_NOTES.md` (it already covers the whole site). The wording "the docs" stays. Only fix any `rt.cool` mention.
- [ ] **Step 4: fast-path.md.** Add a stage before `rt release apps --dry-run --json`: run `rt:docs` scoped by the impact list to the apps that moved, gate the staged diff with Matt (approve, hold, hand back), then `git commit -m "docs: app pages for the next release"` and push main, under the same confirmation prepare.md uses for its push. The verb's gate already admits `website/`, and it commits only `RELEASE_NOTES.md` through the API on top of origin/main (`commitNotes` in `lib/release/release-app.ts`), so the docs commit must reach origin/main before the verb runs. An empty impact list skips the stage. The prose says "Publish and finish ... for the docs site" instead of "for rt.cool".
- [ ] **Step 5: publish-and-finish.md.**
  - Rename the nodes `Off-script gate: rt.cool setup missing` and `rt.cool deploy failing` to `docs site setup missing` and `docs site deploy failing`, everywhere they occur, including their `gate rounds` diamonds and their sections. Their takes become "Matt deployed the docs site himself".
  - Add `bun run docs:smoke` after a `deployed` result. Its failure goes to `Off-script gate: docs site deploy failing` (quote the failing lines); its pass continues to `rt release update-machine --plan --json`.
  - The opening line becomes "deploy the docs site".
  - The setup-missing section names `mattstack-docs` and docs.mattstack.dev.
- [ ] **Step 6: SKILL.md and mattstack-release.** In `rt-release/SKILL.md`, change "stopped before rt.cool or update-machine" to "stopped before the docs deploy or update-machine". In `mattstack-release/SKILL.md` line 13, change "deploying rt.cool" to "deploying the docs site".
- [ ] **Step 7:** Run GREEN for the three scenarios with fresh subagents and record the results. Fix and rerun until each passes.
- [ ] **Step 8:** Run `bun run skills:check 2>/dev/null || bun cli.ts skills check --strict` if it covers `skills/`. If neither applies, record that in the commit body.
- [ ] **Step 9: Commit**

```bash
git add skills/rt-docs skills/rt-release skills/mattstack-release
git commit -m "release skills: the mattstack docs site, app pages on the fast path, deploy smoke"
```

### Task 16: rt.cool guard, the tray link and AGENTS.md

**Files:**
- Create: `lib/__tests__/no-rt-cool-links.test.ts`
- Modify: `rt-tray/Sources-core/Window/DocsSite.swift`, `rt-tray/Tests/MattstackCoreChecks/AppMenuChecks.swift:14-15`, `AGENTS.md` (any `website/` or rt.cool line), `docs/architecture.md` if it names rt.cool

- [ ] **Step 1: Write the failing guard**

```ts
// lib/__tests__/no-rt-cool-links.test.ts
import { expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const ALLOWED = [
  /^website\/redirects\//,
  /^scripts\/deploy-rt-cool-redirects\.sh$/,
  /^scripts\/check-rt-cool-redirects\.ts$/,
  /^scripts\/lib\/docs-smoke\.ts$/,
  /^scripts\/__tests__\/docs-smoke\.test\.ts$/,
  /^lib\/__tests__\/no-rt-cool-links\.test\.ts$/,
  /^RELEASE_NOTES\.md$/,
  /^docs\/superpowers\//,
  /^plugins\/mattstack\/docs\/pre-release\//,
];

test("nothing outside the redirect tooling links to rt.cool", () => {
  const r = spawnSync("git", ["grep", "-l", "rt\\.cool"], { cwd: ROOT, encoding: "utf8" });
  const hits = r.stdout.split("\n").filter(Boolean).filter((f) => !ALLOWED.some((a) => a.test(f)));
  expect(hits).toEqual([]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test lib/__tests__/no-rt-cool-links.test.ts`
Expected: FAIL, listing `rt-tray/Sources-core/Window/DocsSite.swift`, `rt-tray/Tests/MattstackCoreChecks/AppMenuChecks.swift`, and any others still left.

- [ ] **Step 3: Fix each hit**

`DocsSite.swift`:

```swift
import Foundation

/// The mattstack docs site (`website/`, deployed to docs.mattstack.dev).
public enum DocsSite {
    public static let home = URL(string: "https://docs.mattstack.dev/")!
}
```

`AppMenuChecks.swift`:

```swift
    Check("mattstack Help opens the mattstack docs site") { c in
        c.expectEqual(DocsSite.home.absoluteString, "https://docs.mattstack.dev/")
    },
```

In `AGENTS.md` and `docs/architecture.md`, swap any rt.cool or "docs site in `website/`" line for docs.mattstack.dev and the five-tab layout, in one sentence each. Rerun until the guard prints no hits.

- [ ] **Step 4: Verify**

Run: `bun test lib/__tests__/no-rt-cool-links.test.ts`
Expected: PASS. The Swift check runs in the tray's own CI. Don't build or run the tray locally (AGENTS.md "Operating on this machine").

- [ ] **Step 5: Commit and open PR 5**

```bash
git add lib/__tests__/no-rt-cool-links.test.ts rt-tray/Sources-core/Window/DocsSite.swift rt-tray/Tests/MattstackCoreChecks/AppMenuChecks.swift AGENTS.md docs/architecture.md
git commit -m "docs.mattstack.dev everywhere; guard against new rt.cool links"
```

Push and open PR 5.

## Phase F: cutover (with Matt, on his go)

### Task 17: Go live

Every step here is outward-facing. Ask Matt before each one, with a form.

- [ ] **Step 1:** Matt creates the Pages project and domain, or approves me doing it: `bunx wrangler pages project create mattstack-docs --production-branch main`, then in the Cloudflare dashboard, Pages, mattstack-docs, Custom domains, add `docs.mattstack.dev`.
- [ ] **Step 2:** Deploy from merged main: `bash scripts/deploy-docs.sh`. Wait for the custom domain to show Active.
- [ ] **Step 3:** Before redirecting, run the sitemap check against the old site one last time: `bun run docs:redirects:check`. It must report every page landing.
- [ ] **Step 4:** Deploy the redirects: `bash scripts/deploy-rt-cool-redirects.sh`.
- [ ] **Step 5:** `bun run docs:smoke`. All four checks must pass.
- [ ] **Step 6:** Landing nav, in `~/Documents/GitHub/mattstack.dev`: change `href="https://rt.cool"` to `href="https://docs.mattstack.dev"` in `index.html`, commit (`landing: Docs links to docs.mattstack.dev`), and on Matt's go run `./deploy.sh`.
- [ ] **Step 7:** Screenshot docs.mattstack.dev live in both schemes with Fast Browser, and confirm rt.cool redirects in the browser.
- [ ] **Step 8:** Update the agent memory `project_rt_docs_site.md` (now the mattstack docs at docs.mattstack.dev, project `mattstack-docs`, rt.cool redirect-only) and its MEMORY.md line.
