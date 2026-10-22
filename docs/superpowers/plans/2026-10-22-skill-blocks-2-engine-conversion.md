# Skill blocks, plan 2 of 4: converting every engine and include

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mattstack engine and shared include becomes a block tree in one release, `ship` proven with a before-and-after agent test and every other engine with a normalized diff of its compiled output, after which `{{slot:x}}` is gone and an old binding is refused with the engine's props named.

**Architecture:** A converter script splits a `SKILL.md` on its headings into `*.block.md` files, turns each ```` ```dot ```` block into Mermaid, ties `### <node text>` sections to their nodes, sets `order` to keep today's section order, and rewrites `{{slot:x}}` into a prop. A diff script compiles an engine before and after and prints what is left once heading levels, slot→prop moves, dot formatting and the include-trailing-text moves are normalized away. The CI job learns to certify block folders and to run `check-dot` on compiled output, since a Mermaid source has no ```` ```dot ```` fence of its own.

**Tech Stack:** Bun scripts under `scripts/blocks/`, plan 1's `lib/skills/blocks/`, graphviz and `check-dot.py` in CI, superpowers:writing-skills for the `ship` test.

**Spec:** `docs/superpowers/specs/2026-10-22-skill-blocks-design.md` (Decisions 2, 12, 13; "Testing", "Includes", "Rollout of the two team packs", "Non-goals").

Depends on plan 1 (`2026-10-22-skill-blocks-1-compiler.md`): `loadBlockTree`, `parseDot`, `toDot`, `renderTree`, `compileBlockSkill`, the v2 manifest.

## Global Constraints

