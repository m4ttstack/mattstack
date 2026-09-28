# Board Skills Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give board's launcher skills the mattstack `gate-protocol` rules by pasting them in at build time with a new `rt skills expand` verb, so the skills work from the app bundle and a source checkout alike.

**Architecture:** `lib/skills/expand.ts` is a pure module: read every skill under a source dir, replace each `{{include:<name>}}` line with the attachment body under a seam marker, keep the frontmatter byte for byte plus a `metadata.compiled` stamp, and describe the files the output dir should hold. `commands/skills-expand.ts` drives it (`--src`, `--out`, `--mattstack-dir`, `--check`, `--strict`). Board's sources move to `apps/board/skills-src`, the expanded output is committed to `apps/board/skills` (unchanged shape, so the bundle build, linker and dev symlinks need nothing), and a unit test in the always-run `turbo:test` root task fails CI on drift.

**Tech Stack:** Bun, TypeScript, `bun:test`, the existing `lib/skills` compiler pieces (`loadInclude`, `substituteIncludesOnly`, `skillMdDriftCauses`, `lintPackDir`).

**Spec:** `docs/superpowers/specs/2026-09-27-board-compiled-skills-design.md`

## Global Constraints

- No em dashes or en dashes anywhere (code, comments, commits, docs, skill text). Use "..." or rephrase.
- Comments only for constraints the code cannot show; never narrate the next line or cite tickets.
- Never edit `apps/board/skills/**` by hand after Task 3; it is generated. Edit `apps/board/skills-src/**` and re-run `bun run skills:expand:board`.
- `plugins/mattstack` keeps its own Markdown style; any change there bumps `plugins/mattstack/.claude-plugin/plugin.json` `version` (patch) in the same PR, and every skill dir edited passes `sh plugins/mattstack/tests/certify.sh <dir>`.
- Run `bun test` from the repo root only (bunfig preload isolates HOME).
- Worktree Bash guard: one command per Bash call, no `&&`, no heredocs, no `git -C`. Write multi-line file content with the Write/Edit tools.
- Before Task 6, `git fetch origin` and `git rebase origin/main` (the plugin 0.27.1 bump lands on main first).
- Commit after every task with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A source skill whose frontmatter already carries `metadata.compiled` (someone copied an expanded file back into `skills-src`): expand must refuse it by name, not stamp it twice. Pinned in Task 1.
2. A `{{include:x}}` that is not alone on its line, or a placeholder of another kind (`{{slot:x}}`): expand must fail with the file and line, never ship the marker. Pinned in Task 1.
3. A `${CLAUDE_SKILL_DIR}/../...` path in the expanded body that resolves outside `--out` (the exact stopgap this replaces): expand must fail naming the path. A sibling (`../gate-cli-recipes/SKILL.md`) must pass. Pinned in Task 1.
4. An output directory with no source (a skill renamed or deleted in `skills-src`): `expand` removes it and `--check` reports it, so a stale skill never ships. Pinned in Task 1.
5. An edit to `plugins/mattstack/attachments/gate-protocol/SKILL.md` without re-running expand: the always-run guard test must fail on `include` drift. Pinned in Task 5.

---

### Task 1: `lib/skills/expand.ts`

**Files:**
- Create: `lib/skills/expand.ts`
- Create: `lib/skills/__tests__/expand.test.ts`
- Modify: `lib/skills/sources.ts` (export `listFilesUnder`; add `resolvePluginRootsFromDir`)
- Modify: `commands/skills.ts:437-456` (delete its private `resolvePluginRootsFromDir` and `listPluginDirs`, import from sources)

**Interfaces:**
- Consumes: `loadInclude(name, roots)`, `stripFrontmatter(md)`, `PluginRoots` from `lib/skills/sources.ts`; `substituteIncludesOnly(body, ctx, where)`, `findPlaceholders(body)` from `lib/skills/placeholders.ts`; `skillMdDriftCauses(onDisk, expected)` from `lib/skills/drift.ts`; `AttachmentSource`, `CompiledFile`, `PlaceholderContext` from `lib/skills/types.ts`.
- Produces:
  ```ts
  export const EXPAND_HEADER: string;
  export type ExpandedSkill = { name: string; skillMd: string; files: { path: string; copyFrom: string }[]; includes: string[] };
  export function expandSkills(opts: { srcDir: string; outDir: string; roots: PluginRoots }): ExpandedSkill[];
  export function writeExpanded(outDir: string, skills: ExpandedSkill[]): { written: string[]; removed: string[] };
  export type ExpandDrift = { skill: string; causes: string[] };
  export function checkExpanded(outDir: string, skills: ExpandedSkill[]): ExpandDrift[];
  ```
  and in `lib/skills/sources.ts`: `export function listFilesUnder(dir, exclude): string[]` (already exists, just exported) and `export function resolvePluginRootsFromDir(dir: string): PluginRoots` (moved from `commands/skills.ts`).

- [ ] **Step 1: Export `listFilesUnder` and move `resolvePluginRootsFromDir` into `lib/skills/sources.ts`**

In `lib/skills/sources.ts`, change `function listFilesUnder(` to `export function listFilesUnder(`. Then append, after `resolvePluginRoots`:

```ts
function listPluginDirs(pluginsDir: string): string[] {
  if (!existsSync(pluginsDir)) return [];
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Resolves plugins from `<dir>/plugins/<name>` instead of `claude plugin list`.
 * CI passes the checkout root here so an in-tree plugin is read at the
 * commit under test, and board's expand passes it so the pasted gate rules
 * are the tree's, never the installing machine's.
 */
export function resolvePluginRootsFromDir(dir: string): PluginRoots {
  const pluginsDir = join(dir, "plugins");
  const byName: PluginRoots["byName"] = {};
  for (const name of listPluginDirs(pluginsDir)) {
    const pluginDir = join(pluginsDir, name);
    let version = "unknown";
    try {
      const parsed = JSON.parse(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"));
      if (typeof parsed.version === "string") version = parsed.version;
    } catch {
      // a plugin without a readable manifest still resolves a root
    }
    byName[name] = { dir: pluginDir, version };
  }
  return { byName, list: [] };
}
```

