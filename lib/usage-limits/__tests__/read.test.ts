import { describe, expect, test } from "bun:test";
import { parseCswapList, parseUsageResponse, readAccountUsage, type ReadDeps } from "../read.ts";

const CSWAP_LIST = {
  schemaVersion: 1,
  accounts: [
    {
      number: 1,
      email: "dev@example.com",
      organizationUuid: "org-1",
      usageStatus: "ok",
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

describe("parseCswapList", () => {
  test("reads every account's limits, keyed by email, never by slot", () => {
    expect(parseCswapList(CSWAP_LIST)).toEqual([
      {
        account: "dev@example.com",
        orgUuid: "org-1",
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
    expect(parseCswapList({ schemaVersion: 99 })).toEqual([]);
    expect(parseCswapList(null)).toEqual([]);
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

function deps(over: Partial<ReadDeps>): ReadDeps {
  return {
    runCswapList: async () => null,
    readClaudeCredentials: async () => null,
    readClaudeAccount: async () => null,
    fetchUsage: async () => null,
    now: () => 1_000,
    ...over,
  };
}

describe("readAccountUsage", () => {
  test("uses cswap when it is installed, and never reads a token", async () => {
    let tokenRead = false;
    const out = await readAccountUsage(deps({
      runCswapList: async () => CSWAP_LIST,
      readClaudeCredentials: async () => { tokenRead = true; return null; },
    }));
    expect(out.source).toBe("cswap");
    expect(out.accounts.map((a) => a.account)).toEqual(["dev@example.com", "max@example.com"]);
    expect(tokenRead).toBe(false);
  });

  test("without cswap, reads the signed-in Claude Code account", async () => {
    const out = await readAccountUsage(deps({
      readClaudeCredentials: async () => ({ accessToken: "tok", expiresAt: 5_000 }),
      readClaudeAccount: async () => ({ email: "dev@example.com", orgUuid: "org-1" }),
      fetchUsage: async (token) => (token === "tok" ? { seven_day: { utilization: 90 } } : null),
    }));
    expect(out).toEqual({
      source: "claude-code",
      accounts: [{ account: "dev@example.com", orgUuid: "org-1", limits: [{ kind: "seven_day", pct: 90 }] }],
    });
  });

  test("an expired token is skipped rather than refreshed", async () => {
    let fetched = false;
    const out = await readAccountUsage(deps({
      readClaudeCredentials: async () => ({ accessToken: "tok", expiresAt: 500 }),
      readClaudeAccount: async () => ({ email: "dev@example.com" }),
      fetchUsage: async () => { fetched = true; return {}; },
    }));
    expect(fetched).toBe(false);
    expect(out.accounts).toEqual([]);
  });

  test("no cswap and no Claude Code login reads as nothing", async () => {
    expect(await readAccountUsage(deps({}))).toEqual({ source: "none", accounts: [] });
  });
});
