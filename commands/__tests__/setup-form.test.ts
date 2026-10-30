import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupForm, type FormDeps } from "../setup-form.ts";
import { finalizePlan, row, type Plan, type Row } from "../../lib/setup/contract.ts";
import { readSetupState, type SetupRun } from "../../lib/setup/state.ts";
import { PORTLESS_LAUNCHD_PLIST, PROXY_VERSION_PATH } from "../../lib/setup/steps/services.ts";
import { fakeProbes, fakeTray } from "../../lib/setup/__tests__/fakes.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

const STATE = "/fake-home/.mattstack/rt/setup-state.json";

/** Every screen answered on a Just me Mac: the proxy, its certificate and Homebrew in place, and a folder for new clones chosen. */
const ANSWERED_FILES = {
  [PORTLESS_LAUNCHD_PLIST]: "<plist/>",
  [PROXY_VERSION_PATH]: "0.9.0",
  "/fake-home/.portless/ca.pem": "pem",
  "/opt/homebrew/bin/brew": "",
  "/fake-home/.mattstack/rt/repo-root.json": JSON.stringify({ root: "/fake-home/code" }),
};

function grantedTray(notifications: "authorized" | "denied") {
  return fakeTray({ "GET /permissions": () => ({ status: 200, json: { fda: { status: "granted" }, notifications: { status: notifications }, loginItems: { status: "enabled" } } }) });
}

/**
 * `plan` answers plan mode and `status` (else `plan`) answers status mode. A
 * seeded run carries the Install stamp a real run writes unless `stamped` is false.
 */
