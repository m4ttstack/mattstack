import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { runVerify, rowsToChecks, verifyBlocks, verifyPayload, type VerifyDeps } from "../verify.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import type { Plan, Row } from "../../lib/setup/contract.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import { capturePlain } from "./helpers/json-line.ts";

const readyExec: ExecScript = (argv) => (argv[0] === "sw_vers" ? ok("15.6") : ok());
const secrets: SecretPresence = { async has() { return null; } };

function deps(): VerifyDeps & { exitCodes: number[] } {
  const exitCodes: number[] = [];
  return {
    probes: fakeProbes({ exec: readyExec }),
    secrets,
    teams: () => [],
    compose: composePlan,
    exit: ((code: number) => { exitCodes.push(code); throw new Error("exit sentinel"); }) as VerifyDeps["exit"],
    exitCodes,
  };
}

async function run(d: VerifyDeps, args: string[]): Promise<void> {
  try {
    await runVerify(args, {}, d);
  } catch (err) {
    if (!(err instanceof Error && err.message === "exit sentinel")) throw err;
  }
}

let cap: ReturnType<typeof capturePlain> | null = null;
let ambientCi: string | undefined;
beforeEach(() => {
  ambientCi = process.env.CI;
  delete process.env.CI;
});
afterEach(() => {
  cap?.restore();
  cap = null;
  if (ambientCi === undefined) delete process.env.CI;
  else process.env.CI = ambientCi;
});

describe("rt verify --json", () => {
  test("stdout is exactly the two-space-indented payload for the plan composePlan returns", async () => {
    cap = capturePlain();
    const d = deps();
    await run(d, ["--json"]);
    const plan: Plan = await composePlan({ p: d.probes, secrets, ci: false, mode: "status", teams: [] });
    const expected = verifyPayload(rowsToChecks(plan, { ci: false }), plan);
    expect(cap.stdout()).toBe(JSON.stringify(expected, null, 2) + "\n");
    expect(Object.keys(expected)).toEqual(["passed", "summary", "checks", "plan"]);
    expect(cap.stderr()).toBe("");
  });
});

describe("rt verify for a person", () => {
  test("one section per group, every row by title, and a summary line last", async () => {
    cap = capturePlain();
    const d = deps();
    await run(d, []);
    const plan: Plan = await composePlan({ p: d.probes, secrets, ci: false, mode: "status", teams: [] });
    const rows = cap.stdout().trimEnd().split("\n");
    for (const g of plan.groups) {
      if (g.rows.length > 0) expect(rows).toContain(g.title);
      else expect(rows).not.toContain(g.title);
    }
    const titles = new Set(plan.groups.flatMap((g) => g.rows.map((r) => r.title)));
    const statusRows = rows.filter((l) => /^\[[a-z ]+\] /.test(l)).slice(0, -1);
    for (const l of statusRows) expect(titles.has(l.replace(/^\[[a-z ]+\] /, "").split("  ")[0]!)).toBe(true);
    expect(rows.at(-1)).toMatch(/^(\[ok\] Everything checks out|\[failed\] \d+ checks? failed|\[needs you\] (1 check needs|\d+ checks need) attention)  \d+ passed, \d+ warnings?$/);
    expect(cap.stderr()).toBe("");
  });

  test("a required account that is missing needs you and exits 1; --ci spares it and exits 0", async () => {
    const fixture = plan([{ id: "accounts", title: "Accounts", rows: [row({ id: "account.forge", kind: "account", title: "Forge account", status: "missing", detail: "No account connected" })] }]);
    const composed: boolean[] = [];
    const withFixture = (): VerifyDeps & { exitCodes: number[] } => ({ ...deps(), compose: async (i) => (composed.push(i.ci), fixture) });

    cap = capturePlain();
    const strict = withFixture();
    await run(strict, []);
    expect(strict.exitCodes).toEqual([1]);
    expect(cap.stdout()).toBe("Accounts\n[needs you] Forge account  No account connected\n\n[needs you] 1 check needs attention  0 passed, 0 warnings\n");
    cap.restore();

    cap = capturePlain();
    const spared = withFixture();
    await run(spared, ["--ci"]);
    expect(spared.exitCodes).toEqual([]);
    expect(cap.stdout()).toBe("Accounts\n[needs you] Forge account  No account connected\n\n[ok] Everything checks out  0 passed, 1 warning\n");
    expect(composed).toEqual([false, true]);
  });
});

