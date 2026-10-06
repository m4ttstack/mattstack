import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { readPins } from "./tools.ts";
import { buildRtUi, ensureDevApp, ensureTools } from "./stages.ts";
import { registerApps } from "./setup.ts";
import type { DevSeams, StageEnding, StageRunner } from "./seams.ts";

export type DevUpdateResult = { clone: string; stages: StageEnding[] };

export async function rtUiStale(s: DevSeams, clone: string): Promise<boolean> {
  const bin = join(clone, "ui", "dist", "rt-ui");
  if (!s.probes.exists(bin)) return true;
  const r = await s.probes.exec(["find", join(clone, "ui"), "-type", "f", "-newer", bin, "-not", "-path", `${join(clone, "ui", "dist")}/*`, "-print", "-quit"], { timeoutMs: 15_000 });
  return r.code !== 0 || r.stdout.trim() !== "";
}

export async function runDevUpdate(s: DevSeams, stage: StageRunner): Promise<DevUpdateResult> {
  const clone = s.storedSourcePath();
  if (s.flavor !== "dev" || !clone) {
    throw new UserActionableError("dev-not-set-up", "This Mac isn't set up to run mattstack from a clone", {}, { next: "rt dev setup" });
  }
  if (!s.probes.exists(join(clone, "cli.ts"))) {
    throw new UserActionableError(
      "dev-clone-missing",
      "Your mattstack clone is gone",
      { path: clone },
      { why: "It was moved or deleted. Setup finds or clones it again and points rt at it.", next: "rt dev setup" },
    );
  }
  const pins = await readPins(s.probes, clone);
  const stages: StageEnding[] = [];
  let bunPath = "";
  let goPath = "";
  stages.push(
    await stage("Check your tools", async (io) => {
      const t = await ensureTools(s, pins, io);
      bunPath = t.bunPath;
      goPath = t.goPath;
      return t.ending;
    }),
  );
  stages.push(
    await stage("Rebuild rt's terminal helper", async () => {
      if (!(await rtUiStale(s, clone))) return { status: "skipped", title: "rt's terminal helper is current" };
      await buildRtUi(s, clone, { bunPath, goPath });
      return { status: "done", title: "Rebuilt rt's terminal helper" };
    }),
  );
  stages.push(await stage("Update the dev app", (io) => ensureDevApp(s, io, "update")));
  stages.push(
    await stage("Serve the apps from your clone", async (io) => {
      await registerApps(s, clone, io);
      return { status: "done", title: "The apps run from your clone" };
    }),
  );
  return { clone, stages };
}
