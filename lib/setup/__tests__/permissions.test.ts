import { describe, test, expect } from "bun:test";
import { rowsToChecks } from "../../../commands/verify.ts";
import { finalizePlan } from "../contract.ts";
import { applyExpectations } from "../expectations.ts";
import { fetchPermissions, permissionRows, type PermissionsReply } from "../permissions.ts";
import { outcomeFromChecks } from "../steps/verify.ts";
import { fakeTray } from "./fakes.ts";
import type { Action } from "../contract.ts";

function reply(overrides: Partial<PermissionsReply>): PermissionsReply {
  return {
    fda: { status: "granted" },
    notifications: { status: "authorized" },
    loginItems: { status: "enabled" },
    ...overrides,
  };
}

function pickRow(rows: ReturnType<typeof permissionRows>, id: string) {
  const r = rows.find((row) => row.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
}

describe("fetchPermissions", () => {
  test("parses the body on a 200", async () => {
    const body = reply({});
    const tray = fakeTray({ "GET /permissions": () => ({ status: 200, json: body }) });
    expect(await fetchPermissions(tray)).toEqual(body);
  });

  test("non-200 (tray absent, unreachable, or app not yet serving) is null, never a guessed reply", async () => {
    const tray = fakeTray({});
    expect(await fetchPermissions(tray)).toBeNull();

    const tray500 = fakeTray({ "GET /permissions": () => ({ status: 500, json: { oops: true } }) });
    expect(await fetchPermissions(tray500)).toBeNull();
  });
});

describe("permissionRows — perm.fda", () => {
  test("granted -> ready, no action", () => {
    const r = pickRow(permissionRows(reply({ fda: { status: "granted" } }), null), "perm.fda");
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("Granted");
    expect(r.action).toBeNull();
    expect(r.required).toBe(true);
    expect(r.kind).toBe("permission");
    expect(r.recheck).toBe("on-activate");
  });

  test("denied -> needs-you, open Full Disk Access settings", () => {
    const r = pickRow(permissionRows(reply({ fda: { status: "denied" } }), null), "perm.fda");
    expect(r.status).toBe("needs-you");
    expect(r.action).toEqual({ type: "open-settings", label: "Open Full Disk Access Settings…", target: "fda" });
  });

  test("unknown -> needs-you, same settings action", () => {
    const r = pickRow(permissionRows(reply({ fda: { status: "unknown" } }), null), "perm.fda");
    expect(r.status).toBe("needs-you");
    expect(r.action?.type).toBe("open-settings");
  });

  test("reply null, daemonTcc all-clear -> ready via the daemon", () => {
    const r = pickRow(permissionRows(null, { blocked: 0, total: 12 }), "perm.fda");
    expect(r.status).toBe("ready");
    expect(r.detail).toContain("12");
    expect(r.detail).toContain("daemon");
  });

  test("reply null, daemonTcc has blocked repos -> needs-you", () => {
    const r = pickRow(permissionRows(null, { blocked: 3, total: 12 }), "perm.fda");
    expect(r.status).toBe("needs-you");
    expect(r.action?.type).toBe("open-settings");
  });

  test("reply null, no daemonTcc signal -> error, never invalid or ready", () => {
    const r = pickRow(permissionRows(null, null), "perm.fda");
    expect(r.status).toBe("error");
    expect(r.detail).toBe("mattstack.app is not running, so permissions cannot be checked");
    expect(r.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
  });
});

describe("permissionRows — perm.login-items", () => {
  test("enabled -> ready", () => {
    const r = pickRow(permissionRows(reply({ loginItems: { status: "enabled" } }), null), "perm.login-items");
    expect(r.status).toBe("ready");
    expect(r.required).toBe(true);
  });

  test("requiresApproval -> needs-you, open Login Items settings", () => {
    const r = pickRow(permissionRows(reply({ loginItems: { status: "requiresApproval" } }), null), "perm.login-items");
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("Approve in Login Items");
    expect(r.action).toEqual({ type: "open-settings", label: "Open Login Items…", target: "login-items" });
  });

  const REGISTER: Action = { type: "run", label: "Register services", verb: ["setup", "apply", "--only", "services.register"] };

  test("notRegistered -> missing, with a row action that runs services.register", () => {
    const r = pickRow(permissionRows(reply({ loginItems: { status: "notRegistered" } }), null), "perm.login-items");
    expect(r.status).toBe("missing");
    expect(r.detail).toBe("Not registered yet");
    expect(r.action).toEqual(REGISTER);
  });

  test("notFound -> missing, same register action", () => {
    const r = pickRow(permissionRows(reply({ loginItems: { status: "notFound" } }), null), "perm.login-items");
    expect(r.status).toBe("missing");
    expect(r.action).toEqual(REGISTER);
  });

  test("reply null -> error, re-check action", () => {
    const r = pickRow(permissionRows(null, null), "perm.login-items");
    expect(r.status).toBe("error");
    expect(r.action?.type).toBe("run");
  });
});

describe("permissionRows — perm.notifications", () => {
  test("authorized -> ready, optional row with no note", () => {
    const r = pickRow(permissionRows(reply({ notifications: { status: "authorized" } }), null), "perm.notifications");
    expect(r.status).toBe("ready");
    expect(r.required).toBe(false);
    expect(r.optionalNote).toBeNull();
  });

  test("provisional -> ready", () => {
    const r = pickRow(permissionRows(reply({ notifications: { status: "provisional" } }), null), "perm.notifications");
    expect(r.status).toBe("ready");
  });

  test("notDetermined -> needs-you, request-permission action", () => {
    const r = pickRow(permissionRows(reply({ notifications: { status: "notDetermined" } }), null), "perm.notifications");
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("Not requested");
    expect(r.action).toEqual({ type: "request-permission", label: "Allow", which: "notifications" });
  });

  test("denied -> needs-you, open Notification settings", () => {
    const r = pickRow(permissionRows(reply({ notifications: { status: "denied" } }), null), "perm.notifications");
    expect(r.status).toBe("needs-you");
    expect(r.action).toEqual({ type: "open-settings", label: "Open Notification Settings…", target: "notifications" });
  });

  test("reply null -> skipped, never invalid, not required", () => {
    const r = pickRow(permissionRows(null, null), "perm.notifications");
    expect(r.status).toBe("skipped");
    expect(r.detail).toBe("Not checked: mattstack.app is not running");
    expect(r.required).toBe(false);
  });
});

describe("perm.notifications through the plan and verify", () => {
  function planFor(status: PermissionsReply["notifications"]["status"]) {
    const rows = permissionRows(reply({ notifications: { status } }), null);
    const plan = finalizePlan({ slug: "acme", name: "Acme", mode: "join" }, applyExpectations([{ id: "mac", title: "Your Mac", rows }]));
    const notifications = plan.groups.flatMap((g) => g.rows).find((r) => r.id === "perm.notifications")!;
    return { plan, rows, notifications, outcome: outcomeFromChecks(rowsToChecks(plan, { ci: false }), rows) };
  }

  test("denied is an answer: verify passes and neither Install nor Finish waits on it", () => {
    const { plan, notifications, outcome } = planFor("denied");
    expect(outcome.state).toBe("done");
    expect(plan.canInstall).toBe(true);
    expect(plan.requiredMissing).toEqual([]);
    expect(plan.finishBlockedBy).toEqual([]);
    expect(notifications).toMatchObject({ status: "needs-you", detail: "Denied", required: false, optionalNote: "Works without this; you'll see menu-bar badges instead." });
    expect(notifications.finishGated).toBeUndefined();
    expect(notifications.action).toEqual({ type: "open-settings", label: "Open Notification Settings…", target: "notifications" });
  });

  test("denied still shows up in verify as a warning", () => {
    const { plan } = planFor("denied");
    expect(rowsToChecks(plan, { ci: false }).find((c) => c.name === "perm.notifications")).toMatchObject({ status: "warn", severity: "warning" });
  });

  test("nobody has answered yet: Install still waits and verify still fails", () => {
    const { plan, notifications, outcome } = planFor("notDetermined");
    expect(outcome.state).toBe("failed");
    expect(plan.requiredMissing).toEqual(["perm.notifications"]);
    expect(notifications).toMatchObject({ status: "needs-you", detail: "Not requested", required: true, optionalNote: null });
    expect(notifications.action).toEqual({ type: "request-permission", label: "Allow", which: "notifications" });
  });

  test("allowed reads ready with no note", () => {
    const { plan, notifications } = planFor("authorized");
    expect(plan.requiredMissing).toEqual([]);
    expect(notifications).toMatchObject({ status: "ready", required: false, optionalNote: null });
  });
});