function deps(o: { run?: SetupRun; stamped?: boolean; plan?: Plan; status?: Plan; answered?: boolean; notifications?: "authorized" | "denied" } = {}) {
  const lines: string[] = [];
  const state = o.run ? { v: 2, run: o.run, ...(o.stamped === false ? {} : { installRanAt: o.run.startedAt }) } : null;
  const files: Record<string, string> = {
    ...(state ? { [STATE]: JSON.stringify(state) } : {}),
    ...(o.answered ? ANSWERED_FILES : {}),
  };
  const d: FormDeps = {
    probes: fakeProbes({ home: "/fake-home", files, ...(o.answered ? { tray: grantedTray(o.notifications ?? "authorized") } : {}) }),
    secrets: { has: async () => null },
    json: (v) => lines.push(JSON.stringify(v)),
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    orgs: () => [],
    ...(o.plan ? { plan: async (mode) => (mode === "status" ? (o.status ?? o.plan!) : o.plan!) } : {}),
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

const SETTLED = [r("tool.clt", "ready", "Installed"), r("tool.claude", "ready", "Claude Code 2.1.0, signed in"), r("tool.chrome", "ready", "Google Chrome installed")];
const CLEAR = plan([...SETTLED, r("tool.shell", "ready", "zsh", { finishGated: true, waivable: false })]);
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

  test("--section create --forge reads the create screen's rows", async () => {
    const t = deps();
    expect(await exitCode(() => setupForm(["--section", "create", "--forge", "gitlab", "--host", "gitlab.example.com", "--json"], {}, t.d))).toBeUndefined();
    const body = JSON.parse(t.lines[0]!);
    expect(Object.keys(body.sections)).toEqual(["create"]);
    expect(body.sections.create.map((r: { id: string }) => r.id)).toContain("forge.token");
  });

  test("the create section needs --forge naming GitHub or GitLab", async () => {
    for (const args of [["--section", "create"], ["--section", "create", "--forge", "bitbucket"]]) {
      const t = deps();
      expect(await exitCode(() => setupForm([...args, "--json"], {}, t.d))).toBe(2);
      expect(JSON.parse(t.lines[0]!).error).toMatchObject({ code: "bad-forge" });
    }
    const human = deps();
    expect(await exitCode(() => setupForm(["--section", "create"], {}, human.d))).toBe(2);
    expect(quiet.stderr()).toStartWith("Pick where the team's repo goes: github or gitlab");
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
    const t = deps({ run: ENDED_OK, plan: CLEAR, answered: true });
    await setupForm(["--json"], {}, t.d);
    expect(finishedAt(t)).toBe("2026-01-01T00:00:00.000Z");
    const body = JSON.parse(t.lines[0]!);
    expect(body.stage).toBe("ready");
    expect(body.home).toEqual({ label: "Open the console", url: "https://console.mattstack" });
  });

  test("denied notifications left in requiredMissing never stop the form finishing", async () => {
    const denied = plan([r("perm.notifications", "needs-you", "Denied"), ...SETTLED]);
    expect(denied.requiredMissing).toEqual(["perm.notifications"]);
    const t = deps({ run: ENDED_OK, plan: denied, answered: true, notifications: "denied" });
    await setupForm(["--json"], {}, t.d);
    expect(finishedAt(t)).toBeDefined();
    expect(JSON.parse(t.lines[0]!).stage).toBe("ready");
  });

  test("finishing on a read lands where the next read would", async () => {
    const sdm = r("account.sdm", "missing", "No StrongDM account connected yet", {
      action: { type: "connect", label: "Connect", integration: "sdm", fields: [{ name: "email", label: "StrongDM email", secret: false }] },
    });
    const leftover = plan([...SETTLED, sdm]);
    expect(leftover.finishBlockedBy).toEqual([]);
    const t = deps({ run: ENDED_OK, plan: leftover, answered: true });

    await setupForm(["--json"], {}, t.d);
    await setupForm(["--json"], {}, t.d);

    expect(finishedAt(t)).toBe("2026-01-01T00:00:00.000Z");
    const [first, next] = t.lines.map((l) => JSON.parse(l));
    expect(first.sections.macos.map((x: { state: string }) => x.state)).toEqual(["done", "done", "done"]);
    expect(first.sections.connect.find((x: { id: string }) => x.id === "account.sdm")).toMatchObject({ state: "todo" });
    expect([first.stage, next.stage]).toEqual(["connect", "connect"]);
  });

  // Once Install has run, plan mode reads the rows only Install sets up as not required; status mode reads them as required again.
  test("finishing on a read reads the plan the next read will, so a row only the bar fixes still shows", async () => {
    const daemon = (required: boolean) => r("tool.daemon", "missing", "Not running", { required, action: { type: "run", label: "Register services", verb: ["setup", "apply", "--only", "services.register"] } });
    const asPlan = plan([...SETTLED, daemon(false)]);
    const asStatus = plan([...SETTLED, daemon(true)]);
    expect([asPlan.requiredMissing, asPlan.finishBlockedBy, asStatus.requiredMissing]).toEqual([[], [], ["tool.daemon"]]);
    const t = deps({ run: ENDED_OK, plan: asPlan, status: asStatus, answered: true });

    await setupForm(["--json"], {}, t.d);
    await setupForm(["--json"], {}, t.d);

    expect(finishedAt(t)).toBeDefined();
    const [first, next] = t.lines.map((l) => JSON.parse(l));
    expect(first.sections.thisMac.find((x: { id: string }) => x.id === "tool.daemon")).toMatchObject({ state: "todo" });
    expect([first.stage, next.stage]).toEqual(["this-mac", "this-mac"]);
  });

  test("a run record without the Install stamp never finishes setup", async () => {
    const t = deps({ run: ENDED_OK, stamped: false, plan: CLEAR, answered: true });
    await setupForm(["--json"], {}, t.d);
    expect(finishedAt(t)).toBeUndefined();
  });

  test("a section read never finishes setup", async () => {
    for (const section of ["macos", "invite", "restore", "connect", "this-mac"]) {
      const t = deps({ run: ENDED_OK, plan: CLEAR });
      await setupForm(["--section", section, "--json"], {}, t.d);
      expect(finishedAt(t)).toBeUndefined();
      expect(JSON.parse(t.lines[0]!).stage).toBeNull();
    }
    const create = deps({ run: ENDED_OK, plan: CLEAR });
    await setupForm(["--section", "create", "--forge", "github", "--json"], {}, create.d);
    expect(finishedAt(create)).toBeUndefined();
    expect(JSON.parse(create.lines[0]!).stage).toBeNull();
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
