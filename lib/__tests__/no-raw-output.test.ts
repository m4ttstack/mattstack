import { test, expect } from "bun:test";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { relative, resolve } from "path";

// Human output goes through lib/ui/out.ts. This list holds the files that
// still print by hand; it only ever shrinks, and it is empty when the
// conversion is done.
const ROOT = resolve(import.meta.dir, "..", "..");
const ALLOWLIST = resolve(import.meta.dir, "raw-output-allowlist.json");
const SCAN_ROOTS = ["commands", "lib"];

// The output layer itself, and the color modules it retires last.
const EXEMPT = [/^lib\/ui\//, /^lib\/tui\//, /^lib\/ansi\.ts$/, /^lib\/tui\.ts$/];

const RAW = [/\bconsole\.(log|error|warn|info)\s*\(/, /\bprocess\.std(out|err)\b(?!\.(isTTY|columns|rows|fd|on|once|off|removeListener)\b)/, /from\s+["'][^"']*\/(ansi|tui|tui\/palette)\.ts["']/, /\\x1b\[|\\u001b\[/];

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "__tests__") return [];
    if (entry.isDirectory()) return collect(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function offenders(): string[] {
  return SCAN_ROOTS.flatMap((root) => collect(resolve(ROOT, root)))
    .map((file) => relative(ROOT, file))
    .filter((file) => !EXEMPT.some((re) => re.test(file)))
    .filter((file) => RAW.some((re) => re.test(readFileSync(resolve(ROOT, file), "utf8"))))
    .sort();
}

if (process.env.RT_UPDATE_RAW_OUTPUT_ALLOWLIST) {
  writeFileSync(ALLOWLIST, JSON.stringify(offenders(), null, 2) + "\n");
}

const allowed = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as string[];

test("no file outside the allowlist prints raw: use lib/ui/out.ts", () => {
  const known = new Set(allowed);
  expect(offenders().filter((file) => !known.has(file))).toEqual([]);
});

test("the allowlist names only files that still print raw: delete the line when a file is converted", () => {
  const current = new Set(offenders());
  expect(allowed.filter((file) => !current.has(file))).toEqual([]);
});

test("the allowlist is sorted and has no duplicates", () => {
  expect(allowed).toEqual([...new Set(allowed)].sort());
});
