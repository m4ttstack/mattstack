import { describe, expect, test } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import { adminSecretsRow, adminSecretsRowSafe, ADMIN_SECRETS_ROW_ID } from "../validators/admin-secrets.ts";
import type { SecretPresence } from "../validators/accounts.ts";

const HOME = "/home/x";
const ORG = `${HOME}/.mattstack/orgs/acme`;
const ROSTER = [
  { username: "dev1", agePublicKey: "age1dev1", teams: [] },
  { username: "dev2", agePublicKey: "age1dev2", teams: ["widgets"] },
];

function machine(opts: { me?: string; admins?: string[]; locked?: string[] | null; env?: Record<string, string> } = {}) {
  const locked = opts.locked === undefined ? ["age1dev1"] : opts.locked;
  const sops = [
    "creation_rules:",
    "  - path_regex: mattstack/org/secrets/.*",
    "    age: age1dev1,age1dev2",
    ...(locked ? ["  - path_regex: mattstack/org/admin-secrets/.*", `    age: ${locked.join(",")}`] : []),
    "",
  ].join("\n");
  return fakeProbes({
    home: HOME,
    env: opts.env ?? {},
    files: {
      [`${ORG}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: [], admins: opts.admins ?? ["dev1"], teams: {} }, "mattstack.roster": ROSTER }),
      [`${ORG}/.sops.yaml`]: sops,
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.me ?? "dev1" }),
    },
  });
}

const holding = (token: string | null): SecretPresence => ({ has: async (domain, key) => (domain === "rt" && key === "switchboardAdminToken" ? token : null) });

describe("the org.admin-secrets row", () => {
  test("no row while the file is locked to exactly the owners and admins", async () => {
    expect(await adminSecretsRow(machine(), "acme", holding(null))).toBeNull();
  });

  test("a promotion the file has not caught up with asks for the sync", async () => {
    const r = await adminSecretsRow(machine({ admins: ["dev1", "dev2"] }), "acme", holding(null));
    expect(r).toMatchObject({ id: ADMIN_SECRETS_ROW_ID, status: "needs-you", required: false });
    expect(r!.detail).toBe("The org's owners and admins changed since its admin-only secrets were last locked to them");
    expect(r!.action).toEqual({ type: "steps", label: "Show steps…", steps: ["Run rt team admin-secrets", "Re-check this row"] });
  });

  test("so does a demotion", async () => {
    expect((await adminSecretsRow(machine({ locked: ["age1dev1", "age1dev2"] }), "acme", holding(null)))?.status).toBe("needs-you");
  });

  test("a member's Mac never shows it", async () => {
    expect(await adminSecretsRow(machine({ me: "dev2", admins: ["dev1"], locked: ["age1dev1", "age1dev2"] }), "acme", holding("admin-1"))).toBeNull();
  });

  test("before the token is shared, an admin holding it is asked to share it", async () => {
    const r = await adminSecretsRow(machine({ locked: null }), "acme", holding("admin-1"));
    expect(r?.status).toBe("needs-you");
    expect(r!.detail).toBe("This Mac holds the switchboard admin token, but the org's other owners and admins cannot use it yet");
  });

  test("the environment's token counts too", async () => {
    expect((await adminSecretsRow(machine({ locked: null, env: { SWITCHBOARD_ADMIN_TOKEN: "admin-1" } }), "acme", holding(null)))?.status).toBe("needs-you");
  });

  test("before the token is shared, an admin without it sees nothing", async () => {
    expect(await adminSecretsRow(machine({ locked: null }), "acme", holding(null))).toBeNull();
  });

  test("a check that throws fails only this row", async () => {
    const failing: SecretPresence = { has: async () => { throw new Error("keychain locked"); } };
    expect((await adminSecretsRowSafe(machine({ locked: null }), "acme", failing))?.status).toBe("error");
  });
});
