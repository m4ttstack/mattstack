import { describe, test, expect, beforeEach } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import {
  AttachmentLoadError,
  buildPluginRoots,
  installedVersionFor,
  invocableRoster,
  loadAttachment,
  loadInclude,
  loadStepSource,
  orgBasePackRoots,
  orgOfPackDir,
  parseStageQualifiedName,
  readManifestBindings,
  readManifestLayered,
  readManifestPipelineBindings,
  readManifestPipelineLayered,
  readManifestPipelines,
  readVerbRoster,
  stageRoster,
  stripFrontmatter,
  type PluginListEntry,
  type PluginRoots,
} from "../sources.ts";
import { effectiveSlotBindings } from "../pipelines.ts";
import { BlockError } from "../blocks/diagnostics.ts";
import * as out from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../ui/warn.ts";

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

const WATCH_CI_SKILL_MD = `---
name: watch-ci
description: "Watch CI until it goes green"
type: pipeline-step
allowed-tools:
  - "Bash(gh:*)"
  - "Read"
slots:
  domain: { contract: "watch-ci-domain@1" }
  forge: { contract: "ci-forge@1", required: true }
---

Poll the pipeline every 30s and report status.
`;

const WATCH_CI_SCRIPT = "#!/bin/sh\necho polling\n";

const WATCH_CI_DOMAIN_SKILL_MD = `---
name: watch-ci-domain
description: "Domain rules for watch-ci"
metadata:
  provides: "watch-ci-domain@1"
allowed-tools:
  - "Read(\${CLAUDE_SKILL_DIR}/ci-config.json)"
---

Domain rules live at \${CLAUDE_SKILL_DIR}/ci-config.json for details.
`;

const CI_CONFIG_JSON = `{ "noisy": ["flaky-job"] }\n`;

/**
 * mattstack root: skills/pipeline/watch-ci/SKILL.md (+ scripts/ci-watch.sh),
 * matching the real plugin's group/engine nesting, plus
 * attachments/pipeline/ship/SKILL.md -- an engine already moved out of
 * skills/ (unregistered) that loadStepSource must still resolve.
 * acme root: attachments/watch-ci-domain/SKILL.md (+ ci-config.json), the
 * unregistered fill; a registered copy also lives under skills/watch-ci-domain
 * so loadAttachment can be exercised against both search roots.
 */
function makeFixtureRoots(): { rootDir: string; roots: PluginRoots } {
  const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-src-")));

  const mattstackDir = join(rootDir, "mattstack");
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "SKILL.md"), WATCH_CI_SKILL_MD);
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "scripts", "ci-watch.sh"), WATCH_CI_SCRIPT);
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "references", "polling-notes.md"), "Polling notes.\n");
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", ".DS_Store"), "junk");
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "README.md"), "readme");
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "scripts", ".gitignore"), "*.pyc");
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "scripts", "__pycache__", "x.pyc"), "pyc");
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "scripts", "helper.pyc"), "pyc");
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "scripts", "poll.test.sh"), "test");
  writeFile(join(mattstackDir, "skills", "pipeline", "watch-ci", "tests", "harness.sh"), "test");
  writeFile(join(mattstackDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.2.0" }));

  const untypedSkillMd = WATCH_CI_SKILL_MD.replace("type: pipeline-step\n", "");
  writeFile(join(mattstackDir, "skills", "pipeline", "untyped-step", "SKILL.md"), untypedSkillMd);

  const shipSkillMd = WATCH_CI_SKILL_MD.replace(/name: watch-ci/, "name: ship").replace(
    "Poll the pipeline every 30s and report status.",
    "Ship it.",
  );
  writeFile(join(mattstackDir, "attachments", "pipeline", "ship", "SKILL.md"), shipSkillMd);

  const acmeDir = join(rootDir, "acme");
  writeFile(join(acmeDir, "attachments", "watch-ci-domain", "SKILL.md"), WATCH_CI_DOMAIN_SKILL_MD);
  writeFile(join(acmeDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
  writeFile(join(acmeDir, "skills", "qa-gates", "SKILL.md"), WATCH_CI_DOMAIN_SKILL_MD.replace("watch-ci-domain", "qa-gates"));
  writeFile(join(acmeDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.3.0" }));

  const roots: PluginRoots = {
    byName: {
      mattstack: { dir: mattstackDir, version: "1.2.0" },
      acme: { dir: acmeDir, version: "0.3.0" },
    },
    list: [],
  };

  return { rootDir, roots };
}

describe("stripFrontmatter", () => {
  test("round-trips body exactly and parses frontmatter", () => {
    const body = "Line one.\nLine two.\n\nLine four after a blank.";
    const md = `---\nname: foo\nnested:\n  x: 1\n---\n\n${body}\n`;

    const result = stripFrontmatter(md);

    expect(result.body).toBe(body);
    expect(result.frontmatter).toEqual({ name: "foo", nested: { x: 1 } });
  });

  test("no frontmatter block returns the trimmed body and empty frontmatter", () => {
    const result = stripFrontmatter("Just prose, no frontmatter.\n");
    expect(result.body).toBe("Just prose, no frontmatter.");
    expect(result.frontmatter).toEqual({});
  });

  test("reports the line the body starts on", () => {
    const withFm = "---\nname: x\ndescription: y\n---\n\n# Body\n";
    const r = stripFrontmatter(withFm);
    expect(r.body.startsWith("# Body")).toBe(true);
    expect(r.bodyStartLine).toBe(6); // 1-indexed line of "# Body"

    const withoutFm = "# Body\n";
    expect(stripFrontmatter(withoutFm).bodyStartLine).toBe(1);
  });

  test("trailing blank lines after the body do not shift bodyStartLine", () => {
    // body is trimmed at both ends -- a length-difference formula would count
    // these trailing newlines as if they were leading, landing on line 8 instead of 5.
    expect(stripFrontmatter("---\nname: x\n---\n\n# Body\n\n\n\n").bodyStartLine).toBe(5);
  });
});

describe("loadStepSource", () => {
  test("finds the engine under skills/pipeline/, parses slots, lists stepFiles", () => {
    const { roots } = makeFixtureRoots();

    const step = loadStepSource("watch-ci", roots);

    expect(step.name).toBe("watch-ci");
    expect(step.plugin).toBe("mattstack");
    expect(step.version).toBe("1.2.0");
    expect(step.dir.endsWith(join("skills", "pipeline", "watch-ci"))).toBe(true);
    expect(step.body).toBe("Poll the pipeline every 30s and report status.");
    expect(step.slots).toEqual({
      domain: { contract: "watch-ci-domain@1" },
      forge: { contract: "ci-forge@1", required: true },
    });
    expect(step.allowedTools).toEqual(["Bash(gh:*)", "Read"]);
    expect(step.stepFiles).toEqual(["references/polling-notes.md", "scripts/ci-watch.sh"]);
    expect(step.srcPath).toBe(join("skills", "pipeline", "watch-ci", "SKILL.md"));
    expect(step.bodyStartLine).toBe(13);
  });

  test("throws naming the file when the engine has no type: pipeline-step", () => {
    const { roots } = makeFixtureRoots();

    expect(() => loadStepSource("untyped-step", roots)).toThrow(/untyped-step.*SKILL\.md/s);
  });

  test("throws listing searched paths when the engine is absent entirely", () => {
    const { roots } = makeFixtureRoots();
    const expectedSkillsPath = join(
      roots.byName.mattstack!.dir,
      "skills",
      "pipeline",
      "no-such-engine",
      "SKILL.md",
    );
    const expectedAttachmentsFlatPath = join(
      roots.byName.mattstack!.dir,
      "attachments",
      "no-such-engine",
      "SKILL.md",
    );
    const expectedAttachmentsGroupPath = join(
      roots.byName.mattstack!.dir,
      "attachments",
      "pipeline",
      "no-such-engine",
      "SKILL.md",
    );

    let thrown: unknown;
    try {
      loadStepSource("no-such-engine", roots);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(expectedSkillsPath);
    expect((thrown as Error).message).toContain(expectedAttachmentsFlatPath);
    expect((thrown as Error).message).toContain(expectedAttachmentsGroupPath);
  });

  test("falls back to attachments/<group>/<engine>/SKILL.md for an engine moved out of skills/", () => {
    const { roots } = makeFixtureRoots();

    const step = loadStepSource("ship", roots);

    expect(step.name).toBe("ship");
    expect(step.dir.endsWith(join("attachments", "pipeline", "ship"))).toBe(true);
    expect(step.body).toBe("Ship it.");
  });

  test("loadStepSource reads stage metadata into stageMeta", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-step-"));
    const dir = join(root, "attachments", "stage-plan");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), [
      "---", "name: stage-plan", "description: plan", "type: pipeline-step",
      "slots:", "  domain: { contract: plan-domain@1, required: false }",
      "metadata:", "  stage: plan", "  stage-consumes: ticket", "  stage-produces: approach evidence-plan",
      "---", "", "body {{slot:domain}}",
    ].join("\n"));
    const step = loadStepSource("stage-plan", { byName: { mattstack: { dir: root, version: "1.0.0" } }, list: [] });
    expect(step.stageMeta).toEqual({ stage: "plan", consumes: ["ticket"], produces: ["approach", "evidence-plan"] });
  });

  test("loadStepSource reads YAML-sequence stage-consumes/stage-produces into stageMeta", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-step-"));
    const dir = join(root, "attachments", "stage-plan");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), [
      "---", "name: stage-plan", "description: plan", "type: pipeline-step",
      "slots:", "  domain: { contract: plan-domain@1, required: false }",
      "metadata:", "  stage: plan",
      "  stage-consumes:", "    - ticket", "    - repo",
      "  stage-produces:", "    - approach", "    - evidence-plan",
      "---", "", "body {{slot:domain}}",
    ].join("\n"));
    const step = loadStepSource("stage-plan", { byName: { mattstack: { dir: root, version: "1.0.0" } }, list: [] });
    expect(step.stageMeta).toEqual({ stage: "plan", consumes: ["ticket", "repo"], produces: ["approach", "evidence-plan"] });
  });

  test("loadStepSource leaves stageMeta null for a non-stage engine", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-step-"));
    const dir = join(root, "attachments", "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: work\ndescription: w\ntype: pipeline-step\n---\n\nbody");
    const step = loadStepSource("work", { byName: { mattstack: { dir: root, version: "1.0.0" } }, list: [] });
    expect(step.stageMeta).toBeNull();
  });
});

