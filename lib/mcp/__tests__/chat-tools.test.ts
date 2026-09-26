import { describe, expect, test } from "bun:test";
import { chatToolDefs, type ChatToolDeps } from "../chat-tools.ts";
import { SIGN_IN_HINT } from "../shared.ts";

const SESSION = { sessionId: "s1", handle: "ann", baseHandle: "ann", signedInAt: 1 };
const ENV = { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "w1:p2" } as NodeJS.ProcessEnv;

type Call = { fn: string; a: any; o?: any };

function fake(opts: {
  signedIn?: boolean; fail?: string; who?: unknown; whoFail?: string; alive?: boolean; human?: string | null; spawn?: unknown; dirs?: string[];
  buddiesRows?: unknown[]; buddiesFail?: string; roomsResult?: unknown; roomsFail?: string;
} = {}) {
  const calls: Call[] = [];
  const rec = (fn: string, data: unknown = {}) => (async (a?: unknown, o?: unknown) => {
    calls.push({ fn, a, o });
    return opts.fail ? { ok: false, error: opts.fail } : { ok: true, data };
  }) as any;
  const deps: ChatToolDeps = {
    read: rec("read", { rooms: [{ room: "build", messages: [] }] }),
    messages: rec("messages", { messages: [{ id: 9 }] }),
    mark: rec("mark"),
    rooms: opts.roomsFail
      ? ((async (a?: unknown, o?: unknown) => { calls.push({ fn: "rooms", a, o }); return { ok: false, error: opts.roomsFail }; }) as any)
      : rec("rooms", opts.roomsResult ?? { rooms: [] }),
    who: opts.whoFail
      ? ((async (a?: unknown, o?: unknown) => { calls.push({ fn: "who", a, o }); return { ok: false, error: opts.whoFail }; }) as any)
      : rec("who", opts.who ?? { members: [{ room: "build", handle: "ann" }] }),
    buddies: opts.buddiesFail
      ? ((async (o?: unknown) => { calls.push({ fn: "buddies", a: undefined, o }); return { ok: false, error: opts.buddiesFail }; }) as any)
      : ((async (o?: unknown) => { calls.push({ fn: "buddies", a: undefined, o }); return { ok: true, data: { buddies: opts.buddiesRows ?? [] } }; }) as any),
    join: rec("join", { handle: "ann", memberCount: 2, unread: 0 }),
    leave: rec("leave"),
    away: rec("away"),
    back: rec("back"),
    signOut: rec("signOut", { sessionId: "s1" }),
    archive: rec("archive", { room: "build", archivedAt: 5 }),
    invite: rec("invite", { delivered: "accepted", paneId: "w2:p1" }),
    session: (id) => (opts.signedIn === false || id !== "s1" ? null : SESSION),
    deleteSession: (id) => { calls.push({ fn: "deleteSession", a: id }); },
    spawnRt: async (path, rest, o) => { calls.push({ fn: "spawnRt", a: { path, rest }, o }); return (opts.spawn as any) ?? { ok: true, body: { ok: true, handle: "ann", room: "rt" } }; },
    isDir: (p) => (opts.dirs ?? ["/work"]).includes(p),
    serverCwd: () => "/server",
    humanHandle: () => (opts.human === undefined ? "pat" : opts.human),
    sessionAlive: () => opts.alive ?? true,
    now: () => 1_000_000,
  };
  const tools = chatToolDefs(deps);
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { calls, tool };
}

const HANDLE_TOOLS: Array<[string, Record<string, unknown>]> = [
  ["chat_read", {}], ["chat_mark", {}], ["chat_rooms", {}], ["chat_join", { room: "build" }], ["chat_leave", { room: "build" }],
];

