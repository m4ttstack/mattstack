# AI/agent readability — docs as a retrieval surface

A large share of documentation traffic is now agents, not humans (GitBook measured ~41%
of doc page requests from AI agents in 2026: Cursor, Claude, RAG pipelines). Agents read
docs one retrieved chunk at a time, with no navigation, no CSS, and a token budget.
Design for that reader explicitly.

## The one rule that matters most

**Every heading-delimited section must be a complete thought that works retrieved
alone.** A RAG pipeline or agent gets ONE section, out of order, without siblings.

Consequences:
- No "as mentioned above / in the previous section". Restate the fact in one clause or
  link with descriptive text.
- Don't split one concept across two headings; don't bury two concepts under one.
- The section's first sentence states what the section covers — it doubles as the
  retrieval summary.
- Repeat critical constraints (auth required, version minimums, destructive-action
  warnings) in every section where they bind. Human-oriented DRY is an anti-pattern
  for retrieval; controlled repetition is correct.

## Structural rules

- **Strict heading hierarchy.** One h1, no skipped levels; headings are unique within a
  page (agents dedupe anchors by text).
- **Explicit over implicit.** Full parameter tables — name, type, required/optional,
  default, constraints, example. What is "obvious" to a human is ambiguous to an agent
  generating code against your API.
- **Realistic examples with expected output.** Agents pattern-match examples to generate
  parsing code; a fake `{"foo": "bar"}` produces fake integrations. In OpenAPI specs,
  fill the `example`/`examples` fields.
- **Stable anchors and URLs.** Renaming a heading breaks every agent memory and every
  llms.txt pointer to it.
- **Text-accessible everything.** Information that exists only in a screenshot, diagram,
  or video is invisible. Pair every image with prose or alt text that carries the
  same content. Mermaid beats PNG (it is text).
- **Prefer Markdown-native output.** If the docs platform supports it, expose `.md`
  versions of pages (many platforms serve `page.md`); agents fetch those clean.

## llms.txt

A Markdown index at the docs root (`/llms.txt`) that tells an LLM what exists and where,
within a token budget. Format (from llmstxt.org):

```markdown
# Project name

> One-paragraph summary of what the project is and does.

Key facts an agent needs before reading further (auth model, base URL, install command).

## Docs

- [Quickstart](https://example.com/docs/quickstart.md): install to first success in 5 min
- [API reference](https://example.com/docs/api.md): all endpoints, params, examples

## Optional

- [Architecture](https://example.com/docs/architecture.md): internals, for contributors
```

Rules:
- Every link carries a one-line description (the agent decides relevance from it).
- `## Optional` marks what an agent can skip under budget pressure.
- Optionally provide `/llms-full.txt` — the full docs concatenated as one Markdown file
  for agents that prefer one fetch.
- Keep it generated or checked in CI; a stale llms.txt is worse than none.

## Anti-patterns that waste agent tokens

- Marketing prose inside reference pages (agents pay tokens for it; humans skip it).
- Giant "everything" pages — chunking splits them at arbitrary points.
- Tables of images, ASCII-art layout, HTML-only content.
- Changelogs mixed into reference pages (version noise pollutes retrieval).
