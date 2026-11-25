import { existsSync } from "fs";
import { basename, dirname, join } from "path";
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
  /** Basename of the whole executable path, which `args` cannot give when the path holds a space. */
  command: string;
  args: string;
}

export interface ServerSnapshot {
  procs: ServerProc[];
  cwds: Map<number, string>;
  /** pid to its listening ports, ascending. */
  listeners: Map<number, number[]>;
  /** `removed` marks a tree rt has removed and still keeps. */
  worktrees: Array<{ path: string; branch: string | null; removed?: boolean }>;
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
  /** The agent this server runs under. */
  agent: string | null;
  /** An agent's name, or "shell" for an interactive one, running inside the tree: stopping the tree would end it. */
  inside: string | null;
  /** Its worktree has been removed. */
  removed: boolean;
}

export const agentLabel = (name: string): string => (name === "claude" ? "Claude" : name);

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/;

/** Reads `ps -A -o pid=,ppid=,etime=,lstart=,args=` as printed in the C locale, with `ps -A -o pid=,comm=` by pid. */
export function parseServerProcs(psOutput: string, commands: Map<number, string>): ServerProc[] {
  const procs: ServerProc[] = [];
  for (const line of psOutput.split("\n")) {
    const row = PS_ROW.exec(line);
    if (!row) continue;
    const pid = Number(row[1]);
    const args = row[5]!.trimEnd();
    procs.push({
      pid,
      ppid: Number(row[2]),
      etime: row[3]!,
      startTime: row[4]!.replace(/\s+/g, " "),
      command: basename(commands.get(pid) ?? args.split(" ")[0]!),
      args,
    });
  }
  return procs;
}

// Anchored, and nothing but `run` and flags before cli.ts: a shell, an agent or
// another rt verb can hold the rest of this text, and a match becomes a stop target.
const INTERCEPT_ARGV = /^(?:(?:\S*\/)?rt|(?:\S*\/)?bun(?: run| -\S+)* \S*\/cli\.ts) intercept run ([A-Za-z0-9._-]+) -- ?(.*)$/;

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
  return { pid: proc.pid, ppid: proc.ppid, command: proc.command, fullCommand: proc.args };
}

/** A shell, agent or multiplexer, or an app such as an editor. A framework Python runs from an app bundle and is not one. */
function isUsersOwn(proc: ServerProc): boolean {
  return isUserOrAgentProcess(asCandidate(proc)) || (proc.args.includes(".app/Contents/") && !proc.args.includes("/Python.app/Contents/"));
}

// A shell with no script and no -c.
const INTERACTIVE_SHELL = /^-?(?:\S*\/)?(?:zsh|bash|fish|sh)(?: -(?!c\b)[-\w]+)*$/;

function sessionName(proc: ServerProc): string | null {
  return agentNameOf(asCandidate(proc)) ?? (INTERACTIVE_SHELL.test(proc.args) ? "shell" : null);
}

/** A submodule or another clone checked out inside the tree: git reads it as its own repo, so the shim matched no rule there. */
function inNestedRepo(cwd: string, treeRoot: string): boolean {
  for (let dir = cwd; dir.length > treeRoot.length; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return true;
  }
  return false;
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

  const listed = snapshot.worktrees.map((w) => ({ path: w.path, branch: w.branch, removed: w.removed ?? false, real: canon(w.path) }));
  const placed = claims.map((c) => ({ role: c.role, port: c.port, path: c.worktree, tree: canon(c.worktree) }));
  // Claims are keyed by remote, so a folder that still exists unlisted is another clone's, or another repo's by now.
  const deleted = new Map(placed.filter((c) => !listed.some((t) => t.real === c.tree) && !existsSync(c.tree)).map((c) => [c.tree, c.path]));
  // Longest first, so a tree nested in the main checkout wins over it.
  const trees = [...listed, ...[...deleted].map(([real, path]) => ({ path, branch: null, removed: true, real }))]
    .sort((a, b) => b.real.length - a.real.length);
  type Tree = (typeof trees)[number];
  const treeOf = (cwd: string) => {
    const tree = trees.find((t) => cwd === t.real || cwd.startsWith(`${t.real}/`));
    return tree && !inNestedRepo(cwd, tree.real) ? tree : undefined;
  };

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
    if (!tree || isUsersOwn(proc)) continue;
    if ([pid, ...ancestors(pid)].some((p) => roots.has(p))) continue;
    const role = ports.map((port) => roleHolding(port, cwd, tree)).find((r) => r !== undefined);
    if (role === undefined) continue;
    let root = pid;
    for (const up of ancestors(pid)) {
      if (snapshot.cwds.get(up) !== cwd || isUsersOwn(byPid.get(up)!)) break;
      root = up;
    }
    if (!leftBehind.has(root)) leftBehind.set(root, { role, tree, leftBehind: true });
  }
  for (const [pid, at] of leftBehind) roots.set(pid, at);

  const pidsOf = new Map<number, number[]>([...roots.keys()].map((pid) => [pid, []]));
  const insideOf = new Map<number, string>();
  for (const proc of snapshot.procs) {
    const line = [proc.pid, ...ancestors(proc.pid)];
    const at = line.findIndex((p) => roots.has(p));
    if (at < 0) continue;
    const session = sessionName(proc);
    if (session !== null) {
      // Every server above it: stopping an outer one ends what runs inside the inner.
      for (const root of line.slice(1).filter((p) => roots.has(p))) {
        if (!insideOf.has(root) || session !== "shell") insideOf.set(root, session);
      }
    }
    if (!line.slice(0, at).some((p) => agentAt(p) !== null)) pidsOf.get(line[at]!)!.push(proc.pid);
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
      inside: insideOf.get(pid) ?? null,
      removed: tree.removed,
    };
  });
  return servers.sort((a, b) =>
    a.worktree.name.localeCompare(b.worktree.name) ||
    a.role.localeCompare(b.role) ||
    (a.port ?? Infinity) - (b.port ?? Infinity) ||
    a.pid - b.pid);
}