In `commands/skills.ts`, delete the private `listPluginDirs` (around line 420) and `resolvePluginRootsFromDir` (around line 437) and add `resolvePluginRootsFromDir` to the existing `from "../lib/skills/sources.ts"` import. Run `bun test lib/skills commands` and confirm the existing suites still pass.

- [ ] **Step 2: Write the failing tests**

Create `lib/skills/__tests__/expand.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkExpanded, EXPAND_HEADER, expandSkills, writeExpanded } from "../expand.ts";
import { resolvePluginRootsFromDir } from "../sources.ts";

let root: string;
let src: string;
let out: string;

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

const NOTE = "---\nname: note\ndescription: shared note\n---\n\n# Note\n\nShared rule one.\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rt-expand-"));
  src = join(root, "skills-src");
  out = join(root, "skills");
  write(join(root, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "9.9.9" }));
  write(join(root, "plugins", "mattstack", "attachments", "note", "SKILL.md"), NOTE);
  write(
    join(src, "review", "SKILL.md"),
    "---\nname: board:review\ndescription: r\nallowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/go.sh:*)\nmetadata:\n  slots: \"review\"\n---\n\n# Review\n\nRead `${CLAUDE_SKILL_DIR}/../recipes/SKILL.md` first.\n\n{{include:note}}\n\nTail.\n",
  );
  write(join(src, "review", "scripts", "go.sh"), "#!/bin/sh\necho go\n");
  write(join(src, "recipes", "SKILL.md"), "---\nname: board:recipes\ndescription: plain\n---\n\n# Recipes\n\nNo includes here.\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function roots() {
  return resolvePluginRootsFromDir(root);
}

describe("expandSkills", () => {
  test("keeps frontmatter verbatim, stamps compiled, pastes the include under its marker", () => {
    const [recipes, review] = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    expect(review!.name).toBe("review");
    expect(review!.includes).toEqual(["note"]);
    expect(review!.skillMd).toContain("name: board:review\n");
    expect(review!.skillMd).toContain("allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/go.sh:*)\n");
    expect(review!.skillMd).toContain("metadata:\n  slots: \"review\"\n  compiled: \"mattstack:note@9.9.9\"\n---");
    expect(review!.skillMd).toContain(`\n${EXPAND_HEADER}\n`);
    expect(review!.skillMd).toMatch(/<!-- part: step source=review\/SKILL\.md lines=\d+-\d+ -->/);
    expect(review!.skillMd).toContain("<!-- part: include:note source=mattstack:note version=9.9.9 path=attachments/note/SKILL.md lines=");
    expect(review!.skillMd).toContain("Shared rule one.");
    expect(review!.skillMd).not.toContain("{{");
    expect(review!.files).toEqual([{ path: "scripts/go.sh", copyFrom: join(src, "review", "scripts", "go.sh") }]);
    expect(recipes!.includes).toEqual([]);
    expect(recipes!.skillMd).not.toContain("compiled:");
    expect(recipes!.skillMd).toContain("No includes here.");
  });

  test("a frontmatter with no metadata block gets one", () => {
    write(join(src, "plain", "SKILL.md"), "---\nname: board:plain\ndescription: p\n---\n\n{{include:note}}\n");
    const plain = expandSkills({ srcDir: src, outDir: out, roots: roots() }).find((s) => s.name === "plain")!;
    expect(plain.skillMd).toContain("description: p\nmetadata:\n  compiled: \"mattstack:note@9.9.9\"\n---");
  });

  test("refuses a source that already carries metadata.compiled", () => {
    write(join(src, "copied", "SKILL.md"), "---\nname: board:copied\ndescription: c\nmetadata:\n  compiled: \"x\"\n---\n\nbody\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/copied\/SKILL\.md: metadata\.compiled is set by expand/);
  });

  test("refuses an include that is not alone on its line", () => {
    write(join(src, "inline", "SKILL.md"), "---\nname: board:inline\ndescription: i\n---\n\nSee {{include:note}} here.\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/inline\/SKILL\.md: \{\{include:note\}\} must be alone on its line \(line 1\)/);
  });

  test("refuses any placeholder that is not an include", () => {
    write(join(src, "slotty", "SKILL.md"), "---\nname: board:slotty\ndescription: s\n---\n\n{{slot:domain}}\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/slotty\/SKILL\.md: \{\{slot:domain\}\} at line 1 .* only \{\{include:<name>\}\}/);
  });

  test("refuses an unknown include by name", () => {
    write(join(src, "missing", "SKILL.md"), "---\nname: board:missing\ndescription: m\n---\n\n{{include:nope}}\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/include "nope" not found/);
  });

  test("refuses a CLAUDE_SKILL_DIR path that leaves the output dir, names it, and passes a sibling", () => {
    write(
      join(src, "escape", "SKILL.md"),
      "---\nname: board:escape\ndescription: e\n---\n\nRun `cat ${CLAUDE_SKILL_DIR}/../../../../plugins/mattstack/attachments/note/SKILL.md`.\n",
    );
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(
      /escape\/SKILL\.md: "\$\{CLAUDE_SKILL_DIR\}\/\.\.\/\.\.\/\.\.\/\.\.\/plugins\/mattstack\/attachments\/note\/SKILL\.md" resolves outside/,
    );
    rmSync(join(src, "escape"), { recursive: true });
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).not.toThrow();
  });

  test("refuses a source dir with no SKILL.md and a src that does not exist", () => {
    mkdirSync(join(src, "empty"));
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/empty: no SKILL\.md/);
    expect(() => expandSkills({ srcDir: join(root, "nowhere"), outDir: out, roots: roots() })).toThrow(/nowhere does not exist/);
  });
});

describe("writeExpanded and checkExpanded", () => {
  test("writes SKILL.md and vendored files, removes an orphan output dir, then checks clean", () => {
    write(join(out, "stale", "SKILL.md"), "---\nname: board:stale\n---\n\nold\n");
    const skills = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    const result = writeExpanded(out, skills);
    expect(result.written.sort()).toEqual(["recipes", "review"]);
    expect(result.removed).toEqual(["stale"]);
    expect(existsSync(join(out, "stale"))).toBe(false);
    expect(readFileSync(join(out, "review", "SKILL.md"), "utf8")).toBe(skills.find((s) => s.name === "review")!.skillMd);
    expect(readFileSync(join(out, "review", "scripts", "go.sh"), "utf8")).toBe("#!/bin/sh\necho go\n");
    expect(checkExpanded(out, skills)).toEqual([]);
  });

  test("a second write is idempotent", () => {
    const skills = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    writeExpanded(out, skills);
    const again = writeExpanded(out, skills);
    expect(again.removed).toEqual([]);
    expect(checkExpanded(out, skills)).toEqual([]);
  });

  test("check names the cause: source, include, frontmatter, vendored, missing, orphan", () => {
    const skills = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    writeExpanded(out, skills);

    write(join(src, "review", "SKILL.md"), readFileSync(join(src, "review", "SKILL.md"), "utf8").replace("Tail.", "Tail v2."));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["source"] }]);
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));

    write(join(root, "plugins", "mattstack", "attachments", "note", "SKILL.md"), NOTE.replace("rule one", "rule two"));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["include"] }]);
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));

    write(join(src, "review", "SKILL.md"), readFileSync(join(src, "review", "SKILL.md"), "utf8").replace("description: r", "description: r2"));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["frontmatter"] }]);
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));

    write(join(out, "review", "scripts", "go.sh"), "changed\n");
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["vendored"] }]);

    rmSync(join(out, "recipes"), { recursive: true });
    write(join(out, "orphan", "SKILL.md"), "---\nname: x\n---\n");
    const drift = checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));
    expect(drift).toContainEqual({ skill: "recipes", causes: ["missing"] });
    expect(drift).toContainEqual({ skill: "orphan", causes: ["orphan"] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test lib/skills/__tests__/expand.test.ts`
