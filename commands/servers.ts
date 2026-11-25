import type { CommandContext } from "../lib/command-tree.ts";
import { loadEndpointConfig } from "../lib/endpoint/config.ts";
import { groupServers, mrText, serverMatch, type GroupedServer, type ServerGroup } from "../lib/endpoint/server-groups.ts";
import { agentLabel, ancestorPids, findServers, type RunningServer, type ServerRules, type ServerSnapshot } from "../lib/endpoint/servers.ts";
import { readServerSnapshot, stopServers, type ServerRepo, type StopOutcome } from "../lib/endpoint/servers-system.ts";
import { loadInterceptRules } from "../lib/endpoint/shim.ts";
import { loadClaims } from "../lib/endpoint/store.ts";
import { enrichBranches, mrSegments, type EnrichedBranch } from "../lib/enrich.ts";
import { UserActionableError } from "../lib/errors.ts";
import { repoLabel } from "../lib/repo-label.ts";
import { parseIdentity } from "../lib/settings/identity.ts";
import * as out from "../lib/ui/out.ts";
import type { PickHandle } from "../lib/ui/pick.ts";
import type { Block, PickAction, PickGroupHeading, PickRow, PickSegment, Segment } from "../lib/ui/protocol.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";
import { formatUptime } from "../lib/uptime.ts";

type Enriched = Map<string, EnrichedBranch>;

export interface ServersDeps {
  rules(identity: string): ServerRules;
  snapshot(repo: ServerRepo): Promise<ServerSnapshot | null>;
  /** Keyed by worktree path. */
  enrich(servers: RunningServer[], remoteUrl: string | undefined): Promise<Enriched>;
  /** The root pids to stop, or null when nothing was picked. Opens on what has landed. */
  pick(label: string, servers: RunningServer[], lookup: Lookup): Promise<number[] | null>;
  stop: typeof stopServers;
  canAsk(): boolean;
  /** Settles early when `cancel` aborts, so a lookup that answers first leaves no timer holding the process open. */
  sleep(ms: number, cancel: AbortSignal): Promise<void>;
  exit(code: number): void;
}

export interface Lookup {
  answer: Promise<Enriched>;
  landed: Enriched | null;
}

const LIST_ENRICH_DEADLINE_MS = 3_000;
/** Longer than the list's: a person is watching a spinner, and the picker opens without the data after this. */
const PICK_ENRICH_DEADLINE_MS = 10_000;
const READ_FAILED = "rt could not read what is running";
/** The width rt cd pads its ticket states to. */
const STATE_WIDTH = 15;

const portText = (s: RunningServer) => (s.port === null ? "no port" : `:${s.port}`);

export function serverHints(s: RunningServer): string[] {
  return [
    s.agent === null ? null : `${agentLabel(s.agent)} session`,
    s.inside === null ? null : s.inside === "shell" ? "shell inside" : `${agentLabel(s.inside)} session inside`,
    s.listening ? null : "not listening",
    s.leftBehind ? "left behind" : null,
    s.removed ? "worktree removed" : null,
  ].filter((hint) => hint !== null);
}

function groupRoot(group: ServerGroup): Array<string | Segment> {
  const parts: Segment[] = [];
  if (group.ticketId) parts.push(out.key(group.ticketId));
  if (group.ticket?.stateName) parts.push(out.dim(`[${group.ticket.stateName}]`));
  if (group.title !== group.ticketId) parts.push(group.ticketId ? { text: group.title } : out.key(group.title));
  if (group.detached) parts.push(out.dim("detached"));
  if (group.mr) parts.push(out.dim(mrText(group.mr)));
  return parts.flatMap((part, i) => (i === 0 ? [part] : ["  ", part]));
}

function serverCells({ server, branch, mr }: GroupedServer): Array<string | Segment> {
  const rest = [branch, mr && mrText(mr), serverHints(server).join(", ")].filter(Boolean).join("  ");
  return [server.role, portText(server), out.dim(formatUptime(server.etime)), ...(rest ? [out.dim(rest)] : [])];
}

export function serverBlocks(label: string, groups: ServerGroup[]): Block[] {
  if (groups.length === 0) return [out.line("off", "No dev servers are running here", label)];
  return [out.section(label, undefined, ...groups.map((group) => out.tree(groupRoot(group), group.servers.map(serverCells))))];
}

function jsonServer(s: RunningServer) {
  const { role, port, listening, worktree, branch, pid, pids, leftBehind, agent } = s;
  return { role, port, listening, worktree, branch, pid, pids, startedAt: new Date(s.startTime).toISOString(), leftBehind, agent };
}

/** Live worktrees first: the lookup runs git in the first one's folder, and a removed tree has no repo to read. */
export function branchesOf(servers: RunningServer[]): Array<{ path: string; branch: string }> {
  const liveFirst = [...servers].sort((a, b) => Number(a.removed) - Number(b.removed));
  const byPath = new Map(liveFirst.flatMap((s) => (s.branch === null ? [] : [[s.worktree.path, s.branch] as const])));
  return [...byPath].map(([path, branch]) => ({ path, branch }));
}

