/**
 * The board stopped reading team fields from its old config.json, and the
 * import-app-settings migration moved that file to config.json.imported
 * without copying them (they are a team admin's to set). This row is what
 * tells a Mac whose board took them from that file.
 */
import { join } from "path";
import { unwritten } from "../../settings/presence.ts";
import { boardRoots, sourceBoardRoots } from "../../team/board-token.ts";
import { row, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";

export const BOARD_TEAM_FIELDS_ROW_ID = "board.team-fields";

const ROSTER_KEY = "mattstack.roster";

/** Each team field of the old file, and the key the board reads it from now. */
const FIELD_KEYS: ReadonlyArray<readonly [field: string, key: string]> = [
  ["gitlabHost", "board.gitlabHost"],
  ["projects", "board.projects"],
  ["members", ROSTER_KEY],
  ["title", "board.title"],
  ["botUsernames", "board.botUsernames"],
  ["ticketPrefixes", "board.ticketPrefixes"],
  ["slack", "board.slack"],
  ["doctorSkill", "board.doctorSkill"],
  ["tabs", "board.tabs"],
  ["triage.doctorSkill", "board.triage.doctorSkill"],
];

const BASE = {
  id: BOARD_TEAM_FIELDS_ROW_ID,
  kind: "tool" as const,
  title: "Old board settings",
  why: "Your board reads its team settings from your team's settings now, not from its old file.",
  required: false,
  recheck: "on-activate" as const,
};

type FileProbes = Pick<Probes, "home" | "env" | "exists" | "readFile">;

export interface BoardTeamFieldsOpts {
  solo: boolean;
  /** The active team's name; null when the Mac has none yet. */
  team: string | null;
  isSet?: (key: string) => boolean;
  extraRoots?: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldValue(c: Record<string, unknown>, field: string): unknown {
  if (field !== "triage.doctorSkill") return c[field];
  return isObject(c.triage) ? c.triage.doctorSkill : undefined;
}

function readOldFile(p: FileProbes, extraRoots: string[]): { file: string; parsed: Record<string, unknown> } | null {
  const file = [...new Set(boardRoots(p, extraRoots))].map((root) => join(root, "config.json.imported")).find((f) => p.exists(f));
  if (!file) return null;
  const raw = p.readFile(file);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? { file, parsed } : null;
  } catch {
    return null;
  }
}

function shown(p: FileProbes, file: string): string {
  return file.startsWith(`${p.home}/`) ? `~${file.slice(p.home.length)}` : file;
}

function commandSteps(keys: string[], scope: string, team: string): string[] {
  const sets = keys.filter((key) => key !== ROSTER_KEY).map((key) => `rt settings set ${key} <value> ${scope}`);
  const invite = `For the roster (${ROSTER_KEY}), invite each person: rt team invite --handle <username> --teams ${team}`;
  return keys.includes(ROSTER_KEY) ? [...sets, invite] : sets;
}

export function boardTeamFieldsRow(p: FileProbes, opts: BoardTeamFieldsOpts): Row | null {
  const old = readOldFile(p, opts.extraRoots ?? sourceBoardRoots());
  if (!old) return null;
  const isSet = opts.isSet ?? ((key: string) => !unwritten(key));
  const missing = FIELD_KEYS.filter(([field, key]) => fieldValue(old.parsed, field) !== undefined && !isSet(key));
  if (missing.length === 0) return null;

  const fields = missing.map(([field]) => field).join(", ");
  const keys = missing.map(([, key]) => key);
  const tail = [`The old values are in ${shown(p, old.file)}`, "Then run: rt setup status"];

  if (opts.solo) {
    return row({
      ...BASE,
      status: "needs-you",
      detail: `Your old board file sets ${fields}. Only a team's settings hold these, and this Mac has no team`,
      action: {
        type: "steps",
        label: "Show steps…",
        steps: [
          "Only a team's settings hold these, and this Mac has no team yet",
          "Start one: rt team create <name> --remote <url>",
          ...commandSteps(keys, "--scope team", "<team>"),
          ...tail,
        ],
      },
    });
  }

  const team = opts.team ?? "<team>";
  return row({
    ...BASE,
    status: "needs-you",
    detail: `Your old board file sets ${fields}, which your team's settings do not. A team admin sets them`,
    action: {
      type: "steps",
      label: "Show steps…",
      steps: [
        `Ask your team's owner or an org admin to set these for ${opts.team ? `the ${opts.team} team` : "your team"}`,
        ...commandSteps(keys, `--scope team --team ${team}`, team),
        ...tail,
      ],
    },
  });
}

/** A throw here would reach buildGroup's catch and replace every tools row, so the row reports its own error. */
export function boardTeamFieldsRowFor(
  p: Pick<Probes, "home" | "env" | "exists" | "readFile">,
  opts: Omit<BoardTeamFieldsOpts, "team"> & { teamFor: () => string | null },
): Row | null {
  try {
    return boardTeamFieldsRow(p, { ...opts, team: opts.solo ? null : opts.teamFor() });
  } catch (err) {
    return row({ ...BASE, status: "error", detail: `Could not check your old board settings: ${err instanceof Error ? err.message : String(err)}` });
  }
}