Expected: FAIL, `Cannot find module "../expand.ts"`.

- [ ] **Step 4: Implement `lib/skills/expand.ts`**

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { skillMdDriftCauses } from "./drift.ts";
import { findPlaceholders, substituteIncludesOnly } from "./placeholders.ts";
import { listFilesUnder, loadInclude, type PluginRoots } from "./sources.ts";
import type { AttachmentSource, PlaceholderContext } from "./types.ts";

export const EXPAND_HEADER =
  "<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";
const SKILL_DIR_PATH_RE = /\$\{CLAUDE_SKILL_DIR\}\/[^\s"'`)]+/g;

export type ExpandedSkill = {
  name: string;
  skillMd: string;
  files: { path: string; copyFrom: string }[];
  includes: string[];
};

export type ExpandDrift = { skill: string; causes: string[] };

function listSkillDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/**
 * The frontmatter is copied byte for byte rather than re-serialised, so a
 * folded description or a quoted key survives exactly as the author wrote
 * it; only the compiled stamp is spliced in, under an existing metadata
 * block or in a new one.
 */
function stampFrontmatter(raw: string, stamp: string | null, where: string): string {
  if (/^\s*compiled:/m.test(raw)) throw new Error(`${where}: metadata.compiled is set by expand; remove it from the source`);
  if (stamp === null) return raw;
  const line = `  compiled: ${JSON.stringify(stamp)}`;
  const lines = raw.split("\n");
  const close = lines.length - 1;
  const at = lines.findIndex((l) => /^metadata:\s*$/.test(l));
  if (at === -1) {
    lines.splice(close, 0, "metadata:", line);
    return lines.join("\n");
  }
  let end = at + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end]!)) end++;
  lines.splice(end, 0, line);
  return lines.join("\n");
}

function emptyContext(includes: Record<string, AttachmentSource>): PlaceholderContext {
  return {
    fills: {},
    slotMode: {},
    partsPrefix: `${SKILL_DIR_TOKEN}/parts`,
    includes,
    pipelines: {},
    repoKey: "",
    mattstackSha: "",
    mattstackDirty: 0,
    packSha: "",
    stageDir: null,
    stageMeta: null,
    compiledFrom: "",
    verbSides: {},
    side: "skills",
    packRoot: null,
  };
}

function assertPathsInside(body: string, outDir: string, name: string, where: string): void {
  const home = resolve(outDir);
  for (const match of body.matchAll(SKILL_DIR_PATH_RE)) {
    const text = match[0];
    const target = resolve(home, name, text.slice(`${SKILL_DIR_TOKEN}/`.length));
    if (target !== home && !target.startsWith(home + sep)) {
      throw new Error(`${where}: "${text}" resolves outside ${outDir}`);
    }
  }
}

function expandOne(srcDir: string, outDir: string, name: string, roots: PluginRoots): ExpandedSkill {
  const dir = join(srcDir, name);
  const skillMdPath = join(dir, "SKILL.md");
  const where = `${name}/SKILL.md`;
  if (!existsSync(skillMdPath)) throw new Error(`${name}: no SKILL.md`);
  const raw = readFileSync(skillMdPath, "utf8");
  const fm = raw.match(FRONTMATTER_RE);
  if (!fm) throw new Error(`${where}: no frontmatter`);
  const rest = raw.slice(fm[0].length);
  const body = rest.trim();
  const countLines = (s: string) => (s.match(/\n/g) ?? []).length;
  const bodyStartLine = countLines(fm[0]) + countLines(rest.slice(0, rest.length - rest.trimStart().length)) + 1;

  const includes: Record<string, AttachmentSource> = {};
  const names: string[] = [];
  for (const p of findPlaceholders(body)) {
    if (p.kind !== "include" || !p.arg) {
      throw new Error(`${where}: ${p.raw} at line ${p.line} -- only {{include:<name>}} is allowed here`);
    }
    if (!(p.arg in includes)) {
      includes[p.arg] = loadInclude(p.arg, roots);
      names.push(p.arg);
    }
  }

  const expanded = substituteIncludesOnly(body, emptyContext(includes), where).body;
  const brace = expanded.split("\n").findIndex((l) => l.includes("{{"));
  if (brace !== -1) throw new Error(`${where}: literal "{{" survives expansion near output line ${brace + 1}`);
  assertPathsInside(expanded, outDir, name, where);

  const stamp = names.length === 0 ? null : names.map((n) => `${includes[n]!.plugin}:${n}@${includes[n]!.version}`).join(" + ");
  const frontmatter = stampFrontmatter(fm[0].replace(/\r?\n?$/, ""), stamp, where);
  const span = `path=${where} lines=${bodyStartLine}-${bodyStartLine + body.split("\n").length - 1}`;
  const skillMd = `${frontmatter}\n\n${EXPAND_HEADER}\n\n<!-- part: step source=${where.replace("/SKILL.md", "")}/SKILL.md ${span} -->\n${expanded}\n`;

  const files = listFilesUnder(dir, new Set(["SKILL.md"])).map((path) => ({ path, copyFrom: join(dir, path) }));
  for (const n of names) {
    for (const extra of includes[n]!.extraFiles) {
      files.push({ path: `parts/include-${n}/${extra}`, copyFrom: join(includes[n]!.dir, extra) });
    }
  }
  return { name, skillMd, files, includes: names };
}

