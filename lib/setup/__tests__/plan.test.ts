import { closeStateDb } from "../../state/index.ts";
import { describe, test, expect } from "bun:test";
import { applyApprovalWait, applyInstallSatisfiedFlip, composePlan, pendingJoinTeam } from "../plan.ts";
import { APPROVAL_DEPENDENT_IDS, APPROVAL_WAIT_DETAIL } from "../../team/approval.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import { renderSopsYamlRules } from "../../home/age-key.ts";
import { TEAM_PATH_REGEX } from "../../secrets/team-store.ts";
import { FINISH_GATED_ROW_IDS, WAIVABLE_ROW_IDS, finalizePlan, row, type Group, type Plan, type Row } from "../contract.ts";
import { applyFinishGate, waivedNote } from "../finish-gate.ts";
import { applyExpectations } from "../expectations.ts";
import { markDeferred } from "../repo-placement.ts";
import { setSetting } from "../../settings/write.ts";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { UserActionableError } from "../../errors.ts";
import { writeIntent, type SetupIntent } from "../intent.ts";
import { updateSetupState } from "../state.ts";
import type { SecretPresence } from "../validators/accounts.ts";
import { fakeProbes, fakeTray, ok } from "./fakes.ts";
import type { ExecScript } from "./fakes.ts";
import { sharedStorePath } from "../../../packages/rt-client/test/org-fixture.ts";
import { rowsToChecks } from "../../../commands/verify.ts";

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
        v: 2, username: "dev2", teams: ["gadgets", "widgets"],
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

/** The tools rows are split across several groups, so a test that wants one looks through them all. */
const everyRow = (plan: { groups: Group[] }) => ({ rows: plan.groups.flatMap((g) => g.rows) });

