import { readSection } from "../../packages/rt-client/src/settings/migrate.ts";
import { orgSettingsPath, teamSettingsPath } from "../../packages/rt-client/src/settings/paths.ts";
import { getDef } from "../../packages/rt-client/src/settings/registry-machinery.ts";
import { readStore } from "../../packages/rt-client/src/settings/stores.ts";
import { directoryIssues, normalizeChannel, type DirectoryTeam, type TeamDirectory } from "../../packages/rt-client/src/settings/team-directory.ts";
import { pruneStoreName, setSetting, unsetSetting } from "../../lib/settings/write.ts";

type Tab = { source?: { kind?: string }; slackChannel?: string } & Record<string, unknown>;
export type Write = { key: string; value: unknown | undefined };
type Values = Record<string, unknown>;

const slackOf = (v: Values) => v["board.slack"] as ({ channel?: string } & Values) | undefined;
/** board.tabs is versioned; a store may hold it under either name. */
const tabsOf = (v: Values) => readSection(getDef("board.tabs")!, v, { layer: false }).value as Tab[] | undefined;
/** The directory holds bare names in their own case; legacy values may carry a leading "#". */
const bare = (channel: string | undefined) => channel?.trim().replace(/^#/, "") || undefined;

export function entryFromTeamStore(values: Values, orgValues: Values): DirectoryTeam | null {
  const linear = (values["mattstack.integrations"] as { linear?: { teamKey?: string } } | undefined)?.linear?.teamKey;
  const review = bare(slackOf(values)?.channel ?? slackOf(orgValues)?.channel);
  const codeOwners = bare((tabsOf(values) ?? []).find((t) => t.source?.kind === "codeowners" && bare(t.slackChannel))?.slackChannel);
  if (!linear && !review && !codeOwners) return null;
  return {
    ...(linear ? { linear: { team: linear } } : {}),
    ...(review || codeOwners
      ? {
          slack: {
            ...(codeOwners ? { codeOwnersChannel: codeOwners } : {}),
            ...(review ? { channels: [{ name: review, kind: "review" }] } : {}),
          },
        }
      : {}),
  };
}

/** The writes that delete one store's moved values; an emptied object is unset. */
export function withoutRetired(values: Values, entry: DirectoryTeam): Write[] {
  const writes: Write[] = [];
  const slack = slackOf(values);
  if (slack && "channel" in slack) {
    const { channel: _c, ...rest } = slack;
    writes.push({ key: "board.slack", value: Object.keys(rest).length ? rest : undefined });
  }
  const integrations = values["mattstack.integrations"] as ({ linear?: Values } & Values) | undefined;
  if (integrations?.linear && "teamKey" in integrations.linear) {
    const { teamKey: _k, ...linear } = integrations.linear;
    const { linear: _l, ...rest } = integrations;
    const next = Object.keys(linear).length ? { ...rest, linear } : rest;
    writes.push({ key: "mattstack.integrations", value: Object.keys(next).length ? next : undefined });
  }
  const own = entry.slack?.codeOwnersChannel;
  const tabs = tabsOf(values);
  const isOwn = (t: Tab) => t.source?.kind === "codeowners" && !!t.slackChannel && !!own && normalizeChannel(t.slackChannel) === normalizeChannel(own);
  if (tabs?.some(isOwn)) {
    writes.push({
      key: "board.tabs",
      value: tabs.map((t) => {
        if (!isOwn(t)) return t;
        const { slackChannel: _s, ...rest } = t;
        return rest;
      }),
    });
  }
  const prefixes = values["board.ticketPrefixes"] as string[] | undefined;
  const team = entry.linear?.team;
  if (team && prefixes?.length === 1 && prefixes[0]!.toUpperCase() === team.toUpperCase()) {
    writes.push({ key: "board.ticketPrefixes", value: undefined });
  }
  return writes;
}

export function apply(org: string, writes: Write[], scope: "org" | "team", opts: { team?: string } = {}): number {
  for (const w of writes) {
    if (w.value === undefined) unsetSetting(w.key, scope, opts);
    else setSetting(w.key, w.value, scope, opts);
    if (w.key === "board.tabs") {
      const file = scope === "team" ? teamSettingsPath(org, opts.team!) : orgSettingsPath(org);
      for (const older of readSection(getDef("board.tabs")!, readStore(file).global, { layer: false }).older)
        pruneStoreName("board.tabs", older.storeName, scope, { ...opts, force: true });
    }
  }
  return writes.length;
}

export interface DirectoryPlan {
  /** The directory to write, or null when no team gained an entry. */
  directory: TeamDirectory | null;
  /** Writes per team store; only teams with a folder and a directory entry. */
  teamWrites: Record<string, Write[]>;
  /** Writes to the org store: board.slack.channel removed when present. */
  orgWrites: Write[];
  /** Plain lines for the plan printout, one per entry added and per store changed. */
  report: string[];
}

/** A move the planner declines by policy, as opposed to a bug. */
export class DirectoryRefusal extends Error {
  constructor(
    message: string,
    readonly why?: string,
  ) {
    super(message);
  }
}

/** The settings keys a write deletes, named the way a person reads them. */
function removedKeys(write: Write): string {
  switch (write.key) {
    case "board.slack":
      return "board.slack.channel";
    case "mattstack.integrations":
      return "mattstack.integrations.linear.teamKey";
    case "board.tabs":
      return "board.tabs[].slackChannel";
    default:
      return write.key;
  }
}

const removeLine = (store: string, writes: Write[]) => `${store}: remove ${writes.map(removedKeys).join(", ")}`;

/** Pure: reads no store and writes none. Throws DirectoryRefusal when the existing directory already has a duplicate code owners channel. */
export function planDirectoryMove(orgValues: Values, teamValues: Record<string, Values>): DirectoryPlan {
  const existing = (orgValues["mattstack.directory"] ?? {}) as TeamDirectory;
  const duplicate = directoryIssues(existing).duplicates[0];
  if (duplicate) {
    throw new DirectoryRefusal(
      `Two teams claim #${duplicate.channel} as their code owners channel`,
      `${duplicate.teams.join(" and ")} both claim it. Fix the team directory, then run this again.`,
    );
  }
  const teams = { ...(existing.teams ?? {}) };
  const claimed = new Set(Object.values(teams).flatMap((t) => (t.slack?.codeOwnersChannel ? [normalizeChannel(t.slack.codeOwnersChannel)] : [])));
  const report: string[] = [];
  let added = 0;
  for (const [team, values] of Object.entries(teamValues)) {
    if (teams[team]) continue;
    const entry = entryFromTeamStore(values, orgValues);
    if (!entry) continue;
    const own = entry.slack?.codeOwnersChannel;
    if (own && claimed.has(normalizeChannel(own))) continue;
    if (own) claimed.add(normalizeChannel(own));
    teams[team] = entry;
    report.push(`directory: add ${team}`);
    added++;
  }
  const teamWrites: Record<string, Write[]> = {};
  for (const [team, entry] of Object.entries(teams)) {
    const values = teamValues[team];
    if (!values) continue;
    const writes = withoutRetired(values, entry);
    if (writes.length === 0) continue;
    teamWrites[team] = writes;
    report.push(removeLine(`team ${team}`, writes));
  }
  const orgSlack = slackOf(orgValues);
  const orgWrites = orgSlack && "channel" in orgSlack ? withoutRetired({ "board.slack": orgSlack }, {}) : [];
  if (orgWrites.length > 0) report.push(removeLine("org", orgWrites));
  return { directory: added > 0 ? { ...existing, teams } : null, teamWrites, orgWrites, report };
}
