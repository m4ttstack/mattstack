import { describe, test, expect } from "bun:test";
import { applyInstallSatisfiedFlip, composePlan } from "../plan.ts";
import { FINISH_GATED_ROW_IDS, finalizePlan, row, type Group, type Row } from "../contract.ts";
import { WAIVED_NOTE, applyFinishGate } from "../finish-gate.ts";
import { setSetting } from "../../settings/write.ts";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { teamSettingsPath } from "../../rt-paths.ts";
import { UserActionableError } from "../../errors.ts";
import { writeIntent, type SetupIntent } from "../intent.ts";
import type { SecretPresence } from "../validators/accounts.ts";
import { fakeProbes, fakeTray, ok } from "./fakes.ts";
import type { ExecScript } from "./fakes.ts";

function fakeSecrets(stored: Record<string, string> = {}): SecretPresence {
  return {
    async has(domain, key) {
      return stored[`${domain}.${key}`] ?? null;
    },
  };
}

/** Answers every probe the plan.ts validators make with a shape each row reads as "ready" — composePlan itself is under test here, not any one validator's edge cases. */
const readyExec: ExecScript = (argv) => {
  if (argv[0] === "sw_vers") return ok("15.6");
  if (argv[0] === "git" && argv[1] === "--version") return ok("git version 2.50.1");
  if (argv[0] === "herdr" && argv[1] === "integration") return ok("claude: current\n");
  if (argv[0] === "herdr") return ok("0.8.0");
  if (argv[0] === "claude" && argv[1] === "auth") return ok(JSON.stringify({ loggedIn: true }));
  if (argv[0] === "claude") return ok("1.2.3");
  if (argv[0] === "brew") return ok("Homebrew 4.0.0");
  if (argv[0] === "rt") return ok("rt v1.0.0");
  return ok();
};

/** `readyExec` plus a fast-browser on PATH whose doctor reports the extension not loaded. */
const fastBrowserNotLoadedExec: ExecScript = (argv) => {
  if (argv[0] === "/opt/tools/fast-browser" && argv[1] === "doctor") {
    return ok(JSON.stringify({ schemaVersion: 1, ok: false, checks: [{ id: "runtime-checksum", status: "pass" }, { id: "extension-installed", status: "pass" }, { id: "extension-loaded", status: "fail" }, { id: "pairing", status: "pass" }] }));
  }
  return readyExec(argv);
};

const grantedTray = fakeTray({
  "GET /permissions": () => ({
    status: 200,
    json: { fda: { status: "granted" }, notifications: { status: "authorized" }, loginItems: { status: "enabled" } },
  }),
});

function createIntent(): SetupIntent {
  return {
    v: 1,
    at: "2026-08-21T00:00:00.000Z",
    mode: "create",
    team: { slug: "acme", name: "Acme", remote: "https://github.com/o/r.git", others: false },
  };
}

function joinIntent(): SetupIntent {
  return {
    v: 1,
    at: "x",
    mode: "join",
    join: {
      id: "inv1",
      keyB64: "k",
      pointer: {
        v: 1,
        team: "acme",
        name: "Acme",
        // The remote alone would derive "example.com", not "github.com"... proves the pointer's own forge wins.
        remote: "https://example.com/acme/mattstack.git",
        owner: "owner1",
        forge: "github.com",
        createdAt: "x",
      },
    },
  };
}

function restoreIntent(): SetupIntent {
  return { v: 1, at: "2026-08-21T00:00:00.000Z", mode: "restore", restore: { homeRepo: "acme/home" } };
}

