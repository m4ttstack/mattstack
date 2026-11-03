import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { setupJoinStatus, type JoinStatusDeps } from "../setup.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import type { TeamSnapshot } from "../../lib/setup/team-settings.ts";
import { orgDirUnder, orgsDirUnder } from "../../lib/rt-paths.ts";
import { teamLocalPath } from "../../lib/team/team-local.ts";
import { intentPath } from "../../lib/setup/intent.ts";
import { APPROVAL_WAIT_DETAIL } from "../../lib/team/approval.ts";
import type { OrgPull } from "../../lib/team/org-pull.ts";
import { renderSopsYamlRules } from "../../lib/home/age-key.ts";
import { ADMIN_PATH_REGEX, TEAM_PATH_REGEX } from "../../lib/secrets/team-store.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

const HOME = "/fake-home";
const SLUG = "acme";
const DIR = orgDirUnder(HOME, SLUG);
const MINE = "age1mine0000000000000000000000000000000000000000000000000000000";
const OWNER = "age1owner000000000000000000000000000000000000000000000000000000";
const JOINED_AT = "2026-10-29T09:00:00.000Z";
const SOPS = join(DIR, ".sops.yaml");

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

function teamSops(members: string[]): string {
  return renderSopsYamlRules([{ pathRegex: TEAM_PATH_REGEX, recipients: members }, { pathRegex: ADMIN_PATH_REGEX, recipients: [OWNER] }]);
}

const SNAPSHOT: TeamSnapshot = {
  slug: SLUG,
  integrations: { forge: { host: "github.com", provider: "github" }, slack: { appId: "A1" }, linear: { teamKey: "WID" } },
  trackingIdentities: ["github.com/acme/widgets", "github.com/acme/gadgets"],
  marketplaces: [],
  plugins: ["widgets@acme"],
  remote: null,
};

const PULLED: OrgPull = { outcome: "pulled", detail: "Pulled acme" };

function deps(opts: { joined?: boolean; invite?: boolean; pull?: JoinStatusDeps["pull"]; record?: Record<string, unknown> } = {}) {
  const lines: string[] = [];
  const files: Record<string, string> = {
    [join(DIR, ".git", "config")]: `[remote "origin"]\n\turl = https://github.com/acme/widgets-org.git\n`,
    [join(HOME, ".mattstack", "user", ".sops.yaml")]: `creation_rules:\n  - path_regex: secrets/.*\n    age: ${MINE}\n`,
    [SOPS]: teamSops([OWNER]),
  };
  if (opts.joined !== false) files[teamLocalPath(HOME, SLUG)] = JSON.stringify({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, joinedAt: JOINED_AT, ...opts.record });
  if (opts.invite) files[intentPath(HOME)] = JSON.stringify({ v: 1, at: JOINED_AT, mode: "join", join: { id: "a".repeat(32), keyB64: "k", pointer: {} } });
  const probes = fakeProbes({ home: HOME, files, dirs: { [orgsDirUnder(HOME)]: [SLUG] } });
  const d: JoinStatusDeps = {
    probes,
    json: (v) => lines.push(JSON.stringify(v)),
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    pull: opts.pull ?? (async () => PULLED),
    teamSnapshot: () => SNAPSHOT,
  };
  return { d, lines, probes };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ExitSentinel) return err.code;
    throw err;
  }
}

let quiet: CapturedOut;
beforeEach(() => {
  quiet = capturePlain();
});
afterEach(() => quiet.restore());

