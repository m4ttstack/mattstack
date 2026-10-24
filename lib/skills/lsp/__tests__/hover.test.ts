import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hoverAt } from "../hover.ts";
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
  tmp = mkdtempSync(join(tmpdir(), "lsp-hover-"));
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

const hover = (ws: Workspace, file: string, needle: string, ahead?: number) => hoverAt(ws, file, at(ws.text(file), needle, ahead));
const linesOf = (contents: string | undefined) => (contents ?? "").split("\n").filter((l) => l !== "");
const covered = (ws: Workspace, file: string, h: NonNullable<ReturnType<typeof hoverAt>>) =>
  ws.text(file).split("\n")[h.range.start.line]!.slice(h.range.start.character, h.range.end.character);

describe("hoverAt on a prop", () => {
  test("a marker lists the merge, the default, each layer and the contract", () => {
    const ws = new Workspace([plugin, pack]);
    const h = hover(ws, gate, "{{props.tiering}}", 3);
    expect(linesOf(h?.contents)).toEqual(['**tiering** · replace · default: "mattstack:model-tiering"', "- pack: cleared", "contract: model-tiering@1"]);
    expect(covered(ws, gate, h!)).toBe("{{props.tiering}}");
  });

  test("prose is null", () => {
    const ws = new Workspace([plugin, pack]);
    expect(hover(ws, gate, "Ask the human")).toBeNull();
  });

  test("a fill layer names its attachment file and line count", () => {
    const ws = new Workspace([plugin, pack]);
    const h = hover(ws, join(mini, "index.block.md"), "{{props.rules}}");
    expect(linesOf(h?.contents)).toEqual(['**rules** · add · default: ""', "- pack: mini-rules/fast.md (2 lines)"]);
  });

  test("a prop declaration hovers like its marker", () => {
    const ws = new Workspace([plugin, pack]);
    const decl = hover(ws, gate, "tiering:");
    expect(decl?.contents).toBe(hover(ws, gate, "{{props.tiering}}")!.contents);
    expect(covered(ws, gate, decl!)).toBe("tiering");
  });

  test("with no manifest binding it shows only the header and the contract", () => {
    const ws = new Workspace([plugin]);
    expect(linesOf(hover(ws, gate, "{{props.tiering}}")?.contents)).toEqual([
      '**tiering** · replace · default: "mattstack:model-tiering"',
      "contract: model-tiering@1",
    ]);
  });

  test("a marker for a prop the block does not declare is null", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate)}\n{{props.nope}}\n`);
    expect(hover(ws, gate, "{{props.nope}}")).toBeNull();
  });

  test("several binding manifests and a pipeline override each get their own group", () => {
    mkdirSync(join(pack, "more"), { recursive: true });
    writeFileSync(
      join(pack, "more/skills.jsonc"),
      JSON.stringify({
        version: 2,
        bindings: { "mattstack:mini/gate": { tiering: "mattstack:model-tiering" } },
        pipelines: { fast: { bindings: { "mattstack:mini/gate": { tiering: "" } } } },
      }),
    );
    const ws = new Workspace([plugin, pack]);
    expect(linesOf(hover(ws, gate, "{{props.tiering}}")?.contents)).toEqual([
      '**tiering** · replace · default: "mattstack:model-tiering"',
      "**more/skills.jsonc**",
      "- pack: model-tiering/SKILL.md (1 line)",
      "**pipeline fast**",
      "- pack: cleared",
      "**pack/skills.jsonc**",
      "- pack: cleared",
      "contract: model-tiering@1",
    ]);
  });
});

describe("hoverAt on a binding value", () => {
  test("shows the fill's description and what it provides", () => {
    const ws = new Workspace([plugin, pack]);
    const h = hover(ws, manifest, '"widgets:mini-rules/fast"', 2);
    expect(h?.contents).toContain("Rules for the mini widget step");
    expect(h?.contents).toContain("provides: mini-rules@1");
    expect(covered(ws, manifest, h!)).toBe('"widgets:mini-rules/fast"');
  });

  test("a value that does not resolve is null", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(manifest, readFileSync(manifest, "utf8").replace("widgets:mini-rules/fast", "widgets:no-such-fill"));
    expect(hover(ws, manifest, '"widgets:no-such-fill"', 2)).toBeNull();
  });

  test("a cleared value is null", () => {
    const ws = new Workspace([plugin, pack]);
    expect(hover(ws, manifest, '""')).toBeNull();
  });
});

describe("hoverAt on an include", () => {
  test("shows the include root's title and block count", () => {
    const gp = join(plugin, "attachments/gp");
    mkdirSync(gp, { recursive: true });
    writeFileSync(join(gp, "index.block.md"), "---\n---\n\n# Gate protocol\n\nAsk before acting.\n");
    writeFileSync(join(gp, "step.block.md"), "---\n---\n\n# One step\n\nDo one thing.\n");
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{include:gp}}\n`);
    const h = hover(ws, gate, "{{include:gp}}");
    expect(h?.contents).toContain("Gate protocol");
    expect(h?.contents).toContain("2 blocks");
  });
});

