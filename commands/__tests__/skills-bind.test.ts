import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { execFileSync } from "child_process";
import { updateRepoIndex } from "../../lib/repo-index.ts";
import { __test__ as pickImplTest, type PickImpl } from "../../lib/ui/pick.ts";
import type { PickRequest, PickResult } from "../../lib/ui/protocol.ts";
import * as sources from "../../lib/skills/sources.ts";
import { readManifestBindings, stripJsonc } from "../../lib/skills/sources.ts";
import * as skillsMaterialize from "../../lib/setup/skills-materialize.ts";
import * as ui from "../../lib/ui/out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { mergeLayers, parseFragment, renderManifest } from "../../lib/skills/manifest-merge.ts";
import { applyBind, bindBlocks, checkPack, regenerateOutcomeFor, regeneratePackFile, shadowWarning, skillsBind, skillsCompile } from "../skills.ts";
import { ORG_LAYOUT } from "../../lib/team/org-marker.ts";

/**
 * pickBindArgs opens a separate runPick session per omitted positional
 * (verb, then slot, then fill) -- installFakePick replays its whole script
 * against every session, so answering three distinct prompts needs one
 * result dispensed per session instead, in call order.
 */
function installFakePickSequence(results: Array<Omit<PickResult, "t">>) {
  const calls: PickRequest[] = [];
  let i = 0;
  const fakeImpl: PickImpl = (req) => {
    calls.push(req);
    const chosen = results[Math.min(i, results.length - 1)]!;
    i++;
    return {
      update() {},
      modal: () => Promise.resolve(null),
      result: Promise.resolve({ t: "result", ...chosen }),
    };
  };
  pickImplTest.setImpl(fakeImpl);
  return {
    calls,
    restore(): void {
      pickImplTest.setImpl(undefined);
    },
  };
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makePackDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-bind-pack-")));
}

