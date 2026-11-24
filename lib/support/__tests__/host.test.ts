import { describe, expect, test } from "bun:test";
import { SUPPORT_TTL_MS } from "../../../packages/rt-client/src/support.ts";
import { listOpenConversations, pendingItems } from "../../state/index.ts";
import { closeConversation, conversationById, conversationForSlackUser, startGrace } from "../../state/slack-conversation-store.ts";
import { getRequest, moveRequest, recordStop } from "../../state/support-store.ts";
import { renderRequest, SUPPORT_STOP_HOLD_MS, takeRequest, tickRequests } from "../host.ts";
import { ADA, BO, CY, DM_LINK, supportHost } from "./host-harness.ts";

type Host = ReturnType<typeof supportHost>;
const row = (h: Host, r: { peer: string; id: string }) => getRequest("in", r.peer, r.id, h.db)!;
const states = (h: Host, to = "ada") => h.statuses().filter((s) => s.to === to).map((s) => s.state);

describe("opening a chat", () => {
  test("under the cap it opens with no gate and the request is the first item, framed as a message", async () => {
    const h = supportHost();
    const r = h.request({ parts: [{ key: "versions", label: "Versions", value: "rt 1.2.3" }] });
    await takeRequest(h.deps, r);
    const conv = conversationForSlackUser(ADA.slackUserId, h.db)!;
    expect(row(h, r)).toMatchObject({ state: "opening", conversationId: conv.id });
    expect(h.opens).toEqual([]);
    expect(pendingItems(conv.id, h.db)).toMatchObject([
      { kind: "message", fromHandle: conv.slackHandle, text: "the board will not load\n\nVersions: rt 1.2.3" },
    ]);
    const messages = h.db.query("SELECT handle, body FROM chat_messages WHERE room = ?").all(conv.room);
    expect(messages).toEqual([{ handle: conv.slackHandle, body: "the board will not load\n\nVersions: rt 1.2.3" }]);
    expect(h.posted).toEqual([{ room: conv.room, id: expect.any(Number) as unknown as number }]);
  });

  test("the request's text never crosses the agent's inbox", async () => {
    const h = supportHost();
    await takeRequest(h.deps, h.request());
    const conv = conversationForSlackUser(ADA.slackUserId, h.db)!;
    const unread = h.db.query("SELECT COUNT(*) AS n FROM chat_members m JOIN chat_messages c ON c.room = m.room WHERE m.room = ? AND m.handle IN (?, ?) AND c.id > m.last_read_id").get(conv.room, conv.agentHandle, conv.slackHandle);
    expect(unread).toEqual({ n: 0 });
  });

  test("the teammate's text is not in the brief", async () => {
    const h = supportHost();
    const r = h.request();
    await takeRequest(h.deps, r);
    const brief = conversationForSlackUser(ADA.slackUserId, h.db)!.brief!;
    expect(brief).toBe(`Ada Example asked for help from mattstack at ${new Date(r.receivedAt).toISOString()}. Their message arrives first.`);
  });

  test("a request over a day old says so in the brief", async () => {
    const h = supportHost();
    const r = h.request();
    h.state.now = r.receivedAt + 24 * 60 * 60_000 + 1;
    await takeRequest(h.deps, r);
    expect(conversationForSlackUser(ADA.slackUserId, h.db)!.brief).toEndWith("It was sent over a day ago, so ask whether they still need help.");
  });

  test("received, then opened only after the agent posts, each queued once", async () => {
    const h = supportHost();
    const r = h.request();
    await takeRequest(h.deps, r);
    await tickRequests(h.deps);
    expect(states(h)).toEqual(["received"]);
    h.agentPosts(conversationForSlackUser(ADA.slackUserId, h.db)!);
    await tickRequests(h.deps);
    await tickRequests(h.deps);
    expect(h.statuses()).toEqual([
      { requestId: r.id, state: "received", to: "ada" },
      { requestId: r.id, state: "opened", dmLink: DM_LINK, to: "ada" },
    ]);
    expect(row(h, r)).toMatchObject({ state: "opened", dmLink: DM_LINK });
  });

  test("the notification fires when the chat is created, before the agent posts", async () => {
    const h = supportHost();
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(h.notified).toEqual([{ id: r.id, room: conversationForSlackUser(ADA.slackUserId, h.db)!.room }]);
    expect(h.desk).toEqual([]);
  });

  test("a notification that throws does not undo the open", async () => {
    const h = supportHost();
    h.deps.notifyOpening = () => {
      throw new Error("tray is gone");
    };
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(row(h, r).state).toBe("opening");
    expect(h.stopped).toEqual([]);
  });

  test("a request inside the closed chat's grace window opens a new chat and ends the window", async () => {
    const h = supportHost();
    const old = h.operatorChat(ADA.slackUserId);
    closeConversation(old.id, "idle", h.state.now - 1000, h.db);
    startGrace(old.id, h.state.now + 3_000_000, h.db);
    await takeRequest(h.deps, h.request());
    expect(conversationForSlackUser(ADA.slackUserId, h.db)!.id).not.toBe(old.id);
    expect(conversationById(old.id, h.db)!.graceUntil).toBeLessThanOrEqual(h.state.now);
  });

  test("renderRequest is the text, then each part on its own line", () => {
    const h = supportHost();
    expect(renderRequest(h.request({ text: "help", parts: [] }))).toBe("help");
    expect(renderRequest(h.request({ text: "help", parts: [{ key: "mr", label: "MR", value: "https://x/1" }, { key: "setup", label: "Setup", value: "a, b" }] }))).toBe("help\n\nMR: https://x/1\nSetup: a, b");
  });
});

