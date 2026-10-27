import { seedOrg as seedRoleOrg } from "../../packages/rt-client/test/org-fixture.ts";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { checkBlocks, checkPack, compilePackAll, computeRows, installedInfoFor, skillsAnatomy, skillsChanges, skillsCheck, skillsCompile, skillsComposition, skillsDiscard, skillsMaterialize, skillsPacks, type DiscardIo } from "../skills.ts";
import { HEADER_COMMENT } from "../../lib/skills/compile.ts";
import { compileBlockSkill } from "../../lib/skills/compile-blocks.ts";
import { setFieldContractSeverityForTest } from "../../lib/skills/field-contract.ts";
import { materializeRepo, type MaterializeFs } from "../../lib/skills/materialize.ts";
import { invocableRoster, loadAttachment, loadStepSource } from "../../lib/skills/sources.ts";
import type { PluginRoots } from "../../lib/skills/sources.ts";
import type { PackInfo } from "../../lib/skills/packs.ts";
import type { VerbDef } from "../../lib/skills/types.ts";
import { captureSkills, rootPropValues, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import * as ui from "../../lib/ui/out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { ORG_LAYOUT } from "../../lib/team/org-marker.ts";
import { POINTER_KEYS_MIN_ENGINE } from "../../lib/skills/team-params.ts";
import { openingLine } from "../../lib/skills/pointers.ts";
import { attachMaps, withMapFile } from "../../lib/skills/unit-maps.ts";
import { changedPartKeys, partExtents } from "../../lib/skills/drift.ts";

const realInitFsForTests: MaterializeFs = {
  exists: existsSync,
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  writeFile: (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); },
  mkdirp: (p) => mkdirSync(p, { recursive: true }),
  readDir: (p) => (existsSync(p) ? readdirSync(p) : []),
  rename: renameSync,
};

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const WATCH_CI_INDEX = `---
name: watch-ci
description: "Watch CI until it goes green"
type: pipeline-step
allowed-tools:
  - "Bash(gh:*)"
  - "Read"
props:
  domain:
    merge: replace
    default: ""
    contract: "watch-ci-domain@1"
  forge:
    merge: replace
    contract: "ci-forge@1"
---

Poll the pipeline every 30s and report status. See \${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh for the poller.

{{props.domain}}

{{props.forge}}
`;

const WATCH_CI_SCRIPT = "#!/bin/sh\necho polling\n";

const DOMAIN_SKILL_MD = `---
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

const FORGE_SKILL_MD = `---
name: gitlab-forge
description: "Talk to GitLab via glab"
metadata:
  provides: "ci-forge@1"
allowed-tools:
  - "Bash(glab:*)"
---

Talk to GitLab via glab.
`;

const STUBS_JSONC = `{
  "verbs": {
    "watch-ci": {
      "engine": "watch-ci",
      "description": "Use when watching or triaging CI."
    }
  }
}
`;

/**
 * A second, unrelated verb ("helper-verb") sharing watch-ci's engine, kept
 * out of surface.jsonc's public list so computeInternalRoster tags it
 * "acme:helper-verb" -- watch-ci's own description names that token,
 * which is exactly what lintInternalRoster flags (the only producer of
 * compileVerb's returned errors[], as opposed to a thrown failure).
 */
const STUBS_WITH_INTERNAL_REF = `{
  "verbs": {
    "watch-ci": {
      "engine": "watch-ci",
      "description": "Use when watching CI; see acme:helper-verb for internal detail."
    },
    "helper-verb": {
      "engine": "watch-ci",
      "description": "Internal helper, never surfaced."
    }
  }
}
`;

/** One compilable verb ahead of two that name engines no plugin root carries -- the ordering that used to emit watch-ci before the first throw. */
const STUBS_ONE_GOOD_TWO_BROKEN = `{
  "verbs": {
    "watch-ci": {
      "engine": "watch-ci",
      "description": "Use when watching or triaging CI."
    },
    "broken-a": {
      "engine": "no-such-engine-a",
      "description": "Points at a retired engine."
    },
    "broken-b": {
      "engine": "no-such-engine-b",
      "description": "Points at another retired engine."
    }
  }
}
`;

/** A second verb pointing at an engine that does not exist under any plugin root -- loadStepSource throws. */
const STUBS_TWO_VERBS = `{
  "verbs": {
    "watch-ci": {
      "engine": "watch-ci",
      "description": "Use when watching or triaging CI."
    },
    "broken": {
      "engine": "no-such-engine",
      "description": "Points at a retired engine."
    }
  }
}
`;

function manifestJsonc(withForge: boolean): string {
  const bindings = withForge
    ? `{
      "domain": "acme:watch-ci-domain",
      "forge": "mattstack:gitlab-forge"
    }`
    : `{
      "domain": "acme:watch-ci-domain"
    }`;
  return `// GENERATED by rt skills materialize
// provenance (binding <- layer):
//   mattstack:watch-ci domain <- pack
{
  "bindings": {
    "mattstack:watch-ci": ${bindings}
  }
}
`;
}

/** A trivial, propless stage step -- resolve() builds StageEntry[] for every pipeline name a test manifest declares, so any such name needs a real block tree behind it. */
function stageSkillMd(name: string, stage: string): string {
  return `---
name: ${name}
description: "${stage} stage"
type: pipeline-step
metadata:
  stage: ${stage}
---

