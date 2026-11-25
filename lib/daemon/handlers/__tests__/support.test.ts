import { tmpdir } from "os";
import { join } from "path";
import { readdirSync, readFileSync, statSync } from "fs";
import { describe, expect, test } from "bun:test";
import { SUPPORT_AWAY_MS, SUPPORT_MACHINE_HOLD_MS, SUPPORT_TTL_MS, type SupportDraft, type SupportHostState, type SupportMissing } from "../../../../packages/rt-client/src/support.ts";
import { UserActionableError } from "../../../errors.ts";
import { openStateDb } from "../../../state/db.ts";
import { getRequest, insertRequest, listRequests, type SupportRequest, type SupportState } from "../../../state/support-store.ts";
import type { SupportConfig } from "../../../support/config.ts";
import type { SupportSend } from "../../../support/relay.ts";
import { SUPPORT_MAX_OPEN } from "../../../support/host.ts";
import { deleteKvValue, listKvValues } from "../../../state/kv-blob.ts";
import { supportBinding, supportMac } from "../../../support/proof.ts";
import { fakeSealedWorld } from "../../../team/__tests__/fake-sealed-text.ts";
import { createSupportHandlers, type SupportHandlerDeps } from "../support.ts";
import type { HandlerContext } from "../types.ts";

const KEY = Buffer.alloc(32, 1).toString("base64");
const ORG = "git.example.com/acme/mattstack";
const DAY = 24 * 60 * 60_000;
let n = 0;

function harness() {
  const db = openStateDb(join(tmpdir(), `support-handlers-${process.pid}-${n++}-${Date.now()}.db`));
  const state = {
    now: 1_800_000_000_000,
    config: {
      org: "acme", orgRemote: ORG, enabled: true, host: "Alex", me: "ada", isHost: false, accepts: false, acceptHere: false,
      roster: [{ username: "Alex", name: "Alex Doe" }, { username: "ada" }],
    } as SupportConfig | null,
    keys: true,
    keyMissing: false,
    relay: true,
    host: { accepting: true, lastSeenAt: 1_800_000_000_000 } as SupportHostState | null,
    send: "ok" as SupportSend,
    slackUserId: "U0ADA" as string | null | Error,
    missing: [] as SupportMissing[],
    mayChange: false,
    openChats: 0,
    setHost: "ok" as "ok" | "other-machine" | "failed",
    setup: ["account.slack-support"] as string[] | null,
    holdsRole: true,
    enable: null as Error | null,
    stop: { ok: true, told: true } as { ok: true; told: boolean } | { ok: false; reason: string },
  };
  const world = fakeSealedWorld(["alex", "ada"]);
  const sent: SupportDraft[] = [];
  const events: string[] = [];
  const logged: object[] = [];
  const deps: SupportHandlerDeps = {
    db,
    now: () => state.now,
    log: { warn: (o: object) => void logged.push(o), info() {}, debug() {}, error() {} } as unknown as HandlerContext["log"],
    config: () => state.config,
    keys: async () => (state.keys ? { current: KEY, retired: [] } : null),
    keyMissing: () => state.keyMissing,
    sealedText: world.forUser("ada"),
    relay: async () =>
      state.relay
        ? {
            send: async (d) => {
              sent.push(d);
              return state.send;
            },
            list: async () => [],
            wait: async () => null,
            ack: async () => true,
            setHost: async (on) => {
              events.push(`setHost ${on}`);
              return state.setHost;
            },
            host: async () => state.host,
          }
        : null,
    slackUserId: async () => {
      if (state.slackUserId instanceof Error) throw state.slackUserId;
      return state.slackUserId;
    },
    readiness: async () => state.missing,
    mayChange: () => state.mayChange,
    openChats: () => state.openChats,
    persona: () => "Maude",
    repos: () => ["git.example.com/acme/app"],
    setAccepting: (on) => void events.push(`setting ${on}`),
    published: (on) => void events.push(`published ${on}`),
    drain: async () => void events.push("drain"),
    poke: () => void events.push("poke"),
    stop: async (id) => {
      events.push(`stop ${id}`);
      return state.stop;
    },
    versions: async () => ({ rt: "1.2.3", app: "4.5.6", macos: "15.1" }),
    unreadySetupRows: async () => state.setup,
    holdsRole: () => state.holdsRole,
    enable: async (host) => {
      if (state.enable) throw state.enable;
      events.push(`enable ${host ?? "saved"}`);
      return { host: "Alex" };
    },
    disable: () => {
      if (state.enable) throw state.enable;
      events.push("disable");
      return { host: "Alex" };
    },
  };
  const handlers = createSupportHandlers(deps);
  const request = (over: Partial<SupportRequest> = {}) =>
    insertRequest(
      { id: "old", direction: "out", peer: "alex", org: ORG, text: "help", parts: [], slackUserId: "U0ADA", state: "sent", reason: null, persona: null, dmLink: null, conversationId: null, gateId: null, statusAt: 0, sentAt: state.now, receivedAt: state.now, ...over },
      db,
    );
  const askText = (i = 0) => JSON.parse(world.read(JSON.parse(sent[i]!.body).sealed)!.body!);
  return { db, state, deps, world, askText, sent, events, logged, handlers, request };
}

