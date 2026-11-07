import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { getSetting } from "../../../settings/resolve.ts";
import { SUPPORT_ID } from "../../../state/identity-store.ts";
import { dmRoomFor, listMessages, openStateDb, type RegistryDeps } from "../../../state/index.ts";
import { createChatHandlers } from "../chat.ts";
import { realMilestoneDeps } from "../slack-milestones.ts";

const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;

let n = 0;

function setup(registryDeps?: RegistryDeps) {
  const db = openStateDb(join(tmpdir(), `slack-milestones-${process.pid}-${n++}-${Date.now()}.db`));
  const notices: Array<[string, string]> = [];
  const deps = realMilestoneDeps({ db, emitEvent: () => 0, log, notify: (t, m) => notices.push([t, m]), ...(registryDeps ? { registryDeps } : {}) });
  return { db, deps, notices };
}

test("a signed-out or unknown handle is offline", () => {
  expect(setup().deps.isOnline("nobody")).toBe(false);
});

test("a DM is posted from rt.support into the room it shares with the requester", async () => {
  const { db, deps } = setup();
  const chat = createChatHandlers({ db, emitEvent: () => 0, log });
  const signed = await chat["chat:sign-in"]({ sessionId: "req", baseHandle: "requester" });
  if (!signed.ok) throw new Error(signed.error);
  await deps.postDm(SUPPORT_ID, signed.data.handle, "SUP-1 filed: x https://linear.app/x");
  const human = getSetting<string>("chat.humanHandle").value;
  const { room } = dmRoomFor(SUPPORT_ID, signed.data.handle, human, db);
  expect(listMessages({ room, limit: 10 }, db).map((m) => [m.handle, m.body])).toEqual([[SUPPORT_ID, "SUP-1 filed: x https://linear.app/x"]]);
});

test("the desk is the operator's notifier", async () => {
  const { deps, notices } = setup();
  await deps.desk("hello");
  expect(notices).toEqual([["Slack support", "hello"]]);
});

const LIVE_SESSION: RegistryDeps = {
  resolve: (id) => (id === "req-online" ? { pid: 1, socketPath: "/fake.sock", status: "idle" } : null),
  alive: () => true,
  resolveAll: () => new Map(),
};

test("a handle signed in through the chat path is online by its minted id, while its session lives", async () => {
  const { db, deps } = setup(LIVE_SESSION);
  const chat = createChatHandlers({ db, emitEvent: () => 0, log, registryDeps: LIVE_SESSION });
  const signed = await chat["chat:sign-in"]({ sessionId: "req-online", baseHandle: "requester" });
  if (!signed.ok) throw new Error(signed.error);
  expect(deps.isOnline(signed.data.handle)).toBe(true);
  expect(deps.isOnline("requester-typo")).toBe(false);
});
