import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { newTeamContext } from "../team-params.ts";
import type { AttachmentSource, CompiledFile, VerbDef } from "../types.ts";
import { compileOneBlock as compile, oneBlockEngine as engine } from "./helpers.ts";

/** The sibling-reference lint reads the working tree, so its cases need a real pack root on disk. */
function tempPackRoot(): string {
  return mkdtempSync(join(tmpdir(), "rt-compile-pack-"));
}

const verb: VerbDef = {
  name: "watch-ci",
  engine: "watch-ci-engine",
  description: "Watch CI until it goes green",
};

const step = engine(
  "Poll the pipeline every 30s and report status. See ${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh for the poller.\n\n{{props.domain}}\n\n{{props.forge}}",
  {
    props: { domain: { contract: "watch-ci-domain@1", required: true }, forge: { contract: "ci-forge@1", required: true } },
    allowedTools: ["Bash(gh:*)", "Read"],
    stepFiles: ["references/polling-notes.md", "scripts/ci-watch.sh"],
  },
);

/** A propless engine with `text` as its whole body, the shape the lint cases need. */
const bare = (text: string) => engine(text, { stepFiles: ["references/polling-notes.md", "scripts/ci-watch.sh"] });

const domainFill: AttachmentSource = {
  binding: "acme:watch-ci-domain",
  plugin: "acme",
  version: "0.3.0",
  dir: "/plugins/acme/attachments/watch-ci-domain",
  srcPath: "attachments/watch-ci-domain/SKILL.md",
  bodyStartLine: 8,
  body: "Domain rules live at ${CLAUDE_SKILL_DIR}/ci-config.json for details.",
  provides: "watch-ci-domain@1",
  allowedTools: ["Read(${CLAUDE_SKILL_DIR}/ci-config.json)"],
  extraFiles: ["ci-config.json"],
  registered: false,
  file: null,
};

const forgeFill: AttachmentSource = {
  binding: "mattstack:gitlab-forge",
  plugin: "mattstack",
  version: "1.2.0",
  dir: "/plugins/mattstack/skills/gitlab-forge",
  srcPath: "skills/gitlab-forge/SKILL.md",
  bodyStartLine: 8,
  body: "Talk to GitLab via glab.",
  provides: "ci-forge@1",
  allowedTools: ["Bash(glab:*)", "Read"],
  extraFiles: [],
  registered: false,
  file: null,
};

const registeredForgeFill: AttachmentSource = {
  binding: "mattstack:gitlab-forge",
  plugin: "mattstack",
  version: "1.2.0",
  dir: "/plugins/mattstack/skills/gitlab-forge",
  srcPath: "skills/gitlab-forge/SKILL.md",
  bodyStartLine: 8,
  body: "Talk to GitLab via glab.",
  provides: "ci-forge@1",
  allowedTools: ["Bash(glab:*)", "Read(${CLAUDE_SKILL_DIR}/token.txt)"],
  extraFiles: ["token.txt"],
  registered: true,
  file: null,
};

const roster = new Set(["mattstack:watch-ci", "acme:watch-ci-domain", "mattstack:gitlab-forge"]);

function skillFileContent(files: CompiledFile[]): string {
  const skillFile = files[0];
  if (!skillFile || !("content" in skillFile)) {
    throw new Error("expected files[0] to be a content file");
  }
  return skillFile.content;
}

function toolLinesBetween(content: string): string[] {
  const match = content.match(/allowed-tools:\n([\s\S]*?)\nmetadata:/);
  if (!match) {
    throw new Error("allowed-tools block not found");
  }
  return (match[1] as string).split("\n").map((line) => line.trim());
}

