import { describe, test, expect, spyOn } from "bun:test";
import { setupPlan, setupStatus, type SetupDeps } from "../setup.ts";
import type { Plan } from "../../lib/setup/contract.ts";
import { writeIntent } from "../../lib/setup/intent.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";
import { fakeProbes, missing, ok } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import { listTeams } from "../../lib/settings/stores.ts";
import { capturePlain, realJson } from "./helpers/json-line.ts";

/** setupPlan/setupStatus call process.exit(2) on a user-actionable error; the sentinel throw stops it from actually killing the test process, and the caller reads the exit code off the spy. */
async function runExpectingExit(fn: () => Promise<void>): Promise<number | undefined> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return undefined;
  } catch {
    return exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    exitSpy.mockRestore();
  }
}

function fakeSecrets(): SecretPresence {
  return { async has() { return null; } };
}

const readyExec: ExecScript = (argv) => {
  if (argv[0] === "sw_vers") return ok("15.6");
  return ok();
};

function captureDeps(): SetupDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    probes: fakeProbes({ exec: readyExec }),
    secrets: fakeSecrets(),
    print: (s) => lines.push(s),
    json: (v) => lines.push(JSON.stringify(v)),
    lines,
  };
}

describe("setupPlan", () => {
  test("--json prints exactly one line that parses to a Plan with contract:1", async () => {
    const deps = captureDeps();
    await setupPlan(["--json"], {}, deps);

    expect(deps.lines).toHaveLength(1);
    const plan = JSON.parse(deps.lines[0]!) as Plan;
    expect(plan.contract).toBe(1);
    expect(plan.groups.map((g) => g.id)).toEqual(["mac", "accounts", "access", "tools"]);
  });

  test("human mode prints the mac group's section title", async () => {
    const cap = capturePlain();
    try {
      await setupPlan([], {}, captureDeps());
      expect(cap.stdout()).toContain("Your Mac (");
    } finally {
      cap.restore();
    }
  });

  test("--team naming an unknown team --json: exit 2 with the contract's error envelope on stdout (deps.print)", async () => {
    const deps = captureDeps();
    const exitCode = await runExpectingExit(() => setupPlan(["--team", "ghost", "--json"], {}, deps));

    expect(exitCode).toBe(2);
    expect(deps.lines).toHaveLength(1);
    const payload = JSON.parse(deps.lines[0]!) as { contract: 1; error: { code: string; message: string } };
    expect(payload.contract).toBe(1);
    expect(payload.error.code).toBe("unknown-team");
    expect(payload.error.message).toContain("ghost");
  });

  test("--team naming an unknown team, human mode: exit 2 with a one-line rt-prefixed message", async () => {
    const deps = captureDeps();
    const exitCode = await runExpectingExit(() => setupPlan(["--team", "ghost"], {}, deps));

    expect(exitCode).toBe(2);
    expect(deps.lines).toHaveLength(1);
    expect(deps.lines[0]).toStartWith("rt setup: ");
    expect(deps.lines[0]).toContain("ghost");
  });
});

describe("setupStatus", () => {
  test("--json prints exactly one line that parses to a Plan", async () => {
    const deps = captureDeps();
    await setupStatus(["--json"], {}, deps);

    expect(deps.lines).toHaveLength(1);
    const plan = JSON.parse(deps.lines[0]!) as Plan;
    expect(plan.contract).toBe(1);
  });

  test("human mode puts a next callout naming `rt setup <integration> connect` under each missing account", async () => {
    const cap = capturePlain();
    try {
      const lines: string[] = [];
      const p = fakeProbes({
        exec: (argv) => (argv[0] === "sw_vers" ? ok("15.6") : argv[0] === "gh" ? missing("gh") : ok()),
      });
      writeIntent(p, {
        v: 1,
        at: "2026-08-21T00:00:00.000Z",
        mode: "create",
        team: { slug: "acme", name: "Acme", remote: "https://github.com/o/r.git", others: false },
      });
      const deps: SetupDeps = { probes: p, secrets: fakeSecrets(), print: (s) => lines.push(s), json: (v) => lines.push(JSON.stringify(v)) };

      await setupStatus([], {}, deps);

      expect(cap.stdout()).toContain("[needs you] GitHub");
      const rows = cap.stdout().split("\n");
      const github = rows.findIndex((l) => l.startsWith("[needs you] GitHub"));
      expect(rows[github + 1]).toBe("  next: rt setup github connect");
    } finally {
      cap.restore();
    }
  });

  test("plan mode prints no connect callout", async () => {
    const cap = capturePlain();
    try {
      const p = fakeProbes({
        exec: (argv) => (argv[0] === "sw_vers" ? ok("15.6") : argv[0] === "gh" ? missing("gh") : ok()),
      });
      writeIntent(p, {
        v: 1,
        at: "2026-08-21T00:00:00.000Z",
        mode: "create",
        team: { slug: "acme", name: "Acme", remote: "https://github.com/o/r.git", others: false },
      });
      const deps: SetupDeps = { probes: p, secrets: fakeSecrets(), print: () => {}, json: () => {} };

      await setupPlan([], {}, deps);

      expect(cap.stdout()).not.toContain("next: rt setup");
    } finally {
      cap.restore();
    }
  });

  test("human status omits the connect callouts entirely when nothing is missing", async () => {
    const cap = capturePlain();
    try {
      await setupStatus([], {}, captureDeps());
      expect(cap.stdout()).not.toContain("next: rt setup");
    } finally {
      cap.restore();
    }
  });
});

// setupInteractive (the real TTY walk, not the old setupStatus alias) is
// covered in commands/__tests__/setup-apply.test.ts.

describe("setupStatus Finish line", () => {
  test("human status prints the Finish line right after the Install summary", async () => {
    const cap = capturePlain();
    try {
      await setupStatus([], {}, captureDeps());
      const rows = cap.stdout().trimEnd().split("\n");
      const install = rows.findIndex((l) => l.includes("Install can run") || l.includes("Install is waiting on"));
      expect(install).toBeGreaterThan(0);
      // The fake home has no home repo, so the writing-style row blocks Finish here.
      expect(rows[install + 1]).toBe("[needs you] Finish is waiting on  Writing style");
    } finally {
      cap.restore();
    }
  });

  test("setup plan (human) prints no Finish line", async () => {
    const cap = capturePlain();
    try {
      await setupPlan([], {}, captureDeps());
      expect(cap.stdout()).not.toContain("Finish");
    } finally {
      cap.restore();
    }
  });
});

describe("setup plan --json bytes", () => {
  test("stdout is exactly JSON.stringify(plan) plus a newline, for the same plan composePlan returns", async () => {
    const cap = capturePlain();
    try {
      const probes = fakeProbes({ exec: readyExec });
      const deps: SetupDeps = { probes, secrets: fakeSecrets(), print: () => {}, json: realJson };
      await setupPlan(["--json"], {}, deps);
      const plan = await composePlan({ p: probes, secrets: fakeSecrets(), ci: process.env.CI === "true", mode: "plan", teams: listTeams() });
      expect(cap.stdout()).toBe(JSON.stringify(plan) + "\n");
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
    }
  });
});
