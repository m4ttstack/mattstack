import { parse, parseTree, printParseErrorCode, visit, type Node, type ParseError } from "jsonc-parser";
import { nestedTeamPackRel, teamPackRel, teamPackSource } from "../../lib/team/team-pack-path.ts";

export interface MoveInput {
  files: Record<string, string>;
  teams: string[];
  nested: Record<string, string[]>;
  hasPlugin: Record<string, boolean>;
}

export interface MovePlan {
  moves: [from: string, to: string][];
  writes: Record<string, string>;
  report: string[];
}

type Json = Record<string, unknown>;

/** A move the planner declines by policy, as opposed to a bug. */
export class MoveRefusal extends Error {
  constructor(message: string, readonly why: string) {
    super(message);
    this.name = "MoveRefusal";
  }
}

export const ORG_STORE_REL = "mattstack/org/settings.org.jsonc";
export const teamStoreRel = (team: string): string => `mattstack/teams/${team}/settings.team.jsonc`;

/** The file's object, `{}` when absent. A file that is there but does not parse stops the move: rewriting what could be read would lose the rest. */
function objOf(files: Record<string, string>, rel: string): Json {
  const text = files[rel];
  if (text === undefined) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new MoveRefusal(`${rel} is not valid JSONC (${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset})`, "Fix it before moving.");
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new MoveRefusal(`${rel} is not a JSON object`, "Fix it before moving.");
  const check = (node: Node): void => {
    if (node.type === "object") {
      const seen = new Set<string>();
      for (const property of node.children ?? []) {
        const key = String(property.children?.[0]?.value);
        if (seen.has(key)) throw new MoveRefusal(`${rel} has a duplicate key ${key}`, "Fix it before moving.");
        seen.add(key);
      }
    }
    for (const child of node.children ?? []) check(child);
  };
  check(parseTree(text)!);
  return value as Json;
}

function hasComments(text: string): boolean {
  let found = false;
  visit(text, { onComment: () => { found = true; } });
  return found;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bumpPatch(team: string, version: unknown): string {
  const m = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(version) : null;
  if (!m) throw new MoveRefusal(`The ${team} pack's version (${String(version)}) is not x.y.z`, "The script can only bump an x.y.z version. Set one before moving.");
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function rewritePaths(value: unknown, swaps: [string, string][], note: (from: string, to: string) => void): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [from, to] of swaps) {
      // A folder name, not a prefix: `packs/widgets` must not match inside `packs/widgets-extra`.
      const whole = new RegExp(`${escapeRegExp(from)}(?![A-Za-z0-9._-])`, "g");
      const next = out.replace(whole, () => to);
      if (next !== out) {
        note(out, next);
        out = next;
      }
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => rewritePaths(item, swaps, note));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, rewritePaths(v, swaps, note)]));
  }
  return value;
}