describe("loadAttachment", () => {
  test("finds a registered skill under skills/", () => {
    const { roots } = makeFixtureRoots();

    const fill = loadAttachment("acme:qa-gates", "domain", roots);

    expect(fill.registered).toBe(true);
    expect(fill.binding).toBe("acme:qa-gates");
    expect(fill.plugin).toBe("acme");
    expect(fill.version).toBe("0.3.0");
    expect(fill.provides).toBe("watch-ci-domain@1");
    expect(fill.dir.endsWith(join("skills", "qa-gates"))).toBe(true);
    expect(fill.srcPath).toBe(join("skills", "qa-gates", "SKILL.md"));
    expect(fill.bodyStartLine).toBe(10);
  });

  test("finds an unregistered skill under attachments/", () => {
    const { roots } = makeFixtureRoots();

    const fill = loadAttachment("acme:watch-ci-domain", "domain", roots);

    expect(fill.registered).toBe(false);
    expect(fill.binding).toBe("acme:watch-ci-domain");
    expect(fill.provides).toBe("watch-ci-domain@1");
    expect(fill.body).toBe("Domain rules live at ${CLAUDE_SKILL_DIR}/ci-config.json for details.");
    expect(fill.allowedTools).toEqual(["Read(${CLAUDE_SKILL_DIR}/ci-config.json)"]);
    expect(fill.dir.endsWith(join("attachments", "watch-ci-domain"))).toBe(true);
    expect(fill.srcPath).toBe(join("attachments", "watch-ci-domain", "SKILL.md"));
    expect(fill.bodyStartLine).toBe(10);
  });

  test("extraFiles excludes SKILL.md and includes nested files", () => {
    const { rootDir, roots } = makeFixtureRoots();
    writeFile(
      join(rootDir, "acme", "attachments", "watch-ci-domain", "nested", "extra.txt"),
      "extra\n",
    );

    const fill = loadAttachment("acme:watch-ci-domain", "domain", roots);

    expect(fill.extraFiles.sort()).toEqual(["ci-config.json", "nested/extra.txt"]);
  });

  test("throws naming the slot and binding when neither search root has the skill", () => {
    const { roots } = makeFixtureRoots();
    const acmeDir = roots.byName.acme!.dir;
    const expectedSkillsPath = join(acmeDir, "skills", "no-such-skill", "SKILL.md");
    const expectedAttachmentsPath = join(acmeDir, "attachments", "no-such-skill", "SKILL.md");

    let thrown: unknown;
    try {
      loadAttachment("acme:no-such-skill", "domain", roots);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("domain");
    expect(message).toContain("acme:no-such-skill");
    expect(message).toContain(expectedSkillsPath);
    expect(message).toContain(expectedAttachmentsPath);
  });
});

describe("loadAttachment per-file values", () => {
  const LINT_SKILL_MD = `---\nname: lint\ndescription: "lint rules"\nmetadata:\n  provides: ship-domain@1\n---\n`;

  function lintRoots(skillMd = LINT_SKILL_MD): { dir: string; roots: PluginRoots } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-perfile-")));
    writeFile(join(dir, "attachments", "lint", "SKILL.md"), skillMd);
    writeFile(join(dir, "attachments", "lint", "fast.md"), "the fast rules\n");
    writeFile(join(dir, "attachments", "lint", "slow.md"), "the slow rules\n");
    writeFile(join(dir, "attachments", "lint", "config.json"), "{}\n");
    writeFile(join(dir, "attachments", "lint", "references", "notes.md"), "notes\n");
    return { dir, roots: { byName: { w: { dir, version: "0.1.0" } }, list: [] } };
  }

  test("plugin:skill/file reads that file as the body", () => {
    const { roots } = lintRoots();

    const fill = loadAttachment("w:lint/fast", "rules", roots);

    expect(fill.body).toBe("the fast rules");
    expect(fill.file).toBe("fast.md");
    expect(fill.binding).toBe("w:lint/fast");
    expect(fill.srcPath.endsWith(join("attachments", "lint", "fast.md"))).toBe(true);
    expect(fill.bodyStartLine).toBe(1);
    expect(fill.provides).toBe("ship-domain@1");
    expect(fill.registered).toBe(false);
  });

  test("a per-file skill vendors sub-folders and non-md files, never its top-level md values", () => {
    const { roots } = lintRoots();

    expect(loadAttachment("w:lint/fast", "rules", roots).extraFiles).toEqual(["config.json", "references/notes.md"]);
  });

  test("a whole-skill load with an empty body still vendors its top-level md siblings, as a slot fill always has", () => {
    const { roots } = lintRoots();

    expect(loadAttachment("w:lint", "rules", roots).extraFiles).toEqual(["config.json", "fast.md", "references/notes.md", "slow.md"]);
  });

  test("a per-file value that starts with a frontmatter fence is refused as bad-value", () => {
    const { dir, roots } = lintRoots();
    writeFile(join(dir, "attachments", "lint", "fast.md"), "---\ntitle: fast\n---\nthe fast rules\n");

    let caught: unknown;
    try {
      loadAttachment("w:lint/fast", "rules", roots, "prop");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AttachmentLoadError);
    expect((caught as AttachmentLoadError).code).toBe("bad-value");
    expect((caught as Error).message).toContain('loadAttachment: prop "rules": binding "w:lint/fast": a per-file value carries no frontmatter');
  });

  test("a prop load names a prop; a slot load keeps its wording", () => {
    const { roots } = lintRoots();

    expect(() => loadAttachment("w:lint/nope", "rules", roots, "prop")).toThrow(/^loadAttachment: prop "rules": binding "w:lint\/nope": no file at /);
    expect(() => loadAttachment("w:lint/nope", "rules", roots)).toThrow(/^loadAttachment: slot "rules": binding "w:lint\/nope": no file at /);
  });

  test("a whole-skill binding keeps file null", () => {
    const { roots } = makeFixtureRoots();

    expect(loadAttachment("acme:watch-ci-domain", "domain", roots).file).toBeNull();
  });

  test("a SKILL.md with body text refuses a per-file value", () => {
    const { roots } = lintRoots(`${LINT_SKILL_MD}\nsome text\n`);

    expect(() => loadAttachment("w:lint/fast", "rules", roots)).toThrow(/w:lint\/fast: SKILL\.md carries text, but a per-file value's SKILL\.md is frontmatter only/);
  });

  test("a missing file throws naming the binding", () => {
    const { roots } = lintRoots();

    expect(() => loadAttachment("w:lint/nope", "rules", roots)).toThrow(/w:lint\/nope/);
  });

  test("a file part outside the name pattern is refused", () => {
    const { roots } = lintRoots();

    expect(() => loadAttachment("w:lint/../lint/fast", "rules", roots)).toThrow(/w:lint\/\.\.\/lint\/fast/);
  });
});

describe("readVerbRoster", () => {
  test("parses the real stubs.jsonc shape (comment-bearing JSONC)", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-pack-")));
    const stubsJsonc = `// Verb roster for this pack: the doors it compiles from the engines
// (bindings in pack/skills.jsonc).
{
  "verbs": {
    "watch-ci": {
      "engine": "watch-ci",
      "description": "Use when watching or triaging CI."
    },
    "ship": {
      "engine": "ship",
      // inline verb comment
      "description": "Use when ready to ship."
    }
  }
}
`;
    writeFile(join(rootDir, "pack", "stubs.jsonc"), stubsJsonc);

    const roster = readVerbRoster(rootDir);

    expect(roster).toEqual([
      { name: "watch-ci", engine: "watch-ci", description: "Use when watching or triaging CI." },
      { name: "ship", engine: "ship", description: "Use when ready to ship." },
    ]);
  });

  test("throws naming the offending key when a verb name is a path breakout", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-pack-")));
    const stubsJsonc = `{
  "verbs": {
    "../evil": {
      "engine": "watch-ci",
      "description": "Use when watching or triaging CI."
    }
  }
}
`;
    writeFile(join(rootDir, "pack", "stubs.jsonc"), stubsJsonc);

    expect(() => readVerbRoster(rootDir)).toThrow(/"\.\.\/evil"/);
  });

  test("reads a verb's pipeline", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-pack-")));
    writeFile(join(rootDir, "pack", "stubs.jsonc"), JSON.stringify({
      verbs: {
        work: { engine: "work", description: "Run work" },
        "work-a11y": { engine: "work", pipeline: "accessibility", description: "Run accessibility work" },
      },
    }));

    const roster = readVerbRoster(rootDir);

    expect(roster[0]).not.toHaveProperty("pipeline");
    expect(roster[1]).toEqual({ name: "work-a11y", engine: "work", description: "Run accessibility work", pipeline: "accessibility" });
  });
});

