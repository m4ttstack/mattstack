#!/usr/bin/env bun

/**
 * rt daemon — Manage the rt background daemon.
 *
 * The daemon is an SMAppService LaunchAgent registered by the tray app. The agent
 * plist + daemon binary both live inside mattstack.app, and TCC attributes the
 * daemon's file accesses to the signed parent app via AssociatedBundleIdentifiers.
 * launchd handles supervision (KeepAlive + ThrottleInterval).
 *
 * Usage:
 *   rt daemon install     ensure tray has registered the daemon
 *   rt daemon uninstall   unregister daemon
 *   rt daemon start       register/start daemon (via tray)
 *   rt daemon stop        unregister/stop daemon
 *   rt daemon restart     kickstart daemon
 *   rt daemon status      show daemon state
 *   rt daemon logs        tail daemon log
 */

import { execSync, spawn, spawnSync } from "child_process";
import { repoLabelQualified } from "../lib/repo-label.ts";
import { basename, join } from "path";
import { reverseLookupByName } from "../lib/repo-arg.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";
import { logCliEvent } from "../lib/cli-logger.ts";

import {
  isDaemonInstalled,
  isDaemonProcessRunning,
  activeLaunchdLabel,
  markDaemonInstalled, markDaemonUninstalled, cleanupDaemonFiles,
  readDaemonPid,
  RT_DIR,
  LOG_DIR,
  LAUNCHD_PLIST_PATH,
  DAEMON_SOCK_PATH,
  TRAY_SOCK_PATH,
} from "../lib/daemon-config.ts";
import { daemonQuery, isDaemonRunning, pingDaemon, trayQuery } from "../lib/daemon-client.ts";
import { classifyDaemonStatus, type DaemonStatusVerdict } from "../lib/daemon-status.ts";
import { processFlavor, type Flavor } from "../lib/flavor.ts";
import { probeSocketHolder } from "../lib/daemon/park.ts";
import { readBreadcrumb, readSupervisionState } from "../lib/daemon/supervision-state.ts";
import { readHeartbeat } from "../lib/daemon/heartbeat-file.ts";
import { runCapture } from "../lib/subprocess.ts";
import { findBundledTool, whichWithWellKnownDirs } from "../lib/bundled-tool.ts";
import { isGitLabRemote } from "../lib/enrich.ts";
import type { CacheKind, RepoTrackingEntry } from "../lib/repo-tracking.ts";
import { loadRepoTracking, loadMachineRepoTracking, loadMachineRepoTrackingRaw, saveRepoTrackingRaw, grants, parseCachesArg, CACHE_KINDS, DEFAULT_PROJECT_MRS_WINDOW_DAYS, teamNamesIdentity } from "../lib/repo-tracking.ts";
import { deriveRepoIdentity, parseIdentity, serializeIdentity } from "../lib/settings/identity.ts";
import { loadRepoIndex } from "../lib/repo-index.ts";
import { createProjectMRs } from "../lib/daemon/project-mrs-store.ts";
import { getStateDb } from "../lib/state/index.ts";
import { timeAgo } from "../lib/tui/utils/label.ts";
import { trayAppPath, installedTrayAppPath, devTrayAppPath, TRAY_APP_NAME, TRAY_APP_BUNDLE, tmpDir } from "../lib/rt-paths.ts";

/** Where to point an "open it" hint: the bundle's real install location if we can find one, else the conventional ~/Applications destination. */
function trayAppHintPath(): string {
  return installedTrayAppPath(TRAY_APP_BUNDLE) ?? trayAppPath();
}

// ─── Flavor identity ─────────────────────────────────────────────────────────

export interface FlavorTuple {
  cliFlavor: Flavor;
  daemon: { flavor: string; pid: number | null } | null;
}


/**
 * Human events line: repo keys arrive as wire identities and MUST render as
 * labels (no-wire-in-ui.test.ts pins this seam). lastSyncedAt only advances
 * on a non-empty batch or a state transition, so a quiet-but-healthy repo
 * can go the whole session without one; "never" would misread as broken,
 * not idle.
 */
export function formatFreshnessParts(
  freshness: Record<string, { state: string; lastSyncedAt: string | null }>,
  now: number,
): string[] {
  return Object.entries(freshness).map(([repo, f]) => {
    const age = f.lastSyncedAt
      ? `${Math.round((now - Date.parse(f.lastSyncedAt)) / 1000)}s ago`
      : "no events yet";
    return `${repoLabelQualified(repo)} ${f.state} (${age})`;
  });
}

/** Bundle to point an "open it" hint at for `flavor`. */
export function flavorHintPath(flavor: Flavor): string {
  return flavor === "dev" ? devTrayAppPath() : trayAppHintPath();
}

export function flavorMismatchBlocks(
  op: "stop" | "start" | "restart",
  holder: { flavor: string; pid: number | null },
  flavor: Flavor,
): Block[] {
  const pid = holder.pid ? `pid ${holder.pid}` : undefined;
  const line = op === "stop"
    ? out.line("warn", `A ${holder.flavor} daemon is still running`, [pid, `you stopped the ${flavor} one`].filter(Boolean).join("; "))
    : out.line("warn", `A ${holder.flavor} daemon answered instead of the ${flavor} one`, pid);
  return [line, out.callout("next", out.cmd(`open ${flavorHintPath(flavor)}`)), out.callout("note", "Quit it first if it is running.")];
}

export function stillShuttingDownBlock(holder: { pid: number | null }): Block {
  return out.line("pending", "The daemon is still shutting down", holder.pid ? `pid ${holder.pid}` : undefined);
}