describe("chat tools: identity", () => {
  test.each(HANDLE_TOOLS)("%s refuses an unsigned session with no daemon call", async (name, input) => {
    const f = fake({ signedIn: false });
    const r = await f.tool(name).handler(input, ENV);
    expect(r).toEqual({ ok: false, body: undefined, error: SIGN_IN_HINT });
    expect(f.calls).toEqual([]);
  });

  test.each(HANDLE_TOOLS)("%s ignores a caller handle and sends the session's own", async (name, input) => {
    const f = fake();
    await f.tool(name).handler({ ...input, handle: "mallory", as: "mallory" }, ENV);
    expect(f.calls[0]!.a.handle).toBe("ann");
  });

  test("away and back use the env session id and refuse without one", async () => {
    const f = fake();
    await f.tool("chat_away").handler({ text: "rebasing" }, ENV);
    await f.tool("chat_back").handler({}, ENV);
    expect(f.calls).toEqual([
      { fn: "away", a: { sessionId: "s1", text: "rebasing" }, o: undefined },
      { fn: "back", a: { sessionId: "s1" }, o: undefined },
    ]);
    const g = fake();
    expect((await g.tool("chat_away").handler({ text: "x" }, {} as NodeJS.ProcessEnv)).ok).toBe(false);
    expect((await g.tool("chat_back").handler({}, {} as NodeJS.ProcessEnv)).ok).toBe(false);
    expect(g.calls).toEqual([]);
  });

  test("who and buddies need no sign-in", async () => {
    const f = fake({ signedIn: false });
    expect((await f.tool("chat_who").handler({ room: "build" }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    expect((await f.tool("chat_buddies").handler({}, {} as NodeJS.ProcessEnv)).ok).toBe(true);
  });
});

describe("chat_read", () => {
  test("defaults limit to 20 and returns the rooms", async () => {
    const f = fake();
    const r = await f.tool("chat_read").handler({ room: "build" }, ENV);
    expect(r).toEqual({ ok: true, body: { rooms: [{ room: "build", messages: [] }] } });
    expect(f.calls[0]!.a).toEqual({ handle: "ann", room: "build", limit: 20 });
  });

  test("since is a peek from now minus the CLI duration", async () => {
    const f = fake();
    await f.tool("chat_read").handler({ since: "5m" }, ENV);
    expect(f.calls[0]!.a.sinceMs).toBe(1_000_000 - 300_000);
  });

  test("a bad since, limit or last is refused before the daemon", async () => {
    for (const input of [{ since: "abc" }, { limit: 0 }, { limit: "5" }, { room: "build", last: 1.5 }, { last: 3 }, { room: "build", last: 3, since: "5m" }]) {
      const f = fake();
      const r = await f.tool("chat_read").handler(input, ENV);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });

  test("last reads the newest page then marks the room", async () => {
    const f = fake();
    const r = await f.tool("chat_read").handler({ room: "build", last: 3 }, ENV);
    expect(r).toEqual({ ok: true, body: { rooms: [{ room: "build", messages: [{ id: 9 }] }] } });
    expect(f.calls.map((c) => [c.fn, c.a])).toEqual([
      ["who", { room: "build" }],
      ["messages", { room: "build", limit: 3 }],
      ["mark", { handle: "ann", room: "build" }],
    ]);
  });

  test("last is refused for a non-member with no messages or mark call", async () => {
    const f = fake({ who: { members: [{ room: "build", handle: "bob" }] } });
    const r = await f.tool("chat_read").handler({ room: "build", last: 3 }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not a member");
    expect(f.calls.map((c) => c.fn)).toEqual(["who"]);
  });

  test("last fails closed when who errors, with no messages or mark call", async () => {
    const f = fake({ whoFail: "rt daemon unreachable" });
    const r = await f.tool("chat_read").handler({ room: "build", last: 3 }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rt daemon unreachable");
    expect(f.calls.map((c) => c.fn)).toEqual(["who"]);
  });

  test("a bad room name is refused", async () => {
    const f = fake();
    expect((await f.tool("chat_read").handler({ room: "Bad Room" }, ENV)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
});

describe("chat_mark, chat_join, chat_leave, chat_rooms, chat_who", () => {
  test("mark passes room and upto; upto needs a room and a positive integer", async () => {
    const f = fake();
    expect(await f.tool("chat_mark").handler({ room: "build", upto: 4 }, ENV)).toEqual({ ok: true, body: {} });
    expect(f.calls[0]!.a).toEqual({ handle: "ann", room: "build", upto: 4 });
    for (const input of [{ upto: 4 }, { room: "build", upto: 0 }, { room: "build", upto: 2.5 }]) {
      const g = fake();
      expect((await g.tool("chat_mark").handler(input, ENV)).ok, JSON.stringify(input)).toBe(false);
      expect(g.calls).toEqual([]);
    }
  });

  test("join sends wakeOn, the given cwd and the server's own pane ref", async () => {
    const f = fake();
    const r = await f.tool("chat_join").handler({ room: "build", wakeOn: "all", cwd: "/work" }, ENV);
    expect(r).toEqual({ ok: true, body: { room: "build", handle: "ann", memberCount: 2, unread: 0 } });
    expect(f.calls[0]!.a).toEqual({ room: "build", handle: "ann", wakeOn: "all", cwd: "/work", pane: "w1:p2" });
  });

  test("join defaults cwd to the server's and refuses a bad wakeOn or cwd", async () => {
    const f = fake();
    await f.tool("chat_join").handler({ room: "build" }, ENV);
    expect(f.calls[0]!.a.cwd).toBe("/server");
    for (const input of [{ room: "build", wakeOn: "loud" }, { room: "build", cwd: "rel" }, { room: "build", cwd: "/missing" }, {}]) {
      const g = fake();
      expect((await g.tool("chat_join").handler(input, ENV)).ok, JSON.stringify(input)).toBe(false);
      expect(g.calls).toEqual([]);
    }
  });

  test("leave, rooms and who pass through", async () => {
    const f = fake();
    await f.tool("chat_leave").handler({ room: "build" }, ENV);
    await f.tool("chat_rooms").handler({}, ENV);
    await f.tool("chat_who").handler({ room: "build" }, ENV);
    expect(f.calls.map((c) => [c.fn, c.a])).toEqual([["leave", { room: "build", handle: "ann" }], ["rooms", { handle: "ann" }], ["who", { room: "build" }]]);
  });

  test("who requires a room", async () => {
    const f = fake();
    expect((await f.tool("chat_who").handler({}, ENV)).ok).toBe(false);
  });

  test("a daemon error comes back as the tool error", async () => {
    const f = fake({ fail: "rt daemon unreachable" });
    const r = await f.tool("chat_rooms").handler({}, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rt daemon unreachable");
  });

  test("away refuses empty or non-string text", async () => {
    for (const input of [{}, { text: "" }, { text: 3 }]) {
      const f = fake();
      expect((await f.tool("chat_away").handler(input, ENV)).ok, JSON.stringify(input)).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });

  test("away refuses control characters and text over 300 characters, before the daemon", async () => {
    for (const text of ["a\u001b[2Jb", "a\nb", "x".repeat(301)]) {
      const f = fake();
      expect((await f.tool("chat_away").handler({ text }, ENV)).ok, JSON.stringify(text)).toBe(false);
      expect(f.calls).toEqual([]);
    }
    const g = fake();
    expect((await g.tool("chat_away").handler({ text: "x".repeat(300) }, ENV)).ok).toBe(true);
  });
});

describe("chat_sign_in", () => {
  test("spawns the CLI with a fixed argv built from named inputs, in the given cwd", async () => {
    const f = fake();
    const r = await f.tool("chat_sign_in").handler({ cwd: "/work", as: "ann", room: "build", status: "rebasing" }, ENV);
    expect(r).toEqual({ ok: true, body: { handle: "ann", room: "rt" } });
    expect(f.calls).toEqual([{
      fn: "spawnRt",
      a: { path: ["chat", "sign-in"], rest: ["--session", "s1", "--as", "ann", "--room", "build", "--status", "rebasing"] },
      o: { cwd: "/work" },
    }]);
  });

  test("noRoom passes --no-room; no cwd runs in the server's directory", async () => {
    const f = fake();
    await f.tool("chat_sign_in").handler({ noRoom: true }, ENV);
    expect(f.calls[0]!.a.rest).toEqual(["--session", "s1", "--no-room"]);
    expect(f.calls[0]!.o).toEqual({});
  });

  test("never passes --pane, even when input names one", async () => {
    const f = fake();
    await f.tool("chat_sign_in").handler({ pane: "w9:p9", session: "other" }, ENV);
    expect(f.calls[0]!.a.rest).toEqual(["--session", "s1"]);
  });

  test.each([
    [{ room: "build", noRoom: true }],
    [{ cwd: "relative" }],
    [{ cwd: "/missing" }],
    [{ as: "--pane" }],
    [{ status: "-x" }],
    [{ as: "Bad Name" }],
    [{ room: "--no-room" }],
    [{ noRoom: "true" }],
    [{ as: "pat" }],
    [{ as: "here" }],
  ])("refuses %j with no spawn", async (input) => {
    const f = fake();
    const r = await f.tool("chat_sign_in").handler(input, ENV);
    expect(r.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("the human handle refusal follows the setting", async () => {
    const f = fake({ human: "robin" });
    expect((await f.tool("chat_sign_in").handler({ as: "robin" }, ENV)).ok).toBe(false);
    expect((await f.tool("chat_sign_in").handler({ as: "pat" }, ENV)).ok).toBe(true);
  });

  test("an unreadable human handle refuses as, but a plain sign-in still spawns", async () => {
    const f = fake({ human: null });
    const withAs = await f.tool("chat_sign_in").handler({ as: "ann" }, ENV);
    expect(withAs.ok).toBe(false);
    expect(f.calls).toEqual([]);
    const plain = await f.tool("chat_sign_in").handler({}, ENV);
    expect(plain.ok).toBe(true);
    expect(f.calls.length).toBe(1);
  });

  test("a replaced or dead session is refused with the Bash pointer and no spawn", async () => {
    const f = fake({ alive: false });
    const r = await f.tool("chat_sign_in").handler({}, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rt chat sign-in");
    expect(f.calls).toEqual([]);
  });

  test("refuses without a session id", async () => {
    const f = fake();
    expect((await f.tool("chat_sign_in").handler({}, {} as NodeJS.ProcessEnv)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("a CLI failure comes back as the tool error", async () => {
    const f = fake({ spawn: { ok: false, error: "rt daemon unreachable" } });
    const r = await f.tool("chat_sign_in").handler({}, ENV);
    expect(r).toEqual({ ok: false, body: undefined, error: "rt daemon unreachable" });
  });

  test.each([
    [{ ok: true, body: null }],
    [{ ok: true, body: { ok: true } }],
  ])("a malformed CLI body is refused, not thrown", async (spawn) => {
    const f = fake({ spawn });
    const r = await f.tool("chat_sign_in").handler({}, ENV);
    expect(r.ok).toBe(false);
  });

  test("as refuses an offline other session's own base handle, with no spawn", async () => {
    const f = fake({ buddiesRows: [{ sessionId: "s2", handle: "bob", baseHandle: "bob" }] });
    const r = await f.tool("chat_sign_in").handler({ as: "bob" }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("another session holds or held (bob)");
    expect(f.calls.map((c) => c.fn)).toEqual(["buddies"]);
  });

  test("as refuses a suffixed handle from the same base family, with no spawn", async () => {
    const f = fake({ buddiesRows: [{ sessionId: "s2", handle: "bob-2", baseHandle: "bob" }] });
    const r = await f.tool("chat_sign_in").handler({ as: "bob" }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("another session holds or held (bob-2)");
    expect(f.calls.map((c) => c.fn)).toEqual(["buddies"]);
  });

  test("as allows retaking this session's own prior base handle without calling buddies", async () => {
    const f = fake();
    const r = await f.tool("chat_sign_in").handler({ as: "ann" }, ENV);
    expect(r.ok).toBe(true);
    expect(f.calls.map((c) => c.fn)).not.toContain("buddies");
    expect(f.calls.map((c) => c.fn)).toContain("spawnRt");
  });

  test("as fails closed when buddies errors, with no spawn", async () => {
    const f = fake({ buddiesFail: "rt daemon unreachable" });
    const r = await f.tool("chat_sign_in").handler({ as: "bob" }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rt daemon unreachable");
    expect(f.calls.map((c) => c.fn)).toEqual(["buddies"]);
  });

  test("as refuses a handle with remaining room memberships, with no spawn", async () => {
    const f = fake({ roomsResult: { rooms: [{ room: "build" }] } });
    const r = await f.tool("chat_sign_in").handler({ as: "bob" }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("room memberships");
    expect(f.calls.map((c) => c.fn)).toEqual(["buddies", "rooms"]);
  });

  test("as spawns when the name is unused (buddies and rooms both empty)", async () => {
    const f = fake();
    const r = await f.tool("chat_sign_in").handler({ as: "bob" }, ENV);
    expect(r.ok).toBe(true);
    expect(f.calls.map((c) => c.fn)).toEqual(["buddies", "rooms", "spawnRt"]);
  });
});

describe("chat_sign_out", () => {
  test("signs out the env session and deletes its file", async () => {
    const f = fake();
    const r = await f.tool("chat_sign_out").handler({}, ENV);
    expect(r).toEqual({ ok: true, body: {} });
    expect(f.calls).toEqual([
      { fn: "signOut", a: { sessionId: "s1" }, o: { timeoutMs: 3000 } },
      { fn: "deleteSession", a: "s1" },
    ]);
  });

  test("deletes the file even when the daemon fails, reporting daemonError", async () => {
    const f = fake({ fail: "rt daemon unreachable" });
    const r = await f.tool("chat_sign_out").handler({}, ENV);
    expect(r).toEqual({ ok: true, body: { daemonError: "rt daemon unreachable" } });
    expect(f.calls.map((c) => c.fn)).toEqual(["signOut", "deleteSession"]);
  });

  test("refuses without a session id", async () => {
    const f = fake();
    expect((await f.tool("chat_sign_out").handler({}, {} as NodeJS.ProcessEnv)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
});

describe("chat_archive", () => {
  test("a member archives; reopen clears it", async () => {
    const f = fake();
    expect(await f.tool("chat_archive").handler({ room: "build" }, ENV)).toEqual({ ok: true, body: { room: "build", archivedAt: 5 } });
    await f.tool("chat_archive").handler({ room: "build", reopen: true }, ENV);
    expect(f.calls.filter((c) => c.fn === "archive").map((c) => c.a)).toEqual([
      { room: "build", handle: "ann", archived: true },
      { room: "build", handle: "ann", archived: false },
    ]);
  });

  test("a non-member is refused before the archive call", async () => {
    const f = fake({ who: { members: [{ room: "build", handle: "bob" }] } });
    const r = await f.tool("chat_archive").handler({ room: "build" }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not a member");
    expect(f.calls.map((c) => c.fn)).toEqual(["who"]);
  });

  test("fails closed when who errors, with no archive call", async () => {
    const f = fake({ whoFail: "rt daemon unreachable" });
    const r = await f.tool("chat_archive").handler({ room: "build" }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rt daemon unreachable");
    expect(f.calls.map((c) => c.fn)).toEqual(["who"]);
  });

  test("unsigned, a bad room and a non-boolean reopen are refused", async () => {
    expect((await fake({ signedIn: false }).tool("chat_archive").handler({ room: "build" }, ENV)).ok).toBe(false);
    for (const input of [{ room: "Bad" }, { room: "build", reopen: "yes" }]) {
      const f = fake();
      expect((await f.tool("chat_archive").handler(input, ENV)).ok, JSON.stringify(input)).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });
});

describe("chat_invite", () => {
  test("sends the session handle as from and the server's pane as callerPane", async () => {
    const f = fake();
    const r = await f.tool("chat_invite").handler({ pane: "w2:p1", room: "build", note: "you own the vite side" }, ENV);
    expect(r).toEqual({ ok: true, body: { delivered: "accepted", paneId: "w2:p1" } });
    expect(f.calls[0]!.a).toEqual({ paneId: "w2:p1", room: "build", from: "ann", note: "you own the vite side", callerPane: "w1:p2" });
  });

  test("a note with a newline is allowed (the daemon folds it)", async () => {
    const f = fake();
    expect((await f.tool("chat_invite").handler({ pane: "w2:p1", room: "build", note: "line one\nline two" }, ENV)).ok).toBe(true);
  });

  test("refuses an unsigned session instead of speaking as the human", async () => {
    const f = fake({ signedIn: false });
    const r = await f.tool("chat_invite").handler({ pane: "w2:p1", room: "build" }, ENV);
    expect(r.error).toBe(SIGN_IN_HINT);
    expect(f.calls).toEqual([]);
  });

  test.each([
    [{ pane: "w2:p1", room: "build", note: "hi\u001b[2J" }],
    [{ pane: "w2:p1", room: "build", note: "stop\u0003" }],
    [{ pane: "w2:p1", room: "build", note: "a\tb" }],
    [{ pane: "w2:p1", room: "build", note: "a\u007fb" }],
    [{ pane: "w2:p1", room: "build", note: "x".repeat(301) }],
    [{ pane: "-w2", room: "build" }],
    [{ pane: "w2 p1", room: "build" }],
    [{ pane: "w2:p1", room: "Bad" }],
    [{ room: "build" }],
    [{ pane: "w2:p1" }],
  ])("refuses %j with no daemon call", async (input) => {
    const f = fake();
    expect((await f.tool("chat_invite").handler(input, ENV)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("a bg pane ref passes the shape check", async () => {
    const f = fake();
    expect((await f.tool("chat_invite").handler({ pane: "bg:w2:p1", room: "build" }, ENV)).ok).toBe(true);
  });
});