describe("a request that does not open", () => {
  test("an agent that never posts sends failed", async () => {
    const h = supportHost();
    const r = h.request();
    await takeRequest(h.deps, r);
    closeConversation(row(h, r).conversationId!, "pane-gone", h.state.now, h.db);
    await tickRequests(h.deps);
    expect(states(h)).toEqual(["received", "failed"]);
    expect(row(h, r)).toMatchObject({ state: "failed", reason: "the support agent never reached the chat" });
  });

  test("a chat the host stopped before the agent posted says so", async () => {
    const h = supportHost();
    const r = h.request();
    await takeRequest(h.deps, r);
    closeConversation(row(h, r).conversationId!, "operator", h.state.now, h.db);
    await tickRequests(h.deps);
    expect(row(h, r)).toMatchObject({ state: "failed", reason: "the host closed the chat" });
  });

  test("a chat that closed after its first post is opened, not failed", async () => {
    const h = supportHost();
    const r = h.request();
    await takeRequest(h.deps, r);
    h.agentPosts(conversationForSlackUser(ADA.slackUserId, h.db)!);
    closeConversation(row(h, r).conversationId!, "closed-by-pane", h.state.now, h.db);
    await tickRequests(h.deps);
    expect(row(h, r).state).toBe("opened");
  });

  test("a start failure sends failed with its reason, and the host is told", async () => {
    const h = supportHost();
    h.state.startError = "no free herdr server";
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(h.statuses()).toEqual([
      { requestId: r.id, state: "received", to: "ada" },
      { requestId: r.id, state: "failed", reason: "no free herdr server", to: "ada" },
    ]);
    expect(h.desk).toEqual(["Ada Example could not be connected: no free herdr server"]);
    expect(h.notified).toEqual([]);
  });

  test("no repo, a repo rt has no folder for, or a setting that cannot be read sends failed and tells the host", async () => {
    for (const set of [
      (h: Host) => void (h.state.repo = null),
      (h: Host) => void (h.state.repoPath = null),
      (h: Host) => void (h.state.repo = new Error("settings are unreadable")),
      (h: Host) => void (h.state.connectError = "Slack did not answer"),
    ]) {
      const h = supportHost();
      set(h);
      const r = h.request();
      await takeRequest(h.deps, r);
      expect(row(h, r).state).toBe("failed");
      expect(states(h).at(-1)).toBe("failed");
      expect(h.desk).toHaveLength(1);
      expect(h.started).toEqual([]);
    }
  });

  test("support off, not the host, or not accepting sends not-accepting", async () => {
    for (const patch of [{ enabled: false, acceptHere: false }, { isHost: false, acceptHere: false }, { accepts: false, acceptHere: false }, null]) {
      const h = supportHost();
      h.state.config = patch === null ? null : { ...h.state.config!, ...patch };
      const r = h.request();
      await takeRequest(h.deps, r);
      expect(states(h)).toEqual(["not-accepting"]);
      expect(row(h, r).state).toBe("not-accepting");
      expect(h.started).toEqual([]);
      expect(h.desk).toEqual([]);
    }
  });

  test("a Slack id that is missing, deleted, a bot or the host itself sends failed and opens nothing", async () => {
    for (const slackUserId of ["", "ada", "Ada Example", "U0GONE1", "U0HOST"]) {
      const h = supportHost();
      const r = h.request({ slackUserId });
      await takeRequest(h.deps, r);
      expect(row(h, r)).toMatchObject({ state: "failed", reason: "the host's Slack workspace has no active account for you" });
      expect(h.started).toEqual([]);
      expect(h.desk).toEqual(["ada could not be connected: their Slack account is not an active person in your workspace"]);
    }
  });

  test("a name that matches someone is not an id", async () => {
    const h = supportHost();
    h.state.people["U0ADA1"] = "Ada";
    h.deps.findPerson = async () => ({ ok: true, person: { id: "U0OTHER1", displayName: "Other" } });
    const r = h.request({ slackUserId: "U0ADA1" });
    await takeRequest(h.deps, r);
    expect(row(h, r).state).toBe("failed");
  });

  test("a Slack that does not answer leaves the request for the next tick", async () => {
    const h = supportHost();
    h.state.slackDown = true;
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(row(h, r).state).toBe("received");
    expect(h.statuses()).toEqual([]);
    h.state.slackDown = false;
    await tickRequests(h.deps);
    expect(row(h, r).state).toBe("opening");
  });

  test("a request past 7 days expires instead of opening", async () => {
    const h = supportHost();
    const r = h.request();
    h.state.now = r.receivedAt + SUPPORT_TTL_MS;
    await tickRequests(h.deps);
    expect(states(h)).toEqual(["expired"]);
    expect(h.started).toEqual([]);
  });

  test("already open sends already-open and starts no agent", async () => {
    const h = supportHost();
    h.operatorChat(ADA.slackUserId);
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(h.statuses()).toEqual([{ requestId: r.id, state: "already-open", dmLink: DM_LINK, to: "ada" }]);
    expect(h.started).toEqual([]);
    expect(h.desk).toEqual([]);
  });

  test("a second request while one waits sends already-waiting", async () => {
    const h = supportHost();
    h.operatorChat("U0XX1");
    h.operatorChat("U0XX2");
    const first = h.request();
    await takeRequest(h.deps, first);
    const second = h.request();
    await takeRequest(h.deps, second);
    expect(row(h, first).state).toBe("waiting");
    expect(row(h, second).state).toBe("already-waiting");
    expect(h.opens).toHaveLength(1);
  });

  test("a request is taken once, however often it is handed over", async () => {
    const h = supportHost();
    const r = h.request();
    await Promise.all([takeRequest(h.deps, r), takeRequest(h.deps, r), tickRequests(h.deps)]);
    await takeRequest(h.deps, r);
    expect(h.started).toHaveLength(1);
    expect(states(h)).toEqual(["received"]);
  });
});

