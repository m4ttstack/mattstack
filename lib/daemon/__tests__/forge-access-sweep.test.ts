import { describe, expect, test } from "bun:test";
import type { SecretsSeams } from "../../secrets/store.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import { createForgeAccessSweep } from "../forge-access-sweep.ts";

const HOME = "/h";
function probes(me: string, latch: boolean, applied: string | null) {
  return fakeProbes({
    home: HOME,
    files: {
      [`${HOME}/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: {} } }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: me, rtMayManageMembership: latch, ...(applied ? { forgeAccess: { fingerprint: applied, manualSteps: [] } } : {}) }),
    },
  });
}
const log = { info: () => {}, warn: () => {} };
const secrets = () => ({}) as SecretsSeams;
const result = (admin: { reencrypted: string[]; failure: string | null } | null = null) => ({ report: { kind: "no-forge" as const }, applied: { done: [], manualSteps: [], limit: null }, admin });

describe("forge access sweep", () => {
  test("applies, with the org's own secret seams, when the wanted access moved since the last apply", async () => {
    const calls: unknown[] = [];
    const seams = { marker: "acme seams" } as unknown as SecretsSeams;
    const sweep = createForgeAccessSweep({
      probes: probes("dev1", true, "old"),
      slugs: () => ["acme"],
      fingerprint: async () => "new",
      secrets: (slug) => (slug === "acme" ? seams : ({} as SecretsSeams)),
      run: async (_p, slug, s) => { calls.push([slug, s]); return result(); },
      log,
    });
    await sweep();
    expect(calls).toEqual([["acme", seams]]);
  });
  test("does nothing when it has not moved, before the data has its own branch or on a trial, without the latch, or off an admin's Mac", async () => {
    const cases = [probes("dev1", true, "same"), probes("dev1", false, "old"), probes("dev3", true, "old")];
    for (const p of cases) {
      let ran = false;
      const sweep = createForgeAccessSweep({ probes: p, slugs: () => ["acme"], fingerprint: async () => "same", secrets, run: async () => { ran = true; return result(); }, log });
      await sweep();
      expect(ran).toBe(false);
    }
    let ran = false;
    await createForgeAccessSweep({ probes: probes("dev1", true, null), slugs: () => ["acme"], fingerprint: async () => null, secrets, run: async () => { ran = true; return result(); }, log })();
    expect(ran).toBe(false);
  });
  test("an admin-only secrets failure after a role change is logged, never thrown", async () => {
    const warned: unknown[] = [];
    const sweep = createForgeAccessSweep({
      probes: probes("dev1", true, "old"),
      slugs: () => ["acme"],
      fingerprint: async () => "new",
      secrets,
      run: async () => result({ reencrypted: [], failure: "sops refused" }),
      log: { info: () => {}, warn: (...args: unknown[]) => { warned.push(args); } },
    });
    await sweep();
    expect(JSON.stringify(warned)).toContain("sops refused");
  });
  test("a tick that arrives while one is still applying does nothing", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sweep = createForgeAccessSweep({ probes: probes("dev1", true, "old"), slugs: () => ["acme"], fingerprint: async () => "new", secrets, run: async () => { calls++; await gate; return result(); }, log });
    const first = sweep();
    await sweep();
    release();
    await first;
    expect(calls).toBe(1);
  });
  test("one org that throws is logged and the next still runs", async () => {
    const warned: unknown[] = [];
    const seen: string[] = [];
    const sweep = createForgeAccessSweep({
      probes: probes("dev1", true, "old"),
      slugs: () => ["acme", "acme"],
      fingerprint: async () => "new",
      secrets,
      run: async (_p, slug) => { seen.push(slug); if (seen.length === 1) throw new Error("timed out"); return result(); },
      log: { info: () => {}, warn: (...args: unknown[]) => { warned.push(args); } },
    });
    await sweep();
    expect(seen.length).toBe(2);
    expect(warned.length).toBe(1);
  });
});
