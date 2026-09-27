import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_TIMEOUT_MS, deliverToInbox, deliveryLabel, probeInboxReachability, renderDeliveries, replySteer, senderHints, wrapCrossSession } from "../inbox.ts";
import { SYSTEM_HANDLE } from "../handlers/herd.ts";

test("the default push timeout is 3000ms, not the original 1000ms that made one slow recipient look like a dropped push", () => {
  expect(DEFAULT_TIMEOUT_MS).toBe(3000);
});

test("renderDeliveries shows each sender's name, never the id, next to the id rt chat ack takes", () => {
  expect(renderDeliveries([
    { room: "general", dm: false, handle: "max.k3f9", name: "max", body: "hello", id: 12 },
    { room: "dm-1", dm: true, handle: "eli", name: "eli", body: "hi", id: 13 },
  ])).toBe("[#general] max #12: hello\n[dm] eli #13: hi");
});

test("wrapCrossSession produces the exact envelope Claude Code collapses on", () => {
  expect(wrapCrossSession("max (#general)", "[#general] max: hello")).toBe(
    '<cross-session-message from-name="max (#general)">\n[#general] max: hello\n</cross-session-message>',
  );
});

test("wrapCrossSession neutralizes attribute-breaking characters in the label", () => {
  const wrapped = wrapCrossSession('x" bad="<y>', "body");
  expect(wrapped.startsWith("<cross-session-message from-name=\"x' bad='")).toBe(true);
  expect(wrapped).not.toContain('""');
  expect(wrapped.split("\n")[0]).not.toContain("<y>");
});

test("deliveryLabel names the sender by name for one message and counts a batch", () => {
  expect(deliveryLabel([{ room: "general", dm: false, name: "max" }])).toBe("max (#general)");
  expect(deliveryLabel([{ room: "dm-1", dm: true, name: "eli" }])).toBe("eli (dm)");
  expect(deliveryLabel([
    { room: "general", dm: false, name: "max" },
    { room: "general", dm: false, name: "eli" },
    { room: "general", dm: false, name: "kai" },
  ])).toBe("rt chat (3 messages)");
});

test("replySteer names the one sender's id as the dm target", () => {
  expect(replySteer([{ handle: "remy.k3f9", name: "remy" }, { handle: "remy.k3f9", name: "remy" }])).toBe(
    'reply via rt chat post <room> "..." or rt chat dm remy.k3f9 "..." (never SendMessage; this arrived through rt chat)',
  );
});

test("replySteer gives one hint per distinct sender when a bundle has several", () => {
  expect(replySteer([
    { handle: "remy.k3f9", name: "remy" },
    { handle: "kai", name: "kai" },
    { handle: "remy.k3f9", name: "remy" },
  ])).toBe(
    'reply via rt chat post <room> "..." or rt chat dm <id> "..." (never SendMessage; this arrived through rt chat)\n' +
      '  reply to remy: rt chat dm remy.k3f9 "..."\n' +
      '  reply to kai: rt chat dm kai "..."',
  );
});

test("senderHints lists distinct senders in first-seen order", () => {
  expect(senderHints([{ handle: "a.0001", name: "a" }, { handle: "b", name: "b" }, { handle: "a.0001", name: "a" }])).toEqual([
    '  reply to a: rt chat dm a.0001 "..."',
    '  reply to b: rt chat dm b "..."',
  ]);
});

test("replySteer from the herd's system poster alone keeps the room post and offers no dm to it", () => {
  const steer = replySteer([{ handle: SYSTEM_HANDLE, name: SYSTEM_HANDLE }]);
  expect(steer).toBe('reply via rt chat post <room> "..." or rt chat dm <id> "..." (never SendMessage; this arrived through rt chat)');
  expect(steer).not.toContain(`dm ${SYSTEM_HANDLE}`);
});

test("replySteer treats the system poster as absent: one real sender gets the single-sender form", () => {
  expect(replySteer([{ handle: SYSTEM_HANDLE, name: SYSTEM_HANDLE }, { handle: "remy.k3f9", name: "remy" }])).toBe(
    'reply via rt chat post <room> "..." or rt chat dm remy.k3f9 "..." (never SendMessage; this arrived through rt chat)',
  );
});

test("senderHints leaves the herd's system poster out", () => {
  expect(senderHints([{ handle: SYSTEM_HANDLE, name: SYSTEM_HANDLE }, { handle: "b", name: "b" }])).toEqual(['  reply to b: rt chat dm b "..."']);
});

test("deliverToInbox writes exactly one msgV:1 user frame line", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "inbox-")), "s.sock");
  const lines: string[] = [];
  const server = Bun.listen({ unix: path, socket: { data(_s, d) { lines.push(d.toString()); } } });
  const res = await deliverToInbox(path, "[#general] max: hello");
  await Bun.sleep(30);
  server.stop(true);
  expect(res.ok).toBe(true);
  const frame = JSON.parse(lines.join("").trim());
  expect(frame.msgV).toBe(1);
  expect(frame.type).toBe("user");
  expect(frame.priority).toBe("next");
  expect(frame.message).toEqual({ role: "user", content: "[#general] max: hello" });
  expect(typeof frame.msg_id).toBe("string");
});

test("deliverToInbox reports failure on a dead socket", async () => {
  const res = await deliverToInbox(join(tmpdir(), "nope.sock"), "x", { timeoutMs: 200 });
  expect(res.ok).toBe(false);
});

test("probeInboxReachability reports reachable on a listening socket without writing to it", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "inbox-probe-")), "s.sock");
  const lines: string[] = [];
  const server = Bun.listen({ unix: path, socket: { data(_s, d) { lines.push(d.toString()); } } });
  const state = await probeInboxReachability(path);
  await Bun.sleep(30);
  server.stop(true);
  expect(state).toBe("reachable");
  expect(lines.join("")).toBe("");
});

test("probeInboxReachability reports unreachable on a dead socket", async () => {
  const state = await probeInboxReachability(join(tmpdir(), "nope-probe.sock"), { timeoutMs: 200 });
  expect(state).toBe("unreachable");
});

test("probeInboxReachability reports unreachable once the timeout elapses", async () => {
  const state = await probeInboxReachability(join(tmpdir(), "nope-probe-2.sock"), { timeoutMs: 1 });
  expect(state).toBe("unreachable");
});

test("no frame is written after a failed connect has settled", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "inbox-late-")), "s.sock");
  const res = await deliverToInbox(path, "late", { timeoutMs: 50 });
  expect(res.ok).toBe(false);

  const lines: string[] = [];
  const server = Bun.listen({ unix: path, socket: { data(_s, d) { lines.push(d.toString()); } } });
  await Bun.sleep(100);
  server.stop(true);
  expect(lines.join("")).toBe("");
});