describe("rt setup join-status", () => {
  test("--json: a waiting joiner reads waiting with since and what the team uses", async () => {
    const t = deps();
    expect(await exitCode(() => setupJoinStatus(["--json"], {}, t.d))).toBeUndefined();
    expect(t.lines).toHaveLength(1);
    expect(JSON.parse(t.lines[0]!)).toEqual({
      contract: 1,
      at: "2026-01-01T00:00:00.000Z",
      team: { slug: SLUG, name: SLUG },
      invitedBy: null,
      state: "waiting",
      since: JOINED_AT,
      uses: { repos: 2, accounts: 2, packs: 1 },
      pull: PULLED,
    });
  });

  test("join-status names the team and the admin who invited", async () => {
    const t = deps({ record: { teamName: "Mithrandir", invitedBy: "Jane Doe" } });
    await setupJoinStatus(["--json"], {}, t.d);
    expect(JSON.parse(t.lines[0]!)).toMatchObject({ team: { slug: SLUG, name: "Mithrandir" }, invitedBy: "Jane Doe" });
  });

  test("a record from before this change reads the slug and no inviter", async () => {
    const t = deps();
    await setupJoinStatus(["--json"], {}, t.d);
    const body = JSON.parse(t.lines[0]!);
    expect(body.team).toEqual({ slug: SLUG, name: SLUG });
    expect(body.invitedBy).toBeNull();
  });

  test("the pull runs before the check", async () => {
    const t = deps({
      pull: async (p) => {
        p.writeFile(SOPS, teamSops([OWNER, MINE]));
        return PULLED;
      },
    });
    await setupJoinStatus(["--json"], {}, t.d);
    expect(JSON.parse(t.lines[0]!)).toMatchObject({ state: "approved", since: null });
  });

  test("a failed pull still answers the check, reporting the pull", async () => {
    const failed: OrgPull = { outcome: "failed", detail: "fatal: unable to access '<remote>'" };
    const t = deps({ pull: async () => failed });
    expect(await exitCode(() => setupJoinStatus(["--json"], {}, t.d))).toBeUndefined();
    expect(JSON.parse(t.lines[0]!)).toMatchObject({ state: "waiting", pull: failed });
  });

  test("an unreadable .sops.yaml reports that state with since null", async () => {
    const t = deps({
      pull: async (p) => {
        p.removeFile(SOPS);
        return PULLED;
      },
    });
    await setupJoinStatus(["--json"], {}, t.d);
    expect(JSON.parse(t.lines[0]!)).toMatchObject({ state: "unreadable", since: null });
  });

  test("human output: an unreadable .sops.yaml names the file and why", async () => {
    const human = deps({
      pull: async (p) => {
        p.removeFile(SOPS);
        return PULLED;
      },
    });
    await setupJoinStatus([], {}, human.d);
    expect(quiet.stdout().trim().split("\n").at(-1)).toContain(`${SOPS} is missing`);
  });

  test("no joined team on this Mac: refused with a usage error", async () => {
    const t = deps({ joined: false });
    expect(await exitCode(() => setupJoinStatus(["--json"], {}, t.d))).toBe(2);
    expect(JSON.parse(t.lines[0]!).error).toMatchObject({ code: "no-join", message: "This Mac has not joined a team" });
    const human = deps({ joined: false });
    expect(await exitCode(() => setupJoinStatus([], {}, human.d))).toBe(2);
    expect(quiet.stderr()).toStartWith("This Mac has not joined a team");
  });

  test.each([
    ["an invite chosen but never used", false],
    ["a join that stopped partway", true],
  ])("%s: refused as not joined yet, so the app reopens on the Join page", async (_label, joined) => {
    let pulled = false;
    const t = deps({
      joined,
      invite: true,
      pull: async () => {
        pulled = true;
        return PULLED;
      },
    });
    expect(await exitCode(() => setupJoinStatus(["--json"], {}, t.d))).toBe(2);
    expect(JSON.parse(t.lines[0]!).error).toMatchObject({ code: "join-unredeemed", message: "This Mac has an invite it has not joined with yet" });
    expect(pulled).toBe(false);
  });

  test("no joined team: nothing is pulled", async () => {
    let pulled = false;
    const t = deps({
      joined: false,
      pull: async () => {
        pulled = true;
        return PULLED;
      },
    });
    await exitCode(() => setupJoinStatus(["--json"], {}, t.d));
    expect(pulled).toBe(false);
  });

  test("human output: waiting prints the wait sentence", async () => {
    await setupJoinStatus([], {}, deps().d);
    expect(quiet.stdout()).toContain(APPROVAL_WAIT_DETAIL);
    expect(quiet.stdout().trim().split("\n")).toHaveLength(1);
  });

  test("human output: approved names the team", async () => {
    const t = deps({
      pull: async (p) => {
        p.writeFile(SOPS, teamSops([OWNER, MINE]));
        return PULLED;
      },
    });
    await setupJoinStatus([], {}, t.d);
    expect(quiet.stdout()).toContain("You're in the acme team");
  });
});
