import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadCarriers, loadEnrichment } from "../enrichment.ts";
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

describe("loadEnrichment", () => {
  let logged: string[];
  let io: ReturnType<typeof captureOut>;
  const legacyFile = () => join(process.env.HOME!, ".mattstack", "rt", "sdm", "enrichment.jsonc");

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "enr-home-")));
    warnings.reset();
    logged = [];
    setWarningLog((_module, message) => logged.push(message));
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    warnings.reset();
  });

  test("nothing set: no labels, and no word about it", () => {
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe("");
  });

  test("reads your team's sdm.resources", () => {
    writeStore(sharedStorePath("acme"), { "sdm.resources": { "acme-db-qa": { label: "Acme QA", tier: "gold" } } });
    expect(loadEnrichment()).toEqual({ "acme-db-qa": { label: "Acme QA", tier: "gold" } });
  });

  test("the retired rt.sdmEnrichment is not read, and says nothing", () => {
    writeStore(sharedStorePath("acme"), { "rt.sdmEnrichment": { "acme-db-qa": { label: "old key" } } });
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe("");
  });

  test("an old labels file is not read: rt says once how your team's owner can move it", () => {
    mkdirSync(dirname(legacyFile()), { recursive: true });
    writeFileSync(legacyFile(), '{\n  // mine\n  "acme-db-qa": { "label": "It\'s QA" },\n}\n');
    expect(loadEnrichment()).toEqual({});
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe(
      "[warning] Your old StrongDM labels file is no longer read  your team's owner can copy it into your team's settings\n" +
        `  next: rt settings set sdm.resources '{"acme-db-qa":{"label":"It'\\''s QA"}}' --scope team\n`,
    );
    expect(logged[0]).toBe(`the old labels file ${legacyFile()} is no longer read`);
  });

  test("an old labels file says nothing once your team has labels", () => {
    mkdirSync(dirname(legacyFile()), { recursive: true });
    writeFileSync(legacyFile(), '{ "acme-db-qa": { "label": "x" } }');
    writeStore(sharedStorePath("acme"), { "sdm.resources": { "acme-db-qa": { label: "Acme QA" } } });
    expect(loadEnrichment()).toEqual({ "acme-db-qa": { label: "Acme QA" } });
    expect(io.stderr()).toBe("");
  });

  test("an old labels file that is not a map of labels is named without a command", () => {
    mkdirSync(dirname(legacyFile()), { recursive: true });
    writeFileSync(legacyFile(), '["acme-db-qa"]');
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe("[warning] Your old StrongDM labels file is no longer read  rt could not read it either\n");
  });

  test("an old labels file rt cannot read is named without a command", () => {
    mkdirSync(dirname(legacyFile()), { recursive: true });
    writeFileSync(legacyFile(), "{ not json");
    expect(loadEnrichment()).toEqual({});
    expect(io.stderr()).toBe("[warning] Your old StrongDM labels file is no longer read  rt could not read it either\n");
  });
});

describe("loadCarriers", () => {
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "car-home-")));
    warnings.reset();
    setWarningLog(() => {});
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    warnings.reset();
  });

  test("unset -> {}", () => {
    expect(loadCarriers()).toEqual({});
  });

  test("reads the team map", () => {
    writeStore(sharedStorePath("acme"), { "sdm.carriers": { globex: { label: "Globex Corp" } } });

    expect(loadCarriers()).toEqual({ globex: { label: "Globex Corp" } });
  });

  test("an invalid value -> {} (never throws)", () => {
    writeStore(sharedStorePath("acme"), { "sdm.carriers": ["nope"] });

    expect(loadCarriers()).toEqual({});
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

  test("a setting the store cannot resolve is logged and shown with the command that finds it", () => {
    writeStore(sharedStorePath("acme"), { "sdm.resources": { "acme-db-qa": { label: "${team:../x}" } } });

    expect(loadEnrichment()).toEqual({});

    expect(logged[0]!.module).toBe("sdm");
    expect(logged[0]!.message.startsWith('ignoring "sdm.resources" -- ')).toBe(true);
    const shown = io.stderr();
    expect(shown.startsWith("[warning] Your sdm enrichment setting is being ignored  ")).toBe(true);
    expect(shown.endsWith("\n  next: rt settings check\n")).toBe(true);
    expect(shown.split("\n")).toHaveLength(3);
    expect(io.stdout()).toBe("");
  });
});