const ASK = { id: "r1", text: "the board will not load", parts: [{ key: "versions" as const, label: "Versions", value: "rt 1.2.3" }] };

describe("support:enable", () => {
  test("turns support on for the named or the saved host, and off, and wakes the loops", async () => {
    const h = harness();
    expect(await h.handlers["support:enable"]({ on: true, host: "alex" })).toEqual({ ok: true, data: { enabled: true, host: "Alex" } });
    expect(await h.handlers["support:enable"]({ on: true })).toEqual({ ok: true, data: { enabled: true, host: "Alex" } });
    expect(await h.handlers["support:enable"]({ on: false })).toEqual({ ok: true, data: { enabled: false, host: "Alex" } });
    expect(h.events).toEqual(["enable alex", "poke", "enable saved", "poke", "disable", "poke"]);
  });

  test("a refusal reads as one plain message with its reason and its command", async () => {
    const h = harness();
    for (const [err, message] of [
      [new UserActionableError("team-pull-only", "The org's shared files belong to its admins", {}, { why: "Ask dev1 (an org admin) to make this change." }), "The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change."],
      [new UserActionableError("no-recipients", "The acme org's secrets are not locked to anyone yet", {}, { next: "rt team members sync" }), "The acme org's secrets are not locked to anyone yet. Run rt team members sync."],
    ] as const) {
      h.state.enable = err;
      for (const on of [true, false]) {
        expect(await h.handlers["support:enable"]({ on })).toMatchObject({ ok: false, failure: { code: `support-${err.code}`, message } });
      }
    }
    expect(h.events).toEqual([]);
  });

  test("a refusal's technical detail goes to the log and never to the screen", async () => {
    const h = harness();
    h.state.enable = new UserActionableError("secrets-unreadable", "The org's secrets could not be opened", {}, { log: "sops: mac mismatch" });
    const r = await h.handlers["support:enable"]({ on: true });
    expect(r).toMatchObject({ ok: false, failure: { code: "support-secrets-unreadable" } });
    expect(JSON.stringify(r)).not.toContain("sops");
    expect(h.logged).toEqual([{ code: "secrets-unreadable", detail: "sops: mac mismatch" }]);
  });

  test("anything else that goes wrong never shows its own words", async () => {
    const h = harness();
    h.state.enable = new Error("sops: /Users/x/secret failed");
    const r = await h.handlers["support:enable"]({ on: true });
    expect(r).toMatchObject({ ok: false, failure: { code: "support-enable" } });
    expect(JSON.stringify(r)).not.toContain("sops");
  });

  test("a payload that says nothing, or names a host that is not a name, is refused", async () => {
    const h = harness();
    for (const payload of [null, {}, { on: "yes" }, { on: true, host: 3 }, { on: true, host: " " }]) {
      expect(await h.handlers["support:enable"](payload)).toMatchObject({ ok: false, failure: { code: "support-enable" } });
    }
    expect(h.events).toEqual([]);
  });
});

