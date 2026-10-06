import { describe, expect, test } from "bun:test";
import type { ActiveTeam } from "../../../packages/rt-client/src/settings/active-team.ts";
import * as actions from "../use.ts";
import type { UseTeamSeams } from "../use.ts";

function world(active: Partial<ActiveTeam> = {}, overrides: Partial<UseTeamSeams> = {}) {
  const log: string[] = [];
  const enabled = new Set(["widgets@acme-market"]);
  const seams: UseTeamSeams = {
    activeTeam: () => ({ org: "acme", team: "widgets", reason: "first-team", username: "dev2", listedOn: ["widgets", "gadgets"], ...active }),
    writeUserSetting: (key, value) => { log.push(`set ${key}=${String(value)}`); },
    installPack: async () => { log.push("install"); return { ok: true, detail: "1 pack" }; },
    setPackEnabled: async (id, on) => { log.push(`${on ? "enable" : "disable"} ${id}`); if (on) enabled.add(id); else enabled.delete(id); return true; },
    marketplace: () => "acme-market",
    restartApp: async (app) => { log.push(`restart ${app}`); return true; },
    ...overrides,
  };
  return { seams, log, enabled };
}

describe("useTeam", () => {
  test("switches in order and disables a hand-enabled previous pack without removing it", async () => {
    const { seams, log, enabled } = world();
    expect(await actions.useTeam("gadgets", seams)).toEqual({ team: "gadgets", previous: "widgets", pack: { installed: true, enabled: true, detail: "1 pack" }, disabled: "widgets@acme-market", restarted: ["board", "boxscore"] });
    expect(log).toEqual(["set mattstack.activeTeam=gadgets", "install", "enable gadgets@acme-market", "disable widgets@acme-market", "restart board", "restart boxscore"]);
    expect([...enabled]).toEqual(["gadgets@acme-market"]);
  });
  test.each(["sprockets", "../gadgets"])("refuses membership for %s before changing anything", async (team) => {
    const { seams, log } = world();
    await expect(actions.useTeam(team, seams)).rejects.toMatchObject({ code: "not-on-team" });
    expect(log).toEqual([]);
  });
  test.each([{ org: null, code: "no-team" }, { username: null, code: "forge-login-unknown" }])("refuses an unresolved identity", async ({ code, ...active }) => {
    const { seams, log } = world(active);
    await expect(actions.useTeam("gadgets", seams)).rejects.toMatchObject({ code });
    expect(log).toEqual([]);
  });
  test("reselecting a team still installs and enables without disabling it", async () => {
    const { seams, log } = world({ team: "gadgets" });
    expect((await actions.useTeam("gadgets", seams)).disabled).toBeNull();
    expect(log).toEqual(["set mattstack.activeTeam=gadgets", "install", "enable gadgets@acme-market", "restart board", "restart boxscore"]);
  });
  test("failed install skips enabling and leaves the previous pack on", async () => {
    const { seams, log, enabled } = world({}, { installPack: async () => ({ ok: false, detail: "Claude Code is missing" }), restartApp: async () => false });
    expect(await actions.useTeam("gadgets", seams)).toEqual({ team: "gadgets", previous: "widgets", pack: { installed: false, enabled: false, detail: "Claude Code is missing" }, disabled: null, restarted: [] });
    expect(log).toEqual(["set mattstack.activeTeam=gadgets"]);
    expect([...enabled]).toEqual(["widgets@acme-market"]);
  });
  test("a failed enable leaves the previous pack on", async () => {
    const { seams, log, enabled } = world({}, {
      setPackEnabled: async (id, on) => { log.push(`${on ? "enable" : "disable"} ${id}`); if (!on) enabled.delete(id); return !on; },
    });
    expect(await actions.useTeam("gadgets", seams)).toEqual({ team: "gadgets", previous: "widgets", pack: { installed: true, enabled: false, detail: "1 pack" }, disabled: null, restarted: ["board", "boxscore"] });
    expect(log).toEqual(["set mattstack.activeTeam=gadgets", "install", "enable gadgets@acme-market", "restart board", "restart boxscore"]);
    expect([...enabled]).toEqual(["widgets@acme-market"]);
  });
  test("reports unsuccessful enable, disable and individual restarts", async () => {
    const { seams } = world({}, { setPackEnabled: async () => false, restartApp: async (app) => app === "boxscore" });
    expect(await actions.useTeam("gadgets", seams)).toEqual({ team: "gadgets", previous: "widgets", pack: { installed: true, enabled: false, detail: "1 pack" }, disabled: null, restarted: ["boxscore"] });
  });
});
