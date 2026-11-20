/**
 * rt cd's worktree order lives in one place, `pickerOrder`
 * (lib/worktree-groups.ts). Every rt picker calls it, and the VS Code
 * extension gets its rows from the daemon's `worktrees:picker`, which calls
 * it too. Deck's go-live list is exempt on purpose: it sorts by recency.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dir, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__tests__" || name === "test") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = () =>
  ["cli.ts", ...walk(join(ROOT, "commands")), ...walk(join(ROOT, "lib")), ...walk(join(ROOT, "extensions/vscode/rt-context/src"))]
    .map((p) => (p.startsWith(ROOT) ? p : join(ROOT, p)));

describe("worktree order has one home", () => {
  test("only pickerOrder calls pickerWorktrees and groupWorktrees", () => {
    const offenders = files().filter((p) => {
      const rel = relative(ROOT, p);
      if (rel === "lib/worktree-groups.ts" || rel === "lib/repo-index.ts") return false;
      const src = readFileSync(p, "utf8");
      return /\bpickerWorktrees\(|\bgroupWorktrees\(/.test(src);
    });
    expect(offenders.map((p) => relative(ROOT, p))).toEqual([]);
  });

  test("the VS Code worktree picker never sorts trees itself", () => {
    for (const rel of ["extensions/vscode/rt-context/src/worktreeParse.ts", "extensions/vscode/rt-context/src/worktreePicker.ts"]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const sorts = src.split("\n").filter((l) => /\.sort\(/.test(l) && !/code-workspace/.test(l));
      expect({ rel, sorts }).toEqual({ rel, sorts: [] });
    }
  });
});
