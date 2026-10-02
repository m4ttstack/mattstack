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

function killByPort(port: number): void {
  const nothing = (): void => out.print(out.line("skipped", `Nothing is listening on port ${port}`));
  let output: string;
  try {
    // -sTCP:LISTEN: only the listener. Plain `-i :port` also matches clients
    // connected to the port (browser tabs, curl, etc.).
    output = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -P -n 2>/dev/null`, { encoding: "utf8", stdio: "pipe" });
  } catch {
    nothing();
    return;
  }
  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length <= 1) {
    nothing();
    return;
  }
  const pids = new Set<string>();
  for (const line of lines.slice(1)) {
    const pid = line.split(/\s+/)[1];
    if (pid) pids.add(pid);
  }
  const results: Block[] = [];
  for (const pid of pids) {
    try {
      execSync(`kill -9 ${pid}`);
      results.push(out.line("done", `Stopped pid ${pid}`, `port ${port}`));
    } catch {
      results.push(out.line("failed", `Could not stop pid ${pid}`));
    }
  }
  out.print(...results);
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

  const results: Block[] = [];
  for (const pid of selectedPids) {
    const entry = entries.find((p) => String(p.pid) === pid);
    if (!entry) continue;
    try {
      execSync(`kill -9 ${pid}`);
      results.push(out.line("done", `Stopped ${entry.command}`, `pid ${pid}, port ${entry.port}`));
    } catch {
      results.push(out.line("failed", `Could not stop pid ${pid}`));
    }
  }
  out.print(...results);
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

export const __test__ = { formatUptime };