describe("composePlan", () => {
  test("no intent, no teams -> the groups in contract order, team.mode none, perm.fda ready", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: [] });

    expect(plan.contract).toBe(1);
    expect(plan.groups.map((g) => g.id)).toEqual(["mac", "accounts", "access", "agents", "browser", "rt", "team"]);
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
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: [] });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    const fda = mac.rows.find((r) => r.id === "perm.fda")!;
    expect(fda.status).toBe("ready");
    expect(fda.detail).toContain("via the daemon");
  });

  test("create intent -> team ref from the intent, forge derived from its remote, account.github row present", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    writeIntent(p, createIntent());

    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [] });

    expect(plan.team).toEqual({ slug: "acme", name: "Acme", mode: "create" });
    const accounts = plan.groups.find((g) => g.id === "accounts")!;
    expect(accounts.rows.some((r) => r.id === "account.github")).toBe(true);
  });

  test("join intent -> forge derived from the invite pointer's own forge field, not re-parsed from its remote", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    writeIntent(p, joinIntent());

    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [] });

    const accounts = plan.groups.find((g) => g.id === "accounts")!;
    expect(accounts.rows.some((r) => r.id === "account.github")).toBe(true);
  });

  test("join intent, a team file that still declares a switchboard -> the plan carries no switchboard row of either kind", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-switchboard-"));
    process.env.HOME = home;
    try {
      const teamPath = sharedStorePath("acme");
      mkdirSync(dirname(teamPath), { recursive: true });
      writeFileSync(teamPath, `// team store\n${JSON.stringify({ "mattstack.integrations": { switchboard: { url: "https://sw.example.com" } } })}\n`);

      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      writeIntent(p, joinIntent());

      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: ["acme"] });
      const ids = plan.groups.flatMap((g) => g.rows.map((r) => r.id));
      expect(ids).not.toContain("account.switchboard");
      expect(ids).not.toContain("access.switchboard");
    } finally {
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("solo intent, no teams -> no access rows, github optional, fast-browser finish-gated, no team rows, and the existing modes unchanged", async () => {
    const priorHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-solo-"));
    closeStateDb();
    process.env.HOME = home;
    try {
      // canInstall also needs tool.arch and tool.app ready; readyExec/grantedTray alone leave both unmocked, and neither is solo-specific.
      const soloExec: ExecScript = (argv) => (argv[0] === "uname" ? ok("arm64") : readyExec(argv));
      const p = fakeProbes({ exec: soloExec, tray: grantedTray, dirs: { "/Applications/mattstack.app": [] } });
      writeIntent(p, { v: 1, at: "2026-09-26T00:00:00.000Z", mode: "solo" });
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [] });
      expect(plan.team).toEqual({ slug: "", name: "", mode: "none" });
      expect(plan.groups.find((g) => g.id === "access")!.rows).toEqual([]);
      const accounts = plan.groups.find((g) => g.id === "accounts")!.rows;
      expect(accounts.map((r) => [r.id, r.required])).toEqual([["account.github", false]]);
      const tools = everyRow(plan).rows;
      expect(tools.find((r) => r.id === "tool.fast-browser")).toMatchObject({ required: false, finishGated: true, waivable: false, optionalNote: null });
      expect(tools.some((r) => r.id.startsWith("team."))).toBe(false);
      // Only steps expected before Install on every path, each with something to press; nothing team-shaped.
      expect(plan.requiredMissing).toEqual(["tool.chrome"]);
      expect(plan.canInstall).toBe(false);
    } finally {
      closeStateDb();
      process.env.HOME = priorHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("an old board file holding team fields adds the board.team-fields row to the team group", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray, files: { "/fake-home/.mattstack/board/config.json.imported": JSON.stringify({ title: "Ours" }) } });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: [] });
    const team = plan.groups.find((g) => g.id === "team")!;
    const r = team.rows.find((x) => x.id === "board.team-fields")!;
    expect(r.status).toBe("needs-you");
    expect(r.required).toBe(false);
    expect(plan.requiredMissing).not.toContain("board.team-fields");
  });

  test("create, join and restore intents produce the same rows as before solo existed", async () => {
    // readyExec puts no fast-browser on PATH, so the row's "missing" branch is the one asserted; the pending branches already read required:false in every mode.
    for (const intent of [createIntent(), joinIntent(), restoreIntent()]) {
      const isJoin = intent.mode === "join";
      const p = fakeProbes({
        exec: readyExec,
        tray: grantedTray,
        // The join case alone seeds a marketplace.json, and it's deliberately unparseable so a team.* row actually exists to assert against below.
        files: isJoin ? { "/fake-home/.mattstack/orgs/acme/.claude-plugin/marketplace.json": "not json" } : {},
      });
      writeIntent(p, intent);
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [] });
      expect(plan.groups.find((g) => g.id === "access")!.rows.length).toBeGreaterThan(0);
      const tools = everyRow(plan).rows;
      expect(tools.find((r) => r.id === "tool.fast-browser")!.required).toBe(true);
      expect(tools.find((r) => r.id === "tool.fast-browser-extension")!.finishGated).toBe(true);
      const accounts = plan.groups.find((g) => g.id === "accounts")!.rows;
      const expected = { restore: [], create: [["account.github", true]], join: [["account.github", true], ["accounts.after-install", false]] }[intent.mode as "restore" | "create" | "join"];
      expect(accounts.map((r) => [r.id, r.required])).toEqual(expected);
      if (isJoin) expect(tools.some((r) => r.id.startsWith("team."))).toBe(true);
    }
  });

  test("--team naming an unknown team rejects with a user-actionable error instead of silently substituting a different plan", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });

    await expect(
      composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: ["acme"], teamOverride: "ghost" }),
    ).rejects.toThrow(UserActionableError);

    await expect(
      composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: ["acme"], teamOverride: "ghost" }),
    ).rejects.toThrow(/ghost/);
  });

  test("--team naming a discovered team wins over an unrelated intent's team", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const intent: SetupIntent = { v: 1, at: "x", mode: "restore", restore: { homeRepo: "r" } };
    writeIntent(p, intent);

    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: ["acme"], teamOverride: "acme" });
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

    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: [] });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    expect(mac.rows.map((r) => r.id)).toEqual(["mac.group-error", "tool.mission-control"]);
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
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [] });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    const loginItems = mac.rows.find((r) => r.id === "perm.login-items")!;
    expect(loginItems.required).toBe(false);
    expect(loginItems.optionalNote).not.toBeNull();

    const tools = everyRow(plan);
    const daemon = tools.rows.find((r) => r.id === "tool.daemon")!;
    expect(daemon.required).toBe(false);
    expect(daemon.optionalNote).not.toBeNull();
  });

  test("status mode: perm.login-items and tool.daemon read required:true with no optionalNote", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: [] });

    const mac = plan.groups.find((g) => g.id === "mac")!;
    const loginItems = mac.rows.find((r) => r.id === "perm.login-items")!;
    expect(loginItems.required).toBe(true);
    expect(loginItems.optionalNote).toBeNull();

    const tools = everyRow(plan);
    const daemon = tools.rows.find((r) => r.id === "tool.daemon")!;
    expect(daemon.required).toBe(true);
    expect(daemon.optionalNote).toBeNull();
  });

  test("tool.plugins flips required across plan and status mode", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const planned = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [] });
    const plannedRow = everyRow(planned).rows.find((r) => r.id === "tool.plugins")!;
    expect(plannedRow.required).toBe(false);
    expect(plannedRow.optionalNote).not.toBeNull();

    const status = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: [] });
    const statusRow = everyRow(status).rows.find((r) => r.id === "tool.plugins")!;
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
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode, orgs: ["acme"] });
      const r = everyRow(plan).rows.find((r) => r.id === "tool.fast-browser-extension")!;
      expect(r.status).toBe("needs-you");
      expect(r.required).toBe(mode === "status");
      expect(plan.finishBlockedBy).toEqual(["tool.fast-browser", "tool.fast-browser-extension", "tool.proxy", "tool.state-backup", "home.backup"]);
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

