/**
 * Pack requirements reader: parses the active team's pack requirements at
 * teams/<org>/mattstack/teams/<team>/packs/<team>/requirements.jsonc, the
 * only pack this Mac installs, so `rt setup` can fold pack-declared
 * tools/integrations into the plan.
 */

import { join } from "path";
import type { Integration } from "./contract.ts";
import { INTEGRATIONS } from "./integrations.ts";
import { stripJsonc } from "../jsonc.ts";
import { activeTeamFor } from "../team/active-team.ts";
import type { Probes } from "./probes.ts";
import { orgDirUnder } from "../rt-paths.ts";

export interface ToolRequirement {
  name: string;
  floor?: string;
  why: string;
  install?: { brew?: string; url?: string };
  connect?: { integration: Integration } | { verb: string[]; label: string };
  optional?: boolean;
}

export interface PackRequirements {
  pack: string;
  tools: ToolRequirement[];
  integrations: Integration[];
  chrome?: { required: boolean; signedIntoApp?: string };
  workType?: string;
  error?: string;
}

const REQUIREMENTS_FILE = "requirements.jsonc";

const KNOWN_INTEGRATION_IDS = new Set<Integration>(Object.keys(INTEGRATIONS) as Integration[]);

/** The active team's pack requirements; [] when this Mac has no active team or the pack declares none. */
export function readPackRequirements(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">, org: string, team: string | null = activeTeamFor(p, org).team): PackRequirements[] {
  if (team === null) return [];
  const file = join(orgDirUnder(p.home, org), "mattstack", "teams", team, "packs", team, REQUIREMENTS_FILE);
  if (!p.exists(file)) return [];
  const text = p.readFile(file);
  // A file that is there but cannot be read is reported, never skipped.
  if (text === null) return [{ pack: team, tools: [], integrations: [], error: `could not read ${file}` }];
  return [parseRequirements(team, text)];
}

/** Malformed entries and a dropped connect.integration are both reported through `error`, never silently — `index`/`packName` name which tool a pack author needs to fix, since two skipped entries in one file would otherwise render as identical, unactionable text. */
function parseToolRequirement(t: unknown, index: number, packName: string): { tool: ToolRequirement | null; error?: string } {
  if (typeof t !== "object" || t === null) return { tool: null, error: `pack "${packName}": tools[${index}] is malformed, skipped` };
  const o = t as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.why !== "string") {
    return { tool: null, error: `pack "${packName}": tools[${index}] is malformed, skipped` };
  }

  const result: ToolRequirement = { name: o.name, why: o.why };
  if (typeof o.floor === "string") result.floor = o.floor;
  if (typeof o.optional === "boolean") result.optional = o.optional;

  if (typeof o.install === "object" && o.install !== null) {
    const i = o.install as Record<string, unknown>;
    const install: { brew?: string; url?: string } = {};
    if (typeof i.brew === "string") install.brew = i.brew;
    if (typeof i.url === "string") install.url = i.url;
    result.install = install;
  }

  let connectError: string | undefined;
  if (typeof o.connect === "object" && o.connect !== null) {
    const c = o.connect as Record<string, unknown>;
    if (typeof c.integration === "string") {
      if (KNOWN_INTEGRATION_IDS.has(c.integration as Integration)) {
        result.connect = { integration: c.integration as Integration };
      } else {
        connectError = `pack "${packName}": tool "${result.name}" declares unknown integration "${c.integration}"`;
      }
    } else if (Array.isArray(c.verb) && c.verb.every((v) => typeof v === "string") && typeof c.label === "string") {
      result.connect = { verb: c.verb as string[], label: c.label };
    }
  }

  return { tool: result, error: connectError };
}

/** stripJsonc + shape validation. Unknown integration ids and malformed tool entries are dropped, not fatal — the pack still yields whatever parsed, plus `error` naming what was dropped. Totally unparsable JSON or a non-object root yields empty tools/integrations with `error` set. */
export function parseRequirements(packName: string, text: string): PackRequirements {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonc(text));
  } catch (e) {
    return { pack: packName, tools: [], integrations: [], error: `invalid JSON: ${(e as Error).message}` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { pack: packName, tools: [], integrations: [], error: "requirements.jsonc must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  const tools: ToolRequirement[] = [];
  if (Array.isArray(obj.tools)) {
    obj.tools.forEach((t, index) => {
      const { tool, error } = parseToolRequirement(t, index, packName);
      if (tool) tools.push(tool);
      if (error) errors.push(error);
    });
  }

  const integrations: Integration[] = [];
  if (Array.isArray(obj.integrations)) {
    for (const id of obj.integrations) {
      if (typeof id === "string" && KNOWN_INTEGRATION_IDS.has(id as Integration)) integrations.push(id as Integration);
      else errors.push(`unknown integration "${String(id)}"`);
    }
  }

  const result: PackRequirements = { pack: packName, tools, integrations };

  if (typeof obj.chrome === "object" && obj.chrome !== null) {
    const c = obj.chrome as Record<string, unknown>;
    if (typeof c.required === "boolean") {
      result.chrome = { required: c.required, ...(typeof c.signedIntoApp === "string" ? { signedIntoApp: c.signedIntoApp } : {}) };
    }
  }
  if (typeof obj.workType === "string") result.workType = obj.workType;
  if (errors.length > 0) result.error = errors.join("; ");

  return result;
}
