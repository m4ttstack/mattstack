/**
 * rt release: release-cycle verbs.
 *
 *   rt release preflight [--json]
 *   rt release verify [tag] [--json] [--no-wait]
 *   rt release update-machine [--tag <tag>] [--plan] [--verify-only] [--yes] [--json]
 *   rt release apps [--dry-run] [--json] [--yes-notes]
 *
 * Read-only report of the release's mechanical checks (the rt:release
 * skill's preflight node): git/tag state, picker conformance, pin freshness
 * for every vendored layer, catalog pin drift, extension currency, and which
 * gate (fast vs full) the pending diff implies. Exit 0 only when every layer
 * is verified current; stale or unverifiable layers exit 1.
 *
 * `verify` confirms a tagged release actually published: the release.yml
 * run, the release body against the committed RELEASE_NOTES.md, the four
 * build assets, draft/prerelease state, and releases/latest propagation.
 * Exit 0 only when every check verifies; stale, unverifiable, or
 * still-propagating rows exit 1.
 *
 * update-machine runs the skill's update-machine step: bring this machine's
 * prod app, dev bundle, daemon, and served suite up to a released tag.
 *
 * `app` is the fast path for a single served-app fix: qualify the path fast
 * path, write and commit the notes, tag and verify in one resumable run
 * (lib/release/release-app.ts).
 */
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir, homedir } from "os";
import { dirname, join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError, failureFor, logFailureDetail } from "../lib/errors.ts";
import { refusalNote } from "./git/shared.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { childEnv, runCapture } from "../lib/subprocess.ts";
import { runPreflight, type CheckRow, type PreflightSeams } from "../lib/release/preflight.ts";
import { runVerify, type VerifyRow, type VerifySeams } from "../lib/release/verify.ts";
import {
  runUpdateMachine,
  CHAT_ROOM,
  type LegResult,
  type UpdateMachineOptions,
  type UpdateMachineReport,
  type UpdateMachineSeams,
} from "../lib/release/update-machine.ts";
import { resolveSharedCheckout } from "../lib/release/shared-checkout.ts";
import { NOTARY_PROFILE_DEFAULT } from "../lib/release/dev-publish.ts";
import {
  listJoin,
  notesDeclined,
  plannedPhase,
  qualifyStop,
  runReleaseApp,
  type QualifyStop,
  type ReleaseAppOptions,
  type ReleaseAppProgress,
  type ReleaseAppReport,
  type ReleaseAppSeams,
  type StepResult,
  type StepStatus,
} from "../lib/release/release-app.ts";
import { conformanceViolations } from "../scripts/lib/picker-conformance.ts";
import { TREE } from "../lib/command-tree-def.ts";
import { flagValue } from "../lib/cli-args.ts";
import { confirm } from "../lib/ui/prompts.ts";
import { interactive } from "../lib/ui/gate.ts";
import { usageFailure } from "../lib/ui/usage.ts";

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function createRealSeams(): Promise<PreflightSeams> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  return {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", ...opts }),
    fetchJson,
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    violations: () => conformanceViolations(TREE),
  };
}