test("a pack held for an app update stays required:false in both modes and never blocks Install", () => {
  const held = row({ id: "pack.acme-skills", kind: "tool", title: "acme-skills", why: "x", required: false, status: "needs-you", detail: "held", action: null });
  for (const mode of ["plan", "status"] as const) {
    const groups: Group[] = [{ id: "tools", title: "Tools", rows: [held] }];
    const flipped = applyInstallSatisfiedFlip(groups, mode);
    expect(flipped[0]!.rows[0]!.required).toBe(false);
    expect(finalizePlan({ slug: "acme", name: "Acme", mode: "none" }, flipped).canInstall).toBe(true);
  }
});

test("a daemon row that needs you with no action, as in CI, still flips like any other Install-satisfied row", () => {
  const daemon = row({ id: "tool.daemon", kind: "tool", title: "rt daemon", why: "x", required: false, status: "needs-you", detail: "Not running (expected in CI)", action: null });
  const flip = (mode: "plan" | "status") => applyInstallSatisfiedFlip([{ id: "tools", title: "Tools", rows: [daemon] }], mode)[0]!.rows[0]!;
  expect(flip("plan").required).toBe(false);
  expect(flip("status").required).toBe(true);
});

test("before Install, a row only Install can make ready waits for Install; after it, none does", () => {
  const rows = [
    row({ id: "perm.login-items", kind: "permission", title: "Login Items", why: "x", required: false, status: "needs-you", detail: "d",
          action: { type: "run", label: "Re-check", verb: ["setup", "status"] } }),
    row({ id: "tool.daemon", kind: "tool", title: "rt daemon", why: "x", required: false, status: "missing", detail: "d",
          action: { type: "run", label: "Register services", verb: ["setup", "apply", "--only", "services.register"] } }),
    row({ id: "tool.plugins", kind: "tool", title: "Claude plugins", why: "x", required: false, status: "needs-you", detail: "d",
          action: { type: "run", label: "Install plugins", verb: ["setup", "apply", "--only", "plugins.install"] } }),
    row({ id: "pack.acme-skills", kind: "tool", title: "acme-skills", why: "x", required: false, status: "missing", detail: "d",
          action: { type: "run", label: "Install plugins", verb: ["setup", "apply", "--only", "plugins.install"] } }),
    row({ id: "skills.writing-style", kind: "tool", title: "Writing style", why: "x", required: false, status: "needs-you", detail: "You choose this after Install" }),
  ];
  const flip = (mode: "plan" | "status") => applyInstallSatisfiedFlip([{ id: "tools", title: "Tools", rows }], mode)[0]!.rows;
  expect(flip("plan").map((r) => [r.id, r.waitsForInstall])).toEqual(rows.map((r) => [r.id, true]));
  expect(flip("status").map((r) => r.waitsForInstall)).toEqual(rows.map(() => undefined));
});

test("a ready Install-satisfied row, and a writing-style row with a choice to make, do not wait for Install", () => {
  const ready = row({ id: "tool.daemon", kind: "tool", title: "rt daemon", why: "x", required: false, status: "ready", detail: "Running" });
  const choosing = row({ id: "skills.writing-style", kind: "tool", title: "Writing style", why: "x", required: false, status: "needs-you", detail: "Not chosen yet",
                         action: { type: "choose", label: "Choose style…", verb: ["skills", "writing-style", "use"], options: [] } });
  const unrelated = row({ id: "tool.proxy", kind: "tool", title: "Local proxy", why: "x", required: false, status: "missing", detail: "d" });
  const flipped = applyInstallSatisfiedFlip([{ id: "tools", title: "Tools", rows: [ready, choosing, unrelated] }], "plan")[0]!.rows;
  expect(flipped.map((r) => r.waitsForInstall)).toEqual([undefined, undefined, undefined]);
});

