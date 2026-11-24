import { describe, expect, test } from "bun:test";
import { SUPPORT_TTL_MS } from "../../../packages/rt-client/src/support.ts";
import { normalizeGateQuestions } from "../../../packages/rt-client/src/gate-options.ts";
import { answerSlackOpen, approveSlackOpen, expireSlackOpenGates, requestSlackOpen, SLACK_OPEN_KIND, SLACK_OPEN_TTL_MS } from "../../slack/request.ts";
import { offerTriggerChat } from "../../slack/trigger-offer.ts";
import { conversationForSlackUser, listOpenConversations } from "../../state/slack-conversation-store.ts";
import { getRequest, recordStop } from "../../state/support-store.ts";
import { answerSupportGate, takeRequests, tickRequests, type SlackSupportMeta } from "../host.ts";
import { ADA, DM_LINK, REPO, supportHost } from "./host-harness.ts";

type Host = ReturnType<typeof supportHost>;
const row = (h: Host, r: { peer: string; id: string }) => getRequest("in", r.peer, r.id, h.db)!;
const states = (h: Host) => h.statuses().map((s) => s.state);

/** A request that waits because two chats are open. */
async function waiting(h: Host = supportHost()) {
  h.operatorChat("U0XX1");
  h.operatorChat("U0XX2");
  const r = h.request();
  await takeRequests(h.deps);
  return { h, r, gateId: row(h, r).gateId! };
}

describe("raising the gate", () => {
  test("over the cap raises a gate and sends waiting", async () => {
    const { h, r, gateId } = await waiting();
    expect(states(h)).toEqual(["waiting"]);
    expect(h.started).toEqual([]);
    const gate = h.deps.gate(gateId)!;
    expect(gate).toMatchObject({ subject: `support:ada:${r.id}`, kind: SLACK_OPEN_KIND, status: "open" });
    expect(gate.meta).toEqual({ action: "support", requestId: r.id, peer: "ada", person: "U0ADA", personName: "Ada Example", why: "cap", expiresAt: r.receivedAt + SUPPORT_TTL_MS } satisfies SlackSupportMeta);
    expect(gate.context).toBe("Person: Ada Example (ada)\n\nMessage:\nthe board will not load");
    expect(normalizeGateQuestions(gate.questions)[0]!.options).toHaveLength(2);
  });

  test("a stop within 24 hours raises a gate below the cap", async () => {
    const h = supportHost();
    recordStop(ADA.slackUserId, h.state.now, h.db);
    const r = h.request();
    await takeRequests(h.deps);
    expect((h.deps.gate(row(h, r).gateId!)!.meta as SlackSupportMeta).why).toBe("stopped");
  });

  test("the meta carries no brief and no trigger, so the host reads the teammate's own words", async () => {
    const { h, gateId } = await waiting();
    expect(Object.keys(h.deps.gate(gateId)!.meta!)).not.toContain("brief");
    expect(Object.keys(h.deps.gate(gateId)!.meta!)).not.toContain("triggerTs");
  });
});

