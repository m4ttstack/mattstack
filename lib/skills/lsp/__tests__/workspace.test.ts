import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rangeOf } from "../positions.ts";
import { Workspace } from "../workspace.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");

let tmp: string;
let plugin: string;
let pack: string;
let mini: string;
let manifest: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lsp-workspace-"));
  plugin = join(tmp, "mattstack");
  pack = join(tmp, "widgets");
  cpSync(join(FIXTURES, "plugins/mattstack"), plugin, { recursive: true });
  cpSync(join(FIXTURES, "pack"), pack, { recursive: true });
  mini = join(plugin, "attachments/pipeline/mini");
  manifest = join(pack, "pack/skills.jsonc");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const nopeManifest = () => readFileSync(manifest, "utf8").replace('"mattstack:mini/gate"', '"mattstack:mini/nope"');
const allDiagnostics = (ws: Workspace) => [...ws.analysis().diagnostics.values()].flat();
const covered = (text: string, d: Parameters<typeof rangeOf>[0]) => {
  const range = rangeOf(d, text);
  return text.split("\n")[range.start.line]!.slice(range.start.character, range.end.character);
};

describe("Workspace", () => {
  test("the mini plugin root and the blocks pack analyse clean", () => {
    const ws = new Workspace([plugin, pack]);
    const a = ws.analysis();
    expect(allDiagnostics(ws)).toEqual([]);
    expect(ws.engineDirs()).toContain(mini);
    expect(a.trees.get(mini)?.byId.has("mini/gate")).toBe(true);
    expect(a.byBlockId.get("mattstack:mini/run")?.block.title).toBe("Run the step");
    expect(a.manifests.get(manifest)?.layered["mattstack:mini"]?.rules).toEqual([{ layer: "pack", value: "widgets:mini-rules/fast" }]);
  });

  test("a block edited to a bad merge reports only that file and the last good tree stays", () => {
    const ws = new Workspace([plugin, pack]);
    const good = ws.analysis().trees.get(mini);
    const gate = join(mini, "gate.block.md");
    ws.open(gate, ws.text(gate));
    ws.change(gate, ws.text(gate).replace("merge: replace", "merge: sideways"));
    const a = ws.analysis();
    expect(a.diagnostics.get(gate)?.[0]).toMatchObject({ code: "bad-value", line: 5, col: 3 });
    expect([...a.diagnostics.entries()].filter(([f, ds]) => f !== gate && ds.length > 0)).toEqual([]);
    expect(a.trees.get(mini)).toBe(good);
  });

  test("a root that stops parsing keeps the last good tree and reports the parse error", () => {
    const ws = new Workspace([plugin, pack]);
    const good = ws.analysis().trees.get(mini);
    const index = join(mini, "index.block.md");
    ws.open(index, ws.text(index));
    ws.change(index, ws.text(index).replace("type: pipeline-step", "type: [pipeline-step"));
    const a = ws.analysis();
    expect(a.diagnostics.get(index)?.[0]?.code).toBe("bad-frontmatter");
    expect(a.trees.get(mini)).toBe(good);
    ws.close(index);
    expect(ws.analysis().diagnostics.get(index) ?? []).toEqual([]);
  });

  test("before any good load a tree is null", () => {
    writeFileSync(join(mini, "index.block.md"), "---\ntype: [pipeline-step\n---\n\n# mini\n");
    const ws = new Workspace([plugin]);
    expect(ws.analysis().trees.get(mini)).toBeNull();
    expect(ws.analysis().diagnostics.get(join(mini, "index.block.md"))?.[0]?.code).toBe("bad-frontmatter");
  });

  test("a binding to a block the open engine lacks is missing-block at the key", () => {
    const ws = new Workspace([plugin, pack]);
    const text = nopeManifest();
    ws.open(manifest, text);
    const ds = ws.analysis().diagnostics.get(manifest) ?? [];
    expect(ds.map((d) => d.code)).toEqual(["missing-block"]);
    expect(covered(text, ds[0]!)).toBe('"mattstack:mini/nope"');
  });

  test("the same key is clean once the plugin root holds the block", () => {
    writeFileSync(join(mini, "nope.block.md"), '---\nprops:\n  tiering:\n    merge: replace\n    default: ""\n---\n\n# Nope\n\nText.\n');
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, nopeManifest());
    expect(allDiagnostics(ws)).toEqual([]);
  });

  test("with only the pack open, a key under an engine no root holds is not reported", () => {
    const ws = new Workspace([pack]);
    ws.open(manifest, nopeManifest());
    expect(allDiagnostics(ws)).toEqual([]);
  });

  test("a prop the block does not declare is unknown-prop at the prop key", () => {
    const ws = new Workspace([plugin, pack]);
    const text = readFileSync(manifest, "utf8").replace('{ "tiering": "" }', '{ "speed": "" }');
    ws.open(manifest, text);
    const ds = ws.analysis().diagnostics.get(manifest) ?? [];
    expect(ds.map((d) => d.code)).toEqual(["unknown-prop"]);
    expect(covered(text, ds[0]!)).toBe('"speed"');
  });

  test("a binding whose skill is not found is fill-missing at the value", () => {
    const ws = new Workspace([plugin, pack]);
    const text = readFileSync(manifest, "utf8").replace("widgets:mini-rules/fast", "widgets:no-such-skill");
    ws.open(manifest, text);
    const ds = ws.analysis().diagnostics.get(manifest) ?? [];
    expect(ds.map((d) => d.code)).toEqual(["fill-missing"]);
    expect(covered(text, ds[0]!)).toBe('"widgets:no-such-skill"');
  });

  test("a manifest that does not parse is null with a diagnostic", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, '{ "bindings": { "mattstack:mini": ');
    const a = ws.analysis();
    expect(a.manifests.get(manifest)).toBeNull();
    expect(a.diagnostics.get(manifest)?.length).toBe(1);
  });

  test("text reads the overlay, then disk", () => {
    const ws = new Workspace([plugin]);
    const gate = join(mini, "gate.block.md");
    expect(ws.text(gate)).toBe(readFileSync(gate, "utf8"));
    ws.open(gate, "edited");
    expect(ws.text(gate)).toBe("edited");
    ws.close(gate);
    expect(ws.text(gate)).toBe(readFileSync(gate, "utf8"));
  });

  test("garbage in any open file never throws", () => {
    const ws = new Workspace([plugin, pack]);
    for (const text of ["", "---", "---\n---\n{{props.", "\u0000\u0001", "---\nprops: [\n---\n", "[]", "null", '{"bindings": []}']) {
      ws.open(join(mini, "index.block.md"), text);
      ws.open(join(mini, "gate.block.md"), text);
      ws.open(manifest, text);
      expect(() => ws.analysis()).not.toThrow();
    }
  });

  test("a marker that does not sit alone on its line is bad-marker at the marker", () => {
    const ws = new Workspace([plugin, pack]);
    const gate = join(mini, "gate.block.md");
    const text = ws.text(gate).replace("{{props.tiering}}", "Use {{props.tiering}} here.");
    ws.open(gate, text);
    const ds = ws.analysis().diagnostics.get(gate) ?? [];
    expect(ds.map((d) => d.code)).toEqual(["bad-marker"]);
    expect(covered(text, ds[0]!)).toBe("{{props.tiering}}");
  });

  test("an include no plugin holds and an unknown placeholder are reported where they sit", () => {
    const ws = new Workspace([plugin, pack]);
    const gate = join(mini, "gate.block.md");
    const text = `${ws.text(gate).trimEnd()}\n\n{{include:no-such-include}}\n\nSee {{nope.placeholder}}\n`;
    ws.open(gate, text);
    const ds = ws.analysis().diagnostics.get(gate) ?? [];
    expect(ds.map((d) => [d.code, covered(text, d)])).toEqual([
      ["bad-value", "{{include:no-such-include}}"],
      ["bad-value", "{{nope.placeholder}}"],
    ]);
  });
});

