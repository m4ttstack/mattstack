import { describe, expect, test } from "bun:test";
import { join } from "path";
import type { HerdrResult } from "../../herdr/client.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { OLD_BG_SESSION, retireOldBgServer } from "../migrations/retire-old-bg-server.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/home/test";
const SOCK = join(HOME, ".config", "herdr", "sessions", "bg", "herdr.sock");
const ctxWith = (p: ApplyContext["p"]): ApplyContext => ({ p }) as Partial<ApplyContext> as ApplyContext;

type Snapshot = HerdrResult<{ snapshot: { panes: { pane_id: string }[] } }>;
const answering = (paneIds: string[]): Snapshot => ({ ok: true, result: { snapshot: { panes: paneIds.map((pane_id) => ({ pane_id })) } } });
const silent: Snapshot = { ok: false, code: "herdr unavailable", message: "connection refused" };

describe("2026-10-22-retire-old-bg-server", () => {
  test("is the last migration, so ids stay in date order", () => {
    expect(MIGRATIONS.at(-1)?.id).toBe("2026-10-22-retire-old-bg-server");
  });

  test("no old socket: nothing to do", async () => {
    const asked: string[] = [];
    const migration = retireOldBgServer({ snapshot: async (sock) => (asked.push(sock), answering([])) });
    const p = fakeProbes({ home: HOME });

    expect(await migration.run(ctxWith(p))).toEqual({ state: "skipped", detail: "There was no old background herdr server" });
    expect(asked).toEqual([]);
    expect(p.calls.exec).toEqual([]);
  });

  test("a socket nobody answers on: the server is not running, and nothing is stopped or deleted", async () => {
    const migration = retireOldBgServer({ snapshot: async () => silent });
    const p = fakeProbes({ home: HOME, files: { [SOCK]: "" } });

    expect(await migration.run(ctxWith(p))).toEqual({ state: "skipped", detail: "The old background herdr server was not running" });
    expect(p.calls.exec).toEqual([]);
  });

  test("a running server with no panes is stopped by name", async () => {
    const asked: string[] = [];
    const migration = retireOldBgServer({ snapshot: async (sock) => (asked.push(sock), answering([])), herdrBin: () => "herdr" });
    const p = fakeProbes({ home: HOME, files: { [SOCK]: "" }, exec: () => ({ code: 0, stdout: "", stderr: "" }) });

    expect(await migration.run(ctxWith(p))).toEqual({ state: "done", detail: "Stopped the old background herdr server" });
    expect(asked).toEqual([SOCK]);
    expect(p.calls.exec).toEqual([["herdr", "session", "stop", OLD_BG_SESSION]]);
  });

  test("a running server that still holds panes is left for the user", async () => {
    const migration = retireOldBgServer({ snapshot: async () => answering(["p1", "p2"]), herdrBin: () => "herdr" });
    const p = fakeProbes({ home: HOME, files: { [SOCK]: "" } });

    const outcome = await migration.run(ctxWith(p));
    expect(outcome.state).toBe("needs-you");
    expect(outcome).toMatchObject({ detail: "The old background herdr server still has 2 panes open" });
    expect((outcome as { remedy?: string }).remedy).toContain("herdr session stop bg");
    expect(p.calls.exec).toEqual([]);
  });

  test("a stop herdr refuses fails, so the next update tries again", async () => {
    const migration = retireOldBgServer({ snapshot: async () => answering([]), herdrBin: () => "herdr" });
    const p = fakeProbes({ home: HOME, files: { [SOCK]: "" }, exec: () => ({ code: 1, stdout: "no such session", stderr: "" }) });

    const outcome = await migration.run(ctxWith(p));
    expect(outcome.state).toBe("failed");
    expect(outcome).toMatchObject({ detail: "herdr could not stop the old background server: no such session" });
  });
});
