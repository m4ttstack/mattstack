import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { SUPPORT_TTL_MS, type SupportDraft, type SupportKind, type SupportMessage } from "../../../packages/rt-client/src/support.ts";
import { openStateDb } from "../../state/db.ts";
import { getRequest, insertRequest, listRequests, pendingStatuses, queueStatus, type SupportRequest } from "../../state/support-store.ts";
import type { SupportConfig } from "../config.ts";
import type { SupportKeys } from "../org-key.ts";
import { fakeSealedWorld } from "../../team/__tests__/fake-sealed-text.ts";
import { supportBinding, supportMac } from "../proof.ts";
import type { SupportRelay } from "../relay.ts";
import { createSupportSync, PROOF_SETTLE_MS, STRANGER_SETTLE_MS, signDraft, type RequestBody, type StatusBody, type SyncDeps } from "../sync.ts";

const KEY = Buffer.alloc(32, 1).toString("base64");
const OLD = Buffer.alloc(32, 2).toString("base64");
const FOREIGN = Buffer.alloc(32, 3).toString("base64");
const ORG = "git.example.com/acme/mattstack";

let n = 0;
let db: Database;
let clock: number;
let config: SupportConfig | null;
let keys: SupportKeys | null;
let inbox: SupportMessage[];
let acked: string[];
let sent: SupportDraft[];
let sendResult: Awaited<ReturnType<SupportRelay["send"]>>;
let events: string[];
let onRequestHook: (r: SupportRequest) => void;
let world: ReturnType<typeof fakeSealedWorld>;

const host: SupportConfig = {
  org: "acme",
  orgRemote: ORG,
  enabled: true,
  host: "alex",
  me: "alex",
  isHost: true,
  accepts: true,
  acceptHere: true,
  roster: [{ username: "Alex" }, { username: "ada" }, { username: "bo" }],
};
const sender: SupportConfig = { ...host, me: "ada", isHost: false, accepts: false, acceptHere: false };

beforeEach(() => {
  db = openStateDb(join(tmpdir(), `support-sync-test-${process.pid}-${n++}-${Date.now()}.db`));
  clock = 1_000_000_000;
  config = host;
  keys = { current: KEY, retired: [] };
  inbox = [];
  acked = [];
  sent = [];
  sendResult = "ok";
  events = [];
  onRequestHook = () => {};
  world = fakeSealedWorld(["alex", "ada", "bo", "zed"]);
});

const relay: SupportRelay = {
  send: async (d) => {
    sent.push(d);
    return sendResult;
  },
  list: async (kind) => inbox.filter((m) => m.kind === kind).slice(0, 100),
  wait: async () => null,
  ack: async (list) => {
    for (const k of list) {
      acked.push(`${k.from} ${k.id}`);
      events.push(`ack ${k.id}`);
      inbox = inbox.filter((m) => m.from !== k.from || m.id !== k.id);
    }
    return true;
  },
  setHost: async () => "ok",
  host: async () => null,
};

function sync(over: Partial<SyncDeps> = {}) {
  return createSupportSync({
    db,
    relay: async () => relay,
    config: () => config,
    keys: async () => keys,
    sealedText: world.forUser(config?.me ?? "alex"),
    onRequest: (r) => {
      events.push(`request ${r.peer} ${r.id}`);
      onRequestHook(r);
    },
    onStatus: (r) => events.push(`status ${r.id} ${r.state}`),
    now: () => clock,
    log: { info() {}, warn: () => events.push("warn"), debug() {} } as unknown as SyncDeps["log"],
    ...over,
  });
}

const body: RequestBody = { text: "the board will not load", parts: [{ key: "versions", label: "Versions", value: "rt 1.2.3" }], slackUserId: "U0ADA" };

/** A status's text, sealed as its host seals it. */
function sealStatus(b: Partial<StatusBody>, id: string, from = "alex", to = "ada"): string {
  const { reason, persona, dmLink, ...facts } = b;
  const texts = Object.fromEntries(Object.entries({ reason, persona, dmLink }).filter((e): e is [string, string] => typeof e[1] === "string"));
  const sealed = Object.keys(texts).length > 0 ? world.put([to], supportBinding("status", id, from), texts) : undefined;
  return JSON.stringify({ ...facts, sealed });
}