describe("readManifestLayered", () => {
  test("reads the layered section and falls back to the string binding with its provenance layer", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-layered-")));
    const manifestPath = join(rootDir, "skills.jsonc");
    writeFile(
      manifestPath,
      `// GENERATED
// provenance (binding <- layer):
//   mattstack:ship domain <- base:acme-base
//   mattstack:ship/flow/fast-checks rules <- pack
//   a/r x <- override
{
  "version": 2,
  "pipelines": { "a": { "stages": ["r"], "bindings": { "r": { "x": "me:x" } } } },
  "bindings": {
    "mattstack:ship": { "domain": "acme-base:d" },
    "mattstack:ship/flow/fast-checks": { "rules": "" }
  },
  "layered": {
    "mattstack:ship/flow/fast-checks": { "rules": [{ "layer": "base:acme-base", "value": "acme-base:r" }, { "layer": "pack", "value": "" }] }
  }
}
`,
    );

    expect(readManifestLayered(manifestPath)).toEqual({
      "mattstack:ship": { domain: [{ layer: "base:acme-base", value: "acme-base:d" }] },
      "mattstack:ship/flow/fast-checks": { rules: [{ layer: "base:acme-base", value: "acme-base:r" }, { layer: "pack", value: "" }] },
    });
    expect(readManifestPipelineLayered(manifestPath)).toEqual({ a: { r: { x: [{ layer: "override", value: "me:x" }] } } });
    expect(readManifestBindings(manifestPath)["mattstack:ship/flow/fast-checks"]).toEqual({ rules: "" });
  });

  test("a fragment with no provenance lines reads every string as the pack layer", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-layered-")));
    const manifestPath = join(rootDir, "skills.jsonc");
    writeFile(manifestPath, '// Bindings manifest for this pack\n{ "version": 1, "bindings": { "mattstack:shepherdr": { "tiering": "mattstack:model-tiering" } } }\n');
    expect(readManifestLayered(manifestPath)).toEqual({ "mattstack:shepherdr": { tiering: [{ layer: "pack", value: "mattstack:model-tiering" }] } });
  });
});

