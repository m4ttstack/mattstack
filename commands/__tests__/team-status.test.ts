import { describe, test, expect, spyOn } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { teamStatus, type TeamDeps } from "../team.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { ORG_MARKER_REL } from "../../lib/team/org-marker.ts";
import { teamLocalPath } from "../../lib/team/team-local.ts";
import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import type { SettingsReader } from "../../lib/setup/team-settings.ts";
import { row, type Row } from "../../lib/setup/contract.ts";
import { ADMIN_SECRETS_ROW_ID, ADMIN_SECRETS_SYNC_STEPS } from "../../lib/setup/validators/admin-secrets.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../lib/ui/warn.ts";

const HOME = "/home/x";
const SLUG = "acme";
const TEAM_DIR = join(HOME, ".mattstack", "orgs", SLUG);
const GIT_CONFIG = `[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n`;

function baseDeps(overrides: Partial<TeamDeps> = {}): TeamDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    probes: fakeProbes({ home: HOME }),
    print: (s: string) => lines.push(s),
    readLocalSecret: async () => null,
    readAdminSecret: async () => null,
    adminSecretsState: async () => null,
    lines,
    ...overrides,
  };
}

function fakeRead(values: Record<string, unknown>): SettingsReader {
  return <T>(key: string): T | undefined => values[key] as T | undefined;
}

function clonedDeps(overrides: { exec?: TeamDeps["probes"]["exec"]; fetch?: TeamDeps["probes"]["fetch"]; read?: Record<string, unknown>; gitConfig?: string; files?: Record<string, string> } = {}): TeamDeps & { lines: string[] } {
  return baseDeps({
    probes: fakeProbes({
      home: HOME,
      dirs: { [TEAM_DIR]: [] },
      files: { [join(TEAM_DIR, ".git", "config")]: overrides.gitConfig ?? GIT_CONFIG, ...overrides.files },
      exec: overrides.exec,
      fetch: overrides.fetch,
    }),
    statusRead: fakeRead(overrides.read ?? {}),
    daemon: async () => null,
  });
}

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

