/**
 * Whether this machine's board holds a switchboard token. The board reads
 * SWITCHBOARD_TOKEN from its .env before rt's secrets, and its own peer-join
 * writes only there, so rt checks the same files before the secret.
 */

import { join, resolve } from "path";
import type { Probes } from "../setup/probes.ts";
import { discoverTeams } from "../setup/team-settings.ts";
import { isCompiledRt } from "../rt-self.ts";

function envLine(key: string): RegExp {
  return new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*["']?([^"'\\s#]+)`, "m");
}

/** Mirrors apps/board/src/app-root.ts: BOARD_APP_ROOT wins, the compiled board lives under ~/.mattstack/board. */
export function boardRoots(p: Pick<Probes, "home" | "env">, extraRoots: string[]): string[] {
  const override = p.env.BOARD_APP_ROOT;
  return [...(override ? [resolve(override)] : []), join(p.home, ".mattstack", "board"), ...extraRoots];
}

/** A dev-mode board runs from this same checkout, so an rt running from source also checks the checkout's board. */
export function sourceBoardRoots(): string[] {
  return isCompiledRt() ? [] : [join(import.meta.dir, "..", "..", "apps", "board")];
}

/** Whether any board root's .env sets `key`; the board loads that file into its own environment. */
export function boardEnvHas(p: Pick<Probes, "home" | "env" | "readFile">, key: string, extraRoots: string[] = sourceBoardRoots()): boolean {
  const line = envLine(key);
  return boardRoots(p, extraRoots).some((root) => {
    const raw = p.readFile(join(root, ".env"));
    return raw !== null && line.test(raw);
  });
}

/** The board falls back to its legacy config.json's projects when the team declares none, so a board configured there runs too. */
function legacyConfigTracksProjects(p: Pick<Probes, "home" | "env" | "readFile">, extraRoots: string[]): boolean {
  return boardRoots(p, extraRoots).some((root) => {
    const raw = p.readFile(join(root, "config.json"));
    if (raw === null) return false;
    try {
      const projects = (JSON.parse(raw) as { projects?: unknown }).projects;
      return Array.isArray(projects) && projects.length > 0;
    } catch {
      return false;
    }
  });
}

/** Asks only whether a secret exists, the way the setup plan's presence check does; it may throw when the store cannot answer. */
export type SecretPresenceCheck = (domain: string, key: string) => Promise<string | null>;

export type BoardPeering = { kind: "not-applicable" } | { kind: "peered" } | { kind: "unpeered"; teams: string[] } | { kind: "unreadable"; error: string };

/**
 * Whether this Mac is in a team (created or joined) and runs a board (the
 * team or the board's legacy config tracks projects) while neither token
 * source holds a token.
 * Only presence is asked of the secrets store, and a store that cannot
 * answer is reported as such, never read as no token.
 */
export async function boardPeering(p: Probes, has: SecretPresenceCheck, teamTracksProjects: boolean, extraRoots: string[] = sourceBoardRoots()): Promise<BoardPeering> {
  const teams = discoverTeams(p);
  if (teams.length === 0) return { kind: "not-applicable" };
  if (!teamTracksProjects && !legacyConfigTracksProjects(p, extraRoots)) return { kind: "not-applicable" };
  if (boardEnvHas(p, "SWITCHBOARD_TOKEN", extraRoots)) return { kind: "peered" };
  try {
    return (await has("rt", "switchboardToken")) === null ? { kind: "unpeered", teams } : { kind: "peered" };
  } catch (err) {
    return { kind: "unreadable", error: err instanceof Error ? err.message : String(err) };
  }
}
