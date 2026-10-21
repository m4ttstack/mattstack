import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { hasTeamMarker, newTeamContext, readTeamValues, resolveTeamMarkers, type TeamValues } from "../team-params.ts";

const where = "acme-base:provision-flow";

function ctx(params: Record<string, string> = {}, sections: Record<string, string> = {}) {
  const values: TeamValues = { plugin: "widgets", version: "0.4.0", params, sections };
  return newTeamContext(values, new Set(["acme-base"]));
}

function packWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "team-params-"));
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

describe("team-params", () => {
  test("resolves a value marker", () => {
    const team = ctx({ "linear-team": "Widgets" });
    expect(resolveTeamMarkers("team {{team.linear-team}}", team, { where, sectionSeams: true })).toBe("team Widgets");
    expect(team.sawMarker).toBe(true);
    expect(team.used.has("linear-team")).toBe(true);
  });

  test("optional value renders empty when absent", () => {
    const team = ctx();
    expect(resolveTeamMarkers("a {{team.x?}} b", team, { where, sectionSeams: true })).toBe("a  b");
    expect(team.missing.size).toBe(0);
  });

  test("required value records missing", () => {
    const team = ctx();
    expect(resolveTeamMarkers("{{team.ticket-prefix}}", team, { where, sectionSeams: true })).toBe("");
    expect(team.missing.get("param:ticket-prefix")).toEqual({
      kind: "param",
      name: "ticket-prefix",
      file: "pack/params.jsonc",
      askedBy: ["acme-base:provision-flow"],
    });
  });

  test("empty string counts as missing", () => {
    const team = ctx({ k: "" });
    resolveTeamMarkers("{{team.k}}", team, { where, sectionSeams: true });
    expect(team.missing.has("param:k")).toBe(true);
  });

  test("section with seams", () => {
    const team = ctx({}, { "ci-extra": "line one\nline two\n" });
    expect(resolveTeamMarkers("{{team.section:ci-extra}}", team, { where, sectionSeams: true })).toBe(
      "<!-- part: section:ci-extra source=widgets:pack/sections/ci-extra.md version=0.4.0 path=pack/sections/ci-extra.md lines=1-2 -->\nline one\nline two",
    );
  });

  test("section without seams", () => {
    const team = ctx({}, { "ci-extra": "line one\nline two\n" });
    expect(resolveTeamMarkers("{{team.section:ci-extra}}", team, { where, sectionSeams: false })).toBe("line one\nline two");
  });

  test("optional absent section removes its line", () => {
    const team = ctx();
    expect(resolveTeamMarkers("a\n{{team.section:x?}}\nb", team, { where, sectionSeams: true })).toBe("a\nb");
    expect(team.missing.size).toBe(0);
  });

  test("required absent section records missing", () => {
    const team = ctx();
    resolveTeamMarkers("{{team.section:x}}", team, { where, sectionSeams: true });
    expect(team.missing.get("section:x")).toEqual({ kind: "section", name: "x", file: "pack/sections/x.md", askedBy: [where] });
  });

  test("whitespace-only section counts as missing", () => {
    const team = ctx({}, { x: " \n\n" });
    resolveTeamMarkers("{{team.section:x}}", team, { where, sectionSeams: true });
    expect(team.missing.has("section:x")).toBe(true);
  });

  test("CRLF section normalizes", () => {
    const team = ctx({}, { x: "one\r\ntwo\r\n\r\n" });
    const out = resolveTeamMarkers("{{team.section:x}}", team, { where, sectionSeams: true });
    expect(out.endsWith("\none\ntwo")).toBe(true);
    expect(out).toContain("lines=1-2");
  });

  test("resolves markers inside code fences", () => {
    const team = ctx({ a: "A" });
    const out = resolveTeamMarkers("```\n{{team.a}} {{team.b}}\n```", team, { where, sectionSeams: true });
    expect(out).toBe("```\nA \n```");
    expect(team.missing.has("param:b")).toBe(true);
  });

  test("refuses section marker not alone on its line", () => {
    expect(() => resolveTeamMarkers("ok\nx {{team.section:a}}", ctx({}, { a: "t" }), { where, sectionSeams: true })).toThrow(
      new RegExp(`${where}.*line 2`),
    );
  });

  test("refuses nested marker", () => {
    expect(() => resolveTeamMarkers("{{pack.path:{{team.x}}/a}}", ctx({ x: "y" }), { where, sectionSeams: true })).toThrow(
      new RegExp(`${where}.*line 1`),
    );
  });

  test("startLine shifts the reported line", () => {
    expect(() => resolveTeamMarkers("a\n{{team.x}}", ctx({ x: "{{y}}" }), { where, sectionSeams: true, startLine: 11 })).toThrow(new RegExp(`${where}.*line 12`));
  });

  test("refuses {{ in a value", () => {
    expect(() => resolveTeamMarkers("a\n{{team.x}}", ctx({ x: "{{y}}" }), { where, sectionSeams: true })).toThrow(new RegExp(`${where}.*line 2`));
  });

  test("refuses {{ in a section", () => {
    expect(() => resolveTeamMarkers("{{team.section:s}}", ctx({}, { s: "a {{b}}" }), { where, sectionSeams: true })).toThrow(
      new RegExp(`${where}.*line 1`),
    );
  });

  test("refuses key named section", () => {
    expect(() => resolveTeamMarkers("{{team.section}}", ctx(), { where, sectionSeams: true })).toThrow(new RegExp(`${where}.*line 1`));
  });

  test("refuses bad key", () => {
    expect(() => resolveTeamMarkers("{{team.Bad_Key}}", ctx(), { where, sectionSeams: true })).toThrow(new RegExp(`${where}.*line 1`));
  });

  test.each(["{{team.foo bar}}", "{{team.x?y}}", "{{team.section: x}}", "{{ team.x }}", "{{team.x}"])("refuses malformed marker %s", (raw) => {
    const team = ctx({ x: "v" });
    expect(() => resolveTeamMarkers(`a\n${raw}`, team, { where, sectionSeams: true })).toThrow(new RegExp(`${where}.*line 2`));
    expect(hasTeamMarker(raw)).toBe(true);
  });

  test("hasTeamMarker", () => {
    expect(hasTeamMarker("a {{team.x}}")).toBe(true);
    expect(hasTeamMarker("a {{slot:x}}")).toBe(false);
  });
});

