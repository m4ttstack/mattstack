import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkPack, skillsAnatomy, skillsBind, skillsCheck, skillsCompile, skillsComposition } from "../../../commands/skills.ts";
import { childEnv } from "../../subprocess.ts";
import { captureSkills, runExpectingCleanExit } from "./helpers.ts";

const FIX = join(import.meta.dir, "fixtures", "compile-native");
const PIPELINES_FIX = join(import.meta.dir, "fixtures", "compile-pipelines");
const REAL_MODEL_TIERING = join(import.meta.dir, "..", "..", "..", "plugins", "mattstack", "skills", "model-tiering");
const REAL_ATTACHMENTS = join(import.meta.dir, "..", "..", "..", "plugins", "mattstack", "attachments");

function treeOf(dir: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) Object.assign(files, treeOf(path, rel));
    else files[rel] = readFileSync(path, "utf8");
  }
  return files;
}

async function build() {
  const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
  cpSync(FIX, root, { recursive: true });
  const pack = join(root, "pack");
  const ms = join(root, "mattstack-home");
  const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
  await skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);
  return { pack, ms, manifest };
}

describe("compile-native end to end", () => {
  // A stale-check finding sets process.exitCode = 1 directly (no process.exit,
  // so --json can still print); only 0 clears it in Bun.
  afterEach(() => {
    process.exitCode = 0;
  });

  test("work and every compiled stage compile with zero resolver references and zero placeholders", async () => {
    const { pack } = await build();
    const work = readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8");
    const stages = ["stage-plan", "stage-implement", "stage-ship"].map(
      (name) => [name, readFileSync(join(pack, "attachments", name, "SKILL.md"), "utf8")] as const,
    );

    for (const md of [work, ...stages.map(([, body]) => body)]) {
      expect(md).not.toContain("resolve-args");
      expect(md).not.toContain("resolve-pipeline");
      expect(md).not.toContain("{{");
    }
    expect(work).toContain("<!-- part: block:work source=mattstack:work");
    expect(work).toMatch(/--mattstack-sha \S+ --mattstack-dirty [01]/);
    // build() copies the fixture to a temp dir with no git history, so the baked value is the pack's plugin.json version.
    expect(work).toContain("--pack-sha acme=0.1.0");
    for (const [name, body] of stages) {
      expect(body).toContain(`<!-- part: block:${name} source=mattstack:${name}`);
    }

    const plan = stages.find(([name]) => name === "stage-plan")![1];
    // The fill comes from the pack under compilation, at the pack's own version --
    // never from an installed copy of a previous release.
    expect(plan).toContain("<!-- part: prop:stage-plan.rules binding=acme:plan-policy version=0.1.0 path=attachments/plan-policy/SKILL.md");
    expect(plan).toContain("<!-- part: include:gitlab-note");
    expect(plan).toContain("note body");
    expect(existsSync(join(pack, "skills", "work", "scripts", "resolve-pipeline.sh"))).toBe(false);

    // The include's own extra files vendor under the compiling stage's parts
    // dir, and the rewritten body path is what actually resolves there --
    // not just a plausible-looking one.
    expect(existsSync(join(pack, "attachments", "stage-plan", "parts", "include-gitlab-note", "scripts", "note.sh"))).toBe(true);
    expect(plan).toContain(
      "@stage-plan/parts/include-gitlab-note/scripts/note.sh",
    );
  });

  test("no overrides is byte-identical", async () => {
    const { pack } = await build();
    expect(treeOf(pack)).toMatchSnapshot();
  });

  test("a surface-public stage is referenced at skills/, where it is emitted", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
    cpSync(FIX, root, { recursive: true });
    const pack = join(root, "pack");
    const ms = join(root, "mattstack-home");
    const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
    writeFileSync(join(pack, "pack", "surface.jsonc"), JSON.stringify({ public: ["work", "stage-plan"] }));

    await skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);

    expect(existsSync(join(pack, "skills", "stage-plan", "SKILL.md"))).toBe(true);
    expect(existsSync(join(pack, "attachments", "stage-plan"))).toBe(false);
    const work = readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8");
    const { keys } = JSON.parse(readFileSync(join(pack, "skills", "work", "compiled.json"), "utf8")) as { keys: Record<string, string> };
    expect(work).toContain('"read": "@stage-plan/SKILL.md"');
    expect(keys["stage-plan/SKILL.md"]).toBe("skills/stage-plan/SKILL.md");
    expect(work).not.toContain("attachments/stage-plan");
    expect(keys["stage-implement/SKILL.md"]).toBe("attachments/stage-implement/SKILL.md");
  });

  test("pipeline.stages names each stage's file by key, never by token", async () => {
    const { pack } = await build();
    const work = readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8");
    const fence = work.match(/```json\n(\{\n  "feature"[\s\S]*?)\n```/)![1]!;
    const entries = (JSON.parse(fence) as { feature: Record<string, unknown>[] }).feature;
    expect(entries.map((e) => e.read)).toEqual(["@stage-plan/SKILL.md", "@stage-implement/SKILL.md", "@stage-ship/SKILL.md"]);
    expect(entries.every((e) => !("dir" in e))).toBe(true);
    expect(fence).not.toContain("${CLAUDE_SKILL_DIR}");
  });

  test("rt skills check is clean immediately after compile", async () => {
    const { pack, ms, manifest } = await build();
    process.exitCode = 0;
    await skillsCheck(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);
    expect(process.exitCode).toBe(0);
  });

  test("check --json: an edited include body reports staleBecause include on the stage that pulls it in", async () => {
    const { pack, ms, manifest } = await build();
    const notePath = join(ms, "plugins", "mattstack", "attachments", "gitlab-note", "SKILL.md");
    writeFileSync(notePath, readFileSync(notePath, "utf8").replace("note body", "note body v2"));

    const io = captureSkills();
    try {
      await skillsCheck(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest, "--json"]);
    } finally {
      io.restore();
    }

    const parsed = JSON.parse(io.stdout());
    const stagePlan = parsed.verbs.find((v: { name: string }) => v.name === "stage-plan");
    expect(stagePlan.status).toBe("stale");
    expect(stagePlan.staleBecause).toEqual(["include"]);
    expect(process.exitCode).toBe(1);
  });

  test("check --json: dropping a fill's {{include}} line reports staleBecause structure", async () => {
    const { pack, ms, manifest } = await build();
    const policyPath = join(pack, "attachments", "plan-policy", "SKILL.md");
    writeFileSync(policyPath, readFileSync(policyPath, "utf8").replace("\n{{include:gitlab-note}}\n", "\n"));

    const io = captureSkills();
    try {
      await skillsCheck(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest, "--json"]);
    } finally {
      io.restore();
    }

    const parsed = JSON.parse(io.stdout());
    const stagePlan = parsed.verbs.find((v: { name: string }) => v.name === "stage-plan");
    expect(stagePlan.status).toBe("stale");
    expect(stagePlan.staleBecause).toEqual(["structure"]);
    expect(process.exitCode).toBe(1);
  });

  test("a broken chain refuses to compile", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
    cpSync(FIX, root, { recursive: true });
    const manifest = join(root, "mattstack-home", "repos", "my-repo", "skills.jsonc");
    // stage-ship consumes commits; nothing produces it when stage-plan is alone before it
    const broken = readFileSync(manifest, "utf8").replace('"mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"', '"mattstack:stage-plan", "mattstack:stage-ship"');
    writeFileSync(manifest, broken);
    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir", join(root, "pack"), "--mattstack-dir", join(root, "mattstack-home"), "--manifest", manifest]),
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain('stage "stage-ship" consumes "commits"');
  });

  test("a fill carrying an illegal placeholder errors with the compiling stage named", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
    cpSync(FIX, root, { recursive: true });
    const pack = join(root, "pack");
    const ms = join(root, "mattstack-home");
    const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
    const policyPath = join(pack, "attachments", "plan-policy", "SKILL.md");
    writeFileSync(policyPath, readFileSync(policyPath, "utf8").replace("policy text", "policy text\n{{slot:tiering}}"));

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]),
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain(
      'stage "stage-plan": acme:plan-policy: {{slot:tiering}} -- a fill may carry {{include}}, {{verb.path}} or {{pack.path}} only',
    );
  });

  test("a path-breakout pipeline entry refuses to compile and never touches a directory outside packDir", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
    cpSync(FIX, root, { recursive: true });
    const pack = join(root, "pack");
    const ms = join(root, "mattstack-home");
    const manifest = join(ms, "repos", "my-repo", "skills.jsonc");

    // A real engine at the traversal target: without the guard, loadStepSource
    // resolves it and the compile proceeds all the way to writeCompiledVerb's
    // rmSync, so this fixture is what makes the repro genuine rather than a
    // parse error that never reaches the destructive call sites.
    mkdirSync(join(ms, "plugins", "victim"), { recursive: true });
    writeFileSync(
      join(ms, "plugins", "victim", "SKILL.md"),
      '---\nname: victim\ndescription: "malicious payload"\ntype: pipeline-step\nmetadata:\n  stage: evil\n---\n\nmalicious body\n',
    );

    // A sibling of packDir, outside it -- exactly what outDirFor's rmSync
    // reaches when a stage name is "../../victim".
    mkdirSync(join(root, "victim"), { recursive: true });
    writeFileSync(join(root, "victim", "marker.txt"), "do not delete");

    writeFileSync(manifest, '{ "pipelines": { "feature": ["mattstack:../../victim"] }, "bindings": {} }');

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]),
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("../../victim");
    expect(errors.join("\n")).not.toContain("at Object");
    expect(readFileSync(join(root, "victim", "marker.txt"), "utf8")).toBe("do not delete");
  });
});