describe("readManifestBindings", () => {
  test("parses a fixture copied from the real manifest's bindings shape", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-manifest-")));
    const manifestJsonc = `// GENERATED by merge-manifests.sh -- do not hand-edit for keeps;
// the next pack install or merge run rewrites this file.
{
  "version": 1,
  "skills": { "enabled": ["mattstack:watch-ci"] },
  "bindings": {
    "mattstack:watch-ci": {
      "domain": "acme:watch-ci-domain",
      "forge": "mattstack:ci-forge-gitlab"
    },
    "mattstack:work": {
      "tiering": "mattstack:model-tiering"
    }
  }
}
`;
    const manifestPath = join(rootDir, "skills.jsonc");
    writeFile(manifestPath, manifestJsonc);

    const bindings = readManifestBindings(manifestPath);

    expect(bindings).toEqual({
      "mattstack:watch-ci": {
        domain: "acme:watch-ci-domain",
        forge: "mattstack:ci-forge-gitlab",
      },
      "mattstack:work": {
        tiering: "mattstack:model-tiering",
      },
    });
  });
});

describe("invocableRoster", () => {
  test("lists plugin:skillDirName for one- and two-level skills/ entries", () => {
    const { roots } = makeFixtureRoots();

    const roster = invocableRoster(roots);

    expect(roster.has("mattstack:watch-ci")).toBe(true);
    expect(roster.has("mattstack:untyped-step")).toBe(true);
    expect(roster.has("acme:qa-gates")).toBe(true);
    expect(roster.has("acme:watch-ci-domain")).toBe(false);
    expect(roster.has("mattstack:ship")).toBe(false);
  });

  test("adds the skills under every root the plugin manifest's skills array lists", () => {
    const { roots } = makeFixtureRoots();
    const dir = roots.byName.mattstack!.dir;
    writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.2.0", skills: ["./skills", "./plugin/skills"] }));
    writeFile(join(dir, "plugin", "skills", "herd-progress", "SKILL.md"), "---\nname: herd-progress\n---\n");

    const roster = invocableRoster(roots);

    expect(roster.has("mattstack:herd-progress")).toBe(true);
    expect(roster.has("mattstack:watch-ci")).toBe(true);
  });

  test("ignores a manifest skills root that resolves outside the plugin", () => {
    const { rootDir, roots } = makeFixtureRoots();
    const dir = roots.byName.mattstack!.dir;
    writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.2.0", skills: ["../outside"] }));
    writeFile(join(rootDir, "outside", "escaped", "SKILL.md"), "---\nname: escaped\n---\n");

    expect(invocableRoster(roots).has("mattstack:escaped")).toBe(false);
  });
});

describe("buildPluginRoots", () => {
  test("skips an entry whose installPath does not exist, warns once, and still resolves the rest", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-plugin-roots-")));

    const mattstackDir = join(rootDir, "mattstack");
    writeFile(join(mattstackDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.2.0" }));

    const acmeDir = join(rootDir, "acme");
    writeFile(join(acmeDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.3.0" }));

    const staleInstallPath = join(rootDir, "current-time", "0.1.0");

    const io = captureOut();
    out.__test__.setHuman(() => false);
    warnTest.reset();
    const logged: Array<{ module: string; message: string }> = [];
    setWarningLog((module, message) => {
      logged.push({ module, message });
    });
    let roots: PluginRoots;
    let shown: string;
    try {
      roots = buildPluginRoots([
        { id: "mattstack@mattstack", installPath: mattstackDir },
        { id: "current-time@mattstack", installPath: staleInstallPath },
        { id: "acme@acme", installPath: acmeDir },
      ]);
      shown = io.stderr();
      expect(io.stdout()).toBe("");
    } finally {
      warnTest.reset();
      io.restore();
    }

    expect(roots.byName.mattstack).toEqual({ dir: mattstackDir, version: "1.2.0" });
    expect(roots.byName.acme).toEqual({ dir: acmeDir, version: "0.3.0" });
    expect(roots.byName["current-time"]).toBeUndefined();

    expect(logged).toEqual([{ module: "skills", message: `skipping plugin "current-time" -- installPath does not exist: ${staleInstallPath}` }]);
    expect(shown).toBe("[warning] Skipped the current-time plugin  its folder is gone\n");
  });

  test("buildPluginRoots keeps a user-scope and a stale project-scope root for one plugin", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-plugin-dirs-")));
    const userDir = join(rootDir, "user");
    const projectDir = join(rootDir, "project");
    writeFile(join(userDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "2.0.0" }));
    writeFile(join(projectDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));

    const roots = buildPluginRoots([
      { id: "mattstack@mattstack", installPath: userDir, scope: "user" },
      { id: "mattstack@mattstack", installPath: projectDir, scope: "project", projectPath: homedir() } as PluginListEntry,
    ]);

    expect(roots.dirs).toEqual([realpathSync(userDir), realpathSync(projectDir)]);
    expect(roots.byName.mattstack?.dir).toBe(realpathSync(projectDir));
  });

  test("buildPluginRoots dedupes a root listed twice", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-plugin-dedupe-")));
    const dir = join(rootDir, "mattstack");
    writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));

    const roots = buildPluginRoots([
      { id: "mattstack@mattstack", installPath: dir, scope: "user" },
      { id: "mattstack@mattstack", installPath: dir, scope: "project" },
    ]);

    expect(roots.dirs).toEqual([dir]);
  });

  test("buildPluginRoots skips a missing installPath in dirs", () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-plugin-missing-")));
    const dir = join(rootDir, "acme");
    writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
    warnTest.reset();
    setWarningLog(() => {});
    const io = captureOut();
    let roots: PluginRoots;
    try {
      roots = buildPluginRoots([
        { id: "gone@mattstack", installPath: join(rootDir, "gone") },
        { id: "acme@acme", installPath: dir },
      ]);
    } finally {
      warnTest.reset();
      io.restore();
    }

    expect(roots.dirs).toEqual([dir]);
  });

  test("no missing entries: every plugin resolves, no warning printed", () => {
    const { roots: fixtureRoots } = makeFixtureRoots();

    const io = captureOut();
    let roots: PluginRoots;
    let printed: string;
    try {
      roots = buildPluginRoots([
        { id: "mattstack@mattstack", installPath: fixtureRoots.byName.mattstack!.dir },
        { id: "acme@acme", installPath: fixtureRoots.byName.acme!.dir },
      ]);
      printed = io.stderr() + io.stdout();
    } finally {
      io.restore();
    }

    expect(roots.byName.mattstack?.version).toBe("1.2.0");
    expect(roots.byName.acme?.version).toBe("0.3.0");
    expect(printed).toBe("");
  });
});

