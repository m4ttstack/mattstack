# Skill pointers that resolve by id: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pointer in a skill rt writes becomes an `@key`, and one `skills_resolve` call per started skill returns the absolute path for every key reachable from it. Skills rt writes are compiled packs, the mattstack plugin's compiled skills and the board's expanded skills.

**Architecture:**
- Compile and expand keep rendering pointers as they do today. Then one pure pass (`lib/skills/pointers.ts`) turns each `${CLAUDE_SKILL_DIR}/<path>` and each file-relative verb path in a written `.md` into `@<unit>/<path>`, and records each target as a plugin-relative path.
- A post-pass in `performCompile` builds each unit's closure: its own targets plus those of every unit it reads by path. That closure, with `covers`, goes into the unit's `compiled.json`.
- `rt skills resolve <id>`, and the MCP tool `skills_resolve` running the same code in process, find the installed copy for the exact version. They spell each path from the skill's folder the way `allowed-tools` spells it.

**Tech Stack:** Bun, TypeScript, `bun test`, the rt command tree, the mattstack MCP server.

**Spec:** `docs/superpowers/specs/2026-10-24-skill-pointer-resolve-design.md` (approved 2026-10-24). Parent epic spec: `docs/superpowers/specs/2026-10-22-skill-blocks-design.md`.

## Global Constraints

- **Names.** Public repo: invented names only (acme, widgets, gadgets) in code, tests, fixtures, docs and commit messages. Run `bun run purity` before every commit. No "engine" in person-read prose (refusals, docs, skill text); identifiers keep their names.
- **Output.** Everything rt prints goes through `lib/ui/out.ts`. A refusal is a `UserActionableError` (`lib/errors.ts`) with a plain sentence, `why` and `next` (`.claude/rules/output-layer.md`). `rt skills check --json` is frozen: a new array key appears only when non-empty.
- **The MCP tool.** It reads only `~/.claude/plugins/cache` and `~/.claude/skills`, with HOME taken from the server's env. It takes only an id matched against `ID_RE`, writes nothing, and returns through `callTool`'s redaction (`.claude/rules/mcp-and-gates.md`).
- **Untouched.** `allowed-tools` frontmatter keeps `${CLAUDE_SKILL_DIR}` everywhere, byte for byte. Hand-written skills are not touched.
- **Units.** A unit is named by its leaf folder name (`work`, `stage-plan`, `board-respond`, the leaf of a grouped base copy `attachments/<group>/<leaf>`). Compile already refuses two units sharing a leaf.
- **Path spelling.** Every path is spelled from the started unit's folder the way `allowed-tools` spells it:
  - a target inside the unit is `<folder>/<path>`;
  - any other target is `<folder>/` + one `../` per folder level of the unit's own folder (2 for `skills/x` and `attachments/x`, 3 for `attachments/g/x`) + its plugin-relative path, so `../../skills/stage-x/...` for a public stage, and never folded.
