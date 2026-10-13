# Agent Docs Routing, PR 1 (Root File) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the always-loaded root `AGENTS.md` from 1,155 lines to under 200 by moving area rules, text unchanged, into path-scoped files under `.claude/rules/`, with a guard test that keeps it that way.

**Architecture:** A one-off split script (kept in the session scratchpad, never committed) copies fixed line ranges of the old root file into rule files with `paths:` frontmatter and rebuilds the root from the ranges it keeps plus a new index. A second one-off script proves no line was lost. A committed `no-*` guard test checks line caps, frontmatter, glob matches and index completeness on every PR.

**Tech Stack:** Bun, `bun:test`, `Bun.Glob`, Markdown.

**Spec:** `docs/superpowers/specs/2026-10-12-agent-docs-routing-design.md`

This is plan 1 of 3. Plan 2 covers `apps/AGENTS.md` and the herdr-chat shim; plan 3 is the dedupe pass. Each is written after the one before it merges.

## Global Constraints

- Moved text is unchanged. The only new lines are frontmatter, one `# ` title per rule file, and the root index section.
- Every file under `.claude/rules/` carries `paths:` frontmatter in exactly this form: `---`, `paths:`, one `  - "<glob>"` line per glob, `---`.
- Root `AGENTS.md` is at most 200 lines. Each rule file is at most 200 lines.
- No skill is edited. No new skill is added.
- No em dashes or en dashes in any new prose.
- Run `bun test` from the repo root only, and only the targeted files named here.
- In this worktree session, run each `git` command as its own plain command (no `&&`, no pipes, no `cd`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A `paths:` block written with unquoted globs or CRLF line endings: the guard must fail it with a message that shows the exact form, because Claude Code would otherwise load such a rule at launch. (Task 1 test.)
- A rule file in a subdirectory of `.claude/rules/` (plan 2 adds `apps/`): the guard must find it and the index must be able to name it. (Task 1 test.)
- A file of exactly 200 lines with a trailing newline must pass; 201 must fail. (Task 1 test.)
- A glob that matches only a directory, not a file: must fail, since a rule triggers on a file read. (Task 1 test.)
- An agent that plans a change from the root file alone: every rule must be named in the root index with the paths that load it. (Task 2, guard on the real tree.)

---

### Task 1: The guard test

**Files:**
- Create: `lib/__tests__/no-agent-docs-bloat.test.ts`

**Interfaces:**
- Produces: `problems(root: string): string[]` and `rulePaths(text: string): string[] | null`, both local to the test file. Task 2 adds one test that calls `problems(ROOT)`.

- [ ] **Step 1: Write the test file with its helpers and unit cases**

```ts
// lib/__tests__/no-agent-docs-bloat.test.ts
/**
 * Keeps the always-loaded agent instruction files small and the path-scoped
 * rules under .claude/rules/ loadable. Named no-* so it runs on every PR.
 * Design: docs/superpowers/specs/2026-10-12-agent-docs-routing-design.md
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";

const MAX_LINES = 200;
const ALWAYS_LOADED = ["AGENTS.md"];
const RULES_DIR = ".claude/rules";
const FRONTMATTER_FORM = '---\npaths:\n  - "lib/example/**"\n---';

function lineCount(text: string): number {
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

// A rule with frontmatter Claude Code cannot parse loads at launch, like a
// rule with no paths at all, so anything but the exact form is refused.
function rulePaths(text: string): string[] | null {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!block) return null;
  const lines = block[1]!.split("\n");
  if (lines[0] !== "paths:" || lines.length < 2) return null;
  const globs = lines.slice(1).map((line) => /^  - "([^"]+)"$/.exec(line)?.[1]);
  return globs.every((glob) => glob !== undefined) ? (globs as string[]) : null;
}

function matchesAFile(root: string, glob: string): boolean {
  const scan = new Bun.Glob(glob).scanSync({ cwd: root, dot: true, onlyFiles: true });
  return !scan.next().done;
}

function ruleFiles(root: string, dir = join(root, RULES_DIR)): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ruleFiles(root, path);
    return name.endsWith(".md") ? [relative(root, path)] : [];
  });
}

function problems(root: string): string[] {
  const found: string[] = [];
  const capped = [...ALWAYS_LOADED.filter((file) => existsSync(join(root, file))), ...ruleFiles(root)];
  for (const file of capped) {
    const lines = lineCount(readFileSync(join(root, file), "utf8"));
    if (lines > MAX_LINES) {
      found.push(`${file} is ${lines} lines; the cap is ${MAX_LINES}. Move rules for one area into their own file under ${RULES_DIR}/.`);
    }
  }
  for (const file of ruleFiles(root)) {
    const globs = rulePaths(readFileSync(join(root, file), "utf8"));
    if (!globs) {
      found.push(`${file} has no readable paths: frontmatter, so it would load in every session. Start it with:\n${FRONTMATTER_FORM}`);
      continue;
    }
    for (const glob of globs) {
      if (!matchesAFile(root, glob)) found.push(`${file}: the glob "${glob}" matches no file, so the rule can never load for it. Fix or remove the glob.`);
    }
  }
  const index = existsSync(join(root, "AGENTS.md")) ? readFileSync(join(root, "AGENTS.md"), "utf8") : "";
  const indexed = new Set([...index.matchAll(/`(\.claude\/rules\/[^`]+\.md)`/g)].map((m) => m[1]!));
  const present = new Set(ruleFiles(root));
  for (const file of present) {
    if (!indexed.has(file)) found.push(`${file} is not in the index in AGENTS.md ("Rules that load with the code"). Add a row for it.`);
  }
  for (const file of indexed) {
    if (!present.has(file)) found.push(`AGENTS.md indexes ${file}, which does not exist. Remove the row or restore the file.`);
  }
  return found;
}

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "agent-docs-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const rule = (glob: string) => `---\npaths:\n  - "${glob}"\n---\n\n# Example\n\nA rule.\n`;
const indexRow = (file: string) => `| \`${file}\` | example | \`lib/**\` |\n`;

