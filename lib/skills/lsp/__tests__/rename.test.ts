import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { blockIn, type HeldBlock } from "../lookup.ts";
import type { Position } from "../positions.ts";
import { prepareRename, RenameRefused, renameAt, renameBlock, renameProp, willRenameEdits, type WorkspaceEdit } from "../rename.ts";
import { Workspace } from "../workspace.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");
const GATE = "mattstack:mini/gate";
const BLOCKS = { fileRenames: true };
const ENGINE_REFUSAL = "mini is an engine: skills and pipelines name it outside bindings, so it cannot be renamed here";
const NO_FILE_RENAMES = "this editor cannot rename files, so it cannot rename a block";
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

/** The plugin's copy with an include tree `guide` that gate and notes include and the manifest binds. */
function withGuide(): Workspace {
  const guide = join(plugin, "attachments/guide");
  mkdirSync(join(guide, "steps"), { recursive: true });
  writeFileSync(join(guide, "index.block.md"), "---\nprops:\n  tone:\n    merge: replace\n---\n\n# Guide\n\n{{props.tone}}\n");
  writeFileSync(join(guide, "steps/index.block.md"), "---\n---\n\n# Steps\n");
  writeFileSync(join(guide, "steps/first.block.md"), '---\nprops:\n  hint:\n    merge: add\n    default: ""\n---\n\n# First\n\nStart here.\n');
  writeFileSync(gate, `${readFileSync(gate, "utf8").trimEnd()}\n\n{{include:guide}}\n`);
  writeFileSync(notes, `${readFileSync(notes, "utf8").trimEnd()}\n\n  {{include:guide}}\n`);
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(`"${GATE}"`, `"mattstack:guide": { "tone": "calm" },\n    "mattstack:guide/steps/first": { "hint": "" },\n    "${GATE}"`));
  return new Workspace([plugin, pack]);
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

  test("prose and a binding value give null", () => {
    const ws = new Workspace([plugin, pack]);
    expect(prepareRename(ws, gate, at(ws.text(gate), "Ask the human"))).toBeNull();
    expect(prepareRename(ws, manifest, at(ws.text(manifest), '"widgets:mini-rules/fast"', 2))).toBeNull();
  });

  test("a binding key gives its last segment, wherever the cursor sits in the key", () => {
    const ws = new Workspace([plugin, pack]);
    const key = at(ws.text(manifest), `"${GATE}"`, 0);
    const end = key.character + 1 + GATE.length;
    const tail = { range: { start: { line: key.line, character: end - "gate".length }, end: { line: key.line, character: end } }, placeholder: "gate" };
    expect(prepareRename(ws, manifest, { line: key.line, character: key.character + 3 }, BLOCKS)).toEqual(tail);
    expect(prepareRename(ws, manifest, { line: key.line, character: end }, BLOCKS)).toEqual(tail);
  });

  test("an include of a block tree gives the include name", () => {
    const ws = withGuide();
    const line = at(ws.text(gate), "{{include:guide}}", 0);
    expect(prepareRename(ws, gate, { line: line.line, character: line.character + 3 }, BLOCKS)).toEqual({
      range: { start: { line: line.line, character: line.character + "{{include:".length }, end: { line: line.line, character: line.character + "{{include:guide".length } },
      placeholder: "guide",
    });
  });

  test("refuses what rename would refuse: an undeclared prop, an unknown block, an engine root, no file renames", () => {
    const broken = new Workspace([plugin, pack]);
    broken.open(gate, `${broken.text(gate).trimEnd()}\n\n{{props.nope}}\n`);
    expect(refusal(() => prepareRename(broken, gate, at(broken.text(gate), "{{props.nope}}", 3)))).toBe("this file's block does not load, so its props cannot be renamed");
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, ws.text(manifest).replace(`"${GATE}": { "tiering": "" }`, `"mattstack:mini/gone": { "x": "" },\n    "${GATE}": { "tiering": "", "nope": "" }`));
    expect(refusal(() => prepareRename(ws, manifest, at(ws.text(manifest), '"nope"', 2)))).toBe('mini/gate declares no prop "nope"');    expect(refusal(() => prepareRename(ws, manifest, at(ws.text(manifest), '"x"', 1)))).toBe('no open block is keyed "mattstack:mini/gone"');
    expect(refusal(() => prepareRename(ws, manifest, at(ws.text(manifest), '"mattstack:mini/gone"', 3), BLOCKS))).toBe('no open block is keyed "mattstack:mini/gone"');
    expect(refusal(() => prepareRename(ws, manifest, at(ws.text(manifest), '"mattstack:mini"', 3), BLOCKS))).toBe(ENGINE_REFUSAL);
    expect(refusal(() => prepareRename(ws, manifest, at(ws.text(manifest), `"${GATE}"`, 3)))).toBe(NO_FILE_RENAMES);
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

type DocChange = NonNullable<WorkspaceEdit["documentChanges"]>[number];

/** Each edited file's text after the text edits, keyed by its old path, and the moves in order. */
function appliedDocs(ws: Workspace, edit: WorkspaceEdit): { texts: Record<string, string>; moves: [string, string][]; order: string[] } {
  const texts: Record<string, string> = {};
  const moves: [string, string][] = [];
  for (const change of edit.documentChanges ?? []) {
    if ("kind" in change) {
      moves.push([fileURLToPath(change.oldUri), fileURLToPath(change.newUri)]);
      continue;
    }
    expect(change.textDocument.version).toBeNull();
    Object.assign(texts, applied(ws, { changes: { [change.textDocument.uri]: change.edits }, warnings: [] }));
  }
  return { texts, moves, order: (edit.documentChanges ?? []).map((c: DocChange) => ("kind" in c ? c.kind : "text")) };
}

describe("renameBlock", () => {
  test("mini/gate to ask moves the file and rewrites its key; node, title and label stay", () => {
    const ws = new Workspace([plugin, pack]);
    const gateText = ws.text(gate);
    const manifestText = ws.text(manifest);
    const edit = renameBlock(ws, held(ws, gate), "ask");
    expect(edit.changes).toEqual({});
    const { texts, moves, order } = appliedDocs(ws, edit);
    expect(moves).toEqual([[gate, join(mini, "ask.block.md")]]);
    expect(order).toEqual(["text", "rename"]);
    expect(texts).toEqual({ [manifest]: manifestText.replace(`"${GATE}"`, '"mattstack:mini/ask"') });
    expect(gateText).toContain("node: ask_gate");
    expect(gateText).toContain("# Ask the gate");
  });

  test("a folder block renames the folder and rewrites keys on it and its descendants", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, JSON.stringify({ version: 2, bindings: { "mattstack:mini/run/check": {}, "mattstack:mini/runner": {} }, pipelines: { fast: { bindings: { "mattstack:mini/run": {} } } } }, null, 2));
    const run = join(mini, "run");
    const { texts, moves } = appliedDocs(ws, renameBlock(ws, held(ws, join(run, "index.block.md")), "step"));
    expect(moves).toEqual([[run, join(mini, "step")]]);
    expect(JSON.parse(texts[manifest]!)).toEqual({ version: 2, bindings: { "mattstack:mini/step/check": {}, "mattstack:mini/runner": {} }, pipelines: { fast: { bindings: { "mattstack:mini/step": {} } } } });
  });

  test("an include root renames its folder, its keys and every include line naming it", () => {
    const ws = withGuide();
    const guide = join(plugin, "attachments/guide");
    const gateText = ws.text(gate);
    const notesText = ws.text(notes);
    const edit = renameBlock(ws, held(ws, join(guide, "index.block.md")), "manual");
    const { texts, moves } = appliedDocs(ws, edit);
    expect(moves).toEqual([[guide, join(dirname(guide), "manual")]]);
    expect(texts[gate]).toBe(gateText.replace("{{include:guide}}", "{{include:manual}}"));
    expect(texts[notes]).toBe(notesText.replace("  {{include:guide}}", "  {{include:manual}}"));
    expect(texts[manifest]).toContain('"mattstack:manual": { "tone": "calm" }');
    expect(texts[manifest]).toContain('"mattstack:manual/steps/first": { "hint": "" }');
    expect(edit.warnings).toEqual([
      "renaming a mattstack block is a breaking change: add `props-change: guide.tone: block renamed to manual` to the PR body",
      "renaming a mattstack block is a breaking change: add `props-change: guide/steps/first.hint: block renamed to manual/steps/first` to the PR body",
    ]);
  });

  test("the mattstack warning names each prop under the old id", () => {
    const ws = new Workspace([plugin, pack]);
    expect(renameBlock(ws, held(ws, gate), "ask").warnings).toEqual([
      "renaming a mattstack block is a breaking change: add `props-change: mini/gate.tiering: block renamed to mini/ask` to the PR body",
    ]);
  });

  test("a required prop on a renamed child also needs the newly-required waiver", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, ws.text(gate).replace('    default: "mattstack:model-tiering"\n', ""));
    expect(renameBlock(ws, held(ws, gate), "ask").warnings).toEqual([
      "renaming a mattstack block is a breaking change: add `props-change: mini/gate.tiering: block renamed to mini/ask` and `props-change: mini/ask.tiering: block renamed from mini/gate` to the PR body, each on its own line",
    ]);
  });

  test("an engine root is refused", () => {
    const ws = new Workspace([plugin, pack]);
    expect(refusal(() => renameBlock(ws, held(ws, join(mini, "index.block.md")), "tiny"))).toBe(ENGINE_REFUSAL);
  });

  test("a bad name, index, the current name and a sibling on disk or open are refused, nothing moved", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(join(mini, "draft/index.block.md"), "---\n---\n\n# Draft\n");
    const h = held(ws, gate);
    for (const bad of ["Gate", "1gate", "a/b", "ask.block.md", "", "-ask", "run/index"]) {
      expect(refusal(() => renameBlock(ws, h, bad))).toBe(`"${bad}" is not a block name: use lowercase letters, digits and dashes, starting with a letter`);
    }
    expect(refusal(() => renameBlock(ws, h, "index"))).toBe(`"index" names a folder block's own file, so a block cannot be called that`);
    expect(refusal(() => renameBlock(ws, h, "gate"))).toBe('the block is already called "gate"');
    expect(refusal(() => renameBlock(ws, h, "notes"))).toBe('"notes" is taken: attachments/pipeline/mini/notes.block.md already exists');
    expect(refusal(() => renameBlock(ws, h, "run"))).toBe('"run" is taken: attachments/pipeline/mini/run already exists');
    expect(refusal(() => renameBlock(ws, h, "draft"))).toBe('"draft" is taken: attachments/pipeline/mini/draft already exists');
    expect(readFileSync(gate, "utf8")).toContain("# Ask the gate");
  });

  test("a block in a pack-side tree carries no warning", () => {
    const kit = join(pack, "attachments/kit");
    mkdirSync(kit, { recursive: true });
    writeFileSync(join(kit, "index.block.md"), "---\n---\n\n# Kit\n");
    writeFileSync(join(kit, "part.block.md"), '---\nprops:\n  rules:\n    merge: add\n    default: ""\n---\n\n# Part\n\n{{props.rules}}\n');
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, ws.text(manifest).replace(`"${GATE}"`, `"widgets:kit/part": { "rules": "" },\n    "${GATE}"`));
    const edit = renameBlock(ws, held(ws, join(kit, "part.block.md")), "piece");
    expect(edit.warnings).toEqual([]);
    expect(appliedDocs(ws, edit).texts[manifest]).toContain('"widgets:kit/piece": { "rules": "" }');
  });
});

