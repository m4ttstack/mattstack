import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createModLinks, TESTED_CLAUDE_CODE } from "../../agent-integrations/claude/mod-links.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { openStateDb } from "../../state/db.ts";
import type { GatesStore } from "../gates-store.ts";
import { modLinkHooks } from "../mod-link-hooks.ts";

let dir = "";
let origHome: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "rt-mod-link-hooks-"));
  process.env.HOME = join(dir, "home");
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

describe("mod link hooks", () => {
  test("a throwing continued hook still completes the register", () => {
    const db = openStateDb(join(dir, "state.db"));
    const store = createSessionStore(db);
    const warned: string[] = [];
    const log = { info: () => {}, warn: (_o: unknown, message: string) => { warned.push(message); } };
    const gates = {
      nativeQuestions: () => ({ carryGeneration: () => { throw new Error("gates.db is locked"); } }),
    } as unknown as Pick<GatesStore, "nativeQuestions">;
    const links = createModLinks({
      now: () => 1_000_000, integrationsEnabled: () => true, store,
      ...modLinkHooks({ log: log as never, gates, db: () => db }),
    });
    const bound = store.bind(
      store.reserve({ identity: "remy.ab12" }),
      { harness: "claude", profile: "default", kind: "id", value: "sess-1" },
      { mode: "herdr", pane: "w1:p1" },
    );
    if (!bound.ok) throw new Error(bound.error.message);
    const link = { cwd: "/repo", root: "/repo", claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ["presence" as const] };
    const first = links.register({ sessionId: "sess-1", ...link });
    if (!first.ok) throw new Error(first.error.message);

    const next = links.register({ sessionId: "sess-2", previousSessionId: "sess-1", previousLinkId: first.data.linkId, ...link });

    expect(next.ok).toBe(true);
    expect(store.get(bound.data.key)?.native.value).toBe("sess-2");
    expect(links.live("sess-2", "presence")).toBe(true);
    expect(links.continuedAs("sess-1")).toBe("sess-2");
    expect(warned).toEqual(["mod link: the continued session's gate questions did not follow it"]);
  });
});
