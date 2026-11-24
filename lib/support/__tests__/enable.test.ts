import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { UserActionableError } from "../../errors.ts";
import { NoAgeKeyError } from "../../secrets/store.ts";
import { NoTeamRecipientsError } from "../../secrets/team-store.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { createRealProbes } from "../../setup/probes.ts";
import { closeStateDb } from "../../state/index.ts";
import { realMembersSeams } from "../../team/members.ts";
import { createSupportService } from "../service.ts";
import { supportHost } from "./host-harness.ts";
import { disableSupport, enableSupport, type EnableDeps } from "../enable.ts";

let home: string;
let priorHome: string | undefined;

beforeEach(() => {
  priorHome = process.env.HOME;
  closeStateDb();
  home = realpathSync(mkdtempSync(`${tmpdir()}/rt-support-enable-`));
  process.env.HOME = home;
});
afterEach(() => {
  closeStateDb();
  process.env.HOME = priorHome;
  rmSync(home, { recursive: true, force: true });
});

const seed = (settings: Record<string, unknown> = {}, username = "dev1") =>
  seedOrg({ org: "acme", username, roster: [{ username: "Alex" }, { username: "ada" }, { username: "dev1" }], roles: { admins: ["dev1"], teams: {} }, settings });

function deps(ensureKey: () => Promise<void> = async () => {}): EnableDeps {
  return { probes: createRealProbes(), seams: realMembersSeams(), ensureKey: () => ensureKey() };
}

async function refusal(run: () => unknown): Promise<UserActionableError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("nothing was refused");
}

const org = () => ({ enabled: getSetting("support.enabled").value, host: getSetting("support.host").value });

describe("enableSupport", () => {
  test("makes the key before it writes the host and turns support on", async () => {
    seed();
    let before: unknown;
    const d = deps(async () => void (before = org()));
    expect(await enableSupport(d, "acme", "team support on", "alex")).toEqual({ host: "Alex" });
    expect(before).toEqual({ enabled: false, host: undefined });
    expect(org()).toEqual({ enabled: true, host: "Alex" });
  });

  test("with no name it keeps the saved host, and refuses when none is saved", async () => {
    seed({ "support.host": "alex" });
    expect(await enableSupport(deps(), "acme", "team support on")).toEqual({ host: "Alex" });
    seed();
    expect((await refusal(() => enableSupport(deps(), "acme", "team support on"))).code).toBe("no-host");
    expect(org().enabled).toBe(false);
  });

  test("a host saved while the key is made is the one that stands, and one given by name wins", async () => {
    seed({ "support.host": "alex" });
    expect(await enableSupport(deps(async () => setSetting("support.host", "ada", "org")), "acme", "team support on")).toEqual({ host: "ada" });
    expect(org()).toEqual({ enabled: true, host: "ada" });
    expect(await enableSupport(deps(async () => setSetting("support.host", "ada", "org")), "acme", "team support on", "alex")).toEqual({ host: "Alex" });

    seed({ "support.host": "alex" });
    expect((await refusal(() => enableSupport(deps(async () => setSetting("support.host", "bo", "org")), "acme", "team support on"))).code).toBe("not-a-member");
    expect(org()).toEqual({ enabled: false, host: "bo" });
  });

  test("refuses a person off the roster, a member, and an org this Mac does not read", async () => {
    seed();
    expect((await refusal(() => enableSupport(deps(), "acme", "team support on", "bo"))).code).toBe("not-a-member");
    expect((await refusal(() => enableSupport({ ...deps(), seams: { ...realMembersSeams(), currentOrg: () => "other" } }, "acme", "team support on", "alex"))).code).toBe("org-not-current");
    seed({}, "ada");
    expect((await refusal(() => enableSupport(deps(), "acme", "team support on", "alex"))).code).toBe("team-pull-only");
    expect((await refusal(() => disableSupport(deps(), "acme", "team support off"))).code).toBe("team-pull-only");
  });

  test("a key that cannot be made names the fix and writes nothing", async () => {
    for (const [err, code] of [[new NoTeamRecipientsError("acme"), "no-recipients"], [new NoAgeKeyError(), "no-age-key"]] as const) {
      seed();
      expect((await refusal(() => enableSupport(deps(() => Promise.reject(err)), "acme", "team support on", "alex"))).code).toBe(code);
      expect(org()).toEqual({ enabled: false, host: undefined });
    }
  });

  test("disabling leaves the host saved", () => {
    seed({ "support.enabled": true, "support.host": "Alex" });
    expect(disableSupport(deps(), "acme", "team support off")).toEqual({ host: "Alex" });
    expect(org()).toEqual({ enabled: false, host: "Alex" });
  });
});

describe("the daemon's support:enable", () => {
  function handlers(keyed: string[]) {
    const h = supportHost();
    return createSupportService({
      db: h.db, log: h.deps.log, slackOpen: h.deps, slackClient: async () => null, stop: {} as never,
      emitEvent: () => {}, gate: () => null, notify: () => {},
      seams: { enable: { ensureKey: async (slug) => void keyed.push(slug) } },
    }).handlers;
  }

  test("an admin's daemon makes the key and writes the same settings rt team support does", async () => {
    seed({ "support.host": "alex" });
    const keyed: string[] = [];
    const h = handlers(keyed);
    expect(await h["support:enable"]({ on: true })).toEqual({ ok: true, data: { enabled: true, host: "Alex" } });
    expect(keyed).toEqual(["acme"]);
    expect(org()).toEqual({ enabled: true, host: "Alex" });
    expect(await h["support:enable"]({ on: false })).toEqual({ ok: true, data: { enabled: false, host: "Alex" } });
    expect(org()).toEqual({ enabled: false, host: "Alex" });
  });

  test("a member's daemon refuses and makes no key, and so does a Mac in no org", async () => {
    seed({ "support.host": "alex" }, "ada");
    const keyed: string[] = [];
    expect(await handlers(keyed)["support:enable"]({ on: true })).toMatchObject({
      failure: { code: "support-team-pull-only", message: "The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change." },
    });
    rmSync(`${home}/.mattstack`, { recursive: true, force: true });
    expect(await handlers(keyed)["support:enable"]({ on: true })).toMatchObject({ failure: { code: "support-no-org" } });
    expect(keyed).toEqual([]);
  });
});
