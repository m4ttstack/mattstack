# Skill blocks, plan 1 of 4: the block compiler

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt skills compile` reads an engine or include authored as a tree of `*.block.md` files (props, Mermaid graphs, `order`, includes) and writes the same one-file `SKILL.md` it writes today, with every check reporting file, line and column.

**Architecture:** A new `lib/skills/blocks/` module owns the block model: load a tree, parse frontmatter and Mermaid, merge prop values by layer, render markdown with heading levels from depth, and emit dot. `compile.ts` gains a second entry path (`compileBlockSkill`) beside today's `compileSkill`; both share fills, includes, lint and vendoring. Slot engines keep compiling through this plan so the existing suite stays green; plan 2 converts the engines and then removes slots. A `rt skills blocks --json` verb exposes the tree for console (plan 3), and the diagnostics type is what the language server (plan 4) serves.

**Tech Stack:** Bun, TypeScript, `yaml` (already a dependency) for frontmatter, graphviz `dot` only in tests that run `check-dot.py`. No Mermaid library: the subset the spec fixes is small enough to parse by hand.

**Spec:** `docs/superpowers/specs/2026-10-22-skill-blocks-design.md` (sections "The model", "Prop signature check", "Order", "Graphs", "Includes", "Compile", "Language server" for diagnostics only).

Sibling plans: `2026-10-22-skill-blocks-2-engine-conversion.md`, `2026-10-22-skill-blocks-3-console.md`, `2026-10-22-skill-blocks-4-language-server.md`. This plan lands first; the others consume its Interfaces.

## Global Constraints

- Block files are named `*.block.md`; a folder block's file is `index.block.md`. A block's id is its path without `.block.md`, with `/index` dropped: `ship/flow/fast-checks`.
- A block stores its title as a `#` line whose level is ignored; compile assigns `#` marks from depth (root title is H1, its children H2, and so on). A headless block (no `#` line) renders inline at its parent's level; its sub-headings sit one level below the parent's.
- Frontmatter fields: `node`, `label`, `order`, `kind: gate`, `props: { <name>: { merge: add | replace, default?: string, contract?: string } }`, plus the engine fields the root carries today (`name`, `description`, `type: pipeline-step`, `allowed-tools`, `metadata`, `disable-model-invocation`).
- `{{props.x}}` is the only new placeholder. `{{include:x}}`, `{{team.x}}`, `{{team.section:x}}`, `{{verb.path:x}}`, `{{run-start.flags:x}}` and the rest of `placeholders.ts` keep their meaning.
- Prop values: `merge: add` stacks org then team; `merge: replace` keeps the last layer; `default` applies when no layer passes a value; no `default` means required; `""` clears lower layers and falls back to `default`, and clearing a required prop stops compile.
- A value is `plugin:skill` (the skill's `SKILL.md` body) or `plugin:skill/file` (that file; the `SKILL.md` is frontmatter only). A whole-skill value keeps today's reference mode (`isInlined`): a registered public skill renders as the one-line "invoke that skill" reference, any other whole skill is inlined. A per-file value is always inlined. A `plugin:skill/file` value is checked against its skill's `metadata.provides`.
- An include whose root title repeats the title of the block that includes it drops the repeat; compile and `rt skills expand` apply the same rule.
- Bindings: `pack/skills.jsonc` version 2, keyed `"<engine ref>[/<block path>]": { "<prop>": "<value>" }`. The value pattern allows one `/`.
- Order: a graph's children follow the first appearance of their `node:` in the parent's Mermaid source; other siblings follow `order` ascending, then those without `order` by filename.
- Mermaid shapes map one to one: `([…])` ellipse, `{…}` diamond, `[…]` box, `[/…/]` plaintext, `(((…)))` doublecircle; `:::stop` gives `shape=octagon style=filled fillcolor=red fontcolor=white`, `:::done` gives `shape=doublecircle style=filled fillcolor=lightgreen`. A block node may omit its label; compile fills it from the title and refuses a label that disagrees.
- Compiled dot passes `check-dot.py --short-ids` with the same node ids and edges as today; formatting is free.
- An include that carries headings must be the last thing in its block; a heading-less include may sit anywhere.
- Every check reports `{ file, line, col, message }`.
- Output rules from `.claude/rules/output-layer.md`: no console output under `lib/` or `commands/`; errors with exact file:line wording stay as `SkillsUsageError` messages.
- Tests run from the repo root (`bun test <path>`), never from a subdirectory.

## Review Focus

1. A `{{props.x}}` marker for a prop the block's frontmatter does not declare: compile must refuse with the marker's file, line and col, never render the marker verbatim. (Task 3 tests it.)
2. A block whose `node:` names a node absent from the parent's graph, or a parent graph node whose id matches no block when a `### ` section exists today: compile must refuse naming both the block file and the graph line. (Task 6.)
3. Two siblings with the same `order`, or an `order` on a graph child: stable result, no silent reordering between runs. (Task 7 tests both.)
4. A `plugin:skill/file` value whose file is missing, or whose `SKILL.md` has a body: compile refuses, naming the binding key. (Task 4.)
5. A team layer `""` on a required prop with no default: the error names the prop and the layer that cleared it, not "no layer passes a value". (Task 5.)

---

## File structure

Create under `lib/skills/blocks/`:

| File | Responsibility |
|---|---|
| `types.ts` | `BlockTree`, `Block`, `PropSpec`, `PropValue`, `BlockGraph`, `BlockDiagnostic` |
| `diagnostics.ts` | `BlockDiagnostic`, `BlockError` (an `Error` carrying diagnostics), `formatDiagnostic` |
| `frontmatter.ts` | parse one block file's frontmatter into typed fields with positions |
| `tree.ts` | load a tree from a directory, assign ids, depth and order |
| `mermaid.ts` | parse the Mermaid subset into `BlockGraph` |
| `dot.ts` | `BlockGraph` → dot source |
| `props.ts` | layered values → merged value per prop |
| `render.ts` | tree + values + includes → markdown body and seams |
| `signature.ts` | a tree's prop signature and the breaking-change diff |
| `payload.ts` | the `rt skills blocks --json` payload |

Modify: `lib/skills/types.ts`, `lib/skills/compile.ts`, `lib/skills/sources.ts`, `lib/skills/manifest-merge.ts`, `lib/skills/pipelines.ts`, `lib/skills/drift.ts`, `lib/skills/expand.ts`, `commands/skills.ts`, `lib/command-tree-def.ts`, `plugins/mattstack/plugin/schemas/skills-manifest.schema.json`, `scripts/ci/` (signature check), `.github/workflows/checks.yml`.

Tests sit in `lib/skills/blocks/__tests__/` and `lib/skills/__tests__/`; fixtures in `lib/skills/__tests__/fixtures/blocks/`.

---

### Task 1: Diagnostics and block types

**Files:**
- Create: `lib/skills/blocks/types.ts`, `lib/skills/blocks/diagnostics.ts`
- Test: `lib/skills/blocks/__tests__/diagnostics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BlockDiagnostic = { file: string; line: number; col: number; message: string; code: string };
  export class BlockError extends Error { diagnostics: BlockDiagnostic[]; }
  export function formatDiagnostic(d: BlockDiagnostic): string; // `${file}:${line}:${col}: ${message}`
  export type PropSpec = { name: string; merge: "add" | "replace"; default: string | null; contract: string | null; declaredAt: { line: number; col: number } };
  export type MarkerUse = { prop: string; line: number; col: number };
  export type Block = {
    id: string;            // "ship/flow/fast-checks"
    path: string;          // absolute file path
    relPath: string;       // plugin-relative, for seams
    depth: number;         // root = 0
    title: string | null;  // null = headless
    label: string;         // frontmatter label, else id tail in plain words
    node: string | null;
    order: number | null;
    kind: "gate" | null;
    props: PropSpec[];
    markers: MarkerUse[];
    text: string;          // body below the title line, frontmatter stripped
    bodyStartLine: number;
    graph: BlockGraph | null;
    children: Block[];
    frontmatter: Record<string, unknown>; // the root's engine fields live here
  };
  export type BlockTree = { root: Block; dir: string; byId: Map<string, Block> };
  export type GraphNode = { id: string; label: string | null; shape: "ellipse" | "diamond" | "box" | "plaintext" | "doublecircle"; cls: "stop" | "done" | null; line: number };
  export type GraphEdge = { from: string; to: string; label: string | null; line: number };
  export type BlockGraph = { name: string; nodes: GraphNode[]; edges: GraphEdge[]; fenceLine: number };
  ```
- `code` values used across this plan: `unknown-prop`, `required-prop`, `contract-mismatch`, `text-after-include`, `label-disagrees`, `missing-block`, `missing-node`, `node-unbound`, `duplicate-order`, `order-on-graph-child`, `bad-value`, `old-slot-binding`, `headless-children`, `fill-missing`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { BlockError, formatDiagnostic } from "../diagnostics.ts";

test("formatDiagnostic prints file:line:col: message", () => {
  expect(formatDiagnostic({ file: "a/b.block.md", line: 3, col: 7, message: "x", code: "unknown-prop" })).toBe("a/b.block.md:3:7: x");
});
test("BlockError's message joins its diagnostics one per line", () => {
  const err = new BlockError([{ file: "a.block.md", line: 1, col: 1, message: "m1", code: "unknown-prop" }, { file: "b.block.md", line: 2, col: 3, message: "m2", code: "required-prop" }]);
  expect(err.message).toBe("a.block.md:1:1: m1\nb.block.md:2:3: m2");
});
```

- [ ] **Step 2: Run it: `bun test lib/skills/blocks/__tests__/diagnostics.test.ts` → FAIL (module not found)**
- [ ] **Step 3: Write `types.ts` and `diagnostics.ts` with the signatures above**
- [ ] **Step 4: Run it → PASS**
- [ ] **Step 5: Commit: `git add lib/skills/blocks && git commit -m "blocks: diagnostic and block types"`**

---

### Task 2: Frontmatter and markers of one block file

**Files:**
- Create: `lib/skills/blocks/frontmatter.ts`
- Test: `lib/skills/blocks/__tests__/frontmatter.test.ts`

**Interfaces:**
- Consumes: `stripFrontmatter` from `lib/skills/sources.ts` (body, frontmatter, bodyStartLine); `findPlaceholders` from `placeholders.ts`.
- Produces:
  ```ts
  export type ParsedBlockFile = Pick<Block, "title" | "label" | "node" | "order" | "kind" | "props" | "markers" | "text" | "bodyStartLine" | "frontmatter">;
  export function parseBlockFile(raw: string, file: string, idTail: string): ParsedBlockFile; // throws BlockError
  export function labelFromId(idTail: string): string; // "fast-checks" → "Fast checks"
  ```
- Rules: `props` is a map; each entry needs `merge` of `add` or `replace` (else `BlockError` at the frontmatter line); `default` is a string when present; `contract` a string. `order` is a number. `kind` only `gate`. The title is the first non-blank body line when it starts with `#`; `text` is the body after that line, else the whole body. `markers` lists every `{{props.x}}` with its 1-based line (counted in the file) and col. A marker naming an undeclared prop is `unknown-prop` at the marker.

- [ ] **Step 1: Write the failing tests**

```ts
test("parses props, title, label, markers and positions", () => {
  const raw = `---\nnode: domain_fast_checks\nlabel: Fast checks\nprops:\n  rules: { merge: add, default: "" }\n---\n# Run the domain's fast checks\n\nOnly the checks.\n\n{{props.rules}}\n`;
  const b = parseBlockFile(raw, "flow/fast-checks.block.md", "fast-checks");
  expect(b.title).toBe("Run the domain's fast checks");
  expect(b.label).toBe("Fast checks");
  expect(b.node).toBe("domain_fast_checks");
  expect(b.props).toEqual([{ name: "rules", merge: "add", default: "", contract: null, declaredAt: { line: 5, col: 3 } }]);
  expect(b.markers).toEqual([{ prop: "rules", line: 11, col: 1 }]);
  expect(b.text).toBe("Only the checks.\n\n{{props.rules}}");
});
test("a headless block has title null and label from its id", () => {
  const b = parseBlockFile("---\n---\nJust text.\n", "x/guard.block.md", "guard");
  expect(b.title).toBeNull();
  expect(b.label).toBe("Guard");
});
test("a marker for an undeclared prop is unknown-prop at the marker", () => {
  expect(() => parseBlockFile("# T\n\n{{props.nope}}\n", "t.block.md", "t")).toThrow(/t\.block\.md:3:1: .*"nope"/);
});
test("merge must be add or replace", () => {
  expect(() => parseBlockFile("---\nprops:\n  x: { merge: both }\n---\n# T\n", "t.block.md", "t")).toThrow(/t\.block\.md:3:3: .*merge/);
});
test("labelFromId", () => { expect(labelFromId("resume-offer")).toBe("Resume offer"); });
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement `parseBlockFile` and `labelFromId`** (count frontmatter lines from the raw text to position `declaredAt`; use the `yaml` package's `LineCounter` and `parseDocument` to get the node ranges for `props.<name>`).
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `blocks: parse one block file`**

---

### Task 3: Load a tree from a directory

**Files:**
- Create: `lib/skills/blocks/tree.ts`
- Create fixtures: `lib/skills/__tests__/fixtures/blocks/plugins/mattstack/attachments/pipeline/mini/` with `index.block.md` (root, `type: pipeline-step`, name `mini`, a Mermaid graph, a `{{props.domain}}` marker on a `rules` prop), `run.block.md` (`node: run_step`, `order` absent), `notes.block.md` (`order: 2`), `gate.block.md` (`node: ask_gate`, `kind: gate`, `props: { tiering: { merge: replace, default: "mattstack:model-tiering", contract: "model-tiering@1" } }`, text ending with `{{props.tiering}}`), `guard.block.md` (headless, text only).
- Test: `lib/skills/blocks/__tests__/tree.test.ts`

**Interfaces:**
- Consumes: Task 2 `parseBlockFile`; Task 6 `parseMermaid` (Task 6 is executed before this task, see the order note at the end of the plan; `tree.ts` calls it when the block's text has a ```` ```mermaid ```` fence).
- Produces:
  ```ts
  export function loadBlockTree(dir: string, opts: { idPrefix: string; relRoot: string }): BlockTree; // throws BlockError
  export function isBlockTree(dir: string): boolean; // true when dir/index.block.md exists
  export function walk(tree: BlockTree): Block[]; // preorder, children in final order
  ```
- Rules: a folder with `index.block.md` is a block with children: every `*.block.md` in it and every sub-folder holding an `index.block.md`. Any other file is a vendored step file (left to `listFilesUnder` as today). Children are ordered by Task 7's rule; until Task 7 lands, filename order. `depth` of root is 0. A headless block with children is `headless-children`.

- [ ] **Step 1: Write the failing tests**

```ts
const DIR = join(import.meta.dir, "..", "..", "__tests__", "fixtures", "blocks", "plugins", "mattstack", "attachments", "pipeline", "mini");
test("loads ids, depth and the root's engine frontmatter", () => {
  const tree = loadBlockTree(DIR, { idPrefix: "mini", relRoot: "attachments/pipeline/mini" });
  expect(tree.root.id).toBe("mini");
  expect(tree.root.frontmatter.type).toBe("pipeline-step");
  expect([...tree.byId.keys()].sort()).toEqual(["mini", "mini/gate", "mini/guard", "mini/notes", "mini/run"]);
  expect(tree.byId.get("mini/gate")!.depth).toBe(1);
  expect(tree.byId.get("mini/gate")!.relPath).toBe("attachments/pipeline/mini/gate.block.md");
});
test("isBlockTree", () => {
  expect(isBlockTree(DIR)).toBe(true);
  expect(isBlockTree(join(DIR, ".."))).toBe(false);
});
test("a headless block with children is refused", () => {
  // temp dir: a/index.block.md with no title + a/x.block.md
  expect(() => loadBlockTree(tmp, { idPrefix: "a", relRoot: "a" })).toThrow(/index\.block\.md:1:1: .*headless/);
});
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Write the fixture files and `tree.ts`**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `blocks: load a tree from a directory; mini fixture`**

---

### Task 4: Prop values from bindings

**Files:**
- Create: `lib/skills/blocks/props.ts`
- Modify: `lib/skills/sources.ts` (`loadAttachment` learns the `plugin:skill/file` form)
- Modify: `lib/skills/types.ts` (`AttachmentSource` gains `file: string | null`)
- Test: `lib/skills/blocks/__tests__/props.test.ts`, extend `lib/skills/__tests__/sources.test.ts`

**Interfaces:**
- Consumes: `loadAttachment(binding, where, roots)` from `sources.ts`; `AttachmentSource`.
- Produces:
  ```ts
  export type LayerValue = { layer: string; value: string }; // value "" = clear
  export type PropValue = { spec: PropSpec; sources: { layer: string; fill: AttachmentSource; mode: "inline" | "reference" }[]; fromDefault: boolean };
  export function resolveProp(spec: PropSpec, layers: LayerValue[], load: (binding: string) => AttachmentSource, where: { file: string; internalRoster: Set<string> }): PropValue; // throws BlockError
  ```
- Rules in `resolveProp`: walk layers in order; `""` empties what came before; `add` keeps every non-empty value in order; `replace` keeps the last non-empty. Nothing left → `default` (`""` default → empty sources, `fromDefault: true`; a `plugin:skill` default is loaded like a value). No default → `required-prop` at `spec.declaredAt`, naming the layer that cleared it when one did. Each loaded fill's `provides` must equal `spec.contract` when the spec has one (`contract-mismatch`). `mode` is `"reference"` for a whole-skill value where `!isInlined(fill, internalRoster)` (today's rule in `compile.ts`, kept and exported), `"inline"` otherwise; a per-file value (`fill.file !== null`) is always `"inline"`.
- `loadAttachment` change: a binding `plugin:skill/file` resolves the skill dir as today, then reads `<dir>/<file>` as the body (`srcPath` and `bodyStartLine` point at that file, `bodyStartLine` 1), requires the skill's `SKILL.md` body to be empty (`bad-value`: "<binding>: SKILL.md carries text, but a per-file value's SKILL.md is frontmatter only"), and sets `file`. `provides`, `allowedTools`, `extraFiles` come from the skill as today; `extraFiles` excludes `*.md` siblings that other bindings name (they are values, not vendored files).

- [ ] **Step 1: Write the failing tests**

```ts
const spec = (p: Partial<PropSpec>): PropSpec => ({ name: "rules", merge: "add", default: null, contract: null, declaredAt: { line: 4, col: 3 }, ...p });
const fill = (binding: string, provides = ""): AttachmentSource => ({ binding, plugin: binding.split(":")[0]!, version: "1", dir: "/x", srcPath: "x.md", bodyStartLine: 1, body: `body of ${binding}`, provides, allowedTools: [], extraFiles: [], registered: false, file: null });
const load = (b: string) => fill(b, "ship-domain@1");

test("add stacks org then team", () => {
  const v = resolveProp(spec({}), [{ layer: "base:acme-base", value: "acme-base:rules/fast" }, { layer: "pack", value: "widgets:lint/fast" }], load, { file: "f" });
  expect(v.sources.map((s) => s.fill.binding)).toEqual(["acme-base:rules/fast", "widgets:lint/fast"]);
});
test("replace keeps the last layer", () => {
  const v = resolveProp(spec({ merge: "replace" }), [{ layer: "base:b", value: "b:one" }, { layer: "pack", value: "w:two" }], load, { file: "f" });
  expect(v.sources.map((s) => s.fill.binding)).toEqual(["w:two"]);
});
test("an empty binding clears lower layers and falls back to the default", () => {
  const v = resolveProp(spec({ default: "" }), [{ layer: "base:b", value: "b:one" }, { layer: "pack", value: "" }], load, { file: "f" });
  expect(v.sources).toEqual([]);
  expect(v.fromDefault).toBe(true);
});
test("clearing a required prop names the clearing layer", () => {
  expect(() => resolveProp(spec({}), [{ layer: "base:b", value: "b:one" }, { layer: "pack", value: "" }], load, { file: "f.block.md" }))
    .toThrow(/f\.block\.md:4:3: prop "rules" is required .* cleared by pack/);
});
test("no layer and no default is required-prop", () => {
  expect(() => resolveProp(spec({}), [], load, { file: "f.block.md" })).toThrow(/required/);
});
test("a contract mismatch names the binding", () => {
  expect(() => resolveProp(spec({ contract: "model-tiering@1" }), [{ layer: "pack", value: "w:x" }], load, { file: "f.block.md" })).toThrow(/w:x .*provides "ship-domain@1".*"model-tiering@1"/);
});
test("a registered public whole-skill value is a reference; a per-file value is inlined", () => {
  const pub = (b: string) => ({ ...fill(b, "model-tiering@1"), registered: true });
  const v = resolveProp(spec({ merge: "replace", default: "mattstack:model-tiering", contract: "model-tiering@1" }), [], pub, { file: "f", internalRoster: new Set() });
  expect(v.sources[0]!.mode).toBe("reference");
  const perFile = (b: string) => ({ ...fill(b, "model-tiering@1"), registered: true, file: "tiers.md" });
  expect(resolveProp(spec({ contract: "model-tiering@1" }), [{ layer: "pack", value: "w:t/tiers" }], perFile, { file: "f", internalRoster: new Set() }).sources[0]!.mode).toBe("inline");
});
```

(The `where` argument in the earlier cases carries `internalRoster: new Set()` too; it is elided above for brevity.)

And in `sources.test.ts`: a temp plugin root with `attachments/lint/SKILL.md` (frontmatter only, `metadata.provides: ship-domain@1`) and `attachments/lint/fast.md`; `loadAttachment("w:lint/fast", "rules", roots)` returns `body` "the fast rules", `file` "fast.md", `srcPath` ending `attachments/lint/fast.md`; a `SKILL.md` with body text throws `/frontmatter only/`; a missing file throws naming `w:lint/fast`.

- [ ] **Step 2: Run both files → FAIL**
- [ ] **Step 3: Implement `resolveProp`; extend `loadAttachment`; add `file` to `AttachmentSource` (default `null` in every existing constructor, including test literals)**
- [ ] **Step 4: Run `bun test lib/skills` → PASS**
- [ ] **Step 5: Commit: `blocks: prop values by layer; per-file fill values`**

---

### Task 5: Manifest version 2, layered bindings

**Files:**
- Modify: `plugins/mattstack/plugin/schemas/skills-manifest.schema.json` (version `1 | 2`; under 2, binding keys match `^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*$`, values match the skillName pattern with an optional `/<file>` tail or `""`)
- Modify: `lib/skills/manifest-merge.ts` (keep every layer's value per prop), `lib/skills/pipelines.ts` (`effectiveSlotBindings` → `effectiveBindings` returning `Record<prop, LayerValue[]>`), `lib/skills/sources.ts` `readManifestBindings`
- Test: `lib/skills/__tests__/manifest-merge.test.ts`, `lib/skills/__tests__/pipelines.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // manifest-merge.ts
  export type LayeredBindings = Record<string /* "<engineRef>[/<blockPath>]" */, Record<string /* prop */, LayerValue[]>>;
  export type MergedManifest = { …existing…; layered: LayeredBindings; pipelineLayered: Record<string, LayeredBindings> };
  // pipelines.ts
  export function effectiveBindings(defaults: LayeredBindings, overrides: LayeredBindings | undefined, key: string): Record<string, LayerValue[]>;
  ```
- Rules: `mergeLayers` appends `{ layer: label, value }` per (key, prop) in layer order; `bindings` (today's last-wins map) stays derived from `layered` so existing readers keep working. `renderManifest` writes an `add` prop with several surviving values as a JSON array in layer order and a single value as a string; `""` writes `""`. The provenance comment per key stays. `readManifestBindings` accepts both shapes (string or string[]), returning `LayerValue[]` with the layer read from the provenance line.
- A version-1 manifest keeps loading: its `"mattstack:ship": { "domain": "x" }` key form is a valid v2 key with no block path, so no conversion step is needed here; refusing a v1 binding whose slot no longer exists is plan 2's job.

- [ ] **Step 1: Write the failing tests** (mergeLayers: two layers binding `"mattstack:ship/flow/fast-checks".rules` give `layered[...] = [{layer:"base:acme-base",…},{layer:"pack",…}]`; a `""` in the pack layer is kept as a value `""` so compile can see who cleared; `renderManifest` round-trips to the same `layered`; `effectiveBindings` overlays a pipeline's layered values after the top-level ones)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement; update the schema file; keep `bindings` derived**
- [ ] **Step 4: Run `bun test lib/skills/__tests__/manifest-merge.test.ts lib/skills/__tests__/pipelines.test.ts lib/skills/__tests__/sources.test.ts` → PASS**
- [ ] **Step 5: Commit: `skills manifest v2: layered bindings keyed by block and prop`**

---

### Task 6: Mermaid in, dot out

**Files:**
- Create: `lib/skills/blocks/mermaid.ts`, `lib/skills/blocks/dot.ts`
- Test: `lib/skills/blocks/__tests__/mermaid.test.ts`, `lib/skills/blocks/__tests__/dot.test.ts` (the dot test shells to `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py --short-ids` on a temp `.dot` file and skips when `dot` is not on PATH, the way `certify.sh` guards)

**Interfaces:**
- Produces:
  ```ts
  export function parseMermaid(source: string, file: string, fenceLine: number): BlockGraph; // throws BlockError
  export function graphOrder(graph: BlockGraph): string[]; // node ids by first appearance
  export function toDot(graph: BlockGraph, titles: Map<string /* node id */, string /* block title */>): string;
  export function parseDot(source: string): { nodes: { id: string; label: string; shape: string; style?: string; fillcolor?: string }[]; edges: { from: string; to: string; label: string | null }[] }; // for normalized diffs (plan 2) and the converter
  ```
- Grammar accepted (anything else is a diagnostic at that line): `flowchart TB` or `graph TB` header; node statements `id([label])`, `id{label}`, `id[label]`, `id[/label/]`, `id(((label)))`, bare `id`, optional `:::stop` or `:::done`; edges `a --> b`, `a -->|label| b`, `a -- label --> b`, with chains `a --> b --> c`; `%%` comments; blank lines. Labels may be `"quoted"`. A node first seen bare in an edge with no statement has `label: null`.
- `toDot`: `digraph <name> {`, `rankdir=TB;`, one node statement per node in first-appearance order with `label` (the block title when `label` is null; `label-disagrees` when both exist and differ) and `shape`, class attributes per the Global Constraints, then edges with `[label="…"]`, `}`. Labels escape `"` and `\`.

- [ ] **Step 1: Write the failing tests**

```ts
const src = `flowchart TB\n  run_open([Trigger: a ship run is open])\n  checks_pass{Checks pass (ship)?}\n  domain_fast_checks\n  git_push_upstream[/git_push {tree: <root>, setUpstream: true}/]\n  stop_shell_push[STOP: push only with git_push]:::stop\n  done(((Shipped))):::done\n  run_open --> domain_fast_checks --> checks_pass\n  checks_pass -->|yes| git_push_upstream\n  checks_pass -->|no| stop_shell_push\n  git_push_upstream --> done\n`;
test("parses shapes, classes, labels and chains", () => {
  const g = parseMermaid(src, "flow/index.block.md", 10);
  expect(g.nodes.find((n) => n.id === "run_open")).toMatchObject({ shape: "ellipse", label: "Trigger: a ship run is open" });
  expect(g.nodes.find((n) => n.id === "domain_fast_checks")!.label).toBeNull();
  expect(g.nodes.find((n) => n.id === "stop_shell_push")!.cls).toBe("stop");
  expect(g.edges).toContainEqual({ from: "run_open", to: "domain_fast_checks", label: null, line: 18 });
  expect(g.edges).toContainEqual({ from: "checks_pass", to: "git_push_upstream", label: "yes", line: 19 });
  expect(graphOrder(g)).toEqual(["run_open", "checks_pass", "domain_fast_checks", "git_push_upstream", "stop_shell_push", "done"]);
});
test("an unknown line is a diagnostic at its line", () => {
  expect(() => parseMermaid("flowchart TB\n  a ==> b\n", "f.block.md", 3)).toThrow(/f\.block\.md:5:3: /);
});
test("toDot fills a block node's label from its title and refuses a disagreeing one", () => {
  const g = parseMermaid(src, "f", 1);
  const dot = toDot(g, new Map([["domain_fast_checks", "Run the domain's fast checks"]]));
  expect(dot).toContain(`domain_fast_checks [label="Run the domain's fast checks" shape=box];`);
  expect(dot).toContain(`stop_shell_push [label="STOP: push only with git_push" shape=octagon style=filled fillcolor=red fontcolor=white];`);
  expect(dot).toContain(`checks_pass -> git_push_upstream [label="yes"];`);
  expect(() => toDot(g, new Map([["run_open", "Other"]]))).toThrow(/label-disagrees|disagrees/);
});
test("the dot passes check-dot --short-ids", () => { /* write toDot(...) to a temp .dot, spawn python3 check-dot.py --short-ids, expect exit 0; skip when `dot` is absent */ });
test("parseDot reads today's node statements and labelled edges", () => { /* feed ship's first three node lines and one edge */ });
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement `mermaid.ts` (line-by-line regex parser) and `dot.ts`** (Task 3, executed after this one, wires `parseMermaid` into `tree.ts`: a block's text with a ```` ```mermaid ```` fence sets `block.graph`; two fences in one block is a diagnostic)
- [ ] **Step 4: Run `bun test lib/skills/blocks` → PASS**
- [ ] **Step 5: Commit: `blocks: Mermaid parser and dot emitter`**

---

### Task 7: Order and graph binding

**Files:**
- Modify: `lib/skills/blocks/tree.ts`
- Test: `lib/skills/blocks/__tests__/order.test.ts`

**Interfaces:**
- Produces: `loadBlockTree` now returns children in final order; `Block.node` is checked against the parent's graph.
- Rules: a parent with a graph orders the children whose `node` is in the graph by `graphOrder`; a child with `node` not in the graph is `missing-node` (at the child's frontmatter `node:` line); `order` on such a child is `order-on-graph-child`. Children without `node` (or under a parent with no graph) sort by `order` ascending, then those without `order` by filename; two children with the same `order` is `duplicate-order` naming both files. A graph node whose id matches no child is fine (graph-only nodes).

- [ ] **Step 1: Write the failing tests** (the `mini` fixture: `run` and `gate` follow the graph; `notes` with `order: 2` and `guard` without come after, `notes` first; a temp tree where two siblings share `order: 1` throws naming both files; `order` on a graph child throws `order-on-graph-child`; a `node:` absent from the parent's graph throws `missing-node` with the child's file and line)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement in `tree.ts`**
- [ ] **Step 4: Run `bun test lib/skills/blocks` → PASS**
- [ ] **Step 5: Commit: `blocks: sibling order from the graph, then order, then filename`**

---

### Task 8: Render a tree to markdown

**Files:**
- Create: `lib/skills/blocks/render.ts`
- Modify: `lib/skills/drift.ts` (`MARKER_RE` accepts `block:<id>` and `prop:<id>.<name>` part kinds; `causeOf` maps `block:` to `source` and `prop:` to `fill`)
- Test: `lib/skills/blocks/__tests__/render.test.ts`, `lib/skills/__tests__/drift.test.ts`

**Interfaces:**
- Consumes: Task 3 tree, Task 4 `PropValue`, Task 6 `toDot`, `substituteIncludesOnly`-style include handling from `placeholders.ts`, `resolveFillTeamMarkers` and `skillDirFor`.
- Produces:
  ```ts
  export type IncludeResolver = (name: string, where: { file: string; line: number }) => BlockTree;
  export type RenderInput = { tree: BlockTree; values: Map<string /* block id */, Map<string /* prop */, PropValue>>; includes: IncludeResolver; ctx: PlaceholderContext; trace?: (entry: TraceEntry) => void };
  export function renderTree(input: RenderInput): { body: string; used: Used; packPaths: string[] };
  export function headingLevel(depth: number): number; // depth + 1, capped at 6
  ```
- Rules: walk preorder. For a titled block emit `<!-- part: block:<id> source=mattstack:<engine> version=<v> path=<relPath> lines=a-b -->`, then `#`×level + title, then its text with: each `{{props.x}}` replaced, per source in order, by `<!-- part: prop:<id>.<x> binding=<binding> version=<v> path=… lines=… -->` + the body for an `inline` source, or today's one-line `Slot x is bound to \`<binding>\` (<binding>@<v>) -- invoke that skill when this flow needs it.` reference (reworded `Prop x …`) for a `reference` source (nothing when there are none; a blank line between stacked values); each `{{include:x}}` (alone on its line, as today) replaced by the include tree rendered at `depth+1` (its own `block:` seams), except that an include root whose title equals the including block's title is rendered without its own heading and its children one level higher, so the title appears once; every other placeholder goes through `substituteLine` as today. Sub-headings inside the text (`#+` lines outside fences) are re-levelled to `level + their own depth` counted from the title line's single `#`. A headless block emits its text at the parent's level with sub-headings one below the parent's. A ```` ```mermaid ```` fence is replaced by a ```` ```dot ```` fence holding `toDot(graph, titles)`, where `titles` maps each child's `node` to its title. An include whose tree has any titled block must be the last non-blank content of the block's text (`text-after-include` at the first following line).
- `${CLAUDE_SKILL_DIR}` rewriting for fill bodies and allowed-tools follows today's `rewriteSkillDirRefs`/`skillDirFor` with `parts/<prop>` in place of `parts/<slot>`.

- [ ] **Step 1: Write the failing tests** (render the `mini` fixture with `rules` bound to a temp fill and `tiering` from its default: the body starts with the header comment then `# mini`, `## <run title>` carries `<!-- part: block:mini/run …`, the gate's `{{props.tiering}}` became a `prop:mini/gate.tiering` seam followed by the one-line reference to `mattstack:model-tiering` (the fixture registers it as public), while an internal default's body is inlined, the headless `guard` text appears at H2 level with no heading, the Mermaid fence became a ```` ```dot ```` fence; a block with `## sub` under its title renders as `### sub` at depth 1; an include with headings followed by text throws `text-after-include` at the file:line of that text; a heading-less include followed by text renders; a block titled "Gate protocol" whose text is `{{include:gp}}` with `gp`'s root titled "Gate protocol" renders `## Gate protocol` once with `gp`'s children at H3, and the same include under a block titled "Gates" renders `## Gates` then `### Gate protocol`)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement `render.ts`; extend `drift.ts`**
- [ ] **Step 4: Run `bun test lib/skills/blocks lib/skills/__tests__/drift.test.ts` → PASS**
- [ ] **Step 5: Commit: `blocks: render a tree to one markdown body with seams`**

---

### Task 9: `compileBlockSkill` and the loaders

**Files:**
- Modify: `lib/skills/compile.ts` (add `compileBlockSkill`), `lib/skills/sources.ts` (`loadStepSource` and `loadInclude` detect `index.block.md`), `lib/skills/types.ts` (`StepSource.tree?: BlockTree`, `AttachmentSource.tree?: BlockTree`, `CompileResult.diagnostics: BlockDiagnostic[]`)
- Modify: `commands/skills.ts` (`loadFillsFor` → `loadPropValuesFor` when `step.tree` is set; `compileVerb` routes to `compileBlockSkill`)
- Test: `lib/skills/__tests__/compile-blocks.test.ts`, extend `lib/skills/__tests__/compile-native.e2e.test.ts` with a `blocks` fixture pack

**Interfaces:**
- Produces:
  ```ts
  export type CompileSkillOpts = Parameters<typeof compileSkill>[4]; // today's inline opts type, given a name and exported
  export function compileBlockSkill(verb: VerbDef, step: StepSource & { tree: BlockTree }, values: Map<string, Map<string, PropValue>>, roster: Set<string>, opts: CompileSkillOpts): CompileResult;
  // sources.ts
  export function loadStepSource(engineName, roots): StepSource; // tree set when the engine dir holds index.block.md; body is "" then
  export function loadInclude(name, roots): AttachmentSource;   // tree set when attachments/<name>/index.block.md exists
  // commands/skills.ts
  function loadPropValuesFor(step, resolved, where, pipeline?): Map<string, Map<string, PropValue>>; // keys from effectiveBindings per block
  ```
- Rules: `compileBlockSkill` builds frontmatter as today (`name`, `description`, `allowed-tools` from the root frontmatter plus every value's allowed-tools, `metadata.compiled` listing `<plugin>@<v>` and every value binding), calls `renderTree`, then the same `lintReferences`/`lintInternalRoster`/vendoring as `compileSkill`. Vendored files of a per-file value land under `parts/<prop>/`. A binding whose key names a block not in the tree is `missing-block` (file = the manifest path, line from the manifest's key line); a prop the block does not declare is `unknown-prop` at the manifest line. Errors surface as `SkillsUsageError` whose message is the joined diagnostics; `CompileResult.diagnostics` carries them structured for `--json` and the language server.
- Fixture pack: `lib/skills/__tests__/fixtures/blocks/` gains `pack/` (a team pack `widgets` extending nothing, `pack/skills.jsonc` version 2 binding `"mattstack:mini".rules` to `widgets:mini-rules/fast` and `"mattstack:mini/gate".tiering` to `""`) and `mattstack-home/repos/my-repo/skills.jsonc`.

- [ ] **Step 1: Write the failing tests** (unit: `compileBlockSkill` on the `mini` tree returns a `SKILL.md` whose body contains `## ` headings at the right levels and no `{{`; the `""` on a replace prop with a `plugin:skill` default inlines the default's body; a binding to `mattstack:mini/nope` throws `/skills\.jsonc:\d+:\d+: .*block "mini\/nope"/`. e2e: `skillsCompile` on the blocks fixture writes `attachments/mini/SKILL.md`, `rt skills check` on it reports in-sync, editing the fill's file makes `check` report `fill` drift)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement; keep `compileSkill` untouched for slot engines**
- [ ] **Step 4: Run `bun test lib/skills commands/__tests__` → PASS (the whole skills suite, since loaders changed)**
- [ ] **Step 5: Commit: `compile: block-tree engines and includes beside slot engines`**

---

### Task 10: `rt skills blocks --json`

**Files:**
- Create: `lib/skills/blocks/payload.ts`
- Modify: `commands/skills.ts` (`skillsBlocks`), `lib/command-tree-def.ts` (verb `blocks` under `skills`, description "Show one skill as its tree of blocks, with each layer's text", args Pack, Skill, Manifest, Repo, `SETUP_JSON_ARG`)
- Test: `lib/skills/blocks/__tests__/payload.test.ts`, `commands/__tests__/skills-blocks-json.test.ts` (frozen `--json` shape, per `.claude/rules/output-layer.md`)

**Interfaces:**
- Produces:
  ```ts
  export type BlocksPayload = {
    pack: string; skill: string; kind: "verb" | "stage"; engineRef: string; dir: string;
    layers: { name: string; label: string; color: "mattstack" | "org" | "team" }[]; // mattstack, then base when extends, then pack
    blocks: PayloadBlock[]; // preorder
    graphs: { blockId: string; nodes: (GraphNode & { blockId: string | null })[]; edges: GraphEdge[] }[];
    includes: { name: string; blockId: string }[];
    lines: { layer: string; count: number }[]; // whole-skill totals; mermaid lines count as mattstack
  };
  export type PayloadBlock = {
    id: string; parentId: string | null; depth: number; title: string | null; label: string; kind: "step" | "question" | "gate" | "note" | "shared"; path: string; relPath: string; lines: [number, number];
    summary: string; // first sentence of the rendered text
    text: string;    // the block's own rendered markdown, prop values inlined, dot fences as mermaid
    props: { name: string; merge: "add" | "replace"; default: string | null; contract: string | null; marker: { line: number; col: number } | null; values: { layer: string; binding: string; path: string; lines: number }[]; fromDefault: boolean }[];
    node: string | null; order: number | null; headless: boolean;
    renderedLines: [number, number] | null; // in the compiled SKILL.md
  };
  export function buildBlocksPayload(input: { tree: BlockTree; values: …; graphs: …; compiled: string; base: string | null; pack: string }): BlocksPayload;
  ```
- `kind`: `gate` from frontmatter; `question` when the block's node is a diamond; `shared` for a block that came from an include; `note` for a block with no node under a parent without a graph; else `step`.
- The verb resolves the pack and skill the way `skillsAnatomy` does and prints the payload under `--json`; without `--json` it prints `out.tree` of labels with a kind glyph per row.

- [ ] **Step 1: Write the failing tests** (payload on the `mini` fixture: block count, kinds, `lines` per layer, `summary` is the first sentence; `--json` byte-frozen snapshot with empty stderr)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS; `bun run check` for the command-tree conformance gates**
- [ ] **Step 5: Commit: `rt skills blocks: one skill's block tree as JSON`**

---

### Task 11: Prop signature check in CI

**Files:**
- Create: `lib/skills/blocks/signature.ts`, `scripts/ci/props-signature-check.ts`
- Test: `lib/skills/blocks/__tests__/signature.test.ts`, `scripts/__tests__/props-signature-check.test.ts`
- Modify: `.github/workflows/checks.yml` (a step in the `plugin-mattstack` job after "Engine floor", `if: github.event_name == 'pull_request'`, env `PR_BODY`)

**Interfaces:**
- Produces:
  ```ts
  export type Signature = Record<string /* "<engine>/<block>" */, Record<string /* prop */, { merge: "add" | "replace"; required: boolean; contract: string | null }>>;
  export function signatureOf(engineDirs: { engine: string; dir: string }[]): Signature;
  export type BreakingChange = { key: string /* "<engine>/<block>.<prop>" */; what: "removed" | "newly-required" | "merge-flipped" | "contract-changed" };
  export function breakingChanges(before: Signature, after: Signature): BreakingChange[];
  export function checkPropsSignature(input: { changes: BreakingChange[]; prBody: string }): string[]; // errors; a `props-change: <key>: <text>` line per change waives it
  ```
- The script: finds the last release tag (`git describe --tags --abbrev=0 --match 'v*' HEAD^1`), extracts `plugins/mattstack/attachments` and `plugins/mattstack/skills` at that tag into a temp dir with `git archive`, builds both signatures (engines = every dir holding `index.block.md` with `type: pipeline-step`; includes count too, keyed by their include name), prints each unwaived change and exits 1. A prop rename shows as `removed` plus a `newly-required` or nothing; a block rename shows as `removed` for every prop under the old id, since the key carries the block path. Both are what the spec asks.

- [ ] **Step 1: Write the failing tests** (`breakingChanges`: removed prop, new required prop, add→replace flip, contract `@1`→`@2`; a new optional prop is not breaking; `checkPropsSignature` passes with a `props-change: ship/flow/fast-checks.rules: renamed to checks` line and fails without, with the message telling the author to edit the PR body then push a commit, as the engine-floor check does)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement the module and the script; add the workflow step**
- [ ] **Step 4: Run `bun test lib/skills/blocks scripts/__tests__/props-signature-check.test.ts` → PASS**
- [ ] **Step 5: Commit: `ci: props signature check against the last release tag`**

---

### Task 12: Expand and the board launchers

**Files:**
- Modify: `lib/skills/expand.ts` (an include whose attachment is a block tree renders through Task 8's `renderTree` at the level below the nearest heading above the `{{include}}` line, with that heading's text passed as the including title so Task 8's repeated-title rule applies unchanged)
- Test: `lib/skills/__tests__/expand.test.ts`

- [ ] **Step 1: Write the failing test** (a hand-written `SKILL.md` with `## Gate protocol` then `{{include:gp}}` where `gp` is a block tree whose root title is "Gate protocol" and one child: the expanded text has `## Gate protocol` once and the child at H3; under `## Gates` the root renders at H3 and the child at H4; the `EXPAND_HEADER` and `metadata.compiled` stamp are unchanged)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run `bun test lib/skills/__tests__/expand.test.ts` → PASS**
- [ ] **Step 5: Commit: `expand: block-tree includes keep the launcher's outline`**

---

## Self-review notes

- Spec coverage: Files, A block file, Placeholders (Task 2, 8), Fills and bindings (4, 5, 9), Prop signature check (11), Order (7), Graphs (6, 7), Includes (8, 9, 12), Compile (8, 9), Language server's diagnostics shape (1). Testing and Rollout are plan 2; Console is plan 3; the server itself is plan 4.
- Not in this plan on purpose: removing `{{slot:x}}` and the `slots:` frontmatter, and the `old-slot-binding` refusal. They land in plan 2 once every engine has converted, so this plan's suite stays green against today's engines.
- Interpretations made here (also reported to the spec's author): the `add` merge needs both layers' values in the generated manifest, so a multi-value prop renders as a JSON array (Task 5); a root-level prop binds under the bare engine ref (`"mattstack:ship"`), which keeps v1 keys valid v2 keys; graph-only nodes with a `### ` section today become blocks only when the converter (plan 2) finds prose for them.
- Task order: Task 6 (Mermaid) is written before Task 3 (tree) is wired to it, so execute Tasks 1, 2, 6, 3, 4, 5, 7, 8, 9, 10, 11, 12; Task 3 then imports `parseMermaid` directly with no stub.
