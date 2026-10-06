import * as teamActions from "../team.ts";
import type { MembersSeams } from "../../lib/team/members.ts";
import type { InviteResult, MintInviteOpts } from "../../lib/team/invite.ts";
import { afterEach, beforeEach, describe, test, expect, spyOn } from "bun:test";
import { execFileSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { childEnv } from "../../lib/subprocess.ts";
import { tmpdir } from "os";
import { join } from "path";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../lib/ui/warn.ts";
import { realTeamDeps, teamAdd, teamCreate, teamInvite, teamManageMembership, teamPeer, teamPublish, teamPull, teamStatus, type TeamDeps } from "../team.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import type { AgeExecResult, AgeKeySeam } from "../../lib/home/age-key.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import type { Probes } from "../../lib/setup/probes.ts";
import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";
import { joinLink, joinLinkBase, pasteBlock } from "../../lib/team/invite.ts";
import { readTeamLocal, writeTeamLocal, teamLocalPath, updateTeamLocal, type TeamLocalRecord } from "../../lib/team/team-local.ts";
import { cleanupOrgWorlds, orgWorld } from "../../lib/team/__tests__/org-world.ts";

const FAKE_PUBLIC_KEY = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const FAKE_PRIVATE_KEY = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";
const ZONE_DIR = "/home/x/.mattstack/teams/acme";
const adminFiles = {
  [`${ZONE_DIR}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} } }),
  [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: "dev1" }),
};

class FakeAgeKeySeam implements AgeKeySeam {
  async run(cmd: string[]): Promise<AgeExecResult> {
    if (cmd[1] === "find-generic-password") return { code: 0, stdout: `${FAKE_PRIVATE_KEY}\n`, stderr: "" };
    if (cmd[0] === "age-keygen" && cmd[1] === "-y") return { code: 0, stdout: `${FAKE_PUBLIC_KEY}\n`, stderr: "" };
    throw new Error(`FakeAgeKeySeam: unexpected call ${cmd.join(" ")}`);
  }
}

function baseDeps(overrides: Partial<TeamDeps> = {}): TeamDeps & { lines: string[]; exitCodes: number[] } {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  return {
    probes: fakeProbes({ home: "/home/x", files: adminFiles }),
    print: (s: string) => lines.push(s),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    ageKeySeam: new FakeAgeKeySeam(),
    readLocalSecret: async () => null,
    lines,
    exitCodes,
    ...overrides,
  };
}

/** `publishTeam` prechecks the zone exists — every teamPublish test that means to reach the git steps needs it seeded. */
function depsWithZone(overrides: Partial<TeamDeps> = {}) {
  return baseDeps({ probes: fakeProbes({ home: "/home/x", files: adminFiles, dirs: { [ZONE_DIR]: [] }, exec: (argv) => ({ code: 0, stdout: argv.includes("get-url") ? "https://github.com/acme/repo.git\n" : "", stderr: "" }) }), ...overrides });
}

/** Every exit path (usage refusals included, now that they route through `exitUserError`) calls the real `process.exit(2)`, never `deps.exit` — `deps.exit` stays only as a defensive sentinel that would fail a test loudly if some future path called it unexpectedly. */
async function runExpectingProcessExit(fn: () => Promise<void>): Promise<number | undefined> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return undefined;
  } catch {
    return exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    exitSpy.mockRestore();
  }
}

describe("teamCreate", () => {
  test("--first-team names the team without becoming a name positional", async () => {
    const deps = baseDeps();
    await teamCreate(["--first-team", "widgets", "Acme", "--remote", "https://github.com/acme/repo.git", "--json"], {}, deps);
    expect(JSON.parse(deps.lines[0]!)).toMatchObject({ slug: "acme", name: "Acme", team: "widgets" });
  });

  test("a rerun naming another first team is a refusal that points at adding the team", async () => {
    const deps = baseDeps();
    await teamCreate(["--first-team", "widgets", "Acme", "--remote", "https://github.com/acme/repo.git", "--json"], {}, deps);
    const captured = captureOut();
    try {
      expect(await runExpectingProcessExit(() => teamCreate(["--first-team", "gadgets", "Acme", "--remote", "https://github.com/acme/repo.git"], {}, deps))).toBe(2);
      expect(captured.stderr()).toContain("[refused] The acme org was started with widgets as its first team");
      expect(captured.stderr()).toContain("rt team add gadgets --owner <username>");
    } finally { captured.restore(); }
  });

  test("--json prints the exact contract envelope shape", async () => {
    const deps = baseDeps();
    await teamCreate(["Acme", "--remote", "https://github.com/acme/mattstack-team-acme.git", "--json"], {}, deps);

    expect(deps.lines).toHaveLength(1);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({
      contract: 1,
      slug: "acme",
      team: "acme",
      name: "Acme",
      remote: "https://github.com/acme/mattstack-team-acme.git",
      dir: ZONE_DIR,
      created: true,
    });
  });

  test("--others is recorded on the intent, not the printed envelope", async () => {
    const deps = baseDeps();
    await teamCreate(["Acme", "--remote", "https://github.com/acme/repo.git", "--others", "--json"], {}, deps);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.slug).toBe("acme");
  });

  test("missing both --remote and --create-repo exits 2 with remote-required", async () => {
    const deps = baseDeps();
    const code = await runExpectingProcessExit(() => teamCreate(["Acme", "--json"], {}, deps));

    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("remote-required");
  });

  test("a second team exits 2 with team-already-set-up in the envelope", async () => {
    const teams = "/home/x/.mattstack/teams";
    const deps = baseDeps({
      probes: fakeProbes({
        home: "/home/x",
        dirs: { [teams]: ["globex"] },
        files: { [join(teams, "globex", "mattstack", "org", "settings.org.jsonc")]: "{}" },
      }),
    });
    const code = await runExpectingProcessExit(() => teamCreate(["Acme", "--remote", "https://github.com/acme/repo.git", "--json"], {}, deps));

    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("team-already-set-up");
    expect(body.error.message).toBe("This Mac is already set up for the globex team, and mattstack supports one team per machine today");
  });

  test("missing name, --json: exits 2 with the usage envelope, not a plain-text line", async () => {
    const deps = baseDeps();
    const code = await runExpectingProcessExit(() => teamCreate(["--remote", "https://github.com/acme/repo.git", "--json"], {}, deps));

    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("usage");
    expect(body.error.message).toContain("usage:");
  });

  test("missing name, human mode: prints usage and exits 2", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamCreate(["--remote", "https://github.com/acme/repo.git"], {}, deps));
      expect(code).toBe(2);
      expect(deps.lines).toEqual([]);
      expect(io.stderr()).toBe("What should the team be called?\n  next: rt team create <name> [--first-team <name>] (--remote <url> | --create-repo <owner>) [--others] [--json]\n");
    } finally {
      io.restore();
    }
  });

  test("human output on success names the slug and remote", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamCreate(["Acme", "--remote", "https://github.com/acme/repo.git"], {}, deps);
      expect(io.stdout()).toBe("[ok] Created the acme org  https://github.com/acme/repo.git\n");
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("the default print seam writes the envelope line to stdout byte for byte", () => {
    const io = captureOut();
    try {
      realTeamDeps().print('{"contract":1}');
      expect(io.stdout()).toBe('{"contract":1}\n');
    } finally {
      io.restore();
    }
  });
});

describe("teamCreate connects the creator's board", () => {
  const register = (status: number) =>
    fakeProbes({
      home: "/home/x",
      fetch: async (url, init) =>
        init?.method === "POST" ? { status, body: JSON.stringify({ token: "board-tok" }), headers: {} } : url.endsWith("/boards") ? { status: 200, body: JSON.stringify({ boards: [] }), headers: {} } : { status: 404, body: "", headers: {} },
    });

  test("with the admin token, create registers the board and stores its token, leaving the envelope as it was", async () => {
    const written: Array<[string, string]> = [];
    const deps = baseDeps({
      probes: register(200),
      readLocalSecret: async (key) => (key === "switchboardAdminToken" ? "admin" : null),
      peerSeams: { boardUsername: async () => "matt", localStoreReady: async () => true, writeLocalSecret: async (k, v) => void written.push([k, v]) },
    });

    await teamCreate(["Acme", "--remote", "https://github.com/acme/repo.git", "--json"], {}, deps);

    expect(written).toEqual([["switchboardToken", "board-tok"]]);
    expect(Object.keys(JSON.parse(deps.lines[0]!)).sort()).toEqual(["at", "contract", "created", "dir", "name", "remote", "rolesDeferred", "slug", "team"]);
  });

  test("a switchboard that refuses is a warning, never a failed create", async () => {
    const deps = baseDeps({
      probes: register(503),
      readLocalSecret: async (key) => (key === "switchboardAdminToken" ? "admin" : null),
      peerSeams: { boardUsername: async () => "matt", localStoreReady: async () => true, writeLocalSecret: async () => {} },
    });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    warnTest.reset();
    setWarningLog(() => {});
    try {
      await teamCreate(["Acme", "--remote", "https://github.com/acme/repo.git"], {}, deps);
      expect(io.stdout()).toContain("Created the acme org");
      expect(io.stderr()).toContain("The org is ready, but rt could not connect your board");
    } finally {
      warnTest.reset();
      io.restore();
    }
  });
});

describe("teamPeer", () => {
  test("--json prints the outcome and the username the board registered as", async () => {
    const deps = depsWithZone({
      probes: fakeProbes({
        home: "/home/x",
        dirs: { [ZONE_DIR]: [] },
        fetch: async (url, init) => (init?.method === "POST" ? { status: 200, body: JSON.stringify({ token: "t" }), headers: {} } : url.endsWith("/boards") ? { status: 200, body: JSON.stringify({ boards: [] }), headers: {} } : { status: 404, body: "", headers: {} }),
      }),
      readLocalSecret: async (key) => (key === "switchboardAdminToken" ? "admin" : null),
      peerSeams: { boardUsername: async () => "Matt", localStoreReady: async () => true, writeLocalSecret: async () => {} },
    });

    await teamPeer(["--team", "acme", "--json"], {}, deps);

    const { at: _at, ...body } = JSON.parse(deps.lines[0]!);
    expect(body).toEqual({ contract: 1, outcome: "connected", username: "matt", boardEnvOverrides: false });
  });

  test("without the admin token a person reads a refusal pointing at an invite", async () => {
    const deps = depsWithZone({ peerSeams: { boardUsername: async () => "matt" } });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamPeer(["--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toContain("[refused] Only the org admin can connect a board from their own Mac");
      expect(io.stderr()).toContain("rt team join");
    } finally {
      io.restore();
    }
  });
});

describe("teamPublish", () => {
  test("--team explicit: pushes and prints a human summary", async () => {
    const deps = depsWithZone();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamPublish(["--team", "acme", "--remote", "https://github.com/acme/repo.git"], {}, deps);
      expect(io.stdout()).toBe("[ok] Pushed the acme team  https://github.com/acme/repo.git\n");
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("--team explicit, --json prints the exact contract envelope shape", async () => {
    const deps = depsWithZone();
    await teamPublish(["--team", "acme", "--remote", "https://github.com/acme/repo.git", "--json"], {}, deps);

    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({
      contract: 1,
      remote: "https://github.com/acme/repo.git",
      pushed: true,
      detail: "pushed to https://github.com/acme/repo.git",
    });
  });

  test("the push carries the forge token rt holds for the remote, through the env", async () => {
    const seen: { argv: string[]; env?: Record<string, string> }[] = [];
    const probes = fakeProbes({
      home: "/home/x",
      files: adminFiles,
      dirs: { [ZONE_DIR]: [] },
      exec: (argv, opts) => {
        seen.push({ argv, env: opts?.env });
        return { code: 0, stdout: argv.includes("get-url") ? "https://github.com/acme/repo.git\n" : "", stderr: "" };
      },
    });
    const deps = baseDeps({ probes, forgeToken: async (_p, remote) => (remote.includes("acme/repo") ? "ghp-secret" : null) });

    await teamPublish(["--team", "acme", "--remote", "https://github.com/acme/repo.git", "--json"], {}, deps);

    const push = seen.find((c) => c.argv.includes("push"))!;
    expect(push.argv).toEqual(expect.arrayContaining([expect.stringMatching(/^credential\.https:\/\/[^/]+\.helper=$/)]));
    expect(push.env?.RT_GIT_TOKEN).toBe("ghp-secret");
    expect(push.argv.join(" ")).not.toContain("ghp-secret");
  });

  test("no --team and no local team clone exits 2 with no-team", async () => {
    const priorHome = process.env.HOME;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-no-org-")));
    process.env.HOME = home;
    try {
      const deps = baseDeps();
      const code = await runExpectingProcessExit(() => teamPublish(["--remote", "https://github.com/acme/repo.git", "--json"], {}, deps));

      expect(code).toBe(2);
      const body = JSON.parse(deps.lines[0]!);
      expect(body.error.code).toBe("no-team");
    } finally {
      process.env.HOME = priorHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("--team given but no zone on disk exits 2 with no-team-zone", async () => {
    const deps = baseDeps(); // ZONE_DIR deliberately not seeded
    const code = await runExpectingProcessExit(() => teamPublish(["--team", "acme", "--remote", "https://github.com/acme/repo.git", "--json"], {}, deps));

    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("no-team-zone");
  });
});

/**
 * `teamInvite` mints through `mintInvite`'s DEFAULT seams (not injectable at
 * the command layer), which read/write real settings stores via
 * process.env.HOME — so, unlike the fakeProbes-only tests above, this needs
 * a real temp HOME seeded with a real team store, mirrored into fakeProbes
 * at the same paths for the Probes-mediated reads (git config, exec, fetch).
 */
describe("teamInvite", () => {
  const origHome = process.env.HOME;
  let home: string;
  let teamDir: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-team-invite-cmd-home-")));
    process.env.HOME = home;

    teamDir = join(home, ".mattstack", "teams", "acme");
    seedOrg({ org: "acme", username: "dev1", roles: { admins: ["dev1"], teams: {} }, settings: { "board.title": "Acme Team" }, roster: [{ username: "dev1", teams: ["widgets"] }], teams: { widgets: {} } });
    mkdirSync(join(teamDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const GIT_CONFIG = `[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n`;

  function ghExec(putResult: { code: number; stdout: string; stderr: string } = { code: 0, stdout: "", stderr: "" }): ExecScript {
    return (argv) => {
      if (argv[0] === "gh" && argv[1] === "api" && argv[2] === "user") return { code: 0, stdout: JSON.stringify({ login: "octocat" }), stderr: "" };
      if (argv[0] === "gh" && argv[2] === "-X" && argv[3] === "PUT") return putResult;
      return { code: 0, stdout: "", stderr: "" };
    };
  }

  function relayFetch(): Probes["fetch"] {
    return async (url, init) => {
      if (init?.method === "POST" && url.endsWith("/v1/invites")) {
        const body = JSON.parse(init.body ?? "{}") as { id?: string };
        return { status: 200, body: JSON.stringify({ id: body.id ?? "0".repeat(32), creatorSecret: "creator-secret-1" }), headers: {} };
      }
      return { status: 404, body: "", headers: {} };
    };
  }

  function inviteDeps(overrides: { exec?: ExecScript; record?: Partial<TeamLocalRecord>; onRelay?: () => void; adminToken?: string } = {}): TeamDeps & { lines: string[]; exitCodes: number[] } {
    const probes = fakeProbes({
      home,
      dirs: { [teamDir]: [], [join(teamDir, "mattstack", "teams")]: ["widgets"] },
      files: {
        [join(teamDir, ".git", "config")]: GIT_CONFIG,
        [join(teamDir, "mattstack", "org", "settings.org.jsonc")]: JSON.stringify({
          "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } },
          "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }],
        }),
        [join(teamDir, "mattstack", "teams", "widgets", "settings.team.jsonc")]: "{}",
        [teamLocalPath(home, "acme")]: JSON.stringify({ forgeUsername: "dev1" }),
      },
      exec: (argv) => argv.includes("get-url")
        ? { code: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }
        : (overrides.exec ?? ghExec())(argv),
      fetch: (url, init) => {
        if (url.endsWith("/boards")) return Promise.resolve({ status: 401, body: "", headers: {} });
        overrides.onRelay?.();
        return relayFetch()(url, init);
      },
    });
    if (overrides.record) {
      writeTeamLocal(probes, "acme", { createdByRt: false, joinedByRt: false, rtMayManageMembership: false, forgeUsername: "dev1", ...overrides.record });
    }
    const deps = baseDeps({ probes });
    return overrides.adminToken === undefined ? deps : { ...deps, mintInviteSeams: { readLocalSecret: async () => overrides.adminToken! } };
  }

  test("--json prints the exact contract envelope shape", async () => {
    const deps = inviteDeps();
    await teamInvite(["--handle", "zaphod", "--json"], {}, deps);

    expect(deps.lines).toHaveLength(1);
    const parsed = JSON.parse(deps.lines[0]!);
    expect(Object.keys(parsed).sort()).toEqual(["at", "code", "contract", "expiresAt", "forgeAccess", "link", "manualSteps", "pasteBlock", "peering"]);
    expect(parsed.peering).toBe("none");
    expect(typeof parsed.at).toBe("string");
    // `code` is a fresh random secret every mint — every other field is exact, and pasteBlock is exact once code is known.
    expect(typeof parsed.code).toBe("string");
    expect(parsed.contract).toBe(1);
    expect(parsed.expiresAt).toBe("2026-01-08T00:00:00.000Z");
    expect(parsed.link).toBe(joinLink(joinLinkBase({}), parsed.code));
    // "skipped" is the default shape since MAT-387: rt does not administer
    // membership on a team repo unless explicitly permitted. The value is one
    // the contract and the app already accept ("granted"|"manual"|"skipped").
    expect(parsed.forgeAccess).toBe("skipped");
    // Not-created branch: the two forge web-UI steps, plus the admin sentence.
    expect(parsed.manualSteps).toHaveLength(3);
    expect((parsed.manualSteps as string[]).at(-1)).toContain("Ask whoever runs the team repo");
    expect(parsed.pasteBlock).toBe(pasteBlock(parsed.code, { link: parsed.link, teamName: "Acme Team" }));
  });

  describe("board peering the invite could not carry is never silent", () => {
    test("--json reports peering missing with the warning, and still mints", async () => {
      const deps = inviteDeps({ adminToken: "admin-1" });
      const stderr = spyOn(console, "error").mockImplementation(() => {});
      try {
        await teamInvite(["--handle", "zaphod", "--json"], {}, deps);
      } finally {
        stderr.mockRestore();
      }

      const parsed = JSON.parse(deps.lines[0]!);
      expect(parsed.peering).toBe("missing");
      expect(parsed.peeringWarning).toContain("This invite will not connect their board");
      expect(typeof parsed.code).toBe("string");
    });

    test("--require-peering refuses with exit 2 before the relay is touched", async () => {
      let relayCalls = 0;
      const deps = inviteDeps({ adminToken: "admin-1", onRelay: () => { relayCalls++; } });

      const code = await runExpectingProcessExit(() => teamInvite(["--handle", "zaphod", "--require-peering", "--json"], {}, deps));

      expect(code).toBe(2);
      expect(JSON.parse(deps.lines[0]!).error.code).toBe("peering-not-embedded");
      expect(relayCalls).toBe(0);
      expect(deps.lines).toHaveLength(1);
    });

    test("human mode: an invite that could not connect the board is a failure, not a refusal", async () => {
      const deps = inviteDeps({ adminToken: "admin-1" });
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      try {
        const code = await runExpectingProcessExit(() => teamInvite(["--handle", "zaphod", "--require-peering"], {}, deps));
        expect(code).toBe(2);
        expect(io.errLines()[0]).toBe("rt did not make the invite, because it could not connect their board");
        expect(io.stderr()).not.toContain("[refused]");
      } finally {
        io.restore();
      }
    });
  });

  describe("who may invite, and to which team", () => {
    const MINTED = { code: "C", expiresAt: "2026-01-08T00:00:00.000Z", pasteBlock: "x", forgeAccess: "skipped", manualSteps: [], link: "l", peering: "none" } as unknown as InviteResult;

    function orgDeps(username: string, minted: MintInviteOpts[]): TeamDeps & { lines: string[]; exitCodes: number[] } {
      const probes = fakeProbes({
        home,
        dirs: { [join(teamDir, "mattstack", "teams")]: ["widgets", "gadgets"] },
        files: {
          [join(teamDir, ".git", "config")]: GIT_CONFIG,
          [join(teamDir, "mattstack", "org", "settings.org.jsonc")]: JSON.stringify({
            "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } },
            "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["widgets"] }],
          }),
          [teamLocalPath(home, "acme")]: JSON.stringify({ forgeUsername: username }),
        },
      });
      return baseDeps({ probes, mintInvite: async (_p, _relay, opts) => { minted.push(opts); return MINTED; } });
    }

    test("only an org admin invites; an owner is told who can", async () => {
      const minted: MintInviteOpts[] = [];
      const deps = orgDeps("dev2", minted);
      const code = await runExpectingProcessExit(() => teamInvite(["--handle", "dev3", "--team", "acme", "--json"], {}, deps));
      expect(code).toBe(2);
      expect(JSON.parse(deps.lines[0]!).error).toMatchObject({ code: "team-pull-only", message: "Only an org admin invites" });
      expect(minted).toEqual([]);
    });

    test("with no --teams the invite is for the inviter's own team, so the app's Invite button needs no new flag", async () => {
      const minted: MintInviteOpts[] = [];
      await teamInvite(["--handle", "dev3", "--team", "acme", "--json"], {}, orgDeps("dev1", minted));
      expect(minted[0]).toMatchObject({ slug: "acme", handle: "dev3", teams: ["widgets"] });
    });

    test("--teams names the team folders, in order", async () => {
      const minted: MintInviteOpts[] = [];
      await teamInvite(["--handle", "dev3", "--team", "acme", "--teams", "gadgets,widgets", "--json"], {}, orgDeps("dev1", minted));
      expect(minted[0]!.teams).toEqual(["gadgets", "widgets"]);
    });
  });

  test("human mode: an owner is refused before minting", async () => {
    const deps = inviteDeps({ record: { forgeUsername: "dev2" } });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamInvite(["--handle", "dev3", "--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toBe("[refused] Only an org admin invites\n  why: Ask dev1 to invite dev3.\n");
      expect(io.stdout()).toBe("");
    } finally { io.restore(); }
  });

  test("on a TTY, accepting the offer writes the permission before minting", async () => {
    const deps = inviteDeps({ record: { createdByRt: true } });
    deps.interactive = () => true;
    deps.confirm = async () => true;

    await teamInvite(["--handle", "zaphod", "--team", "acme"], {}, deps);

    expect(readTeamLocal(deps.probes, "acme").rtMayManageMembership).toBe(true);
  });

  test("--json never prompts, even on a TTY", async () => {
    const deps = inviteDeps({ record: { createdByRt: true } });
    deps.interactive = () => true;
    let asked = false;
    deps.confirm = async () => {
      asked = true;
      return true;
    };

    await teamInvite(["--handle", "zaphod", "--team", "acme", "--json"], {}, deps);

    expect(asked).toBe(false);
    expect(readTeamLocal(deps.probes, "acme").rtMayManageMembership).toBe(false);
  });

  test("missing --handle, --json: exits 2 with the usage envelope", async () => {
    const deps = baseDeps();
    const code = await runExpectingProcessExit(() => teamInvite(["--json"], {}, deps));

    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("usage");
    expect(body.error.message).toContain("usage:");
  });

  test("missing --handle, human mode: prints usage and exits 2", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamInvite([], {}, deps));
      expect(code).toBe(2);
      expect(deps.lines).toEqual([]);
      expect(io.stderr()).toBe("Who is the invite for?\n  next: rt team invite --handle <h> [--teams <team>[,<team>]] [--team <org>] [--require-peering] [--json]\n");
    } finally {
      io.restore();
    }
  });

  test("team invite prints the join link on its own line", async () => {
    const deps = inviteDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamInvite(["--handle", "bob"], {}, deps);
      expect(io.lines()[0]).toBe("invite link:");
      expect(io.lines()[1]).toMatch(/^https:\/\/mattstack\.dev\/join#/);
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("human output names who to ask, since rt does not manage membership", async () => {
    const deps = inviteDeps({ exec: ghExec({ code: 127, stdout: "", stderr: "ENOENT: gh" }) });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamInvite(["--handle", "zaphod"], {}, deps);
      const text = io.stdout();
      expect(text).toContain("mattstack://join/");
      expect(text).toContain("[needs you] zaphod cannot see the team repo yet  forge access: skipped\n");
      expect(text).toContain("Ask whoever runs the team repo");
    } finally {
      io.restore();
    }
  });
});

describe("teamManageMembership", () => {
  function manageDeps(record: TeamLocalRecord): TeamDeps & { lines: string[]; exitCodes: number[] } {
    const deps = baseDeps();
    writeTeamLocal(deps.probes, "acme", record);
    return deps;
  }

  test("bare form reports the state and whether it can be offered at all", async () => {
    const deps = manageDeps({ createdByRt: true, joinedByRt: false, rtMayManageMembership: false });
    await teamManageMembership(["--team", "acme", "--json"], {}, deps);

    const parsed = JSON.parse(deps.lines[0]!);
    expect(parsed.mayManage).toBe(false);
    expect(parsed.offerable).toBe(true);
  });

  test("on writes the permission", async () => {
    const deps = manageDeps({ createdByRt: true, joinedByRt: false, rtMayManageMembership: false });
    await teamManageMembership(["on", "--team", "acme", "--json"], {}, deps);

    expect(readTeamLocal(deps.probes, "acme").rtMayManageMembership).toBe(true);
  });

  test("on is refused where rt did not create the repo, and writes nothing", async () => {
    const deps = manageDeps({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false });
    const code = await runExpectingProcessExit(() => teamManageMembership(["on", "--team", "acme", "--json"], {}, deps));

    expect(code).toBe(2);
    expect(JSON.parse(deps.lines[0]!).error.code).toBe("not-rt-created");
    expect(readTeamLocal(deps.probes, "acme").rtMayManageMembership).toBe(false);
  });

  test("off clears it", async () => {
    const deps = manageDeps({ createdByRt: true, joinedByRt: false, rtMayManageMembership: true });
    await teamManageMembership(["off", "--team", "acme", "--json"], {}, deps);

    expect(readTeamLocal(deps.probes, "acme").rtMayManageMembership).toBe(false);
  });

  test("human mode says whether invites grant access, and how to turn it on", async () => {
    const cases: Array<[string[], Parameters<typeof manageDeps>[0], string]> = [
      [["on", "--team", "acme"], { createdByRt: true, joinedByRt: false, rtMayManageMembership: false }, "[ok] Invites to acme give read access on the forge  membership management is on\n"],
      [["--team", "acme"], { createdByRt: true, joinedByRt: false, rtMayManageMembership: false }, "[off] Invites to acme leave forge access to you  membership management is off\n  next: rt team manage-membership on\n"],
      [["--team", "acme"], { createdByRt: false, joinedByRt: false, rtMayManageMembership: false }, "[off] Invites to acme leave forge access to you  membership management is off\n  note: mattstack did not create this repo, so this cannot be turned on\n"],
    ];
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      for (const [args, local, expected] of cases) {
        io.clear();
        const deps = manageDeps(local);
        await teamManageMembership(args, {}, deps);
        expect(io.stdout()).toBe(expected);
        expect(deps.lines).toEqual([]);
      }
    } finally {
      io.restore();
    }
  });

  test("human mode: on where rt did not create the repo is a refused line, not a failure", async () => {
    const deps = manageDeps({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamManageMembership(["on", "--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe(
        "[refused] mattstack did not create the acme team's repo, so it will not manage who can see it\n  why: Whoever runs that repo gives people access.\n",
      );
      expect(deps.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("--json: the same refusal keeps today's exit-2 envelope shape", async () => {
    const deps = manageDeps({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false });
    const code = await runExpectingProcessExit(() => teamManageMembership(["on", "--team", "acme", "--json"], {}, deps));
    expect(code).toBe(2);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({ contract: 1, error: { code: "not-rt-created", message: "mattstack did not create the acme team's repo, so it will not manage who can see it" } });
  });

  test("human mode: a usage error asks for on or off", async () => {
    const deps = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamManageMembership(["sideways", "--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toBe("Choose on or off\n  next: rt team manage-membership [on|off] [--team <slug>] [--json]\n");
    } finally {
      io.restore();
    }
  });

  test("an unrecognized state token is a usage error, not silently ignored", async () => {
    const deps = manageDeps({ createdByRt: true, joinedByRt: false, rtMayManageMembership: false });
    const code = await runExpectingProcessExit(() => teamManageMembership(["sideways", "--team", "acme", "--json"], {}, deps));

    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("usage");
    expect(body.error.message).toContain("usage:");
  });
});

describe("teamPull", () => {
  test("--json prints the daemon's pull result in the contract envelope", async () => {
    const deps = depsWithZone({ daemon: async (cmd, payload) => (cmd === "team:pull" ? { ok: true, data: { outcome: "fast-forwarded", detail: null } } : { ok: false }) });
    await teamPull(["--team", "acme", "--json"], {}, deps);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(body).toEqual({ contract: 1, slug: "acme", outcome: "fast-forwarded", detail: null });
  });

  test("the pull carries a timeout that fits a real fetch and rebase, not the status default", async () => {
    let seen: number | undefined = -1;
    const deps = depsWithZone({
      daemon: async (_cmd, _payload, timeoutMs) => {
        seen = timeoutMs;
        return { ok: true, data: { outcome: "rebased", detail: null } };
      },
    });
    await teamPull(["--team", "acme", "--json"], {}, deps);
    expect(seen).toBeGreaterThanOrEqual(120_000);
  });
  test("daemon unreachable (daemonQuery returns null) exits 2 with a plain message, never a stack", async () => {
    const deps = depsWithZone({ daemon: async () => null });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamPull(["--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toContain("daemon");
      expect(io.stderr()).toContain("  next: rt daemon start\n");
    } finally {
      io.restore();
    }
  });
  test("human output says what the pull did, by outcome", async () => {
    const cases: Array<[string, string | null, string]> = [
      ["up-to-date", null, "[ok] The acme team is already up to date\n"],
      ["fast-forwarded", null, "[ok] Pulled the acme team\n"],
      ["rebased", "2 commits replayed", "[ok] Pulled the acme team  2 commits replayed\n"],
      ["conflict", "settings.team.jsonc", "[needs you] The acme team has changes that clash with yours  settings.team.jsonc\n"],
      ["skipped", "pull not enabled for this repo", "[skipped] Skipped pulling the acme team  pull not enabled for this repo\n"],
      ["diverged-oddly", null, "[warning] The acme team pull ended in a way rt does not recognize  outcome: diverged-oddly\n"],
      ["diverged-oddly", "3 files", "[warning] The acme team pull ended in a way rt does not recognize  outcome: diverged-oddly, 3 files\n"],
    ];
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      for (const [outcome, detail, expected] of cases) {
        io.clear();
        const deps = depsWithZone({ daemon: async () => ({ ok: true, data: { outcome, detail } }) });
        await teamPull(["--team", "acme"], {}, deps);
        expect(io.stdout()).toBe(expected);
        expect(deps.lines).toEqual([]);
      }
    } finally {
      io.restore();
    }
  });
  test("a daemon failure envelope surfaces its code", async () => {
    const deps = depsWithZone({ daemon: async () => ({ ok: false, error: "team \"acme\" is not cloned locally", failure: { code: "no-team", message: "team \"acme\" is not cloned locally" } }) });
    await runExpectingProcessExit(() => teamPull(["--team", "acme", "--json"], {}, deps));
    expect(JSON.parse(deps.lines[0]!).error.code).toBe("no-team");
  });
});

test("teamStatus --json carries the daemon's sync fields, null when the daemon is down", async () => {
  const deps = depsWithZone({ daemon: async () => ({ ok: true, data: [{ slug: "acme", lastPullAt: 1_700_000_000_000, lastPushAt: 0, conflicted: null }] }) });
  await teamStatus(["--team", "acme", "--json"], {}, deps);
  const body = JSON.parse(deps.lines[0]!);
  expect(body.lastPull).toBe(new Date(1_700_000_000_000).toISOString());
  expect(body.lastPushAt).toBeNull();
  expect(body.conflicted).toBeNull();
});


describe("teamAdd", () => {
  function addDeps(username = "dev1") {
    const deps = baseDeps({ probes: fakeProbes({ home: "/home/x", files: {
      ...adminFiles,
      [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: username }),
    } }) });
    const writes: [string, unknown][] = [];
    return { ...deps, writes, addTeamSeams: {
      writeOrgSetting: (key: string, value: unknown) => { writes.push([key, value]); },
      engineDescription: () => "Use when running a unit of work.",
    } };
  }

  test("actual add parses flags and prints a flat JSON result", async () => {
    const deps = addDeps();
    await teamAdd(["--owner", " dev2, dev1 ", "--team", "acme", "gadgets", "--json"], {}, deps);
    expect(deps.lines).toHaveLength(1);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({ contract: 1, org: "acme", team: "gadgets", dir: `${ZONE_DIR}/mattstack/teams/gadgets`, owners: ["dev2", "dev1"], wrote: expect.any(Array), published: { pushed: false, reason: expect.any(String), next: "rt team publish --team acme" } });
    expect(deps.probes.exists(`${body.dir}/packs/gadgets/pack/skills.jsonc`)).toBe(true);
    expect(deps.writes).toHaveLength(1);
  });

  describe("against a real org clone", () => {
    afterEach(cleanupOrgWorlds);
    const realSeams = { writeOrgSetting: () => {}, engineDescription: () => "Use when running a unit of work." };

    test("the new pack folder and its marketplace entry reach origin in one push", async () => {
      const w = orgWorld();
      const deps = baseDeps({ probes: w.p, addTeamSeams: realSeams, forgeToken: async () => null });
      await teamAdd(["gadgets", "--owner", "dev2", "--team", "acme", "--json"], {}, deps);
      expect(JSON.parse(deps.lines[0]!).published).toEqual({ pushed: true, remote: w.remote });
      expect(w.pushes).toHaveLength(1);
      const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
      expect(files).toContain(".claude-plugin/marketplace.json");
      expect(files).toContain("mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc");
      expect(JSON.parse(w.atOrigin("show", "main:.claude-plugin/marketplace.json")).plugins).toEqual([expect.objectContaining({ name: "gadgets" })]);
    });

    test("a failed push still adds the team and names the publish command", async () => {
      const w = orgWorld();
      w.git("remote", "set-url", "origin", join(w.home, "missing.git"));
      const deps = baseDeps({ probes: w.p, addTeamSeams: realSeams, forgeToken: async () => null });
      const captured = captureOut();
      try {
        await teamAdd(["gadgets", "--owner", "dev2", "--team", "acme"], {}, deps);
        expect(captured.stdout()).toContain("Added the gadgets team");
        expect(captured.stdout()).toContain("The gadgets pack is not shared with your org yet");
        expect(captured.stdout()).toContain("rt team publish");
      } finally { captured.restore(); }
      expect(w.p.exists(join(w.root, "mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc"))).toBe(true);
      expect(w.atOrigin("log", "--format=%s", "main").trim()).toBe("seed");
    });

    /** Runs the `next` a failed share printed, as the person would type it. */
    async function runNext(next: string, deps: TeamDeps): Promise<void> {
      const [rt, verb, sub, ...args] = next.split(" ");
      expect([rt, verb, sub]).toEqual(["rt", "team", "publish"]);
      await teamPublish(args, {}, deps);
    }

    test("a failed commit is finished by the next command it names, with nothing unrelated in the commit", async () => {
      const w = orgWorld();
      writeFileSync(join(w.root, ".git", "index.lock"), "");
      const deps = baseDeps({ probes: w.p, addTeamSeams: realSeams, forgeToken: async () => null });
      await teamAdd(["gadgets", "--owner", "dev2", "--team", "acme", "--json"], {}, deps);
      const published = JSON.parse(deps.lines[0]!).published;
      expect(published).toMatchObject({ pushed: false, next: "rt team publish --team acme" });
      expect(w.git("log", "--format=%s").trim()).toBe("seed");
      rmSync(join(w.root, ".git", "index.lock"));
      writeFileSync(join(w.root, "notes.txt"), "scratch\n");
      writeFileSync(join(w.root, "mattstack/teams/widgets/settings.team.jsonc"), "{ \"board.title\": \"edited\" }\n");

      const later = baseDeps({ probes: w.p, forgeToken: async () => null });
      await runNext(published.next, later);

      expect(w.atOrigin("log", "--format=%s", "main").trim().split("\n")).toEqual(["skills: new gadgets pack", "seed"]);
      const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
      expect(files).toContain("mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc");
      expect(files).toContain(".claude-plugin/marketplace.json");
      expect(files).not.toContain("notes.txt");
      expect(files).not.toContain("mattstack/teams/widgets/settings.team.jsonc");
      expect(JSON.parse(w.atOrigin("show", "main:.claude-plugin/marketplace.json")).plugins).toEqual([expect.objectContaining({ name: "gadgets" })]);
      expect(readTeamLocal(w.p, "acme").pendingPackShares).toBeUndefined();
    });

    /** Someone else pushes to origin, so this clone's next push is not a fast-forward. */
    function moveOrigin(w: ReturnType<typeof orgWorld>): void {
      const other = join(w.home, "other");
      execFileSync("git", ["clone", "-q", "-b", "main", w.remote, other], { env: childEnv() });
      writeFileSync(join(other, "README.md"), "moved\n");
      execFileSync("git", ["add", "README.md"], { cwd: other, env: childEnv() });
      execFileSync("git", ["-c", "user.name=dev2", "-c", "user.email=dev2@example.test", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "elsewhere"], { cwd: other, env: childEnv() });
      execFileSync("git", ["push", "-q", "origin", "main"], { cwd: other, env: childEnv() });
      w.git("fetch", "-q", "origin");
    }

    test("a push the moved org repo rejects names rt team pull first, then rt team publish", async () => {
      const w = orgWorld();
      moveOrigin(w);
      const deps = baseDeps({ probes: w.p, addTeamSeams: realSeams, forgeToken: async () => null });
      await teamAdd(["gadgets", "--owner", "dev2", "--team", "acme", "--json"], {}, deps);
      expect(JSON.parse(deps.lines[0]!).published).toEqual({
        pushed: false,
        reason: "The org repo has changes this Mac does not have yet",
        next: "rt team pull --team acme",
        thenRun: "rt team publish --team acme",
      });

      const captured = captureOut();
      try {
        expect(await runExpectingProcessExit(() => teamPublish(["--team", "acme"], {}, baseDeps({ probes: w.p, forgeToken: async () => null })))).toBe(2);
        const err = captured.stderr();
        expect(err).toContain("The org repo has changes this Mac does not have yet");
        expect(err).toContain("rt team pull --team acme");
        expect(err).toContain("rt team publish --team acme");
        expect(err.indexOf("rt team pull --team acme")).toBeLessThan(err.indexOf("rt team publish --team acme"));
      } finally { captured.restore(); }
    });

    test("a failed push is finished by the next command it names", async () => {
      const w = orgWorld();
      w.git("remote", "set-url", "origin", join(w.home, "missing.git"));
      const deps = baseDeps({ probes: w.p, addTeamSeams: realSeams, forgeToken: async () => null });
      await teamAdd(["gadgets", "--owner", "dev2", "--team", "acme", "--json"], {}, deps);
      const published = JSON.parse(deps.lines[0]!).published;
      expect(published).toMatchObject({ pushed: false, next: "rt team publish --team acme" });
      w.git("remote", "set-url", "origin", w.remote);

      await runNext(published.next, baseDeps({ probes: w.p, forgeToken: async () => null }));

      expect(w.atOrigin("log", "--format=%s", "main").trim().split("\n")).toEqual(["skills: new gadgets pack", "seed"]);
      const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
      expect(files).toContain("mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc");
      expect(files).toContain(".claude-plugin/marketplace.json");
    });

    test("a remembered share this Mac's role can no longer write is skipped with a note, and the publish goes on", async () => {
      const w = orgWorld("dev2");
      mkdirSync(join(w.root, "mattstack/teams/gadgets/packs/gadgets"), { recursive: true });
      writeFileSync(join(w.root, "mattstack/teams/gadgets/packs/gadgets/PACK.md"), "gadgets\n");
      mkdirSync(join(w.root, "mattstack/teams/widgets/packs/widgets"), { recursive: true });
      writeFileSync(join(w.root, "mattstack/teams/widgets/packs/widgets/PACK.md"), "widgets\n");
      updateTeamLocal(w.p, "acme", { pendingPackShares: [
        { pack: "gadgets", paths: ["mattstack/teams/gadgets", ".claude-plugin/marketplace.json"] },
        { pack: "widgets", paths: ["mattstack/teams/widgets/packs/widgets"] },
      ] });
      const captured = captureOut();
      try {
        await teamPublish(["--team", "acme"], {}, baseDeps({ probes: w.p, forgeToken: async () => null }));
        expect(captured.stderr()).toContain("rt did not share the gadgets pack from this Mac");
        expect(captured.stdout()).toContain("Shared the widgets pack with your org");
      } finally { captured.restore(); }
      const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
      expect(files).toEqual(["mattstack/teams/widgets/packs/widgets/PACK.md"]);
      expect(readTeamLocal(w.p, "acme").pendingPackShares).toBeUndefined();
    });

    test("--json names each remembered share it dropped beside the push", async () => {
      const w = orgWorld("dev2");
      mkdirSync(join(w.root, "mattstack/teams/gadgets/packs/gadgets"), { recursive: true });
      writeFileSync(join(w.root, "mattstack/teams/gadgets/packs/gadgets/PACK.md"), "gadgets\n");
      mkdirSync(join(w.root, "mattstack/teams/widgets/packs/widgets"), { recursive: true });
      writeFileSync(join(w.root, "mattstack/teams/widgets/packs/widgets/PACK.md"), "widgets\n");
      updateTeamLocal(w.p, "acme", { pendingPackShares: [
        { pack: "gadgets", paths: ["mattstack/teams/gadgets", ".claude-plugin/marketplace.json"] },
        { pack: "widgets", paths: ["mattstack/teams/widgets/packs/widgets"] },
      ] });
      const deps = baseDeps({ probes: w.p, forgeToken: async () => null });
      const captured = captureOut();
      try {
        await teamPublish(["--team", "acme", "--json"], {}, deps);
        expect(captured.stderr()).toBe("");
      } finally { captured.restore(); }
      const { at: _at, detail: _detail, ...body } = JSON.parse(deps.lines[0]!);
      expect(body).toEqual({
        contract: 1,
        remote: w.remote,
        pushed: true,
        skipped: [{ pack: "gadgets", message: "The gadgets team's files belong to its owners" }],
      });
    });

    test("a team add whose pack is remembered before its commit leaves the share owed when the commit fails", async () => {
      const w = orgWorld();
      const hooks = join(w.home, "hooks");
      mkdirSync(hooks, { recursive: true });
      writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
      chmodSync(join(hooks, "pre-commit"), 0o755);
      w.git("config", "core.hooksPath", hooks);
      const remembered: unknown[] = [];
      const probes = { ...w.p, exec: async (argv: string[], opts?: Parameters<typeof w.p.exec>[1]) => {
        if (argv[1] === "add") remembered.push(readTeamLocal(w.p, "acme").pendingPackShares);
        return w.p.exec(argv as [string, ...string[]], opts);
      } } as typeof w.p;
      const deps = baseDeps({ probes, addTeamSeams: realSeams, forgeToken: async () => null });
      await teamAdd(["gadgets", "--owner", "dev2", "--team", "acme", "--json"], {}, deps);
      expect(remembered[0]).toEqual([{ pack: "gadgets", paths: ["mattstack/teams/gadgets", ".claude-plugin/marketplace.json"] }]);
      expect(readTeamLocal(w.p, "acme").pendingPackShares).toEqual([{ pack: "gadgets", paths: ["mattstack/teams/gadgets", ".claude-plugin/marketplace.json"] }]);
    });

    test("a member's Mac never commits a remembered share", async () => {
      const w = orgWorld("dev3");
      mkdirSync(join(w.root, "mattstack/teams/gadgets/packs/gadgets"), { recursive: true });
      writeFileSync(join(w.root, "mattstack/teams/gadgets/packs/gadgets/README.md"), "gadgets\n");
      updateTeamLocal(w.p, "acme", { pendingPackShares: [{ pack: "gadgets", paths: ["mattstack/teams/gadgets"] }] });
      const deps = baseDeps({ probes: w.p, forgeToken: async () => null });
      expect(await runExpectingProcessExit(() => teamPublish(["--team", "acme", "--json"], {}, deps))).toBe(2);
      expect(JSON.parse(deps.lines[0]!).error.code).toBe("team-pull-only");
      expect(w.git("log", "--format=%s").trim()).toBe("seed");
      expect(w.pushes).toEqual([]);
    });

    test("a member's Mac refuses before writing or pushing anything", async () => {
      const w = orgWorld("dev2");
      const deps = baseDeps({ probes: w.p, addTeamSeams: realSeams, forgeToken: async () => null });
      expect(await runExpectingProcessExit(() => teamAdd(["gadgets", "--owner", "dev2", "--team", "acme", "--json"], {}, deps))).toBe(2);
      expect(JSON.parse(deps.lines[0]!).error.code).toBe("team-pull-only");
      expect(w.pushes).toEqual([]);
      expect(w.p.exists(join(w.root, "mattstack/teams/gadgets"))).toBe(false);
    });
  });

  test("missing owners exits with usage without writing", async () => {
    const deps = addDeps();
    expect(await runExpectingProcessExit(() => teamAdd(["gadgets", "--team", "acme", "--json"], {}, deps))).toBe(2);
    expect(JSON.parse(deps.lines[0]!).error.code).toBe("usage");
    expect(deps.writes).toEqual([]);
  });

  test("member JSON refuses before shared writes", async () => {
    const deps = addDeps("dev2");
    expect(await runExpectingProcessExit(() => teamAdd(["gadgets", "--owner", "dev2", "--team", "acme", "--json"], {}, deps))).toBe(2);
    expect(JSON.parse(deps.lines[0]!).error.code).toBe("team-pull-only");
    expect(deps.probes.exists(`${ZONE_DIR}/mattstack/teams/gadgets`)).toBe(false);
    expect(deps.writes).toEqual([]);
  });

  test("human success uses output and leaves the envelope seam empty", async () => {
    const deps = addDeps();
    const captured = captureOut();
    try {
      await teamAdd(["gadgets", "--owner", "dev2", "--team", "acme"], {}, deps);
      expect(captured.stdout()).toContain("Added the gadgets team");
      expect(captured.stdout()).toContain("rt team members set <username> --teams gadgets");
      expect(deps.lines).toEqual([]);
    } finally { captured.restore(); }
  });
});


describe("teamMembersSet", () => {
  function world(username = "dev1", ownsTeam = true) {
    const roster = [{ username: "dev1", teams: ["widgets"] }, { username: "Dev2", name: "Dev Two", teams: ["widgets"] }];
    const writes: { key: string; value: unknown; scope: string }[] = [];
    const membersSeams: MembersSeams = {
      readTeamStore: () => ({ "mattstack.roster": roster }),
      writeSetting: ((key: string, value: unknown, scope: string) => { writes.push({ key, value, scope }); }) as MembersSeams["writeSetting"],
      currentOrg: () => "acme",
      revokeRead: async () => { throw new Error("must not revoke access"); },
      readTeamLocal: () => { throw new Error("must not read membership permissions"); },
      forgeToken: async () => { throw new Error("must not read secrets"); },
      warn: () => { throw new Error("must not warn"); },
      readLocalSecret: async () => { throw new Error("must not read secrets"); },
    };
    const deps = baseDeps({ membersSeams, probes: fakeProbes({ home: "/home/x", files: {
      ...adminFiles,
      [`${ZONE_DIR}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ownsTeam ? ["dev2"] : [] } } } }),
      [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: username }),
      [`${ZONE_DIR}/mattstack/teams/widgets/settings.team.jsonc`]: "{}",
      [`${ZONE_DIR}/mattstack/teams/gadgets/settings.team.jsonc`]: "{}",
    } }) });
    return { deps, writes };
  }

  test("runs the real roster mutation and emits one flat JSON envelope", async () => {
    const { deps, writes } = world();
    await teamActions.teamMembersSet(["--teams", " gadgets, widgets, gadgets, ", "--team", "acme", "dev2", "--json"], {}, deps);
    expect(deps.lines).toHaveLength(1);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({ contract: 1, username: "Dev2", teams: ["gadgets", "widgets"], previous: ["widgets"] });
    expect(writes).toEqual([{ key: "mattstack.roster", value: [{ username: "dev1", teams: ["widgets"] }, { username: "Dev2", name: "Dev Two", teams: ["gadgets", "widgets"] }], scope: "org" }]);
  });

  test("empty teams clears membership and human output shows the previous team", async () => {
    const { deps, writes } = world();
    const captured = captureOut();
    try {
      await teamActions.teamMembersSet(["dev2", "--teams", "", "--team", "acme"], {}, deps);
      expect(captured.stdout()).toContain("Dev2 is on no team");
      expect(captured.stdout()).toContain("was on widgets");
    } finally { captured.restore(); }
    expect(deps.lines).toEqual([]);
    expect((writes[0]!.value as { teams: string[] }[])[1]!.teams).toEqual([]);
  });

  test.each([
    [["dev2", "--team", "acme", "--json"]],
    [["--teams", "widgets", "--team", "acme", "--json"]],
  ])("missing required arguments exits 2 without writing: %j", async (args) => {
    const { deps, writes } = world();
    expect(await runExpectingProcessExit(() => teamActions.teamMembersSet(args, {}, deps))).toBe(2);
    expect(JSON.parse(deps.lines[0]!)).toMatchObject({ contract: 1, error: { code: "usage" } });
    expect(writes).toEqual([]);
  });

  test.each([["team owner", true], ["member", false]] as const)("a %s gets the flat refusal envelope and no write", async (_role, ownsTeam) => {
    const { deps, writes } = world("dev2", ownsTeam);
    expect(await runExpectingProcessExit(() => teamActions.teamMembersSet(["dev1", "--teams", "gadgets", "--team", "acme", "--json"], {}, deps))).toBe(2);
    expect(JSON.parse(deps.lines[0]!)).toMatchObject({ contract: 1, error: { code: "team-pull-only" } });
    expect(writes).toEqual([]);
  });

  test("policy refusal is drawn as refused for a person", async () => {
    const { deps, writes } = world("dev2");
    const captured = captureOut();
    try {
      expect(await runExpectingProcessExit(() => teamActions.teamMembersSet(["dev1", "--teams", "gadgets", "--team", "acme"], {}, deps))).toBe(2);
      expect(captured.stderr()).toContain("[refused]");
      expect(captured.stderr()).not.toContain("[failed]");
    } finally { captured.restore(); }
    expect(writes).toEqual([]);
  });
});