${stage}.
`;
}

/**
 * Fixture "mattstack home" root: plugins/<name>/ mirrors resolvePluginRoots()'s
 * real shape (dir + .claude-plugin/plugin.json) so skillsCompile's test-mode
 * root resolution and the golden compile below walk identical trees.
 */
function makeMattstackDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-mattstack-")));

  const mattstackPluginDir = join(dir, "plugins", "mattstack");
  writeFile(join(mattstackPluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.2.0" }));
  writeFile(join(mattstackPluginDir, "skills", "pipeline", "watch-ci", "index.block.md"), WATCH_CI_INDEX);
  writeFile(join(mattstackPluginDir, "skills", "pipeline", "watch-ci", "scripts", "ci-watch.sh"), WATCH_CI_SCRIPT);
  chmodSync(join(mattstackPluginDir, "skills", "pipeline", "watch-ci", "scripts", "ci-watch.sh"), 0o755);
  writeFile(join(mattstackPluginDir, "skills", "gitlab-forge", "SKILL.md"), FORGE_SKILL_MD);
  writeFile(join(mattstackPluginDir, "attachments", "pipeline", "stage-plan", "index.block.md"), stageSkillMd("stage-plan", "plan"));
  writeFile(join(mattstackPluginDir, "attachments", "pipeline", "stage-provision", "index.block.md"), stageSkillMd("stage-provision", "provision"));
  writeFile(join(mattstackPluginDir, "attachments", "pipeline", "stage-ship", "index.block.md"), stageSkillMd("stage-ship", "ship"));

  const acmePluginDir = join(dir, "plugins", "acme");
  writeFile(join(acmePluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.3.0" }));
  writeFile(join(acmePluginDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
  writeFile(join(acmePluginDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);

  return dir;
}

/** An org clone under `<mattstackRoot>/orgs/<org>` with one folder per team; every team inherits the org's claim unless it sets its own. */
function seedOrg(mattstackRoot: string, org: string, opts: { projects: string[]; host?: string | null; teams: string[] }): void {
  const dir = join(mattstackRoot, "orgs", org, "mattstack");
  writeFile(join(mattstackRoot, "orgs", org, ".git", "config"), "");
  writeFile(join(dir, "mattstack.jsonc"), JSON.stringify({ role: "org", org, layout: ORG_LAYOUT }));
  const settings: Record<string, unknown> = { "board.projects": opts.projects };
  if (opts.host !== null) settings["board.gitlabHost"] = opts.host ?? "https://gitlab.example.com";
  writeFile(join(dir, "org", "settings.org.jsonc"), JSON.stringify(settings));
  for (const team of opts.teams) {
    writeFile(join(dir, "teams", team, "settings.team.jsonc"), "{}");
    writeFile(join(dir, "teams", team, "plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ name: team, version: "0.1.0" }));
  }
}

const teamPackDir = (mattstackRoot: string, org: string, team: string) =>
  join(mattstackRoot, "orgs", org, "mattstack", "teams", team, "plugin");

function makePackDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-pack-")));
  writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
  writeFile(join(dir, "pack", "stubs.jsonc"), STUBS_JSONC);
  return dir;
}

function makeManifest(withForge = true): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-")));
  const path = join(dir, "skills.jsonc");
  writeFile(path, manifestJsonc(withForge));
  return path;
}

/** domain is bound to a name nothing provides -- loadAttachment throws, exercising composition's per-value degrade. */
function makeManifestDanglingDomain(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-")));
  const path = join(dir, "skills.jsonc");
  writeFile(path, `{
  "bindings": {
    "mattstack:watch-ci": {
      "domain": "acme:does-not-exist",
      "forge": "mattstack:gitlab-forge"
    }
  }
}
`);
  return path;
}

function computeGolden(mattstackDir: string) {
  const roots: PluginRoots = {
    byName: {
      mattstack: { dir: join(mattstackDir, "plugins", "mattstack"), version: "1.2.0" },
      acme: { dir: join(mattstackDir, "plugins", "acme"), version: "0.3.0" },
    },
    list: [],
  };
  const verb: VerbDef = { name: "watch-ci", engine: "watch-ci", description: "Use when watching or triaging CI." };
  const step = loadStepSource("watch-ci", roots);
  const domain = loadAttachment("acme:watch-ci-domain", "domain", roots);
  const forge = loadAttachment("mattstack:gitlab-forge", "forge", roots);
  const invocable = invocableRoster(roots);
  const identity = { name: "widgets", version: "0.1.0" };
  const units = { "watch-ci": "skills/watch-ci" };
  const result = compileBlockSkill(verb, step, rootPropValues(step, { domain, forge }), invocable, { identity, units });
  const { maps } = attachMaps({ packDir: mattstackDir, identity, units, compiled: [{ leaf: "watch-ci", ...result }], emits: [] });
  return { ...result, files: withMapFile(result.files, maps.get("watch-ci")) };
}

let io: CapturedOut;

beforeEach(() => {
  io = captureSkills();
});

afterEach(() => {
  io.restore();
  // skillsCheck sets this on staleness; Bun ignores process.exitCode = undefined once
  // truthy, so 0 is the only value that clears it before the suite's own exit status.
  process.exitCode = 0;
});

describe("skillsCompile", () => {
  test("dry-run prints a would-write summary and writes nothing", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--dry-run",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const summary = io.lines().find((l) => /would write \d+ files/.test(l));
    expect(summary).toBeDefined();
    expect(summary).toContain("watch-ci");
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("--preview prints the compiled body and writes nothing", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack", "t", "--verb", "watch-ci", "--preview",
      "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);

    const out = io.lines().join("\n");
    expect(out).toContain("<!-- part: block:watch-ci source=");
    expect(out).not.toContain("Compiled watch-ci");
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("--preview requires exactly one verb", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack", "t", "--preview",
        "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Which verb should be previewed?");
  });

  test("--preview on a retired (surface-internal) verb leaves its stale output directory alone", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    // watch-ci is absent from surface.jsonc's public list, so it is internal/retired --
    // this is the transition-window state computeInternalRoster's own comment describes.
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);
    // A stale output dir from an earlier (pre-retirement) real compile.
    writeFile(join(packDir, "skills", "watch-ci", "SKILL.md"), "stale\n");

    await skillsCompile(["--pack", "t", "--verb", "watch-ci", "--preview",
      "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);

    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(true);
  });

  test("--preview on a non-public verb still previews the compiled body, writing nothing to disk", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);

    await skillsCompile(["--pack", "t", "--verb", "watch-ci", "--preview",
      "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);

    const out = io.lines().join("\n");
    expect(out).toContain("<!-- part: block:watch-ci source=");
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
    expect(existsSync(join(packDir, "attachments", "watch-ci"))).toBe(false);
  });

  test("non-public verb previewed alongside a misplaced compiled dir elsewhere: still nothing but the body on stdout", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);
    // Registered on disk, absent from the public list, and NOT the requested
    // verb: exactly what the post-loop "misplaced" scan reports -- but that
    // scan never runs under --preview, so it must not leak onto stdout here.
    writeFile(join(packDir, "skills", "stray-skill", "SKILL.md"), "# stray\n");

    await skillsCompile(["--pack", "t", "--verb", "watch-ci", "--preview",
      "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);

    const out = io.lines().join("\n");
    expect(out).toContain("<!-- part: block:watch-ci source=");
    expect(out).not.toContain("wrong folder");
  });

  test("real run emits SKILL.md + vendored files matching a golden compile, byte for byte", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    expect(io.lines().some((l) => l.includes("Compiled watch-ci") && l.includes("4 files"))).toBe(true);

    const golden = computeGolden(mattstackDir);
    const outDir = join(packDir, "skills", "watch-ci");

    for (const file of golden.files) {
      const dest = join(outDir, file.path);
      expect(existsSync(dest)).toBe(true);
      const expected = "content" in file ? file.content : readFileSync(file.copyFrom, "utf8");
      expect(readFileSync(dest, "utf8")).toBe(expected);
    }

    const scriptPath = join(outDir, "scripts", "ci-watch.sh");
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
  });

  test("missing required binding: clean one-line error naming verb and slot, exit 1, no partial write", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest(false);

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--manifest", manifestPath,
        "--verb", "watch-ci",
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe("1 verb did not compile");
    expect(errors.join("\n")).not.toContain("\n    at "); // no stack trace
    expect(errors.join("\n")).toContain("watch-ci");
    expect(errors.join("\n")).toContain("forge");
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("one errored verb aborts the whole compile: every error reported, nothing written", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_ONE_GOOD_TWO_BROKEN);
    // A previous compile's output for the one verb that DOES compile: surviving
    // byte for byte is what proves the failing run never reached the disk.
    writeFile(join(packDir, "skills", "watch-ci", "SKILL.md"), "PLANTED\n");

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--manifest", manifestPath,
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("2 verbs did not compile");
    const diagnostics = errors.filter((e) => /^ *verb "/.test(e));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toContain('verb "broken-a": loadStepSource: engine "no-such-engine-a" not found under');
    expect(diagnostics[1]).toContain('verb "broken-b": loadStepSource: engine "no-such-engine-b" not found under');
    expect(readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8")).toBe("PLANTED\n");
  });

  test("an engine body reading outside the pack root: clean one-line error, exit 1, nothing written", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(
      join(mattstackDir, "plugins", "mattstack", "skills", "pipeline", "watch-ci", "index.block.md"),
      WATCH_CI_INDEX.replace(
        "Poll the pipeline every 30s",
        "Read `../../../elsewhere/SKILL.md` first. Poll the pipeline every 30s",
      ),
    );

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--manifest", manifestPath,
        "--verb", "watch-ci",
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("../../../elsewhere/SKILL.md");
    // The engine's own file and line, not a coordinate in an artifact this run
    // refuses to write.
    expect(errors.join("\n")).toContain("at skills/pipeline/watch-ci/index.block.md:18 resolves outside the pack root");
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("unrecognized argument: clean one-line error, exit 1", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--bogus-flag"]),
    );

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain("--bogus-flag");
  });

  test("unknown verb: clean one-line error, exit 1", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--manifest", manifestPath,
        "--verb", "no-such-verb",
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain("no-such-verb");
  });

  test("absent manifest (no skills.jsonc names the team): clean one-line error, exit 1", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--verb", "watch-ci",
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("No t bindings file was found");
    expect(errors.join("\n")).toContain("skills.jsonc");
  });

  test("a symlinked plugin dir under --mattstack-dir resolves as a plugin root", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    const linkedAcme = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-acme-")));
    cpSync(join(mattstackDir, "plugins", "acme"), linkedAcme, { recursive: true });
    rmSync(join(mattstackDir, "plugins", "acme"), { recursive: true, force: true });
    symlinkSync(linkedAcme, join(mattstackDir, "plugins", "acme"));

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--dry-run",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--manifest", manifestPath,
        "--verb", "watch-ci",
      ]),
    );

    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();
    expect(io.lines().some((l) => /would write \d+ files/.test(l))).toBe(true);
  });

  test("default pack dir formula (--team + --mattstack-dir, no --pack-dir)", async () => {
    const mattstackDir = makeMattstackDir();
    const manifestPath = makeManifest();
    seedOrg(mattstackDir, "acme", { projects: [], teams: ["t"] });
    writeFile(join(teamPackDir(mattstackDir, "acme", "t"), "pack", "stubs.jsonc"), STUBS_JSONC);

    await skillsCompile([
      "--team", "t",
      "--dry-run",
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
    ]);

    expect(io.lines().some((l) => /would write \d+ files/.test(l) && l.includes("watch-ci"))).toBe(true);
  });

  test("default manifest lookup: the one repos/*/packs/<team>/skills.jsonc", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc"), manifestJsonc(true));

    const { errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "t", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));

    expect(errors).toEqual([]);
    expect(io.lines().some((l) => /would write \d+ files/.test(l))).toBe(true);
  });

  test("two packs bound to one repo compile different domain fills with no merge error", async () => {
    const mattstackDir = makeMattstackDir();
    writeFile(join(mattstackDir, "plugins", "gadgets", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.1.0" }));
    writeFile(join(mattstackDir, "plugins", "gadgets", "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
    writeFile(join(mattstackDir, "plugins", "gadgets", "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets", "gadgets"] });
    const zone = (pack: string, domain: string) => {
      const dir = teamPackDir(mattstackDir, "acme", pack);
      // The installed gadgets plugin supplies the fill, so the team pack goes by another plugin name.
      writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: `${pack}-team`, version: "0.1.0" }));
      writeFile(join(dir, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:watch-ci": { domain, forge: "mattstack:gitlab-forge" } } }));
      writeFile(join(dir, "pack", "stubs.jsonc"), STUBS_JSONC);
      return dir;
    };
    const widgetsDir = zone("widgets", "acme:watch-ci-domain");
    const gadgetsDir = zone("gadgets", "gadgets:watch-ci-domain");
    const engine = join(mattstackDir, "plugins", "mattstack");
    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: engine }, "https://gitlab.example.com/acme/widgets.git");
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.every((p) => p.ok)).toBe(true);

    const widgets = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", widgetsDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    const gadgets = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "gadgets", "--pack-dir", gadgetsDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    expect(widgets.errors).toEqual([]);
    expect(gadgets.errors).toEqual([]);

    const widgetsBody = readFileSync(join(widgetsDir, "skills", "watch-ci", "SKILL.md"), "utf8");
    const gadgetsBody = readFileSync(join(gadgetsDir, "skills", "watch-ci", "SKILL.md"), "utf8");
    expect(widgetsBody).toContain("acme:watch-ci-domain");
    expect(widgetsBody).not.toContain("gadgets:watch-ci-domain");
    expect(gadgetsBody).toContain("gadgets:watch-ci-domain");
    expect(gadgetsBody).not.toContain("acme:watch-ci-domain");
  });

  test("a team pack compiles a fill that lives in the org base pack", async () => {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    const baseDir = join(mattstackDir, "orgs", "acme", "mattstack", "org", "packs", "acme-base");
    const packDir = teamPackDir(mattstackDir, "acme", "widgets");
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);

    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs).toMatchObject([{ pack: "widgets", ok: true, layers: ["base:acme-base", "pack"] }]);

    const { errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    expect(errors).toEqual([]);
    expect(readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8")).toContain("acme-base:watch-ci-domain");
    expect(existsSync(join(baseDir, "skills"))).toBe(false);
  });

  function seedBaseFixture(): { mattstackDir: string; packDir: string; baseDir: string } {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    const baseDir = join(mattstackDir, "orgs", "acme", "mattstack", "org", "packs", "acme-base");
    const packDir = teamPackDir(mattstackDir, "acme", "widgets");
    writeFile(join(baseDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "0.1.0" }));
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
    if (out.kind !== "written") throw new Error(out.kind);
    return { mattstackDir, packDir, baseDir };
  }

  test("composition tags a base fill, its prop value and binder prop, and names the base the pack extends", async () => {
    const { mattstackDir, packDir } = seedBaseFixture();

    const io = captureSkills();
    try {
      await skillsComposition(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--json"]);
      const payload = JSON.parse(io.stdout());
      const tag = { origin: "base", base: "acme-base", baseVersion: "0.1.0" };
      expect(payload.extends).toEqual({ name: "acme-base", version: "0.1.0" });
      expect(payload.fills.find((f: { binding: string }) => f.binding === "acme-base:watch-ci-domain")).toMatchObject(tag);
      expect(payload.fills.find((f: { binding: string }) => f.binding.startsWith("mattstack:"))).not.toHaveProperty("origin");
      const domain = payload.verbs.find((v: { name: string }) => v.name === "watch-ci").props["watch-ci"].find((p: { name: string }) => p.name === "domain");
      expect(domain.values).toEqual([expect.objectContaining({ boundTo: "acme-base:watch-ci-domain", fillVersion: "org", ...tag })]);
      const binderProp = payload.binders.flatMap((b: { props: { boundTo: string }[] }) => b.props).find((p: { boundTo: string }) => p.boundTo === "acme-base:watch-ci-domain");
      expect(binderProp).toMatchObject(tag);
    } finally {
      io.restore();
    }
  });

  test("anatomy tags a base fill's source and leaves the engine's alone", async () => {
    const { mattstackDir, packDir } = seedBaseFixture();
    await runExpectingCleanExit(() => skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    const io = captureSkills();
    try {
      await skillsAnatomy(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--skill", "watch-ci", "--json"]);
      const payload = JSON.parse(io.stdout());
      const domain = payload.parts.find((p: { kind: string; name: string }) => p.kind === "prop" && p.name === "watch-ci.domain");
      expect(domain.source).toMatchObject({ ref: "acme-base:watch-ci-domain", version: "org", origin: "base", base: "acme-base", baseVersion: "0.1.0" });
      expect(payload.template).not.toHaveProperty("origin");
    } finally {
      io.restore();
    }
  });

  for (const externalCopy of [false, true]) test(`a numeric-leading org materializes and compiles inherited base fills in its ${externalCopy ? "external copy" : "clone"}`, async () => {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "1acme", { projects: ["acme/widgets"], teams: ["team-1acme"] });
    const baseDir = join(mattstackDir, "orgs", "1acme", "mattstack", "org", "packs", "acme-base");
    const packDir = teamPackDir(mattstackDir, "1acme", "team-1acme");
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);

    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs).toMatchObject([{ pack: "team-1acme", ok: true, layers: ["base:acme-base", "pack"] }]);

    let compileDir = packDir;
    if (externalCopy) {
      const copy = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-numeric-org-copy-"))), "1acme-copy");
      cpSync(join(mattstackDir, "orgs", "1acme"), copy, { recursive: true });
      compileDir = join(copy, "mattstack", "teams", "team-1acme", "plugin");
      const copiedFill = join(copy, "mattstack", "org", "packs", "acme-base", "attachments", "watch-ci-domain", "SKILL.md");
      writeFile(copiedFill, DOMAIN_SKILL_MD + "\nFill from this external copy.\n");
    }
    const { errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "team-1acme", "--pack-dir", compileDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    expect(errors).toEqual([]);
    const body = readFileSync(join(compileDir, "skills", "watch-ci", "SKILL.md"), "utf8");
    expect(body).toContain("acme-base:watch-ci-domain");
    if (externalCopy) expect(body).toContain("Fill from this external copy.");
    expect(existsSync(join(baseDir, "skills"))).toBe(false);
  });

  test("a team pack in a copy of the org repo outside teams/ compiles its org base fill from that copy, and a pack in no org repo gets no bases", async () => {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    const baseDir = join(mattstackDir, "orgs", "acme", "mattstack", "org", "packs", "acme-base");
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    const clonePack = teamPackDir(mattstackDir, "acme", "widgets");
    writeFile(join(clonePack, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
    writeFile(join(clonePack, "pack", "stubs.jsonc"), STUBS_JSONC);
    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
    if (out.kind !== "written") throw new Error(out.kind);

    const worktree = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-org-wt-"))), "acme-wt");
    cpSync(join(mattstackDir, "orgs", "acme"), worktree, { recursive: true });
    const worktreePack = join(worktree, "mattstack", "teams", "widgets", "plugin");
    const compiled = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", worktreePack, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    expect(compiled.errors).toEqual([]);
    expect(readFileSync(join(worktreePack, "skills", "watch-ci", "SKILL.md"), "utf8")).toContain("acme-base:watch-ci-domain");

    const loose = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-loose-"))), "widgets");
    cpSync(clonePack, loose, { recursive: true });
    const refused = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", loose, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    expect(refused.exitCode).toBe(1);
    expect(refused.errors.join("\n")).toContain("widgets extends acme-base, but it is not inside an org repo");
  });

  test("a team pack's pack/skills.jsonc at plugin/ is a fragment, never taken as its manifest, even in a worktree outside ~/.mattstack", async () => {
    const mattstackDir = makeMattstackDir();
    // A worktree of the org repo sits anywhere; only the path shape says this is a team pack.
    const packDir = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-worktree-"))), "clone", "mattstack", "teams", "widgets", "plugin");
    writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: {} }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    const { exitCode, stderr } = await runSkillsCapturing(["compile", "--pack-dir", packDir, "--mattstack-dir", mattstackDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("repos/*/packs/widgets/skills.jsonc");
  });

  test("a base pack of another org on the same Mac is not resolvable from this org's pack", async () => {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    seedOrg(mattstackDir, "other", { projects: [], teams: [] });
    const otherBase = join(mattstackDir, "orgs", "other", "mattstack", "org", "packs", "other-base");
    writeFile(join(otherBase, "pack", "skills.jsonc"), JSON.stringify({ base: true }));
    writeFile(join(otherBase, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
    writeFile(join(otherBase, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    const packDir = teamPackDir(mattstackDir, "acme", "widgets");
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    const manifestPath = join(mattstackDir, "widgets-bindings.jsonc");
    writeFile(manifestPath, JSON.stringify({ bindings: { "mattstack:watch-ci": { domain: "other-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain('no plugin root registered for "other-base"');
  });

  test("an org base pack named like an installed plugin is refused, and another org's compile still resolves that plugin's fills", async () => {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    seedOrg(mattstackDir, "other", { projects: [], teams: ["gadgets"] });
    const clash = join(mattstackDir, "orgs", "acme", "mattstack", "org", "packs", "mattstack");
    writeFile(join(clash, "pack", "skills.jsonc"), JSON.stringify({ base: true }));
    const widgetsDir = teamPackDir(mattstackDir, "acme", "widgets");
    const gadgetsDir = teamPackDir(mattstackDir, "other", "gadgets");
    writeFile(join(widgetsDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    writeFile(join(gadgetsDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    const manifestPath = makeManifest();

    const refused = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", widgetsDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]));
    expect(refused.exitCode).toBe(1);
    expect(refused.errors[0]).toBe("An org base pack has the same name as an installed plugin");
    expect(existsSync(join(widgetsDir, "skills"))).toBe(false);

    const other = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "gadgets", "--pack-dir", gadgetsDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]));
    expect(other.errors).toEqual([]);
    expect(existsSync(join(gadgetsDir, "skills", "watch-ci", "SKILL.md"))).toBe(true);
  });

  test("another pack's file on the same repo is never picked", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "other", "skills.jsonc"), manifestJsonc(true));

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "t", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("No t bindings file was found");
    expect(errors.join("\n")).toContain("repos/*/packs/t/skills.jsonc");
  });

  test.each([["no stale file"], ["a stale bindings file"]])("a base pack has no bindings file of its own, and the error says so (%s)", async (variant) => {
    const mattstackDir = makeMattstackDir();
    const packDir = teamPackDir(mattstackDir, "acme", "acme");
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ base: true }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    if (variant === "a stale bindings file") {
      writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "acme-base", "skills.jsonc"), manifestJsonc(true));
    }

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "acme-base", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain(
      'pack "acme-base" is a base pack and has no bindings file of its own; bind it to edit its shared fills, or compile a pack that extends it',
    );
  });

  test("two repos for one pack: --repo picks, and without it the zone's first project wins", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc"), manifestJsonc(true));
    writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-gadgets", "packs", "t", "skills.jsonc"), manifestJsonc(false));
    const base = ["--team", "t", "--json", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"];

    const ambiguous = await runExpectingCleanExit(() => skillsCompile(base));
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.errors[0]).toBe("Which repo?");
    expect(ambiguous.errors.join("\n")).toContain("--repo <slug>");

    for (const repo of ["gitlab.example.com-acme-widgets", "gitlab.example.com/acme/widgets"]) {
      const picked = await runExpectingCleanExit(() => skillsCompile([...base, "--repo", repo]));
      expect(picked.errors).toEqual([]);
      expect(JSON.parse(io.lines().at(-1)!).manifestPath).toContain("gitlab.example.com-acme-widgets");
    }

    seedOrg(mattstackDir, "acme", { projects: ["acme/gadgets", "acme/widgets"], teams: ["t"] });
    writeFile(join(teamPackDir(mattstackDir, "acme", "t"), "pack", "skills.jsonc"), "{}");
    const tieBroken = await runExpectingCleanExit(() => skillsCompile(base));
    expect(tieBroken.errors).toEqual([]);
    expect(JSON.parse(io.lines().at(-1)!).manifestPath).toContain("gitlab.example.com-acme-gadgets");
  });

  test("--repo naming a repo with no file for this pack is a clean error", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "t", "--dry-run", "--repo", "nope", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("No t bindings file for nope yet");
  });

  test("a trailing bare --repo is a usage error, never the default lookup", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc"), manifestJsonc(true));

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "t", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci", "--repo"]));

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("--repo needs a value");
  });

  test("a team with no forge host cannot break a two-repo tie, and says so", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc"), manifestJsonc(true));
    writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-gadgets", "packs", "t", "skills.jsonc"), manifestJsonc(false));
    seedOrg(mattstackDir, "acme", { projects: ["acme/gadgets", "acme/widgets"], host: null, teams: ["t"] });
    writeFile(join(teamPackDir(mattstackDir, "acme", "t"), "pack", "skills.jsonc"), "{}");

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "t", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("names no forge host");
    expect(errors.join("\n")).toContain("--repo <slug>");
  });

  test("repoKey is the repo slug for the per-pack shape", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc"), manifestJsonc(true));

    const { errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "t", "--json", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));

    expect(errors).toEqual([]);
    expect(JSON.parse(io.lines().at(-1)!).repoKey).toBe("gitlab.example.com-acme-widgets");
  });

  test("a standalone pack (outside the teams zone) with no registered manifest compiles against its own pack/skills.jsonc", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "skills.jsonc"), manifestJsonc(true));

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--dry-run",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--verb", "watch-ci",
      ]),
    );

    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();
    expect(io.lines().some((l) => /would write \d+ files/.test(l) && l.includes("watch-ci"))).toBe(true);
  });

  test("a team-shaped pack OUTSIDE the teams zone (a worktree) still never falls back to its pack/skills.jsonc fragment", async () => {
    const mattstackDir = makeMattstackDir();
    const worktreeRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-worktree-")));
    const packDir = join(worktreeRoot, "mattstack", "teams", "t", "plugin");
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    writeFile(join(packDir, "pack", "skills.jsonc"), manifestJsonc(true));

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--dry-run",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--verb", "watch-ci",
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("No t bindings file was found");
    expect(errors.join("\n")).toContain("repos/*/packs/t/skills.jsonc");
  });

  test("a team-zone pack never falls back to its own pack/skills.jsonc: that file is a fragment, not the repo's manifest", async () => {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: [], teams: ["t"] });
    const packDir = teamPackDir(mattstackDir, "acme", "t");
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    writeFile(join(packDir, "pack", "skills.jsonc"), manifestJsonc(true));

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--dry-run",
        "--mattstack-dir", mattstackDir,
        "--verb", "watch-ci",
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("No t bindings file was found");
    expect(errors.join("\n")).toContain("skills.jsonc");
  });

  test("compilePackAll writes the pack and reports ok", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifest = makeManifest();

    const result = await compilePackAll({ pack: "t", packDir, mattstackDir, manifest });

    expect(result).toMatchObject({ ok: true, errors: [], removed: [] });
    expect(result.written).toContain("skills/watch-ci/SKILL.md");
    expect(existsSync(join(packDir, "skills", "watch-ci", "SKILL.md"))).toBe(true);
  });

  test("compilePackAll names every file it wrote and every file it removed, pack-relative", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifest = makeManifest();
    writeFile(join(packDir, "skills", "watch-ci", "left-over.md"), "from an older compile\n");

    const result = await compilePackAll({ pack: "t", packDir, mattstackDir, manifest });

    const filesUnder = (rel: string) => (readdirSync(join(packDir, rel), { recursive: true }) as string[]).filter((p) => statSync(join(packDir, rel, p)).isFile()).map((p) => `${rel}/${p}`);
    expect(result.removed).toEqual(["skills/watch-ci/left-over.md"]);
    expect([...result.written].sort()).toEqual([...filesUnder("skills"), "pack/requires.json"].sort());
    expect(existsSync(join(packDir, "skills", "watch-ci", "left-over.md"))).toBe(false);
  });

  test("compilePackAll surfaces lint failures as errors, writing nothing", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifest = makeManifest(false); // reuses the missing-required-binding fixture

    const result = await compilePackAll({ pack: "t", packDir, mattstackDir, manifest });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result).toMatchObject({ written: [], removed: [] });
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });
});

describe("base pack attachments", () => {
  function seedBaseAndTeam(opts: { domainBody?: string; bindings?: Record<string, Record<string, string>>; baseFiles?: Record<string, string>; teamFiles?: Record<string, string> } = {}) {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    const baseDir = join(mattstackDir, "orgs", "acme", "mattstack", "org", "packs", "acme-base");
    const packDir = teamPackDir(mattstackDir, "acme", "widgets");
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" }, ...opts.bindings } }));
    for (const [rel, body] of Object.entries(opts.baseFiles ?? {})) writeFile(join(baseDir, rel), body);
    for (const [rel, body] of Object.entries(opts.teamFiles ?? {})) writeFile(join(packDir, rel), body);
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), opts.domainBody ?? DOMAIN_SKILL_MD);
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    writeFile(join(baseDir, "attachments", "review-kit", "SKILL.md"), "---\nname: review-kit\ndescription: shared review notes\n---\nInvoke {{pack.name}}:watch-ci. Read {{verb.path:watch-ci}}.\n");
    writeFile(join(baseDir, "attachments", "review-kit", "references", "guide.md"), "Back to {{verb.path:watch-ci}}. Keep {{slot:x}} and ${{ secrets.TOKEN }}.\n");
    writeFile(join(baseDir, "attachments", "review-kit", "scripts", "run.sh"), "#!/bin/sh\necho '{{pack.name}}' '{{verb.path:watch-ci}}'\n");
    chmodSync(join(baseDir, "attachments", "review-kit", "scripts", "run.sh"), 0o755);
    writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    let manifestPath = "";
    const materialize = () => {
      const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
      if (out.kind !== "written") throw new Error(out.kind);
      const written = out.packs[0];
      if (!written?.ok) throw new Error(written?.detail ?? "no pack");
      manifestPath = written.path;
    };
    materialize();
    const compile = (...extra: string[]) => runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, ...extra]));
    const boardBindings = () => (JSON.parse(stripJsoncForTest(readFileSync(manifestPath, "utf8"))) as { bindings: Record<string, Record<string, string>> }).bindings;
    return { mattstackDir, baseDir, packDir, compile, materialize, boardBindings, manifestFile: () => manifestPath };
  }

  const stripJsoncForTest = (text: string) => text.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const BOARD_REVIEW_MD = "---\nname: board-review\ndescription: How the board reviews an MR\nmetadata:\n  provides: \"review\"\n---\nReview as {{pack.name}}.\n";
  const BOARD = { "board:review": { review: "acme-base:board-review" } };

  test("a base fill bound only from a board slot is copied into the team pack, and the board binding names the team plugin", async () => {
    const { mattstackDir, packDir, compile, boardBindings } = seedBaseAndTeam({ bindings: BOARD, baseFiles: { "attachments/board-review/SKILL.md": BOARD_REVIEW_MD } });

    expect((await compile()).errors).toEqual([]);

    expect(readFileSync(join(packDir, "attachments", "board-review", "SKILL.md"), "utf8")).toBe(BOARD_REVIEW_MD.replace("{{pack.name}}", "widgets"));
    expect(JSON.parse(readFileSync(join(packDir, "attachments", "board-review", "compiled.json"), "utf8"))).toEqual({
      base: "acme-base", version: null, files: ["SKILL.md"], id: "widgets@0.1.0:board-review", dir: "attachments/board-review", covers: ["widgets@0.1.0:board-review"], keys: {},
    });
    expect(boardBindings()["board:review"]).toEqual({ review: "widgets:board-review" });
    expect(boardBindings()["mattstack:watch-ci"]!.domain).toBe("acme-base:watch-ci-domain");
    expect((await checkPack({ packDir, mattstackDir })).attachments.map((row) => [row.name, row.status])).toContainEqual(["board-review", "in-sync"]);
  });

  test("materialize refuses a board fill retarget for a team pack with no plugin name, naming the file", () => {
    const { mattstackDir, packDir } = seedBaseAndTeam({ bindings: BOARD, baseFiles: { "attachments/board-review/SKILL.md": BOARD_REVIEW_MD } });
    rmSync(join(packDir, ".claude-plugin", "plugin.json"));

    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");

    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ pack: "widgets", ok: false });
    expect((out.packs[0] as { detail: string }).detail).toContain(join(packDir, ".claude-plugin", "plugin.json"));
  });

  test("a board binding onto a fill the base does not have is refused at compile", async () => {
    const { packDir, compile } = seedBaseAndTeam({ bindings: { "board:review": { review: "acme-base:board-reveiw" } }, baseFiles: { "attachments/board-review/SKILL.md": BOARD_REVIEW_MD } });

    const { errors } = await compile();

    expect(errors.join("\n")).toContain("acme-base binds board:review to acme-base:board-reveiw, but has no attachments/board-reveiw");
    expect(existsSync(join(packDir, "attachments", "board-review"))).toBe(false);
  });

  test("a board fill the base keeps in a group is refused at compile", async () => {
    const { compile } = seedBaseAndTeam({ bindings: BOARD, baseFiles: { "attachments/board/board-review/SKILL.md": BOARD_REVIEW_MD } });

    const { errors } = await compile();

    expect(errors.join("\n")).toContain("acme-base keeps its board fill board-review at attachments/board/board-review; the board only finds attachments/board-review");
  });

  test("a board binding onto a fill only the team carries compiles clean", async () => {
    const { compile } = seedBaseAndTeam({ bindings: BOARD, teamFiles: { "attachments/board-review/SKILL.md": BOARD_REVIEW_MD } });

    expect((await compile()).errors).toEqual([]);
  });

  test("a board fill the base stops binding from a board slot is removed from the team pack", async () => {
    const { baseDir, packDir, compile, materialize } = seedBaseAndTeam({ bindings: BOARD, baseFiles: { "attachments/board-review/SKILL.md": BOARD_REVIEW_MD } });
    expect((await compile()).errors).toEqual([]);
    expect(existsSync(join(packDir, "attachments", "board-review", "compiled.json"))).toBe(true);

    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
    materialize();
    expect((await compile()).errors).toEqual([]);

    expect(existsSync(join(packDir, "attachments", "board-review"))).toBe(false);
  });

  test("a base fill a compile target also binds is still inlined only, and its board binding is left alone", async () => {
    const { packDir, compile, boardBindings } = seedBaseAndTeam({ bindings: { "board:review": { review: "acme-base:watch-ci-domain" } } });

    expect((await compile()).errors).toEqual([]);

    expect(existsSync(join(packDir, "attachments", "watch-ci-domain"))).toBe(false);
    expect(boardBindings()["board:review"]).toEqual({ review: "acme-base:watch-ci-domain" });
  });

  test("a team that keeps its own board fill wins, and the board binding still names the team plugin", async () => {
    const own = BOARD_REVIEW_MD.replace("Review as {{pack.name}}.", "Review the widgets way.");
    const { packDir, compile, boardBindings } = seedBaseAndTeam({
      bindings: BOARD,
      baseFiles: { "attachments/board-review/SKILL.md": BOARD_REVIEW_MD },
      teamFiles: { "attachments/board-review/SKILL.md": own },
    });

    expect((await compile()).errors).toEqual([]);

    expect(readFileSync(join(packDir, "attachments", "board-review", "SKILL.md"), "utf8")).toBe(own);
    expect(existsSync(join(packDir, "attachments", "board-review", "compiled.json"))).toBe(false);
    expect(boardBindings()["board:review"]).toEqual({ review: "widgets:board-review" });
  });

  const kit = (packDir: string, ...rest: string[]) => join(packDir, "attachments", "review-kit", ...rest);
  const notes = (packDir: string, ...rest: string[]) => join(packDir, "attachments", "notes-kit", ...rest);
  const PACK_PATH_DOMAIN = DOMAIN_SKILL_MD.replace(/\n$/, "\nSee {{pack.path:notes-kit/references/guide.md}}.\n");
  const NOTES_KIT = {
    "attachments/notes-kit/SKILL.md": "---\nname: notes-kit\ndescription: shared notes\n---\nNotes. Back to {{verb.path:watch-ci}}.\n",
    "attachments/notes-kit/references/guide.md": "See {{pack.path:notes-kit/SKILL.md}}.\n",
  };

  test("emits a base attachment with compiled.json, renders the three placeholders by depth, and copies scripts byte for byte", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam();

    const { errors } = await compile();

    expect(errors).toEqual([]);
    expect(readFileSync(kit(packDir, "SKILL.md"), "utf8")).toBe(`---\nname: review-kit\ndescription: shared review notes\n---\n${openingLine("widgets@0.1.0:review-kit")}\n\nInvoke widgets:watch-ci. Read @watch-ci/SKILL.md.\n`);
    expect(readFileSync(kit(packDir, "references", "guide.md"), "utf8")).toBe(`${openingLine("widgets@0.1.0:review-kit")}\n\nBack to @watch-ci/SKILL.md. Keep {{slot:x}} and $\{{ secrets.TOKEN }}.\n`);
    expect(readFileSync(kit(packDir, "scripts", "run.sh")).equals(readFileSync(join(baseDir, "attachments", "review-kit", "scripts", "run.sh")))).toBe(true);
    expect(statSync(kit(packDir, "scripts", "run.sh")).mode & 0o111).not.toBe(0);
    expect(JSON.parse(readFileSync(kit(packDir, "compiled.json"), "utf8"))).toMatchObject({
      base: "acme-base", version: null, files: ["SKILL.md", "references/guide.md", "scripts/run.sh"], id: "widgets@0.1.0:review-kit", dir: "attachments/review-kit",
    });
  });

  test("a dotfile in a base attachment is copied byte for byte and listed, and check stays clean", async () => {
    const { mattstackDir, baseDir, packDir, compile } = seedBaseAndTeam();
    writeFile(join(baseDir, "attachments", "review-kit", "scripts", ".env.example"), "TOKEN=\n");
    writeFile(join(baseDir, "attachments", "review-kit", ".DS_Store"), "junk");

    expect((await compile()).errors).toEqual([]);

    expect(readFileSync(kit(packDir, "scripts", ".env.example"), "utf8")).toBe("TOKEN=\n");
    expect(existsSync(kit(packDir, ".DS_Store"))).toBe(false);
    expect(JSON.parse(readFileSync(kit(packDir, "compiled.json"), "utf8")).files).toEqual(["SKILL.md", "references/guide.md", "scripts/.env.example", "scripts/run.sh"]);
    const payload = await checkPack({ packDir, mattstackDir });
    expect(payload.attachments.map((row) => row.status)).toEqual(["in-sync"]);
  });

  test("a fill in the base is inlined, never emitted", async () => {
    const { packDir, compile } = seedBaseAndTeam();

    await compile();

    expect(existsSync(join(packDir, "attachments", "watch-ci-domain"))).toBe(false);
    expect(readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8")).toContain("acme-base:watch-ci-domain");
  });

  test("a team verb reads a base attachment through its own rendered copy on a clean compile", async () => {
    const { mattstackDir, packDir, compile } = seedBaseAndTeam({ domainBody: PACK_PATH_DOMAIN, baseFiles: NOTES_KIT });

    const first = await compile();
    expect(first.errors).toEqual([]);
    const verbDir = join(packDir, "skills", "watch-ci");
    expect(readFileSync(join(verbDir, "SKILL.md"), "utf8")).toContain("@watch-ci/references/notes-kit/references/guide.md");
    expect(readFileSync(join(verbDir, "references", "notes-kit", "SKILL.md"), "utf8")).toBe(`---\nname: notes-kit\ndescription: shared notes\n---\n${openingLine("widgets@0.1.0:watch-ci")}\n\nNotes. Back to @watch-ci/SKILL.md.\n`);
    expect(readFileSync(join(verbDir, "references", "notes-kit", "references", "guide.md"), "utf8")).toBe(`${openingLine("widgets@0.1.0:watch-ci")}\n\nSee @watch-ci/references/notes-kit/SKILL.md.\n`);
    expect(existsSync(join(verbDir, "references", "notes-kit", "compiled.json"))).toBe(false);
    expect((await checkPack({ packDir, mattstackDir })).verbs.map((row) => [row.name, row.status])).toEqual([["watch-ci", "in-sync"]]);

    rmSync(notes(packDir), { recursive: true });
    const dry = await compile("--dry-run");
    expect(dry.errors).toEqual([]);
    expect(existsSync(notes(packDir))).toBe(false);
  });

  test("a built skill's copy of a base attachment resolves {{pack.name}} and keeps other braces as text", async () => {
    const linked = DOMAIN_SKILL_MD.replace(/\n$/, "\nSee {{pack.path:review-kit/SKILL.md}}.\n");
    const { baseDir, packDir, compile } = seedBaseAndTeam({ domainBody: linked });

    expect((await compile()).errors).toEqual([]);

    const copy = join(packDir, "skills", "watch-ci", "references", "review-kit");
    expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe(`---\nname: review-kit\ndescription: shared review notes\n---\n${openingLine("widgets@0.1.0:watch-ci")}\n\nInvoke widgets:watch-ci. Read @watch-ci/SKILL.md.\n`);
    expect(readFileSync(join(copy, "references", "guide.md"), "utf8")).toBe(`${openingLine("widgets@0.1.0:watch-ci")}\n\nBack to @watch-ci/SKILL.md. Keep {{slot:x}} and $\{{ secrets.TOKEN }}.\n`);
    expect(readFileSync(join(copy, "scripts", "run.sh")).equals(readFileSync(join(baseDir, "attachments", "review-kit", "scripts", "run.sh")))).toBe(true);
  });

  test("a recompile clears what an earlier compile copied into references/", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam({ domainBody: PACK_PATH_DOMAIN, baseFiles: { ...NOTES_KIT, "attachments/other-kit/SKILL.md": "---\nname: other-kit\n---\nother\n" } });
    expect((await compile()).errors).toEqual([]);
    const refs = join(packDir, "skills", "watch-ci", "references");
    expect(existsSync(join(refs, "notes-kit", "SKILL.md"))).toBe(true);
    writeFile(join(refs, "notes-kit", "left-over.md"), "stale\n");

    writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD.replace(/\n$/, "\nSee {{pack.path:other-kit/SKILL.md}}.\n"));
    expect((await compile()).errors).toEqual([]);

    expect(existsSync(join(refs, "notes-kit"))).toBe(false);
    expect(readFileSync(join(refs, "other-kit", "SKILL.md"), "utf8")).toBe("---\nname: other-kit\n---\nother\n");
  });

  test("a pack.path link onto a base attachment does not warn on the compile that first writes it", async () => {
    const linked = DOMAIN_SKILL_MD.replace(/\n$/, "\nRead `{{pack.path:notes-kit/SKILL.md}}` first.\n");
    const { packDir, compile } = seedBaseAndTeam({ domainBody: linked, baseFiles: NOTES_KIT });
    io.clear();

    expect((await compile()).errors).toEqual([]);

    expect(existsSync(notes(packDir, "SKILL.md"))).toBe(true);
    expect(io.stdout() + io.stderr()).not.toContain("not an emitted file");
  });

  test("a team's own folder wins", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam();
    writeFile(kit(packDir, "SKILL.md"), "team copy\n");

    await compile();
    expect(readFileSync(kit(packDir, "SKILL.md"), "utf8")).toBe("team copy\n");
    expect(existsSync(kit(packDir, "compiled.json"))).toBe(false);
    expect(io.lines().join("\n")).toContain("review-kit  your own copy; the one in acme-base is not copied");

    writeFile(join(baseDir, "attachments", "review-kit", "SKILL.md"), "---\nname: review-kit\n---\nchanged\n");
    await compile();
    expect(readFileSync(kit(packDir, "SKILL.md"), "utf8")).toBe("team copy\n");
  });

  test("a folder left by a retired verb is replaced by the base copy, and the run reports both", async () => {
    const { mattstackDir, baseDir, packDir, compile } = seedBaseAndTeam();
    writeFile(kit(packDir, "SKILL.md"), `---\nname: review-kit\n---\n${HEADER_COMMENT}\nold verb body\n`);
    writeFile(kit(packDir, "old.md"), "old\n");

    expect((await compile()).errors).toEqual([]);

    expect(readFileSync(kit(packDir, "SKILL.md"), "utf8")).toBe(`---\nname: review-kit\ndescription: shared review notes\n---\n${openingLine("widgets@0.1.0:review-kit")}\n\nInvoke widgets:watch-ci. Read @watch-ci/SKILL.md.\n`);
    expect(existsSync(kit(packDir, "old.md"))).toBe(false);
    expect(existsSync(kit(packDir, "compiled.json"))).toBe(true);
    const shown = io.lines().join("\n");
    expect(shown).toContain("Removed review-kit");
    expect(shown).toContain("Copied review-kit");

    writeFile(kit(packDir, "SKILL.md"), `---\nname: review-kit\n---\n${HEADER_COMMENT}\nold verb body\n`);
    rmSync(kit(packDir, "compiled.json"));
    writeFile(kit(packDir, "old.md"), "old\n");
    writeFileSync(join(baseDir, "attachments", "review-kit", "references", "guide.md"), "changed\n");
    const result = await compilePackAll({ packDir, mattstackDir });
    expect(result.ok).toBe(true);
    expect(result.removed).toContain("attachments/review-kit/old.md");
    expect(result.removed).not.toContain("attachments/review-kit/SKILL.md");
    expect(result.written).toContain("attachments/review-kit/SKILL.md");
  });

  test("a base attachment named like a verb or a hand-authored skill is refused, and nothing is written", async () => {
    const verbClash = seedBaseAndTeam();
    writeFile(join(verbClash.baseDir, "attachments", "watch-ci", "SKILL.md"), "---\nname: watch-ci\n---\nbase copy\n");
    const refused = await verbClash.compile();
    expect(refused.exitCode).not.toBe(0);
    expect(refused.exitCode).toBeDefined();
    expect(refused.errors.join("\n")).toContain("acme-base attachment watch-ci has the same name as the widgets verb watch-ci; rename one of them");
    expect(existsSync(kit(verbClash.packDir))).toBe(false);

    const skillClash = seedBaseAndTeam();
    writeFile(join(skillClash.packDir, "skills", "review-kit", "SKILL.md"), "---\nname: review-kit\n---\nmine\n");
    const second = await skillClash.compile();
    expect(second.errors.join("\n")).toContain("acme-base attachment review-kit has the same name as the widgets skill skills/review-kit; rename one of them");
    expect(existsSync(kit(skillClash.packDir))).toBe(false);
  });

  test("a symlink in a base attachment is refused, and nothing is written", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam();
    symlinkSync("run.sh", join(baseDir, "attachments", "review-kit", "scripts", "link.sh"));

    const refused = await compile();

    expect(refused.exitCode).toBeDefined();
    expect(refused.exitCode).not.toBe(0);
    expect(refused.errors.join("\n")).toContain("acme-base attachment review-kit has a symlink at scripts/link.sh; compile copies regular files only");
    expect(existsSync(kit(packDir))).toBe(false);
  });

  test("cleanup after the base drops an attachment and after extends is dropped", async () => {
    const dropped = seedBaseAndTeam();
    writeFile(join(dropped.packDir, "attachments", "own", "SKILL.md"), "---\nname: own\n---\nours\n");
    await dropped.compile();
    expect(existsSync(kit(dropped.packDir, "compiled.json"))).toBe(true);
    rmSync(join(dropped.baseDir, "attachments", "review-kit"), { recursive: true });
    expect((await dropped.compile()).errors).toEqual([]);
    expect(existsSync(kit(dropped.packDir))).toBe(false);
    expect(existsSync(join(dropped.packDir, "attachments", "own", "SKILL.md"))).toBe(true);

    const unextended = seedBaseAndTeam();
    writeFile(join(unextended.packDir, "attachments", "own", "SKILL.md"), "---\nname: own\n---\nours\n");
    await unextended.compile();
    expect(existsSync(kit(unextended.packDir, "compiled.json"))).toBe(true);
    writeFile(join(unextended.packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:watch-ci": { forge: "mattstack:gitlab-forge" } } }));
    unextended.materialize();
    expect((await unextended.compile()).errors).toEqual([]);
    expect(existsSync(kit(unextended.packDir))).toBe(false);
    expect(existsSync(join(unextended.packDir, "attachments", "own", "SKILL.md"))).toBe(true);
  });

  test("a base file dropped from a kept attachment is removed on the next compile", async () => {
    const { mattstackDir, baseDir, packDir, compile } = seedBaseAndTeam();
    await compile();
    rmSync(join(baseDir, "attachments", "review-kit", "references", "guide.md"));

    const result = await compilePackAll({ packDir, mattstackDir });

    expect(result.ok).toBe(true);
    expect(result.removed.some((p) => p.endsWith("attachments/review-kit/references/guide.md"))).toBe(true);
    expect(result.written.some((p) => p.endsWith("attachments/review-kit/compiled.json"))).toBe(true);
    expect(existsSync(kit(packDir, "references", "guide.md"))).toBe(false);
  });

  test("a dry run and a failed verb leave no emitted folder", async () => {
    const { baseDir, packDir, compile, materialize } = seedBaseAndTeam();
    await compile("--dry-run");
    expect(existsSync(kit(packDir))).toBe(false);

    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:does-not-exist", forge: "mattstack:gitlab-forge" } } }));
    materialize();
    const failed = await compile();
    expect(failed.exitCode).toBeDefined();
    expect(failed.exitCode).not.toBe(0);
    expect(existsSync(kit(packDir))).toBe(false);
  });

  test("a failed verb leaves a stale emitted folder in place", async () => {
    const { baseDir, packDir, compile, materialize } = seedBaseAndTeam();
    await compile();
    rmSync(join(baseDir, "attachments", "review-kit"), { recursive: true });
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:does-not-exist", forge: "mattstack:gitlab-forge" } } }));
    materialize();

    const failed = await compile();

    expect(failed.exitCode).toBe(1);
    expect(existsSync(kit(packDir, "compiled.json"))).toBe(true);
  });

  test("an extends naming a missing base fails compilePackAll and anatomy with the plan error", async () => {
    const { mattstackDir, packDir } = seedBaseAndTeam();
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "gadgets-base" }));
    const message = "widgets extends gadgets-base, but the org has no base pack called gadgets-base";

    const result = await compilePackAll({ packDir, mattstackDir });
    expect(result).toEqual({ ok: false, errors: [message], written: [], removed: [] });

    const anatomy = await runExpectingCleanExit(() =>
      skillsAnatomy(["--skill", "watch-ci", "--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--json"]));
    expect(anatomy.exitCode).toBe(1);
    expect(anatomy.errors[0]).toBe("This pack's base cannot be used");
    expect(anatomy.errors.join("\n")).toContain(message);
  });

  test("an extends pack with no plugin.json refuses before anything is copied", async () => {
    const { mattstackDir, packDir, compile, manifestFile } = seedBaseAndTeam();
    rmSync(join(packDir, ".claude-plugin", "plugin.json"));
    const message = `${join(packDir, ".claude-plugin", "plugin.json")} is missing; every compiled skill is stamped with the pack's name and version`;

    const refused = await compile();
    expect(refused.exitCode).toBeDefined();
    expect(refused.exitCode).not.toBe(0);
    expect(refused.errors.join("\n")).toContain(join(packDir, ".claude-plugin", "plugin.json"));
    expect(existsSync(kit(packDir))).toBe(false);

    expect(await compilePackAll({ packDir, mattstackDir, manifest: manifestFile() })).toEqual({ ok: false, errors: [message], written: [], removed: [] });
  });

  test("a copied attachment's dead relative link out of the pack is a warning, and the copy still lands", async () => {
    const { packDir, compile } = seedBaseAndTeam({ baseFiles: { "attachments/gates-note/SKILL.md": "---\nname: gates-note\n---\nSee `../../../stage-gates/SKILL.md`.\n" } });
    const { exitCode } = await compile();
    expect(exitCode).toBeUndefined();
    const printed = io.lines().join("\n");
    expect(printed).toContain("Copied gates-note");
    expect(printed).toContain("SKILL.md references ../../../stage-gates/SKILL.md which is not an emitted file");
    expect(existsSync(join(packDir, "attachments", "gates-note", "SKILL.md"))).toBe(true);
  });

  test("the human output names what was copied", async () => {
    const { baseDir, compile } = seedBaseAndTeam();
    await compile();
    const copied = io.lines().join("\n");
    expect(copied).toContain("Copied review-kit");
    expect(copied).toContain("from acme-base, 3 files");

    rmSync(join(baseDir, "attachments", "review-kit"), { recursive: true });
    await compile();
    expect(io.lines().join("\n")).toContain("Removed review-kit");
  });

  test("isCompiledDir treats an emitted folder as compiled", async () => {
    const { packDir, compile } = seedBaseAndTeam();
    writeFile(join(packDir, "attachments", "own", "SKILL.md"), "---\nname: own\n---\nours\n");
    await compile();

    const { rows } = computeRows(packDir, new Set(["watch-ci"]), null, new Set());
    expect(rows.find((r) => r.name === "review-kit")?.kind).toBe("compiled");
    expect(rows.find((r) => r.name === "own")?.kind).toBe("hand-authored");
  });

  test("a grouped base attachment is copied to its relative path, checked under that name, and removed with its emptied group", async () => {
    const { mattstackDir, baseDir, packDir, compile } = seedBaseAndTeam();
    const group = (...rest: string[]) => join(baseDir, "attachments", "review", ...rest);
    const team = (...rest: string[]) => join(packDir, "attachments", "review", ...rest);
    writeFile(group("self-review", "SKILL.md"), "---\nname: self-review\n---\nRead {{verb.path:watch-ci}}.\n");
    writeFile(group("receive-review", "SKILL.md"), "---\nname: receive-review\n---\nbody\n");

    expect((await compile()).errors).toEqual([]);
    expect(readFileSync(team("self-review", "SKILL.md"), "utf8")).toBe(`---\nname: self-review\n---\n${openingLine("widgets@0.1.0:self-review")}\n\nRead @watch-ci/SKILL.md.\n`);
    expect(JSON.parse(readFileSync(team("self-review", "compiled.json"), "utf8"))).toMatchObject({ base: "acme-base", version: null, files: ["SKILL.md"], id: "widgets@0.1.0:self-review", dir: "attachments/review/self-review" });
    expect(existsSync(team("compiled.json"))).toBe(false);
    expect(io.lines().join("\n")).toContain("Copied review/self-review");

    const payload = await checkPack({ packDir, mattstackDir });
    expect(payload.attachments.map((row) => [row.name, row.status]).sort()).toEqual([["review-kit", "in-sync"], ["review/receive-review", "in-sync"], ["review/self-review", "in-sync"]]);
    expect(payload.drift).toBe(false);

    rmSync(group("self-review"), { recursive: true });
    expect((await compile()).errors).toEqual([]);
    expect(existsSync(team("self-review"))).toBe(false);
    expect(existsSync(team("receive-review", "compiled.json"))).toBe(true);

    rmSync(group(), { recursive: true });
    expect((await compile()).errors).toEqual([]);
    expect(existsSync(team())).toBe(false);
  });

  test("a grouped unit whose leaf collides is a plan error, never the duplicate-name throw, in a pack with a surface", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam();
    writeFile(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["watch-ci"] }));
    writeFile(join(baseDir, "attachments", "review", "watch-ci", "SKILL.md"), "---\nname: watch-ci\n---\nbody\n");
    writeFile(join(baseDir, "attachments", "review", "self-review", "SKILL.md"), "---\nname: self-review\n---\nbody\n");
    writeFile(join(packDir, "attachments", "self-review", "SKILL.md"), "---\nname: self-review\n---\nours\n");

    const refused = await compile();

    expect(refused.exitCode).toBeDefined();
    expect(refused.exitCode).not.toBe(0);
    const shown = refused.errors.join("\n");
    expect(shown).toContain("acme-base attachment review/watch-ci has the same name as the widgets verb watch-ci; rename one of them");
    expect(shown).toContain("acme-base attachment review/self-review has the same name as the widgets attachment attachments/self-review; rename one of them");
    expect(shown).not.toContain("appears twice");
    expect(existsSync(join(packDir, "attachments", "review"))).toBe(false);
  });

  test("a base that turns a flat attachment into a group replaces the flat copy, and pack.path reaches the grouped file", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam();
    writeFile(join(baseDir, "attachments", "review", "SKILL.md"), "---\nname: review\n---\nflat\n");
    expect((await compile()).errors).toEqual([]);
    expect(existsSync(join(packDir, "attachments", "review", "compiled.json"))).toBe(true);

    rmSync(join(baseDir, "attachments", "review", "SKILL.md"));
    writeFile(join(baseDir, "attachments", "review", "self-review", "SKILL.md"), "---\nname: self-review\n---\nbody\n");
    writeFile(join(baseDir, "attachments", "review", "self-review", "x.md"), "x\n");
    writeFile(join(baseDir, "attachments", "review-kit", "SKILL.md"), "---\nname: review-kit\n---\nSee {{pack.path:review/self-review/x.md}}.\n");

    expect((await compile()).errors).toEqual([]);

    expect(existsSync(join(packDir, "attachments", "review", "compiled.json"))).toBe(false);
    expect(existsSync(join(packDir, "attachments", "review", "SKILL.md"))).toBe(false);
    expect(existsSync(join(packDir, "attachments", "review", "self-review", "compiled.json"))).toBe(true);
    expect(readFileSync(kit(packDir, "SKILL.md"), "utf8")).toContain("@self-review/x.md");
  });

  test("a group folder that still holds the team's own files outlives its last emitted unit", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam();
    writeFile(join(baseDir, "attachments", "review", "self-review", "SKILL.md"), "---\nname: self-review\n---\nbody\n");
    await compile();
    writeFile(join(packDir, "attachments", "review", "notes.md"), "ours\n");

    rmSync(join(baseDir, "attachments", "review"), { recursive: true });
    expect((await compile()).errors).toEqual([]);

    expect(existsSync(join(packDir, "attachments", "review", "self-review"))).toBe(false);
    expect(readFileSync(join(packDir, "attachments", "review", "notes.md"), "utf8")).toBe("ours\n");
  });

  test("a group folder holding emitted units is not a skill of its own, and its units read as compiled", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam();
    writeFile(join(baseDir, "attachments", "review", "self-review", "SKILL.md"), "---\nname: self-review\n---\nbody\n");
    await compile();

    const { rows } = computeRows(packDir, new Set(["watch-ci"]), null, new Set());
    expect(rows.find((r) => r.name === "self-review")?.kind).toBe("compiled");
    expect(rows.find((r) => r.name === "review")).toBeUndefined();
  });

  test("a field written only by an emitted base attachment counts as written, and its reads are checked", async () => {
    const reader = DOMAIN_SKILL_MD + "Read it: run_field_get {key: extra.plan-verdict}\n";
    const writer = "---\nname: plan-writer\ndescription: records the verdict\n---\nWrite it: run_field_set {key: extra.plan-verdict, value: yes, stage: plan}\n";
    const withWriter = seedBaseAndTeam({ domainBody: reader, baseFiles: { "attachments/plan-writer/SKILL.md": writer } });

    expect((await withWriter.compile()).errors).toEqual([]);
    expect(existsSync(join(withWriter.packDir, "attachments", "plan-writer", "SKILL.md"))).toBe(true);

    const noWriter = seedBaseAndTeam({ domainBody: reader });
    const refused = await noWriter.compile();
    expect(refused.exitCode).toBe(1);
    expect(refused.errors.join("\n")).toContain('reads "extra.plan-verdict", which nothing in this pack writes');

    const emittedReader = seedBaseAndTeam({ baseFiles: { "attachments/plan-reader/SKILL.md": "---\nname: plan-reader\ndescription: reads the verdict\n---\nRead it: run_field_get {key: extra.plan-verdict}\n" } });
    const emittedRefused = await emittedReader.compile();
    expect(emittedRefused.exitCode).toBe(1);
    expect(emittedRefused.errors.join("\n")).toContain("field contract: attachments/plan-reader/SKILL.md:");
  });

  test("a pack that extends a base but has no verbs still emits", async () => {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    const baseDir = join(mattstackDir, "orgs", "acme", "mattstack", "org", "packs", "acme-base");
    const packDir = teamPackDir(mattstackDir, "acme", "widgets");
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true }));
    writeFile(join(baseDir, "attachments", "review-kit", "SKILL.md"), "---\nname: review-kit\n---\nInvoke {{pack.name}}:ship.\n");
    writeFile(join(baseDir, "attachments", "review-kit", "references", "guide.md"), "Notes for {{pack.name}}.\n");
    writeFile(join(baseDir, "attachments", "review-kit", "scripts", "run.sh"), "#!/bin/sh\necho hi\n");
    writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
    if (out.kind !== "written") throw new Error(out.kind);

    const { errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir]));

    expect(errors).toEqual([]);
    expect(existsSync(kit(packDir, "compiled.json"))).toBe(true);
    expect(readFileSync(kit(packDir, "SKILL.md"), "utf8")).toBe("---\nname: review-kit\n---\nInvoke widgets:ship.\n");

    rmSync(kit(packDir), { recursive: true });
    io.clear();
    await skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--json"]);
    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.verbs).toEqual([]);
    expect(payload.written).toBe(true);
    expect(existsSync(kit(packDir, "compiled.json"))).toBe(true);
  });

  test("a scoped compile still emits and removes across the whole base set", async () => {
    const { baseDir, packDir, compile } = seedBaseAndTeam();
    writeFile(join(baseDir, "attachments", "gadgets-kit", "SKILL.md"), "---\nname: gadgets-kit\n---\ngadgets\n");

    expect((await compile("--verb", "watch-ci")).errors).toEqual([]);
    expect(existsSync(kit(packDir, "compiled.json"))).toBe(true);
    expect(existsSync(join(packDir, "attachments", "gadgets-kit", "compiled.json"))).toBe(true);

    rmSync(join(baseDir, "attachments", "gadgets-kit"), { recursive: true });
    expect((await compile("--verb", "watch-ci")).errors).toEqual([]);
    expect(existsSync(join(packDir, "attachments", "gadgets-kit"))).toBe(false);
    expect(existsSync(kit(packDir, "compiled.json"))).toBe(true);
  });

  test("a scoped check reports no attachment rows", async () => {
    const { mattstackDir, packDir } = seedBaseAndTeam();

    await skillsCheck(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci", "--json"]);

    expect(JSON.parse(io.lines()[0]!).attachments).toEqual([]);
  });

  test("a preview reaches an emitted file through pack.path on a clean tree", async () => {
    const { packDir, compile } = seedBaseAndTeam({ domainBody: PACK_PATH_DOMAIN, baseFiles: NOTES_KIT });

    const { errors } = await compile("--preview", "--verb", "watch-ci");

    expect(errors).toEqual([]);
    expect(io.stdout()).toContain("@watch-ci/references/notes-kit/references/guide.md");
    expect(existsSync(notes(packDir))).toBe(false);
  });

  test("anatomy resolves pack.path to an emitted file on a clean tree", async () => {
    const { mattstackDir, packDir } = seedBaseAndTeam({ domainBody: PACK_PATH_DOMAIN, baseFiles: NOTES_KIT });

    const { errors } = await runExpectingCleanExit(() =>
      skillsAnatomy(["--skill", "watch-ci", "--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--json"]));

    expect(errors).toEqual([]);
    expect(io.lines().join("\n")).toContain("references/notes-kit/references/guide.md");
  });

  describe("check", () => {
    const inSync = { name: "review-kit", base: "acme-base", status: "in-sync" as const, staleFiles: [] as string[], orphanFiles: [] as string[] };
    const guide = (baseDir: string) => join(baseDir, "attachments", "review-kit", "references", "guide.md");

    test("check is clean right after a compile", async () => {
      const { mattstackDir, packDir, compile } = seedBaseAndTeam();
      await compile();

      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.attachments).toEqual([inSync]);
      expect(payload.drift).toBe(false);
    });

    test("a base change is drift", async () => {
      const { mattstackDir, baseDir, packDir, compile } = seedBaseAndTeam();
      await compile();
      writeFileSync(guide(baseDir), readFileSync(guide(baseDir), "utf8") + "One more line.\n");

      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.attachments).toEqual([{ ...inSync, status: "stale", staleFiles: ["references/guide.md"] }]);
      expect(payload.drift).toBe(true);
    });

    test("a copied script that lost its executable bit is stale", async () => {
      const { mattstackDir, packDir, compile } = seedBaseAndTeam();
      await compile();
      chmodSync(kit(packDir, "scripts", "run.sh"), 0o644);

      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.attachments).toEqual([{ ...inSync, status: "stale", staleFiles: ["scripts/run.sh"] }]);
      expect(payload.drift).toBe(true);
    });

    test("a base file removed is an orphan; a base version bump alone is not drift", async () => {
      const { mattstackDir, baseDir, packDir, compile } = seedBaseAndTeam();
      await compile();
      writeFile(join(baseDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "2.0.0" }));

      expect((await checkPack({ packDir, mattstackDir })).attachments).toEqual([inSync]);

      rmSync(join(baseDir, "attachments", "review-kit", "scripts", "run.sh"));
      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.attachments).toEqual([{ ...inSync, status: "stale", staleFiles: ["compiled.json"], orphanFiles: ["scripts/run.sh"] }]);
      expect(payload.drift).toBe(true);
    });

    test("never compiled and orphaned", async () => {
      const { mattstackDir, baseDir, packDir, compile } = seedBaseAndTeam();

      expect((await checkPack({ packDir, mattstackDir })).attachments).toEqual([{ ...inSync, status: "never-compiled" }]);

      await compile();
      rmSync(join(baseDir, "attachments", "review-kit"), { recursive: true });
      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.attachments).toEqual([{
        name: "review-kit",
        base: null,
        status: "orphaned",
        staleFiles: [],
        orphanFiles: ["SKILL.md", "compiled.json", "references/guide.md", "scripts/run.sh"],
      }]);
      expect(payload.drift).toBe(true);
    });

    test("the human output names drift and the fix", async () => {
      const { mattstackDir, baseDir, packDir, compile } = seedBaseAndTeam();
      await compile();
      writeFileSync(guide(baseDir), readFileSync(guide(baseDir), "utf8") + "One more line.\n");
      io.clear();

      await skillsCheck(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir]);

      const shown = io.stdout();
      expect(shown).toContain("review-kit");
      expect(shown).toContain("changed since the last compile: references/guide.md");
      expect(shown).toContain("rt skills compile");
      expect(process.exitCode).toBe(1);
    });

    test("a folder left after extends was dropped says the pack no longer extends a base", async () => {
      const { mattstackDir, packDir, compile, materialize } = seedBaseAndTeam();
      await compile();
      writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:watch-ci": { forge: "mattstack:gitlab-forge" } } }));
      materialize();
      io.clear();

      await skillsCheck(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir]);

      expect(io.stdout()).toContain("review-kit  this pack no longer extends a base");
    });

    test("run leftovers are not drift", async () => {
      const { mattstackDir, packDir, compile } = seedBaseAndTeam();
      await compile();
      writeFile(kit(packDir, "scripts", "__pycache__", "run.cpython-312.pyc"), "bytes");
      writeFile(kit(packDir, ".DS_Store"), "bytes");

      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.attachments).toEqual([inSync]);
      expect(payload.drift).toBe(false);
    });

    test("a plan error is drift carried in baseErrors, with no attachment rows", async () => {
      const { mattstackDir, baseDir, packDir } = seedBaseAndTeam();
      writeFile(join(baseDir, "attachments", "watch-ci", "SKILL.md"), "---\nname: watch-ci\n---\nbase copy\n");

      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.baseErrors).toEqual(["acme-base attachment watch-ci has the same name as the widgets verb watch-ci; rename one of them"]);
      expect(payload.attachments).toEqual([]);
      expect(payload.drift).toBe(true);
    });

    test("check --json prints its envelope when extends names a missing base", async () => {
      const { mattstackDir, packDir, compile } = seedBaseAndTeam();
      await compile();
      writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "gadgets-base" }));
      io.clear();

      const { errors } = await runExpectingCleanExit(() =>
        skillsCheck(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--json"]));

      expect(errors).toEqual([]);
      const payload = JSON.parse(io.stdout());
      expect(payload.baseErrors).toEqual(["widgets extends gadgets-base, but the org has no base pack called gadgets-base"]);
      expect(payload.attachments).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect((await checkPack({ packDir, mattstackDir })).drift).toBe(true);
    });
  });

  test("a pack that never extends keeps a hand-authored compiled.json", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "skills.jsonc"), "{}");
    writeFile(join(packDir, "attachments", "data", "compiled.json"), `{"rows": []}\n`);
    writeFile(join(packDir, "attachments", "data", "SKILL.md"), "---\nname: data\n---\nrows\n");

    const { errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]));

    expect(errors).toEqual([]);
    expect(readFileSync(join(packDir, "attachments", "data", "compiled.json"), "utf8")).toBe(`{"rows": []}\n`);
    expect(existsSync(join(packDir, "attachments", "data", "SKILL.md"))).toBe(true);
  });

  test("a pack that never extends keeps a data folder whose compiled.json has a base key", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    const data = `{"base":"https://api.example","rows":[]}`;
    writeFile(join(packDir, "pack", "skills.jsonc"), "{}");
    writeFile(join(packDir, "attachments", "data", "compiled.json"), data);

    const { errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--team", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]));

    expect(errors).toEqual([]);
    expect(readFileSync(join(packDir, "attachments", "data", "compiled.json"), "utf8")).toBe(data);
  });

  describe("team values in base text", () => {
    const DOMAIN_WITH_TEAM = DOMAIN_SKILL_MD + "Linear team: {{team.linear-team}}.\n";
    const CI_NOTES_MD = "---\nname: ci-notes\ndescription: CI notes\n---\nExtra jobs:\n{{team.section:ci-extra}}\n";
    const TWO_VERBS = JSON.stringify({ verbs: {
      "watch-ci": { engine: "watch-ci", description: "Use when watching or triaging CI." },
      "triage-ci": { engine: "watch-ci", description: "Use when sorting CI failures." },
    } });
    const TITLE = "The widgets pack is missing values the acme-base pack asks for";

    function seedTeamValues(opts: { domainBody?: string; ciNotes?: boolean } = {}) {
      const seeded = seedBaseAndTeam({
        domainBody: opts.domainBody ?? DOMAIN_WITH_TEAM,
        baseFiles: opts.ciNotes === false ? {} : { "attachments/ci-notes/SKILL.md": CI_NOTES_MD },
      });
      writeFile(join(seeded.packDir, "pack", "stubs.jsonc"), TWO_VERBS);
      const setValues = (params: Record<string, string>, sections: Record<string, string> = {}) => {
        writeFile(join(seeded.packDir, "pack", "params.jsonc"), JSON.stringify({ version: 1, params }));
        for (const [name, text] of Object.entries(sections)) writeFile(join(seeded.packDir, "pack", "sections", `${name}.md`), text);
      };
      const run = (argv: string[]) => runSkillsCapturing([...argv, "--team", "widgets", "--pack-dir", seeded.packDir, "--mattstack-dir", seeded.mattstackDir]);
      return { ...seeded, setValues, run };
    }

    function filesUnder(dir: string): Record<string, string> {
      const files: Record<string, string> = {};
      for (const side of ["skills", "attachments"]) {
        const root = join(dir, side);
        if (!existsSync(root)) continue;
        for (const rel of readdirSync(root, { recursive: true }) as string[]) {
          const abs = join(root, rel);
          if (statSync(abs).isFile()) files[`${side}/${rel}`] = readFileSync(abs, "utf8");
        }
      }
      return files;
    }

    test("compile refuses with every missing value listed and writes nothing", async () => {
      const { packDir, mattstackDir, compile, setValues } = seedTeamValues();

      const { exitCode, errors } = await compile();

      expect(exitCode).toBe(1);
      expect(errors[0]).toBe(TITLE);
      expect(errors).toContain("  pack/params.jsonc: linear-team (acme-base:watch-ci-domain)");
      expect(errors).toContain("  pack/sections/ci-extra.md (acme-base:attachments/ci-notes/SKILL.md)");
      expect(errors.join("\n")).toContain("rt skills compile --pack widgets");
      expect(existsSync(join(packDir, "skills"))).toBe(false);
      expect(existsSync(join(packDir, "attachments", "ci-notes"))).toBe(false);
      expect(existsSync(join(packDir, "attachments", "review-kit"))).toBe(false);
      expect(existsSync(join(packDir, "pack", "requires.json"))).toBe(false);

      const viaSync = await compilePackAll({ packDir, mattstackDir });
      expect(viaSync.ok).toBe(false);
      expect(viaSync.errors[0]).toBe(TITLE);
      expect(viaSync.written).toEqual([]);
      expect(viaSync.missing).toEqual([
        { kind: "param", name: "linear-team", file: "pack/params.jsonc", askedBy: ["acme-base:watch-ci-domain"] },
        { kind: "section", name: "ci-extra", file: "pack/sections/ci-extra.md", askedBy: ["acme-base:attachments/ci-notes/SKILL.md"] },
      ]);

      setValues({ "linear-team": "Widgets" }, { "ci-extra": "- lint\n- e2e\n" });
      expect((await compilePackAll({ packDir, mattstackDir })).ok).toBe(true);
      expect(readFileSync(join(packDir, "skills", "triage-ci", "SKILL.md"), "utf8")).toContain("Linear team: Widgets.");
      expect(readFileSync(join(packDir, "attachments", "ci-notes", "SKILL.md"), "utf8")).toContain("Extra jobs:\n- lint\n- e2e\n");
      expect(JSON.parse(readFileSync(join(packDir, "pack", "requires.json"), "utf8"))).toEqual({ minEngine: POINTER_KEYS_MIN_ENGINE });
    });

    test("--json carries missing beside the verb rows and exits 1", async () => {
      const { packDir, compile } = seedTeamValues();

      const { exitCode } = await compile("--json");

      expect(exitCode).toBeUndefined();
      expect(process.exitCode).toBe(1);
      const payload = JSON.parse(io.lines().at(-1)!);
      expect(payload.written).toBe(false);
      expect(payload.missing.map((m: { kind: string; name: string }) => `${m.kind}:${m.name}`)).toEqual(["param:linear-team", "section:ci-extra"]);
      expect(existsSync(join(packDir, "skills"))).toBe(false);
    });

    test("check lists missing values as a compile error and drops the stale rows a hole would cause", async () => {
      const { packDir, mattstackDir, compile, setValues } = seedTeamValues();
      setValues({ "linear-team": "Widgets" }, { "ci-extra": "- lint\n" });
      expect((await compile()).errors).toEqual([]);

      setValues({});
      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.drift).toBe(true);
      expect(payload.compileErrors).toContain(TITLE);
      expect(payload.compileErrors).toContain("pack/params.jsonc: linear-team (acme-base:watch-ci-domain)");
      expect(renderPlain(checkBlocks(payload, false))).toContain("pack/params.jsonc: linear-team (acme-base:watch-ci-domain)");
      expect(payload.verbs.filter((row) => row.status === "stale")).toEqual([]);
      expect(payload.attachments.filter((row) => row.status === "stale")).toEqual([]);
    });

    test("check reports a params edit as drift", async () => {
      const { packDir, mattstackDir, compile, setValues } = seedTeamValues();
      setValues({ "linear-team": "Widgets" }, { "ci-extra": "- lint\n" });
      expect((await compile()).errors).toEqual([]);
      expect((await checkPack({ packDir, mattstackDir })).drift).toBe(false);

      setValues({ "linear-team": "Gadgets" });
      const payload = await checkPack({ packDir, mattstackDir });

      expect(payload.drift).toBe(true);
      expect(payload.verbs.find((row) => row.name === "watch-ci")?.status).toBe("stale");
      expect(payload.compileErrors).toEqual([]);
    });

    test("a hand-typed path in a section or a param value fails compile and check at its own file and line", async () => {
      const { packDir, mattstackDir, compile, setValues } = seedTeamValues();
      writeFile(join(packDir, "attachments", "widgets-gates", "SKILL.md"), "gates\n");
      setValues({ "linear-team": "Widgets", gates: "../../attachments/widgets-gates/SKILL.md" }, { "ci-extra": "- lint\n- read ../../attachments/widgets-gates/SKILL.md\n" });
      const sectionLine = "pack/sections/ci-extra.md:2:8: hand-typed path ../../attachments/widgets-gates/SKILL.md breaks when its target moves; write {{pack.path:widgets-gates/SKILL.md}} instead";

      const { exitCode, errors } = await compile();
      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toContain(sectionLine);
      expect(errors.join("\n")).toMatch(/pack\/params\.jsonc:1:\d+: hand-typed path \.\.\/\.\.\/attachments\/widgets-gates\/SKILL\.md/);
      expect(existsSync(join(packDir, "skills"))).toBe(false);

      const payload = await checkPack({ packDir, mattstackDir });
      expect(payload.drift).toBe(true);
      expect(payload.compileErrors).toContain(sectionLine);

      setValues({ "linear-team": "Widgets", gates: "{{pack.path:widgets-gates/SKILL.md}}" }, { "ci-extra": "- lint\n- read {{pack.path:widgets-gates/SKILL.md}}\n" });
      expect((await compile()).errors).toEqual([]);
    });

    const DOMAIN_WITH_SECTION = DOMAIN_SKILL_MD + "Rules:\n{{team.section:ci-extra}}\nDone.\n";

    test("a section inlined into a prop value is its own anatomy part, and an edit to it is a team change", async () => {
      const { packDir, mattstackDir, compile, setValues, run } = seedTeamValues({ domainBody: DOMAIN_WITH_SECTION, ciNotes: false });
      setValues({}, { "ci-extra": "- lint\n- e2e\n- deploy\n" });
      expect((await compile()).errors).toEqual([]);
      const rendered = readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8");
      const lines = rendered.split("\n");
      const seamAt = lines.findIndex((l) => l.startsWith("<!-- part: section:ci-extra "));
      expect(seamAt).toBeGreaterThan(0);

      io.clear();
      await run(["anatomy", "--skill", "watch-ci", "--json"]);
      const anatomy = JSON.parse(io.stdout());
      const section = anatomy.parts.find((p: { kind: string }) => p.kind === "section");
      expect(section).toMatchObject({ name: "ci-extra", renderedLines: [seamAt + 1, seamAt + 4], changed: false });
      expect(section.source).toMatchObject({ ref: "widgets:pack/sections/ci-extra.md", version: "0.1.0", lines: 3 });
      expect(section.source.path).toBe(join(packDir, "pack", "sections", "ci-extra.md"));
      const domain = anatomy.parts.find((p: { kind: string; name: string }) => p.kind === "prop" && p.name === "watch-ci.domain");
      expect(domain.renderedLines[0]).toBeLessThan(seamAt + 1);
      expect(domain.renderedLines[1]).toBeGreaterThanOrEqual(seamAt + 5);
      expect(anatomy.status).toBe("in-sync");

      setValues({}, { "ci-extra": "- lint\n- e2e\n- deploy\n- smoke\n" });
      const payload = await checkPack({ packDir, mattstackDir });
      expect(payload.verbs.find((row) => row.name === "watch-ci")).toMatchObject({ status: "stale", staleBecause: ["team"] });
      expect(renderPlain(checkBlocks(payload, false))).toContain("watch-ci  team values moved: SKILL.md");
      io.clear();
      await run(["anatomy", "--skill", "watch-ci", "--json"]);
      const stale = JSON.parse(io.stdout());
      expect(stale).toMatchObject({ status: "stale", staleBecause: ["team"] });
      expect(stale.parts.find((p: { kind: string }) => p.kind === "section")).toMatchObject({ changed: true });
    });

    const DOMAIN_WITH_ABSENT = DOMAIN_SKILL_MD + "Rules:\n{{team.section:ci-a?}}\n{{team.section:ci-b?}}\nDone.\n";

    test("absent optional sections drop their lines without the prop value's extent running into the next one", async () => {
      const { packDir, compile, run } = seedTeamValues({ domainBody: DOMAIN_WITH_ABSENT, ciNotes: false });
      expect((await compile()).errors).toEqual([]);
      const rendered = readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8");
      expect(rendered).not.toContain("ci-a");
      const lines = rendered.split("\n");
      const domain = partExtents(rendered).find((x) => x.key === "prop:watch-ci.domain")!;
      expect(lines[domain.end]).toBe("Done.");

      const forgeAt = lines.findIndex((l) => l.startsWith("For forge, invoke the"));
      expect(forgeAt).toBeGreaterThan(domain.end);
      lines[forgeAt] += " edited";
      expect([...changedPartKeys(lines.join("\n"), rendered)]).toEqual(["prop:watch-ci.forge"]);

      io.clear();
      await run(["anatomy", "--skill", "watch-ci", "--json"]);
      const part = JSON.parse(io.stdout()).parts.find((p: { kind: string; name: string }) => p.kind === "prop" && p.name === "watch-ci.domain");
      expect(part.renderedLines[1]).toBe(domain.end + 1);
    });

    test("absent optional sections in a stage's prop value leave the block text after it outside the value", async () => {
      const { packDir, mattstackDir } = seedTeamValues({ domainBody: DOMAIN_WITH_ABSENT, ciNotes: false });
      writeFile(join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "stage-plan", "index.block.md"), slottedStageMd("intro\n{{props.domain}}\noutro\nmore"));
      const manifestPath = join(mattstackDir, "widgets-pipelines.jsonc");
      writeFile(manifestPath, JSON.stringify({
        pipelines: { feature: ["mattstack:stage-plan"] },
        bindings: {
          "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" },
          "mattstack:stage-plan": { domain: "acme-base:watch-ci-domain" },
        },
      }));
      const flags = ["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath];
      await runExpectingCleanExit(() => skillsCompile([...flags, "--verb", "stage-plan"]));
      io.clear();
      await skillsAnatomy([...flags, "--skill", "stage-plan", "--json"]);
      const anatomy = JSON.parse(io.stdout());
      const lines = readFileSync(anatomy.rendered.path, "utf8").split("\n");
      const prop = anatomy.parts.find((p: { kind: string }) => p.kind === "prop");
      expect(lines[prop.renderedLines[1] - 1]).toBe("Done.");
      expect(lines[prop.renderedLines[1]]).toStartWith("<!-- part: block:stage-plan ");
      expect(lines[prop.renderedLines[1] + 1]).toBe("outro");
      const extent = partExtents(lines.join("\n")).find((x) => x.key === "prop:stage-plan.domain")!;
      expect(lines[extent.end]).toBe("Done.");
    });

    test("a stage lists a section as its own part after the prop value that holds it", async () => {
      const { packDir, mattstackDir, setValues } = seedTeamValues({ domainBody: DOMAIN_WITH_SECTION, ciNotes: false });
      setValues({}, { "ci-extra": "- lint\n- e2e\n- deploy\n" });
      writeFile(join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "stage-plan", "index.block.md"), slottedStageMd("intro\n{{props.domain}}\noutro"));
      const manifestPath = join(mattstackDir, "widgets-pipelines.jsonc");
      writeFile(manifestPath, JSON.stringify({
        pipelines: { feature: ["mattstack:stage-plan"] },
        bindings: {
          "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" },
          "mattstack:stage-plan": { domain: "acme-base:watch-ci-domain" },
        },
      }));
      const flags = ["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath];
      await runExpectingCleanExit(() => skillsCompile([...flags, "--verb", "stage-plan"]));
      const anatomyOf = async () => {
        io.clear();
        await skillsAnatomy([...flags, "--skill", "stage-plan", "--json"]);
        return JSON.parse(io.stdout());
      };

      const fresh = await anatomyOf();
      const lines = readFileSync(fresh.rendered.path, "utf8").split("\n");
      const seamAt = lines.findIndex((l) => l.startsWith("<!-- part: section:ci-extra "));
      expect(fresh.parts.map((p: { kind: string }) => p.kind)).toEqual(["block", "prop", "section"]);
      const [block, prop, section] = fresh.parts;
      expect(section).toMatchObject({ name: "ci-extra", renderedLines: [seamAt + 1, seamAt + 4], changed: false, templateLines: null });
      expect(section.source).toMatchObject({ ref: "widgets:pack/sections/ci-extra.md", version: "0.1.0", lines: 3 });
      expect(prop.renderedLines[0]).toBeLessThan(seamAt + 1);
      expect(prop.renderedLines[1]).toBeGreaterThanOrEqual(seamAt + 4);
      expect(lines[block.renderedLines[1] - 1]).toBe("outro");

      setValues({}, { "ci-extra": "- lint\n- e2e\n- deploy\n- smoke\n" });
      const stale = await anatomyOf();
      expect(stale).toMatchObject({ status: "stale", staleBecause: ["team"] });
      const staleSection = stale.parts.find((p: { kind: string }) => p.kind === "section");
      expect(staleSection).toMatchObject({ changed: true, renderedLines: [seamAt + 1, seamAt + 4] });
    });

    test("preview, anatomy and composition refuse on missing values", async () => {
      const { run } = seedTeamValues();

      for (const argv of [["compile", "--preview", "--verb", "watch-ci"], ["anatomy", "--skill", "watch-ci"], ["composition"]]) {
        const { exitCode, stderr } = await run(argv);
        expect({ argv, exitCode, title: stderr.split("\n")[0]!.replace(/^\[failed\] /, "") }).toEqual({ argv, exitCode: 1, title: TITLE });
      }
      expect(io.stdout()).not.toContain("Linear team:");
    });

    test("unused key warns on a full compile", async () => {
      const { compile, setValues } = seedTeamValues();
      setValues({ "linear-team": "Widgets", "old-key": "x" }, { "ci-extra": "- lint\n" });

      expect((await compile()).errors).toEqual([]);
      expect(io.stdout()).toContain("pack/params.jsonc: old-key is not asked for by any base text this pack compiles");

      io.clear();
      await compile("--json", "--dry-run");
      expect(JSON.parse(io.lines().at(-1)!).unusedParams).toEqual(["old-key"]);
    });

    test("unused key does not warn under --verb", async () => {
      const { compile, setValues } = seedTeamValues();
      setValues({ "linear-team": "Widgets", "old-key": "x" }, { "ci-extra": "- lint\n" });

      expect((await compile("--verb", "watch-ci")).errors).toEqual([]);
      expect(io.stdout()).not.toContain("old-key");

      io.clear();
      await compile("--json", "--dry-run", "--verb", "watch-ci");
      expect(JSON.parse(io.lines().at(-1)!)).not.toHaveProperty("unusedParams");
    });

    test("a pack with no params and no markers compiles byte-identical to one whose base uses only an optional marker", async () => {
      const plain = seedTeamValues({ domainBody: DOMAIN_SKILL_MD, ciNotes: false });
      const optional = seedTeamValues({ domainBody: DOMAIN_SKILL_MD.replace("for details.", "for details.{{team.note?}}"), ciNotes: false });

      expect((await plain.compile()).errors).toEqual([]);
      expect((await optional.compile()).errors).toEqual([]);

      const files = filesUnder(plain.packDir);
      expect(Object.keys(files).length).toBeGreaterThan(0);
      expect(filesUnder(optional.packDir)).toEqual(files);
      expect(JSON.parse(readFileSync(join(plain.packDir, "pack", "requires.json"), "utf8"))).toEqual({ minEngine: POINTER_KEYS_MIN_ENGINE });
    });

    test("a team marker in a stage fill's allowed-tools refuses a scoped orchestrator compile before it reaches the orchestrator's frontmatter", async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-native-")));
      cpSync(join(import.meta.dir, "..", "..", "lib", "skills", "__tests__", "fixtures", "compile-native"), root, { recursive: true });
      const fill = join(root, "pack", "attachments", "plan-policy", "SKILL.md");
      writeFile(fill, readFileSync(fill, "utf8").replace("metadata:", 'allowed-tools:\n  - "Read({{team.x}})"\nmetadata:'));
      const ms = join(root, "mattstack-home");
      const flags = ["--pack-dir", join(root, "pack"), "--mattstack-dir", ms, "--manifest", join(ms, "repos", "my-repo", "skills.jsonc")];

      const { exitCode, stderr } = await runSkillsCapturing(["compile", ...flags, "--verb", "work", "--dry-run"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("team markers only resolve in a body, not frontmatter");
    });

    test("a team marker in a base fill's description refuses with the file line instead of being dropped with the frontmatter", async () => {
      const { packDir, compile, setValues } = seedTeamValues({ domainBody: DOMAIN_WITH_TEAM.replace('"Domain rules for watch-ci"', '"Domain rules for {{team.linear-team}}"'), ciNotes: false });
      setValues({ "linear-team": "Widgets" });

      const { exitCode, errors } = await compile();

      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toContain("acme-base:watch-ci-domain: {{team.linear-team}} -- team markers only resolve in a body, not frontmatter (line 3)");
      expect(existsSync(join(packDir, "skills"))).toBe(false);
    });

    test("a team marker in a compile-native stage fill's description refuses with the file line", async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-native-")));
      cpSync(join(import.meta.dir, "..", "..", "lib", "skills", "__tests__", "fixtures", "compile-native"), root, { recursive: true });
      const fill = join(root, "pack", "attachments", "plan-policy", "SKILL.md");
      writeFile(fill, readFileSync(fill, "utf8").replace('description: "plan-policy"', 'description: "plan-policy for {{team.x}}"'));
      const ms = join(root, "mattstack-home");
      const flags = ["--pack-dir", join(root, "pack"), "--mattstack-dir", ms, "--manifest", join(ms, "repos", "my-repo", "skills.jsonc")];

      const { exitCode, stderr } = await runSkillsCapturing(["compile", ...flags, "--verb", "stage-plan", "--dry-run"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("{{team.x}} -- team markers only resolve in a body, not frontmatter (line 3)");
    });

    test("requiredness follows each emitted target: a stage copy overridden to a team fill does not need the base fill's values", async () => {
      const { packDir, mattstackDir, setValues } = seedTeamValues({ ciNotes: false });
      writeFile(join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "stage-plan", "index.block.md"), slottedStageMd("{{props.domain}}"));
      writeFile(join(packDir, "attachments", "own-domain", "SKILL.md"), DOMAIN_SKILL_MD.replace("name: watch-ci-domain", "name: own-domain"));
      const manifestPath = join(mattstackDir, "widgets-pipelines.jsonc");
      writeFile(manifestPath, JSON.stringify({
        pipelines: {
          feature: ["mattstack:stage-plan"],
          lite: { stages: ["mattstack:stage-plan"], bindings: { "mattstack:stage-plan": { domain: "widgets:own-domain" } } },
        },
        bindings: {
          "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" },
          "mattstack:stage-plan": { domain: "acme-base:watch-ci-domain" },
        },
      }));
      const compile = (verb: string) => runExpectingCleanExit(() =>
        skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", verb]));

      expect((await compile("stage-plan--lite")).errors).toEqual([]);
      expect(existsSync(join(packDir, "attachments", "stage-plan--lite", "SKILL.md"))).toBe(true);

      const refused = await compile("stage-plan");
      expect(refused.exitCode).toBe(1);
      expect(refused.errors[0]).toBe(TITLE);
      expect(refused.errors).toContain("  pack/params.jsonc: linear-team (acme-base:watch-ci-domain)");

      setValues({ "linear-team": "Widgets" });
      expect((await compile("stage-plan")).errors).toEqual([]);
    });
  });
});