export function expandSkills(opts: { srcDir: string; outDir: string; roots: PluginRoots }): ExpandedSkill[] {
  if (!existsSync(opts.srcDir) || !statSync(opts.srcDir).isDirectory()) throw new Error(`${opts.srcDir} does not exist`);
  return listSkillDirs(opts.srcDir).map((name) => expandOne(opts.srcDir, opts.outDir, name, opts.roots));
}

export function writeExpanded(outDir: string, skills: ExpandedSkill[]): { written: string[]; removed: string[] } {
  mkdirSync(outDir, { recursive: true });
  const keep = new Set(skills.map((s) => s.name));
  const removed = listSkillDirs(outDir).filter((d) => !keep.has(d));
  for (const d of removed) rmSync(join(outDir, d), { recursive: true, force: true });
  for (const s of skills) {
    const dir = join(outDir, s.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), s.skillMd);
    for (const f of s.files) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      copyFileSync(f.copyFrom, join(dir, f.path));
    }
  }
  return { written: skills.map((s) => s.name), removed };
}

export function checkExpanded(outDir: string, skills: ExpandedSkill[]): ExpandDrift[] {
  const drift: ExpandDrift[] = [];
  const expected = new Set(skills.map((s) => s.name));
  for (const s of skills) {
    const dir = join(outDir, s.name);
    const skillMdPath = join(dir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      drift.push({ skill: s.name, causes: ["missing"] });
      continue;
    }
    const causes: string[] = skillMdDriftCauses(readFileSync(skillMdPath, "utf8"), s.skillMd);
    const vendoredMoved = s.files.some((f) => {
      const onDisk = join(dir, f.path);
      return !existsSync(onDisk) || !readFileSync(onDisk).equals(readFileSync(f.copyFrom));
    });
    if (vendoredMoved) causes.push("vendored");
    if (causes.length > 0) drift.push({ skill: s.name, causes });
  }
  if (existsSync(outDir)) {
    for (const d of listSkillDirs(outDir)) {
      if (!expected.has(d)) drift.push({ skill: d, causes: ["orphan"] });
    }
  }
  return drift;
}
```

Note for the implementer: `substituteIncludesOnly` throws `${where}: {{include:x}} must be alone on its line (line N)` itself; the placeholder pre-scan above only rejects other kinds. If the "alone on its line" test's line number differs from the message, adjust the test's expected line to what the function reports, not the code.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test lib/skills/__tests__/expand.test.ts`
Expected: PASS, all tests. Then `bun test lib/skills commands/__tests__` to confirm nothing else moved after the sources.ts change.

- [ ] **Step 6: Commit**

```bash
git add lib/skills/expand.ts lib/skills/__tests__/expand.test.ts lib/skills/sources.ts commands/skills.ts
git commit -m "skills: add expand module (include paste for hand-written skills)"
```

---

### Task 2: `rt skills expand` verb

**Files:**
- Create: `commands/skills-expand.ts`
- Create: `commands/__tests__/skills-expand.test.ts`
- Modify: `lib/command-tree-def.ts:2310` (add the `expand` leaf under `skills`)
- Modify: `lib/module-registry.ts:43-46` (register the module)
- Modify: `website/docs/reference/**` (regenerated by `bun run docs:gen`)

**Interfaces:**
- Consumes: `expandSkills`, `writeExpanded`, `checkExpanded` (Task 1); `resolvePluginRootsFromDir`, `resolvePluginRoots` from `lib/skills/sources.ts`; `deriveRules`, `lintPackDir`, `lintPackScripts`, `formatHit` from `lib/skills/mcp-lint.ts`; `mcpTools` from `lib/mcp/tools.ts`; `listAgentSafe` from `lib/command-tree-resolve.ts`; `TREE` from `lib/command-tree-def.ts`.
- Produces: `export async function skillsExpand(args: string[]): Promise<void>`. Exit 0 on success or a clean check; exit 1 on drift, lint hits under `--strict`, or a usage error. `--json` prints `{"ok": boolean, "mode": "expand"|"check", "skills": string[], "removed": string[], "drift": ExpandDrift[], "lint": string[]}`.

- [ ] **Step 1: Write the failing test**

Create `commands/__tests__/skills-expand.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { skillsExpand } from "../skills-expand.ts";
import { runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";

let root: string;
let logs: string[];
let logSpy: ReturnType<typeof spyOn>;

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rt-expand-cli-"));
  write(join(root, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "1.2.3" }));
  write(join(root, "plugins", "mattstack", "attachments", "note", "SKILL.md"), "---\nname: note\ndescription: n\n---\n\nShared.\n");
  write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\n{{include:note}}\n");
  logs = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

const base = () => ["--src", join(root, "src"), "--out", join(root, "out"), "--mattstack-dir", root];

describe("rt skills expand", () => {
  test("writes the output and reports each skill", async () => {
    await skillsExpand(base());
    expect(readFileSync(join(root, "out", "a", "SKILL.md"), "utf8")).toContain("Shared.");
    expect(logs.join("\n")).toContain("+ a");
  });

  test("--check is clean after expand and exits 1 naming the drift after an edit", async () => {
    await skillsExpand(base());
    const clean = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(clean.exitCode).toBeUndefined();
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nNew line.\n\n{{include:note}}\n");
    const drifted = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(drifted.exitCode).toBe(1);
    expect(drifted.errors.join("\n")).toContain("a: source");
  });

  test("--check --json prints the drift envelope", async () => {
    await skillsExpand(base());
    rmSync(join(root, "out", "a"), { recursive: true });
    await runExpectingCleanExit(() => skillsExpand([...base(), "--check", "--json"]));
    const parsed = JSON.parse(logs.at(-1)!);
    expect(parsed).toMatchObject({ ok: false, mode: "check", drift: [{ skill: "a", causes: ["missing"] }] });
  });

  test("--dry-run writes nothing", async () => {
    await skillsExpand([...base(), "--dry-run"]);
    expect(existsSync(join(root, "out"))).toBe(false);
    expect(logs.join("\n")).toContain("+ a");
  });

  test("a missing --src or --out is a usage error", async () => {
    const r = await runExpectingCleanExit(() => skillsExpand(["--src", join(root, "src")]));
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain("--out");
  });

  test("an expand error exits 1 with the file named", async () => {
    write(join(root, "src", "b", "SKILL.md"), "---\nname: app:b\ndescription: b\n---\n\n{{include:nope}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand(base()));
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain('include "nope"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test commands/__tests__/skills-expand.test.ts`
Expected: FAIL, `Cannot find module "../skills-expand.ts"`.

