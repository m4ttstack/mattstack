/**
 * The org's team directory (`mattstack.directory`): pure reads every app
 * shares, so "which team owns this channel" has one answer.
 */

import { activeTeam } from "./active-team.ts";
import type { Value } from "./registry-schemas.ts";
import { getSetting } from "./resolve.ts";

export type TeamDirectory = Value<"mattstack.directory">;
export type DirectoryTeam = NonNullable<TeamDirectory["teams"]>[string];

/** Channel kinds some app reads; any other kind is legal but draws a notice on write. */
export const KNOWN_CHANNEL_KINDS: readonly string[] = ["review"];

export function normalizeChannel(channel: string): string {
  return channel.trim().replace(/^#/, "").toLowerCase();
}

export function directoryEntry(dir: TeamDirectory | undefined, team: string | null): DirectoryTeam | null {
  if (!team) return null;
  return dir?.teams?.[team] ?? null;
}

export function teamForChannel(dir: TeamDirectory | undefined, channel: string): { name: string; entry: DirectoryTeam } | null {
  const want = normalizeChannel(channel);
  for (const [name, entry] of Object.entries(dir?.teams ?? {})) {
    const own = entry.slack?.codeOwnersChannel;
    if (own && normalizeChannel(own) === want) return { name, entry };
  }
  return null;
}

export function channelsOfKind(entry: DirectoryTeam, kind: string): string[] {
  return (entry.slack?.channels ?? []).filter((c) => c.kind === kind).map((c) => normalizeChannel(c.name));
}

export function teamChannels(entry: DirectoryTeam): string[] {
  const own = entry.slack?.codeOwnersChannel;
  return [...(own ? [own] : []), ...(entry.slack?.channels ?? []).map((c) => c.name)].map(normalizeChannel);
}

export function directoryIssues(dir: TeamDirectory | undefined): {
  duplicates: Array<{ channel: string; teams: string[] }>;
  unknownKinds: Array<{ team: string; channel: string; kind: string }>;
} {
  const byChannel = new Map<string, string[]>();
  const unknownKinds: Array<{ team: string; channel: string; kind: string }> = [];
  for (const [team, entry] of Object.entries(dir?.teams ?? {})) {
    const own = entry.slack?.codeOwnersChannel;
    if (own) {
      const key = normalizeChannel(own);
      byChannel.set(key, [...(byChannel.get(key) ?? []), team]);
    }
    for (const c of entry.slack?.channels ?? []) {
      if (!KNOWN_CHANNEL_KINDS.includes(c.kind)) unknownKinds.push({ team, channel: c.name, kind: c.kind });
    }
  }
  const duplicates = [...byChannel].filter(([, teams]) => teams.length > 1).map(([channel, teams]) => ({ channel, teams }));
  return { duplicates, unknownKinds };
}

/** The active team's directory entry, or null on no team, no directory or no entry. */
export function myDirectoryTeam(): DirectoryTeam | null {
  return directoryEntry(getSetting<TeamDirectory>("mattstack.directory").value, activeTeam().team);
}
