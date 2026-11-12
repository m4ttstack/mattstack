import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BILLING_CLASS_SQL,
  type AccountRecord,
  readAccount,
  recordAccount,
} from "../accounts";

const tmp = () => mkdtempSync(join(tmpdir(), "usage-accounts-"));
const oauth = {
  oauthAccount: {
    accountUuid: "u1",
    emailAddress: "a@x",
    organizationType: "claude_max",
    billingType: "stripe_subscription",
  },
};

describe("readAccount", () => {
  test("reads oauthAccount from CLAUDE_CONFIG_DIR's .claude.json", () => {
    const d = tmp();
    writeFileSync(join(d, ".claude.json"), JSON.stringify(oauth));
    expect(readAccount({ configDir: d, home: tmp(), env: {} })).toEqual({
      account: "u1",
      label: "a@x",
      orgType: "claude_max",
      seatTier: null,
      billingType: "stripe_subscription",
    });
  });

  test("falls back to ~/.claude.json with no config dir", () => {
    const home = tmp();
    writeFileSync(join(home, ".claude.json"), JSON.stringify(oauth));
    expect(readAccount({ configDir: null, home, env: {} })?.account).toBe("u1");
  });

  test("an API key wins over an oauth account", () => {
    const home = tmp();
    writeFileSync(join(home, ".claude.json"), JSON.stringify(oauth));
    const r = readAccount({ configDir: null, home, env: { ANTHROPIC_API_KEY: "k" } });
    expect(r?.account).toBe("api-key");
    expect(r?.label).toBe("API key");
  });

  describe("an API key and Claude Code's answer to it", () => {
    const key = `sk-ant-${"x".repeat(30)}`;
    const tail = key.slice(-20);
    const withResponses = (customApiKeyResponses: unknown) => {
      const d = tmp();
      writeFileSync(join(d, ".claude.json"), JSON.stringify({ ...oauth, customApiKeyResponses }));
      return readAccount({ configDir: d, home: tmp(), env: { ANTHROPIC_API_KEY: key } });
    };

    test("a declined key reads the oauth account", () => {
      expect(withResponses({ approved: [], rejected: [tail] })?.account).toBe("u1");
    });

    test("an approved key reads api-key", () => {
      expect(withResponses({ approved: [tail], rejected: [] })?.account).toBe("api-key");
    });

    test("a key in neither list reads api-key", () => {
      expect(withResponses({ approved: ["other"], rejected: ["another"] })?.account).toBe("api-key");
      expect(withResponses(undefined)?.account).toBe("api-key");
    });

    test("a missing or broken config with a key set reads api-key", () => {
      const d = tmp();
      const env = { ANTHROPIC_API_KEY: key };
      expect(readAccount({ configDir: d, home: d, env })?.account).toBe("api-key");
      writeFileSync(join(d, ".claude.json"), "{not json");
      expect(readAccount({ configDir: d, home: d, env })?.account).toBe("api-key");
    });
  });

  test("a missing or broken config reads null", () => {
    const d = tmp();
    expect(readAccount({ configDir: d, home: d, env: {} })).toBeNull();
    writeFileSync(join(d, ".claude.json"), "{not json");
    expect(readAccount({ configDir: d, home: d, env: {} })).toBeNull();
  });

  test("a config with no oauthAccount reads api-key", () => {
    const d = tmp();
    writeFileSync(join(d, ".claude.json"), "{}");
    expect(readAccount({ configDir: d, home: d, env: {} })?.account).toBe("api-key");
  });

  test("label falls back to organizationName", () => {
    const d = tmp();
    writeFileSync(
      join(d, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: "u2", organizationName: "Org" } }),
    );
    expect(readAccount({ configDir: d, home: d, env: {} })?.label).toBe("Org");
  });
});

describe("recordAccount", () => {
  const rec = (account: string): AccountRecord => ({
    account,
    label: null,
    orgType: null,
    seatTier: null,
    billingType: null,
  });

  test("records once per account change", () => {
    const d = tmp();
    const path = join(d, "usage", "accounts.jsonl");
    const call = (a: string) => recordAccount({ path, session: "s1", ts: 1, record: rec(a) });
    expect([call("u1"), call("u1"), call("u2")]).toEqual([true, false, true]);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({
      session: "s1",
      ts: 1,
      account: "u1",
      label: null,
      org_type: null,
      seat_tier: null,
      billing_type: null,
    });
  });

  test("refuses a session that could escape the state dir", () => {
    const path = join(tmp(), "accounts.jsonl");
    expect(recordAccount({ path, session: "../x", ts: 1, record: rec("u1") })).toBe(false);
    expect(recordAccount({ path, session: "a/b", ts: 1, record: rec("u1") })).toBe(false);
  });
});

test("BILLING_CLASS_SQL classifies", () => {
  const db = new Database(":memory:");
  db.run("create table a (account text, seat_tier text, org_type text)");
  const rows: [string, string | null, string | null][] = [
    ["u1", "enterprise_usage_based", "claude_enterprise"],
    ["api-key", null, null],
    ["u3", null, "claude_max"],
    ["u4", null, "claude_pro"],
    ["u5", null, "claude_team"],
  ];
  for (const r of rows) db.run("insert into a values (?, ?, ?)", r);
  const out = db
    .query(`select a.account as account, ${BILLING_CLASS_SQL} as cls from a`)
    .all() as { account: string; cls: string }[];
  expect(out.map((o) => o.cls)).toEqual(["metered", "metered", "plan", "plan", "unknown"]);
});
