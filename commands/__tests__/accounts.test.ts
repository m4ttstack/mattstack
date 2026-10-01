import { Database } from "bun:sqlite";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { formatAccountsJson, run, accountsBlocks, type AccountsDeps } from "../accounts.ts";
import { readAllCredentialHealth, writeCredentialHealth } from "../../lib/credential-health/db.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { capturePlain } from "./helpers/json-line.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credential_health (
  integration        TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  expires_at         TEXT,
  checked_at         INTEGER NOT NULL,
  last_notified_at   INTEGER,
  last_notified_kind TEXT
);
`;

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
});

describe("formatAccountsJson", () => {
  test("returns empty array when no rows", () => {
    const result = formatAccountsJson(db);
    expect(result).toEqual({ ok: true, accounts: [] });
  });

  test("returns all rows with correct shape", () => {
    writeCredentialHealth(db, {
      integration: "github", status: "ready", detail: "ok",
      expiresAt: "2026-12-01", checkedAt: 1000,
      lastNotifiedAt: null, lastNotifiedKind: null,
    });
    writeCredentialHealth(db, {
      integration: "gitlab", status: "invalid", detail: "401",
      expiresAt: null, checkedAt: 2000,
      lastNotifiedAt: 2000, lastNotifiedKind: "dead",
    });
    const result = formatAccountsJson(db);
    expect(result.ok).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]).toMatchObject({
      integration: "github",
      status: "ready",
      expiresAt: "2026-12-01",
    });
    expect(result.accounts[1]).toMatchObject({
      integration: "gitlab",
      status: "invalid",
    });
  });
});

let cap: ReturnType<typeof capturePlain> | null = null;
afterEach(() => {
  cap?.restore();
  cap = null;
});

function deps(over: Partial<AccountsDeps> = {}): AccountsDeps & { exitCodes: number[] } {
  const exitCodes: number[] = [];
  return {
    db: () => db,
    recheck: async () => true,
    now: () => 10_000_000,
    exit: ((code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    }) as AccountsDeps["exit"],
    exitCodes,
    ...over,
  };
}

async function go(d: AccountsDeps, args: string[]): Promise<void> {
  try {
    await run(args, {}, d);
  } catch (err) {
    if (!(err instanceof Error && err.message === "exit sentinel")) throw err;
  }
}

describe("rt accounts --json bytes", () => {
  test("stdout is exactly the compact formatAccountsJson line", async () => {
    cap = capturePlain();
    await go(deps(), ["--json"]);
    expect(cap.stdout()).toBe(JSON.stringify(formatAccountsJson(db)) + "\n");
  });

  test("a failed recheck under --json is the one-line error object and exit 1", async () => {
    cap = capturePlain();
    const d = deps({ recheck: async () => false });
    await go(d, ["--json", "--recheck"]);
    expect(cap.stdout()).toBe('{"ok":false,"error":"Recheck failed. Is the daemon running?"}\n');
    expect(d.exitCodes).toEqual([1]);
  });
});

describe("rt accounts for a person", () => {
  test("no rows yet is a pending line with the recheck command", () => {
    expect(renderPlain(accountsBlocks([], 0))).toBe("[not yet] No account checks have run yet\n  next: rt accounts --recheck\n");
  });

  test("rows are a table with a status word per account", () => {
    writeCredentialHealth(db, { integration: "github", status: "ready", detail: "ok", expiresAt: "2026-12-01", checkedAt: 10_000_000 - 120_000, lastNotifiedAt: null, lastNotifiedKind: null });
    writeCredentialHealth(db, { integration: "gitlab", status: "invalid", detail: "401", expiresAt: null, checkedAt: 10_000_000 - 3 * 3_600_000, lastNotifiedAt: null, lastNotifiedKind: null });
    const rows = readAllCredentialHealth(db);
    expect(renderPlain(accountsBlocks(rows, 10_000_000))).toBe(
      "ACCOUNT  STATUS    EXPIRES     CHECKED  DETAIL\n" +
        "github   working   2026-12-01  2m ago   ok\n" +
        "gitlab   rejected              3h ago   401\n",
    );
  });

  test("a failed recheck for a person is a failure block on stderr, exit 1", async () => {
    cap = capturePlain();
    const d = deps({ recheck: async () => false });
    await go(d, ["--recheck"]);
    expect(cap.stdout()).toBe("");
    expect(cap.stderr()).toBe("Could not recheck your accounts\n  why: The rt daemon did not answer\n  next: rt daemon start\n");
    expect(d.exitCodes).toEqual([1]);
  });

  test("a successful recheck prints a done line before the table", async () => {
    cap = capturePlain();
    await go(deps(), ["--recheck"]);
    expect(cap.stdout()).toMatch(/^\[ok\] Rechecked your accounts\n/);
  });
});
