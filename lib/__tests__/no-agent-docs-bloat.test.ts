// lib/__tests__/no-agent-docs-bloat.test.ts
/**
 * Keeps the always-loaded agent instruction files small and the path-scoped
 * rules under .claude/rules/ loadable. Named no-* so it runs on every PR.
 * Design: docs/superpowers/specs/2026-10-12-agent-docs-routing-design.md
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const MAX_LINES = 200;
const ALWAYS_LOADED = ["AGENTS.md", "apps/AGENTS.md"];
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
  const hasRoot = existsSync(join(root, "AGENTS.md"));
  if (!hasRoot) found.push("AGENTS.md is missing. It is the one instruction file every session loads; restore it.");
  const index = hasRoot ? readFileSync(join(root, "AGENTS.md"), "utf8") : "";
  const indexed = new Set([...index.matchAll(/^\| `(\.claude\/rules\/[^`]+\.md)` \|/gm)].map((m) => m[1]!));
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

test("this repo's agent instruction files are within the caps and every rule can load", () => {
  expect(problems(ROOT)).toEqual([]);
});

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

  test("a rule named only in prose is not indexed", () => {
    const root = repo({
      "AGENTS.md": "# rt\n\nSee `.claude/rules/example.md` for an example.\n",
      ".claude/rules/example.md": rule("lib/**"),
      "lib/a.ts": "",
    });
    expect(problems(root)).toEqual([`.claude/rules/example.md is not in the index in AGENTS.md ("Rules that load with the code"). Add a row for it.`]);
    rmSync(root, { recursive: true });
  });

  test("a repo without its root instruction file is refused", () => {
    const root = repo({ "lib/a.ts": "" });
    expect(problems(root)).toEqual(["AGENTS.md is missing. It is the one instruction file every session loads; restore it."]);
    rmSync(root, { recursive: true });
  });

  test("an index row for a missing rule is refused", () => {
    const root = repo({ "AGENTS.md": indexRow(".claude/rules/gone.md") });
    expect(problems(root)).toEqual([`AGENTS.md indexes .claude/rules/gone.md, which does not exist. Remove the row or restore the file.`]);
    rmSync(root, { recursive: true });
  });
});
