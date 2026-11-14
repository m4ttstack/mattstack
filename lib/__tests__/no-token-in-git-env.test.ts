import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { relative, resolve } from "path";

// A forge token reaches git through `rt git credential`, which reads it at
// call time, never through a child's env, where any process git starts can
// read it. Files that still do it are listed with a reason and an exact count.
const ROOT = resolve(import.meta.dir, "..", "..");
const EXEMPTIONS = resolve(import.meta.dir, "token-env-exemptions.json");
const SCAN_ROOTS = ["cli.ts", "commands", "lib"];

const TOKEN_IN_ENV = [/\bgitWithToken\s*\(/, /\bRT_GIT_(TOKEN|USER|HOST)\b/, /\bGIT_(PASSWORD|TOKEN)\b/, /extraheader/i];

/** A comment line is not counted, so trading one for a real call moves the count. */
const COMMENT = /^\s*(\/\/|\/?\*)/;

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

function tokenLines(file: string): number {
  return readFileSync(resolve(ROOT, file), "utf8")
    .split("\n")
    .filter((line) => !COMMENT.test(line) && TOKEN_IN_ENV.some((re) => re.test(line))).length;
}

const exemptions = JSON.parse(readFileSync(EXEMPTIONS, "utf8")) as Exemption[];
const exempt = new Set(exemptions.map((e) => e.file));

test("no file outside the exemptions passes a forge token to git through env: use rt git credential", () => {
  const offenders = SCAN_ROOTS.flatMap((root) => collect(resolve(ROOT, root)))
    .map((file) => relative(ROOT, file))
    .filter((file) => !exempt.has(file) && tokenLines(file) > 0)
    .sort();
  expect(offenders).toEqual([]);
});

test("an exempt file holds exactly the lines its entry allows", () => {
  const drift = exemptions.filter((e) => tokenLines(e.file) !== e.lines).map((e) => `${e.file}: entry says ${e.lines}, file has ${tokenLines(e.file)}`);
  expect(drift).toEqual([]);
});

test("an exempt file that no longer passes a token is removed from the exemptions", () => {
  expect(exemptions.filter((e) => tokenLines(e.file) === 0).map((e) => e.file)).toEqual([]);
});

test("every exemption gives a reason, and the list is sorted with no duplicates", () => {
  expect(exemptions.filter((e) => e.reason.trim().length < 20).map((e) => e.file)).toEqual([]);
  const files = exemptions.map((e) => e.file);
  expect(files).toEqual([...new Set(files)].sort());
});