describe("composePlan", () => {
  test("no intent, no teams -> 4 groups in contract order, team.mode none, perm.fda ready", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: [] });

    expect(plan.contract).toBe(1);
    expect(plan.groups.map((g) => g.id)).toEqual(["mac", "accounts", "access", "tools"]);
    expect(plan.team).toEqual({ slug: "", name: "", mode: "none" });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    const fda = mac.rows.find((r) => r.id === "perm.fda")!;
    expect(fda.status).toBe("ready");
  });

  test("tray unreachable, daemon tcc reports every repo readable -> perm.fda ready via the daemon fallback", async () => {
    const p = fakeProbes({
      exec: readyExec,
      // Default fakeProbes tray already answers status 0 (unreachable) when not overridden.
      daemon: async (cmd) => (cmd === "tcc:check" ? { ok: true, data: { blocked: [], accessible: ["a", "b"], totalRepos: 2 } } : null),
    });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: [] });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    const fda = mac.rows.find((r) => r.id === "perm.fda")!;
    expect(fda.status).toBe("ready");
    expect(fda.detail).toContain("via the daemon");
  });

  test("create intent -> team ref from the intent, forge derived from its remote, account.github row present", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    writeIntent(p, createIntent());

    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: [] });

    expect(plan.team).toEqual({ slug: "acme", name: "Acme", mode: "create" });
    const accounts = plan.groups.find((g) => g.id === "accounts")!;
    expect(accounts.rows.some((r) => r.id === "account.github")).toBe(true);
  });

  test("join intent -> forge derived from the invite pointer's own forge field, not re-parsed from its remote", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    writeIntent(p, joinIntent());

    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: [] });

    const accounts = plan.groups.find((g) => g.id === "accounts")!;
    expect(accounts.rows.some((r) => r.id === "account.github")).toBe(true);
  });

  // RT-260: composePlan now threads readUserIntegrationOverrides() into accountRows (it never did before this task), so a joined team whose declared switchboard URL matches the user's own confirmed latch must read as a re-check, not a Confirm prompt asking to re-latch the same value.
  test("join intent, team declares switchboard -> latch matching the declared URL offers the re-check action; no latch offers connect", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-switchboard-"));
    process.env.HOME = home;
    try {
      const teamPath = teamSettingsPath("acme");
      mkdirSync(dirname(teamPath), { recursive: true });
      writeFileSync(teamPath, "// team store\n{}\n");
      setSetting("mattstack.integrations", { switchboard: { url: "https://sw.example.com" } }, "team", { team: "acme" });

      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      writeIntent(p, joinIntent());

      const unlatched = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: ["acme"] });
      const unlatchedRow = unlatched.groups.find((g) => g.id === "accounts")!.rows.find((r) => r.id === "account.switchboard")!;
      expect(unlatchedRow.action?.type).toBe("connect");

      setSetting("rt.integrations", { switchboardUrl: "https://sw.example.com" }, "user");
      const latched = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: ["acme"] });
      const latchedRow = latched.groups.find((g) => g.id === "accounts")!.rows.find((r) => r.id === "account.switchboard")!;
      expect(latchedRow.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
    } finally {
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("solo intent, no teams -> no access rows, github optional, fast-browser optional, no team rows, and the existing modes unchanged", async () => {
    // canInstall also needs tool.arch and tool.app ready; readyExec/grantedTray alone leave both unmocked, and neither is solo-specific.
    const soloExec: ExecScript = (argv) => (argv[0] === "uname" ? ok("arm64") : readyExec(argv));
    const p = fakeProbes({ exec: soloExec, tray: grantedTray, dirs: { "/Applications/mattstack.app": [] } });
    writeIntent(p, { v: 1, at: "2026-09-26T00:00:00.000Z", mode: "solo" });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: [] });
    expect(plan.team).toEqual({ slug: "", name: "", mode: "none" });
    expect(plan.groups.find((g) => g.id === "access")!.rows).toEqual([]);
    const accounts = plan.groups.find((g) => g.id === "accounts")!.rows;
    expect(accounts.map((r) => [r.id, r.required])).toEqual([["account.github", false]]);
    const tools = plan.groups.find((g) => g.id === "tools")!.rows;
    expect(tools.find((r) => r.id === "tool.fast-browser")!.required).toBe(false);
    expect(tools.some((r) => r.id.startsWith("team."))).toBe(false);
    expect(plan.canInstall).toBe(true);
  });

  test("create, join and restore intents produce the same rows as before solo existed", async () => {
    // readyExec puts no fast-browser on PATH, so the row's "missing" branch is the one asserted; the pending branches already read required:false in every mode.
    for (const intent of [createIntent(), joinIntent(), restoreIntent()]) {
      const isJoin = intent.mode === "join";
      const p = fakeProbes({
        exec: readyExec,
        tray: grantedTray,
        // The join case alone seeds a marketplace.json, and it's deliberately unparseable so a team.* row actually exists to assert against below.
        files: isJoin ? { "/fake-home/.mattstack/teams/acme/.claude-plugin/marketplace.json": "not json" } : {},
      });
      writeIntent(p, intent);
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: [] });
      expect(plan.groups.find((g) => g.id === "access")!.rows.length).toBeGreaterThan(0);
      const tools = plan.groups.find((g) => g.id === "tools")!.rows;
      expect(tools.find((r) => r.id === "tool.fast-browser")!.required).toBe(true);
      expect(tools.find((r) => r.id === "tool.fast-browser-extension")!.finishGated).toBe(true);
      const accounts = plan.groups.find((g) => g.id === "accounts")!.rows;
      expect(accounts.map((r) => [r.id, r.required])).toEqual(intent.mode === "restore" ? [] : [["account.github", true]]);
      if (isJoin) expect(tools.some((r) => r.id.startsWith("team."))).toBe(true);
    }
  });

  test("--team naming an unknown team rejects with a user-actionable error instead of silently substituting a different plan", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });

    await expect(
      composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: ["acme"], teamOverride: "ghost" }),
    ).rejects.toThrow(UserActionableError);

    await expect(
      composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: ["acme"], teamOverride: "ghost" }),
    ).rejects.toThrow(/ghost/);
  });

  test("--team naming a discovered team wins over an unrelated intent's team", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const intent: SetupIntent = { v: 1, at: "x", mode: "restore", restore: { homeRepo: "r" } };
    writeIntent(p, intent);

    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: ["acme"], teamOverride: "acme" });
    expect(plan.team).toEqual({ slug: "acme", name: "acme", mode: "none" });
  });

  test("a group builder that throws degrades to one required error row with a re-check action, and canInstall stays false", async () => {
    const p = fakeProbes({
      exec: (argv) => {
        if (argv[0] === "sw_vers") throw new Error("boom");
        return ok();
      },
      tray: grantedTray,
    });

    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: [] });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    expect(mac.rows).toHaveLength(1);
    const errorRow = mac.rows[0]!;
    expect(errorRow.status).toBe("error");
    expect(errorRow.detail).toContain("boom");
    expect(errorRow.required).toBe(true);
    expect(errorRow.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });

    // The group's unrun checks must still count against canInstall — a
    // degraded group is not the same thing as a group that came back clean.
    expect(plan.canInstall).toBe(false);
    expect(plan.requiredMissing).toContain(errorRow.id);
  });
});

