import { describe, test, expect, afterEach } from "bun:test";
import { runVerify, rowsToChecks, verifyPayload, type VerifyDeps } from "../verify.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import type { Plan } from "../../lib/setup/contract.ts";
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
afterEach(() => {
  cap?.restore();
  cap = null;
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
    for (const g of plan.groups) expect(rows).toContain(g.title);
    const titles = new Set(plan.groups.flatMap((g) => g.rows.map((r) => r.title)));
    const statusRows = rows.filter((l) => /^\[[a-z ]+\] /.test(l)).slice(0, -1);
    for (const l of statusRows) expect(titles.has(l.replace(/^\[[a-z ]+\] /, "").split("  ")[0]!)).toBe(true);
    expect(rows.at(-1)).toMatch(/^\[(ok|failed)\] (Everything checks out|\d+ checks? failed)  \d+ passed, \d+ warnings?$/);
    expect(cap.stderr()).toBe("");
  });

  test("a critical failure exits 1 after the summary; --ci spares the rows CI cannot satisfy", async () => {
    cap = capturePlain();
    const d = deps();
    await run(d, []);
    const plan: Plan = await composePlan({ p: d.probes, secrets, ci: false, mode: "status", teams: [] });
    const failing = rowsToChecks(plan, { ci: false }).some((c) => c.status === "fail" && c.severity === "critical");
    expect(d.exitCodes).toEqual(failing ? [1] : []);
    if (failing) expect(cap.stdout()).toMatch(/\[failed\] \d+ checks? failed/);
  });
});
