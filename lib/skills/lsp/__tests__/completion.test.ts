import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completionsAt } from "../completion.ts";
import type { Position } from "../positions.ts";
import { Workspace } from "../workspace.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");

let tmp: string;
let plugin: string;
let pack: string;
let mini: string;
let gate: string;
let manifest: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lsp-completion-"));
  plugin = join(tmp, "mattstack");
  pack = join(tmp, "widgets");
  cpSync(join(FIXTURES, "plugins/mattstack"), plugin, { recursive: true });
  cpSync(join(FIXTURES, "pack"), pack, { recursive: true });
  mini = join(plugin, "attachments/pipeline/mini");
  gate = join(mini, "gate.block.md");
  manifest = join(pack, "pack/skills.jsonc");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** Opens `file` as `text` with the cursor where `|` sits, and completes there. */
function complete(ws: Workspace, file: string, text: string) {
  const cut = text.indexOf("|");
  const before = text.slice(0, cut).split("\n");
  const pos: Position = { line: before.length - 1, character: before[before.length - 1]!.length };
  ws.open(file, text.slice(0, cut) + text.slice(cut + 1));
  return completionsAt(ws, file, pos);
}

/** The cursor's line once `label`'s edit is applied, as a client applies a textEdit. */
function accept(ws: Workspace, file: string, items: ReturnType<typeof completionsAt>, label: string): string {
  const item = items.find((i) => i.label === label);
  if (!item?.range) throw new Error(`no ranged item ${label}`);
  const { start, end } = item.range;
  expect(end.line).toBe(start.line);
  const row = ws.text(file).split("\n")[start.line]!;
  return row.slice(0, start.character) + (item.insertText ?? item.label) + row.slice(end.character);
}

const labels = (items: ReturnType<typeof completionsAt>) => items.map((i) => i.label);
const appended = (ws: Workspace, file: string, tail: string) => `${ws.text(file).trimEnd()}\n\n${tail}\n`;

describe("completionsAt in a block", () => {
  test("after {{props. it lists the block's props", () => {
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, gate, appended(ws, gate, "{{props.|"));
    expect(labels(items)).toEqual(["tiering"]);
    expect(items[0]!.kind).toBe("prop");
  });

  test("inside a bash fence it lists nothing", () => {
    const ws = new Workspace([plugin, pack]);
    expect(complete(ws, gate, appended(ws, gate, "```bash\n{{props.|\n```"))).toEqual([]);
  });

  test("inside a {{ that is not a props or include marker it lists nothing", () => {
    const ws = new Workspace([plugin, pack]);
    expect(complete(ws, gate, appended(ws, gate, "{{nope.|"))).toEqual([]);
  });

  test("a half-typed {{pro with no closing braces does not throw", () => {
    const ws = new Workspace([plugin, pack]);
    expect(() => complete(ws, gate, appended(ws, gate, "{{pro|"))).not.toThrow();
    expect(complete(ws, gate, appended(ws, gate, "{{pro|"))).toEqual([]);
  });

  test("after {{include: it lists the tree and flat includes", () => {
    const gp = join(plugin, "attachments/gp");
    mkdirSync(gp, { recursive: true });
    writeFileSync(join(gp, "index.block.md"), "---\n---\n\n# Gate protocol\n");
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, gate, appended(ws, gate, "{{include:|"));
    expect(labels(items).sort()).toEqual(["gp", "style-floor"]);
    expect(items.every((i) => i.kind === "include")).toBe(true);
  });

  test("after contract: in a prop entry it lists every provides value", () => {
    const ws = new Workspace([plugin, pack]);
    const text = ws.text(gate).replace('contract: "model-tiering@1"', 'contract: "|');
    const items = complete(ws, gate, text);
    expect(labels(items).sort()).toEqual(["mini-rules@1", "model-tiering@1", "style-floor@1"]);
    expect(items.every((i) => i.kind === "contract")).toBe(true);
  });
});

describe("completionsAt in a manifest", () => {
  test("a value for tiering lists only model-tiering@1 providers", () => {
    const ws = new Workspace([plugin, pack]);
    const text = ws.text(manifest).replace('"tiering": ""', '"tiering": "|"');
    const items = complete(ws, manifest, text);
    expect(labels(items)).toEqual(["mattstack:model-tiering"]);
    expect(items[0]).toMatchObject({ kind: "value", detail: "model-tiering@1" });
  });

  test("a value for a prop with no contract lists every fill", () => {
    const ws = new Workspace([plugin, pack]);
    const text = ws.text(manifest).replace('"rules": "widgets:mini-rules/fast"', '"rules": "|"');
    expect(labels(complete(ws, manifest, text)).sort()).toEqual(["mattstack:model-tiering", "mattstack:style-floor", "widgets:mini-rules/fast"]);
  });

  test("a key lists engine refs", () => {
    const ws = new Workspace([plugin, pack]);
    const text = ws.text(manifest).replace('"mattstack:mini/gate"', '"|"');
    const items = complete(ws, manifest, text);
    expect(labels(items)).toEqual(["mattstack:mini"]);
    expect(items[0]!.kind).toBe("block");
  });

  test("an open key after / lists the engine's block ids with label and gate detail", () => {
    const ws = new Workspace([plugin, pack]);
    const text = ws.text(manifest).replace('"tiering": "" }', '"tiering": "" },\n    "mattstack:mini/|');
    const items = complete(ws, manifest, text);
    expect(labels(items).sort()).toEqual(["mattstack:mini/gate", "mattstack:mini/notes", "mattstack:mini/run", "mattstack:mini/run/check", "mattstack:mini/run/guard"]);
    expect(items.find((i) => i.label === "mattstack:mini/gate")).toMatchObject({ kind: "block", detail: "Gate · gate" });
    expect(items.find((i) => i.label === "mattstack:mini/run")?.detail).toBe("Run");
  });

  test("a prop position lists that block's props", () => {
    const ws = new Workspace([plugin, pack]);
    const text = ws.text(manifest).replace('"tiering": ""', '"|": ""');
    expect(labels(complete(ws, manifest, text))).toEqual(["tiering"]);
  });
});