describe("support:availability", () => {
  const availability = async (h: ReturnType<typeof harness>) => {
    const r = await h.handlers["support:availability"]({});
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };

  test("ready, and says who answers", async () => {
    expect(await availability(harness())).toEqual({ state: "ready", host: "Alex Doe", away: false, persona: "Maude" });
  });

  test("hidden: no org, support off, no host, host not accepting, or this person is the host", async () => {
    for (const set of [
      (h: ReturnType<typeof harness>) => void (h.state.config = null),
      (h: ReturnType<typeof harness>) => void (h.state.config = { ...h.state.config!, enabled: false }),
      (h: ReturnType<typeof harness>) => void (h.state.config = { ...h.state.config!, host: null }),
      (h: ReturnType<typeof harness>) => void (h.state.host = { accepting: false, lastSeenAt: null }),
      (h: ReturnType<typeof harness>) => void (h.state.config = { ...h.state.config!, me: "alex", isHost: true }),
    ]) {
      const h = harness();
      set(h);
      expect(await availability(h)).toEqual({ state: "hidden" });
    }
  });

  test("disabled with its reason: no board token, no Slack connection, support key unreadable, or no username", async () => {
    const cases: [(h: ReturnType<typeof harness>) => void, string][] = [
      [(h) => void (h.state.relay = false), "Connect your board first"],
      [(h) => void (h.state.slackUserId = null), "Connect Slack first"],
      [(h) => void (h.state.keys = false), "This Mac cannot open the org's secrets"],
      [(h) => void ((h.state.keys = false), (h.state.keyMissing = true)), "Your org has no support key yet, so an org admin runs rt team support on"],
      [(h) => void (h.state.config = { ...h.state.config!, me: null }), "Connect your forge account first"],
      [(h) => void h.world.keyed.delete("alex"), "Alex Doe can't receive requests yet"],
    ];
    for (const [set, reason] of cases) {
      const h = harness();
      set(h);
      expect(await availability(h)).toEqual({ state: "disabled", reason, host: "Alex Doe", persona: "Maude" });
    }
  });

  test("a relay that does not answer is hidden, never an error", async () => {
    const h = harness();
    h.state.host = null;
    expect(await availability(h)).toEqual({ state: "hidden" });
  });

  test("a Slack that does not answer does not hide the button", async () => {
    const h = harness();
    h.state.slackUserId = new Error("ratelimited");
    expect(await availability(h)).toMatchObject({ state: "ready" });
  });

  test("away when the host's Mac has not polled for 2 minutes, or never has", async () => {
    const h = harness();
    h.state.host = { accepting: true, lastSeenAt: h.state.now - SUPPORT_AWAY_MS };
    expect(await availability(h)).toMatchObject({ away: false });
    h.state.host = { accepting: true, lastSeenAt: h.state.now - SUPPORT_AWAY_MS - 1 };
    expect(await availability(h)).toMatchObject({ away: true });
    h.state.host = { accepting: true, lastSeenAt: null };
    expect(await availability(h)).toMatchObject({ away: true });
  });
});

