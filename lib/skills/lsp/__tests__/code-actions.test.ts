import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { codeActionsAt } from "../code-actions.ts";
import { publishable } from "../diagnostics.ts";
import type { Range } from "../positions.ts";
import { Workspace } from "../workspace.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");
const HAND = "../../attachments/mini-rules/fast.md";

let tmp: string;
let plugin: string;
let pack: string;
let gate: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lsp-code-actions-"));
  plugin = join(tmp, "mattstack");
  pack = join(tmp, "widgets");
  cpSync(join(FIXTURES, "plugins/mattstack"), plugin, { recursive: true });
  cpSync(join(FIXTURES, "pack"), pack, { recursive: true });
  gate = join(plugin, "attachments/pipeline/mini/gate.block.md");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** Opens gate with `line` appended and returns the published hand-typed-path diagnostics. */
function withLine(ws: Workspace, line: string) {
  ws.open(gate, `${ws.text(gate).trimEnd()}\n\n${line}\n`);
  return publishable(ws, gate).filter((d) => d.code === "hand-typed-path");
}

/** What compile leaves for a stage named only in a manifest outside the pack: an output folder marked compiled. */
function withStageOutput(): void {
  mkdirSync(join(pack, "attachments/stage-x"), { recursive: true });
  writeFileSync(join(pack, "attachments/stage-x/SKILL.md"), '---\nname: "stage-x"\ndescription: ""\nmetadata:\n  compiled: "mattstack@1.0.0"\n---\n\nBody.\n');
}

const covered =(ws: Workspace, r: Range) => ws.text(gate).split("\n")[r.start.line]!.slice(r.start.character, r.end.character);

function applied(ws: Workspace, edit: { changes: Record<string, { range: Range; newText: string }[]> }): string {
  const edits = edit.changes[pathToFileURL(gate).href] ?? [];
  expect(edits).toHaveLength(1);
  const { range, newText } = edits[0]!;
  const row = ws.text(gate).split("\n")[range.start.line]!;
  return row.slice(0, range.start.character) + newText + row.slice(range.end.character);
}

describe("hand-typed paths in the editor", () => {
  test("a hand-typed path publishes hand-typed-path over exactly the path", () => {
    const ws = new Workspace([plugin, pack]);
    const ds = withLine(ws, `Read ${HAND} first.`);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ source: "skill-blocks", severity: 1 });
    expect(covered(ws, ds[0]!.range)).toBe(HAND);
  });

  test("its code action rewrites the span into the placeholder", () => {
    const ws = new Workspace([plugin, pack]);
    const [d] = withLine(ws, `Read ${HAND} first.`);
    const actions = codeActionsAt(ws, gate, d!.range);
    expect(actions.map((a) => a.title)).toEqual(["Use {{pack.path:mini-rules/fast.md}}"]);
    expect(actions[0]!.diagnostic).toEqual(d!);
    expect(applied(ws, actions[0]!.edit)).toBe("Read {{pack.path:mini-rules/fast.md}} first.");
  });

  test("a path to a sibling compiled verb's SKILL.md becomes verb.path", () => {
    const ws = new Workspace([plugin, pack]);
    const [d] = withLine(ws, "See ../mini/SKILL.md for the rest.");
    const actions = codeActionsAt(ws, gate, d!.range);
    expect(actions.map((a) => a.title)).toEqual(["Use {{verb.path:mini}}"]);
    expect(applied(ws, actions[0]!.edit)).toBe("See {{verb.path:mini}} for the rest.");
  });

  test("a diagnostic without a fix has no code action", () => {
    const ws = new Workspace([plugin, pack]);
    const [d] = withLine(ws, "Read ../../attachments/nowhere/x.md first.");
    expect(d).toBeDefined();
    expect(codeActionsAt(ws, gate, d!.range)).toEqual([]);
  });

  test("with no pack open the verbs are unknown, so the path gets no fix", () => {
    const ws = new Workspace([plugin]);
    const [d] = withLine(ws, "See ../mini/SKILL.md for the rest.");
    expect(d).toBeDefined();
    expect(codeActionsAt(ws, gate, d!.range)).toEqual([]);
  });

  test("a stage's output folder, named by no manifest in the pack, gets no pack.path or verb.path fix", () => {
    withStageOutput();
    const ws = new Workspace([plugin, pack]);
    const [d] = withLine(ws, "See ../stage-x/SKILL.md now.");
    expect(d).toBeDefined();
    expect(codeActionsAt(ws, gate, d!.range)).toEqual([]);
  });

  test("a range away from the diagnostic gets no action", () => {
    const ws = new Workspace([plugin, pack]);
    withLine(ws, `Read ${HAND} first.`);
    expect(codeActionsAt(ws, gate, { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } })).toEqual([]);
  });
});

describe("team sections and params", () => {
  test("a section's hand-typed path gets the same fix compile offers, and the fixed text is clean", () => {
    const ws = new Workspace([plugin, pack]);
    const section = join(pack, "pack/sections/gates.md");
    ws.open(section, `Gates.\nRead ${HAND} first.\n`);
    const [d] = publishable(ws, section).filter((x) => x.code === "hand-typed-path");
    expect(d?.range).toEqual({ start: { line: 1, character: 5 }, end: { line: 1, character: 5 + HAND.length } });
    const [action] = codeActionsAt(ws, section, d!.range);
    expect(action!.edit.changes[pathToFileURL(section).href]![0]!.newText).toBe("{{pack.path:mini-rules/fast.md}}");
    ws.change(section, "Gates.\nRead {{pack.path:mini-rules/fast.md}} first.\n");
    expect(publishable(ws, section)).toEqual([]);
  });

  test("a params.jsonc value's hand-typed path points at the value inside the file", () => {
    const ws = new Workspace([plugin, pack]);
    const params = join(pack, "pack/params.jsonc");
    const text = `{\n  "params": {\n    "rules": "${HAND}"\n  }\n}\n`;
    ws.open(params, text);
    const [d] = publishable(ws, params).filter((x) => x.code === "hand-typed-path");
    expect(d?.range).toEqual({ start: { line: 2, character: 14 }, end: { line: 2, character: 14 + HAND.length } });
  });

  test("a fill splicing a section reports the section's path once, at the section", () => {
    const ws = new Workspace([plugin, pack]);
    const section = join(pack, "pack/sections/gates.md");
    ws.open(section, `Read ${HAND} first.\n`);
    const fill = join(pack, "attachments/mini-rules/fast.md");
    ws.open(fill, `${ws.text(fill).trimEnd()}\n{{team.section:gates}}\n`);
    const all = [...ws.analysis().diagnostics.values()].flat().filter((x) => x.code === "hand-typed-path");
    expect(all.map((x) => x.file)).toEqual([section]);
  });
});

describe("a bound fill's unsaved buffer", () => {
  test("the diagnostic and its quick fix follow edits that have not been saved", () => {
    const ws = new Workspace([plugin, pack]);
    const fill = join(pack, "attachments/mini-rules/fast.md");
    const base = `${ws.text(fill).trimEnd()}\nRead ${HAND} first.\n`;
    const lineOf = (text: string) => text.split("\n").findIndex((l) => l.includes(HAND));
    for (const text of [base, `A new first line.\n${base}`]) {
      ws.open(fill, text);
      const [d] = publishable(ws, fill).filter((x) => x.code === "hand-typed-path");
      expect(d).toBeDefined();
      expect(d!.range.start.line).toBe(lineOf(text));
      const [action] = codeActionsAt(ws, fill, d!.range);
      expect(action!.edit.changes[pathToFileURL(fill).href]![0]!.range).toEqual(d!.range);
    }
  });
});
