/**
 * The setup plan for each supported harness profile, as the tray decodes it.
 * `lib/setup/fixtures/integration-plans.json` is this module's output; the
 * tray's checks read that file, and `integration-plan-fixtures.test.ts`
 * fails when the plan rt composes drifts from it.
 */
import type { HarnessId } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { Plan, Row } from "../contract.ts";
import { composePlan } from "../plan.ts";
import type { SecretPresence } from "../validators/accounts.ts";
import { fakeProbes, missing, ok, type ExecScript } from "./fakes.ts";

export const PROFILES = ["claude-only", "codex-only", "both", "none"] as const;
export type Profile = (typeof PROFILES)[number];

const ENABLED: Record<Profile, HarnessId[]> = {
  "claude-only": ["claude"],
  "codex-only": ["codex"],
  both: ["claude", "codex"],
  none: [],
};

/** Codex-only leaves Claude uninstalled, so the fixture proves a missing Claude never gates that Mac. */
function execFor(profile: Profile): ExecScript {
  return (argv) => {
    if (argv[0] === "sw_vers") return ok("15.6");
    if (argv[0] === "claude" && profile === "codex-only") return missing("claude");
    if (argv[0] === "claude" && argv[1] === "--version") return ok("2.1.283 (Claude Code)");
    if (argv[0] === "claude" && argv[1] === "auth") return ok(JSON.stringify({ loggedIn: true }));
    if (argv[0] === "claude" && argv[1] === "plugin") return ok("[]");
    if (argv[0] === "codex" && argv[1] === "--version") return ok("codex-cli 0.160.0");
    return ok();
  };
}

const secrets: SecretPresence = { async has() { return null; } };

/** `tool.editor` lists the editor apps in /Applications and `tool.flavor` reads how rt was started; no probe seam fakes either. */
function pinMachineReads(r: Row): Row {
  if (r.id === "tool.editor") return { ...r, status: "missing", detail: "<read from this Mac>" };
  if (r.id === "tool.flavor") return { ...r, detail: "<read from this Mac>" };
  return r;
}

export async function composeProfile(profile: Profile): Promise<Omit<Plan, "at"> & { at: string }> {
  const plan = await composePlan({
    p: fakeProbes({ exec: execFor(profile) }), secrets, ci: false, mode: "plan", orgs: [], waived: [],
    integrations: { switchOn: true, enabled: ENABLED[profile] },
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