test("after Install has run, a row Install could not finish asks for it again", () => {
  const register = { type: "run" as const, label: "Register services", verb: ["setup", "apply", "--only", "services.register"] };
  const daemon = row({ id: "tool.daemon", kind: "tool", title: "rt daemon", why: "x", required: false, status: "needs-you", detail: "Not running", action: register });
  const waiting = row({ id: "skills.writing-style", kind: "tool", title: "Writing style", why: "x", required: false, status: "needs-you",
                        detail: "You choose this after Install" });
  const flipped = applyInstallSatisfiedFlip([{ id: "tools", title: "Tools", rows: [daemon, waiting] }], "plan", { installRan: true })[0]!.rows;
  expect(flipped.map((r) => r.waitsForInstall)).toEqual([undefined, undefined]);
  expect(flipped[0]!.action).toEqual(register);
});

test("composePlan reads whether Install has run from setup state, and a Mac that finished setup has run it", async () => {
  const p = fakeProbes({ exec: readyExec, tray: grantedTray });
  const waiting = async () => (await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [] })).groups
    .flatMap((g) => g.rows).filter((r) => r.waitsForInstall).map((r) => r.id);
  expect(await waiting()).toContain("skills.writing-style");
  updateSetupState(p, (s) => ({ ...s, installRanAt: "2026-10-29T10:00:00.000Z" }));
  expect(await waiting()).toEqual([]);

  const finished = fakeProbes({ exec: readyExec, tray: grantedTray });
  updateSetupState(finished, (s) => ({ ...s, finishedAt: "2026-09-01T10:00:00.000Z" }));
  const plan = await composePlan({ p: finished, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [] });
  expect(plan.groups.flatMap((g) => g.rows).filter((r) => r.waitsForInstall)).toEqual([]);
});

test("a writing-style error is never folded as waiting for Install, and the actionless row before Install is", () => {
  const error = row({ id: "skills.writing-style", kind: "tool", title: "Writing style", why: "x", required: false, status: "error",
                      detail: "Could not read the writing style: boom", finishGated: false });
  const beforeInstall = row({ id: "skills.writing-style", kind: "tool", title: "Writing style", why: "x", required: false, status: "needs-you", detail: "d" });
  const flipped = applyInstallSatisfiedFlip([{ id: "tools", title: "Tools", rows: [error, beforeInstall] }], "plan")[0]!.rows;
  expect(flipped.map((r) => r.waitsForInstall)).toEqual([undefined, true]);
});