async function warnIfWrongFlavor(op: "start" | "restart", flavor: Flavor): Promise<boolean> {
  const holder = await probeSocketHolder();
  if (!holder || holder.flavor === flavor) return false;
  out.print(...flavorMismatchBlocks(op, holder, flavor));
  return true;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Clean up legacy launchd plist if it exists.
 * Pre-SMAppService rt versions wrote a plist to ~/Library/LaunchAgents/.
 * Removing it on install/uninstall prevents the old daemon from racing the
 * SMAppService-managed one.
 */
function cleanupLaunchdPlist(): boolean {
  if (!existsSync(LAUNCHD_PLIST_PATH)) return false;
  try { execSync(`launchctl unload "${LAUNCHD_PLIST_PATH}" 2>/dev/null`, { stdio: "pipe" }); } catch { /* */ }
  try { unlinkSync(LAUNCHD_PLIST_PATH); } catch { /* */ }
  return true;
}

// ─── Install ─────────────────────────────────────────────────────────────────

export async function install(_args: string[] = []): Promise<void> {
  const flavor = processFlavor();
  // Persist the install marker so isDaemonInstalled() returns true and the
  // CLI will attempt to reach the daemon (rather than silently no-op).
  markDaemonInstalled();
  out.print(out.line("done", "Turned the daemon on for this Mac"));

  if (cleanupLaunchdPlist()) {
    out.print(out.line("done", "Removed a launch agent an older rt left behind"));
  }

  const trayResult = await trayQuery("/daemon/start", "POST");
  if (trayResult?.ok) {
    out.print(out.line("done", `${TRAY_APP_NAME} is starting the daemon`));
  } else {
    out.print(
      out.line("needs-you", `${TRAY_APP_NAME} is not open`, "open it to finish"),
      out.callout("next", out.cmd(`open ${flavorHintPath(flavor)}`)),
    );
  }

  const connected = await withTransientStep("Waiting for the daemon to answer", async () => {
    for (let i = 0; i < 12; i++) {
      await Bun.sleep(250);
      if (await isDaemonRunning()) return true;
    }
    return false;
  });

  if (connected) {
    out.print(out.line("done", "Installed the daemon", `${TRAY_APP_NAME} keeps it running`));
  } else {
    const trayStatus = await trayQuery("/daemon/status", "GET");
    const smStatus = trayStatus?.ok ? (trayStatus as any).status : "unknown";

    out.print(out.line("warn", "The daemon is not answering yet"));

    if (smStatus === "requiresApproval") {
      out.print(
        out.line("needs-you", "macOS needs your approval to run it in the background", `System Settings is open at Login Items: allow ${TRAY_APP_NAME}`),
        out.callout("next", out.cmd("rt daemon start")),
      );
      try { execSync("open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'", { stdio: "pipe" }); } catch { /* */ }
    } else if (smStatus === "notFound") {
      out.fail({
        title: `The daemon is missing from ${TRAY_APP_NAME}`,
        why: "The app install looks incomplete.",
        next: out.cmd("rt --post-install"),
      });
    } else if (smStatus === "enabled") {
      out.fail({ title: "The daemon stops right after it starts", next: out.cmd("rt daemon logs") });
    } else {
      out.print(out.callout("next", out.cmd("rt daemon logs")));
    }
  }
}

// ─── Uninstall ───────────────────────────────────────────────────────────────

export async function uninstall(): Promise<void> {
  // 1. Ask tray to unregister the SMAppService agent (stops launchd supervision).
  const result = await trayQuery("/daemon/stop", "POST");
  if (result?.ok) {
    out.print(out.line("done", `Turned the daemon off in ${TRAY_APP_NAME}`));
    await Bun.sleep(500);
  } else {
    out.print(out.line("warn", `${TRAY_APP_NAME} is not open`, "the daemon may still be turned on"));
  }

  // 2. Remove any legacy launchd plist.
  if (cleanupLaunchdPlist()) {
    out.print(out.line("done", "Removed a launch agent an older rt left behind"));
  }

  // 3. A failed/absent tray stop must never delete rt.sock/rt.pid/daemon.json
  // out from under a daemon that's actually still alive (that would orphan
  // it, still running, launchd-supervised, but rt's own bookkeeping says
  // uninstalled). Check both liveness signals: the recorded pid, and whether
  // anything still answers on rt.sock (a daemon can be alive with no
  // matching rt.pid, e.g. after a crash-and-respawn under launchd).
  const stillAlive = isDaemonProcessRunning() || (await probeSocketHolder()) !== null;
  if (stillAlive) {
    out.note(
      out.line("refused", "Left the daemon's files alone", "it is still running"),
      out.callout("next", out.cmd(`launchctl bootout gui/$UID/${activeLaunchdLabel()}`)),
    );
    return;
  }

  // 4. Clear install flag + sock/pid files.
  markDaemonUninstalled();
  cleanupDaemonFiles();
  out.print(out.line("done", "Uninstalled the daemon"));
}

// ─── Start / Stop / Restart ──────────────────────────────────────────────────

export async function start(): Promise<void> {
  if (!isDaemonInstalled()) {
    out.print(out.line("off", "The daemon is not installed"), out.callout("next", out.cmd("rt daemon install")));
    return;
  }
  const flavor = processFlavor();
  if (await isDaemonRunning()) {
    if (!(await warnIfWrongFlavor("start", flavor))) out.print(out.line("skipped", "The daemon is already running"));
    return;
  }
  const result = await trayQuery("/daemon/start", "POST");
  if (result && !result.ok) {
    out.fail({ title: `${TRAY_APP_NAME} could not start the daemon`, next: out.cmd("rt daemon logs") });
    return;
  }
  if (!result) {
    out.print(out.line("needs-you", `${TRAY_APP_NAME} is not open`), out.callout("next", out.cmd(`open ${flavorHintPath(flavor)}`)));
    return;
  }
  const up = (await withTransientStep(`Starting the ${flavor} daemon`, pollForDaemonUp)) || (await withTransientStep("It has not answered yet; restarting it", async () => {
    const restartResult = await trayQuery("/daemon/restart", "POST");
    return Boolean(restartResult?.ok) && (await pollForDaemonUp());
  }));
  if (up) {
    if (!(await warnIfWrongFlavor("start", flavor))) out.print(out.line("done", "The daemon started"));
    return;
  }
  out.print(out.line("pending", "The daemon has not answered yet"), out.callout("next", out.cmd("rt daemon logs")));
}

async function pollForDaemonUp(): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    await Bun.sleep(250);
    if (await isDaemonRunning()) return true;
  }
  return false;
}

export async function stop(): Promise<void> {
  const flavor = processFlavor();
  const result = await trayQuery("/daemon/stop", "POST");
  if (result && !result.ok) {
    out.fail({ title: `${TRAY_APP_NAME} could not stop the daemon`, why: "It may still be turned on.", next: out.cmd("rt daemon logs") });
    return;
  }
  if (result?.ok) {
    await Bun.sleep(500);
    // The ack only proves the reached tray's own flavor was told to stop.
    const holder = await probeSocketHolder();
    if (holder) {
      if (holder.flavor === flavor) out.print(stillShuttingDownBlock(holder));
      else out.print(...flavorMismatchBlocks("stop", holder, flavor));
      return;
    }
    out.print(out.line("done", `Stopped the ${flavor} daemon`));
    return;
  }
  out.print(out.line("skipped", `${TRAY_APP_NAME} is not open, so nothing is running to stop`));
}

/** Test seam: the poll cadence for restart's pid-turnover wait. */
export const RESTART_POLL = { intervalMs: 500, attempts: 16 };