describe("teamUse", () => {
  function world(overrides: Partial<TeamDeps> = {}) {
    const effects: string[] = [];
    const deps = baseDeps({
      useTeamSeams: {
        activeTeam: () => ({ org: "acme", team: "widgets", reason: "first-team", username: "dev2", listedOn: ["widgets", "gadgets"] }),
        writeUserSetting: (key, value) => { effects.push(`${key}=${value}`); },
        installPack: async () => ({ ok: true, detail: "1 pack" }),
        setPackEnabled: async () => true,
        marketplace: () => "acme-market",
        restartApp: async () => true,
      },
      ...overrides,
    });
    return { deps, effects };
  }
  test("prints a flat success envelope", async () => {
    const { deps, effects } = world();
    await teamActions.teamUse(["gadgets", "--json"], {}, deps);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({ contract: 1, team: "gadgets", previous: "widgets", pack: { installed: true, enabled: true, detail: "1 pack" }, disabled: "widgets@acme-market", restarted: ["board", "boxscore"] });
    expect(effects).toEqual(["mattstack.activeTeam=gadgets"]);
  });
  test("missing team under JSON exits 2 without opening the picker", async () => {
    const { deps, effects } = world({ interactive: () => true, selectTeam: async () => { throw new Error("must not pick"); } });
    expect(await runExpectingProcessExit(() => teamActions.teamUse(["--json"], {}, deps))).toBe(2);
    expect(JSON.parse(deps.lines[0]!)).toMatchObject({ error: { code: "usage" } });
    expect(effects).toEqual([]);
  });
  test("human usage asks which team", async () => {
    const { deps, effects } = world({ interactive: () => false });
    const captured = captureOut();
    try {
      expect(await runExpectingProcessExit(() => teamActions.teamUse([], {}, deps))).toBe(2);
      expect(captured.stderr()).toContain("Which team do you want to work as?");
    } finally { captured.restore(); }
    expect(effects).toEqual([]);
  });
  test("membership refusal has no effects and draws a refused note", async () => {
    const { deps, effects } = world();
    const captured = captureOut();
    try {
      expect(await runExpectingProcessExit(() => teamActions.teamUse(["sprockets"], {}, deps))).toBe(2);
      expect(captured.stderr()).toContain("[refused] The roster does not list you on the sprockets team");
    } finally { captured.restore(); }
    expect(effects).toEqual([]);
  });
  test("picker offers only memberships in roster order and uses the selection", async () => {
    const oldBatch = process.env.RT_BATCH;
    delete process.env.RT_BATCH;
    try {
      const { deps, effects } = world({ interactive: () => true, selectTeam: async (choices) => { expect(choices).toEqual(["widgets", "gadgets"]); return "gadgets"; } });
      const captured = captureOut();
      try {
        await teamActions.teamUse([], {}, deps);
        expect(captured.stdout()).toContain("You are working as the gadgets team");
      } finally { captured.restore(); }
      expect(effects).toEqual(["mattstack.activeTeam=gadgets"]);
    } finally { if (oldBatch === undefined) delete process.env.RT_BATCH; else process.env.RT_BATCH = oldBatch; }
  });
  test("canceling the picker exits successfully without effects", async () => {
    const oldBatch = process.env.RT_BATCH;
    delete process.env.RT_BATCH;
    try {
      const { deps, effects } = world({ interactive: () => true, selectTeam: async () => null });
      expect(await runExpectingProcessExit(() => teamActions.teamUse([], {}, deps))).toBe(0);
      expect(effects).toEqual([]);
    } finally { if (oldBatch === undefined) delete process.env.RT_BATCH; else process.env.RT_BATCH = oldBatch; }
  });
});

