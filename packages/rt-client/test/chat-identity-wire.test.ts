import { afterEach, describe, expect, test } from "bun:test";
import { chatAck, chatDm, chatJoin, chatPost, chatRelease, chatSignIn } from "../src/client.ts";
import type {
  AgentRecord,
  ChatClaimOutcome,
  ChatMember,
  ChatMessage,
  ChatPane,
  Commands,
  HerdInfo,
  HerdJobInfo,
  PresenceRow,
  RoomSummary,
} from "../src/index.ts";
import { fakeDaemon } from "./fake-daemon.ts";

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function assertType<_T extends true>(): void {}

type Data<C extends keyof Commands> = Commands[C]["data"];
type Claimed = Extract<ChatClaimOutcome, { outcome: "claimed" }>;
type Held = Extract<ChatClaimOutcome, { outcome: "held" }>;
type Lost = Extract<ChatClaimOutcome, { outcome: "lost" }>;
type Participants = NonNullable<RoomSummary["participants"]>;
type PanePresence = NonNullable<ChatPane["presence"]>;

assertType<Equals<ChatMember["name"], string>>();
assertType<Equals<ChatMessage["name"], string>>();
assertType<Equals<ChatMessage["mentionNames"], string[]>>();
assertType<Equals<ChatMessage["quiet"], boolean | undefined>>();
assertType<Equals<Claimed["authorName"], string>>();
assertType<Equals<Claimed["previousHolderName"], string | undefined>>();
assertType<Equals<Held["authorName"], string>>();
assertType<Equals<Lost["holderName"], string>>();
assertType<Equals<Participants["aName"], string>>();
assertType<Equals<Participants["bName"], string>>();
assertType<Equals<PresenceRow["name"], string>>();
assertType<Equals<PanePresence["name"], string>>();
assertType<Equals<AgentRecord["name"], string | undefined>>();
assertType<Equals<HerdInfo["shepherdName"], string>>();
assertType<Equals<HerdJobInfo["handleName"], string>>();
assertType<Equals<Data<"chat:join">["name"], string>>();
assertType<Equals<Data<"chat:post">["recipientNames"], string[]>>();
assertType<Equals<Data<"chat:dm">["recipientNames"], string[]>>();
assertType<Equals<Data<"chat:ack">["authorName"], string>>();
assertType<Equals<Data<"chat:release">["holderName"], string>>();
assertType<Equals<Commands["chat:sign-in"]["payload"]["continue"], string | undefined>>();
assertType<Equals<Data<"chat:sign-in">["name"], string>>();
assertType<Equals<Data<"chat:sign-in">["continued"], boolean>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatJoin>>["data"]>, Data<"chat:join">>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatPost>>["data"]>, Data<"chat:post">>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatAck>>["data"]>, Data<"chat:ack">>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatRelease>>["data"]>, Data<"chat:release">>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatDm>>["data"]>, Data<"chat:dm">>>();

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops) stop(); stops.length = 0; });

describe("chat identity on the wire", () => {
  test("chatSignIn sends continue only when given", async () => {
    const { sock, seen, stop } = fakeDaemon({
      "chat:sign-in": { ok: true, data: { handle: "remy.m2p4", baseHandle: "remy", name: "remy", reclaimed: false, continued: true, sessionId: "s1", room: null } },
    });
    stops.push(stop);
    await chatSignIn({ sessionId: "s1" }, { sockPath: sock });
    const res = await chatSignIn({ sessionId: "s1", continue: "remy.m2p4" }, { sockPath: sock });
    expect(seen.map((s) => s.payload)).toEqual([{ sessionId: "s1" }, { sessionId: "s1", continue: "remy.m2p4" }]);
    expect(res.data).toMatchObject({ handle: "remy.m2p4", name: "remy", continued: true });
  });

  test("join, post, ack, release and dm hand back the name siblings untouched", async () => {
    const { sock, stop } = fakeDaemon({
      "chat:join": { ok: true, data: { handle: "remy.m2p4", name: "remy", memberCount: 3, unread: 0 } },
      "chat:post": { ok: true, data: { id: 9, recipients: ["remy.m2p4"], recipientNames: ["remy"], others: 2 } },
      "chat:ack": { ok: true, data: { author: "remy.m2p4", authorName: "remy", room: "rt", already: false } },
      "chat:release": { ok: true, data: { holder: "remy.m2p4", holderName: "remy" } },
      "chat:dm": { ok: true, data: { room: "dm-2c9b7e41d0a5", id: 10, recipients: ["remy.m2p4"], recipientNames: ["remy"] } },
    });
    stops.push(stop);
    const o = { sockPath: sock };
    expect((await chatJoin({ room: "rt", handle: "remy.m2p4" }, o)).data?.name).toBe("remy");
    expect((await chatPost({ room: "rt", handle: "matt", body: "@remy hi", mentions: ["remy"] }, o)).data?.recipientNames).toEqual(["remy"]);
    expect((await chatAck({ id: 9, handle: "matt" }, o)).data?.authorName).toBe("remy");
    expect((await chatRelease({ id: 9, handle: "matt" }, o)).data?.holderName).toBe("remy");
    expect((await chatDm({ from: "kai", to: "remy", body: "hi" }, o)).data?.recipientNames).toEqual(["remy"]);
  });
});
