import { afterAll, describe, expect, test } from "bun:test";
import { closeStateDb } from "../../state/index.ts";
import { finalizePlan, type Plan } from "../contract.ts";
import { composeForm } from "../form.ts";
import { composePlan } from "../plan.ts";
import { readPackRequirements } from "../requirements.ts";
import { signInTools } from "../sign-in-tools.ts";
import { readSetupState } from "../state.ts";
import { PORTLESS_LAUNCHD_PLIST, PROXY_VERSION_PATH } from "../steps/services.ts";
import { fakeProbes, fakeTray, ok, type ExecScript } from "./fakes.ts";

afterAll(() => closeStateDb());

const HOME = "/fake-home";
const ROOT = `${HOME}/.mattstack/orgs/acme`;
const ORG_FILE = `${ROOT}/mattstack/org/requirements.jsonc`;
const TEAM_FILE = `${ROOT}/mattstack/teams/widgets/plugin/requirements.jsonc`;
const RUN = { startedAt: "2026-10-01T00:00:00.000Z", done: [], endedAt: "2026-10-01T00:10:00.000Z", ok: true };
const FINISHED = { finishedAt: "2026-10-01T00:11:00.000Z", run: RUN, installRanAt: RUN.startedAt };

const WIDGET = { name: "widget-cli", why: "Builds the widgets", install: { brew: "widget-cli" } };
const DOPPLER = { name: "doppler", why: "Pulls your dev secrets", connect: { integration: "doppler" } };

const secrets = { async has() { return null; } };
const tray = fakeTray({ "GET /permissions": () => ({ status: 200, json: { fda: { status: "granted" }, notifications: { status: "authorized" }, loginItems: { status: "enabled" } } }) });

function execMissing(...missing: string[]): ExecScript {
  return (argv) => {
    if (missing.includes(argv[0]!)) return { code: 127, stdout: "", stderr: "" };
    if (argv[0] === "sw_vers") return ok("15.6");
    if (argv[0] === "git" && argv[1] === "--version") return ok("git version 2.50.1");
    if (argv[0] === "herdr" && argv[1] === "integration") return ok("claude: current\n");
    if (argv[0] === "herdr") return ok("0.8.0");
    if (argv[0] === "claude" && argv[1] === "auth") return ok(JSON.stringify({ loggedIn: true }));
    if (argv[0] === "claude") return ok("1.2.3");
    if (argv[0] === "brew") return ok("Homebrew 4.0.0");
    return ok();
  };
}