export function planMove(input: MoveInput): MovePlan {
  const marker = objOf(input.files, "mattstack/mattstack.jsonc");
  if (marker.role !== "org") throw new MoveRefusal("This is not a mattstack org repo", "mattstack/mattstack.jsonc does not say role: org.");
  const report: string[] = [];
  const moving: string[] = [];
  for (const team of [...input.teams].sort()) {
    const nested = input.nested[team] ?? [];
    if (nested.length === 0) {
      report.push(`${team}: no pack, left alone`);
      continue;
    }
    const strangers = nested.filter((name) => name !== team);
    if (strangers.length > 0) throw new MoveRefusal(`${team} has ${strangers.map((name) => `packs/${name}`).join(", ")}, which the script does not know how to place`, "A team's pack is named after the team.");
    if (input.hasPlugin[team]) throw new MoveRefusal(`${team} has both ${nestedTeamPackRel(team)} and ${teamPackRel(team)}`, "Keep one before moving.");
    const manifestRel = `${nestedTeamPackRel(team)}/.claude-plugin/plugin.json`;
    if (input.files[manifestRel] === undefined) throw new MoveRefusal(`${manifestRel} is missing`, `The script cannot bump the ${team} pack's version without it. Add it before moving.`);
    objOf(input.files, manifestRel);
    moving.push(team);
  }
  if (moving.length === 0) throw new MoveRefusal("There is nothing to move", "Every team's pack is already at plugin/, or the team has none.");
  if (input.files[".claude-plugin/marketplace.json"] === undefined) throw new MoveRefusal(".claude-plugin/marketplace.json is missing", "There is no marketplace entry to point at the moved packs. Restore it before moving.");

  const moves: [string, string][] = [];
  const writes: Record<string, string> = {};
  const swaps: [string, string][] = [];
  const versions = new Map<string, string>();
  for (const team of moving) {
    const from = nestedTeamPackRel(team);
    const to = teamPackRel(team);
    moves.push([from, to]);
    report.push(`move ${from} to ${to}`);
    const manifest = objOf(input.files, `${from}/.claude-plugin/plugin.json`);
    const version = bumpPatch(team, manifest.version);
    versions.set(team, version);
    report.push(`${team}: version ${String(manifest.version)} to ${version}`);
    writes[`${to}/.claude-plugin/plugin.json`] = `${JSON.stringify({ ...manifest, version }, null, 2)}\n`;
    swaps.push([`/${from}`, `/${to}`]);
  }

  const noteRewrite = (before: string, after: string) => report.push(`rewrote ${before} to ${after}`);
  for (const rel of [ORG_STORE_REL, ...input.teams.map(teamStoreRel)]) {
    if (input.files[rel] === undefined) continue;
    const before = objOf(input.files, rel);
    const after = rewritePaths(before, swaps, noteRewrite) as Json;
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    const text = input.files[rel]!;
    const header = text.startsWith("//") ? `${text.split("\n")[0]}\n` : "";
    writes[rel] = `${header}${JSON.stringify(after, null, 2)}\n`;
    if (hasComments(text.slice(header.length))) report.push(`comments in ${rel} are not carried over`);
  }

  const market = objOf(input.files, ".claude-plugin/marketplace.json");
  const entries = Array.isArray(market.plugins) ? (market.plugins as Json[]) : [];
  // `./a/b`, `a/b` and `./a/b/` all name one folder.
  const folderOf = (source: unknown): string | null => (typeof source === "string" ? source.replace(/^\.\//, "").replace(/\/+$/, "") : null);
  const teamFor = (entry: Json): string | null => {
    if (typeof entry.name === "string" && versions.has(entry.name)) return entry.name;
    return moving.find((team) => folderOf(entry.source) === nestedTeamPackRel(team)) ?? null;
  };
  const pointed = new Set<string>();
  const plugins = entries.map((entry) => {
    const team = teamFor(entry);
    if (team === null) return entry;
    pointed.add(team);
    const name = String(entry.name);
    const version = versions.get(team)!;
    if (entry.source !== teamPackSource(team)) report.push(`marketplace: ${name} source ${String(entry.source)} to ${teamPackSource(team)}`);
    if (entry.version !== undefined && entry.version !== version) report.push(`marketplace: ${name} version ${String(entry.version)} to ${version}`);
    return { ...entry, source: teamPackSource(team), ...(entry.version !== undefined ? { version } : {}) };
  });
  for (const entry of plugins) {
    const folder = folderOf(entry.source);
    const team = folder === null ? undefined : moving.find((t) => folder === nestedTeamPackRel(t) || folder.startsWith(`${nestedTeamPackRel(t)}/`));
    if (team !== undefined) throw new MoveRefusal(`The marketplace entry ${String(entry.name)} points inside ${nestedTeamPackRel(team)}`, `The move removes that folder, and the script cannot tell where the entry belongs. Point it at ${teamPackSource(team)} or remove it before moving.`);
  }
  for (const team of moving) if (!pointed.has(team)) report.push(`no marketplace entry for ${team}`);
  if (JSON.stringify(plugins) !== JSON.stringify(entries)) writes[".claude-plugin/marketplace.json"] = `${JSON.stringify({ ...market, plugins }, null, 2)}\n`;

  return { moves, writes, report };
}