- [ ] **Step 3: Implement `commands/skills-expand.ts`**

```ts
/**
 * rt skills expand -- paste mattstack attachments into hand-written skills.
 *
 *   rt skills expand --src <dir> --out <dir> [--mattstack-dir <root>] [--check] [--strict] [--dry-run] [--json]
 *
 * The source dir holds one directory per skill; each SKILL.md may carry
 * `{{include:<attachment>}}` lines and nothing else placeholder-shaped. The
 * output dir is owned by expand: every dir in it is regenerated or removed.
 */

import { TREE } from "../lib/command-tree-def.ts";
import { listAgentSafe } from "../lib/command-tree-resolve.ts";
import { mcpTools } from "../lib/mcp/tools.ts";
import { checkExpanded, expandSkills, writeExpanded, type ExpandDrift, type ExpandedSkill } from "../lib/skills/expand.ts";
import { deriveRules, formatHit, lintPackDir, lintPackScripts } from "../lib/skills/mcp-lint.ts";
import { resolvePluginRoots, resolvePluginRootsFromDir } from "../lib/skills/sources.ts";

type Flags = { src: string; out: string; mattstackDir: string | null; check: boolean; strict: boolean; dryRun: boolean; json: boolean };

function fail(message: string): never {
  console.error(`rt skills expand: ${message}`);
  process.exit(1);
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { src: "", out: "", mattstackDir: null, check: false, strict: false, dryRun: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case "--src": flags.src = args[++i] ?? ""; break;
      case "--out": flags.out = args[++i] ?? ""; break;
      case "--mattstack-dir": flags.mattstackDir = args[++i] ?? null; break;
      case "--check": flags.check = true; break;
      case "--strict": flags.strict = true; break;
      case "--dry-run": flags.dryRun = true; break;
      case "--json": flags.json = true; break;
      default: fail(`unknown flag ${a}`);
    }
  }
  if (!flags.src) fail("--src <dir> is required");
  if (!flags.out) fail("--out <dir> is required");
  return flags;
}

function lintOutput(outDir: string): string[] {
  const rules = deriveRules(
    mcpTools(),
    listAgentSafe(TREE).map((l) => ({ path: l.path, deniedFlags: l.node.agentDeniedFlags, noCwd: l.node.agentNoCwd })),
  );
  return [...lintPackDir(outDir, rules), ...lintPackScripts(outDir, rules)].map(formatHit);
}

function emit(flags: Flags, payload: { ok: boolean; mode: "expand" | "check"; skills: string[]; removed: string[]; drift: ExpandDrift[]; lint: string[] }, lines: string[]): void {
  if (flags.json) {
    console.log(JSON.stringify(payload));
    return;
  }
  for (const line of lines) console.log(line);
}

export async function skillsExpand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const roots = flags.mattstackDir ? resolvePluginRootsFromDir(flags.mattstackDir) : resolvePluginRoots();

  let skills: ExpandedSkill[];
  try {
    skills = expandSkills({ srcDir: flags.src, outDir: flags.out, roots });
  } catch (err) {
    fail((err as Error).message);
  }

  if (flags.check) {
    const drift = checkExpanded(flags.out, skills);
    const lint = flags.strict ? lintOutput(flags.out) : [];
    const ok = drift.length === 0 && lint.length === 0;
    emit(flags, { ok, mode: "check", skills: skills.map((s) => s.name), removed: [], drift, lint }, ok ? [`expanded skills current (${skills.length})`] : []);
    if (!ok) {
      for (const d of drift) console.error(`${d.skill}: ${d.causes.join(", ")}`);
      for (const hit of lint) console.error(hit);
      process.exit(1);
    }
    return;
  }

  const result = flags.dryRun ? { written: skills.map((s) => s.name), removed: [] as string[] } : writeExpanded(flags.out, skills);
  const lint = flags.strict && !flags.dryRun ? lintOutput(flags.out) : [];
  const lines = [...result.written.map((n) => `+ ${n}`), ...result.removed.map((n) => `- ${n}`)];
  emit(flags, { ok: lint.length === 0, mode: "expand", skills: result.written, removed: result.removed, drift: [], lint }, lines);
  if (lint.length > 0) {
    for (const hit of lint) console.error(hit);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Declare the leaf and register the module**

In `lib/command-tree-def.ts`, inside `skills.subcommands` after `link`, add:

```ts
      expand: {
        description: "Paste mattstack attachments into hand-written skills: each {{include:<name>}} line in <src>/<skill>/SKILL.md is replaced and the result written to <out>/<skill>/",
        module: "./commands/skills-expand.ts",
        fn: "skillsExpand",
        args: [
          { name: "Source", flag: "--src", type: "text", placeholder: "apps/board/skills-src", hint: "Directory holding one skill dir per skill" },
          { name: "Output", flag: "--out", type: "text", placeholder: "apps/board/skills", hint: "Directory expand owns: every skill dir in it is regenerated or removed" },
          { name: "Mattstack dir", flag: "--mattstack-dir", type: "text", placeholder: ".", hint: "Resolve plugins from <dir>/plugins/<name> instead of the installed set" },
          { name: "Check", flag: "--check", type: "boolean", default: false, hint: "Compare the output to a fresh expansion and exit 1 on drift; write nothing" },
          { name: "Strict", flag: "--strict", type: "boolean", default: false, hint: "Fail on mcp-lint hits in the output (shell forms a mattstack tool covers)" },
          { name: "Dry run", flag: "--dry-run", type: "boolean", default: false, hint: "Print what would be written without touching disk" },
          SETUP_JSON_ARG,
        ],
      },