describe("Workspace with two plugins of the same name", () => {
  let other: string;
  let otherMini: string;

  beforeEach(() => {
    other = join(tmp, "mattstack-copy");
    cpSync(join(FIXTURES, "plugins/mattstack"), other, { recursive: true });
    otherMini = join(other, "attachments/pipeline/mini");
    cpSync(join(other, "attachments/style-floor"), join(other, "attachments/copy-floor"), { recursive: true });
    const notes = join(otherMini, "notes.block.md");
    writeFileSync(notes, readFileSync(notes, "utf8").replace("mattstack:style-floor", "mattstack:copy-floor"));
  });

  test("each copy resolves fills in its own plugin", () => {
    const ws = new Workspace([plugin, other, pack]);
    expect(allDiagnostics(ws)).toEqual([]);
  });

  test("a key the other copy lacks the block for is not missing-block", () => {
    rmSync(join(otherMini, "gate.block.md"));
    const ws = new Workspace([plugin, other, pack]);
    expect(ws.analysis().diagnostics.get(manifest)).toEqual([]);
  });

  test("a prop the other copy's block does not declare is not unknown-prop", () => {
    writeFileSync(join(otherMini, "gate.block.md"), "---\nnode: ask_gate\nkind: gate\n---\n\n# Ask the gate\n\nAsk the human.\n");
    const ws = new Workspace([plugin, other, pack]);
    expect(allDiagnostics(ws)).toEqual([]);
  });

  test("a key neither copy holds is still missing-block", () => {
    const ws = new Workspace([plugin, other, pack]);
    ws.open(manifest, nopeManifest());
    expect(allDiagnostics(ws).map((d) => d.code)).toEqual(["missing-block"]);
  });
});

describe("Workspace plugin discovery", () => {
  test("is walked once until a document opens, changes or closes", () => {
    const ws = new Workspace([plugin, pack]);
    const first = ws.plugins();
    expect(first.map((p) => p.name).sort()).toEqual(["mattstack", "widgets"]);
    ws.analysis();
    ws.rootsFor([manifest]);
    expect(ws.plugins()).toBe(first);
    ws.open(manifest, readFileSync(manifest, "utf8"));
    expect(ws.plugins()).not.toBe(first);
  });

  test("refresh follows a folder moved on disk, carrying its open documents to the new path", () => {
    const ws = new Workspace([plugin, pack]);
    const run = join(mini, "run");
    const step = join(mini, "step");
    const edited = `${readFileSync(join(run, "check.block.md"), "utf8")}\nEdited.\n`;
    ws.open(join(run, "check.block.md"), edited);
    ws.open(manifest, readFileSync(manifest, "utf8").replace('"mattstack:mini/gate"', '"mattstack:mini/step/check": {},\n    "mattstack:mini/gate"'));
    expect(ws.analysis().byBlockId.has("mattstack:mini/run/check")).toBe(true);
    const plugins = ws.plugins();
    renameSync(run, step);
    ws.refresh([{ from: run, to: step }]);
    expect(ws.plugins()).not.toBe(plugins);
    expect(ws.text(join(step, "check.block.md"))).toBe(edited);
    expect(ws.text(join(run, "check.block.md"))).toBe("");
    expect(ws.analysis().byBlockId.get("mattstack:mini/step/check")?.block.path).toBe(join(step, "check.block.md"));
    expect(ws.analysis().byBlockId.has("mattstack:mini/run/check")).toBe(false);
    expect(allDiagnostics(ws).filter((d) => d.code === "missing-block")).toEqual([]);
  });
});