describe("skillsCompile --json write semantics", () => {
  test("--json --dry-run reports the plan, written false, and touches nothing", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--json",
      "--dry-run",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.written).toBe(false);
    expect(payload.verbs[0].status).toBe("compiled");
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("--json with an errored verb writes nothing, reports every row, exits 1", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_ONE_GOOD_TWO_BROKEN);
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--json",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
    ]);

    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.written).toBe(false);
    const statuses = Object.fromEntries(payload.verbs.map((v: { name: string; status: string }) => [v.name, v.status]));
    expect(statuses["watch-ci"]).toBe("compiled");
    expect(statuses["broken-a"]).toBe("errored");
    expect(statuses["broken-b"]).toBe("errored");
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("--preview with --json is a usage error, not a silent report", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack", "t", "--verb", "watch-ci", "--preview", "--json",
        "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("--preview");
  });

  test("--json on a rosterless pack reports written false, not a phantom success", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "stubs.jsonc"), `{ "verbs": {} }\n`);

    await skillsCompile(["--team", "t", "--json", "--pack-dir", packDir, "--mattstack-dir", mattstackDir]);

    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.verbs).toEqual([]);
    expect(payload.written).toBe(false);
  });

  test("--json --dry-run misplaced prediction matches what the real run leaves behind", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    // A real compile leaves a compiler-headed skills/watch-ci; retiring the
    // verb afterward is the transition window whose stale dir the next real
    // run sweeps -- so a dry-run must not call it misplaced.
    await skillsCompile(["--team", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);
    io.clear();
    process.exitCode = 0;

    await skillsCompile(["--team", "t", "--json", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);

    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.misplaced).toEqual([]);
    expect(process.exitCode).not.toBe(1);
  });

  test("a failure-aborted --json run does not predict sweeps: the stale dir it leaves behind stays misplaced", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    await skillsCompile(["--team", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);
    // Retire the verb AND break a sibling: the aborted run sweeps nothing,
    // so the stale compiler-headed skills/watch-ci really is still on disk.
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_TWO_VERBS);
    io.clear();
    process.exitCode = 0;

    await skillsCompile(["--team", "t", "--json", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);

    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.written).toBe(false);
    expect(payload.misplaced).toEqual(["watch-ci"]);
  });

  test("--json reports misplaced skills in the payload, not as stray stdout lines", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    writeFile(join(packDir, "skills", "stray-skill", "SKILL.md"), "# stray\n");

    await skillsCompile([
      "--team", "t",
      "--json",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    expect(io.lines()).toHaveLength(1);
    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.misplaced).toEqual(["stray-skill"]);
    expect(process.exitCode).toBe(1);
  });
});

