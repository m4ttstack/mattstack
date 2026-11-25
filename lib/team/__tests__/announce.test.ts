import { beforeEach, describe, expect, test } from "bun:test";
import { ANNOUNCEMENT_PLACEHOLDER, announcementBinding, parseAnnouncementPayload } from "../../../packages/rt-client/src/announcement.ts";
import type { SealBinding, SealFields, SealResult } from "../../../packages/rt-client/src/sealed-text.ts";
import { switchboardUrl } from "../../../packages/rt-client/src/switchboard.ts";
import { fakeProbes, type FakeProbesOpts } from "../../setup/__tests__/fakes.ts";
import type { Probes } from "../../setup/probes.ts";
import { sendAnnouncement, type AnnounceSeams } from "../announce.ts";
import type { SealedText } from "../sealed-text.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/home/x";
const SWITCHBOARD_URL = switchboardUrl();
const input = { title: "Update rt", message: "Today" };

function orgFiles(username: string): Record<string, string> {
  return {
    [`${HOME}/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc`]: JSON.stringify({
      "mattstack.org": { owners: ["dev1"], admins: [], teams: {} },
      "mattstack.roster": [{ username: "Dev1" }, { username: "dev2" }, { username: "dev3" }],
    }),
    [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: username }),
  };
}

type Call = { url: string; headers: Record<string, string>; body: string };
let calls: Call[];

function probesFor(username: string, reply: () => { status: number; body: string } | Promise<never>, extra: FakeProbesOpts = {}): Probes {
  return fakeProbes({
    home: HOME,
    files: orgFiles(username),
    fetch: async (url, init) => {
      calls.push({ url, headers: init?.headers ?? {}, body: init?.body ?? "" });
      const r = await reply();
      return { ...r, headers: {} };
    },
    ...extra,
  });
}

const ok = () => ({ status: 200, body: JSON.stringify({ ok: true, delivered: 3 }) });

type Sealing = { to: readonly string[]; binding: SealBinding; fields: SealFields };
let sealings: Sealing[];

function sealing(result: SealResult): SealedText {
  return {
    seal: async (to, binding, fields) => {
      sealings.push({ to, binding, fields });
      return result;
    },
    open: async () => ({ ok: false, reason: "unavailable" }),
    holdsKeyOf: async () => true,
    reachable: () => [],
  };
}

const sealed = (unreachable: string[] = []) => sealing({ ok: true, sealed: "YWdl", unreachable });
const seams: AnnounceSeams = { readLocalSecret: async (key) => (key === "switchboardToken" ? "board-token" : null), sealedText: sealed() };
const noToken: AnnounceSeams = { ...seams, readLocalSecret: async () => null };

beforeEach(() => {
  calls = [];
  sealings = [];
});