```

In `lib/module-registry.ts`, next to the other skills entries, add:

```ts
  "./commands/skills-expand.ts": () => import("../commands/skills-expand.ts"),
```

- [ ] **Step 5: Run the tests and the gates**

Run: `bun test commands/__tests__/skills-expand.test.ts`
Expected: PASS.

Run: `bun run picker:check`
Expected: no report for `skills expand` (it has no positional).

Run: `bun run docs:gen` then `bun run docs:check`
Expected: docs:check passes; `git status` shows regenerated files under `website/docs/reference/`.

Run: `bun test lib/__tests__/no-eager-tui.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/skills-expand.ts commands/__tests__/skills-expand.test.ts lib/command-tree-def.ts lib/module-registry.ts website/docs/reference
git commit -m "skills: add rt skills expand verb"
```

---

### Task 3: Move board's skills to `skills-src`, fix the prose, expand

**Files:**
- Move: `apps/board/skills/{review,respond,doctor,gate-cli-recipes}/` to `apps/board/skills-src/` (git mv)
- Move: `apps/board/skills/review/scripts/open-gate.test.ts` to `apps/board/src/__tests__/skills-open-gate.test.ts`
- Modify: `apps/board/skills-src/review/SKILL.md`, `apps/board/skills-src/respond/SKILL.md`, `apps/board/skills-src/doctor/SKILL.md`
- Create (generated): `apps/board/skills/**`
- Modify: `package.json` (two scripts), `apps/board/AGENTS.md:64`, `apps/board/README.md:115`, `apps/board/docs/agent-actions.md:68`

**Interfaces:**
- Consumes: `rt skills expand` (Task 2).
- Produces: `bun run skills:expand:board` and `bun run skills:check:board`; committed `apps/board/skills/*` with `board:<dir>` names.

- [ ] **Step 1: Move the source dirs**

Run, as four separate Bash calls:

```bash
git mv apps/board/skills apps/board/skills-src
```

```bash
git mv apps/board/skills-src/review/scripts/open-gate.test.ts apps/board/src/__tests__/skills-open-gate.test.ts
```

Then edit the moved test so its paths point at the sources:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SRC = join(import.meta.dir, '..', '..', 'skills-src');

test("the vendored open-gate.sh is byte-identical to board:respond's", () => {
  const review = readFileSync(join(SRC, 'review', 'scripts', 'open-gate.sh'));
  const respond = readFileSync(join(SRC, 'respond', 'scripts', 'open-gate.sh'));
  expect(review.equals(respond)).toBe(true);
});

test('board:review allows and names its vendored open-gate.sh', () => {
  const skill = readFileSync(join(SRC, 'review', 'SKILL.md'), 'utf8');
  expect(skill).toContain('Bash(${CLAUDE_SKILL_DIR}/scripts/open-gate.sh:*)');
  expect(skill).toContain(
    '"${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" <status-bin> <state> review-post <open-file>'
  );
  expect(skill).toContain(
    'whose path the domain skill handed back with the open file'
  );
});
```

Keep any further assertions the original file had below these, with the same `SRC` base. Run: `bun test apps/board/src/__tests__/skills-open-gate.test.ts` from `apps/board` (its suite runs from the app dir; see the repo note on board's preload). Expected: PASS.

- [ ] **Step 2: Add `disable-model-invocation` to the three wrappers**

In each of `apps/board/skills-src/review/SKILL.md`, `respond/SKILL.md`, `doctor/SKILL.md`, add the line `disable-model-invocation: true` directly after the `description:` block (before `allowed-tools:`). `gate-cli-recipes` already has it.

- [ ] **Step 3: Rewrite the gate-protocol passages**

There are seven passages. Each has two shapes. Replace them as follows, keeping the surrounding sentence flow.

Shape A (review 321-323, respond 298-300 and 462-464, doctor 142-144), currently:

```
follow `mattstack:gate-protocol`'s "Acting on the response" (form branch) and "CAS and the doorbell" sections (an attachment of the mattstack plugin, read from this checkout: `cat ${CLAUDE_SKILL_DIR}/../../../../plugins/mattstack/attachments/gate-protocol/SKILL.md`)
```

becomes:

```
follow the gate protocol included at the end of this skill: its "Present the in-pane gate form" and "Map the gate answer to exact option values" steps and its "Discard the form's gate answer; say which surface won" and "Doorbell" sections
```

Shape B (review 365-366, respond 604-605, doctor 237-238), currently:

```
Follow `mattstack:gate-protocol`'s "Answers are option values" and "CAS and the doorbell" sections (an attachment of the mattstack plugin, read from this checkout: `cat ${CLAUDE_SKILL_DIR}/../../../../plugins/mattstack/attachments/gate-protocol/SKILL.md`)
```

becomes:

```
Follow the included gate protocol's "Answers are option values", "Discard the form's gate answer; say which surface won" and "Doorbell" sections
```

Translation lines (review 330-332, respond 470-471, doctor around 148), currently of the form:

```
Its `rt gate answer <id> --answers ... --by pane` is this CLI's `<status-bin> gate answer <state> --answers <json> --by pane`, unchanged.
```

become:

```
Its `gate_answer {id, answers}` tool call is this CLI's `<status-bin> gate answer <state> --answers <json> --by pane`, unchanged.
```

Then confirm with `grep -n "plugins/mattstack\|Acting on\|CAS and\|rt gate answer" apps/board/skills-src/*/SKILL.md` that nothing remains. Expected: no output.

- [ ] **Step 4: Add the include line**

At the end of each of the three wrappers, after the last line of the `## Rules` section (review), the final rules list (respond), and the final section (doctor), append:

```markdown

## Gate protocol

The daemon-generic gate mechanics every passage above refers to. The board's
own projections (`<status-bin> gate ...`) sit in `board:gate-cli-recipes`;
everything else is here.

{{include:gate-protocol}}
```

- [ ] **Step 5: Add the package scripts and expand**

In `package.json` `scripts`, after `"picker:check"`, add:

