import { describe, expect, test } from "bun:test";
import { endLogin, LOGIN_TTL_MS, loginSessionPath, readLogin, sendLoginInput, startLogin, type LoginSeams, type LoginSession } from "../cli-login.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/fake-home";
const NOW = new Date("2026-01-01T00:00:00Z");
const LOGINS = `${HOME}/.mattstack/rt/logins`;
const WRAPPER = 'exec 3<>"$1"; shift; cat <&3 | { /usr/bin/script -q /dev/null "$@"; kill 0; }';

function fakeSeams(opts: { alive?: boolean; pid?: number | null } = {}): LoginSeams & { spawned: string[][]; killed: number[]; fifos: string[]; written: Array<[string, string]> } {
  const spawned: string[][] = [];
  const killed: number[] = [];
  const fifos: string[] = [];
  const written: Array<[string, string]> = [];
  return {
    spawned,
    killed,
    fifos,
    written,
    spawnDetached(argv) {
      spawned.push(argv);
      return opts.pid === undefined ? 4242 : opts.pid;
    },
    alive: () => opts.alive ?? true,
    kill(pid) {
      killed.push(pid);
    },
    mkfifo(path) {
      fifos.push(path);
      return true;
    },
    writeFifo(path, text) {
      written.push([path, text]);
      return true;
    },
  };
}

function session(tool: LoginSession["tool"], startedAt: Date): LoginSession {
  return { tool, pid: 4242, startedAt: startedAt.toISOString(), logPath: `${LOGINS}/${tool}.log`, fifoPath: `${LOGINS}/${tool}.fifo`, url: null, code: null, prompt: false };
}

function seeded(record: LoginSession, log = "") {
  return fakeProbes({ home: HOME, now: NOW, files: { [loginSessionPath(HOME, record.tool)]: JSON.stringify(record), [record.logPath]: log } });
}

describe("cli sign-in sessions", () => {
  test("a new login spawns the tool under script with its own fifo and log", async () => {
    const p = fakeProbes({ home: HOME, now: NOW });
    const seams = fakeSeams();
    const started = await startLogin(p, "claude", { seams, waitMs: 0 });

    expect(seams.fifos).toEqual([`${LOGINS}/claude.fifo`]);
    expect(seams.spawned).toEqual([["/bin/sh", "-c", WRAPPER, "sh", `${LOGINS}/claude.fifo`, "claude", "auth", "login"]]);
    expect(seams.spawned[0]![2]).toContain('/usr/bin/script -q /dev/null "$@"');
    expect(started?.pid).toBe(4242);
    const record = JSON.parse(p.readFile(loginSessionPath(HOME, "claude"))!) as LoginSession;
    expect(record).toMatchObject({ tool: "claude", pid: 4242, startedAt: NOW.toISOString(), logPath: `${LOGINS}/claude.log`, fifoPath: `${LOGINS}/claude.fifo` });
  });

  test("the email is passed when known", async () => {
    const seams = fakeSeams();
    await startLogin(fakeProbes({ home: HOME, now: NOW }), "claude", { email: "jane@example.com", seams, waitMs: 0 });
    expect(seams.spawned[0]!.slice(5)).toEqual(["claude", "auth", "login", "--email", "jane@example.com"]);
  });

  test("a spawn that fails starts nothing", async () => {
    const p = fakeProbes({ home: HOME, now: NOW });
    expect(await startLogin(p, "ldcli", { seams: fakeSeams({ pid: null }), waitMs: 0 })).toBeNull();
    expect(p.readFile(loginSessionPath(HOME, "ldcli"))).toBeNull();
  });

  test("a live, young session is reused, not spawned again", async () => {
    const seams = fakeSeams();
    const p = seeded(session("doppler", new Date(NOW.getTime() - 60_000)));
    const reused = await startLogin(p, "doppler", { seams, waitMs: 0 });
    expect(seams.spawned).toEqual([]);
    expect(reused?.pid).toBe(4242);
  });

  test("a session whose pid died reads as none", () => {
    const p = seeded(session("claude", new Date(NOW.getTime() - 60_000)));
    expect(readLogin(p, "claude", fakeSeams({ alive: false }))).toBeNull();
  });

  test("a session older than ten minutes is killed and replaced", async () => {
    const seams = fakeSeams();
    const p = seeded(session("claude", new Date(NOW.getTime() - LOGIN_TTL_MS - 1000)));
    expect(readLogin(p, "claude", fakeSeams())).toBeNull();

    const replaced = await startLogin(seeded(session("claude", new Date(NOW.getTime() - LOGIN_TTL_MS - 1000))), "claude", { seams, waitMs: 0 });
    expect(seams.killed).toEqual([4242]);
    expect(seams.spawned).toHaveLength(1);
    expect(replaced?.startedAt).toBe(NOW.toISOString());
  });

  test("the url, the doppler code and the paste prompt are read from the log", async () => {
    const p = seeded(session("doppler", NOW), "Your auth code is: ABC-123\nhttps://dashboard.doppler.com/workplace/auth/cli\n");
    expect(readLogin(p, "doppler", fakeSeams())).toMatchObject({ code: "ABC-123", url: "https://dashboard.doppler.com/workplace/auth/cli", prompt: false });

    const claude = seeded(session("claude", NOW), "Opening browser\r\nhttps://claude.ai/oauth/authorize?code=true\r\nPaste code here if prompted > ");
    expect(readLogin(claude, "claude", fakeSeams())).toMatchObject({ url: "https://claude.ai/oauth/authorize?code=true", code: null, prompt: true });
  });

  test("terminal styling in the log never reaches the url", () => {
    const esc = String.fromCharCode(27);
    const p = seeded(session("ldcli", NOW), `Visit ${esc}[1mhttps://app.launchdarkly.com/cli/auth${esc}[0m to sign in\n`);
    expect(readLogin(p, "ldcli", fakeSeams())?.url).toBe("https://app.launchdarkly.com/cli/auth");
  });

  test("startLogin returns the url once the log shows it", async () => {
    const p = fakeProbes({ home: HOME, now: NOW });
    const seams = fakeSeams();
    const spawn = seams.spawnDetached.bind(seams);
    seams.spawnDetached = (argv, io) => {
      p.writeFile(io.log, "Your auth code is: XY-9\nhttps://dashboard.doppler.com/workplace/auth/cli\n");
      return spawn(argv, io);
    };
    const started = await startLogin(p, "doppler", { seams });
    expect(started).toMatchObject({ url: "https://dashboard.doppler.com/workplace/auth/cli", code: "XY-9" });
    expect(JSON.parse(p.readFile(loginSessionPath(HOME, "doppler"))!)).toMatchObject({ code: "XY-9" });
  });

  test("input goes to the fifo with a newline", () => {
    const seams = fakeSeams();
    const p = seeded(session("claude", NOW));
    expect(sendLoginInput(p, "claude", "abc#123", seams)).toBe(true);
    expect(seams.written).toEqual([[`${LOGINS}/claude.fifo`, "abc#123\n"]]);
  });

  test("input to no session goes nowhere", () => {
    const seams = fakeSeams();
    expect(sendLoginInput(fakeProbes({ home: HOME, now: NOW }), "claude", "abc", seams)).toBe(false);
    expect(seams.written).toEqual([]);
  });

  test("ending a login kills it and removes its record", () => {
    const seams = fakeSeams();
    const p = seeded(session("ldcli", NOW));
    endLogin(p, "ldcli", seams);
    expect(seams.killed).toEqual([4242]);
    expect(p.readFile(loginSessionPath(HOME, "ldcli"))).toBeNull();
  });
});
