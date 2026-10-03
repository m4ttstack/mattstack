import { afterEach, beforeEach, describe, test, expect, spyOn } from "bun:test";
import { join } from "path";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { createTeam, defaultTeamName, scaffoldFiles } from "../create.ts";
import { UserActionableError } from "../../errors.ts";
import { readIntent } from "../../setup/intent.ts";
import { resetCltCacheForTests } from "../../setup/home-git.ts";
import { createRealProbes } from "../../setup/probes.ts";
import { getSetting } from "../../settings/resolve.ts";
import { readTeamLocal, updateTeamLocal } from "../team-local.ts";
import type { AgeExecResult, AgeKeySeam } from "../../home/age-key.ts";
import * as isolation from "../../../packages/rt-client/src/test-isolation.ts";

const FAKE_PUBLIC_KEY = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const FAKE_PRIVATE_KEY = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";

/** An age key already in the keychain — ensureAgeKey only derives its public half, never mints. */
class FakeAgeKeySeam implements AgeKeySeam {
  calls: string[][] = [];
  async run(cmd: string[]): Promise<AgeExecResult> {
    this.calls.push(cmd);
    if (cmd[1] === "find-generic-password") return { code: 0, stdout: `${FAKE_PRIVATE_KEY}\n`, stderr: "" };
    if (cmd[0] === "age-keygen" && cmd[1] === "-y") return { code: 0, stdout: `${FAKE_PUBLIC_KEY}\n`, stderr: "" };
    throw new Error(`FakeAgeKeySeam: unexpected call ${cmd.join(" ")}`);
  }
}

/** A settings store's content is a one-line header comment followed by the JSON body. */
function parseSettingsBody(content: string): Record<string, unknown> {
  return JSON.parse(content.split("\n").slice(1).join("\n"));
}

type FakeExecResult = { code: number; stdout: string; stderr: string };
type Intercept = (argv: string[], opts?: { cwd?: string }) => FakeExecResult | undefined;

/**
 * `createTeam`'s idempotency/resume logic reads `.git` and `.git/config` off
 * disk (mirroring `team-settings.ts`'s own `readTeamSnapshot`) — real git
 * writes both as a side effect of `init`/`remote add`, which a plain fake
 * exec has no side effect for on its own. This simulates just enough of
 * that for a resumed `createTeam` call to see what a previous call did.
 * `intercept` lets a test override one specific call (e.g. fail `git init`
 * once) while every other recognized git call still gets its default,
 * successful, side-effecting simulation.
 */
