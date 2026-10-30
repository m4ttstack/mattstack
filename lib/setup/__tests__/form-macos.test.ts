import { describe, expect, test } from "bun:test";
import { applyStepAction } from "../contract.ts";
import type { FancyUrls } from "../fancy-urls.ts";
import { composeForm, macosRows, type FormRow } from "../form.ts";
import { permissionRows, type PermissionsReply } from "../permissions.ts";
import { fakeProbes, fakeTray } from "./fakes.ts";

type NotificationStatus = PermissionsReply["notifications"]["status"];

function reply(fda: PermissionsReply["fda"]["status"], notifications: NotificationStatus): PermissionsReply {
  return { fda: { status: fda }, notifications: { status: notifications }, loginItems: { status: "enabled" } };
}

const FANCY_DONE: FancyUrls = { state: "done", detail: "Allowed", brewMissing: false };
const FANCY_TODO: FancyUrls = { state: "todo", detail: "Not set up yet", brewMissing: true };

function rows(fda: PermissionsReply["fda"]["status"], notifications: NotificationStatus, fancyUrls: FancyUrls = FANCY_DONE): FormRow[] {
  return macosRows({ permissions: permissionRows(reply(fda, notifications), null), notifications, fancyUrls });
}

function pick(list: FormRow[], id: string): FormRow {
  const found = list.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

describe("macosRows", () => {
  test("the three macOS rows come in order with the spec's words", () => {
    const list = rows("denied", "notDetermined", FANCY_TODO);
    expect(list.map((r) => r.id)).toEqual(["perm.fda", "perm.notifications", "mac.fancy-urls"]);
    expect(list.map((r) => [r.title, r.subtext])).toEqual([
      ["Full Disk Access", "Reads your repos and Chrome's profile"],
      ["Notifications", "Tells you when setup is done"],
      ["Fancy URLs", "Grant mattstack apps permission to use .mattstack"],
    ]);
  });

  test("Full Disk Access not granted offers Open settings for the fda pane", () => {
    const fda = pick(rows("denied", "authorized"), "perm.fda");
    expect(fda.state).toBe("todo");
    expect(fda.action).toEqual({ type: "open-settings", label: "Open settings", target: "fda" });
  });

  test("notifications not asked yet offer Allow", () => {
    const n = pick(rows("granted", "notDetermined"), "perm.notifications");
    expect(n.state).toBe("todo");
    expect(n.action).toEqual({ type: "request-permission", label: "Allow", which: "notifications" });
  });

  test("notifications denied count as answered", () => {
    const n = pick(rows("granted", "denied"), "perm.notifications");
    expect(n.state).toBe("done");
    expect(n.detail).toBe("Turned off");
    expect(n.action).toMatchObject({ type: "open-settings", target: "notifications" });
  });

  test("a not-yet-asked status is to do whatever the row's words say", () => {
    const permissions = permissionRows(reply("granted", "authorized"), null);
    const n = pick(macosRows({ permissions, notifications: "notDetermined", fancyUrls: FANCY_DONE }), "perm.notifications");
    expect(n.state).toBe("todo");
    const unknown = pick(macosRows({ permissions, notifications: null, fancyUrls: FANCY_DONE }), "perm.notifications");
    expect(unknown.state).toBe("todo");
  });

  test("fancy URLs to do offers Allow, which runs proxy.install", () => {
    const f = pick(rows("granted", "authorized", FANCY_TODO), "mac.fancy-urls");
    expect(f.state).toBe("todo");
    expect(f.detail).toBe("Not set up yet");
    expect(f.action).toEqual(applyStepAction("Allow", "proxy.install"));
    expect(f.waiting).toBe("Waiting for your admin password in the macOS dialog…");
  });

  test("granted rows are done with no action", () => {
    for (const r of rows("granted", "authorized")) {
      expect(r.state).toBe("done");
      expect(r.action).toBeNull();
      expect(r.optional).toBe(false);
    }
  });
});

describe("composeForm", () => {
  test("the macos section reads the tray once and leaves the stage unset", async () => {
    const p = fakeProbes({
      home: "/fake-home",
      tray: fakeTray({ "GET /permissions": () => ({ status: 200, json: reply("granted", "provisional") }) }),
    });
    const form = await composeForm(p, { sections: ["macos"], secrets: { has: async () => null, hasAdmin: async () => null, ownAgeKey: async () => null }, orgs: [] });
    expect(p.calls.tray).toEqual(["/permissions"]);
    expect(form.stage).toBeNull();
    expect(Object.keys(form.sections)).toEqual(["macos"]);
    expect(form.sections.macos?.map((r) => [r.id, r.state])).toEqual([
      ["perm.fda", "done"],
      ["perm.notifications", "done"],
      ["mac.fancy-urls", "todo"],
    ]);
  });
});
