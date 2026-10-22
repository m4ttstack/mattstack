import { describe, expect, test } from "bun:test";
import { parseCswapUsage, parseUsageResponse, readAccountUsage, readCredentialsFrom, type ReadDeps } from "../read.ts";

const CSWAP_LIST = {
  schemaVersion: 1,
  accounts: [
    {
      number: 1,
      email: "dev@example.com",
      organizationUuid: "org-1",
      organizationName: "Example Co",
      usageStatus: "ok",
      disabled: true,
      usage: { spend: { used: 1250.17, limit: 1250, pct: 100, currency: "USD", resetsAt: "2026-11-01T00:00:00Z" } },
    },
    {
      number: 2,
      email: "max@example.com",
      organizationUuid: "org-2",
      usageStatus: "ok",
      usage: {
        fiveHour: { pct: 12 },
        sevenDay: { pct: 47, resetsAt: "2026-10-28T10:59:59Z" },
        scoped: [{ name: "Fable", pct: 3 }],
      },
    },
    { number: 3, email: "stale@example.com", usageStatus: "error" },
  ],
};

describe("parseCswapUsage", () => {
  test("reads every account's limits, keyed by email, never by slot, disabled slots included", () => {
    expect(parseCswapUsage(CSWAP_LIST)).toEqual([
      {
        account: "dev@example.com",
        orgUuid: "org-1",
        orgName: "Example Co",
        limits: [{ kind: "spend", pct: 100, used: 1250.17, limit: 1250, currency: "USD", resetsAt: "2026-11-01T00:00:00Z" }],
      },
      {
        account: "max@example.com",
        orgUuid: "org-2",
        limits: [
          { kind: "five_hour", pct: 12 },
          { kind: "seven_day", pct: 47, resetsAt: "2026-10-28T10:59:59Z" },
          { kind: "scoped:Fable", pct: 3 },
        ],
      },
    ]);
  });

  test("an unknown shape reads as no accounts", () => {
    expect(parseCswapUsage({ schemaVersion: 99 })).toEqual([]);
    expect(parseCswapUsage(null)).toEqual([]);
  });
});

describe("parseUsageResponse", () => {
  test("converts extra_usage cents to dollars and reads the windows", () => {
    const limits = parseUsageResponse({
      five_hour: { utilization: 36, resets_at: "2026-10-22T20:00:00Z" },
      seven_day: { utilization: 47 },
      extra_usage: { is_enabled: true, used_credits: 125017, monthly_limit: 125000, utilization: 100 },
      limits: [{ scope: { model: { display_name: "Fable" } }, percent: 9 }],
    });
    expect(limits).toEqual([
      { kind: "spend", pct: 100, used: 1250.17, limit: 1250, currency: "USD" },
      { kind: "five_hour", pct: 36, resetsAt: "2026-10-22T20:00:00Z" },
      { kind: "seven_day", pct: 47 },
      { kind: "scoped:Fable", pct: 9 },
    ]);
  });

  test("an unlimited or disabled extra_usage carries no spend limit", () => {
    expect(parseUsageResponse({ extra_usage: { is_enabled: true, used_credits: 10, monthly_limit: null, utilization: null } })).toEqual([]);
    expect(parseUsageResponse({ extra_usage: { is_enabled: false } })).toEqual([]);
  });
});

const SIGNED_IN = { email: "dev@example.com", orgUuid: "org-1" };

function deps(over: Partial<ReadDeps>): ReadDeps {
  return {
    runCswapList: async () => null,
    readClaudeAccount: async () => null,
    readClaudeCredentials: async () => ({ ok: false, problem: "no OAuth token found" }),
    fetchUsage: async () => ({ ok: false, problem: "unused" }),
    now: () => 1_000,
    ...over,
  };
}

