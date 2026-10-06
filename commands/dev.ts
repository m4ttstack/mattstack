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
import { runDevUpdate, type DevUpdateResult } from "../lib/dev/update.ts";
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
  await run(args, runDevUpdate, (r, stages, json) => {
    if (json) out.json(devEnvelope({ ok: true, clone: r.clone, stages }, new Date()));
    else out.print(...devUpdateBlocks(r));
  });
}
