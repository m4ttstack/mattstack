import { afterEach, beforeEach, describe, test, expect, spyOn } from "bun:test";
import { join } from "path";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { childEnv } from "../../subprocess.ts";
import { tmpdir } from "os";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { commitFiles, createTeam, defaultTeamName, scaffoldFiles, withCreator, claimPendingAdmin } from "../create.ts";
import { UserActionableError } from "../../errors.ts";
import { recordForgeIdentity } from "../../setup/steps/org.ts";
import { clearIntent, readIntent } from "../../setup/intent.ts";
import { resetCltCacheForTests } from "../../setup/home-git.ts";
import { createRealProbes } from "../../setup/probes.ts";
import { getSetting } from "../../settings/resolve.ts";
import { readTeamLocal, updateTeamLocal } from "../team-local.ts";
import type { AgeExecResult, AgeKeySeam } from "../../home/age-key.ts";
import * as isolation from "../../../packages/rt-client/src/test-isolation.ts";

const seams = { forgeLogin: async () => "dev1", forgeToken: async () => null };

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
      if (argv.includes("get-url")) return { code: 0, stdout: "https://github.com/acme/repo.git\n", stderr: "" };
      if (argv.includes("symbolic-ref")) return { code: 0, stdout: "main\n", stderr: "" };
      if (argv.includes("ls-remote")) return { code: 0, stdout: "", stderr: "" };
      const override = intercept?.(argv, execOpts);
      if (override) return override;

      if (argv[0] === "git" && argv[1] === "diff" && argv.includes("--quiet")) return { code: 1, stdout: "", stderr: "" };
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
    expect(JSON.parse(files["mattstack/mattstack.jsonc"]!)).toEqual({ role: "org", org: "acme", layout: 2 });
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
    expect(files[".sops.yaml"]).toContain("mattstack/org/secrets/.*");
    expect(files[".gitignore"]).toBe("mattstack/org/secrets/*.tmp\n.DS_Store\n");
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
        createTeam(p, { name: "Acme", remote: "https://github.com/acme/mattstack-team-acme.git", others: false }, new FakeAgeKeySeam(), seams),
      ).rejects.toThrow(/Run bun test from the repo root/);
      expect(p.exists(join("/home/x", ".mattstack", "orgs", "acme"))).toBe(false);
      expect(p.calls.exec).toEqual([]);
    });
  });

  test("a failed scaffold commit is not success because its text says nothing to commit", async () => {
    const p = gitAwareFakeProbes("/home/x", (argv) => argv[0] === "git" && argv[1] === "commit" ? { code: 1, stdout: "", stderr: "nothing to commit; fake commit failure" } : undefined);
    await expect(createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams)).rejects.toMatchObject({ code: "git-commit-failed" });
    expect(readTeamLocal(p, "acme").creatorPending).toEqual({ team: "acme", agePublicKey: FAKE_PUBLIC_KEY });
  });

  test("commitFiles unstages its paths when git add fails part way, and says whether it committed", async () => {
    const failing = gitAwareFakeProbes("/home/x", (argv) => (argv[1] === "add" ? { code: 128, stdout: "", stderr: "fatal: unable to index file" } : undefined));
    await expect(commitFiles(failing, "acme", ["a", "b"], "m")).rejects.toMatchObject({ code: "git-add-failed" });
    expect(failing.calls.exec).toContainEqual(["git", "reset", "-q", "--", "a", "b"]);

    const clean = gitAwareFakeProbes("/home/x", (argv) => (argv[1] === "diff" ? { code: 0, stdout: "", stderr: "" } : undefined));
    expect(await commitFiles(clean, "acme", ["a"], "m")).toBe(false);
    expect(await commitFiles(gitAwareFakeProbes("/home/x"), "acme", ["a"], "m")).toBe(true);
  });

  test("argv sequence is CLT probe → init → remote add → add → commit, never push", async () => {
    const p = gitAwareFakeProbes("/home/x");
    const result = await createTeam(
      p,
      { name: "Acme", remote: "https://github.com/acme/mattstack-team-acme.git", others: false },
      new FakeAgeKeySeam(),
      seams,
    );

    expect(result.team).toBe("acme");
    expect(result).toEqual({
      slug: "acme",
      team: "acme",
      name: "Acme",
      remote: "https://github.com/acme/mattstack-team-acme.git",
      dir: join("/home/x", ".mattstack", "orgs", "acme"),
      created: true,
    });

    expect(p.calls.exec).toEqual([
      ["xcode-select", "-p"],
      ["git", "init", "-b", "main"],
      ["git", "remote", "add", "origin", "https://github.com/acme/mattstack-team-acme.git"],
      ["git", "add", "--", "mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"],
      ["git", "diff", "--cached", "--quiet", "--", "mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"],
      ["git", "commit", "-m", "team: scaffold acme", "--", "mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"],
    ]);
  });

  test("writes the setup intent for the daemon/apply to resume from", async () => {
    const p = gitAwareFakeProbes("/home/x");
    await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: true }, new FakeAgeKeySeam(), seams);

    const intent = readIntent(p);
    expect(intent?.mode).toBe("create");
    expect(intent?.team).toEqual({ slug: "acme", name: "Acme", remote: "https://github.com/acme/repo.git", others: true, firstTeam: "acme" });
  });

  test("missing remote and --create-repo throws remote-required", async () => {
    const p = gitAwareFakeProbes("/home/x");
    await expect(createTeam(p, { name: "Acme", remote: null, others: false }, new FakeAgeKeySeam(), seams)).rejects.toMatchObject({
      code: "remote-required",
    });
    expect(p.calls.exec).toEqual([]);
  });

  // The Team screen runs this before the checklist installs CLT; on a clean
  // Mac /usr/bin/git is Apple's stub, which fails and pops the install dialog.
  test("no CLT yet: scaffolds files and intent without touching git, and reports the deferral", async () => {
    const noClt: Intercept = (argv) => (argv[0] === "xcode-select" ? { code: 2, stdout: "", stderr: "xcode-select: error: unable to get active developer directory" } : undefined);
    const p = gitAwareFakeProbes("/home/x", noClt);
    const result = await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams);

    expect(result).toMatchObject({ slug: "acme", created: true, gitDeferred: true });
    expect(p.calls.exec.filter((c) => c[0] === "git")).toEqual([]);
    const dir = join("/home/x", ".mattstack", "orgs", "acme");
    expect(p.exists(join(dir, "mattstack", "mattstack.jsonc"))).toBe(true);
    expect(p.exists(join(dir, ".git"))).toBe(false);
    expect(readIntent(p)?.team).toEqual({ slug: "acme", name: "Acme", remote: "https://github.com/acme/repo.git", others: false, firstTeam: "acme" });
  });

  test("the Install re-run finishes a git-deferred zone: init → remote add → add → commit, scaffold kept", async () => {
    let cltInstalled = false;
    const clt: Intercept = (argv) => (argv[0] === "xcode-select" && !cltInstalled ? { code: 2, stdout: "", stderr: "" } : undefined);
    const p = gitAwareFakeProbes("/home/x", clt);
    const opts = { name: "Acme", remote: "https://github.com/acme/repo.git", others: false };
    await createTeam(p, opts, new FakeAgeKeySeam(), seams);
    const dir = join("/home/x", ".mattstack", "orgs", "acme");
    p.writeFile(join(dir, "mattstack", "org", "settings.org.jsonc"), withCreator("// edited before CLT arrived\n{}", "acme", { username: "dev1", agePublicKey: FAKE_PUBLIC_KEY }));
    p.calls.exec.length = 0;

    cltInstalled = true;
    const result = await createTeam(p, opts, new FakeAgeKeySeam(), seams);

    expect(result).toMatchObject({ created: true });
    expect(result.gitDeferred).toBeUndefined();
    expect(p.calls.exec.filter((c) => c[0] === "git")).toEqual([
      ["git", "init", "-b", "main"],
      ["git", "remote", "add", "origin", "https://github.com/acme/repo.git"],
      ["git", "add", "--", "mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"],
      ["git", "diff", "--cached", "--quiet", "--", "mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"],
      ["git", "commit", "-m", "team: scaffold acme", "--", "mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"],
    ]);
    expect(p.readFile(join(dir, "mattstack", "org", "settings.org.jsonc"))).toBe(withCreator("// edited before CLT arrived\n{}", "acme", { username: "dev1", agePublicKey: FAKE_PUBLIC_KEY }));
  });

  test("--create-repo o creates o/mattstack-team-<slug> via gh and the printed URL becomes the remote", async () => {
    const p = gitAwareFakeProbes("/home/x", (argv) => (argv[0] === "gh" ? { code: 0, stdout: "https://github.com/o/mattstack-team-acme\n", stderr: "" } : undefined));
    const result = await createTeam(p, { name: "Acme", remote: null, createRepoOwner: "o", others: false }, new FakeAgeKeySeam(), seams);

    expect(p.calls.exec[0]).toEqual(["gh", "repo", "create", "o/mattstack-team-acme", "--private"]);
    expect(result.remote).toBe("https://github.com/o/mattstack-team-acme");
  });

  test("a stale joinedByRt from an earlier joined-then-deleted clone of the same slug is cleared, not merged forward", async () => {
    const p = gitAwareFakeProbes("/home/x", (argv) => (argv[0] === "gh" ? { code: 0, stdout: "https://github.com/o/mattstack-team-acme\n", stderr: "" } : undefined));
    // Simulates: joined "acme" earlier (stamping joinedByRt), then deleted
    // ~/.mattstack/orgs/acme by hand; the local record survives the delete.
    updateTeamLocal(p, "acme", { joinedByRt: true });

    await createTeam(p, { name: "Acme", remote: null, createRepoOwner: "o", others: false }, new FakeAgeKeySeam(), seams);

    expect(readTeamLocal(p, "acme")).toEqual({ createdByRt: true, joinedByRt: false, rtMayManageMembership: false, forgeUsername: "dev1" });
  });

  test("second call with the same remote only checks the committed scaffold and refreshes intent", async () => {
    const p = gitAwareFakeProbes("/home/x");
    await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams);
    p.calls.exec.length = 0;
    const writePathsBefore = Object.keys(p.calls.writes).sort();

    const result = await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams);

    expect(result.created).toBe(false);
    expect(result.remote).toBe("https://github.com/acme/repo.git");
    expect(p.calls.exec).toEqual(["mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"].map((path) => ["git", "cat-file", "-e", `HEAD:${path}`]));
    // The intent file is refreshed (finding 8), but no NEW path is ever written on the idempotent path — no scaffold file is rewritten.
    expect(Object.keys(p.calls.writes).sort()).toEqual(writePathsBefore);
    expect(readIntent(p)?.team?.remote).toBe("https://github.com/acme/repo.git");
  });

  test("existing dir with a different remote throws team-exists", async () => {
    const p = gitAwareFakeProbes("/home/x");
    await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams);

    await expect(
      createTeam(p, { name: "Acme", remote: "https://github.com/other/repo.git", others: false }, new FakeAgeKeySeam(), seams),
    ).rejects.toMatchObject({ code: "team-exists" });
  });

  test("a second team on a machine that already has one is refused before any zone or git work", async () => {
    const p = gitAwareFakeProbes("/home/x");
    p.mkdirp(join("/home/x", ".mattstack", "orgs", "globex"));
    p.writeFile(join("/home/x", ".mattstack", "orgs", "globex", "mattstack", "org", "settings.org.jsonc"), "{}");

    await expect(
      createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams),
    ).rejects.toMatchObject({
      code: "team-already-set-up",
      message: "This Mac is already set up for the globex team, and mattstack supports one team per machine today",
    });

    expect(p.exists(join("/home/x", ".mattstack", "orgs", "acme"))).toBe(false);
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
        createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams),
      ).rejects.toBeInstanceOf(UserActionableError);

      // Second call succeeds and finishes the zone.
      const result = await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams);
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
        createTeam(p, { name: "Acme", remote: null, createRepoOwner: "o", others: false }, new FakeAgeKeySeam(), seams),
      ).rejects.toMatchObject({ code: "git-init-failed" });

      const result = await createTeam(p, { name: "Acme", remote: null, createRepoOwner: "o", others: false }, new FakeAgeKeySeam(), seams);

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

      const err = await createTeam(p, { name: "Acme", remote: "https://github.com/o/r.git", others: false }, new FakeAgeKeySeam(), seams).catch((e: unknown) => e);

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
        await createTeam(p, { name: "Acme", remote: "https://github.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), seams);
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
      const dir = join("/home/x", ".mattstack", "orgs", "acme");
      const remote = "https://github.com/acme/repo.git";

      const customSettings = withCreator('// hand-edited\n{"board.title":"Acme (real)"}\n', "acme", { username: "dev1" });
      const customSops = "creation_rules:\n  - path_regex: mattstack/org/secrets/.*\n    age: age1aaa,age1bbb\n";
      const secretBlob = '{"rt":{"switchboardAdminToken":"sops-encrypted-blob"}}';

      p.writeFile(join(dir, ".git", "config"), `[remote "origin"]\n\turl = ${remote}\n`);
      p.writeFile(join(dir, "mattstack", "mattstack.jsonc"), '{"role":"team","namespace":"acme","org":"acme"}\n');
      p.writeFile(join(dir, "mattstack", "org", "settings.org.jsonc"), customSettings);
      p.writeFile(join(dir, ".sops.yaml"), customSops);
      p.writeFile(join(dir, "mattstack", "org", "secrets", "rt.json"), secretBlob);
      updateTeamLocal(p, "acme", { forgeUsername: "dev1" });
      p.calls.writes = {};
      p.calls.exec.length = 0;

      const result = await createTeam(p, { name: "Acme", remote, others: false }, new FakeAgeKeySeam(), seams);

      expect(result.created).toBe(false);
      expect(p.calls.exec).toEqual(["mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"].map((path) => ["git", "cat-file", "-e", `HEAD:${path}`]));
      // The only permitted write on this path is the runtime intent — every zone file is untouched.
      expect(Object.keys(p.calls.writes)).toEqual(["/home/x/.mattstack/rt/setup-intent.json"]);
      expect(p.readFile(join(dir, "mattstack", "org", "settings.org.jsonc"))).toBe(customSettings);
      expect(p.readFile(join(dir, ".sops.yaml"))).toBe(customSops);
      expect(p.readFile(join(dir, "mattstack", "org", "secrets", "rt.json"))).toBe(secretBlob);
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
      seams,
      );

      expect(result.created).toBe(true);
      expect(getSetting<unknown[]>("board.projects").value).toBeUndefined();
      expect(getSetting<string>("board.title").value).toBe("Acme");

      const sopsYaml = p.readFile(join(result.dir, ".sops.yaml"));
      expect(sopsYaml).toContain(`age: ${FAKE_PUBLIC_KEY}`);
    } finally {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("the creator", () => {
  const HOME = "/home/x";
  const seams = { forgeLogin: async () => "dev1", forgeToken: async () => null };
  const unknown = { forgeLogin: async () => null, forgeToken: async () => null };
  const ORG_STORE = `${HOME}/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc`;
  const GITHUB = { name: "Acme", remote: "https://github.com/acme/repo.git", others: false };
  const orgStore = (p: ReturnType<typeof gitAwareFakeProbes>) => parseSettingsBody(p.readFile(ORG_STORE)!);

  test("withCreator makes them the org's admin, the first team's owner, and the first roster member, and keeps the header", () => {
    const before = scaffoldFiles("acme", "Acme", "https://github.com/acme/repo.git", [FAKE_PUBLIC_KEY], "widgets")["mattstack/org/settings.org.jsonc"]!;
    const after = withCreator(before, "widgets", { username: "dev1", agePublicKey: FAKE_PUBLIC_KEY });
    expect(after.split("\n")[0]).toBe(before.split("\n")[0]!);
    const org = parseSettingsBody(after);
    expect(org["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
    expect(org["mattstack.roster"]).toEqual([{ username: "dev1", agePublicKey: FAKE_PUBLIC_KEY, teams: ["widgets"] }]);
  });

  test("withCreator never replaces an admin the store already names", () => {
    const once = withCreator(`{ "board.title": "Acme" }`, "widgets", { username: "dev1" });
    expect(withCreator(once, "widgets", { username: "dev2" })).toBe(once);
  });

  test("a create whose forge login is known records it and writes the roles", async () => {
    const p = gitAwareFakeProbes(HOME);
    const result = await createTeam(p, GITHUB, new FakeAgeKeySeam(), seams);
    expect(result.team).toBe("acme");
    expect(result.rolesDeferred).toBeUndefined();
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
    expect(orgStore(p)["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { acme: { owners: ["dev1"] } } });
    expect(orgStore(p)["mattstack.roster"]).toEqual([{ username: "dev1", agePublicKey: FAKE_PUBLIC_KEY, teams: ["acme"] }]);
  });

  test("--first-team names the first team folder and its owner entry", async () => {
    const p = gitAwareFakeProbes(HOME);
    const result = await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), seams);
    expect(result.team).toBe("widgets");
    expect(p.exists(`${HOME}/.mattstack/orgs/acme/mattstack/teams/widgets/settings.team.jsonc`)).toBe(true);
    expect((orgStore(p)["mattstack.org"] as { teams: object }).teams).toEqual({ widgets: { owners: ["dev1"] } });
  });

  test("a first team name that is not a folder name is refused before anything is written", async () => {
    const p = gitAwareFakeProbes(HOME);
    await expect(createTeam(p, { ...GITHUB, firstTeam: "Widgets!" }, new FakeAgeKeySeam(), seams)).rejects.toMatchObject({ code: "bad-team-name" });
    expect(p.exists(`${HOME}/.mattstack/orgs/acme`)).toBe(false);
  });

  test("on a recognized forge whose login is not known yet, create writes no username, admin, owner or roster entry, and never falls back to $USER", async () => {
    const p = gitAwareFakeProbes(HOME);
    p.env.USER = "dev2";
    const result = await createTeam(p, GITHUB, new FakeAgeKeySeam(), unknown);
    expect(result.rolesDeferred).toBe(true);
    expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
    expect("mattstack.org" in orgStore(p)).toBe(false);
    expect("mattstack.roster" in orgStore(p)).toBe(false);
  });

  test("the rerun after the forge connects writes the roles, records the username and commits the change", async () => {
    const commits: string[] = [];
    const p = gitAwareFakeProbes(HOME, (argv) => {
      if (argv[0] === "git" && argv[1] === "commit") commits.push(argv[argv.indexOf("-m") + 1]!);
      return undefined;
    });
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), unknown);
    const second = await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), seams);
    expect(second).toMatchObject({ created: false, team: "widgets" });
    expect(second.rolesDeferred).toBeUndefined();
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
    expect(orgStore(p)["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
    expect(commits).toEqual(["team: scaffold acme", "team: dev1 is the acme org's admin"]);
  });

  test("a deferred create leaves a marker, and recording the username later claims the admin role, commits and pushes", async () => {
    const git: string[] = [];
    const p = gitAwareFakeProbes(HOME, (argv) => {
      if (argv[0] === "git" && (argv[1] === "commit" || argv.includes("push"))) git.push(argv.includes("push") ? "push" : `commit ${argv[argv.indexOf("-m") + 1]}`);
      return undefined;
    });
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), unknown);
    expect(readTeamLocal(p, "acme").creatorPending).toEqual({ team: "widgets", agePublicKey: FAKE_PUBLIC_KEY });

    updateTeamLocal(p, "acme", { forgeUsername: "dev1" });
    expect(await claimPendingAdmin(p, "acme", "dev1", null)).toEqual({ claimed: true, published: true });
    expect(orgStore(p)["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
    expect(orgStore(p)["mattstack.roster"]).toEqual([{ username: "dev1", agePublicKey: FAKE_PUBLIC_KEY, teams: ["widgets"] }]);
    expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
    expect(git.slice(-2)).toEqual(["commit team: dev1 is the acme org's admin", "push"]);

    expect(await claimPendingAdmin(p, "acme", "dev2", null)).toEqual({ claimed: false, published: false });
  });

  test("a pending creator whose admin entry differs only in case still claims, commits and pushes", async () => {
    const git: string[] = [];
    const p = gitAwareFakeProbes(HOME, (argv) => {
      if (argv[0] === "git" && (argv[1] === "commit" || argv.includes("push"))) git.push(argv.includes("push") ? "push" : `commit ${argv[argv.indexOf("-m") + 1]}`);
      return undefined;
    });
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), unknown);
    p.writeFile(ORG_STORE, withCreator(p.readFile(ORG_STORE)!, "widgets", { username: "Dev1" }));
    updateTeamLocal(p, "acme", { forgeUsername: "dev1" });
    expect(await claimPendingAdmin(p, "acme", "dev1", null)).toEqual({ claimed: true, published: true });
    expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
    expect(git.slice(-2)).toEqual(["commit team: dev1 is the acme org's admin", "push"]);
  });

  test("a rerun whose admin entry differs only in case keeps its pending commit", async () => {
    const commits: string[] = [];
    const p = gitAwareFakeProbes(HOME, (argv) => {
      if (argv[0] === "git" && argv[1] === "commit") commits.push(argv[argv.indexOf("-m") + 1]!);
      return undefined;
    });
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), unknown);
    p.writeFile(ORG_STORE, withCreator(p.readFile(ORG_STORE)!, "widgets", { username: "Dev1" }));
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), seams);
    expect(commits).toEqual(["team: scaffold acme", "team: dev1 is the acme org's admin"]);
    expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
  });

  test("a rerun naming a different first team is refused and points at adding a team", async () => {
    const p = gitAwareFakeProbes(HOME);
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), seams);
    const writesBefore = Object.keys(p.calls.writes).sort();
    await expect(createTeam(p, { ...GITHUB, firstTeam: "gadgets" }, new FakeAgeKeySeam(), seams)).rejects.toMatchObject({
      code: "org-first-team-set",
      message: "The acme org was started with widgets as its first team",
      next: "rt team add gadgets --owner <username>",
    });
    expect(p.exists(`${HOME}/.mattstack/orgs/acme/mattstack/teams/gadgets`)).toBe(false);
    expect(Object.keys(p.calls.writes).sort()).toEqual(writesBefore);
  });

  test("once setup forgot the intent, a rerun naming a team the committed org lacks is still refused", async () => {
    const p = gitAwareFakeProbes(HOME, (argv) => (argv[1] === "cat-file" && argv.at(-1) === "HEAD:mattstack/teams/gadgets/settings.team.jsonc" ? { code: 128, stdout: "", stderr: "" } : undefined));
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), seams);
    clearIntent(p);
    await expect(createTeam(p, { ...GITHUB, firstTeam: "gadgets" }, new FakeAgeKeySeam(), seams)).rejects.toMatchObject({
      code: "org-first-team-set",
      message: "The acme org already has its first team",
      next: "rt team add gadgets --owner <username>",
    });
    expect(p.exists(`${HOME}/.mattstack/orgs/acme/mattstack/teams/gadgets`)).toBe(false);
  });

  test("a rerun with no first team finishes the one the org was started with", async () => {
    const p = gitAwareFakeProbes(HOME);
    await createTeam(p, { ...GITHUB, firstTeam: "widgets" }, new FakeAgeKeySeam(), unknown);
    const second = await createTeam(p, GITHUB, new FakeAgeKeySeam(), seams);
    expect(second.team).toBe("widgets");
    expect(p.exists(`${HOME}/.mattstack/orgs/acme/mattstack/teams/acme`)).toBe(false);
    expect(orgStore(p)["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
  });

  test("with no marker, or an org that already names an admin, nothing is claimed", async () => {
    const p = gitAwareFakeProbes(HOME);
    await createTeam(p, GITHUB, new FakeAgeKeySeam(), seams);
    expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
    expect(await claimPendingAdmin(p, "acme", "dev2", null)).toEqual({ claimed: false, published: false });
    expect((orgStore(p)["mattstack.org"] as { admins: string[] }).admins).toEqual(["dev1"]);
    updateTeamLocal(p, "acme", { creatorPending: { team: "acme" } });
    const before = p.readFile(ORG_STORE);
    const calls = p.calls.exec.length;
    expect(await claimPendingAdmin(p, "acme", "dev2", null)).toEqual({ claimed: false, published: false });
    expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
    expect(p.readFile(ORG_STORE)).toBe(before);
    expect(p.calls.exec.length).toBe(calls);
  });

  test("an org on no recognized forge records $USER, so its creator is still its admin", async () => {
    const p = gitAwareFakeProbes(HOME);
    p.env.USER = "dev2";
    const never = { forgeLogin: async () => { throw new Error("must not ask a forge"); }, forgeToken: async () => null };
    await createTeam(p, { name: "Acme", remote: "https://git.example.com/acme/repo.git", others: false }, new FakeAgeKeySeam(), never);
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev2");
    expect((orgStore(p)["mattstack.org"] as { admins: string[] }).admins).toEqual(["dev2"]);
  });

  test("a second run keeps the roles and the username it already wrote", async () => {
    const p = gitAwareFakeProbes(HOME);
    await createTeam(p, GITHUB, new FakeAgeKeySeam(), seams);
    await createTeam(p, GITHUB, new FakeAgeKeySeam(), { forgeLogin: async () => "dev2", forgeToken: async () => null });
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
    expect((orgStore(p)["mattstack.org"] as { admins: string[] }).admins).toEqual(["dev1"]);
  });
});

