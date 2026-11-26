import { mrSegments, mrStateWord, type EnrichedBranch, type MRInfo } from "../enrich.ts";
import { extractLinearId, type LinearTicket } from "../linear.ts";
import type { RunningServer } from "./servers.ts";

export interface GroupedServer {
  server: RunningServer;
  /** Set only when the group spans several branches. */
  branch: string | null;
  /** Set only when the group spans several branches. */
  mr: MRInfo | null;
}

export interface ServerGroup {
  /** Ticket id, else branch, else worktree path. */
  key: string;
  ticketId: string | null;
  ticket: LinearTicket | null;
  /** Ticket title, else MR title, else branch, else worktree name. */
  title: string;
  detached: boolean;
  /** Set only when every server in the group is on one branch. */
  mr: MRInfo | null;
  servers: GroupedServer[];
}

const startedAt = (server: RunningServer) => Date.parse(server.startTime);

/** `enriched` is keyed by worktree path. */
export function groupServers(servers: RunningServer[], enriched: Map<string, EnrichedBranch>): ServerGroup[] {
  // An id found only in an MR title counts once a ticket answers to it: any WORD-123 in a title reads as one.
  const ticketIdOf = (s: RunningServer) => {
    if (s.branch === null) return null;
    const found = enriched.get(s.worktree.path);
    return extractLinearId(s.branch) ?? (found?.ticket ? found.linearId : null);
  };

  const byKey = new Map<string, RunningServer[]>();
  for (const s of servers) {
    const key = ticketIdOf(s) ?? s.branch ?? s.worktree.path;
    byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }

  const groups = [...byKey].map(([key, members]): ServerGroup => {
    const first = members[0]!;
    const mrOf = (s: RunningServer) => enriched.get(s.worktree.path)?.mr ?? null;
    const ticketId = ticketIdOf(first);
    const ticket = ticketId === null ? null : members.map((s) => enriched.get(s.worktree.path)?.ticket).find(Boolean) ?? null;
    const several = new Set(members.map((s) => s.branch)).size > 1;
    const mr = several ? null : mrOf(first);
    return {
      key,
      ticketId,
      ticket,
      title: ticket?.title ?? mr?.title ?? (several ? key : first.branch ?? first.worktree.name),
      detached: first.branch === null && !first.removed,
      mr,
      servers: [...members]
        .sort((a, b) => (a.branch ?? "").localeCompare(b.branch ?? "") || a.role.localeCompare(b.role) || (a.port ?? Infinity) - (b.port ?? Infinity))
        .map((server) => ({ server, branch: several ? server.branch : null, mr: several ? mrOf(server) : null })),
    };
  });
  const oldest = (group: ServerGroup) => Math.min(...group.servers.map((r) => startedAt(r.server)));
  return groups.sort((a, b) => oldest(a) - oldest(b) || a.key.localeCompare(b.key));
}

export const NO_PORT = "no port";
export const portText = (s: RunningServer) => (s.port === null ? NO_PORT : `:${s.port}`);

/** The row's filter text. */
export function serverMatch(group: ServerGroup, { server, mr: rowMr }: GroupedServer): string {
  const mr = rowMr ?? group.mr;
  return [
    server.role,
    portText(server),
    server.worktree.name,
    group.ticketId,
    group.ticket?.stateName,
    group.title,
    server.branch,
    mr?.title,
    mr && mrStateWord(mr),
  ].filter(Boolean).join(" ");
}

/** `!412 open  checks passed` */
export function mrText(mr: MRInfo): string {
  return mrSegments(mr).map((s) => s.text).join("");
}