describe("completionsAt replaces the partial it completes", () => {
  test("a key past its colon", () => {
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, manifest, ws.text(manifest).replace('"mattstack:mini/gate"', '"mattstack:|"'));
    expect(accept(ws, manifest, items, "mattstack:mini")).toBe('    "mattstack:mini": { "tiering": "" }');
  });

  test("a value past its colon", () => {
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, manifest, ws.text(manifest).replace('"widgets:mini-rules/fast"', '"widgets:mi|"'));
    expect(accept(ws, manifest, items, "widgets:mini-rules/fast")).toBe('    "mattstack:mini": { "rules": "widgets:mini-rules/fast" },');
  });

  test("a key past a nested slash", () => {
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, manifest, ws.text(manifest).replace('"mattstack:mini/gate"', '"mattstack:mini/run/|"'));
    expect(accept(ws, manifest, items, "mattstack:mini/run/check")).toBe('    "mattstack:mini/run/check": { "tiering": "" }');
  });

  test("a props marker past a dash", () => {
    const ws = new Workspace([plugin, pack]);
    const withProp = ws.text(gate).replace("props:\n", 'props:\n  run-mode:\n    merge: replace\n    default: ""\n');
    const items = complete(ws, gate, `${withProp.trimEnd()}\n\n{{props.run-m|\n`);
    expect(accept(ws, gate, items, "run-mode")).toBe("{{props.run-mode");
  });

  test("an include past its colon", () => {
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, gate, appended(ws, gate, "{{include:sty|"));
    expect(accept(ws, gate, items, "style-floor")).toBe("{{include:style-floor");
  });

  test("right after the contract: trigger it adds the space and quotes", () => {
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, gate, ws.text(gate).replace('contract: "model-tiering@1"', "contract:|"));
    expect(accept(ws, gate, items, "model-tiering@1")).toBe('    contract: "model-tiering@1"');
  });

  test("a quoted contract past a dash replaces only the partial", () => {
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, gate, ws.text(gate).replace('contract: "model-tiering@1"', 'contract: "model-ti|"'));
    expect(accept(ws, gate, items, "model-tiering@1")).toBe('    contract: "model-tiering@1"');
  });

  test("an unquoted contract partial is quoted", () => {
    const ws = new Workspace([plugin, pack]);
    const items = complete(ws, gate, ws.text(gate).replace('contract: "model-tiering@1"', "contract: model-ti|"));
    expect(accept(ws, gate, items, "model-tiering@1")).toBe('    contract: "model-tiering@1"');
  });
});

describe("completionsAt for a contract no fill provides", () => {
  test("a value lists nothing", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, ws.text(gate).replace('contract: "model-tiering@1"', 'contract: "nobody@1"'));
    const items = complete(ws, manifest, ws.text(manifest).replace('"tiering": ""', '"tiering": "|"'));
    expect(items).toEqual([]);
  });
});

describe("completionsAt for skill paths", () => {
  test("after {{pack.path: it lists the pack's attachments, then a folder's files after its slash", () => {
    const ws = new Workspace([plugin, pack]);
    const names = complete(ws, gate, appended(ws, gate, "{{pack.path:|"));
    expect(labels(names)).toContain("mini-rules");
    expect(accept(ws, gate, names, "mini-rules")).toBe("{{pack.path:mini-rules");
    const files = complete(ws, gate, appended(ws, gate, "Run {{pack.path:mini-rules/f|"));
    expect(labels(files)).toEqual(["SKILL.md", "fast.md", "lint.sh"]);
    expect(accept(ws, gate, files, "fast.md")).toBe("Run {{pack.path:mini-rules/fast.md");
  });

  test("pack.path completes inside a bash fence, where shell commands name it", () => {
    const ws = new Workspace([plugin, pack]);
    expect(labels(complete(ws, gate, appended(ws, gate, "```bash\nbash {{pack.path:mini-rules/|\n```")))).toContain("lint.sh");
  });

  test("after {{verb.path: it lists the pack's compiled verbs", () => {
    const ws = new Workspace([plugin, pack]);
    expect(labels(complete(ws, gate, appended(ws, gate, "{{verb.path:|")))).toEqual(["mini"]);
  });

  test("a compiled output folder is no pack.path folder", () => {
    mkdirSync(join(pack, "attachments/stage-x"), { recursive: true });
    writeFileSync(join(pack, "attachments/stage-x/SKILL.md"), '---\nname: "stage-x"\nmetadata:\n  compiled: "mattstack@1.0.0"\n---\n');
    const ws = new Workspace([plugin, pack]);
    expect(labels(complete(ws, gate, appended(ws, gate, "{{pack.path:|")))).not.toContain("stage-x");
    expect(complete(ws, gate, appended(ws, gate, "{{pack.path:stage-x/|"))).toEqual([]);
  });

  test("with no pack open nothing is listed", () => {
    const ws = new Workspace([plugin]);
    expect(complete(ws, gate, appended(ws, gate, "{{pack.path:|"))).toEqual([]);
  });
});