describe("composePlan — install-satisfied flip", () => {
  test("plan mode: perm.login-items and tool.daemon read required:false with an optionalNote", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: [] });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    const loginItems = mac.rows.find((r) => r.id === "perm.login-items")!;
    expect(loginItems.required).toBe(false);
    expect(loginItems.optionalNote).not.toBeNull();

    const tools = plan.groups.find((g) => g.id === "tools")!;
    const daemon = tools.rows.find((r) => r.id === "tool.daemon")!;
    expect(daemon.required).toBe(false);
    expect(daemon.optionalNote).not.toBeNull();
  });

  test("status mode: perm.login-items and tool.daemon read required:true with no optionalNote", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: [] });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    const loginItems = mac.rows.find((r) => r.id === "perm.login-items")!;
    expect(loginItems.required).toBe(true);
    expect(loginItems.optionalNote).toBeNull();

    const tools = plan.groups.find((g) => g.id === "tools")!;
    const daemon = tools.rows.find((r) => r.id === "tool.daemon")!;
    expect(daemon.required).toBe(true);
    expect(daemon.optionalNote).toBeNull();
  });

  test("tool.plugins flips required across plan and status mode", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const planned = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: [] });
    const plannedRow = planned.groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.plugins")!;
    expect(plannedRow.required).toBe(false);
    expect(plannedRow.optionalNote).not.toBeNull();

    const status = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: [] });
    const statusRow = status.groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.plugins")!;
    expect(statusRow.required).toBe(true);
    expect(statusRow.optionalNote).toBeNull();
  });

  // The extension is loaded by hand in Chrome, so it must never reach
  // requiredMissing in either mode: status mode is what the verify Install
  // step runs, and a critical failure there would end every successful
  // install in failure. Chrome plus a doctor report that says "not loaded"
  // is the one shape that makes the row needs-you through the real seams;
  // without both it reads skipped and the assertion proves nothing.
  test("tool.fast-browser-extension never counts against canInstall, in either mode, even while status mode reads it required", async () => {
    const p = fakeProbes({ exec: fastBrowserNotLoadedExec, tray: grantedTray, env: { PATH: "/opt/tools" }, files: { "/opt/tools/fast-browser": "#!/bin/sh" } });
    p.mkdirp("/Applications/Google Chrome.app");
    // A discovered team keeps this machine non-solo, which is what makes the extension row finish-gated here.
    for (const mode of ["plan", "status"] as const) {
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode, teams: ["acme"] });
      const r = plan.groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.fast-browser-extension")!;
      expect(r.status).toBe("needs-you");
      expect(r.required).toBe(mode === "status");
      // The fake home has no home repo, so skills.writing-style also blocks Finish here.
      expect(plan.finishBlockedBy).toEqual(["tool.fast-browser-extension", "skills.writing-style"]);
      expect(plan.requiredMissing).not.toContain("tool.fast-browser-extension");
    }
  });
});

