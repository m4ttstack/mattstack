import { readSection } from "../../../packages/rt-client/src/settings/migrate.ts";
import { orgSettingsPath, teamSettingsPath } from "../../../packages/rt-client/src/settings/paths.ts";
import { getDef } from "../../../packages/rt-client/src/settings/registry-machinery.ts";
import { listTeamFolders, readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { directoryIssues, normalizeChannel, type DirectoryTeam, type TeamDirectory } from "../../../packages/rt-client/src/settings/team-directory.ts";
import { pruneStoreName, SettingsOwnershipRefusal, setSetting, unsetSetting } from "../../settings/write.ts";
import { orgLayoutState } from "../../team/org-layout.ts";
import type { MigrationDef } from "./index.ts";

type Tab = { source?: { kind?: string }; slackChannel?: string } & Record<string, unknown>;
type Write = { key: string; value: unknown | undefined };
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

function apply(org: string, writes: Write[], scope: "org" | "team", opts: { team?: string } = {}): number {
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

export const teamDirectoryMigration: MigrationDef = {
  id: "2026-10-08-team-directory",
  title: "Move your teams' channels and Linear keys into the team directory",
  async run(ctx) {
    const layout = orgLayoutState(ctx.p);
    if (layout.kind === "none") return { state: "skipped", detail: "This Mac is in no org" };
    if (layout.kind === "waiting") return { state: "skipped", detail: "Your org has not moved to its new layout yet; nothing to move on this Mac" };
    const org = layout.slug;
    const orgValues = readStore(orgSettingsPath(org)).global;
    const existing = (orgValues["mattstack.directory"] ?? {}) as TeamDirectory;
    const duplicate = directoryIssues(existing).duplicates[0];
    if (duplicate) {
      return {
        state: "failed",
        detail: `Teams ${duplicate.teams.join(" and ")} both claim #${duplicate.channel} as their code owners channel. Fix the team directory and the move runs at the next update`,
      };
    }
    const teams = { ...(existing.teams ?? {}) };
    const claimed = new Set(Object.values(teams).flatMap((t) => (t.slack?.codeOwnersChannel ? [normalizeChannel(t.slack.codeOwnersChannel)] : [])));
    const folders = listTeamFolders(org);
    let added = 0;
    for (const team of folders) {
      if (teams[team]) continue;
      const entry = entryFromTeamStore(readStore(teamSettingsPath(org, team)).global, orgValues);
      if (!entry) continue;
      const own = entry.slack?.codeOwnersChannel;
      if (own && claimed.has(normalizeChannel(own))) continue;
      if (own) claimed.add(normalizeChannel(own));
      teams[team] = entry;
      added++;
    }
    let changed = 0;
    try {
      if (added > 0) {
        setSetting("mattstack.directory", { ...existing, teams }, "org");
        changed += added;
      }
      for (const [team, entry] of Object.entries(teams)) {
        if (!folders.includes(team)) continue;
        changed += apply(org, withoutRetired(readStore(teamSettingsPath(org, team)).global, entry), "team", { team });
      }
      const orgSlack = slackOf(orgValues);
      if (orgSlack && "channel" in orgSlack) changed += apply(org, withoutRetired({ "board.slack": orgSlack }, {}), "org");
    } catch (err) {
      if (!(err instanceof SettingsOwnershipRefusal)) throw err;
      if (changed === 0) return { state: "skipped", detail: "Only an org admin's Mac moves the team settings" };
    }
    return changed > 0
      ? { state: "done", detail: `Moved ${changed} ${changed === 1 ? "setting" : "settings"} into the team directory` }
      : { state: "skipped", detail: "Nothing left to move on this Mac" };
  },
};