describe("realUseTeamSeams", () => {
  test("reads the chosen team through the resolver rather than the raw user global", async () => {
    const active = await import("../../packages/rt-client/src/settings/active-team.ts");
    const settings = await import("../../lib/settings/resolve.ts");
    const activeSpy = spyOn(active, "activeTeam").mockReturnValue({ org: "acme", team: "widgets", reason: "chosen", username: "dev2", listedOn: ["widgets", "gadgets"] });
    const settingSpy = spyOn(settings, "getSetting").mockImplementation(<T>(key: string) => ({ value: (key === "mattstack.activeTeam" ? "gadgets" : [{ username: "dev2", teams: ["widgets", "gadgets"] }]) as T, provenance: [] }));
    try {
      const seams = await teamActions.realUseTeamSeams(baseDeps({ deckPath: () => null }));
      expect(seams.activeTeam()).toMatchObject({ team: "gadgets", reason: "chosen", listedOn: ["widgets", "gadgets"] });
      expect(settingSpy.mock.calls.map((a) => a[0])).toContain("mattstack.activeTeam");
    } finally { activeSpy.mockRestore(); settingSpy.mockRestore(); }
  });

  test("real update installation preserves a disabled selected pack until explicit enable, then disables the hand-enabled previous pack", async () => {
    const apply = await import("../../lib/setup/apply.ts");
    const original = apply.createApplyContext;
    const forbidden = (): never => { throw new Error("must not access secrets"); };
    const secrets = { ageKeySeam: new FakeAgeKeySeam(), execSeam: { run: forbidden, fileExists: forbidden, statFile: forbidden, readFile: forbidden, writeFile: forbidden, ensureDir: forbidden, chmod: forbidden, fsyncAndRename: forbidden, removeFile: forbidden } };
    const presence = { has: async () => { throw new Error("must not inspect credentials"); } };
    const enabled: Record<string, boolean> = { "widgets@acme-market": true, "gadgets@acme-market": false };
    const home = "/home/x";
    const p = fakeProbes({ home, env: { PATH: "/fixture/bin", CLAUDE_CONFIG_DIR: "/fixture/config" },
      dirs: { [`${home}/.mattstack/teams`]: ["acme"] },
      files: { ...adminFiles, "/fixture/bin/claude": "bin", [`${ZONE_DIR}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.roster": [{ username: "dev1", teams: ["gadgets", "widgets"] }] }), [`${ZONE_DIR}/.claude-plugin/marketplace.json`]: JSON.stringify({ name: "acme-market", plugins: [{ name: "widgets" }, { name: "gadgets" }] }) },
      exec: async (argv, opts) => {
        if (argv[0] === "/fixture/deck") return { code: 0, stdout: "", stderr: "" };
        expect(argv[0]).toBe("/fixture/bin/claude");
        expect(opts?.env?.CLAUDE_CONFIG_DIR).toBe("/fixture/config");
        const [, , verb, id] = argv;
        if (verb === "list") return { code: 0, stdout: JSON.stringify(Object.entries(enabled).map(([id, enabled]) => ({ id, enabled, version: "1" }))), stderr: "" };
        if (verb === "install" || verb === "enable") enabled[id!] = true;
        if (verb === "disable") enabled[id!] = false;
        if (verb === "uninstall" || verb === "remove") throw new Error("must not remove packs");
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const contextSpy = spyOn(apply, "createApplyContext").mockImplementation(async (deps) => {
      expect(deps.secrets).toBe(secrets);
      expect(deps.secretPresence).toBe(presence);
      expect(deps.flags.update).toBe(true);
      return original(deps);
    });
    try {
      const seams = await teamActions.realUseTeamSeams(baseDeps({ probes: p, secrets, secretPresence: presence, deckPath: () => "/fixture/deck" }));
      expect(seams.marketplace("acme")).toBe("acme-market");
      expect((await seams.installPack()).ok).toBe(true);
      expect(enabled["gadgets@acme-market"]).toBe(false);
      expect(enabled["widgets@acme-market"]).toBe(true);
      expect(p.calls.exec.some((a) => a[2] === "update" && a[3] === "gadgets@acme-market")).toBe(true);
      expect(await seams.setPackEnabled("gadgets@acme-market", true)).toBe(true);
      expect(await seams.setPackEnabled("widgets@acme-market", false)).toBe(true);
      expect(enabled["gadgets@acme-market"]).toBe(true);
      expect(enabled["widgets@acme-market"]).toBe(false);
      expect(await seams.restartApp("board")).toBe(true);
      expect(p.calls.exec.at(-1)).toEqual(["/fixture/deck", "restart", "board"]);
      expect(contextSpy.mock.calls).toHaveLength(1);
    } finally { contextSpy.mockRestore(); }
  });

  test("missing tools and invalid marketplace are reported without external calls", async () => {
    const p = fakeProbes({ home: "/home/x", files: { [`${ZONE_DIR}/.claude-plugin/marketplace.json`]: "{" } });
    const seams = await teamActions.realUseTeamSeams(baseDeps({ probes: p, deckPath: () => null }));
    expect(seams.marketplace("acme")).toBe("acme");
    expect(await seams.setPackEnabled("gadgets@acme", true)).toBe(false);
    expect(await seams.restartApp("boxscore")).toBe(false);
    expect(p.calls.exec).toEqual([]);
  });
  test.each([true, false])("Claude already in the requested state succeeds: %s", async (enabled) => {
    const p = fakeProbes({ home: "/home/x", env: { PATH: "/fixture/bin" }, files: { "/fixture/bin/claude": "bin" }, exec: async () => ({ code: 1, stdout: "", stderr: `is already ${enabled ? "enabled" : "disabled"}` }) });
    const seams = await teamActions.realUseTeamSeams(baseDeps({ probes: p, deckPath: () => null }));
    expect(await seams.setPackEnabled("gadgets@acme", enabled)).toBe(true);
  });
});
