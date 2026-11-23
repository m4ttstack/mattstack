import { describe, expect, test } from "bun:test";
import { createDevUpdateSweep, DEV_UPDATE_SCHEDULE } from "../dev-update-sweep.ts";

function harness(over: { flavor?: "dev" | "prod"; on?: () => boolean; spawn?: () => Promise<void> } = {}) {
  let spawns = 0;
  let offs = 0;
  const warns: unknown[] = [];
  const sweep = createDevUpdateSweep({
    flavor: () => over.flavor ?? "dev",
    autoUpdateOn: over.on ?? (() => true),
    spawnUpdate: over.spawn ?? (async () => { spawns++; }),
    markOff: () => { offs++; },
    log: { warn: (o: unknown) => warns.push(o), info: () => {} },
  });
  return { sweep, spawns: () => spawns, offs: () => offs, warns };
}

describe("dev update sweep", () => {
  test("runs an hour apart, starting five minutes after boot", () => {
    expect(DEV_UPDATE_SCHEDULE).toEqual({ bootDelayMs: 5 * 60_000, intervalMs: 60 * 60_000 });
  });

  test("a prod daemon never starts the update", async () => {
    const h = harness({ flavor: "prod" });
    await h.sweep();
    expect(h.spawns()).toBe(0);
    expect(h.offs()).toBe(0);
  });

  test("the setting off never starts the update, and records the Mac as off", async () => {
    const h = harness({ on: () => false });
    await h.sweep();
    expect(h.spawns()).toBe(0);
    expect(h.offs()).toBe(1);
  });

  test("a dev daemon with the setting on starts it once per tick", async () => {
    const h = harness();
    await h.sweep();
    await h.sweep();
    expect(h.spawns()).toBe(2);
  });

  test("a tick that arrives while the previous one is still starting is skipped", async () => {
    let release!: () => void;
    let spawns = 0;
    const h = harness({ spawn: () => { spawns++; return new Promise<void>((r) => { release = r; }); } });
    const first = h.sweep();
    await h.sweep();
    expect(spawns).toBe(1);
    release();
    await first;
  });

  test("a settings read that throws is logged and counts as on", async () => {
    const h = harness({ on: () => { throw new Error("settings unreadable"); } });
    await h.sweep();
    expect(h.warns.length).toBe(1);
    expect(h.spawns()).toBe(1);
  });

  test("a spawn that throws is logged and does not throw out of the sweep", async () => {
    const h = harness({ spawn: async () => { throw new Error("no bun"); } });
    await h.sweep();
    expect(h.warns.length).toBe(1);
  });
});