function mac(opts: { orgTools: unknown[]; teamFile?: unknown; state?: Record<string, unknown>; missing?: string[] }) {
  return fakeProbes({
    home: HOME,
    exec: execMissing(...(opts.missing ?? ["widget-cli"])),
    tray,
    dirs: { [`${HOME}/.mattstack/orgs`]: ["acme"], [`${ROOT}/mattstack/teams`]: ["widgets"] },
    files: {
      [PORTLESS_LAUNCHD_PLIST]: "<plist/>",
      [PROXY_VERSION_PATH]: "0.9.0",
      [`${HOME}/.portless/ca.pem`]: "pem",
      "/opt/homebrew/bin/brew": "",
      [`${HOME}/.mattstack/rt/repo-root.json`]: JSON.stringify({ root: `${HOME}/code` }),
      [`${ROOT}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }] }),
      [ORG_FILE]: JSON.stringify({ tools: opts.orgTools, integrations: [] }),
      ...(opts.teamFile ? { [TEAM_FILE]: JSON.stringify(opts.teamFile) } : {}),
      [`${HOME}/.mattstack/user/settings.user.jsonc`]: JSON.stringify({ "mattstack.activeTeam": "widgets" }),
      [`${HOME}/.mattstack/rt/teams/acme.json`]: JSON.stringify({ forgeUsername: "dev1" }),
      [`${HOME}/.mattstack/rt/setup-state.json`]: JSON.stringify({ v: 2, homeBackup: { mode: "local" }, ...(opts.state ?? FINISHED) }),
    },
  });
}

const statusPlan = (p: ReturnType<typeof mac>) => composePlan({ p, secrets, ci: false, mode: "status", orgs: ["acme"] });

/** The real plan's rows, narrowed to the team's tools: the stage reads whether anything else blocks, and a fixture Mac is not a fully set up one. */
const teamToolsOnly = (p: ReturnType<typeof mac>) => async (mode: "plan" | "status"): Promise<Plan> => {
  const real = await composePlan({ p, secrets, ci: false, mode, orgs: ["acme"] });
  const groups = real.groups.map((g) => ({ ...g, rows: g.rows.filter((r) => r.id.startsWith("tool.team.")) })).filter((g) => g.rows.length > 0);
  return finalizePlan(real.team, groups, new Date("2026-11-03T00:00:00.000Z"));
};

describe("an org file through a real composePlan", () => {
  test("a team with no pack file gets the org's tool and no pack row", async () => {
    const p = mac({ orgTools: [WIDGET] });
    const plan = await statusPlan(p);
    expect(plan.requiredMissing).toContain("tool.team.widget-cli");
    expect(plan.groups.flatMap((g) => g.rows).filter((r) => r.id.startsWith("pack."))).toEqual([]);
  });

  test("a team with a pack file keeps its own tools and gains the org's", async () => {
    const p = mac({ orgTools: [WIDGET], teamFile: { tools: [{ name: "jq", why: "json" }], integrations: [] } });
    const plan = await statusPlan(p);
    const ids = plan.groups.flatMap((g) => g.rows).map((r) => r.id);
    expect(ids).toContain("tool.team.jq");
    expect(plan.requiredMissing).toContain("tool.team.widget-cli");
  });

  test("a team that names the tool replaces the org's entry", async () => {
    const p = mac({ orgTools: [WIDGET], teamFile: { tools: [{ ...WIDGET, optional: true }], integrations: [] } });
    const plan = await statusPlan(p);
    expect(plan.requiredMissing).not.toContain("tool.team.widget-cli");
  });

  test("a team's excludeOrg removes the row", async () => {
    const p = mac({ orgTools: [WIDGET], teamFile: { tools: [], integrations: [], excludeOrg: ["widget-cli"] } });
    const plan = await statusPlan(p);
    expect(plan.groups.flatMap((g) => g.rows).map((r) => r.id)).not.toContain("tool.team.widget-cli");
  });

  test("an org tool with a sign-in draws its tool and account rows", async () => {
    const p = mac({ orgTools: [DOPPLER], missing: ["doppler"] });
    const plan = await statusPlan(p);
    const rows = plan.groups.flatMap((g) => g.rows).filter((r) => r.id === "account.doppler" || r.id === "tool.team.doppler");
    expect(rows.map((r) => [r.id, r.status, r.required])).toEqual([["account.doppler", "invalid", false], ["tool.team.doppler", "missing", true]]);
    expect(plan.requiredMissing).toContain("tool.team.doppler");
    expect(signInTools(readPackRequirements(p, "acme")).map((t) => t.name)).toEqual(["doppler"]);
  });
});

describe("orgNotice against a real plan", () => {
  const MALFORMED = { why: "No name" };

  test("a broken org file sets orgNotice on a whole read", async () => {
    const p = mac({ orgTools: [WIDGET, MALFORMED] });
    const plan = await statusPlan(p);
    const row = plan.groups.flatMap((g) => g.rows).find((r) => r.id === "org.requirements");
    const form = await composeForm(p, { secrets, orgs: ["acme"] });
    expect(form.orgNotice).toEqual({ title: "Your org's setup file has an error. Ask an admin to fix it", detail: row!.detail });
    expect(form.orgNotice?.detail).toBe("tools[1] is malformed, skipped");
  });

  test("a section read carries no orgNotice", async () => {
    const p = mac({ orgTools: [WIDGET, MALFORMED] });
    const form = await composeForm(p, { sections: ["connect"], secrets, orgs: ["acme"] });
    expect("orgNotice" in form).toBe(false);
  });

  test("no org error sets no orgNotice key", async () => {
    const p = mac({ orgTools: [WIDGET] });
    const form = await composeForm(p, { secrets, orgs: ["acme"] });
    expect("orgNotice" in form).toBe(false);
  });
});

describe("the tools stage against real rows", () => {
  test("a finished Mac lands on tools with the merged org tool", async () => {
    const p = mac({ orgTools: [WIDGET] });
    const form = await composeForm(p, { secrets, orgs: ["acme"], plan: teamToolsOnly(p) });
    expect(form.stage).toBe("tools");
    expect(form.sections.tools?.map((r) => r.id)).toEqual(["tool.team.widget-cli"]);
  });

  test("a first run ending ok with only that tool open records Finish and lands on tools", async () => {
    const p = mac({ orgTools: [WIDGET], state: { run: RUN, installRanAt: RUN.startedAt } });
    expect(readSetupState(p).finishedAt).toBeUndefined();
    const form = await composeForm(p, { secrets, orgs: ["acme"], plan: teamToolsOnly(p) });
    expect(form.stage).toBe("tools");
    expect(readSetupState(p).finishedAt).toBeDefined();
  });
});
