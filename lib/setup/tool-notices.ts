/**
 * Tells a member on a finished Mac once about a newly required tool, from the
 * daemon's post-pull hook. ~/.mattstack/rt/tool-notices.json holds what was
 * said, apart from setup-state.json: updateSetupState has no lock, and a daemon
 * write during a run could lose a migration id.
 */

import { dirname, join } from "path";
import { integrationDef } from "./integrations.ts";
import { intentPath, orgRefFromIntent } from "./intent.ts";
import type { Probes } from "./probes.ts";
import { readPackRequirements, type ToolRequirement } from "./requirements.ts";
import { isSetupFinished, readSetupState, type SetupRun } from "./state.ts";
import { discoverOrgs } from "./team-settings.ts";
import { SETUP_UPDATE_CATEGORY } from "./update.ts";
import { lockHeldByLiveRun, updateLockPath } from "./update-lock.ts";
import { dedupeTeamTools, teamToolRow } from "./validators/tools.ts";

export interface ToolNotices {
  pending: string[];
  told: string[];
  acked: string[];
}

interface MissingTool {
  name: string;
  title: string;
}

export function toolNoticesPath(home: string): string {
  return join(home, ".mattstack", "rt", "tool-notices.json");
}

function nameList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

export function readToolNotices(p: Pick<Probes, "readFile" | "home">): ToolNotices {
  const raw = p.readFile(toolNoticesPath(p.home));
  if (raw === null) return { pending: [], told: [], acked: [] };
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof ToolNotices, unknown>> | null;
    return { pending: nameList(value?.pending), told: nameList(value?.told), acked: nameList(value?.acked) };
  } catch {
    return { pending: [], told: [], acked: [] };
  }
}

export function writeToolNotices(p: Pick<Probes, "writeFile" | "mkdirp" | "rename" | "home">, value: ToolNotices): void {
  const path = toolNoticesPath(p.home);
  p.mkdirp(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  p.writeFile(tmp, JSON.stringify(value));
  p.rename(tmp, path);
}

function listTitles(titles: string[]): string {
  return titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

/** A name must read missing twice running before it notifies, because a false result reaches every member at once. */
export function toolNotice(missing: MissingTool[], record: ToolNotices): { notice: { title: string; message: string } | null; record: ToolNotices } {
  const told = record.told.filter((name) => !record.acked.includes(name));
  const unsaid = missing.filter((tool) => !told.includes(tool.name));
  const due = unsaid.filter((tool) => record.pending.includes(tool.name));
  const next: ToolNotices = {
    pending: unsaid.filter((tool) => !record.pending.includes(tool.name)).map((tool) => tool.name),
    told: [...told, ...due.map((tool) => tool.name)],
    acked: [],
  };
  if (due.length === 0) return { notice: null, record: next };
  const notice = due.length === 1
    ? { title: `Your team needs ${due[0]!.title}`, message: "Open setup to install it" }
    : { title: `Your team needs ${due.length} new tools`, message: listTitles(due.map((tool) => tool.title)) };
  return { notice, record: next };
}

function toolTitle(tool: ToolRequirement): string {
  return tool.connect && "integration" in tool.connect ? integrationDef(tool.connect.integration).title : tool.name;
}

function setupIsRunning(p: Probes, run: SetupRun | undefined): boolean {
  return (run !== undefined && run.endedAt === undefined) || p.exists(intentPath(p.home)) || lockHeldByLiveRun(updateLockPath(p.home));
}

/** The org setup reads, through setup's own rule: one record file per Mac, so a pull of any other clone must not touch it. */
function setupOrg(p: Probes): string {
  return orgRefFromIntent(null, discoverOrgs(p)).slug;
}

/** A tool the team dropped is forgotten even if Done never ran, so it notifies again when it comes back. */
function withoutDroppedTools(record: ToolNotices, required: ToolRequirement[]): ToolNotices {
  return { ...record, told: record.told.filter((name) => required.some((tool) => tool.name === name)) };
}

export async function runToolNotices(p: Probes, slug: string, notify: (title: string, message: string, id: string) => void): Promise<void> {
  const state = readSetupState(p);
  if (!isSetupFinished(state) || setupIsRunning(p, state.run) || setupOrg(p) !== slug) return;

  const reqs = readPackRequirements(p, slug);
  const required = dedupeTeamTools(reqs).filter((tool) => !tool.optional);
  const missing: MissingTool[] = [];
  for (const tool of required) {
    const row = await teamToolRow(p, tool, false);
    if (row.status === "missing") missing.push({ name: tool.name, title: toolTitle(tool) });
  }

  const record = readToolNotices(p);
  // A file that did not read says nothing about what was dropped, and pruning on it would re-notify every member once it is fixed.
  const current = reqs.some((req) => req.orgError || req.error) ? record : withoutDroppedTools(record, required);
  const { notice, record: next } = toolNotice(missing, current);
  // Written before the send: this runs every pull interval, so a record that will not write would otherwise repeat the notice forever.
  writeToolNotices(p, next);
  if (!notice) return;
  const names = next.told.filter((name) => !record.told.includes(name)).sort();
  try {
    notify(notice.title, notice.message, `${SETUP_UPDATE_CATEGORY}:tools:${names.join(",")}`);
  } catch (err) {
    writeToolNotices(p, record);
    throw err;
  }
}