describe("hoverAt on a skill path", () => {
  test("pack.path names its source from the pack's root, says it exists and where each built skill reads its copy", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\nRead {{pack.path:mini-rules/fast.md}} first.\n`);
    const h = hover(ws, gate, "{{pack.path:mini-rules/fast.md}}", 4);
    expect(linesOf(h?.contents)).toEqual(["**pack.path** · widgets", "`attachments/mini-rules/fast.md` · exists", "copied into each built skill's `references/mini-rules/fast.md`"]);
    expect(covered(ws, gate, h!)).toBe("{{pack.path:mini-rules/fast.md}}");
  });

  test("a missing pack.path target says so", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{pack.path:mini-rules/gone.md}}\n`);
    expect(linesOf(hover(ws, gate, "{{pack.path:", 4)?.contents)).toEqual(["**pack.path** · widgets", "`attachments/mini-rules/gone.md` · does not exist"]);
  });

  test("pack.path into a compiled output folder says it is compiled output", () => {
    mkdirSync(join(pack, "attachments/stage-x"), { recursive: true });
    writeFileSync(join(pack, "attachments/stage-x/SKILL.md"), '---\nname: "stage-x"\nmetadata:\n  compiled: "mattstack@1.0.0"\n---\n');
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{pack.path:stage-x/SKILL.md}}\n`);
    expect(linesOf(hover(ws, gate, "{{pack.path:", 4)?.contents)).toEqual(["**pack.path** · widgets", "`attachments/stage-x/SKILL.md` · compiled output, not pack source"]);
  });

  test("pack.path picking its attachment by team value names the target the pack's value resolves to", () => {
    writeFileSync(join(pack, "pack/params.jsonc"), '{\n  // the fill each team picks\n  "params": { "gates-fill": "mini-rules" }\n}\n');
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\nRead {{pack.path:{{team.gates-fill}}/fast.md}} first.\n`);
    const h = hover(ws, gate, "{{pack.path:", 4);
    expect(linesOf(h?.contents)).toEqual(["**pack.path** · widgets", "`{{team.gates-fill}}` is `mini-rules`", "`attachments/mini-rules/fast.md` · exists", "copied into each built skill's `references/mini-rules/fast.md`"]);
    expect(covered(ws, gate, h!)).toBe("{{pack.path:{{team.gates-fill}}/fast.md}}");
    expect(linesOf(hover(ws, gate, "{{team.gates-fill}}", 4)?.contents)).toEqual(linesOf(h?.contents));
  });

  test("an open params.jsonc buffer is what the team value reads", () => {
    writeFileSync(join(pack, "pack/params.jsonc"), '{ "params": { "gates-fill": "mini-rules" } }\n');
    const ws = new Workspace([plugin, pack]);
    ws.open(join(pack, "pack/params.jsonc"), '{ "params": { "gates-fill": "other-rules" } }\n');
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{pack.path:{{team.gates-fill}}/fast.md}}\n`);
    expect(linesOf(hover(ws, gate, "{{pack.path:", 4)?.contents)).toEqual([
      "**pack.path** · widgets",
      "`{{team.gates-fill}}` is `other-rules`",
      "`attachments/other-rules/fast.md` · does not exist",
    ]);
  });

  test("with no value for the team key the target depends on it", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{pack.path:{{team.gates-fill}}/fast.md}}\n`);
    expect(linesOf(hover(ws, gate, "{{pack.path:", 4)?.contents)).toEqual([
      "**pack.path** · widgets",
      "the target depends on the team value `gates-fill`, which widgets does not set",
    ]);
  });

  test("verb.path names the compiled verb's SKILL.md", () => {
    const ws = new Workspace([plugin, pack]);
    ws.open(gate, `${ws.text(gate).trimEnd()}\n\n{{verb.path:mini}}\n`);
    expect(linesOf(hover(ws, gate, "{{verb.path:", 4)?.contents)).toEqual(["**verb.path** · widgets", "`attachments/mini/SKILL.md` · does not exist"]);
  });
});