describe("readAccountUsage", () => {
  test("cswap covers the signed-in account, so no token is read", async () => {
    let tokenRead = false;
    const out = await readAccountUsage(deps({
      runCswapList: async () => ({ ok: true, value: CSWAP_LIST }),
      readClaudeAccount: async () => SIGNED_IN,
      readClaudeCredentials: async () => { tokenRead = true; return { ok: false, problem: "x" }; },
    }));
    expect(out.accounts.map((a) => a.account)).toEqual(["dev@example.com", "max@example.com"]);
    expect(out.problems).toEqual([]);
    expect(tokenRead).toBe(false);
  });

  test("cswap with no managed accounts still reads the signed-in account", async () => {
    const out = await readAccountUsage(deps({
      runCswapList: async () => ({ ok: true, value: { schemaVersion: 1, activeAccountNumber: null, accounts: [] } }),
      readClaudeAccount: async () => SIGNED_IN,
      readClaudeCredentials: async () => ({ ok: true, value: { accessToken: "tok" } }),
      fetchUsage: async () => ({ ok: true, value: { seven_day: { utilization: 90 } } }),
    }));
    expect(out.accounts).toEqual([{ account: "dev@example.com", orgUuid: "org-1", limits: [{ kind: "seven_day", pct: 90 }] }]);
  });

  test("a signed-in account cswap does not manage is read beside cswap's", async () => {
    const out = await readAccountUsage(deps({
      runCswapList: async () => ({ ok: true, value: CSWAP_LIST }),
      readClaudeAccount: async () => ({ email: "other@example.com" }),
      readClaudeCredentials: async () => ({ ok: true, value: { accessToken: "tok" } }),
      fetchUsage: async () => ({ ok: true, value: { five_hour: { utilization: 5 } } }),
    }));
    expect(out.accounts.map((a) => a.account)).toEqual(["dev@example.com", "max@example.com", "other@example.com"]);
  });

  test("a signed-in account cswap lists without usage is left to cswap's backoff", async () => {
    let tokenRead = false;
    const backingOff = { schemaVersion: 1, accounts: [{ number: 1, email: "dev@example.com", organizationUuid: "org-1", usageStatus: "unavailable", usage: null }] };
    const out = await readAccountUsage(deps({
      runCswapList: async () => ({ ok: true, value: backingOff }),
      readClaudeAccount: async () => SIGNED_IN,
      readClaudeCredentials: async () => { tokenRead = true; return { ok: true, value: { accessToken: "tok" } }; },
    }));
    expect(tokenRead).toBe(false);
    expect(out.accounts).toEqual([]);
  });

  test("a failing cswap falls back to the signed-in account and says why", async () => {
    const out = await readAccountUsage(deps({
      runCswapList: async () => ({ ok: false, problem: "list exited 143" }),
      readClaudeAccount: async () => SIGNED_IN,
      readClaudeCredentials: async () => ({ ok: true, value: { accessToken: "tok", expiresAt: 5_000 } }),
      fetchUsage: async (token: string) => (token === "tok" ? { ok: true, value: { seven_day: { utilization: 90 } } } : { ok: false, problem: "bad token" }),
    }));
    expect(out.accounts.map((a) => a.account)).toEqual(["dev@example.com"]);
    expect(out.problems).toEqual(["cswap: list exited 143"]);
  });

  test("an expired token is skipped rather than refreshed", async () => {
    let fetched = false;
    const out = await readAccountUsage(deps({
      readClaudeAccount: async () => SIGNED_IN,
      readClaudeCredentials: async () => ({ ok: true, value: { accessToken: "tok", expiresAt: 500 } }),
      fetchUsage: async () => { fetched = true; return { ok: true, value: {} }; },
    }));
    expect(fetched).toBe(false);
    expect(out.accounts).toEqual([]);
    expect(out.problems).toEqual(["Claude Code token expired; waiting for Claude Code to refresh it"]);
  });

  test("an endpoint failure is reported, not swallowed", async () => {
    const out = await readAccountUsage(deps({
      readClaudeAccount: async () => SIGNED_IN,
      readClaudeCredentials: async () => ({ ok: true, value: { accessToken: "tok" } }),
      fetchUsage: async () => ({ ok: false, problem: "HTTP 429" }),
    }));
    expect(out.problems).toEqual(["usage endpoint: HTTP 429"]);
  });

  test("no cswap and no Claude Code login reads as nothing, quietly", async () => {
    expect(await readAccountUsage(deps({}))).toEqual({ accounts: [], problems: [] });
  });
});

describe("readCredentialsFrom", () => {
  const fresh = JSON.stringify({ claudeAiOauth: { accessToken: "keychain", expiresAt: 9 } });
  const stale = JSON.stringify({ claudeAiOauth: { accessToken: "file", expiresAt: 1 } });

  test("on macOS the keychain wins over a lagging plain file", async () => {
    const got = await readCredentialsFrom({ platform: "darwin", readKeychain: async () => fresh, readFile: async () => stale });
    expect(got).toEqual({ ok: true, value: { accessToken: "keychain", expiresAt: 9 } });
  });

  test("on macOS the file is the fallback when the keychain has nothing", async () => {
    const got = await readCredentialsFrom({ platform: "darwin", readKeychain: async () => null, readFile: async () => stale });
    expect(got).toEqual({ ok: true, value: { accessToken: "file", expiresAt: 1 } });
  });

  test("elsewhere only the file is read", async () => {
    let keychainRead = false;
    const got = await readCredentialsFrom({ platform: "linux", readKeychain: async () => { keychainRead = true; return fresh; }, readFile: async () => stale });
    expect(got.ok && got.value.accessToken).toBe("file");
    expect(keychainRead).toBe(false);
  });
});