function gatedRow(status: Row["status"], id = "tool.fast-browser-extension"): Row {
  return row({
    id,
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

function gatedPlan(status: Row["status"], mode: "plan" | "status", waived: string[] = [], id?: string) {
  const groups: Group[] = [{ id: "tools", title: "Tools", rows: [gatedRow(status, id)] }];
  return finalizePlan({ slug: "acme", name: "Acme", mode: "none" }, applyFinishGate(groups, mode, waived), new Date(), waived);
}

describe("finish gate", () => {
  test("the contract's finish-gated ids are the extension alone, and the finish targets stay gated", () => {
    expect([...FINISH_GATED_ROW_IDS]).toEqual(["tool.fast-browser-extension"]);
    expect([...WAIVABLE_ROW_IDS]).toEqual(["skills.overrides", "tool.chrome-signin", "tool.mission-control"]);
    const shell = row({ id: "tool.shell", kind: "tool", title: "Shell", why: "x", required: false, status: "missing", detail: "d",
                        action: { type: "run", label: "Install", verb: ["setup", "apply", "--only", "path.link"] } });
    const gated = applyExpectations([{ id: "tools", title: "Tools", rows: [shell] }]);
    expect(gated[0]!.rows[0]).toMatchObject({ finishGated: true, waivable: false });
    expect(finalizePlan({ slug: "acme", name: "Acme", mode: "join" }, gated).finishBlockedBy).toEqual(["tool.shell"]);
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
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode, orgs: [] });
      expect(Array.isArray(plan.finishBlockedBy)).toBe(true);
    }
  });

  test("a waived finish-gated row reads optional with the skipped-on-this-Mac note, carries waived:true, keeps its status and action, and leaves finishBlockedBy, in both modes", () => {
    for (const mode of ["plan", "status"] as const) {
      const plan = gatedPlan("needs-you", mode, ["tool.mission-control"], "tool.mission-control");
      const r = plan.groups[0]!.rows[0]!;
      expect(r.required).toBe(false);
      expect(r.waived).toBe(true);
      expect(r.optionalNote).toBe(waivedNote("tool.mission-control"));
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
      setSetting("setup.waived", ["tool.mission-control"], "machine");
      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: ["acme"] });
      const r = everyRow(plan).rows.find((r) => r.id === "tool.mission-control")!;
      expect(r.optionalNote).toBe(waivedNote("tool.mission-control"));
      expect(plan.finishBlockedBy).toEqual(["tool.proxy", "tool.state-backup", "home.backup"]);
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
      const extension = (plan: Awaited<ReturnType<typeof composePlan>>) => everyRow(plan).rows.find((r) => r.id === "tool.mission-control")!;

      setSetting("setup.waived", [], "machine");
      const injectedWaived = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: ["acme"], waived: ["tool.mission-control"] });
      expect(extension(injectedWaived).waived).toBe(true);

      setSetting("setup.waived", ["tool.mission-control"], "machine");
      const injectedNone = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: ["acme"], waived: [] });
      expect(extension(injectedNone).waived).toBeFalsy();
      const fromStore = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: ["acme"] });
      expect(extension(fromStore).waived).toBe(true);
    } finally {
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a tracked repo Install left for you sits under Your repos and blocks Finish, never Install", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-repos-"));
    closeStateDb();
    process.env.HOME = home;
    try {
      const teamPath = sharedStorePath("acme");
      mkdirSync(dirname(teamPath), { recursive: true });
      writeFileSync(teamPath, JSON.stringify({ "mattstack.tracking": { repos: { "gitlab.com/acme/widgets": {}, "gitlab.com/acme/acme-api": {} } } }));
      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      markDeferred(p, "gitlab.com/acme/acme-api");

      for (const mode of ["plan", "status"] as const) {
        const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode, orgs: ["acme"], waived: [] });
        const repos = plan.groups.find((g) => g.id === "repos")!;
        expect(repos.title).toBe("Your repos");
        expect(repos.rows.map((r) => [r.id, r.finishGated ?? false])).toEqual([
          ["repos.place:gitlab.com/acme/widgets", false],
          ["repos.place:gitlab.com/acme/acme-api", true],
        ]);
        expect(plan.finishBlockedBy).toContain("repos.place:gitlab.com/acme/acme-api");
        expect(plan.requiredMissing.some((id) => id.startsWith("repos."))).toBe(false);
      }
    } finally {
      closeStateDb();
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});


