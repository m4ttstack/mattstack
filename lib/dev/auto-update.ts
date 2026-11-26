/**
 * The dev Mac's automatic update: the clone and the dev app move to the
 * newest release together, or nothing moves. Every guard is checked before
 * the clone is touched; the app swap comes last, because it relaunches the
 * app, which restarts the daemon this run may have been started by.
 */
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { chooseDevRelease, listDevReleases, readInstalledDevApp } from "./dev-app.ts";
import type { CloneCheck, CloneHold } from "./clone-guards.ts";
import { registerApps } from "./setup.ts";
import type { DevSeams, StageRunner } from "./seams.ts";
import { buildRtUi, ensureDevApp, requireGh, toolchainEnv } from "./stages.ts";
import { compareVersions, parseBunPin, parseGoPin, probeDevTools } from "./tools.ts";
import { buildServedApps, rtUiStale } from "./update.ts";

export type DevHold = CloneHold | "daemonBusy" | "orgOff" | "updateFailed";
export type DevAutoOutcome =
  | { kind: "current" }
  | { kind: "held"; version: string; hold: DevHold; detail: string }
  | { kind: "updated"; version: string; daemonRestarted: boolean };

import type { DevAutoStatus } from "./app-update-status.ts";
export type { DevAutoStatus };

export interface DevAutoDeps {
  autoUpdateOn(): boolean;
  /** False when the daemon does not answer. */
  daemonBusy(): Promise<boolean>;
  checkClone(clone: string): Promise<CloneCheck>;
  /** git merge --ff-only origin/main */
  fastForward(clone: string): Promise<{ exitCode: number; stderr: string }>;
  /** bun install --frozen-lockfile */
  /** `bun` is the path the tools stage probed; Go's directory comes first in `env.PATH`. */
  install(clone: string, env: Record<string, string>, bun: string): Promise<{ exitCode: number; tail: string }>;
  /** True once the tray took the restart; false when no tray answered. */
  restartDaemon(): Promise<boolean>;
  writeStatus(s: DevAutoStatus): void;
  /** Clears a held status left by an earlier run; writes nothing when none is recorded. */
  clearHeld(): void;
  /** One notification per (version, hold). */
  notifyOnce(version: string, hold: DevHold, detail: string): void;
  lock<T>(fn: () => Promise<T>): Promise<T | "locked">;
  /** The detached run's output goes nowhere, so a failure's own output is kept here. */
  logFailure(detail: string, output: string): void;
}

const CURRENT: DevAutoOutcome = { kind: "current" };

export async function runDevAutoUpdate(s: DevSeams, stage: StageRunner, d: DevAutoDeps): Promise<DevAutoOutcome | "locked"> {
  return d.lock(async () => {
    const clone = s.storedSourcePath();
    if (s.flavor !== "dev" || !clone || !s.probes.exists(join(clone, "cli.ts"))) return CURRENT;
    // No dev app, or one built on this Mac, is not this run's to update, so
    // a hold an earlier run recorded no longer says anything true.
    const installed = await readInstalledDevApp(s.probes);
    if (!installed || !installed.releaseBuild) {
      d.clearHeld();
      return CURRENT;
    }
    const pick = await newestRelease(s);
    if (!pick) return CURRENT;
    if (compareVersions(installed.version, pick.release.version) >= 0) {
      d.clearHeld();
      return CURRENT;
    }
    const version = pick.release.version;
    const held = (hold: DevHold, detail: string): DevAutoOutcome => {
      d.writeStatus({ offeredVersion: version, heldVersion: hold === "orgOff" ? null : version, hold });
      if (hold !== "orgOff") d.notifyOnce(version, hold, detail);
      return { kind: "held", version, hold, detail };
    };

    if (!d.autoUpdateOn()) return held("orgOff", "Your org turned automatic updates off.");
    const check = await d.checkClone(clone);
    if (!check.ok) return held(check.hold, check.detail);
    if (await d.daemonBusy()) return held("daemonBusy", "The daemon is busy; rt tries again within the hour.");

    const tools = await toolsForOriginMain(s, clone);
    if ("missing" in tools) return held("updateFailed", tools.missing);

    let current = "";
    let relaunched = false;
    const step: StageRunner = (title, task) => {
      current = title;
      return stage(title, task);
    };
    try {
      await step("Update your clone", async () => {
        const ff = await d.fastForward(clone);
        if (ff.exitCode !== 0) throw new StepFailed("Fast-forwarding your clone to origin/main failed.", ff.stderr);
        const inst = await d.install(clone, toolchainEnv(s, tools), tools.bunPath);
        if (inst.exitCode !== 0) throw new StepFailed("bun install failed in your clone.", inst.tail);
        return { status: "done", title: "Updated your clone" };
      });
      await step("Rebuild rt's terminal helper", async () => {
        if (!(await rtUiStale(s, clone))) return { status: "skipped", title: "rt's terminal helper is current" };
        await asStep(() => buildRtUi(s, clone, tools), "Building rt's terminal helper failed.");
        return { status: "done", title: "Rebuilt rt's terminal helper" };
      });
      await step("Build the served apps", async () => {
        const failed = await buildServedApps(s, clone, toolchainEnv(s, tools));
        if (failed) throw new StepFailed(`Building ${failed} from your clone failed.`);
        return { status: "done", title: "Built the served apps" };
      });
      await step("Serve the apps from your clone", async (io) => {
        await asStep(() => registerApps(s, clone, io), "Serving the apps from your clone failed.");
        return { status: "done", title: "The apps run from your clone" };
      });
      await step("Update the dev app", (io) =>
        asStep(() => ensureDevApp(s, io, "update", pick, { onInstalled: (r) => { relaunched = r.relaunchedPid !== null; } }), "Installing the dev app failed."));
    } catch (err) {
      if (err instanceof StepFailed) {
        d.logFailure(err.message, err.output);
        return held("updateFailed", err.message);
      }
      const detail = `${current} stopped on an unexpected error.`;
      d.logFailure(detail, err instanceof Error ? (err.stack ?? err.message) : String(err));
      return held("updateFailed", detail);
    }
    // The swap's relaunch of a running app already restarted the daemon.
    const daemonRestarted = relaunched || (await d.restartDaemon());
    d.writeStatus({ offeredVersion: version, heldVersion: null, hold: null });
    return { kind: "updated", version, daemonRestarted };
  });
}