const RECEIVE_REVIEW_ENGINE = `---
name: receive-review
description: "receive-review"
type: pipeline-step
---

Read the note, then act on it.

{{include:gitlab-note}}
`;

const CHECKOUT_ENGINE = `---
name: checkout
description: "checkout"
type: pipeline-step
---

Read {{verb.path:receive-review}} first, then {{verb.path:work}}.
`;

/** The fixture plus a public `checkout` verb and an internal `receive-review` verb whose engine vendors an include. */
function buildWithRosterVerbs(): { pack: string; ms: string; manifest: string } {
  const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
  cpSync(FIX, root, { recursive: true });
  const pack = join(root, "pack");
  const ms = join(root, "mattstack-home");
  const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
  writeFileSync(join(pack, "pack", "stubs.jsonc"), JSON.stringify({
    verbs: {
      work: { engine: "work", description: "Run a unit of work" },
      checkout: { engine: "checkout", description: "Check out the branch" },
      "receive-review": { engine: "receive-review", description: "Act on review feedback" },
    },
  }));
  writeFileSync(join(pack, "pack", "surface.jsonc"), JSON.stringify({ public: ["work", "checkout"] }));
  for (const [name, source] of [["receive-review", RECEIVE_REVIEW_ENGINE], ["checkout", CHECKOUT_ENGINE]] as const) {
    mkdirSync(join(ms, "plugins", "mattstack", "attachments", name), { recursive: true });
    writeFileSync(join(ms, "plugins", "mattstack", "attachments", name, "index.block.md"), source);
  }
  return { pack, ms, manifest };
}

