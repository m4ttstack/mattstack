/**
 * Source guard: settings are read with getSetting and written with
 * setSetting/unsetSetting. Per-rung reads, the raw store reader and the store
 * files themselves are for the resolver and for the listed callers that
 * genuinely need them, and each allowlist entry pins how many times its file
 * reaches for them, so a new use in an already-listed file still fails.
 *
 * test-scope.ts skips the unit shards on an apps- or plugins-only PR, so this
 * file also runs in the always-run //#turbo:test root task, whose turbo.json
 * inputs must cover every scanned root.
 */

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, resolve } from "path";
import ts from "typescript";

const ROOT = resolve(import.meta.dir, "..", "..");

type Rule = "per-rung reader" | "store file" | "raw store reader" | "store path helper";

const IDENTIFIER_RULES = new Map<string, Rule>(Object.entries({
  explainSetting: "per-rung reader",
  repoSectionsFor: "per-rung reader",
  readSection: "per-rung reader",
  storeSections: "per-rung reader",
  mergedValueWith: "per-rung reader",
  currentMergedValue: "per-rung reader",
  readStore: "raw store reader",
  readStores: "raw store reader",
  userSettingsPath: "store path helper",
  teamSettingsPath: "store path helper",
  machineSettingsPath: "store path helper",
} satisfies Record<string, Rule>));

const STORE_FILE_TEXT = [/settings\.(?:user|team|local)\.jsonc/, /settings\.\$\{/];

const SCAN_ROOTS = ["commands", "lib", "scripts", "cli.ts", "apps", "packages", "extensions", "plugins"];
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-bin", "build", ".turbo", ".next", "fixtures", "test", "tests", "__tests__"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"]);
const EXCLUDED_PREFIXES = ["packages/rt-client/src/settings/", "lib/rt-paths.ts"];

interface Allowed {
  count: number;
  reason: string;
}

const ROSTER_READ = "reads one team's own roster; getSetting merges every team store and has no per-team read";

const ALLOWLIST: Record<Rule, Record<string, Allowed>> = {
  "per-rung reader": {
    "commands/settings-keys.ts": { count: 2, reason: "`rt settings explain` prints every rung" },
    "commands/worktree-hook.ts": { count: 2, reason: "claudeHook is read from the machine rung only" },
    "lib/worktree/config.ts": { count: 3, reason: "declared-presence check and ready-ladder owner need per-rung presence" },
    "lib/worktree/ready-approval.ts": { count: 2, reason: "approval is trusted only from user.repo/machine.repo rungs, never a team rung" },
    "packages/settings-kit/src/server.ts": { count: 15, reason: "the console's scope-chain editor shows every rung and every repo section" },
    "packages/rt-client/src/index.ts": { count: 6, reason: "rt-client's public entry re-exports the resolver" },
  },
  "store file": {
    "commands/home.ts": { count: 1, reason: "existence probe listing adoptable machine profiles" },
    "lib/command-tree-def.ts": { count: 6, reason: "help hints naming where --scope writes" },
    "lib/home/init-exec.ts": { count: 1, reason: "assertNotRealStoreInTest guard before home init seeds the user store" },
    "lib/team/create.ts": { count: 2, reason: "scaffolds a new team's store and guards it with assertNotRealStoreInTest" },
    "lib/team/join.ts": { count: 1, reason: "assertNotRealStoreInTest guard before join seeds the team store" },
    "lib/setup/team-settings.ts": { count: 1, reason: "existence probe discovering cloned teams through the Probes seam" },
    "lib/skills/init.ts": { count: 1, reason: "reads each team zone's own forge host; getSetting merges every team store and has no per-team read" },
  },
  "raw store reader": {
    "commands/team.ts": { count: 2, reason: ROSTER_READ },
    "lib/team/invite.ts": { count: 2, reason: ROSTER_READ },
    "lib/team/members.ts": { count: 2, reason: ROSTER_READ },
    "packages/rt-client/src/index.ts": { count: 1, reason: "rt-client's public entry re-exports the resolver" },
  },
  "store path helper": {
    "commands/team.ts": { count: 2, reason: "names the one team store its roster read targets" },
    "lib/team/invite.ts": { count: 2, reason: "names the one team store its roster read targets" },
    "lib/team/members.ts": { count: 2, reason: "names the one team store its roster read targets" },
    "lib/endpoint/shim.ts": { count: 6, reason: "mtime staleness probe over the store files intercept rules came from" },
    "lib/repo-reidentify.ts": { count: 8, reason: "renames a repo's section in every store file" },
    "lib/repo-tracking.ts": { count: 3, reason: "refuses to move a tracking grant over an unparseable machine store" },
  },
};