async function createRealVerifySeams(): Promise<VerifySeams> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  return {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", ...opts }),
    fetchJson,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function parseVerifyArgs(args: string[]): { tag?: string; json: boolean; noWait: boolean } {
  const tag = args.find((a) => !a.startsWith("--"));
  return { tag, json: args.includes("--json"), noWait: args.includes("--no-wait") };
}

// A row rt could not check is not a failure: nothing is known to be wrong.
const ROW_STATUS: Record<VerifyRow["status"], RenderStatus> = { ok: "done", stale: "stale", error: "warn", pending: "pending" };

function rowLine(row: CheckRow | VerifyRow): Block {
  const versions = row.pinned && row.current && row.pinned !== row.current ? ` ${row.pinned} → ${row.current}` : "";
  return out.line(ROW_STATUS[row.status], `${row.label}${versions}`, row.detail ?? row.status);
}

export async function releasePreflight(args: string[], _ctx: CommandContext = {}, seams?: PreflightSeams): Promise<void> {
  const report = await runPreflight(seams ?? (await createRealSeams()));

  if (args.includes("--json")) {
    out.json(envelope(report));
    if (!report.clean) process.exitCode = 1;
    return;
  }

  const okCount = report.rows.length - report.staleCount - report.errorCount;
  out.print(
    ...report.rows.map(rowLine),
    ...(report.gate ? [out.kv("gate", `${report.gate.path} (${report.gate.reason})`)] : []),
    out.summary(report.clean ? "done" : report.staleCount > 0 ? "stale" : "warn", `${report.rows.length} checks`, [
      `${okCount} ok`,
      `${report.staleCount} stale`,
      `${report.errorCount} unverifiable`,
    ]),
  );
  if (!report.clean) process.exitCode = 1;
}

export async function releaseVerify(args: string[], _ctx: CommandContext = {}, seams?: VerifySeams): Promise<void> {
  const { tag, json, noWait } = parseVerifyArgs(args);
  const report = await runVerify(seams ?? (await createRealVerifySeams()), { tag, noWait });

  if (json) {
    out.json(envelope(report));
    if (!report.clean) process.exitCode = 1;
    return;
  }

  const okCount = report.rows.length - report.staleCount - report.errorCount - report.pendingCount;
  const status: RenderStatus = report.clean ? "done" : report.staleCount > 0 ? "stale" : report.errorCount > 0 ? "warn" : "pending";
  out.print(
    out.section(`Release ${report.tag ?? "(no tag resolved)"}`, undefined, ...report.rows.map(rowLine)),
    out.summary(status, `${report.rows.length} checks`, [`${okCount} ok`, `${report.staleCount} stale`, `${report.pendingCount} pending`, `${report.errorCount} unverifiable`]),
  );
  if (!report.clean) process.exitCode = 1;
}

/** Only created for a run that can actually mutate anything -- --plan and --verify-only never touch it. */
export async function createRealUpdateMachineSeams(options: UpdateMachineOptions): Promise<UpdateMachineSeams> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  const needsWorkDir = !options.plan && !options.verifyOnly;
  return {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    sharedCheckoutPath: resolveSharedCheckout(homedir()),
    workDir: needsWorkDir ? mkdtempSync(join(tmpdir(), "rt-update-machine-")) : "",
    uid: process.getuid ? process.getuid() : 501,
    isTTY: interactive(),
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", timeoutMs: 600_000, ...opts, ...(opts?.env ? { env: { ...childEnv(), ...opts.env } } : {}) }),
    download: async (url, destPath) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      await Bun.write(destPath, res);
    },
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: async (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      await Bun.write(path, content);
    },
    notaryProfile: process.env.NOTARY_PROFILE || NOTARY_PROFILE_DEFAULT,
    confirm: (message) => confirm({ message }),
    announce: async (message) => (await runCapture(["rt", "chat", "post", CHAT_ROOM, message], { timeoutMs: 30_000 })).exitCode === 0,
    clock: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

const LEG_STATUS: Record<LegResult["status"], RenderStatus> = { ok: "done", skipped: "skipped", aborted: "refused", error: "failed", planned: "pending" };

/** An aborted leg is rt declining by a guard (a checkout off main, an announcement that did not land), except the prod app's: its only abort is a checksum that does not match, which is a fault. */
function legStatus(leg: LegResult): RenderStatus {
  return leg.status === "aborted" && leg.id === "prod-app" ? "failed" : LEG_STATUS[leg.status];
}

export function updateMachineBlocks(report: UpdateMachineReport): Block[] {
  const planOnly = report.legs.length > 0 && report.legs.every((leg) => leg.status === "planned");
  const stoppedBy = report.haltedAfter ? report.legs.find((leg) => leg.label === report.haltedAfter) : undefined;
  const summary = planOnly ? "plan only, nothing changed" : report.ok ? "clean" : report.haltedAfter ? `stopped at ${report.haltedAfter}` : "problems above";
  const summaryStatus: RenderStatus = planOnly ? "pending" : report.ok ? "done" : stoppedBy && legStatus(stoppedBy) === "refused" ? "refused" : "failed";
  return [...report.legs.map((leg) => out.line(legStatus(leg), leg.label, leg.detail)), out.summary(summaryStatus, `tag ${report.tag}`, [summary])];
}

export async function releaseUpdateMachine(args: string[], _ctx: CommandContext = {}, seams?: UpdateMachineSeams): Promise<void> {
  const json = args.includes("--json");
  const options: UpdateMachineOptions = {
    tag: flagValue(args, "--tag"),
    plan: args.includes("--plan"),
    verifyOnly: args.includes("--verify-only"),
    yes: args.includes("--yes"),
  };

  const realSeams = seams ? null : await createRealUpdateMachineSeams(options);
  const cleanupWorkDir = () => {
    if (!realSeams?.workDir) return;
    try {
      rmSync(realSeams.workDir, { recursive: true, force: true });
    } catch {
      // best effort; a leftover scratch dir under tmpdir() is not worth failing the verb over
    }
  };

  // exitUserError calls the real process.exit, which never runs a pending finally,
  // so cleanup happens explicitly on this path before that call, not after it.
  let report;
  try {
    report = await runUpdateMachine(seams ?? realSeams!, options);
  } catch (err) {
    cleanupWorkDir();
    if (err instanceof UserActionableError && err.code === "update-machine-noninteractive" && !json) {
      logFailureDetail(err);
      out.note(...refusalNote(failureFor(err)));
      process.exit(2);
    }
    if (err instanceof UserActionableError) exitUserError(err, json);
    throw err;
  }
  cleanupWorkDir();

  const failed = report.legs.some((l) => l.status === "aborted" || l.status === "error");

  if (json) {
    out.json(envelope(report));
    if (failed) process.exitCode = 1;
    return;
  }

  out.print(...updateMachineBlocks(report));
  if (failed) process.exitCode = 1;
}

/** `workDirPath` reads whatever `workDir()` lazily created, or null if the run never touched it, so the caller can remove it when done. */
async function createRealReleaseAppSeams(): Promise<{ seams: ReleaseAppSeams; workDirPath: () => string | null }> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  let workDir: string | null = null;
  const seams: ReleaseAppSeams = {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", timeoutMs: 60_000, ...opts }),
    fetchJson,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isTTY: interactive(),
    workDir: () => (workDir ??= mkdtempSync(join(tmpdir(), "rt-release-app-"))),
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: (path, text) => writeFileSync(path, text),
    confirm: (message) => confirm({ message }),
    progress: (event) => out.print(...progressBlocks(event)),
  };
  return { seams, workDirPath: () => workDir };
}