```json
    "skills:expand:board": "bun cli.ts skills expand --src apps/board/skills-src --out apps/board/skills --mattstack-dir .",
    "skills:check:board": "bun cli.ts skills expand --src apps/board/skills-src --out apps/board/skills --mattstack-dir . --check --strict",
```

Run: `bun run skills:expand:board`
Expected: four `+` lines (doctor, gate-cli-recipes, respond, review).

Run: `bun run skills:check:board`
Expected: `expanded skills current (4)`, exit 0. If `--strict` reports mcp-lint hits on `<status-bin>` lines, add `<!-- mcp-lint: allow -->` at the end of each flagged line in the source, re-run expand, and re-check. Do not weaken the lint.

Run: `grep -c "part: include:gate-protocol" apps/board/skills/review/SKILL.md apps/board/skills/respond/SKILL.md apps/board/skills/doctor/SKILL.md`
Expected: `1` for each.

Run: `bun test lib/__tests__/deps-lock-live.test.ts`
Expected: PASS (names still `board:<dir>`, no dotted dirs).

- [ ] **Step 6: Point the docs at `skills-src`**

- `apps/board/AGENTS.md:64`: `skills/respond/SKILL.md` becomes `skills-src/respond/SKILL.md`. Add one paragraph to the same file, under its skills discussion: "`skills-src/` is the only place anyone edits a board skill. `skills/` is generated by `bun run skills:expand:board` (which pastes the mattstack `gate-protocol` attachment into the three wrappers) and committed; `bun run skills:check:board` fails on drift and runs in `bun run check`."
- `apps/board/README.md:115` and `apps/board/docs/agent-actions.md:68`: the symlinks are still made from `skills/`, so those lines stay; add after each: "`skills/` is generated from `skills-src/` by `bun run skills:expand:board` at the repo root."

- [ ] **Step 7: RED and GREEN with a fresh agent**

RED, before trusting the new text, using the old wrapper from `git show origin/main:apps/board/skills/review/SKILL.md` saved to the scratchpad: spawn one fresh subagent (Agent tool, `subagent_type: "general-purpose"`, model `opus`) with this prompt, substituting the scratchpad path:

```
You are a board review pane. Read only <path-to-old-SKILL.md>. You have reached the review-post gate and `<status-bin> gate open` printed {"gateId": "g1", "presentation": "form"}. In five sentences, say exactly what you do next and which file or skill you read to learn the form rules. Do not run anything.
```

Record the answer in your task report. Expected RED: the agent names the `cat ${CLAUDE_SKILL_DIR}/../../../../plugins/mattstack/...` path or the missing section names.

GREEN: the same prompt against `apps/board/skills/review/SKILL.md` (the expanded file). Expected: the agent describes presenting the in-pane form per the included protocol and names no external file. If it still reaches for a file outside the skill, fix the wording in `skills-src`, re-run expand, and repeat once.

- [ ] **Step 8: Commit**

```bash
git add -A apps/board package.json
git commit -m "board: skills expand from skills-src with gate-protocol included"
```

---

### Task 4: Always-run drift guard in `turbo:test`

**Files:**
- Create: `lib/__tests__/no-board-skills-drift.test.ts`
- Modify: `package.json` (`turbo:test` script)
- Modify: `turbo.json` (`//#turbo:test` inputs)
- Modify: `scripts/__tests__/turbo-inputs.test.ts:39-50`

**Interfaces:**
- Consumes: `expandSkills`, `checkExpanded` (Task 1); `resolvePluginRootsFromDir` (Task 1).
- Produces: a unit test that fails on drift between `apps/board/skills-src` plus `plugins/mattstack/attachments` and `apps/board/skills`, run by `bun run check` on every PR.

- [ ] **Step 1: Write the guard test**

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { checkExpanded, expandSkills } from "../skills/expand.ts";
import { resolvePluginRootsFromDir } from "../skills/sources.ts";

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "apps", "board", "skills-src");
const OUT = join(ROOT, "apps", "board", "skills");