describe("rt verify draws each required row the way rt setup status does", () => {
  async function verifyOne(r: Row): Promise<{ stdout: string; exitCodes: number[] }> {
    const fixture = plan([{ id: "mac", title: "Your Mac", rows: [r] }]);
    const d: VerifyDeps & { exitCodes: number[] } = { ...deps(), compose: async () => fixture };
    cap = capturePlain();
    await run(d, []);
    const stdout = cap.stdout();
    cap.restore();
    cap = null;
    return { stdout, exitCodes: d.exitCodes };
  }

  test("a row that could not be checked is a warning, and the summary is not coral", async () => {
    const res = await verifyOne(row({ id: "perm.screen", kind: "permission", title: "Screen recording", status: "error", detail: "The helper app is not running" }));
    expect(res.stdout).toBe("Your Mac\n[warning] Screen recording  The helper app is not running\n\n[needs you] 1 check needs attention  0 passed, 0 warnings\n");
    expect(res.exitCodes).toEqual([1]);
  });

  test("a tool that is not set up yet is not yet, and the summary is not coral", async () => {
    const res = await verifyOne(row({ id: "tool.widget", title: "Widget", status: "missing", detail: "Not registered yet" }));
    expect(res.stdout).toBe("Your Mac\n[not yet] Widget  Not registered yet\n\n[needs you] 1 check needs attention  0 passed, 0 warnings\n");
    expect(res.exitCodes).toEqual([1]);
  });

  test("an account that is not connected needs you, and the summary is not coral", async () => {
    const res = await verifyOne(row({ id: "account.forge", kind: "account", title: "Forge account", status: "missing", detail: "No account connected" }));
    expect(res.stdout).toBe("Your Mac\n[needs you] Forge account  No account connected\n\n[needs you] 1 check needs attention  0 passed, 0 warnings\n");
    expect(res.exitCodes).toEqual([1]);
  });

  test("a check that ran and found something wrong is coral, and so is the summary", async () => {
    const res = await verifyOne(row({ id: "tool.widget", title: "Widget", status: "invalid", detail: "Version 1.0 is too old" }));
    expect(res.stdout).toBe("Your Mac\n[failed] Widget  Version 1.0 is too old\n\n[failed] 1 check failed  0 passed, 0 warnings\n");
    expect(res.exitCodes).toEqual([1]);
  });

  test("several checks that need attention take the plural", () => {
    const fixture = plan([
      {
        id: "mac",
        title: "Your Mac",
        rows: [row({ id: "tool.widget", title: "Widget", status: "missing" }), row({ id: "tool.gadget", title: "Gadget", status: "error" })],
      },
    ]);
    expect(renderPlain(verifyBlocks(fixture, { ci: false })).trimEnd().split("\n").at(-1)).toBe("[needs you] 2 checks need attention  0 passed, 0 warnings");
  });
});

function row(r: Partial<Row> & Pick<Row, "id" | "title" | "status">): Row {
  return { kind: "tool", why: "x", required: true, optionalNote: null, detail: "", action: null, recheck: "on-change", ...r };
}

function plan(groups: Plan["groups"]): Plan {
  return { contract: 1, at: "2026-01-01T00:00:00.000Z", team: { slug: "", name: "", mode: "none" }, groups, canInstall: true, requiredMissing: [], finishBlockedBy: [] };
}

describe("verifyBlocks", () => {
  test("a required failure is coral, a row that could not be checked is a warning, and each action's command is a next callout", () => {
    const fixture = plan([
      {
        id: "mac",
        title: "Your Mac",
        rows: [
          row({ id: "tool.widget", title: "Widget", status: "invalid", detail: "Version 1.0 is too old", action: { type: "run", label: "Update", verb: ["tools", "install", "widget"] } }),
          row({ id: "access.mirror", kind: "access", title: "Mirror", required: false, status: "error", detail: "Could not reach the mirror" }),
          row({ id: "tool.git", title: "Git", status: "ready", detail: "2.45" }),
        ],
      },
      {
        id: "accounts",
        title: "Accounts",
        rows: [row({ id: "account.forge", kind: "account", title: "Forge account", required: false, status: "missing", detail: "No account connected", action: { type: "connect", label: "Connect", integration: "github", fields: [] } })],
      },
    ]);
    expect(renderPlain(verifyBlocks(fixture, { ci: false }))).toBe(
      "Your Mac\n" +
        "[failed] Widget  Version 1.0 is too old\n" +
        "  next: rt tools install widget\n" +
        "[warning] Mirror  Could not reach the mirror\n" +
        "[ok] Git  2.45\n" +
        "\n" +
        "Accounts\n" +
        "[needs you] Forge account  No account connected\n" +
        "  next: rt setup github connect\n" +
        "\n" +
        "[failed] 1 check failed  1 passed, 2 warnings\n",
    );
  });

  test("a non-required row never draws coral, whatever its status", () => {
    const statuses = ["missing", "invalid", "error", "needs-you"] as const;
    const fixture = plan([{ id: "tools", title: "Tools", rows: statuses.map((status) => row({ id: `tool.${status}`, title: status, required: false, status })) }]);
    expect(renderPlain(verifyBlocks(fixture, { ci: false }))).not.toContain("[failed]");
  });

  test("a group with no rows prints nothing, not a bare title", () => {
    const fixture = plan([
      { id: "accounts", title: "Accounts", rows: [] },
      { id: "tools", title: "Tools", rows: [row({ id: "tool.git", title: "Git", status: "ready", detail: "2.45" })] },
    ]);
    expect(renderPlain(verifyBlocks(fixture, { ci: false }))).toBe("Tools\n[ok] Git  2.45\n\n[ok] Everything checks out  1 passed, 0 warnings\n");
  });
});
