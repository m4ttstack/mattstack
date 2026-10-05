import { test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { relative, resolve } from "path";

// Human output goes through lib/ui/out.ts. Exemptions must touch streams
// directly, with a reason and an exact matching-line count.
const ROOT = resolve(import.meta.dir, "..", "..");
const EXEMPTIONS = resolve(import.meta.dir, "raw-output-exemptions.json");
const SCAN_ROOTS = ["cli.ts", "commands", "lib"];

const LAYER = /^lib\/ui\//;

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

function offenders(): string[] {
  return SCAN_ROOTS.flatMap((root) => collect(resolve(ROOT, root)))
    .map((file) => relative(ROOT, file))
    .filter((file) => !LAYER.test(file) && !exempt.has(file) && rawLines(file) > 0)
    .sort();
}

test("no file outside the output layer and the exemptions prints raw: use lib/ui/out.ts", () => {
  expect(offenders()).toEqual([]);
});

test("an exempt file holds exactly the raw lines its entry allows", () => {
  const drift = exemptions.filter((e) => rawLines(e.file) !== e.lines).map((e) => `${e.file}: entry says ${e.lines}, file has ${rawLines(e.file)}`);
  expect(drift).toEqual([]);
});

test("an exempt file that no longer prints raw is removed from the exemptions", () => {
  expect(exemptions.filter((e) => rawLines(e.file) === 0).map((e) => e.file)).toEqual([]);
});

test("every exemption gives a reason, and the list is sorted with no duplicates", () => {
  expect(exemptions.filter((e) => e.reason.trim().length < 20).map((e) => e.file)).toEqual([]);
  const files = exemptions.map((e) => e.file);
  expect(files).toEqual([...new Set(files)].sort());
});