describe("readTeamValues", () => {
  test("missing file gives empty params", () => {
    const dir = mkdtempSync(join(tmpdir(), "team-params-"));
    expect(readTeamValues(dir, "widgets", "0.4.0")).toEqual({ plugin: "widgets", version: "0.4.0", params: {}, sections: {} });
  });

  test("reads params and sections", () => {
    const dir = packWith({
      "pack/params.jsonc": '// note\n{"version":1,"params":{"a":"x"}}',
      "pack/sections/ci-extra.md": "hello\n",
      "pack/sections/notes.txt": "ignored",
    });
    expect(readTeamValues(dir, "widgets", "0.4.0")).toEqual({
      plugin: "widgets",
      version: "0.4.0",
      params: { a: "x" },
      sections: { "ci-extra": "hello\n" },
    });
  });

  test.each([
    ["malformed JSON", "{nope"],
    ["params not an object", '{"version":1,"params":[]}'],
    ["non-string value", '{"version":1,"params":{"a":1}}'],
    ["newline in a value", '{"version":1,"params":{"a":"x\\ny"}}'],
  ])("%s throws", (_name, text) => {
    const dir = packWith({ "pack/params.jsonc": text });
    expect(() => readTeamValues(dir, "widgets", "0.4.0")).toThrow(/pack\/params\.jsonc/);
  });
});
