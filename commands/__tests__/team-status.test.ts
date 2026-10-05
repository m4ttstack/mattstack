import { describe, test, expect, spyOn } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { teamStatus, type TeamDeps } from "../team.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import type { SettingsReader } from "../../lib/setup/team-settings.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../lib/ui/warn.ts";

const HOME = "/home/x";
const SLUG = "acme";
const TEAM_DIR = join(HOME, ".mattstack", "teams", SLUG);
const GIT_CONFIG = `[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n`;

function baseDeps(overrides: Partial<TeamDeps> = {}): TeamDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    probes: fakeProbes({ home: HOME }),
    print: (s: string) => lines.push(s),
    lines,
    ...overrides,
  };
}

function fakeRead(values: Record<string, unknown>): SettingsReader {
  return <T>(key: string): T | undefined => values[key] as T | undefined;
}

function clonedDeps(overrides: { exec?: TeamDeps["probes"]["exec"]; read?: Record<string, unknown>; gitConfig?: string } = {}): TeamDeps & { lines: string[] } {
  return baseDeps({
    probes: fakeProbes({
      home: HOME,
      dirs: { [TEAM_DIR]: [] },
      files: { [join(TEAM_DIR, ".git", "config")]: overrides.gitConfig ?? GIT_CONFIG },
      exec: overrides.exec,
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

    test("an admin sees active-team members and sorted valid team folders with settings", async () => {
      expect(await status("dev1")).toMatchObject({ slug: "acme", name: "Acme Team", role: "admin", activeTeam: "widgets", teams: ["widgets"], orgTeams: ["gadgets", "widgets"], members: [{ username: "dev1" }, { username: "dev2" }] });
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
      ui.__test__.setHuman(() => false);
      try {
        await teamStatus(["--team", SLUG], {}, depsFor("dev1"));
        expect(io.stdout()).toContain("Acme Team (acme)\n");
        expect(io.stdout()).toContain("your team: widgets\n");
        expect(io.stdout()).toContain("your role: org admin\n");
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
      lastPush: "2026-08-21T10:00:00+00:00",
      members: [{ username: "dev1" }],
      role: "unknown",
      activeTeam: null,
      teams: [],
      orgTeams: [],
      lastPull: null,
      lastPushAt: null,
      lastPullSkipped: null,
      conflicted: null,
      pullOnly: false,
    });
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
    expect(JSON.parse(deps.lines[0]!)).toMatchObject({ contract: 1, mode: "solo", slug: null, name: null, remote: null, lastPush: null, members: [], role: null, activeTeam: null, teams: [], orgTeams: [] });

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
    const teams = join(process.env.HOME!, ".mattstack", "teams");
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
    expect(body.members).toEqual([{ username: "dev2" }]);
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
      expect(JSON.parse(deps.lines[0]!).members).toEqual([{ username: "dev2" }]);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("[warning] Some team members could not be read  4 left out\n");
    } finally {
      warnTest.reset();
      io.restore();
    }
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