describe("the cap and the stop hold", () => {
  test("ten requests at once open two, in arrival order, and eight wait", async () => {
    const h = supportHost();
    const people = Array.from({ length: 10 }, (_, i) => ({ peer: `p${i}`, slackUserId: `U0P${i}` }));
    for (const p of people) h.state.people[p.slackUserId] = `Person ${p.peer}`;
    const rows = people.map((p) => h.request(p));
    await tickRequests(h.deps);
    expect(h.started).toEqual(["Person p0", "Person p1"]);
    expect(rows.map((r) => row(h, r).state)).toEqual(["opening", "opening", ...Array.from({ length: 8 }, () => "waiting" as const)]);
    expect(listOpenConversations(h.db)).toHaveLength(2);
  });

  test("two requests racing for the last place open one", async () => {
    const h = supportHost();
    h.operatorChat("U0XX1");
    h.state.beforeStartReturns = () => {
      h.state.beforeStartReturns = null;
      h.operatorChat("U0XX2");
    };
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(listOpenConversations(h.db)).toHaveLength(2);
    expect(conversationForSlackUser(ADA.slackUserId, h.db)).toBeUndefined();
    expect(h.stopped).toHaveLength(1);
    expect(row(h, r)).toMatchObject({ state: "waiting", conversationId: null });
    expect(states(h)).toEqual(["received", "waiting"]);
    expect(h.desk).toEqual([]);
  });

  test("a chat that opens with them while the agent starts settles as already-open", async () => {
    const h = supportHost();
    h.state.beforeStartReturns = () => {
      h.state.beforeStartReturns = null;
      h.operatorChat(ADA.slackUserId);
    };
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(row(h, r).state).toBe("already-open");
    expect(h.stopped).toHaveLength(1);
    expect(h.desk).toEqual([]);
  });

  test("an operator-started chat counts toward the cap", async () => {
    const h = supportHost();
    h.operatorChat("U0XX1");
    const a = h.request(ADA);
    const b = h.request(BO);
    await takeRequest(h.deps, a);
    await takeRequest(h.deps, b);
    expect(row(h, a).state).toBe("opening");
    expect(row(h, b).state).toBe("waiting");
  });

  test("a stop within 24 hours raises a gate below the cap, and after 24 hours does not", async () => {
    const h = supportHost();
    recordStop(ADA.slackUserId, h.state.now, h.db);
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(row(h, r).state).toBe("waiting");

    const later = supportHost();
    recordStop(ADA.slackUserId, later.state.now, later.db);
    recordStop(CY.slackUserId, later.state.now + SUPPORT_STOP_HOLD_MS, later.db);
    later.state.now += SUPPORT_STOP_HOLD_MS + 1;
    const again = later.request();
    await takeRequest(later.deps, again);
    expect(row(later, again).state).toBe("opening");
  });

  test("a gate that cannot open leaves the request for the next tick", async () => {
    const h = supportHost();
    recordStop(ADA.slackUserId, h.state.now, h.db);
    h.state.gateError = "the gate store is busy";
    const r = h.request();
    await takeRequest(h.deps, r);
    expect(row(h, r).state).toBe("received");
    expect(h.statuses()).toEqual([]);
    h.state.gateError = null;
    await tickRequests(h.deps);
    expect(row(h, r).state).toBe("waiting");
  });
});

