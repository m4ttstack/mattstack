import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { definitionAt } from "../definition.ts";
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
  tmp = mkdtempSync(join(tmpdir(), "lsp-definition-"));
  plugin = join(tmp, "mattstack");
  pack = join(tmp, "widgets");
  cpSync(join(FIXTURES, "plugins/mattstack"), plugin, { recursive: true });
  cpSync(join(FIXTURES, "pack"), pack, { recursive: true });
  mini = join(plugin, "attachments/pipeline/mini");
  gate = join(mini, "gate.block.md");
  manifest = join(pack, "pack/skills.jsonc");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function at(text: string, needle: string, ahead = 1): Position {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => l.includes(needle));
  if (line < 0) throw new Error(`no ${needle}`);
  return { line, character: lines[line]!.indexOf(needle) + ahead };
}

const define = (ws: Workspace, file: string, needle: string, ahead?: number) => definitionAt(ws, file, at(ws.text(file), needle, ahead));

/** The target's file and the text its range covers. */
function landing(ws: Workspace, results: ReturnType<typeof definitionAt>): { uri: string; text: string }[] {
  return results.map(({ uri, range }) => {
    const row = ws.text(fileURLToPath(uri)).split("\n")[range.start.line] ?? "";
    expect(range.end.line).toBe(range.start.line);
    return { uri, text: row.slice(range.start.character, range.end.character) };
  });
}

const uri = (file: string) => pathToFileURL(file).href;

describe("definitionAt", () => {
  test("a binding key lands on the block's title line", () => {
    const ws = new Workspace([plugin, pack]);
    expect(landing(ws, define(ws, manifest, '"mattstack:mini/gate"', 3))).toEqual([{ uri: uri(gate), text: "# Ask the gate" }]);
  });

  test("node: lands on the parent's mermaid node statement", () => {
    const ws = new Workspace([plugin, pack]);
    expect(landing(ws, define(ws, gate, "ask_gate", 2))).toEqual([{ uri: uri(join(mini, "index.block.md")), text: "ask_gate" }]);
    const target = define(ws, gate, "ask_gate", 2)[0]!;
    expect(ws.text(join(mini, "index.block.md")).split("\n")[target.range.start.line]).toBe("  ask_gate");
  });

  test("a node with only an edge mention lands on its first edge line", () => {
    const ws = new Workspace([plugin, pack]);
    const index = join(mini, "index.block.md");
    ws.open(index, ws.text(index).replace("  ask_gate\n", ""));
    expect(landing(ws, define(ws, gate, "ask_gate", 2))).toEqual([{ uri: uri(index), text: "start --> run_step --> ask_gate --> finish" }]);
  });

  test("a binding prop lands on the prop's declaration line", () => {
    const ws = new Workspace([plugin, pack]);
    expect(landing(ws, define(ws, manifest, '"tiering"', 2))).toEqual([{ uri: uri(gate), text: "tiering:" }]);
  });

  test("a binding value lands on the value file", () => {
    const ws = new Workspace([plugin, pack]);
    const results = define(ws, manifest, '"widgets:mini-rules/fast"', 2);
    expect(results.map((r) => r.uri)).toEqual([uri(join(pack, "attachments/mini-rules/fast.md"))]);
    expect(results[0]!.range.start.line).toBe(0);
  });

  test("an include lands on its index.block.md title line", () => {
    const gp = join(plugin, "attachments/gp");
    mkdirSync(gp, { recursive: true });
    writeFileSync(join(gp, "index.block.md"), "---\n---\n\n# Gate protocol\n\nAsk before acting.\n");
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{include:gp}}\n`);
    expect(landing(ws, define(ws, gate, "{{include:gp}}"))).toEqual([{ uri: uri(join(gp, "index.block.md")), text: "# Gate protocol" }]);
  });

  test("prose and an unknown key have no definition", () => {
    const ws = new Workspace([plugin, pack]);
    expect(define(ws, gate, "Ask the human")).toEqual([]);
    ws.open(manifest, ws.text(manifest).replace('"mattstack:mini/gate"', '"mattstack:mini/nope"'));
    expect(define(ws, manifest, '"mattstack:mini/nope"', 3)).toEqual([]);
  });
});

describe("definitionAt on a skill path", () => {
  test("pack.path opens its target file", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\nRead {{pack.path:mini-rules/fast.md}} first.\n`);
    expect(define(ws, gate, "{{pack.path:", 4).map((r) => r.uri)).toEqual([uri(join(pack, "attachments/mini-rules/fast.md"))]);
  });

  test("a compiled output folder's file has no definition", () => {
    mkdirSync(join(pack, "attachments/stage-x"), { recursive: true });
    writeFileSync(join(pack, "attachments/stage-x/SKILL.md"), '---\nname: "stage-x"\nmetadata:\n  compiled: "mattstack@1.0.0"\n---\n');
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{pack.path:stage-x/SKILL.md}}\n`);
    expect(define(ws, gate, "{{pack.path:", 4)).toEqual([]);
  });

  test("a missing target has no definition", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{pack.path:mini-rules/gone.md}}\n`);
    expect(define(ws, gate, "{{pack.path:", 4)).toEqual([]);
  });
});
