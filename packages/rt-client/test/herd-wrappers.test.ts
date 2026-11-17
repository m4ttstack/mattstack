import { expect, test } from "bun:test";
import { herdRespawn, herdSpawn } from "../src/index.ts";
import { fakeDaemon } from "./fake-daemon.ts";

// Pins the allowlists in the spawn wrappers' forwarding loops: a field left
// out there is dropped before it reaches the daemon.
test("herdSpawn forwards gateMode", async () => {
  const fake = fakeDaemon({ "herd:spawn": { ok: true, data: {} } });
  const res = await herdSpawn({ herd: "h", job: "j", gateMode: "quiet" }, { sockPath: fake.sock });
  fake.stop();
  expect(res.ok).toBe(true);
  expect(fake.seen.find((s) => s.cmd === "herd:spawn")?.payload).toMatchObject({ herd: "h", job: "j", gateMode: "quiet" });
});

test("herdRespawn forwards gateMode", async () => {
  const fake = fakeDaemon({ "herd:respawn": { ok: true, data: {} } });
  const res = await herdRespawn({ herd: "h", job: "j", gateMode: "chatty" }, { sockPath: fake.sock });
  fake.stop();
  expect(res.ok).toBe(true);
  expect(fake.seen.find((s) => s.cmd === "herd:respawn")?.payload).toMatchObject({ herd: "h", job: "j", gateMode: "chatty" });
});