/** A pack with no plugin identity cannot compile a verb, so the naming tests use a pack with none to compile. */
const EMPTY_ROSTER = `{ "verbs": {} }\n`;

describe("skillsCompile --pack-dir validation", () => {
  test("--pack-dir without a value is a usage error, not a silent fallthrough", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir"]));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("--pack-dir");
  });

  test("--pack-dir pointing at a missing directory is a usage error, not an empty exit 0", async () => {
    const mattstackDir = makeMattstackDir();
    const manifestPath = makeManifest();
    const missing = join(tmpdir(), "rt-skills-no-such-pack-dir");

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir", missing, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--dry-run"]));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain(missing);
  });

  test("--pack-dir pointing at a regular file is a usage error", async () => {
    const mattstackDir = makeMattstackDir();
    const manifestPath = makeManifest();
    const filePath = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-file-"))), "not-a-dir");
    writeFileSync(filePath, "");

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir", filePath, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--dry-run"]));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain(filePath);
  });

  test("--pack-dir derives the team from the pack's plugin identity, not the directory basename", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "t", version: "0.0.1" }));
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci", "--dry-run", "--json"]);

    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.pack).toBe("t");
  });

  test("--pack-dir on a team plugin folder with no plugin identity names the team, not plugin", async () => {
    const mattstackDir = makeMattstackDir();
    const clone = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-clone-")));
    const packDir = join(clone, "mattstack", "teams", "widgets", "plugin");
    writeFile(join(packDir, "pack", "stubs.jsonc"), EMPTY_ROSTER);
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--dry-run", "--json"]);

    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.pack).toBe("widgets");
    expect(payload.verbs).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("--pack-dir on any other folder with no plugin identity still names the folder", async () => {
    const mattstackDir = makeMattstackDir();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-flat-")));
    const packDir = join(root, "plugins", "gadgets");
    writeFile(join(packDir, "pack", "stubs.jsonc"), EMPTY_ROSTER);
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--dry-run", "--json"]);

    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.pack).toBe("gadgets");
    expect(payload.verbs).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe("skillsCompile pack resolution from cwd", () => {
  test("empty --pack inside a pack tree resolves the enclosing pack's own name, not an empty team", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "t", version: "0.0.1" }));
    const manifestPath = makeManifest();

    const prevCwd = process.cwd();
    process.chdir(packDir);
    try {
      await skillsCompile(["--pack", "", "--dry-run", "--json", "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);
    } finally {
      process.chdir(prevCwd);
    }

    const payload = JSON.parse(io.lines()[0]!);
    expect(payload.pack).toBe("t");
  });

  test("cwd inside a pack dir resolves that pack when no --pack/--pack-dir is given", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    const manifestPath = makeManifest();

    const prevCwd = process.cwd();
    process.chdir(packDir);
    try {
      const { exitCode, errors } = await runExpectingCleanExit(() =>
        skillsCompile(["--dry-run", "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]));
      expect(errors).toEqual([expect.stringContaining("Using the pack this folder is inside")]);
      expect(exitCode).toBeUndefined();
    } finally {
      process.chdir(prevCwd);
    }

    expect(io.lines().some((l) => /would write \d+ files/.test(l) && l.includes("watch-ci"))).toBe(true);
  });

  test("cwd below the pack root still resolves the enclosing pack", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    const manifestPath = makeManifest();

    const prevCwd = process.cwd();
    process.chdir(join(packDir, "pack"));
    try {
      const { exitCode, errors } = await runExpectingCleanExit(() =>
        skillsCompile(["--dry-run", "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]));
      expect(errors).toEqual([expect.stringContaining("Using the pack this folder is inside")]);
      expect(exitCode).toBeUndefined();
    } finally {
      process.chdir(prevCwd);
    }

    expect(io.lines().some((l) => /would write \d+ files/.test(l) && l.includes("watch-ci"))).toBe(true);
  });

  test("--pack matching the enclosing pack's plugin name resolves to the enclosing dir, not the registry", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "t", version: "0.0.1" }));
    const manifestPath = makeManifest();

    const prevCwd = process.cwd();
    process.chdir(packDir);
    try {
      const { exitCode, errors } = await runExpectingCleanExit(() =>
        skillsCompile(["--pack", "t", "--dry-run", "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]));
      expect(errors).toEqual([expect.stringContaining("Using the pack this folder is inside")]);
      expect(exitCode).toBeUndefined();
    } finally {
      process.chdir(prevCwd);
    }

    expect(io.lines().some((l) => /would write \d+ files/.test(l) && l.includes("watch-ci"))).toBe(true);
  });

  test("--pack naming a different pack does not hijack onto the enclosing dir", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    const manifestPath = makeManifest();

    const prevCwd = process.cwd();
    process.chdir(packDir);
    try {
      const { exitCode, errors } = await runExpectingCleanExit(() =>
        skillsCompile(["--pack", "other", "--dry-run", "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]));
      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toContain("No pack is called other");
    } finally {
      process.chdir(prevCwd);
    }
  });
});

/**
 * A "work" orchestrator (places {{pipeline.stages}}) plus one stage
 * (metadata.stage: plan) declared via the manifest's pipelines map -- the
 * minimal fixture for exercising --verb scoping across the roster-verb and
 * pipeline-stage name spaces together.
 */
function makePipelineFixtures(): { mattstackDir: string; packDir: string; manifestPath: string } {
  const mattstackDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-pipeline-mattstack-")));
  const mattstackPluginDir = join(mattstackDir, "plugins", "mattstack");
  writeFile(join(mattstackPluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  writeFile(
    join(mattstackPluginDir, "attachments", "pipeline", "work", "index.block.md"),
    `---\nname: work\ndescription: "Run the work pipeline"\ntype: pipeline-step\n---\n\n{{work-type}}\n{{pipeline.stages}}\n`,
  );
  writeFile(join(mattstackPluginDir, "attachments", "pipeline", "stage-plan", "index.block.md"), stageSkillMd("stage-plan", "plan"));

  const packDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-pipeline-pack-")));
  writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
  writeFile(join(packDir, "pack", "stubs.jsonc"), `{ "verbs": { "work": { "engine": "work", "description": "Run the pipeline." } } }\n`);
  writeFile(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["work"] }));

  const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-pipeline-manifest-")));
  const manifestPath = join(manifestDir, "skills.jsonc");
  writeFile(manifestPath, `{\n  "pipelines": { "feature": ["mattstack:stage-plan"] },\n  "bindings": {}\n}\n`);

  return { mattstackDir, packDir, manifestPath };
}

describe("skillsCompile/skillsCheck --verb scoping across roster verbs and pipeline stages", () => {
  test("--verb work --preview emits exactly the orchestrator's body, not every stage's too", async () => {
    const { mattstackDir, packDir, manifestPath } = makePipelineFixtures();
    const payload = spyOn(ui, "payload");
    try {
      await skillsCompile([
        "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
        "--verb", "work", "--preview",
      ]);

      // Strict, not toContain: a second body on stdout (the stage's after the
      // orchestrator's) is the N+1-bodies bug, and one payload call is the check.
      expect(payload).toHaveBeenCalledTimes(1);
      expect(io.stdout()).toContain("The work type is `feature`. Continue.");
      const previewed = io.stdout();

      // Byte parity with the old console.log(content): the body, then one newline.
      await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "work"]);
      const written = readFileSync(join(packDir, "skills", "work", "SKILL.md"), "utf8");
      expect(previewed).toBe(`${written}\n`);
    } finally {
      payload.mockRestore();
    }
  });

  test("--preview with a pack note firing: stdout is the body alone, the note is on stderr", async () => {
    const { mattstackDir, packDir, manifestPath } = makePipelineFixtures();
    const cwd = process.cwd();
    const payload = spyOn(ui, "payload");
    try {
      process.chdir(packDir);
      await skillsCompile(["--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "stage-plan", "--preview"]);
      expect(payload).toHaveBeenCalledTimes(1);
      expect(io.stdout()).toBe(String(payload.mock.calls[0]![0]));
      expect(io.stdout()).not.toContain("Using the pack");
      expect(io.stderr()).toContain("Using the pack this folder is inside");
    } finally {
      process.chdir(cwd);
      payload.mockRestore();
    }
  });

  test("--verb stage-plan --preview emits exactly that stage's body, not the orchestrator's", async () => {
    const { mattstackDir, packDir, manifestPath } = makePipelineFixtures();
    const payload = spyOn(ui, "payload");
    try {
      await skillsCompile([
        "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
        "--verb", "stage-plan", "--preview",
      ]);

      expect(payload).toHaveBeenCalledTimes(1);
      expect(io.stdout()).not.toContain("The work type is");
    } finally {
      payload.mockRestore();
    }
  });

  test("--preview writes the body once through out.payload and nothing else on stdout", async () => {
    const { mattstackDir, packDir, manifestPath } = makePipelineFixtures();
    const payload = spyOn(ui, "payload");
    try {
      await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "stage-plan", "--preview"]);
      expect(payload).toHaveBeenCalledTimes(1);
      expect(io.stdout()).toBe(String(payload.mock.calls[0]![0]));
      expect(io.stderr()).toBe("");
    } finally {
      payload.mockRestore();
    }
  });

  test("--verb work (real compile) writes only the orchestrator, leaving the stage uncompiled", async () => {
    const { mattstackDir, packDir, manifestPath } = makePipelineFixtures();

    await skillsCompile([
      "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "work",
    ]);

    expect(existsSync(join(packDir, "skills", "work", "SKILL.md"))).toBe(true);
    expect(existsSync(join(packDir, "attachments", "stage-plan"))).toBe(false);
  });

  test("skillsCheck --verb stage-plan --json reports only that stage, not the orchestrator", async () => {
    const { mattstackDir, packDir, manifestPath } = makePipelineFixtures();

    await skillsCheck([
      "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      "--verb", "stage-plan", "--json",
    ]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs.map((v: { name: string }) => v.name)).toEqual(["stage-plan"]);
  });

  test("an unknown --verb naming neither a roster verb nor a pipeline stage: clean one-line error", async () => {
    const { mattstackDir, packDir, manifestPath } = makePipelineFixtures();

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "no-such-name",
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain("no-such-name");
  });
});

describe("skillsCompile with a broken pipeline manifest", () => {
  test("a pipeline naming a stage with no backing SKILL.md fails cleanly, not with a stack trace", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-bad-pipeline-")));
    const manifestPath = join(manifestDir, "skills.jsonc");
    writeFile(manifestPath, `{\n  "pipelines": { "feature": ["mattstack:no-such-stage"] },\n  "bindings": {}\n}\n`);

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--manifest", manifestPath,
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).not.toContain("\n    at ");
    expect(errors[0]).toContain("feature");
    expect(errors[0]).toContain("no-such-stage");
  });

  test("a name that is both a roster verb and a pipeline stage errors instead of silently deleting its own output", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(
      join(packDir, "pack", "stubs.jsonc"),
      `{\n  "verbs": {\n    "watch-ci": { "engine": "watch-ci", "description": "Watch CI." },\n    "stage-plan": { "engine": "stage-plan", "description": "Also a roster verb, oops." }\n  }\n}\n`,
    );
    const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-collision-")));
    const manifestPath = join(manifestDir, "skills.jsonc");
    writeFile(manifestPath, `{\n  "pipelines": { "feature": ["mattstack:stage-plan"] },\n  "bindings": {}\n}\n`);

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "t",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--manifest", manifestPath,
      ]),
    );

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors.join("\n")).not.toContain("rt skills:");
    expect(errors[0]).toContain("stage-plan");
    expect(errors[0]).toContain("both a roster verb and a pipeline stage");
    expect(existsSync(join(packDir, "skills", "stage-plan"))).toBe(false);
    expect(existsSync(join(packDir, "attachments", "stage-plan"))).toBe(false);
  });
});