describe("creator commits with an existing index", () => {
  for (const mode of ["rerun", "partial", "claim", "add", "commit", "push", "rerun-add", "rerun-commit", "already-committed"] as const) {
    test(`${mode}: unrelated staged changes stay outside the creator commit`, async () => {
      const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-creator-index-")));
      const originalHome = process.env.HOME;
      process.env.HOME = home;
      try {
        const p = createRealProbes();
        const run = (args: string[], cwd: string) => {
          const result = Bun.spawnSync(["git", ...args], { cwd, env: childEnv(), stdout: "pipe", stderr: "pipe" });
          expect(result.exitCode).toBe(0);
          return result.stdout.toString().trim();
        };
        let failing = false;
        const realExec = p.exec;
        let publishedBase: string | null = null;
        p.exec = async (argv, opts) => {
          if (argv[0] === "xcode-select") return { code: 0, stdout: "/fake-clt", stderr: "" };
          if (failing && argv[0] === "git" && argv[1] === mode.replace("rerun-", "")) return { code: 1, stdout: "", stderr: `fake ${mode} failure` };
          if (argv.includes("ls-remote")) return { code: 0, stdout: publishedBase ? `${publishedBase}\trefs/heads/main\n` : "", stderr: "" };
          if (argv.includes("push")) return { code: 0, stdout: "", stderr: "" };
          return realExec(argv, opts);
        };
        const opts = { name: "Acme", remote: "https://github.com/acme/repo.git", others: false, firstTeam: "widgets" };
        const unknown = { forgeLogin: async () => null, forgeToken: async () => null };
        const created = await createTeam(p, opts, new FakeAgeKeySeam(), mode === "already-committed" ? seams : unknown);
        if (mode === "already-committed") updateTeamLocal(p, "acme", { creatorPending: { team: "widgets", agePublicKey: FAKE_PUBLIC_KEY } });
        writeFileSync(join(created.dir, "unrelated.txt"), "original\n");
        run(["add", "--", "unrelated.txt"], created.dir);
        run(["commit", "-m", "fixture unrelated", "--", "unrelated.txt"], created.dir);
        publishedBase = run(["rev-parse", "HEAD"], created.dir);
        writeFileSync(join(created.dir, "unrelated.txt"), "staged\n");
        run(["add", "--", "unrelated.txt"], created.dir);
        writeFileSync(join(created.dir, "unrelated.txt"), "working\n");
        const head = run(["rev-parse", "HEAD"], created.dir);
        failing = true;
        if (mode === "rerun-add" || mode === "rerun-commit") {
          await expect(createTeam(p, opts, new FakeAgeKeySeam(), seams)).rejects.toBeInstanceOf(UserActionableError);
          expect(readTeamLocal(p, "acme").creatorPending).toEqual({ team: "widgets", agePublicKey: FAKE_PUBLIC_KEY });
          expect(run(["rev-parse", "HEAD"], created.dir)).toBe(head);
          failing = false;
          await createTeam(p, opts, new FakeAgeKeySeam(), seams);
          expect(JSON.parse(run(["show", "HEAD:mattstack/org/settings.org.jsonc"], created.dir).split("\n").filter((line) => !line.startsWith("//")).join("\n"))["mattstack.org"].admins).toEqual(["dev1"]);
        } else if (mode === "rerun" || mode === "partial") {
          if (mode === "partial") p.removeFile(join(created.dir, "mattstack", "mattstack.jsonc"));
          await createTeam(p, opts, new FakeAgeKeySeam(), seams);
        } else {
          updateTeamLocal(p, "acme", { forgeUsername: "dev1" });
          const result = await claimPendingAdmin(p, "acme", "dev1", null);
          if (mode === "claim" || mode === "already-committed") expect(result).toEqual({ claimed: true, published: true });
          else {
            expect(result).toMatchObject({ claimed: true, published: false });
            expect(result.detail).toBe(mode === "add" ? "rt could not stage the team repo's files" : mode === "commit" ? "rt could not make the team repo's first commit" : "rt could not push the team repo");
          }
        }
        expect(run(["show", ":unrelated.txt"], created.dir)).toBe("staged");
        expect(p.readFile(join(created.dir, "unrelated.txt"))).toBe("working\n");
        expect(run(["show", "HEAD:unrelated.txt"], created.dir)).toBe("original");
        if (mode === "add" || mode === "commit" || mode === "already-committed") expect(run(["rev-parse", "HEAD"], created.dir)).toBe(head);
        else if (mode !== "partial") expect(run(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], created.dir)).toBe("mattstack/org/settings.org.jsonc");
        expect(parseSettingsBody(p.readFile(join(created.dir, "mattstack", "org", "settings.org.jsonc"))!)["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
        if (mode === "add" || mode === "commit") {
          expect(readTeamLocal(p, "acme").creatorPending).toEqual({ team: "widgets", agePublicKey: FAKE_PUBLIC_KEY });
          failing = false;
          expect(await claimPendingAdmin(p, "acme", "dev1", null)).toEqual({ claimed: true, published: true });
          expect(JSON.parse(run(["show", "HEAD:mattstack/org/settings.org.jsonc"], created.dir).split("\n").filter((line) => !line.startsWith("//")).join("\n"))["mattstack.org"].admins).toEqual(["dev1"]);
          expect(run(["show", ":unrelated.txt"], created.dir)).toBe("staged");
          expect(p.readFile(join(created.dir, "unrelated.txt"))).toBe("working\n");
        }
        expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
      } finally {
        process.env.HOME = originalHome;
        rmSync(home, { recursive: true, force: true });
      }
    });
  }
});

describe("fresh scaffold failure recovery", () => {
  for (const failure of ["add", "commit"] as const) {
    for (const known of [true, false]) {
      test(`initial ${failure} failure retries every scaffold path with ${known ? "known" : "unknown"} forge login`, async () => {
        const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-fresh-scaffold-retry-")));
        const originalHome = process.env.HOME;
        process.env.HOME = home;
        try {
          const p = createRealProbes();
          const dir = join(home, ".mattstack", "orgs", "acme");
          const run = (args: string[]) => {
            const result = Bun.spawnSync(["git", ...args], { cwd: dir, env: childEnv(), stdout: "pipe", stderr: "pipe" });
            expect(result.exitCode).toBe(0);
            return result.stdout.toString().trim();
          };
          let failing = true;
          const realExec = p.exec;
          p.exec = async (argv, opts) => {
            if (argv[0] === "xcode-select") return { code: 0, stdout: "/fake-clt", stderr: "" };
            if (failing && argv[0] === "git" && argv[1] === failure) return { code: 1, stdout: "", stderr: `fake initial ${failure} failure` };
            if (argv.includes("push")) throw new Error("create must never push");
            return realExec(argv, opts);
          };
          const opts = { name: "Acme", remote: "https://github.com/acme/repo.git", others: false, firstTeam: "widgets" };
          const forge = known ? seams : { forgeLogin: async () => null, forgeToken: async () => null };
          await expect(createTeam(p, opts, new FakeAgeKeySeam(), forge)).rejects.toMatchObject({ code: failure === "add" ? "git-add-failed" : "git-commit-failed" });
          writeFileSync(join(dir, "unrelated.txt"), "original\n");
          run(["add", "--", "unrelated.txt"]);
          run(["commit", "-m", "fixture unrelated", "--", "unrelated.txt"]);
          writeFileSync(join(dir, "unrelated.txt"), "staged\n");
          run(["add", "--", "unrelated.txt"]);
          writeFileSync(join(dir, "unrelated.txt"), "working\n");
          failing = false;
          const retried = await createTeam(p, opts, new FakeAgeKeySeam(), forge);
          expect(retried.rolesDeferred).toBe(known ? undefined : true);
          const paths = ["mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/widgets/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"];
          for (const path of paths) expect(run(["show", `HEAD:${path}`])).toBe(p.readFile(join(dir, path))!.trim());
          expect(retried).toMatchObject({ created: true, team: "widgets" });
          expect(run(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").sort()).toEqual([...paths].sort());
          expect(run(["show", "HEAD:unrelated.txt"])).toBe("original");
          expect(run(["show", ":unrelated.txt"])).toBe("staged");
          expect(p.readFile(join(dir, "unrelated.txt"))).toBe("working\n");
          expect(readTeamLocal(p, "acme").creatorPending).toEqual(known ? undefined : { team: "widgets", agePublicKey: FAKE_PUBLIC_KEY });
          const org = parseSettingsBody(p.readFile(join(dir, "mattstack", "org", "settings.org.jsonc"))!);
          if (known) expect(org["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
          else {
            expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
            expect(org["mattstack.org"]).toBeUndefined();
            expect(org["mattstack.roster"]).toBeUndefined();
          }
        } finally {
          process.env.HOME = originalHome;
          rmSync(home, { recursive: true, force: true });
        }
      });
    }
  }
});

describe("forge identity scaffold failure recovery", () => {
  for (const failure of ["add", "commit"] as const) {
    for (const known of [true, false]) {
      test(`identity after initial ${failure} failure publishes every scaffold path with ${known ? "known" : "unknown"} forge login`, async () => {
        const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-fresh-scaffold-retry-")));
        const originalHome = process.env.HOME;
        process.env.HOME = home;
        try {
          const p = createRealProbes();
          const dir = join(home, ".mattstack", "orgs", "acme");
          const run = (args: string[]) => {
            const result = Bun.spawnSync(["git", ...args], { cwd: dir, env: childEnv(), stdout: "pipe", stderr: "pipe" });
            expect(result.exitCode).toBe(0);
            return result.stdout.toString().trim();
          };
          let failing = true;
          const realExec = p.exec;
          let publishedBase: string | null = null;
          p.exec = async (argv, opts) => {
            if (argv[0] === "xcode-select") return { code: 0, stdout: "/fake-clt", stderr: "" };
            if (failing && argv[0] === "git" && argv[1] === failure) return { code: 1, stdout: "", stderr: `fake initial ${failure} failure` };
            if (argv.includes("ls-remote")) return { code: 0, stdout: publishedBase ? `${publishedBase}\trefs/heads/main\n` : "", stderr: "" };
            if (argv.includes("push")) {
              const paths = run(["ls-tree", "-r", "--name-only", "HEAD"]).split("\n");
              expect(paths.sort()).toEqual([".claude-plugin/marketplace.json", ".gitignore", ".sops.yaml", "mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/widgets/settings.team.jsonc", "unrelated.txt"].sort());
              return { code: 0, stdout: "", stderr: "" };
            }
            return realExec(argv, opts);
          };
          const opts = { name: "Acme", remote: "https://github.com/acme/repo.git", others: false, firstTeam: "widgets" };
          const forge = known ? seams : { forgeLogin: async () => null, forgeToken: async () => null };
          await expect(createTeam(p, opts, new FakeAgeKeySeam(), forge)).rejects.toMatchObject({ code: failure === "add" ? "git-add-failed" : "git-commit-failed" });
          writeFileSync(join(dir, "unrelated.txt"), "original\n");
          run(["add", "--", "unrelated.txt"]);
          run(["commit", "-m", "fixture unrelated", "--", "unrelated.txt"]);
          publishedBase = run(["rev-parse", "HEAD"]);
          writeFileSync(join(dir, "unrelated.txt"), "staged\n");
          run(["add", "--", "unrelated.txt"]);
          writeFileSync(join(dir, "unrelated.txt"), "working\n");
          const failed = await recordForgeIdentity(p, "acme", { provider: "github", host: "github.com" }, null, async () => "dev1");
          expect(failed.admin).toMatchObject({ claimed: true, published: false });
          expect(readTeamLocal(p, "acme").creatorPending).toEqual({ team: "widgets", agePublicKey: FAKE_PUBLIC_KEY });
          expect(run(["ls-tree", "-r", "--name-only", "HEAD"])).toBe("unrelated.txt");
          failing = false;
          const retried = await recordForgeIdentity(p, "acme", { provider: "github", host: "github.com" }, null, async () => "dev1");
          expect(retried.admin).toEqual({ claimed: true, published: true });
          const paths = ["mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/widgets/settings.team.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", ".gitignore"];
          for (const path of paths) expect(run(["show", `HEAD:${path}`])).toBe(p.readFile(join(dir, path))!.trim());

          expect(run(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").sort()).toEqual([...paths].sort());
          expect(run(["show", "HEAD:unrelated.txt"])).toBe("original");
          expect(run(["show", ":unrelated.txt"])).toBe("staged");
          expect(p.readFile(join(dir, "unrelated.txt"))).toBe("working\n");
          expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
          const org = parseSettingsBody(p.readFile(join(dir, "mattstack", "org", "settings.org.jsonc"))!);
          expect(org["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
        } finally {
          process.env.HOME = originalHome;
          rmSync(home, { recursive: true, force: true });
        }
      });
    }
  }
});
