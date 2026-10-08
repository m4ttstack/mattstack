import { afterEach, beforeEach, describe, test, expect, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../lib/ui/warn.ts";
import { realTeamDeps, teamCreate, teamInvite, teamManageMembership, teamPeer, teamPublish, teamPull, teamStatus, type TeamDeps } from "../team.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import type { AgeExecResult, AgeKeySeam } from "../../lib/home/age-key.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import type { Probes } from "../../lib/setup/probes.ts";
import { joinLink, joinLinkBase, pasteBlock } from "../../lib/team/invite.ts";
import { readTeamLocal, writeTeamLocal, type TeamLocalRecord } from "../../lib/team/team-local.ts";

const FAKE_PUBLIC_KEY = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const FAKE_PRIVATE_KEY = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";
const ZONE_DIR = "/home/x/.mattstack/teams/acme";

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
    probes: fakeProbes({ home: "/home/x" }),
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
  return baseDeps({ probes: fakeProbes({ home: "/home/x", dirs: { [ZONE_DIR]: [] } }), ...overrides });
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
  test("--json prints the exact contract envelope shape", async () => {
    const deps = baseDeps();
    await teamCreate(["Acme", "--remote", "https://github.com/acme/mattstack-team-acme.git", "--json"], {}, deps);

    expect(deps.lines).toHaveLength(1);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({
      contract: 1,
      slug: "acme",
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
        files: { [join(teams, "globex", "mattstack", "settings.team.jsonc")]: "{}" },
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
      expect(io.stderr()).toBe("What should the team be called?\n  next: rt team create <name> (--remote <url> | --create-repo <owner>) [--others] [--json]\n");
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
      expect(io.stdout()).toBe("[ok] Created the acme team  https://github.com/acme/repo.git\n");
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
    expect(Object.keys(JSON.parse(deps.lines[0]!)).sort()).toEqual(["at", "contract", "created", "dir", "name", "remote", "slug"]);
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
      expect(io.stdout()).toContain("Created the acme team");
      expect(io.stderr()).toContain("The team is ready, but rt could not connect your board");
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
      expect(io.stderr()).toContain("[refused] Only the team's owner can connect a board from their own Mac");
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
      dirs: { [ZONE_DIR]: [] },
      exec: (argv, opts) => {
        seen.push({ argv, env: opts?.env });
        return { code: 0, stdout: "", stderr: "" };
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
    const deps = baseDeps();
    const code = await runExpectingProcessExit(() => teamPublish(["--remote", "https://github.com/acme/repo.git", "--json"], {}, deps));

    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("no-team");
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
    mkdirSync(join(teamDir, "mattstack"), { recursive: true });
    writeFileSync(join(teamDir, "mattstack", "settings.team.jsonc"), `${JSON.stringify({ "board.title": "Acme Team" }, null, 2)}\n`);
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
      files: { [join(teamDir, ".git", "config")]: GIT_CONFIG },
      exec: overrides.exec ?? ghExec(),
      fetch: (url, init) => {
        if (url.endsWith("/boards")) return Promise.resolve({ status: 401, body: "", headers: {} });
        overrides.onRelay?.();
        return relayFetch()(url, init);
      },
    });
    if (overrides.record) {
      writeTeamLocal(probes, "acme", { createdByRt: false, joinedByRt: false, rtMayManageMembership: false, ...overrides.record });
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

  test("a joined machine refuses before the relay is ever touched", async () => {
    let relayCalls = 0;
    const deps = inviteDeps({ record: { joinedByRt: true }, onRelay: () => { relayCalls++; } });

    const code = await runExpectingProcessExit(() => teamInvite(["--handle", "zaphod", "--team", "acme", "--json"], {}, deps));

    expect(relayCalls).toBe(0);
    expect(code).toBe(2);
    expect(JSON.parse(deps.lines[0]!).error.code).toBe("team-pull-only");
  });

  test("human mode: a pull-only clone refuses to invite, as a refused line", async () => {
    const deps = inviteDeps({ record: { joinedByRt: true } });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamInvite(["--handle", "zaphod", "--team", "acme"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toBe("[refused] This Mac joined the acme team by invite, so its copy is pull-only and cannot invite anyone.\n  why: Ask the team's owner to invite zaphod.\n");
      expect(io.stdout()).toBe("");
    } finally {
      io.restore();
    }
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
      expect(io.stderr()).toBe("Who is the invite for?\n  next: rt team invite --handle <h> [--team <slug>] [--require-peering] [--json]\n");
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

  test("--json carries a layout hold beside the outcome", async () => {
    const hold = { layout: 2, reads: 1 };
    const deps = depsWithZone({ daemon: async (cmd) => (cmd === "team:pull" ? { ok: true, data: { outcome: "skipped", detail: "held", hold } } : { ok: false }) });
    await teamPull(["--team", "acme", "--json"], {}, deps);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(body).toEqual({ contract: 1, slug: "acme", outcome: "skipped", detail: "held", hold });
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
