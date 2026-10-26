import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiagnosticSeverity } from "vscode-languageserver";
import { publishable } from "../diagnostics.ts";
import { Workspace } from "../workspace.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");

let tmp: string;
let plugin: string;
let gate: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lsp-diagnostics-"));
  plugin = join(tmp, "mattstack");
  cpSync(join(FIXTURES, "plugins/mattstack"), plugin, { recursive: true });
  gate = join(plugin, "attachments/pipeline/mini/gate.block.md");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("publishable", () => {
  test("a clean file publishes no diagnostics", () => {
    expect(publishable(new Workspace([plugin]), gate)).toEqual([]);
  });

  test("an unknown marker is an error over the marker, from skill-blocks, with its code", () => {
    const ws = new Workspace([plugin]);
    const text = `${ws.text(gate)}\n{{props.nope}}\n`;
    ws.open(gate, text);
    const ds = publishable(ws, gate);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ severity: DiagnosticSeverity.Error, source: "skill-blocks", code: "unknown-prop" });
    const { start, end } = ds[0]!.range;
    expect(text.split("\n")[start.line]!.slice(start.character, end.character)).toBe("{{props.nope}}");
    expect(ds[0]!.message).toContain("nope");
  });

  test("a file outside the workspace publishes nothing", () => {
    expect(publishable(new Workspace([plugin]), join(tmp, "elsewhere.block.md"))).toEqual([]);
  });
});