export interface ReleaseAppCommandDeps {
  seams?: ReleaseAppSeams;
  run?: (seams: ReleaseAppSeams, opts: ReleaseAppOptions) => Promise<ReleaseAppReport>;
}

const RELEASE_APPS_USAGE = "usage: rt release apps [--dry-run] [--json] [--yes-notes <notes hash>]";

const STEP_STATUS: Record<StepStatus, RenderStatus> = { ok: "done", done: "done", planned: "pending", failed: "failed", stopped: "needs-you", pending: "pending" };

const QUALIFY_STOP_STATUS: Record<QualifyStop, RenderStatus> = { "not-fast-path": "refused", "nothing-moved": "skipped", "no-release-tag": "failed" };

/** A stopped notes step waits on a person unless they already said no; a stopped qualify step is a refusal, nothing to do, or an environment problem. */
function stepStatus(step: StepResult): RenderStatus {
  if (notesDeclined(step)) return "skipped";
  const stop = qualifyStop(step);
  return stop ? QUALIFY_STOP_STATUS[stop] : STEP_STATUS[step.status];
}

export function progressBlocks(event: ReleaseAppProgress): Block[] {
  switch (event.kind) {
    case "step":
      return [out.line(stepStatus(event.step), event.step.label, event.step.detail), ...(event.step.command ? [out.callout("next", out.cmd(event.step.command))] : [])];
    case "watching":
      return [out.line("running", `Watching the release build for ${event.tag}`, "a real run takes 25 to 50 minutes")];
    case "notes":
      return [out.verbatim(event.notes.split("\n"), "release notes"), out.kv("notes hash", event.hash)];
  }
}