describe("a state db another process is writing", () => {
  test("a request waits for the lock instead of failing at once", async () => {
    const h = supportHost();
    h.state.config = null;
    const r = h.request();
    h.db.exec("PRAGMA busy_timeout = 2000;");
    const file = (h.db.query("PRAGMA database_list").get() as { file: string }).file;
    const holder = Bun.spawn(
      [process.execPath, "-e", `const { Database } = require("bun:sqlite"); const d = new Database(${JSON.stringify(file)}); d.exec("BEGIN IMMEDIATE"); console.log("held"); setTimeout(() => { d.exec("COMMIT"); }, 150);`],
      { stdout: "pipe", env: { ...process.env } },
    );
    await holder.stdout.getReader().read();
    await takeRequest(h.deps, r);
    await holder.exited;
    expect(row(h, r).state).toBe("not-accepting");
  });
});

describe("a restart", () => {
  test("a restart in received opens once; a restart in opening never starts a second agent", async () => {
    const h = supportHost();
    const r = h.request();
    await tickRequests(h.deps);
    await tickRequests(h.deps);
    expect(h.started).toHaveLength(1);

    const crashed = supportHost();
    const c = crashed.request();
    moveRequest(c, ["received"], { state: "opening" }, crashed.state.now, crashed.db);
    crashed.state.now += 2 * 60_000;
    await tickRequests(crashed.deps);
    expect(row(crashed, c).state).toBe("opening");
    crashed.state.now += 2 * 60_000;
    await tickRequests(crashed.deps);
    expect(row(crashed, c).state).toBe("failed");
    expect(crashed.started).toEqual([]);
    expect(crashed.desk).toHaveLength(1);
    expect(row(h, r).state).toBe("opening");
  });

  test("one request that throws does not hold up the rest", async () => {
    const h = supportHost();
    const find = h.deps.findPerson;
    h.deps.findPerson = async (p) => {
      if (p === ADA.slackUserId) throw new Error("boom");
      return find(p);
    };
    const a = h.request(ADA);
    const b = h.request(BO);
    await tickRequests(h.deps);
    expect(row(h, a).state).toBe("received");
    expect(row(h, b).state).toBe("opening");
  });
});