export interface Hit {
  line: number;
  rule: Rule;
  text: string;
}

const REGEX_AFTER_PAREN = new Set([ts.SyntaxKind.IfKeyword, ts.SyntaxKind.WhileKeyword, ts.SyntaxKind.ForKeyword, ts.SyntaxKind.WithKeyword]);

/** Whether a `/` after this token starts a regex rather than a division. */
function regexCanFollow(prev: ts.SyntaxKind | undefined, parenOpenedByKeyword: boolean): boolean {
  if (prev === undefined) return true;
  if (prev === ts.SyntaxKind.CloseParenToken) return parenOpenedByKeyword;
  if (prev === ts.SyntaxKind.CloseBracketToken || prev === ts.SyntaxKind.CloseBraceToken) return false;
  if (prev === ts.SyntaxKind.Identifier || prev === ts.SyntaxKind.PrivateIdentifier) return false;
  if (prev >= ts.SyntaxKind.FirstLiteralToken && prev <= ts.SyntaxKind.LastTemplateToken) return false;
  if (prev === ts.SyntaxKind.ThisKeyword || prev === ts.SyntaxKind.SuperKeyword) return false;
  if (prev === ts.SyntaxKind.TrueKeyword || prev === ts.SyntaxKind.FalseKeyword || prev === ts.SyntaxKind.NullKeyword) return false;
  if (prev === ts.SyntaxKind.PlusPlusToken || prev === ts.SyntaxKind.MinusMinusToken) return false;
  return true;
}

/** Every bypass in code, found by the TypeScript scanner so comments never count. */
export function findBypasses(src: string, fileName = "x.ts"): Hit[] {
  const variant = /\.[jt]sx$/.test(fileName) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, variant, src);
  const hits: Hit[] = [];
  const lineOf = (pos: number) => src.slice(0, pos).split("\n").length;
  const templateBraceDepth: number[] = [];
  const parenKeyword: boolean[] = [];
  let braceDepth = 0;
  let prev: ts.SyntaxKind | undefined;
  let prevPrev: ts.SyntaxKind | undefined;
  let lastParenByKeyword = false;

  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) {
      if (regexCanFollow(prev, lastParenByKeyword)) kind = scanner.reScanSlashToken();
    } else if (kind === ts.SyntaxKind.OpenBraceToken) {
      braceDepth++;
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      if (templateBraceDepth.length > 0 && templateBraceDepth[templateBraceDepth.length - 1] === braceDepth) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateTail) templateBraceDepth.pop();
      } else {
        braceDepth--;
      }
    } else if (kind === ts.SyntaxKind.TemplateHead) {
      templateBraceDepth.push(braceDepth);
    } else if (kind === ts.SyntaxKind.OpenParenToken) {
      parenKeyword.push(prev !== undefined && REGEX_AFTER_PAREN.has(prev) && prevPrev !== ts.SyntaxKind.DotToken);
    }
    lastParenByKeyword = kind === ts.SyntaxKind.CloseParenToken ? (parenKeyword.pop() ?? false) : false;

    const text = scanner.getTokenText();
    if (kind === ts.SyntaxKind.Identifier) {
      const rule = IDENTIFIER_RULES.get(text);
      if (rule) hits.push({ line: lineOf(scanner.getTokenStart()), rule, text });
    } else if (
      kind === ts.SyntaxKind.StringLiteral ||
      (kind >= ts.SyntaxKind.FirstTemplateToken && kind <= ts.SyntaxKind.LastTemplateToken)
    ) {
      for (const re of STORE_FILE_TEXT) {
        const m = re.exec(text);
        if (m) hits.push({ line: lineOf(scanner.getTokenStart()), rule: "store file", text: m[0] });
      }
    }
    prevPrev = prev;
    prev = kind;
  }
  return hits;
}

function collectFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : collectFiles(full);
    if (!SOURCE_EXT.has(extname(entry.name)) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return [full];
  });
}

