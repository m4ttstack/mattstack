import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadEnrichment, stripJsonc } from "../enrichment.ts";
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import * as out from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnings } from "../../ui/warn.ts";
import { sharedStorePath } from "../../../packages/rt-client/test/org-fixture.ts";

function writeStore(file: string, obj: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2));
}

describe("stripJsonc", () => {
  test("removes line + block comments and trailing commas", () => {
    const out = stripJsonc(`{
      // a comment
      "a": 1, /* inline */
      "b": 2,   // trailing comma below
    }`);
    expect(JSON.parse(out)).toEqual({ a: 1, b: 2 });
  });
});

describe("loadEnrichment", () => {
  // rt.sdmEnrichment reads through the settings resolver now (ownership
  // latch), so every case here needs an isolated HOME — a real ~/.mattstack
  // must never leak into these reads.
  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "enr-home-")));
  });

  const write = (s: string) => { const p = join(mkdtempSync(join(tmpdir(), "enr-")), "e.jsonc"); writeFileSync(p, s); return p; };

  test("store unowned: reads a JSONC map from the file", () => {
    const p = write(`{ "acme-db-qa": { "label": "acme qa", "db": { "schema": "acme" } } }`);
    expect(loadEnrichment(p)).toEqual({ "acme-db-qa": { label: "acme qa", db: { schema: "acme" } } });
  });
  test("store unowned, missing file -> {}", () => { expect(loadEnrichment(join(tmpdir(), "nope-x.jsonc"))).toEqual({}); });
  test("store unowned, corrupt file -> {} (never throws)", () => { expect(loadEnrichment(write("{ not json"))).toEqual({}); });

  test("store-owned: store wins wholesale, the file is never consulted", () => {
    const p = write(`{ "file-only": { "label": "from file" } }`);
    writeStore(sharedStorePath("acme"), {
      "rt.sdmEnrichment": { "acme-db-qa": { label: "from store", tier: "gold" } },
    });

    expect(loadEnrichment(p)).toEqual({ "acme-db-qa": { label: "from store", tier: "gold" } });
  });

  test("store shape validation: a non-object store value is refused, falling back to the file", () => {
    const p = write(`{ "acme-db-qa": { "label": "from file" } }`);
    writeStore(sharedStorePath("acme"), { "rt.sdmEnrichment": ["nope"] });

    expect(loadEnrichment(p)).toEqual({ "acme-db-qa": { label: "from file" } });
  });
});

describe("enrichment warnings", () => {
  let logged: Array<{ module: string; message: string; context: Record<string, unknown> }>;
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "enr-warn-home-")));
    warnings.reset();
    logged = [];
    setWarningLog((module, message, context) => logged.push({ module, message, context }));
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    warnings.reset();
  });

  test("a file that will not parse is logged with its path and shown once, without the path", () => {
    const dir = mkdtempSync(join(tmpdir(), "enr-warn-"));
    const p = join(dir, "e.jsonc");
    writeFileSync(p, "{ not json");

    expect(loadEnrichment(p)).toEqual({});
    expect(loadEnrichment(p)).toEqual({});

    expect(logged).toHaveLength(2);
    expect(logged[0]!.module).toBe("sdm");
    expect(logged[0]!.message.startsWith(`failed to parse ${p}, ignoring enrichment file: `)).toBe(true);
    expect(logged[0]!.context).toMatchObject({ path: p });
    expect(io.stderr()).toBe("[warning] Your sdm enrichment file could not be read  rt is ignoring it\n");
    expect(io.stdout()).toBe("");
  });

  test("a setting the store cannot resolve is logged and shown with the command that finds it", () => {
    writeStore(sharedStorePath("acme"), { "rt.sdmEnrichment": { "acme-db-qa": { label: "${team:../x}" } } });

    expect(loadEnrichment(join(tmpdir(), "no-such-enrichment.jsonc"))).toEqual({});

    expect(logged[0]!.module).toBe("sdm");
    expect(logged[0]!.message.startsWith('ignoring "rt.sdmEnrichment" -- ')).toBe(true);
    const shown = io.stderr();
    expect(shown.startsWith("[warning] Your sdm enrichment setting is being ignored  ")).toBe(true);
    expect(shown.endsWith("\n  next: rt settings check\n")).toBe(true);
    expect(shown.split("\n")).toHaveLength(3);
    expect(io.stdout()).toBe("");
  });

  test("a missing file is no warning at all", () => {
    expect(loadEnrichment(join(tmpdir(), "no-such-enrichment.jsonc"))).toEqual({});
    expect(logged).toEqual([]);
    expect(io.stderr()).toBe("");
  });
});
