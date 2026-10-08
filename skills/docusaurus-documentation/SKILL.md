---
name: docusaurus-documentation
description: Use when looking up the latest Docusaurus documentation at https://docusaurus.io/docs — retrieving config option references, plugin/preset APIs, MDX and markdown-feature syntax, sidebar and routing setup, theming, and deployment instructions. Triggers on tasks involving Docusaurus APIs, markdown/MDX features, configuration options, sidebars, or best practices.
license: MIT
metadata:
  author: mcclowes
  version: "1.0.0"
---

# Docusaurus Docs

## Quick Start

When the user asks about Docusaurus features, configuration, or best practices, use the WebFetch tool to look up information from the official Docusaurus documentation. Fetch the page closest to the topic, then read the answer out of the returned content.

```typescript
// Concrete example: confirm how to set the default sidebar collapse behaviour
WebFetch({
  url: "https://docusaurus.io/docs/sidebar",
  prompt: "How do I make all sidebar categories collapsed by default? Quote the exact config option and where it goes."
})
```

## Core Principles

- Always use WebFetch to get the latest documentation from https://docusaurus.io/docs
- Common documentation paths: /configuration, /api, /guides, /creating-pages, /markdown-features
- Start with the main docs page if you're unsure of the exact path

## When a fetch doesn't answer the question

URLs change between Docusaurus versions, so a guessed path may 404 or land on the wrong page. If that happens:

1. Fetch the docs index `https://docusaurus.io/docs` and look for the right link in its navigation.
2. Try `https://docusaurus.io/search?q=<keywords>` to locate the page by keyword.
3. If the topic is version-specific, prefix the path with the version, e.g. `https://docusaurus.io/docs/3.x/<path>`.

Don't answer from memory when a fetch fails — say which paths you tried and what you couldn't confirm.

## Common Patterns

### Looking Up Configuration Options

When users ask about docusaurus.config.js settings, theming, or plugins:
1. Use WebFetch with https://docusaurus.io/docs/api/docusaurus-config
2. For specific plugins, check https://docusaurus.io/docs/api/plugins/[plugin-name]
3. For theming, use https://docusaurus.io/docs/styling-layout

### Finding Feature Documentation

For markdown features, MDX, or content creation:
- Markdown features: https://docusaurus.io/docs/markdown-features
- MDX and React: https://docusaurus.io/docs/markdown-features/react
- Docs organization: https://docusaurus.io/docs/create-doc

## Notes

- Docusaurus documentation is frequently updated; always fetch latest from https://docusaurus.io/docs
- When uncertain about the exact URL path, start with the main docs page and search
- For version-specific features, check the version selector on the docs site
