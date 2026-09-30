/**
 * Source guard: settings are read with getSetting and written with
 * setSetting/unsetSetting. Per-rung reads (explainSetting), the raw store
 * reader and the store files themselves are for the resolver and for the
 * listed callers that genuinely need them. Reads source as text, so the no-*
 * prefix is what puts it in the always-run set.
 */

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");

type Rule = "explainSetting" | "store file" | "raw store reader" | "store path helper";

const RULES: { rule: Rule; re: RegExp }[] = [
  { rule: "explainSetting", re: /\bexplainSetting\b/ },
  { rule: "store file", re: /settings\.(?:user|team|local)\.jsonc/ },
  { rule: "raw store reader", re: /\breadStores?\b/ },
  { rule: "store path helper", re: /\b(?:userSettingsPath|teamSettingsPath|machineSettingsPath)\b/ },
];

const EXCLUDED_PREFIXES = ["packages/rt-client/src/settings/", "lib/rt-paths.ts"];

const ALLOWLIST: Record<Rule, Record<string, string>> = {
  explainSetting: {
    "commands/settings-keys.ts": "`rt settings explain` prints every rung",
    "commands/worktree-hook.ts": "claudeHook is read from the machine rung only",
    "lib/worktree/config.ts": "declared-presence check and ready-ladder owner need per-rung presence",
    "lib/worktree/ready-approval.ts": "approval is trusted only from user.repo/machine.repo rungs, never a team rung",
    "packages/settings-kit/src/server.ts": "the console's scope-chain editor shows every rung",
    "packages/rt-client/src/index.ts": "rt-client's public entry re-exports the resolver",
  },
  "store file": {
    "commands/home.ts": "existence probe listing adoptable machine profiles",
    "lib/command-tree-def.ts": "help hints naming where --scope writes",
    "lib/home/init-exec.ts": "assertNotRealStoreInTest guard before home init seeds the user store",
    "lib/team/create.ts": "scaffolds a new team's store and guards it with assertNotRealStoreInTest",
    "lib/team/join.ts": "assertNotRealStoreInTest guard before join seeds the team store",
    "lib/setup/team-settings.ts": "existence probe discovering cloned teams through the Probes seam",
    "lib/skills/init.ts": "reads each team zone's own forge host; getSetting merges every team store and has no per-team read",
  },
  "raw store reader": {
    "commands/team.ts": "reads one team's own roster; getSetting merges every team store",
    "lib/team/invite.ts": "reads one team's own roster; getSetting merges every team store",
    "lib/team/members.ts": "reads one team's own roster; getSetting merges every team store",
    "packages/rt-client/src/index.ts": "rt-client's public entry re-exports the resolver",
  },
  "store path helper": {
    "commands/team.ts": "names the one team store its roster read targets",
    "lib/team/invite.ts": "names the one team store its roster read targets",
    "lib/team/members.ts": "names the one team store its roster read targets",
    "lib/endpoint/shim.ts": "mtime staleness probe over the store files intercept rules came from",
    "lib/repo-reidentify.ts": "renames a repo's section in every store file",
    "lib/repo-tracking.ts": "refuses to move a tracking grant over an unparseable machine store",
  },
};

/**
 * Blanks comments while keeping line numbers and string contents, so a
 * mention in prose never matches but a string literal still does.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (ch === "/" && startsRegex(out)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n") {
        const c = src[j];
        if (c === "\\") j++;
        else if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** A `/` opens a regex literal, not a division, after an operator or keyword. */
function startsRegex(before: string): boolean {
  const trimmed = before.trimEnd();
  return trimmed === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(trimmed) || /\b(?:return|typeof|case|of|in)$/.test(trimmed);
}

export function findBypasses(src: string): { line: number; rule: Rule; text: string }[] {
  const hits: { line: number; rule: Rule; text: string }[] = [];
  stripComments(src)
    .split("\n")
    .forEach((line, i) => {
      for (const { rule, re } of RULES) {
        const m = re.exec(line);
        if (m) hits.push({ line: i + 1, rule, text: m[0] });
      }
    });
  return hits;
}

function collectFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "__tests__", "fixtures", "test", "tests"].includes(entry.name)) return [];
      return collectFiles(full);
    }
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

function scannedFiles(): string[] {
  const workspaceSrcs = ["apps", "packages"].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(ROOT, dir, e.name, "src")),
  );
  return ["commands", "lib", "scripts", "cli.ts"]
    .map((p) => join(ROOT, p))
    .concat(workspaceSrcs)
    .flatMap(collectFiles)
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => relative(ROOT, file).startsWith(prefix)));
}

test("the scanner flags bypasses in code and ignores them in comments", () => {
  expect(findBypasses(`const rows = explainSetting("k");`).map((h) => h.rule)).toEqual(["explainSetting"]);
  expect(findBypasses(`readJsonc(fs, join(dir, "settings.team.jsonc"));`).map((h) => h.rule)).toEqual(["store file"]);
  expect(findBypasses(`const s = readStore(p).global;`).map((h) => h.rule)).toEqual(["raw store reader"]);
  expect(findBypasses(`readFileSync(userSettingsPath())`).map((h) => h.rule)).toEqual(["store path helper"]);
  expect(findBypasses(`// explainSetting is not needed here`)).toEqual([]);
  expect(findBypasses(`/**\n * settings.user.jsonc\n */\nconst x = 1;`)).toEqual([]);
  expect(findBypasses(`const url = "https://x"; // readStore`)).toEqual([]);
  expect(findBypasses(`/* a */\nconst r = explainSetting;`)).toEqual([{ line: 2, rule: "explainSetting", text: "explainSetting" }]);
  expect(findBypasses(`const m = s.match(/"a"/); // settings.local.jsonc`)).toEqual([]);
  expect(findBypasses(`const half = a / 2; const r = readStore(p);`).map((h) => h.rule)).toEqual(["raw store reader"]);
});

test("settings are read and written only through the resolver", () => {
  const files = scannedFiles();
  expect(files.length).toBeGreaterThan(500);

  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const rel = relative(ROOT, file);
    for (const hit of findBypasses(readFileSync(file, "utf8"))) {
      if (ALLOWLIST[hit.rule][rel] !== undefined) {
        seen.add(`${hit.rule}\0${rel}`);
        continue;
      }
      offenders.push(`${rel}:${hit.line}  ${hit.rule}: ${hit.text}`);
    }
  }
  expect(
    offenders,
    `Settings bypass the resolver. Read via getSetting / write via setSetting (see docs/settings-architecture.md), or add an ALLOWLIST entry in lib/__tests__/no-settings-bypass.test.ts with a one-line reason:\n${offenders.join("\n")}`,
  ).toEqual([]);

  const stale = (Object.keys(ALLOWLIST) as Rule[]).flatMap((rule) =>
    Object.keys(ALLOWLIST[rule])
      .filter((rel) => !seen.has(`${rule}\0${rel}`))
      .map((rel) => `${rule}: ${rel}`),
  );
  expect(stale, `ALLOWLIST entries that no longer match anything; remove them:\n${stale.join("\n")}`).toEqual([]);
});
