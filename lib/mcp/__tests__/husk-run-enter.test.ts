import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { skillsRender } from "../../../commands/skills-render.ts";
import { resolvePointers, realResolveFs } from "../../skills/resolve.ts";
import { installHusks, renderWorld } from "../../skills/__tests__/render-world.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import * as out from "../../ui/out.ts";
import { realRunToolDeps, runToolDefs } from "../run-tools.ts";

const made: string[] = [];
const savedHome = process.env.HOME;
const savedVersion = process.env.RT_VERSION;
afterEach(() => {
  process.env.HOME = savedHome;
  if (savedVersion === undefined) delete process.env.RT_VERSION;
  else process.env.RT_VERSION = savedVersion;
  out.__test__.reset();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a husk pack's verb starts a run from the folder skills_resolve returns", async () => {
  const w = renderWorld(made, { husks: true });
  process.env.HOME = w.home;
  process.env.RT_VERSION = "9.9.9";
  await installHusks(w);
  const unit = join(w.installed, "skills", "work");
  out.__test__.reset();
  const io = captureOut();
  try {
    await skillsRender(["acme:work", "--dir", unit, "--mattstack-dir", w.mattstackDir, "--json"]);
  } finally {
    io.restore();
  }

  const resolved = resolvePointers("acme:work", { fs: realResolveFs, home: w.home }, unit);
  const env = { RT_RUNS_ROOT: join(w.home, "runs"), RT_RUN_EMIT: "0", HOME: w.home } as NodeJS.ProcessEnv;
  const enter = runToolDefs({ ...realRunToolDeps, env }).find((t) => t.name === "run_enter")!;
  const entered = await enter.handler({ flags: "--repo my-repo --work-type feature --pipeline feature", skillDir: resolved.folder }, env);

  expect(entered.error).toBeUndefined();
  expect(entered.body).toMatchObject({ mode: "started", stages: ["plan", "implement", "ship"] });
  const db = new Database((entered.body as { runDb: string }).runDb, { readonly: true });
  const row = db.query("SELECT pack_commits FROM runs").get() as { pack_commits: string };
  db.close();
  expect(row.pack_commits).toBe("acme=0.1.0,mattstack=1.0.0,rt=9.9.9");
});

test("a skill read from its render tree starts a run from its own folder there", async () => {
  const w = renderWorld(made, { husks: true });
  process.env.HOME = w.home;
  process.env.RT_VERSION = "9.9.9";
  await installHusks(w);
  out.__test__.reset();
  const io = captureOut();
  try {
    await skillsRender(["acme:stage-plan", "--dir", join(w.installed, "attachments", "stage-plan"), "--mattstack-dir", w.mattstackDir, "--json"]);
  } finally {
    io.restore();
  }

  const treeStage = join(w.root, "acme", "acme", "0.1.0", "1.0.0", "attachments", "stage-plan");
  const env = { RT_RUNS_ROOT: join(w.home, "runs"), RT_RUN_EMIT: "0", HOME: w.home } as NodeJS.ProcessEnv;
  const enter = runToolDefs({ ...realRunToolDeps, env }).find((t) => t.name === "run_enter")!;
  const entered = await enter.handler({ flags: "--repo my-repo --work-type feature --pipeline feature", skillDir: treeStage }, env);

  expect(entered.error).toBeUndefined();
  expect(entered.body).toMatchObject({ mode: "started", stages: ["plan", "implement", "ship"] });
  const db = new Database((entered.body as { runDb: string }).runDb, { readonly: true });
  const row = db.query("SELECT pack_commits FROM runs").get() as { pack_commits: string };
  db.close();
  expect(row.pack_commits).toBe("acme=0.1.0,mattstack=1.0.0,rt=9.9.9");
});
