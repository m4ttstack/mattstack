/**
 * `rt dev setup` and `rt dev update`: the shell around lib/dev. One rt-ui
 * step per stage at a terminal, plain lines off one, and a frozen envelope
 * under --json. Every decision lives in lib/dev.
 */
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
import { resolveTool } from "../lib/deps/resolve.ts";
import { devWrapperOwnsRt } from "../lib/dev-mode.ts";
import { DEV_NEEDS_YOU_CODES, DEV_REFUSAL_CODES, type DevSeams, type StageEnding, type StageIO, type StageRunner } from "../lib/dev/seams.ts";
import { runDevSetup, type DevSetupResult } from "../lib/dev/setup.ts";
import { runDevUpdate, type CloneSync, type DevUpdateResult } from "../lib/dev/update.ts";
import { createNotifyOnce, runDevAutoUpdate, type DevAutoDeps, type DevAutoOutcome } from "../lib/dev/auto-update.ts";
import { readAppUpdateHold, writeAppUpdateStatus, type DevAutoStatus } from "../lib/dev/app-update-status.ts";
import { checkClone, fastForwardMain, realCloneGuardDeps } from "../lib/dev/clone-guards.ts";
import { rtCommand } from "../packages/rt-client/src/index.ts";
import { RT_DIR } from "../lib/daemon-config.ts";
import { trayQuery } from "../lib/daemon-client.ts";
import { notify } from "../lib/notifier.ts";
import { devUpdateLock, underDevUpdateLock } from "../lib/dev/update-lock.ts";
import { getKvValue, setKvValueCritical } from "../lib/state/kv-blob.ts";
import { exitUserError, failureFor, logFailureDetail, UserActionableError } from "../lib/errors.ts";
import { processFlavor } from "../lib/flavor.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import { envelope } from "../lib/setup/contract.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import { installDevTool } from "../lib/setup/tools-install.ts";
import { rtVersion } from "../lib/setup/update.ts";
import { childEnv, runCapture } from "../lib/subprocess.ts";
import { withoutUrls } from "../lib/team/redact.ts";
import { interactive } from "../lib/ui/gate.ts";
import * as out from "../lib/ui/out.ts";
import { confirm } from "../lib/ui/prompts.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { openStep, settleBackground, type StepHandle } from "../lib/ui/spawn.ts";
import { readDevModeConfig, saveSourcePath } from "./settings.ts";

const OUTPUT_CAPTION = "what it said";
const OUTPUT_TAIL_LINES = 5;

function realSeams(json: boolean, scratch: { dir: string | null }): DevSeams {
  const probes = createRealProbes();
  return {
    probes,
    swap: {
      exec: (argv, opts) => runCapture(argv, { stderr: "pipe", timeoutMs: 600_000, ...opts, ...(opts?.env ? { env: { ...childEnv(), ...opts.env } } : {}) }),
      sleep: (ms) => Bun.sleep(ms),
    },
    download: async (url, dest) => {
      const r = await runCapture(["curl", "-fsSL", "--retry", "3", "-o", dest, url], { stderr: "pipe", timeoutMs: 30 * 60_000 });
      if (r.exitCode !== 0) throw new UserActionableError("dev-download-failed", "Downloading the dev app failed", {}, { log: r.stderr });
    },
    scratchDir: () => (scratch.dir ??= mkdtempSync(join(tmpdir(), "rt-dev-"))),
    flavor: processFlavor(),
    interactive: !json && interactive(),
    prodVersion: rtVersion(),
    confirm: (message) => confirm({ message, initialValue: true }),
    repoRoot: () => getSetting<string[]>("rt.repoRoots").value?.[0] ?? null,
    storedSourcePath: () => readDevModeConfig().sourcePath ?? null,
    saveSourcePath,
    installDevTool: (tool, version) => installDevTool(probes, tool, version),
    gh: () => resolveTool(probes, "gh").exec,
    devWrapperOwnsRt,
  };
}