describe("compileBlockSkill", () => {
  test("both props bound: frontmatter, allowed-tools union, seams, body rewrite", () => {
    const result = compile(verb, step, { domain: domainFill, forge: forgeFill }, roster);

    expect(result.warnings).toEqual([]);

    const skillFile = result.files[0];
    expect(skillFile?.path).toBe("SKILL.md");
    const content = skillFileContent(result.files);

    expect(content).toContain('name: "watch-ci"');
    expect(content).toContain('description: "Watch CI until it goes green"');
    expect(content).toContain(
      'metadata:\n  compiled: "mattstack@1.2.0 + acme:watch-ci-domain@0.3.0 + mattstack:gitlab-forge@1.2.0"',
    );

    expect(toolLinesBetween(content)).toEqual([
      '- "Bash(gh:*)"',
      '- "Read"',
      '- "Read(${CLAUDE_SKILL_DIR}/parts/domain/ci-config.json)"',
      '- "Bash(glab:*)"',
    ]);

    expect(content).toContain(
      "<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->",
    );
    expect(content).toMatch(/<!-- part: block:watch-ci source=mattstack:watch-ci version=1\.2\.0 path=skills\/pipeline\/watch-ci\/index\.block\.md lines=\d+-\d+ -->/);
    expect(content).toContain(
      "<!-- part: prop:watch-ci.domain binding=acme:watch-ci-domain version=0.3.0 path=attachments/watch-ci-domain/SKILL.md lines=8-8 -->",
    );
    expect(content).toContain(
      "<!-- part: prop:watch-ci.forge binding=mattstack:gitlab-forge version=1.2.0 path=skills/gitlab-forge/SKILL.md lines=8-8 -->",
    );

    expect(content).toContain(
      "Domain rules live at ${CLAUDE_SKILL_DIR}/parts/domain/ci-config.json for details.",
    );
    expect(content).toContain(
      "Poll the pipeline every 30s and report status. See ${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh for the poller.",
    );
  });

  test("an inlined fill's own {{include}} is expanded", () => {
    const ciNoteInclude: AttachmentSource = {
      binding: "mattstack:ci-note",
      plugin: "mattstack",
      version: "1.0.0",
      dir: "/plugins/mattstack/attachments/ci-note",
      srcPath: "attachments/ci-note/SKILL.md",
      bodyStartLine: 4,
      body: "ci note body",
      provides: "",
      allowedTools: [],
      extraFiles: [],
      registered: false,
      file: null,
    };
    const domainWithInclude: AttachmentSource = {
      ...domainFill,
      body: "Domain rules live at ${CLAUDE_SKILL_DIR}/ci-config.json for details.\n{{include:ci-note}}\n",
    };

    const result = compile(verb, step, { domain: domainWithInclude, forge: forgeFill }, roster, {
      includes: { "ci-note": ciNoteInclude },
    });
    const content = skillFileContent(result.files);

    expect(content).toContain("<!-- part: include:ci-note");
    expect(content).toContain("ci note body");
    expect(content).not.toContain("{{");
  });

  test("a base fill's team markers resolve", () => {
    const baseDomain: AttachmentSource = { ...domainFill, binding: "acme-base:watch-ci-domain", plugin: "acme-base", body: "Team {{team.linear-team}}" };
    const team = newTeamContext({ plugin: "widgets", version: "0.4.0", params: { "linear-team": "Widgets" }, sections: {} }, new Set(["acme-base"]));

    const content = skillFileContent(compile(verb, step, { domain: baseDomain, forge: forgeFill }, roster, { team }).files);

    expect(content).toContain("Team Widgets");
    expect(content).not.toContain("{{");
  });

  test("a team marker in a non-base fill is an error naming the file line", () => {
    const widgetsDomain: AttachmentSource = { ...domainFill, binding: "widgets:x", plugin: "widgets", body: "a\nTeam {{team.linear-team}}" };
    const team = newTeamContext({ plugin: "widgets", version: "0.4.0", params: {}, sections: {} }, new Set(["acme-base"]));

    expect(() => compile(verb, step, { domain: widgetsDomain, forge: forgeFill }, roster, { team })).toThrow(
      "widgets:x: {{team.linear-team}} -- team markers only resolve in base pack text (line 9)",
    );
  });

  test("a team marker in a base fill's allowed-tools is an error", () => {
    const baseDomain: AttachmentSource = { ...domainFill, binding: "acme-base:watch-ci-domain", plugin: "acme-base", allowedTools: ["Bash({{team.x}}:*)"] };
    const team = newTeamContext({ plugin: "widgets", version: "0.4.0", params: { x: "y" }, sections: {} }, new Set(["acme-base"]));

    expect(() => compile(verb, step, { domain: baseDomain, forge: forgeFill }, roster, { team })).toThrow(
      "acme-base:watch-ci-domain: {{team.x}} -- team markers only resolve in a body, not frontmatter",
    );
  });

  describe("a team marker in a fill's description", () => {
    const team = newTeamContext({ plugin: "widgets", version: "0.4.0", params: { x: "y" }, sections: {} }, new Set(["acme-base"]));
    const marker = { raw: "{{team.x}}", line: 3 };

    test("compiles when the fill is bound by reference, since only its allowed-tools are copied", () => {
      const forge: AttachmentSource = { ...registeredForgeFill, binding: "acme-base:gitlab-forge", plugin: "acme-base", frontmatterTeamMarker: marker };
      const refRoster = new Set([...roster, "acme-base:gitlab-forge"]);

      const content = skillFileContent(compile(verb, step, { domain: domainFill, forge }, refRoster, { team }).files);

      expect(content).toContain("Prop forge is bound to `acme-base:gitlab-forge`");
    });

    test("refuses when an inlined base fill carries it", () => {
      const domain: AttachmentSource = { ...domainFill, binding: "acme-base:watch-ci-domain", plugin: "acme-base", frontmatterTeamMarker: marker };

      expect(() => compile(verb, step, { domain, forge: forgeFill }, roster, { team })).toThrow(
        "acme-base:watch-ci-domain: {{team.x}} -- team markers only resolve in a body, not frontmatter (line 3)",
      );
    });

    test("a reference-bound fill with one in allowed-tools still refuses", () => {
      const forge: AttachmentSource = { ...registeredForgeFill, binding: "acme-base:gitlab-forge", plugin: "acme-base", allowedTools: ["Bash({{team.x}}:*)"] };
      const refRoster = new Set([...roster, "acme-base:gitlab-forge"]);

      expect(() => compile(verb, step, { domain: domainFill, forge }, refRoster, { team })).toThrow(
        "acme-base:gitlab-forge: {{team.x}} -- team markers only resolve in a body, not frontmatter",
      );
    });
  });

  describe("a base fill's vendored files", () => {
    const vendoring = (text: string) => {
      const dir = tempPackRoot();
      writeFileSync(join(dir, "checklist.md"), text);
      const fill: AttachmentSource = { ...domainFill, binding: "acme-base:provision-flow", plugin: "acme-base", dir, body: "Read the checklist.", allowedTools: [], extraFiles: ["checklist.md"] };
      return fill;
    };
    const team = newTeamContext({ plugin: "widgets", version: "0.4.0", params: { "linear-team": "Widgets" }, sections: {} }, new Set(["acme-base"]));

    test("a team marker in one is refused with the file line", () => {
      const fill = vendoring("# Checklist\n\nFile it in {{team.linear-team}}.\n");
      expect(() => compile(verb, step, { domain: fill, forge: forgeFill }, roster, { team })).toThrow(
        "acme-base:provision-flow:checklist.md: {{team.linear-team}} -- team markers only resolve in a fill's SKILL.md, not the files it vendors (line 3)",
      );
    });

    test("with no team context the same file is refused", () => {
      const fill = vendoring("File it in {{team.linear-team}}.\n");
      expect(() => compile(verb, step, { domain: fill, forge: forgeFill }, roster)).toThrow(
        "acme-base:provision-flow:checklist.md: {{team.linear-team}} -- team markers only resolve in a fill's SKILL.md, not the files it vendors (line 1)",
      );
    });

    test("a file with no marker, and a team pack's own fill, still vendor", () => {
      const clean = vendoring("Nothing to fill.\n");
      expect(compile(verb, step, { domain: clean, forge: forgeFill }, roster, { team }).files.map((f) => f.path)).toContain("parts/domain/checklist.md");
      const own = { ...vendoring("Docs mention {{team.x}}.\n"), binding: "widgets:provision-flow", plugin: "widgets" };
      expect(compile(verb, step, { domain: own, forge: forgeFill }, roster, { team }).files.map((f) => f.path)).toContain("parts/domain/checklist.md");
    });
  });

  test("a fill carrying an old {{slot:...}} marker is a compile error naming the fill", () => {
    const domainWithSlot: AttachmentSource = {
      ...domainFill,
      body: "Domain rules.\n{{slot:tiering}}\n",
    };

    expect(() => compile(verb, step, { domain: domainWithSlot, forge: forgeFill }, roster)).toThrow(
      'acme:watch-ci-domain: {{slot:tiering}} -- a fill may carry {{include}}, {{verb.path}} or {{pack.path}} only (line 2)',
    );
  });

  test("vendoring: stepFiles and extraFiles map to exact copyFrom paths", () => {
    const result = compile(verb, step, { domain: domainFill, forge: forgeFill }, roster);

    expect(result.files).toContainEqual({
      path: "scripts/ci-watch.sh",
      copyFrom: "/plugins/mattstack/skills/pipeline/watch-ci/scripts/ci-watch.sh",
    });
    expect(result.files).toContainEqual({
      path: "references/polling-notes.md",
      copyFrom: "/plugins/mattstack/skills/pipeline/watch-ci/references/polling-notes.md",
    });
    expect(result.files).toContainEqual({
      path: "parts/domain/ci-config.json",
      copyFrom: "/plugins/acme/attachments/watch-ci-domain/ci-config.json",
    });
    expect(result.files.some((f) => f.path.startsWith("parts/forge/"))).toBe(false);
  });

  test("registered fill: reference line only, no fill body, but still vendors extraFiles and joins allowed-tools", () => {
    const result = compile(
      verb,
      step,
      { domain: domainFill, forge: registeredForgeFill },
      roster,
    );

    expect(result.warnings).toEqual([]);

    const content = skillFileContent(result.files);

    expect(content).toContain(
      "Prop forge is bound to `mattstack:gitlab-forge` (mattstack:gitlab-forge@1.2.0) -- invoke that skill when this flow needs it.",
    );
    expect(content).not.toContain("Talk to GitLab via glab.");

    expect(result.files).toContainEqual({
      path: "parts/forge/token.txt",
      copyFrom: "/plugins/mattstack/skills/gitlab-forge/token.txt",
    });

    expect(toolLinesBetween(content)).toEqual([
      '- "Bash(gh:*)"',
      '- "Read"',
      '- "Read(${CLAUDE_SKILL_DIR}/parts/domain/ci-config.json)"',
      '- "Bash(glab:*)"',
      '- "Read(${CLAUDE_SKILL_DIR}/parts/forge/token.txt)"',
    ]);

    expect(content).toContain(
      'metadata:\n  compiled: "mattstack@1.2.0 + acme:watch-ci-domain@0.3.0 + mattstack:gitlab-forge@1.2.0"',
    );
  });

  test("name lint: unregistered token warns, roster member does not", () => {
    const lintRoster = new Set(["mattstack:watch-ci", "acme:watch-ci-domain"]);

    const result = compile(verb, engine("This step defers domain judgment to acme:watch-ci-domain and never invokes acme:nonexistent."), {}, lintRoster);

    expect(result.warnings).toEqual([
      "body references acme:nonexistent which is not invocable",
    ]);
  });

  test("name lint: a bound fill's own seam comment does not warn even when its binding is unregistered", () => {
    const rosterWithoutDomain = new Set(["mattstack:watch-ci", "mattstack:gitlab-forge"]);

    const result = compile(verb, step, { domain: domainFill, forge: forgeFill }, rosterWithoutDomain);

    expect(result.warnings).toEqual([]);
  });

  test("name lint: the same binding name in author body prose still warns", () => {
    const rosterWithoutDomain = new Set(["mattstack:watch-ci", "mattstack:gitlab-forge"]);
    const mentioning = engine("This step composes with acme:watch-ci-domain for domain rules.\n\n{{props.domain}}", {
      props: { domain: { contract: "watch-ci-domain@1" } },
    });

    const result = compile(verb, mentioning, { domain: domainFill }, rosterWithoutDomain);

    expect(result.warnings).toEqual([
      "body references acme:watch-ci-domain which is not invocable",
    ]);
  });

  test("path lint: vendored file reference is clean, missing file reference warns", () => {
    const withMissingRef = engine(
      "See ${CLAUDE_SKILL_DIR}/parts/domain/ci-config.json and ${CLAUDE_SKILL_DIR}/parts/domain/missing.json for details.\n\n{{props.domain}}",
      { props: { domain: { contract: "watch-ci-domain@1" } } },
    );

    const result = compile(verb, withMissingRef, { domain: domainFill }, roster);

    expect(result.warnings).toEqual([
      "body references ${CLAUDE_SKILL_DIR}/parts/domain/missing.json which is not an emitted file",
    ]);
  });

  test("empty allowed-tools union omits the key entirely", () => {
    const bareVerb: VerbDef = {
      name: "self-review",
      engine: "self-review",
      description: "Review your own change",
    };

    const result = compile(bareVerb, engine("Review your own diff before shipping.", { name: "self-review" }), {}, roster);

    expect(result.warnings).toEqual([]);
    const content = skillFileContent(result.files);
    expect(content).not.toContain("allowed-tools");
    expect(content).toContain('description: "Review your own change"\nmetadata:');
  });

  test("determinism: structurally equal inputs produce identical content", () => {
    const verbCopy: VerbDef = JSON.parse(JSON.stringify(verb));
    const domainFillCopy: AttachmentSource = JSON.parse(JSON.stringify(domainFill));
    const forgeFillCopy: AttachmentSource = JSON.parse(JSON.stringify(forgeFill));
    const rosterCopy = new Set(roster);

    const resultA = compile(verb, step, { domain: domainFill, forge: forgeFill }, roster);
    const resultB = compile(verbCopy, step, { domain: domainFillCopy, forge: forgeFillCopy }, rosterCopy);

    expect(skillFileContent(resultB.files)).toBe(skillFileContent(resultA.files));
    expect(resultB.files).toEqual(resultA.files);
    expect(resultB.warnings).toEqual(resultA.warnings);
  });

  test("seams carry the source path and line span, never an absolute path", () => {
    const content = skillFileContent(compile(verb, step, { domain: domainFill, forge: forgeFill }, new Set<string>()).files);
    expect(content).toMatch(/<!-- part: block:watch-ci source=mattstack:watch-ci version=1\.2\.0 path=\S+ lines=\d+-\d+ -->/);
    expect(content).toMatch(/<!-- part: prop:watch-ci\.domain binding=acme:watch-ci-domain version=0\.3\.0 path=\S+ lines=\d+-\d+ -->/);
    // Relative, never absolute: an absolute path would bake this machine's tmpdir
    // into a committed artifact.
    expect(content).not.toMatch(/path=\//);
  });

  test("an empty-arg placeholder is a compile error, not a silent compile", () => {
    expect(() => compile(verb, bare("Poll status. {{slot:}}"), {}, roster)).toThrow(
      'engine "watch-ci": literal "{{" near line 4 -- "{{" is reserved for compiler placeholders and has no escape, so a compiled body may not contain it',
    );
  });

  test("a placeholder with internal whitespace is a compile error, not a silent compile", () => {
    expect(() => compile(verb, bare("Poll status. {{ stage.dir }}"), {}, roster)).toThrow(
      'engine "watch-ci": literal "{{" near line 4 -- "{{" is reserved for compiler placeholders and has no escape, so a compiled body may not contain it',
    );
  });
});

const stageStep = engine("Run ${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh.\n{{props.domain}}\n{{stage.fields}}", {
  name: "stage-watch-ci",
  props: { domain: { contract: "watch-ci-domain@1", required: true } },
  allowedTools: ["Bash(${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh:*)"],
  stepFiles: ["references/polling-notes.md", "scripts/ci-watch.sh"],
  stageMeta: { stage: "watch-ci", consumes: ["mr", "branch"], produces: ["ci"] },
});

function skillMd(result: { files: CompiledFile[] }): string {
  const f = result.files.find((x) => x.path === "SKILL.md");
  return f && "content" in f ? f.content : "";
}

describe("compileBlockSkill with placeholders", () => {
  test("a fileless fill's tool rule names the same dir its body does", () => {
    const filelessDomain: AttachmentSource = {
      ...domainFill,
      body: "config at ${CLAUDE_SKILL_DIR}/references/polling-notes.md",
      allowedTools: ["Read(${CLAUDE_SKILL_DIR}/references/polling-notes.md)"],
      extraFiles: [],
    };
    const result = compile(verb, stageStep, { domain: filelessDomain }, new Set(), {});
    const md = skillMd(result);

    expect(md).toContain('- "Read(${CLAUDE_SKILL_DIR}/references/polling-notes.md)"');
    expect(md).toContain("config at ${CLAUDE_SKILL_DIR}/references/polling-notes.md");
    expect(md).not.toContain("parts/domain");
  });

  test("a fill that vendors files still scopes its tool rules to the parts dir, stage dir and all", () => {
    const md = skillMd(compile(verb, stageStep, { domain: domainFill }, new Set(), {
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci",
    }));
    expect(md).toContain('- "Read(${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci/parts/domain/ci-config.json)"');
  });

  test("substitutes in place and emits one prop marker", () => {
    const md = skillMd(compile(verb, stageStep, { domain: domainFill }, new Set(), {
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci",
    }));
    expect(md).toContain("<!-- part: prop:stage-watch-ci.domain binding=acme:watch-ci-domain version=0.3.0 path=attachments/watch-ci-domain/SKILL.md lines=8-8 -->");
    expect(md).toContain("You consume `mr`, `branch`. You must produce `ci`.");
    expect(md.indexOf("You consume")).toBeGreaterThan(md.indexOf("part: prop:stage-watch-ci.domain"));
    expect(md.split("part: prop:stage-watch-ci.domain").length).toBe(2);
  });

  test("inside a stage, step-owned script references are rewritten to the stage dir", () => {
    const md = skillMd(compile(verb, stageStep, { domain: domainFill }, new Set(), {
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci",
    }));
    expect(md).toContain("Run ${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci/scripts/ci-watch.sh.");
  });

  test("a placeholder that cannot be filled comes back as a diagnostic with no files", () => {
    const bad = engine("{{props.domain}}\n{{stage.dir}}", { props: { domain: { contract: "watch-ci-domain@1" } } });
    const result = compile(verb, bad, { domain: domainFill }, new Set(), {});
    expect(result.files).toEqual([]);
    expect(result.diagnostics.map((d) => d.message)).toEqual(["{{stage.dir}} used in a public verb"]);
  });

  test("a fill's file references resolve under the stage's parts dir inside a stage", () => {
    const md = skillMd(compile(verb, stageStep, { domain: domainFill }, new Set(), {
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci",
    }));
    expect(md).toContain("${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci/parts/domain/ci-config.json");
  });

  test("an engine calling the runtime resolver is a compile error", () => {
    const bad = engine('run "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"\n{{props.domain}}', { props: { domain: { contract: "watch-ci-domain@1" } } });
    expect(() => compile(verb, bad, { domain: domainFill }, new Set(), {}))
      .toThrow("compile-native engine calls the runtime resolver");
  });

  test("a malformed placeholder alongside a valid one is still a compile error", () => {
    const bad = engine("{{stage.fields}}\n{{slot:}}", { name: "stage-watch-ci", stageMeta: stageStep.stageMeta });
    expect(() => compile(verb, bad, {}, new Set(), { stageDir: "x" })).toThrow(
      /engine "stage-watch-ci": literal "\{\{" near line \d+ -- "\{\{" is reserved for compiler placeholders and has no escape, so a compiled body may not contain it/,
    );
  });

  test("an inline include placeholder is a compile error", () => {
    const result = compile(verb, bare("See {{include:review-core-body}} for details."), {}, new Set(), {
      includes: {
        "review-core-body": { ...domainFill, binding: "mattstack:review-core-body", provides: "" },
      },
    });
    expect(result.diagnostics.map((d) => d.message).join("\n")).toContain("must be alone on its line");
  });

  test("stage allowed-tools union rewrites to the leading-wildcard form", () => {
    const md = skillMd(compile(verb, bare("{{pipeline.stages}}"), {}, new Set(), {
      pipelines: { feature: [] },
      stageAllowedTools: ["Bash(${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh:*)", "Bash(*/scripts/ci-forge.sh:*)", "Bash(gh:*)"],
    }));
    expect(md).toContain('  - "Bash(*/scripts/ci-watch.sh:*)"');
    expect(md).toContain('  - "Bash(*/scripts/ci-forge.sh:*)"');
    expect((md.match(/Bash\(gh:\*\)/g) ?? []).length).toBe(1);
  });

  test("emitted sibling dirs are not lint-warned as missing files", () => {
    const r = compile(verb, bare("read ${CLAUDE_SKILL_DIR}/../../attachments/stage-plan/SKILL.md"), {}, new Set(), {
      emittedSiblingDirs: ["${CLAUDE_SKILL_DIR}/../../attachments/stage-plan"],
    });
    expect(r.warnings.filter((w) => w.includes("not an emitted file"))).toEqual([]);
  });

  test("an internal roster verb's vendored include lints clean when its host dir is exempt", () => {
    const withRef: AttachmentSource = {
      ...domainFill,
      binding: "mattstack:review-core-body",
      provides: "",
      body: "shape at ${CLAUDE_SKILL_DIR}/references/adjudicator.md",
      extraFiles: ["references/adjudicator.md"],
    };
    const host = "${CLAUDE_SKILL_DIR}/../../attachments/receive-review";
    const r = compile(verb, bare("Act on it.\n{{include:review-core-body}}"), {}, new Set(), {
      includes: { "review-core-body": withRef },
      stageDir: host,
      emittedSiblingDirs: [host],
    });
    expect(skillMd(r)).toContain(`shape at ${host}/parts/include-review-core-body/references/adjudicator.md`);
    expect(r.warnings).toEqual([]);
  });

  test("a relative read escaping the pack root is a compile error naming verb, path and source line", () => {
    expect(() =>
      compile(verb, bare("first line\nread `../../../attachments/self-review/SKILL.md` before starting"), {}, new Set(), {
        packRoot: "/pack",
        compiledDir: "/pack/attachments/stage-plan",
      }),
    // The root's text starts on line 7 of its index.block.md, and the offending
    // read is its second line.
    ).toThrow('verb "watch-ci": "../../../attachments/self-review/SKILL.md" at skills/pipeline/watch-ci/index.block.md:8 resolves outside the pack root');
  });

  test("a stage's escaping read is reported as a stage, not a verb", () => {
    expect(() =>
      compile(verb, bare("read `../../../elsewhere/SKILL.md`"), {}, new Set(), {
        packRoot: "/pack",
        compiledDir: "/pack/attachments/stage-plan",
        where: 'stage "stage-plan"',
      }),
    ).toThrow('stage "stage-plan": "../../../elsewhere/SKILL.md"');
  });

  test("the pack-root token is exempt with a trailing slash too", () => {
    const r = compile(verb, bare("cd ${CLAUDE_SKILL_DIR}/../../ && pwd"), {}, new Set(), {});
    expect(r.warnings).toEqual([]);
  });

  test("an escaping read inside a fill is reported against the fill's own file", () => {
    const escapingFill: AttachmentSource = { ...domainFill, body: "read `../../../outside.md` first" };
    expect(() =>
      compile(verb, stageStep, { domain: escapingFill }, new Set(), {
        packRoot: "/pack",
        compiledDir: "/pack/attachments/stage-watch-ci",
      }),
    ).toThrow('"../../../outside.md" at attachments/watch-ci-domain/SKILL.md:8 resolves outside the pack root');
  });

  test("an escaping ${CLAUDE_SKILL_DIR} path is the same compile error", () => {
    expect(() =>
      compile(verb, bare("read ${CLAUDE_SKILL_DIR}/../../../secrets.md"), {}, new Set(), { packRoot: "/pack", compiledDir: "/pack/skills/work" }),
    ).toThrow("resolves outside the pack root");
  });

  test("a relative read that resolves to nothing the pack has warns instead of erroring", () => {
    const packRoot = tempPackRoot();
    const r = compile(verb, bare("read `../../attachments/self-review/SKILL.md`"), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "work"),
    });
    expect(r.warnings).toEqual(["body references ../../attachments/self-review/SKILL.md which is not an emitted file"]);
  });

  test("a relative read onto a base attachment this compile plans to write is silent on a clean tree", () => {
    const packRoot = tempPackRoot();
    const r = compile(verb, bare("read `../../attachments/self-review/SKILL.md`"), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "work"),
      plannedAttachments: new Map([["self-review", new Set(["SKILL.md", "compiled.json"])]]),
    });
    expect(r.warnings).toEqual([]);
  });

  test("a planned base attachment satisfies only the files it plans", () => {
    const packRoot = tempPackRoot();
    const r = compile(verb, bare("read `../../attachments/self-review/missing.md`"), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "work"),
      plannedAttachments: new Map([["self-review", new Set(["SKILL.md"])]]),
    });
    expect(r.warnings).toEqual(["body references ../../attachments/self-review/missing.md which is not an emitted file"]);
  });

  test("a relative read onto a grouped planned base attachment is silent", () => {
    const packRoot = tempPackRoot();
    const r = compile(verb, bare("read `../../attachments/review/self/SKILL.md`"), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "work"),
      plannedAttachments: new Map([["review/self", new Set(["SKILL.md"])]]),
    });
    expect(r.warnings).toEqual([]);
  });

  test("a relative read onto a file the pack already carries is silent", () => {
    const packRoot = tempPackRoot();
    mkdirSync(join(packRoot, "attachments", "self-review"), { recursive: true });
    writeFileSync(join(packRoot, "attachments", "self-review", "SKILL.md"), "hand-authored\n");

    const r = compile(verb, bare("read `../../attachments/self-review/SKILL.md`"), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "work"),
    });
    expect(r.warnings).toEqual([]);
  });

  test("a relative read onto another target's output dir is silent before that target is written", () => {
    const packRoot = tempPackRoot();
    const r = compile(verb, bare("read `../../attachments/stage-plan/SKILL.md`"), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "work"),
      emittedTargetDirs: [join(packRoot, "attachments", "stage-plan")],
    });
    expect(r.warnings).toEqual([]);
  });

  test("a shell-composed path whose ../ follows another path is not read as a body reference", () => {
    const r = compile(verb, bare('FORGE=$(dirname "$STAGE")/../forge/ci-forge.sh'), {}, new Set(), {
      packRoot: "/pack",
      compiledDir: "/pack/skills/work",
    });
    expect(r.warnings).toEqual([]);
  });

  test("a bare asset path that this target never emits warns", () => {
    const r = compile(verb, bare("run scripts/missing.sh, then read references/notes.md"), {}, new Set(), {});
    expect(r.warnings).toEqual([
      "bare path scripts/missing.sh is not an emitted file",
      "bare path references/notes.md is not an emitted file",
    ]);
  });

  test("a bare directory in prose is not a path and never warns", () => {
    const r = compile(verb, bare("Put it in scripts/, then run it. See references/."), {}, new Set(), {});
    expect(r.warnings).toEqual([]);
  });

  test("a markdown-bracketed bare path warns under the file's real name", () => {
    const r = compile(verb, bare("[scripts/x.sh]"), {}, new Set(), {});
    expect(r.warnings).toEqual(["bare path scripts/x.sh is not an emitted file"]);
  });

  test("a bare asset path the engine vendors does not warn, sentence punctuation and all", () => {
    const r = compile(verb, bare("run scripts/ci-watch.sh, as documented in references/polling-notes.md."), {}, new Set(), {});
    expect(r.warnings).toEqual([]);
  });

  test("the pack-root token is not lint-warned as a missing file", () => {
    const r = compile(verb, bare('PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"'), {}, new Set(), {});
    expect(r.warnings).toEqual([]);
  });

  test("verb.path renders against the target's side and lints clean when the sibling is emitted", () => {
    const packRoot = tempPackRoot();
    const r = compile(verb, bare("Read {{verb.path:receive-review}} first, then {{verb.path:checkout}}."), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "watch-ci"),
      side: "skills",
      verbSides: { "watch-ci": "skills", checkout: "skills", "receive-review": "attachments" },
      emittedTargetDirs: [join(packRoot, "skills", "watch-ci"), join(packRoot, "skills", "checkout"), join(packRoot, "attachments", "receive-review")],
    });
    expect(skillMd(r)).toContain("Read ../../attachments/receive-review/SKILL.md first, then ../checkout/SKILL.md.");
    expect(r.warnings).toEqual([]);
  });

  function packWithEvidence(): string {
    const packRoot = tempPackRoot();
    mkdirSync(join(packRoot, "attachments", "evidence", "scripts"), { recursive: true });
    writeFileSync(join(packRoot, "attachments", "evidence", "scripts", "capture.sh"), "#!/bin/sh\n");
    return packRoot;
  }

  test("pack.path in a fill survives the parts rewrite inside a stage and lints clean", () => {
    const packRoot = packWithEvidence();
    const capturing: AttachmentSource = {
      ...domainFill,
      body: "Config at ${CLAUDE_SKILL_DIR}/ci-config.json; capture with {{pack.path:evidence/scripts/capture.sh}}.",
    };
    const host = "${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci";
    const r = compile(verb, stageStep, { domain: capturing }, new Set(), {
      stageDir: host,
      packRoot,
      compiledDir: join(packRoot, "attachments", "stage-watch-ci"),
      side: "attachments",
      emittedSiblingDirs: [host],
    });
    expect(skillMd(r)).toContain(
      `Config at ${host}/parts/domain/ci-config.json; capture with \${CLAUDE_SKILL_DIR}/../../attachments/evidence/scripts/capture.sh.`,
    );
    expect(r.warnings).toEqual([]);
  });

  test("pack.path in a public verb renders the same anchored path and lints clean", () => {
    const packRoot = packWithEvidence();
    const r = compile(verb, bare("Run {{pack.path:evidence/scripts/capture.sh}} after the diff."), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "watch-ci"),
      side: "skills",
    });
    expect(skillMd(r)).toContain("Run ${CLAUDE_SKILL_DIR}/../../attachments/evidence/scripts/capture.sh after the diff.");
    expect(r.warnings).toEqual([]);
  });

  test("pack.path naming a compiled target's output comes back as a diagnostic", () => {
    const packRoot = packWithEvidence();
    mkdirSync(join(packRoot, "skills", "work"), { recursive: true });
    writeFileSync(join(packRoot, "skills", "work", "SKILL.md"), "compiled earlier\n");
    const r = compile(verb, bare("see {{pack.path:work/SKILL.md}}"), {}, new Set(), {
      packRoot,
      compiledDir: join(packRoot, "skills", "watch-ci"),
      side: "skills",
      verbSides: { work: "skills", "watch-ci": "skills" },
    });
    expect(r.diagnostics.map((d) => d.message)).toEqual(["{{pack.path:work/SKILL.md}} -- work is a compiled verb; pack.path names source files only"]);
  });
});