test("readManifestPipelines returns the pipelines map", () => {
  const root = mkdtempSync(join(tmpdir(), "rt-man-"));
  const p = join(root, "skills.jsonc");
  writeFileSync(p, '// header\n{ "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-ship"] }, "bindings": {} }');
  expect(readManifestPipelines(p)).toEqual({ feature: ["mattstack:stage-plan", "mattstack:stage-ship"] });
});

test("readManifestPipelines reads the object form", () => {
  const root = mkdtempSync(join(tmpdir(), "rt-man-"));
  const p = join(root, "skills.jsonc");
  writeFileSync(p, JSON.stringify({
    pipelines: {
      feature: ["mattstack:stage-plan", "mattstack:stage-ship"],
      accessibility: { stages: ["mattstack:stage-plan", "mattstack:stage-evidence"], bindings: { "mattstack:stage-evidence": { domain: "acme:a" } } },
    },
    bindings: {},
  }));
  expect(readManifestPipelines(p)).toEqual({
    feature: ["mattstack:stage-plan", "mattstack:stage-ship"],
    accessibility: ["mattstack:stage-plan", "mattstack:stage-evidence"],
  });
  expect(readManifestPipelineBindings(p)).toEqual({ accessibility: { "mattstack:stage-evidence": { domain: "acme:a" } } });
});

test("stageRoster is the distinct union across pipelines, bare names", () => {
  expect(stageRoster({ feature: ["mattstack:stage-plan", "mattstack:stage-ship"], bugfix: ["mattstack:stage-plan"] }, {}, {}))
    .toEqual([
      { name: "stage-plan", engine: "stage-plan", description: "" },
      { name: "stage-ship", engine: "stage-ship", description: "" },
    ]);
});

describe("stageRoster stage copies", () => {
  const pipelines = {
    feature: ["mattstack:stage-plan", "mattstack:stage-evidence"],
    accessibility: ["mattstack:stage-plan", "mattstack:stage-evidence"],
  };
  const defaults = { "mattstack:stage-evidence": { domain: "acme:a" } };
  const base = [
    { name: "stage-plan", engine: "stage-plan", description: "" },
    { name: "stage-evidence", engine: "stage-evidence", description: "" },
  ];

  test("a pipeline's binding on a block path of a block engine adds a copy", () => {
    const mini = { feature: ["mattstack:mini"] };
    const top = { "mattstack:mini/gate": { tiering: "widgets:tiers/fast" } };
    const overrides = { feature: { "mattstack:mini/gate": { tiering: "" } } };
    expect(stageRoster(mini, overrides, top)).toEqual([
      { name: "mini", engine: "mini", description: "" },
      { name: "mini--feature", engine: "mini", description: "", pipeline: "feature" },
    ]);
    expect(stageRoster(mini, { feature: { "mattstack:mini/nope": { rules: "widgets:x" } } }, {}).map((v) => v.name)).toEqual(["mini", "mini--feature"]);
    expect(stageRoster(mini, { feature: { "mattstack:mini-x/gate": { tiering: "widgets:x" } } }, {}).map((v) => v.name)).toEqual(["mini"]);
  });

  test("override equal to default makes no copy", () => {
    const overrides = { accessibility: { "mattstack:stage-evidence": { domain: "acme:a" } } };
    expect(stageRoster(pipelines, overrides, defaults)).toEqual(base);
  });

  test("empty override over an absent slot makes no copy", () => {
    const overrides = { accessibility: { "mattstack:stage-evidence": { forge: "" } } };
    expect(stageRoster(pipelines, overrides, defaults)).toEqual(base);
  });

  test("an override that changes a fill adds a copy for that pipeline", () => {
    const overrides = { accessibility: { "mattstack:stage-evidence": { domain: "acme:b" } } };
    expect(stageRoster(pipelines, overrides, defaults)).toEqual([
      ...base,
      { name: "stage-evidence--accessibility", engine: "stage-evidence", description: "", pipeline: "accessibility" },
    ]);
  });

  test("empty override unbinds in the copy only", () => {
    const overrides = { accessibility: { "mattstack:stage-evidence": { domain: "" } } };
    expect(stageRoster(pipelines, overrides, defaults)).toEqual([
      ...base,
      { name: "stage-evidence--accessibility", engine: "stage-evidence", description: "", pipeline: "accessibility" },
    ]);
    expect(effectiveSlotBindings(defaults, overrides.accessibility, "mattstack:stage-evidence")).toEqual({ domain: "" });
    expect(effectiveSlotBindings(defaults, undefined, "mattstack:stage-evidence")).toEqual({ domain: "acme:a" });
  });

  test("a pipeline name that is not a skill name throws when it carries an override", () => {
    const overrides = { "../x": { "mattstack:stage-evidence": { domain: "acme:b" } } };
    expect(() => stageRoster({ ...pipelines, "../x": ["mattstack:stage-evidence"] }, overrides, defaults))
      .toThrow('pipeline "../x" must match [a-z][a-z0-9-]*');
  });

  test("-- in an override-carrying pipeline is refused", () => {
    const overrides = { "a--b": { "mattstack:stage-evidence": { domain: "acme:b" } } };
    expect(() => stageRoster({ ...pipelines, "a--b": ["mattstack:stage-evidence"] }, overrides, defaults))
      .toThrow('pipeline "a--b" must not contain "--"');
  });

  test("a plain-list pipeline with -- is not name-checked", () => {
    expect(stageRoster({ ...pipelines, "a--b": ["mattstack:stage-evidence"] }, {}, defaults)).toEqual(base);
  });
});

describe("stageRoster path-breakout guard", () => {
  test("rejects a \"..\" stage name naming the offending pipeline entry", () => {
    expect(() => stageRoster({ feature: ["mattstack:../../victim"] }, {}, {})).toThrow(/\.\.\/victim/);
  });

  test("rejects a \"/\" stage name", () => {
    expect(() => stageRoster({ feature: ["mattstack:a/b"] }, {}, {})).toThrow(/not a safe directory name/);
  });

  test("rejects a \"\\\\\" stage name", () => {
    expect(() => stageRoster({ feature: ["mattstack:a\\b"] }, {}, {})).toThrow(/not a safe directory name/);
  });
});

