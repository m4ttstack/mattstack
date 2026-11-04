import { beforeEach, describe, expect, test } from "bun:test";
import { switchboardUrl } from "../../../packages/rt-client/src/switchboard.ts";
import { fakeProbes, type FakeProbesOpts } from "../../setup/__tests__/fakes.ts";
import type { Probes } from "../../setup/probes.ts";
import { sendAnnouncement, type AnnounceSeams } from "../announce.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/home/x";
const SWITCHBOARD_URL = switchboardUrl();
const input = { title: "Update rt", message: "Today" };

function orgFiles(username: string): Record<string, string> {
  return {
    [`${HOME}/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: ["dev1"], admins: [], teams: {} } }),
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
const seams: AnnounceSeams = { readLocalSecret: async (key) => (key === "switchboardToken" ? "board-token" : null) };
const noToken: AnnounceSeams = { readLocalSecret: async () => null };

beforeEach(() => {
  calls = [];
});

describe("sendAnnouncement", () => {
  test("an owner posts an announcement to every board", async () => {
    const r = await sendAnnouncement(probesFor("dev1", ok), "acme", input, seams);
    expect(r).toEqual({ delivered: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SWITCHBOARD_URL}/envelopes`);
    expect(calls[0]!.headers.Authorization).toBe("Bearer board-token");
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ to: "*", type: "announcement", payload: { title: "Update rt", message: "Today" } });
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

  test("any other failure reads as a failed send", async () => {
    const failed = { code: "announce-send-failed" };
    await expect(sendAnnouncement(probesFor("dev1", () => ({ status: 500, body: "" })), "acme", input, seams)).rejects.toMatchObject(failed);
    await expect(sendAnnouncement(probesFor("dev1", () => Promise.reject(new Error("boom"))), "acme", input, seams)).rejects.toMatchObject(failed);
    await expect(sendAnnouncement(probesFor("dev1", () => ({ status: 200, body: "not json" })), "acme", input, seams)).rejects.toMatchObject(failed);
    await expect(sendAnnouncement(probesFor("dev1", () => ({ status: 200, body: JSON.stringify({ ok: true }) })), "acme", input, seams)).rejects.toMatchObject(failed);
  });
});
