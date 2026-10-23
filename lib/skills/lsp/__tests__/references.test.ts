import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Position } from "../positions.ts";
import { blockReferences, propReferences, referencesAt, toLocations, type Reference } from "../references.ts";
import { Workspace } from "../workspace.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");

let tmp: string;
let plugin: string;
let pack: string;
let mini: string;
let gate: string;
let notes: string;
let manifest: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lsp-references-"));
  plugin = join(tmp, "mattstack");
  pack = join(tmp, "widgets");
  cpSync(join(FIXTURES, "plugins/mattstack"), plugin, { recursive: true });
  cpSync(join(FIXTURES, "pack"), pack, { recursive: true });
  mini = join(plugin, "attachments/pipeline/mini");
  gate = join(mini, "gate.block.md");
  notes = join(mini, "notes.block.md");
  manifest = join(pack, "pack/skills.jsonc");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function at(text: string, needle: string, ahead = 1): Position {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => l.includes(needle));
  if (line < 0) throw new Error(`no ${needle}`);
  return { line, character: lines[line]!.indexOf(needle) + ahead };
}

/** Each reference as its kind, file and the text its range covers. */
function seen(ws: Workspace, refs: Reference[]): { kind: string; file: string; text: string }[] {
  return refs.map(({ uri, range, kind }) => {
    const file = fileURLToPath(uri);
    expect(range.end.line).toBe(range.start.line);
    const row = ws.text(file).split("\n")[range.start.line] ?? "";
    return { kind, file, text: row.slice(range.start.character, range.end.character) };
  });
}

const GATE = "mattstack:mini/gate";

describe("propReferences", () => {
  test("from the marker: the decl, the marker and the manifest binding", () => {
    const ws = new Workspace([plugin, pack]);
    expect(seen(ws, referencesAt(ws, gate, at(ws.text(gate), "{{props.tiering}}", 3)))).toEqual([
      { kind: "decl", file: gate, text: "tiering" },
      { kind: "marker", file: gate, text: "{{props.tiering}}" },
      { kind: "binding", file: manifest, text: '"tiering"' },
    ]);
  });

  test("the decl and the binding prop find the same references", () => {
    const ws = new Workspace([plugin, pack]);
    const fromMarker = referencesAt(ws, gate, at(ws.text(gate), "{{props.tiering}}", 3));
    expect(referencesAt(ws, gate, at(ws.text(gate), "tiering:", 1))).toEqual(fromMarker);
    expect(referencesAt(ws, manifest, at(ws.text(manifest), '"tiering"', 2))).toEqual(fromMarker);
  });

  test("a fenced marker is listed", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n\`\`\`text\nuse {{props.tiering}} here\n\`\`\`\n`);
    const markers = seen(ws, propReferences(ws, GATE, "tiering")).filter((r) => r.kind === "marker");
    expect(markers.map((m) => m.text)).toEqual(["{{props.tiering}}", "{{props.tiering}}"]);
  });

  test("a pipelines.<type>.bindings entry is listed", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, JSON.stringify({ version: 2, bindings: {}, pipelines: { fast: { bindings: { [GATE]: { tiering: "" } } } } }, null, 2));
    expect(seen(ws, propReferences(ws, GATE, "tiering")).filter((r) => r.kind === "binding")).toEqual([
      { kind: "binding", file: manifest, text: '"tiering"' },
    ]);
  });

  test("a prop of the same name on another block is not listed", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(notes, `${ws.text(notes).replace("props:\n", 'props:\n  tiering:\n    merge: replace\n    default: ""\n')}\n{{props.tiering}}\n`);
    ws.open(manifest, ws.text(manifest).replace(`"${GATE}"`, `"mattstack:mini/notes": { "tiering": "" },\n    "${GATE}"`));
    expect(propReferences(ws, "mattstack:mini/notes", "tiering").map((r) => r.kind)).toEqual(["decl", "marker", "binding"]);
    const refs = propReferences(ws, GATE, "tiering");
    expect(seen(ws, refs).filter((r) => r.file === notes)).toEqual([]);
    const bindings = refs.filter((r) => r.kind === "binding");
    expect(bindings).toHaveLength(1);
    expect(ws.text(manifest).split("\n")[bindings[0]!.range.start.line]).toContain(GATE);
  });

  test("includeDeclaration false drops the decl", () => {
    const ws = new Workspace([plugin, pack]);
    const refs = propReferences(ws, GATE, "tiering");
    expect(toLocations(refs, true)).toHaveLength(3);
    expect(toLocations(refs, false)).toEqual(refs.filter((r) => r.kind !== "decl").map(({ uri, range }) => ({ uri, range })));
  });
});

describe("blockReferences", () => {
  test("lists the file and the binding key", () => {
    const ws = new Workspace([plugin, pack]);
    expect(seen(ws, blockReferences(ws, GATE))).toEqual([
      { kind: "file", file: gate, text: "# Ask the gate" },
      { kind: "binding-key", file: manifest, text: `"${GATE}"` },
    ]);
  });

  test("from the binding key", () => {
    const ws = new Workspace([plugin, pack]);
    expect(referencesAt(ws, manifest, at(ws.text(manifest), `"${GATE}"`, 3))).toEqual(blockReferences(ws, GATE));
  });

  test("a root lists binding keys on its descendants; a headless block's file range is 0:0", () => {
    const ws = new Workspace([plugin, pack]);
    expect(seen(ws, blockReferences(ws, "mattstack:mini")).filter((r) => r.kind === "binding-key").map((r) => r.text)).toEqual([
      '"mattstack:mini"',
      `"${GATE}"`,
    ]);
    const guard = blockReferences(ws, "mattstack:mini/run/guard");
    expect(guard[0]!.uri).toBe(pathToFileURL(join(mini, "run/guard.block.md")).href);
    expect(guard[0]!.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
  });

  test("includeDeclaration false drops the file", () => {
    const ws = new Workspace([plugin, pack]);
    expect(toLocations(blockReferences(ws, GATE), false)).toHaveLength(1);
  });

  test("an include root lists every include naming it", () => {
    const gp = join(plugin, "attachments/gp");
    mkdirSync(gp, { recursive: true });
    writeFileSync(join(gp, "index.block.md"), "---\n---\n\n# Gate protocol\n\nAsk before acting.\n");
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{include:gp}}\n`);
    const expected = [
      { kind: "file", file: join(gp, "index.block.md"), text: "# Gate protocol" },
      { kind: "include", file: gate, text: "{{include:gp}}" },
    ];
    expect(seen(ws, blockReferences(ws, "mattstack:gp"))).toEqual(expected);
    expect(seen(ws, referencesAt(ws, gate, at(ws.text(gate), "{{include:gp}}")))).toEqual(expected);
  });

  test("prose and an unknown block have no references", () => {
    const ws = new Workspace([plugin, pack]);
    expect(referencesAt(ws, gate, at(ws.text(gate), "Ask the human"))).toEqual([]);
    expect(blockReferences(ws, "mattstack:mini/nope")).toEqual([]);
  });
});