type CompileRun = { logs: string[]; errors: string[]; exitCode: number | undefined };

/** A failing compile calls process.exit(1); runExpectingCleanExit turns that into a result instead of ending the bun process. */
async function compileCapturingLogs(pack: string, ms: string, manifest: string, extra: string[] = []): Promise<CompileRun> {
  const io = captureSkills();
  try {
    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest, ...extra]),
    );
    return { logs: io.lines(), errors, exitCode };
  } finally {
    io.restore();
  }
}

describe("internal roster verbs", () => {
  test("an internal verb's vendored include is addressed from its attachments-side host dir and lints clean", async () => {
    const { pack, ms, manifest } = buildWithRosterVerbs();
    const { logs, errors, exitCode } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    const md = readFileSync(join(pack, "attachments", "receive-review", "SKILL.md"), "utf8");
    expect(md).toContain("@receive-review/parts/include-gitlab-note/scripts/note.sh");
    expect(md).not.toContain("${CLAUDE_SKILL_DIR}/parts/");
    expect(existsSync(join(pack, "attachments", "receive-review", "parts", "include-gitlab-note", "scripts", "note.sh"))).toBe(true);
    expect(logs.some((l) => l.startsWith("[ok] Compiled receive-review  "))).toBe(true);
  });
});

describe("verb.path end to end", () => {
  test("a whole-pack compile renders sibling paths on both sides and lints clean", async () => {
    const { pack, ms, manifest } = buildWithRosterVerbs();
    const { logs, errors, exitCode } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    const md = readFileSync(join(pack, "skills", "checkout", "SKILL.md"), "utf8");
    expect(md).toContain("Read @receive-review/SKILL.md first, then @work/SKILL.md.");
    expect(logs.some((l) => l.startsWith("[ok] Compiled checkout  "))).toBe(true);
  });

  test("a --verb compile still renders a path to a sibling it is not emitting, and lints it clean", async () => {
    const { pack, ms, manifest } = buildWithRosterVerbs();
    const { logs, errors, exitCode } = await compileCapturingLogs(pack, ms, manifest, ["--verb", "checkout"]);
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    const md = readFileSync(join(pack, "skills", "checkout", "SKILL.md"), "utf8");
    expect(md).toContain("@receive-review/SKILL.md");
    expect(md).toContain("@work/SKILL.md");
    expect(existsSync(join(pack, "attachments", "receive-review"))).toBe(false);
    expect(logs.filter((l) => l.includes("not an emitted file"))).toEqual([]);
  });
});

describe("pack.path end to end", () => {
  test("a fill's pack.path compiles into a stage and a public verb, each reading its own copy, lint clean", async () => {
    const { pack, ms, manifest } = buildWithRosterVerbs();
    mkdirSync(join(pack, "attachments", "evidence", "scripts"), { recursive: true });
    writeFileSync(join(pack, "attachments", "evidence", "scripts", "capture.sh"), "#!/bin/sh\n");
    const policyPath = join(pack, "attachments", "plan-policy", "SKILL.md");
    writeFileSync(policyPath, readFileSync(policyPath, "utf8").replace("policy text", "policy text\n\nCapture with {{pack.path:evidence/scripts/capture.sh}}."));
    const checkoutPath = join(ms, "plugins", "mattstack", "attachments", "checkout", "index.block.md");
    writeFileSync(checkoutPath, CHECKOUT_ENGINE.replace("then {{verb.path:work}}.", "then {{verb.path:work}}, then {{pack.path:evidence/scripts/capture.sh}}."));

    const { logs, errors, exitCode } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    expect(readFileSync(join(pack, "attachments", "stage-plan", "SKILL.md"), "utf8")).toContain("Capture with @stage-plan/references/evidence/scripts/capture.sh.");
    expect(readFileSync(join(pack, "skills", "checkout", "SKILL.md"), "utf8")).toContain("then @checkout/references/evidence/scripts/capture.sh.");
    for (const dir of [join(pack, "attachments", "stage-plan"), join(pack, "skills", "checkout")]) {
      expect(readFileSync(join(dir, "references", "evidence", "scripts", "capture.sh"), "utf8")).toBe("#!/bin/sh\n");
    }
    expect(logs.some((l) => l.startsWith("[ok] Compiled stage-plan  "))).toBe(true);
    expect(logs.some((l) => l.startsWith("[ok] Compiled checkout  "))).toBe(true);
  });
});