function gitAwareFakeProbes(home: string, intercept?: Intercept) {
  const p = fakeProbes({
    home,
    exec: (argv, execOpts) => {
      const override = intercept?.(argv, execOpts);
      if (override) return override;

      if (argv[0] === "git" && argv[1] === "init" && execOpts?.cwd) {
        p.mkdirp(join(execOpts.cwd, ".git"));
        return { code: 0, stdout: "", stderr: "" };
      }
      if (argv[0] === "git" && argv[1] === "remote" && argv[2] === "add" && execOpts?.cwd) {
        p.writeFile(join(execOpts.cwd, ".git", "config"), `[remote "origin"]\n\turl = ${argv[4]}\n`);
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  return p;
}

describe("scaffoldFiles", () => {
  const ORG_SETTINGS = "mattstack/org/settings.org.jsonc";
  const TEAM_SETTINGS = "mattstack/teams/acme/settings.team.jsonc";

  test("writes the org layout: marker, org store, one team folder, marketplace, sops rule", () => {
    const files = scaffoldFiles("acme", "Acme", "https://gitlab.example.com/g/acme.git");
    expect(Object.keys(files).sort()).toEqual([".claude-plugin/marketplace.json", ".gitignore", ".sops.yaml", "mattstack/mattstack.jsonc", ORG_SETTINGS, TEAM_SETTINGS].sort());
    expect(JSON.parse(files["mattstack/mattstack.jsonc"]!)).toEqual({ role: "org", org: "acme" });
  });

  test("gitlab remote: the org store holds the forge and board.gitlabHost", () => {
    const org = parseSettingsBody(scaffoldFiles("acme", "Acme", "https://gitlab.example.com/g/acme.git")[ORG_SETTINGS]!);
    expect(org["mattstack.integrations"]).toEqual({ forge: { host: "gitlab.example.com", provider: "gitlab" } });
    expect(org["board.gitlabHost"]).toBe("gitlab.example.com");
  });

  test("github remote: no board.gitlabHost key at all", () => {
    const org = parseSettingsBody(scaffoldFiles("acme", "Acme", "https://github.com/acme/mattstack-team-acme.git")[ORG_SETTINGS]!);
    expect("board.gitlabHost" in org).toBe(false);
  });

  test("the display name is the first team's board title", () => {
    const team = parseSettingsBody(scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git")[TEAM_SETTINGS]!);
    expect(team).toEqual({ "board.title": "Acme" });
  });

  test("board.projects is never written: a present value would claim repos nobody chose", () => {
    const files = scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git");
    expect("board.projects" in parseSettingsBody(files[ORG_SETTINGS]!)).toBe(false);
    expect("board.projects" in parseSettingsBody(files[TEAM_SETTINGS]!)).toBe(false);
  });

  test("a named first team gets its own folder", () => {
    const files = scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git", [], "widgets");
    expect(files["mattstack/teams/widgets/settings.team.jsonc"]).toBeDefined();
    expect(files[TEAM_SETTINGS]).toBeUndefined();
  });

  test("seeds .sops.yaml with the given recipients, not empty", () => {
    const files = scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git", [FAKE_PUBLIC_KEY]);
    expect(files[".sops.yaml"]).toContain(FAKE_PUBLIC_KEY);
  });
});

describe("defaultTeamName", () => {
  test("the org slug when it is a team name", () => {
    expect(defaultTeamName("acme")).toBe("acme");
    expect(defaultTeamName("acme-labs")).toBe("acme-labs");
  });
  test("a slug that starts with a digit gets a team- prefix", () => {
    expect(defaultTeamName("3d-tools")).toBe("team-3d-tools");
  });
});

describe("createTeam", () => {
  beforeEach(() => resetCltCacheForTests());

  describe("in a test run whose home is the account's", () => {
    let accountHomeSpy: ReturnType<typeof spyOn> | undefined;
    afterEach(() => accountHomeSpy?.mockRestore());

    test("refuses before creating the zone, so no team store is scaffolded", async () => {
      accountHomeSpy = spyOn(isolation, "accountHome").mockReturnValue("/home/x");
      const p = gitAwareFakeProbes("/home/x");
      await expect(
        createTeam(p, { name: "Acme", remote: "https://github.com/acme/mattstack-team-acme.git", others: false }, new FakeAgeKeySeam()),
      ).rejects.toThrow(/Run bun test from the repo root/);
      expect(p.exists(join("/home/x", ".mattstack", "teams", "acme"))).toBe(false);
      expect(p.calls.exec).toEqual([]);
    });
  });

  test("argv sequence is CLT probe → init → remote add → add → commit, never push", async () => {
    const p = gitAwareFakeProbes("/home/x");
    const result = await createTeam(
      p,
      { name: "Acme", remote: "https://github.com/acme/mattstack-team-acme.git", others: false },
      new FakeAgeKeySeam(),
    );

    expect(result.team).toBe("acme");
    expect(result).toEqual({
      slug: "acme",
      team: "acme",
      name: "Acme",
      remote: "https://github.com/acme/mattstack-team-acme.git",
      dir: join("/home/x", ".mattstack", "teams", "acme"),
      created: true,
    });

    expect(p.calls.exec).toEqual([
      ["xcode-select", "-p"],
      ["git", "init", "-b", "main"],
      ["git", "remote", "add", "origin", "https://github.com/acme/mattstack-team-acme.git"],
      ["git", "add", "-A"],
      ["git", "commit", "-m", "team: scaffold acme"],
    ]);
  });

  test("writes the setup intent for the daemon/apply to resume from", async () => {
    const p = gitAwareFakeProbes("/home/x");
    await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: true }, new FakeAgeKeySeam());

    const intent = readIntent(p);
    expect(intent?.mode).toBe("create");
    expect(intent?.team).toEqual({ slug: "acme", name: "Acme", remote: "https://github.com/acme/repo.git", others: true });
  });

  test("missing remote and --create-repo throws remote-required", async () => {
    const p = gitAwareFakeProbes("/home/x");
    await expect(createTeam(p, { name: "Acme", remote: null, others: false }, new FakeAgeKeySeam())).rejects.toMatchObject({
      code: "remote-required",
    });
    expect(p.calls.exec).toEqual([]);
  });

  // The Team screen runs this before the checklist installs CLT; on a clean
  // Mac /usr/bin/git is Apple's stub, which fails and pops the install dialog.
  test("no CLT yet: scaffolds files and intent without touching git, and reports the deferral", async () => {
    const noClt: Intercept = (argv) => (argv[0] === "xcode-select" ? { code: 2, stdout: "", stderr: "xcode-select: error: unable to get active developer directory" } : undefined);
    const p = gitAwareFakeProbes("/home/x", noClt);
    const result = await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam());

    expect(result).toMatchObject({ slug: "acme", created: true, gitDeferred: true });
    expect(p.calls.exec.filter((c) => c[0] === "git")).toEqual([]);
    const dir = join("/home/x", ".mattstack", "teams", "acme");
    expect(p.exists(join(dir, "mattstack", "mattstack.jsonc"))).toBe(true);
    expect(p.exists(join(dir, ".git"))).toBe(false);
    expect(readIntent(p)?.team).toEqual({ slug: "acme", name: "Acme", remote: "https://github.com/acme/repo.git", others: false });
  });

  test("the Install re-run finishes a git-deferred zone: init → remote add → add → commit, scaffold kept", async () => {
    let cltInstalled = false;
    const clt: Intercept = (argv) => (argv[0] === "xcode-select" && !cltInstalled ? { code: 2, stdout: "", stderr: "" } : undefined);
    const p = gitAwareFakeProbes("/home/x", clt);
    const opts = { name: "Acme", remote: "https://github.com/acme/repo.git", others: false };
    await createTeam(p, opts, new FakeAgeKeySeam());
    const dir = join("/home/x", ".mattstack", "teams", "acme");
    p.writeFile(join(dir, "mattstack", "org", "settings.org.jsonc"), "// edited before CLT arrived\n{}");
    p.calls.exec.length = 0;

    cltInstalled = true;
    const result = await createTeam(p, opts, new FakeAgeKeySeam());

    expect(result).toMatchObject({ created: true });
    expect(result.gitDeferred).toBeUndefined();
    expect(p.calls.exec.filter((c) => c[0] === "git")).toEqual([
      ["git", "init", "-b", "main"],
      ["git", "remote", "add", "origin", "https://github.com/acme/repo.git"],
      ["git", "add", "-A"],
      ["git", "commit", "-m", "team: scaffold acme"],
    ]);
    expect(p.readFile(join(dir, "mattstack", "org", "settings.org.jsonc"))).toBe("// edited before CLT arrived\n{}");
  });

  test("--create-repo o creates o/mattstack-team-<slug> via gh and the printed URL becomes the remote", async () => {
    const p = gitAwareFakeProbes("/home/x", (argv) => (argv[0] === "gh" ? { code: 0, stdout: "https://github.com/o/mattstack-team-acme\n", stderr: "" } : undefined));
    const result = await createTeam(p, { name: "Acme", remote: null, createRepoOwner: "o", others: false }, new FakeAgeKeySeam());

    expect(p.calls.exec[0]).toEqual(["gh", "repo", "create", "o/mattstack-team-acme", "--private"]);
    expect(result.remote).toBe("https://github.com/o/mattstack-team-acme");
  });

  test("a stale joinedByRt from an earlier joined-then-deleted clone of the same slug is cleared, not merged forward", async () => {
    const p = gitAwareFakeProbes("/home/x", (argv) => (argv[0] === "gh" ? { code: 0, stdout: "https://github.com/o/mattstack-team-acme\n", stderr: "" } : undefined));
    // Simulates: joined "acme" earlier (stamping joinedByRt), then deleted
    // ~/.mattstack/teams/acme by hand; the local record survives the delete.
    updateTeamLocal(p, "acme", { joinedByRt: true });

    await createTeam(p, { name: "Acme", remote: null, createRepoOwner: "o", others: false }, new FakeAgeKeySeam());

    expect(readTeamLocal(p, "acme")).toEqual({ createdByRt: true, joinedByRt: false, rtMayManageMembership: false });
  });

  test("second call with the same remote is idempotent: created:false, zero git calls, intent (re)written", async () => {
    const p = gitAwareFakeProbes("/home/x");
    await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam());
    p.calls.exec.length = 0;
    const writePathsBefore = Object.keys(p.calls.writes).sort();

    const result = await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam());

    expect(result.created).toBe(false);
    expect(result.remote).toBe("https://github.com/acme/repo.git");
    expect(p.calls.exec).toEqual([]);
    // The intent file is refreshed (finding 8), but no NEW path is ever written on the idempotent path — no scaffold file is rewritten.
    expect(Object.keys(p.calls.writes).sort()).toEqual(writePathsBefore);
    expect(readIntent(p)?.team?.remote).toBe("https://github.com/acme/repo.git");
  });

  test("existing dir with a different remote throws team-exists", async () => {
    const p = gitAwareFakeProbes("/home/x");
    await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam());

    await expect(
      createTeam(p, { name: "Acme", remote: "https://github.com/other/repo.git", others: false }, new FakeAgeKeySeam()),
    ).rejects.toMatchObject({ code: "team-exists" });
  });

  test("a second team on a machine that already has one is refused before any zone or git work", async () => {
    const p = gitAwareFakeProbes("/home/x");
    p.mkdirp(join("/home/x", ".mattstack", "teams", "globex"));
    p.writeFile(join("/home/x", ".mattstack", "teams", "globex", "mattstack", "org", "settings.org.jsonc"), "{}");

    await expect(
      createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam()),
    ).rejects.toMatchObject({
      code: "team-already-set-up",
      message: "This Mac is already set up for the globex team, and mattstack supports one team per machine today",
    });

    expect(p.exists(join("/home/x", ".mattstack", "teams", "acme"))).toBe(false);
    expect(p.calls.exec).toEqual([]);
    expect(readIntent(p)).toBeNull();
  });

  describe("partial-zone resume (R-T16-b)", () => {
    test("--remote path: git init fails, then a re-run with the same args finishes the zone", async () => {
      let initCalls = 0;
      const p = gitAwareFakeProbes("/home/x", (argv) => {
        if (argv[0] === "git" && argv[1] === "init") {
          initCalls += 1;
          if (initCalls === 1) return { code: 128, stdout: "", stderr: "fatal: could not create work tree dir" };
        }
        return undefined;
      });

      await expect(
        createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam()),
      ).rejects.toBeInstanceOf(UserActionableError);

      // Second call succeeds and finishes the zone.
      const result = await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam());
      expect(result.created).toBe(true);
      expect(result.remote).toBe("https://github.com/acme/repo.git");
      expect(initCalls).toBe(2);
    });

    test("--create-repo path: gh succeeds, git init then fails, and a resume finishes WITHOUT calling gh a second time", async () => {
      let initCalls = 0;
      const p = gitAwareFakeProbes("/home/x", (argv) => {
        if (argv[0] === "gh") return { code: 0, stdout: "https://github.com/o/mattstack-team-acme\n", stderr: "" };
        if (argv[0] === "git" && argv[1] === "init") {
          initCalls += 1;
          if (initCalls === 1) return { code: 128, stdout: "", stderr: "fatal: could not create work tree dir" };
        }
        return undefined;
      });

      await expect(
        createTeam(p, { name: "Acme", remote: null, createRepoOwner: "o", others: false }, new FakeAgeKeySeam()),
      ).rejects.toMatchObject({ code: "git-init-failed" });

      const result = await createTeam(p, { name: "Acme", remote: null, createRepoOwner: "o", others: false }, new FakeAgeKeySeam());

      expect(result.created).toBe(true);
      expect(result.remote).toBe("https://github.com/o/mattstack-team-acme");
      expect(initCalls).toBe(2);
      const ghCalls = p.calls.exec.filter((c) => c[0] === "gh");
      expect(ghCalls).toHaveLength(1); // never re-created the already-existing gh repo
    });

    test("a failed git step keeps git's output, URLs stripped, in the log and out of the message", async () => {
      const p = gitAwareFakeProbes("/home/x", (argv) =>
        argv[0] === "git" && argv[1] === "init" ? { code: 128, stdout: "", stderr: "fatal: could not reach https://x-access-token:SECRET@github.com/o/r.git" } : undefined,
      );

      const err = await createTeam(p, { name: "Acme", remote: "https://github.com/o/r.git", others: false }, new FakeAgeKeySeam()).catch((e: unknown) => e);

      expect(err).toMatchObject({ code: "git-init-failed", message: "rt could not start the team repo" });
      const log = (err as UserActionableError).log ?? "";
      expect(log).toStartWith("git init -b main failed (exit 128): fatal: could not reach");
      expect(log).not.toContain("SECRET");
      expect(log).not.toContain("https://");
    });

    test("never returns remote:'' — an incomplete zone is always a typed error, not a silent success", async () => {
      const p = gitAwareFakeProbes("/home/x", (argv) => (argv[0] === "git" && argv[1] === "init" ? { code: 1, stdout: "", stderr: "boom" } : undefined));

      let thrown: unknown;
      try {
        await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam());
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(UserActionableError);
      expect((thrown as UserActionableError).code).not.toBe("");
    });
  });

  describe("populated-zone re-run is non-destructive (R-T16-b / finding 9)", () => {
    test("existing settings, a multi-recipient .sops.yaml, and a secret file all survive an idempotent re-run", async () => {
      const p = gitAwareFakeProbes("/home/x");
      const dir = join("/home/x", ".mattstack", "teams", "acme");
      const remote = "https://github.com/acme/repo.git";

      const customSettings = '// hand-edited\n{"board.title":"Acme (real)"}\n';
      const customSops = "creation_rules:\n  - path_regex: mattstack/secrets/.*\n    age: age1aaa,age1bbb\n";
      const secretBlob = '{"rt":{"switchboardAdminToken":"sops-encrypted-blob"}}';

      p.writeFile(join(dir, ".git", "config"), `[remote "origin"]\n\turl = ${remote}\n`);
      p.writeFile(join(dir, "mattstack", "mattstack.jsonc"), '{"role":"team","namespace":"acme","org":"acme"}\n');
      p.writeFile(join(dir, "mattstack", "org", "settings.org.jsonc"), customSettings);
      p.writeFile(join(dir, ".sops.yaml"), customSops);
      p.writeFile(join(dir, "mattstack", "secrets", "rt.json"), secretBlob);
      p.calls.writes = {};
      p.calls.exec.length = 0;

      const result = await createTeam(p, { name: "Acme", remote, others: false }, new FakeAgeKeySeam());

      expect(result.created).toBe(false);
      expect(p.calls.exec).toEqual([]);
      // The only permitted write on this path is the runtime intent — every zone file is untouched.
      expect(Object.keys(p.calls.writes)).toEqual(["/home/x/.mattstack/rt/setup-intent.json"]);
      expect(p.readFile(join(dir, "mattstack", "org", "settings.org.jsonc"))).toBe(customSettings);
      expect(p.readFile(join(dir, ".sops.yaml"))).toBe(customSops);
      expect(p.readFile(join(dir, "mattstack", "secrets", "rt.json"))).toBe(secretBlob);
    });
  });
});

describe("createTeam (real fs + real git, fake age key only) — R-T16-a / finding 9b", () => {
  test("a pre-existing board config's ownership latch is not flipped, and the on-disk .sops.yaml carries the creator's real key", async () => {
    const origHome = process.env.HOME;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-team-create-e2e-")));
    process.env.HOME = home;
    try {
      const p = createRealProbes();
      const result = await createTeam(
        p,
        { name: "Acme", remote: "https://github.com/acme/repo.git", others: false },
        new FakeAgeKeySeam(),
      );

      expect(result.created).toBe(true);
      expect(getSetting<unknown[]>("board.projects").value).toBeUndefined();
      expect(getSetting<unknown[]>("board.members").value).toBeUndefined();
      expect(parseSettingsBody(p.readFile(join(result.dir, "mattstack", "teams", "acme", "settings.team.jsonc"))!)["board.title"]).toBe("Acme");

      const sopsYaml = p.readFile(join(result.dir, ".sops.yaml"));
      expect(sopsYaml).toContain(`age: ${FAKE_PUBLIC_KEY}`);
    } finally {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