export async function restart(): Promise<void> {
  const flavor = processFlavor();
  // The pid is the only honest restart signal: the OLD daemon answers a
  // liveness poll too, so "a daemon is up" proved nothing when the tray
  // silently dropped the op (2026-09-21: three restarts reported ✓ while
  // the pid never changed). A failed baseline probe with the socket file
  // present is UNKNOWN, never "down"; the old daemon may just have missed
  // one probe, and a pid seen later then proves nothing.
  const sockPresent = existsSync(DAEMON_SOCK_PATH);
  let before = sockPresent ? await probeSocketHolder() : null;
  for (let i = 0; sockPresent && !before?.pid && i < 2; i++) {
    await Bun.sleep(RESTART_POLL.intervalMs);
    before = await probeSocketHolder();
  }
  const baselineUnknown = sockPresent && !before?.pid;
  const result = await trayQuery("/daemon/restart", "POST");
  if (result && !result.ok) {
    out.fail({ title: `${TRAY_APP_NAME} could not restart the daemon`, next: out.cmd("rt daemon logs") });
    return;
  }
  // The tray replies after the op completes, so a slow op can outlive the
  // request timeout. Its socket existing means the tray is there; the pid
  // poll below still decides the truth. Only a missing socket means gone;
  // the same TRAY_SOCK_PATH trayQuery itself gates on, so "no reply" and
  // "no tray" can never disagree about which socket they mean.
  if (!result && !existsSync(TRAY_SOCK_PATH)) {
    out.print(out.line("needs-you", `${TRAY_APP_NAME} is not open`), out.callout("next", out.cmd(`open ${flavorHintPath(flavor)}`)));
    return;
  }
  const polled = await withTransientStep(`Restarting the ${flavor} daemon`, async () => {
    for (let i = 0; i < RESTART_POLL.attempts; i++) {
      await Bun.sleep(RESTART_POLL.intervalMs);
      const now = await probeSocketHolder();
      if (!now?.pid) continue;
      if (before?.pid && now.pid === before.pid) continue;
      if (baselineUnknown) return { unverified: now.pid };
      return { now };
    }
    return null;
  });
  if (polled?.unverified) {
    out.print(out.line("warn", "A daemon is answering, but rt could not tell whether it restarted", `pid ${polled.unverified}`), out.callout("next", out.cmd("rt daemon logs")));
    return;
  }
  if (polled?.now) {
    if (!(await warnIfWrongFlavor("restart", flavor))) out.print(out.line("done", "The daemon restarted", `pid ${before?.pid ?? "down"} to ${polled.now.pid}`));
    return;
  }
  const still = await probeSocketHolder();
  if (before?.pid && still?.pid === before.pid) {
    out.fail({ title: "The daemon did not restart", why: `It still answers as pid ${still.pid}.`, next: out.cmd("rt daemon logs") });
    return;
  }
  out.print(out.line("pending", "The daemon has not answered yet"), out.callout("next", out.cmd("rt daemon logs")));
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Raw OS-level liveness, independent of rt.sock. Tries a direct pid check
 * first against every pid this HOME actually recorded: rt.pid, then the
 * boot breadcrumb's pid (the breadcrumb survives failures rt.pid never gets
 * written for, per Ruling P1), before falling back to a last-resort scan.
 *
 * That scan is `lsof +D <RT_DIR>`, not the brief's suggested system-wide
 * `pgrep -f 'rt --daemon|lib/daemon.ts'`: a raw pgrep matches ANY rt daemon
 * on the machine regardless of which HOME started it, and on an ordinary dev
 * workstation there usually IS one (the developer's own real daemon), so a
 * pgrep-based check on an isolated/alternate HOME reliably misreports a dead
 * boot attempt as alive-not-serving (verified live against this repo's own
 * dev daemon while writing the e2e test below). `lsof +D` instead asks "does
 * any process hold a file open under THIS HOME's rt dir", home-scoped by
 * construction, immune to that false positive and to pid-reuse. Only worth
 * calling once both `status` and a plain ping have already failed.
 *
 * The CALLER itself is excluded from the lsof result: `showStatus` opens its
 * own `bun:sqlite` handle on `state.db` (inside RT_DIR) via
 * `readSupervisionState()` just before this probe runs, so `lsof +D RT_DIR`
 * legitimately reports the calling CLI process as a live holder of the
 * directory, with no daemon involved at all. Left unfiltered, a genuinely
 * dead daemon self-matches and misclassifies as alive-not-serving/parked;
 * this only failed to show up in manual testing because incidental work
 * happened to separate the state.db open from the lsof call by enough time
 * for state.db's own transient lock window to close, an accident of
 * timing, not a guarantee.
 */
export async function probePidAlive(recordedPid: number | null, breadcrumbPid?: number): Promise<{ alive: boolean; pid: number | null }> {
  for (const candidate of [recordedPid, breadcrumbPid ?? null]) {
    if (candidate === null) continue;
    try {
      process.kill(candidate, 0);
      return { alive: true, pid: candidate };
    } catch { /* not this one, try the next candidate */ }
  }
  const { stdout } = await runCapture(["lsof", "-t", "+D", RT_DIR], { timeoutMs: 3000 });
  const pids = stdout.trim().split(/\s+/).filter(Boolean).map(Number)
    .filter((n) => !isNaN(n) && n !== process.pid);
  return pids.length > 0 ? { alive: true, pid: pids[0]! } : { alive: false, pid: recordedPid };
}

export async function showStatus(args: string[] = []): Promise<void> {
  const json = args.includes("--json");

  if (!isDaemonInstalled()) {
    if (json) return void out.json({ ok: true, state: "not-installed" });
    out.print(...statusBlocks({ state: "not-installed" }, Date.now()).print);
    return;
  }

  const response = await daemonQuery("status");
  // A failed status query does NOT mean the daemon is down — it answers `ping`
  // in a fraction of the budget a loaded `status` needs. Establish liveness
  // before reporting, and only pay for the probe when nothing came back.
  // pingDaemon (not isDaemonRunning) so the raw reply's eventLoop summary is
  // still on hand to render, and so this probe never risks a restart.
  const pingResp = classifyDaemonStatus.needsLivenessProbe(response) ? await pingDaemon() : null;
  const pingOk = pingResp?.ok === true;
  const recordedPid = readDaemonPid() ?? null;

  // Ping ALSO failed: the only remaining ground is the pid/breadcrumb/kv/heartbeat
  // trail Task 9/2 left behind. Read it here, once, rather than on every status
  // call, since it's the uncommon path.
  let pidAlive: boolean | undefined;
  let pid = recordedPid;
  let breadcrumb: ReturnType<typeof readBreadcrumb> | undefined;
  let supervision: ReturnType<typeof readSupervisionState> | undefined;
  let heartbeat: ReturnType<typeof readHeartbeat> | undefined;
  if (classifyDaemonStatus.needsPidProbe(response, pingOk)) {
    breadcrumb = readBreadcrumb();
    // The kv tier can be legitimately empty (or reflect nothing useful) when
    // a failure happened before state.db ever opened (Ruling P1). The
    // breadcrumb read above is what classifyDaemonStatus falls back to then.
    supervision = readSupervisionState();
    heartbeat = readHeartbeat(RT_DIR);
    const probed = await probePidAlive(recordedPid, breadcrumb?.pid);
    pidAlive = probed.alive;
    pid = probed.pid;
  }

  const verdict = classifyDaemonStatus({
    installed: true,
    response,
    pingOk,
    pid,
    pidAlive,
    cliFlavor: processFlavor(),
    breadcrumb,
    supervision,
    heartbeat,
    pingEventLoop: (pingResp as any)?.eventLoop,
  });

  if (json) return void out.json({ ok: true, ...verdict });

  const shown = statusBlocks(verdict, Date.now());
  const extra: Block[] = [];
  if (verdict.state === "running") {
    const identity = verdict.data.identity as { flavor: "dev" | "prod"; version: string; sourceRev: string | null } | undefined;
    if (identity) extra.push(...flavorInfoBlocks({ flavor: identity.flavor, version: identity.version, sourceRev: identity.sourceRev, pid: verdict.data.pid ?? null }, processFlavor()));
    const worktreePool = verdict.data.worktreePool as { dormant: boolean; message?: string } | undefined;
    if (worktreePool?.dormant && worktreePool.message) extra.push(out.callout("note", worktreePool.message));
  } else if (verdict.state === "degraded") {
    extra.push(...flavorInfoBlocks(await probeSocketHolder(), processFlavor()));
  }
  if (shown.print.length + extra.length > 0) out.print(...shown.print, ...extra);
  if (shown.failure) out.fail(shown.failure);
}

export function tupleWarningBlocks(t: FlavorTuple): Block[] {
  if (!t.daemon || t.daemon.flavor === t.cliFlavor) return [];
  return [
    out.line("warn", `A ${t.daemon.flavor} daemon is answering this ${t.cliFlavor} rt`, t.daemon.pid ? `pid ${t.daemon.pid}` : undefined),
    out.callout("next", out.cmd(`open ${flavorHintPath(t.cliFlavor)}`)),
    out.callout("note", "Quit it first if it is running."),
  ];
}

export function flavorInfoBlocks(daemon: { flavor: string; pid: number | null; version?: string; sourceRev?: string | null } | null, cliFlavor: Flavor): Block[] {
  if (!daemon) return [];
  const rev = daemon.flavor === "dev" && daemon.sourceRev ? `, ${daemon.sourceRev}` : "";
  const version = daemon.version ? `, ${daemon.version}${rev}` : "";
  return [out.kv("version", `${daemon.flavor}${version}`), ...tupleWarningBlocks({ cliFlavor, daemon: { flavor: daemon.flavor, pid: daemon.pid } })];
}

const NOT_SERVING: Record<"booting" | "wedged" | "quarantined", string> = {
  booting: "It is still starting up.",
  wedged: "It started, then stopped answering; it may be stuck.",
  quarantined: "It reset a damaged database and has not answered since.",
};

export function statusBlocks(verdict: DaemonStatusVerdict, now: number): { print: Block[]; failure?: out.FailureInput } {
  switch (verdict.state) {
    case "running": {
      const { pid, uptime, watchedRepos, cacheEntries } = verdict.data;
      const blocks: Block[] = [
        out.line("running", "The daemon is running", `pid ${pid}, up ${formatUptime(uptime)}`),
        out.kv("watching", `${watchedRepos} repo${watchedRepos !== 1 ? "s" : ""}`),
        out.kv("cache", `${cacheEntries} entries`),
      ];
      const freshness = verdict.data.freshness as Record<string, { state: string; lastSyncedAt: string | null }> | undefined;
      if (freshness && Object.keys(freshness).length > 0) blocks.push(out.kv("events", formatFreshnessParts(freshness, now).join(" · ")));
      const el = verdict.data.eventLoop as { maxLagMs: number } | undefined;
      if (el && el.maxLagMs >= 500) blocks.push(out.kv("event loop", `slowest pause ${el.maxLagMs} ms`));
      const health = verdict.data.health as { level: string; reasons: string[] } | undefined;
      if (health && health.level !== "ok") {
        blocks.push(out.line("warn", `The daemon reports it is ${health.level}`));
        if (health.reasons.length > 0) blocks.push(out.verbatim(health.reasons, "why"));
      }
      return { print: blocks };
    }
    case "degraded": {
      const why =
        verdict.reason === "error"
          ? `Its status command failed: ${verdict.detail ?? "unknown error"}`
          : verdict.eventLoop && verdict.eventLoop.maxLagMs > 0
            ? `It answered a ping, but status timed out; its slowest pause was ${verdict.eventLoop.maxLagMs} ms${verdict.eventLoop.lastStallCmd ? `, in ${verdict.eventLoop.lastStallCmd}` : ""}.`
            : "It answered a ping, but status timed out, probably while it syncs.";
      return {
        print: [
          out.line("warn", "The daemon is running but did not report its status", verdict.pid ? `pid ${verdict.pid}` : undefined),
          out.callout("why", why),
          out.callout("next", out.cmd("rt daemon logs")),
        ],
      };
    }
    case "parked":
      return {
        print: [
          out.line("off", "This daemon is waiting", verdict.holderFlavor ? `the ${verdict.holderFlavor} daemon is running instead` : "another daemon is running instead"),
          out.callout("next", out.cmd("rt daemon logs")),
        ],
      };
    case "alive-not-serving": {
      const why = verdict.detail === "stalled" ? `It has not checked in for ${Math.round((verdict.stalledForMs ?? 0) / 1000)} seconds.` : NOT_SERVING[verdict.detail];
      return { print: [out.line("warn", "The daemon is running but not answering", `pid ${verdict.pid}`), out.callout("why", why), out.callout("next", out.cmd("rt daemon logs -t"))] };
    }
    case "crash-looping":
      return { print: [], failure: { title: "The daemon keeps crashing", hint: `${verdict.failures} failures recently`, why: verdict.reason, next: out.cmd("rt daemon logs -t") } };
    case "boot-failed":
      return { print: [], failure: { title: "The daemon failed to start", hint: `while ${verdict.phase}`, why: verdict.reason, next: out.cmd("rt daemon start") } };
    case "not-running":
      return { print: [out.line("off", "The daemon is installed but not running", verdict.pid ? `last pid ${verdict.pid}` : undefined), out.callout("next", out.cmd("rt daemon start"))] };
    case "not-installed":
      return { print: [out.line("off", "The daemon is not installed"), out.callout("next", out.cmd("rt daemon install"))] };
  }
}

// ─── Per-repo tracking (opt-in) ──────────────────────────────────────────────

/** "45d" for an explicit value, "(default 30)" when the entry leaves it unset. */
function formatWindowLabel(rawWindowDays: number | undefined): string {
  return rawWindowDays !== undefined ? `${rawWindowDays}d` : `(default ${DEFAULT_PROJECT_MRS_WINDOW_DAYS})`;
}

function readRepoIndex(): Record<string, string> {
  return loadRepoIndex();
}

/** A raw serialized identity → its display label (last path segment / basename). */
function trackingLabel(serialized: string): string {
  const id = parseIdentity(serialized);
  if (!id) return serialized;
  return id.kind === "remote" ? (id.id.split("/").pop() ?? id.id) : basename(id.id);
}

export function trackListBlocks(repos: Record<string, string>, tracking: Record<string, RepoTrackingEntry>, freshness: Record<string, { state: string }>): Block[] {
  const rows: out.CellInput[][] = [];
  for (const identity of Object.keys(repos).sort()) {
    const g = grants(tracking, identity);
    const label = trackingLabel(identity);
    if (g.mode === "off") {
      rows.push([{ text: "off", role: "off" }, out.dim(label), ""]);
      continue;
    }
    const watcher = g.mode === "live" ? [freshness[identity] ? `watcher ${freshness[identity]!.state}` : "watcher starting"] : [];
    const detail = [...watcher, `caches ${[...g.caches].join(", ")}`, `window ${formatWindowLabel(tracking[identity]?.projectMrsWindowDays)}`].join(" · ");
    rows.push([{ text: g.mode === "live" ? "live" : "every 5 minutes", role: "running" }, out.strong(label), out.dim(detail)]);
  }
  const blocks: Block[] = [out.section("Repo tracking", "what rt watches in the background", out.table(rows))];
  for (const identity of Object.keys(tracking).filter((n) => !repos[n])) {
    blocks.push(out.line("warn", `${trackingLabel(identity)} is tracked, but rt does not know where it is`), out.callout("next", out.cmd("rt repos register <path>")));
  }
  blocks.push(out.callout("next", out.cmd("rt daemon track <repo> live|poll|off")));
  return blocks;
}

/**
 * Resolve the operator's `rt daemon track <arg>` argument — an already-serialized
 * identity, a directory path, or a bare repo name — to the serialized identity
 * every store keys on, plus the checkout path when one is known. Null when a
 * name matches no registered repo (or is ambiguous); `path` is null only when
 * an identity was typed for a repo absent from the index.
 */
async function resolveTrackingIdentity(arg: string): Promise<{ identity: string; path: string | null } | null> {
  const index = readRepoIndex();
  if (parseIdentity(arg)) return { identity: arg, path: index[arg] ?? null };
  try {
    if (statSync(arg).isDirectory()) {
      return { identity: serializeIdentity(await deriveRepoIdentity(arg)), path: arg };
    }
  } catch { /* not a directory on disk — fall through to the name reverse-lookup */ }
  const matches = reverseLookupByName(arg, index);
  if (matches.length === 1) return { identity: matches[0]![0], path: matches[0]![1] };
  return null;
}

/**
 * Manage per-repo background tracking.
 *
 *   rt daemon track                      list repos with level + watcher state
 *   rt daemon track <repo> live|poll     events watcher + 5-min enrichment (branches by default)
 *   rt daemon track <repo> off           no background API calls (default)
 *   rt daemon track <repo> live|poll <caches>  opt-in to specific caches (branches,project-mrs,discussions)
 *
 * "off" removes the entry (off is the default for unlisted repos) — UNLESS
 * the team layer (`mattstack.tracking`) still names this repo, in which case
 * a bare delete would let team intent resurrect it on the next merged read;
 * "off" then plants an explicit `{mode:"off"}` marker instead, a real local
 * opt-out (see lib/repo-tracking.ts's module doc). Level changes apply
 * immediately for watchers; the 5-min poll picks up poll/off changes on its
 * next cycle, so `live`/`poll` also kick a refresh.
 */
export async function manageTracking(args: string[] = []): Promise<void> {
  const [repoArg, levelArg] = args;

  if (!repoArg) {
    const repos = readRepoIndex();
    const tracking = loadRepoTracking();
    const status = await daemonQuery("status");
    const freshness = ((status?.ok ? status.data?.freshness : undefined) ?? {}) as
      Record<string, { state: string }>;

    out.print(...trackListBlocks(repos, tracking, freshness));
    return;
  }

  // Every store keys on the serialized identity now; resolve the operator's
  // argument (name, path, or identity) to it once. Human-facing messages keep
  // showing what they typed (`repoArg`).
  const resolved = await resolveTrackingIdentity(repoArg);

  // ── rt daemon track <repo> — interactive editor (house style: picker flow) ──
  let interactiveLevel: string | undefined;
  let interactiveCaches: CacheKind[] | undefined;
  let interactiveWindowDays: number | null | undefined; // undefined = untouched, null = clear
  if (!levelArg) {
    if (!resolved) {
      out.fail({ title: `rt does not know a repo called ${repoArg}`, next: out.cmd("rt repos register <path>") });
      return;
    }
    const identity = resolved.identity;
    const { filterableSelect, filterableMultiselect } = await import("../lib/pick-wrappers.ts");
    const { textInput } = await import("../lib/rt-render.ts");
    const displayTracking = loadRepoTracking();
    const rawEntry = displayTracking[identity];
    const current = grants(displayTracking, identity);
    const modeHint = (m: string) => (current.mode === m ? "current" : undefined);

    // Read demands from the CLI-flavor database; only the daemon writes them.
    const demands = createProjectMRs(getStateDb()).read(identity)?.demands;
    const editorBlocks: Block[] = [];
    if (demands && Object.keys(demands).length > 0) {
      editorBlocks.push(out.line("skipped", "Read only: rt records these, you do not set them"));
      for (const [client, d] of Object.entries(demands)) {
        editorBlocks.push(out.kv(client, `${d.authors.length} author${d.authors.length === 1 ? "" : "s"}: ${d.authors.join(", ")}, last seen ${timeAgo(d.lastSeenAt)}`));
      }
    }
    out.print(out.section(repoArg, `window ${formatWindowLabel(rawEntry?.projectMrsWindowDays)}`, ...(editorBlocks.length ? [out.section("demands", undefined, ...editorBlocks)] : [])));

    const picked = await filterableSelect({
      message: `${repoArg} tracking mode`,
      options: [
        { value: "live", label: "live", hint: [modeHint("live"), "events watcher (~15s) + 5-min cycle · GitLab only"].filter(Boolean).join(" · ") },
        { value: "poll", label: "poll", hint: [modeHint("poll"), "5-min cycle only"].filter(Boolean).join(" · ") },
        { value: "off",  label: "off",  hint: [modeHint("off"), "no background API calls (on-demand still works)"].filter(Boolean).join(" · ") },
      ],
    });
    if (!picked) return; // esc = no changes
    interactiveLevel = picked;
    if (picked !== "off") {
      const selected = await filterableMultiselect({
        message: `${repoArg} caches: space to toggle, enter to confirm`,
        options: [
          { value: "branches",    label: "branches",    hint: "my branches: MR + Linear enrichment" },
          { value: "project-mrs", label: "project-mrs", hint: "team-wide open-MR list (boards)" },
          { value: "discussions", label: "discussions", hint: "background thread freshness + comment notifications" },
        ],
        initialValues: current.mode === "off" ? ["branches"] : [...current.caches],
      });
      if (selected === null) return; // esc = no changes
      if (selected.length === 0) {
        out.fail({ title: "Pick at least one cache", why: "To stop tracking, choose off." });
        return;
      }
      interactiveCaches = selected as CacheKind[];

      // Positive integer or empty (clears back to default); re-prompt on
      // anything else rather than silently keeping a bad value.
      while (true) {
        const raw = await textInput({
          message: `project-mrs window in days (empty clears to default ${DEFAULT_PROJECT_MRS_WINDOW_DAYS})`,
          defaultValue: rawEntry?.projectMrsWindowDays !== undefined ? String(rawEntry.projectMrsWindowDays) : "",
        });
        const trimmed = raw.trim();
        if (trimmed === "") { interactiveWindowDays = null; break; }
        const n = Number(trimmed);
        if (Number.isInteger(n) && n > 0) { interactiveWindowDays = n; break; }
        out.print(out.line("warn", "Enter a whole number of days, or leave it empty for the default"));
      }
    }
  }

  const level = interactiveLevel ?? levelArg;
  if (!level || !["live", "poll", "off"].includes(level)) {
    out.fail(usageFailure("Which tracking mode?", "rt daemon track [<repo>] [live|poll|off [caches...]]", "Name a repo alone to choose in a menu."));
    return;
  }
  const levelArg2 = level;

  // Explicit caches: everything after the level, space-separated words
  // (commas tolerated for muscle memory).
  const cachesArg = interactiveCaches ? undefined : (args.length > 2 ? args.slice(2).join(",") : undefined);
  let caches: CacheKind[] = interactiveCaches ?? ["branches"];
  if (!interactiveCaches && levelArg2 !== "off" && cachesArg !== undefined) {
    const parsed = parseCachesArg(cachesArg);
    if (!parsed) {
      out.fail({ title: `"${args.slice(2).join(" ")}" has a cache rt does not know`, why: `The caches are ${CACHE_KINDS[0]}, ${CACHE_KINDS[1]} and ${CACHE_KINDS[2]}.` });
      return;
    }
    caches = parsed;
  }

  if (levelArg2 !== "off") {
    const repoPath = resolved?.path ?? null;
    if (!repoPath) {
      out.fail({ title: `rt does not know a repo called ${repoArg}`, next: out.cmd("rt repos register <path>") });
      return;
    }
    if (levelArg2 === "live") {
      // Watchers only ever start for GitLab remotes; refuse rather than
      // write a tracking entry that can never take effect.
      let remoteUrl = "";
      try {
        remoteUrl = execSync("git config --get remote.origin.url", {
          cwd: repoPath, encoding: "utf8", stdio: "pipe",
        }).trim();
      } catch { /* no origin remote */ }
      if (!isGitLabRemote(remoteUrl)) {
        out.note(out.line("refused", `rt cannot watch ${repoArg} live`, "live watching needs a GitLab remote"), out.callout("next", out.cmd(`rt daemon track ${repoArg} poll`)));
        return;
      }
    }
  }

  // `previousEntry` only ever feeds the window/caches-reset bookkeeping below,
  // which only cares about valid live/poll entries, so the NORMALIZED view is
  // fine for it. The WRITE itself must start from the RAW map instead:
  // loadMachineRepoTracking() drops any entry normalizeEntry rejects — a
  // typo'd mode, or another repo's explicit {mode:"off"} opt-out marker — so
  // rebuilding the whole store from it would silently erase that marker the
  // moment ANY repo's tracking is next written (the bug the rider fixes). A
  // merged (loadRepoTracking) read must never be the base either — that would
  // bake every other repo's team-synthesized entry into the machine store as
  // if a human had granted it.
  const tracking = loadMachineRepoTracking();
  const rawTracking = loadMachineRepoTrackingRaw();
  // Falls back to the literal argument only when a stale-entry `off` names a
  // repo no longer in the index (nothing to derive an identity from); every
  // resolvable path keys by the serialized identity.
  const writeKey = resolved?.identity ?? repoArg;
  const previousEntry = levelArg2 !== "off" ? tracking[writeKey] : undefined;
  let offMarker = false;
  let newEntry: RepoTrackingEntry | undefined;
  if (levelArg2 === "off") {
    delete rawTracking[writeKey];
    // A repo the team layer still declares intent for needs a raw-named
    // block, not a bare delete — otherwise the merge in loadRepoTracking
    // resurrects team intent for it on the very next read.
    if (resolved && teamNamesIdentity(resolved.identity)) {
      rawTracking[resolved.identity] = { mode: "off" };
      offMarker = true;
    }
  } else {
    // Only the interactive editor ever touches the window; the positional
    // CLI form (rt daemon track <repo> live [caches]) carries whatever the
    // entry it's replacing already had.
    const windowDays = interactiveWindowDays !== undefined
      ? (interactiveWindowDays ?? undefined)
      : previousEntry?.projectMrsWindowDays;
    newEntry = {
      mode: levelArg2 as "live" | "poll",
      caches,
      ...(windowDays !== undefined ? { projectMrsWindowDays: windowDays } : {}),
    };
    rawTracking[writeKey] = newEntry;
  }
  saveRepoTrackingRaw(rawTracking);
  out.print(levelArg2 === "off" ? out.line("done", `Stopped tracking ${repoArg}`) : out.line("done", `Tracking ${repoArg}: ${levelArg2 === "poll" ? "every 5 minutes" : "live"}`, `caches ${caches.join(", ")}, window ${formatWindowLabel(newEntry?.projectMrsWindowDays)}`));
  if (offMarker) {
    out.print(out.callout("note", "Your team still tracks it, so this is saved as your own opt-out."), out.callout("next", out.cmd(`rt daemon track ${repoArg} live`)));
  }
  // A write that omits the caches arg always resets to ["branches"] (see
  // default above). If the entry it replaced granted more than that, the
  // caller silently lost project-mrs/discussions grants — flag it.
  if (
    levelArg2 !== "off" &&
    interactiveCaches === undefined &&
    cachesArg === undefined &&
    previousEntry &&
    previousEntry.caches.some((c) => c !== "branches")
  ) {
    out.print(out.callout("note", `Its caches went back to branches only; they were ${previousEntry.caches.join(", ")}.`), out.callout("next", out.cmd(`rt daemon track ${repoArg} ${levelArg2} ${previousEntry.caches.join(" ")}`)));
  }

  // Watchers apply immediately; a fresh enrichment pass makes poll/live
  // repos show data now instead of at the next 5-minute cycle.
  const res = await daemonQuery("freshness:reconcile", undefined, 30_000);
  if (res?.ok) {
    const watching = Object.keys((res.data ?? {}) as Record<string, unknown>).map(trackingLabel).sort();
    out.print(out.kv("live watchers", watching.length > 0 ? watching.join(", ") : "none"));
    if (levelArg2 !== "off") await daemonQuery("cache:refresh");
  } else {
    out.print(out.line("pending", "The daemon did not apply this tracking change", "this applies when it next starts or refreshes"));
  }
}

// ─── Logs ────────────────────────────────────────────────────────────────────

/**
 * Decides whether showLogs' native-stderr block is worth printing, and its
 * header. `daemon-stderr.log` is rotated on open (daemon-logger.ts) but the
 * fresh file can still be non-empty from a crash that happened before *this*
 * boot's rotation ran (e.g. a bun panic mid-startup), so staleness is judged
 * by mtime vs. the live daemon's startedAt, not by rotation alone. A `null`
 * startedAt (daemon unreachable, nothing to compare against) fails open:
 * show it, since a down daemon is exactly when the last crash matters most.
 */
export function nativeStderrDisplay(
  mtimeMs: number,
  daemonStartedAt: number | null,
): { show: boolean; header: string } {
  if (daemonStartedAt !== null && mtimeMs <= daemonStartedAt) {
    return { show: false, header: "no crash since this daemon started" };
  }
  return { show: true, header: `native stderr (captured ${new Date(mtimeMs).toISOString()})` };
}

/**
 * Show daemon logs.
 *
 *   rt daemon logs              → open browser-based viewer (logdy)
 *   rt daemon logs --terminal   → live tail piped through pino-pretty
 *   rt daemon logs -t           → same as --terminal
 *   rt daemon logs --no-open    → start the viewer, leave opening it to the caller
 */
export async function showLogs(args: string[] = []): Promise<void> {
  const terminal = args.includes("--terminal") || args.includes("-t");

  if (!existsSync(LOG_DIR)) {
    out.print(out.line("skipped", "No daemon logs yet"), out.callout("next", out.cmd("rt daemon start")));
    return;
  }

  // Surface captured native stderr first — these are bun panics/asserts that
  // bypassed the JS-side interceptor and were caught by the swift-shim's
  // freopen of fd 2. Only shown when it postdates the running daemon's boot,
  // otherwise it's a previous life's crash, not "the most recent crash".
  const stderrPath = join(LOG_DIR, "daemon-stderr.log");
  if (existsSync(stderrPath)) {
    const content = readFileSync(stderrPath, "utf8").trim();
    if (content) {
      const mtimeMs = statSync(stderrPath).mtimeMs;
      const ping = await daemonQuery("ping");
      const daemonStartedAt =
        ping && (ping as any).ok && typeof (ping as any).startedAt === "number"
          ? ((ping as any).startedAt as number)
          : null;
      const { show } = nativeStderrDisplay(mtimeMs, daemonStartedAt);
      if (show) {
        out.print(out.line("warn", daemonStartedAt === null ? "The daemon has captured native output" : "The daemon crashed since it last started", `captured ${new Date(mtimeMs).toLocaleString()}`), out.verbatim(content.split("\n").slice(-20), "what it printed"));
      } else {
        out.print(out.line("skipped", "No crash since this daemon started"));
      }
    }
  }

  // Convention: every surface appends to ~/.mattstack/rt/logs/<surface>.YYYY-MM-DD[.N].log
  // (daemon via pino-roll, cli via lib/cli-logger.ts, tray via TrayLog, ...).
  // Follow the newest file per surface — new surfaces show up in the viewer
  // automatically, nothing to register.
  const SURFACE_LOG_RE = /^([a-z][a-z-]*)\.\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/;
  const newestPerSurface = new Map<string, { f: string; mtime: number }>();
  for (const f of readdirSync(LOG_DIR)) {
    const surface = SURFACE_LOG_RE.exec(f)?.[1];
    if (!surface) continue;
    const mtime = statSync(join(LOG_DIR, f)).mtimeMs;
    const prev = newestPerSurface.get(surface);
    if (!prev || mtime > prev.mtime) newestPerSurface.set(surface, { f, mtime });
  }
  if (newestPerSurface.size === 0) {
    out.print(out.line("skipped", "No daemon logs yet"), out.callout("next", out.cmd("rt daemon start")));
    return;
  }
  const logPaths = [...newestPerSurface.values()]
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ f }) => join(LOG_DIR, f));

  if (terminal) {
    await runTerminalViewer(logPaths);
  } else {
    await runWebViewer(logPaths, { open: !args.includes("--no-open") });
  }
}