- Every engine and include converts in one release: no shipped engine stays a slot engine once the plugin version bumps (Decision 12).
- Decompose by headings: a `## ` or `### ` section that stands on its own becomes a block; a graph node with prose (today's `### <node text>` section) always does; a `### ` section that is not a node keeps its heading inside its parent block when it is short and bound to the prose around it, else becomes a note block. Keep a cohesive chunk together where splitting hurts (Decision 2).
- Slots map to props: `domain` → a `rules` prop (`merge: add`, `default: ""`) on each block a domain fill targets today; `tiering`, `forge`, `reviewer`, `criteria`, `strategy`, `accounts`, `reply-rules` → a prop of the same name (`merge: replace`, today's mattstack default as `default`, today's contract as `contract`; `required: true` today → no `default`).
- The compiled dot keeps every node id and edge; `check-dot.py --short-ids` passes on the compiled `SKILL.md`.
- Expected differences per engine, and nothing else: heading levels; a pack's text moving from the old slot section into its block; dot formatting after normalization; in `review`, `self-review` and `receive-review`, trailing text after a heading-carrying include moving into its own block with a new heading; a prop bound to a registered skill now inlined where it used to render as a one-line reference (see Interpretations).
- The plugin keeps its own style: no rt formatter on `plugins/mattstack`; its version bumps in the same PR; `CERTIFICATION.md` stays the written rule certify enforces.
- Skill text edits (`editing-skills`, `extending-a-pack`, `process-digraphs`) go through superpowers:writing-skills, per `~/.claude/rules/skill-writing.md`.
- Ticket ids never appear in plugin content (certify's `no-ticket-ids`).

## Review Focus

1. A `### ` section whose text matches a node label except for trailing ` (ship)`-style disambiguators: the converter must tie it to the node, not emit a note block plus an unlabelled node. (Task 1 tests a disambiguated label.)
2. A dot node declared with a `\n` in its label or a `"` inside: Mermaid output must round-trip through `toDot` to the same label. (Task 1.)
3. An engine whose `{{slot:domain}}` sits under a heading that `emptySlotAfter` drops today when unbound: the converted block must render no empty heading when the prop is empty. (Task 2 tests `ship`'s "Domain rules" with no value.)
4. A team pack still on manifest v1 after the engines convert: `rt skills compile` must refuse with the engine named and its props listed, never compile with the fill silently dropped. (Task 7.)
5. The board launcher skills (`apps/board/skills-src`) after `gate-protocol` converts: `bun run skills:check:board` must still pass, or the always-run guard fails main. (Task 5.)

---

## Interpretations

- The spec says "A value is always inlined". Today a prop value bound to a registered public skill (`mattstack:model-tiering` on `tiering`) renders as a one-line reference. Inlining it changes `shepherdr`'s and the review engines' compiled text beyond the four listed differences. This plan treats that as a fifth expected difference and the diff script normalizes it; the spec's author has been told.
- The converter is a committed script run once per engine, then reviewed by hand (Decision 2 wants judgment on cohesion, which the script cannot supply). The script's output is the starting point, not the result.

---

### Task 1: The converter

**Files:**
- Create: `scripts/blocks/convert-skill.ts`, `scripts/blocks/lib/split.ts`, `scripts/blocks/lib/dot-to-mermaid.ts`
- Test: `scripts/__tests__/blocks-convert.test.ts` (fixture: a 60-line slice of today's `ship` with Run's first four nodes, two `### ` sections, `{{slot:domain}}` under `## Domain rules`, and the four trailing includes)

**Interfaces:**
- Consumes: plan 1 `parseDot`, `toDot`, `parseMermaid`, `loadBlockTree`.
- Produces:
  ```ts
  export type SlotMap = Record<string, { prop: string; merge: "add" | "replace"; targets?: string[] /* block ids for add; omitted = the slot's own section becomes the block */ }>;
  export function splitSkill(raw: string, opts: { engine: string; slots: SlotMap }): { files: Record<string /* rel path */, string>; notes: string[] };
  export function dotToMermaid(dot: string): { mermaid: string; nodeIds: string[] };
  // CLI: bun scripts/blocks/convert-skill.ts <skill dir> [--out <dir>] [--slot domain=rules:add] [--write]
  ```
- Rules for `splitSkill`: the root `index.block.md` keeps the engine frontmatter minus `slots:`; `## ` sections become child blocks (folder when they hold `### ` sections that are nodes, else a leaf); each `### ` section whose text equals a node label, or equals it minus a trailing parenthetical, becomes a child block with `node:` set and `label` = the id tail in plain words; other `### ` sections stay as sub-headings in their parent; a ```` ```dot ```` fence becomes a ```` ```mermaid ```` fence in the parent's `index.block.md`; node statements for blocks omit their label; `order` is set on every non-graph child from its position; `{{slot:x}}` becomes `{{props.<prop>}}` and the root's `props:` (for `add` with `targets`, the marker is placed at the end of each target block's text instead and the old section is dropped); `{{include:x}}` lines stay; a `## X` section that is only `{{include:x}}` becomes a block whose text is the include line (the include's own root title is dropped by `renderTree` when it equals the enclosing title, see plan 1 Task 12). `notes` lists every judgment call it made (a section it could not tie to a node, a label it rewrote).
- `dotToMermaid`: `[label=".." shape=box]` → `id[label]`; shapes per plan 1's table; octagon with the red fill → `:::stop`; the green doublecircle → `:::done`; edges with `[label=".."]` → `-->|label|`; labels containing `|`, `[`, `]`, `{`, `}`, `(`, `)` or `"` are quoted.

- [ ] **Step 1: Write the failing tests** (`splitSkill` on the fixture: files `index.block.md`, `run/index.block.md`, `run/<node>.block.md` for each `### ` node section, `domain-rules.block.md` carrying `{{props.rules}}`, `browser-evidence.block.md` holding `{{include:browser-evidence}}`; the root frontmatter has no `slots:` and has `props: { rules: … }`; a `### Find the shipped run (ship)` section ties to `find_shipped_run`; `dotToMermaid` round-trips: `toDot(parseMermaid(dotToMermaid(d).mermaid), titles)` parses with `parseDot` to the same node ids, shapes and edges as `parseDot(d)`, including a label with an escaped quote)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement the two libs and the CLI**
- [ ] **Step 4: Run `bun test scripts/__tests__/blocks-convert.test.ts` → PASS**
- [ ] **Step 5: Commit: `scripts/blocks: convert a SKILL.md engine into a block tree`**

---

### Task 2: The normalized diff

**Files:**
- Create: `scripts/blocks/compiled-diff.ts`, `scripts/blocks/lib/normalize.ts`
- Test: `scripts/__tests__/blocks-diff.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizeCompiled(md: string): string; // strips seams and the header comment, lowers every heading to "#", replaces each ```dot block by a canonical listing (sorted "id|label|shape|style" lines then sorted "from|to|label" lines), collapses runs of blank lines, drops the one-line "Slot x is bound to `plugin:skill` … invoke that skill" reference lines
  export function residualDiff(before: string, after: string, opts: { allowMovedBlocks: string[] /* headings whose text may move */ }): string; // unified diff of the normalized texts after moving allowed blocks; "" when clean
  // CLI: bun scripts/blocks/compiled-diff.ts --verb <name> --before <compiled SKILL.md> --after <compiled SKILL.md> [--allow-move "<heading>"]
  ```

- [ ] **Step 1: Write the failing tests** (two compiled bodies differing only in heading levels and dot whitespace give `""`; a changed sentence survives; a slot's text that moved from `## Domain rules` into `### Fast checks` is clean when `--allow-move` names it; an inlined tiering body where a reference line stood is clean; the `ship` "Domain rules" heading with no value present on both sides is clean, and a side with an empty `## Domain rules` heading the other lacks is not)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `scripts/blocks: normalized diff of compiled output`**

---

### Task 3: Convert the includes

**Files:**
- Modify (convert): `plugins/mattstack/attachments/{gate-protocol,browser-evidence,evidence-record,run-identity,spawned-no-run-guard,wrap-up-form,writing-style-floor,writing-style-lookup,review-core-body,review-core-body-after,review-core-body-tail,review-dispatch-body,review-dispatch-body-after,review-posting,work-next-gate,execution-strategy}/` from `SKILL.md` to `index.block.md` (+ children where the include has `## ` sections)
- Modify: `plugins/mattstack/tests/certify.sh` (a dir whose `index.block.md` exists is certified from that file: the `fm-open`, frontmatter and purity checks read it; the digraph gate is skipped for a block dir, since Mermaid is checked at compile)

- [ ] **Step 1: Run the converter on every include dir with `--write`; read each `notes` line and settle it by hand** (a heading-less include such as `spawned-no-run-guard` becomes a single headless `index.block.md`)
- [ ] **Step 2: For each include, run `bun cli.ts skills compile --preview --verb <an engine that includes it> --pack-dir plugins/mattstack --mattstack-dir <tmp>` before (git stash is forbidden: use `git worktree add <tmp> HEAD` for the before tree) and after, and `bun scripts/blocks/compiled-diff.ts` on the pair; expected `""`**
- [ ] **Step 3: Extend `certify.sh`; run `sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/gate-protocol` → `ok` lines, exit 0**
- [ ] **Step 4: Run `bun run skills:check:board`** (the launcher skills expand `gate-protocol` three times) → exit 0
- [ ] **Step 5: Commit per include group: `mattstack: gate-protocol as a block tree`, then the review bodies, then the rest**

---

### Task 4: Convert `ship` and prove it

**Files:**
- Modify (convert): `plugins/mattstack/attachments/pipeline/ship/` → `index.block.md`, `run/`, `flow/`, note blocks; `plugins/mattstack/pack/skills.jsonc` stays at the mattstack pack (it binds nothing on `ship`)
- Test record: `plugins/mattstack/docs/superpowers/tests/2026-10-2X-ship-blocks/` (the writing-skills before/after record: scenarios, transcripts summary, verdict)

- [ ] **Step 1: Run the converter with `--slot domain=rules:add` and targets = the step blocks a real domain fill's `## At: <step>` sections name today (read the two team packs' domain fills for the list; the spec's boards list them: domain steps, fast checks, commit named, write title, and the rest)**
- [ ] **Step 2: Read every block by hand against Decision 2: merge back a `### ` that split a cohesive chunk; confirm each `node:` and that `run/index.block.md` and `flow/index.block.md` carry one Mermaid graph each**
- [ ] **Step 3: Compile and diff: `compiled-diff.ts --verb ship` with `--allow-move "Domain rules"`; expected `""`. Run `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py --short-ids <compiled SKILL.md>` → `ok`**
- [ ] **Step 4: Before-and-after test with fresh agents, following superpowers:writing-skills: the same three scenarios (a clean ship, a ship with failing fast checks and a fix round, a ship whose push is refused) against today's compiled `ship` and the block-compiled one, in a scratch pack with a domain fill that targets `fast-checks` and `commit-named`; record the transcripts' decisions and the verdict in the test record dir**
- [ ] **Step 5: Commit: `mattstack: ship as a block tree` and `mattstack: ship before-and-after test record`**

---

### Task 5: Convert every other engine

**Files:**
- Modify (convert): every dir under `plugins/mattstack/attachments/` whose `SKILL.md` is `type: pipeline-step` (the pipeline stages, `work`, `watch-ci`, the review verbs, the forge adapters, `shepherdr`, `orchestration`, `cswap-accounts` and the rest the loader finds), and `plugins/mattstack/skills/review/*` engines
- Modify: `plugins/mattstack/pack/skills.jsonc` → version 2, defaults removed (they live on the props now); `plugins/mattstack/plugin/examples/skills.jsonc` → version 2 example with one `add` and one `replace` binding and one `""`

- [ ] **Step 1: Convert in groups, each group one commit: stages (`stage-*`, `work`), review (`review`, `self-review`, `receive-review` with the seven include sites' trailing text moved into a block right after the include's block, titled from its first sentence), forge adapters, `shepherdr` with `tiering`/`strategy`/`accounts` as `replace` props carrying today's defaults, `watch-ci` with `forge` and `domain`**
- [ ] **Step 2: For each engine: `compiled-diff.ts` against the before worktree; expected `""` after `--allow-move` for its slot sections and the three review engines' moved trailing text. Paste each residual (expected `""`) into the group's commit message**
- [ ] **Step 3: `bun cli.ts skills check --pack-dir plugins/mattstack --mattstack-dir <tmp> --strict` → exit 0; `bun cli.ts skills compile --dry-run …` → exit 0**
- [ ] **Step 4: Run `bun test lib/skills commands` → PASS (fixtures that still carry slot engines are converted in Task 6, so any failure here is a conversion defect)**
- [ ] **Step 5: Commit per group as named in Step 1**

---

### Task 6: Remove slots

**Files:**
- Modify: `lib/skills/placeholders.ts` (drop the `slot` case and `emptySlotAfter`), `lib/skills/compile.ts` (drop `compileSkill`'s slot path: `resolveBoundSlots`, `BoundSlot`, `isInlined`, `slotMode`; `compileBlockSkill` becomes `compileSkill`), `lib/skills/types.ts` (`SlotSpec`, `StepSource.slots`, `PlaceholderContext.fills`/`slotMode` go), `lib/skills/sources.ts` (`parseSlots`, the `slots:` reads; `loadStepSource` requires `index.block.md`), `commands/skills.ts` (`rt skills bind <verb> <slot> <fill>` becomes `rt skills bind <verb> <block path> <prop> <fill>`; composition's `slots` become `props` keyed by block), `lib/command-tree-def.ts` (bind's args and descriptions), `lib/skills/anatomy.ts` (`slot` part kind → `prop`)
- Modify fixtures: `lib/skills/__tests__/fixtures/compile-native`, `compile-pipelines`, `browser-target` → block trees and v2 manifests; `apps/console` fixtures stay (plan 3 replaces them)
- Test: the whole `lib/skills` and `commands/__tests__` suites

- [ ] **Step 1: Convert the fixtures with the converter; update every test literal that built a `StepSource` with `slots`**
- [ ] **Step 2: Remove the slot code paths; add the refusal: a binding key whose prop is not declared and whose name matches a slot the engine used to declare is `old-slot-binding` with the message `"<engine ref>" no longer has slot "<x>"; its props are: <block>.<prop> (<merge>), …` (the engine root frontmatter carries `replaced-slots: [domain, …]` so compile knows the old names; the converter writes that list)**
- [ ] **Step 3: Write the failing test for the refusal in `lib/skills/__tests__/compile-blocks.test.ts` (a v1-shaped binding `"mattstack:ship": { "domain": "w:x" }` throws with `ship/flow/fast-checks.rules (add)` in the message), run it → FAIL, implement, run → PASS**
- [ ] **Step 4: Run `bun test lib/skills commands scripts` → PASS; `bun run check` → PASS**
- [ ] **Step 5: Commit: `skills: props replace slots; refuse old slot bindings naming the engine's props`**

---

### Task 7: CI for block engines

**Files:**
- Modify: `.github/workflows/checks.yml` (`plugin-mattstack` job: the "Every plugin digraph passes check-dot" step now runs `check-dot.py --short-ids` over `**/*.md` that still carry ```` ```dot ```` fences (docs test records) and, new, over every `SKILL.md` a real compile writes into a temp pack copy: `cp -R plugins/mattstack "$RUNNER_TEMP/pack" && bun cli.ts skills compile --pack-dir "$RUNNER_TEMP/pack" --mattstack-dir "$RUNNER_TEMP/mattstack"` then `find "$RUNNER_TEMP/pack" -name SKILL.md -path '*/attachments/*' -o -path '*/skills/*'` piped to the checker; the certify loop adds `attachments/*/*/` dirs holding `index.block.md`)
- Modify: `scripts/ci/test-scope.ts` only if the plugin job's trigger paths need `*.block.md` (check `docs/ci.md`'s table first; add the glob when the job keys on `SKILL.md`)
- Test: `scripts/__tests__/no-plugin-ci-jobs.test.ts` keeps passing

- [ ] **Step 1: Edit the workflow; run the new steps locally with `act` unavailable, so run their shell lines by hand from the repo root with `RUNNER_TEMP=$(mktemp -d)` → each exits 0**
- [ ] **Step 2: `bun test scripts/__tests__/no-plugin-ci-jobs.test.ts scripts/__tests__/test-scope*.test.ts` → PASS**
- [ ] **Step 3: Commit: `ci: check-dot on compiled engines; certify block folders`**

---

### Task 8: Docs and skills

**Files:**
- Modify (via superpowers:writing-skills): `plugins/mattstack/skills/editing-skills/SKILL.md` (block files, props, where a fix goes), `plugins/mattstack/skills/extending-a-pack/SKILL.md` (bind a prop: `rt skills bind <verb> <block path> <prop> <fill>`, per-file values, `""` to clear), `plugins/mattstack/plugin/skills/process-digraphs/SKILL.md` (author graphs in Mermaid; the `### <node text>` rule becomes "one block per judgment node, `node:` set"; `check-dot` runs on compiled output), `plugins/mattstack/skills/creating-a-pack/SKILL.md` (manifest v2 example)
- Modify: `docs/skills.md` or the rt docs the `rt:docs` skill names for `rt skills bind`, `rt skills blocks`; `plugins/mattstack/CERTIFICATION.md` (block folders); `plugins/mattstack/README.md` layout section
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` version bump; `plugins/mattstack/pack/requires.json` `minEngine` to the rt version that ships plan 1 (a block engine cannot compile on an older rt), with the `engine-floor:` PR line

- [ ] **Step 1: For each skill, follow writing-skills (RED baseline against a fresh agent, the edit, GREEN) and record it in `plugins/mattstack/docs/superpowers/tests/`**
- [ ] **Step 2: `sh plugins/mattstack/tests/certify.sh <each edited skill dir>` → exit 0**
- [ ] **Step 3: Commit: `mattstack: skills and docs for block engines` and `mattstack: plugin 0.<next>, minEngine <rt version>`**

---

### Task 9: Rollout of the two team packs

Out of scope for code (Non-goals). What this task does is the handoff:

- [ ] **Step 1: In each of the two team packs' repos, run `rt skills compile` on the new rt: expected the `old-slot-binding` refusal naming the engine and its props**
- [ ] **Step 2: Convert each pack by hand with Claude: split the domain fill's `## At: <step>` sections into per-file values beside a frontmatter-only `SKILL.md`, rebind under v2 keys, `rt skills compile` clean, `rt skills check --strict` clean**
- [ ] **Step 3: Note in `RELEASE_NOTES.md` the manual conversion and the refusal text a pack author sees**

---

## Self-review notes

- Spec coverage: Decision 12 (Tasks 3-5), Decision 13 and "Testing" (Tasks 2, 4, 5), "Includes" trailing text (Task 5), "Rollout" and the refusal (Tasks 6, 9), slot removal implied by the Placeholders table (Task 6), CI for `check-dot` on compiled dot (Task 7), skills that teach the new model (Task 8).
- The `rt skills bind` signature change is not in the spec (it only retires console's Rebind panel). The CLI verb keeps working keyed by block and prop; the spec's author has been told.
