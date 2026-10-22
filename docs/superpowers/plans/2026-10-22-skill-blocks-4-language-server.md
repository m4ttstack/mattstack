# Skill blocks, plan 4 of 4: the language server

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One stdio language server for `*.block.md` files and `skills.jsonc`, built on plan 1's parser and checks, launched by a VS Code extension and registered with Claude Code through the mattstack plugin, offering diagnostics, hover, go to definition, completion, find references, prop rename and block rename, in that order.

**Architecture:** The server is an rt verb, `rt skills lsp`, so it ships wherever rt does and the Claude Code registration is one command line. `lib/skills/lsp/` holds a workspace model (open documents overlaid on disk, the block trees and manifests under the workspace root, re-analysed on change) and one module per feature; each feature is a pure function from the workspace model and a position to an LSP result, with `vscode-languageserver` doing only transport. `extensions/vscode/skill-blocks/` is a thin `vscode-languageclient` extension. Nothing here duplicates a check: every diagnostic comes from `loadBlockTree`, `resolveProp`, `renderTree` and the manifest reader through their `BlockError`s.

**Tech Stack:** `vscode-languageserver` and `vscode-languageserver-textdocument` (server, added to rt's dependencies), `vscode-languageclient` (extension only), Bun, the existing `extensions/vscode/rt-context` as the extension template.

**Spec:** `docs/superpowers/specs/2026-10-22-skill-blocks-design.md`, section "Language server", Decision 16.

Depends on plan 1 (`BlockDiagnostic`, `loadBlockTree`, `parseBlockFile`, `parseMermaid`, `resolveProp`, `readManifestBindings`, `signatureOf`). Plan 2 should have landed before the extension is published so the engines it opens are block trees, but every task here is testable on the `mini` fixture alone.

## Global Constraints

- One server. The VS Code extension and the Claude Code registration both launch `rt skills lsp` over stdio; no second implementation and no feature that lives only in the extension.
- Every diagnostic is a plan 1 `BlockDiagnostic` mapped to an LSP `Diagnostic` with `range.start = { line: line - 1, character: col - 1 }` and `range.end` at the end of the token (a marker, a frontmatter key, a binding key or value), `source: "skill-blocks"`, `code` from the diagnostic.
- Features land in the spec's order and each is usable on its own.
- Rename and references cover the open workspace only: block files under the workspace root and every `skills.jsonc` under it. A mattstack prop or block renamed here is still a breaking change for plan 1's signature check; the server adds a warning diagnostic on the rename result saying so when the file is under `plugins/mattstack`.
- Block rename changes the id only: it moves the file or folder and rewrites bindings keyed on the old id and `{{include:x}}` lines naming it; `node:`, the title and `label` stay.
- Not in scope: renaming contracts; any editor other than VS Code (and Claude Code's registration).
- rt's TypeScript stays UI-free (`.claude/rules/output-layer.md`): the server prints nothing to stdout except LSP frames, and its logs go through rt's logger.
- Tests run from the repo root.

## Review Focus

1. A block file edited to a state that does not parse (a half-typed frontmatter): the server must publish the parse diagnostic and keep the last good tree for hover and completion, not drop every feature until the file is valid again. (Task 2.)
2. Two workspace folders, or a workspace that holds the mattstack plugin and a team pack: a binding in the pack's `skills.jsonc` must resolve against the plugin's engines when both are open, and report `missing-block` only when neither holds the block. (Task 2 tests a two-root workspace.)
3. Rename of a prop that another block in the same engine also declares with the same name: only the chosen block's declaration, markers and bindings change; the other block's are untouched. (Task 7.)
4. Block rename to an id that already exists, or to an id with `/index`, `.block.md` or an uppercase letter: refused with a message, no file moved. (Task 8.)
5. Completion inside a fenced code block or inside a `{{` that is not a `props.`/`include:` marker: no suggestions, never a crash on a malformed line. (Task 5.)

---

## File structure

Create under `lib/skills/lsp/`:

| File | Responsibility |
|---|---|
| `workspace.ts` | `Workspace`: roots, open-document overlay, analysed trees and manifests, reanalysis on change |
| `positions.ts` | `BlockDiagnostic` ↔ LSP `Range`; token spans in a block file and in `skills.jsonc` |
| `diagnostics.ts` | feature 1 |
| `hover.ts` | feature 2 |
| `definition.ts` | feature 3 |
| `completion.ts` | feature 4 |
| `references.ts` | feature 5 (find) |
| `rename.ts` | features 5 (prop) and 6 (block) |
| `server.ts` | `vscode-languageserver` connection wiring: capabilities, handlers → the modules above |

Modify: `commands/skills-lsp.ts` (new, `skillsLsp(args)` starts `server.ts` on stdio), `lib/command-tree-def.ts` (verb `lsp` under `skills`, description "Run the block language server over stdio for an editor", `omitBehavior` for the picker since it is not interactive; read `.claude/rules/command-tree.md` first), `package.json` (dependencies), `plugins/mattstack/.claude-plugin/plugin.json` (registration, Task 10).

Create: `extensions/vscode/skill-blocks/` (`package.json`, `src/extension.ts`, `tsconfig.json`, `README.md`, and a `build` npm script running esbuild, as `rt-context` builds; `rt-context` has no `scripts/build.sh`), and add it to the root `package.json` workspaces beside `extensions/vscode/rt-context`.

Tests: `lib/skills/lsp/__tests__/*.test.ts` against a temp copy of the `mini` fixture plus the `blocks` fixture pack; `extensions/vscode/skill-blocks/src/__tests__/extension.test.ts` for the launch arguments.

---

### Task 1: Positions

**Files:**
- Create: `lib/skills/lsp/positions.ts`
- Test: `lib/skills/lsp/__tests__/positions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Range = { start: { line: number; character: number }; end: { line: number; character: number } }; // 0-based, LSP
  export function rangeOf(d: BlockDiagnostic, text: string): Range; // end = end of the token starting at d (a {{…}} marker, a YAML key, a JSON string), else end of line
  export type Token =
    | { kind: "marker"; prop: string; range: Range }
    | { kind: "include"; name: string; range: Range }
    | { kind: "prop-decl"; prop: string; range: Range }
    | { kind: "node-decl"; node: string; range: Range }
    | { kind: "binding-key"; engineRef: string; blockPath: string | null; range: Range }
    | { kind: "binding-prop"; key: string; prop: string; range: Range }
    | { kind: "binding-value"; key: string; prop: string; value: string; range: Range };
  export function tokenAt(text: string, file: string, pos: { line: number; character: number }): Token | null; // block files and skills.jsonc (by extension)
  export function tokensIn(text: string, file: string): Token[];
  ```
- `tokenAt` ignores positions inside fenced code except a ```` ```mermaid ```` fence, where a node id under the cursor is `{ kind: "node-decl" }`.

- [ ] **Step 1: Write the failing tests** (a diagnostic at a marker's `{{` spans the whole `{{props.rules}}`; `tokenAt` inside `{{props.rules}}` on a block file gives `marker` with `prop: "rules"`; on `rules:` under `props:` gives `prop-decl`; on `"mattstack:mini/gate"` in a manifest gives `binding-key` with `blockPath: "gate"`; on its `"tiering"` key gives `binding-prop`; inside a ```` ```bash ```` fence gives null)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `lsp: positions and tokens in block files and manifests`**

---

### Task 2: The workspace model

**Files:**
- Create: `lib/skills/lsp/workspace.ts`
- Test: `lib/skills/lsp/__tests__/workspace.test.ts`

**Interfaces:**
- Consumes: plan 1 `loadBlockTree`, `isBlockTree`, `readManifestBindings`, `resolveProp`, `renderTree` (dry, no writes), `BlockError`.
- Produces:
  ```ts
  export type Analysis = { trees: Map<string /* engine dir */, BlockTree | null>; manifests: Map<string /* path */, LayeredBindings | null>; diagnostics: Map<string /* file */, BlockDiagnostic[]>; byBlockId: Map<string, { tree: BlockTree; block: Block }> };
  export class Workspace {
    constructor(roots: string[], readFile?: (p: string) => string);
    open(file: string, text: string): void; change(file: string, text: string): void; close(file: string): void;
    analysis(): Analysis;        // recomputed lazily after a change; a tree that fails to load keeps its last good value in `trees` and the failure in `diagnostics`
    engineDirs(): string[];      // every dir under a root holding index.block.md with type: pipeline-step, plus include dirs under attachments/
    text(file: string): string;  // overlay, else disk
  }
  ```
- A manifest's bindings are checked against every tree in every root: a key naming a block none holds is `missing-block` at the key; a prop none declares is `unknown-prop` at the prop key; a value whose skill is not found is `fill-missing` at the value. Required-prop and contract checks run through `resolveProp` with the manifest's layers.

- [ ] **Step 1: Write the failing tests** (a workspace over the `mini` fixture's plugin root plus the `blocks` fixture pack: `analysis().diagnostics` is empty; `change` a block file to a bad `merge:` publishes one diagnostic for that file and `trees` still holds the last good tree; a manifest binding to `mattstack:mini/nope` is `missing-block` at the key's range; the same key with both roots open and the block present in the plugin root is clean)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `lsp: workspace model with an open-document overlay`**

---

### Task 3: Diagnostics and the server

**Files:**
- Create: `lib/skills/lsp/diagnostics.ts`, `lib/skills/lsp/server.ts`, `commands/skills-lsp.ts`
- Modify: `package.json` (add `vscode-languageserver`, `vscode-languageserver-textdocument`), `lib/command-tree-def.ts`
- Test: `lib/skills/lsp/__tests__/diagnostics.test.ts`, `lib/skills/lsp/__tests__/server.e2e.test.ts` (spawns `bun cli.ts skills lsp` with `childEnv()`, sends `initialize`, `textDocument/didOpen` for a block file with an unknown prop, expects a `textDocument/publishDiagnostics` notification with one diagnostic whose `code` is `unknown-prop`; named `no-lsp-server.test.ts` if it must run on a PR per `.claude/rules/ci-and-tests.md`)

**Interfaces:**
- `publishable(ws: Workspace, file: string): Diagnostic[]` maps `BlockDiagnostic[]` through `rangeOf`, severity Error, `source: "skill-blocks"`.
- `server.ts` exports `startServer(opts: { roots: string[] })`; capabilities declared incrementally per task (`textDocumentSync: Incremental` here; hover, definition, completion, references, rename added by their tasks). Document selector: `**/*.block.md` and `**/skills.jsonc`.
- `rt skills lsp` takes no arguments beyond `--root <dir>` (repeatable; default the `initialize` request's workspace folders).

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement; `bun run check` for the command-tree conformance and the UI-free guard (`lib/__tests__/no-ui-in-cli.test.ts` must stay green: the server is not a UI framework, but confirm it is not caught by the import list). `lib/__tests__/no-raw-output.test.ts` forbids `process.stdout` under `lib/` and `commands/`: `server.ts` hands stdio to `vscode-languageserver` (`createConnection(ProposedFeatures.all)` started with `--stdio`) and never writes stdout itself; list the file in `lib/__tests__/raw-output-exemptions.json`, with its reason, only if the connection setup still trips the guard**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `rt skills lsp: diagnostics over stdio`**

---

### Task 4: Hover

**Files:**
- Create: `lib/skills/lsp/hover.ts`
- Test: `lib/skills/lsp/__tests__/hover.test.ts`

**Interfaces:**
- `hoverAt(ws, file, pos): { contents: string /* markdown */; range: Range } | null`: on a marker or a prop declaration: `**rules** · add · default: ""` then one line per layer `- widgets: ship-lint/fast-checks.md (12 lines)` or `- acme-base: nothing passed`, then `contract: model-tiering@1` when set; on a binding value: the value's skill description and `provides`; on `{{include:x}}`: the include root's title and block count.

- [ ] **Step 1: Write the failing tests** (hover on `{{props.tiering}}` in `mini/gate` lists `replace`, the default, the contract and `pack: cleared` for the fixture pack's `""`; hover on prose is null)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement and register `textDocument/hover`**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `lsp: hover on props, bindings and includes`**

---

### Task 5: Go to definition and completion

**Files:**
- Create: `lib/skills/lsp/definition.ts`, `lib/skills/lsp/completion.ts`
- Test: `definition.test.ts`, `completion.test.ts`

**Interfaces:**
- `definitionAt(ws, file, pos): { uri: string; range: Range }[]`: `{{include:x}}` → the include's `index.block.md` title line; `node: foo` → the parent's Mermaid node statement (or its first edge mention); a binding key → the block file's title line; a binding prop → the prop's declaration line; a binding value → the value file (`<skill>/<file>` or `SKILL.md`).
- `completionsAt(ws, file, pos): { label: string; kind: "prop" | "include" | "contract" | "block" | "value"; detail?: string }[]`: after `{{props.` the block's props; after `{{include:` every include dir; after `contract:` every `provides` value in the workspace; in a manifest key string, engine refs then block ids with `/`; in a manifest prop position, that block's props; in a value position, fills whose `provides` matches the prop's contract (or every fill when none). Nothing inside non-mermaid fences.

- [ ] **Step 1: Write the failing tests** (definition from the fixture manifest's `"mattstack:mini/gate"` lands on `gate.block.md` line of `# `; from `node: ask_gate` lands on the Mermaid line; completion after `{{props.` in `mini/gate` is `["tiering"]`; in a manifest value for `tiering` lists only `model-tiering@1` providers; inside a bash fence is `[]`; a line `{{pro` with no closing braces does not throw)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement and register `textDocument/definition` and `textDocument/completion` (trigger characters `.`, `:`, `"`, `/`)**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `lsp: go to definition and completion`**

---

### Task 6: Find references

**Files:**
- Create: `lib/skills/lsp/references.ts`
- Test: `references.test.ts`

**Interfaces:**
- `propReferences(ws, blockId, prop): { uri: string; range: Range; kind: "decl" | "marker" | "binding" }[]` across every open root: the declaration, every marker in that block, every manifest `bindings` and pipeline-bindings entry keyed on the block with that prop.
- `blockReferences(ws, blockId): { uri; range; kind: "file" | "binding-key" | "include" }[]`: the block's own file, every binding key on it (and on its descendants, since their ids contain its path), every `{{include:x}}` when the block is an include root.
- `referencesAt(ws, file, pos)` dispatches on `tokenAt`.

- [ ] **Step 1: Write the failing tests** (references for `mini/gate`.`tiering` from the marker: the decl, the marker, the fixture manifest's binding; `blockReferences("mini/gate")` lists the file and the binding key; a prop of the same name on another block is not listed)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement and register `textDocument/references`**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `lsp: find references for props and blocks`**

---

### Task 7: Rename a prop

**Files:**
- Create: `lib/skills/lsp/rename.ts`
- Test: `rename.test.ts`

**Interfaces:**
- `prepareRename(ws, file, pos): { range: Range; placeholder: string } | null` (a prop token or a block token, Task 8).
- `renameProp(ws, blockId, from, to): WorkspaceEdit` where `WorkspaceEdit = { changes: Record<uri, { range: Range; newText: string }[]>; warnings: string[] }`: edits the declaration key, every marker and every binding prop key from Task 6's list. `to` must match `^[a-z][a-z0-9-]*$` and not collide with another prop of the block (refused with a message). When the block is under a `plugins/mattstack` path, `warnings` carries "renaming a mattstack prop is a breaking change: add `props-change: <engine>/<block>.<from>: renamed to <to>` to the PR body" and the server shows it as a window message after the edit.

- [ ] **Step 1: Write the failing tests** (rename `tiering` → `model` on `mini/gate` edits three ranges across two files and no other block; a collision and a bad name are refused; the warning appears for a path under `plugins/mattstack` and not for the pack)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement and register `textDocument/prepareRename` and `textDocument/rename`**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `lsp: rename a prop across the workspace`**

---

### Task 8: Rename a block

**Files:**
- Modify: `lib/skills/lsp/rename.ts`
- Test: `rename.test.ts`

**Interfaces:**
- `renameBlock(ws, blockId, toTail: string): WorkspaceEdit & { documentChanges: ({ kind: "rename"; oldUri; newUri })[] }`: one `RenameFile` for the block's file (`<tail>.block.md`) or folder; text edits on every binding key that starts with the old id (the old segment replaced), every `{{include:<old>}}` when the block is an include root, and nothing in `node:`, the title or `label`. `toTail` must match `^[a-z][a-z0-9-]*$`, not be `index`, and not collide with a sibling (refused). The same `plugins/mattstack` warning as Task 7, naming the signature consequence.

- [ ] **Step 1: Write the failing tests** (rename `mini/gate` → `ask`: a `RenameFile` from `gate.block.md` to `ask.block.md`, the manifest key becomes `"mattstack:mini/ask"`, the file's `node: ask_gate` and `# ` title are unchanged; renaming a folder block renames the folder and rewrites a key on a descendant; `index`, `Gate` and an existing sibling are refused)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement; `prepareRename` on a block token returns the id tail**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `lsp: rename a block, moving its file and rewriting bindings and includes`**

---

### Task 9: The VS Code extension

**Files:**
- Create: `extensions/vscode/skill-blocks/package.json` (name `skill-blocks`, `activationEvents: ["workspaceContains:**/*.block.md", "workspaceContains:**/skills.jsonc"]`, `contributes.languages` registering `skill-blocks-markdown` for `*.block.md` with `markdown` as the base configuration so highlighting stays, a `skillBlocks.rtPath` setting defaulting to `rt`), `src/extension.ts` (`LanguageClient` over `{ command: rtPath, args: ["skills", "lsp"], transport: stdio }`, document selector for both patterns, a "Skill Blocks: Restart Server" command), `tsconfig.json`, the esbuild `build` script in `package.json`, `README.md` (install from a `.vsix` built by `bun run build && npx @vscode/vsce package`)
- Modify: root `package.json` workspaces
- Test: `src/__tests__/extension.test.ts` (the client is built with `["skills","lsp"]` and the configured path)

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run from the repo root with the extension's own test script → FAIL**
- [ ] **Step 3: Implement; build; install the `.vsix` into VS Code by hand; open `plugins/mattstack/attachments/pipeline/ship/flow/fast-checks.block.md` (or the `mini` fixture before plan 2 lands), type `{{props.nope}}` and see the diagnostic, hover a marker, F12 on an include, rename a prop; screenshot the diagnostic and the hover into the scratchpad**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `extensions/vscode/skill-blocks: launch rt skills lsp`**

---

### Task 10: Claude Code registration

**Files:**
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` and, if the reference puts it elsewhere, the file it names
- Test: `plugins/mattstack/tests/test-lsp-registration.sh` (the registration names `rt skills lsp` and the two file patterns; added to the plugin hook tests step in `checks.yml`)

- [ ] **Step 1: Read the Claude Code plugin reference (code.claude.com/docs/en/plugins and the plugins reference page) for how a plugin registers a language server, and confirm the key name and shape there before writing it; do not guess a field**
- [ ] **Step 2: If registration is supported: add it (command `rt`, args `["skills","lsp"]`, the two patterns), bump the plugin version, write the test, run it → PASS. If it is not: stop, write the finding in the commit message of a docs-only commit to `plugins/mattstack/README.md`'s editor section, and report it as out of scope under the spec's "only registration" rule**
- [ ] **Step 3: Commit: `mattstack: register the block language server with Claude Code`**

---

## Self-review notes

- Spec coverage: Files pattern (every task's selector), Diagnostics with ranges (Tasks 1-3), features 1-6 in order (Tasks 3-8), Editors (Tasks 9-10), Not in scope honored (no contract rename; no Zed).
- Interpretation: the server is `rt skills lsp` inside rt rather than a separate package, because the Claude Code registration needs a command that exists on every machine rt is installed on and because the checks it reuses live in `lib/skills/blocks`. The spec's author has been told.
- `BlockError` positions come from plan 1; a check plan 1 reports without a column (none are planned) would surface here at column 1, which is why plan 1's Global Constraints require line and col on every diagnostic.