/**
 * Open the log in `lnav` (interactive TUI with auto-detected pino support,
 * level coloring, filtering, search, jump-to-error). Stays attached until
 * the user quits lnav with `q`.
 *
 * lnav is the best off-the-shelf TUI for structured logs in 2025:
 *   /text   — search
 *   f       — filter by regex
 *   e / E   — jump to next/prev error-level entry
 *   :filter-in WRN  — only show warnings
 *   q       — quit
 *
 * Falls back to `bunx pino-pretty` if lnav isn't installed.
 */
async function runTerminalViewer(logPaths: string[]): Promise<void> {
  const hasLnav = spawnSync("which", ["lnav"]).status === 0;

  let viewer: ReturnType<typeof spawn>;
  if (hasLnav) {
    // lnav is a full TUI — inherit stdin so keystrokes reach it.
    viewer = spawn("lnav", logPaths, {
      stdio: "inherit",
    });
  } else {
    out.print(out.line("running", "Following the daemon's logs", "Ctrl-C to stop"), out.callout("tip", ["For a richer view, install lnav: ", out.cmd("brew install lnav")]));
    // sh -c pipeline avoids Bun's stream-as-stdio limitation between two spawns.
    const quoted = logPaths.map(p => JSON.stringify(p)).join(" ");
    viewer = spawn("sh", ["-c", `tail -F ${quoted} | bunx pino-pretty`], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  }

  const stop = (code: number) => {
    try { viewer.kill("SIGTERM"); } catch { /* */ }
    process.exit(code);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  viewer.on("exit", (code) => stop(code ?? 0));
}

/**
 * logdy UI config that breaks pino JSON lines into proper columns instead
 * of dumping the raw line into one cell. Written to ~/.mattstack/rt/ on first invocation.
 *
 * Schema (verified against logdy v0.17):
 *   - top-level: `name`, `settings`, `columns`
 *   - settings: { maxMessages, entriesOrder, leftColWidth, drawerColWidth,
 *                 middlewares: [...] }
 *   - columns:  { id, name, idx, width, hidden?, faceted?, handlerTsCode? }
 *   - handlerTsCode is TS source: `(line: Message) => CellHandler`
 *
 * logdy parses each JSON line automatically; handlers access fields via the
 * parsed object (different versions expose it as `line.json` or
 * `line.json_content` — we use a defensive helper).
 */
// IMPORTANT: logdy wraps each handler as `let fn = ${ts.transpile(code)}`.
// TypeScript's transpiler can emit prelude statements (e.g. `var _a, _b;` for
// nullish-coalescing helpers in ES5 mode), which would break the wrap with a
// syntax error and silently empty the columns array. To stay safe we use
// plain ES5-style code in every handler: function expressions, `||` instead
// of `??`, manual object iteration instead of destructure-rest, no template
// literals.

const PINO_PARSE_MIDDLEWARE =
  'function(line){try{line.json_content=JSON.parse(line.content);}catch(e){}return line;}';

const HANDLER_TIME = [
  'function(line){',
  '  var j=line.json_content||line.json||{};',
  '  if(!j.time) return {text:""};',
  '  var d=new Date(j.time);',
  '  function p(n,w){var s=String(n);while(s.length<(w||2)) s="0"+s; return s;}',
  '  return {text:p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds())+"."+p(d.getMilliseconds(),3)};',
  '}',
].join("");

// CLI command-log lines (cli.YYYY-MM-DD.log) carry {command, outcome} instead
// of pino's {level, module, msg} — each handler falls back so both file
// shapes render in the same columns.
const HANDLER_LEVEL = 'function(line){var j=line.json_content||line.json||{};return {text:j.level||j.outcome||""};}';
const HANDLER_MODULE = 'function(line){var j=line.json_content||line.json||{};return {text:j.module||(j.command!==undefined?"cli":"")};}';
const HANDLER_MSG = 'function(line){var j=line.json_content||line.json||{};return {text:j.msg||(j.command!==undefined?"rt "+j.command:line.content)};}';

const HANDLER_FIELDS = [
  'function(line){',
  '  var j=line.json_content||line.json||{};',
  '  var skip={level:1,time:1,pid:1,hostname:1,module:1,msg:1,command:1,outcome:1};',
  '  var rest={}, has=false;',
  '  for(var k in j){ if(!skip[k]){ rest[k]=j[k]; has=true; } }',
  '  if(!has) return {text:""};',
  '  return {text:JSON.stringify(rest),isJson:true};',
  '}',
].join("");

const LOGDY_PINO_COLUMNS_JSON = JSON.stringify(
  {
    name: "rt-daemon pino",
    settings: {
      maxMessages: 10000,
      entriesOrder: "desc",
      leftColWidth: 200,
      drawerColWidth: 480,
      middlewares: [
        { id: "pino-parse", name: "Parse pino JSON", handlerTsCode: PINO_PARSE_MIDDLEWARE },
      ],
    },
    columns: [
      { id: "time",   name: "time",   idx: 0, width: 110, handlerTsCode: HANDLER_TIME },
      { id: "level",  name: "level",  idx: 1, width:  70, faceted: true, handlerTsCode: HANDLER_LEVEL },
      { id: "module", name: "module", idx: 2, width: 140, faceted: true, handlerTsCode: HANDLER_MODULE },
      { id: "msg",    name: "msg",    idx: 3, width: 520, handlerTsCode: HANDLER_MSG },
      { id: "fields", name: "fields", idx: 4, width: 320, handlerTsCode: HANDLER_FIELDS },
    ],
  },
  null,
  2,
);

/**
 * Materialize the logdy column config under rt/tmp (rewriting only if it
 * changed, so edits to LOGDY_PINO_COLUMNS_JSON above propagate without
 * manual cache busting) and clear out any pre-RT-33-collapse copy left at
 * the rt/ top level. Returns the path logdy's `--config` flag should get.
 */
export function materializeLogdyConfig(): string {
  mkdirSync(tmpDir(), { recursive: true });
  const configPath = join(tmpDir(), "logdy-pino-columns.json");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (existing !== LOGDY_PINO_COLUMNS_JSON) {
    writeFileSync(configPath, LOGDY_PINO_COLUMNS_JSON);
  }

  const legacyPath = join(RT_DIR, "logdy-pino-columns.json");
  try {
    if (existsSync(legacyPath)) unlinkSync(legacyPath);
  } catch { /* best-effort */ }

  return configPath;
}

export interface WebViewerSeams {
  findLogdy(): string | null;
  materializeConfig(): string;
  spawnLogdy(bin: string, args: string[]): { kill(): void; onExit(cb: (code: number | null) => void): void };
  waitForPort(port: number, timeoutMs: number): Promise<boolean>;
  openUrl(url: string): void;
  onSignal(signal: "SIGINT" | "SIGTERM", cb: () => void): void;
  exit(code: number): never;
  print(...blocks: Block[]): void;
  fail(f: out.FailureInput): void;
}

const REAL_WEB_VIEWER_SEAMS: WebViewerSeams = {
  findLogdy: () => findBundledTool("logdy", whichWithWellKnownDirs()),
  materializeConfig: materializeLogdyConfig,
  spawnLogdy: (bin, args) => {
    const child = spawn(bin, args, { stdio: ["ignore", "inherit", "inherit"] });
    return {
      kill: () => { try { child.kill("SIGTERM"); } catch { /* already gone */ } },
      onExit: (cb) => { child.on("exit", cb); },
    };
  },
  waitForPort,
  openUrl: (url) => { spawnSync("open", [url]); },
  onSignal: (signal, cb) => { process.on(signal, cb); },
  exit: (code) => process.exit(code),
  print: (...blocks) => out.print(...blocks),
  fail: (f) => out.fail(f),
};

const LOGDY_PORT = 5544;
const LOGDY_ANSWER_TIMEOUT_MS = 5000;

/**
 * Spawn logdy follow and, unless `open` is false, open the browser on it.
 * Stays attached so the user can Ctrl-C. Every path that leaves no viewer
 * running exits nonzero with a one-line reason as the first stderr line:
 * the tray shows that line instead of opening a dead page.
 */
export async function runWebViewer(
  logPaths: string[],
  opts: { open: boolean },
  seams: WebViewerSeams = REAL_WEB_VIEWER_SEAMS,
): Promise<void> {
  const bin = seams.findLogdy();
  if (!bin) {
    seams.fail({ title: "rt could not find logdy", why: "It ships with the app, and it was not there or on your PATH.", next: [out.cmd("brew install logdy"), ", or ", out.cmd("rt daemon logs --terminal")] });
    return seams.exit(1);
  }

  const configPath = seams.materializeConfig();

  const url = `http://localhost:${LOGDY_PORT}`;
  seams.print(out.line("running", "Starting the log viewer", url));
  logCliEvent("debug", "daemon", "logdy follows", { paths: logPaths });

  const logdy = seams.spawnLogdy(bin, [
    "follow", ...logPaths,
    "--port", String(LOGDY_PORT),
    "--ui-pass", "",
    "--no-analytics",
    "--config", configPath,
    // --full-read backfills existing file content; without it logdy only
    // tails lines added after launch. Capped by settings.maxMessages.
    "--full-read",
  ]);

  const stop = (code: number) => {
    logdy.kill();
    return seams.exit(code);
  };
  seams.onSignal("SIGINT", () => stop(0));
  seams.onSignal("SIGTERM", () => stop(0));
  // Attach before awaiting anything: if logdy exits instantly (e.g. the port
  // is already bound by another process), a listener attached after
  // waitForPort would miss the event and we'd hang pointing the browser at
  // whatever service answered on the port.
  let answered = false;
  logdy.onExit((code) => {
    if (!answered) seams.fail({ title: "The log viewer stopped before it opened", why: `logdy exited ${code ?? "on a signal"}.` });
    return stop(code ?? 0);
  });

  answered = await seams.waitForPort(LOGDY_PORT, LOGDY_ANSWER_TIMEOUT_MS);
  if (!answered) {
    seams.fail({ title: "The log viewer did not start in time", why: `Nothing answered on port ${LOGDY_PORT} within ${LOGDY_ANSWER_TIMEOUT_MS / 1000} seconds.` });
    return stop(1);
  }
  if (opts.open) seams.openUrl(url);

  seams.print(out.line("running", "The log viewer is open", `${url}, Ctrl-C to stop`));
}

/** Poll TCP connect until the port is accepting connections, up to timeoutMs. */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const { Socket } = require("net");
      const sock: any = new Socket();
      sock.setTimeout(200);
      sock.once("connect", () => { sock.destroy(); resolve(true); });
      sock.once("error",   () => { sock.destroy(); resolve(false); });
      sock.once("timeout", () => { sock.destroy(); resolve(false); });
      sock.connect(port, "127.0.0.1");
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

export function logLevelBlocks(res: { ok: boolean; level?: string; error?: string }, wasSet: boolean): { print: Block[]; failure?: out.FailureInput } {
  if (!res.ok) return { print: [], failure: { title: res.error ?? "The daemon did not change its log level" } };
  return { print: [wasSet ? out.line("done", `Set the daemon's log level to ${res.level}`) : out.kv("log level", res.level)] };
}

export async function setLogLevel(args: string[] = []): Promise<void> {
  const json = args.includes("--json");
  const level = args.find((a) => !a.startsWith("--"));
  const res = await daemonQuery("daemon:log-level", level ? { level } : {});
  if (!res) {
    out.fail({ title: "The daemon did not answer the log level request", next: out.cmd("rt daemon status") });
    return;
  }
  if (json) {
    out.json(res);
    return;
  }
  const shown = logLevelBlocks(res as { ok: boolean; level?: string; error?: string }, Boolean(level));
  if (shown.failure) out.fail(shown.failure);
  else out.print(...shown.print);
}
