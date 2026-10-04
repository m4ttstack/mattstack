import { test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { relative, resolve } from "path";

// Human output must go through lib/ui/out.ts. The allowlist may only shrink.
// Permanent stream seams require reasons and exact matching-line counts.
const ROOT = resolve(import.meta.dir, "..", "..");
const ALLOWLIST = resolve(import.meta.dir, "raw-output-allowlist.json");
const EXEMPTIONS = resolve(import.meta.dir, "raw-output-exemptions.json");
const SCAN_ROOTS = ["cli.ts", "commands", "lib"];

// The output layer and legacy color modules remain outside this scan.
const EXEMPT_DIRS = [/^lib\/ui\//, /^lib\/tui\//, /^lib\/ansi\.ts$/, /^lib\/tui\.ts$/];

const RAW = [/\bconsole\.(log|error|warn|info)\s*\(/, /\bprocess\.std(out|err)\b(?!\.(isTTY|columns|rows|fd|on|once|off|removeListener)\b)/, /from\s+["'][^"']*\/(ansi|tui|tui\/palette)\.ts["']/, /\\x1b\[|\\u001b\[/];

interface Exemption {
  file: string;
  reason: string;
  lines: number;
}

function collect(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    if (entry.name === "node_modules" || entry.name === "__tests__") return [];
    if (entry.isDirectory()) return collect(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function rawLines(file: string): number {
  return readFileSync(resolve(ROOT, file), "utf8")
    .split("\n")
    .filter((line) => RAW.some((re) => re.test(line))).length;
}

const exemptions = JSON.parse(readFileSync(EXEMPTIONS, "utf8")) as Exemption[];
const exempt = new Set(exemptions.map((e) => e.file));

function scanned(): string[] {
  return SCAN_ROOTS.flatMap((root) => collect(resolve(ROOT, root)))
    .map((file) => relative(ROOT, file))
    .filter((file) => !EXEMPT_DIRS.some((re) => re.test(file)))
    .sort();
}

function offenders(): string[] {
  return scanned().filter((file) => !exempt.has(file) && rawLines(file) > 0);
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

test("an exempt file holds exactly the raw lines its entry allows", () => {
  const drift = exemptions.filter((e) => rawLines(e.file) !== e.lines).map((e) => `${e.file}: entry says ${e.lines}, file has ${rawLines(e.file)}`);
  expect(drift).toEqual([]);
});

test("an exempt file that no longer prints raw is removed from the exemptions", () => {
  expect(exemptions.filter((e) => rawLines(e.file) === 0).map((e) => e.file)).toEqual([]);
});

test("no file is both exempt and allowlisted, and every exemption gives a reason", () => {
  expect(allowed.filter((file) => exempt.has(file))).toEqual([]);
  expect(exemptions.filter((e) => e.reason.trim().length < 20).map((e) => e.file)).toEqual([]);
});

test("the exemptions are sorted by file and have no duplicates", () => {
  const files = exemptions.map((e) => e.file);
  expect(files).toEqual([...new Set(files)].sort());
});