describe("teamStatus", () => {
  describe("role and teams", () => {
    const roster = [{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["gadgets", "widgets"] }, { username: "dev3", teams: ["gadgets"] }];
    const roles = { admins: ["dev1"], teams: { gadgets: { owners: ["dev2"] } } };

    function depsFor(username: string | null, selected?: string): TeamDeps & { lines: string[] } {
      return baseDeps({
        probes: fakeProbes({
          home: HOME,
          dirs: { [TEAM_DIR]: [], [join(TEAM_DIR, "mattstack", "teams")]: ["widgets", "gadgets", ".DS_Store", "Nope", "missing"] },
          files: {
            [join(TEAM_DIR, ".git", "config")]: GIT_CONFIG,
            [join(TEAM_DIR, "mattstack", "org", "settings.org.jsonc")]: JSON.stringify({ "mattstack.roster": roster, "mattstack.org": roles }),
            [join(TEAM_DIR, "mattstack", "teams", "widgets", "settings.team.jsonc")]: "{}",
            [join(TEAM_DIR, "mattstack", "teams", "gadgets", "settings.team.jsonc")]: "{}",
            [join(TEAM_DIR, "mattstack", "teams", "Nope", "settings.team.jsonc")]: "{}",
            ...(username ? { [join(HOME, ".mattstack", "rt", "teams", `${SLUG}.json`)]: JSON.stringify({ forgeUsername: username }) } : {}),
            ...(selected ? { [join(HOME, ".mattstack", "user", "settings.user.jsonc")]: JSON.stringify({ "mattstack.activeTeam": selected }) } : {}),
          },
        }),
        statusRead: fakeRead({ "board.title": "Acme Team", "mattstack.roster": roster }),
        daemon: async () => null,
      });
    }

    async function status(username: string | null, selected?: string): Promise<Record<string, unknown>> {
      const deps = depsFor(username, selected);
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      const { at: _at, ...body } = JSON.parse(deps.lines[0]!);
      return body;
    }

    test("an org owner sees active-team members and sorted valid team folders with settings", async () => {
      expect(await status("dev1")).toMatchObject({ slug: "acme", name: "Acme Team", role: "org-owner", activeTeam: "widgets", teams: ["widgets"], orgTeams: ["gadgets", "widgets"], members: [{ username: "dev1" }, { username: "dev2" }] });
    });

    test("each member carries their own org role kind, whoever is viewing", async () => {
      expect((await status("dev3")).members).toEqual([
        { username: "dev2", role: "owner", peered: null },
        { username: "dev3", role: "member", peered: null },
      ]);
      expect((await status("dev1")).members).toEqual([
        { username: "dev1", role: "org-owner", peered: null },
        { username: "dev2", role: "owner", peered: null },
      ]);
    });

    test("an owner starts on their first roster team and preserves roster order", async () => {
      expect(await status("dev2")).toMatchObject({ role: "owner", activeTeam: "gadgets", teams: ["gadgets", "widgets"], members: [{ username: "dev2" }, { username: "dev3" }] });
    });

    test("a selected team changes members without changing primary roster order", async () => {
      expect(await status("dev2", "widgets")).toMatchObject({ activeTeam: "widgets", teams: ["gadgets", "widgets"], members: [{ username: "dev1" }, { username: "dev2" }] });
    });

    test("someone on no team sees the whole org and has no active team", async () => {
      expect(await status("stranger")).toMatchObject({ role: "member", activeTeam: null, teams: [], members: [{ username: "dev1" }, { username: "dev2" }, { username: "dev3" }] });
    });

    test("an unidentified Mac reports unknown role and no listed teams", async () => {
      expect(await status(null)).toMatchObject({ role: "unknown", activeTeam: null, teams: [] });
    });

    test("human output shows your role and team under the resolved title", async () => {
      const io = captureOut();
      io.reset();
      ui.__test__.setHuman(() => false);
      try {
        await teamStatus(["--team", SLUG], {}, depsFor("dev1"));
        expect(io.stdout()).toContain("Acme Team (acme)\n");
        expect(io.stdout()).toContain("your team: widgets\n");
        expect(io.stdout()).toContain("your role: org owner\n");
      } finally {
        io.restore();
      }
    });
  });

  test("--json prints the exact contract envelope: slug, name, remote, lastPush, members, and the five sync fields false/null without a daemon", async () => {
    const deps = clonedDeps({
      exec: async (argv) => {
        if (argv[0] === "git" && argv[2] === TEAM_DIR && argv[3] === "log") {
          return { code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" };
        }
        if (argv.includes("symbolic-ref")) return { code: 0, stdout: "main\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
      read: { "board.title": "Acme Team", "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }] },
    });

    await teamStatus(["--team", SLUG, "--json"], {}, deps);

    expect(deps.lines).toHaveLength(1);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({
      contract: 1,
      slug: "acme",
      name: "Acme Team",
      remote: "git@github.com:acme/widgets.git",
      branch: "main",
      dataBranch: "main",
      trial: false,
      lastPush: "2026-08-21T10:00:00+00:00",
      members: [{ username: "dev1", role: "member", peered: null }],
      invites: [],
      adminSecrets: null,
      role: "unknown",
      activeTeam: null,
      teams: [],
      orgTeams: [],
      lastPull: null,
      lastPushAt: null,
      lastPullSkipped: null,
      conflicted: null,
      pullOnly: false,
      relayFailed: false,
    });
  });

  test("peered is true or false per member when the switchboard lists the boards, and only the switchboard is asked", async () => {
    const fetched: Array<{ url: string; auth?: string }> = [];
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      fetch: async (url, init) => {
        fetched.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
        return { status: 200, body: JSON.stringify({ boards: [{ username: "Dev1" }] }), headers: {} };
      },
      read: { "mattstack.roster": [{ username: "dev1" }, { username: "dev2" }] },
    });
    deps.readLocalSecret = async (key) => (key === "switchboardAdminToken" ? "admin-tok" : null);

    await teamStatus(["--team", SLUG, "--json"], {}, deps);

    expect(JSON.parse(deps.lines[0]!).members).toEqual([
      { username: "dev1", role: "member", peered: true },
      { username: "dev2", role: "member", peered: false },
    ]);
    expect(fetched).toEqual([{ url: `${switchboardUrl()}/boards`, auth: "Bearer admin-tok" }]);
  });

  test("an admin whose token is only in the org's admin-only file still sees who is peered", async () => {
    const fetched: Array<{ url: string; auth?: string }> = [];
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      fetch: async (url, init) => {
        fetched.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
        return { status: 200, body: JSON.stringify({ boards: [{ username: "dev1" }] }), headers: {} };
      },
      read: { "mattstack.roster": [{ username: "dev1" }, { username: "dev2" }] },
    });
    deps.readLocalSecret = async () => null;
    deps.readAdminSecret = async (org, key) => (org === SLUG && key === "switchboardAdminToken" ? "admin-file" : null);

    await teamStatus(["--team", SLUG, "--json"], {}, deps);

    expect(JSON.parse(deps.lines[0]!).members).toEqual([
      { username: "dev1", role: "member", peered: true },
      { username: "dev2", role: "member", peered: false },
    ]);
    expect(fetched).toEqual([{ url: `${switchboardUrl()}/boards`, auth: "Bearer admin-file" }]);
  });

  test("without the admin token, the board's own token asks /peers, and the human view counts connected boards", async () => {
    const fetched: string[] = [];
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      fetch: async (url) => {
        fetched.push(url);
        return { status: 200, body: JSON.stringify({ peers: ["dev2"] }), headers: {} };
      },
      read: { "mattstack.roster": [{ username: "dev1" }, { username: "dev2" }] },
    });
    deps.readLocalSecret = async (key) => (key === "switchboardToken" ? "board-tok" : null);

    await teamStatus(["--team", SLUG, "--json"], {}, deps);
    expect(JSON.parse(deps.lines[0]!).members).toEqual([
      { username: "dev1", role: "member", peered: false },
      { username: "dev2", role: "member", peered: true },
    ]);
    expect(fetched).toEqual([`${switchboardUrl()}/peers`]);

    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus(["--team", SLUG], {}, deps);
      expect(io.stdout()).toContain("members: 2\n  1 with a connected board\n");
    } finally {
      io.restore();
    }
  });

  test("a clone on another branch reports it, and its last push is read from that branch", async () => {
    const calls: string[][] = [];
    const deps = clonedDeps({
      exec: async (argv) => {
        calls.push(argv);
        if (argv.includes("symbolic-ref")) return { code: 0, stdout: "org-trial\n", stderr: "" };
        return { code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" };
      },
    });

    await teamStatus(["--team", SLUG, "--json"], {}, deps);
    expect(JSON.parse(deps.lines[0]!).branch).toBe("org-trial");
    expect(calls.find((argv) => argv.includes("log"))!.at(-1)).toBe("origin/org-trial");

    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus(["--team", SLUG], {}, deps);
      expect(io.stdout()).toContain("branch: org-trial");
    } finally {
      io.restore();
    }
  });

  describe("on an org with a data branch", () => {
    const MARKER = { [join(TEAM_DIR, ORG_MARKER_REL)]: JSON.stringify({ role: "org", org: SLUG, layout: 4, dataBranch: "mattstack" }) };
    async function humanStatus(checkedOut: string, files: Record<string, string> = {}): Promise<string> {
      const deps = clonedDeps({
        files: { ...MARKER, ...files },
        exec: async (argv) => (argv.includes("symbolic-ref") ? { code: 0, stdout: `${checkedOut}\n`, stderr: "" } : { code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" }),
      });
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      try {
        await teamStatus(["--team", SLUG], {}, deps);
        return io.stdout();
      } finally {
        io.restore();
      }
    }

    test("the data branch shows no branch line", async () => {
      expect(await humanStatus("mattstack")).not.toContain("branch:");
    });

    test("a recorded trial branch shows as a trial, not as off the org's branch", async () => {
      const stdout = await humanStatus("try-roles", { [teamLocalPath(HOME, SLUG)]: JSON.stringify({ trialBranch: "try-roles" }) });
      expect(stdout).toContain("branch: try-roles");
      expect(stdout).toContain("a trial; the org's data is on mattstack");
      expect(stdout).not.toContain("not ");
    });

    async function jsonStatus(checkedOut: string, files: Record<string, string> = {}): Promise<{ branch: string; dataBranch: string; trial: boolean }> {
      const deps = clonedDeps({
        files: { ...MARKER, ...files },
        exec: async (argv) => (argv.includes("symbolic-ref") ? { code: 0, stdout: `${checkedOut}\n`, stderr: "" } : { code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" }),
      });
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      return JSON.parse(deps.lines[0]!);
    }

    test("--json names the data branch and says the clone is not on a trial while it sits there", async () => {
      expect(await jsonStatus("mattstack")).toMatchObject({ branch: "mattstack", dataBranch: "mattstack", trial: false });
    });

    test("--json flags the recorded trial branch as a trial", async () => {
      const body = await jsonStatus("try-roles", { [teamLocalPath(HOME, SLUG)]: JSON.stringify({ trialBranch: "try-roles" }) });
      expect(body).toMatchObject({ branch: "try-roles", dataBranch: "mattstack", trial: true });
    });

    test("--json never calls an unrecorded branch a trial", async () => {
      expect(await jsonStatus("stray")).toMatchObject({ branch: "stray", dataBranch: "mattstack", trial: false });
    });

    test("any other branch is flagged against the data branch", async () => {
      const stdout = await humanStatus("stray");
      expect(stdout).toContain("this Mac reads and publishes this branch, not mattstack");
    });
  });

  test("a clone on main shows no branch line", async () => {
    const deps = clonedDeps({
      exec: async (argv) => (argv.includes("symbolic-ref") ? { code: 0, stdout: "main\n", stderr: "" } : { code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" }),
    });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus(["--team", SLUG], {}, deps);
      expect(io.stdout()).not.toContain("branch:");
    } finally {
      io.restore();
    }
  });

  test("--json carries pullOnly through from the daemon's snapshot-status entry, so a member can see why nothing pushes", async () => {
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" }),
    });
    deps.daemon = async (verb) =>
      verb === "team:snapshot-status"
        ? {
            ok: true,
            data: [
              {
                slug: SLUG,
                lastPullAt: 900_000,
                lastPushAt: 0,
                lastPullSkipped: null,
                conflicted: null,
                pullOnly: true,
              },
            ],
          }
        : null;

    await teamStatus(["--team", SLUG, "--json"], {}, deps);

    const body = JSON.parse(deps.lines[0]!);
    expect(body.pullOnly).toBe(true);
  });

  test("human mode notes a pull-only clone never pushes", async () => {
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" }),
    });
    deps.daemon = async (verb) =>
      verb === "team:snapshot-status"
        ? { ok: true, data: [{ slug: SLUG, lastPullAt: 900_000, lastPushAt: 0, lastPullSkipped: null, conflicted: null, pullOnly: true }] }
        : null;

    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus(["--team", SLUG], {}, deps);
      expect(io.stdout()).toContain("sync: ok\n  this copy only pulls, it never pushes\n");
    } finally {
      io.restore();
    }
  });

  test("a marketplace held for a new pack's share shows as pending with the publish to run, and stays out of --json", async () => {
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" }),
    });
    deps.daemon = async (verb) =>
      verb === "team:snapshot-status"
        ? { ok: true, data: [{ slug: SLUG, lastPullAt: 900_000, lastPushAt: 0, lastPullSkipped: null, conflicted: null, pullOnly: false, heldBack: [".claude-plugin/marketplace.json"] }] }
        : null;

    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus(["--team", SLUG], {}, deps);
      expect(io.stdout()).toContain("A new pack is not shared with your org yet");
      expect(io.stdout()).toContain("rt team publish --team acme");
    } finally {
      io.restore();
    }
    await teamStatus(["--team", SLUG, "--json"], {}, deps);
    expect(JSON.parse(deps.lines.at(-1)!).heldBack).toBeUndefined();
  });

  test("no board.title -> name falls back to the slug", async () => {
    const deps = clonedDeps({ exec: async () => ({ code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" }) });

    await teamStatus(["--team", SLUG, "--json"], {}, deps);

    const body = JSON.parse(deps.lines[0]!);
    expect(body.name).toBe("acme");
    expect(body.members).toEqual([]);
  });

  test("git log failing -> lastPush is null, not the exit code or an empty string", async () => {
    const deps = clonedDeps({ exec: async () => ({ code: 128, stdout: "", stderr: "fatal: bad revision 'origin/main'" }) });

    await teamStatus(["--team", SLUG, "--json"], {}, deps);

    const body = JSON.parse(deps.lines[0]!);
    expect(body.lastPush).toBeNull();
  });

  test("no team cloned locally -> exits 2 with no-team", async () => {
    const deps = baseDeps({ probes: fakeProbes({ home: HOME }) }); // no team dir at all

    const code = await runExpectingProcessExit(() => teamStatus(["--team", SLUG, "--json"], {}, deps));

    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("no-team");
  });

  test("no --team and zero local teams -> mode solo, exit 0, in both output modes", async () => {
    const deps = baseDeps();
    await teamStatus(["--json"], {}, deps);
    expect(JSON.parse(deps.lines[0]!)).toMatchObject({ contract: 1, mode: "solo", slug: null, name: null, remote: null, lastPush: null, members: [], invites: [], adminSecrets: null, role: null, activeTeam: null, teams: [], orgTeams: [] });

    const text = baseDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus([], {}, text);
      expect(io.stdout()).toBe("[off] No team on this Mac  just you\n");
      expect(text.lines).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("two local teams and no --team -> still exits 2 with ambiguous-team, never solo", async () => {
    const teams = join(process.env.HOME!, ".mattstack", "orgs");
    for (const team of ["acme", "beta"]) {
      mkdirSync(join(teams, team, "mattstack", "org"), { recursive: true });
      writeFileSync(join(teams, team, "mattstack", "org", "settings.org.jsonc"), "{}");
    }
    try {
      const deps = baseDeps();
      const code = await runExpectingProcessExit(() => teamStatus(["--json"], {}, deps));
      expect(code).toBe(2);
      expect(JSON.parse(deps.lines[0]!).error.code).toBe("ambiguous-team");
    } finally {
      rmSync(teams, { recursive: true, force: true });
    }
  });

  test("a credential-bearing remote is stripped before it reaches the envelope", async () => {
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      gitConfig: `[remote "origin"]\n\turl = https://tok3n@github.com/acme/widgets.git\n`,
    });

    await teamStatus(["--team", SLUG, "--json"], {}, deps);

    const body = JSON.parse(deps.lines[0]!);
    expect(body.remote).toBe("https://github.com/acme/widgets.git");
    expect(deps.lines[0]).not.toContain("tok3n");
  });

  test("malformed mattstack.roster entries (null, a bare string, a non-string username) are filtered, not crashed on or leaked raw", async () => {
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      read: { "mattstack.roster": [null, "dev1", { username: { evil: 1 } }, { username: "dev2", teams: ["widgets"] }, {}] },
    });

    const io = captureOut();
    warnTest.reset();
    setWarningLog(() => {});
    try {
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
    } finally {
      warnTest.reset();
      io.restore();
    }

    const body = JSON.parse(deps.lines[0]!);
    expect(body.members).toEqual([{ username: "dev2", role: "member", peered: null }]);
  });

  test("a malformed roster entry warns on stderr and leaves the envelope alone", async () => {
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      read: { "mattstack.roster": [null, "dev1", { username: { evil: 1 } }, { username: "dev2", teams: ["widgets"] }, {}] },
    });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    warnTest.reset();
    setWarningLog(() => {});
    try {
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(deps.lines).toHaveLength(1);
      expect(JSON.parse(deps.lines[0]!).members).toEqual([{ username: "dev2", role: "member", peered: null }]);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("[warning] Some team members could not be read  4 left out\n");
    } finally {
      warnTest.reset();
      io.restore();
    }
  });

  describe("invites", () => {
    const invite = { handle: "alice", teams: ["widgets"], expiresAt: "2026-12-01T00:00:00.000Z", state: "replied" as const };
    const withSeam = (inviteStatuses: NonNullable<TeamDeps["inviteStatuses"]>) => ({
      ...clonedDeps({ exec: async () => ({ code: 0, stdout: "", stderr: "" }), read: { "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }] } }),
      inviteStatuses,
    });

    test("--json carries invites from the seam", async () => {
      const deps = withSeam(async () => ({ invites: [invite], relayFailed: false }));
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      const body = JSON.parse(deps.lines[0]!);
      expect(body.invites).toEqual([invite]);
      expect(Object.keys(body)).toEqual(expect.arrayContaining(["slug", "members", "role", "orgTeams", "pullOnly"]));
    });

    test("--json carries relayFailed from the seam", async () => {
      const failed = withSeam(async () => ({ invites: [], relayFailed: true }));
      await teamStatus(["--team", SLUG, "--json"], {}, failed);
      expect(JSON.parse(failed.lines[0]!).relayFailed).toBe(true);
      const ok = withSeam(async () => ({ invites: [], relayFailed: false }));
      await teamStatus(["--team", SLUG, "--json"], {}, ok);
      expect(JSON.parse(ok.lines[0]!).relayFailed).toBe(false);
    });

    test("--json carries an empty invites list with no records", async () => {
      const deps = withSeam(async () => ({ invites: [], relayFailed: false }));
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(JSON.parse(deps.lines[0]!).invites).toEqual([]);
    });

    test("the seam receives the full roster", async () => {
      let seen: unknown;
      const deps = withSeam(async (_slug, roster) => { seen = roster; return { invites: [], relayFailed: false }; });
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(seen).toEqual([{ username: "dev1", teams: ["widgets"] }]);
    });

    test("a throwing inviteStatuses seam still answers with invites: []", async () => {
      const deps = withSeam(async () => { throw new Error("damaged invite file"); });
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(JSON.parse(deps.lines[0]!).invites).toEqual([]);
    });

    test("human output names who is waiting", async () => {
      const deps = withSeam(async () => ({ invites: [invite], relayFailed: false }));
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      try {
        await teamStatus(["--team", SLUG], {}, deps);
        expect(io.stdout()).toContain("waiting to join: alice");
        expect(io.stdout()).toContain(`rt team members sync --team ${SLUG} adds them`);
      } finally {
        io.restore();
      }
    });

    test("human output notes an unreachable switchboard", async () => {
      const deps = withSeam(async () => ({ invites: [{ ...invite, state: "invited" as const }], relayFailed: true }));
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      try {
        await teamStatus(["--team", SLUG], {}, deps);
        expect(io.stdout()).toContain("waiting to join: unknown");
        expect(io.stdout()).toContain("the switchboard did not answer");
      } finally {
        io.restore();
      }
    });

    test("no row when nobody has replied", async () => {
      const deps = withSeam(async () => ({ invites: [{ ...invite, state: "invited" as const }], relayFailed: false }));
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      try {
        await teamStatus(["--team", SLUG], {}, deps);
        expect(io.stdout()).not.toContain("waiting to join");
      } finally {
        io.restore();
      }
    });
  });

  describe("admin secrets", () => {
    const syncRow = (detail: string): Row => row({ id: ADMIN_SECRETS_ROW_ID, kind: "access", title: "Admin-only secrets", why: "", required: false, status: "needs-you", detail, action: ADMIN_SECRETS_SYNC_STEPS });

    function adminDeps(username: string, adminSecretsState?: TeamDeps["adminSecretsState"]): TeamDeps & { lines: string[] } {
      return baseDeps({
        probes: fakeProbes({
          home: HOME,
          dirs: { [TEAM_DIR]: [] },
          files: {
            [join(TEAM_DIR, ".git", "config")]: GIT_CONFIG,
            [join(TEAM_DIR, "mattstack", "org", "settings.org.jsonc")]: JSON.stringify({ "mattstack.org": { owners: ["dev1"], admins: ["dev2"] } }),
            [join(HOME, ".mattstack", "rt", "teams", `${SLUG}.json`)]: JSON.stringify({ forgeUsername: username }),
          },
        }),
        statusRead: fakeRead({}),
        daemon: async () => null,
        ...(adminSecretsState ? { adminSecretsState } : {}),
      });
    }

    async function stateFor(rowValue: Row | null | Error, username = "dev1"): Promise<unknown> {
      const deps = adminDeps(username, async () => {
        if (rowValue instanceof Error) throw rowValue;
        return rowValue;
      });
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      return JSON.parse(deps.lines[0]!).adminSecrets;
    }

    test("no row reads current", async () => {
      expect(await stateFor(null)).toEqual({ state: "current", detail: null });
    });

    test("the plain sync steps read needs-sync with the row's detail", async () => {
      expect(await stateFor(syncRow("The org's owners and admins changed"))).toEqual({ state: "needs-sync", detail: "The org's owners and admins changed" });
    });

    test("any other needs-you reads needs-you", async () => {
      const mismatch = row({ ...syncRow("The org shares a different switchboard admin token from this Mac's"), action: { type: "steps", label: "Show steps…", steps: ["If this Mac's token is the newer one, run rt team admin-secrets --replace-token"] } });
      expect(await stateFor(mismatch)).toEqual({ state: "needs-you", detail: "The org shares a different switchboard admin token from this Mac's" });
    });

    test("skipped reads not-this-mac", async () => {
      expect(await stateFor({ ...syncRow("Check this row on the Mac whose key the roster holds"), status: "skipped", action: null })).toEqual({ state: "not-this-mac", detail: "Check this row on the Mac whose key the roster holds" });
    });

    test("error reads unknown", async () => {
      expect(await stateFor({ ...syncRow("sops failed"), status: "error" })).toEqual({ state: "unknown", detail: "sops failed" });
    });

    test("a throwing seam reads unknown and still answers", async () => {
      expect(await stateFor(new Error("keychain locked"))).toEqual({ state: "unknown", detail: "keychain locked" });
    });

    test("a check that never settles reads unknown at the deadline", async () => {
      const deps = { ...adminDeps("dev1", () => new Promise<Row | null>(() => {})), adminSecretsTimeoutMs: 20 };
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(JSON.parse(deps.lines[0]!).adminSecrets).toEqual({ state: "unknown", detail: "The admin secrets check took too long" });
    });

    test("the invite read and the admin secrets check run at the same time", async () => {
      let adminAsked!: () => void;
      const asked = new Promise<void>((resolve) => { adminAsked = resolve; });
      const deps = {
        ...adminDeps("dev1", async () => { adminAsked(); return null; }),
        inviteStatuses: async () => { await asked; return { invites: [], relayFailed: false }; },
        adminSecretsTimeoutMs: 1_000,
      };
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(JSON.parse(deps.lines[0]!).adminSecrets).toEqual({ state: "current", detail: null });
    });

    test("adminSecrets is the envelope's last key", async () => {
      const deps = adminDeps("dev1", async () => null);
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(Object.keys(JSON.parse(deps.lines[0]!)).at(-1)).toBe("adminSecrets");
    });

    test("an org admin gets it too", async () => {
      expect(await stateFor(null, "dev2")).toEqual({ state: "current", detail: null });
    });

    test("a member gets null and the seam is never asked", async () => {
      let asked = false;
      const deps = adminDeps("dev3", async () => { asked = true; return null; });
      await teamStatus(["--team", SLUG, "--json"], {}, deps);
      expect(JSON.parse(deps.lines[0]!).adminSecrets).toBeNull();
      expect(asked).toBe(false);
    });

    test("human output adds the admin secrets row only when they need updating", async () => {
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      try {
        await teamStatus(["--team", SLUG], {}, adminDeps("dev1", async () => syncRow("The org's owners and admins changed")));
        expect(io.stdout()).toContain("admin secrets: needs updating\n  rt team admin-secrets --team acme locks them to the current owners and admins\n");
        const before = io.stdout().length;
        await teamStatus(["--team", SLUG], {}, adminDeps("dev1", async () => null));
        expect(io.stdout().slice(before)).not.toContain("admin secrets");
      } finally {
        io.restore();
      }
    });
  });

  test("human mode names the team and remote", async () => {
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "2026-08-21T10:00:00+00:00\n", stderr: "" }),
      read: { "board.title": "Acme Team" },
    });

    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await teamStatus(["--team", SLUG], {}, deps);
      expect(io.lines()[0]).toBe(`Acme Team (${SLUG})`);
      expect(io.stdout()).toContain("widgets.git");
      expect(io.stdout()).toContain("last push: 2026-08-21T10:00:00+00:00\n");
      expect(io.stdout()).toContain("sync: unknown\n");
    } finally {
      io.restore();
    }
  });
});
