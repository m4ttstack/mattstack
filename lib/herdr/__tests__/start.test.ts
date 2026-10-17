import { expect, test } from "bun:test";
import { createHerdrStarter, HERDR_NOT_INSTALLED, type HerdrStartSeams } from "../start.ts";
import { herdrServerEnv } from "../login-env.ts";

const BIN = "/opt/acme/bin/herdr";
const SOCK = "/Users/dev1/.config/herdr/herdr.sock";
const CALLER = { PATH: "/usr/bin", HOME: "/Users/dev1", USER: "dev1", RT_BATCH: "1", HERDR_THEME: "acme" };
const LOGIN = { PATH: "/opt/acme/bin:/usr/bin", HOME: "/Users/dev1", SHELL: "/bin/zsh" };

type Spawned = { argv: string[]; env: Record<string, string>; cwd: string };

/** A fake herdr: `up` flips once the server binds; the clock only moves on sleep. */
function fakeSeams(over: Partial<HerdrStartSeams> & { bindAfterPings?: number } = {}) {
  const spawned: Spawned[] = [];
  const pinged: string[] = [];
  let clock = 1_000;
  let pingsSinceSpawn = 0;
  let bound = false;
  const bindAfterPings = over.bindAfterPings ?? 1;
  const seams: Partial<HerdrStartSeams> = {
    ping: async (sock) => {
      pinged.push(sock);
      if (spawned.length > 0 && bindAfterPings >= 0 && ++pingsSinceSpawn > bindAfterPings) bound = true;
      return bound;
    },
    resolveBin: () => BIN,
    exists: () => true,
    loginEnv: async () => LOGIN,
    spawn: (argv, env, cwd) => { spawned.push({ argv, env, cwd }); },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    env: CALLER,
    home: "/Users/dev1",
    ...over,
  };
  return { seams, spawned, pinged };
}

test("a herdr that answers its ping is running and nothing is spawned", async () => {
  const { seams, spawned } = fakeSeams({ ping: async () => true });
  const r = await createHerdrStarter(seams, { socketPath: SOCK }).start();
  expect(r).toEqual({ state: "running", bin: BIN });
  expect(spawned).toHaveLength(0);
});

test("a leftover socket that refuses connections is started, not reported running", async () => {
  const { seams, spawned } = fakeSeams({ exists: () => true });
  const r = await createHerdrStarter(seams, { socketPath: SOCK }).start();
  expect(spawned).toHaveLength(1);
  expect(r).toEqual({ state: "started", bin: BIN });
});

test("a missing herdr binary is not-installed and nothing is spawned", async () => {
  const { seams, spawned } = fakeSeams({ exists: (p) => p !== BIN });
  const r = await createHerdrStarter(seams, { socketPath: SOCK }).start();
  expect(r).toEqual({ state: "not-installed", bin: BIN });
  expect(spawned).toHaveLength(0);
  expect(HERDR_NOT_INSTALLED).toBe("herdr isn't installed. Open mattstack Setup to install it");
});

test("a server that never answers fails naming its log, and a retry inside the cooldown does not spawn again", async () => {
  const { seams, spawned } = fakeSeams({ bindAfterPings: -1 });
  const starter = createHerdrStarter(seams, { socketPath: SOCK, readyTimeoutMs: 500, cooldownMs: 60_000 });
  const first = await starter.start();
  expect(first.state).toBe("failed");
  if (first.state !== "failed") throw new Error("unreachable");
  expect(first.detail).toContain("~/.config/herdr/herdr-server.log");
  expect(spawned).toHaveLength(1);

  const second = await starter.start();
  expect(second.state).toBe("failed");
  expect(spawned).toHaveLength(1);
});

test("a retry after the cooldown spawns again", async () => {
  let clock = 0;
  const { seams, spawned } = fakeSeams({ bindAfterPings: -1, now: () => clock, sleep: async (ms) => { clock += ms; } });
  const starter = createHerdrStarter(seams, { socketPath: SOCK, readyTimeoutMs: 500, cooldownMs: 1_000 });
  await starter.start();
  clock += 1_000;
  await starter.start();
  expect(spawned).toHaveLength(2);
});

test("a spawn that throws is failed with its reason", async () => {
  const { seams } = fakeSeams({ spawn: () => { throw new Error("EACCES"); } });
  const r = await createHerdrStarter(seams, { socketPath: SOCK }).start();
  expect(r.state).toBe("failed");
  if (r.state !== "failed") throw new Error("unreachable");
  expect(r.detail).toContain("EACCES");
});

test("two concurrent starts share one spawn and both come back started", async () => {
  const { seams, spawned } = fakeSeams({ bindAfterPings: 3 });
  const starter = createHerdrStarter(seams, { socketPath: SOCK });
  const [a, b] = await Promise.all([starter.start(), starter.start()]);
  expect(spawned).toHaveLength(1);
  expect(a).toEqual({ state: "started", bin: BIN });
  expect(b).toEqual({ state: "started", bin: BIN });
});

test("the server is spawned as `herdr server` from home with the built server env", async () => {
  const { seams, spawned, pinged } = fakeSeams();
  await createHerdrStarter(seams, { socketPath: SOCK, extraEnv: { HERDR_SESSION: "bg" } }).start();
  expect(spawned[0]).toEqual({
    argv: [BIN, "server"],
    cwd: "/Users/dev1",
    env: herdrServerEnv(CALLER, LOGIN, { HERDR_SESSION: "bg" }),
  });
  expect(pinged.every((s) => s === SOCK)).toBe(true);
});