- **Version.** The plugin version stays one past main's (`plugins/mattstack/.claude-plugin/plugin.json`, 0.32.28 while main is 0.32.27), and `plugins/mattstack/pack/requires.json` minEngine equals it. Every version bump is followed by a recompile, because an id's stamp is not masked (Matt's ruling, 2026-10-24).
- **Opening line**, verbatim, with `<id>` filled in:
  > Pointers here are `@keys`. Resolve them once per run: if you already hold a `skills_resolve` map that covers `<id>`, use it; otherwise call `skills_resolve {id: "<id>"}` and use the path it returns for each key. If it fails, stop and say so; never look for the file another way.
- **Safety.** Run `bun test` from the repo root only. Built binaries only under `env -i HOME=<temp>`. Never touch the real `~/.mattstack` or `~/.claude`.
- **Skill edits** load superpowers:writing-skills and mattstack:editing-skills first.

## Review Focus

1. A pack whose `plugin.json` was bumped after its last compile: check reports it out of date, and resolve of the old id refuses naming the versions it found.
2. A fenced shell command (`bash "${CLAUDE_SKILL_DIR}/scripts/x.sh"`) becomes a key like any other pointer. A prose sentence that explains the token itself is rewritten at its source, never keyed.
3. The same reference file copied into two units of one closure (`stage-gates/references/widget-gates/` and `watch-ci/references/widget-gates/`) gets two keys and two paths.
4. A `~/.claude/skills/<name>` link whose target is gone: resolve refuses naming the link.
5. An npm scoped name in a pack's prose (`@mantine/core`, `@acme/ui`) is not a key and never fails check.

Each line's test sits in the task that owns the code (Tasks 1 to 3).

---

### Task 1: The pointer pass and the map (headless)

**Files:**
- Create: `lib/skills/pointers.ts`
- Test: `lib/skills/__tests__/pointers.test.ts`

**Interfaces:**
- Produces:
  - `type Target = string | { skill: string; path: string }`: a plugin-relative file path (`attachments/stage-plan/parts/d/x.sh`), or a sibling skill under `~/.claude/skills`.
  - `type UnitTable = Record<string, string>`: unit leaf name to its plugin-relative folder (`"stage-plan": "attachments/stage-plan"`, `"widget": "attachments/tools/widget"`).
  - `type PointerMap = { id: string; dir: string; covers: string[]; keys: Record<string, Target> }`: `dir` is the unit's plugin-relative folder, and `covers` lists every unit id in the closure, its own first.
  - `const ID_RE: RegExp`, matching either:
    - `<plugin>@<version>:<unit>`, where plugin and unit are `[a-z0-9][a-z0-9-]*` and the version is dotted numeric;
    - `skills:<name>`, where the name is `[a-z0-9][a-z0-9:-]*`.
  - `unitId(plugin: string, version: string, unit: string): string` and `skillsId(name: string): string`.
  - `keyBody(text: string, at: { dir: string; fileRel: string; units: UnitTable }): { text: string; targets: Record<string, Target> }`.
    - What it converts: every `${CLAUDE_SKILL_DIR}/<path>` (fences included, frontmatter excluded), and every file-relative verb path, into `@<unit>/<rest>`.
    - Reading the token: it treats `${CLAUDE_SKILL_DIR}` as `at.dir` when `at.dir` is under `skills/`. Otherwise it reads it as any `skills/<x>` folder, since every internal-unit token carries `../../`. It normalises to a plugin-relative path, then splits it into a unit of `units` and the rest.
    - Anchoring: `fileRel` is the file's path inside the unit (`SKILL.md`, `references/x/SKILL.md`), so file-relative paths anchor at that file.
    - Failure: a path that leaves the plugin, or names no unit, is left as written for check to report.
  - `isKey(token: string, units: UnitTable): boolean`: true only for `@<u>/...` where `u` is a key of `units`.
  - `spellFrom(dir: string, target: string): string` is the Global Constraints spelling, relative to `dir` (`scripts/x.sh` inside; `../../attachments/stage-plan/parts/d/x.sh` from `skills/work`).
  - `openingLine(id: string): string` is the Global Constraints line with `<id>` filled in.
  - `closeMap(own: PointerMap, reached: PointerMap[]): PointerMap` merges keys and `covers`. It throws on one key with two different targets.
  - `leftoverTokens(text: string): { line: number; col: number }[]` finds `${CLAUDE_SKILL_DIR}` outside frontmatter.

- [ ] **Step 1: Write the failing tests** in `pointers.test.ts`. Use `units = { "receive-review": "attachments/receive-review", "stage-plan": "attachments/stage-plan", "stage-x": "skills/stage-x", "work": "skills/work", "widget": "attachments/tools/widget" }`.
  - **Scripts:** `Run \`bash "${CLAUDE_SKILL_DIR}/../../attachments/receive-review/scripts/gate-ctx.sh"\`` in `attachments/receive-review/SKILL.md` gives `Run \`bash "@receive-review/scripts/gate-ctx.sh"\`` and target `attachments/receive-review/scripts/gate-ctx.sh`. The same inside a fenced block converts too (Review Focus 2).
  - **Units:** `${CLAUDE_SKILL_DIR}/scripts/x.sh` in `skills/work/SKILL.md` gives `@work/scripts/x.sh`. `${CLAUDE_SKILL_DIR}/../../skills/stage-x/parts/d/y.sh` gives `@stage-x/parts/d/y.sh`. A grouped `${CLAUDE_SKILL_DIR}/../../attachments/tools/widget/SKILL.md` gives `@widget/SKILL.md`.
  - **Verb paths:** a file-relative `../receive-review/SKILL.md` in `attachments/board-respond/SKILL.md` gives `@receive-review/SKILL.md`. A pointer in `references/widget-gates/SKILL.md` anchors at that file's folder.
  - **Spelling:** `spellFrom("skills/work", "attachments/stage-plan/parts/d/x.sh")` is `../../attachments/stage-plan/parts/d/x.sh`. `spellFrom("skills/work", "skills/stage-x/parts/d/y.sh")` is `../../skills/stage-x/parts/d/y.sh`. `spellFrom("attachments/tools/widget", "attachments/receive-review/SKILL.md")` is `../../../attachments/receive-review/SKILL.md`. `spellFrom("skills/work", "skills/work/scripts/x.sh")` is `scripts/x.sh`.
  - **Closure:** `closeMap` with `stage-gates` and `watch-ci` both reaching `widget-gates` copies gives two keys (Review Focus 3). A reached unit with no keys still appears in `covers`. One key with two targets throws.
  - **Scoped names:** `isKey` is false for `@mantine/core`, `@acme/ui`, `mattstack@0.32.28` and `name@acme.dev` (Review Focus 5).
  - **Ids:** `ID_RE` accepts `widgets@0.4.2:receive-review` and `skills:board:respond`, and rejects `widgets@latest:x`, `../x` and `skills:../x`.
  - **Leftovers:** `leftoverTokens` ignores the token in frontmatter `allowed-tools` and finds it in the body.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/pointers.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the Interfaces above in `lib/skills/pointers.ts`. Pure functions, no fs; `posix.normalize` for the plugin-relative form only, never for spelling.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit** `skills: a pointer pass that turns paths into @keys, and the closure map`.

### Task 2: Compile writes keys, ids and closure maps

**Files:**
- Modify: `commands/skills.ts`:
  - `compileVerb` (~:860-925) and `performCompile`'s writing block (~:1297-1312);
  - `computeCheck` (~:1767-1915) and `checkBlocks` (~:1942);
  - the `--json` object (~:2023) and `classify()` (~:3040).
- Modify: `lib/skills/compile-blocks.ts` (`compileBlockSkill` ~:283-342) and `lib/skills/compile.ts` (`CompileSkillOpts` at :377, `HEADER_COMMENT` :20).
- Modify: `lib/skills/references.ts` (`renderCopy`) and `lib/skills/base-attachments.ts` (emits ~:258-323, `isEmittedAttachmentText` ~:27).
- Modify: `lib/skills/placeholders.ts`: the `pipelineTable` row at :353, `Used`, and `fileVerbPath`.
- Modify: the floor constant beside `TEAM_MARKERS_MIN_ENGINE`.
- Modify: `makePackDir` in `commands/__tests__/skills.test.ts`, and any other pack-fixture helper with no `plugin.json`.
- Modify: `.github/workflows/checks.yml` (~:334-338). The `plugin-mattstack` job's "Compiled engines pass check-dot" step builds `$RUNNER_TEMP/pack` from `pack/stubs.jsonc` and `pack/skills.jsonc` only. It now also writes `$RUNNER_TEMP/pack/.claude-plugin/plugin.json` (`{"name": "widgets", "version": "0.1.0"}`), or the new identity refusal fails it.
- Modify: `scripts/blocks/lib/normalize.ts` (`SEAM_LINE`), so the blocks-diff tooling strips the opening line the way it strips the header and `part:` comments. Test: `scripts/__tests__/blocks-diff.test.ts`.
- Test: `commands/__tests__/skills-pointers.test.ts` (new). Also update the existing compile, drift, base-attachments and check-paths tests whose expected output changes.

**Interfaces:**
- Consumes: from Task 1, `keyBody`, `openingLine`, `closeMap`, `unitId`, `leftoverTokens`, `isKey`, `PointerMap` and `UnitTable`.
- Produces:
  - **`compiled.json`.** Every compiled unit folder holds one: the `PointerMap` with its closure, `{ "id": "<plugin>@<version>:<unit>", "dir", "covers", "keys" }`. A base copy's keeps `base`, `version` and `files` and adds the same four keys. `isEmittedAttachmentText` still keys on `base`, so a verb's file is never read as a base unit.
  - **The floor.** `const POINTER_KEYS_MIN_ENGINE = "0.32.28"`: a pack whose build carries keys gets at least this in `pack/requires.json`.
  - **Check rows.** `CheckPayload.pointerErrors?: BlockDiagnostic[]`, with codes `dangling-key` (an `isKey` token with no entry in the closure), `missing-target` (an entry whose file is missing, a folder counting as missing) and `leftover-token`.

- [ ] **Step 1: Write the failing tests** in `skills-pointers.test.ts`. The fixture is an invented `widgets` pack: `plugin.json` 0.4.2, a `work` verb, two stages (one public), a vendored script, a `references/` copy, and a grouped base copy that a `{{pack.path:}}` names.
  - **Opening line.** After compile, the line right after `HEADER_COMMENT` in `skills/work/SKILL.md` is `openingLine("widgets@0.4.2:work")`. No written `.md` body holds `${CLAUDE_SKILL_DIR}` outside `allowed-tools`.
  - **Maps.**
    - `skills/work/compiled.json`: its `covers` names both stages and the grouped base copy, including one with no pointers of its own. Its `keys` include the public stage's script with target `skills/stage-x/parts/<dir>/y.sh`.
    - `attachments/stage-plan/compiled.json` holds only stage-plan's own closure.
    - A base copy that reads `{{verb.path:receive-review}}` (board-respond's shape) covers `receive-review`.
  - **Folder detection.** `isEmittedAttachmentDir` and `classify()` treat a verb folder with `compiled.json` as a compiled verb.
  - **Frontmatter and floor.** Every `allowed-tools` line is byte-identical to the pre-change build, and `pack/requires.json` minEngine is at least `POINTER_KEYS_MIN_ENGINE`.
  - **Stale stamp.** Bumping the fixture's `plugin.json` to 0.4.3 without recompiling makes `checkPack` report the verbs out of date (Review Focus 1).
  - **Check failures.** A hand-edited body with `@work/nope.md`, a key whose target file was deleted, a key whose target is a folder, and a leftover `${CLAUDE_SKILL_DIR}` each give one `pointerErrors` row with its code. `checkBlocks` prints them under a "compiled skills, pointers" caption, and the exit code is 1. `@mantine/core` in a fill's prose gives no row.
  - **Shared key.** Two units in one closure claiming one key with different targets fails the compile, naming both.
  - **Missing manifest.** A pack with no `plugin.json`, or no version in it, refuses to compile, naming the file.
- [ ] **Step 2: Run** `bun test commands/__tests__/skills-pointers.test.ts --timeout 60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Identity.** Pass `packPluginIdentity(packDir)` into `CompileSkillOpts`. Refuse a `null` identity or an empty version. Give `makePackDir` and the other fixture helpers a `plugin.json` (`{"name": "widgets", "version": "0.1.0"}`).
  - **Keying.** Build the `UnitTable` from the compile plan. Apply `keyBody` to every `.md` compile writes:
    - verb and stage `SKILL.md`;
    - every rendered `references/` copy and every base copy;
    - every fill-vendored `.md` under `parts/` that is copied byte for byte today. Turn its `copyFrom` entry into a content entry.

    Insert `openingLine` right after `HEADER_COMMENT`; a copy's line names its host unit's id. Send the `pipelineTable` read path through the same pass. Check's `leftover-token` scans every `.md` in a compiled unit folder. A test pins a vendored `parts/` `.md` that carries a pointer.
  - **Closure.** After all targets compile, compute each unit's closure from its own targets plus every unit it reads by path, then write `compiled.json`. The units read by path are:
    - the orchestrator's `stageEntries`;
    - the `{{verb.path:}}` targets recorded while rendering (add `verbPaths: string[]` to `Used`);
    - a base copy's verb paths (`fileVerbPath`);
    - every planned base unit a `{{pack.path:}}` names (`used.packPaths`).
  - **Check.** Add the `pointerErrors` checks and the floor. The `--json` key is emitted only when non-empty.
  - **Folder pointers.** List in the report every pointer in the plugin's sources that names a folder rather than a file. Task 5 rewrites them.
- [ ] **Step 4: Run** the new test, then `bun test lib/skills commands/__tests__/skills*.test.ts --timeout 60000`. Expected: all pass. Update existing expected outputs only for the opening line, keys, `compiled.json` and fixture `plugin.json` files, and name each one in the report.
- [ ] **Step 5: Commit** `skills compile: write @keys, an id line and each unit's pointer map`.

### Task 3: `rt skills resolve` and the `skills_resolve` MCP tool

**Files:**
- Create: `lib/skills/resolve.ts`, `lib/mcp/skills-resolve-tool.ts`, `commands/skills-resolve.ts`
- Modify: `lib/skills/installed-plugins.ts` (the exact-version finder), `lib/command-tree-def.ts` (the `skills resolve` leaf, after the `check` leaf ~:2429), `lib/mcp/tools.ts` (register beside `whoamiToolDefs` ~:901), `.claude/rules/mcp-and-gates.md` (the tool roster paragraph), `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerate)
- Test: `lib/skills/__tests__/resolve.test.ts`, `lib/mcp/__tests__/skills-resolve-tool.test.ts`; update `lib/mcp/__tests__/tools.test.ts` `NAMES` and `lib/__tests__/agent-safe.test.ts`'s list

**Interfaces:**
- Consumes: from Task 1, `ID_RE`, `PointerMap`, `Target` and `spellFrom`. From Task 2, the `compiled.json` shape.
- Produces:
  - **`findPluginVersionDirs(fs: PluginFs, home: string, plugin: string, version: string): string[]`** returns every `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`, skipping `temp_git_*` marketplaces, sorted.
  - **`resolvePointers(id: string, deps: ResolveDeps): ResolveResult`.**
    - `ResolveDeps = { fs: PluginFs & { readFile(p: string): string | null }; home: string }`.
    - `ResolveResult = { id: string; folder: string; covers: string[]; keys: Record<string, string> }`.
    - **`folder`:** for a plugin id, the version dir plus the unit's `dir` from its `compiled.json`, found under `skills/<leaf>`, `attachments/<leaf>` or `attachments/*/<leaf>` by matching `id`. For a `skills:` id, it is `home/.claude/skills/<name>`, the link path itself.
    - **Each key's value:** `folder + "/" + spellFrom(dir, target)`, joined as text. A sibling target is `home/.claude/skills/<skill>/<path>`.
    - **`covers`** is read from `compiled.json`.
    - **Refusals.** It throws `UserActionableError` for:
      - a malformed id;
      - no installed copy, naming the versions found;
      - more than one marketplace, or more than one matching unit folder, naming each;
      - a missing `compiled.json`;
      - a key whose target file is missing, naming the key;
      - a `skills:` link whose target is gone, naming the link.
  - **The leaf.** `skills resolve <id>`: `agentSafe: true`, `--json`, no path flags. Human output prints the folder and a key/path table.
  - **The tool.** `skills_resolve`, input `{id: string}` (pattern `ID_RE`), `shellForms` `rt skills resolve <id> --json`, HOME from the server's env.

- [ ] **Step 1: Write the failing tests** in `resolve.test.ts`, with a fake fs.
  - **Plugin id.** It resolves `widgets@0.4.2:work` from `<home>/.claude/plugins/cache/acme/widgets/0.4.2/skills/work/compiled.json`.
    - The public stage's script key returns `<…>/0.4.2/skills/work/../../skills/stage-x/parts/d/y.sh`, with the `../` kept.
    - The returned path for `work`'s own `scripts/x.sh` equals the text of `Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh:*)` with the folder filled in.
    - The stage script's path matches the orchestrator's wildcard rule `Bash(*/parts/d/y.sh:*)`.
  - **Attachments units.** It resolves `widgets@0.4.2:board-respond` from `attachments/board-respond`, and a grouped `widgets@0.4.2:widget` from `attachments/tools/widget`.
  - **No copy.** With only 0.4.1 installed, it refuses naming 0.4.1 (Review Focus 1).
  - **Marketplaces.** A `temp_git_123_ab` marketplace holding the same version is ignored. Two other marketplaces holding it refuse, naming both.
  - **Board skills.** `skills:board:respond` uses `<home>/.claude/skills/board:respond` as the folder, never the link's target. A sibling target resolves under `board:gate-cli-recipes`'s own link. A dead link refuses naming it (Review Focus 4).
  - **Missing file.** A missing target file refuses naming the key.
  - **The tool** (`skills-resolve-tool.test.ts`): it returns `resolvePointers`'s JSON for a valid id and `err` for `../x`, and it never reads outside the two roots.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/resolve.test.ts lib/mcp/__tests__/skills-resolve-tool.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces above.
  - Follow `whoami-tool.ts` for the tool's shape, and the `check` leaf for the tree entry.
  - Add the tool to `NAMES`, and `skills resolve` to the agent-safe list.
  - Add one line on `skills_resolve` to the roster in `.claude/rules/mcp-and-gates.md`.
  - Regenerate the reference: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`.
- [ ] **Step 4: Run**, in order:
  1. the two new tests;
  2. `bun test lib/mcp lib/__tests__/agent-safe.test.ts lib/skills`;
  3. `bun scripts/ci/engine-floor-check.ts --base origin/main`.

  Expected: all pass.
- [ ] **Step 5: Commit** `skills: resolve a skill's pointers by id, as a verb and an MCP tool`.

### Task 4: The board's expanded skills

**Files:**
- Modify: `lib/skills/expand.ts`:
  - `ExpandedSkill`, so a vendored `.md` can be a content entry, not only `{path, copyFrom}`;
  - `expandOne` (~:120-215) and `assertPathsInside` (~:78);
  - `writeExpanded` (~:284), `checkExpanded` (~:313) and `firstVendoredDrift`.
- Regenerate: `apps/board/skills/**` (`bun run skills:expand:board`).
- Test: the expand tests under `lib/skills/__tests__/`, and `lib/__tests__/no-board-skills-drift.test.ts`.

**Interfaces:**
- Consumes: from Task 1, `keyBody`, `skillsId`, `openingLine` and `closeMap`; from Task 3, the sibling-target form.
- Produces:
  - **`compiled.json`.** Each expanded board skill holds `{ "id": "skills:<frontmatter name>", "dir", "covers", "keys" }`, listed in `files` so drift sees it.
  - **Rewritten text.** Its `SKILL.md` and vendored `.md` files carry `@keys` and the opening line: `respond/launch.md`, `triage.md`, `post.md`, `gate-step.md`, `doctor/entry.md`, and `gate-cli-recipes/SKILL.md`, which has no pointers but is read by path.
  - **What `keyBody` gets.** For a board skill, `at.dir` is `skills/<folder>` (the skill's folder name under `apps/board/skills`, such as `respond`). `at.units` maps every board skill folder to `skills/<folder>` (`respond`, `review`, `doctor`, `gate-cli-recipes`). So `${CLAUDE_SKILL_DIR}/scripts/x` reads as the skill's own folder, and `@gate-cli-recipes/...` counts as a key.
  - **Siblings.** After `keyBody`, expand turns a string target that lands in another board skill's folder into `{ skill: <that skill's frontmatter name>, path }`. `../gate-cli-recipes/SKILL.md` becomes `{ skill: "board:gate-cli-recipes", path: "SKILL.md" }`. That sibling's id is in the reader's `covers`.
  - **Scripts** are copied byte for byte, and their comments keep the token.

- [ ] **Step 1: Write the failing test.** Expand a fixture board skill named `board:widget` whose body runs `"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"`, points at `${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md`, and vendors a `launch.md` with a pointer. The result has:
  - `@widget/scripts/resolve-args.sh`;
  - a sibling target for `board:gate-cli-recipes`, with `skills:board:gate-cli-recipes` in `covers`;
  - the opening line for `skills:board:widget` in both `.md` files;
  - a `compiled.json` that `checkExpanded` treats as part of the skill;
  - an `allowed-tools` line byte-identical to the source's.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces above, then run `bun run skills:expand:board`.
- [ ] **Step 4: Run** the expand tests, `bun run skills:check:board`, `bun test lib/__tests__/no-board-skills-drift.test.ts`, and check-dot over `apps/board/skills`. Expected: all pass.
- [ ] **Step 5: Commit** `skills expand: board skills point by @key and carry their map`, with `apps/board/skills` in the same commit.

### Task 5: Source prose, folder pointers, docs and release notes

**Files:**
- Modify: the shepherdr block holding "`${CLAUDE_SKILL_DIR}` is the absolute directory this skill loaded from". It is compiled at `plugins/mattstack/skills/shepherdr/SKILL.md:470`; its source is under `plugins/mattstack/attachments/orchestration/shepherdr/`.
- Modify: `plugins/mattstack/attachments/pipeline/stage-watch-ci/forge.block.md` (the `<scripts>` folder pointer at :14), the matching `pipeline/watch-ci/forge.block.md`, and every other folder pointer Task 2's report lists.
- Modify: `plugins/mattstack/attachments/pipeline/stage-self-review/dispatch-reviewer.block.md` and `plugins/mattstack/attachments/pipeline/stage-implement/superpowers-chain.block.md`, the blocks that brief subagents.
- Modify: `plugins/mattstack/plugin/skills/editing-skills/SKILL.md` and `extending-a-pack/SKILL.md`.
- Modify: `website/docs/skills/packs.mdx` and `RELEASE_NOTES.md`.

- [ ] **Step 1: Skill text.** Load superpowers:writing-skills and mattstack:editing-skills, then make these edits:
  - **shepherdr:** rewrite the sentence to say pointers are `@keys` resolved by `skills_resolve`.
  - **Folder pointers:** rewrite each so it names every file it reaches (`<scripts>/ci-triage.sh` becomes the script's own pointer).
  - **The two dispatch blocks:** add one line. The brief names each file it passes by its resolved absolute path from this run's map, never by `@key`. A subagent that reads a written skill itself makes that skill's one call.
  - **editing-skills and extending-a-pack:** say three things.
    - Authors keep writing `${CLAUDE_SKILL_DIR}`, `{{pack.path:}}` and `{{verb.path:}}` in sources, and compile turns them into `@keys`.
    - `rt skills resolve <id>` shows a skill's map.
    - A plugin version bump needs a recompile before commit.
  - Keep every other line as it is, recompile, and run check-dot.
- [ ] **Step 2: Docs.**
  - In `packs.mdx`, add a short "Pointers in compiled skills" section, following the rt:docs skill.
  - In `RELEASE_NOTES.md`, under Skill packs, add: "Compiled skills point at their own files by `@key`; one `skills_resolve` call per started skill finds them wherever the skill was opened from. A plugin version bump now needs a recompile."
- [ ] **Step 3: Run** `bun run docs:check` and `bun run docs:build`. Expected: pass.
- [ ] **Step 4: Commit** `docs and skills: pointers are @keys resolved by id`.

### Task 6: Recompile and prove

- [ ] **Step 1: Version first.** Re-read main's plugin version (`git fetch origin main`, `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json`). If main has moved, set `plugin.json`, minEngine and `POINTER_KEYS_MIN_ENGINE` one past it now, before recompiling.
- [ ] **Step 2: Recompile.** Recompile the plugin's own skills (`rt skills compile --pack-dir plugins/mattstack --mattstack-dir <empty scratch dir>` under an isolated HOME). Then run `bun run skills:expand:board`. Confirm `leftoverTokens` finds nothing in any `plugins/mattstack/skills/**/*.md` or `apps/board/skills/**/*.md` body.
- [ ] **Step 3: Run**, all expected to pass:
  - `rt skills check --pack-dir plugins/mattstack --mattstack-dir <empty> --strict`;
  - certify, check-dot over the plugin and the compiled verbs, and the plugin shell tests;
  - `bun test lib/skills lib/mcp commands/__tests__/skills*.test.ts --timeout 60000` and `bunx tsc --noEmit`;
  - `bun run purity` and `bun run skills:check:board`;
  - the engine-floor and version-bump checks against `origin/main`;
  - the commands of `checks.yml`'s "Compiled engines pass check-dot" step, run locally against a temp pack built the way that step builds it.
- [ ] **Step 4: Commit** `mattstack: recompile with @key pointers`.
- [ ] **Step 5: The live proof.** These checks run at the cutover trial on the dev app, not here, because they need the plugin installed in a real `~/.claude`. Add them to the trial checklist the controller keeps:
  - a board respond run follows every receive-review pointer from the pack skill's one call;
  - a `work` run makes one `skills_resolve` call;
  - a vendored script run from a resolved path asks for no permission where today's path asks none.