class StepFailed extends Error {
  constructor(message: string, readonly output: string = "") {
    super(message);
  }
}

async function asStep<T>(fn: () => Promise<T>, detail: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserActionableError) throw new StepFailed(detail, err.log ?? err.message);
    throw err;
  }
}

/** No release, or GitHub not answering, both mean there is nothing to install this hour. */
async function newestRelease(s: DevSeams) {
  try {
    return await chooseDevRelease(s.probes, await listDevReleases(s.probes, requireGh(s)));
  } catch (err) {
    if (err instanceof UserActionableError) return null;
    throw err;
  }
}

/** The pins the clone will have after the fast-forward, read before it, so a missing tool stops the run while nothing has changed. */
async function toolsForOriginMain(s: DevSeams, clone: string): Promise<{ bunPath: string; goPath: string } | { missing: string }> {
  const show = (path: string) => s.probes.exec(["git", "-C", clone, "show", `origin/main:${path}`], { timeoutMs: 15_000 });
  const [pkg, goMod] = await Promise.all([show("package.json"), show("ui/go.mod")]);
  const bun = pkg.code === 0 ? parseBunPin(pkg.stdout) : null;
  const go = goMod.code === 0 ? parseGoPin(goMod.stdout) : null;
  if (!bun || !go) return { missing: "rt could not read which bun and Go versions origin/main needs." };
  const tools = await probeDevTools(s.probes, { bun, go });
  const short = tools.find((t) => t.need === "required" && t.state !== "ready");
  if (short) {
    return {
      missing: short.state === "too-old"
        ? `The update needs ${short.name} ${short.wanted}; this Mac has ${short.version}.`
        : `The update needs ${short.name} ${short.wanted}, which is not installed.`,
    };
  }
  return { bunPath: tools.find((t) => t.name === "bun")!.found!, goPath: tools.find((t) => t.name === "go")!.found! };
}

export interface NotifyOnceStore {
  read(): string | null;
  write(value: string): void;
  notify(n: { title: string; message: string; id: string }): void;
}

/**
 * The record outlives the process, so a daemon restart between hourly runs
 * does not repeat a notice. It keeps every hold announced for the waiting
 * version (`<version>:<hold>,<hold>`), so holds that alternate notify once each.
 */
export function createNotifyOnce(store: NotifyOnceStore): (version: string, hold: DevHold, detail: string) => void {
  return (version, hold, detail) => {
    const [storedVersion, storedHolds = ""] = (store.read() ?? "").split(":");
    const holds = storedVersion === version ? storedHolds.split(",").filter(Boolean) : [];
    if (holds.includes(hold)) return;
    store.write(`${version}:${[...holds, hold].join(",")}`);
    store.notify({ title: "A mattstack update is waiting", message: `mattstack-dev ${version} is ready. ${detail}`, id: `dev_update:${version}:${hold}` });
  };
}