/** The real mattstack attachments under a fixture pack with a `feature` pipeline and an `accessibility` one that overrides stage-evidence's fill. */
function buildPipelines(): { pack: string; ms: string; manifest: string; args: string[] } {
  const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
  cpSync(PIPELINES_FIX, root, { recursive: true });
  const pack = join(root, "pack");
  const ms = join(root, "mattstack-home");
  cpSync(REAL_ATTACHMENTS, join(ms, "plugins", "mattstack", "attachments"), { recursive: true });
  cpSync(REAL_MODEL_TIERING, join(ms, "plugins", "mattstack", "skills", "model-tiering"), { recursive: true });
  const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
  return { pack, ms, manifest, args: ["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest] };
}

const COPY = "stage-evidence--accessibility";
const CHECK_DOT = join(import.meta.dir, "..", "..", "..", "plugins", "mattstack", "plugin", "skills", "process-digraphs", "check-dot.py");

/** The stage table work/SKILL.md carried by hand before {{pipeline.table}}, rendered. */
const EIGHT_ROWS = [
  "| Stage | Read | Consumes | Produces |",
  "|---|---|---|---|",
  "| `provision` | `@stage-provision/SKILL.md` | `ticket` `repo` | `branch` `worktree` |",
  "| `plan` | `@stage-plan/SKILL.md` | `ticket` | `approach` `evidence-plan` |",
  "| `gates` | `@stage-gates/SKILL.md` | `approach` `worktree` | nothing |",
  "| `evidence` | `@stage-evidence/SKILL.md` | `evidence-plan` `worktree` | `evidence` |",
  "| `implement` | `@stage-implement/SKILL.md` | `approach` `branch` `worktree` | `commits` |",
  "| `self-review` | `@stage-self-review/SKILL.md` | `commits` | `review` |",
  "| `ship` | `@stage-ship/SKILL.md` | `commits` `ticket` | `mr` |",
  "| `watch-ci` | `@stage-watch-ci/SKILL.md` | `mr` `branch` | `ci` |",
].join("\n");

describe("compile-pipelines", () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  test("per-pipeline fill compiles a copy", async () => {
    const { pack, ms, manifest } = buildPipelines();
    const { errors, exitCode } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    const stage = readFileSync(join(pack, "attachments", "stage-evidence", "SKILL.md"), "utf8");
    const copy = readFileSync(join(pack, "attachments", COPY, "SKILL.md"), "utf8");
    expect(stage).toContain("evidence-a body");
    expect(stage).not.toContain("evidence-b body");
    expect(copy).toContain("evidence-b body");
    expect(copy).not.toContain("evidence-a body");
  }, 30_000);

  test("pack/pipelines.json points each pipeline at its own stage copy", async () => {
    const { pack, ms, manifest } = buildPipelines();
    const { errors } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);

    const { pipelines } = JSON.parse(readFileSync(join(pack, "pack", "pipelines.json"), "utf8"));
    expect(Object.keys(pipelines).sort()).toEqual(["accessibility", "feature"]);
    const evidence = (pipeline: string) => pipelines[pipeline].find((s: { stage: string }) => s.stage === "evidence");
    expect(evidence("feature")).toMatchObject({ name: "stage-evidence", file: "attachments/stage-evidence/SKILL.md" });
    expect(evidence("accessibility")).toMatchObject({ name: COPY, file: `attachments/${COPY}/SKILL.md` });
    for (const stages of Object.values(pipelines) as { file: string }[][]) {
      for (const { file } of stages) expect(existsSync(join(pack, file))).toBe(true);
    }
    const payload = await checkPack({ packDir: pack, mattstackDir: ms, manifest });
    expect(payload.compileErrors).toEqual([]);
    expect(payload.drift).toBe(false);
  }, 30_000);

  test("work-a11y compiles against its pipeline", async () => {
    const { pack, ms, manifest } = buildPipelines();
    const { errors } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);

    const a11y = readFileSync(join(pack, "skills", "work-a11y", "SKILL.md"), "utf8");
    expect(a11y).toContain(EIGHT_ROWS.replace("@stage-evidence/", `@${COPY}/`));
    expect(a11y).toContain("--work-type work --pipeline accessibility");
    expect(a11y).toContain("`run_list`'s `pipelines` is `accessibility`; only those runs are offered to resume.");
  }, 30_000);

  test("plain work runs feature with today's eight rows and digraphs that pass check-dot", async () => {
    const { pack, ms, manifest } = buildPipelines();
    const { errors } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);

    const workDir = join(pack, "skills", "work");
    const work = readFileSync(join(workDir, "SKILL.md"), "utf8");
    expect(work).toContain(EIGHT_ROWS);
    expect(work).toContain("--work-type work --pipeline feature");
    expect(work).toContain("`run_list`'s `pipelines` is `feature`, `work`; only those runs are offered to resume.");
    expect(work).not.toContain("{{");

    if (!Bun.which("dot")) return;
    const mds = Object.keys(treeOf(workDir)).filter((rel) => rel.endsWith(".md")).map((rel) => join(workDir, rel));
    const run = Bun.spawnSync(["python3", CHECK_DOT, ...mds], { env: childEnv() });
    expect(run.stdout.toString() + run.stderr.toString()).toMatch(/graph\(s\) checked, ok, 0 warning\(s\)\n$/);
    expect(run.exitCode).toBe(0);
  }, 30_000);

  test("a dropped override removes its copy", async () => {
    const { pack, ms, manifest, args } = buildPipelines();
    await compileCapturingLogs(pack, ms, manifest);
    expect(existsSync(join(pack, "attachments", COPY))).toBe(true);

    writeFileSync(manifest, readFileSync(manifest, "utf8").replace(
      ',\n      "bindings": { "mattstack:stage-evidence/domain-rules": { "rules": "acme:evidence-b" } }',
      "",
    ));

    const payload = await checkPack({ packDir: pack, mattstackDir: ms, manifest });
    expect(payload.staleCopies).toEqual([COPY]);
    expect(payload.drift).toBe(true);

    const json = captureSkills();
    try {
      await skillsCheck([...args, "--json"]);
    } finally {
      json.restore();
    }
    expect(JSON.parse(json.stdout()).staleCopies).toEqual([COPY]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    const io = captureSkills();
    try {
      await skillsCheck(args);
    } finally {
      io.restore();
    }
    expect(io.lines()).toContain(`[out of date] stale stage copy ${COPY}: run rt skills compile`);
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    const { errors } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);
    expect(existsSync(join(pack, "attachments", COPY))).toBe(false);
    expect(existsSync(join(pack, "attachments", "stage-evidence", "SKILL.md"))).toBe(true);
    expect((await checkPack({ packDir: pack, mattstackDir: ms, manifest })).staleCopies).toEqual([]);
  }, 30_000);

  test("a stage every pipeline overrides still compiles its default", async () => {
    const { pack, ms, manifest } = buildPipelines();
    const stages = [
      "mattstack:stage-provision",
      "mattstack:stage-plan",
      "mattstack:stage-gates",
      "mattstack:stage-evidence",
      "mattstack:stage-implement",
      "mattstack:stage-self-review",
      "mattstack:stage-ship",
      "mattstack:stage-watch-ci",
    ];
    const forge = { "mattstack:stage-watch-ci/forge": { forge: "mattstack:ci-forge-gitlab" } };
    writeFileSync(manifest, JSON.stringify({
      pipelines: {
        feature: { stages, bindings: forge },
        accessibility: { stages, bindings: { ...forge, "mattstack:stage-evidence/domain-rules": { rules: "acme:evidence-b" } } },
      },
      bindings: { "mattstack:stage-evidence/domain-rules": { rules: "acme:evidence-a" } },
    }, null, 2));

    const { errors, exitCode } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();

    const stage = readFileSync(join(pack, "attachments", "stage-watch-ci", "SKILL.md"), "utf8");
    expect(stage).toContain("@stage-watch-ci/scripts/");
    expect(stage).not.toContain("{{");
    for (const pipeline of ["feature", "accessibility"]) {
      const copy = readFileSync(join(pack, "attachments", `stage-watch-ci--${pipeline}`, "SKILL.md"), "utf8");
      expect(copy).toContain("prop:stage-watch-ci/forge.forge binding=mattstack:ci-forge-gitlab");
      expect(copy).toContain(`@stage-watch-ci--${pipeline}/parts/forge/forge/scripts/ci-forge.sh`);
    }
  }, 30_000);

  test("a scoped compile leaves copies", async () => {
    const { pack, ms, manifest, args } = buildPipelines();
    await compileCapturingLogs(pack, ms, manifest);
    expect(existsSync(join(pack, "attachments", COPY))).toBe(true);

    const scoped = await compileCapturingLogs(pack, ms, manifest, ["--verb", "work"]);
    expect(scoped.errors).toEqual([]);
    expect(existsSync(join(pack, "attachments", COPY, "SKILL.md"))).toBe(true);

    const io = captureSkills();
    try {
      const { errors, exitCode } = await runExpectingCleanExit(() => skillsBind(["work", "work/sub-agent-tiering", "tiering", "mattstack:model-tiering", ...args]));
      expect(errors).toEqual([]);
      expect(exitCode).toBeUndefined();
    } finally {
      io.restore();
    }
    expect(readFileSync(manifest, "utf8")).toContain("mattstack:model-tiering");
    expect(existsSync(join(pack, "attachments", COPY, "SKILL.md"))).toBe(true);
  }, 30_000);

  test("compile --json lists removed copies", async () => {
    const { pack, ms, manifest, args } = buildPipelines();
    await compileCapturingLogs(pack, ms, manifest);
    dropAccessibilityOverride(manifest);

    const payload = await compileJson(args);
    expect(payload.written).toBe(true);
    expect(payload.removedCopies).toEqual([COPY]);
    expect(existsSync(join(pack, "attachments", COPY))).toBe(false);

    expect(await compileJson(args)).not.toHaveProperty("removedCopies");
  }, 30_000);

  test("dry run leaves removedCopies out", async () => {
    const { pack, ms, manifest, args } = buildPipelines();
    await compileCapturingLogs(pack, ms, manifest);
    dropAccessibilityOverride(manifest);

    const dry = await compileJson([...args, "--dry-run"]);
    expect(dry.written).toBe(false);
    expect(dry).not.toHaveProperty("removedCopies");
    expect(existsSync(join(pack, "attachments", COPY))).toBe(true);
  }, 30_000);

  test("a stage named like a copy collides", async () => {
    const { pack, ms, manifest } = buildPipelines();
    const stubs = join(pack, "pack", "stubs.jsonc");
    writeFileSync(stubs, readFileSync(stubs, "utf8").replace(
      '"work-a11y":',
      `"${COPY}": { "engine": "stage-evidence", "description": "Gather evidence" },\n    "work-a11y":`,
    ));
    const { errors } = await compileCapturingLogs(pack, ms, manifest);
    expect(errors.join("\n")).toContain(`"${COPY}" is both a roster verb and a pipeline stage`);
  }, 30_000);

  test("binder names the default pipeline's verb", async () => {
    const { manifest, args } = buildPipelines();
    bindWorkTiering(manifest);
    expect(await workBinderVerb(args)).toBe("work");
  }, 30_000);

  test("with no default pipeline, the binder names the verb with no pipeline", async () => {
    const { pack, manifest, args } = buildPipelines();
    bindWorkTiering(manifest);
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"feature": [', '"general": ['));
    writeFileSync(join(pack, "pack", "stubs.jsonc"), JSON.stringify({
      verbs: {
        work: { engine: "work", description: "Run a unit of work" },
        "work-a11y": { engine: "work", pipeline: "accessibility", description: "Run accessibility work end to end" },
      },
    }, null, 2));
    expect(await workBinderVerb(args)).toBe("work");
  }, 30_000);
});

