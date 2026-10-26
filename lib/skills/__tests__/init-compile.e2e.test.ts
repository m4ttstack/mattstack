import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { checkPack, skillsCompile } from "../../../commands/skills.ts";
import { PIPELINE_STAGES, renderPackFiles } from "../init.ts";
import { runExpectingCleanExit } from "./helpers.ts";

const FIX = join(import.meta.dir, "fixtures", "compile-native");

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const stageEngine = (name: string) => `---
name: ${name}
description: "Pipeline stage ${name}."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "${name.slice("stage-".length)}"
  stage-consumes: "ticket"
  stage-produces: "-"
props:
  rules:
    merge: add
    default: ""
---

# ${name}

{{props.rules}}
`;

/** A block holding one replace prop with a contract, the shape of work's tiering and stage-watch-ci's forge. */
const contractBlock = (title: string, prop: string, contract: string) => `---
props:
  ${prop}:
    merge: replace
    default: ""
    contract: "${contract}"
---

# ${title}

{{props.${prop}}}
`;

const workEngine = `---
name: work
description: "Use when running a unit of work through a configured pipeline."
disable-model-invocation: true
type: pipeline-step
---

# work

Stages:

{{pipeline.stages}}
`;

const fill = (name: string, provides: string, body: string) => `---
name: ${name}
description: "Use when a prop resolves here."
disable-model-invocation: true
metadata:
  provides: "${provides}"
---

${body}
`;

async function build() {
  const root = mkdtempSync(join(tmpdir(), "rt-init-e2e-"));
  cpSync(FIX, root, { recursive: true });
  const ms = join(root, "mattstack-home");
  const engines = join(ms, "plugins", "mattstack", "attachments");
  // The fixture's own work engine declares no props, so the seeded tiering binding would
  // name a block it lacks; this one carries the block the seed binds.
  write(join(engines, "pipeline", "work", "index.block.md"), workEngine);
  write(join(engines, "pipeline", "work", "sub-agent-tiering.block.md"), contractBlock("Tiering", "tiering", "model-tiering@1"));
  for (const stage of PIPELINE_STAGES) {
    const path = join(engines, "pipeline", stage, "index.block.md");
    if (existsSync(path)) continue;
    write(path, stageEngine(stage));
    if (stage === "stage-watch-ci") write(join(engines, "pipeline", stage, "forge.block.md"), contractBlock("Forge", "forge", "ci-forge@1"));
  }
  write(join(engines, "model-tiering", "SKILL.md"), fill("model-tiering", "model-tiering@1", "tiering rules"));
  write(join(engines, "ci-forge-gitlab", "SKILL.md"), fill("ci-forge-gitlab", "ci-forge@1", "gitlab forge"));
  const pack = join(root, "generated");
  for (const [rel, text] of Object.entries(renderPackFiles({ pack: "acme", workDescription: "Use when running a unit of work." }))) {
    write(join(pack, rel), text);
  }
  const manifest = join(ms, "repos", "acme-repo", "skills.jsonc");
  write(manifest, "// mattstack:work/sub-agent-tiering tiering <- acme@acme\n" + readFileSync(join(pack, "pack", "skills.jsonc"), "utf8"));
  return { pack, ms, manifest };
}

describe("rt skills init output compiles", () => {
  test("work (tiering bound) plus eight stages compile and check clean with no placeholders left", async () => {
    const { pack, ms, manifest } = await build();
    const compiled = await runExpectingCleanExit(() => skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]));
    expect(compiled.exitCode).toBeUndefined();
    expect(compiled.errors).toEqual([]);
    const work = readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8");
    expect(work).toContain("tiering rules");
    expect(work).not.toContain("{{");
    for (const stage of PIPELINE_STAGES) {
      const body = readFileSync(join(pack, "attachments", stage, "SKILL.md"), "utf8");
      expect(body).not.toContain("{{");
    }
    const checked = await checkPack({ packDir: pack, manifest, mattstackDir: ms });
    expect(checked.drift).toBe(false);
  });
});
