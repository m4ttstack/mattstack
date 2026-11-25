import { basename } from "path";
import { agentNameOf, isUserOrAgentProcess, type KillCandidate } from "../daemon/worktree-process-kill.ts";
import { canon } from "../fs-canon.ts";
import type { EndpointClaim } from "../state/index.ts";
import type { RoleConfig } from "./config.ts";
import { matchInvocation, type InterceptRule } from "./shim.ts";

export interface ServerProc {
  pid: number;
  ppid: number;
  etime: string;
  startTime: string;
  args: string;
}

export interface ServerSnapshot {
  procs: ServerProc[];
  cwds: Map<number, string>;
  /** pid to its listening ports, ascending. */
  listeners: Map<number, number[]>;
  worktrees: Array<{ path: string; branch: string | null }>;
}

/** `rules` holds this repo's rules only. */
export interface ServerRules {
  rules: InterceptRule[];
  roles: Record<string, RoleConfig>;
  claims: EndpointClaim[];
}

export interface RunningServer {
  role: string;
  port: number | null;
  listening: boolean;
  worktree: { path: string; name: string };
  branch: string | null;
  pid: number;
  /** The whole tree, ascending, agents and their descendants left out. */
  pids: number[];
  startTime: string;
  etime: string;
  leftBehind: boolean;
  agent: string | null;
}

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/;

/** Reads `ps -A -o pid=,ppid=,etime=,lstart=,args=` as printed in the C locale. */
export function parseServerProcs(psOutput: string): ServerProc[] {
  const procs: ServerProc[] = [];
  for (const line of psOutput.split("\n")) {
    const row = PS_ROW.exec(line);
    if (!row) continue;
    procs.push({
      pid: Number(row[1]),
      ppid: Number(row[2]),
      etime: row[3]!,
      startTime: row[4]!.replace(/\s+/g, " "),
      args: row[5]!.trimEnd(),
    });
  }
  return procs;
}

// Anchored because the shell or agent that typed the command line holds the same text.
const INTERCEPT_ARGV = /^(?:(?:\S*\/)?rt|(?:\S*\/)?bun(?: \S+)* \S*\/cli\.ts) intercept run ([A-Za-z0-9._-]+) -- ?(.*)$/;

export function interceptCommandOf(args: string): { command: string; args: string[] } | null {
  const hit = INTERCEPT_ARGV.exec(args);
  if (!hit) return null;
  const rest = hit[2]!;
  return { command: hit[1]!, args: rest === "" ? [] : rest.split(" ") };
}

function ancestorsIn(parents: Map<number, number>, pid: number): number[] {
  const found: number[] = [];
  const seen = new Set([pid]);
  for (let up = parents.get(pid); up !== undefined && up > 1 && parents.has(up) && !seen.has(up); up = parents.get(up)) {
    seen.add(up);
    found.push(up);
  }
  return found;
}

/** Nearest first, stopping below pid 1. */
export function ancestorPids(procs: ServerProc[], pid: number): number[] {
  return ancestorsIn(new Map(procs.map((p) => [p.pid, p.ppid])), pid);
}

function asCandidate(proc: ServerProc): KillCandidate {
  return { pid: proc.pid, ppid: proc.ppid, command: basename(proc.args.split(" ")[0]!), fullCommand: proc.args };
}

