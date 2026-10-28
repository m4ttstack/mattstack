import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { skillsCompile } from "../../../commands/skills.ts";
import { setFieldContractSeverityForTest } from "../field-contract.ts";
import { captureSkills, runExpectingCleanExit } from "./helpers.ts";

const FIX = join(import.meta.dir, "fixtures", "rule-selector");
const REPO_PLUGIN = resolve(import.meta.dir, "..", "..", "..", "plugins", "mattstack");
const ENGINES = ["review", "self-review", "receive-review"] as const;
const FILL_LINE = "fence: acme-verdicts";
// A fill's seam names the engine's block and the prop it fills.
const seam = (verb: string) => `<!-- part: prop:${verb}/rule-selector.rule-selector `;
const SELECT = /^#+ Select the rules$/m;
const FAILS_TO_FINDINGS = /^#+ Failed rules become findings$/m;

type Compiled = Record<(typeof ENGINES)[number], string>;

let root = "";
let seq = 0;

function writeBindings(pack: string, bindings: Record<string, Record<string, string>>): void {
  writeFileSync(join(pack, "pack", "skills.jsonc"), JSON.stringify({ version: 2, bindings }, null, 2));
}

/** A scratch copy of the fixture pack, `shape` applied, and a mattstack home that points at this repo's real plugin. */
function stagePack(shape?: (pack: string) => void): { pack: string; compileArgs: string[] } {
  const name = `pack-${seq++}`;
  const pack = join(root, name);
  cpSync(FIX, pack, { recursive: true });
  shape?.(pack);
  const ms = join(root, `${name}-home`);
  mkdirSync(join(ms, "plugins"), { recursive: true });
  symlinkSync(REPO_PLUGIN, join(ms, "plugins", "mattstack"));
  return { pack, compileArgs: ["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", join(pack, "pack", "skills.jsonc")] };
}

async function compilePack(shape?: (pack: string) => void): Promise<{ pack: string; verbs: Compiled }> {
  const { pack, compileArgs } = stagePack(shape);
  const io = captureSkills();
  try {
    await skillsCompile(compileArgs);
  } finally {
    io.restore();
  }
  const read = (verb: string) => {
    const side = existsSync(join(pack, "skills", verb)) ? "skills" : "attachments";
    return readFileSync(join(pack, side, verb, "SKILL.md"), "utf8");
  };
  return { pack, verbs: Object.fromEntries(ENGINES.map((v) => [v, read(v)])) as Compiled };
}

describe("rule selector slot", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rt-rule-selector-"));
    // The fixture is a partial pack: the review engines read fields no stage writes here.
    setFieldContractSeverityForTest("warn");
  });
  afterEach(() => {
    process.exitCode = 0;
  });
  afterAll(() => {
    setFieldContractSeverityForTest(null);
    rmSync(root, { recursive: true, force: true });
  });

  describe("a pack that binds a selector", () => {
    let compiled: { pack: string; verbs: Compiled };
    beforeAll(async () => {
      compiled = await compilePack();
    });

    test("bound: each review engine inlines the fill under the rule-selector prop", () => {
      for (const verb of ENGINES) {
        const body = compiled.verbs[verb];
        expect(body).toContain(FILL_LINE);
        expect(body).toContain(seam(verb));
      }
    });

    test("bound: review and self-review include both bodies, receive-review only the select body", () => {
      for (const verb of ENGINES) expect(compiled.verbs[verb]).toMatch(SELECT);
      expect(compiled.verbs.review).toMatch(FAILS_TO_FINDINGS);
      expect(compiled.verbs["self-review"]).toMatch(FAILS_TO_FINDINGS);
      expect(compiled.verbs["receive-review"]).not.toMatch(FAILS_TO_FINDINGS);
    });

    test("review graph places the rule steps", () => {
      const body = compiled.verbs.review;
      const edge = (a: string, b: string) => new RegExp(`\\b${a} -> ${b}\\b`);
      expect(body).toMatch(edge("select_rules", "dispatch_reviewer"));
      expect(body).toMatch(edge("dispatch_reviewer", "check_verdicts"));
      expect(body).toMatch(edge("assemble_draft", "fails_to_findings"));
      expect(body).toMatch(edge("fails_to_findings", "verify_blocking"));
      expect(body).not.toMatch(edge("dispatch_reviewer", "assemble_draft"));
      expect(body).toMatch(edge("redispatch_reviewer", "assemble_draft"));
      expect(body).toContain("run_budget {runDb, key: verdict-rounds:<depth>, limit: 2, stage}");
    });

    test("review graph: every path to the dispatch passes select_rules, a failed head checkout included", () => {
      const into = [...compiled.verbs.review.matchAll(/^\s*(\w+) -> dispatch_reviewer\b/gm)].map((m) => m[1]);
      expect(into).toEqual(["select_rules"]);
    });

    test("self-review graph places the rule steps", () => {
      const body = compiled.verbs["self-review"];
      const edge = (a: string, b: string) => new RegExp(`\\b${a} -> ${b}\\b`);
      expect(body).toMatch(edge("run_depth_checks", "select_rules"));
      expect(body).toMatch(edge("select_rules", "repro_browser"));
      expect(body).toMatch(edge("dispatch_reviewer", "check_verdicts"));
      expect(body).toMatch(edge("fails_to_findings", "assemble_draft"));
      expect(body).not.toMatch(edge("run_depth_checks", "repro_browser"));
      expect(body).not.toMatch(edge("dispatch_reviewer", "assemble_draft"));
      expect(body).toMatch(edge("make_recorded_move", "assemble_draft"));
      expect(body).toContain("run_budget {runDb, key: verdict-rounds:<depth>, limit: 2, stage}");
    });
    test("receive-review selects rules before the adjudicator", () => {
      const body = compiled.verbs["receive-review"];
      expect(body).toMatch(/\bany_unresolved -> select_rules\b/);
      expect(body).toMatch(/\bselect_rules -> dispatch_adjudicator\b/);
      expect(body).not.toMatch(/\bany_unresolved -> dispatch_adjudicator\b/);
      expect(body).not.toMatch(/\bcheck_verdicts\b/);
    });
  });

  test("unbound: no fill text, bodies still present", async () => {
    const unbound = await compilePack((pack) => writeBindings(pack, {}));
    for (const verb of ENGINES) {
      const body = unbound.verbs[verb];
      expect(body).not.toContain("acme-verdicts");
      expect(body).toMatch(SELECT);
    }
  });

  test("a fill providing another contract is refused", async () => {
    const { compileArgs } = stagePack((pack) =>
      writeBindings(pack, { "mattstack:review/rule-selector": { "rule-selector": "acme:acme-wrong-contract" } }),
    );
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(compileArgs));
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain('provides "review-criteria@1", but the prop\'s contract is "rule-selector@1"');
  });
});
