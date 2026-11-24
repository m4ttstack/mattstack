import { describe, expect, test } from "bun:test";
import { teamLocalPath } from "../../team/team-local.ts";
import { SUPPORT_KEY_ROW_ID, supportKeyRow } from "../validators/support-key.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/home/x";
const ORG_DIR = `${HOME}/.mattstack/orgs/acme/mattstack/org`;
const ON = { "support.enabled": true, "support.host": "Alex" };

function probes(opts: { settings?: Record<string, unknown>; me?: string; key?: boolean } = {}) {
  return fakeProbes({
    home: HOME,
    files: {
      [`${ORG_DIR}/settings.org.jsonc`]: JSON.stringify({
        "mattstack.org": { admins: ["dev1"] },
        "mattstack.roster": [{ username: "alex" }, { username: "dev1" }],
        ...(opts.settings ?? ON),
      }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.me ?? "dev1" }),
      ...(opts.key ? { [`${ORG_DIR}/secrets/support.json`]: "{}" } : {}),
    },
  });
}

describe("org.support-key", () => {
  test("an admin whose org has support on and no key gets a Fix that makes it", () => {
    expect(supportKeyRow(probes(), "acme")).toMatchObject({
      id: SUPPORT_KEY_ROW_ID,
      status: "needs-you",
      required: false,
      detail: "Your org has support on but no key",
      action: { type: "run", label: "Fix", verb: ["team", "support", "on", "--team", "acme"] },
    });
  });

  test("with no host saved, or one off the roster, it shows the steps instead", () => {
    for (const settings of [{ "support.enabled": true }, { "support.enabled": true, "support.host": "bo" }, { "support.enabled": true, "support.host": 4 }]) {
      expect(supportKeyRow(probes({ settings }), "acme")).toMatchObject({
        status: "needs-you",
        action: { type: "steps", steps: ["Run rt team support on --host <username>", "Re-check this row"] },
      });
    }
  });

  test("no row with a key, with support off, or on a Mac that is not an admin's", () => {
    for (const opts of [{ key: true }, { settings: { "support.enabled": false } }, { settings: {} }, { me: "alex" }, { me: "" }]) {
      expect(supportKeyRow(probes(opts), "acme")).toBeNull();
    }
  });

  test("an org store that cannot be read shows no row", () => {
    const p = probes();
    p.readFile = () => "{ not json";
    expect(supportKeyRow(p, "acme")).toBeNull();
  });
});
