/**
 * The one write gate: validateValue (type + path guard, the resolver's own
 * skip rule), then the layer schema, then the merged result. The merged
 * check refuses only a write that makes a passing merge fail, so a layer
 * already broken elsewhere never blocks an unrelated edit.
 */

import { checkSchema, firstIssueText, hasSchema, type SchemaIssue } from "./schema.ts";
import { validateValue, type SettingDef, type SettingScope } from "./registry-machinery.ts";
import { currentMergedValue, listStoreRepoIdentities, mergedValueWith } from "./resolve.ts";
import { currentOrg, listTeamFolders } from "./stores.ts";
import { directoryIssues } from "./team-directory.ts";

export type WriteRefusalKind = "repoOnly" | "type" | "pathGuard" | "schema";
export type WriteVerdict = { ok: true } | { ok: false; kind: WriteRefusalKind; reason: string; issues: SchemaIssue[] };

export function validateWrite(def: SettingDef, value: unknown, opts: { scope: SettingScope; repoIdentity?: string; team?: string }): WriteVerdict {
  if (def.repoOnly && !opts.repoIdentity)
    return { ok: false, kind: "repoOnly", reason: `"${def.key}" is repo-only: name the repo (--repo) instead of writing a global value`, issues: [] };
  const unguarded: SettingDef = { ...def, pathGuardFields: undefined };
  const typed = validateValue(unguarded, value);
  if (!typed.ok) return { ok: false, kind: "type", reason: typed.reason, issues: [] };
  if (opts.scope !== "machine") {
    const guarded = validateValue(def, value);
    if (!guarded.ok) return { ok: false, kind: "pathGuard", reason: guarded.reason, issues: [] };
  }
  if (!hasSchema(def)) return { ok: true };

  const layerIssues = checkSchema(def, value, { layer: true });
  if (layerIssues.length > 0) return { ok: false, kind: "schema", reason: firstIssueText(layerIssues), issues: layerIssues };
  const semantic = SEMANTIC_CHECKS[def.key]?.(value);
  if (semantic) return { ok: false, kind: "schema", reason: semantic, issues: [] };

  for (const team of viewsToCheck(opts.scope)) {
    const contexts: (string | null)[] =
      opts.repoIdentity !== undefined ? [opts.repoIdentity] : def.repoScoped ? [null, ...listStoreRepoIdentities({ team })] : [null];
    for (const repoIdentity of contexts) {
      const after = mergedValueWith(def, { scope: opts.scope, repoIdentity: opts.repoIdentity, team: opts.team, value }, { repoIdentity, expand: false, team });
      // A shared write with no store to land in patches nothing, so `after` is the current merge,
      // undefined only when nothing is set anywhere; setSetting refuses that write afterwards.
      if (after === undefined) continue;
      const afterIssues = checkSchema(def, after, { layer: false });
      if (afterIssues.length === 0) continue;
      const view = opts.scope === "team" && opts.team !== undefined ? opts.team : team;
      const before = currentMergedValue(def, { repoIdentity, expand: false, team: view });
      if (before === undefined || checkSchema(def, before, { layer: false }).length === 0) {
        return { ok: false, kind: "schema", reason: `merged value${whereText(repoIdentity, team)} would fail: ${firstIssueText(afterIssues)}`, issues: afterIssues };
      }
    }
  }
  return { ok: true };
}

/** Rules a JSON Schema cannot state, such as uniqueness across a record. */
const SEMANTIC_CHECKS: Record<string, (value: unknown) => string | null> = {
  "mattstack.directory": (value) => {
    const dup = directoryIssues(value as never).duplicates[0];
    return dup ? `two teams claim #${dup.channel} as their code owners channel: ${dup.teams.join(", ")}` : null;
  },
};

/**
 * The team views a write is judged in; undefined is the active team. An org
 * write lands under every team, so it is judged in each team folder's view
 * and in the view of members on no team.
 */
function viewsToCheck(scope: SettingScope): (string | null | undefined)[] {
  const org = scope === "org" ? currentOrg() : null;
  return org === null ? [undefined] : [...listTeamFolders(org), null];
}

function whereText(repoIdentity: string | null, team: string | null | undefined): string {
  const repo = repoIdentity ? ` for ${repoIdentity}` : "";
  if (team === undefined) return repo;
  const who = team === null ? "members on no team" : `team ${team}`;
  return repoIdentity ? `${repo} in ${who}` : ` for ${who}`;
}