describe("support:context", () => {
  const context = (h: ReturnType<typeof harness>, payload: object = {}) => h.handlers["support:context"](payload);

  test("context holds versions and unready row ids only; the mr part only when asked", async () => {
    const h = harness();
    expect(await context(h, { board: "0.9", app: "4.5.7" })).toEqual({
      ok: true,
      data: {
        parts: [
          { key: "versions", label: "Versions", value: "rt 1.2.3, app 4.5.7, board 0.9, macOS 15.1" },
          { key: "setup", label: "Setup rows that need attention", value: "account.slack-support" },
        ],
      },
    });
    const withMr = await context(h, { mr: { url: "https://git.example.com/acme/app/-/merge_requests/7", state: "review running" } });
    expect(withMr.ok && withMr.data.parts.at(-1)).toEqual({ key: "mr", label: "MR", value: "https://git.example.com/acme/app/-/merge_requests/7 (review running)" });
  });

  test("a version it cannot read and a setup status that failed are left out", async () => {
    const h = harness();
    h.deps.versions = async () => ({ rt: "1.2.3", app: null, macos: null });
    for (const setup of [null, []]) {
      h.state.setup = setup;
      const r = await createSupportHandlers(h.deps)["support:context"]({});
      expect(r.ok && r.data.parts).toEqual([{ key: "versions", label: "Versions", value: "rt 1.2.3" }]);
    }
  });

  test("context refuses an mr url that is not https, or that carries credentials", async () => {
    const h = harness();
    for (const url of ["http://git.example.com/x", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@git.example.com/x", "https://tok@git.example.com/x", "nope", `https://git.example.com/${"x".repeat(2000)}`]) {
      expect((await context(h, { mr: { url, state: "open" } })).ok).toBe(false);
    }
    expect((await context(h, { mr: { url: "https://git.example.com/x", state: 4 } })).ok).toBe(false);
  });

  test("a value never breaks its line or runs long", async () => {
    const h = harness();
    const r = await context(h, { board: "0.9\nInjected: yes", mr: { url: "https://git.example.com/x?private_token=abc#frag", state: `open\n${"y".repeat(5000)}` } });
    if (!r.ok) throw new Error(r.error);
    for (const p of r.data.parts) {
      expect(p.value).not.toContain("\n");
      expect(p.value.length).toBeLessThanOrEqual(2000);
    }
    expect(JSON.stringify(r.data.parts)).not.toContain("private_token");
  });
});

describe("support:send", () => {
  const send = (h: ReturnType<typeof harness>, over: object = {}) => h.handlers["support:send"]({ ...ASK, ...over } as never);

  test("a request is signed, sent and kept as sent", async () => {
    const h = harness();
    const r = await send(h);
    expect(r).toMatchObject({ ok: true, data: { request: { id: "r1", peer: "alex", state: "sent", text: ASK.text, parts: ASK.parts } } });
    const d = h.sent[0]!;
    expect(d).toMatchObject({ id: "r1", to: "alex", kind: "request", sentAt: h.state.now });
    expect(d.mac).toBe(supportMac(KEY, { ...d, from: "ada" }));
    expect(Object.keys(JSON.parse(d.body))).toEqual(["sealed"]);
    expect(h.askText()).toEqual({ text: ASK.text, parts: ASK.parts, slackUserId: "U0ADA" });
    expect(await h.world.forUser("alex").open(JSON.parse(d.body).sealed, supportBinding("request", "r1", "ada"))).toMatchObject({ ok: true });
    for (const text of [ASK.text, "rt 1.2.3", "U0ADA"]) expect(JSON.stringify(h.sent)).not.toContain(text);
    expect(getRequest("out", "alex", "r1", h.db)).toMatchObject({ org: ORG, sentAt: h.state.now });
    expect(h.events).toEqual(["poke"]);
  });

  test("send refuses unknown part keys, 13 parts, and text of 8001 characters or only spaces", async () => {
    const part = ASK.parts[0]!;
    const bad: object[] = [
      { parts: [{ ...part, key: "logs" }] },
      { parts: Array.from({ length: 13 }, () => part) },
      { parts: [{ ...part, value: "x".repeat(2001) }] },
      { parts: [{ ...part, label: "x".repeat(101) }] },
      { parts: [{ ...part, value: 4 }] },
      { parts: "none" },
      { text: "x".repeat(8001) },
      { text: "  \n " },
      { text: 4 },
      { id: "" },
      { id: "x".repeat(129) },
      { id: "has space" },
    ];
    for (const over of bad) {
      const h = harness();
      expect((await send(h, over)).ok).toBe(false);
      expect(h.sent).toEqual([]);
      expect(listRequests("out", undefined, h.db)).toEqual([]);
    }
  });

  test("send takes 8000 characters of any script, or says it is too long to send", async () => {
    const h = harness();
    expect((await send(h, { text: "x".repeat(8000) })).ok).toBe(true);
    const wide = harness();
    const r = await send(wide, { text: "x".repeat(8000), parts: Array.from({ length: 12 }, () => ({ ...ASK.parts[0]!, value: "\n".repeat(2000) })) });
    expect(r).toMatchObject({ ok: false, failure: { code: "support-too-long" } });
    expect(wide.sent).toEqual([]);
  });

  test("send reads the Slack id from this Mac's own token, never from the payload", async () => {
    const h = harness();
    await send(h, { slackUserId: "U0SOMEONE" });
    expect(h.askText().slackUserId).toBe("U0ADA");
    for (const id of [null, new Error("ratelimited")]) {
      const none = harness();
      none.state.slackUserId = id;
      expect((await send(none)).ok).toBe(false);
      expect(none.sent).toEqual([]);
    }
  });

  test("send stores nothing when the relay is unreachable, and a retry with the same id sends once", async () => {
    const h = harness();
    h.state.send = "unreachable";
    expect(await send(h)).toMatchObject({ ok: false, failure: { code: "support-unreachable" } });
    expect(listRequests("out", undefined, h.db)).toEqual([]);
    h.state.send = "ok";
    expect((await send(h)).ok).toBe(true);
    expect((await send(h)).ok).toBe(true);
    expect(h.sent).toHaveLength(2);
    expect(listRequests("out", undefined, h.db)).toHaveLength(1);
  });

  test("a host with no key is refused, and a Mac that cannot seal says to try again", async () => {
    const h = harness();
    h.world.keyed.delete("alex");
    expect(await send(h)).toMatchObject({ ok: false, failure: { code: "support-no-host-key", message: "Alex Doe can't receive requests yet." } });
    h.world.keyed.add("alex");
    h.world.state.seal = { ok: false, reason: "unavailable" };
    expect(await send(h)).toMatchObject({ ok: false, failure: { code: "support-not-sealed", message: "This Mac could not lock your request, so nothing was sent. Try again." } });
    expect(h.sent).toEqual([]);
    expect(listRequests("out", undefined, h.db)).toEqual([]);
    expect(listKvValues("support-sealed", h.db)).toEqual({});
    h.world.state.seal = null;
    expect((await send(h)).ok).toBe(true);
  });

  test("a retry after a lost answer sends the same bytes, a daemon restart between or not", async () => {
    const h = harness();
    h.state.send = "unreachable";
    expect(await send(h)).toMatchObject({ failure: { code: "support-unreachable" } });
    h.state.send = "ok";
    const again = createSupportHandlers(h.deps);
    expect((await again["support:send"](ASK as never)).ok).toBe(true);
    expect(h.sent[1]!.body).toBe(h.sent[0]!.body);
    expect(listKvValues("support-sealed", h.db)).toEqual({});
  });

  test("other words, other parts or another host under the same id are sealed anew", async () => {
    const h = harness();
    h.state.send = "unreachable";
    await send(h);
    await send(h, { text: "something else" });
    await send(h, { parts: [] });
    h.world.keyed.add("bo");
    h.state.config = { ...h.state.config!, host: "bo" };
    await send(h);
    expect(new Set(h.sent.map((d) => d.body)).size).toBe(4);
    expect(h.askText(1).text).toBe("something else");
    expect(h.askText(2).parts).toEqual([]);
  });

  test("a kept body goes once the relay has the request, whichever version it took, and after 7 days", async () => {
    for (const result of ["ok", "changed"] as const) {
      const h = harness();
      h.state.send = "unreachable";
      await send(h);
      expect(Object.keys(listKvValues("support-sealed", h.db))).toEqual(["r1"]);
      h.state.send = result;
      await send(h);
      expect(listKvValues("support-sealed", h.db)).toEqual({});
    }
    const h = harness();
    h.state.send = "unreachable";
    await send(h);
    h.state.now += SUPPORT_TTL_MS;
    await send(h);
    expect(h.sent[1]!.body).not.toBe(h.sent[0]!.body);
    h.state.now += SUPPORT_TTL_MS;
    await h.handlers["support:mine"]({});
    expect(listKvValues("support-sealed", h.db)).toEqual({});
  });

  test("a kept body that went missing is sealed again", async () => {
    const h = harness();
    h.state.send = "unreachable";
    await send(h);
    deleteKvValue("support-sealed", "r1", h.db);
    h.state.send = "ok";
    expect((await send(h)).ok).toBe(true);
    expect(h.askText(1)).toEqual(h.askText(0));
  });

  test("two sends of one id at once reach the relay once", async () => {
    const h = harness();
    await Promise.all([send(h), send(h)]);
    expect(h.sent).toHaveLength(1);
  });

  test("a relay that already holds an earlier version keeps the request and says so", async () => {
    const h = harness();
    h.state.send = "changed";
    expect(await send(h)).toMatchObject({ ok: false, failure: { code: "support-changed" } });
    expect(getRequest("out", "alex", "r1", h.db)).toMatchObject({ state: "sent" });
  });

  test("a host that stopped accepting gets nothing sent", async () => {
    const h = harness();
    h.state.host = { accepting: false, lastSeenAt: 1 };
    expect(await send(h)).toMatchObject({ ok: false, failure: { code: "support-not-accepting" } });
    expect(h.sent).toEqual([]);
    expect(listRequests("out", undefined, h.db)).toEqual([]);
  });

  test("when the relay cannot say whether the host accepts, the send itself answers", async () => {
    for (const [result, code] of [["unauthorized", "support-unauthorized"], ["unreachable", "support-unreachable"]] as const) {
      const h = harness();
      h.state.host = null;
      h.state.send = result;
      expect(await send(h)).toMatchObject({ ok: false, failure: { code } });
    }
  });

  test("an id used again for other words says the first version is the one sent", async () => {
    const h = harness();
    await send(h);
    expect(await send(h, { text: "something else" })).toMatchObject({ ok: false, failure: { code: "support-changed" } });
    expect(await send(h, { parts: [] })).toMatchObject({ ok: false, failure: { code: "support-changed" } });
    expect(h.sent).toHaveLength(1);
  });

  test("a request left with a former host does not hold up a new one", async () => {
    const h = harness();
    h.request({ peer: "former", state: "received" });
    expect((await send(h)).ok).toBe(true);
  });

  test("every other refusal says what to do and stores nothing", async () => {
    for (const result of ["unknown-recipient", "full", "unauthorized", "rejected"] as const) {
      const h = harness();
      h.state.send = result;
      const r = await send(h);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.failure?.message).toBeTruthy();
      expect(listRequests("out", undefined, h.db)).toEqual([]);
    }
  });

  test("send refuses with support off, no host, no username, no token, no key, or as the host", async () => {
    for (const set of [
      (h: ReturnType<typeof harness>) => void (h.state.config = null),
      (h: ReturnType<typeof harness>) => void (h.state.config = { ...h.state.config!, enabled: false }),
      (h: ReturnType<typeof harness>) => void (h.state.config = { ...h.state.config!, host: null }),
      (h: ReturnType<typeof harness>) => void (h.state.config = { ...h.state.config!, me: null }),
      (h: ReturnType<typeof harness>) => void (h.state.config = { ...h.state.config!, isHost: true }),
      (h: ReturnType<typeof harness>) => void (h.state.relay = false),
      (h: ReturnType<typeof harness>) => void (h.state.keys = false),
    ]) {
      const h = harness();
      set(h);
      expect((await send(h)).ok).toBe(false);
      expect(h.sent).toEqual([]);
    }
  });

  test("send tells an org with no support key from one this Mac cannot open", async () => {
    const h = harness();
    h.state.keys = false;
    expect(await send(h)).toMatchObject({ failure: { code: "support-no-key", message: "This Mac cannot open the org's secrets." } });
    h.state.keyMissing = true;
    expect(await send(h)).toMatchObject({ failure: { code: "support-no-key", message: "Your org has no support key yet, so an org admin runs rt team support on." } });
  });

  test("a rename of the org's folder leaves the request already waiting", async () => {
    const h = harness();
    h.request({ state: "waiting" });
    h.state.config = { ...h.state.config!, org: "renamed" };
    expect(await send(h)).toMatchObject({ ok: false, failure: { code: "support-already-waiting" } });
  });

  test("send refuses while the sender has a request in sent, received, opening or waiting", async () => {
    for (const state of ["sent", "received", "opening", "waiting"] as SupportState[]) {
      const h = harness();
      h.request({ state });
      expect(await send(h)).toMatchObject({ ok: false, failure: { code: "support-already-waiting" } });
      expect(h.sent).toEqual([]);
    }
    const h = harness();
    h.request({ state: "opened" });
    expect((await send(h)).ok).toBe(true);
  });

  test("a request past 7 days does not hold up the next one", async () => {
    const h = harness();
    h.request({ state: "received", sentAt: h.state.now - SUPPORT_TTL_MS });
    expect((await send(h)).ok).toBe(true);
  });
});