function statusPlan(rows: Row[]) {
  // Group requires a title as well as id and rows.
  const groups: Group[] = [{ id: "tools", title: "Tools", rows }];
  return finalizePlan({ slug: "acme", name: "Acme", mode: "none" }, applyInstallSatisfiedFlip(groups, "status"));
}

test("a skipped pack row never lands in requiredMissing, so it cannot block Install", () => {
  const plan = statusPlan([
    row({ id: "pack.remote", kind: "tool", title: "remote", why: "x", required: false, status: "skipped", detail: "version unknown; rt does not track this source's version" }),
  ]);
  expect(plan.requiredMissing).not.toContain("pack.remote");
  expect(plan.canInstall).toBe(true);
});

test("on a machine with no claude, the skipped plugin rows do not block Install either", () => {
  const plan = statusPlan([
    row({ id: "tool.plugins", kind: "tool", title: "Claude plugins", why: "x", required: false, status: "skipped", detail: "claude not installed" }),
    row({ id: "pack.acme-skills", kind: "tool", title: "acme-skills", why: "x", required: false, status: "skipped", detail: "claude not installed" }),
  ]);
  expect(plan.requiredMissing).toEqual([]);
  expect(plan.canInstall).toBe(true);
});

function gatedRow(status: Row["status"]): Row {
  return row({
    id: "tool.fast-browser-extension",
    kind: "tool",
    title: "Fast Browser extension",
    why: "x",
    required: false,
    optionalNote: "You load this into Chrome yourself; Install cannot do it for you.",
    status,
    detail: "d",
    action: { type: "steps", label: "Show steps…", steps: ["Open chrome://extensions"] },
    finishGated: true,
  });
}

function gatedPlan(status: Row["status"], mode: "plan" | "status", waived: string[] = []) {
  const groups: Group[] = [{ id: "tools", title: "Tools", rows: [gatedRow(status)] }];
  return finalizePlan({ slug: "acme", name: "Acme", mode: "none" }, applyFinishGate(groups, mode, waived), new Date(), waived);
}