describe("renameAt on a block", () => {
  test("from a binding key renames the block the manifest sees", () => {
    const ws = new Workspace([plugin, pack]);
    expect(renameAt(ws, manifest, at(ws.text(manifest), `"${GATE}"`, 3), "ask", BLOCKS)).toEqual(renameBlock(ws, held(ws, gate), "ask"));
  });

  test("from an include renames the include root", () => {
    const ws = withGuide();
    const guide = held(ws, join(plugin, "attachments/guide/index.block.md"));
    expect(renameAt(ws, gate, at(ws.text(gate), "{{include:guide}}", 3), "manual", BLOCKS)).toEqual(renameBlock(ws, guide, "manual"));
  });

  test("a client without file renames is refused", () => {
    const ws = new Workspace([plugin, pack]);
    expect(refusal(() => renameAt(ws, manifest, at(ws.text(manifest), `"${GATE}"`, 3), "ask"))).toBe(NO_FILE_RENAMES);
  });

  test("an include root in a pack also rewrites the pack.path placeholders naming its folder", () => {
    const guide = join(pack, "attachments/guide");
    mkdirSync(guide, { recursive: true });
    writeFileSync(join(guide, "index.block.md"), "---\n---\n\n# Guide\n\nRead the tour.\n");
    writeFileSync(join(guide, "tour.md"), "The tour.\n");
    writeFileSync(gate, `${readFileSync(gate, "utf8").trimEnd()}\n\nRead {{pack.path:guide/tour.md}} and {{pack.path:mini-rules/fast.md}}.\n`);
    const ws = new Workspace([plugin, pack]);
    const { texts, moves } = appliedDocs(ws, renameBlock(ws, held(ws, join(guide, "index.block.md")), "manual"));
    expect(moves).toEqual([[guide, join(pack, "attachments/manual")]]);
    expect(texts[gate]).toContain("Read {{pack.path:manual/tour.md}} and {{pack.path:mini-rules/fast.md}}.");
  });
});

