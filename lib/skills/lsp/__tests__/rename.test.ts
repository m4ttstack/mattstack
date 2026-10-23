import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { blockIn, type HeldBlock } from "../lookup.ts";
import type { Position } from "../positions.ts";
import { prepareRename, RenameRefused, renameAt, renameProp, type WorkspaceEdit } from "../rename.ts";
import { Workspace } from "../workspace.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");
const GATE = "mattstack:mini/gate";
const WARNING = "renaming a mattstack prop is a breaking change: add `props-change: mini/gate.tiering: renamed to model` to the PR body";

let tmp: string;
let plugin: string;
let pack: string;
let mini: string;
let gate: string;
let notes: string;
let manifest: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lsp-rename-"));
  plugin = join(tmp, "plugins/mattstack");
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

function held(ws: Workspace, file: string): HeldBlock {
  const found = blockIn(ws, file);
  if (!found) throw new Error(`no block in ${file}`);
  return found;
}

/** Each edited file's text after the edit. */
function applied(ws: Workspace, edit: WorkspaceEdit): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [uri, edits] of Object.entries(edit.changes)) {
    const file = fileURLToPath(uri);
    const lines = ws.text(file).split("\n");
    const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
    for (const { range, newText } of sorted) {
      expect(range.end.line).toBe(range.start.line);
      const row = lines[range.start.line]!;
      lines[range.start.line] = row.slice(0, range.start.character) + newText + row.slice(range.end.character);
    }
    out[file] = lines.join("\n");
  }
  return out;
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    if (err instanceof RenameRefused) return err.message;
    throw err;
  }
  throw new Error("not refused");
}

describe("renameProp", () => {
  test("tiering to model on mini/gate edits three ranges across two files and no other block", () => {
    const ws = new Workspace([plugin, pack]);
    const gateText = ws.text(gate);
    const manifestText = ws.text(manifest);
    const edit = renameProp(ws, held(ws, gate), "tiering", "model");
    expect(Object.keys(edit.changes).sort()).toEqual([pathToFileURL(manifest).href, pathToFileURL(gate).href].sort());
    expect(Object.values(edit.changes).flat()).toHaveLength(3);
    expect(applied(ws, edit)).toEqual({
      [gate]: gateText.replace("  tiering:\n", "  model:\n").replace("{{props.tiering}}", "{{props.model}}"),
      [manifest]: manifestText.replace('{ "tiering": "" }', '{ "model": "" }'),
    });
  });

  test("a fenced marker is renamed", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n\`\`\`text\nuse {{props.tiering}} here\n\`\`\`\n`);
    const after = applied(ws, renameProp(ws, held(ws, gate), "tiering", "model"))[gate]!;
    expect(after).toContain("use {{props.model}} here");
    expect(after).not.toContain("props.tiering");
  });

  test("a pipelines.<type>.bindings entry is renamed", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, JSON.stringify({ version: 2, bindings: { [GATE]: { tiering: "" } }, pipelines: { fast: { bindings: { [GATE]: { tiering: "" } } } } }, null, 2));
    const after = applied(ws, renameProp(ws, held(ws, gate), "tiering", "model"))[manifest]!;
    expect(JSON.parse(after)).toEqual({ version: 2, bindings: { [GATE]: { model: "" } }, pipelines: { fast: { bindings: { [GATE]: { model: "" } } } } });
  });

  test("the same prop on another block of the engine is untouched", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(notes, `${ws.text(notes).replace("props:\n", 'props:\n  tiering:\n    merge: replace\n    default: ""\n')}\n{{props.tiering}}\n`);
    ws.open(manifest, ws.text(manifest).replace(`"${GATE}"`, `"mattstack:mini/notes": { "tiering": "" },\n    "${GATE}"`));
    const notesText = ws.text(notes);
    const edit = renameProp(ws, held(ws, gate), "tiering", "model");
    expect(edit.changes[pathToFileURL(notes).href]).toBeUndefined();
    const after = applied(ws, edit);
    expect(after[manifest]).toContain('"mattstack:mini/notes": { "tiering": "" }');
    expect(after[manifest]).toContain(`"${GATE}": { "model": "" }`);
    expect(ws.text(notes)).toBe(notesText);
  });

  test("a bad name, a collision and an unchanged name are refused", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, ws.text(gate).replace("props:\n", 'props:\n  extra:\n    merge: add\n    default: ""\n'));
    const h = held(ws, gate);
    for (const bad of ["Model", "1model", "model_x", "", "-model"]) {
      expect(refusal(() => renameProp(ws, h, "tiering", bad))).toContain("lowercase");
    }
    expect(refusal(() => renameProp(ws, h, "tiering", "extra"))).toBe('mini/gate already declares a prop "extra"');
    expect(refusal(() => renameProp(ws, h, "tiering", "tiering"))).toBe('the prop is already called "tiering"');
    expect(refusal(() => renameProp(ws, h, "nope", "model"))).toBe('mini/gate declares no prop "nope"');
  });

  test("the warning appears for a block under plugins/mattstack", () => {
    const ws = new Workspace([plugin, pack]);
    expect(renameProp(ws, held(ws, gate), "tiering", "model").warnings).toEqual([WARNING]);
  });

  test("a block tree in the pack carries no warning", () => {
    const kit = join(pack, "attachments/kit");
    mkdirSync(kit, { recursive: true });
    writeFileSync(join(kit, "index.block.md"), '---\nprops:\n  rules:\n    merge: add\n    default: ""\n---\n\n# Kit\n\n{{props.rules}}\n');
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, ws.text(manifest).replace(`"${GATE}"`, `"widgets:kit": { "rules": "" },\n    "${GATE}"`));
    const edit = renameProp(ws, held(ws, join(kit, "index.block.md")), "rules", "checks");
    expect(edit.warnings).toEqual([]);
    const after = applied(ws, edit);
    expect(after[join(kit, "index.block.md")]).toContain("  checks:\n");
    expect(after[join(kit, "index.block.md")]).toContain("{{props.checks}}");
    expect(after[manifest]).toContain('"widgets:kit": { "checks": "" }');
    expect(after[manifest]).toContain('"mattstack:mini": { "rules": "widgets:mini-rules/fast" }');
  });
});