describe("parseStageQualifiedName", () => {
  test("splits on the first colon, bare names pass through unchanged", () => {
    expect(parseStageQualifiedName("mattstack:stage-plan", "x")).toBe("stage-plan");
    expect(parseStageQualifiedName("stage-plan", "x")).toBe("stage-plan");
  });

  test("names the qualified entry and the caller-supplied context on rejection", () => {
    expect(() => parseStageQualifiedName("mattstack:../../victim", 'pipeline "feature"')).toThrow(
      'pipeline "feature": stage "mattstack:../../victim" resolves to name "../../victim" which is not a safe directory name',
    );
  });

  test("rejects a name that resolves to empty", () => {
    expect(() => parseStageQualifiedName("mattstack:", "x")).toThrow(
      'x: stage "mattstack:" resolves to name "" which is not a safe directory name',
    );
  });

  test("rejects a name that resolves to the current-dir alias", () => {
    expect(() => parseStageQualifiedName("mattstack:.", "x")).toThrow(
      'x: stage "mattstack:." resolves to name "." which is not a safe directory name',
    );
  });
});

describe("loadInclude", () => {
  const roots = () => {
    const root = mkdtempSync(join(tmpdir(), "rt-inc-"));
    return { root, roots: { byName: { mattstack: { dir: root, version: "1.0.0" } }, list: [] } };
  };
  const write = (root: string, name: string, md: string) => {
    mkdirSync(join(root, "attachments", name), { recursive: true });
    writeFileSync(join(root, "attachments", name, "SKILL.md"), md);
  };

  test("loads a slotless attachment with empty provides", () => {
    const { root, roots: r } = roots();
    write(root, "review-core-body", "---\nname: review-core-body\ndescription: d\n---\n\nthe body");
    const inc = loadInclude("review-core-body", r);
    expect(inc.body).toBe("the body");
    expect(inc.provides).toBe("");
    expect(inc.srcPath).toBe("attachments/review-core-body/SKILL.md");
  });

  test("rejects a target that declares slots", () => {
    const { root, roots: r } = roots();
    write(root, "bad", "---\nname: bad\ndescription: d\nslots:\n  x: { contract: x@1 }\n---\n\nbody");
    expect(() => loadInclude("bad", r)).toThrow('include "bad" declares slots; an include target must be slotless');
  });

  test("rejects a target that contains a placeholder", () => {
    const { root, roots: r } = roots();
    write(root, "bad2", "---\nname: bad2\ndescription: d\n---\n\nbody {{slot:x}}");
    expect(() => loadInclude("bad2", r)).toThrow('include "bad2" contains a placeholder; an include target must be inert');
  });

  test("rejects an include name that tries to escape attachments/, never reading the escaped file", () => {
    const { root, roots: r } = roots();
    mkdirSync(join(root, "escape"), { recursive: true });
    writeFileSync(join(root, "escape", "SKILL.md"), "---\nname: escape\ndescription: d\n---\n\nvictim");
    expect(() => loadInclude("../escape", r)).toThrow(
      'loadInclude: include "../escape" is not a safe directory name (must not contain "/", "\\", or "..", or be empty or ".")',
    );
  });
});

