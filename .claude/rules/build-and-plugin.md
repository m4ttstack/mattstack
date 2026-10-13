---
paths:
  - "plugins/mattstack/**"
  - "lib/skills/**"
  - "scripts/build*"
  - ".github/workflows/release.yml"
---

# Build and the mattstack plugin

## plugins/mattstack

The mattstack skills plugin lives at `plugins/mattstack` and keeps its own
Markdown and shell style, never rt's formatter. Its checks run in the
`plugin-mattstack` job (certify, `rt skills check --strict`, the mcp-tools
reference diff), which also fails a PR that changes the plugin without
bumping `.claude-plugin/plugin.json`'s version. After any MCP tool change,
regenerate the reference: `bun cli.ts mcp tools --json | bun
plugins/mattstack/scripts/gen-mcp-tools.ts >
plugins/mattstack/attachments/mcp-tools/reference.md`. An edit under
`plugins/mattstack/attachments/gate-protocol` needs `bun run
skills:expand:board` and a committed `apps/board/skills` in the same PR, or
the always-run board skills guard fails.

### Bytecode compile (`--bytecode`) silently falls back on failure

`bun build --compile --bytecode` does not reliably fail loudly when bytecode generation fails. Ink's dependency graph (via `yoga-layout`) and top-level await in `cli.ts` both currently break bytecode generation, but when the *post-bundle* bytecode step itself fails (as opposed to a bundling/parse error), bun still writes out a working binary, just without bytecode, and only a few hundred KB smaller than the non-bytecode build, so the artifact looks like a success. Never conclude `--bytecode` worked because a binary appeared and ran; check the build's stderr for `Failed to generate bytecode` (or read the exit code) before trusting the artifact. A hard parse-time failure (e.g. the top-level `await` in `cli.ts`) does exit non-zero with no binary produced, so that failure mode is safe -- it's specifically the later stage that goes silent.