describe("prepareRename", () => {
  test("a decl, a marker and a binding prop give the name's range and placeholder", () => {
    const ws = new Workspace([plugin, pack]);
    const gateText = ws.text(gate);
    const decl = at(gateText, "tiering:", 0);
    expect(prepareRename(ws, gate, decl)).toEqual({ range: { start: decl, end: { line: decl.line, character: decl.character + 7 } }, placeholder: "tiering" });
    const marker = at(gateText, "{{props.tiering}}", 0);
    expect(prepareRename(ws, gate, { line: marker.line, character: 3 })).toEqual({
      range: { start: { line: marker.line, character: 8 }, end: { line: marker.line, character: 15 } },
      placeholder: "tiering",
    });
    const binding = at(ws.text(manifest), '"tiering"', 0);
    expect(prepareRename(ws, manifest, { line: binding.line, character: binding.character + 2 })).toEqual({
      range: { start: { line: binding.line, character: binding.character + 1 }, end: { line: binding.line, character: binding.character + 8 } },
      placeholder: "tiering",
    });
  });

  test("prose, a binding value and a binding key give null", () => {
    const ws = new Workspace([plugin, pack]);
    expect(prepareRename(ws, gate, at(ws.text(gate), "Ask the human"))).toBeNull();
    expect(prepareRename(ws, manifest, at(ws.text(manifest), '"widgets:mini-rules/fast"', 2))).toBeNull();
    expect(prepareRename(ws, manifest, at(ws.text(manifest), `"${GATE}"`, 3))).toBeNull();
  });
});

describe("renameAt", () => {
  test("from a binding prop renames the block it names", () => {
    const ws = new Workspace([plugin, pack]);
    const fromManifest = renameAt(ws, manifest, at(ws.text(manifest), '"tiering"', 2), "model");
    expect(fromManifest).toEqual(renameProp(ws, held(ws, gate), "tiering", "model"));
  });

  test("from a marker; prose gives null", () => {
    const ws = new Workspace([plugin, pack]);
    expect(renameAt(ws, gate, at(ws.text(gate), "{{props.tiering}}", 3), "model")).toEqual(renameProp(ws, held(ws, gate), "tiering", "model"));
    expect(renameAt(ws, gate, at(ws.text(gate), "Ask the human"), "model")).toBeNull();
  });

  test("with two same-named copies, a rename from the manifest edits only the copy the manifest sees", () => {
    const a = join(tmp, "a/plugins/mattstack");
    const b = join(tmp, "b/plugins/mattstack");
    cpSync(plugin, a, { recursive: true });
    cpSync(plugin, b, { recursive: true });
    const ws = new Workspace([join(tmp, "a"), join(tmp, "b"), pack]);
    const edit = renameAt(ws, manifest, at(ws.text(manifest), '"tiering"', 2), "model")!;
    expect(Object.keys(edit.changes).map((u) => fileURLToPath(u)).sort()).toEqual([join(a, "attachments/pipeline/mini/gate.block.md"), manifest].sort());
  });
});