describe("installedVersionFor", () => {
  test("installedVersionFor reads the version of the matching installed id", () => {
    const install = realpathSync(mkdtempSync(join(tmpdir(), "rt-installed-")));
    mkdirSync(join(install, ".claude-plugin"), { recursive: true });
    writeFileSync(join(install, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "0.5.2" }));
    const list = [{ id: "acme@beacon", installPath: install }];
    expect(installedVersionFor(list, "acme@beacon")).toBe("0.5.2");
    expect(installedVersionFor(list, "acme@other")).toBeNull();
    expect(installedVersionFor([{ id: "acme@beacon", installPath: join(install, "gone") }], "acme@beacon")).toBeNull();
  });

  test("buildPluginRoots preserves the raw entry list", () => {
    const install = realpathSync(mkdtempSync(join(tmpdir(), "rt-roots-list-")));
    mkdirSync(join(install, ".claude-plugin"), { recursive: true });
    writeFileSync(join(install, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
    const roots = buildPluginRoots([{ id: "acme@beacon", installPath: install }]);
    expect(roots.list).toEqual([{ id: "acme@beacon", installPath: install }]);
  });
});

describe("org base pack roots", () => {
  function makeRoot(): { root: string; base: string } {
    const root = mkdtempSync(join(tmpdir(), "rt-sources-org-"));
    const base = join(root, "orgs", "acme", "mattstack", "org", "packs", "acme-base");
    mkdirSync(join(base, "pack"), { recursive: true });
    writeFileSync(join(root, "orgs", "acme", "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme" }));
    writeFileSync(join(base, "pack", "skills.jsonc"), `{ "base": true }`);
    mkdirSync(join(base, "attachments", "ci-forge"), { recursive: true });
    writeFileSync(join(base, "attachments", "ci-forge", "SKILL.md"), "---\nname: ci-forge\nmetadata:\n  provides: forge\n---\nUse the forge.\n");
    return { root, base };
  }

  test("each org base pack is a root named after its folder", () => {
    const { root, base } = makeRoot();
    expect(orgBasePackRoots(join(root, "orgs", "acme"))).toEqual([{ name: "acme-base", dir: realpathSync(base), version: "org", baseVersion: null }]);
    expect(orgBasePackRoots(join(root, "nope", "orgs", "acme"))).toEqual([]);
  });

  test("a base root carries its plugin.json version beside the org token", () => {
    const { root, base } = makeRoot();
    mkdirSync(join(base, ".claude-plugin"), { recursive: true });
    writeFileSync(join(base, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "0.1.0" }));
    expect(orgBasePackRoots(join(root, "orgs", "acme"))).toEqual([{ name: "acme-base", dir: realpathSync(base), version: "org", baseVersion: "0.1.0" }]);
  });

  test("a base whose plugin.json has an empty version has a null baseVersion", () => {
    const { root, base } = makeRoot();
    mkdirSync(join(base, ".claude-plugin"), { recursive: true });
    writeFileSync(join(base, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "" }));
    expect(orgBasePackRoots(join(root, "orgs", "acme"))[0]?.baseVersion).toBeNull();
  });

  test("only the named org's bases are roots", () => {
    const { root } = makeRoot();
    const other = join(root, "orgs", "gadgets", "mattstack");
    mkdirSync(join(other, "org", "packs", "gadgets-base", "pack"), { recursive: true });
    writeFileSync(join(other, "mattstack.jsonc"), JSON.stringify({ role: "org", org: "gadgets" }));
    writeFileSync(join(other, "org", "packs", "gadgets-base", "pack", "skills.jsonc"), `{ "base": true }`);
    expect(orgBasePackRoots(join(root, "orgs", "acme")).map((r) => r.name)).toEqual(["acme-base"]);
    expect(orgBasePackRoots(join(root, "orgs", "gadgets")).map((r) => r.name)).toEqual(["gadgets-base"]);
  });

  test("a clone that is not marked as an org has no roots", () => {
    const { root } = makeRoot();
    writeFileSync(join(root, "orgs", "acme", "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "team" }));
    expect(orgBasePackRoots(join(root, "orgs", "acme"))).toEqual([]);
  });

  test("a folder whose fragment is not marked base is not a root", () => {
    const { root, base } = makeRoot();
    writeFileSync(join(base, "pack", "skills.jsonc"), `{}`);
    expect(orgBasePackRoots(join(root, "orgs", "acme"))).toEqual([]);
  });

  test("orgOfPackDir names the org of a pack inside an org clone and nothing else", () => {
    const { root, base } = makeRoot();
    const teamPack = join(root, "orgs", "acme", "mattstack", "teams", "widgets", "plugin");
    mkdirSync(teamPack, { recursive: true });
    const elsewhere = mkdtempSync(join(tmpdir(), "rt-sources-elsewhere-"));
    const clone = realpathSync(join(root, "orgs", "acme"));
    expect(orgOfPackDir(teamPack)).toEqual({ org: "acme", root: clone });
    expect(orgOfPackDir(base)).toEqual({ org: "acme", root: clone });
    expect(orgOfPackDir(elsewhere)).toBeNull();
    expect(orgOfPackDir(join(root, "nope"))).toBeNull();
  });

  test("orgOfPackDir finds the org repo from a copy of it outside teams/", () => {
    const { root } = makeRoot();
    const copy = join(mkdtempSync(join(tmpdir(), "rt-sources-worktree-")), "acme-wt");
    cpSync(join(root, "orgs", "acme"), copy, { recursive: true });
    const teamPack = join(copy, "mattstack", "teams", "widgets", "plugin");
    mkdirSync(teamPack, { recursive: true });
    expect(orgOfPackDir(teamPack)).toEqual({ org: "acme", root: realpathSync(copy) });
    expect(orgBasePackRoots(copy).map((r) => r.name)).toEqual(["acme-base"]);
  });

  test("org marker slugs use the org domain, while pack names keep the team domain", () => {
    const { root } = makeRoot();
    const clone = join(root, "orgs", "acme");
    const pack = join(clone, "mattstack", "teams", "team-1acme", "plugin");
    mkdirSync(pack, { recursive: true });
    const marker = join(clone, "mattstack", "mattstack.jsonc");
    writeFileSync(marker, JSON.stringify({ role: "org", org: "1acme" }));
    expect(orgOfPackDir(pack)).toEqual({ org: "1acme", root: realpathSync(clone) });
    for (const org of ["../acme", "a/b", "a\\b", "", "Upper", "a".repeat(41)]) {
      writeFileSync(marker, JSON.stringify({ role: "org", org }));
      expect(orgOfPackDir(pack)).toBeNull();
    }
  });

  test("orgOfPackDir never looks above HOME for a marker", () => {
    const outer = realpathSync(mkdtempSync(join(tmpdir(), "rt-sources-above-home-")));
    mkdirSync(join(outer, "mattstack"), { recursive: true });
    writeFileSync(join(outer, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme" }));
    const home = join(outer, "home");
    const pack = join(home, "work", "packs", "widgets");
    mkdirSync(pack, { recursive: true });
    const savedHome = process.env.HOME;
    process.env.HOME = home;
    try {
      expect(orgOfPackDir(pack)).toBeNull();
      expect(orgOfPackDir(join(outer, "elsewhere-is-missing"))).toBeNull();
      mkdirSync(join(outer, "beside"), { recursive: true });
      expect(orgOfPackDir(join(outer, "beside"))).toEqual({ org: "acme", root: outer });
    } finally {
      process.env.HOME = savedHome;
    }
  });

  test("orgOfPackDir stops at the nearest marker, and refuses one that is not a valid org", () => {
    const { root } = makeRoot();
    const nested = join(root, "orgs", "acme", "mattstack", "teams", "widgets", "vendor");
    mkdirSync(join(nested, "mattstack"), { recursive: true });
    writeFileSync(join(nested, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "team" }));
    expect(orgOfPackDir(join(nested, "mattstack"))).toBeNull();
    writeFileSync(join(root, "orgs", "acme", "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "../evil" }));
    expect(orgOfPackDir(join(root, "orgs", "acme", "mattstack", "org"))).toBeNull();
    writeFileSync(join(root, "orgs", "acme", "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org" }));
    expect(orgOfPackDir(join(root, "orgs", "acme", "mattstack", "org"))).toBeNull();
  });

  test("a folder that is not a valid pack name is not a root", () => {
    const { root } = makeRoot();
    const odd = join(root, "orgs", "acme", "mattstack", "org", "packs", "Bad_Name");
    mkdirSync(join(odd, "pack"), { recursive: true });
    writeFileSync(join(odd, "pack", "skills.jsonc"), `{ "base": true }`);
    expect(orgBasePackRoots(join(root, "orgs", "acme")).map((r) => r.name)).toEqual(["acme-base"]);
  });

  test("a fill under a base pack's attachments loads from the org folder", () => {
    const { base } = makeRoot();
    const roots: PluginRoots = { byName: { "acme-base": { dir: base, version: "org" } }, list: [], folderOnly: new Set(["acme-base"]) };
    const fill = loadAttachment("acme-base:ci-forge", "forge", roots);
    expect(fill).toMatchObject({ plugin: "acme-base", version: "org", registered: false, provides: "forge" });
  });

  test("loading a fill records a frontmatter team marker with its file line and refuses nothing, so only an emitted fill stops compile", () => {
    const { base } = makeRoot();
    mkdirSync(join(base, "attachments", "notes"), { recursive: true });
    writeFileSync(join(base, "attachments", "notes", "SKILL.md"), "---\nname: notes\ndescription: for {{team.linear-team}}\nmetadata:\n  provides: notes\n---\nbody\n");
    const roots: PluginRoots = { byName: { "acme-base": { dir: base, version: "org" } }, list: [], folderOnly: new Set(["acme-base"]) };
    const fill = loadAttachment("acme-base:notes", "notes", roots);
    expect(fill.frontmatterTeamMarker).toEqual({ raw: "{{team.linear-team}}", line: 3 });
    expect(fill.body).toBe("body");
    expect(loadAttachment("acme-base:ci-forge", "forge", roots).frontmatterTeamMarker).toBeUndefined();
  });

  test("a fill under a base pack's skills is refused: nothing installs the base, so it could never be invoked", () => {
    const { base } = makeRoot();
    mkdirSync(join(base, "skills", "watch"), { recursive: true });
    writeFileSync(join(base, "skills", "watch", "SKILL.md"), "---\nname: watch\nmetadata:\n  provides: forge\n---\nbody\n");
    const roots: PluginRoots = { byName: { "acme-base": { dir: base, version: "org" } }, list: [], folderOnly: new Set(["acme-base"]) };
    expect(() => loadAttachment("acme-base:watch", "forge", roots)).toThrow(/move it under attachments\//);
  });
});

describe("block-tree loaders", () => {
  const BLOCKS_MATTSTACK = join(import.meta.dir, "fixtures", "blocks", "plugins", "mattstack");

  function blockRoots(): { dir: string; roots: PluginRoots } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-blocks-")));
    cpSync(BLOCKS_MATTSTACK, dir, { recursive: true });
    return { dir, roots: { byName: { mattstack: { dir, version: "1.0.0" } }, list: [] } };
  }

  test("loadStepSource reads an engine folder holding index.block.md as a tree", () => {
    const { dir, roots } = blockRoots();
    writeFile(join(dir, "attachments", "pipeline", "mini", "scripts", "go.sh"), "echo go\n");

    const step = loadStepSource("mini", roots);

    expect(step.tree?.root.id).toBe("mini");
    expect(step.tree?.byId.has("mini/run/check")).toBe(true);
    expect(step.body).toBe("");
    expect(step.slots).toEqual({});
    expect(step.description).toBe("A small pipeline step used to test block trees");
    expect(step.srcPath).toBe(join("attachments", "pipeline", "mini", "index.block.md"));
    expect(step.bodyStartLine).toBe(11);
    expect(step.stepFiles).toEqual(["scripts/go.sh"]);
  });

  test("only the root SKILL.md is kept from vendoring; one in a plain sub-folder ships", () => {
    const { dir, roots } = blockRoots();
    writeFile(join(dir, "attachments", "pipeline", "mini", "references", "SKILL.md"), "a reference page\n");

    expect(loadStepSource("mini", roots).stepFiles).toEqual(["references/SKILL.md"]);
  });

  test("loadStepSource refuses a block root that is not typed pipeline-step", () => {
    const { dir, roots } = blockRoots();
    const index = join(dir, "attachments", "pipeline", "mini", "index.block.md");
    writeFileSync(index, readFileSync(index, "utf8").replace("type: pipeline-step\n", ""));

    expect(() => loadStepSource("mini", roots)).toThrow(`loadStepSource: "${index}" is not typed "type: pipeline-step"`);
  });

  test("loadInclude reads attachments/<name>/index.block.md as a tree whose block files are not vendored", () => {
    const { dir, roots } = blockRoots();
    writeFile(join(dir, "attachments", "gate-protocol", "index.block.md"), "---\n---\n\n# Gate protocol\n\nAsk once.\n");
    writeFile(join(dir, "attachments", "gate-protocol", "late.block.md"), "---\n---\n\n# Late\n\nLate text.\n");
    writeFile(join(dir, "attachments", "gate-protocol", "scripts", "gate.sh"), "echo gate\n");

    const inc = loadInclude("gate-protocol", roots);

    expect(inc.tree?.root.id).toBe("gate-protocol");
    expect(inc.tree?.root.relPath).toBe("attachments/gate-protocol/index.block.md");
    expect(inc.body).toBe("");
    expect(inc.binding).toBe("mattstack:gate-protocol");
    expect(inc.extraFiles).toEqual(["scripts/gate.sh"]);
  });

  test("a SKILL.md beside index.block.md is refused at that SKILL.md, for an engine and an include", () => {
    const { dir, roots } = blockRoots();
    writeFile(join(dir, "attachments", "pipeline", "mini", "SKILL.md"), "---\nname: mini\ntype: pipeline-step\n---\n\n{{slot:x}}\n");
    writeFile(join(dir, "attachments", "gate-protocol", "index.block.md"), "---\n---\n\n# Gate protocol\n");
    writeFile(join(dir, "attachments", "gate-protocol", "SKILL.md"), "---\nname: gate-protocol\n---\n\nold\n");

    const refusal = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(BlockError);
        return (err as BlockError).diagnostics;
      }
      throw new Error("expected a refusal");
    };
    const message = "the block tree in index.block.md replaces this SKILL.md; delete it";
    expect(refusal(() => loadStepSource("mini", roots))).toEqual([{ file: "attachments/pipeline/mini/SKILL.md", line: 1, col: 1, code: "bad-value", message }]);
    expect(refusal(() => loadInclude("gate-protocol", roots))).toEqual([{ file: "attachments/gate-protocol/SKILL.md", line: 1, col: 1, code: "bad-value", message }]);
  });

  test("a flat include keeps no tree", () => {
    const { roots } = blockRoots();
    expect(loadInclude("style-floor", roots).tree).toBeUndefined();
  });
});