/** The org's base pack folder in an org clone at `<root>/acme`, with the org marker written. */
function orgBasePackDir(root: string): string {
  const mattstack = join(root, "acme", "mattstack");
  writeFile(join(mattstack, "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: ORG_LAYOUT }));
  return join(mattstack, "org", "packs", "acme-base");
}

function writeStubs(packDir: string, verbs: Record<string, { engine: string; description: string }>): void {
  writeFile(join(packDir, "pack", "stubs.jsonc"), JSON.stringify({ verbs }));
}

const WATCH_CI_SKILL_MD = `---
name: watch-ci
description: "Watch CI"
type: pipeline-step
slots:
  domain:
    contract: "watch-ci-domain@1"
---

Watch CI.
`;

function fillSkillMd(name: string, provides: string): string {
  return `---\nname: ${name}\ndescription: "Fill ${name}"\nmetadata:\n  provides: "${provides}"\n---\n\nFill ${name}.\n`;
}

function manifestText(domainBinding: string | null): string {
  const bindingsBody = domainBinding
    ? `    /* block comment about watch-ci */\n    "mattstack:watch-ci": {\n      "domain": "${domainBinding}"\n    }`
    : `    /* block comment about watch-ci */\n    "mattstack:watch-ci": {}`;
  return [
    "// skills.jsonc -- provenance header",
    "{",
    "  // bindings comment",
    '  "bindings": {',
    bindingsBody,
    "  }",
    "}",
    "",
  ].join("\n");
}

/**
 * Mirrors lib/skills/__tests__/fixtures/compile-native's real stage-plan
 * engine: a slotted pipeline-step whose stage-consumes ("ticket") is
 * satisfiable from PIPELINE_SEED, so a single-stage pipeline chain validates.
 */
const STAGE_PLAN_SKILL_MD = `---
name: stage-plan
description: "stage-plan"
type: pipeline-step
slots:
  domain: { contract: "plan-domain@1", required: false }
metadata:
  stage: plan
  stage-consumes: ticket
  stage-produces: approach
---

{{stage.fields}}
{{slot:domain}}
`;

/**
 * A pack with one roster verb (so fullRoster.length > 0 and resolve() honors
 * --manifest) plus a pipeline stage with its own slot, bindable by name
 * alongside the roster verb.
 */
function makeStageFixture(): { packDir: string; mattstackDir: string; manifestPath: string } {
  const packDir = makePackDir();
  writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });

  const mattstackDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-bind-stage-mattstack-")));
  writeFile(join(mattstackDir, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  writeFile(join(mattstackDir, "plugins", "mattstack", "skills", "pipeline", "watch-ci", "SKILL.md"), WATCH_CI_SKILL_MD);
  writeFile(join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "stage-plan", "SKILL.md"), STAGE_PLAN_SKILL_MD);

  writeFile(join(mattstackDir, "plugins", "acme", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  writeFile(join(mattstackDir, "plugins", "acme", "skills", "plan-policy", "SKILL.md"), fillSkillMd("plan-policy", "plan-domain@1"));

  const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-bind-stage-manifest-")));
  const manifestPath = join(manifestDir, "skills.jsonc");
  writeFile(manifestPath, `{\n  "pipelines": { "feature": ["mattstack:stage-plan"] },\n  "bindings": {}\n}\n`);

  return { packDir, mattstackDir, manifestPath };
}

const ORCHESTRATOR_SKILL_MD = `---
name: work
description: "Run the work pipeline"
type: pipeline-step
---

{{work-type}}
{{pipeline.stages}}
`;

/** allowed-tools nothing else in the fixture declares, so its presence in a compiled SKILL.md proves that file was actually rebuilt. */
const PLAN_POLICY_WITH_TOOL_SKILL_MD = `---
name: plan-policy
description: "Fill plan-policy"
metadata:
  provides: "plan-domain@1"
allowed-tools:
  - "Bash(plan-policy-tool:*)"
---

Fill plan-policy.
`;

/**
 * A public orchestrator verb ({{pipeline.stages}}) plus the slotted stage-plan
 * stage: an orchestrator's compiled allowed-tools unions every stage's bound
 * fills' allowed-tools (stageAllowedToolsFor), so binding the stage's slot
 * changes an input the orchestrator's own compiled output bakes in.
 */
function makeOrchestratorStageFixture(): { packDir: string; mattstackDir: string; manifestPath: string } {
  const packDir = makePackDir();
  writeStubs(packDir, { work: { engine: "work", description: "Run the work pipeline" } });
  writeFile(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["work"] }));

  const mattstackDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-bind-orch-mattstack-")));
  writeFile(join(mattstackDir, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  writeFile(join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "work", "SKILL.md"), ORCHESTRATOR_SKILL_MD);
  writeFile(join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "stage-plan", "SKILL.md"), STAGE_PLAN_SKILL_MD);

  writeFile(join(mattstackDir, "plugins", "acme", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  writeFile(join(mattstackDir, "plugins", "acme", "skills", "plan-policy", "SKILL.md"), PLAN_POLICY_WITH_TOOL_SKILL_MD);

  const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-bind-orch-manifest-")));
  const manifestPath = join(manifestDir, "skills.jsonc");
  writeFile(manifestPath, `{\n  "pipelines": { "feature": ["mattstack:stage-plan"] },\n  "bindings": {}\n}\n`);

  return { packDir, mattstackDir, manifestPath };
}

/**
 * Trivial one-slot pipeline-step engine ("watch-ci", slot "domain" ->
 * contract "watch-ci-domain@1") plus a fixture mattstack root carrying two
 * providing fills (v1, initially bound; v2, the bind target) and one fill
 * whose provides deliberately mismatches the slot's contract.
 */
function makeEngineFixture(domainBinding: string | null = "acme:watch-ci-domain-v1"): { mattstackDir: string; manifestPath: string } {
  const mattstackDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-bind-mattstack-")));
  writeFile(join(mattstackDir, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  writeFile(join(mattstackDir, "plugins", "mattstack", "skills", "pipeline", "watch-ci", "SKILL.md"), WATCH_CI_SKILL_MD);

  writeFile(join(mattstackDir, "plugins", "acme", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  writeFile(join(mattstackDir, "plugins", "acme", "skills", "watch-ci-domain-v1", "SKILL.md"), fillSkillMd("watch-ci-domain-v1", "watch-ci-domain@1"));
  writeFile(join(mattstackDir, "plugins", "acme", "skills", "watch-ci-domain-v2", "SKILL.md"), fillSkillMd("watch-ci-domain-v2", "watch-ci-domain@1"));
  writeFile(join(mattstackDir, "plugins", "acme", "skills", "watch-ci-domain-wrong", "SKILL.md"), fillSkillMd("watch-ci-domain-wrong", "watch-ci-domain@2"));

  const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-bind-manifest-")));
  const manifestPath = join(manifestDir, "skills.jsonc");
  writeFile(manifestPath, manifestText(domainBinding));

  return { mattstackDir, manifestPath };
}

let io: CapturedOut;

beforeEach(() => {
  io = captureSkills();
});

afterEach(() => {
  io.restore();
  // Bun ignores process.exitCode = undefined once truthy; 0 is the only value that clears it.
  process.exitCode = 0;
});

describe("skillsBind", () => {
  test("valid bind changes bindings.<engineRef>.<slot> and recompiles", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture();

    await skillsBind([
      "watch-ci", "domain", "acme:watch-ci-domain-v2",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    const bindings = readManifestBindings(manifestPath);
    expect(bindings["mattstack:watch-ci"]?.domain).toBe("acme:watch-ci-domain-v2");

    const skillMd = readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8");
    expect(skillMd).toContain("acme:watch-ci-domain-v2");
  });

  test("--json success path prints exactly one parseable JSON document, recompile folded in", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture();

    await skillsBind([
      "watch-ci", "domain", "acme:watch-ci-domain-v2", "--json",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    expect(io.lines()).toHaveLength(1);
    const payload = JSON.parse(io.lines()[0]!);
    expect(payload).toEqual({
      ok: true,
      verb: "watch-ci",
      slot: "domain",
      from: "acme:watch-ci-domain-v1",
      to: "acme:watch-ci-domain-v2",
      fragmentUpdated: null,
      shadowedBy: null,
      compileErrors: [],
    });

    const bindings = readManifestBindings(manifestPath);
    expect(bindings["mattstack:watch-ci"]?.domain).toBe("acme:watch-ci-domain-v2");
    const skillMd = readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8");
    expect(skillMd).toContain("acme:watch-ci-domain-v2");
  });

  test("comments in the manifest survive the write", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture();

    await skillsBind([
      "watch-ci", "domain", "acme:watch-ci-domain-v2",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    const written = readFileSync(manifestPath, "utf8");
    expect(written).toContain("// skills.jsonc -- provenance header");
    expect(written).toContain("// bindings comment");
    expect(written).toContain("/* block comment about watch-ci */");
  });

  test("unknown verb: clean error, exit 1, writes nothing", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture();
    const before = readFileSync(manifestPath, "utf8");

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsBind([
        "no-such-verb", "domain", "acme:watch-ci-domain-v2",
        "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain("no-such-verb");
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
    // Rejection is before any compile: no artifact is left behind either.
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  describe("a base pack", () => {
    let savedHome: string | undefined;
    let savedEnginePackDir: string | undefined;
    beforeEach(() => {
      savedHome = process.env.HOME;
      savedEnginePackDir = process.env.RT_ENGINE_PACK_DIR;
    });
    afterEach(() => {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedEnginePackDir === undefined) delete process.env.RT_ENGINE_PACK_DIR;
      else process.env.RT_ENGINE_PACK_DIR = savedEnginePackDir;
    });

    test.each([["text", "no stale file"], ["--json", "no stale file"], ["text", "a stale bindings file"]])(
      "bind (%s, %s) writes its own fragment once, regenerates and compiles nothing",
      async (mode, variant) => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-base-")));
        process.env.HOME = join(root, "home");
        mkdirSync(process.env.HOME, { recursive: true });
        process.env.RT_ENGINE_PACK_DIR = join(root, "missing-engine-pack");
        const packDir = orgBasePackDir(root);
        writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
        const fragmentPath = join(packDir, "pack", "skills.jsonc");
        writeFile(fragmentPath, `{\n  "base": true,\n  "bindings": {}\n}\n`);
        const stale = join(process.env.HOME, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "acme-base", "skills.jsonc");
        if (variant === "a stale bindings file") writeFile(stale, `{ "bindings": { "mattstack:watch-ci": { "domain": "acme:watch-ci-domain-v1" } } }`);
        const staleBefore = variant === "a stale bindings file" ? readFileSync(stale, "utf8") : null;
        const { mattstackDir } = makeEngineFixture();
        const rootsSpy = spyOn(sources, "resolvePluginRoots").mockImplementation(() => sources.resolvePluginRootsFromDir(mattstackDir));

        let result;
        try {
          result = await runExpectingCleanExit(() =>
            skillsBind([
              "watch-ci", "domain", "acme:watch-ci-domain-v2",
              "--pack", "acme-base", "--pack-dir", packDir,
              ...(mode === "--json" ? ["--json"] : []),
            ]),
          );
        } finally {
          rootsSpy.mockRestore();
        }

        expect(result.exitCode).toBeUndefined();
        expect(process.exitCode ?? 0).toBe(0);
        expect(result.errors).toEqual([]);
        expect(readManifestBindings(fragmentPath)["mattstack:watch-ci"]?.domain).toBe("acme:watch-ci-domain-v2");
        expect(JSON.parse(stripJsonc(readFileSync(fragmentPath, "utf8"))).base).toBe(true);
        expect(existsSync(join(packDir, "skills"))).toBe(false);
        if (staleBefore !== null) expect(readFileSync(stale, "utf8")).toBe(staleBefore);
        if (mode === "--json") {
          expect(io.lines()).toHaveLength(1);
          const payload = JSON.parse(io.lines()[0]!);
          expect(payload).toMatchObject({ ok: true, base: true, from: "(unbound)", to: "acme:watch-ci-domain-v2" });
          expect("regenerated" in payload).toBe(false);
        } else {
          expect(io.lines()).toContain(
            "  note: acme-base is a base pack. Packs that extend it pick this up once it is published and their bindings are rebuilt.",
          );
        }
      },
    );

    test("an explicit --manifest takes the normal path and reports a failed regenerate", async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-base-")));
      process.env.HOME = join(root, "home");
      mkdirSync(process.env.HOME, { recursive: true });
      process.env.RT_ENGINE_PACK_DIR = join(root, "missing-engine-pack");
      const packDir = orgBasePackDir(root);
      writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
      writeFile(join(packDir, "pack", "skills.jsonc"), `{\n  "base": true,\n  "bindings": {}\n}\n`);
      const manifest = join(process.env.HOME, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
      writeFile(manifest, `{ "bindings": {} }`);
      const { mattstackDir } = makeEngineFixture();
      const rootsSpy = spyOn(sources, "resolvePluginRoots").mockImplementation(() => sources.resolvePluginRootsFromDir(mattstackDir));
      try {
        await skillsBind([
          "watch-ci", "domain", "acme:watch-ci-domain-v2", "--json",
          "--pack", "acme-base", "--pack-dir", packDir, "--manifest", manifest,
        ]);
      } finally {
        rootsSpy.mockRestore();
      }

      expect(process.exitCode).toBe(1);
      expect(io.lines()).toHaveLength(1);
      const payload = JSON.parse(io.lines()[0]!);
      expect(payload).toMatchObject({ ok: false, regenerated: false });
      expect(payload.regenerateDetail).toContain("engine-pack-missing");
      expect("base" in payload).toBe(false);
    });

    test("a fragment that symlinks outside the pack is refused, and the outside file is untouched", async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-base-")));
      const packDir = orgBasePackDir(root);
      writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
      const outside = join(root, "elsewhere", "skills.jsonc");
      const outsideText = `{\n  "base": true,\n  "bindings": {}\n}\n`;
      writeFile(outside, outsideText);
      symlinkSync(outside, join(packDir, "pack", "skills.jsonc"));
      const { mattstackDir } = makeEngineFixture();

      const { exitCode, errors } = await runExpectingCleanExit(() =>
        skillsBind([
          "watch-ci", "domain", "acme:watch-ci-domain-v2",
          "--pack", "acme-base", "--pack-dir", packDir, "--mattstack-dir", mattstackDir,
        ]),
      );

      expect(exitCode).toBe(1);
      expect(errors.some((l) => l.includes("resolves outside the pack") && l.includes("nothing written"))).toBe(true);
      expect(readFileSync(outside, "utf8")).toBe(outsideText);
    });

    test("a base with no verbs of its own says to edit its fragment directly", async () => {
      const packDir = orgBasePackDir(makePackDir());
      const fragmentPath = join(packDir, "pack", "skills.jsonc");
      writeFile(fragmentPath, JSON.stringify({ base: true }));
      const { mattstackDir } = makeEngineFixture();

      const { exitCode, errors } = await runExpectingCleanExit(() =>
        skillsBind([
          "watch-ci", "domain", "acme:watch-ci-domain-v2",
          "--pack", "acme-base", "--pack-dir", packDir, "--mattstack-dir", mattstackDir,
        ]),
      );

      expect(exitCode).toBe(1);
      expect(errors[0]).toBe("acme-base is a base pack with no verbs of its own, so rt cannot check the slot");
      expect(errors.join("\n")).toContain(fragmentPath);
      expect(readFileSync(fragmentPath, "utf8")).toBe(JSON.stringify({ base: true }));
    });
  });

  test("unknown slot: clean error naming the real slots, exit 1, writes nothing", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture();
    const before = readFileSync(manifestPath, "utf8");

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsBind([
        "watch-ci", "no-such-slot", "acme:watch-ci-domain-v2",
        "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain("no-such-slot");
    expect(errors[0]).toContain("domain");
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("fill whose provides does not match the slot's contract: clean error, exit 1, writes nothing", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture();
    const before = readFileSync(manifestPath, "utf8");

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsBind([
        "watch-ci", "domain", "acme:watch-ci-domain-wrong",
        "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain("watch-ci-domain@2");
    expect(errors[0]).toContain("watch-ci-domain@1");
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("--dry-run writes nothing", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture();
    const before = readFileSync(manifestPath, "utf8");

    await skillsBind([
      "watch-ci", "domain", "acme:watch-ci-domain-v2", "--dry-run",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    expect(readFileSync(manifestPath, "utf8")).toBe(before);
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
    expect(io.lines().some((l) => l.includes("acme:watch-ci-domain-v1") && l.includes("acme:watch-ci-domain-v2"))).toBe(true);
  });

  test("binding a previously-unbound slot (new key) works", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture(null);

    await skillsBind([
      "watch-ci", "domain", "acme:watch-ci-domain-v2",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    const bindings = readManifestBindings(manifestPath);
    expect(bindings["mattstack:watch-ci"]?.domain).toBe("acme:watch-ci-domain-v2");
    const written = readFileSync(manifestPath, "utf8");
    expect(written).toContain("/* block comment about watch-ci */");
  });

  test("all three positionals omitted on a tty: chained verb/slot/fill pickers resolve the same bind as typing them", async () => {
    const packDir = makePackDir();
    writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
    const { mattstackDir, manifestPath } = makeEngineFixture();

    const seq = installFakePickSequence([
      { action: "select", value: "watch-ci", query: "" },
      { action: "select", value: "domain", query: "" },
      { action: "select", value: "acme:watch-ci-domain-v2", query: "" },
    ]);

    const previousIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      await skillsBind([
        "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      ]);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: previousIsTTY, configurable: true });
      seq.restore();
    }

    expect(seq.calls).toHaveLength(3);
    const bindings = readManifestBindings(manifestPath);
    expect(bindings["mattstack:watch-ci"]?.domain).toBe("acme:watch-ci-domain-v2");
  });
});

describe("skillsBind: pipeline stages", () => {
  test("binds a stage's slot under bindings[\"mattstack:<stage>\"]", async () => {
    const { packDir, mattstackDir, manifestPath } = makeStageFixture();

    await skillsBind([
      "stage-plan", "domain", "acme:plan-policy",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    const bindings = readManifestBindings(manifestPath);
    expect(bindings["mattstack:stage-plan"]?.domain).toBe("acme:plan-policy");
  });

  test("--dry-run on a stage prints <stage>.<slot>: (unbound) -> <fill> and writes nothing", async () => {
    const { packDir, mattstackDir, manifestPath } = makeStageFixture();
    const before = readFileSync(manifestPath, "utf8");

    await skillsBind([
      "stage-plan", "domain", "acme:plan-policy", "--dry-run",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    expect(readFileSync(manifestPath, "utf8")).toBe(before);
    expect(io.lines()).toContain("[not yet] stage-plan.domain  (unbound) -> acme:plan-policy");
  });

  test("a slot the stage does not declare still errors with the known-slots list", async () => {
    const { packDir, mattstackDir, manifestPath } = makeStageFixture();
    const before = readFileSync(manifestPath, "utf8");

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsBind([
        "stage-plan", "no-such-slot", "acme:plan-policy",
        "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain("no-such-slot");
    expect(errors[0]).toContain("domain");
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
  });

  test("a name matching neither a roster verb nor a pipeline stage: clean error listing both spaces", async () => {
    const { packDir, mattstackDir, manifestPath } = makeStageFixture();

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsBind([
        "no-such-name", "domain", "acme:plan-policy",
        "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain('"no-such-name" is neither a roster verb nor a pipeline stage');
    expect(errors[0]).toContain("verbs: watch-ci");
    expect(errors[0]).toContain("stages: stage-plan");
  });

  test("a name in both spaces resolves as the roster verb (lookup order)", async () => {
    const { packDir, mattstackDir, manifestPath } = makeStageFixture();
    writeStubs(packDir, {
      "watch-ci": { engine: "watch-ci", description: "Watch CI" },
      "stage-plan": { engine: "watch-ci", description: "Also a roster verb" },
    });
    writeFile(
      join(mattstackDir, "plugins", "acme", "skills", "watch-ci-domain-v1", "SKILL.md"),
      fillSkillMd("watch-ci-domain-v1", "watch-ci-domain@1"),
    );

    await skillsBind([
      "stage-plan", "domain", "acme:watch-ci-domain-v1", "--dry-run",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    // watch-ci's engine (not stage-plan's) is the one loaded when a name collides:
    // its slot is "domain" with contract "watch-ci-domain@1", satisfied by this fill.
    expect(io.lines()).toContain("[not yet] stage-plan.domain  (unbound) -> acme:watch-ci-domain-v1");
  });

  test("binding a stage's slot recompiles the whole pack, updating the orchestrator's baked-in allowed-tools", async () => {
    const { packDir, mattstackDir, manifestPath } = makeOrchestratorStageFixture();
    await skillsCompile(["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);

    const orchestratorPath = join(packDir, "skills", "work", "SKILL.md");
    expect(readFileSync(orchestratorPath, "utf8")).not.toContain("plan-policy-tool");

    await skillsBind([
      "stage-plan", "domain", "acme:plan-policy",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    expect(readFileSync(orchestratorPath, "utf8")).toContain("Bash(plan-policy-tool:*)");
    const stageSkillMd = readFileSync(join(packDir, "attachments", "stage-plan", "SKILL.md"), "utf8");
    expect(stageSkillMd).toContain("acme:plan-policy");
  });

  test("--dry-run on a stage recompiles nothing (orchestrator file untouched)", async () => {
    const { packDir, mattstackDir, manifestPath } = makeOrchestratorStageFixture();
    await skillsCompile(["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);

    const orchestratorPath = join(packDir, "skills", "work", "SKILL.md");
    const before = readFileSync(orchestratorPath, "utf8");
    const mtimeBefore = statSync(orchestratorPath).mtimeMs;

    await skillsBind([
      "stage-plan", "domain", "acme:plan-policy", "--dry-run",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    expect(readFileSync(orchestratorPath, "utf8")).toBe(before);
    expect(statSync(orchestratorPath).mtimeMs).toBe(mtimeBefore);
  });

  test("rebinding a stage slot twice prints old -> new and the manifest ends with the second binding", async () => {
    const { packDir, mattstackDir, manifestPath } = makeStageFixture();
    writeFile(
      join(mattstackDir, "plugins", "acme", "skills", "plan-policy-v2", "SKILL.md"),
      fillSkillMd("plan-policy-v2", "plan-domain@1"),
    );

    await skillsBind([
      "stage-plan", "domain", "acme:plan-policy",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);
    await skillsBind([
      "stage-plan", "domain", "acme:plan-policy-v2",
      "--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
    ]);

    expect(io.lines()).toContain("[ok] stage-plan.domain  acme:plan-policy -> acme:plan-policy-v2");
    const bindings = readManifestBindings(manifestPath);
    expect(bindings["mattstack:stage-plan"]?.domain).toBe("acme:plan-policy-v2");
  });
});

const FIX = join(import.meta.dir, "..", "..", "lib", "skills", "__tests__", "fixtures", "compile-native");

describe("bind writes the team pack fragment", () => {
  function fixtureWithFragment(fragment: string) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-frag-")));
    cpSync(FIX, root, { recursive: true });
    const pack = join(root, "pack");
    const ms = join(root, "mattstack-home");
    const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
    writeFile(join(pack, "pack", "skills.jsonc"), fragment);
    writeFile(manifest, `// acme@acme\n{\n  "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"] },\n  "bindings": {}\n}\n`);
    return { pack, ms, manifest, root };
  }

  test("the fragment gains the binding, comments kept, and the manifest gets it too", async () => {
    const { pack, ms, manifest } = fixtureWithFragment(`// acme fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    const fragmentPath = join(pack, "pack", "skills.jsonc");
    await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);
    const fragment = readFileSync(fragmentPath, "utf8");
    expect(fragment).toContain("// acme fragment");
    expect(JSON.parse(stripJsonc(fragment)).bindings).toEqual({ "mattstack:stage-plan": { domain: "acme:plan-policy" } });
    expect(readManifestBindings(manifest)["mattstack:stage-plan"]).toEqual({ domain: "acme:plan-policy" });
    // The summary suffix is the only observable proof the fragment write ran.
    expect(io.lines().some((l) => l.includes(`bindings file: ${fragmentPath}`))).toBe(true);
  });

  test("a standalone pack whose fragment is the manifest is written once", async () => {
    const { pack, ms } = fixtureWithFragment(`{\n  "version": 1,\n  "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"] },\n  "bindings": {}\n}\n`);
    const own = join(pack, "pack", "skills.jsonc");
    await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", own]);
    const text = readFileSync(own, "utf8");
    expect(text.match(/acme:plan-policy/g)?.length).toBe(1);
    // A second write onto the same text is idempotent, so the count above alone
    // cannot prove the realpath guard skipped it; the missing summary suffix can.
    expect(io.lines().some((l) => l.includes("pack's own bindings file"))).toBe(false);
  });

  test("a fragment with no top-level bindings key gains one", async () => {
    const { pack, ms, manifest } = fixtureWithFragment(`// acme fragment\n{\n  "version": 1\n}\n`);
    await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);
    const fragment = readFileSync(join(pack, "pack", "skills.jsonc"), "utf8");
    expect(fragment).toContain("// acme fragment");
    expect(JSON.parse(stripJsonc(fragment)).bindings).toEqual({ "mattstack:stage-plan": { domain: "acme:plan-policy" } });
  });

  test("a fragment symlinked outside the pack is skipped, with a warning, and the outside file is untouched", async () => {
    const { pack, ms, manifest, root } = fixtureWithFragment(`// acme fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    const fragmentPath = join(pack, "pack", "skills.jsonc");
    const outsidePath = join(root, "outside-fragment.jsonc");
    writeFile(outsidePath, `// outside fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    const outsideBefore = readFileSync(outsidePath, "utf8");
    rmSync(fragmentPath);
    symlinkSync(outsidePath, fragmentPath);

    io.clear();
    await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);
    const errors = io.errLines();

    expect(readFileSync(outsidePath, "utf8")).toBe(outsideBefore);
    const warning = errors.find((l) => l.includes(fragmentPath));
    expect(warning).toBeDefined();
    expect(warning).toContain("outside the pack");
    expect(readManifestBindings(manifest)["mattstack:stage-plan"]).toEqual({ domain: "acme:plan-policy" });
  });

  test("a bind note under --json keeps stdout to one envelope", async () => {
    const { pack, ms, manifest, root } = fixtureWithFragment(`// acme fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    const fragmentPath = join(pack, "pack", "skills.jsonc");
    const outsidePath = join(root, "outside-fragment.jsonc");
    writeFile(outsidePath, `// outside fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    rmSync(fragmentPath);
    symlinkSync(outsidePath, fragmentPath);
    io.clear();

    await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--json", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);

    expect(io.lines()).toHaveLength(1);
    expect(typeof JSON.parse(io.lines()[0]!).ok).toBe("boolean");
    expect(io.errLines()).toEqual([`[warning] The pack's bindings file points outside the pack, so it was left alone  ${fragmentPath}`]);
  });

  describe("a bind another layer shadows", () => {
    let savedHome: string | undefined;
    let savedEnginePackDir: string | undefined;
    beforeEach(() => {
      savedHome = process.env.HOME;
      savedEnginePackDir = process.env.RT_ENGINE_PACK_DIR;
    });
    afterEach(() => {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedEnginePackDir === undefined) delete process.env.RT_ENGINE_PACK_DIR;
      else process.env.RT_ENGINE_PACK_DIR = savedEnginePackDir;
    });

    test.each([["--json"], ["text"]])("%s: the warning goes to stderr and stdout carries only the result", async (mode) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-shadow-")));
      cpSync(FIX, root, { recursive: true });
      process.env.HOME = join(root, "home");
      mkdirSync(process.env.HOME, { recursive: true });
      process.env.RT_ENGINE_PACK_DIR = join(root, "engine");
      const pack = join(root, "pack");
      writeFile(join(pack, "pack", "skills.jsonc"), `{\n  "bindings": {}\n}\n`);
      const manifest = join(process.env.HOME, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
      const shadowed = `//   mattstack:stage-plan domain <- override\n{\n  "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"] },\n  "bindings": { "mattstack:stage-plan": { "domain": "me:plan-policy" } }\n}\n`;
      writeFile(manifest, `{\n  "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"] },\n  "bindings": {}\n}\n`);
      const spies = [
        spyOn(sources, "resolvePluginRoots").mockImplementation(() => sources.resolvePluginRootsFromDir(join(root, "mattstack-home"))),
        spyOn(skillsMaterialize, "findEnginePackDir").mockImplementation(() => join(root, "engine")),
        spyOn(skillsMaterialize, "registeredCheckoutForSlug").mockImplementation(async () => join(root, "checkout")),
        spyOn(skillsMaterialize, "materializeSkills").mockImplementation((async () => {
          writeFile(manifest, shadowed);
          return { skipped: false, repos: [{ name: "widgets", path: join(root, "checkout"), ok: true, detail: "", packs: [{ pack: "widgets", path: manifest, ok: true, detail: "" }] }] };
        }) as never),
      ];
      io.clear();
      try {
        await runExpectingCleanExit(() => skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--manifest", manifest, ...(mode === "--json" ? ["--json"] : [])]));
      } finally {
        for (const spy of spies) spy.mockRestore();
      }

      const warning = `[warning] stage-plan.domain is still decided by the override layer  your change is saved, but that layer wins`;
      expect(io.errLines()).toContain(warning);
      expect(io.lines().some((l) => l.includes("still decided by"))).toBe(false);
      if (mode === "--json") {
        expect(io.lines()).toHaveLength(1);
        expect(JSON.parse(io.lines()[0]!)).toMatchObject({ verb: "stage-plan", slot: "domain", shadowedBy: "override" });
      }
    });
  });

  test("an unreadable fragment (a directory at the fragment path) leaves the manifest bindings unchanged", async () => {
    const { pack, ms, manifest } = fixtureWithFragment(`// acme fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    const fragmentPath = join(pack, "pack", "skills.jsonc");
    const manifestBefore = readFileSync(manifest, "utf8");
    rmSync(fragmentPath);
    mkdirSync(fragmentPath);

    await expect(
      skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]),
    ).rejects.toThrow();

    expect(readFileSync(manifest, "utf8")).toBe(manifestBefore);
  });
});

describe("applyBind", () => {
  test("team pack: writes the fragment, regenerates, and reports a shadowing override", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
    const packDir = join(root, "mattstack", "teams", "widgets", "plugin");
    writeFile(join(packDir, "pack", "skills.jsonc"), `{\n  "bindings": {}\n}\n`);
    const manifestPath = join(root, "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
    writeFile(manifestPath, "{}");
    let regenerated = 0;
    const result = await applyBind({
      manifestPath, packDir, engineRef: "mattstack:watch-ci", slotName: "domain", fill: "widgets:ci", pipeline: null, fixtureMode: false,
      materialize: async () => {
        regenerated++;
        writeFile(manifestPath, `//   mattstack:watch-ci domain <- override\n{ "bindings": { "mattstack:watch-ci": { "domain": "me:ci" } } }`);
        return { ok: true };
      },
    });
    expect(regenerated).toBe(1);
    expect(result.fragmentUpdated).toBe(join(packDir, "pack", "skills.jsonc"));
    expect(JSON.parse(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).bindings["mattstack:watch-ci"].domain).toBe("widgets:ci");
    expect(result.shadowedBy).toBe("override");
    expect(result.regenerated).toBe(true);
    expect("regenerateDetail" in result).toBe(false);
  });

  describe("when materialize skips", () => {
    let savedHome: string | undefined;
    let savedEnginePackDir: string | undefined;
    beforeEach(() => {
      savedHome = process.env.HOME;
      savedEnginePackDir = process.env.RT_ENGINE_PACK_DIR;
    });
    afterEach(() => {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedEnginePackDir === undefined) delete process.env.RT_ENGINE_PACK_DIR;
      else process.env.RT_ENGINE_PACK_DIR = savedEnginePackDir;
    });

    test("no engine pack: the fragment is written, nothing is read for shadowing, and the skip reason is reported", async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
      process.env.HOME = join(root, "home");
      mkdirSync(process.env.HOME, { recursive: true });
      process.env.RT_ENGINE_PACK_DIR = join(root, "missing-engine-pack");
      const packDir = join(root, "mattstack", "teams", "widgets", "plugin");
      const fragmentPath = join(packDir, "pack", "skills.jsonc");
      writeFile(fragmentPath, `{\n  "bindings": {}\n}\n`);
      const manifestPath = join(process.env.HOME, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
      writeFile(manifestPath, `//   mattstack:watch-ci domain <- default\n{ "bindings": { "mattstack:watch-ci": { "domain": "mattstack:ci" } } }`);

      const result = await applyBind({
        manifestPath, packDir, engineRef: "mattstack:watch-ci", slotName: "domain", fill: "widgets:ci", pipeline: null, fixtureMode: false,
        materialize: () => regeneratePackFile(manifestPath),
      });

      expect(JSON.parse(readFileSync(fragmentPath, "utf8")).bindings["mattstack:watch-ci"].domain).toBe("widgets:ci");
      expect(result.fragmentUpdated).toBe(fragmentPath);
      expect(result.shadowedBy).toBeNull();
      expect(result.regenerated).toBe(false);
      expect(result.regenerateDetail).toContain("engine-pack-missing");
      expect(result.regenerateDetail).toContain("mattstack plugin");
    });

    test.each([["--json"], ["text"]])("no engine pack through skillsBind (%s): exit 1, not ok, and no recompile", async (mode) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
      cpSync(FIX, root, { recursive: true });
      process.env.HOME = join(root, "home");
      mkdirSync(process.env.HOME, { recursive: true });
      process.env.RT_ENGINE_PACK_DIR = join(root, "missing-engine-pack");
      const pack = join(root, "pack");
      const fragmentPath = join(pack, "pack", "skills.jsonc");
      writeFile(fragmentPath, `{\n  "bindings": {}\n}\n`);
      const manifest = join(process.env.HOME, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
      writeFile(manifest, `{\n  "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"] },\n  "bindings": {}\n}\n`);
      const rootsSpy = spyOn(sources, "resolvePluginRoots").mockImplementation(() => sources.resolvePluginRootsFromDir(join(root, "mattstack-home")));
      io.clear();
      try {
        await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--manifest", manifest, ...(mode === "--json" ? ["--json"] : [])]);
      } finally {
        rootsSpy.mockRestore();
      }
      const errors = io.errLines();

      expect(existsSync(join(pack, "skills"))).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(readFileSync(fragmentPath, "utf8")).bindings["mattstack:stage-plan"].domain).toBe("acme:plan-policy");
      if (mode === "--json") {
        expect(io.lines()).toHaveLength(1);
        const payload = JSON.parse(io.lines()[0]!);
        expect(payload).toMatchObject({ ok: false, regenerated: false, fragmentUpdated: fragmentPath });
        expect(payload.regenerateDetail).toContain("engine-pack-missing");
      } else {
        expect(errors[0]).toBe("The bindings file was not rebuilt, so nothing was recompiled");
        expect(errors.join("\n")).toContain("engine-pack-missing");
        expect(errors.join("\n")).toContain("rt skills materialize");
      }
    });

    test("no engine pack after an unset: the note claims no fallback", async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
      cpSync(FIX, root, { recursive: true });
      process.env.HOME = join(root, "home");
      mkdirSync(process.env.HOME, { recursive: true });
      process.env.RT_ENGINE_PACK_DIR = join(root, "missing-engine-pack");
      const stages = ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"];
      const withOverride = { pipelines: { feature: { stages, bindings: { "mattstack:stage-plan": { domain: "acme:plan-policy" } } } }, bindings: {} };
      const pack = join(root, "pack");
      const fragmentPath = join(pack, "pack", "skills.jsonc");
      writeFile(fragmentPath, JSON.stringify(withOverride, null, 2));
      const manifest = join(process.env.HOME, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
      writeFile(manifest, JSON.stringify(withOverride, null, 2));
      const rootsSpy = spyOn(sources, "resolvePluginRoots").mockImplementation(() => sources.resolvePluginRootsFromDir(join(root, "mattstack-home")));
      io.clear();
      try {
        await skillsBind(["stage-plan", "domain", "--pipeline", "feature", "--unset", "--pack-dir", pack, "--manifest", manifest]);
      } finally {
        rootsSpy.mockRestore();
      }

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(readFileSync(fragmentPath, "utf8")).pipelines.feature).toEqual(stages);
      expect(io.lines()).toContain("  note: Removed this pack's feature override.");
      expect(io.lines().join("\n")).not.toContain("falls back");
      expect(io.errLines()[0]).toBe("The bindings file was not rebuilt, so nothing was recompiled");
    });
  });

  describe("regeneratePackFile scope", () => {
    let savedHome: string | undefined;
    let savedEnginePackDir: string | undefined;
    let root: string | undefined;
    beforeEach(() => {
      savedHome = process.env.HOME;
      savedEnginePackDir = process.env.RT_ENGINE_PACK_DIR;
    });
    afterEach(() => {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedEnginePackDir === undefined) delete process.env.RT_ENGINE_PACK_DIR;
      else process.env.RT_ENGINE_PACK_DIR = savedEnginePackDir;
      if (root) rmSync(root, { recursive: true, force: true });
      root = undefined;
    });

    function seedTwoRepoWorld(registered: string[] = ["widgets", "gadgets"]): { home: string; manifest: (slug: string) => string } {
      root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-scope-")));
      const home = join(root, "home");
      mkdirSync(home, { recursive: true });
      process.env.HOME = home;
      process.env.RT_ENGINE_PACK_DIR = join(root, "engine");
      writeFile(join(root, "engine", "pack", "skills.jsonc"), "{}");
      const orgDir = join(home, ".mattstack", "orgs", "acme", "mattstack");
      writeFile(join(home, ".mattstack", "orgs", "acme", ".git", "config"), "");
      writeFile(join(orgDir, "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: ORG_LAYOUT }));
      writeFile(join(orgDir, "org", "settings.org.jsonc"), JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": ["acme/widgets", "acme/gadgets"] }));
      writeFile(join(orgDir, "teams", "widgets", "settings.team.jsonc"), "{}");
      writeFile(join(orgDir, "teams", "widgets", "plugin", "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:watch-ci": { domain: "widgets:ci" } } }));
      for (const name of registered) {
        const dir = join(root, "src", name);
        execFileSync("git", ["init", "-q", dir]);
        execFileSync("git", ["-C", dir, "remote", "add", "origin", `https://gitlab.example.com/acme/${name}.git`]);
        updateRepoIndex(basename(dir), dir);
      }
      return { home, manifest: (slug) => join(home, ".mattstack", "repos", slug, "packs", "widgets", "skills.jsonc") };
    }

    test("regenerates only the repo the bindings file belongs to", async () => {
      const { home, manifest } = seedTwoRepoWorld();
      const widgets = manifest("gitlab.example.com-acme-widgets");
      const gadgets = manifest("gitlab.example.com-acme-gadgets");
      const untouched = `{ "marker": "gadgets before bind" }`;
      writeFile(gadgets, untouched);
      const gadgetsLegacy = join(home, ".mattstack", "repos", "gitlab.example.com-acme-gadgets", "skills.jsonc");
      writeFile(gadgetsLegacy, "{}");

      expect(await regeneratePackFile(widgets)).toEqual({ ok: true });

      expect(readManifestBindings(widgets)["mattstack:watch-ci"]?.domain).toBe("widgets:ci");
      expect(readFileSync(gadgets, "utf8")).toBe(untouched);
      expect(existsSync(gadgetsLegacy)).toBe(true);
      expect(existsSync(`${gadgetsLegacy}.migrated`)).toBe(false);
    });

    test("a bindings file no registered checkout produces reports no registered repo wrote it", async () => {
      const { manifest } = seedTwoRepoWorld(["gadgets"]);
      const orphan = manifest("gitlab.example.com-acme-widgets");
      expect(await regeneratePackFile(orphan)).toEqual({ ok: false, detail: `no registered repo wrote ${orphan}` });
    });
  });

  test("regenerateOutcomeFor judges by this pack file's own outcome", () => {
    const manifestPath = join(tmpdir(), "rt-bind-none", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
    const row = { name: "widgets", path: "/src/widgets", detail: "", ok: false };
    expect(regenerateOutcomeFor({ skipped: false, repos: [{ ...row, packs: [
      { pack: "widgets", zone: "acme", ok: true, path: manifestPath, layers: [] },
      { pack: "gadgets", zone: "acme", ok: false, detail: "gadgets fragment is missing" },
    ] }] }, manifestPath)).toEqual({ ok: true });
    expect(regenerateOutcomeFor({ skipped: false, repos: [{ ...row, packs: [
      { pack: "widgets", zone: "acme", ok: false, detail: "fragment is missing" },
    ] }] }, manifestPath)).toEqual({ ok: false, detail: "widgets: fragment is missing" });
  });

  test("fixture mode: writes the fragment and the manifest, never regenerates", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
    const packDir = join(root, "pack");
    writeFile(join(packDir, "pack", "skills.jsonc"), `// acme fragment\n{ "bindings": {} }`);
    const manifestPath = join(root, "skills.jsonc");
    writeFile(manifestPath, `{ "bindings": {} }`);
    const result = await applyBind({ manifestPath, packDir, engineRef: "mattstack:watch-ci", slotName: "domain", fill: "widgets:ci", pipeline: null, fixtureMode: true, materialize: async () => { throw new Error("must not run"); } });
    expect(result).toEqual({ fragmentUpdated: join(packDir, "pack", "skills.jsonc"), shadowedBy: null });
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).bindings["mattstack:watch-ci"].domain).toBe("widgets:ci");
    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toContain("// acme fragment");
  });

  test("fixture mode with no fragment: the manifest alone is written", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
    const manifestPath = join(root, "skills.jsonc");
    writeFile(manifestPath, `{ "bindings": {} }`);
    const result = await applyBind({ manifestPath, packDir: join(root, "pack"), engineRef: "mattstack:watch-ci", slotName: "domain", fill: "widgets:ci", pipeline: null, fixtureMode: true, materialize: async () => { throw new Error("must not run"); } });
    expect(result).toEqual({ fragmentUpdated: null, shadowedBy: null });
  });

  test("standalone pack (fragment is the manifest): one write, no regenerate", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
    const packDir = join(root, "mattstack");
    const manifestPath = join(packDir, "pack", "skills.jsonc");
    writeFile(manifestPath, `{ "bindings": {} }`);
    const result = await applyBind({ manifestPath, packDir, engineRef: "mattstack:shepherdr", slotName: "tiering", fill: "mattstack:model-tiering", pipeline: null, fixtureMode: false, materialize: async () => { throw new Error("must not run"); } });
    expect(result).toEqual({ fragmentUpdated: null, shadowedBy: null });
  });
});

describe("bindBlocks", () => {
  const bind = { verb: "stage-plan", slot: "domain", from: "(unbound)", to: "acme:plan-policy", dryRun: false, fragmentUpdated: null, basePack: null };

  test("a bind is one line: the slot, then what it was and what it is", () => {
    expect(renderPlain(bindBlocks(bind))).toBe("[ok] stage-plan.domain  (unbound) -> acme:plan-policy\n");
  });

  test("a dry run is pending", () => {
    expect(renderPlain(bindBlocks({ ...bind, dryRun: true }))).toBe("[not yet] stage-plan.domain  (unbound) -> acme:plan-policy\n");
  });

  test("the pack's own bindings file and a base pack each add a note", () => {
    expect(renderPlain(bindBlocks({ ...bind, fragmentUpdated: "/z/packs/acme/pack/skills.jsonc", basePack: "acme-base" }))).toBe(
      [
        "[ok] stage-plan.domain  (unbound) -> acme:plan-policy",
        "  note: Also saved in the pack's own bindings file: /z/packs/acme/pack/skills.jsonc",
        "  note: acme-base is a base pack. Packs that extend it pick this up once it is published and their bindings are rebuilt.",
        "",
      ].join("\n"),
    );
  });

  test("an unset notes that the override was removed", () => {
    expect(renderPlain(bindBlocks({ ...bind, verb: "accessibility: stage-plan", from: "acme:b", unset: { pipeline: "accessibility", stillOverriddenBy: null } }))).toBe(
      [
        "[ok] accessibility: stage-plan.domain  acme:b -> acme:plan-policy",
        "  note: Removed the accessibility override, so this slot falls back to the default.",
        "",
      ].join("\n"),
    );
    expect(renderPlain(bindBlocks({ ...bind, dryRun: true, unset: { pipeline: "accessibility", stillOverriddenBy: null } }))).toBe("[not yet] stage-plan.domain  (unbound) -> acme:plan-policy\n");
  });

  test("an unset whose bindings file was not rebuilt claims no fallback", () => {
    expect(renderPlain(bindBlocks({ ...bind, from: "acme:b", unset: { pipeline: "accessibility", stillOverriddenBy: null, rebuilt: false } }))).toBe(
      [
        "[ok] stage-plan.domain  acme:b -> acme:plan-policy",
        "  note: Removed this pack's accessibility override.",
        "",
      ].join("\n"),
    );
  });

  test("the shadow warning is a note on stderr, never stdout", () => {
    io.clear();
    ui.note(...shadowWarning("watch-ci", "domain", "override", "/h/packs/acme/skills.jsonc"));
    expect(io.stdout()).toBe("");
    expect(io.errLines()).toEqual([
      "[warning] watch-ci.domain is still decided by the override layer  your change is saved, but that layer wins",
      "  note: The winning value is in /h/packs/acme/skills.jsonc",
    ]);
  });
});


describe("pack role refusals", () => {
  for (const username of ["dev4", "dev2"]) for (const target of ["team", "root", "..pack"]) for (const json of [[], ["--json"]]) {
    if (username === "dev2" && target === "team") continue;
    test(`${username} writes to ${target} are refused ${json.length ? "as JSON" : "for a person"}`, async () => {
      const savedHome = process.env.HOME;
      process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rt-pack-role-")));
      try {
        seedOrg({ org: "acme", username, roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } }, teams: { widgets: {} } });
        const orgRoot = join(process.env.HOME!, ".mattstack", "orgs", "acme");
        const packDir = target === "root" ? orgRoot : target === "..pack" ? join(orgRoot, "..pack") : join(orgRoot, "mattstack", "teams", "widgets", "plugin");
        writeFile(join(packDir, ".claude-plugin", "plugin.json"), '{"name":"widgets","version":"1.0.0"}');
        const title = target === "team" ? "The widgets team's files belong to its owners" : "The org's shared files belong to its admins";
        const refusal = `${title}. ${target === "team" ? "Ask dev2 (the team's owner) or dev1 (an org admin) to make this change." : "Ask dev1 (an org admin) to make this change."}`;

      writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
      const { mattstackDir, manifestPath } = makeEngineFixture();
      const before = readFileSync(manifestPath, "utf8");
      const fragmentPath = join(packDir, "pack", "skills.jsonc");
      writeFile(fragmentPath, manifestText("acme:watch-ci-domain-v1"));
      const fragmentBefore = readFileSync(fragmentPath, "utf8");
      const result = await runExpectingCleanExit(() => skillsBind(["watch-ci", "domain", "acme:watch-ci-domain-v2", "--pack-dir", packDir, "--manifest", manifestPath, "--mattstack-dir", mattstackDir, ...json]));
      expect(result.exitCode).toBe(2);
      if (json.length) expect(JSON.parse(io.lines().at(-1)!)).toEqual({ ok: false, verb: "watch-ci", slot: "domain", from: "acme:watch-ci-domain-v1", to: "acme:watch-ci-domain-v2", fragmentUpdated: null, shadowedBy: null, compileErrors: [refusal] });
      else expect(io.stderr()).toStartWith(`[refused] ${title}`);
      expect(readFileSync(manifestPath, "utf8")).toBe(before);
      expect(readFileSync(fragmentPath, "utf8")).toBe(fragmentBefore);
      expect((await runExpectingCleanExit(() => skillsBind(["watch-ci", "domain", "acme:watch-ci-domain-v2", "--pack-dir", packDir, "--manifest", manifestPath, "--mattstack-dir", mattstackDir, "--dry-run", ...json]))).exitCode).toBeUndefined();
      expect(readFileSync(manifestPath, "utf8")).toBe(before);
      expect(readFileSync(fragmentPath, "utf8")).toBe(fragmentBefore);

      } finally { process.env.HOME = savedHome; }
    });
  }
});


describe("a Mac with two org clones", () => {
  for (const json of [[], ["--json"]]) test(`a member's bind in the other org's pack is refused ${json.length ? "as JSON" : "for a person"}`, async () => {
    const savedHome = process.env.HOME;
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rt-two-orgs-")));
    const seed = seedOrg;
    try {
        const roles = { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } };
        seed({ org: "acme", username: "dev4", roles, teams: { widgets: {} } });
        seed({ org: "beta", username: "dev4", roles, teams: { widgets: {} } });
        const packDir = join(process.env.HOME!, ".mattstack", "orgs", "beta", "mattstack", "teams", "widgets", "plugin");
        writeFile(join(packDir, ".claude-plugin", "plugin.json"), '{"name":"widgets","version":"1.0.0"}');
        const title = "This pack is in the beta org, not the one this Mac uses";
        const refusal = `${title}. rt works with one org per Mac, and this Mac uses acme`;
      writeStubs(packDir, { "watch-ci": { engine: "watch-ci", description: "Watch CI" } });
      const { mattstackDir, manifestPath } = makeEngineFixture();
      const before = readFileSync(manifestPath, "utf8");
      const fragmentPath = join(packDir, "pack", "skills.jsonc");
      writeFile(fragmentPath, manifestText("acme:watch-ci-domain-v1"));
      const fragmentBefore = readFileSync(fragmentPath, "utf8");
      const result = await runExpectingCleanExit(() => skillsBind(["watch-ci", "domain", "acme:watch-ci-domain-v2", "--pack-dir", packDir, "--manifest", manifestPath, "--mattstack-dir", mattstackDir, ...json]));
      expect(result.exitCode).toBe(2);
      if (json.length) expect(JSON.parse(io.lines().at(-1)!).compileErrors).toEqual([refusal]);
      else expect(io.stderr()).toStartWith(`[refused] ${title}\n  why: rt works with one org per Mac, and this Mac uses acme`);
      expect(readFileSync(manifestPath, "utf8")).toBe(before);
      expect(readFileSync(fragmentPath, "utf8")).toBe(fragmentBefore);
    } finally { process.env.HOME = savedHome; }
  });
});

const PIPELINES_FIX = join(import.meta.dir, "..", "..", "lib", "skills", "__tests__", "fixtures", "compile-pipelines");
const REAL_MODEL_TIERING = join(import.meta.dir, "..", "..", "plugins", "mattstack", "skills", "model-tiering");
const REAL_ATTACHMENTS = join(import.meta.dir, "..", "..", "plugins", "mattstack", "attachments");
const PIPELINE_STAGES = [
  "mattstack:stage-provision",
  "mattstack:stage-plan",
  "mattstack:stage-gates",
  "mattstack:stage-evidence",
  "mattstack:stage-implement",
  "mattstack:stage-self-review",
  "mattstack:stage-ship",
  "mattstack:stage-watch-ci",
];

/** compile-pipelines plus an `acme:b` evidence fill and, when given, the pack's own fragment. */
function pipelinesFixture(fragment: string | null) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-pipelines-")));
  cpSync(PIPELINES_FIX, root, { recursive: true });
  const pack = join(root, "pack");
  const ms = join(root, "mattstack-home");
  cpSync(REAL_ATTACHMENTS, join(ms, "plugins", "mattstack", "attachments"), { recursive: true });
  cpSync(REAL_MODEL_TIERING, join(ms, "plugins", "mattstack", "attachments", "model-tiering"), { recursive: true });
  writeFile(join(pack, "attachments", "b", "SKILL.md"), fillSkillMd("b", "evidence-domain@1"));
  const fragmentPath = join(pack, "pack", "skills.jsonc");
  if (fragment !== null) writeFile(fragmentPath, fragment);
  const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
  return { root, pack, ms, manifest, fragmentPath, args: ["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest] };
}

const PLAIN_LIST_FRAGMENT = `// acme fragment\n{\n  "pipelines": {\n    "feature": ${JSON.stringify(PIPELINE_STAGES)},\n    "accessibility": ${JSON.stringify(PIPELINE_STAGES)}\n  },\n  "bindings": {}\n}\n`;

describe("skillsBind --pipeline", () => {
  test("--pipeline writes the override", async () => {
    const { pack, manifest, fragmentPath, args } = pipelinesFixture(PLAIN_LIST_FRAGMENT);

    const { errors, exitCode } = await runExpectingCleanExit(() => skillsBind(["stage-evidence", "domain", "acme:b", "--pipeline", "accessibility", ...args]));
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    const fragment = readFileSync(fragmentPath, "utf8");
    expect(fragment).toContain("// acme fragment");
    const parsed = JSON.parse(stripJsonc(fragment));
    expect(parsed.pipelines.accessibility).toEqual({ stages: PIPELINE_STAGES, bindings: { "mattstack:stage-evidence": { domain: "acme:b" } } });
    expect(parsed.pipelines.feature).toEqual(PIPELINE_STAGES);
    expect(parsed.bindings).toEqual({});

    expect(sources.readManifestPipelineBindings(manifest).accessibility?.["mattstack:stage-evidence"]).toEqual({ domain: "acme:b" });
    expect(readManifestBindings(manifest)["mattstack:stage-evidence"]).toEqual({ domain: "acme:evidence-a" });
    expect(readFileSync(join(pack, "attachments", "stage-evidence--accessibility", "SKILL.md"), "utf8")).toContain("Fill b.");
    expect(io.lines()).toContain("[ok] accessibility: stage-evidence.domain  acme:evidence-b -> acme:b");
  });

  test("--pipeline writes the override: a fragment without the pipeline gains only its bindings", async () => {
    const { fragmentPath, args } = pipelinesFixture(`// acme fragment\n{\n  "bindings": {}\n}\n`);

    await skillsBind(["stage-evidence", "domain", "acme:b", "--pipeline", "accessibility", ...args]);

    const parsed = JSON.parse(stripJsonc(readFileSync(fragmentPath, "utf8")));
    expect(parsed.pipelines).toEqual({ accessibility: { bindings: { "mattstack:stage-evidence": { domain: "acme:b" } } } });
    expect(parsed.bindings).toEqual({});
  });

  test("--unset after binding into a fragment without the pipeline restores the fragment", async () => {
    const original = `// acme fragment\n{\n  "bindings": {}\n}\n`;
    const { fragmentPath, args } = pipelinesFixture(original);
    await skillsBind(["stage-evidence", "domain", "acme:b", "--pipeline", "accessibility", ...args]);

    const { errors, exitCode } = await runExpectingCleanExit(() => skillsBind(["stage-evidence", "domain", "--pipeline", "accessibility", "--unset", ...args]));
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    expect(JSON.parse(stripJsonc(readFileSync(fragmentPath, "utf8")))).toEqual(JSON.parse(stripJsonc(original)));
  }, 30_000);

  describe("a stage named with its plugin prefix", () => {
    async function bindBoth(argv: (stage: string) => string[], setup?: (f: ReturnType<typeof pipelinesFixture>) => Promise<void>) {
      const results = [];
      for (const stage of ["stage-evidence", "mattstack:stage-evidence"]) {
        const f = pipelinesFixture(PLAIN_LIST_FRAGMENT);
        await setup?.(f);
        io.clear();
        const { errors, exitCode } = await runExpectingCleanExit(() => skillsBind([...argv(stage), ...f.args]));
        expect(errors).toEqual([]);
        expect(exitCode).toBeUndefined();
        const local = (text: string) => text.replaceAll(f.root, "$ROOT");
        results.push({
          fragment: readFileSync(f.fragmentPath, "utf8"),
          manifest: local(readFileSync(f.manifest, "utf8")),
          copy: existsSync(join(f.pack, "attachments", "stage-evidence--accessibility")),
          lines: io.lines().map(local),
        });
      }
      expect(results[1]).toEqual(results[0]!);
      return results[0]!;
    }

    test("--pipeline writes the same fragment and manifest as the bare name", async () => {
      const r = await bindBoth((stage) => [stage, "domain", "acme:b", "--pipeline", "accessibility"]);
      expect(JSON.parse(stripJsonc(r.fragment)).pipelines.accessibility.bindings).toEqual({ "mattstack:stage-evidence": { domain: "acme:b" } });
      expect(r.copy).toBe(true);
      expect(r.lines).toContain("[ok] accessibility: stage-evidence.domain  acme:evidence-b -> acme:b");
    }, 30_000);

    test("without --pipeline writes the same fragment and manifest as the bare name", async () => {
      const r = await bindBoth((stage) => [stage, "domain", "acme:b"]);
      expect(JSON.parse(stripJsonc(r.fragment)).bindings).toEqual({ "mattstack:stage-evidence": { domain: "acme:b" } });
      expect(r.lines).toContain("[ok] stage-evidence.domain  acme:evidence-a -> acme:b");
    }, 30_000);

    test("--unset removes the override the bare name set", async () => {
      const r = await bindBoth(
        (stage) => [stage, "domain", "--pipeline", "accessibility", "--unset"],
        async (f) => {
          await runExpectingCleanExit(() => skillsBind(["stage-evidence", "domain", "acme:b", "--pipeline", "accessibility", ...f.args]));
        },
      );
      expect(JSON.parse(stripJsonc(r.fragment)).pipelines.accessibility).toEqual(PIPELINE_STAGES);
      expect(r.copy).toBe(false);
    }, 30_000);
  });

  test("--dry-run --pipeline shows the pipeline's own fill and writes nothing", async () => {
    const { manifest, fragmentPath, args } = pipelinesFixture(PLAIN_LIST_FRAGMENT);
    const before = [readFileSync(manifest, "utf8"), readFileSync(fragmentPath, "utf8")];

    await skillsBind(["stage-evidence", "domain", "acme:b", "--pipeline", "accessibility", "--dry-run", ...args]);

    expect(io.lines()).toContain("[not yet] accessibility: stage-evidence.domain  acme:evidence-b -> acme:b");
    expect([readFileSync(manifest, "utf8"), readFileSync(fragmentPath, "utf8")]).toEqual(before);
  });

  describe("refusals write nothing", () => {
    async function refused(argv: (args: string[]) => string[], setup?: (f: ReturnType<typeof pipelinesFixture>) => void): Promise<string[]> {
      const f = pipelinesFixture(PLAIN_LIST_FRAGMENT);
      setup?.(f);
      const before = [readFileSync(f.manifest, "utf8"), readFileSync(f.fragmentPath, "utf8")];
      const { exitCode, errors } = await runExpectingCleanExit(() => skillsBind(argv(f.args)));
      expect(exitCode).toBe(1);
      expect([readFileSync(f.manifest, "utf8"), readFileSync(f.fragmentPath, "utf8")]).toEqual(before);
      expect(existsSync(join(f.pack, "attachments", "stage-evidence"))).toBe(false);
      return errors;
    }

    test("an undeclared pipeline", async () => {
      const errors = await refused((args) => ["stage-evidence", "domain", "acme:b", "--pipeline", "nope", ...args]);
      expect(errors[0]).toContain(`pipeline "nope" is not declared in this pack's manifest`);
    });

    test("a stage the pipeline does not list", async () => {
      const errors = await refused(
        (args) => ["stage-x", "domain", "acme:b", "--pipeline", "accessibility", ...args],
        ({ ms, manifest }) => {
          writeFile(
            join(ms, "plugins", "mattstack", "attachments", "pipeline", "stage-x", "SKILL.md"),
            `---\nname: stage-x\ndescription: "stage-x"\ntype: pipeline-step\nslots:\n  domain: { contract: "evidence-domain@1", required: false }\nmetadata:\n  stage: x\n  stage-consumes: ticket\n  stage-produces: x\n---\n\n{{slot:domain}}\n`,
          );
          const parsed = JSON.parse(stripJsonc(readFileSync(manifest, "utf8")));
          parsed.pipelines.feature.push("mattstack:stage-x");
          writeFile(manifest, JSON.stringify(parsed, null, 2));
        },
      );
      expect(errors[0]).toContain(`stage-x is not a stage of pipeline "accessibility"`);
    });

    test("a declared plain-list pipeline whose name an override cannot carry", async () => {
      const errors = await refused(
        (args) => ["stage-evidence", "domain", "acme:b", "--pipeline", "Feature", ...args],
        ({ manifest }) => {
          const parsed = JSON.parse(stripJsonc(readFileSync(manifest, "utf8")));
          parsed.pipelines.Feature = PIPELINE_STAGES;
          writeFile(manifest, JSON.stringify(parsed, null, 2));
        },
      );
      expect(errors[0]).toContain(`pipeline "Feature" must match [a-z][a-z0-9-]*`);
    });

    test("a declared plain-list pipeline whose name holds --", async () => {
      const errors = await refused(
        (args) => ["stage-evidence", "domain", "acme:b", "--pipeline", "a--b", ...args],
        ({ manifest }) => {
          const parsed = JSON.parse(stripJsonc(readFileSync(manifest, "utf8")));
          parsed.pipelines["a--b"] = PIPELINE_STAGES;
          writeFile(manifest, JSON.stringify(parsed, null, 2));
        },
      );
      expect(errors[0]).toContain(`pipeline "a--b" must not contain "--"`);
    });

    test("a copy name as the verb", async () => {
      const errors = await refused((args) => ["stage-evidence--accessibility", "domain", "acme:b", ...args]);
      expect(errors[0]).toContain("stage-evidence--accessibility is a compiled copy; bind stage-evidence --pipeline accessibility instead");
    });

    test("a copy name with the plugin prefix", async () => {
      const errors = await refused((args) => ["mattstack:stage-evidence--accessibility", "domain", "acme:b", ...args]);
      expect(errors[0]).toContain("stage-evidence--accessibility is a compiled copy; bind stage-evidence --pipeline accessibility instead");
    });

    test("a stage under the wrong plugin prefix", async () => {
      const errors = await refused((args) => ["acme:stage-evidence", "domain", "acme:b", "--pipeline", "accessibility", ...args]);
      expect(errors[0]).toContain(`"acme:stage-evidence" names plugin acme, but stage-evidence comes from mattstack; bind stage-evidence or mattstack:stage-evidence`);
    });

    test("a roster verb with a plugin prefix", async () => {
      const errors = await refused((args) => ["mattstack:work-a11y", "tiering", "mattstack:model-tiering", ...args]);
      expect(errors[0]).toContain(`"mattstack:work-a11y": a roster verb takes no plugin prefix; bind work-a11y`);
    });

    test("--unset without --pipeline", async () => {
      const errors = await refused((args) => ["stage-evidence", "domain", "--unset", ...args]);
      expect(errors[0]).toContain("--unset removes a pipeline override; name the pipeline with --pipeline");
    });

    test("--unset with a fill", async () => {
      const errors = await refused((args) => ["stage-evidence", "domain", "acme:b", "--pipeline", "accessibility", "--unset", ...args]);
      expect(errors[0]).toContain("--unset takes no fill");
    });

    test("--unset where the pipeline has no override", async () => {
      const errors = await refused((args) => ["stage-evidence", "domain", "--pipeline", "feature", "--unset", ...args]);
      expect(errors[0]).toContain("feature has no override for stage-evidence.domain");
    });

    test("--unset an override another layer sets", async () => {
      const errors = await refused(
        (args) => ["stage-evidence", "domain", "--pipeline", "accessibility", "--unset", ...args],
        ({ manifest }) => {
          writeFile(manifest, `//   accessibility/mattstack:stage-evidence domain <- base:acme-base\n${readFileSync(manifest, "utf8")}`);
        },
      );
      expect(errors[0]).toContain("accessibility's override for stage-evidence.domain comes from base:acme-base; remove it there");
    });
  });

  test("binding a work verb's own slot recompiles every verb on its engine", async () => {
    const { pack, args } = pipelinesFixture(PLAIN_LIST_FRAGMENT);
    await runExpectingCleanExit(() => skillsCompile(args));

    const { errors, exitCode } = await runExpectingCleanExit(() => skillsBind(["work-a11y", "tiering", "mattstack:model-tiering", ...args]));
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    for (const verb of ["work", "work-a11y"]) {
      expect(readFileSync(join(pack, "skills", verb, "SKILL.md"), "utf8")).toContain("slot:tiering binding=mattstack:model-tiering");
    }
  }, 30_000);

  test("the usage line names --pipeline", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsBind(["stage-evidence"]));
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("rt skills bind <verb> <slot> <fill> [--pipeline <name>]");
  });

  test("the picker never lists copy names", async () => {
    const { manifest, args } = pipelinesFixture(PLAIN_LIST_FRAGMENT);
    const seq = installFakePickSequence([
      { action: "select", value: "stage-evidence", query: "" },
      { action: "select", value: "domain", query: "" },
      { action: "select", value: "acme:b", query: "" },
    ]);
    const previousIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      await skillsBind(["--pipeline", "accessibility", ...args]);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: previousIsTTY, configurable: true });
      seq.restore();
    }

    const verbRows = JSON.stringify(seq.calls[0]!.rows);
    expect(verbRows).toContain('"stage-evidence"');
    expect(verbRows).not.toContain("--accessibility");
    expect(sources.readManifestPipelineBindings(manifest).accessibility?.["mattstack:stage-evidence"]).toEqual({ domain: "acme:b" });
  });
});

describe("skillsBind --unset", () => {
  const COPY_DIR = "stage-evidence--accessibility";
  const unsetArgv = (args: string[], ...extra: string[]) => ["stage-evidence", "domain", "--pipeline", "accessibility", "--unset", ...extra, ...args];

  async function bindOverride(f: ReturnType<typeof pipelinesFixture>, pipeline = "accessibility"): Promise<void> {
    const { errors, exitCode } = await runExpectingCleanExit(() => skillsBind(["stage-evidence", "domain", "acme:b", "--pipeline", pipeline, ...f.args]));
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();
    io.clear();
  }

  test("--unset removes the override and its copy", async () => {
    const f = pipelinesFixture(PLAIN_LIST_FRAGMENT);
    await bindOverride(f);
    expect(existsSync(join(f.pack, "attachments", COPY_DIR))).toBe(true);

    const { errors, exitCode } = await runExpectingCleanExit(() => skillsBind(unsetArgv(f.args)));
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    const fragment = readFileSync(f.fragmentPath, "utf8");
    expect(fragment).toContain("// acme fragment");
    expect(JSON.parse(stripJsonc(fragment)).pipelines.accessibility).toEqual(PIPELINE_STAGES);
    expect(existsSync(join(f.pack, "attachments", COPY_DIR))).toBe(false);
    expect((await checkPack({ packDir: f.pack, mattstackDir: f.ms, manifest: f.manifest })).drift).toBe(false);
    expect(io.lines()).toContain("[ok] accessibility: stage-evidence.domain  acme:b -> acme:evidence-a");
  }, 30_000);

  test("unset in fixture mode drops the provenance line", async () => {
    const f = pipelinesFixture(PLAIN_LIST_FRAGMENT);
    writeFile(f.manifest, `//   accessibility/mattstack:stage-evidence domain <- pack\n${readFileSync(f.manifest, "utf8")}`);

    await runExpectingCleanExit(() => skillsBind(unsetArgv(f.args)));

    const manifest = readFileSync(f.manifest, "utf8");
    expect(manifest).not.toContain("accessibility/mattstack:stage-evidence domain");
    expect(manifest).toContain("// acme bindings");
    expect(sources.readManifestPipelineBindings(f.manifest).accessibility).toBeUndefined();
  }, 30_000);

  test("unset an override on the only pipeline", async () => {
    const f = pipelinesFixture(`// acme fragment\n{\n  "pipelines": { "feature": ${JSON.stringify(PIPELINE_STAGES)} },\n  "bindings": {}\n}\n`);
    writeFile(join(f.pack, "pack", "stubs.jsonc"), JSON.stringify({ verbs: { work: { engine: "work", description: "Run a unit of work" } } }));
    writeFile(join(f.pack, "pack", "surface.jsonc"), JSON.stringify({ public: ["work"] }));
    writeFile(f.manifest, `// acme bindings\n${JSON.stringify({ pipelines: { feature: PIPELINE_STAGES }, bindings: { "mattstack:stage-evidence": { domain: "acme:evidence-a" } } }, null, 2)}\n`);
    await bindOverride(f, "feature");
    expect(existsSync(join(f.pack, "attachments", "stage-evidence--feature"))).toBe(true);

    const { errors, exitCode } = await runExpectingCleanExit(() => skillsBind(["stage-evidence", "domain", "--pipeline", "feature", "--unset", ...f.args]));
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    expect(JSON.parse(stripJsonc(readFileSync(f.fragmentPath, "utf8"))).pipelines.feature).toEqual(PIPELINE_STAGES);
    expect(existsSync(join(f.pack, "attachments", "stage-evidence--feature"))).toBe(false);
    expect(readFileSync(join(f.pack, "attachments", "stage-evidence", "SKILL.md"), "utf8")).toContain("evidence-a body");
  }, 30_000);

  test("unset json", async () => {
    const f = pipelinesFixture(PLAIN_LIST_FRAGMENT);

    await skillsBind(unsetArgv(f.args, "--json"));

    expect(JSON.parse(io.stdout())).toMatchObject({
      ok: true, verb: "stage-evidence", slot: "domain", pipeline: "accessibility", from: "acme:evidence-b", to: "acme:evidence-a", unset: true,
    });
  }, 30_000);

  test("unset dry run", async () => {
    const f = pipelinesFixture(PLAIN_LIST_FRAGMENT);
    const before = [readFileSync(f.manifest, "utf8"), readFileSync(f.fragmentPath, "utf8")];

    await skillsBind(unsetArgv(f.args, "--dry-run"));

    expect(io.lines()).toContain("[not yet] accessibility: stage-evidence.domain  acme:evidence-b -> acme:evidence-a");
    expect([readFileSync(f.manifest, "utf8"), readFileSync(f.fragmentPath, "utf8")]).toEqual(before);
    expect(existsSync(join(f.pack, "attachments", "stage-evidence"))).toBe(false);
  });

  test("the unset usage line names --pipeline and --unset", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsBind(["stage-evidence", "--pipeline", "accessibility", "--unset"]));
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("rt skills bind <verb> <slot> --pipeline <name> --unset");
  });

  test("byte-identical after unset", async () => {
    const f = pipelinesFixture(PLAIN_LIST_FRAGMENT);
    await bindOverride(f);
    await runExpectingCleanExit(() => skillsBind(unsetArgv(f.args)));

    const after = readFileSync(f.fragmentPath, "utf8");
    const render = (text: string) => renderManifest(
      mergeLayers([{ label: "pack", fragment: parseFragment(text, f.fragmentPath) }]),
      { repo: "gitlab.example.com/acme/widgets", pack: "acme", zone: "acme" },
    );
    expect(JSON.parse(stripJsonc(after))).toEqual(JSON.parse(stripJsonc(PLAIN_LIST_FRAGMENT)));
    expect(render(after)).toBe(render(PLAIN_LIST_FRAGMENT));
  }, 30_000);
});

describe("applyBind --pipeline", () => {
  function teamPack(fragment: string) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
    const packDir = join(root, "mattstack", "teams", "widgets", "plugin");
    writeFile(join(packDir, "pack", "skills.jsonc"), fragment);
    const manifestPath = join(root, "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
    writeFile(manifestPath, "{}");
    return { packDir, manifestPath };
  }

  test("shadowedBy reads the pipeline override's provenance", async () => {
    const { packDir, manifestPath } = teamPack(`{\n  "pipelines": { "accessibility": ["mattstack:stage-evidence"] }\n}\n`);
    const result = await applyBind({
      manifestPath, packDir, engineRef: "mattstack:stage-evidence", slotName: "domain", fill: "acme:b", pipeline: "accessibility", fixtureMode: false,
      materialize: async () => {
        writeFile(manifestPath, [
          "//   mattstack:stage-evidence domain <- team",
          "//   accessibility/mattstack:stage-evidence domain <- override",
          `{ "pipelines": { "accessibility": { "stages": ["mattstack:stage-evidence"], "bindings": { "mattstack:stage-evidence": { "domain": "me:evidence" } } } }, "bindings": { "mattstack:stage-evidence": { "domain": "acme:b" } } }`,
        ].join("\n"));
        return { ok: true };
      },
    });
    expect(result.shadowedBy).toBe("override");
    expect(JSON.parse(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).pipelines.accessibility).toEqual({
      stages: ["mattstack:stage-evidence"],
      bindings: { "mattstack:stage-evidence": { domain: "acme:b" } },
    });
  });

  test("a pipeline override that landed is not shadowed, whatever the default says", async () => {
    const { packDir, manifestPath } = teamPack(`{}`);
    const result = await applyBind({
      manifestPath, packDir, engineRef: "mattstack:stage-evidence", slotName: "domain", fill: "acme:b", pipeline: "accessibility", fixtureMode: false,
      materialize: async () => {
        writeFile(manifestPath, [
          "//   mattstack:stage-evidence domain <- override",
          "//   accessibility/mattstack:stage-evidence domain <- team",
          `{ "pipelines": { "accessibility": { "stages": ["mattstack:stage-evidence"], "bindings": { "mattstack:stage-evidence": { "domain": "acme:b" } } } }, "bindings": { "mattstack:stage-evidence": { "domain": "me:evidence" } } }`,
        ].join("\n"));
        return { ok: true };
      },
    });
    expect(result).toEqual({ fragmentUpdated: join(packDir, "pack", "skills.jsonc"), shadowedBy: null, regenerated: true });
  });

  test("a lower layer's override still applies after unset", async () => {
    const { packDir, manifestPath } = teamPack(
      `{\n  "pipelines": { "accessibility": { "stages": ["mattstack:stage-evidence"], "bindings": { "mattstack:stage-evidence": { "domain": "acme:b" } } } }\n}\n`,
    );
    const result = await applyBind({
      manifestPath, packDir, engineRef: "mattstack:stage-evidence", slotName: "domain", fill: "", pipeline: "accessibility", unset: true, fixtureMode: false,
      materialize: async () => {
        writeFile(manifestPath, [
          "//   mattstack:stage-evidence domain <- pack",
          "//   accessibility/mattstack:stage-evidence domain <- base:acme-base",
          `{ "pipelines": { "accessibility": { "stages": ["mattstack:stage-evidence"], "bindings": { "mattstack:stage-evidence": { "domain": "acme:base-evidence" } } } }, "bindings": { "mattstack:stage-evidence": { "domain": "acme:evidence-a" } } }`,
        ].join("\n"));
        return { ok: true };
      },
    });

    expect(JSON.parse(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).pipelines.accessibility).toEqual(["mattstack:stage-evidence"]);
    expect(result.to).toBe("acme:base-evidence");
    expect(result.shadowedBy).toBe("base:acme-base");
    expect(renderPlain(bindBlocks({
      verb: "accessibility: stage-evidence", slot: "domain", from: "acme:b", to: result.to!, dryRun: false, fragmentUpdated: null, basePack: null,
      unset: { pipeline: "accessibility", stillOverriddenBy: result.shadowedBy },
    }))).toBe([
      "[ok] accessibility: stage-evidence.domain  acme:b -> acme:base-evidence",
      "  note: Removed this pack's accessibility override, but base:acme-base's override still applies.",
      "",
    ].join("\n"));
  });
});