const spaced = (parts: PickSegment[][]): PickSegment[] =>
  parts.filter((part) => part.length > 0).flatMap((part, i) => (i === 0 ? part : [{ text: "  " }, ...part]));

/** A known ticket leads with its state and title; before that the id or branch leads, so nothing waits on a lookup. */
function groupHeading(group: ServerGroup): PickGroupHeading {
  const { ticket, ticketId, title } = group;
  const state: PickSegment[] = ticket?.stateName
    ? [{ text: `[${ticket.stateName}]`.padEnd(STATE_WIDTH), ...(ticket.stateColor ? { hex: ticket.stateColor } : { tone: "dim" }) }]
    : [];
  const name: PickSegment[] = ticketId && !ticket
    ? [{ text: ticketId, bold: true }, ...(title === ticketId ? [] : [{ text: `  ${title}`, tone: "faint" }])]
    : [{ text: title, bold: true }, ...(group.detached ? [{ text: "  detached", tone: "faint" }] : [])];
  return {
    left: spaced([state, name]),
    right: spaced([group.mr ? mrSegments(group.mr) : [], ticket && ticketId ? [{ text: ticketId, tone: "dimmer" }] : []]),
  };
}

/** Role and port are all the selected strip prints, so a pair that repeats adds its worktree, then its pid. */
function portCells(servers: RunningServer[]): (server: RunningServer) => string {
  const short = (s: RunningServer) => portText(s);
  const placed = (s: RunningServer) => `${portText(s)} ${s.worktree.name}`;
  const alone = (s: RunningServer, cell: (s: RunningServer) => string) =>
    servers.filter((other) => other.role === s.role && cell(other) === cell(s)).length === 1;
  return (s) => (alone(s, short) ? short(s) : alone(s, placed) ? placed(s) : `${placed(s)} ${s.pid}`);
}

export function pickView(groups: ServerGroup[]): { rows: PickRow[]; groupHeadings: Record<string, PickGroupHeading> } {
  const all = groups.flatMap((group) => group.servers.map((row) => ({ group, row, uptime: formatUptime(row.server.etime) })));
  const portCell = portCells(all.map(({ row }) => row.server));
  const roleWidth = Math.max(...all.map(({ row }) => row.server.role.length));
  const uptimeWidth = Math.max(...all.map(({ uptime }) => uptime.length));
  const rows = all.map(({ group, row, uptime }): PickRow => ({
    value: String(row.server.pid),
    match: serverMatch(group, row),
    group: group.key,
    left: [
      { text: `${row.server.role.padEnd(roleWidth)}  `, tone: "peach", bold: true },
      { text: portCell(row.server), tone: row.server.port === null ? "faint" : "textsoft", column: true },
      ...(row.branch ? [{ text: `  ${row.branch}`, tone: "faint" }] : []),
      ...serverHints(row.server).map((hint) => ({ text: `  ${hint}`, tone: hint.endsWith(" session") ? "lav" : "peach" })),
    ],
    right: spaced([row.mr ? mrSegments(row.mr) : [], [{ text: uptime.padStart(uptimeWidth), tone: "dim" }]]),
  }));
  return { rows, groupHeadings: Object.fromEntries(groups.map((group) => [group.key, groupHeading(group)])) };
}

const STOP_ACTION: PickAction = { id: "select", label: "stop", key: "enter", scope: "item", group: "mark", primary: true };

export const realServersDeps: ServersDeps = {
  rules: (identity) => {
    const id = parseIdentity(identity);
    return {
      rules: loadInterceptRules().filter((rule) => rule.repo === identity),
      roles: loadEndpointConfig({ repoIdentity: id?.kind === "remote" ? id.id : null, repoName: identity }).roles,
      claims: loadClaims(identity),
    };
  },
  snapshot: readServerSnapshot,
  enrich: async (servers, remoteUrl) => {
    const branches = branchesOf(servers);
    if (branches.length === 0) return new Map();
    return new Map((await enrichBranches(branches, remoteUrl, { silent: true })).map((eb) => [eb.path, eb]));
  },
  pick: async (label, servers, lookup) => {
    const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");
    const first = pickView(groupServers(servers, lookup.landed ?? new Map()));
    let handle: PickHandle | undefined;
    const picked = filterableMultiselect(
      {
        message: "Select servers to stop (or esc to exit)",
        options: [],
        breadcrumb: ["rt", "servers", label],
        crumbSuffix: "  ctrl-a marks all",
        groupHeadings: first.groupHeadings,
        // A fuzzy near match would be marked, then stopped, by ctrl-a.
        exact: true,
      },
      { rows: first.rows, actions: [STOP_ACTION], onOpen: (opened) => { handle = opened; } },
    );
    if (!lookup.landed) {
      void lookup.answer
        .then((answer) => {
          if (answer.size > 0) handle?.update(pickView(groupServers(servers, answer)));
        })
        // The picker can be closing as the answer lands; the pick still stands.
        .catch(() => {});
    }
    return (await picked)?.map(Number) ?? null;
  },
  stop: stopServers,
  // stdout and stderr too, so `rt servers | grep api` and `rt servers 2>log` list.
  canAsk: () => Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY) && !process.env.RT_BATCH,
  sleep: (ms, cancel) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      cancel.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    }),
  exit: (code) => process.exit(code),
};

