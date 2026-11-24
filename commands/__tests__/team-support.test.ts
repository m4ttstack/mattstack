import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";
import { getSetting } from "../../lib/settings/resolve.ts";
import { setSetting } from "../../lib/settings/write.ts";
import { NoAgeKeyError } from "../../lib/secrets/store.ts";
import { NoTeamRecipientsError } from "../../lib/secrets/team-store.ts";
import { createRealProbes } from "../../lib/setup/probes.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { realMembersSeams } from "../../lib/team/members.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { supportStatusBlocks, teamSupportOff, teamSupportOn, teamSupportStatus, type TeamDeps } from "../team.ts";

let fixtureHome: string;
let priorHome: string | undefined;

beforeEach(() => {
  priorHome = process.env.HOME;
  closeStateDb();
  fixtureHome = realpathSync(mkdtempSync(`${tmpdir()}/rt-team-support-`));
  process.env.HOME = fixtureHome;
});
afterEach(() => {
  closeStateDb();
  process.env.HOME = priorHome;
  rmSync(fixtureHome, { recursive: true, force: true });
});

const ROSTER = [{ username: "Alex", name: "Alex Doe" }, { username: "ada" }, { username: "dev1" }];

function seed(settings: Record<string, unknown> = {}, username = "dev1") {
  seedOrg({ org: "acme", username, roster: ROSTER, roles: { admins: ["dev1"], teams: {} }, settings });
}

function deps(opts: { ensure?: () => Promise<void>; keys?: () => Promise<unknown> } = {}) {
  const lines: string[] = [];
  const calls: string[] = [];
  const real = realMembersSeams();
  const d: TeamDeps = {
    probes: createRealProbes(),
    print: (s) => lines.push(s),
    exit: () => {
      throw new Error("exit sentinel");
    },
    membersSeams: {
      ...real,
      writeSetting: ((key: string, value: unknown, scope: "org") => {
        calls.push(`${key}=${JSON.stringify(value)} ${scope}`);
        setSetting(key, value, scope);
      }) as typeof setSetting,
    },
    supportKeys: {
      ensure: async () => {
        calls.push("key");
        await opts.ensure?.();
      },
      read: (async () => (opts.keys ? opts.keys() : null)) as NonNullable<TeamDeps["supportKeys"]>["read"],
    },
  };
  return { d, lines, calls };
}

async function exitCode(fn: () => Promise<unknown>): Promise<number> {
  const real = process.exit;
  let code = 0;
  process.exit = ((c: number) => {
    code = c;
    throw new Error("exit sentinel");
  }) as typeof process.exit;
  try {
    await fn().catch((e: Error) => {
      if (e.message !== "exit sentinel") throw e;
    });
  } finally {
    process.exit = real;
  }
  return code;
}

const org = () => ({ enabled: getSetting("support.enabled").value, host: getSetting("support.host").value });

