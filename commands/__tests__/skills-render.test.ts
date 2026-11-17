import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UserActionableError } from "../../lib/errors.ts";
import { LOCK_REL, serializeLock } from "../../lib/skills/compiled-lock.ts";
import { renderWorld, setPackVersion, writeFile } from "../../lib/skills/__tests__/render-world.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import * as out from "../../lib/ui/out.ts";
import { skillsRender } from "../skills-render.ts";

const made: string[] = [];
const savedHome = process.env.HOME;
let io: CapturedOut | null = null;

beforeEach(() => out.__test__.reset());
afterEach(() => {
  io?.restore();
  io = null;
  process.env.HOME = savedHome;
  out.__test__.reset();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const w = renderWorld(made);
  process.env.HOME = w.home;
  return w;
}

async function render(w: ReturnType<typeof setup>, id: string, unitDir: string, extra: string[] = []): Promise<Record<string, unknown>> {
  io = captureOut();
  await skillsRender([id, "--dir", join(w.installed, unitDir), "--mattstack-dir", w.mattstackDir, ...extra, "--json"]);
  const printed = io.stdout();
  io.restore();
  io = null;
  return JSON.parse(printed) as Record<string, unknown>;
}

async function refusal(w: ReturnType<typeof setup>, id: string, unitDir: string): Promise<UserActionableError> {
  try {
    await render(w, id, unitDir);
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("rt skills render", () => {
  test("prints the rendered SKILL.md for a stage and for a verb", async () => {
    const w = setup();
    const verb = await render(w, "acme:work", "skills/work");
    expect(verb.path).toBe(join(w.root, "acme", "acme", "0.1.0", "1.0.0", "skills", "work", "SKILL.md"));
    expect(verb.body).toContain("<!-- part: block:work source=mattstack:work");
    expect(verb.body).toBe(readFileSync(verb.path as string, "utf8"));

    const stage = await render(w, "acme:stage-plan", "attachments/stage-plan");
    expect(stage.path).toBe(join(w.root, "acme", "acme", "0.1.0", "1.0.0", "attachments", "stage-plan", "SKILL.md"));
    expect(stage.body).toContain("<!-- part: block:stage-plan source=mattstack:stage-plan");
  });

  test("--file returns a file from the unit's folder", async () => {
    const w = setup();
    const file = await render(w, "acme:stage-plan", "attachments/stage-plan", ["--file", "parts/include-gitlab-note/scripts/note.sh"]);
    expect(file.path).toBe(join(w.root, "acme", "acme", "0.1.0", "1.0.0", "attachments", "stage-plan", "parts", "include-gitlab-note", "scripts", "note.sh"));
    expect(file.body).toBe(readFileSync(file.path as string, "utf8"));
  });

  test("--file refuses a path that climbs out of the unit", async () => {
    const w = setup();
    io = captureOut();
    await expect(skillsRender(["acme:work", "--dir", join(w.installed, "skills/work"), "--mattstack-dir", w.mattstackDir, "--file", "../../render.json", "--json"])).rejects.toThrow(UserActionableError);
  });

  test("missing tree when the clone is ahead", async () => {
    const w = setup();
    setPackVersion(w.packDir, "0.1.1");
    const err = await refusal(w, "acme:work", "skills/work");
    expect(err.message).toBe("acme 0.1.0 isn't rendered on this Mac.");
    expect(err.next).toBe("rt setup");
    expect(err.extra.next).toBe("rt setup");
  });

  test("clone ahead: the installed version's tree for this mattstack serves", async () => {
    const w = setup();
    await render(w, "acme:work", "skills/work");
    setPackVersion(w.packDir, "0.1.1");
    const env = await render(w, "acme:work", "skills/work");
    expect(env).toMatchObject({ packVersion: "0.1.0", mattstack: "1.0.0", treeDir: join(w.root, "acme", "acme", "0.1.0", "1.0.0") });
  });

  test("clone ahead: a tree rendered with an older mattstack still serves", async () => {
    const w = setup();
    await render(w, "acme:work", "skills/work");
    setPackVersion(w.packDir, "0.1.1");
    writeFile(join(w.mattstackDir, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "1.1.0" }));
    const env = await render(w, "acme:work", "skills/work");
    expect(env).toMatchObject({ packVersion: "0.1.0", mattstack: "1.0.0", treeDir: join(w.root, "acme", "acme", "0.1.0", "1.0.0") });
    expect(env.body).toContain("<!-- part: block:work source=mattstack:work");
  });

  test("a versioned id and a versioned map id find the unit, not the first folder of that name", async () => {
    const w = setup();
    const first = await render(w, "acme:stage-plan", "attachments/stage-plan");
    const tree = first.treeDir as string;
    writeFile(join(tree, "skills", "stage-plan", "SKILL.md"), "decoy\n");
    writeFile(join(tree, "skills", "stage-plan", "compiled.json"), JSON.stringify({ id: "acme:other", dir: "skills/stage-plan", covers: [], keys: {} }));
    const map = join(tree, "attachments", "stage-plan", "compiled.json");
    writeFile(map, readFileSync(map, "utf8").replace('"id": "acme:stage-plan"', '"id": "acme@0.1.0:stage-plan"'));
    const env = await render(w, "acme@0.1.0:stage-plan", "attachments/stage-plan");
    expect(env.path).toBe(join(tree, "attachments", "stage-plan", "SKILL.md"));
    expect(env.packVersion).toBe("0.1.0");
  });

  test("names builtWith when the engine is older", async () => {
    const w = setup();
    writeFile(join(w.packDir, LOCK_REL), serializeLock({ targets: {}, bases: {}, mattstackSha: {}, mattstackDirty: {}, builtWith: "1.2.0" }));
    writeFile(join(w.packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:stage-plan": { rules: "acme:nope" } } }));
    const err = await refusal(w, "acme:work", "skills/work");
    expect(err.message).toBe("acme was built with mattstack 1.2.0; this Mac has 1.0.0.");
    expect(err.next).toBe("rt setup");
  });

  test("other render failures carry the compile errors in log, and the first one as why", async () => {
    const w = setup();
    writeFile(join(w.packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:stage-plan": { rules: "acme:nope" } } }));
    const err = await refusal(w, "acme:work", "skills/work");
    expect(err.message).toBe("acme 0.1.0 didn't render on this Mac.");
    expect(err.log).toContain("cannot be filled -- the manifest declares no pipelines");
    expect(err.why).toContain("cannot be filled -- the manifest declares no pipelines");
    expect(err.why).not.toContain("\n");
    expect(err.extra.why).toBe(err.why);
  });

  test("a failed re-render serves the last good render and names why", async () => {
    const w = setup();
    const good = await render(w, "acme:work", "skills/work");
    writeFile(join(w.packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:stage-plan": { rules: "acme:nope" } } }));
    const env = await render(w, "acme:work", "skills/work");
    expect(env).toMatchObject({ ok: true, treeDir: good.treeDir, body: good.body });
    expect(env.staleBecause).toContain("cannot be filled -- the manifest declares no pipelines");
  });

  describe("a clone that moved on at the same version", () => {
    const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "pipe", env: childEnv() }).toString();
    function gitWorld() {
      const w = setup();
      rmSync(join(w.orgDir, ".git"), { recursive: true, force: true });
      git(w.orgDir, "init", "-q", "-b", "main");
      git(w.orgDir, "add", "-A");
      git(w.orgDir, "commit", "-qm", "org");
      return w;
    }
    const policy = (w: ReturnType<typeof setup>) => join(w.packDir, "attachments", "plan-policy", "SKILL.md");
    const edit = (w: ReturnType<typeof setup>) => writeFileSync(policy(w), readFileSync(policy(w), "utf8").replace("policy text", "policy text EDITED"));

    test("an uncommitted fill edit does not change what is served while a tree exists", async () => {
      const w = gitWorld();
      await render(w, "acme:stage-plan", "attachments/stage-plan");
      edit(w);
      expect((await render(w, "acme:stage-plan", "attachments/stage-plan")).body).not.toContain("EDITED");
      git(w.orgDir, "commit", "-qam", "edit");
      expect((await render(w, "acme:stage-plan", "attachments/stage-plan")).body).toContain("EDITED");
    });

    test("a clone off its data branch serves the tree it has", async () => {
      const w = gitWorld();
      await render(w, "acme:stage-plan", "attachments/stage-plan");
      git(w.orgDir, "switch", "-qc", "trial");
      edit(w);
      git(w.orgDir, "commit", "-qam", "trial edit");
      expect((await render(w, "acme:stage-plan", "attachments/stage-plan")).body).not.toContain("EDITED");
    });

    test("with no tree yet, the working copy renders", async () => {
      const w = gitWorld();
      edit(w);
      expect((await render(w, "acme:stage-plan", "attachments/stage-plan")).body).toContain("EDITED");
    });
  });

  test("the id may follow the flags", async () => {
    const w = setup();
    io = captureOut();
    await skillsRender(["--json", "--dir", join(w.installed, "skills/work"), "--mattstack-dir", w.mattstackDir, "acme:work"]);
    expect((JSON.parse(io.stdout()) as { id: string }).id).toBe("acme:work");
  });

  test("--json envelope keys are exactly", async () => {
    const w = setup();
    const env = await render(w, "acme:work", "skills/work");
    expect(Object.keys(env)).toEqual(["ok", "id", "packVersion", "mattstack", "rtBuild", "treeDir", "path", "body"]);
    expect(env).toMatchObject({ ok: true, id: "acme:work", packVersion: "0.1.0", mattstack: "1.0.0", treeDir: join(w.root, "acme", "acme", "0.1.0", "1.0.0") });
    expect(typeof env.rtBuild).toBe("string");
  });
});