export function releaseAppBlocks(report: ReleaseAppReport): Block[] {
  const resume = report.resume ? [out.callout("next", out.cmd(report.resume))] : [];
  switch (report.status) {
    case "released":
      return [out.summary("done", `Released ${report.nextTag}`)];
    case "planned":
      return [
        out.summary("pending", "Dry run: nothing changed", [
          plannedPhase(report) === "released" ? `a real run checks the publish of ${report.lastTag} again` : `a real run releases ${listJoin(report.apps)} as ${report.nextTag}`,
        ]),
      ];
    case "awaiting-approval":
      return [out.summary("needs-you", "The notes need your approval"), ...resume];
    case "declined": {
      if (report.resume) return [out.summary("skipped", "You said no: nothing was committed or tagged"), ...resume];
      const last = report.steps.at(-1);
      switch (qualifyStop(last)) {
        case "nothing-moved":
          return [out.line("skipped", "Nothing to release", last?.detail)];
        case "no-release-tag":
          return [out.failure({ title: "rt cannot release from here", why: last?.detail })];
        default:
          return [out.line("refused", "rt will not take the fast path for this release", last?.detail)];
      }
    }
    case "pending":
      return [out.summary("pending", `${report.nextTag} is tagged, and its publish has not verified yet`), ...resume];
    case "failed": {
      const step = report.steps.at(-1)?.label ?? "qualify";
      return [out.summary("failed", `Stopped at ${step}`, report.resume ? undefined : ["this needs a decision, not a rerun"]), ...resume];
    }
  }
}

export async function releaseApps(args: string[], _ctx: CommandContext = {}, deps: ReleaseAppCommandDeps = {}): Promise<void> {
  const json = args.includes("--json");
  // The envelope owns stdout, so progress moves to stderr for this run.
  if (json) out.payloadOnStdout();
  const real = deps.seams ? null : await createRealReleaseAppSeams();
  const seams = deps.seams ?? real!.seams;
  const cleanupWorkDir = () => {
    const dir = real?.workDirPath();
    if (!dir) return;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort; a leftover scratch dir under tmpdir() is not worth failing the verb over
    }
  };
  const usage = (title: string, why?: string): never => {
    if (json) exitUserError(new UserActionableError("usage", RELEASE_APPS_USAGE), true);
    out.fail(usageFailure(title, RELEASE_APPS_USAGE, why));
    return process.exit(2);
  };
  const badHash = () => usage("The notes hash is the 12 characters a stopped run printed");

  try {
    let yesNotes: string | null;
    try {
      yesNotes = flagValue(args, "--yes-notes") ?? null;
    } catch {
      return badHash();
    }
    if (yesNotes !== null && !/^[0-9a-f]{12}$/.test(yesNotes)) return badHash();
    const yesAt = args.indexOf("--yes-notes");
    if (args.some((a, i) => !a.startsWith("--") && !(yesAt >= 0 && i === yesAt + 1))) return usage("This command takes no app name", "It releases every app that changed.");

    const report = await (deps.run ?? runReleaseApp)(seams, {
      dryRun: args.includes("--dry-run"),
      json,
      yesNotes,
    });
    const stop = report.status === "declined" && !report.resume ? qualifyStop(report.steps.at(-1)) : null;
    if (json) out.json(envelope(report));
    else if (stop === "not-fast-path" || stop === "no-release-tag") out.note(...releaseAppBlocks(report));
    else out.print(...releaseAppBlocks(report));
    if (report.status === "failed" || report.status === "declined" || report.status === "pending") process.exitCode = 1;
  } finally {
    cleanupWorkDir();
  }
}
