# docs site (website/)

The Docusaurus site served at https://docs.mattstack.dev. The `rt:docs` skill
(`skills/rt-docs/SKILL.md`) owns the process: what is generated, `docs:gen`,
`docs:check`, `docs:build` and the deploy. This file covers how a page is laid
out and written.

## Docs conventions

### Layout

- Five tabs, one folder each under `docs/`: `start`, `apps`, `rt`, `gitq`,
  `skills`. `sidebars.ts` autogenerates each tab's sidebar from its folder, so
  a new page needs no sidebar entry.
- Order pages with `sidebar_position` in frontmatter. A subfolder carries a
  `_category_.json` with `label` and `position`, and a `generated-index` link
  when the folder needs a landing page (`docs/gitq/guides/`). `docs/apps/` is
  flat and has none.
- `docs/rt/reference/` is generated from `lib/command-tree-def.ts`. Never edit
  it by hand; `rt:docs` says what to do instead.
- Every page is `.mdx`. Docs route from `/`, so `docs/apps/board.mdx` is
  `/apps/board`. Link with absolute paths (`/start/teams`). Broken links,
  anchors and Markdown links all fail the build.

### Components and features

- Admonitions: `:::note`, `:::tip`, `:::caution`, `:::warning` and `:::danger`.
  A warning goes before the step it protects.
- Alternatives (macOS or Linux, CLI or app) go in `<Tabs>` from `@theme/Tabs`,
  never hand-built HTML. No page uses them yet.
- `<Screenshot name="board/row-menu" alt="..." />` loads
  `static/img/<name>-light.png` and `-dark.png`, so every screenshot ships both.
- `<BoardIcon>` and `<FlockStatus>` draw the apps' own icons and status marks
  inside tables.
- Keys are `<kbd>` elements. A table of keys sits in
  `<div className="keys-table">`.
- Diagrams are ```` ```mermaid ```` fences.
- A content change adds no new component or CSS.

### Writing

- Before drafting, classify the page as a tutorial, how-to, reference or
  explanation (Diátaxis). One page is one type. An app page may pair a short
  overview with reference tables; anything the reader does in order is a
  numbered procedure.
- One approved term per concept. `TERMINOLOGY.md`, beside this file, holds the
  table; it stays out of `docs/` so it never publishes. A page that introduces
  a concept adds its row.
- Verify every claim against the source before you write it. A behavior you
  have not confirmed in code stays out of the page.
- Name a feature by what it is, not how it looks: the section is
  "Background work", and the text can say its mark is a mauve ring.
- The page never describes itself or how it was made: no "this page covers",
  "every block below came from a real run", "verified against source" or
  "these screenshots are fixtures". Say the fact the reader needs, or cut it.
- A file name the reader looks for is never a placeholder like
  `Flock-<version>.dmg`; write "the `.dmg` from the latest release".
- The site is public: placeholder names only (acme, widgets, gadgets, dev1,
  dev2, gitlab.example.com), never a real org, team, person, MR or ticket.
- Matt's writing style governs the voice: short plain sentences, lead with
  what the reader does, no em or en dashes, no "ensures" or "in order to".

### Writing a page

Follow the `doc-standards` skill (`skills/doc-standards/SKILL.md`):

1. Structure: the Diátaxis type, the reader, and what they can do afterwards.
2. Draft under its controlled-language rules.
3. Style pass.
4. AI pass: cut narration, filler and dashes.
5. Gate, from the repo root:
   - `python3 skills/doc-standards/scripts/check_docs.py website/docs/<path>.mdx --no-vale`
     shows zero errors on every page you touched. Warnings are judgment calls:
     UI labels and table cells often trip the passive-voice check.
   - `bun run docs:check`, then `bun run docs:build` (bun, never npm).
6. Look at the page in Fast Browser, light and dark, before you call it done.

The `doc-standards`, `docusaurus-config` and `docusaurus-documentation` skills
live in `skills/`. `check_docs.py` carries a local patch so it reads MDX
(frontmatter, imports, JSX, `:::` fences, table cells).