describe("answering the gate", () => {
  test("approve opens past the cap", async () => {
    const { h, r, gateId } = await waiting();
    await answerSupportGate(h.deps, h.answer(gateId, "approve"));
    expect(listOpenConversations(h.db)).toHaveLength(3);
    expect(row(h, r)).toMatchObject({ state: "opening", conversationId: conversationForSlackUser(ADA.slackUserId, h.db)!.id });
    expect(states(h)).toEqual(["waiting", "received"]);
    expect(h.notified).toHaveLength(1);
  });

  test("each status carries a later time than the one before, even within one millisecond or with the clock set back", async () => {
    const { h, gateId } = await waiting();
    h.state.now -= 60_000;
    await answerSupportGate(h.deps, h.answer(gateId, "approve"));
    h.agentPosts(conversationForSlackUser(ADA.slackUserId, h.db)!);
    await tickRequests(h.deps);
    const times = h.statusTimes();
    expect(states(h)).toEqual(["waiting", "received", "opened"]);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });

  test("decline sends declined", async () => {
    const { h, r, gateId } = await waiting();
    await answerSupportGate(h.deps, h.answer(gateId, "decline"));
    expect(row(h, r).state).toBe("declined");
    expect(states(h)).toEqual(["waiting", "declined"]);
    expect(h.started).toEqual([]);
    expect(h.desk).toEqual([]);
  });

  test("anything but approve is a decline", async () => {
    for (const decision of ["", "maybe", "Approve please"]) {
      const { h, r, gateId } = await waiting();
      await answerSupportGate(h.deps, h.answer(gateId, decision));
      expect(row(h, r).state).toBe("declined");
    }
  });

  test("an answer is taken once", async () => {
    const { h, gateId } = await waiting();
    const answered = h.answer(gateId, "approve");
    await Promise.all([answerSupportGate(h.deps, answered), answerSupportGate(h.deps, answered), tickRequests(h.deps)]);
    expect(h.started).toHaveLength(1);
  });

  test("an answer to a gate that is not the request's own does nothing", async () => {
    const { h, r, gateId } = await waiting();
    await answerSupportGate(h.deps, { ...h.answer(gateId, "approve"), id: "another" });
    expect(row(h, r).state).toBe("waiting");
    expect(h.started).toEqual([]);
  });

  test("approve after support was turned off sends not-accepting and opens nothing", async () => {
    const { h, r, gateId } = await waiting();
    h.state.config = { ...h.state.config!, enabled: false, acceptHere: false };
    await answerSupportGate(h.deps, h.answer(gateId, "approve"));
    expect(row(h, r).state).toBe("not-accepting");
    expect(h.started).toEqual([]);
  });

  test("approve once a chat with them is open settles as already-open", async () => {
    const { h, r, gateId } = await waiting();
    h.operatorChat(ADA.slackUserId);
    await answerSupportGate(h.deps, h.answer(gateId, "approve"));
    expect(row(h, r)).toMatchObject({ state: "already-open", dmLink: DM_LINK });
    expect(h.started).toEqual([]);
  });

  test("answerSlackOpen hands a support gate to its own answer, and nothing else", async () => {
    const { h, gateId } = await waiting();
    const handed: string[] = [];
    const answered = h.answer(gateId, "approve");
    await answerSlackOpen(h.deps, answered, async (g) => void handed.push(g.id));
    await answerSlackOpen(h.deps, answered);
    await answerSlackOpen(h.deps, { ...answered, meta: { action: "other" } }, async (g) => void handed.push(g.id));
    expect(handed).toEqual([gateId]);
    expect(h.started).toEqual([]);
  });
});