describe("Install stays reachable", () => {
  const RECHECK = ["setup", "status"].join(" ");

  function stranded(plan: Plan): string[] {
    const rows = plan.groups.flatMap((g) => g.rows);
    return plan.requiredMissing.filter((id) => {
      const r = rows.find((x) => x.id === id)!;
      return r.action === null || (r.action.type === "run" && r.action.verb.join(" ") === RECHECK);
    });
  }

  test("no required row that is not ready lacks an action a person can press", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-reachable-"));
    closeStateDb();
    process.env.HOME = home;
    try {
      const teamPath = sharedStorePath("acme");
      mkdirSync(dirname(teamPath), { recursive: true });
      writeFileSync(teamPath, JSON.stringify({
        "mattstack.integrations": { forge: { host: "github.com", provider: "github" }, slack: { clientId: "abc" } },
        "mattstack.tracking": { repos: { "github.com/acme/widgets": {} } },
      }));
      const soloExec: ExecScript = (argv) => (argv[0] === "uname" ? ok("arm64") : readyExec(argv));
      // A restore brings the team's clone back with the home repo, so its plan reads that clone's origin.
      const restoredClone = { [join(orgDirUnder("/fake-home", "acme"), ".git", "config")]: '[remote "origin"]\n\turl = https://github.com/acme/mattstack.git\n' };
      const fixtures: { name: string; intent: SetupIntent; orgs: string[]; files?: Record<string, string> }[] = [
        { name: "create", intent: createIntent(), orgs: [] },
        { name: "join, cloned", intent: joinIntent(), orgs: ["acme"] },
        { name: "restore", intent: restoreIntent(), orgs: ["acme"], files: restoredClone },
        { name: "solo", intent: { v: 1, at: "2026-09-26T00:00:00.000Z", mode: "solo" }, orgs: [] },
      ];
      for (const f of fixtures) {
        // A reachable network: a host that does not answer is a fault Re-check is the honest remedy for.
        const p = fakeProbes({ exec: soloExec, tray: grantedTray, fetch: async () => ({ status: 200, body: "", headers: {} }), dirs: { "/Applications/mattstack.app": [] }, files: f.files ?? {} });
        writeIntent(p, f.intent);
        const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: f.orgs, waived: [] });
        expect({ fixture: f.name, stranded: stranded(plan) }).toEqual({ fixture: f.name, stranded: [] });
      }
    } finally {
      closeStateDb();
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("pendingJoinTeam", () => {
  test("before the clone exists the pointer's first team selects the pack", () => { expect(pendingJoinTeam(joinIntent(), [])).toBe("gadgets"); });
  test("after cloning the clone selects the team", () => { expect(pendingJoinTeam(joinIntent(), ["acme"])).toBeUndefined(); });
  test("no intent or a create intent has no pending join team", () => { expect(pendingJoinTeam(null, [])).toBeUndefined(); expect(pendingJoinTeam(createIntent(), [])).toBeUndefined(); });
});


test("a saved old invite leaves the plan renderable until join refuses it", () => {
  const intent = joinIntent();
  const pointer = { ...intent.join!.pointer, v: 1, teams: undefined };
  intent.join!.pointer = pointer as unknown as NonNullable<SetupIntent["join"]>["pointer"];
  expect(pendingJoinTeam(intent, [])).toBeNull();
});

describe("a join asks for the team's Slack and repos whether or not the app relaunched (RT-510)", () => {
  async function withTeamHome(fn: (home: string) => Promise<void>): Promise<void> {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-rt510-"));
    closeStateDb();
    process.env.HOME = home;
    try {
      await fn(home);
    } finally {
      closeStateDb();
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  }

  test("before Install clones the team: no Slack or repo rows yet, and a note says they come once Install has the team", async () => {
    await withTeamHome(async () => {
      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      writeIntent(p, joinIntent());
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: [], waived: [] });
      const ids = plan.groups.flatMap((g) => g.rows.map((r) => r.id));
      expect(ids).not.toContain("account.slack");
      expect(ids.some((id) => id.startsWith("repos.place:"))).toBe(false);
      const note = plan.groups.find((g) => g.id === "accounts")!.rows.find((r) => r.id === "accounts.after-install")!;
      expect(note.kind).toBe("info");
      expect(note.required).toBe(false);
      expect(note.status).toBe("skipped");
      expect(plan.requiredMissing).not.toContain("accounts.after-install");
      expect(plan.requiredMissing.filter((id) => id.startsWith("account."))).toEqual([]);
    });
  });

  test("once the team is cloned: Slack and a repo Install left for the member both block Finish, and the note is gone", async () => {
    await withTeamHome(async () => {
      const teamPath = sharedStorePath("acme");
      mkdirSync(dirname(teamPath), { recursive: true });
      writeFileSync(teamPath, JSON.stringify({
        "mattstack.integrations": { slack: { clientId: "abc" } },
        "mattstack.tracking": { repos: { "github.com/acme/widgets": {} } },
      }));
      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      writeIntent(p, joinIntent());
      markDeferred(p, "github.com/acme/widgets");

      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: ["acme"], waived: [] });
      const ids = plan.groups.flatMap((g) => g.rows.map((r) => r.id));
      expect(ids).not.toContain("accounts.after-install");
      expect(plan.finishBlockedBy).toContain("account.slack");
      expect(plan.finishBlockedBy).toContain("repos.place:github.com/acme/widgets");

      const status = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", orgs: ["acme"], waived: [] });
      const slack = status.groups.flatMap((g) => g.rows).find((r) => r.id === "account.slack")!;
      expect(slack.finishGated).toBeUndefined();
      expect(status.requiredMissing).toContain("account.slack");
      expect(rowsToChecks(status, { ci: false }).find((c) => c.name === "account.slack")).toMatchObject({ status: "fail", severity: "critical" });
    });
  });
});