describe("willRenameEdits", () => {
  const withPlaceholder = () => {
    writeFileSync(gate, `${readFileSync(gate, "utf8").trimEnd()}\n\nRead {{pack.path:mini-rules/fast.md}}, then run {{pack.path:mini-rules/lint.sh}}.\n`);
    return new Workspace([plugin, pack]);
  };

  test("moving mini-rules to quick-rules rewrites the placeholders that name it, on the old uri", () => {
    const ws = withPlaceholder();
    const edit = willRenameEdits(ws, [{ from: join(pack, "attachments/mini-rules"), to: join(pack, "attachments/quick-rules") }]);
    expect(Object.keys(edit.changes)).toEqual([pathToFileURL(gate).href]);
    expect(applied(ws, edit)[gate]).toContain("Read {{pack.path:quick-rules/fast.md}}, then run {{pack.path:quick-rules/lint.sh}}.");
  });

  test("moving a file inside an attachment rewrites the file part", () => {
    const ws = withPlaceholder();
    const edit = willRenameEdits(ws, [{ from: join(pack, "attachments/mini-rules/fast.md"), to: join(pack, "attachments/mini-rules/quick.md") }]);
    expect(applied(ws, edit)[gate]).toContain("Read {{pack.path:mini-rules/quick.md}}, then run {{pack.path:mini-rules/lint.sh}}.");
  });

  test("renaming a compiled verb's folder rewrites verb.path", () => {
    writeFileSync(gate, `${readFileSync(gate, "utf8").trimEnd()}\n\nSee {{verb.path:mini}}.\n`);
    const ws = new Workspace([plugin, pack]);
    const edit = willRenameEdits(ws, [{ from: join(pack, "attachments/mini"), to: join(pack, "attachments/tiny") }]);
    expect(applied(ws, edit)[gate]).toContain("See {{verb.path:tiny}}.");
  });

  test("a move out of the pack's attachments rewrites nothing", () => {
    const ws = withPlaceholder();
    expect(willRenameEdits(ws, [{ from: join(pack, "attachments/mini-rules"), to: join(tmp, "elsewhere") }]).changes).toEqual({});
  });
});
