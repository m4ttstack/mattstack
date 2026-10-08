import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ModBlock, NativeSessionRef } from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb } from "../../state/db.ts";
import { createSessionStore } from "../session-store.ts";
import { createModLinks, TESTED_CLAUDE_CODE, type ModLinks } from "../claude/mod-links.ts";

let dir = "";
let origHome: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "rt-mod-links-"));
  process.env.HOME = join(dir, "home");
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

const claudeRef = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });

function harness(over: { enabled?: () => boolean } = {}) {
  const db: Database = openStateDb(join(dir, "state.db"));
  const store = createSessionStore(db);
  const clock = { now: 1_000_000 };
  const links: ModLinks = createModLinks({
    now: () => clock.now,
    integrationsEnabled: over.enabled ?? (() => true),
    store,
  });
  return { db, store, clock, links };
}

const ALL: ModBlock[] = ["delivery", "gate-form", "presence"];

function register(links: ModLinks, sessionId: string, over: Partial<Parameters<ModLinks["register"]>[0]> = {}) {
  const result = links.register({
    sessionId, cwd: "/repo", root: "/repo", pane: "w1:p1",
    claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ALL, ...over,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("mod links", () => {
  test("blocks clear 30 s after the last heartbeat", () => {
    const { links, clock } = harness();
    const start = clock.now;
    const { linkId } = register(links, "sess-1");
    expect(links.live("sess-1", "delivery")).toBe(true);
    expect(links.live("sess-1", "observe")).toBe(false);

    clock.now = start + 29_000;
    expect(links.live("sess-1", "delivery")).toBe(true);
    clock.now = start + 31_000;
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.linkOf("sess-1")).toBeNull();
    const late = links.heartbeat(linkId);
    expect(late.ok).toBe(false);

    const again = register(links, "sess-1");
    clock.now = start + 31_000 + 20_000;
    expect(links.heartbeat(again.linkId).ok).toBe(true);
    clock.now = start + 31_000 + 20_000 + 29_000;
    expect(links.live("sess-1", "delivery")).toBe(true);
    expect(links.linkOf("sess-1")?.lastHeartbeatAt).toBe(start + 31_000 + 20_000);
    clock.now = start + 31_000 + 20_000 + 31_000;
    expect(links.sweep()).toBe(1);
    expect(links.live("sess-1", "delivery")).toBe(false);
  });

  test("switch off refuses register and clears existing links", () => {
    let enabled = true;
    const { links } = harness({ enabled: () => enabled });
    const { linkId } = register(links, "sess-1");
    expect(links.live("sess-1", "delivery")).toBe(true);

    enabled = false;
    const refused = links.register({
      sessionId: "sess-2", cwd: "/repo", root: "/repo", claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ALL,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("refused");
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.linkOf("sess-1")).toBeNull();
    expect(links.heartbeat(linkId).ok).toBe(false);

    enabled = true;
    expect(links.heartbeat(linkId).ok).toBe(false);
    expect(links.live("sess-2", "delivery")).toBe(false);
  });

  test("an engine outside the tested range registers with no blocks", () => {
    const { links } = harness();
    for (const [sessionId, claudeCode] of [["new", "9.0.0"], ["old", "2.1.292"], ["odd", "unknown"]] as const) {
      const out = register(links, sessionId, { claudeCode });
      expect(out.blocks).toEqual([]);
      expect(links.live(sessionId, "delivery")).toBe(false);
      expect(links.linkOf(sessionId)).toMatchObject({ claudeCode, blocks: [] });
      expect(links.heartbeat(out.linkId).ok).toBe(true);
    }
    const inRange = register(links, "in", { claudeCode: `${TESTED_CLAUDE_CODE.min} (Claude Code)` });
    expect(inRange.blocks).toEqual(ALL);
  });

  test("a link-reported id change keeps the binding key and identity and advances the generation", () => {
    const { links, store } = harness();
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), claudeRef("sess-1"), { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    const old = register(links, "sess-1");

    const next = register(links, "sess-2", { previousSessionId: "sess-1" });

    const moved = store.get(bound.data.key);
    expect(moved?.key).toBe(bound.data.key);
    expect(moved?.identity).toBe("remy.ab12");
    expect(moved?.native).toEqual(claudeRef("sess-2"));
    expect(moved?.attachment.generation).toBe(bound.data.attachment.generation + 1);
    expect(store.find(claudeRef("sess-1"))).toBeNull();
    expect(links.live("sess-2", "delivery")).toBe(true);
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.heartbeat(old.linkId).ok).toBe(false);
    expect(links.heartbeat(next.linkId).ok).toBe(true);
  });

  test("an id change without a live link from the old id registers fresh, with no continuation", () => {
    const { links, store, clock } = harness();
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), claudeRef("sess-1"), { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);

    register(links, "sess-2", { previousSessionId: "sess-1" });
    expect(store.get(bound.data.key)).toEqual(bound.data);
    expect(links.live("sess-2", "delivery")).toBe(true);

    register(links, "sess-1");
    clock.now += 31_000;
    register(links, "sess-3", { previousSessionId: "sess-1" });
    expect(store.get(bound.data.key)).toEqual(bound.data);
    expect(store.find(claudeRef("sess-3"))).toBeNull();
    expect(links.live("sess-3", "delivery")).toBe(true);
  });

  test("two links for one session id: the newer wins and the older stops counting", () => {
    const { links } = harness();
    const older = register(links, "sess-1", { blocks: ["delivery"] });
    const newer = register(links, "sess-1", { blocks: ["presence"], pane: "w2:p2" });

    expect(links.linkOf("sess-1")).toMatchObject({ linkId: newer.linkId, pane: "w2:p2", blocks: ["presence"] });
    expect(links.live("sess-1", "presence")).toBe(true);
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.heartbeat(older.linkId).ok).toBe(false);
    expect(links.has(older.linkId)).toBe(false);
    links.end(older.linkId);
    expect(links.live("sess-1", "presence")).toBe(true);
    links.end(newer.linkId);
    expect(links.live("sess-1", "presence")).toBe(false);
    expect(links.linkOf("sess-1")).toBeNull();
  });

  test("a link view carries what diagnostics list", () => {
    const { links, clock } = harness();
    const { linkId } = register(links, "sess-1", { blocks: ["delivery", "delivery", "not-a-block" as ModBlock] });
    expect(links.linkOf("sess-1")).toEqual({
      linkId, sessionId: "sess-1", cwd: "/repo", root: "/repo", pane: "w1:p1",
      claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ["delivery"],
      registeredAt: clock.now, lastHeartbeatAt: clock.now,
    });
  });

  test("an ack is recorded under its command id for the link that sent it", () => {
    const { links, clock } = harness();
    const { linkId } = register(links, "sess-1");
    expect(links.ack("ml-missing", "cmd-1").ok).toBe(false);
    expect(links.ack(linkId, "cmd-1").ok).toBe(true);
    expect(links.takeAck("cmd-1")).toEqual({ linkId, sessionId: "sess-1", at: clock.now });
    expect(links.takeAck("cmd-1")).toBeNull();
  });
});
