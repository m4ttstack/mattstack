import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const ALLOWED = new Set(["lib/setup/plugin-calls.ts"]);
const PATTERN = /["']plugin["']\s*,\s*["'](install|update)["']/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("every claude plugin install/update argv is built by lib/setup/plugin-calls.ts", () => {
  const offenders = [...walk(join(ROOT, "lib"), []), ...walk(join(ROOT, "commands"), [])]
    .map((p) => relative(ROOT, p))
    .filter((rel) => !ALLOWED.has(rel) && PATTERN.test(readFileSync(join(ROOT, rel), "utf8")));
  expect(offenders).toEqual([]);
});
