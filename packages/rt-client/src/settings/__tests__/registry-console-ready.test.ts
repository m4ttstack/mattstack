import { describe, expect, test } from "bun:test";
import { allDefs } from "../../index.ts";

type Schema = { title?: string; description?: string; properties?: Record<string, Schema>; items?: Schema | Schema[]; additionalProperties?: Schema | boolean; anyOf?: Schema[]; oneOf?: Schema[] };

function unannotated(schema: Schema, path: string, out: string[]): string[] {
  for (const [name, sub] of Object.entries(schema.properties ?? {})) {
    if (!sub.title && !sub.description) out.push(`${path}.${name}`);
    unannotated(sub, `${path}.${name}`, out);
  }
  for (const s of Array.isArray(schema.items) ? schema.items : schema.items ? [schema.items] : []) unannotated(s, `${path}[]`, out);
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") unannotated(schema.additionalProperties, `${path}{}`, out);
  for (const s of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) unannotated(s, path, out);
  return out;
}

/** Keys with no zod schema yet. Shrink only: a key that gains a schema leaves this list. */
const NO_SCHEMA_YET: readonly string[] = [
  "agent.claude.account",
  "agent.claude.effort",
  "agent.claude.extraArgs",
  "agent.claude.model",
  "agent.claude.yolo",
  "agent.codex.effort",
  "agent.codex.extraArgs",
  "agent.codex.model",
  "agent.codex.yolo",
  "agent.provider",
  "board.agent.account",
  "board.agent.effort",
  "board.agent.model",
  "board.defaultMember",
  "board.doctorSkill",
  "board.gateGraceMinutes",
  "board.gitlabHost",
  "board.staleAfterDays",
  "board.title",
  "board.triage.doctorSkill",
  "board.triageMaxConcurrent",
  "boxscore.defaultRange",
  "chat.handle",
  "chat.herdrWorkspace",
  "chat.humanHandle",
  "chat.push.provider",
  "chat.push.target",
  "chat.viewerUrl",
  "ci.watch.budgetMinutes",
  "herd.watchdog.backstopMins",
  "herd.watchdog.enabled",
  "herd.watchdog.fastMins",
  "herd.watchdog.midRunTrustAccept",
  "herd.watchdog.nagMins",
  "herd.watchdog.notifyHuman",
  "herd.watchdog.notifyQuietMins",
  "herd.watchdog.retryMins",
  "herd.watchdog.shepherdFastMins",
  "mattstack.activeTeam",
  "mattstack.appPath",
  "panes.relocationAutoAccept",
  "rt.apiPort",
  "rt.daemonPath",
  "rt.gates.escalationTtlMinutes",
  "rt.logLevel",
  "rt.logRetentionDays",
  "rt.runsPruneDays",
  "rt.ui.background",
  "rt.worktreeReadyApproval",
  "skills.writingStyle",
];
/** Keys with an object property that has no title or description yet. Shrink only. */
const UNANNOTATED_YET: readonly string[] = [
  "board.codeowners",
  "board.cwds",
  "board.peerAsks",
  "board.reReview",
  "board.slack",
  "board.triage",
  "board.workspaces",
  "boxscore.sizeBand",
  "deck.access",
  "deck.apps",
  "deck.platform",
  "gitq.board",
  "gitq.forges",
  "gitq.workSlots",
  "mattstack.integrations",
  "mattstack.org",
  "mattstack.roster",
  "mattstack.tracking",
  "rt.branchNaming",
  "rt.cron",
  "rt.dopplerTemplate",
  "rt.gitStatus",
  "rt.homeSnapshot",
  "rt.hooks",
  "rt.ignoredMrs",
  "rt.integrations",
  "rt.intercepts",
  "rt.notifications",
  "rt.notify.eventBridges",
  "rt.presets",
  "rt.repoTracking",
  "rt.roles",
  "rt.runaway",
  "rt.sdmEnrichment",
  "rt.sync",
  "rt.teamSnapshot",
  "rt.variations",
  "rt.workspacePrefs",
  "rt.worktreeApp",
  "rt.worktrees",
  "sdm.carriers",
  "sdm.resources",
];

const ADD_A_KEY = "See the rt:settings skill's contract (item 2) and docs/settings-architecture.md, 'Adding a key (the checklist)'.";

describe("every setting is console-ready", () => {
  const defs = allDefs();
  test("every key has a zod schema", () => {
    const missing = defs.filter((d) => !d.schema).map((d) => d.key);
    expect({ newWithoutSchema: missing.filter((k) => !NO_SCHEMA_YET.includes(k)), note: ADD_A_KEY }).toEqual({ newWithoutSchema: [], note: ADD_A_KEY });
    expect(NO_SCHEMA_YET.filter((k) => !missing.includes(k))).toEqual([]);
  });
  test("every object property carries a title or description", () => {
    const gaps = new Map(defs.filter((d) => d.schema).map((d) => [d.key, unannotated(d.schema as Schema, d.key, [])] as const));
    const withGaps = [...gaps].filter(([, g]) => g.length > 0).map(([k]) => k);
    expect({ newGaps: [...gaps].filter(([k, g]) => g.length > 0 && !UNANNOTATED_YET.includes(k)).map(([, g]) => g).flat(), note: ADD_A_KEY }).toEqual({ newGaps: [], note: ADD_A_KEY });
    expect(UNANNOTATED_YET.filter((k) => !withGaps.includes(k))).toEqual([]);
  });
});
