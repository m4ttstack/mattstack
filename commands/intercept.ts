#!/usr/bin/env bun

/**
 * rt intercept: generic command interception CLI verbs.
 *
 *   rt intercept run <command> -- [args...]   hidden verb the shim execs
 *   rt intercept status [--json]              shim + rule health + cache staleness
 *   rt intercept install [--json]             (re)write PATH shims
 *   rt intercept uninstall [--json]           remove generated shims
 *
 * `interceptRun` wires the real dependencies for `lib/endpoint/run.ts`'s
 * `runInterception`: the pure, testable core (see
 * `lib/endpoint/__tests__/intercept-run.test.ts`). Everything that talks to
 * git, the daemon, or a real subprocess lives here; the decision tree does
 * not.
 *
 * `RT_INTERCEPT_BYPASS=1` short-circuits HERE, before any matching: the
 * generated `/bin/sh` shim (`lib/endpoint/shim.ts`) carries no bypass logic
 * of its own, by design (see that module's header comment).
 */

import { closeSync, openSync, readSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { wellKnownBinDirs } from "../lib/bundled-tool.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
import { redactCredentials } from "../packages/rt-client/src/redact.ts";
import { daemonQuery } from "../lib/daemon-client.ts";
import { runCapture } from "../lib/subprocess.ts";
import { GENERATED_MARKER, loadInterceptRules, shimPath, shimReport, installShims, interceptsOutOfDate, uninstallShims } from "../lib/endpoint/shim.ts";
import { runInterception, type RunDeps } from "../lib/endpoint/run.ts";

function toStringEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// ─── real RunDeps wiring ─────────────────────────────────────────────────────

async function gitToplevel(cwd: string): Promise<string | null> {
  const res = await runCapture(["git", "-C", cwd, "rev-parse", "--show-toplevel"]);
  if (res.exitCode !== 0) return null;
  const trimmed = res.stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function gitRemote(toplevel: string): Promise<string | null> {
  const res = await runCapture(["git", "-C", toplevel, "config", "--get", "remote.origin.url"]);
  if (res.exitCode !== 0) return null;
  const trimmed = res.stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads just the first 512 bytes of `path` and checks for the generated-shim
 * marker (always on line 2, well inside that window, see
 * `renderInterceptShim`). Deliberately a raw partial read, not
 * `readFileSync`, so this stays cheap even against a large real binary: a
 * few bytes off disk, never the whole file. Any read failure (permission,
 * ENOENT between stat and here, a directory) is treated as "not a shim":
 * this is a guard against recursion, not a correctness gate on resolution.
 */
function looksLikeGeneratedShim(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(512);
    const bytesRead = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString("utf8").includes(GENERATED_MARKER);
  } catch {
    return false;
  } finally {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
  }
}

/**
 * Scans `PATH` for an executable file named `command` that is NOT one of
 * rt's own generated intercept shims, skipping this command's own shim path
 * (so the search never resolves back to itself) — `~/.local/bin` sits on
 * PATH ahead of everything else so an unfiltered scan would just find the
 * shim again.
 *
 * Path-string equality alone is not a sufficient recursion guard: a
 * symlinked HOME makes the shim reachable under a different absolute path
 * string, and a shim file COPIED (not symlinked) onto PATH ahead of
 * `~/.local/bin` would never string-match `ownShimPath` at all — either
 * would recurse `rt intercept run` into itself forever. So every candidate
 * gets two additional, cheap checks before it's accepted: a realpath
 * comparison against the resolved shim path (catches the symlink case), and
 * a content sniff for the generated-shim marker (catches the copy case).
 *
 * `RT_INTERCEPT_REAL` overrides the whole search (test/debug escape hatch).
 */
export function resolveRealBinary(command: string, fallbackDirs: string[] = wellKnownBinDirs(process.env.HOME ?? homedir())): string | null {
  if (process.env.RT_INTERCEPT_REAL) return process.env.RT_INTERCEPT_REAL;

  let ownShimPath: string | null = null;
  try {
    ownShimPath = shimPath(command);
  } catch {
    ownShimPath = null;
  }
  let ownShimReal: string | null = null;
  if (ownShimPath) {
    try {
      ownShimReal = realpathSync(ownShimPath);
    } catch {
      ownShimReal = null; // shim not actually on disk — nothing to compare against
    }
  }

  // The app spawns rt with launchd's minimal PATH, which has no Homebrew dir,
  // so a brew-installed command behind a shim resolves only through these.
  const pathVar = process.env.PATH ?? "";
  for (const dir of [...pathVar.split(":"), ...fallbackDirs]) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (candidate === ownShimPath) continue;

    let st;
    try {
      st = statSync(candidate);
    } catch {
      continue; // not present in this PATH entry
    }
    if (!st.isFile() || (st.mode & 0o111) === 0) continue;

    if (ownShimReal) {
      try {
        if (realpathSync(candidate) === ownShimReal) continue; // symlinked back to the shim
      } catch {
        continue; // vanished between stat and realpath — treat as absent
      }
    }

    if (looksLikeGeneratedShim(candidate)) continue; // a copied (not symlinked) shim

    return candidate;
  }
  return null;
}

/**
 * Ported from @acme/dev-ports doppler.ts passthrough: inherit-stdio spawn,
 * forward SIGINT/SIGTERM/SIGHUP to the child, and mirror its exit code.
 */
async function execReal(bin: string, args: string[], env: Record<string, string>): Promise<never> {
  const child = Bun.spawn([bin, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    env,
  });

  const forward = (signal: NodeJS.Signals) => {
    try {
      child.kill(signal);
    } catch {
      // child already gone
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGHUP", () => forward("SIGHUP"));

  const code = await child.exited;
  process.exit(code);
}

// ─── rt intercept run ────────────────────────────────────────────────────────

/** Splits `<command> -- <args...>` (what the generated shim always sends). */
function parseRunArgs(args: string[]): { command: string; forwardArgs: string[] } | null {
  const command = args[0];
  if (!command) return null;
  const dashIdx = args.indexOf("--");
  const forwardArgs = dashIdx === -1 ? args.slice(1) : args.slice(dashIdx + 1);
  return { command, forwardArgs };
}

// lib/endpoint/run.ts's two RT_INTERCEPT_DEBUG traces start this way.
const DEBUG_TRACE = /^rt-intercept: (match |claim result=)/;

export const isDebugTrace = (msg: string): boolean => DEBUG_TRACE.test(msg);

/**
 * A line from the shim's core, never on stdout: this process's stdout belongs
 * to the tool it wraps. The tool must run whatever happens to the line, so a
 * stderr that is closed or broken drops it. This verb sits in front of every
 * intercepted command, so a debug trace is a log line, never a warning, and
 * reaches stderr only when the caller asked for traces.
 */
export function interceptNote(msg: string): void {
  try {
    if (isDebugTrace(msg)) {
      logCliEvent("debug", "intercept", redactCredentials(msg));
      if (process.env.RT_INTERCEPT_DEBUG === "1" || process.env.RT_LOG_LEVEL === "debug") out.note(out.verbatim([msg]));
      return;
    }
    out.note(out.line("warn", msg));
  } catch {
    // stderr is gone; the wrapped tool still runs
  }
}

export async function interceptRun(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args);
  if (!parsed) {
    out.fail(usageFailure("Which command should rt run?", "rt intercept run <command> -- [args...]"));
    process.exit(1);
  }
  const { command, forwardArgs } = parsed;

  const cwd = process.cwd();
  const pid = process.pid;
  const callerEnv = { ...process.env };

  if (callerEnv.RT_INTERCEPT_BYPASS === "1") {
    const bin = resolveRealBinary(command);
    if (!bin) throw new Error(`rt intercept: real binary for "${command}" could not be resolved`);
    await execReal(bin, forwardArgs, toStringEnv(callerEnv));
    return;
  }

  const deps: RunDeps = {
    rules: loadInterceptRules(),
    gitToplevel,
    gitRemote,
    claim: (payload) => daemonQuery("endpoint:claim", payload, 10_000),
    execReal,
    resolveRealBinary,
    warn: interceptNote,
  };

  await runInterception(deps, command, forwardArgs, cwd, callerEnv, pid);
}

// ─── rt intercept status ─────────────────────────────────────────────────────

const rulesText = (n: number): string => `${n} ${n === 1 ? "rule" : "rules"}`;

export function statusBlocks(report: ReturnType<typeof shimReport>, rulesByRepo: Record<string, number>, daemonUp: boolean, stale: { stale: boolean; reason?: string }): Block[] {
  const blocks: Block[] = [daemonUp ? out.line("running", "The rt daemon is running") : out.line("off", "The rt daemon is not running", "intercepted commands run as they are")];
  if (report.length === 0) {
    blocks.push(out.line("pending", "No commands are intercepted yet"));
    if (!stale.stale) blocks.push(out.callout("next", ["Add rules under ", out.key("rt.intercepts"), " in your settings, then run ", out.cmd("rt intercept install")]));
  }
  for (const entry of report) {
    const hint = `${entry.repo}, ${rulesText(rulesByRepo[entry.repo] ?? 0)}`;
    if (entry.installed && entry.current) blocks.push(out.line("done", entry.command, hint));
    else if (entry.installed) blocks.push(out.line("stale", entry.command, `${hint}; its shim is out of date`));
    else blocks.push(out.line("pending", entry.command, `${hint}; not installed yet`));
  }
  // The rules are a saved copy of what the settings resolve to, so a settings
  // edit can leave them behind without any shim looking wrong: it is its own
  // line, on the empty and the populated path alike.
  if (stale.stale) blocks.push(out.line("stale", "The saved rules are behind your settings", stale.reason));
  if (stale.stale || report.some((entry) => !entry.installed || !entry.current)) blocks.push(out.callout("next", out.cmd("rt intercept install")));
  return blocks;
}

export async function interceptStatus(args: string[]): Promise<void> {
  const json = args.includes("--json");

  const report = shimReport();
  const rules = loadInterceptRules();
  const rulesByRepo: Record<string, number> = {};
  for (const rule of rules) rulesByRepo[rule.repo] = (rulesByRepo[rule.repo] ?? 0) + 1;

  const daemonUp = (await daemonQuery("endpoint:status", {}, 5_000)) !== null;
  const stale = await interceptsOutOfDate();

  if (json) {
    out.json({ ok: true, shims: report, rulesByRepo, daemonUp, stale });
    return;
  }
  out.print(...statusBlocks(report, rulesByRepo, daemonUp, stale));
}

// ─── rt intercept install / uninstall ────────────────────────────────────────

export function installBlocks(result: { installed: string[]; current: string[]; skipped: string[]; rules: number }): Block[] {
  const blocks: Block[] = [];
  if (result.installed.length > 0) blocks.push(out.line("done", "Installed", result.installed.join(", ")));
  if (result.current.length > 0) blocks.push(out.line("done", "Already current", result.current.join(", ")));
  if (result.skipped.length > 0) blocks.push(out.line("refused", "rt did not make these, so rt left them alone", result.skipped.join(", ")));
  if (blocks.length === 0) blocks.push(out.line("skipped", "No commands to intercept"));
  blocks.push(out.kv("Rules", String(result.rules)));
  return blocks;
}

export function uninstallBlocks(result: { removed: string[] }): Block[] {
  return [result.removed.length > 0 ? out.line("done", "Removed", result.removed.join(", ")) : out.line("skipped", "Nothing to remove")];
}

export async function interceptInstall(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const result = await installShims();

  if (json) {
    out.json({ ok: true, ...result });
    return;
  }
  out.print(...installBlocks(result));
}

export async function interceptUninstall(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const result = uninstallShims();

  if (json) {
    out.json({ ok: true, ...result });
    return;
  }
  out.print(...uninstallBlocks(result));
}