describe("support:mine", () => {
  const mine = async (h: ReturnType<typeof harness>) => {
    const r = await h.handlers["support:mine"]({});
    if (!r.ok) throw new Error(r.error);
    return r.data.requests;
  };

  test("mine reads away after 2 minutes and expired after 7 days", async () => {
    const h = harness();
    h.request();
    expect(await mine(h)).toMatchObject([{ id: "old", state: "sent", away: false }]);
    h.state.now += SUPPORT_AWAY_MS + 1;
    expect(await mine(h)).toMatchObject([{ away: true }]);
    h.state.now += SUPPORT_TTL_MS;
    expect(await mine(h)).toMatchObject([{ state: "expired", away: false }]);
  });

  test("a request the host answered is never away", async () => {
    const h = harness();
    h.request({ state: "received", sentAt: h.state.now - DAY });
    expect(await mine(h)).toMatchObject([{ state: "received", away: false }]);
  });

  test("newest first, and only what this Mac sent", async () => {
    const h = harness();
    h.request({ id: "a", receivedAt: 1, state: "opened" });
    h.request({ id: "b", receivedAt: 2, state: "failed" });
    h.request({ id: "c", direction: "in" });
    expect((await mine(h)).map((r) => r.id)).toEqual(["b", "a"]);
  });

  test("each is named for the person it went to, whoever is the host now", async () => {
    const h = harness();
    h.request({ id: "a", peer: "alex" });
    h.request({ id: "gone", peer: "gone" });
    h.state.config = { ...h.state.config!, host: "ada" };
    const names = async () => (await mine(h)).map((r) => r.host).sort();
    expect(await names()).toEqual(["Alex Doe", "gone"]);
    h.state.config = null;
    expect(await names()).toEqual(["alex", "gone"]);
  });

  test("a send, and its retry, read the same as the list", async () => {
    const h = harness();
    for (let i = 0; i < 2; i++) {
      const r = await h.handlers["support:send"](ASK);
      expect(r).toMatchObject({ ok: true, data: { request: { id: "r1", host: "Alex Doe", away: false } } });
    }
    expect(h.sent).toHaveLength(1);
  });
});