/** `body` is a request's text before it is sealed; `raw` is what is on the wire as it stands. */
function arrive(over: { id?: string; from?: string; to?: string; kind?: SupportKind; body?: string; raw?: string; key?: string; age?: number } = {}): void {
  const kind = over.kind ?? "request";
  const from = over.from ?? "ada";
  const id = over.id ?? "r1";
  const to = over.to ?? "alex";
  const text =
    over.raw ?? (kind === "status" ? over.body! : JSON.stringify({ sealed: world.put([to], supportBinding("request", id, from), { body: over.body ?? JSON.stringify(body) }) }));
  const receivedAt = clock - (over.age ?? 0);
  const mac = supportMac(over.key ?? KEY, { kind, id, from, to, sentAt: receivedAt, body: text });
  inbox.push({ id, to, from, kind, sentAt: receivedAt, body: text, mac, receivedAt });
}

/** Pulls every 25 seconds, as the loop does on a Mac that is awake. */
async function awake(s: ReturnType<typeof createSupportSync>, ms: number, kind: SupportKind = "request") {
  for (const end = clock + ms; clock < end; ) {
    clock += 25_000;
    await s.pull(kind);
  }
}

describe("pulling requests", () => {
  test("a request is stored before it is acked", async () => {
    arrive();
    const ack = relay.ack;
    let seenAtAck: SupportRequest | null = null;
    const watching: SupportRelay = {
      ...relay,
      ack: async (k) => {
        seenAtAck = getRequest("in", "ada", "r1", db);
        return ack(k);
      },
    };
    await sync({ relay: async () => watching }).pull("request");
    expect(seenAtAck!).toMatchObject({
      state: "received",
      peer: "ada",
      org: ORG,
      text: body.text,
      parts: body.parts,
      slackUserId: "U0ADA",
      receivedAt: clock,
    });
    expect(acked).toEqual(["ada r1"]);
    expect(events).toContain("request ada r1");
  });

  test("a request whose store write throws is not acked, and the next message still is", async () => {
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON support_requests WHEN NEW.id = 'r1' BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    arrive({ id: "r1" });
    arrive({ id: "r2", from: "bo" });
    await sync().pull("request");
    expect(acked).toEqual(["bo r2"]);
    expect(listRequests("in", undefined, db).map((r) => r.id)).toEqual(["r2"]);
  });

  test("a bad MAC, another org's key, or a sender off the roster is acked, logged and never stored or answered", async () => {
    arrive({ id: "forged", key: FOREIGN });
    arrive({ id: "off-roster", from: "zed" });
    arrive({ id: "stranger", from: "zed", key: FOREIGN });
    const s = sync();
    await s.pull("request");
    expect(acked).toEqual([]);
    await awake(s, STRANGER_SETTLE_MS);
    expect(acked).toEqual(["zed stranger"]);
    await awake(s, PROOF_SETTLE_MS);
    expect(acked.sort()).toEqual(["ada forged", "zed off-roster", "zed stranger"]);
    expect(listRequests("in", undefined, db)).toEqual([]);
    expect(pendingStatuses(db)).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("the wait to prove a message starts when this Mac first sees it, not when the relay got it", async () => {
    arrive({ id: "new-key", key: FOREIGN, age: 2 * PROOF_SETTLE_MS });
    arrive({ id: "new-member", from: "zed", age: 2 * PROOF_SETTLE_MS });
    const s = sync();
    await s.pull("request");
    expect(acked).toEqual([]);
    keys = { current: FOREIGN, retired: [{ key: KEY, retiredAt: clock }] };
    config = { ...host, roster: [...host.roster, { username: "zed" }] };
    await s.pull("request");
    expect(listRequests("in", undefined, db)).toHaveLength(2);
  });

  test("a sender whose clone spells the remote another way is believed", async () => {
    arrive();
    config = { ...host, orgRemote: "ssh.git.example.com/renamed/mattstack" };
    await sync().pull("request");
    expect(getRequest("in", "ada", "r1", db)).not.toBeNull();
  });

  test("a new member whose key and roster entry this Mac both lacks is taken once the org syncs", async () => {
    arrive({ id: "r1", from: "zed", key: FOREIGN });
    const s = sync();
    await s.pull("request");
    expect(acked).toEqual([]);
    keys = { current: FOREIGN, retired: [{ key: KEY, retiredAt: clock }] };
    config = { ...host, roster: [...host.roster, { username: "zed" }] };
    await s.pull("request");
    expect(acked).toEqual(["zed r1"]);
    expect(getRequest("in", "zed", "r1", db)).not.toBeNull();
  });

  test("time asleep does not count toward proving a message", async () => {
    arrive({ id: "new-key", key: FOREIGN });
    const s = sync();
    await s.pull("request");
    clock += 5 * PROOF_SETTLE_MS;
    await s.pull("request");
    expect(acked).toEqual([]);
    keys = { current: FOREIGN, retired: [] };
    await s.pull("request");
    expect(acked).toEqual(["ada new-key"]);
  });

  test("a roster that reads empty takes and drops nothing", async () => {
    arrive();
    arrive({ id: "stranger", from: "zed", key: FOREIGN });
    config = { ...host, roster: [] };
    const s = sync();
    await s.pull("request");
    clock += 2 * PROOF_SETTLE_MS;
    await s.pull("request");
    expect(acked).toEqual([]);
  });

  test("a proof this Mac cannot check yet waits for its org to sync, and is taken once it has", async () => {
    arrive({ id: "new-key", key: FOREIGN });
    arrive({ id: "new-member", from: "zed" });
    const s = sync();
    await s.pull("request");
    expect(acked).toEqual([]);
    keys = { current: FOREIGN, retired: [{ key: KEY, retiredAt: clock }] };
    config = { ...host, roster: [...host.roster, { username: "zed" }] };
    await s.pull("request");
    expect(acked.sort()).toEqual(["ada new-key", "zed new-member"]);
    expect(listRequests("in", undefined, db)).toHaveLength(2);
  });

  test("a message left to be proved is logged once, and once more when it is dropped", async () => {
    arrive({ key: FOREIGN });
    const s = sync();
    for (let i = 0; i < 3; i++) await s.pull("request");
    expect(events.filter((e) => e === "warn")).toHaveLength(1);
    await awake(s, PROOF_SETTLE_MS);
    expect(events.filter((e) => e === "warn")).toHaveLength(2);
  });

  test("unreadable keys ack nothing", async () => {
    arrive();
    keys = null;
    const s = sync();
    await s.pull("request");
    expect(acked).toEqual([]);
    keys = { current: KEY, retired: [] };
    await s.pull("request");
    expect(events).toContain("request ada r1");
  });

  test("a request signed with the previous key inside 7 days is stored", async () => {
    keys = { current: KEY, retired: [{ key: OLD, retiredAt: clock }] };
    arrive({ key: OLD });
    await sync().pull("request");
    expect(getRequest("in", "ada", "r1", db)).not.toBeNull();
    clock += SUPPORT_TTL_MS;
    arrive({ id: "r2", key: OLD });
    await sync().pull("request");
    expect(getRequest("in", "ada", "r2", db)).toBeNull();
  });

  test("a message signed longer ago than a request lives, or far ahead, is dropped however new the relay says it is", async () => {
    const DAY = 24 * 60 * 60_000;
    clock = 30 * DAY;
    const at = (id: string, sentAt: number) => {
      const text = JSON.stringify({ sealed: world.put(["alex"], supportBinding("request", id, "ada"), { body: JSON.stringify(body) }) });
      const mac = supportMac(KEY, { kind: "request", id, from: "ada", to: "alex", sentAt, body: text });
      inbox.push({ id, to: "alex", from: "ada", kind: "request", sentAt, body: text, mac, receivedAt: clock });
    };
    at("replayed", clock - SUPPORT_TTL_MS - DAY - 1);
    at("ahead", clock + DAY + 1);
    at("slow-clock", clock - SUPPORT_TTL_MS - DAY + 1);
    at("fast-clock", clock + DAY - 1);
    await sync().pull("request");
    expect(acked).toEqual(["ada replayed", "ada ahead", "ada slow-clock", "ada fast-clock"]);
    expect(listRequests("in", undefined, db).map((r) => r.id).sort()).toEqual(["fast-clock", "slow-clock"]);
  });

  test("a repeat delivery calls onRequest once", async () => {
    arrive();
    const again = inbox[0]!;
    const s = sync();
    await s.pull("request");
    inbox.push(again);
    await s.pull("request");
    expect(events.filter((e) => e.startsWith("request"))).toEqual(["request ada r1"]);
    expect(acked).toEqual(["ada r1", "ada r1"]);
  });

  test("an onRequest that throws still acks, and the next request is taken", async () => {
    arrive({ id: "r1" });
    arrive({ id: "r2", from: "bo" });
    onRequestHook = (r) => {
      if (r.id === "r1") throw new Error("boom");
    };
    await sync().pull("request");
    expect(acked).toEqual(["ada r1", "bo r2"]);
  });

  test("a Mac that is not the accepting host pulls no requests", async () => {
    arrive();
    for (const c of [null, { ...host, accepts: false, acceptHere: false }]) {
      config = c;
      await sync().pull("request");
    }
    expect(acked).toEqual([]);
    expect(events).toEqual([]);
  });

  test("a Mac set to accept still drains its queue after support is turned off or the host changes", async () => {
    arrive();
    config = { ...host, enabled: false, acceptHere: false };
    await sync().pull("request");
    expect(events).toContain("request ada r1");
  });

  test("a drain reads the queue of a Mac that just stopped accepting", async () => {
    arrive();
    config = { ...host, accepts: false, acceptHere: false };
    await sync().pull("request", { drain: true });
    expect(events).toContain("request ada r1");
  });

  test("a proved request this rt cannot read is answered failed before it is acked", async () => {
    const bad = [
      "not json",
      "{}",
      JSON.stringify({ ...body, text: "  " }),
      JSON.stringify({ ...body, text: "x".repeat(8001) }),
      JSON.stringify({ ...body, slackUserId: 4 }),
      JSON.stringify({ ...body, parts: "none" }),
      JSON.stringify({ ...body, parts: [{ key: "mr", label: "MR", value: "x".repeat(2001) }] }),
      JSON.stringify({ ...body, parts: Array.from({ length: 13 }, () => body.parts[0]) }),
    ];
    bad.forEach((b, i) => arrive({ id: `r${i}`, body: b }));
    await sync().pull("request");
    expect(acked).toHaveLength(bad.length);
    expect(listRequests("in", undefined, db)).toEqual([]);
    expect(pendingStatuses(db)).toHaveLength(bad.length);
    const told = pendingStatuses(db)[0]!;
    expect(told).toMatchObject({ id: "r0:failed", to: "ada" });
    expect(JSON.parse(told.body)).toEqual({ requestId: "r0", state: "failed", at: clock, reason: "the host's mattstack could not read your request" });
  });

  test("a request that was never sealed is answered failed", async () => {
    for (const [i, raw] of ["not json", "{}", JSON.stringify(body), JSON.stringify({ sealed: 7 }), JSON.stringify({ ...body, sealed: null })].entries()) arrive({ id: `r${i}`, raw });
    await sync().pull("request");
    expect(acked).toHaveLength(5);
    expect(listRequests("in", undefined, db)).toEqual([]);
    expect(JSON.parse(pendingStatuses(db)[2]!.body)).toMatchObject({ requestId: "r2", state: "failed", reason: "the host's mattstack could not read your request" });
    expect(world.state.opened).toBe(0);
  });

  test("a request whose text belongs to another message, or is damaged, is answered failed", async () => {
    arrive({ id: "r1", raw: JSON.stringify({ sealed: world.put(["alex"], supportBinding("request", "r2", "ada"), { body: JSON.stringify(body) }) }) });
    arrive({ id: "r3", raw: JSON.stringify({ sealed: "nonsense" }) });
    arrive({ id: "r4", raw: JSON.stringify({ sealed: world.put(["alex"], supportBinding("request", "r4", "ada"), { note: "no body" }) }) });
    await sync().pull("request");
    expect(acked).toEqual(["ada r1", "ada r3", "ada r4"]);
    expect(listRequests("in", undefined, db)).toEqual([]);
    expect(pendingStatuses(db).map((s) => s.id)).toEqual(["r1:failed", "r3:failed", "r4:failed"]);
  });

  test("a request this Mac cannot open yet stays on the relay and is taken on a later pull", async () => {
    for (const reason of ["unavailable", "not-for-this-key"] as const) {
      const id = `r-${reason}`;
      acked = [];
      arrive({ id });
      world.state.open = { ok: false, reason };
      const s = sync();
      expect(await s.pull("request")).toBe(false);
      expect(acked).toEqual([]);
      expect(getRequest("in", "ada", id, db)).toBeNull();
      expect(pendingStatuses(db)).toEqual([]);
      world.state.open = null;
      await s.pull("request");
      expect(acked).toEqual([`ada ${id}`]);
      expect(getRequest("in", "ada", id, db)).toMatchObject({ text: body.text, slackUserId: "U0ADA" });
    }
  });

  test("a request sealed to a key this Mac does not hold is answered once it has had an hour to move to the Mac that does", async () => {
    arrive();
    world.state.open = { ok: false, reason: "not-for-this-key" };
    const s = sync();
    await s.pull("request");
    await awake(s, PROOF_SETTLE_MS - 60_000);
    expect(acked).toEqual([]);
    expect(pendingStatuses(db)).toEqual([]);
    clock += 12 * 60 * 60_000;
    await s.pull("request");
    expect(acked).toEqual(["ada r1"]);
    expect(pendingStatuses(db).map((p) => p.id)).toEqual(["r1:failed"]);
    expect(events.filter((e) => e === "warn")).toHaveLength(2);
  });

  test("a locked key keeps a request waiting however long it takes, and is warned about once", async () => {
    arrive();
    world.state.open = { ok: false, reason: "unavailable" };
    const s = sync();
    await s.pull("request");
    await awake(s, 2 * PROOF_SETTLE_MS);
    expect(acked).toEqual([]);
    expect(pendingStatuses(db)).toEqual([]);
    expect(events.filter((e) => e === "warn")).toHaveLength(1);
    world.state.open = null;
    await s.pull("request");
    expect(acked).toEqual(["ada r1"]);
  });

  test("text is opened only once the message is proved to come from the org", async () => {
    arrive({ id: "forged", key: FOREIGN });
    arrive({ id: "off-roster", from: "zed" });
    const s = sync();
    await s.pull("request");
    await awake(s, 2 * PROOF_SETTLE_MS);
    expect(acked.sort()).toEqual(["ada forged", "zed off-roster"]);
    expect(world.state.opened).toBe(0);
  });

  test("a repeat delivery is acked without being opened again", async () => {
    arrive();
    const again = inbox[0]!;
    const s = sync();
    await s.pull("request");
    world.state.open = { ok: false, reason: "unavailable" };
    inbox.push(again);
    await s.pull("request");
    expect(acked).toEqual(["ada r1", "ada r1"]);
    expect(world.state.opened).toBe(1);
  });

  test("an unreadable request whose answer cannot be stored is not acked", async () => {
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON support_outbox BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    arrive({ body: "not json" });
    await sync().pull("request");
    expect(acked).toEqual([]);
  });

  test("a part a newer sender adds is left out, and the rest is kept", async () => {
    arrive({ body: JSON.stringify({ ...body, parts: [...body.parts, { key: "later", label: "Later", value: "x" }] }) });
    await sync().pull("request");
    expect(getRequest("in", "ada", "r1", db)!.parts).toEqual(body.parts);
  });

  test("a message addressed to someone else is not this Mac's", async () => {
    arrive({ to: "bo" });
    await sync().pull("request");
    expect(listRequests("in", undefined, db)).toEqual([]);
  });

  test("every page is read", async () => {
    for (let i = 0; i < 250; i++) arrive({ id: `r${i}`, from: i % 2 ? "ada" : "bo" });
    await sync().pull("request");
    expect(listRequests("in", undefined, db)).toHaveLength(250);
    expect(inbox).toEqual([]);
  });

  test("a full page that cannot be acked does not spin", async () => {
    for (let i = 0; i < 150; i++) arrive({ id: `r${i}`, key: FOREIGN });
    let lists = 0;
    const counting: SupportRelay = {
      ...relay,
      list: async (k) => {
        lists++;
        return relay.list(k);
      },
    };
    await sync({ relay: async () => counting }).pull("request");
    expect(lists).toBe(1);
  });

  test("a pull says whether it read the queue empty", async () => {
    expect(await sync().pull("request")).toBe(true);
    arrive();
    expect(await sync().pull("request")).toBe(true);
    arrive({ id: "r2", key: FOREIGN });
    expect(await sync().pull("request")).toBe(false);
    inbox = [];
    arrive({ id: "r3" });
    expect(await sync({ relay: async () => ({ ...relay, ack: async () => false }) }).pull("request")).toBe(false);
    keys = null;
    expect(await sync().pull("request")).toBe(false);
  });

  test("a relay that does not answer is not an error", async () => {
    expect(await sync({ relay: async () => null }).pull("request")).toBe(false);
    expect(await sync({ relay: async () => ({ ...relay, list: async () => null }) }).pull("request")).toBe(false);
    expect(events).toEqual([]);
  });
});

describe("pulling statuses", () => {
  beforeEach(() => {
    config = sender;
    insertRequest(
      { id: "r1", direction: "out", peer: "alex", org: "acme", text: "help", parts: [], slackUserId: "U0ADA", state: "sent", reason: null, persona: null, dmLink: null, conversationId: null, gateId: null, statusAt: 0, sentAt: clock, receivedAt: clock },
      db,
    );
  });
  let at = 0;
  const status = (b: Partial<StatusBody> & { state: StatusBody["state"] }, over: Parameters<typeof arrive>[0] = {}) =>
    arrive({
      kind: "status",
      from: "alex",
      to: "ada",
      id: `${b.requestId ?? "r1"}:${b.state}`,
      body: sealStatus({ requestId: "r1", at: ++at, ...b }, `${b.requestId ?? "r1"}:${b.state}`, over?.from),
      ...over,
    });
  const state = () => getRequest("out", "alex", "r1", db)!;

  test("a status moves the request, with its reason and link", async () => {
    status({ state: "received" });
    status({ state: "opened", dmLink: "slack://user?team=T1&id=U1" });
    await sync().pull("status");
    expect(state()).toMatchObject({ state: "opened", dmLink: "slack://user?team=T1&id=U1", reason: null });
    expect(events.filter((e) => e.startsWith("status"))).toEqual(["status r1 received", "status r1 opened"]);
    expect(acked).toHaveLength(2);
  });

  test("a status whose text cannot be opened still moves the request", async () => {
    for (const reason of ["unavailable", "not-for-this-key", "mismatch", "damaged"] as const) {
      insertRequest({ ...getRequest("out", "alex", "r1", db)!, id: `q-${reason}`, state: "sent", statusAt: 0 }, db);
      status({ requestId: `q-${reason}`, state: "opened", reason: "because", persona: "Maude", dmLink: "slack://user?team=T1&id=U1" });
      world.state.open = { ok: false, reason };
      await sync().pull("status");
      expect(getRequest("out", "alex", `q-${reason}`, db)).toMatchObject({ state: "opened", reason: null, persona: null, dmLink: null });
    }
    expect(acked).toHaveLength(4);
  });

  test("a status's plain text fields are ignored", async () => {
    const raw = JSON.stringify({ requestId: "r1", state: "failed", at: 900, reason: "plain", persona: "Plain", dmLink: "slack://plain" });
    arrive({ kind: "status", from: "alex", to: "ada", id: "r1:failed", raw });
    await sync().pull("status");
    expect(state()).toMatchObject({ state: "failed", reason: null, persona: null, dmLink: null });
  });

  test("a status for a request this Mac did not send is left unacked", async () => {
    status({ requestId: "elsewhere", state: "received" });
    await sync().pull("status");
    expect(acked).toEqual([]);
  });

  test("a status from anyone but the request's host is acked and ignored", async () => {
    status({ state: "declined" }, { from: "bo" });
    await sync().pull("status");
    expect(acked).toEqual(["bo r1:declined"]);
    expect(state().state).toBe("sent");
  });

  test("a late status never moves a terminal request back", async () => {
    status({ state: "failed", reason: "no folder" });
    status({ state: "received" });
    await sync().pull("status");
    expect(state()).toMatchObject({ state: "failed", reason: "no folder" });
    expect(acked).toHaveLength(2);
  });

  test("redelivered statuses move and notify once, and never put an older one back", async () => {
    status({ state: "received" });
    status({ state: "waiting" });
    const s = sync({ relay: async () => ({ ...relay, ack: async () => false }) });
    for (let i = 0; i < 3; i++) await s.pull("status");
    expect(state().state).toBe("waiting");
    expect(events.filter((e) => e.startsWith("status"))).toEqual(["status r1 received", "status r1 waiting"]);
  });

  test("a status that overtook an earlier one stands", async () => {
    status({ state: "waiting", at: 100 });
    status({ state: "received", at: 50 });
    await sync().pull("status");
    expect(state().state).toBe("waiting");
  });

  test("a request the host OKed moves from waiting to received", async () => {
    status({ state: "waiting", at: 50 });
    status({ state: "received", at: 100 });
    await sync().pull("status");
    expect(state().state).toBe("received");
  });

  test("a status with no time on it is not believed", async () => {
    status({ state: "received", at: undefined as unknown as number });
    await sync().pull("status");
    expect(state().state).toBe("sent");
    expect(acked).toHaveLength(1);
  });

  test("a forged status is never believed", async () => {
    status({ state: "failed" }, { key: FOREIGN });
    const s = sync();
    await s.pull("status");
    await awake(s, PROOF_SETTLE_MS, "status");
    expect(state().state).toBe("sent");
    expect(acked).toEqual(["alex r1:failed"]);
  });

  test("a state this rt does not know, or a link that is not Slack's, is not believed", async () => {
    status({ state: "sent" });
    status({ state: "vanished" as StatusBody["state"] });
    status({ state: "opened", dmLink: "https://evil.example" });
    await sync().pull("status");
    expect(state()).toMatchObject({ state: "opened", dmLink: null });
    expect(acked).toHaveLength(3);
  });

  test("a status reaches a sender whose org has since turned support off", async () => {
    config = { ...sender, enabled: false };
    status({ state: "not-accepting" });
    await sync().pull("status");
    expect(state().state).toBe("not-accepting");
  });
});

describe("flushing statuses", () => {
  test("flush keeps a status the relay did not take and drops one it did", async () => {
    queueStatus({ id: "r1:received", to: "ada", body: "{}" }, clock, db);
    sendResult = "unreachable";
    await sync().flush();
    expect(pendingStatuses(db)).toHaveLength(1);
    sendResult = "ok";
    await sync().flush();
    expect(pendingStatuses(db)).toEqual([]);
    expect(sent.at(-1)).toMatchObject({ id: "r1:received", to: "ada", kind: "status", sentAt: clock, body: "{}" });
    expect(sent.at(-1)).toEqual(signDraft(config!, keys!, { id: "r1:received", to: "ada", kind: "status", body: "{}" }, clock));
  });

  const FULL: StatusBody = { requestId: "r1", state: "opened", at: 7, reason: "because", persona: "Maude", dmLink: "slack://user?team=T1&id=U1" };

  test("a status's reason, persona and link leave sealed, and its state stays readable", async () => {
    queueStatus({ id: "r1:opened", to: "ada", body: JSON.stringify(FULL) }, clock, db);
    await sync().flush();
    const { sealed, ...facts } = JSON.parse(sent[0]!.body);
    expect(facts).toEqual({ requestId: "r1", state: "opened", at: 7 });
    expect(world.read(sealed)).toEqual({ reason: "because", persona: "Maude", dmLink: "slack://user?team=T1&id=U1" });
    expect(await world.forUser("ada").open(sealed, supportBinding("status", "r1:opened", "alex"))).toMatchObject({ ok: true });
    for (const text of ["because", "Maude", "slack://"]) expect(JSON.stringify(sent)).not.toContain(text);
  });

  test("a status that cannot be sealed sends its state alone", async () => {
    for (const reason of ["unavailable", "no-recipients"] as const) {
      sent = [];
      world.state.seal = { ok: false, reason };
      queueStatus({ id: "r1:opened", to: "ada", body: JSON.stringify(FULL) }, clock, db);
      await sync().flush();
      expect(JSON.parse(sent[0]!.body)).toEqual({ requestId: "r1", state: "opened", at: 7 });
      expect(pendingStatuses(db)).toEqual([]);
    }
  });

  test("a status with no text is sent without sealing anything", async () => {
    queueStatus({ id: "r1:received", to: "ada", body: JSON.stringify({ requestId: "r1", state: "received", at: 7 }) }, clock, db);
    await sync().flush();
    expect(JSON.parse(sent[0]!.body)).toEqual({ requestId: "r1", state: "received", at: 7 });
    expect(world.texts()).toBe("[]");
  });

  test("a status is signed with the key of the moment it is sent", async () => {
    queueStatus({ id: "r1:received", to: "ada", body: "{}" }, clock, db);
    keys = { current: FOREIGN, retired: [{ key: KEY, retiredAt: clock }] };
    await sync().flush();
    const d = sent[0]!;
    expect(d.mac).toBe(supportMac(FOREIGN, { ...d, from: "alex" }));
  });

  test("an unreachable relay stops the flush, and a full queue does not hold up someone else's", async () => {
    queueStatus({ id: "r1:received", to: "ada", body: "{}" }, clock, db);
    queueStatus({ id: "r2:received", to: "bo", body: "{}" }, clock, db);
    sendResult = "unreachable";
    await sync().flush();
    expect(sent).toHaveLength(1);
    sendResult = "full";
    await sync().flush();
    expect(sent).toHaveLength(3);
    expect(pendingStatuses(db)).toHaveLength(2);
  });

  test("after a full queue, that person's later statuses wait their turn", async () => {
    queueStatus({ id: "r1:received", to: "ada", body: "{}" }, clock, db);
    queueStatus({ id: "r1:waiting", to: "ada", body: "{}" }, clock, db);
    queueStatus({ id: "r2:received", to: "bo", body: "{}" }, clock, db);
    sendResult = "full";
    await sync().flush();
    expect(sent.map((d) => d.id)).toEqual(["r1:received", "r2:received"]);
  });

  test("two flushes at once send each status once", async () => {
    queueStatus({ id: "r1:received", to: "ada", body: "{}" }, clock, db);
    queueStatus({ id: "r1:opened", to: "ada", body: "{}" }, clock, db);
    const s = sync();
    await Promise.all([s.flush(), s.flush()]);
    expect(sent.map((d) => d.id)).toEqual(["r1:received", "r1:opened"]);
  });

  test("flushes asked for while one is running become one more", async () => {
    queueStatus({ id: "r1:received", to: "ada", body: "{}" }, clock, db);
    let asked = 0;
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    const s = sync({
      relay: async () => {
        asked++;
        await held;
        return { ...relay, send: async () => "unreachable" as const };
      },
    });
    const all = [s.flush()];
    await Bun.sleep(1);
    for (let i = 0; i < 3; i++) all.push(s.flush());
    release();
    await Promise.all(all);
    expect(asked).toBe(2);
  });

  test("a status the relay will never take is dropped", async () => {
    for (const r of ["rejected", "unknown-recipient", "changed"] as const) {
      queueStatus({ id: `r1:${r}`, to: "ada", body: "{}" }, clock, db);
      sendResult = r;
      await sync().flush();
      expect(pendingStatuses(db)).toEqual([]);
    }
  });

  test("a status older than a request lives is dropped unsent", async () => {
    queueStatus({ id: "r1:received", to: "ada", body: "{}" }, clock, db);
    clock += SUPPORT_TTL_MS;
    await sync().flush();
    expect(sent).toEqual([]);
    expect(pendingStatuses(db)).toEqual([]);
  });

  test("with nothing queued, or no key or identity, nothing is sent", async () => {
    let asked = 0;
    const s = sync({
      relay: async () => {
        asked++;
        return relay;
      },
    });
    await s.flush();
    expect(asked).toBe(0);
    queueStatus({ id: "r1:received", to: "ada", body: "{}" }, clock, db);
    keys = null;
    await s.flush();
    keys = { current: KEY, retired: [] };
    config = { ...host, me: null };
    await s.flush();
    expect(sent).toEqual([]);
    expect(pendingStatuses(db)).toHaveLength(1);
  });
});