describe("skillsCheck", () => {
  test("reports current right after a compile", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);
    io.clear();

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    expect(io.lines()).toContain("[ok] watch-ci  current");
    expect(io.lines().some((l) => l.includes("[out of date]"))).toBe(false);
    expect(process.exitCode).not.toBe(1);
  });

  test("a pipeline whose chain no longer folds is reported and exits 1", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    // Nothing before it produces "commits", and the seed does not carry it.
    writeFile(
      join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "stage-ship", "index.block.md"),
      `---\nname: stage-ship\ndescription: "ship stage"\ntype: pipeline-step\nmetadata:\n  stage: ship\n  stage-consumes: commits\n---\n\nship.\n`,
    );
    const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-chain-")));
    const manifestPath = join(manifestDir, "skills.jsonc");
    writeFile(manifestPath, `{\n  "pipelines": { "feature": ["mattstack:stage-ship"] },\n  "bindings": {}\n}\n`);

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
    ]);

    expect(io.lines().some((l) => l.includes('stage "stage-ship" consumes "commits"'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  test("hand-edited SKILL.md reports stale and exits 1", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const skillMdPath = join(packDir, "skills", "watch-ci", "SKILL.md");
    writeFileSync(skillMdPath, readFileSync(skillMdPath, "utf8") + "\nhand-edited drift\n");
    io.clear();

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const staleLine = io.lines().find((l) => l.includes("[out of date]"));
    expect(staleLine).toBeDefined();
    expect(staleLine).toContain("watch-ci");
    expect(staleLine).toContain("SKILL.md");
    expect(process.exitCode).toBe(1);
  });

  test("orphan file left over from a previous compile reports stale and exits 1", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    writeFileSync(join(packDir, "skills", "watch-ci", "leftover.txt"), "stale content\n");
    io.clear();

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const staleLine = io.lines().find((l) => l.includes("[out of date]"));
    expect(staleLine).toBeDefined();
    expect(staleLine).toContain("watch-ci");
    expect(staleLine).toContain("leftover.txt");
    expect(process.exitCode).toBe(1);
  });

  test("a gitignored file inside the compiled dir (a __pycache__ from running its scripts) is not an orphan", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    execFileSync("git", ["init", "-q"], { cwd: packDir });
    writeFileSync(join(packDir, ".gitignore"), "__pycache__/\n");

    await skillsCompile([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    mkdirSync(join(packDir, "skills", "watch-ci", "scripts", "__pycache__"), { recursive: true });
    writeFileSync(join(packDir, "skills", "watch-ci", "scripts", "__pycache__", "ci_watch.cpython-314.pyc"), "bytecode\n");
    io.clear();

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    expect(io.lines()).toContain("[ok] watch-ci  current");
    expect(process.exitCode).not.toBe(1);
  });

  test("never-compiled public verb (missing outDir) reports stale and exits 1", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const staleLine = io.lines().find((l) => l.includes("[out of date]"));
    expect(staleLine).toBeDefined();
    expect(staleLine).toContain("watch-ci");
    expect(process.exitCode).toBe(1);
  });

  test("provenance-only drift (marker versions, compiled recompute) is masked out: in-sync", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const skillMdPath = join(packDir, "skills", "watch-ci", "SKILL.md");
    const bumped = readFileSync(skillMdPath, "utf8")
      .replace(/version=\S+/g, "version=9.9.9")
      .replace(/(compiled: )"[^"]*"/, '$1"bumped"');
    writeFileSync(skillMdPath, bumped);
    io.clear();

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
      "--json",
    ]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs).toEqual([
      { name: "watch-ci", status: "in-sync", staleFiles: [], orphanFiles: [], side: "skills" },
    ]);
    expect(process.exitCode).not.toBe(1);
  });

  test("provenance-masked drift plus a real prose change still reports stale and exits 1", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const skillMdPath = join(packDir, "skills", "watch-ci", "SKILL.md");
    const bumped = readFileSync(skillMdPath, "utf8")
      .replace(/version=\S+/g, "version=9.9.9")
      .replace(/(compiled: )"[^"]*"/, '$1"bumped"')
      .replace("Poll the pipeline every 30s", "Poll the pipeline every 45s");
    writeFileSync(skillMdPath, bumped);
    io.clear();

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--verb", "watch-ci",
    ]);

    const staleLine = io.lines().find((l) => l.includes("[out of date]"));
    expect(staleLine).toBeDefined();
    expect(staleLine).toContain("watch-ci");
    expect(staleLine).toContain("SKILL.md");
    expect(process.exitCode).toBe(1);
  });

  test("check --json reports installed: null under --mattstack-dir and drift alone drives the exit code", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);
    io.clear();

    await skillsCheck(["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci", "--json"]);

    const payload = JSON.parse(io.lines().at(-1)!);
    expect(payload.installed).toBeNull();
    expect(payload.verbs.every((v: { status: string }) => v.status === "in-sync")).toBe(true);
    expect(process.exitCode ?? 0).toBe(0);
  });
  test("check --json still prints its envelope when a verb's compile throws, with the error and drift", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    await skillsCompile(["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", makeManifest(), "--verb", "watch-ci"]);
    io.clear();

    const { exitCode } = await runExpectingCleanExit(() => skillsCheck(["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", makeManifestDanglingDomain(), "--verb", "watch-ci", "--json"]));
    expect(exitCode).toBeUndefined();

    const payload = JSON.parse(io.lines().at(-1)!);
    expect(payload.verbs).toEqual([]);
    expect(payload.compileErrors).toHaveLength(1);
    expect(payload.compileErrors[0]).toContain("does-not-exist");
    expect(process.exitCode).toBe(1);
  });

  test("check names a verb whose compile throws for a person", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    await skillsCompile(["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", makeManifest(), "--verb", "watch-ci"]);
    io.clear();

    const { exitCode } = await runExpectingCleanExit(() => skillsCheck(["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", makeManifestDanglingDomain(), "--verb", "watch-ci"]));
    expect(exitCode).toBeUndefined();

    expect(io.lines().some((l) => l.startsWith("[failed]") && l.includes("does-not-exist"))).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});

describe("installedInfoFor", () => {
  function installedFixture(version: string | null): PluginRoots {
    if (version === null) return { byName: {}, list: [] };
    const install = realpathSync(mkdtempSync(join(tmpdir(), "rt-check-installed-")));
    mkdirSync(join(install, ".claude-plugin"), { recursive: true });
    writeFileSync(join(install, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version }));
    return { byName: {}, list: [{ id: "acme@beacon", installPath: install }] };
  }
  function packAt(dir: string): PackInfo {
    return { name: "acme", dir, layout: "flat", surfacePath: join(dir, "surface.jsonc"), marketplace: "beacon" };
  }
  function sourcePack(version: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-check-src-")));
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version }));
    return dir;
  }

  test("lagging when installed is behind source", () => {
    const dir = sourcePack("0.5.3");
    const info = installedInfoFor({ packDir: dir, pluginRoots: installedFixture("0.5.2") }, [packAt(dir)]);
    expect(info).toEqual({ plugin: "acme", marketplace: "beacon", version: "0.5.2", sourceVersion: "0.5.3", status: "lagging" });
  });

  test("current when versions match", () => {
    const dir = sourcePack("0.5.3");
    expect(installedInfoFor({ packDir: dir, pluginRoots: installedFixture("0.5.3") }, [packAt(dir)])!.status).toBe("current");
  });

  test("missing when no installed record", () => {
    const dir = sourcePack("0.5.3");
    const roots: PluginRoots = { byName: {}, list: [{ id: "other@beacon", installPath: dir }] };
    expect(installedInfoFor({ packDir: dir, pluginRoots: roots }, [packAt(dir)])!.status).toBe("missing");
  });

  test("null when the pack has no marketplace or the list is empty", () => {
    const dir = sourcePack("0.5.3");
    expect(installedInfoFor({ packDir: dir, pluginRoots: installedFixture(null) }, [packAt(dir)])).toBeNull();
    const noMkt = { ...packAt(dir), marketplace: null };
    expect(installedInfoFor({ packDir: dir, pluginRoots: installedFixture("0.5.3") }, [noMkt])).toBeNull();
  });
});

describe("skillsCheck --json", () => {
  test("emits one row per verb (never compiled)", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCheck(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.pack).toBe("acme");
    expect(parsed.packDir).toBe(packDir);
    expect(parsed.verbs).toEqual([
      { name: "watch-ci", status: "never-compiled", staleFiles: [], orphanFiles: [], side: "skills" },
    ]);
    expect(parsed.chainErrors).toEqual([]);
  });

  test("a broken chain rides the payload, not just the exit code", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(
      join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "stage-ship", "index.block.md"),
      `---\nname: stage-ship\ndescription: "ship stage"\ntype: pipeline-step\nmetadata:\n  stage: ship\n  stage-consumes: commits\n---\n\nship.\n`,
    );
    const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-chain-json-")));
    const manifestPath = join(manifestDir, "skills.jsonc");
    writeFile(manifestPath, `{\n  "pipelines": { "feature": ["mattstack:stage-ship"] },\n  "bindings": {}\n}\n`);

    await skillsCheck([
      "--team", "t",
      "--pack-dir", packDir,
      "--mattstack-dir", mattstackDir,
      "--manifest", manifestPath,
      "--json",
    ]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.chainErrors).toHaveLength(1);
    expect(parsed.chainErrors[0]).toContain('stage "stage-ship" consumes "commits"');
    // Rows are untouched by a pack-level failure -- the console reads them.
    expect(parsed.verbs.every((v: { status: string }) => typeof v.status === "string")).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  test("prints ONLY json -- no human lines on stdout", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCheck(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    expect(() => JSON.parse(io.lines().join("\n"))).not.toThrow();
  });

  test("reports in-sync right after a compile", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);
    io.clear();

    await skillsCheck(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs).toEqual([
      { name: "watch-ci", status: "in-sync", staleFiles: [], orphanFiles: [], side: "skills" },
    ]);
    expect("staleBecause" in parsed.verbs[0]).toBe(false);
  });

  test("separates staleFiles (content drift) from orphanFiles (leftover) instead of merging them", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);
    const skillMdPath = join(packDir, "skills", "watch-ci", "SKILL.md");
    writeFileSync(skillMdPath, readFileSync(skillMdPath, "utf8") + "\nhand-edited drift\n");
    writeFileSync(join(packDir, "skills", "watch-ci", "leftover.txt"), "stale content\n");
    io.clear();

    await skillsCheck(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs).toEqual([
      { name: "watch-ci", status: "stale", staleFiles: ["SKILL.md"], orphanFiles: ["leftover.txt"], side: "skills", staleBecause: ["fill"] },
    ]);
    expect(process.exitCode).toBe(1);
  });

  test("engine body edited: staleBecause names the source", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);

    writeFile(
      join(mattstackDir, "plugins", "mattstack", "skills", "pipeline", "watch-ci", "index.block.md"),
      WATCH_CI_INDEX.replace("Poll the pipeline every 30s", "Poll the pipeline every 60s"),
    );
    io.clear();

    await skillsCheck(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const verb = JSON.parse(io.lines().join("\n")).verbs[0];
    expect(verb.status).toBe("stale");
    expect(verb.staleFiles).toEqual(["SKILL.md"]);
    expect(verb.staleBecause).toEqual(["source"]);
  });

  test("fill body edited: staleBecause names the fill", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);

    writeFile(
      join(mattstackDir, "plugins", "acme", "attachments", "watch-ci-domain", "SKILL.md"),
      DOMAIN_SKILL_MD.replace("Domain rules live at", "Domain rules now live at"),
    );
    io.clear();

    await skillsCheck(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const verb = JSON.parse(io.lines().join("\n")).verbs[0];
    expect(verb.status).toBe("stale");
    expect(verb.staleBecause).toEqual(["fill"]);
  });

  test("roster description edited: staleBecause names frontmatter", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);

    writeFile(
      join(packDir, "pack", "stubs.jsonc"),
      STUBS_JSONC.replace("Use when watching or triaging CI.", "Use when watching CI."),
    );
    io.clear();

    await skillsCheck(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const verb = JSON.parse(io.lines().join("\n")).verbs[0];
    expect(verb.status).toBe("stale");
    expect(verb.staleBecause).toEqual(["frontmatter"]);
  });

  test("vendored script edited: staleBecause names vendored", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci"]);

    writeFile(
      join(mattstackDir, "plugins", "mattstack", "skills", "pipeline", "watch-ci", "scripts", "ci-watch.sh"),
      "#!/bin/sh\necho polling twice\n",
    );
    io.clear();

    await skillsCheck(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const verb = JSON.parse(io.lines().join("\n")).verbs[0];
    expect(verb.status).toBe("stale");
    expect(verb.staleFiles).toEqual(["scripts/ci-watch.sh"]);
    expect(verb.staleBecause).toEqual(["vendored"]);
  });

  test("internal verb with missing outDir: never-compiled under attachments/, and still counts as stale", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);

    await skillsCheck(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs).toEqual([
      { name: "watch-ci", status: "never-compiled", staleFiles: [], orphanFiles: [], side: "attachments" },
    ]);
    expect(process.exitCode).toBe(1);
  });
});

describe("skillsCompile --json", () => {
  test("compiled verb: files + warnings reported, files written to disk like the plain form", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci", "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.pack).toBe("acme");
    expect(parsed.written).toBe(true);
    expect(parsed.verbs).toHaveLength(1);
    const verb = parsed.verbs[0];
    expect(verb.name).toBe("watch-ci");
    expect(verb.status).toBe("compiled");
    expect(verb.errors).toEqual([]);
    expect(verb.files.map((f: { path: string }) => f.path).sort()).toEqual([
      "SKILL.md",
      "compiled.json",
      "parts/domain/ci-config.json",
      "scripts/ci-watch.sh",
    ]);
    for (const file of verb.files) {
      expect(existsSync(join(packDir, "skills", "watch-ci", file.path))).toBe(true);
    }
    // A clean compile leaves the exit code unset: a caller reading it sees success.
    expect(process.exitCode).not.toBe(1);
  });

  test("internal (retired) verb: compiled row with side attachments, written to the attachments side", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci", "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs).toHaveLength(1);
    const verb = parsed.verbs[0];
    expect(verb.name).toBe("watch-ci");
    expect(verb.status).toBe("compiled");
    expect(verb.side).toBe("attachments");
    expect(verb.errors).toEqual([]);
    expect(verb.files.map((f: { path: string }) => f.path).sort()).toEqual([
      "SKILL.md",
      "compiled.json",
      "parts/domain/ci-config.json",
      "scripts/ci-watch.sh",
    ]);
    expect(existsSync(join(packDir, "attachments", "watch-ci", "SKILL.md"))).toBe(true);
    expect(existsSync(join(packDir, "skills", "watch-ci"))).toBe(false);
  });

  test("lint-erroring verb (returned errors[]): errored with the message, other verbs unaffected -- command does not die", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_WITH_INTERNAL_REF);
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    const manifestPath = makeManifest();

    await skillsCompile(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    const watchCi = parsed.verbs.find((v: { name: string }) => v.name === "watch-ci");
    expect(watchCi.status).toBe("errored");
    expect(watchCi.files).toEqual([]);
    expect(watchCi.errors).toHaveLength(1);
    expect(watchCi.errors[0]).toContain("acme:helper-verb");

    const helper = parsed.verbs.find((v: { name: string }) => v.name === "helper-verb");
    expect(helper.status).toBe("compiled");
    expect(helper.side).toBe("attachments");

    // An errored verb is a failed compile: the exit code says so, matching the
    // non-JSON throw and check --json's stale exit.
    expect(process.exitCode).toBe(1);
  });

  test("unbound required slot (compileVerb throws): errored, not a crash", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest(false);

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci", "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs).toHaveLength(1);
    expect(parsed.verbs[0].status).toBe("errored");
    expect(parsed.verbs[0].files).toEqual([]);
    expect(parsed.verbs[0].errors[0]).toContain("forge");
    expect(process.exitCode).toBe(1);
  });

  test("prints ONLY json -- no human lines on stdout", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "watch-ci", "--json"]);

    expect(() => JSON.parse(io.lines().join("\n"))).not.toThrow();
  });
});

describe("skillsCompile --preview error handling", () => {
  test("lint-erroring verb: message on stderr, empty stdout, exit code set but no crash", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_WITH_INTERNAL_REF);
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    const manifestPath = makeManifest();

    io.clear();
    await skillsCompile([
      "--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      "--verb", "watch-ci", "--preview",
    ]);
    const errors = io.errLines();

    expect(io.lines()).toEqual([]);
    expect(errors.join("\n")).toContain("acme:helper-verb");
    expect(process.exitCode).toBe(1);
  });

  test("erroring verb in a pack that ALSO has a misplaced compiled dir: still nothing on stdout", async () => {
    // Before the per-verb try/catch, an error always exited the whole command
    // immediately, so the post-loop "misplaced" scan (which prints to stdout)
    // was unreachable on any --preview error path. A bare `continue` in the
    // catch would let the loop end normally (--preview is single-verb) and
    // fall straight into that scan -- leaking a "misplaced: ..." line onto
    // stdout, breaking --preview's stdout-is-the-body-or-nothing contract.
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_WITH_INTERNAL_REF);
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": ["watch-ci"] }\n`);
    writeFile(join(packDir, "skills", "leftover-verb", "SKILL.md"), "---\nname: leftover-verb\n---\nstale\n");
    const manifestPath = makeManifest();

    io.clear();
    await skillsCompile([
      "--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      "--verb", "watch-ci", "--preview",
    ]);
    const errors = io.errLines();

    expect(io.lines()).toEqual([]);
    expect(errors.join("\n")).toContain("acme:helper-verb");
  });

  test("unbound required slot: message on stderr, empty stdout, exit code set but no crash", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest(false);

    io.clear();
    await skillsCompile([
      "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      "--verb", "watch-ci", "--preview",
    ]);
    const errors = io.errLines();

    expect(io.lines()).toEqual([]);
    expect(errors.join("\n")).toContain("forge");
    expect(process.exitCode).toBe(1);
  });
});

const GATE_PROTOCOL_MD = "---\nname: gate-protocol\n---\n\nAsk before acting.\nWait for the answer.\n";

function slottedStageMd(body: string): string {
  return `---
name: stage-plan
description: "plan stage"
type: pipeline-step
props:
  domain:
    merge: replace
    default: ""
    contract: "watch-ci-domain@1"
metadata:
  stage: plan
---

${body}
`;
}

