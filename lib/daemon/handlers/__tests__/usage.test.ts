import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createUsageHandlers } from "../usage.ts";
import { coerceQueryParams } from "../../api-server.ts";
import { openUsageDb } from "../../../usage/store.ts";

const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as any;
const KEY = "remote:gitlab.com%2Facme%2Fwidgets!12";

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-handlers-"));
  dbPath = join(dir, "usage.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(): void {
  const db = openUsageDb(dbPath);
  db.query(
    `INSERT INTO usage_runs (machine_id, run_id, repo, pipeline, work_type, status, started_at, mr_key)
     VALUES ('m', 'r-1', 'remote:gitlab.com%2Facme%2Fwidgets', 'work', 'feature', 'done', ?, ?)`,
  ).run(Date.now() - 1000, KEY);
  db.query(
    `INSERT INTO usage_messages (machine_id, message_id, session_id, ts, model, input, output, cache_read,
       cache_write_5m, cache_write_1h, run_id, mr_key, attribution)
     VALUES ('m', 'msg-1', 's-1', ?, 'claude-opus-5', 10, 20, 0, 0, 0, 'r-1', ?, 'run')`,
  ).run(Date.now() - 1000, KEY);
  db.close();
}

const make = () => createUsageHandlers({ log } as any, { dbPath }) as any;

describe("usage handlers", () => {
  test("usage:mrs returns ok with no database", async () => {
    const res = await make()["usage:mrs"]({});
    expect(res.ok).toBe(true);
    expect(res.data.mrs).toEqual([]);
  });

  test("usage:mr with no mrKey is refused", async () => {
    const h = make();
    expect((await h["usage:mr"]({})).ok).toBe(false);
    expect((await h["usage:mr"]({ mrKey: "  " })).ok).toBe(false);
  });

  test("usage:mr with an unknown key returns null data", async () => {
    const res = await make()["usage:mr"]({ mrKey: "remote:none!1" });
    expect(res).toEqual({ ok: true, data: null });
  });

  test("days must be a positive number", async () => {
    const h = make();
    for (const days of [0, -3, "abc", "30", Number.NaN, null, 3651, 3e7]) {
      expect((await h["usage:mrs"]({ days })).ok).toBe(false);
      expect((await h["usage:trends"]({ days })).ok).toBe(false);
    }
    expect((await h["usage:trends"]({})).ok).toBe(false);
    expect((await h["usage:mrs"]({ days: 30 })).ok).toBe(true);
    expect((await h["usage:trends"]({ days: 30 })).ok).toBe(true);
    expect((await h["usage:mrs"]({ days: 3650 })).ok).toBe(true);
    expect((await h["usage:trends"]({ days: 3650 })).ok).toBe(true);
  });

  test("usage:status returns ok with no database", async () => {
    const res = await make()["usage:status"]({});
    expect(res.ok).toBe(true);
    expect(res.data.messages).toBe(0);
  });

  test("an mrKey with % ! : survives a REST query string to the handler", async () => {
    seed();
    const url = new URL(`http://x/api/usage/mr?mrKey=${encodeURIComponent(KEY)}`);
    const payload = coerceQueryParams(url.searchParams);
    expect(payload.mrKey).toBe(KEY);
    const res = await make()["usage:mr"](payload);
    expect(res.ok).toBe(true);
    expect(res.data.mrKey).toBe(KEY);
  });

  test("REST days arrives as a number and the handler accepts it", async () => {
    seed();
    const payload = coerceQueryParams(new URLSearchParams("days=7&repo=remote%3Agitlab.com%252Facme%252Fwidgets"));
    expect(payload.days).toBe(7);
    const res = await make()["usage:mrs"](payload);
    expect(res.ok).toBe(true);
    expect(res.data.mrs.length).toBe(1);
  });
});