// apps/board/skills is generated; this is the gate that keeps it current
// with skills-src and with the gate-protocol attachment it pastes in.
describe("board skills are expanded and current", () => {
  const skills = expandSkills({ srcDir: SRC, outDir: OUT, roots: resolvePluginRootsFromDir(ROOT) });

  test("no drift (run `bun run skills:expand:board` and commit apps/board/skills)", () => {
    expect(checkExpanded(OUT, skills)).toEqual([]);
  });

  for (const name of ["review", "respond", "doctor"]) {
    test(`${name} carries gate-protocol and no path into another artifact`, () => {
      const md = readFileSync(join(OUT, name, "SKILL.md"), "utf8");
      expect(md).toContain("<!-- part: include:gate-protocol source=mattstack:gate-protocol");
      expect(md).not.toContain("plugins/mattstack");
      expect(md).not.toContain("Documents/GitHub");
      expect(md).toContain("disable-model-invocation: true");
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `bun test lib/__tests__/no-board-skills-drift.test.ts`
Expected: PASS. Then edit `plugins/mattstack/attachments/gate-protocol/SKILL.md` (add a trailing line), run again, expect FAIL on `include`, and `git checkout plugins/mattstack/attachments/gate-protocol/SKILL.md` to restore.

- [ ] **Step 3: Wire it into the always-run root task**

`package.json` `turbo:test` gains ` ./lib/__tests__/no-board-skills-drift.test.ts` at the end of its file list.

`turbo.json` `//#turbo:test.inputs` gains:

```json
        "lib/__tests__/no-board-skills-drift.test.ts",
        "lib/skills/expand.ts",
        "lib/skills/placeholders.ts",
        "lib/skills/drift.ts",
        "$TURBO_ROOT$/apps/board/skills-src/**",
        "$TURBO_ROOT$/plugins/mattstack/attachments/**",
        "$TURBO_ROOT$/plugins/mattstack/.claude-plugin/plugin.json",
```

`scripts/__tests__/turbo-inputs.test.ts` gets a second test beside the deps.lock one:

```ts
test('the board skills drift guard runs in //#turbo:test and rehashes on its sources', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts['turbo:test'].split(' ')).toContain('./lib/__tests__/no-board-skills-drift.test.ts');
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  expect(turbo.tasks['//#turbo:test'].inputs).toEqual(
    expect.arrayContaining([
      'lib/__tests__/no-board-skills-drift.test.ts',
      'lib/skills/expand.ts',
      '$TURBO_ROOT$/apps/board/skills-src/**',
      '$TURBO_ROOT$/plugins/mattstack/attachments/**',
    ])
  );
});
```

Run: `bun run turbo:test`
Expected: PASS, including the new test. Run: `bun test scripts/__tests__/turbo-sh.test.ts scripts/__tests__/turbo-graph.test.ts`. Expected: PASS (the task list in `turbo.sh` did not change).

- [ ] **Step 4: Commit**

```bash
git add lib/__tests__/no-board-skills-drift.test.ts package.json turbo.json scripts/__tests__/turbo-inputs.test.ts
git commit -m "ci: guard board skills drift in the always-run turbo:test task"
```

---

### Task 5: `editing-skills` names expand; plugin version bump

**Files:**
- Modify: `plugins/mattstack/plugin/skills/editing-skills/SKILL.md` (new section after "When a pack compiles verbs from a shared engine")
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`version` patch bump)

**Interfaces:**
- Consumes: nothing from earlier tasks at run time; documents `rt skills expand`.
- Produces: the skill text below; the bumped version.

- [ ] **Step 0: Rebase**

Run `git fetch origin` then `git rebase origin/main`. eli's plugin 0.27.1 bump (#539) lands on main before this task; the bump below is relative to whatever `version` main has.

- [ ] **Step 1: RED**

Spawn one fresh subagent (general-purpose, `opus`) with the current editing-skills SKILL.md: "You maintain the board app's skills under apps/board. A board skill needs the mattstack plugin's gate-protocol rules. Using only this skill, say in three sentences how you would get that text into the board skill so it works from the app bundle." Expected RED: the agent proposes a relative path, a copy, or making board a pack. Record the answer.

- [ ] **Step 2: Add the section**

Use superpowers:writing-skills for this edit. Append after the "When a pack compiles verbs from a shared engine" section:

```markdown
## When a hand-written skill needs shared plugin text

A skill outside any pack (an app's launcher skills, say) that needs a
mattstack attachment does not become a pack. Its source dir carries
`{{include:<attachment>}}` alone on a line, and `rt skills expand` pastes
the attachment in and writes the result to a second dir the app ships:

`rt skills expand --src <app>/skills-src --out <app>/skills --mattstack-dir <monorepo root>` <!-- mcp-lint: allow -->

The frontmatter is copied as written (name, `allowed-tools`,
`disable-model-invocation`, metadata) with a `compiled:` stamp added; the
body gets the compiler's seam markers; files beside the source vendor at
the same path. `--check` fails on drift and is what CI runs. Nothing in the
output dir is edited by hand: expand regenerates or removes every dir in
it. No slots, no roster, no manifest: a skill with blanks to fill is a pack
verb and goes through `compile` instead.

The board's `apps/board/skills-src` is the first user; `bun run
skills:expand:board` and `bun run skills:check:board` wrap the flags.
```

- [ ] **Step 3: GREEN and certify**

Re-run the RED prompt against the edited skill. Expected: the agent names `rt skills expand` and the include line.

Run: `sh plugins/mattstack/tests/certify.sh plugins/mattstack/plugin/skills/editing-skills/`
Expected: no `FAIL` line. Fix what it names in the source; never the checker.

- [ ] **Step 4: Bump the version**

In `plugins/mattstack/.claude-plugin/plugin.json`, bump the patch component of `version` (for example `0.27.1` to `0.27.2`).

Run: `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack/plugin/skills/editing-skills/SKILL.md plugins/mattstack/.claude-plugin/plugin.json
git commit -m "editing-skills: hand-written skills with shared text use rt skills expand"
```

---

### Task 6: Full verification and PR

**Files:** none new.

- [ ] **Step 1: Run every gate**

Run, one per Bash call, from the repo root:

```bash
bun run test
```
Expected: PASS (rotating full-suite flakes are known; re-run a failing file alone before treating it as real).

```bash
bun run typecheck
```

```bash
bun run check
```
Expected: PASS, including `//#turbo:test` with the new guard.

```bash
bun run skills:check:board
```
Expected: `expanded skills current (4)`.

```bash
bash plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh
```
Expected: PASS (editing-skills' digraph is untouched).

- [ ] **Step 2: Confirm the bundle path is clean**

Run: `grep -rn "plugins/mattstack\|Documents/GitHub" apps/board/skills`
Expected: no output. Run: `find apps/board/skills -type d -name '*.*'`. Expected: no output (the bundle check refuses dotted dirs).

- [ ] **Step 3: Push and open the PR**

Push with the `git_push` MCP tool (`tree` = this worktree, `setUpstream: true`), then `gh pr create` against `main` titled `RT-358: board skills expand gate-protocol in at build time`. The body follows the repo's PR template if one exists, else:

```
Board's launcher skills named the mattstack plugin's gate-protocol by a path that only resolves from a source checkout. They now carry it: `rt skills expand` pastes the attachment into `apps/board/skills` from `apps/board/skills-src`, and an always-run test fails CI on drift.

### What changed

**rt skills expand** (`lib/skills/expand.ts`, `commands/skills-expand.ts`)

- Pastes `{{include:<attachment>}}` lines into hand-written skills; frontmatter verbatim plus a `compiled:` stamp
- `--check` reports drift by cause; `--strict` runs the mcp lint on the output
- Refuses a `${CLAUDE_SKILL_DIR}` path that leaves the output dir

**Board** (`apps/board/skills-src`, generated `apps/board/skills`)

- Sources move to `skills-src`; the three wrappers include gate-protocol and set `disable-model-invocation`
- Stale section cites and the `rt gate answer` translation lines updated to the current protocol
- `bun run skills:expand:board`, `bun run skills:check:board`

**CI**

- `lib/__tests__/no-board-skills-drift.test.ts` in the always-run `turbo:test` root task

**Also**

- editing-skills documents expand; plugin patch bump

### Verification

`bun run check` and `bun run test` green locally; a fresh agent given the expanded `board:review` at a form gate follows the included protocol and names no external file.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then wait for CodeRabbit and CI per the repo's PR rules.
