import { describe, expect, test } from "bun:test";
import { teamLocalPath } from "../../team/team-local.ts";
import { SUPPORT_HOST_ROW_ID, supportHostRow } from "../validators/support-host.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/home/x";

function probes(opts: { settings?: Record<string, unknown>; me?: string; daemon?: unknown } = {}) {
  const asked: string[] = [];
  const p = fakeProbes({
    home: HOME,
    files: {
      [`${HOME}/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc`]: JSON.stringify(opts.settings ?? { "support.enabled": true, "support.host": "Alex" }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.me ?? "alex" }),
    },
  });
  p.daemon = (async (cmd: string) => {
    asked.push(cmd);
    return opts.daemon === undefined ? { ok: true, data: { isHost: true, accepting: true, missing: [] } } : opts.daemon;
  }) as typeof p.daemon;
  return { p, asked };
}

const host = (accepting: boolean, missing: string[] = []) => ({ ok: true, data: { isHost: true, accepting, missing } });

describe("org.support-host", () => {
  test("it shows on the host's Mac only, and asks the daemon nowhere else", async () => {
    for (const opts of [{ me: "ada" }, { me: "" }, { settings: {} }, { settings: { "support.enabled": true } }, { settings: { "support.host": 4 } }]) {
      const { p, asked } = probes(opts);
      expect(await supportHostRow(p, "acme")).toBeNull();
      expect(asked).toEqual([]);
    }
  });

  test("ready while accepting with nothing missing", async () => {
    const { p } = probes();
    expect(await supportHostRow(p, "acme")).toMatchObject({ id: SUPPORT_HOST_ROW_ID, status: "ready", required: false, detail: "Answering support requests" });
  });

  test("needs-you while accepting with something missing, naming the first", async () => {
    const { p } = probes({ daemon: host(true, ["Set your chat name", "Slack did not answer"]) });
    expect(await supportHostRow(p, "acme")).toMatchObject({ status: "needs-you", detail: "Set your chat name" });
  });

  test("skipped while not accepting, whatever is missing", async () => {
    const { p } = probes({ daemon: host(false, ["Set your chat name"]) });
    expect(await supportHostRow(p, "acme")).toMatchObject({ status: "skipped", detail: "Off" });
  });

  test("skipped when the daemon cannot say, whether down, old or not the host", async () => {
    for (const daemon of [null, { ok: false, error: "unknown command" }, { ok: true, data: { isHost: false, accepting: false, missing: [] } }, { ok: true }]) {
      const { p } = probes({ daemon });
      expect(await supportHostRow(p, "acme")).toMatchObject({ status: "skipped", detail: "Could not check" });
    }
    const { p } = probes();
    p.daemon = (async () => {
      throw new Error("socket closed");
    }) as typeof p.daemon;
    expect(await supportHostRow(p, "acme")).toMatchObject({ status: "skipped", detail: "Could not check" });
  });

  test("an org store that cannot be read shows no row", async () => {
    const { p } = probes();
    p.readFile = () => "{ not json";
    expect(await supportHostRow(p, "acme")).toBeNull();
  });
});