describe("finish gate", () => {
  test("the contract names exactly two finish-gated rows today", () => {
    expect([...FINISH_GATED_ROW_IDS]).toEqual(["tool.fast-browser-extension", "skills.writing-style"]);
  });

  test("a needs-you finish-gated row blocks Finish in both modes and never Install", () => {
    for (const mode of ["plan", "status"] as const) {
      const plan = gatedPlan("needs-you", mode);
      expect(plan.finishBlockedBy).toEqual(["tool.fast-browser-extension"]);
      expect(plan.requiredMissing).toEqual([]);
      expect(plan.canInstall).toBe(true);
    }
  });

  test("ready and skipped finish-gated rows block nothing", () => {
    expect(gatedPlan("ready", "status").finishBlockedBy).toEqual([]);
    expect(gatedPlan("skipped", "status").finishBlockedBy).toEqual([]);
  });

  test("status mode reads an unwaived finish-gated row as required with no optionalNote; plan mode keeps the validator's shape", () => {
    const status = gatedPlan("needs-you", "status").groups[0]!.rows[0]!;
    expect(status.required).toBe(true);
    expect(status.optionalNote).toBeNull();
    const planned = gatedPlan("needs-you", "plan").groups[0]!.rows[0]!;
    expect(planned.required).toBe(false);
    expect(planned.optionalNote).toBe("You load this into Chrome yourself; Install cannot do it for you.");
  });

  test("a skipped finish-gated row stays optional in status mode", () => {
    expect(gatedPlan("skipped", "status").groups[0]!.rows[0]!.required).toBe(false);
  });

  test("composePlan's envelope carries finishBlockedBy in both modes", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    for (const mode of ["plan", "status"] as const) {
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode, teams: [] });
      expect(Array.isArray(plan.finishBlockedBy)).toBe(true);
    }
  });

  test("a waived finish-gated row reads optional with the skipped-on-this-Mac note, carries waived:true, keeps its status and action, and leaves finishBlockedBy, in both modes", () => {
    for (const mode of ["plan", "status"] as const) {
      const plan = gatedPlan("needs-you", mode, ["tool.fast-browser-extension"]);
      const r = plan.groups[0]!.rows[0]!;
      expect(r.required).toBe(false);
      expect(r.waived).toBe(true);
      expect(r.optionalNote).toBe(WAIVED_NOTE);
      expect(r.status).toBe("needs-you");
      expect(r.action?.type).toBe("steps");
      expect(plan.finishBlockedBy).toEqual([]);
    }
  });

  test("an unwaived finish-gated row never carries waived:true, and a row that is not finish-gated never carries the field at all", () => {
    expect(gatedPlan("needs-you", "status").groups[0]!.rows[0]!.waived).toBeFalsy();
    const plain = row({ id: "tool.chrome", kind: "tool", title: "Chrome", why: "x", required: false, status: "missing", detail: "d" });
    const groups: Group[] = [{ id: "tools", title: "Tools", rows: [plain] }];
    expect("waived" in applyFinishGate(groups, "status", ["tool.chrome"])[0]!.rows[0]!).toBe(false);
  });

  test("composePlan reads the waiver through the resolver when none is injected", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-waived-"));
    process.env.HOME = home;
    try {
      setSetting("setup.waived", ["tool.fast-browser-extension"], "machine");
      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      // A discovered team keeps this machine non-solo, which is what makes the extension row finish-gated (and so waivable) here.
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: ["acme"] });
      const r = plan.groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.fast-browser-extension")!;
      expect(r.optionalNote).toBe(WAIVED_NOTE);
      // skills.writing-style is finish-gated but not waivable, so it still blocks Finish.
      expect(plan.finishBlockedBy).toEqual(["skills.writing-style"]);
    } finally {
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("an injected waived list wins over the store, in both directions", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-waived-"));
    process.env.HOME = home;
    try {
      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      const extension = (plan: Awaited<ReturnType<typeof composePlan>>) => plan.groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.fast-browser-extension")!;

      setSetting("setup.waived", [], "machine");
      // A discovered team keeps this machine non-solo, which is what makes the extension row finish-gated (and so waivable) here.
      const injectedWaived = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: ["acme"], waived: ["tool.fast-browser-extension"] });
      expect(extension(injectedWaived).waived).toBe(true);

      setSetting("setup.waived", ["tool.fast-browser-extension"], "machine");
      const injectedNone = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: ["acme"], waived: [] });
      expect(extension(injectedNone).waived).toBeFalsy();
      const fromStore = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: ["acme"] });
      expect(extension(fromStore).waived).toBe(true);
    } finally {
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