/** watch-ci plus one internal stage, stage-plan, whose domain prop is bound to acme's inlined fill. */
function makeStagePackFlags(stageBody: string): string[] {
  const mattstackDir = makeMattstackDir();
  const mattstackPluginDir = join(mattstackDir, "plugins", "mattstack");
  writeFile(join(mattstackPluginDir, "attachments", "pipeline", "stage-plan", "index.block.md"), slottedStageMd(stageBody));
  writeFile(join(mattstackPluginDir, "attachments", "gate-protocol", "SKILL.md"), GATE_PROTOCOL_MD);
  const packDir = makePackDir();
  const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-anatomy-")));
  const manifestPath = join(manifestDir, "skills.jsonc");
  writeFile(manifestPath, JSON.stringify({
    pipelines: { feature: ["mattstack:stage-plan"] },
    bindings: {
      "mattstack:watch-ci": { domain: "acme:watch-ci-domain", forge: "mattstack:gitlab-forge" },
      "mattstack:stage-plan": { domain: "acme:watch-ci-domain" },
    },
  }));
  return ["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath];
}

const SKILLS_VERBS: Record<string, (args: string[]) => Promise<void>> = {
  compile: skillsCompile,
  composition: skillsComposition,
  anatomy: skillsAnatomy,
  changes: skillsChanges,
  discard: (args) => skillsDiscard(args, discardIo()),
};

/** A run with nobody at the terminal and no shared checkout to guard; a prompt here is a bug. */
function discardIo(over: Partial<DiscardIo> = {}): DiscardIo {
  return {
    interactive: () => false,
    confirm: async () => {
      throw new Error("discard prompted off a terminal");
    },
    sharedCheckout: () => null,
    ...over,
  };
}

/** What this one run wrote to stdout, read from the suite's open capture. */
async function runSkills(argv: string[]): Promise<string> {
  const [verb, ...rest] = argv;
  const run = SKILLS_VERBS[verb ?? ""];
  if (!run) throw new Error(`no test runner for rt skills ${verb}`);
  const before = io.stdout().length;
  await run(rest);
  return io.stdout().slice(before);
}

async function runSkillsCapturing(argv: string[]): Promise<{ exitCode: number | undefined; stderr: string }> {
  const { exitCode, errors } = await runExpectingCleanExit(async () => {
    await runSkills(argv);
  });
  return { exitCode, stderr: errors.join("\n") };
}

const compositionJson = async (flags: string[]) => JSON.parse(await runSkills(["composition", ...flags, "--json"]));
const anatomyJson = async (flags: string[]) => JSON.parse(await runSkills(["anatomy", ...flags, "--json"]));

const INCLUDE_THEN_PROP = "intro\n{{include:gate-protocol}}\n{{props.domain}}";

describe("skillsComposition --json", () => {
  test("composition lists every compile target with its rendered path and template placeholders", async () => {
    const packFlags = makeStagePackFlags(INCLUDE_THEN_PROP);
    const packDir = packFlags[packFlags.indexOf("--pack-dir") + 1]!;
    const mattstackDir = packFlags[packFlags.indexOf("--mattstack-dir") + 1]!;
    const payload = await compositionJson(packFlags);

    const stage = payload.targets.find((t: { name: string }) => t.name === "stage-plan");
    expect(stage).toMatchObject({ kind: "stage", public: false, engineError: null });
    expect(stage.artifactPath.endsWith("/attachments/stage-plan/SKILL.md")).toBe(true);
    expect(stage.templatePath).toBe(join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "stage-plan", "index.block.md"));
    expect(stage.placeholders.map((p: { kind: string }) => p.kind)).toEqual(["include", "prop"]);
    expect(stage.placeholders[0].line).toBeGreaterThan(1);
    const stageFile = "attachments/pipeline/stage-plan/index.block.md";
    expect(stage.placeholders).toEqual([
      { kind: "include", arg: "gate-protocol", file: stageFile, line: 15 },
      { kind: "prop", arg: "stage-plan.domain", file: stageFile, line: 16 },
    ]);
    expect(stage.props).toEqual({ "stage-plan": [{ name: "domain", merge: "replace", contract: "watch-ci-domain@1", required: false, default: "" }] });

    const verb = payload.targets.find((t: { name: string }) => t.name === "watch-ci");
    expect(verb).toEqual({
      name: "watch-ci",
      kind: "verb",
      public: true,
      artifactPath: join(packDir, "skills", "watch-ci", "SKILL.md"),
      templatePath: join(mattstackDir, "plugins", "mattstack", "skills", "pipeline", "watch-ci", "index.block.md"),
      placeholders: [
        { kind: "prop", arg: "watch-ci.domain", file: "skills/pipeline/watch-ci/index.block.md", line: 20 },
        { kind: "prop", arg: "watch-ci.forge", file: "skills/pipeline/watch-ci/index.block.md", line: 22 },
      ],
      props: {
        "watch-ci": [
          { name: "domain", merge: "replace", contract: "watch-ci-domain@1", required: false, default: "" },
          { name: "forge", merge: "replace", contract: "ci-forge@1", required: true, default: null },
        ],
      },
      engineError: null,
    });
  });

  test("a target whose engine cannot load carries the load error instead of a template", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_TWO_VERBS);
    const manifestPath = makeManifest();

    const payload = await compositionJson(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);

    const broken = payload.targets.find((t: { name: string }) => t.name === "broken");
    expect(broken).toMatchObject({ kind: "verb", templatePath: null, placeholders: [], props: {} });
    expect(broken.engineError).toContain("no-such-engine");
    expect(payload.targets.find((t: { name: string }) => t.name === "watch-ci").engineError).toBeNull();
  });

  test("verb, props, fills, and binders reflect the manifest", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsComposition(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.pack).toBe("acme");
    expect(parsed.packDir).toBe(packDir);
    expect(parsed.verbs).toHaveLength(1);

    const verb = parsed.verbs[0];
    expect(verb.name).toBe("watch-ci");
    expect(verb.engine).toBe("watch-ci");
    expect(verb.engineRef).toBe("mattstack:watch-ci");
    expect(verb.plugin).toBe("mattstack");
    expect(verb.public).toBe(true);
    expect(verb.sourcePath).toBe(join(mattstackDir, "plugins", "mattstack", "skills", "pipeline", "watch-ci", "index.block.md"));
    expect(verb.artifactPath).toBe(join(packDir, "skills", "watch-ci"));
    expect(verb.engineError).toBeUndefined();
    expect(verb.includes).toEqual([]);

    expect(Object.keys(verb.props)).toEqual(["watch-ci"]);
    const domain = verb.props["watch-ci"].find((p: { name: string }) => p.name === "domain");
    expect(domain).toMatchObject({ contract: "watch-ci-domain@1", required: false, merge: "replace", default: "" });
    expect(domain.values).toEqual([{
      boundTo: "acme:watch-ci-domain",
      layer: "pack",
      fillSourcePath: join(mattstackDir, "plugins", "acme", "attachments", "watch-ci-domain", "SKILL.md"),
      fillVersion: "0.3.0",
      registered: false,
      inlined: true,
    }]);

    const forge = verb.props["watch-ci"].find((p: { name: string }) => p.name === "forge");
    expect(forge.required).toBe(true);
    expect(forge.values).toHaveLength(1);
    expect(forge.values[0]).toMatchObject({ boundTo: "mattstack:gitlab-forge", registered: true, inlined: false });

    expect(parsed.fills).toHaveLength(2);
    const domainFill = parsed.fills.find((f: { binding: string }) => f.binding === "acme:watch-ci-domain");
    expect(domainFill).toEqual({
      binding: "acme:watch-ci-domain",
      provides: "watch-ci-domain@1",
      sourcePath: join(mattstackDir, "plugins", "acme", "attachments", "watch-ci-domain", "SKILL.md"),
      registered: false,
    });
    const forgeFill = parsed.fills.find((f: { binding: string }) => f.binding === "mattstack:gitlab-forge");
    expect(forgeFill.registered).toBe(true);
    expect(forgeFill.provides).toBe("ci-forge@1");

    const binder = parsed.binders.find((b: { ref: string }) => b.ref === "mattstack:watch-ci");
    expect(binder.verb).toBe("watch-ci");
    expect(binder.kind).toBe("verb");
    expect(binder.props).toEqual([
      { name: "domain", boundTo: "acme:watch-ci-domain", layer: "pack" },
      { name: "forge", boundTo: "mattstack:gitlab-forge", layer: null },
    ]);
  });

  test("includes names every {{include}} the engine and its bound fills carry, pre-compile", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(
      join(mattstackDir, "plugins", "mattstack", "skills", "pipeline", "watch-ci", "index.block.md"),
      WATCH_CI_INDEX.replace(
        "Poll the pipeline every 30s and report status.",
        "{{include:ci-note}}\n\n{{include:ci-note}}\n\nPoll the pipeline every 30s and report status.",
      ),
    );
    writeFile(
      join(mattstackDir, "plugins", "acme", "attachments", "watch-ci-domain", "SKILL.md"),
      DOMAIN_SKILL_MD + "\n{{include:fill-note}}\n",
    );

    await skillsComposition(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const verb = JSON.parse(io.lines().join("\n")).verbs[0];
    expect(verb.includes).toEqual(["ci-note", "fill-note"]);
  });

  test("an include reached only through a reference-mode (registered, public) fill is not scanned or vendored", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();
    writeFile(
      join(mattstackDir, "plugins", "mattstack", "skills", "gitlab-forge", "SKILL.md"),
      FORGE_SKILL_MD + "\n{{include:forge-note}}\n",
    );
    writeFile(
      join(mattstackDir, "plugins", "mattstack", "attachments", "forge-note", "SKILL.md"),
      "---\nname: forge-note\n---\n\nforge note body\n",
    );
    writeFile(join(mattstackDir, "plugins", "mattstack", "attachments", "forge-note", "note.txt"), "note\n");

    await skillsComposition(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);
    const verb = JSON.parse(io.lines().join("\n")).verbs[0];
    expect(verb.includes).toEqual([]);

    io.clear();
    await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);
    expect(existsSync(join(packDir, "skills", "watch-ci", "parts", "include-forge-note"))).toBe(false);
  });

  test("an internal verb's artifactPath is under attachments/, not a hardcoded skills/", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);
    const manifestPath = makeManifest();

    await skillsComposition(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    const verb = parsed.verbs.find((v: { name: string }) => v.name === "watch-ci");
    expect(verb.public).toBe(false);
    expect(verb.artifactPath).toBe(join(packDir, "attachments", "watch-ci"));
  });

  test("degrades per-value (dangling binding) and per-verb (broken engine) without blanking the payload", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_TWO_VERBS);
    const manifestPath = makeManifestDanglingDomain();

    await skillsComposition(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs).toHaveLength(2);

    const watchCi = parsed.verbs.find((v: { name: string }) => v.name === "watch-ci");
    expect(watchCi.engineRef).toBe("mattstack:watch-ci");
    expect(watchCi.engineError).toBeUndefined();
    const [domain] = watchCi.props["watch-ci"].find((p: { name: string }) => p.name === "domain").values;
    expect(domain.boundTo).toBe("acme:does-not-exist");
    expect(domain.resolveError).toContain("does-not-exist");
    expect(domain.fillSourcePath).toBeNull();
    expect(domain.fillVersion).toBeNull();
    const [forge] = watchCi.props["watch-ci"].find((p: { name: string }) => p.name === "forge").values;
    expect(forge.resolveError).toBeUndefined();
    expect(forge.fillSourcePath).not.toBeNull();

    const broken = parsed.verbs.find((v: { name: string }) => v.name === "broken");
    expect(broken.engineRef).toBeNull();
    expect(broken.plugin).toBeNull();
    expect(broken.sourcePath).toBeNull();
    expect(broken.props).toEqual({});
    expect(broken.engineError).toContain("no-such-engine");
    expect(broken.artifactPath).toBe(join(packDir, "skills", "broken"));

    // The payload as a whole is still populated -- one broken verb/value pair
    // does not blank fills or binders either.
    expect(parsed.fills.length).toBeGreaterThan(0);
    expect(parsed.binders.length).toBeGreaterThan(0);
  });

  test("ignores a stray --verb flag: verbs stays the full roster, never truncated", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_TWO_VERBS);
    const manifestPath = makeManifest();

    await skillsComposition([
      "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath,
      "--verb", "watch-ci", "--json",
    ]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.verbs.map((v: { name: string }) => v.name).sort()).toEqual(["broken", "watch-ci"]);
  });

  test("binder kind is derived from pipelines/roster membership, not a ref string heuristic", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-")));
    const manifestPath = join(manifestDir, "skills.jsonc");
    writeFile(manifestPath, `{
  "pipelines": {
    "feature": ["mattstack:stage-provision"]
  },
  "bindings": {
    "mattstack:watch-ci": {
      "domain": "acme:watch-ci-domain",
      "forge": "mattstack:gitlab-forge"
    },
    "mattstack:stage-provision": {
      "domain": "acme:watch-ci-domain"
    },
    "mattstack:review-core": {
      "criteria": "acme:watch-ci-domain"
    },
    "board:review": {
      "skill": "acme:watch-ci-domain"
    }
  }
}
`);

    await skillsComposition(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    const byRef = Object.fromEntries(parsed.binders.map((b: { ref: string; kind: string; verb: string | null }) => [b.ref, b]));

    // mattstack:stage-provision has NO roster verb, so this also proves kind
    // isn't derived by string-matching "stage-" -- only pipelines membership does it.
    expect(byRef["mattstack:watch-ci"]).toMatchObject({ kind: "verb", verb: "watch-ci" });
    expect(byRef["mattstack:stage-provision"]).toMatchObject({ kind: "stage", verb: null });
    expect(byRef["mattstack:review-core"]).toMatchObject({ kind: "skill", verb: null });
    expect(byRef["board:review"]).toMatchObject({ kind: "external", verb: null });
  });

  test("composition reports each prop value's layer from the file's provenance header", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-layer-")));
    const manifestPath = join(dir, "skills.jsonc");
    writeFile(manifestPath, `// GENERATED by rt skills materialize
// provenance (binding <- layer):
//   mattstack:watch-ci domain <- pack
//   mattstack:watch-ci forge <- base:acme-base
//   mattstack:stage-plan domain <- override
{
  "bindings": {
    "mattstack:watch-ci": { "domain": "acme:watch-ci-domain", "forge": "mattstack:gitlab-forge" },
    "mattstack:stage-plan": { "domain": "acme:watch-ci-domain" }
  }
}
`);
    await skillsComposition(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);
    const parsed = JSON.parse(io.lines().join("\n"));
    const props = parsed.verbs.find((v: { name: string }) => v.name === "watch-ci").props["watch-ci"];
    expect(props.find((p: { name: string }) => p.name === "domain").values[0].layer).toBe("pack");
    expect(props.find((p: { name: string }) => p.name === "forge").values[0].layer).toBe("base:acme-base");
    const binderProps = (ref: string) => parsed.binders.find((b: { ref: string }) => b.ref === ref).props;
    expect(binderProps("mattstack:watch-ci")).toEqual([
      { name: "domain", boundTo: "acme:watch-ci-domain", layer: "pack" },
      { name: "forge", boundTo: "mattstack:gitlab-forge", layer: "base:acme-base" },
    ]);
    expect(binderProps("mattstack:stage-plan")).toEqual([
      { name: "domain", boundTo: "acme:watch-ci-domain", layer: "override" },
    ]);
  });

  test("a manifest with no provenance header reads its values as the pack's, as compile does", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-nolayer-")));
    const manifestPath = join(dir, "skills.jsonc");
    writeFile(manifestPath, `{
  "bindings": {
    "mattstack:watch-ci": { "domain": "acme:watch-ci-domain" }
  }
}
`);
    await skillsComposition(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);
    const parsed = JSON.parse(io.lines().join("\n"));
    const props = parsed.verbs[0].props["watch-ci"];
    expect(props.find((p: { name: string }) => p.name === "domain").values[0].layer).toBe("pack");
  });

  test("rosterless pack: empty verbs, fills, and binders -- not a failure", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-pack-empty-")));

    await skillsComposition(["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed).toEqual({ pack: "acme", packDir, manifestPath: null, verbs: [], fills: [], binders: [], pipelines: {}, targets: [], extends: null });
  });

  test("manifestPath is the absolute manifest the bindings came from, not <packDir>/skills.jsonc", async () => {
    // The console names this path as the file to edit to rebind a prop. It is
    // NOT reconstructable from the pack name -- it lives in a registered repo
    // dir -- so the payload has to carry the real one or the console guesses.
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-path-")));
    const manifestPath = join(manifestDir, "skills.jsonc");
    writeFile(manifestPath, `{ "bindings": { "mattstack:watch-ci": { "domain": "acme:watch-ci-domain" } } }`);

    await skillsComposition(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.manifestPath).toBe(manifestPath);
    expect(parsed.manifestPath).not.toBe(join(packDir, "skills.jsonc"));
  });

  test("pipelines carries each work type's stage order, not a set", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-order-")));
    const manifestPath = join(manifestDir, "skills.jsonc");
    // Deliberately NOT alphabetical: ship precedes provision. Anything that
    // rebuilt this list from binders[] or routed it through a Set would come
    // back sorted or in binding-insertion order, and a consumer rendering
    // execution order would show the pipeline running backwards with nothing
    // failing anywhere.
    writeFile(manifestPath, `{
  "pipelines": {
    "feature": ["mattstack:stage-ship", "mattstack:stage-provision", "mattstack:stage-plan"],
    "bugfix": ["mattstack:stage-provision"]
  },
  "bindings": {
    "mattstack:watch-ci": {
      "domain": "acme:watch-ci-domain"
    }
  }
}
`);

    await skillsComposition(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed.pipelines).toEqual({
      feature: ["mattstack:stage-ship", "mattstack:stage-provision", "mattstack:stage-plan"],
      bugfix: ["mattstack:stage-provision"],
    });
  });

  test("prints ONLY json -- no human lines on stdout", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = makeManifest();

    await skillsComposition(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--json"]);

    expect(() => JSON.parse(io.lines().join("\n"))).not.toThrow();
  });

  describe("compile-pipelines", () => {
    const PIPELINES_FIX = join(import.meta.dir, "..", "..", "lib", "skills", "__tests__", "fixtures", "compile-pipelines");
    const REAL_ATTACHMENTS = join(import.meta.dir, "..", "..", "plugins", "mattstack", "attachments");

    function pipelinesFlags(editManifest: (text: string) => string = (t) => t): string[] {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-pipelines-")));
      cpSync(PIPELINES_FIX, root, { recursive: true });
      const ms = join(root, "mattstack-home");
      cpSync(REAL_ATTACHMENTS, join(ms, "plugins", "mattstack", "attachments"), { recursive: true });
      const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
      writeFile(manifest, editManifest(`//   accessibility/mattstack:stage-evidence/domain-rules rules <- team\n${readFileSync(manifest, "utf8")}`));
      return ["--pack-dir", join(root, "pack"), "--mattstack-dir", ms, "--manifest", manifest];
    }

    test("the evidence binder prop carries the accessibility override, work-a11y its pipeline, and the copy target its engine and pipeline", async () => {
      const payload = await compositionJson(pipelinesFlags());

      const evidence = payload.binders.find((b: { ref: string }) => b.ref === "mattstack:stage-evidence/domain-rules");
      expect(evidence.kind).toBe("stage");
      expect(evidence.props).toHaveLength(1);
      expect(evidence.props[0]).toMatchObject({
        name: "rules",
        boundTo: "acme:evidence-a",
        overrides: [{ pipeline: "accessibility", boundTo: "acme:evidence-b", layer: "team" }],
      });

      const verbs = Object.fromEntries(payload.verbs.map((v: { name: string }) => [v.name, v]));
      expect(verbs["work-a11y"].pipeline).toBe("accessibility");
      expect("pipeline" in verbs.work).toBe(false);

      const copy = payload.targets.find((t: { name: string }) => t.name === "stage-evidence--accessibility");
      expect(copy).toMatchObject({ kind: "stage", engine: "stage-evidence", pipeline: "accessibility", engineError: null });
      const stage = payload.targets.find((t: { name: string }) => t.name === "stage-evidence");
      expect("engine" in stage).toBe(false);
      expect("pipeline" in stage).toBe(false);

      const plan = payload.binders.find((b: { ref: string }) => b.ref === "mattstack:stage-plan");
      expect(plan).toBeUndefined();
      expect(payload.pipelines.accessibility).toHaveLength(8);
    });

    test("a ref bound only by a pipeline override still gets a binder, with an empty default", async () => {
      const payload = await compositionJson(pipelinesFlags((t) => t.replace(`"bindings": { "mattstack:stage-evidence/domain-rules": { "rules": "acme:evidence-a" } }\n}`, `"bindings": {}\n}`)));

      const evidence = payload.binders.find((b: { ref: string }) => b.ref === "mattstack:stage-evidence/domain-rules");
      expect(evidence).toEqual({
        ref: "mattstack:stage-evidence/domain-rules",
        verb: null,
        kind: "stage",
        props: [{ name: "rules", boundTo: "", layer: null, overrides: [{ pipeline: "accessibility", boundTo: "acme:evidence-b", layer: "team" }] }],
      });
    });
  });
});

describe("skillsAnatomy --json", () => {
  test("anatomy reports a part per seam in file order, with rendered ranges", async () => {
    const packFlags = makeStagePackFlags(INCLUDE_THEN_PROP);
    await runSkills(["compile", ...packFlags]);
    const a = await anatomyJson(["--skill", "stage-plan", ...packFlags]);
    expect(a.kind).toBe("stage");
    expect(a.status).toBe("in-sync");
    expect(a.parts.map((p: { kind: string }) => p.kind)).toEqual(["block", "include", "prop"]);
    const inc = a.parts[1];
    const lines = readFileSync(a.rendered.path, "utf8").split("\n");
    expect(lines[inc.renderedLines[0] - 1]).toStartWith("<!-- part: include:gate-protocol ");
    expect(inc.source.lines).toBe(2);
    expect(inc.templateLines).toBeNull();
    expect(lines[a.parts[0].renderedLines[0] - 1]).toStartWith("<!-- part: block:stage-plan ");
    expect(lines[a.parts[0].renderedLines[0]]).toBe("intro");
    expect(lines[a.parts[2].renderedLines[0] - 1]).toStartWith("<!-- part: prop:stage-plan.domain ");
    expect(a.parts[2]).toMatchObject({ name: "stage-plan.domain", mode: "inline", source: { ref: "acme:watch-ci-domain" } });
    expect(a.template).toMatchObject({ ref: "mattstack:stage-plan", builtVersion: "1.2.0", lines: 16 });
    expect(a.rendered).toMatchObject({ exists: true, lines: lines.length - 1 });
  });

  test("anatomy of a never-compiled stage still lists template parts", async () => {
    const packFlags = makeStagePackFlags(INCLUDE_THEN_PROP);
    const a = await anatomyJson(["--skill", "stage-plan", ...packFlags]);
    expect(a.status).toBe("never-compiled");
    expect(a.rendered.exists).toBe(false);
    expect(a.parts.every((p: { renderedLines: unknown }) => p.renderedLines !== undefined)).toBe(true);
    expect(a.parts.map((p: { kind: string }) => p.kind)).toEqual(["block", "include", "prop"]);
    expect(a.template.builtVersion).toBeNull();
  });

  test("a prop placed after the block's text is its own part, sourced from its fill", async () => {
    const packFlags = makeStagePackFlags("Plan the work.\nWrite the plan down.\n{{props.domain}}");
    await runSkills(["compile", ...packFlags]);
    const a = await anatomyJson(["--skill", "stage-plan", ...packFlags]);
    expect(a.status).toBe("in-sync");
    expect(a.parts.map((p: { kind: string; name: string | null }) => [p.kind, p.name])).toEqual([["block", "stage-plan"], ["prop", "stage-plan.domain"]]);
    const [block, prop] = a.parts;
    const lines = readFileSync(a.rendered.path, "utf8").split("\n");
    expect(lines[block.renderedLines[0]]).toBe("Plan the work.");
    expect(lines[prop.renderedLines[0] - 1]).toStartWith("<!-- part: prop:stage-plan.domain ");
    expect(prop.source.ref).toBe("acme:watch-ci-domain");
  });

  test("an edited fill marks its part changed and the skill stale", async () => {
    const packFlags = makeStagePackFlags(INCLUDE_THEN_PROP);
    const mattstackDir = packFlags[packFlags.indexOf("--mattstack-dir") + 1]!;
    await runSkills(["compile", ...packFlags]);
    const fillPath = join(mattstackDir, "plugins", "acme", "attachments", "watch-ci-domain", "SKILL.md");
    writeFile(fillPath, readFileSync(fillPath, "utf8").replace("for details.", "for every detail."));
    const a = await anatomyJson(["--skill", "stage-plan", ...packFlags]);
    expect(a.status).toBe("stale");
    expect(a.staleBecause).toEqual(["fill"]);
    expect(a.parts.map((p: { changed: boolean }) => p.changed)).toEqual([false, false, true]);
  });

  test("anatomy rejects an unknown skill with a usage error", async () => {
    const packFlags = makeStagePackFlags(INCLUDE_THEN_PROP);
    const { exitCode, stderr } = await runSkillsCapturing(["anatomy", "--skill", "nope", ...packFlags, "--json"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("has no skill called nope");
  });

  test("anatomy without --skill is a usage error", async () => {
    const packFlags = makeStagePackFlags(INCLUDE_THEN_PROP);
    const { exitCode, stderr } = await runSkillsCapturing(["anatomy", ...packFlags]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Which skill?");
    expect(stderr).toContain("rt skills anatomy --skill <name>");
  });

  test("without --json, prints one row per part", async () => {
    const packFlags = makeStagePackFlags(INCLUDE_THEN_PROP);
    await runSkills(["compile", ...packFlags]);
    const text = await runSkills(["anatomy", "--skill", "stage-plan", ...packFlags]);
    const { parts } = await anatomyJson(["--skill", "stage-plan", ...packFlags]);
    const [header, ...rows] = text.split("\n").filter((l) => l.trim() !== "");
    expect(header!.split(/\s{2,}/)).toEqual(["Part", "Name", "Template lines", "Rendered lines"]);
    expect(rows).toHaveLength(parts.length);
    rows.forEach((row, i) => {
      const p = parts[i];
      const span = (lines: [number, number] | null) => (lines ? `${lines[0]}-${lines[1]}` : "-");
      const cells = [p.kind, p.name, span(p.templateLines), span(p.renderedLines)].filter((c) => c !== null);
      expect(row.trim().split(/\s{2,}/)).toEqual(cells);
    });
  });

  test("anatomy of a roster verb reports it public, with the verb's own description", async () => {
    const packFlags = makeStagePackFlags(INCLUDE_THEN_PROP);
    await runSkills(["compile", ...packFlags]);
    const a = await anatomyJson(["--skill", "watch-ci", ...packFlags]);
    expect(a).toMatchObject({ skill: "watch-ci", kind: "verb", public: true, description: "Use when watching or triaging CI.", status: "in-sync" });
    expect(a.rendered.path.endsWith("/skills/watch-ci/SKILL.md")).toBe(true);
    expect(a.parts.map((p: { kind: string; name: string | null }) => [p.kind, p.name])).toEqual([["block", "watch-ci"], ["prop", "watch-ci.domain"], ["prop", "watch-ci.forge"]]);
  });

  test("a stale skill whose fill grew points its parts at their markers in the file on disk", async () => {
    const packFlags = makeStagePackFlags("intro\n{{props.domain}}\n{{include:gate-protocol}}\noutro");
    const mattstackDir = packFlags[packFlags.indexOf("--mattstack-dir") + 1]!;
    await runSkills(["compile", ...packFlags]);
    const fillPath = join(mattstackDir, "plugins", "acme", "attachments", "watch-ci-domain", "SKILL.md");
    writeFile(fillPath, readFileSync(fillPath, "utf8").replace("for details.", "for details.\nA second rule.\nA third rule."));

    const a = await anatomyJson(["--skill", "stage-plan", ...packFlags]);
    expect(a.status).toBe("stale");
    expect(a.parts.map((p: { kind: string }) => p.kind)).toEqual(["block", "prop", "include"]);
    const lines = readFileSync(a.rendered.path, "utf8").split("\n");
    const [, prop, inc] = a.parts;
    expect(lines[prop.renderedLines[0] - 1]).toStartWith("<!-- part: prop:stage-plan.domain ");
    expect(prop.renderedLines[1] - prop.renderedLines[0]).toBe(1);
    expect(prop.changed).toBe(true);
    expect(lines[inc.renderedLines[0] - 1]).toStartWith("<!-- part: include:gate-protocol ");
    expect(lines[inc.renderedLines[1] - 1]).toBe("Wait for the answer.");
  });
});

describe("skillsPacks --json", () => {
  test("no packs discovered: empty packs array, not an error", async () => {
    await skillsPacks(["--settings-path", "/nonexistent/settings.json", "--json"]);

    const parsed = JSON.parse(io.lines().join("\n"));
    expect(parsed).toEqual({ packs: [] });
  });

  test("prints ONLY json -- no human lines on stdout", async () => {
    await skillsPacks(["--settings-path", "/nonexistent/settings.json", "--json"]);

    expect(() => JSON.parse(io.lines().join("\n"))).not.toThrow();
  });

  test("names the team for an org team pack and null for a marketplace plugin", async () => {
    const savedHome = process.env.HOME;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-packs-team-")));
    try {
      process.env.HOME = home;
      const orgRoot = join(home, ".mattstack", "orgs", "acme", "mattstack");
      mkdirSync(join(orgRoot, "teams", "web", "plugin"), { recursive: true });
      writeFileSync(join(orgRoot, "mattstack.jsonc"), '{"role":"org"}');
      writeFileSync(join(orgRoot, "teams", "web", "plugin", "surface.jsonc"), "{}");
      const market = join(home, "market");
      mkdirSync(join(market, ".claude-plugin"), { recursive: true });
      mkdirSync(join(market, "tools"), { recursive: true });
      writeFileSync(join(market, "tools", "surface.jsonc"), "{}");
      writeFileSync(join(market, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ name: "tools", source: "./tools" }] }));
      const settings = join(home, "settings.json");
      writeFileSync(settings, JSON.stringify({ extraKnownMarketplaces: { dev: { source: { source: "directory", path: market } } } }));

      await skillsPacks(["--settings-path", settings, "--json"]);

      const { packs } = JSON.parse(io.lines().join("\n")) as { packs: { name: string; team: string | null }[] };
      expect(packs.map((p) => [p.name, p.team])).toEqual([
        ["tools", null],
        ["web", "web"],
      ]);
    } finally {
      process.env.HOME = savedHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("skillsMaterialize --dir exit codes", () => {
  const ENGINE = join(import.meta.dir, "..", "..", "plugins", "mattstack");
  const saved = { HOME: process.env.HOME, RT_ENGINE_PACK_DIR: process.env.RT_ENGINE_PACK_DIR };
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-materialize-cli-")));
    process.env.HOME = home;
    delete process.env.RT_ENGINE_PACK_DIR;
  });
  afterEach(() => {
    process.env.HOME = saved.HOME;
    if (saved.RT_ENGINE_PACK_DIR === undefined) delete process.env.RT_ENGINE_PACK_DIR;
    else process.env.RT_ENGINE_PACK_DIR = saved.RT_ENGINE_PACK_DIR;
    rmSync(home, { recursive: true, force: true });
  });

  function checkout(remote: string): string {
    const dir = mkdtempSync(join(home, "widgets-"));
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
    return dir;
  }

  function declareWidgets(): void {
    seedOrg(join(home, ".mattstack"), "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    writeFile(join(teamPackDir(join(home, ".mattstack"), "acme", "widgets"), "pack", "skills.jsonc"), "{}");
  }

  test("a bare --dir is a usage error, never the every-repo sweep", async () => {
    process.env.RT_ENGINE_PACK_DIR = ENGINE;
    declareWidgets();
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsMaterialize(["--dir"]));
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("--dir needs a value");
    expect(io.lines()).toEqual([]);
  });

  test("a checkout no team declares exits 2", async () => {
    process.env.RT_ENGINE_PACK_DIR = ENGINE;
    await skillsMaterialize(["--dir", checkout("https://gitlab.example.com/acme/gadgets.git")]);
    expect(process.exitCode).toBe(2);
    expect(io.lines().join("\n")).toContain("No team covers gitlab.example.com/acme/gadgets");
  });

  test("a checkout with no git remote exits 2", async () => {
    process.env.RT_ENGINE_PACK_DIR = ENGINE;
    const dir = mkdtempSync(join(home, "loose-"));
    execFileSync("git", ["init", "-q", dir]);
    await skillsMaterialize(["--dir", dir]);
    expect(process.exitCode).toBe(2);
    expect(io.lines().join("\n")).toContain(`No git remote in ${dir}`);
  });

  test("no engine pack installed exits 1: nothing was written", async () => {
    await skillsMaterialize(["--dir", checkout("https://gitlab.example.com/acme/widgets.git")]);
    expect(process.exitCode).toBe(1);
    expect(io.lines().join("\n")).toContain("[skipped] Nothing was written  engine-pack-missing");
  });

  test("a declared checkout exits 0 and reports the migrated legacy file", async () => {
    process.env.RT_ENGINE_PACK_DIR = ENGINE;
    declareWidgets();
    const legacy = join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "skills.jsonc");
    writeFile(legacy, "{}");
    await skillsMaterialize(["--dir", checkout("https://gitlab.example.com/acme/widgets.git")]);
    expect(process.exitCode).toBe(0);
    expect(io.lines()).toContain(`  note: Renamed the old merged file to ${legacy}.migrated`);
    expect(existsSync(join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc"))).toBe(true);
  });

  test("a bindings file no pack still owns is set aside and reported", async () => {
    process.env.RT_ENGINE_PACK_DIR = ENGINE;
    declareWidgets();
    const stale = join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "gadgets", "skills.jsonc");
    writeFile(stale, "// zone: acme/widgets\n{}");
    await skillsMaterialize(["--dir", checkout("https://gitlab.example.com/acme/widgets.git")]);
    expect(process.exitCode).toBe(0);
    expect(io.lines()).toContain(`  note: Set aside 1 stale bindings file: ${stale}.stale`);
    expect(existsSync(stale)).toBe(false);
  });
});

const GIT_IDENTITY = ["-c", "user.email=ci@example.com", "-c", "user.name=ci"];

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, stdio: "pipe" });
}