describe("problems", () => {
  test("a small root, one indexed rule and a matching glob pass", () => {
    const root = repo({
      "AGENTS.md": `# rt\n\n${indexRow(".claude/rules/example.md")}`,
      ".claude/rules/example.md": rule("lib/**"),
      "lib/a.ts": "export {};\n",
    });
    expect(problems(root)).toEqual([]);
    rmSync(root, { recursive: true });
  });

  test("exactly 200 lines passes and 201 fails", () => {
    const at = repo({ "AGENTS.md": "x\n".repeat(200) });
    const over = repo({ "AGENTS.md": "x\n".repeat(201) });
    expect(problems(at)).toEqual([]);
    expect(problems(over)).toEqual([`AGENTS.md is 201 lines; the cap is 200. Move rules for one area into their own file under .claude/rules/.`]);
    rmSync(at, { recursive: true });
    rmSync(over, { recursive: true });
  });

  test("a rule without frontmatter, with unquoted globs or with CRLF is refused", () => {
    for (const text of ["# No frontmatter\n", "---\npaths:\n  - lib/**\n---\n\n# Unquoted\n", '---\r\npaths:\r\n  - "lib/**"\r\n---\r\n\r\n# CRLF\r\n']) {
      const root = repo({ "AGENTS.md": indexRow(".claude/rules/example.md"), ".claude/rules/example.md": text, "lib/a.ts": "" });
      expect(problems(root)).toHaveLength(1);
      expect(problems(root)[0]).toContain("has no readable paths: frontmatter");
      rmSync(root, { recursive: true });
    }
  });

  test("a glob that matches no file, or only a directory, is refused", () => {
    const root = repo({
      "AGENTS.md": indexRow(".claude/rules/example.md"),
      ".claude/rules/example.md": '---\npaths:\n  - "lib/gone/**"\n  - "lib/empty"\n---\n\n# Example\n',
      "lib/empty/keep/a.ts": "",
    });
    expect(problems(root)).toEqual([
      `.claude/rules/example.md: the glob "lib/gone/**" matches no file, so the rule can never load for it. Fix or remove the glob.`,
      `.claude/rules/example.md: the glob "lib/empty" matches no file, so the rule can never load for it. Fix or remove the glob.`,
    ]);
    rmSync(root, { recursive: true });
  });

  test("a rule in a subdirectory is found and must be indexed by its full path", () => {
    const root = repo({ "AGENTS.md": "# rt\n", ".claude/rules/apps/kit.md": rule("lib/**"), "lib/a.ts": "" });
    expect(problems(root)).toEqual([`.claude/rules/apps/kit.md is not in the index in AGENTS.md ("Rules that load with the code"). Add a row for it.`]);
    rmSync(root, { recursive: true });
  });

  test("an index row for a missing rule is refused", () => {
    const root = repo({ "AGENTS.md": indexRow(".claude/rules/gone.md") });
    expect(problems(root)).toEqual([`AGENTS.md indexes .claude/rules/gone.md, which does not exist. Remove the row or restore the file.`]);
    rmSync(root, { recursive: true });
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun test lib/__tests__/no-agent-docs-bloat.test.ts`
Expected: 6 pass. If the CRLF case reports 0 problems, `rulePaths` is accepting `\r`; the regex above must not.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/no-agent-docs-bloat.test.ts
```
```bash
git commit -m "test: guard for agent instruction file size and rule frontmatter"
```

---

### Task 2: Split the root file

**Files:**
- Modify: `.gitignore:2`
- Modify: `AGENTS.md` (rebuilt)
- Create: `.claude/rules/*.md` (20 files, listed in the manifest below)
- Modify: `lib/__tests__/no-agent-docs-bloat.test.ts` (add the real-tree test)
- Modify: `lib/__tests__/no-nested-team-pack.test.ts:38`
- Modify: `scripts/ci/__tests__/test-scope.test.ts` (one case)
- Scratch, not committed: `$SCRATCH/split-root.ts`, `$SCRATCH/verify-move.ts`, `$SCRATCH/root.before.md`

`$SCRATCH` is the session scratchpad directory.

**Interfaces:**
- Consumes: `problems(root)` from Task 1.
- Produces: the index section heading `## Rules that load with the code` in root `AGENTS.md`, which plan 2 appends rows to.

- [ ] **Step 1: Add the failing real-tree test**

Append to `lib/__tests__/no-agent-docs-bloat.test.ts`, and add `resolve` to the `path` import:

```ts
const ROOT = resolve(import.meta.dir, "..", "..");

test("this repo's agent instruction files are within the caps and every rule can load", () => {
  expect(problems(ROOT)).toEqual([]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test lib/__tests__/no-agent-docs-bloat.test.ts`
Expected: FAIL with `AGENTS.md is 1155 lines; the cap is 200.`

- [ ] **Step 3: Track the rules directory**

In `.gitignore`, replace line 2 (`.claude/`) with:

```
.claude/*
!.claude/rules/
```

- [ ] **Step 4: Snapshot the old root file**

```bash
cp AGENTS.md "$SCRATCH/root.before.md"
```

Confirm it is the file the ranges below were measured on: `wc -l "$SCRATCH/root.before.md"` prints `1155`, and `sed -n 267p` prints `## Output layer`. If either differs, `main` has moved: re-measure every range with `grep -n -E '^#{1,3} ' AGENTS.md` before going on.

- [ ] **Step 5: Write the split script**

`$SCRATCH/split-root.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const [before, repo] = process.argv.slice(2) as [string, string];
const src = readFileSync(before, "utf8").split("\n");

type Range = [number, number];
type Rule = { file: string; title: string; covers: string; paths: string[]; ranges: Range[] };

const slice = (ranges: Range[]) =>
  ranges
    .map(([from, to]) => src.slice(from - 1, to).join("\n").replace(/\n+$/, ""))
    .join("\n\n");

const RULES: Rule[] = [
  {
    file: "settings.md",
    title: "Settings",
    covers: "Settings stores, the org clone and its layout, org naming",
    paths: ["packages/rt-client/src/settings/**", "lib/team/**", "packages/settings-kit/**", "scripts/move-*.ts"],
    ranges: [[11, 88]],
  },
  {
    file: "worktree-pool.md",
    title: "Worktree pool",
    covers: "The golden tree and hydration traps",
    paths: ["lib/worktree/**"],
    ranges: [[127, 149]],
  },
  {
    file: "chat.md",
    title: "rt chat",
    covers: "Reading order before touching chat",
    paths: ["commands/chat.ts", "lib/state/chat-store.ts", "lib/chat-viewer-url.ts", "lib/daemon/handlers/chat.ts"],
    ranges: [[150, 172]],
  },
  {
    file: "build-and-plugin.md",
    title: "Build and the mattstack plugin",
    covers: "The mattstack plugin's checks, the bytecode compile fallback",
    paths: ["plugins/mattstack/**", "lib/skills/**", "scripts/build*", ".github/workflows/release.yml"],
    ranges: [[173, 186], [1131, 1134]],
  },
  {
    file: "rt-ui.md",
    title: "rt-ui",
    covers: "The Go helper, pickers, the runner, shared primitives",
    paths: ["ui/**", "lib/ui/**", "lib/runner/**", "lib/pick-wrappers.ts", "commands/runner.ts"],
    ranges: [[187, 238]],
  },
  {
    file: "glitter.md",
    title: "Glitter",
    covers: "GitHub Desktop as the authority, the staging model",
    paths: ["lib/mission/**", "ui/internal/views/mission/**", "docs/design/mission/**", "commands/glitter.ts"],
    ranges: [[239, 266]],
  },
  {
    file: "output-layer.md",
    title: "Output layer",
    covers: "Everything rt prints: the five rules, failures, the raw-output guard, warnings, UI-free CLI",
    paths: ["cli.ts", "commands/**", "lib/**"],
    ranges: [[267, 330], [348, 383], [401, 411], [424, 435], [472, 487], [565, 579], [591, 601]],
  },
  {
    file: "output-rendering.md",
    title: "Output layer: how rt-ui draws it",
    covers: "Breadcrumb, transient steps, wrapping, steps, stacked tables",
    paths: ["lib/ui/**", "ui/**", "lib/command-tree.ts"],
    ranges: [[384, 400], [412, 423], [465, 471], [526, 528], [580, 583]],
  },
  {
    file: "output-git-verbs.md",
    title: "Output layer: git verbs and sync",
    covers: "How the git verbs, `rt sync` and `rt git rebase` fail and refuse",
    paths: ["commands/git/**", "commands/sync.ts", "lib/mcp/git-tools.ts"],
    ranges: [[436, 464]],
  },
  {
    file: "output-agent-verbs.md",
    title: "Output layer: verbs agents read",
    covers: "Frozen bytes for chat, herd, pane, agent and the agent-only verbs; `rt cd` and `rt nav`",
    paths: ["commands/chat.ts", "commands/herd.ts", "commands/pane.ts", "commands/agent*.ts", "commands/gate.ts", "commands/events.ts", "commands/ci.ts", "commands/mcp.ts", "commands/runs*.ts", "commands/worktree-hook.ts", "commands/cd.ts", "commands/nav.ts"],
    ranges: [[488, 500], [529, 540], [548, 554], [584, 590]],
  },
  {
    file: "output-setup-and-services.md",
    title: "Output layer: setup, sdm, daemon and service verbs",
    covers: "The setup emitter, streamed child output, daemon and service verb output",
    paths: ["lib/setup/**", "commands/setup.ts", "commands/uninstall.ts", "commands/sdm.ts", "commands/home.ts", "commands/release.ts", "lib/release/**", "commands/daemon.ts", "commands/services.ts", "commands/apps.ts", "commands/flavor.ts", "commands/bg.ts", "commands/cron.ts", "commands/reconciler.ts", "commands/endpoint.ts", "commands/intercept.ts"],
    ranges: [[331, 347], [501, 525], [541, 547], [555, 564]],
  },
  {
    file: "command-tree.md",
    title: "Command tree",
    covers: "Plain-language descriptions, the module registry, `omitBehavior`",
    paths: ["lib/command-tree*.ts", "lib/module-registry.ts", "scripts/lib/picker-conformance.ts", "cli.ts"],
    ranges: [[602, 622], [1068, 1073], [1135, 1155]],
  },
  {
    file: "daemon.md",
    title: "Daemon",
    covers: "Logging seams, the relocation prompt parser",
    paths: ["lib/daemon/**", "lib/daemon.ts", "lib/daemon-logger.ts", "rt-tray/Sources/TrayLog.swift", "rt-tray/Sources/TrayServer.swift"],
    ranges: [[635, 651], [886, 915]],
  },
  {
    file: "mcp-and-gates.md",
    title: "MCP tools and gates",
    covers: "`rt_verb`, the tool roster and its guards, decision gates, baseline permissions",
    paths: ["lib/mcp/**", "commands/mcp.ts", "commands/gate.ts", "lib/setup/base-permissions.ts", "lib/setup/claude-permissions.ts", "lib/daemon/forge-reads.ts", "lib/daemon/upload-guard.ts"],
    ranges: [[652, 748], [868, 885]],
  },
  {
    file: "team-switchboard.md",
    title: "Switchboard and team join",
    covers: "Invite, join, peer and the board-peering row",
    paths: ["lib/team/**", "packages/rt-client/src/switchboard.ts", "lib/setup/validators/accounts.ts", "commands/team.ts"],
    ranges: [[749, 794]],
  },
  {
    file: "setup.md",
    title: "Setup",
    covers: "Writing-style presets, checklist rows, setup after an update, migrations",
    paths: ["lib/setup/**", "lib/skills/writing-style.ts", "commands/setup.ts", "commands/skills-writing-style.ts", "rt-tray/Sources-core/Contract/PlanModels.swift"],
    ranges: [[795, 867]],
  },
  {
    file: "state.md",
    title: "State",
    covers: "State backup, claiming `SCHEMA_VERSION`",
    paths: ["lib/state/**", "commands/state*.ts"],
    ranges: [[916, 931], [1074, 1098]],
  },
  {
    file: "dev-app.md",
    title: "The running dev app",
    covers: "How a change reaches the dev app: served apps, manifests, tray rebuilds",
    paths: ["rt-tray/**", "apps/deck/**", "apps/*/mattstack.deck.json", "lib/release/update-machine.ts"],
    ranges: [[967, 1002]],
  },
  {
    file: "ci-and-tests.md",
    title: "CI shards and test scope",
    covers: "How CI shards and scopes the unit suite, `no-*` naming, timings",
    paths: ["scripts/ci/**", ".github/workflows/checks.yml", "test-timings.json", "lib/__tests__/no-*.test.ts", "commands/__tests__/no-*.test.ts", "scripts/__tests__/no-*.test.ts", "e2e/**"],
    ranges: [[1014, 1038]],
  },
  {
    file: "workspace-packages.md",
    title: "Workspace packages",
    covers: "Private packages, stale `dist/` in rt-client and glance",
    paths: ["packages/rt-client/**", "packages/glance/**", "packages/settings-kit/**", "packages/tui-kit/**"],
    ranges: [[1099, 1130]],
  },
];

const ROOT_KEEP_HEAD: Range[] = [[1, 10]];
const ROOT_KEEP_TAIL: Range[] = [[89, 126], [623, 634], [932, 966], [1003, 1013], [1039, 1067]];

const rulesDir = join(repo, ".claude", "rules");
mkdirSync(rulesDir, { recursive: true });
for (const rule of RULES) {
  const frontmatter = ["---", "paths:", ...rule.paths.map((p) => `  - "${p}"`), "---"].join("\n");
  writeFileSync(join(rulesDir, rule.file), `${frontmatter}\n\n# ${rule.title}\n\n${slice(rule.ranges)}\n`);
}

const index = [
  "## Rules that load with the code",
  "",
  "Most of this repo's rules live in `.claude/rules/`. Each file loads by",
  "itself when you read or edit a file matching its paths; a search does not",
  "load it. Planning a change in an area before you have opened a file",
  "there? Read its rule file first.",
  "",
  "| Rule | Covers | Loads for |",
  "|---|---|---|",
  ...RULES.map((r) => `| \`.claude/rules/${r.file}\` | ${r.covers} | ${r.paths.slice(0, 3).map((p) => `\`${p}\``).join(", ")}${r.paths.length > 3 ? ", more in the file" : ""} |`),
].join("\n");

writeFileSync(join(repo, "AGENTS.md"), `${slice(ROOT_KEEP_HEAD)}\n\n${index}\n\n${slice(ROOT_KEEP_TAIL)}\n`);

const covered = [...ROOT_KEEP_HEAD, ...ROOT_KEEP_TAIL, ...RULES.flatMap((r) => r.ranges)].sort((a, b) => a[0] - b[0]);
let next = 1;
for (const [from, to] of covered) {
  if (from !== next) throw new Error(`lines ${next}-${from - 1} are assigned to no file, or overlap`);
  next = to + 1;
}
if (next !== src.length) throw new Error(`ranges end at ${next - 1}; the file has ${src.length - 1} lines`);
```

The last block is the first safety net: every source line belongs to exactly one range, with no gap and no overlap, or the script throws after writing nothing useful. Fix the ranges, restore `AGENTS.md` from the snapshot, and rerun.

- [ ] **Step 6: Run the split**

```bash
bun "$SCRATCH/split-root.ts" "$SCRATCH/root.before.md" "$PWD"
```

Expected: no output, 20 files in `.claude/rules/`, and `wc -l AGENTS.md` under 200.

- [ ] **Step 7: Prove no line was lost**

`$SCRATCH/verify-move.ts`:

```ts
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const [before, repo] = process.argv.slice(2) as [string, string];
const count = (lines: string[]) => {
  const seen = new Map<string, number>();
  for (const line of lines) if (line.trim() !== "") seen.set(line, (seen.get(line) ?? 0) + 1);
  return seen;
};

const rulesDir = join(repo, ".claude", "rules");
const after = [join(repo, "AGENTS.md"), ...readdirSync(rulesDir).map((f) => join(rulesDir, f))].flatMap((f) => readFileSync(f, "utf8").split("\n"));
const was = count(readFileSync(before, "utf8").split("\n"));
const now = count(after);

const missing = [...was].filter(([line, n]) => (now.get(line) ?? 0) < n).map(([line]) => line);
const added = [...now].filter(([line, n]) => n > (was.get(line) ?? 0)).map(([line]) => line);
const expected = (line: string) =>
  line === "---" || line === "paths:" || /^  - "/.test(line) || /^# /.test(line) || /^\| `\.claude\/rules\//.test(line) ||
  ["## Rules that load with the code", "| Rule | Covers | Loads for |", "|---|---|---|"].includes(line) ||
  /^(Most of this repo's rules|itself when you read|load it\. Planning|there\? Read its rule)/.test(line);

console.log(`missing: ${missing.length}`);
for (const line of missing) console.log(`  - ${line}`);
const surprises = added.filter((line) => !expected(line));
console.log(`unexpected additions: ${surprises.length}`);
for (const line of surprises) console.log(`  + ${line}`);
process.exit(missing.length + surprises.length === 0 ? 0 : 1);
```

Run: `bun "$SCRATCH/verify-move.ts" "$SCRATCH/root.before.md" "$PWD"`
Expected: `missing: 0` and `unexpected additions: 0`, exit 0. The old file's own `# rt (repo tools)` title is in the kept head, so it is not an addition.

- [ ] **Step 8: Run the guard and fix what it names**

Run: `bun test lib/__tests__/no-agent-docs-bloat.test.ts`
Expected: PASS. Likely first-run failures and their fixes, all made in the manifest, followed by a rerun of steps 6 and 7 (restore `AGENTS.md` from the snapshot first):
- "the glob ... matches no file": the file was renamed or the guess was wrong. Find the real path with `ls`, correct the glob, or drop it if the area has no such file.
- "... is N lines; the cap is 200": split that rule's ranges into two rules by paragraph.

- [ ] **Step 9: Read every rule file's first 15 lines**

Check each opens with frontmatter, a title, and a paragraph that makes sense with nothing above it. A rule that starts mid-thought (its first paragraph says "it" or "the same rule" about something left behind) needs its range moved to start at the paragraph that introduces the subject; adjust the manifest and rerun steps 6 to 8.

- [ ] **Step 10: Keep the moved text under the team-pack doc scan**

In `lib/__tests__/no-nested-team-pack.test.ts` line 38, change

```ts
const DOC_SCAN = ["docs", "website/docs", "plugins/mattstack", "skills", "AGENTS.md"];
```

to

```ts
const DOC_SCAN = ["docs", "website/docs", "plugins/mattstack", "skills", "AGENTS.md", ".claude/rules"];
```

Run: `bun test lib/__tests__/no-nested-team-pack.test.ts`
Expected: PASS.

- [ ] **Step 11: Pin the CI scope of a rules-only PR**

In `scripts/ci/__tests__/test-scope.test.ts`, next to the existing case at line 61 (`expect(decide(pr(["docs/architecture.md", "AGENTS.md"])).mode).toBe("skip");`), add:

```ts
  test("a PR that only moves agent rules skips the unit shards", () => {
    expect(decide(pr([".claude/rules/output-layer.md", "AGENTS.md"])).mode).toBe("skip");
  });
```

Run: `bun test scripts/ci/__tests__/test-scope.test.ts`
Expected: PASS. If it reports `full`, read which source `readBy` matched (the `reason` on the decision) and report it: the guard is named `no-*` precisely so it does not count.

- [ ] **Step 12: Commit**

```bash
git add .gitignore AGENTS.md .claude/rules lib/__tests__/no-agent-docs-bloat.test.ts lib/__tests__/no-nested-team-pack.test.ts scripts/ci/__tests__/test-scope.test.ts
```
```bash
git commit -m "docs: move root AGENTS.md area rules into path-scoped .claude/rules"
```

---

### Task 3: Confirm the rules load, then open the PR

**Files:**
- None changed unless a check fails.

- [ ] **Step 1: Confirm a rule loads on a matching read and not before**

From the worktree root, in a fresh non-interactive session:

```bash
claude -p "Do not read any file yet. Quote the first heading of every instruction file you were given that mentions 'Coral is for failures'. Then read lib/ui/out.ts and answer the same question again. Reply as two lines: BEFORE: and AFTER:."
```

Expected: `BEFORE:` names nothing; `AFTER:` names "Output layer". If `BEFORE:` already quotes it, a rule is loading at launch: check its frontmatter by hand against Global Constraints. If `AFTER:` names nothing, path-scoped rules are not loading from this checkout: stop and report, since the design depends on it.

- [ ] **Step 2: Record the sizes**

```bash
wc -l -c "$SCRATCH/root.before.md" AGENTS.md
```

Keep both lines for the PR description.

- [ ] **Step 3: Run the purity gate and the three touched tests together**

```bash
bun run purity
```
```bash
bun test lib/__tests__/no-agent-docs-bloat.test.ts lib/__tests__/no-nested-team-pack.test.ts scripts/ci/__tests__/test-scope.test.ts
```

Expected: both pass.

- [ ] **Step 4: Push and open the PR**

Title: `docs: route root AGENTS.md rules by path`. Body: one framing sentence, the before and after sizes from step 2, the result of step 1, and a link to the spec. Then follow the repo's standing PR rule: wait for CodeRabbit and green CI, address findings, and merge only with Matt's confirmation.