function realCloneSync(): CloneSync {
  const guards = realCloneGuardDeps();
  return {
    checkClone: (clone) => checkClone(guards, clone),
    fastForward: (clone) => fastForwardMain(guards, clone),
    install: async (clone, env, bun) => {
      const r = await runCapture([bun, "install", "--frozen-lockfile"], { cwd: clone, stderr: "pipe", timeoutMs: 15 * 60_000, env: { ...childEnv(), ...env } });
      return { exitCode: r.exitCode, tail: `${r.stdout}\n${r.stderr}`.trim().split("\n").slice(-OUTPUT_TAIL_LINES).join("\n") };
    },
  };
}

function writeAppUpdate(s: DevAutoStatus): void {
  writeAppUpdateStatus(RT_DIR, s);
}

function realAutoDeps(): DevAutoDeps {
  const sync = realCloneSync();
  return {
    autoUpdateOn: () => {
      try {
        return getSetting<boolean>("mattstack.autoUpdate").value !== false;
      } catch {
        return true;
      }
    },
    daemonBusy: async () => {
      const r = await rtCommand<{ busy: boolean }>("daemon:busy", {}, { timeoutMs: 3000, retryBudgetMs: 0 });
      return r.ok === true && r.data?.busy === true;
    },
    checkClone: sync.checkClone,
    fastForward: sync.fastForward,
    install: sync.install,
    restartDaemon: async () => (await trayQuery("/daemon/restart", "POST"))?.ok === true,
    writeStatus: writeAppUpdate,
    clearHeld: () => {
      if (readAppUpdateHold(RT_DIR) !== null) writeAppUpdate({ offeredVersion: null, heldVersion: null, hold: null });
    },
    notifyOnce: createNotifyOnce({
      read: () => getKvValue<string | null>("dev-auto-update", "announced", null),
      write: (v) => { setKvValueCritical("dev-auto-update", "announced", v); },
      notify: (n) => notify(n.title, n.message, undefined, "setup_update", undefined, n.id),
    }),
    lock: (fn) => underDevUpdateLock(devUpdateLock(RT_DIR), fn),
    logFailure: (detail, output) => logCliEvent("warn", "dev", detail, { output: withoutUrls(output) }),
  };
}

async function openStageStep(title: string): Promise<StepHandle | null> {
  await settleBackground();
  try {
    return openStep(title);
  } catch {
    return null;
  }
}

/**
 * One rt-ui step per stage, the shape commands/home.ts uses. `pause` ends the
 * step before a prompt or a child that owns the terminal and opens a fresh
 * one after, so nothing paints under it. Endings are collected for --json.
 */
function stageRunner(json: boolean, endings: StageEnding[]): StageRunner {
  return async (title, task) => {
    const drawing = !json && interactive();
    let step: StepHandle | null = drawing ? await openStageStep(title) : null;
    const io: StageIO = {
      sub: (text) => {
        step?.sub(text);
        logCliEvent("debug", "dev", withoutUrls(text));
      },
      pause: async (fn) => {
        if (step) {
          await step.clear();
          step = null;
        }
        try {
          return await fn();
        } finally {
          if (drawing) step = await openStageStep(title);
        }
      },
    };
    let ending: StageEnding;
    try {
      ending = await task(io);
    } catch (err) {
      if (step) await step.clear({ thrown: true });
      throw err;
    }
    endings.push(ending);
    if (json) return ending;
    const painted =
      step === null
        ? false
        : ending.status === "failed"
          ? await step.fail(ending.title, ending.hint)
          : await step.done(ending.title, ending.hint, ending.status === "done" ? undefined : ending.status);
    if (!painted) out.print(out.line(ending.status, ending.title, ending.hint));
    return ending;
  };
}

export function devSetupBlocks(r: DevSetupResult): Block[] {
  if (r.kind === "already") {
    return [out.line("skipped", "This Mac already runs mattstack from your clone", r.clone), out.callout("next", out.cmd("rt dev update"))];
  }
  return [
    out.blank(),
    out.line("done", "You're on the dev app, running your clone", r.clone),
    out.callout("tip", "The dev app's Rebuild menu is for tray changes and needs the maintainers' signing certificate."),
    out.callout("next", ["Switch back any time: ", out.cmd("open /Applications/mattstack.app")]),
  ];
}