describe("approval wait", () => {
  const MINE = "age1mine0000000000000000000000000000000000000000000000000000000";
  const OWNER = "age1owner000000000000000000000000000000000000000000000000000000";
  const DEPENDENT = new Set<string>(APPROVAL_DEPENDENT_IDS);

  async function withSlackTeam(fn: () => Promise<void>): Promise<void> {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-approval-"));
    closeStateDb();
    process.env.HOME = home;
    try {
      const teamPath = sharedStorePath("acme");
      mkdirSync(dirname(teamPath), { recursive: true });
      writeFileSync(teamPath, JSON.stringify({ "mattstack.integrations": { slack: { clientId: "abc" } } }));
      await fn();
    } finally {
      closeStateDb();
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  }

  function joinedProbes(members: string[]) {
    return fakeProbes({
      exec: readyExec,
      tray: grantedTray,
      files: {
        [teamLocalPath("/fake-home", "acme")]: JSON.stringify({ joinedByRt: true, joinedAt: "2026-10-29T09:00:00.000Z", agePublicKey: MINE }),
        [join(orgDirUnder("/fake-home", "acme"), ".sops.yaml")]: renderSopsYamlRules([{ pathRegex: TEAM_PATH_REGEX, recipients: members }]),
      },
    });
  }

  const dependentRows = (plan: { groups: Group[] }) => plan.groups.flatMap((g) => g.rows).filter((r) => DEPENDENT.has(r.id));

  test("while waiting, Slack, team sync, org secrets and board peering show the wait, never their own error", async () => {
    await withSlackTeam(async () => {
      const p = joinedProbes([OWNER]);
      writeIntent(p, joinIntent());
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: ["acme"], waived: [] });
      const rows = dependentRows(plan);
      expect(rows.map((r) => r.id)).toContain("account.slack");
      for (const r of rows) {
        expect(r).toMatchObject({
          status: "needs-you",
          detail: APPROVAL_WAIT_DETAIL,
          action: { type: "run", label: "Check again", verb: ["setup", "join-status"] },
          required: false,
          finishGated: true,
          waivable: false,
        });
      }
    });
  });

  test("once approved the four rows are the validators' own", async () => {
    await withSlackTeam(async () => {
      const p = joinedProbes([OWNER, MINE]);
      writeIntent(p, joinIntent());
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: ["acme"], waived: [] });
      expect(dependentRows(plan).map((r) => r.id)).toContain("account.slack");
      expect(dependentRows(plan).some((r) => r.detail === APPROVAL_WAIT_DETAIL)).toBe(false);
      expect(applyApprovalWait(plan.groups, { kind: "approved" })).toEqual(plan.groups);
    });
  });

  test("the redeem cleared the intent: a joined clone with no intent still waits", async () => {
    await withSlackTeam(async () => {
      const p = joinedProbes([OWNER]);
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", orgs: ["acme"], waived: [] });
      const rows = dependentRows(plan);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.detail).toBe(APPROVAL_WAIT_DETAIL);
    });
  });

  test("only the dependent rows change, and only while waiting", () => {
    const own = row({ id: "account.slack", kind: "account", title: "Slack", why: "w", required: true, status: "error", detail: "own error" });
    const other = row({ id: "tool.git", kind: "tool", title: "git", why: "w", required: true, status: "missing", detail: "no git" });
    const groups: Group[] = [{ id: "accounts", title: "Accounts", rows: [own, other] }];
    for (const wait of [{ kind: "not-joined" as const }, { kind: "approved" as const }, { kind: "unreadable" as const, path: "/x", reason: "is missing" }]) {
      expect(applyApprovalWait(groups, wait)).toEqual(groups);
    }
    const peering = row({ id: "account.board-peering", kind: "account", title: "Board peering", why: "w", required: false, status: "ready", detail: "d" });
    const peeringWaited = applyApprovalWait([{ id: "accounts", title: "Accounts", rows: [peering] }], { kind: "waiting", since: null })[0]!.rows[0]!;
    expect(peeringWaited).toMatchObject({ status: "needs-you", detail: APPROVAL_WAIT_DETAIL, finishGated: false });
    const waited = applyApprovalWait(groups, { kind: "waiting", since: null });
    expect(waited[0]!.rows[0]).toMatchObject({ id: "account.slack", status: "needs-you", detail: APPROVAL_WAIT_DETAIL, required: false });
    expect(waited[0]!.rows[1]).toEqual(other);
  });
});