describe("sendAnnouncement", () => {
  test("an owner posts an announcement to every board", async () => {
    const r = await sendAnnouncement(probesFor("dev1", ok), "acme", input, seams);
    expect(r).toEqual({ delivered: 3, unreadable: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SWITCHBOARD_URL}/envelopes`);
    expect(calls[0]!.headers.Authorization).toBe("Bearer board-token");
    const { id: _id, sentAt: _sentAt, ...rest } = JSON.parse(calls[0]!.body);
    expect(rest).toEqual({ to: "*", type: "announcement", payload: { ...ANNOUNCEMENT_PLACEHOLDER, sealed: "YWdl" } });
  });

  test("the posted body holds neither the title nor the message, and an older board reads the placeholder", async () => {
    await sendAnnouncement(probesFor("dev1", ok), "acme", input, seams);
    const body = calls[0]!.body;
    expect(body).not.toContain(input.title);
    expect(body).not.toContain(input.message);
    const { title, message } = JSON.parse(body).payload;
    expect({ title, message }).toEqual({ title: "Announcement", message: "Update mattstack to read this." });
    expect(parseAnnouncementPayload({ title, message })).toEqual({ title, message });
  });

  test("the text is sealed to the whole roster, the sender included, and bound to its envelope", async () => {
    await sendAnnouncement(probesFor("dev1", ok), "acme", input, seams);
    const { id } = JSON.parse(calls[0]!.body);
    expect(sealings).toEqual([{ to: ["dev1", "dev2", "dev3"], binding: announcementBinding(id, "dev1"), fields: input }]);
  });

  test("a sender the roster does not name is sealed to as well", async () => {
    const p = probesFor("dev1", ok, {
      files: { ...orgFiles("dev1"), [`${HOME}/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: ["dev1"], admins: [], teams: {} } }) },
    });
    await sendAnnouncement(p, "acme", input, seams);
    expect(sealings[0]!.to).toEqual(["dev1"]);
  });

  test("people with no key are counted", async () => {
    const r = await sendAnnouncement(probesFor("dev1", ok), "acme", input, { ...seams, sealedText: sealed(["dev2", "dev3"]) });
    expect(r).toEqual({ delivered: 3, unreadable: 2 });
  });

  test("text this Mac cannot seal is never sent", async () => {
    for (const reason of ["unavailable", "no-recipients"] as const) {
      const err = await sendAnnouncement(probesFor("dev1", ok), "acme", input, { ...seams, sealedText: sealing({ ok: false, reason }) }).catch((e) => e);
      expect(err).toMatchObject({ code: "announce-not-sealed", message: "This Mac could not lock the announcement, so nothing was sent" });
    }
    expect(calls).toHaveLength(0);
  });

  test("a plain member is refused before anything is sent", async () => {
    await expect(sendAnnouncement(probesFor("dev3", ok), "acme", input, seams)).rejects.toMatchObject({ code: "announce-not-admin" });
    expect(calls).toHaveLength(0);
  });

  test("text over the cap is refused before anything is sent", async () => {
    await expect(sendAnnouncement(probesFor("dev1", ok), "acme", { title: "a".repeat(81), message: "b" }, seams)).rejects.toMatchObject({ code: "announce-invalid" });
    expect(calls).toHaveLength(0);
  });

  test("no board token is refused", async () => {
    await expect(sendAnnouncement(probesFor("dev1", ok), "acme", input, noToken)).rejects.toMatchObject({ code: "announce-no-board-token" });
    expect(calls).toHaveLength(0);
  });

  test("a 401 reads as a rejected token", async () => {
    await expect(sendAnnouncement(probesFor("dev1", () => ({ status: 401, body: "" })), "acme", input, seams)).rejects.toMatchObject({ code: "announce-token-rejected" });
  });

  test("an unreachable switchboard says so", async () => {
    const err = await sendAnnouncement(probesFor("dev1", () => ({ status: 0, body: "" })), "acme", input, seams).catch((e) => e);
    expect(err).toMatchObject({ code: "announce-send-failed" });
    expect(err.why).toContain("could not reach the switchboard");
  });

  test("a Mac with no recorded username is told so, not that it is a member", async () => {
    const p = fakeProbes({ home: HOME, files: { ...orgFiles("dev1"), [teamLocalPath(HOME, "acme")]: JSON.stringify({}) } });
    const err = await sendAnnouncement(p, "acme", input, seams).catch((e) => e);
    expect(err).toMatchObject({ code: "announce-not-admin" });
    expect(err.why).toContain("does not know this Mac's username");
  });

  test("recovery commands ride in next", async () => {
    const noBoard = await sendAnnouncement(probesFor("dev1", ok), "acme", input, noToken).catch((e) => e);
    expect(noBoard.next).toBe("rt team peer");
    const rejected = await sendAnnouncement(probesFor("dev1", () => ({ status: 401, body: "" })), "acme", input, seams).catch((e) => e);
    expect(rejected.next).toBe("rt team peer --rotate");
  });

  test("any other failure reads as a failed send", async () => {
    const failed = { code: "announce-send-failed" };
    await expect(sendAnnouncement(probesFor("dev1", () => ({ status: 500, body: "" })), "acme", input, seams)).rejects.toMatchObject(failed);
    await expect(sendAnnouncement(probesFor("dev1", () => Promise.reject(new Error("boom"))), "acme", input, seams)).rejects.toMatchObject(failed);
    await expect(sendAnnouncement(probesFor("dev1", () => ({ status: 200, body: "not json" })), "acme", input, seams)).rejects.toMatchObject(failed);
    await expect(sendAnnouncement(probesFor("dev1", () => ({ status: 200, body: JSON.stringify({ ok: true }) })), "acme", input, seams)).rejects.toMatchObject(failed);
  });
});
