import { describe, expect, test } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import { adminSecretsRow, adminSecretsRowSafe, ADMIN_SECRETS_ROW_ID } from "../validators/admin-secrets.ts";
import type { SecretPresence } from "../validators/accounts.ts";
import { orgToken } from "../../team/__tests__/org-token-fixtures.ts";

const HOME = "/home/x";
const ORG = `${HOME}/.mattstack/orgs/acme`;
const TOKEN = orgToken("a");
const OTHER = orgToken("b");
const MASTER = "the-relay-operators-own-token";
const BOARD_ENV = `${HOME}/.mattstack/board/.env`;
const ROSTER = [
  { username: "dev1", agePublicKey: "age1dev1", teams: [] },
  { username: "dev2", agePublicKey: "age1dev2", teams: ["widgets"] },
];

/** A Mac with one org clone unless `orgs` says otherwise. */
function machine(opts: { me?: string; admins?: string[]; locked?: string[] | null; env?: Record<string, string>; orgs?: string[]; extra?: Record<string, string> } = {}) {
  const orgs = opts.orgs ?? ["acme"];
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
    dirs: { [`${HOME}/.mattstack/orgs`]: orgs },
    files: {
      ...Object.fromEntries(orgs.filter((o) => o !== "acme").map((o) => [`${HOME}/.mattstack/orgs/${o}/mattstack/org/settings.org.jsonc`, "{}"])),
      [`${ORG}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: [], admins: opts.admins ?? ["dev1"], teams: {} }, "mattstack.roster": ROSTER }),
      [`${ORG}/.sops.yaml`]: sops,
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.me ?? "dev1" }),
      ...opts.extra,
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
    expect(await adminSecretsRow(machine({ me: "dev2", admins: ["dev1"], locked: ["age1dev1", "age1dev2"] }), "acme", holding(TOKEN))).toBeNull();
  });

  test("before the token is shared, an admin holding it is asked to share it", async () => {
    const r = await adminSecretsRow(machine({ locked: null }), "acme", holding(TOKEN));
    expect(r?.status).toBe("needs-you");
    expect(r!.detail).toBe("This Mac holds the org's switchboard token, but the org's other owners and admins cannot use it yet");
  });

  test("the environment's token counts too", async () => {
    expect((await adminSecretsRow(machine({ locked: null, env: { SWITCHBOARD_ADMIN_TOKEN: TOKEN } }), "acme", holding(null)))?.status).toBe("needs-you");
  });

  test("before the token is shared, an admin without it sees nothing", async () => {
    expect(await adminSecretsRow(machine({ locked: null }), "acme", holding(null))).toBeNull();
  });

  const withFile = (token: string | null, mine: string | null): SecretPresence => ({ ...holding(mine), hasAdmin: async () => token });

  test("a current rule with no token in the file asks an admin holding one to share it", async () => {
    const r = await adminSecretsRow(machine(), "acme", withFile(null, TOKEN));
    expect(r?.status).toBe("needs-you");
    expect(r!.detail).toBe("This Mac holds the org's switchboard token, but the org's other owners and admins cannot use it yet");
  });

  test("a current rule whose file holds a different token names both remedies", async () => {
    const r = await adminSecretsRow(machine(), "acme", withFile(OTHER, TOKEN));
    expect(r?.status).toBe("needs-you");
    expect(r!.detail).toBe("The org shares a different switchboard token from this Mac's");
    const steps = (r!.action as { steps: string[] }).steps;
    expect(steps.some((s) => s.endsWith("rt team admin-secrets --replace-token"))).toBe(true);
    expect(steps.at(-1)).toBe("Re-check this row");
  });

  test("the environment's token is the one compared, and the remedy names it", async () => {
    const r = await adminSecretsRow(machine({ env: { SWITCHBOARD_ADMIN_TOKEN: TOKEN } }), "acme", withFile(OTHER, null));
    expect(r?.detail).toBe("The org shares a different switchboard token from this Mac's");
    expect((r!.action as { steps: string[] }).steps[1]).toBe("If the org's token is the right one, remove SWITCHBOARD_ADMIN_TOKEN from the environment rt runs in so the org's is used");
  });

  test("a token from rt's secrets is named as that source", async () => {
    const r = await adminSecretsRow(machine(), "acme", withFile(OTHER, TOKEN));
    expect((r!.action as { steps: string[] }).steps[1]).toBe("If the org's token is the right one, remove switchboardAdminToken from rt's secrets so the org's is used");
  });

  const onMac = (key: string | null, secrets: SecretPresence): SecretPresence => ({ ...secrets, ownAgeKey: async () => key });

  test("a Mac whose age key the roster does not hold is pointed at the Mac it does, not at a verb that refuses it", async () => {
    const r = await adminSecretsRow(machine(), "acme", onMac("age1second", withFile(null, TOKEN)));
    expect(r).toMatchObject({ id: ADMIN_SECRETS_ROW_ID, status: "skipped" });
    expect(r!.detail).toContain("Check this row on the Mac whose key the roster holds");
    expect(r!.action).toBeNull();
  });

  test("so is one that would otherwise be asked to re-lock the file", async () => {
    expect((await adminSecretsRow(machine({ admins: ["dev1", "dev2"] }), "acme", onMac("age1second", holding(null))))?.status).toBe("skipped");
  });

  test("the Mac the roster holds still gets the share request", async () => {
    expect((await adminSecretsRow(machine(), "acme", onMac("age1dev1", withFile(null, TOKEN))))?.status).toBe("needs-you");
  });

  test("a key that cannot be read keeps the share request", async () => {
    const failing: SecretPresence = { ...withFile(null, TOKEN), ownAgeKey: async () => { throw new Error("keychain locked"); } };
    expect((await adminSecretsRow(machine(), "acme", failing))?.status).toBe("needs-you");
  });

  test("a healthy row stays hidden on a Mac the roster does not hold", async () => {
    expect(await adminSecretsRow(machine(), "acme", onMac("age1second", withFile(TOKEN, TOKEN)))).toBeNull();
  });

  test("a current rule whose file holds the same token reads healthy", async () => {
    expect(await adminSecretsRow(machine(), "acme", withFile(TOKEN, TOKEN))).toBeNull();
  });

  test("a current rule with a token in the file and none on this Mac reads healthy", async () => {
    expect(await adminSecretsRow(machine(), "acme", withFile(OTHER, null))).toBeNull();
    expect(await adminSecretsRow(machine(), "acme", withFile(null, null))).toBeNull();
  });

  test("a shared master reads needs-you with the operator steps", async () => {
    const r = await adminSecretsRow(machine(), "acme", withFile(MASTER, null));
    expect(r).toMatchObject({ id: ADMIN_SECRETS_ROW_ID, status: "needs-you", required: false });
    expect(r!.detail).toBe("The org shares the relay operator's token, not its own");
    expect(r!.action).toEqual({
      type: "steps",
      label: "Show steps…",
      steps: ["Ask the relay operator for your org's switchboard token", "Run rt team admin-secrets --token-stdin --replace-token and paste it", "Re-check this row"],
    });
  });

  test("a master in env, board .env or the local secret reads needs-you naming each place", async () => {
    const all = await adminSecretsRow(machine({ env: { SWITCHBOARD_ADMIN_TOKEN: MASTER }, extra: { [BOARD_ENV]: `SWITCHBOARD_ADMIN_TOKEN=${MASTER}\n` } }), "acme", withFile(TOKEN, MASTER));
    expect(all?.status).toBe("needs-you");
    expect(all!.detail).toBe("This Mac keeps the relay operator's switchboard token in the environment rt runs in, the board's .env and rt's secrets");
    expect((all!.action as { steps: string[] }).steps).toEqual([
      "Remove it from the environment rt runs in; the relay operator keeps it outside rt",
      "Remove it from the board's .env; the relay operator keeps it outside rt",
      "Remove it from rt's secrets by hand, as step 3 of docs/switchboard-org-tokens.md shows; the relay operator keeps it outside rt",
      "Re-check this row",
    ]);

    const one = await adminSecretsRow(machine({ extra: { [BOARD_ENV]: `SWITCHBOARD_ADMIN_TOKEN=${MASTER}\n` } }), "acme", holding(TOKEN));
    expect(one!.detail).toBe("This Mac keeps the relay operator's switchboard token in the board's .env");
    expect((one!.action as { steps: string[] }).steps).toEqual(["Remove it from the board's .env; the relay operator keeps it outside rt", "Re-check this row"]);
  });

  test("while the file still shares the master, this Mac's own copies are named first", async () => {
    const r = await adminSecretsRow(machine({ env: { SWITCHBOARD_ADMIN_TOKEN: MASTER }, extra: { [BOARD_ENV]: `SWITCHBOARD_ADMIN_TOKEN=${MASTER}\n` } }), "acme", withFile(MASTER, MASTER));
    expect(r).toMatchObject({ id: ADMIN_SECRETS_ROW_ID, status: "needs-you", required: false });
    expect(r!.detail).toBe("This Mac keeps the relay operator's switchboard token in the environment rt runs in, the board's .env and rt's secrets");
    expect((r!.action as { steps: string[] }).steps).toEqual([
      "Remove it from the environment rt runs in; the relay operator keeps it outside rt",
      "Remove it from the board's .env; the relay operator keeps it outside rt",
      "Remove it from rt's secrets by hand, as step 3 of docs/switchboard-org-tokens.md shows; the relay operator keeps it outside rt",
      "Re-check this row",
    ]);

    for (const [p, secrets] of [
      [machine({ env: { SWITCHBOARD_ADMIN_TOKEN: MASTER } }), withFile(MASTER, null)],
      [machine({ extra: { [BOARD_ENV]: `SWITCHBOARD_ADMIN_TOKEN=${MASTER}\n` } }), withFile(MASTER, null)],
      [machine(), withFile(MASTER, MASTER)],
    ] as const) {
      expect((await adminSecretsRow(p, "acme", secrets))!.detail).toStartWith("This Mac keeps the relay operator's switchboard token in ");
    }

    const cleared = await adminSecretsRow(machine(), "acme", withFile(MASTER, null));
    expect(cleared!.detail).toBe("The org shares the relay operator's token, not its own");
  });

  test('a master on this Mac never produces "cannot use it yet"', async () => {
    for (const [p, secrets] of [
      [machine({ locked: null }), holding(MASTER)],
      [machine({ locked: null, env: { SWITCHBOARD_ADMIN_TOKEN: MASTER } }), holding(null)],
      [machine(), withFile(null, MASTER)],
    ] as const) {
      const r = await adminSecretsRow(p, "acme", secrets);
      expect(r?.status).toBe("needs-you");
      expect(r!.detail).not.toContain("cannot use it yet");
      expect(r!.detail).toStartWith("This Mac keeps the relay operator's switchboard token in ");
    }
  });

  test("an org token not yet shared still asks to share it", async () => {
    for (const r of [await adminSecretsRow(machine({ locked: null }), "acme", holding(TOKEN)), await adminSecretsRow(machine(), "acme", withFile(null, TOKEN))]) {
      expect(r?.status).toBe("needs-you");
      expect(r!.detail).toBe("This Mac holds the org's switchboard token, but the org's other owners and admins cannot use it yet");
      expect(r!.action).toEqual({ type: "steps", label: "Show steps…", steps: ["Run rt team admin-secrets", "Re-check this row"] });
    }
  });

  test("on a two-org Mac no share verdict fires", async () => {
    const orgs = ["acme", "beta"];
    expect(await adminSecretsRow(machine({ locked: null, orgs }), "acme", holding(TOKEN))).toBeNull();
    expect(await adminSecretsRow(machine({ orgs }), "acme", withFile(null, TOKEN))).toBeNull();
    expect(await adminSecretsRow(machine({ orgs, env: { SWITCHBOARD_ADMIN_TOKEN: TOKEN } }), "acme", withFile(OTHER, null))).toBeNull();
  });

  test("a Mac whose age key is not its roster key still reads skipped", async () => {
    for (const secrets of [withFile(MASTER, null), holding(MASTER), withFile(null, TOKEN)]) {
      const r = await adminSecretsRow(machine(), "acme", onMac("age1second", secrets));
      expect(r).toMatchObject({ id: ADMIN_SECRETS_ROW_ID, status: "skipped" });
      expect(r!.detail).toContain("Check this row on the Mac whose key the roster holds");
    }
  });

  test("its why names the org's token, never an admin token", async () => {
    const r = await adminSecretsRow(machine({ locked: null }), "acme", holding(TOKEN));
    expect(r!.why).toBe("Lets every org owner and admin use the org's switchboard token, and keeps it from everyone else.");
  });

  test("a check that throws fails only this row", async () => {
    const failing: SecretPresence = { has: async () => { throw new Error("keychain locked"); } };
    expect((await adminSecretsRowSafe(machine({ locked: null }), "acme", failing))?.status).toBe("error");
  });
});