export function devAutoBlocks(r: DevAutoOutcome | "locked"): Block[] {
  if (r === "locked") return [out.line("skipped", "Another dev update is running")];
  if (r.kind === "current") return [out.line("done", "Your dev setup is up to date")];
  if (r.kind === "updated") {
    const done = out.line("done", `Updated to mattstack-dev ${r.version}`);
    if (r.daemonRestarted) return [done];
    return [done, out.line("pending", "The daemon still runs the code from before the update", "mattstack-dev did not answer"), out.callout("next", out.cmd("rt daemon restart"))];
  }
  return [out.line("pending", `An update to mattstack-dev ${r.version} is waiting`, r.detail)];
}

export function devUpdateBlocks(r: DevUpdateResult): Block[] {
  return [out.blank(), out.line("done", "Your dev setup is up to date", r.clone)];
}

export function devEnvelope(body: Record<string, unknown>, now: Date) {
  return envelope(body, now);
}

export type FailureView = { note: true; status: "refused" | "needs-you"; blocks: Block[] } | { note: false; failure: out.FailureInput; after: Block[] };

export function failureBlocks(err: UserActionableError): FailureView {
  const status = DEV_REFUSAL_CODES.has(err.code) ? "refused" : DEV_NEEDS_YOU_CODES.has(err.code) ? "needs-you" : null;
  if (status) {
    return { note: true, status, blocks: [out.line(status, err.message, err.why), ...(err.next ? [out.callout("next", out.cmd(err.next))] : [])] };
  }
  const tail = err.log
    ? withoutUrls(err.log)
        .split("\n")
        .filter((l) => l.trim() !== "")
        .slice(-OUTPUT_TAIL_LINES)
    : [];
  return { note: false, failure: failureFor(err), after: tail.length > 0 ? [out.verbatim(tail, OUTPUT_CAPTION)] : [] };
}

/** `cleanup` runs first: process.exit skips the caller's finally. */
function fail(err: unknown, json: boolean, cleanup: () => void): never {
  cleanup();
  if (!(err instanceof UserActionableError)) throw err;
  const safe = new UserActionableError(err.code, err.message, err.extra, { why: err.why, next: err.next, log: err.log ? withoutUrls(err.log) : undefined });
  if (json) exitUserError(safe, true);
  logFailureDetail(safe);
  const f = failureBlocks(safe);
  if (f.note) out.note(...f.blocks);
  else out.fail(f.failure, ...f.after);
  process.exit(2);
}

async function run<T>(args: string[], verb: (s: DevSeams, r: StageRunner) => Promise<T>, done: (r: T, stages: StageEnding[], json: boolean) => void): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const endings: StageEnding[] = [];
  const scratch: { dir: string | null } = { dir: null };
  const cleanup = () => {
    if (scratch.dir) rmSync(scratch.dir, { recursive: true, force: true });
    scratch.dir = null;
  };
  try {
    done(await verb(realSeams(json, scratch), stageRunner(json, endings)), endings, json);
  } catch (err) {
    fail(err, json, cleanup);
  } finally {
    cleanup();
  }
}

export async function devSetup(args: string[], _ctx: CommandContext = {}): Promise<void> {
  await run(args, runDevSetup, (r, stages, json) => {
    if (json) out.json(devEnvelope({ ok: true, kind: r.kind, clone: r.clone, stages }, new Date()));
    else out.print(...devSetupBlocks(r));
  });
}

export async function devUpdate(args: string[], _ctx: CommandContext = {}): Promise<void> {
  if (args.includes("--auto")) {
    await run(args, (s, stage) => runDevAutoUpdate(s, stage, realAutoDeps()), (r, _stages, json) => {
      if (json) out.json(devEnvelope({ ok: true, ...(r === "locked" ? { kind: "locked" } : r) }, new Date()));
      else out.print(...devAutoBlocks(r));
    });
    return;
  }
  const release = args.includes("--release");
  await run(args, (s, stage) => runDevUpdate(s, stage, { release, clone: realCloneSync(), lock: (fn) => underDevUpdateLock(devUpdateLock(RT_DIR), fn) }), (r, stages, json) => {
    if (json) out.json(devEnvelope({ ok: true, clone: r.clone, stages }, new Date()));
    else out.print(...devUpdateBlocks(r));
  });
}
