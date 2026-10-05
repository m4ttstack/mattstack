/**
 * rt port: Zero-config port scanner + killer.
 *
 * Usage:
 *   rt port          show all listening ports for known repos (daemon-first)
 *   rt port kill     interactive kill picker
 *   rt port 8080     ad-hoc kill processes on port 8080
 *
 * Queries the daemon's cached port scan for instant results.
 * Falls back to direct lsof scan when daemon is not running.
 */

import { execSync } from "child_process";
import { basename } from "path";
import { scanListeningPorts, type PortEntry } from "../lib/port-scanner.ts";
import { repoLabel } from "../lib/repo-label.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, PickRow, PickSegment } from "../lib/ui/protocol.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";

// ─── Data fetching ───────────────────────────────────────────────────────────

async function getPortData(): Promise<{ entries: PortEntry[]; source: "daemon" | "direct" }> {
  const { daemonQuery } = await import("../lib/daemon-client.ts");
  // refresh: true → daemon re-scans before returning, so we never serve the
  // 30s-stale cache on a direct CLI invocation. A fresh scan does an lsof per
  // listening PID, so allow more than the default 2s.
  const result = await withTransientStep("Scanning ports", () => daemonQuery("ports", { refresh: true }, 15_000));

  if (result?.ok && result.data?.ports) {
    return { entries: result.data.ports as PortEntry[], source: "daemon" };
  }

  // daemonQuery's own daemon-down note fires only after a failed restart; a
  // missing daemon or a timed-out one falls back here with nothing said.
  out.note(out.line("warn", "Scanned your ports without the rt daemon"));
  return {
    entries: await withTransientStep("Scanning ports", async () => scanListeningPorts()),
    source: "direct",
  };
}

// ─── Display ─────────────────────────────────────────────────────────────────

/**
 * Build a human-readable path starting from the worktree/repo folder name.
 * e.g. "my-repo-wktree-2/apps/portal" or "my-repo/."
 */
function folderPath(entry: PortEntry): string {
  const wtName = entry.worktree ? basename(entry.worktree) : (entry.repo ? repoLabel(entry.repo) : "unknown");
  return entry.relativeDir && entry.relativeDir !== "." ? `${wtName}/${entry.relativeDir}` : wtName;
}

function formatUptime(etime: string): string {
  const trimmed = etime.trim();
  if (!trimmed || trimmed === "unknown") return "?";

  const parts = trimmed.split(/[-:]/);
  if (parts.length === 2) {
    const mins = parseInt(parts[0]!, 10);
    if (mins === 0) return `${parts[1]}s`;
    return `${mins}m`;
  }
  if (parts.length === 3) {
    if (trimmed.includes("-")) return `${parts[0]}d`;
    const hours = parseInt(parts[0]!, 10);
    const mins = parseInt(parts[1]!, 10);
    if (hours === 0) return `${mins}m`;
    return `${hours}h${mins > 0 ? `${mins}m` : ""}`;
  }
  if (parts.length === 4) return `${parts[0]}d`;
  return trimmed;
}

const NOTHING_LISTENING = "Nothing is listening in your repos";

export function portBlocks(entries: PortEntry[]): Block[] {
  if (entries.length === 0) return [out.line("done", NOTHING_LISTENING)];

  const grouped = new Map<string, Map<string, PortEntry[]>>();
  for (const entry of entries) {
    const repoKey = entry.repo || "unknown";
    if (!grouped.has(repoKey)) grouped.set(repoKey, new Map());
    const wtKey = entry.worktree || "unknown";
    const wtMap = grouped.get(repoKey)!;
    if (!wtMap.has(wtKey)) wtMap.set(wtKey, []);
    wtMap.get(wtKey)!.push(entry);
  }

  const blocks: Block[] = [];
  for (const [repoName, worktrees] of grouped) {
    const trees: Block[] = [];
    for (const [wtPath, ports] of worktrees) {
      const branch = ports[0]?.branch;
      const root = branch ? out.key(branch) : out.dim(wtPath === "unknown" ? "unknown folder" : basename(wtPath));
      trees.push(out.tree(root, ports.map((p) => [`:${p.port}`, folderPath(p), out.dim(p.command), out.dim(formatUptime(p.uptime))])));
    }
    blocks.push(out.section(repoLabel(repoName), undefined, ...trees));
  }
  return blocks;
}

// ─── Kill helpers ────────────────────────────────────────────────────────────