function dropAccessibilityOverride(manifest: string): void {
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(
    ',\n      "bindings": { "mattstack:stage-evidence/domain-rules": { "rules": "acme:evidence-b" } }',
    "",
  ));
}

function bindWorkTiering(manifest: string): void {
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(
    '"bindings": { "mattstack:stage-evidence/domain-rules": { "rules": "acme:evidence-a" } }',
    '"bindings": { "mattstack:stage-evidence/domain-rules": { "rules": "acme:evidence-a" }, "mattstack:work/sub-agent-tiering": { "tiering": "mattstack:model-tiering" } }',
  ));
}

async function compileJson(args: string[]): Promise<Record<string, unknown>> {
  const io = captureSkills();
  try {
    await skillsCompile([...args, "--json"]);
    return JSON.parse(io.stdout());
  } finally {
    io.restore();
  }
}

const BLOCKS_FIX = join(import.meta.dir, "fixtures", "blocks");

/** The blocks fixture keeps its mattstack plugin beside the pack, so it is laid out the way compile-native's is. */
async function buildBlocks() {
  const root = mkdtempSync(join(tmpdir(), "rt-e2e-blocks-"));
  cpSync(join(BLOCKS_FIX, "pack"), join(root, "pack"), { recursive: true });
  cpSync(join(BLOCKS_FIX, "mattstack-home"), join(root, "mattstack-home"), { recursive: true });
  cpSync(join(BLOCKS_FIX, "plugins"), join(root, "mattstack-home", "plugins"), { recursive: true });
  const pack = join(root, "pack");
  const ms = join(root, "mattstack-home");
  const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
  const args = ["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest];
  await skillsCompile(args);
  return { pack, ms, manifest, args };
}

describe("block-tree engines end to end", () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  test("compile writes the block engine as one SKILL.md with its value's files", async () => {
    const { pack } = await buildBlocks();
    const md = readFileSync(join(pack, "attachments", "mini", "SKILL.md"), "utf8");

    expect(md).toContain('compiled: "mattstack@1.0.0 + widgets:mini-rules/fast@0.1.0 + mattstack:model-tiering@1.0.0 + mattstack:style-floor@1.0.0"');
    expect(md.split("\n").filter((l) => l.startsWith("#"))).toEqual(["# mini", "## Run the step", "### Check the result", "## Ask the gate", "## Notes"]);
    expect(md).toContain("Run @mini/parts/rules/lint.sh first.");
    expect(md).toContain("For tiering, invoke the `mattstack:model-tiering` skill");
    expect(md).not.toContain("{{");
    expect(treeOf(join(pack, "attachments", "mini"))["parts/rules/lint.sh"]).toBe("#!/bin/sh\necho lint\n");
  });

  test("compile --json on a block key no tree claims exits 1 and the envelope says why", async () => {
    const { manifest, args } = await buildBlocks();
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"mattstack:mini/gate": { "tiering": "" }', '"mattstack:mini/gate": { "tiering": "" },\n    "mattstack:gate-protocl/ask": { "a": "" }'));
    process.exitCode = 0;

    const env = await compileJson(args);
    expect(process.exitCode).toBe(1);
    expect(env.written).toBe(false);
    expect(env.unclaimedBlockKeys).toEqual([
      `${manifest}:15:5: binding "mattstack:gate-protocl/ask" names a block of mattstack:gate-protocl, which no compiled verb loads`,
    ]);
  });

  test("check is in sync right after compile", async () => {
    const { args } = await buildBlocks();
    process.exitCode = 0;
    await skillsCheck(args);
    expect(process.exitCode).toBe(0);
  });

  test("editing the value's file makes check report fill drift", async () => {
    const { pack, args } = await buildBlocks();
    const fast = join(pack, "attachments", "mini-rules", "fast.md");
    writeFileSync(fast, readFileSync(fast, "utf8").replace("fast widget rules", "fast widget rules, twice"));

    const io = captureSkills();
    try {
      await skillsCheck([...args, "--json"]);
    } finally {
      io.restore();
    }
    const mini = JSON.parse(io.stdout()).verbs.find((v: { name: string }) => v.name === "mini");
    expect(mini.status).toBe("stale");
    expect(mini.staleBecause).toEqual(["fill"]);
    expect(process.exitCode).toBe(1);
  });

  test("anatomy lists the block and prop parts, marking the edited value changed", async () => {
    const { pack, args } = await buildBlocks();
    const fast = join(pack, "attachments", "mini-rules", "fast.md");
    writeFileSync(fast, readFileSync(fast, "utf8").replace("fast widget rules", "fast widget rules, twice"));

    const io = captureSkills();
    try {
      await skillsAnatomy([...args, "--skill", "mini", "--json"]);
    } finally {
      io.restore();
    }
    const parts = JSON.parse(io.stdout()).parts as { kind: string; name: string | null; changed: boolean }[];
    expect(parts.filter((p) => p.kind === "block").map((p) => p.name)).toEqual(["mini", "mini/run", "mini/run/guard", "mini/run/check", "mini/gate", "mini/notes"]);
    expect(parts.filter((p) => p.changed).map((p) => `${p.kind}:${p.name}`)).toEqual(["prop:mini.rules"]);
  });

  test("anatomy gives each value of an add prop the version its own seam was built at", async () => {
    const { pack, ms, manifest, args } = await buildBlocks();
    mkdirSync(join(ms, "plugins", "mattstack", "attachments", "base-rules"), { recursive: true });
    writeFileSync(
      join(ms, "plugins", "mattstack", "attachments", "base-rules", "SKILL.md"),
      '---\nname: base-rules\ndescription: "Base rules"\nmetadata:\n  provides: "mini-rules@1"\n---\n\nFollow the base rules.\n',
    );
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace(
      '"bindings": {',
      '"layered": {\n    "mattstack:mini": { "rules": [{ "layer": "base:acme-base", "value": "mattstack:base-rules" }, { "layer": "pack", "value": "widgets:mini-rules/fast" }] }\n  },\n  "bindings": {',
    ));
    await skillsCompile(args);
    expect(readFileSync(join(pack, "attachments", "mini", "SKILL.md"), "utf8")).toContain("Follow the base rules.");

    const io = captureSkills();
    try {
      await skillsAnatomy([...args, "--skill", "mini", "--json"]);
    } finally {
      io.restore();
    }
    const parts = JSON.parse(io.stdout()).parts as { kind: string; name: string; source: { ref: string; version: string; builtVersion: string | null } }[];
    expect(parts.filter((p) => p.kind === "prop" && p.name === "mini.rules").map((p) => [p.source.ref, p.source.version, p.source.builtVersion])).toEqual([
      ["mattstack:base-rules", "1.0.0", "1.0.0"],
      ["widgets:mini-rules/fast", "0.1.0", "0.1.0"],
    ]);
  });

  test("a SKILL.md left beside the block tree refuses compile and leaves the compiled skill alone", async () => {
    const { pack, ms, args } = await buildBlocks();
    const before = readFileSync(join(pack, "attachments", "mini", "SKILL.md"), "utf8");
    writeFileSync(join(ms, "plugins", "mattstack", "attachments", "pipeline", "mini", "SKILL.md"), "---\nname: mini\ntype: pipeline-step\n---\n\nOld text.\n");
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(args));
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("attachments/pipeline/mini/SKILL.md:1:1: the block tree in index.block.md replaces this SKILL.md; delete it");
    expect(readFileSync(join(pack, "attachments", "mini", "SKILL.md"), "utf8")).toBe(before);
  });

  /** Runs mini as the feature pipeline's one stage too, with `bindings` as that pipeline's own section. */
  function asStage(pack: string, ms: string, manifest: string, bindings: string): void {
    const index = join(ms, "plugins", "mattstack", "attachments", "pipeline", "mini", "index.block.md");
    writeFileSync(index, readFileSync(index, "utf8").replace("type: pipeline-step\n", "type: pipeline-step\nmetadata:\n  stage: mini\n  stage-consumes: ticket\n  stage-produces: mr\n"));
    writeFileSync(join(pack, "pack", "stubs.jsonc"), '{"verbs":{"widget-run":{"engine":"mini","description":"Run the mini widget step"}}}\n');
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"pipelines": {}', `"pipelines": { "feature": { "stages": ["mattstack:mini"], "bindings": ${bindings} } }`));
  }

  test("a pipeline's block binding compiles into that pipeline's stage copy only", async () => {
    const { pack, ms, manifest, args } = await buildBlocks();
    asStage(pack, ms, manifest, '{ "mattstack:mini": { "rules": "" } }');
    await skillsCompile(args);
    expect(readFileSync(join(pack, "attachments", "mini", "SKILL.md"), "utf8")).toContain("Follow the fast widget rules.");
    expect(readFileSync(join(pack, "attachments", "mini--feature", "SKILL.md"), "utf8")).not.toContain("Follow the fast widget rules.");
  });

  test("a pipeline's value replaces the top-level value of an add prop in its stage copy", async () => {
    const { pack, ms, manifest, args } = await buildBlocks();
    writeFileSync(join(pack, "attachments", "mini-rules", "slow.md"), "Follow the slow widget rules.\n");
    asStage(pack, ms, manifest, '{ "mattstack:mini": { "rules": "widgets:mini-rules/slow" } }');
    await skillsCompile(args);
    const stage = readFileSync(join(pack, "attachments", "mini", "SKILL.md"), "utf8");
    const copy = readFileSync(join(pack, "attachments", "mini--feature", "SKILL.md"), "utf8");
    expect(stage).toContain("Follow the fast widget rules.");
    expect(stage).not.toContain("Follow the slow widget rules.");
    expect(copy).toContain("Follow the slow widget rules.");
    expect(copy).not.toContain("Follow the fast widget rules.");
  });

  test("a typo block key in a pipeline section refuses compile though no stage copy uses it", async () => {
    const { pack, ms, manifest, args } = await buildBlocks();
    asStage(pack, ms, manifest, '{ "mattstack:mini/gaet": { "tiering": "" } }');
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(args));
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/skills\.jsonc:11:\d+: binding "mattstack:mini\/gaet": mattstack:mini has no block "mini\/gaet"/);
  });

  test("a binding to a block the engine lacks refuses compile at the manifest line", async () => {
    const { manifest, args } = await buildBlocks();
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"mattstack:mini/gate"', '"mattstack:mini/nope"'));
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(args));
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/skills\.jsonc:14:5: binding "mattstack:mini\/nope": mattstack:mini has no block "mini\/nope"/);
  });

  test("a block key whose engine part matches no loaded tree refuses compile at the manifest key", async () => {
    const { manifest, args } = await buildBlocks();
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"mattstack:mini/gate"', '"mattstack:mnii/gate"'));
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(args));
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain('skills.jsonc:14:5: binding "mattstack:mnii/gate" names a block of mattstack:mnii, which no compiled verb loads');
  });

  test("a typo'd include in a block refuses compile at the marker's file, line and column", async () => {
    const { ms, args } = await buildBlocks();
    const run = join(ms, "plugins", "mattstack", "attachments", "pipeline", "mini", "run", "index.block.md");
    writeFileSync(run, `${readFileSync(run, "utf8")}\n  {{include:nope}}\n`);
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(args));
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain('attachments/pipeline/mini/run/index.block.md:9:3: loadInclude: include "nope" not found at ');
  });

  test("check reports a block key naming no loaded tree", async () => {
    const { manifest, args } = await buildBlocks();
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"mattstack:mini/gate"', '"mattstack:gate-protocl/ask"'));
    const io = captureSkills();
    try {
      await skillsCheck([...args, "--json"]);
    } finally {
      io.restore();
    }
    expect(JSON.parse(io.stdout()).compileErrors.join("\n")).toContain('skills.jsonc:14:5: binding "mattstack:gate-protocl/ask" names a block of mattstack:gate-protocl, which no compiled verb loads');
    expect(process.exitCode).toBe(1);
  });
});

async function workBinderVerb(args: string[]): Promise<string | null> {
  const io = captureSkills();
  try {
    await skillsComposition([...args, "--json"]);
    const { binders } = JSON.parse(io.stdout()) as { binders: { ref: string; verb: string | null }[] };
    return binders.find((b) => b.ref === "mattstack:work/sub-agent-tiering")?.verb ?? null;
  } finally {
    io.restore();
  }
}