function scannedFiles(): string[] {
  return SCAN_ROOTS.flatMap((p) => collectFiles(join(ROOT, p))).filter(
    (file) => !EXCLUDED_PREFIXES.some((prefix) => relative(ROOT, file).startsWith(prefix)),
  );
}

test("the scanner flags bypasses in code and ignores them in comments", () => {
  const rules = (src: string, file?: string) => findBypasses(src, file).map((h) => h.rule);
  expect(rules(`const rows = explainSetting("k");`)).toEqual(["per-rung reader"]);
  expect(rules(`const r = rt.repoSectionsFor(key);`)).toEqual(["per-rung reader"]);
  expect(rules(`readJsonc(fs, join(dir, "settings.team.jsonc"));`)).toEqual(["store file"]);
  expect(rules("const f = `settings.${scope}.jsonc`;")).toEqual(["store file"]);
  expect(rules(`const s = readStore(p).global;`)).toEqual(["raw store reader"]);
  expect(rules(`readFileSync(userSettingsPath())`)).toEqual(["store path helper"]);
  expect(rules(`// explainSetting is not needed here`)).toEqual([]);
  expect(rules(`/**\n * settings.user.jsonc\n */\nconst x = 1;`)).toEqual([]);
  expect(rules(`const url = "https://x"; // readStore`)).toEqual([]);
  expect(rules(`const m = s.match(/"a"/); // settings.local.jsonc`)).toEqual([]);
  expect(rules(`const half = a / 2; const r = readStore(p);`)).toEqual(["raw store reader"]);
  expect(rules("const t = `a ${b ? `${c}` : '}'} // readStore`;")).toEqual([]);
  expect(rules(`const A = () => <p>Don't</p>;\nconst u = 'http://x'; const r = readStore(p);`, "x.tsx")).toEqual([
    "raw store reader",
  ]);
  expect(rules(`if (ok) /'/.test(s); readStore(p)`)).toEqual(["raw store reader"]);
  expect(findBypasses(`/* a */\nconst r = explainSetting;`)).toEqual([{ line: 2, rule: "per-rung reader", text: "explainSetting" }]);
});

test("settings are read and written only through the resolver", () => {
  const files = scannedFiles();
  expect(files.length).toBeGreaterThan(1000);

  const found = new Map<string, Hit[]>();
  for (const file of files) {
    const rel = relative(ROOT, file);
    for (const hit of findBypasses(readFileSync(file, "utf8"), file)) {
      const key = `${hit.rule}\0${rel}`;
      found.set(key, [...(found.get(key) ?? []), hit]);
    }
  }

  const unlisted: string[] = [];
  const miscounted: string[] = [];
  for (const [key, hits] of found) {
    const [rule, rel] = key.split("\0") as [Rule, string];
    const allowed = Object.hasOwn(ALLOWLIST[rule], rel) ? ALLOWLIST[rule][rel] : undefined;
    if (!allowed) {
      unlisted.push(...hits.map((h) => `${rel}:${h.line}  ${rule}: ${h.text}`));
    } else if (allowed.count !== hits.length) {
      miscounted.push(
        `${rel}  ${rule}: allowlisted ${allowed.count}, found ${hits.length} at ${hits.map((h) => `${h.line} (${h.text})`).join(", ")}`,
      );
    }
  }
  for (const rule of Object.keys(ALLOWLIST) as Rule[]) {
    for (const [rel, allowed] of Object.entries(ALLOWLIST[rule])) {
      if (!found.has(`${rule}\0${rel}`)) miscounted.push(`${rel}  ${rule}: allowlisted ${allowed.count}, found 0; remove the entry`);
    }
  }

  expect(
    unlisted,
    `Settings bypass the resolver. Read via getSetting / write via setSetting (see docs/settings-architecture.md), or add an ALLOWLIST entry in lib/__tests__/no-settings-bypass.test.ts with a count and a one-line reason:\n${unlisted.join("\n")}`,
  ).toEqual([]);
  expect(
    miscounted,
    `An allowlisted file's bypass count changed. A new use must read via getSetting / write via setSetting (see docs/settings-architecture.md); if it genuinely needs the raw access, update the entry's count and reason in lib/__tests__/no-settings-bypass.test.ts:\n${miscounted.join("\n")}`,
  ).toEqual([]);
});
