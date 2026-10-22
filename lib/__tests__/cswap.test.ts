import { describe, expect, test } from "bun:test";
import { CSWAP_STILL_RUNNING, callerCswapAccount, createCswapExec, cswapConfigDirs, listCswapAccounts, parseCswapList } from "../cswap.ts";
import { fakeProbes } from "../setup/__tests__/fakes.ts";

const CAPTURED = `
A newer version of claude-swap is available (0.25.0). You are using 0.23.0. Run \`cswap upgrade\` to update.
Accounts:
  1: alex@acme.test [Acme] (history: shared)
     ├ $$:    100%   $400.07 / $400.00
     ├ 5h:      0%
     ├ 7d:     40%   resets Aug 30 20:00  in 4d 0h
     └ Fable:  35%   resets Aug 30 20:00  in 4d 0h · 6m ago
  2: someone@example.com
     └ 5h:     12%
`;

test("parses slots, emails, aliases and a compact headroom summary", () => {
  expect(parseCswapList(CAPTURED)).toEqual([
    { slot: 1, email: "alex@acme.test", alias: "Acme", headroom: "5h 0% · 7d 40% · Fable 35%" },
    { slot: 2, email: "someone@example.com", headroom: "5h 12%" },
  ]);
});

test("a headroom label containing a colon still parses", () => {
  const text = `
Accounts:
  1: a@b.c
     ├ Sub:Label:  50%
`;
  expect(parseCswapList(text)).toEqual([{ slot: 1, email: "a@b.c", headroom: "Sub:Label 50%" }]);
});

test("an empty or unrelated output parses to no accounts", () => {
  expect(parseCswapList("")).toEqual([]);
  expect(parseCswapList("cswap: not found")).toEqual([]);
});

test("listCswapAccounts is empty when the binary is missing or fails", async () => {
  const missing = async () => ({ stdout: "", stderr: "", exitCode: -1 });
  expect(await listCswapAccounts(missing)).toEqual([]);
});

const LIST_JSON = JSON.stringify({
  schemaVersion: 1,
  activeAccountNumber: 1,
  accounts: [
    { number: 1, email: "alex@acme.test", active: true },
    { number: 4, email: "other@example.com", active: false },
  ],
});
const SESSION_DIR = "/home/x/.claude-swap-backup/sessions/1-alex_acme.test";

test("callerCswapAccount returns the active account a cswap-run caller sees", async () => {
  let seen: { argv: string[]; env?: Record<string, string | undefined> } | undefined;
  const exec = async (argv: string[], opts: { env?: Record<string, string | undefined> } = {}) => {
    seen = { argv, env: opts.env };
    return { stdout: LIST_JSON, stderr: "", exitCode: 0 };
  };
  expect(await callerCswapAccount({ CLAUDE_CONFIG_DIR: SESSION_DIR }, exec)).toBe("alex@acme.test");
  expect(seen!.argv.slice(1)).toEqual(["list", "--json"]);
  expect(seen!.env?.CLAUDE_CONFIG_DIR).toBe(SESSION_DIR);
});

test("callerCswapAccount is undefined for a default-profile caller, without spawning cswap", async () => {
  let calls = 0;
  const exec = async () => { calls++; return { stdout: LIST_JSON, stderr: "", exitCode: 0 }; };
  expect(await callerCswapAccount({}, exec)).toBeUndefined();
  expect(calls).toBe(0);
});

test("callerCswapAccount is undefined when cswap fails or reports no active account", async () => {
  const env = { CLAUDE_CONFIG_DIR: SESSION_DIR };
  expect(await callerCswapAccount(env, async () => ({ stdout: "", stderr: "", exitCode: 1 }))).toBeUndefined();
  expect(await callerCswapAccount(env, async () => ({ stdout: "not json", stderr: "", exitCode: 0 }))).toBeUndefined();
  const none = JSON.stringify({ activeAccountNumber: null, accounts: [] });
  expect(await callerCswapAccount(env, async () => ({ stdout: none, stderr: "", exitCode: 0 }))).toBeUndefined();
});

test("cswapConfigDirs lists each account folder under the cswap sessions root, sorted, and skips files", () => {
  const root = "/home/x/.claude-swap-backup/sessions";
  const p = fakeProbes({
    home: "/home/x",
    files: { [`${root}/notes.txt`]: "x" },
    dirs: { [root]: ["4-dev2_acme.test", "1-dev1_acme.test", "notes.txt"], [`${root}/1-dev1_acme.test`]: [], [`${root}/4-dev2_acme.test`]: [] },
  });
  expect(cswapConfigDirs(p)).toEqual([`${root}/1-dev1_acme.test`, `${root}/4-dev2_acme.test`]);
  expect(cswapConfigDirs(fakeProbes({ home: "/home/x" }))).toEqual([]);
});

describe("createCswapExec", () => {
  type Result = { stdout: string; stderr: string; exitCode: number };
  function controlled() {
    const runs: Array<(r: Result) => void> = [];
    const spawn = () => new Promise<Result>((resolve) => { runs.push(resolve); });
    return { spawn, runs };
  }

  test("a missing binary reads as a failed spawn", async () => {
    const exec = createCswapExec(() => null);
    expect(await exec(["cswap", "list"], { timeoutMs: 50 })).toEqual({ stdout: "", stderr: "", exitCode: -1 });
  });

  test("a finished run returns its output", async () => {
    const exec = createCswapExec(async () => ({ stdout: "ok", stderr: "", exitCode: 0 }));
    expect(await exec(["cswap", "list"], { timeoutMs: 1_000 })).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  });

  test("a slow run stops the wait, never the child, and a later call joins it", async () => {
    const { spawn, runs } = controlled();
    const exec = createCswapExec(spawn);
    expect((await exec(["cswap", "list", "--json"], { timeoutMs: 10 })).exitCode).toBe(CSWAP_STILL_RUNNING);
    const joined = exec(["cswap", "list", "--json"], { timeoutMs: 1_000 });
    runs[0]!({ stdout: "late", stderr: "", exitCode: 0 });
    expect(await joined).toEqual({ stdout: "late", stderr: "", exitCode: 0 });
    expect(runs).toHaveLength(1);
  });

  test("a call after the run finished starts a fresh one", async () => {
    const { spawn, runs } = controlled();
    const exec = createCswapExec(spawn);
    const first = exec(["cswap", "list"], { timeoutMs: 1_000 });
    runs[0]!({ stdout: "1", stderr: "", exitCode: 0 });
    await first;
    const second = exec(["cswap", "list"], { timeoutMs: 1_000 });
    runs[1]!({ stdout: "2", stderr: "", exitCode: 0 });
    expect((await second).stdout).toBe("2");
  });

  test("callers under different cswap profiles never share a run", async () => {
    const { spawn, runs } = controlled();
    const exec = createCswapExec(spawn);
    const a = exec(["cswap", "list", "--json"], { timeoutMs: 1_000, env: { CLAUDE_CONFIG_DIR: "/a" } });
    const b = exec(["cswap", "list", "--json"], { timeoutMs: 1_000, env: { CLAUDE_CONFIG_DIR: "/b" } });
    expect(runs).toHaveLength(2);
    runs[0]!({ stdout: "a", stderr: "", exitCode: 0 });
    runs[1]!({ stdout: "b", stderr: "", exitCode: 0 });
    expect([(await a).stdout, (await b).stdout]).toEqual(["a", "b"]);
  });
});