function commitAll(cwd: string): void {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "base");
}

const BINDINGS_BEFORE = JSON.stringify({ bindings: { "mattstack:stage-plan": { domain: "acme:plan-policy" } } });
const BINDINGS_AFTER = JSON.stringify({ bindings: { "mattstack:stage-plan": { domain: "acme:plan-policy-strict" } } });

/** A committed pack whose bindings and surface are known, in a repo rooted at `repoRoot` with the pack at `packRel`. */
function makeCommittedPack(packRel = ""): { repoRoot: string; packDir: string } {
  const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-changes-")));
  const packDir = packRel ? join(repoRoot, packRel) : repoRoot;
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_BEFORE);
  writeFile(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["work", "review"] }));
  writeFile(join(packDir, "attachments", "stage-plan", "SKILL.md"), "stage plan\n");
  writeFile(join(packDir, "README.md"), "readme\n");
  commitAll(repoRoot);
  return { repoRoot, packDir };
}

const changesJson = async (flags: string[]) => JSON.parse(await runSkills(["changes", ...flags, "--json"]));

const blobId = (cwd: string, rel: string) => execFileSync("git", ["hash-object", "--", rel], { cwd, encoding: "utf8" }).trim();

describe("skillsChanges --json", () => {
  test("lists a rebind, a surface flip and an out-of-scope file", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    writeFile(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["work", "ship"] }));
    writeFile(join(packDir, "README.md"), "edited\n");

    const c = await changesJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(c).toEqual({
      pack: "acme",
      packDir,
      dirty: true,
      files: [
        { path: "pack/skills.jsonc", status: "M", hash: blobId(packDir, "pack/skills.jsonc") },
        { path: "pack/surface.jsonc", status: "M", hash: blobId(packDir, "pack/surface.jsonc") },
      ],
      outsideScope: [{ path: "README.md", status: "M" }],
      bindings: [{ engineRef: "mattstack:stage-plan", slot: "domain", from: "acme:plan-policy", to: "acme:plan-policy-strict" }],
      surface: [
        { skill: "review", from: "public", to: "internal" },
        { skill: "ship", from: "internal", to: "public" },
      ],
      signature: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  test("names the trial branch when the org copy is on the one this Mac chose, and only then", async () => {
    const savedHome = process.env.HOME;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-changes-trial-")));
    try {
      process.env.HOME = home;
      const { repoRoot, packDir } = makeCommittedPack("mattstack/teams/acme/plugin");
      writeFile(join(repoRoot, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme" }));
      commitAll(repoRoot);
      git(repoRoot, "branch", "-M", "main");
      const record = join(home, ".mattstack", "rt", "teams", "acme.json");
      writeFile(record, JSON.stringify({ dataBranch: "main", trialBranch: "try-blocks" }));

      expect((await changesJson(["--pack", "acme", "--pack-dir", packDir])).trialBranch).toBeUndefined();

      git(repoRoot, "switch", "-q", "-c", "try-blocks");
      expect((await changesJson(["--pack", "acme", "--pack-dir", packDir])).trialBranch).toBe("try-blocks");

      writeFile(record, JSON.stringify({ dataBranch: "main" }));
      expect((await changesJson(["--pack", "acme", "--pack-dir", packDir])).trialBranch).toBeUndefined();
    } finally {
      process.env.HOME = savedHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a deleted pack file has no content id", async () => {
    const { packDir } = makeCommittedPack();
    rmSync(join(packDir, "attachments", "stage-plan", "SKILL.md"));
    const c = await changesJson(["--pack", "acme", "--pack-dir", packDir]);
    expect(c.files).toEqual([{ path: "attachments/stage-plan/SKILL.md", status: "D", hash: null }]);
  });

  test("the signature is the same for the same tree, and moves with a file's content, a new file and a binding", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "attachments", "stage-plan", "SKILL.md"), "stage plan, edited\n");
    const signature = async () => (await changesJson(["--pack", "acme", "--pack-dir", packDir])).signature as string;

    const first = await signature();
    expect(await signature()).toBe(first);

    writeFile(join(packDir, "attachments", "stage-plan", "SKILL.md"), "stage plan, edited again\n");
    const edited = await signature();
    expect(edited).not.toBe(first);

    writeFile(join(packDir, "skills", "fresh", "SKILL.md"), "fresh\n");
    const added = await signature();
    expect(added).not.toBe(edited);

    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    expect(await signature()).not.toBe(added);
  });

  test("a file outside the pack's scope never moves the signature", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    const before = (await changesJson(["--pack", "acme", "--pack-dir", packDir])).signature;
    writeFile(join(packDir, "README.md"), "edited\n");
    expect((await changesJson(["--pack", "acme", "--pack-dir", packDir])).signature).toBe(before);
  });

  test("a rename into the pack from outside its scope is listed as outside the scope, with its source", async () => {
    const { packDir } = makeCommittedPack();
    git(packDir, "mv", "README.md", "pack/README.md");

    const c = await changesJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(c.files).toEqual([]);
    expect(c.outsideScope).toEqual([{ path: "pack/README.md", status: "R", from: "README.md" }]);
  });

  test("a rename reads as source and destination in the human list", async () => {
    const { packDir } = makeCommittedPack();
    git(packDir, "mv", "README.md", "pack/README.md");
    expect(await runSkills(["changes", "--pack", "acme", "--pack-dir", packDir])).toContain("README.md -> pack/README.md");
  });

  test("a clean pack is not dirty", async () => {
    const { packDir } = makeCommittedPack();
    const c = await changesJson(["--pack", "acme", "--pack-dir", packDir]);
    expect(c).toMatchObject({ dirty: false, files: [], outsideScope: [], bindings: [], surface: [] });
  });

  test("an untracked file inside a new directory is listed by its own path", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "attachments", "stage-plan", "new notes.md"), "notes\n");
    const c = await changesJson(["--pack", "acme", "--pack-dir", packDir]);
    expect(c.files).toEqual([{ path: "attachments/stage-plan/new notes.md", status: "??", hash: blobId(packDir, "attachments/stage-plan/new notes.md") }]);
  });

  test("a pack that is a subdirectory of its repo reports pack-relative paths and ignores the rest of the repo", async () => {
    const { repoRoot, packDir } = makeCommittedPack("packs/acme");
    writeFile(join(repoRoot, "unrelated.txt"), "elsewhere\n");
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    writeFile(join(packDir, "README.md"), "edited\n");

    const c = await changesJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(c.files).toEqual([{ path: "pack/skills.jsonc", status: "M", hash: blobId(packDir, "pack/skills.jsonc") }]);
    expect(c.outsideScope).toEqual([{ path: "README.md", status: "M" }]);
    expect(c.bindings).toEqual([{ engineRef: "mattstack:stage-plan", slot: "domain", from: "acme:plan-policy", to: "acme:plan-policy-strict" }]);
  });

  test("a rename into a subdirectory pack from elsewhere in its repo is outside the scope, and discard signs it the same way", async () => {
    const { repoRoot, packDir } = makeCommittedPack("packs/acme");
    writeFile(join(repoRoot, "NOTES.md"), "notes\n");
    commitAll(repoRoot);
    git(repoRoot, "mv", "NOTES.md", "packs/acme/pack/NOTES.md");
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);

    const c = await changesJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(c.files).toEqual([{ path: "pack/skills.jsonc", status: "M", hash: blobId(packDir, "pack/skills.jsonc") }]);
    expect(c.outsideScope).toEqual([{ path: "pack/NOTES.md", status: "R", from: "../../NOTES.md" }]);

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir, "--expect", c.signature]);

    expect(d.discarded).toEqual([{ path: "pack/skills.jsonc", status: "M" }]);
    expect(porcelain(repoRoot)).toBe("R  NOTES.md -> packs/acme/pack/NOTES.md\n");
  });

  test("a bindings file that is new since HEAD lists every binding as added", async () => {
    const { packDir } = makeCommittedPack();
    rmSync(join(packDir, "pack", "skills.jsonc"));
    commitAll(packDir);
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_BEFORE);

    const c = await changesJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(c.files).toEqual([{ path: "pack/skills.jsonc", status: "??", hash: blobId(packDir, "pack/skills.jsonc") }]);
    expect(c.bindings).toEqual([{ engineRef: "mattstack:stage-plan", slot: "domain", from: null, to: "acme:plan-policy" }]);
  });

  test("a pack outside any git checkout is a usage error", async () => {
    const packDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-nogit-")));
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_BEFORE);
    const { exitCode, stderr } = await runSkillsCapturing(["changes", "--pack", "acme", "--pack-dir", packDir, "--json"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not inside a git checkout");
  });

  test("a git failure other than a missing repository carries git's own message", async () => {
    const packDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-badgit-")));
    writeFile(join(packDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(packDir, ".git", "objects"));
    mkdirSync(join(packDir, ".git", "refs"));
    writeFile(join(packDir, ".git", "config"), "[[[\n");
    const { exitCode, stderr } = await runSkillsCapturing(["changes", "--pack", "acme", "--pack-dir", packDir, "--json"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("config");
    expect(stderr).not.toContain("not inside a git checkout");
  });

  test("reading changes never rewrites the index, so a concurrent git add is not locked out", async () => {
    const { packDir } = makeCommittedPack();
    const readme = join(packDir, "README.md");
    utimesSync(readme, new Date(Date.now() + 120_000), new Date(Date.now() + 120_000));
    const indexPath = join(packDir, ".git", "index");
    const before = readFileSync(indexPath);

    await changesJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(readFileSync(indexPath).equals(before)).toBe(true);
  });

  test("prints ONLY json -- no human lines on stdout", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    const text = await runSkills(["changes", "--pack", "acme", "--pack-dir", packDir, "--json"]);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("skillsChanges human output", () => {
  test("names the pack and the changed files", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    const text = await runSkills(["changes", "--pack", "acme", "--pack-dir", packDir]);
    expect(text).toContain("acme");
    expect(text).toContain("pack/skills.jsonc");
  });

  test("a pipeline override's binding row names its pipeline; a default row stays as it was", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({
      pipelines: { accessibility: { bindings: { "mattstack:stage-plan": { domain: "acme:plan-a11y" } } } },
      bindings: { "mattstack:stage-plan": { domain: "acme:plan-policy-strict" } },
    }));
    const lines = (await runSkills(["changes", "--pack", "acme", "--pack-dir", packDir])).split("\n");
    expect(lines).toContainEqual(expect.stringMatching(/^mattstack:stage-plan domain +acme:plan-policy +acme:plan-policy-strict$/));
    expect(lines).toContainEqual(expect.stringMatching(/^accessibility: mattstack:stage-plan domain +\(none\) +acme:plan-a11y$/));
  });
});

const discardJson = async (flags: string[]) => JSON.parse(await runSkills(["discard", ...flags, "--json"]));

function porcelain(cwd: string): string {
  return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, encoding: "utf8" });
}

describe("skillsDiscard --json", () => {
  test("throws away pack edits and new pack files, and leaves a README edit alone", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    writeFile(join(packDir, "attachments", "x", "SKILL.md"), "new skill\n");
    writeFile(join(packDir, "README.md"), "edited\n");

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(d).toEqual({
      pack: "acme",
      packDir,
      discarded: [
        { path: "pack/skills.jsonc", status: "M" },
        { path: "attachments/x/SKILL.md", status: "??" },
      ],
    });
    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(BINDINGS_BEFORE);
    expect(existsSync(join(packDir, "attachments", "x"))).toBe(false);
    expect(readFileSync(join(packDir, "README.md"), "utf8")).toBe("edited\n");
    expect(porcelain(packDir)).toBe(" M README.md\n");
  });

  test("a clean pack has nothing to throw away", async () => {
    const { packDir } = makeCommittedPack();
    expect(await discardJson(["--pack", "acme", "--pack-dir", packDir])).toEqual({ pack: "acme", packDir, discarded: [] });
  });

  test("an untracked file outside the pack's scope survives", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "notes", "todo.md"), "keep me\n");
    writeFile(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["work"] }));

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(d.discarded).toEqual([{ path: "pack/surface.jsonc", status: "M" }]);
    expect(readFileSync(join(packDir, "notes", "todo.md"), "utf8")).toBe("keep me\n");
    expect(porcelain(packDir)).toBe("?? notes/todo.md\n");
  });

  test("a staged new file under a pack root missing from HEAD is thrown away too", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "skills", "fresh", "SKILL.md"), "fresh\n");
    git(packDir, "add", "skills");

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(d.discarded).toEqual([{ path: "skills/fresh/SKILL.md", status: "A" }]);
    expect(existsSync(join(packDir, "skills", "fresh", "SKILL.md"))).toBe(false);
    expect(porcelain(packDir)).toBe("");
  });

  test("a pack inside a larger repo touches nothing outside its own directory", async () => {
    const { repoRoot, packDir } = makeCommittedPack("packs/acme");
    writeFile(join(repoRoot, "unrelated.txt"), "elsewhere\n");
    writeFile(join(repoRoot, "pack", "skills.jsonc"), "repo-level, not the pack\n");
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    writeFile(join(packDir, "skills", "new", "SKILL.md"), "new\n");
    writeFile(join(packDir, "README.md"), "edited\n");

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(d.discarded).toEqual([
      { path: "pack/skills.jsonc", status: "M" },
      { path: "skills/new/SKILL.md", status: "??" },
    ]);
    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(BINDINGS_BEFORE);
    expect(porcelain(repoRoot)).toBe(" M packs/acme/README.md\n?? pack/skills.jsonc\n?? unrelated.txt\n");
  });

  test("a pack outside any git checkout is a usage error", async () => {
    const packDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-nogit-")));
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_BEFORE);
    const { exitCode, stderr } = await runSkillsCapturing(["discard", "--pack", "acme", "--pack-dir", packDir, "--json"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not inside a git checkout");
    expect(existsSync(join(packDir, "pack", "skills.jsonc"))).toBe(true);
  });

  test("prints ONLY json -- no human lines on stdout", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    const text = await runSkills(["discard", "--pack", "acme", "--pack-dir", packDir, "--json"]);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("skillsDiscard human output", () => {
  test("names the pack and what was thrown away", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    const text = await runSkills(["discard", "--pack", "acme", "--pack-dir", packDir]);
    expect(text).toContain("acme");
    expect(text).toContain("pack/skills.jsonc");
  });

  test("says when there is nothing to throw away", async () => {
    const { packDir } = makeCommittedPack();
    const text = await runSkills(["discard", "--pack", "acme", "--pack-dir", packDir]);
    expect(text).toContain("nothing");
  });
});

async function discardWith(over: Partial<DiscardIo>, argv: string[]): Promise<{ exitCode: number | undefined; stderr: string; stdout: string }> {
  const before = io.stdout().length;
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsDiscard(argv, discardIo(over)));
  return { exitCode, stderr: errors.join("\n"), stdout: io.stdout().slice(before) };
}

describe("skillsDiscard guards", () => {
  test("needs an explicit --pack, since it throws work away", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);

    const { exitCode, stderr } = await discardWith({}, ["--pack-dir", packDir, "--json"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--pack");
    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(BINDINGS_AFTER);
  });

  test("refuses a pack inside the shared checkout, which changes only through a pull request", async () => {
    const { repoRoot, packDir } = makeCommittedPack("plugins/acme");
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);

    const { exitCode, stderr } = await discardWith({ sharedCheckout: () => repoRoot }, ["--pack", "acme", "--pack-dir", packDir, "--json"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("shared checkout");
    expect(stderr).toContain("pull request");
    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(BINDINGS_AFTER);
  });

  test("at a terminal it lists the files and keeps them all when the person says no", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    const asked: string[] = [];

    const { exitCode, stdout } = await discardWith(
      { interactive: () => true, confirm: async (message) => (asked.push(message), false) },
      ["--pack", "acme", "--pack-dir", packDir],
    );

    expect(exitCode).toBeUndefined();
    expect(asked).toHaveLength(1);
    expect(stdout).toContain("pack/skills.jsonc");
    expect(stdout).toContain("Kept");
    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(BINDINGS_AFTER);
  });

  test("at a terminal a yes throws the changes away", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);

    await discardWith({ interactive: () => true, confirm: async () => true }, ["--pack", "acme", "--pack-dir", packDir]);

    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(BINDINGS_BEFORE);
  });

  test("a file that lands under a pack root while the person confirms refuses the discard and deletes nothing", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "attachments", "x", "SKILL.md"), "new skill\n");
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    const lateBeside = join(packDir, "attachments", "x", "late.md");
    const lateElsewhere = join(packDir, "attachments", "y", "late.md");

    const { exitCode, stderr } = await discardWith(
      {
        interactive: () => true,
        confirm: async () => {
          writeFile(lateBeside, "late\n");
          writeFile(lateElsewhere, "late\n");
          return true;
        },
      },
      ["--pack", "acme", "--pack-dir", packDir],
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("changed while");
    expect(readFileSync(join(packDir, "attachments", "x", "SKILL.md"), "utf8")).toBe("new skill\n");
    expect(readFileSync(lateBeside, "utf8")).toBe("late\n");
    expect(readFileSync(lateElsewhere, "utf8")).toBe("late\n");
    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(BINDINGS_AFTER);
  });

  test.each<[string, string[]]>([["without --expect", []], ["with --expect", ["--expect"]]])(
    "an edit to a listed file while the person confirms refuses and throws nothing away, %s",
    async (_label, expectFlag) => {
      const { packDir } = makeCommittedPack();
      writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
      const signature = expectFlag.length > 0 ? [...expectFlag, (await changesJson(["--pack", "acme", "--pack-dir", packDir])).signature] : [];
      const later = BINDINGS_AFTER.replace("plan-policy-strict", "plan-policy-loose");

      const { exitCode, stderr } = await discardWith(
        {
          interactive: () => true,
          confirm: async () => {
            writeFile(join(packDir, "pack", "skills.jsonc"), later);
            return true;
          },
        },
        ["--pack", "acme", "--pack-dir", packDir, ...signature],
      );

      expect(exitCode).toBe(1);
      expect(stderr).toContain("changed while");
      expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(later);
    },
  );

  test("--json never prompts, even at a terminal", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);

    const { exitCode, stdout } = await discardWith({ interactive: () => true }, ["--pack", "acme", "--pack-dir", packDir, "--json"]);

    expect(exitCode).toBeUndefined();
    expect(JSON.parse(stdout).discarded).toEqual([{ path: "pack/skills.jsonc", status: "M" }]);
  });
});

describe("skillsDiscard --expect", () => {
  test("a signature that still matches throws the changes away as before", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    writeFile(join(packDir, "attachments", "x", "SKILL.md"), "new skill\n");
    const { signature } = await changesJson(["--pack", "acme", "--pack-dir", packDir]);

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir, "--expect", signature]);

    expect(d.discarded).toEqual([
      { path: "pack/skills.jsonc", status: "M" },
      { path: "attachments/x/SKILL.md", status: "??" },
    ]);
    expect(porcelain(packDir)).toBe("");
  });

  test.each<[string, (packDir: string) => void]>([
    ["a listed file edited again", (dir) => writeFile(join(dir, "pack", "skills.jsonc"), BINDINGS_BEFORE.replace("plan-policy", "plan-policy-loose"))],
    ["a new file in scope", (dir) => writeFile(join(dir, "skills", "late", "SKILL.md"), "late\n")],
  ])("%s after the signature was read refuses and throws nothing away", async (_label, move) => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);
    writeFile(join(packDir, "attachments", "x", "SKILL.md"), "new skill\n");
    const { signature } = await changesJson(["--pack", "acme", "--pack-dir", packDir]);
    move(packDir);
    const before = porcelain(packDir);

    const { exitCode, stderr } = await runSkillsCapturing(["discard", "--pack", "acme", "--pack-dir", packDir, "--expect", signature, "--json"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("changed since");
    expect(porcelain(packDir)).toBe(before);
    expect(readFileSync(join(packDir, "attachments", "x", "SKILL.md"), "utf8")).toBe("new skill\n");
  });

  test("an --expect that is not a signature is a usage error that touches nothing", async () => {
    const { packDir } = makeCommittedPack();
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);

    const { exitCode, stderr } = await runSkillsCapturing(["discard", "--pack", "acme", "--pack-dir", packDir, "--expect", "nope", "--json"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("signature");
    expect(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).toBe(BINDINGS_AFTER);
  });
});

describe("skillsDiscard renames", () => {
  test("a rename inside the scope is undone on both sides", async () => {
    const { packDir } = makeCommittedPack();
    mkdirSync(join(packDir, "skills"));
    git(packDir, "mv", "attachments/stage-plan", "skills/stage-plan");

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(d.discarded).toEqual([{ path: "skills/stage-plan/SKILL.md", status: "R", from: "attachments/stage-plan/SKILL.md" }]);
    expect(readFileSync(join(packDir, "attachments", "stage-plan", "SKILL.md"), "utf8")).toBe("stage plan\n");
    expect(existsSync(join(packDir, "skills"))).toBe(false);
    expect(porcelain(packDir)).toBe("");
  });

  test("a rename across the scope boundary is left alone, even beside a pack file that is thrown away", async () => {
    const { packDir } = makeCommittedPack();
    git(packDir, "mv", "README.md", "pack/README.md");
    writeFile(join(packDir, "pack", "skills.jsonc"), BINDINGS_AFTER);

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(d.discarded).toEqual([{ path: "pack/skills.jsonc", status: "M" }]);
    expect(readFileSync(join(packDir, "pack", "README.md"), "utf8")).toBe("readme\n");
    expect(porcelain(packDir)).toBe("R  README.md -> pack/README.md\n");
  });

  test("a rename into a subdirectory pack from elsewhere in its repo is left alone", async () => {
    const { repoRoot, packDir } = makeCommittedPack("packs/acme");
    writeFile(join(repoRoot, "NOTES.md"), "notes\n");
    commitAll(repoRoot);
    git(repoRoot, "mv", "NOTES.md", "packs/acme/pack/NOTES.md");

    const d = await discardJson(["--pack", "acme", "--pack-dir", packDir]);

    expect(d.discarded).toEqual([]);
    expect(porcelain(repoRoot)).toBe("R  NOTES.md -> packs/acme/pack/NOTES.md\n");
  });
});


describe("pack role refusals", () => {
  for (const username of ["dev4", "dev2"]) for (const target of ["team", "root", "..pack"]) for (const json of [[], ["--json"]]) {
    if (username === "dev2" && target === "team") continue;
    test(`${username} writes to ${target} are refused ${json.length ? "as JSON" : "for a person"}`, async () => {
      const savedHome = process.env.HOME;
      process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rt-pack-role-")));
      try {
        seedRoleOrg({ org: "acme", username, roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } }, teams: { widgets: {} } });
        const orgRoot = join(process.env.HOME!, ".mattstack", "orgs", "acme");
        const packDir = target === "root" ? orgRoot : target === "..pack" ? join(orgRoot, "..pack") : join(orgRoot, "mattstack", "teams", "widgets", "plugin");
        writeFile(join(packDir, ".claude-plugin", "plugin.json"), '{"name":"widgets","version":"1.0.0"}');
        const title = target === "team" ? "The widgets team's files belong to its owners" : "The org's shared files belong to its admins";
        const refusal = `${title}. ${target === "team" ? "Ask dev2 (the team's owner) or dev1 (an org admin) to make this change." : "Ask dev1 (an org admin) to make this change."}`;

      writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
      const mattstackDir = makeMattstackDir();
      const manifestPath = makeManifest();
      const flags = ["--pack-dir", packDir, "--manifest", manifestPath, "--mattstack-dir", mattstackDir, ...json];
      const result = await runExpectingCleanExit(() => skillsCompile(flags));
      expect(result.exitCode).toBe(2);
      if (json.length) expect(JSON.parse(io.lines().at(-1)!)).toEqual({ pack: "widgets", packDir, manifestPath, repoKey: dirname(manifestPath).split("/").at(-1), written: false, verbs: [{ name: "watch-ci", status: "errored", files: [], warnings: [], errors: [refusal], side: "skills" }], misplaced: [] });
      else expect(io.stderr()).toStartWith(`[refused] ${title}`);
      expect(readFileSync(join(packDir, "pack", "stubs.jsonc"), "utf8")).toBe(STUBS_JSONC);
      expect(readFileSync(join(packDir, ".claude-plugin", "plugin.json"), "utf8")).toBe('{"name":"widgets","version":"1.0.0"}');
      expect((await compilePackAll({ packDir, manifest: manifestPath, mattstackDir })).errors).toEqual([refusal]);
      expect((await runExpectingCleanExit(() => skillsCompile([...flags, "--dry-run"]))).exitCode).toBeUndefined();
      expect(existsSync(join(packDir, "skills", "watch-ci", "SKILL.md"))).toBe(false);

      } finally { process.env.HOME = savedHome; }
    });
  }
});


