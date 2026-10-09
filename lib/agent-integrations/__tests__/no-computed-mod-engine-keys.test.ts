import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Claude Code's loader lists a hooks module's env reads and state keys
// statically, and refuses the whole module (every mod block with it) when one
// is computed. Only the loader enforces this, so the plugin's own tests pass
// on a module that will never load.
const PLUGIN = join(import.meta.dir, "../../../plugins/mattstack-mods");
const SCANNED = ["src", "hooks"];

const LITERAL = String.raw`'[A-Za-z0-9_.-]+'|"[A-Za-z0-9_.-]+"`;
const ENV_ARG = new RegExp(String.raw`^\s*(?:${LITERAL})\s*[,)]`);
const STATE_ARG = new RegExp(String.raw`^\s*\{\s*plugin:\s*(?:${LITERAL})\s*,\s*key:\s*(?:${LITERAL})\s*,?\s*\}`);

function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

function computedKeys(file: string, text: string): string[] {
  const src = code(text);
  const found: string[] = [];
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;
  const evasions: Array<[RegExp, string]> = [
    [/\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*\$(?![\w$])/g, "$ destructured"],
    [/(?<![\w$])\$\s*(?:\?\.|\[)/g, "$ reached by bracket or optional access"],
    [/(?<![\w$])(?!\$\s*:)[A-Za-z_$][\w$]*\s*:\s*EngineInterface\b/g, "the engine held under a name other than $"],
  ];
  for (const [re, what] of evasions) {
    for (const m of src.matchAll(re)) found.push(`${file}:${lineOf(m.index)}: ${what}`);
  }
  for (const m of src.matchAll(/\$\.(env|state)\b(\.(get|set)\()?/g)) {
    const at = `${file}:${lineOf(m.index)}`;
    if (!m[2]) {
      found.push(`${at}: $.${m[1]} used other than as a direct get or set call`);
      continue;
    }
    const rest = src.slice(m.index + m[0].length);
    const ok = m[1] === "env" ? ENV_ARG.test(rest) : STATE_ARG.test(rest);
    if (!ok) found.push(`${at}: $.${m[1]}.${m[3]} takes a non-literal first argument`);
  }
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

describe("mattstack-mods engine keys are literal", () => {
  test("every $.env and $.state call in the hooks module names its key literally", () => {
    const found = SCANNED.flatMap((d) => sources(join(PLUGIN, d))).flatMap((path) =>
      computedKeys(relative(PLUGIN, path), readFileSync(path, "utf8")),
    );
    expect(found).toEqual([]);
  });

  test("the scan flags a computed name, an alias and a computed state key", () => {
    expect(computedKeys("a.ts", "boardVar: name => $.env.get(name),")).toHaveLength(1);
    expect(computedKeys("a.ts", "const env = $.env")).toHaveLength(1);
    expect(computedKeys("a.ts", "await $.state.get({ plugin: 'p', key: k })")).toHaveLength(1);
    expect(computedKeys("a.ts", "$.env.get(`HOME`)")).toHaveLength(1);
  });

  test("the scan flags every way around a direct $ call", () => {
    for (const evasion of [
      "const { env } = $",
      "let { state: s } = $",
      "await $['env'].get('HOME')",
      "await $?.env.get('HOME')",
      "function facade(api: EngineInterface) {",
      "const read = (engine: EngineInterface) => engine.env.get(name)",
    ]) {
      expect(computedKeys("a.ts", evasion)).toHaveLength(1);
    }
  });

  test("the scan passes literal names and ignores comments", () => {
    const ok = [
      "function facade($: EngineInterface): ModApi {",
      "const tpl = `${a}[${b}]`",
      "home: () => $.env.get('HOME'),",
      "await $.state.set({ plugin: 'mattstack-mods', key: 'linkId' }, value)",
      "// boardVar: name => $.env.get(name)",
      "/** reads $.env.get(name) */",
    ].join("\n");
    expect(computedKeys("a.ts", ok)).toEqual([]);
  });
});