interface PortSystem {
  /** lsof's listener table for the port, header included; empty when nothing listens. */
  listeners(port: number): string;
  kill(pid: number): void;
}

const realSystem: PortSystem = {
  listeners: (port) => {
    try {
      // -sTCP:LISTEN: only the listener. Plain `-i :port` also matches clients
      // connected to the port (browser tabs, curl, etc.).
      return execSync(`lsof -iTCP:${port} -sTCP:LISTEN -P -n 2>/dev/null`, { encoding: "utf8", stdio: "pipe" });
    } catch {
      return "";
    }
  },
  kill: (pid) => process.kill(pid, "SIGKILL"),
};

let system: PortSystem = realSystem;

interface StopTarget {
  pid: number;
  command: string;
  port: number;
}

function stopAll(targets: StopTarget[]): void {
  const done: Block[] = [];
  const failures: out.FailureInput[] = [];
  for (const { pid, command, port } of targets) {
    const valid = Number.isInteger(pid) && pid > 0;
    const where = valid ? `pid ${pid}, port ${port}` : `port ${port}`;
    // process.kill on 0 or a negative pid signals a whole process group.
    if (!valid) {
      done.push(out.line("skipped", `${command} has no process to stop`, where));
      continue;
    }
    try {
      system.kill(pid);
      done.push(out.line("done", `Stopped ${command}`, where));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ESRCH") done.push(out.line("skipped", `${command} had already stopped`, where));
      else failures.push({ title: `Could not stop ${command}`, hint: where, why: code === "EPERM" ? "It belongs to another user or to macOS." : (err as Error).message });
    }
  }
  out.print(...done);
  for (const f of failures) out.fail(f);
}

function killByPort(port: number): void {
  const rows = system.listeners(port).trim().split("\n").filter(Boolean).slice(1);
  const targets = new Map<number, StopTarget>();
  for (const row of rows) {
    const [command, pidText] = row.split(/\s+/);
    const pid = Number(pidText);
    if (command && pidText && !targets.has(pid)) targets.set(pid, { pid, command, port });
  }
  if (targets.size === 0) {
    out.print(out.line("skipped", `Nothing is listening on port ${port}`));
    return;
  }
  stopAll([...targets.values()]);
}

async function showKillPicker(entries: PortEntry[]): Promise<void> {
  const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");

  const rows: PickRow[] = entries.map((p) => {
    const uptimeStr = formatUptime(p.uptime);
    const left: PickSegment[] = [
      { text: `:${p.port}`, tone: "peach", bold: true, column: true },
      { text: `  ${folderPath(p)}` },
      { text: `  ${p.command}`, tone: "dim" },
    ];
    const hintParts: string[] = [];
    if (p.repo) hintParts.push(repoLabel(p.repo));
    if (p.branch) hintParts.push(p.branch);
    hintParts.push(uptimeStr);
    const right: PickSegment[] = [{ text: hintParts.join(" \u00b7 "), tone: "dim" }];
    return {
      value: String(p.pid),
      match: `:${p.port} ${folderPath(p)} ${p.command}`,
      left,
      right,
    };
  });

  const selectedPids = await filterableMultiselect(
    { message: "Select processes to kill (or esc to exit)", options: [] },
    { rows },
  );

  if (!selectedPids || selectedPids.length === 0) {
    out.print(out.line("skipped", "Nothing selected"));
    return;
  }

  const targets = selectedPids.flatMap((pid) => {
    const entry = entries.find((p) => String(p.pid) === pid);
    return entry ? [{ pid: entry.pid, command: entry.command, port: entry.port }] : [];
  });
  stopAll(targets);
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export async function portScanner(args: string[]): Promise<void> {
  // Ad-hoc kill mode: rt port 8080
  if (args.length > 0 && /^\d+$/.test(args[0] || "")) {
    return killByPort(parseInt(args[0]!, 10));
  }

  if (args[0] === "kill") {
    const killArgs = args.slice(1);
    if (killArgs.length > 0 && /^\d+$/.test(killArgs[0] || "")) {
      return killByPort(parseInt(killArgs[0]!, 10));
    }
  }

  const { entries } = await getPortData();

  // The kill picker already shows every port, so a terminal gets the picker
  // and everything else gets the list.
  if (entries.length === 0 || !process.stdin.isTTY) {
    out.print(...portBlocks(entries));
    return;
  }
  await showKillPicker(entries);
}

export const __test__ = {
  formatUptime,
  setSystem(fake: PortSystem | undefined): void {
    system = fake ?? realSystem;
  },
};
