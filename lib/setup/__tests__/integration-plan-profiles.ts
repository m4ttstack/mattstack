/**
 * The setup plan for each supported harness profile, as the tray decodes it.
 * `lib/setup/fixtures/integration-plans.json` is this module's output; the
 * tray's checks read that file, and `integration-plan-fixtures.test.ts`
 * fails when what the tray asserts drifts from the plan rt composes.
 */
import type { HarnessId, Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { PolicyInstallPlan, PolicyReview } from "../../agent-integrations/codex/policy-install.ts";
import { enabledIntegrations, storedIntegrationScopes } from "../../agent-integrations/preferences.ts";
import type { Action, Plan, Row } from "../contract.ts";
import { composePlan } from "../plan.ts";
import type { SecretPresence } from "../validators/accounts.ts";
import { fakeProbes, missing, ok, type ExecScript } from "./fakes.ts";

/** `absent` is a Mac that never stored a list: the switch is on and the set is read as an upgrade reads it. */
export const PROFILES = ["claude-only", "codex-only", "both", "none", "absent"] as const;
export type Profile = (typeof PROFILES)[number];

/** The rows whose copy the tray's checks and UI tests read. */
export const HARNESS_ROW_IDS: ReadonlySet<string> = new Set([
  "tool.claude", "tool.plugins", "tool.linear-mcp", "tool.codex", "tool.codex-mcp", "tool.codex-policy", "tool.integrations",
]);

const CODEX_HOME = "/Users/member/.codex";
const HOOK_PROGRAM = "/Users/member/.mattstack/rt/codex-policy/bin/" + "e".repeat(64) + "/rt";

/** A Mac whose rt hooks are in Codex and wait on review, so the fixture carries the sheet's payload. */
const CODEX_REVIEW: PolicyReview = {
  id: "cp-5f0c2a9e4b7d1c3e8a6f0b2d4c6e8a1f",
  codexHome: CODEX_HOME,
  hooksPath: `${CODEX_HOME}/hooks.json`,
  configPath: `${CODEX_HOME}/config.toml`,
  executable: HOOK_PROGRAM,
  digest: "e".repeat(64),
  commands: [],
  hooks: [
    { event: "PreToolUse", key: `${CODEX_HOME}/hooks.json:pre_tool_use:0:0`, command: `'${HOOK_PROGRAM}' agent policy-hook --installation mac-1 --event PreToolUse`, hash: `sha256:${"1".repeat(64)}` },
    { event: "Stop", key: `${CODEX_HOME}/hooks.json:stop:0:0`, command: `'${HOOK_PROGRAM}' agent policy-hook --installation mac-1 --event Stop`, hash: `sha256:${"2".repeat(64)}` },
  ],
};
const codexPolicy = async (): Promise<Outcome<PolicyInstallPlan>> => ({
  ok: true,
  data: { stage: "hooks", reviews: [CODEX_REVIEW], hooksPath: CODEX_REVIEW.hooksPath } as unknown as PolicyInstallPlan,
});

const ENABLED: Record<Exclude<Profile, "absent">, HarnessId[]> = {
  "claude-only": ["claude"],
  "codex-only": ["codex"],
  both: ["claude", "codex"],
  none: [],
};

function enabledFor(profile: Profile): HarnessId[] {
  if (profile !== "absent") return ENABLED[profile];
  if (storedIntegrationScopes().length > 0) throw new Error("the absent profile needs a settings store with no agent.integrations");
  return enabledIntegrations();
}

/**
 * Every Mac-level requirement reads ready, so each profile's `canInstall`
 * turns on its harness rows alone. Codex-only leaves Claude uninstalled, so
 * the fixture proves a missing Claude never gates that Mac.
 */
function execFor(profile: Profile): ExecScript {
  return (argv) => {
    if (argv[0] === "sw_vers") return ok("15.6");
    if (argv[0] === "uname" && argv[1] === "-m") return ok("arm64");
    if (argv[0] === "herdr" && argv[1] === "--version") return ok("herdr 0.9.2");
    if (argv[0] === "herdr" && argv[1] === "integration") return ok("claude: current\ncodex: current\n");
    if (argv[0] === "claude" && profile === "codex-only") return missing("claude");
    if (argv[0] === "claude" && argv[1] === "--version") return ok("2.1.283 (Claude Code)");
    if (argv[0] === "claude" && argv[1] === "auth") return ok(JSON.stringify({ loggedIn: true }));
    if (argv[0] === "claude" && argv[1] === "plugin") return ok("[]");
    if (argv[0] === "codex" && argv[1] === "--version") return ok("codex-cli 0.160.0");
    return ok();
  };
}

const GRANTED = {
  fda: { status: "granted" }, notifications: { status: "authorized" }, loginItems: { status: "enabled" },
};

/** Both flavors' bundles, since which one rt looks for depends on how it was started. */
const APP_DIRS = { "/Applications/mattstack.app": [], "/Applications/mattstack-dev.app": [] };

const secrets: SecretPresence = { async has() { return null; } };

/** `tool.editor` lists the editor apps in /Applications and `tool.flavor` and `tool.app` read how rt was started; no probe seam fakes them. */
function pinMachineReads(r: Row): Row {
  if (r.id === "tool.editor") return { ...r, status: "missing", detail: "<read from this Mac>" };
  if (r.id === "tool.flavor" || r.id === "tool.app") return { ...r, detail: "<read from this Mac>" };
  return r;
}

export async function composeProfile(profile: Profile): Promise<Plan> {
  const probes = fakeProbes({
    exec: execFor(profile),
    dirs: APP_DIRS,
    tray: (async (path: string) => (path === "/permissions" ? { status: 200, json: GRANTED } : { status: 0, json: null })) as never,
  });
  const plan = await composePlan({
    p: probes, secrets, ci: false, mode: "plan", orgs: [], waived: [],
    integrations: { switchOn: true, enabled: enabledFor(profile) }, codexPolicy,
  });
  return {
    ...plan,
    at: "2026-10-09T00:00:00.000Z",
    groups: plan.groups.map((g) => ({ ...g, rows: g.rows.map(pinMachineReads) })),
  };
}

export async function composeProfiles(): Promise<Record<Profile, Plan>> {
  const out = {} as Record<Profile, Plan>;
  for (const profile of PROFILES) out[profile] = await composeProfile(profile);
  return out;
}

/**
 * What the tray asserts about a plan: its gates, each row's machine fields,
 * and the copy of the harness rows. Copy elsewhere in the plan can change
 * without touching the fixture.
 */
export function trayView(plan: Plan): unknown {
  return {
    canInstall: plan.canInstall,
    requiredMissing: plan.requiredMissing,
    finishBlockedBy: plan.finishBlockedBy,
    rows: plan.groups.flatMap((g) => g.rows).map((r) => ({
      id: r.id,
      required: r.required,
      status: r.status,
      finishGated: r.finishGated ?? false,
      waivable: r.waivable ?? r.finishGated ?? false,
      action: r.action?.type ?? null,
      ...(HARNESS_ROW_IDS.has(r.id) && {
        copy: { title: r.title, why: r.why, detail: r.detail, optionalNote: r.optionalNote, label: r.action?.label ?? null, steps: (r.action as { steps?: string[] } | null)?.steps ?? null },
      }),
      ...(r.action?.type === "choose-harnesses" && { harnessChoice: harnessChoice(r.action) }),
      ...(r.action?.type === "review-codex-hooks" && { codexReview: { verb: r.action.verb, subtitle: r.action.subtitle ?? null, footnote: r.action.footnote ?? null, review: r.action.review } }),
    })),
  };
}

/** What the tray's harness picker opens on and runs. */
function harnessChoice(a: Extract<Action, { type: "choose-harnesses" }>): unknown {
  return { verb: a.verb, options: a.options.map((o) => o.id), enabled: a.enabled, defaultHarness: a.defaultHarness, subtitle: a.subtitle ?? null, footnote: a.footnote ?? null };
}