describe("a Mac with two org clones", () => {
  for (const json of [[], ["--json"]]) test(`a member's compile of the other org's pack is refused ${json.length ? "as JSON" : "for a person"}`, async () => {
    const savedHome = process.env.HOME;
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rt-two-orgs-")));
    const seed = seedRoleOrg;
    try {
        const roles = { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } };
        seed({ org: "acme", username: "dev4", roles, teams: { widgets: {} } });
        seed({ org: "beta", username: "dev4", roles, teams: { widgets: {} } });
        const packDir = join(process.env.HOME!, ".mattstack", "orgs", "beta", "mattstack", "teams", "widgets", "plugin");
        writeFile(join(packDir, ".claude-plugin", "plugin.json"), '{"name":"widgets","version":"1.0.0"}');
        const title = "This pack is in the beta org, not the one this Mac uses";
        const refusal = `${title}. rt works with one org per Mac, and this Mac uses acme`;
      writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
      const mattstackDir = makeMattstackDir();
      const manifestPath = makeManifest();
      const flags = ["--pack-dir", packDir, "--manifest", manifestPath, "--mattstack-dir", mattstackDir, ...json];
      const result = await runExpectingCleanExit(() => skillsCompile(flags));
      expect(result.exitCode).toBe(2);
      if (json.length) expect(JSON.parse(io.lines().at(-1)!).verbs[0].errors).toEqual([refusal]);
      else expect(io.stderr()).toBe(`[refused] ${title}\n  why: rt works with one org per Mac, and this Mac uses acme\n`);
      expect(readFileSync(join(packDir, "pack", "stubs.jsonc"), "utf8")).toBe(STUBS_JSONC);
      expect(existsSync(join(packDir, "skills", "watch-ci", "SKILL.md"))).toBe(false);
    } finally { process.env.HOME = savedHome; }
  });

  test("an owner still compiles a pack in the org this Mac uses", async () => {
    const savedHome = process.env.HOME;
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rt-two-orgs-")));
    try {
      const roles = { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } };
      seedRoleOrg({ org: "acme", username: "dev2", roles, teams: { widgets: {} } });
      seedRoleOrg({ org: "beta", username: "dev2", roles, teams: { widgets: {} } });
      const packDir = join(process.env.HOME!, ".mattstack", "orgs", "acme", "mattstack", "teams", "widgets", "plugin");
      writeFile(join(packDir, ".claude-plugin", "plugin.json"), '{"name":"widgets","version":"1.0.0"}');
      writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
      const result = await runExpectingCleanExit(() => skillsCompile(["--pack-dir", packDir, "--manifest", makeManifest(), "--mattstack-dir", makeMattstackDir()]));
      expect(result.exitCode).toBeUndefined();
      expect(existsSync(join(packDir, "skills", "watch-ci", "SKILL.md"))).toBe(true);
    } finally { process.env.HOME = savedHome; }
  });
});

test("a zero-target JSON compile refusal keeps its report and explains why on stderr", async () => {
  const savedHome = process.env.HOME;
  process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rt-empty-pack-role-")));
  try {
    seedRoleOrg({ org: "acme", username: "dev4", roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } }, teams: { widgets: {} } });
    const packDir = join(process.env.HOME!, ".mattstack", "orgs", "acme", "mattstack", "teams", "widgets", "plugin");
    const stubs = join(packDir, "pack", "stubs.jsonc");
    writeFile(stubs, '{"verbs":{}}');
    writeFile(join(packDir, ".claude-plugin", "plugin.json"), '{"name":"widgets","version":"1.0.0"}');
    const mattstackDir = makeMattstackDir();
    const manifestPath = makeManifest();
    const result = await runExpectingCleanExit(() => skillsCompile(["--pack-dir", packDir, "--manifest", manifestPath, "--mattstack-dir", mattstackDir, "--json"]));
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(io.stdout())).toEqual({ pack: "widgets", packDir, manifestPath: null, repoKey: "", written: false, verbs: [], misplaced: [] });
    expect(io.stderr()).toStartWith("[refused] The widgets team's files belong to its owners");
    expect(io.stderr()).toContain("Ask dev2 (the team's owner) or dev1 (an org admin) to make this change.");
    expect(readFileSync(stubs, "utf8")).toBe('{"verbs":{}}');
    expect(readdirSync(packDir).sort()).toEqual([".claude-plugin", "pack"]);
  } finally { process.env.HOME = savedHome; }
});

const TABLE_WORK_SKILL_MD = `---
name: work
description: "Run a unit of work"
type: pipeline-step
---

Walk the stages below.

{{pipeline.table}}

{{run-start.flags:work}}

Resume only {{run-list.pipelines}}.
`;

const WORK_RUN = ["mattstack:stage-provision", "mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship", "mattstack:stage-watch-ci"];

type TablePack = { flags: string[]; packDir: string; mattstackDir: string; manifestPath: string };

/** A pack whose `work` engine renders the stage table, with every stage WORK_RUN names behind a real SKILL.md. */
function makeTablePack(verbs: Record<string, { pipeline?: unknown }>, manifest: string): TablePack {
  const mattstackDir = makeMattstackDir();
  const engines = join(mattstackDir, "plugins", "mattstack", "attachments", "pipeline");
  writeFile(join(engines, "work", "index.block.md"), TABLE_WORK_SKILL_MD);
  writeFile(join(engines, "stage-implement", "index.block.md"), stageSkillMd("stage-implement", "implement"));
  writeFile(join(engines, "stage-watch-ci", "index.block.md"), stageSkillMd("stage-watch-ci", "watch-ci"));
  const packDir = makePackDir();
  const stubs = Object.fromEntries(Object.entries(verbs).map(([name, extra]) => [name, { engine: "work", description: "Run work", ...extra }]));
  writeFile(join(packDir, "pack", "stubs.jsonc"), JSON.stringify({ verbs: stubs }));
  const manifestPath = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-table-"))), "skills.jsonc");
  writeFile(manifestPath, manifest);
  return { flags: ["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath], packDir, mattstackDir, manifestPath };
}

async function expectRefused({ flags, packDir, mattstackDir, manifestPath }: TablePack, message: string): Promise<void> {
  const fixture = { packDir, mattstackDir, manifest: manifestPath };
  const payload = await checkPack(fixture);
  expect(payload.chainErrors).toContain(message);
  expect(payload.drift).toBe(true);
  expect(payload.compileErrors.join("\n")).not.toContain("{{");
  const compiled = await compilePackAll(fixture);
  expect(compiled.ok).toBe(false);
  expect(compiled.errors).toContain(message);
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(flags));
  expect(exitCode).toBe(1);
  expect(errors.join("\n")).toContain(message);
}

describe("a work verb's pipeline", () => {
  test("verb names an undeclared pipeline", async () => {
    const pack = makeTablePack(
      { work: {}, "work-a11y": { pipeline: "accessibility" } },
      JSON.stringify({ pipelines: { feature: WORK_RUN }, bindings: {} }),
    );
    await expectRefused(pack, 'verb "work-a11y" runs pipeline "accessibility", which the manifest does not declare');
  });

  test("several pipelines, none feature, and a table verb that names none", async () => {
    const pack = makeTablePack({ work: {} }, JSON.stringify({ pipelines: { alpha: WORK_RUN, beta: WORK_RUN }, bindings: {} }));
    await expectRefused(pack, 'verb "work" names no pipeline and the manifest declares several with none named feature');
  });

  test("a pipeline a table verb runs must have the work run's shape", async () => {
    const pack = makeTablePack(
      { work: {}, "work-a11y": { pipeline: "accessibility" } },
      JSON.stringify({ pipelines: { feature: WORK_RUN, accessibility: ["mattstack:stage-plan", "mattstack:stage-ship"] }, bindings: {} }),
    );
    await expectRefused(pack, 'pipeline "accessibility" must start with stage-provision, end with stage-watch-ci, and include stage-implement and stage-ship');
  });

  test("the same subset pipeline passes in a pack whose verbs never render the table", async () => {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const manifestPath = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-table-"))), "skills.jsonc");
    writeFile(manifestPath, JSON.stringify({ pipelines: { accessibility: ["mattstack:stage-plan", "mattstack:stage-ship"] }, bindings: {} }));
    const payload = await checkPack({ packDir, mattstackDir, manifest: manifestPath });
    expect(payload.chainErrors).toEqual([]);
  });

  test("a work verb naming a plain-list pipeline with a bad name", async () => {
    const pack = makeTablePack(
      { work: {}, "work-a11y": { pipeline: "Access_ibility" } },
      JSON.stringify({ pipelines: { feature: WORK_RUN, Access_ibility: WORK_RUN }, bindings: {} }),
    );
    await expectRefused(pack, 'pipeline "Access_ibility" must match [a-z][a-z0-9-]*');
  });

  test("-- in a pipeline a work verb names is refused", async () => {
    const pack = makeTablePack(
      { work: {}, "work-a11y": { pipeline: "a--b" } },
      JSON.stringify({ pipelines: { feature: WORK_RUN, "a--b": WORK_RUN }, bindings: {} }),
    );
    await expectRefused(pack, 'pipeline "a--b" must not contain "--"');
  });

  test("a hand-written override naming a stage its pipeline does not list", async () => {
    const pack = makeTablePack(
      { work: {}, "work-a11y": { pipeline: "accessibility" } },
      JSON.stringify({
        pipelines: { feature: WORK_RUN, accessibility: { stages: WORK_RUN, bindings: { "mattstack:stage-x": { domain: "acme:watch-ci-domain" } } } },
        bindings: {},
      }),
    );
    await expectRefused(pack, 'pipeline "accessibility" binds mattstack:stage-x but does not list it');
  });

  test("a non-string pipeline in stubs is refused, naming the verb", async () => {
    const { flags } = makeTablePack({ work: { pipeline: 7 } }, JSON.stringify({ pipelines: { feature: WORK_RUN }, bindings: {} }));
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(flags));
    expect(exitCode).not.toBeUndefined();
    expect(errors.join("\n")).toContain('verb "work" in');
    expect(errors.join("\n")).toContain("pipeline that is not a string");
  });

  test("a dropped override is a warning: check passes and --json carries it", async () => {
    const dropped = { key: "feature/mattstack:stage-gates domain", layer: "base:acme-base" };
    const { flags, packDir, mattstackDir, manifestPath } = makeTablePack(
      { work: {} },
      `// GENERATED by rt skills materialize\n// provenance (binding <- layer):\n//   pipeline feature <- pack\n// dropped: ${dropped.key} <- ${dropped.layer}\n${JSON.stringify({ pipelines: { feature: WORK_RUN }, bindings: {} })}\n`,
    );
    const compiled = await runExpectingCleanExit(() => skillsCompile(flags));
    expect(compiled.errors).toEqual([]);
    const payload = await checkPack({ packDir, mattstackDir, manifest: manifestPath });
    expect(payload.drift).toBe(false);
    expect(payload.droppedOverrides).toEqual([dropped]);

    io.clear();
    await skillsCheck([...flags, "--json"]);
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(io.stdout()).droppedOverrides).toEqual([dropped]);

    io.clear();
    await skillsCheck(flags);
    expect(io.lines().some((l) => l.includes(dropped.key) && l.includes(dropped.layer))).toBe(true);
  });

  test("composition lists a verb.path placeholder per table row on the work verb", async () => {
    const { flags } = makeTablePack({ work: {} }, JSON.stringify({ pipelines: { feature: WORK_RUN }, bindings: {} }));
    const payload = await compositionJson(flags);
    const work = payload.targets.find((t: { name: string }) => t.name === "work");
    const rows = work.placeholders.filter((p: { kind: string }) => p.kind === "verb.path");
    expect(rows.map((p: { arg: string }) => p.arg)).toEqual(WORK_RUN.map((r) => r.slice("mattstack:".length)));
    expect(new Set(rows.map((p: { line: number }) => p.line)).size).toBe(1);
    expect(work.placeholders.some((p: { kind: string }) => p.kind === "pipeline.table")).toBe(false);
  });
});

describe("pack/pipelines.json and the field contract in compile and check", () => {
  const fillMd = (name: string, body: string) =>
    `---\nname: ${name}\ndescription: "${name}"\nmetadata:\n  provides: "watch-ci-domain@1"\n---\n\n${body}\n`;
  const stageMd = (name: string, stage: string) =>
    `---\nname: ${name}\ndescription: "${stage} stage"\ntype: pipeline-step\nprops:\n  domain:\n    merge: replace\n    default: ""\n    contract: "watch-ci-domain@1"\nmetadata:\n  stage: ${stage}\n---\n\n{{props.domain}}\n`;

  /** Two stages with a domain prop: plan reads extra.plan-verdict; provision writes it only when `writer` is set. */
  function makeFieldPack(opts: { writer: boolean }) {
    const mattstackDir = makeMattstackDir();
    const mattstackPluginDir = join(mattstackDir, "plugins", "mattstack");
    writeFile(join(mattstackPluginDir, "attachments", "pipeline", "stage-plan", "index.block.md"), stageMd("stage-plan", "plan"));
    writeFile(join(mattstackPluginDir, "attachments", "pipeline", "stage-provision", "index.block.md"), stageMd("stage-provision", "provision"));
    const acmeDir = join(mattstackDir, "plugins", "acme");
    writeFile(join(acmeDir, "attachments", "plan-reader", "SKILL.md"), fillMd("plan-reader", "Read it: run_field_get {key: extra.plan-verdict}"));
    writeFile(join(acmeDir, "attachments", "provision-fill", "SKILL.md"), fillMd(
      "provision-fill",
      opts.writer ? "Write it: run_field_set {key: extra.plan-verdict, value: yes, stage: plan}" : "Nothing to record.",
    ));
    const packDir = makePackDir();
    const manifestDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-fieldpack-")));
    const manifestPath = join(manifestDir, "skills.jsonc");
    writeFile(manifestPath, JSON.stringify({
      pipelines: { feature: ["mattstack:stage-plan", "mattstack:stage-provision"] },
      bindings: {
        "mattstack:watch-ci": { domain: "acme:watch-ci-domain", forge: "mattstack:gitlab-forge" },
        "mattstack:stage-plan": { domain: "acme:plan-reader" },
        "mattstack:stage-provision": { domain: "acme:provision-fill" },
      },
    }));
    return { mattstackDir, packDir, manifestPath, flags: ["--pack", "t", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath] };
  }

  test("compile writes pack/pipelines.json for a pack with a pipeline", async () => {
    const { mattstackDir, packDir, manifestPath } = makeFieldPack({ writer: true });

    const result = await compilePackAll({ pack: "t", packDir, mattstackDir, manifest: manifestPath });

    expect(result.ok).toBe(true);
    expect(result.written).toContain("pack/pipelines.json");
    expect(JSON.parse(readFileSync(join(packDir, "pack", "pipelines.json"), "utf8"))).toEqual({
      version: 1,
      pipelines: {
        feature: [
          { stage: "plan", name: "stage-plan", file: "attachments/stage-plan/SKILL.md", consumes: [], produces: [] },
          { stage: "provision", name: "stage-provision", file: "attachments/stage-provision/SKILL.md", consumes: [], produces: [] },
        ],
      },
    });
  });

  test("check reports a missing or stale pack/pipelines.json", async () => {
    const { flags, packDir } = makeFieldPack({ writer: true });
    await skillsCompile(flags);
    rmSync(join(packDir, "pack", "pipelines.json"));
    io.clear();

    await skillsCheck(flags);

    expect(io.lines().some((l) => l.includes("pack/pipelines.json is out of date with the pack's pipelines"))).toBe(true);
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    io.clear();
    await skillsCheck([...flags, "--json"]);
    expect(JSON.parse(io.lines().join("\n")).compileErrors).toContain("pack/pipelines.json is out of date with the pack's pipelines");
  });

  describe("when the field contract is routed as a warning", () => {
    beforeEach(() => setFieldContractSeverityForTest("warn"));
    afterEach(() => setFieldContractSeverityForTest(null));

    test("compile warns, and still writes, when a fill reads a field nothing writes", async () => {
      const { flags, packDir } = makeFieldPack({ writer: false });

      const { exitCode, stderr } = await runSkillsCapturing(["compile", ...flags]);

      expect(exitCode).toBeUndefined();
      expect(process.exitCode ?? 0).toBe(0);
      expect(existsSync(join(packDir, "pack", "pipelines.json"))).toBe(true);
      expect(stderr).not.toContain("did not compile");
      const text = io.lines().join("\n");
      expect(text).toContain("field contract: 1 warning");
      expect(text).toContain('field contract: attachments/stage-plan/SKILL.md');
      expect(text).toContain('reads "extra.plan-verdict", which nothing in this pack writes');
    });

    test("compile --json lists the field-contract lines under fieldContract and exits 0, even under strict", async () => {
      const { flags, packDir } = makeFieldPack({ writer: false });

      await skillsCompile([...flags, "--json", "--strict"]);

      const parsed = JSON.parse(io.stdout());
      expect(process.exitCode ?? 0).toBe(0);
      expect(parsed.written).toBe(true);
      expect(parsed.fieldContract).toHaveLength(1);
      expect(parsed.fieldContract[0]).toContain('field contract: attachments/stage-plan/SKILL.md');
      expect(existsSync(join(packDir, "pack", "pipelines.json"))).toBe(true);
    });

    test("compile --json carries an empty fieldContract when the pack is clean", async () => {
      const { flags } = makeFieldPack({ writer: true });

      await skillsCompile([...flags, "--json"]);

      expect(JSON.parse(io.stdout()).fieldContract).toEqual([]);
    });

    test("check warns on the same pack: fieldContract set, no drift, exit 0", async () => {
      const { flags } = makeFieldPack({ writer: false });
      await skillsCompile(flags);
      io.clear();

      await skillsCheck([...flags, "--json", "--strict"]);

      const parsed = JSON.parse(io.stdout());
      expect(parsed.fieldContract).toHaveLength(1);
      expect(parsed.fieldContract[0]).toStartWith("field contract: attachments/stage-plan/SKILL.md");
      expect(parsed.compileErrors).toEqual([]);
      expect(process.exitCode ?? 0).toBe(0);

      io.clear();
      await skillsCheck(flags);
      expect(io.lines().join("\n")).toContain("field contract: 1 warning");
      expect(process.exitCode ?? 0).toBe(0);
    });
  });

  describe("by default the field contract is an error", () => {
    test("compile --json exits 1, writes nothing, and says why under fieldContract", async () => {
      const { flags, packDir } = makeFieldPack({ writer: false });

      await skillsCompile([...flags, "--json"]);

      const parsed = JSON.parse(io.stdout());
      expect(parsed.written).toBe(false);
      expect(parsed.fieldContract).toHaveLength(1);
      expect(parsed.fieldContract[0]).toStartWith("field contract: attachments/stage-plan/SKILL.md");
      expect(process.exitCode).toBe(1);
      expect(existsSync(join(packDir, "pack", "pipelines.json"))).toBe(false);
    });

    test("compile fails and writes nothing", async () => {
      const { flags, packDir } = makeFieldPack({ writer: false });

      const { exitCode, stderr } = await runSkillsCapturing(["compile", ...flags]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('field contract: attachments/stage-plan/SKILL.md');
      expect(stderr).toContain("(from acme:plan-reader");
      expect(stderr).toContain('reads "extra.plan-verdict", which nothing in this pack writes');
      expect(existsSync(join(packDir, "pack", "pipelines.json"))).toBe(false);
    });

    test("check reports it in compileErrors, marks drift and exits 1", async () => {
      const { flags } = makeFieldPack({ writer: false });
      // Compile scoped to the stages so the dirs exist; the pack-wide check is what a full check adds.
      await skillsCompile([...flags, "--verb", "watch-ci", "--verb", "stage-plan", "--verb", "stage-provision"]);
      io.clear();

      await skillsCheck([...flags, "--json"]);

      const parsed = JSON.parse(io.stdout());
      expect(parsed.compileErrors.some((e: string) => e.startsWith("field contract: attachments/stage-plan/SKILL.md"))).toBe(true);
      expect(parsed.fieldContract).toEqual([]);
      expect(process.exitCode).toBe(1);
    });
  });

  test("compile passes when another verb's fill writes the field", async () => {
    const { mattstackDir, packDir, manifestPath } = makeFieldPack({ writer: true });

    const result = await compilePackAll({ pack: "t", packDir, mattstackDir, manifest: manifestPath });

    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  test("a --verb scoped compile skips both", async () => {
    const { mattstackDir, packDir, manifestPath } = makeFieldPack({ writer: false });

    const result = await compilePackAll({ pack: "t", packDir, mattstackDir, manifest: manifestPath, verbs: ["stage-plan"] });

    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(existsSync(join(packDir, "pack", "pipelines.json"))).toBe(false);
  });
});

describe("skillsCompile: a fill that includes a block tree", () => {
  const ENGINE = (after = "") => `---
name: watch-ci
description: "Watch CI until it goes green"
type: pipeline-step
props:
  domain:
    merge: replace
    default: ""
    contract: "watch-ci-domain@1"
---

# Watch CI

Poll the pipeline.

{{props.domain}}
${after}`;

  const TONE_TREE = `---
props:
  voice:
    merge: replace
    default: ""
---

# Tone lookup

Read the tone.

{{props.voice}}

{{include:tone-note}}
`;

  function makeFixture(opts: { domainTail: string; engineAfter?: string; voiceBody?: string }) {
    const mattstackDir = makeMattstackDir();
    const packDir = makePackDir();
    const plugins = join(mattstackDir, "plugins");
    writeFile(join(plugins, "mattstack", "skills", "pipeline", "watch-ci", "index.block.md"), ENGINE(opts.engineAfter));
    writeFile(join(plugins, "mattstack", "attachments", "tone-lookup", "index.block.md"), TONE_TREE);
    writeFile(join(plugins, "mattstack", "attachments", "tone-note", "SKILL.md"), "---\nname: tone-note\n---\n\nTone note body.\n");
    writeFile(join(plugins, "acme", "attachments", "tone-voice", "SKILL.md"), `---\nname: tone-voice\ndescription: "Voice"\nmetadata:\n  provides: "tone-voice@1"\n---\n\n${opts.voiceBody ?? "Speak plainly."}\n`);
    writeFile(join(plugins, "acme", "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD + opts.domainTail);
    const manifestPath = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-cli-manifest-"))), "skills.jsonc");
    writeFile(manifestPath, `{
  "bindings": {
    "mattstack:watch-ci": { "domain": "acme:watch-ci-domain" },
    "mattstack:tone-lookup": { "voice": "acme:tone-voice" }
  }
}
`);
    return { mattstackDir, packDir, manifestPath };
  }

  const compile = (f: ReturnType<typeof makeFixture>) =>
    runExpectingCleanExit(() => skillsCompile(["--pack-dir", f.packDir, "--mattstack-dir", f.mattstackDir, "--manifest", f.manifestPath]));

  test("renders the tree under the prop's heading, with the tree's own prop and nested include", async () => {
    const f = makeFixture({ domainTail: "\n{{include:tone-lookup}}\n" });
    const { exitCode, errors } = await compile(f);
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();
    const md = readFileSync(join(f.packDir, "skills", "watch-ci", "SKILL.md"), "utf8");
    expect(md).toContain("\n## Tone lookup\n\nRead the tone.\n");
    expect(md).toContain("Speak plainly.");
    expect(md).toContain("Tone note body.");
    expect(md).not.toContain("{{");
  });

  test("a fill that includes the tree it fills is refused as a self-include at the fill's line", async () => {
    const f = makeFixture({ domainTail: "\n{{include:tone-lookup}}\n", voiceBody: "Speak plainly.\n\n{{include:tone-lookup}}" });
    const { exitCode, errors } = await compile(f);
    expect(exitCode).toBe(1);
    const text = errors.join("\n");
    expect(text).toContain("attachments/tone-voice/SKILL.md:10:1");
    expect(text).toContain("{{include:tone-lookup}} would include itself: tone-lookup -> tone-lookup");
  });

  test("fill text after a tree include that carries headings is refused", async () => {
    const f = makeFixture({ domainTail: "\n{{include:tone-lookup}}\n\nMore domain text.\n" });
    const { exitCode, errors } = await compile(f);
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("text after {{include:tone-lookup}}: an include that carries headings must be the last thing in its fill");
  });

  test("block text after a prop whose fill ends with a tree include that carries headings is refused", async () => {
    const f = makeFixture({ domainTail: "\n{{include:tone-lookup}}\n", engineAfter: "\nThen report.\n" });
    const { exitCode, errors } = await compile(f);
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("text after {{include:tone-lookup}}: an include that carries headings must be the last thing in its block");
  });

  describe("in a base-pack fill that carries team sections", () => {
    const BASE_ENGINE = `---
name: watch-ci
description: "Watch CI until it goes green"
type: pipeline-step
props:
  forge:
    merge: replace
    contract: "ci-forge@1"
  domain:
    merge: replace
    default: ""
    contract: "watch-ci-domain@1"
---

# Watch CI

{{props.forge}}

{{props.domain}}
`;

    function seedBase(domainTail: string, sections: Record<string, string> = {}) {
      const mattstackDir = makeMattstackDir();
      seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
      const plugins = join(mattstackDir, "plugins", "mattstack");
      writeFile(join(plugins, "skills", "pipeline", "watch-ci", "index.block.md"), BASE_ENGINE);
      writeFile(join(plugins, "attachments", "tone-lookup", "index.block.md"), TONE_TREE);
      writeFile(join(plugins, "attachments", "tone-note", "SKILL.md"), "---\nname: tone-note\n---\n\nTone note body.\n");
      const baseDir = join(mattstackDir, "orgs", "acme", "mattstack", "org", "packs", "acme-base");
      const packDir = teamPackDir(mattstackDir, "acme", "widgets");
      writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
      writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD + domainTail);
      writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
      writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
      writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
      writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
      writeFile(join(packDir, "pack", "params.jsonc"), JSON.stringify({ version: 1, params: {} }));
      for (const [name, text] of Object.entries(sections)) writeFile(join(packDir, "pack", "sections", `${name}.md`), text);
      const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: plugins }, "https://gitlab.example.com/acme/widgets.git");
      if (out.kind !== "written" || !out.packs[0]?.ok) throw new Error("materialize failed");
      return { packDir, compile: () => runExpectingCleanExit(() => skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir])) };
    }

    test("an optional section the team leaves empty above the include compiles", async () => {
      const { packDir, compile } = seedBase("\n{{team.section:extra?}}\n\n{{include:tone-lookup}}\n");
      const { exitCode, errors } = await compile();
      expect(errors).toEqual([]);
      expect(exitCode).toBeUndefined();
      expect(readFileSync(join(packDir, "skills", "watch-ci", "SKILL.md"), "utf8")).toContain("\n## Tone lookup\n\nRead the tone.\n");
    });

    test("text after the include is refused at its source line when a section above it expands", async () => {
      // DOMAIN_SKILL_MD ends on file line 10, so the tail's lines are 11 (blank), 12 (section), 13, 14 (include), 15, 16.
      const { compile } = seedBase("\n{{team.section:extra}}\n\n{{include:tone-lookup}}\n\nMore domain text.\n", { extra: "Extra one.\nExtra two.\n" });
      const { exitCode, errors } = await compile();
      expect(exitCode).toBe(1);
      const text = errors.join("\n");
      expect(text).toContain("attachments/watch-ci-domain/SKILL.md:16:1");
      expect(text).toContain("text after {{include:tone-lookup}}: an include that carries headings must be the last thing in its fill");
    });
  });
});