describe("support:host and support:accept", () => {
  const asHost = (h: ReturnType<typeof harness>, accepting = false) =>
    void (h.state.config = { ...h.state.config!, me: "alex", isHost: true, accepts: accepting, acceptHere: accepting });

  const need = (text: string, fix: SupportMissing["fix"] = null): SupportMissing => ({ text, label: text, fix });
  const view = async (h: ReturnType<typeof harness>) => {
    const r = await h.handlers["support:host"]({});
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };

  test("the host reads what is missing; nobody else is asked", async () => {
    const h = harness();
    h.state.missing = [need("Set your chat name", "chat-name")];
    h.state.openChats = 1;
    h.request({ id: "w", direction: "in", peer: "ada", state: "waiting" });
    const nobody = { isHost: false, enabled: true, accepting: false, missing: [], needs: [], otherMac: false, open: 0, cap: SUPPORT_MAX_OPEN, waiting: 0, persona: "Maude", repos: [], org: null };
    expect(await view(h)).toEqual(nobody);
    asHost(h, true);
    expect(await view(h)).toEqual({ ...nobody, isHost: true, accepting: true, missing: ["Set your chat name"], needs: h.state.missing, open: 1, waiting: 1 });
    h.state.holdsRole = false;
    expect(await view(h)).toMatchObject({ accepting: false, otherMac: true });
  });

  test("the host's other Mac is named only while the relay would keep this one out", async () => {
    const h = harness();
    asHost(h);
    expect((await view(h)).otherMac, "this Mac holds the role itself").toBe(false);
    h.state.holdsRole = false;
    const other = async (host: SupportHostState | null) => {
      h.state.host = host;
      return (await view(h)).otherMac;
    };
    expect(await other({ accepting: true, lastSeenAt: h.state.now - SUPPORT_MACHINE_HOLD_MS + 1 })).toBe(true);
    expect(await other({ accepting: true, lastSeenAt: h.state.now - SUPPORT_MACHINE_HOLD_MS })).toBe(false);
    expect(await other({ accepting: true, lastSeenAt: null })).toBe(false);
    expect(await other({ accepting: false, lastSeenAt: h.state.now })).toBe(false);
    expect(await other(null)).toBe(false);
  });

  test("the repos to choose from come only with the repo still to choose", async () => {
    const h = harness();
    asHost(h);
    expect((await view(h)).repos).toEqual([]);
    h.state.missing = [need("Choose the repo the support agent works in", "repo")];
    expect((await view(h)).repos).toEqual(["git.example.com/acme/app"]);
  });

  test("someone who may change the org reads its switch, and whether the host is answering", async () => {
    const h = harness();
    h.state.mayChange = true;
    const people = h.state.config!.roster;
    expect((await view(h)).org).toEqual({ host: "Alex", hasKey: true, people, answering: true });
    h.state.host = { accepting: false, lastSeenAt: null };
    h.state.keyMissing = true;
    expect((await view(h)).org).toEqual({ host: "Alex", hasKey: false, people, answering: false });
    h.state.relay = false;
    expect((await view(h)).org).toMatchObject({ answering: null });
    h.state.config = { ...h.state.config!, host: null, enabled: false };
    expect(await view(h)).toMatchObject({ enabled: false, org: { host: null, answering: null } });
  });

  test("accept refuses for anyone but the host", async () => {
    const h = harness();
    expect((await h.handlers["support:accept"]({ on: true })).ok).toBe(false);
    asHost(h);
    h.state.config = { ...h.state.config!, enabled: false };
    expect((await h.handlers["support:accept"]({ on: true })).ok).toBe(false);
    expect((await h.handlers["support:accept"]({ on: "yes" } as never)).ok).toBe(false);
    expect(h.events).toEqual([]);
  });

  test("accept refuses with each missing piece named", async () => {
    const h = harness();
    asHost(h);
    h.state.missing = [need("Set your chat name"), need("Slack did not answer")];
    const r = await h.handlers["support:accept"]({ on: true });
    expect(!r.ok && r.failure?.message).toBe("Set your chat name. Slack did not answer.");
    expect(h.events).toEqual([]);
  });

  test("accept on claims the role before it is kept, and refuses a second Mac", async () => {
    const h = harness();
    asHost(h);
    expect(await h.handlers["support:accept"]({ on: true })).toEqual({ ok: true, data: { accepting: true } });
    expect(h.events).toEqual(["setHost true", "published true", "setting true", "poke"]);
    for (const [result, message] of [["other-machine", "Another of your Macs is already accepting"], ["failed", "The relay did not answer"]] as const) {
      const other = harness();
      asHost(other);
      other.state.setHost = result;
      const r = await other.handlers["support:accept"]({ on: true });
      expect(!r.ok && r.failure?.message).toContain(message);
      expect(other.events).toEqual(["setHost true"]);
    }
  });

  test("accept off publishes the flag and answers queued requests not-accepting", async () => {
    const h = harness();
    asHost(h, true);
    expect(await h.handlers["support:accept"]({ on: false })).toEqual({ ok: true, data: { accepting: false } });
    expect(h.events).toEqual(["setHost false", "published false", "setting false", "drain"]);
  });

  test("accept off always turns this Mac off, even with no relay", async () => {
    for (const set of [(h: ReturnType<typeof harness>) => void (h.state.relay = false), (h: ReturnType<typeof harness>) => void (h.state.setHost = "failed")]) {
      const h = harness();
      asHost(h, true);
      set(h);
      expect((await h.handlers["support:accept"]({ on: false })).ok).toBe(true);
      expect(h.events).toContain("setting false");
      expect(h.events).not.toContain("published false");
    }
  });

  test("someone who is no longer the host can still turn their Mac off", async () => {
    const h = harness();
    h.state.config = { ...h.state.config!, accepts: true };
    expect((await h.handlers["support:accept"]({ on: false })).ok).toBe(true);
    expect(h.events).toContain("setting false");
  });
});