describe("AttachmentLoadError", () => {
  const LINT_SKILL_MD = `---\nname: lint\ndescription: "lint rules"\nmetadata:\n  provides: ship-domain@1\n---\n`;

  function thrown(fn: () => unknown): { code: string; message: string } {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(AttachmentLoadError);
      return { code: (err as AttachmentLoadError).code, message: (err as Error).message };
    }
    throw new Error("expected a throw");
  }

  function roots(skillMd = LINT_SKILL_MD): PluginRoots {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-loaderr-")));
    writeFile(join(dir, "attachments", "lint", "SKILL.md"), skillMd);
    writeFile(join(dir, "attachments", "lint", "fast.md"), "the fast rules\n");
    writeFile(join(dir, "attachments", "bare", "SKILL.md"), "---\nname: bare\n---\n\nbody\n");
    return { byName: { w: { dir, version: "0.1.0" } }, list: [] };
  }

  test("a value that is not there is fill-missing", () => {
    expect(thrown(() => loadAttachment("w:nope", "rules", roots())).code).toBe("fill-missing");
    expect(thrown(() => loadAttachment("w:lint/slow", "rules", roots())).code).toBe("fill-missing");
    expect(thrown(() => loadAttachment("x:lint", "rules", roots())).code).toBe("fill-missing");
  });

  test("a malformed or unusable value is bad-value, with today's messages", () => {
    expect(thrown(() => loadAttachment("w:lint/a/b", "rules", roots()))).toEqual({
      code: "bad-value",
      message: 'loadAttachment: slot "rules": binding "w:lint/a/b" is not "<plugin>:<skill>" or "<plugin>:<skill>/<file>"',
    });
    expect(thrown(() => loadAttachment("w:lint/fast", "rules", roots(`${LINT_SKILL_MD}\ntext\n`))).code).toBe("bad-value");
    const bare = thrown(() => loadAttachment("w:bare", "rules", roots()));
    expect(bare.code).toBe("bad-value");
    expect(bare.message).toMatch(/has no metadata\.provides$/);
  });
});