describe("while it waits", () => {
  test("the gate outlives 30 minutes and expires with the request at 7 days, sending expired", async () => {
    const { h, r, gateId } = await waiting();
    h.state.now = r.receivedAt + SLACK_OPEN_TTL_MS + 60_000;
    await expireSlackOpenGates(h.deps);
    await tickRequests(h.deps);
    expect(row(h, r).state).toBe("waiting");
    h.state.now = r.receivedAt + SUPPORT_TTL_MS;
    await tickRequests(h.deps);
    expect(row(h, r).state).toBe("expired");
    expect(h.deps.gate(gateId)!.status).toBe("closed");
    expect(states(h)).toEqual(["waiting", "expired"]);
  });

  test("expireSlackOpenGates leaves a support gate alone", async () => {
    const { h, gateId } = await waiting();
    h.state.now += 8 * 24 * 60 * 60_000;
    expect(await expireSlackOpenGates(h.deps)).toBe(0);
    expect(h.deps.gate(gateId)!.status).toBe("open");
  });

  test("a typed @Maude gate and a support gate for one person coexist", async () => {
    const { h, gateId } = await waiting();
    const offered = await offerTriggerChat({ ...h.deps, defaultRepo: () => REPO }, { userId: ADA.slackUserId, text: "@Maude hi", ts: "1.1" }, { name: "Maude", emoji: "x" });
    expect(offered).toBe("recorded");
    expect(h.gates.filter((g) => g.status === "open").map((g) => g.subject)).toEqual([h.deps.gate(gateId)!.subject, `slack:${ADA.slackUserId}`]);
  });

  test("a waiting request does not block chat_slack_request for that person", async () => {
    const { h } = await waiting();
    const res = await requestSlackOpen(h.deps, { person: ADA.slackUserId, brief: "b", requesterSession: "s", requesterHandle: "h", repo: REPO });
    expect(res).toMatchObject({ ok: true });
  });

  test("a chat opened another way settles the waiting request as already-open and closes its gate", async () => {
    const { h, r, gateId } = await waiting();
    const opened = await approveSlackOpen(h.deps, { person: ADA.slackUserId, personName: "Ada Example", brief: "b", requesterSession: null, requesterHandle: null, requesterPane: null, repo: REPO });
    expect(opened.ok).toBe(true);
    await tickRequests(h.deps);
    expect(row(h, r).state).toBe("already-open");
    expect(h.deps.gate(gateId)!.status).toBe("closed");
    expect(states(h)).toEqual(["waiting", "already-open"]);
  });

  test("turning support off, or changing the host, closes the gate and sends not-accepting", async () => {
    for (const patch of [{ enabled: false, acceptHere: false }, { isHost: false, acceptHere: false }]) {
      const { h, r, gateId } = await waiting();
      h.state.config = { ...h.state.config!, ...patch };
      await tickRequests(h.deps);
      expect(row(h, r).state).toBe("not-accepting");
      expect(h.deps.gate(gateId)!.status).toBe("closed");
      expect(states(h)).toEqual(["waiting", "not-accepting"]);
    }
  });

  test("a gate that will not close still settles the request", async () => {
    const { h, r } = await waiting();
    h.deps.gates.close = async () => {
      throw new Error("gate store is busy");
    };
    h.state.config = { ...h.state.config!, acceptHere: false };
    await tickRequests(h.deps);
    expect(row(h, r).state).toBe("not-accepting");
  });

  test("an answer recorded while the daemon was down is applied on the next tick", async () => {
    const approved = await waiting();
    approved.h.answer(approved.gateId, "approve");
    await tickRequests(approved.h.deps);
    expect(row(approved.h, approved.r).state).toBe("opening");
    const declined = await waiting();
    declined.h.answer(declined.gateId, "decline");
    await tickRequests(declined.h.deps);
    expect(row(declined.h, declined.r).state).toBe("declined");
  });

  test("a gate that closed with no answer is put to the host again", async () => {
    const { h, r, gateId } = await waiting();
    await h.deps.gates.close(gateId);
    await tickRequests(h.deps);
    const now = row(h, r);
    expect(now.state).toBe("waiting");
    expect(now.gateId).not.toBe(gateId);
    expect(h.deps.gate(now.gateId!)).toMatchObject({ status: "open", meta: { personName: "Ada Example", why: "cap" } });
    expect(states(h)).toEqual(["waiting"]);
    await tickRequests(h.deps);
    expect(h.opens).toHaveLength(2);
  });

  test("a person removed from the roster while waiting is never opened, by tick or by approve, and hears nothing", async () => {
    const ticked = await waiting();
    ticked.h.state.config = { ...ticked.h.state.config!, roster: [{ username: "alex" }] };
    await tickRequests(ticked.h.deps);
    expect(row(ticked.h, ticked.r).state).toBe("failed");
    expect(ticked.h.deps.gate(ticked.gateId)!.status).toBe("closed");
    expect(states(ticked.h)).toEqual(["waiting"]);

    const approved = await waiting();
    approved.h.state.config = { ...approved.h.state.config!, roster: [{ username: "alex" }] };
    await answerSupportGate(approved.h.deps, approved.h.answer(approved.gateId, "approve"));
    expect(row(approved.h, approved.r).state).toBe("failed");
    expect(approved.h.started).toEqual([]);
  });

  test("a parked gate is put to the host again, since the console does not list it", async () => {
    const { h, r, gateId } = await waiting();
    Object.assign(h.deps.gate(gateId)!, { status: "parked" });
    await tickRequests(h.deps);
    expect(row(h, r).gateId).not.toBe(gateId);
  });

  test("a support gate that is not its request's own is closed", async () => {
    const { h, r, gateId } = await waiting();
    const stray = { ...h.deps.gate(gateId)!, id: "stray", subject: "support:bo:r9", meta: { ...h.deps.gate(gateId)!.meta!, requestId: "r9", peer: "bo" } };
    h.gates.push(stray);
    await tickRequests(h.deps);
    expect(stray.status).toBe("closed");
    expect(h.deps.gate(gateId)!.status).toBe("open");
    expect(row(h, r).state).toBe("waiting");
  });

  test("a place that frees up does not open a waiting request by itself", async () => {
    const { h, r } = await waiting();
    h.db.query("UPDATE slack_conversations SET closed_at = 1 WHERE slack_user_id = 'U0XX1'").run();
    await tickRequests(h.deps);
    expect(row(h, r).state).toBe("waiting");
  });
});
