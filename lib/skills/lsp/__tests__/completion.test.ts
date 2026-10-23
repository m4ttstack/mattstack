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
    expect(labels(items).sort()).toEqual(["gate", "notes", "run", "run/check", "run/guard"]);
    expect(items.find((i) => i.label === "gate")).toEqual({ label: "gate", kind: "block", detail: "Gate · gate" });
    expect(items.find((i) => i.label === "run")?.detail).toBe("Run");
  });

  test("a prop position lists that block's props", () => {
    const ws = new Workspace([plugin, pack]);
    const text = ws.text(manifest).replace('"tiering": ""', '"|": ""');
    expect(labels(complete(ws, manifest, text))).toEqual(["tiering"]);
  });
});
