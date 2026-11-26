import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { readPins } from "./tools.ts";
import { buildRtUi, ensureDevApp, ensureTools, toolchainEnv } from "./stages.ts";
import type { CloneCheck } from "./clone-guards.ts";
import { registerApps } from "./setup.ts";
import { REGISTERED_APPS } from "../release/update-machine.ts";
import type { DevSeams, StageEnding, StageRunner } from "./seams.ts";

export type DevUpdateResult = { clone: string; stages: StageEnding[] };

/**
 * Each served app's `dev.build`. Deck serves the clone's `dist/`, and a
 * restart keeps an app's last browser bundle, so a pulled clone needs these
 * before the apps restart. Returns the first app that did not build.
 */
export async function buildServedApps(s: DevSeams, clone: string, env: Record<string, string>): Promise<string | null> {
  for (const app of REGISTERED_APPS) {
    let build: string | undefined;
    try {
      build = (JSON.parse(s.probes.readFile(join(clone, "apps", app, "mattstack.deck.json")) ?? "{}") as { dev?: { build?: string } }).dev?.build;
    } catch {
      build = undefined;
    }
    if (!build) continue;
    const r = await s.probes.exec(["/bin/sh", "-c", build], { cwd: join(clone, "apps", app), env, timeoutMs: 10 * 60_000 });
    if (r.code !== 0) return app;
  }
  return null;
}

/** What a hand-run update uses to bring the clone to origin/main when that is safe. */
export interface CloneSync {
  checkClone(clone: string): Promise<CloneCheck>;
  fastForward(clone: string): Promise<{ exitCode: number; stderr: string }>;
  /** `bun` is the path the tools stage probed; Go's directory comes first in `env.PATH`. */
  install(clone: string, env: Record<string, string>, bun: string): Promise<{ exitCode: number; tail: string }>;
}

export async function rtUiStale(s: DevSeams, clone: string): Promise<boolean> {
  const bin = join(clone, "ui", "dist", "rt-ui");
  if (!s.probes.exists(bin)) return true;
  const r = await s.probes.exec(["find", join(clone, "ui"), "-type", "f", "-newer", bin, "-not", "-path", `${join(clone, "ui", "dist")}/*`, "-print", "-quit"], { timeoutMs: 15_000 });
  return r.code !== 0 || r.stdout.trim() !== "";
}

/** `release` swaps a dev app built on this Mac for the release's, which a plain update leaves alone. */
export async function runDevUpdate(
  s: DevSeams,
  stage: StageRunner,
  opts: { release?: boolean; clone?: CloneSync; lock?: <T>(fn: () => Promise<T>) => Promise<T | "locked"> } = {},
): Promise<DevUpdateResult> {
  if (!opts.lock) return updateUnlocked(s, stage, opts);
  const r = await opts.lock(() => updateUnlocked(s, stage, opts));
  if (r === "locked") {
    throw new UserActionableError("dev-update-running", "Another dev update is running", {}, { why: "The hourly update may be installing. Try again in a few minutes.", next: "rt dev update" });
  }
  return r;
}

async function updateUnlocked(s: DevSeams, stage: StageRunner, opts: { release?: boolean; clone?: CloneSync }): Promise<DevUpdateResult> {
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
  const stages: StageEnding[] = [];
  const sync = opts.clone;
  // The clone moves before its pins are read, so the tools are checked
  // against what it will build with.
  let synced = false;
  if (sync) {
    stages.push(
      await stage("Update your clone", async () => {
        const check = await sync.checkClone(clone);
        if (!check.ok) return { status: "skipped", title: "Left your clone as it is", hint: check.detail };
        synced = true;
        if (check.behind === 0) return { status: "skipped", title: "Your clone is up to date" };
        const ff = await sync.fastForward(clone);
        if (ff.exitCode !== 0) {
          throw new UserActionableError("dev-clone-ff-failed", "Fast-forwarding your clone to origin/main failed", {}, { log: ff.stderr, next: "rt dev update" });
        }
        return { status: "done", title: "Updated your clone", hint: `${check.behind} new commit${check.behind === 1 ? "" : "s"}` };
      }),
    );
  }
  const pins = await readPins(s.probes, clone);
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
  if (sync && synced) {
    // Every time, not only after a pull: an earlier run may have pulled and
    // then failed here.
    stages.push(
      await stage("Install your clone's packages", async () => {
        const inst = await sync.install(clone, toolchainEnv(s, { bunPath, goPath }), bunPath);
        if (inst.exitCode !== 0) {
          throw new UserActionableError("dev-clone-install-failed", "bun install failed in your clone", {}, { log: inst.tail, next: "rt dev update" });
        }
        return { status: "done", title: "Installed your clone's packages" };
      }),
    );
    stages.push(
      await stage("Build the served apps", async () => {
        const failed = await buildServedApps(s, clone, toolchainEnv(s, { bunPath, goPath }));
        if (failed) throw new UserActionableError("dev-app-build-failed", `${failed} did not build from your clone`, {}, { next: "rt dev update" });
        return { status: "done", title: "Built the served apps" };
      }),
    );
  }
  stages.push(
    await stage("Rebuild rt's terminal helper", async () => {
      if (!(await rtUiStale(s, clone))) return { status: "skipped", title: "rt's terminal helper is current" };
      await buildRtUi(s, clone, { bunPath, goPath });
      return { status: "done", title: "Rebuilt rt's terminal helper" };
    }),
  );
  stages.push(await stage("Update the dev app", (io) => ensureDevApp(s, io, "update", undefined, { replaceLocal: opts.release === true })));
  stages.push(
    await stage("Serve the apps from your clone", async (io) => {
      await registerApps(s, clone, io);
      return { status: "done", title: "The apps run from your clone" };
    }),
  );
  return { clone, stages };
}