describe("support:stop", () => {
  test("stop says whether the teammate was told", async () => {
    const h = harness();
    expect(await h.handlers["support:stop"]({ conversation: 5 })).toEqual({ ok: true, data: { told: true } });
    expect(h.events).toEqual(["stop 5"]);
  });

  test("stop refuses an unknown or closed conversation", async () => {
    const h = harness();
    h.state.stop = { ok: false, reason: "that chat is already closed" };
    expect(await h.handlers["support:stop"]({ conversation: 5 })).toMatchObject({ ok: false, failure: { message: "that chat is already closed" } });
    for (const conversation of [0, 1.5, "5", undefined]) expect((await h.handlers["support:stop"]({ conversation } as never)).ok).toBe(false);
    expect(h.events).toEqual(["stop 5"]);
  });
});

describe("what a person alone may do", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "__tests__" || name === "node_modules") return [];
      return statSync(path).isDirectory() ? sources(path) : /\.(ts|mts)$/.test(name) ? [path] : [];
    });
  }

  test("no command tree verb or MCP tool names support:send, support:accept or support:stop", () => {
    const root = join(import.meta.dir, "..", "..", "..", "..");
    const files = [...sources(join(root, "commands")), ...sources(join(root, "lib", "mcp")), join(root, "lib", "command-tree-def.ts"), join(root, "lib", "module-registry.ts")];
    const named = files.filter((f) => /support:(send|accept|stop)|support(Send|Accept|Stop)\b/.test(readFileSync(f, "utf8").replace(/teamSupport\w+/g, "")));
    expect(named).toEqual([]);
  });
});