function startLookup(deps: ServersDeps, servers: RunningServer[], remoteUrl: string | undefined): Lookup {
  const lookup: Lookup = { answer: deps.enrich(servers, remoteUrl).catch((): Enriched => new Map()), landed: null };
  void lookup.answer.then((answer) => { lookup.landed = answer; });
  return lookup;
}

async function enrichedWithin(deps: ServersDeps, lookup: Lookup, ms: number): Promise<Enriched> {
  const cancel = new AbortController();
  try {
    return await Promise.race([lookup.answer, deps.sleep(ms, cancel.signal).then((): Enriched => new Map())]);
  } finally {
    cancel.abort();
  }
}

function printOutcomes(outcomes: StopOutcome[], groups: ServerGroup[]): void {
  const titles = new Map(groups.flatMap((group) => group.servers.map((row) => [row.server.pid, group.title] as const)));
  const done: Block[] = [];
  const refused: Block[] = [];
  const failures: out.FailureInput[] = [];
  for (const { server, result, why } of outcomes) {
    const where = [server.port === null ? null : portText(server), titles.get(server.pid)].filter(Boolean).join(", ");
    if (result === "stopped") done.push(out.line("done", `Stopped ${server.role}`, where));
    else if (result === "gone") done.push(out.line("skipped", `${server.role} had already stopped`, where));
    else if (result === "refused") refused.push(out.line("refused", `Left ${server.role} running`, where), out.callout("why", why ?? ""));
    else failures.push({ title: `Could not stop ${server.role}`, hint: where, why });
  }
  if (done.length > 0) out.print(...done);
  if (refused.length > 0) out.note(...refused);
  for (const failure of failures) out.fail(failure);
  if (refused.length + failures.length > 0) process.exitCode = 1;
}

export async function serversCommand(args: string[], ctx: CommandContext, deps: ServersDeps = realServersDeps): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const { identity, repoRoot, remoteUrl } = ctx.identity!;
  const label = repoLabel(identity);
  const read = async (): Promise<ServerSnapshot> => {
    const once = () => deps.snapshot({ identity, root: repoRoot });
    const snapshot = await (json ? once() : withTransientStep("Looking for running servers", once));
    if (!snapshot) throw new UserActionableError("servers-read-failed", READ_FAILED, {}, { why: "The process list did not answer.", next: "rt servers" });
    return snapshot;
  };

  const rules = deps.rules(identity);
  if (rules.rules.length === 0) {
    if (json) out.json({ ok: true, repo: identity, servers: [] });
    else out.print(out.line("off", "rt does not intercept any commands here", label));
    return;
  }

  const snapshot = await read();
  const servers = findServers(snapshot, rules);
  if (json) {
    out.json({ ok: true, repo: identity, servers: servers.map(jsonServer) });
    return;
  }
  if (servers.length === 0) {
    out.print(...serverBlocks(label, []));
    return;
  }

  const lookup = startLookup(deps, servers, remoteUrl || undefined);
  const pickAndStop = async () => {
    await withTransientStep("Loading tickets and merge requests", () => enrichedWithin(deps, lookup, PICK_ENRICH_DEADLINE_MS));
    const picked = await deps.pick(label, servers, lookup);
    if (!picked || picked.length === 0) {
      out.print(out.line("skipped", "Nothing selected"));
      return;
    }
    // Read again: the picker can sit open for minutes, and a pid can be reused.
    const now = await read();
    const spare = new Set([process.pid, ...ancestorPids(now.procs, process.pid)]);
    const chosen = servers.filter((s) => picked.includes(s.pid));
    const fresh = { servers: findServers(now, rules), procs: now.procs };
    const outcomes = await withTransientStep("Stopping servers", () => deps.stop(chosen, fresh, spare));
    printOutcomes(outcomes, groupServers(servers, lookup.landed ?? new Map()));
  };

  if (deps.canAsk()) await pickAndStop();
  else out.print(...serverBlocks(label, groupServers(servers, await enrichedWithin(deps, lookup, LIST_ENRICH_DEADLINE_MS))));
  // A forge lookup has no timeout of its own, and a pending one holds the process open.
  if (!lookup.landed) deps.exit(Number(process.exitCode ?? 0));
}
