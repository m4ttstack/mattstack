import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupForm, type FormDeps } from "../setup-form.ts";
import { finalizePlan, row, type Plan, type Row } from "../../lib/setup/contract.ts";
import { readSetupState, type SetupRun } from "../../lib/setup/state.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

const STATE = "/fake-home/.mattstack/rt/setup-state.json";

function deps(o: { run?: SetupRun; plan?: Plan } = {}) {
  const lines: string[] = [];
  const files: Record<string, string> = o.run ? { [STATE]: JSON.stringify({ v: 2, run: o.run }) } : {};
  const d: FormDeps = {
    probes: fakeProbes({ home: "/fake-home", files }),
    secrets: { has: async () => null },
    json: (v) => lines.push(JSON.stringify(v)),
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    orgs: () => [],
    ...(o.plan ? { plan: async () => o.plan! } : {}),
  };
  return { d, lines };
}

const NOW = new Date("2026-01-01T00:00:00.000Z");

function r(id: string, status: Row["status"], detail: string, over: Partial<Row> = {}): Row {
  return row({ id, kind: id.startsWith("perm.") ? "permission" : "tool", title: id, why: `why ${id}`, required: true, status, detail, ...over });
}

function plan(rows: Row[]): Plan {
  return finalizePlan({ slug: "", name: "", mode: "none" }, [{ id: "tools", title: "Tools", rows }], NOW);
}

const CLEAR = plan([r("tool.claude", "ready", "Claude Code 2.1.0, signed in"), r("tool.shell", "ready", "zsh", { finishGated: true, waivable: false })]);
const ENDED_OK: SetupRun = { startedAt: "2025-12-31T23:40:00.000Z", done: ["home.init", "verify"], endedAt: "2025-12-31T23:50:00.000Z", ok: true };

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ExitSentinel) return err.code;
    throw err;
  }
}

let quiet: CapturedOut;
beforeEach(() => {
  quiet = capturePlain();
});
afterEach(() => quiet.restore());

describe("rt setup form", () => {
  test("--section macos --json prints the envelope with only the macos section", async () => {
    const t = deps();
    expect(await exitCode(() => setupForm(["--section", "macos", "--json"], {}, t.d))).toBeUndefined();
    expect(t.lines).toHaveLength(1);
    const body = JSON.parse(t.lines[0]!);
    expect(body).toMatchObject({ contract: 1, at: "2026-01-01T00:00:00.000Z" });
    expect(body.sections.macos).toHaveLength(3);
    expect(body.sections).not.toHaveProperty("connect");
  });

  test("an unknown section is a usage error", async () => {
    const t = deps();
    expect(await exitCode(() => setupForm(["--section", "elsewhere", "--json"], {}, t.d))).toBe(2);
    expect(JSON.parse(t.lines[0]!).error).toMatchObject({ code: "bad-section" });
    const human = deps();
    expect(await exitCode(() => setupForm(["--section", "elsewhere"], {}, human.d))).toBe(2);
    expect(quiet.stderr()).toStartWith("Pick a part of setup");
  });

  test("human output prints one line per row", async () => {
    const t = deps();
    await setupForm(["--section", "macos"], {}, t.d);
    const lines = quiet.stdout().trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Full Disk Access");
    expect(lines[2]).toContain("Fancy URLs");
  });

  test("no --section prints every section, the stage and home", async () => {
    const t = deps({ plan: CLEAR });
    await setupForm(["--json"], {}, t.d);
    const body = JSON.parse(t.lines[0]!);
    expect(Object.keys(body.sections)).toEqual(["macos", "invite", "restore", "connect", "thisMac"]);
    expect(body.stage).toBe("macos");
    expect(body.path).toBeNull();
    expect(body.paused).toBeNull();
    expect(body.home).toEqual({ label: "Open the board", url: "https://board.mattstack" });
  });
});

describe("rt setup form finishes setup once nothing blocks it", () => {
  const finishedAt = (t: ReturnType<typeof deps>) => readSetupState(t.d.probes).finishedAt;

  test("fixing the last leftover after an ok run finishes setup at the next read", async () => {
    const t = deps({ run: ENDED_OK, plan: CLEAR });
    await setupForm(["--json"], {}, t.d);
    expect(finishedAt(t)).toBe("2026-01-01T00:00:00.000Z");
    const body = JSON.parse(t.lines[0]!);
    expect(body.stage).toBe("ready");
    expect(body.home).toEqual({ label: "Open the console", url: "https://console.mattstack" });
  });

  test("denied notifications left in requiredMissing never stop the form finishing", async () => {
    const denied = plan([r("perm.notifications", "needs-you", "Denied"), r("tool.claude", "ready", "Claude Code 2.1.0, signed in")]);
    expect(denied.requiredMissing).toEqual(["perm.notifications"]);
    const t = deps({ run: ENDED_OK, plan: denied });
    await setupForm(["--json"], {}, t.d);
    expect(finishedAt(t)).toBeDefined();
    expect(JSON.parse(t.lines[0]!).stage).toBe("ready");
  });

  test("a section read never finishes setup", async () => {
    for (const section of ["macos", "invite", "restore", "connect", "this-mac"]) {
      const t = deps({ run: ENDED_OK, plan: CLEAR });
      await setupForm(["--section", section, "--json"], {}, t.d);
      expect(finishedAt(t)).toBeUndefined();
      expect(JSON.parse(t.lines[0]!).stage).toBeNull();
    }
  });

  test("a run that ended failed is never finished by the form", async () => {
    const failed: SetupRun = { ...ENDED_OK, ok: false, failed: { step: "repos.clone", detail: "Couldn't clone acme-api" } };
    const t = deps({ run: failed, plan: CLEAR });
    await setupForm(["--json"], {}, t.d);
    expect(finishedAt(t)).toBeUndefined();
    expect(JSON.parse(t.lines[0]!).paused).toMatchObject({ step: "repos.clone", title: "Couldn't clone your repos", detail: "Couldn't clone acme-api" });
  });

  test("Finish blocked after an ok run stays unfinished", async () => {
    const blocked = plan([r("tool.shell", "needs-you", "rt does not recognize your shell", { finishGated: true, waivable: false })]);
    const t = deps({ run: ENDED_OK, plan: blocked });
    await setupForm(["--json"], {}, t.d);
    expect(finishedAt(t)).toBeUndefined();
  });
});