describe("rt team support", () => {
  test("support on writes the key before the settings", async () => {
    seed();
    const { d, lines, calls } = deps();
    await teamSupportOn(["--host", "alex", "--json"], {}, d);
    expect(calls).toEqual(["key", 'support.host="Alex" org', "support.enabled=true org"]);
    expect(org()).toEqual({ enabled: true, host: "Alex" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ slug: "acme", enabled: true, host: "Alex" });
  });

  test("support on refuses a name that is not on the roster", async () => {
    seed();
    const { d, lines, calls } = deps();
    expect(await exitCode(() => teamSupportOn(["--host", "bo", "--json"], {}, d))).toBe(2);
    expect(JSON.parse(lines[0]!).error.code).toBe("not-a-member");
    expect(calls).toEqual([]);
  });

  test("support on with no host keeps the one already set, and asks for one when there is none", async () => {
    seed({ "support.host": "alex" });
    const first = deps();
    await teamSupportOn(["--json"], {}, first.d);
    expect(org()).toEqual({ enabled: true, host: "Alex" });
    seed();
    const second = deps();
    expect(await exitCode(() => teamSupportOn(["--json"], {}, second.d))).toBe(2);
    expect(JSON.parse(second.lines[0]!).error.code).toBe("usage");
    expect(second.calls).toEqual([]);
  });

  test("a host given with an equals sign counts, and one left blank asks", async () => {
    seed({ "support.host": "ada" });
    const { d } = deps();
    await teamSupportOn(["--host=alex", "--json"], {}, d);
    expect(org()).toEqual({ enabled: true, host: "Alex" });
    for (const args of [["--host", "--json"], ["--host=", "--json"], ["--json", "--host"]]) {
      seed({ "support.host": "ada" });
      const blank = deps();
      expect(await exitCode(() => teamSupportOn(args, {}, blank.d))).toBe(2);
      expect(JSON.parse(blank.lines[0]!).error.code).toBe("usage");
      expect(blank.calls).toEqual([]);
    }
  });

  test("a member is refused with the org's admins named", async () => {
    for (const verb of [teamSupportOn, teamSupportOff]) {
      seed({ "support.enabled": true }, "ada");
      const { d, calls } = deps();
      const io = captureOut();
      try {
        expect(await exitCode(() => verb(["--host", "alex"], {}, d))).toBe(2);
        expect(io.stderr()).toContain("dev1 (an org admin)");
      } finally {
        io.restore();
      }
      expect(calls).toEqual([]);
    }
  });

  test("a key that cannot be made leaves the settings alone", async () => {
    for (const [err, code] of [
      [new NoTeamRecipientsError("acme"), "no-recipients"],
      [new NoAgeKeyError(), "no-age-key"],
    ] as const) {
      seed();
      const { d, lines } = deps({
        ensure: async () => {
          throw err;
        },
      });
      expect(await exitCode(() => teamSupportOn(["--host", "alex", "--json"], {}, d))).toBe(2);
      expect(JSON.parse(lines[0]!).error.code).toBe(code);
      expect(org()).toEqual({ enabled: false, host: undefined });
    }
  });

  test("support off leaves the key and host in place", async () => {
    seed({ "support.enabled": true, "support.host": "Alex" });
    const { d, lines, calls } = deps();
    await teamSupportOff(["--json"], {}, d);
    expect(calls).toEqual(["support.enabled=false org"]);
    expect(org()).toEqual({ enabled: false, host: "Alex" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ enabled: false, host: "Alex" });
  });

  test("status reads and writes nothing, for a member too", async () => {
    seed({ "support.enabled": true, "support.host": "bo" }, "ada");
    const { d, lines, calls } = deps({ keys: async () => ({ current: "k", retired: [] }) });
    await teamSupportStatus(["--json"], {}, d);
    expect(JSON.parse(lines[0]!)).toMatchObject({ slug: "acme", enabled: true, host: "bo", hostOnRoster: false, key: "ready" });
    expect(calls).toEqual([]);
  });

  test("status says when this Mac cannot open the key", async () => {
    seed({ "support.enabled": true, "support.host": "Alex" });
    const { d, lines } = deps({
      keys: async () => {
        throw new Error("sops: no key");
      },
    });
    await teamSupportStatus(["--json"], {}, d);
    expect(JSON.parse(lines[0]!).key).toBe("unreadable");
    expect(lines[0]).not.toContain("sops");
  });

  test("status reads in plain words", () => {
    expect(renderPlain(supportStatusBlocks({ slug: "acme", enabled: true, host: "Alex", hostOnRoster: true, key: "ready" }))).toContain("Alex answers support requests for acme");
    expect(renderPlain(supportStatusBlocks({ slug: "acme", enabled: false, host: null, hostOnRoster: false, key: "missing" }))).toContain("Support requests are off for acme");
    expect(renderPlain(supportStatusBlocks({ slug: "acme", enabled: true, host: "bo", hostOnRoster: false, key: "ready" }))).toContain("bo is not in this org");
    expect(renderPlain(supportStatusBlocks({ slug: "acme", enabled: true, host: "Alex", hostOnRoster: true, key: "missing" }))).toContain("rt team support on --host Alex");
  });
});
