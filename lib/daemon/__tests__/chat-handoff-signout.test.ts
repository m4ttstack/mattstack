import { beforeEach, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { conversationForAgent, openConversation, openStateDb, presenceForSession } from "../../state/index.ts";
import { beginHandoff, handoffFromSession, type HandoffDeps } from "../../state/chat-handoff.ts";
import { setSetting } from "../../settings/write.ts";
import { createChatHandlers } from "../handlers/chat.ts";

const HANDING_OFF: HandoffDeps = { sessionForPid: () => "new", pidAlive: () => true };
/** A plain exit: the registry still names the old session while its SessionEnd hooks run. */
const STILL_OLD: HandoffDeps = { sessionForPid: () => "old", pidAlive: () => true };
let n = 0;

beforeEach(() => {
  setSetting("chat.humanHandle", "matt", "user");
});

async function signedIn(handoffDeps: HandoffDeps = HANDING_OFF) {
  const db = openStateDb(join(tmpdir(), `chat-handoff-signout-${process.pid}-${n++}.db`));
  const h = createChatHandlers({
    db,
    emitEvent: () => 0,
    retryDelayMs: 0,
    handoffDeps,
    slackClient: async () => null,
    slackNotify: () => {},
  });
  const r = await h["chat:sign-in"]({ sessionId: "old" });
  if (!r.ok) throw new Error(r.error);
  return { db, h, handle: r.data.handle };
}

test("sign-out of a session handing off keeps the row signed in", async () => {
  const { db, h } = await signedIn();
  beginHandoff({ sessionId: "old", pid: 4242 }, db, STILL_OLD);
  expect(await h["chat:sign-out"]({ sessionId: "old", reason: "clear" })).toEqual({ ok: true, data: { sessionId: "old" } });
  expect(presenceForSession("old", db)?.signedOutAt).toBeUndefined();
});

test("sign-out of a session handing off does not close its Slack chat", async () => {
  const { db, h, handle } = await signedIn();
  openConversation({
    room: "dm-aaa",
    agentHandle: handle,
    slackHandle: "slack.u0test",
    slackUserId: "U0TEST",
    slackChannel: "D0TEST",
    slackDisplayName: "Alex Example",
    operatorUserId: "U0OPER",
    operatorName: "Robin",
    frameMarker: "marker1",
    lastReadTs: "1000000000.000100",
    openedAt: Date.now(),
  }, db);
  beginHandoff({ sessionId: "old", pid: 4242 }, db, STILL_OLD);
  await h["chat:sign-out"]({ sessionId: "old", reason: "clear" });
  await Bun.sleep(20);
  expect(conversationForAgent(handle, db)).toBeDefined();
});

test("sign-out with no hand-off still signs out", async () => {
  const { db, h } = await signedIn();
  await h["chat:sign-out"]({ sessionId: "old" });
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
});

test("an exit while handing off signs out at once, closes the Slack chat and ends the hand-off", async () => {
  const { db, h, handle } = await signedIn(STILL_OLD);
  openConversation({
    room: "dm-aaa",
    agentHandle: handle,
    slackHandle: "slack.u0test",
    slackUserId: "U0TEST",
    slackChannel: "D0TEST",
    slackDisplayName: "Alex Example",
    operatorUserId: "U0OPER",
    operatorName: "Robin",
    frameMarker: "marker1",
    lastReadTs: "1000000000.000100",
    openedAt: Date.now(),
  }, db);
  beginHandoff({ sessionId: "old", pid: 4242 }, db, STILL_OLD);
  await h["chat:sign-out"]({ sessionId: "old", reason: "prompt_input_exit" });
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
  expect(handoffFromSession("old", db)).toBeNull();
  await Bun.sleep(20);
  expect(conversationForAgent(handle, db)).toBeUndefined();
  expect(await h["chat:handoff-cancel"]({ fromSessionId: "old" })).toMatchObject({ ok: false, failure: { code: "no-handoff" } });
});

test("a sign-out the session asks for itself is never held back by a hand-off", async () => {
  const { db, h } = await signedIn(STILL_OLD);
  beginHandoff({ sessionId: "old", pid: 4242 }, db, STILL_OLD);
  await h["chat:sign-out"]({ sessionId: "old" });
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
  expect(handoffFromSession("old", db)).toBeNull();
});

test("an exit where the mod's cancel lands first: the later sign-out still signs out", async () => {
  const { db, h } = await signedIn(STILL_OLD);
  beginHandoff({ sessionId: "old", pid: 4242 }, db, STILL_OLD);
  expect(await h["chat:handoff-cancel"]({ fromSessionId: "old" })).toEqual({ ok: true, data: { signedOut: false } });
  await h["chat:sign-out"]({ sessionId: "old", reason: "prompt_input_exit" });
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
});