/** Sorted by worktree name, role, port. */
export function findServers(snapshot: ServerSnapshot, { rules, roles, claims }: ServerRules): RunningServer[] {
  const byPid = new Map(snapshot.procs.map((p) => [p.pid, p]));
  const parents = new Map(snapshot.procs.map((p) => [p.pid, p.ppid]));
  const ancestors = (pid: number) => ancestorsIn(parents, pid);
  const agentAt = (pid: number) => {
    const proc = byPid.get(pid);
    return proc ? agentNameOf(asCandidate(proc)) : null;
  };

  // Longest first, so a tree nested in the main checkout wins over it.
  const trees = snapshot.worktrees
    .map((w) => ({ ...w, real: canon(w.path) }))
    .sort((a, b) => b.real.length - a.real.length);
  type Tree = (typeof trees)[number];
  const treeOf = (cwd: string) => trees.find((t) => cwd === t.real || cwd.startsWith(`${t.real}/`));
  const placed = claims.map((c) => ({ role: c.role, port: c.port, tree: canon(c.worktree) }));

  const repoRules = rules.map((rule) => ({ ...rule, repoRemote: null }));
  const matched = new Map<number, { role: string; tree: Tree }>();
  for (const proc of snapshot.procs) {
    const run = interceptCommandOf(proc.args);
    const cwd = snapshot.cwds.get(proc.pid);
    if (!run || cwd === undefined) continue;
    const tree = treeOf(cwd);
    if (!tree) continue;
    const hit = matchInvocation(repoRules, { ...run, cwd, toplevel: tree.real, remote: null });
    if (hit) matched.set(proc.pid, { role: hit.match.role, tree });
  }

  const roots = new Map<number, { role: string; tree: Tree; leftBehind: boolean }>();
  for (const [pid, at] of matched) {
    const nested = ancestors(pid).some((up) => matched.get(up)?.role === at.role && matched.get(up)?.tree === at.tree);
    if (!nested) roots.set(pid, { ...at, leftBehind: false });
  }

  const inRoleFolder = (role: string, cwd: string, tree: Tree) =>
    repoRules.some((rule) => {
      const matches = rule.matches.filter((m) => m.role === role).map(({ cwdGlob }) => ({ cwdGlob, role }));
      return matchInvocation([{ ...rule, matches }], { command: rule.command, args: [], cwd, toplevel: tree.real, remote: null }) !== null;
    });
  const roleHolding = (port: number, cwd: string, tree: Tree) =>
    placed.find((c) => c.port === port && c.tree === tree.real)?.role ??
    Object.keys(roles).find((role) => roles[role]!.fixedPort === port && inRoleFolder(role, cwd, tree));

  const leftBehind = new Map<number, { role: string; tree: Tree; leftBehind: boolean }>();
  for (const [pid, ports] of snapshot.listeners) {
    const proc = byPid.get(pid);
    const cwd = snapshot.cwds.get(pid);
    if (!proc || cwd === undefined) continue;
    const tree = treeOf(cwd);
    if (!tree || isUserOrAgentProcess(asCandidate(proc))) continue;
    if ([pid, ...ancestors(pid)].some((p) => roots.has(p))) continue;
    const role = ports.map((port) => roleHolding(port, cwd, tree)).find((r) => r !== undefined);
    if (role === undefined) continue;
    let root = pid;
    for (const up of ancestors(pid)) {
      if (snapshot.cwds.get(up) !== cwd || isUserOrAgentProcess(asCandidate(byPid.get(up)!))) break;
      root = up;
    }
    if (!leftBehind.has(root)) leftBehind.set(root, { role, tree, leftBehind: true });
  }
  for (const [pid, at] of leftBehind) roots.set(pid, at);

  const pidsOf = new Map<number, number[]>([...roots.keys()].map((pid) => [pid, []]));
  for (const { pid } of snapshot.procs) {
    const line = [pid, ...ancestors(pid)];
    const at = line.findIndex((p) => roots.has(p));
    if (at < 0 || line.slice(0, at).some((p) => agentAt(p) !== null)) continue;
    pidsOf.get(line[at]!)!.push(pid);
  }

  const servers = [...roots].map(([pid, { role, tree, leftBehind }]): RunningServer => {
    const proc = byPid.get(pid)!;
    const pids = pidsOf.get(pid)!.sort((a, b) => a - b);
    const held = pids.flatMap((p) => snapshot.listeners.get(p) ?? []);
    const expected = [
      placed.find((c) => c.role === role && c.tree === tree.real)?.port,
      roles[role]?.fixedPort,
    ].filter((port) => port !== undefined);
    return {
      role,
      port: expected.find((port) => held.includes(port)) ?? (held.length ? Math.min(...held) : expected[0] ?? null),
      listening: held.length > 0,
      worktree: { path: tree.path, name: basename(tree.path) },
      branch: tree.branch,
      pid,
      pids,
      startTime: proc.startTime,
      etime: proc.etime,
      leftBehind,
      agent: ancestors(pid).map(agentAt).find((name) => name !== null) ?? null,
    };
  });
  return servers.sort((a, b) =>
    a.worktree.name.localeCompare(b.worktree.name) ||
    a.role.localeCompare(b.role) ||
    (a.port ?? Infinity) - (b.port ?? Infinity) ||
    a.pid - b.pid);
}
