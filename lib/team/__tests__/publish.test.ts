import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { childEnv, runCapture } from "../../subprocess.ts";
import { afterEach, describe, test, expect } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { publishTeam } from "../publish.ts";
import { teamLocalPath } from "../team-local.ts";
import { UserActionableError } from "../../errors.ts";

const DIR = "/home/x/.mattstack/teams/acme";

/** publishTeam prechecks the zone exists (finding 7) — every test that means to reach the git steps must seed the dir. */
function probesWithZone(overrides: Parameters<typeof fakeProbes>[0] = {}, branch = "main") {
  return fakeProbes({ home: "/home/x", dirs: { [DIR]: [] }, ...overrides,
    exec: (argv, opts) => {
      if (argv.includes("symbolic-ref")) return { code: 0, stdout: `${branch}\n`, stderr: "" };
      if (argv.includes("get-url")) return { code: 0, stdout: "https://github.com/acme/repo.git\n", stderr: "" };
      if (argv.includes("ls-remote") || argv.includes("rev-list")) return { code: 0, stdout: "", stderr: "" };
      return overrides.exec?.(argv, opts) ?? { code: 0, stdout: "", stderr: "" };
    }, files: {
    [`${DIR}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } }),
    [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: "dev1" }),
    ...overrides.files,
  } });
}

describe("publishTeam", () => {
  test("set-url then push -u origin main", async () => {
    const p = probesWithZone({ home: "/home/x" });
    const result = await publishTeam(p, "acme", "https://github.com/acme/repo.git");

    expect(p.calls.exec.filter((argv) => !argv.includes("get-url") && !argv.includes("ls-remote") && !argv.includes("rev-list") && !argv.includes("symbolic-ref"))).toEqual([
      ["git", "remote", "set-url", "origin", "https://github.com/acme/repo.git"],
      ["git", "push", "-u", "origin", "refs/heads/main:refs/heads/main"],
    ]);
    expect(result).toEqual({ remote: "https://github.com/acme/repo.git", pushed: true, detail: "pushed to https://github.com/acme/repo.git" });
  });

  test("a clone on another branch publishes that branch, never main", async () => {
    const p = probesWithZone({ home: "/home/x" }, "org-trial");
    await publishTeam(p, "acme", null);
    const remoteCalls = p.calls.exec.filter((argv) => argv.includes("ls-remote") || argv.includes("push") || argv.includes("rev-list"));
    expect(remoteCalls.find((argv) => argv.includes("ls-remote"))!.at(-1)).toBe("refs/heads/org-trial");
    expect(remoteCalls.find((argv) => argv.includes("push"))!.slice(-3)).toEqual(["-u", "origin", "refs/heads/org-trial:refs/heads/org-trial"]);
    expect(remoteCalls.find((argv) => argv.includes("rev-list"))!.join(" ")).toContain("refs/heads/org-trial");
    expect(p.calls.exec.flat().join(" ")).not.toContain("refs/heads/main");
  });

  test("a clone with no branch checked out is refused before anything is pushed", async () => {
    const p = probesWithZone({ home: "/home/x" }, "");
    await expect(publishTeam(p, "acme", null)).rejects.toMatchObject({ code: "org-detached" });
    expect(p.calls.exec.some((argv) => argv.includes("push"))).toBe(false);
  });

  // Install pushes before git has any credential of its own on a fresh
  // machine; the token rt holds rides in the environment, never argv.
  test("with a token: push goes through an inline credential helper, token only in env", async () => {
    const p = probesWithZone({ home: "/home/x" });
    const seen: { argv: string[]; env?: Record<string, string> }[] = [];
    p.exec = async (argv, opts) => {
      seen.push({ argv, env: opts?.env });
      return { code: 0, stdout: argv.includes("get-url") ? "https://github.com/acme/repo.git\n" : argv.includes("symbolic-ref") ? "main\n" : "", stderr: "" };
    };
    const result = await publishTeam(p, "acme", "https://github.com/acme/repo.git", { token: "ghp_secret" });
    const push = seen.find((c) => c.argv.includes("push"))!;
    expect(push.argv.join(" ")).toMatch(/-c credential\.https:\/\/[^/ ]+\.helper= /);
    expect(push.argv.join(" ")).not.toContain("ghp_secret");
    expect(push.env?.RT_GIT_TOKEN).toBe("ghp_secret");
    expect(result.pushed).toBe(true);
  });

  test("falls back to remote add when set-url fails (no origin yet)", async () => {
    const p = probesWithZone({
      home: "/home/x",
      exec: (argv) => (argv[2] === "set-url" ? { code: 2, stdout: "", stderr: "error: No such remote 'origin'" } : { code: 0, stdout: "", stderr: "" }),
    });
    await publishTeam(p, "acme", "https://github.com/acme/repo.git");

    expect(p.calls.exec.filter((argv) => !argv.includes("get-url") && !argv.includes("ls-remote") && !argv.includes("rev-list") && !argv.includes("symbolic-ref"))).toEqual([
      ["git", "remote", "set-url", "origin", "https://github.com/acme/repo.git"],
      ["git", "remote", "add", "origin", "https://github.com/acme/repo.git"],
      ["git", "push", "-u", "origin", "refs/heads/main:refs/heads/main"],
    ]);
  });

  test("no explicit remote: pushes with the existing origin, no remote-changing calls", async () => {
    const p = probesWithZone({
      home: "/home/x",
      files: { [`${DIR}/.git/config`]: '[remote "origin"]\n\turl = https://github.com/acme/repo.git\n' },
    });
    const result = await publishTeam(p, "acme", null);

    expect(p.calls.exec.filter((argv) => !argv.includes("get-url") && !argv.includes("ls-remote") && !argv.includes("rev-list") && !argv.includes("symbolic-ref"))).toEqual([["git", "push", "-u", "origin", "refs/heads/main:refs/heads/main"]]);
    expect(result.remote).toBe("https://github.com/acme/repo.git");
  });

  test("no zone for the slug: typed no-team-zone error, no exec calls at all", async () => {
    const p = probesWithZone({ dirs: {} }); // DIR deliberately not seeded

    let thrown: unknown;
    try {
      await publishTeam(p, "acme", "https://github.com/acme/repo.git");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UserActionableError);
    expect((thrown as UserActionableError).code).toBe("no-team-zone");
    expect(p.calls.exec).toEqual([]);
  });

  test("a member or unknown Mac refuses to publish; invited owners and admins may publish", async () => {
    for (const username of ["dev9", null, "dev1", "dev2"]) {
      const p = probesWithZone({ files: {
        [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: username, joinedByRt: true }),
        [`${DIR}/.git/config`]: '[remote "origin"]\n\turl = https://github.com/acme/widgets.git\n',
      } });
      if (username === "dev1" || username === "dev2") await expect(publishTeam(p, "acme", null)).resolves.toMatchObject({ pushed: true });
      else {
        await expect(publishTeam(p, "acme", null)).rejects.toMatchObject({ code: "team-pull-only" });
        expect(p.calls.exec).toEqual([]);
      }
    }
  });

  test("an unvalidated --team never resolves outside teamsDir()", async () => {
    const p = fakeProbes({ home: "/home/x", dirs: { "/some/other-repo": [] } });

    let thrown: unknown;
    try {
      await publishTeam(p, "../../some-repo", "https://github.com/acme/repo.git");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UserActionableError);
    expect((thrown as UserActionableError).code).toBe("invalid-team-slug");
    expect(p.calls.exec).toEqual([]);
  });

  test("auth failure (exit 128) throws push-denied with the credential-bearing URL stripped", async () => {
    const remote = "https://x-access-token:SECRET@github.com/acme/repo.git";
    const p = probesWithZone({
      home: "/home/x",
      exec: (argv) =>
        argv[0] === "git" && argv[1] === "push"
          ? { code: 128, stdout: "", stderr: `fatal: Authentication failed for '${remote}'` }
          : { code: 0, stdout: "", stderr: "" },
    });

    let thrown: unknown;
    try {
      await publishTeam(p, "acme", remote);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UserActionableError);
    const err = thrown as UserActionableError;
    expect(err.code).toBe("push-denied");
    const log = err.log ?? "";
    expect(log).toContain("Authentication failed");
    expect(log).not.toContain("SECRET");
    expect(log).not.toContain("https://");
    expect(err.message).toBe("The forge would not let rt push to the team repo");
  });

  test("non-fast-forward rejection (existing EMPTY-repo contract violated) is a typed remote-not-empty error", async () => {
    const p = probesWithZone({
      home: "/home/x",
      exec: (argv) =>
        argv[0] === "git" && argv[1] === "push"
          ? { code: 1, stdout: "", stderr: "! [rejected]        main -> main (fetch first)\nerror: failed to push some refs" }
          : { code: argv[1] === "rev-parse" ? 1 : 0, stdout: "", stderr: "" },
    });

    let thrown: unknown;
    try {
      await publishTeam(p, "acme", "https://github.com/acme/repo.git");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UserActionableError);
    const err = thrown as UserActionableError;
    expect(err.code).toBe("remote-not-empty");
    expect(err.why).toBe("rt starts a team in an empty repo.");
  });

  test("every other push failure is still a typed, redacted error — never a plain Error crash", async () => {
    const remote = "https://x-access-token:SECRET@github.com/acme/repo.git";
    const p = probesWithZone({
      home: "/home/x",
      exec: (argv) =>
        argv[0] === "git" && argv[1] === "push"
          ? { code: 1, stdout: "", stderr: `fatal: unable to access '${remote}': Could not resolve host` }
          : { code: 0, stdout: "", stderr: "" },
    });

    let thrown: unknown;
    try {
      await publishTeam(p, "acme", remote);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UserActionableError);
    const err = thrown as UserActionableError;
    expect(err.code).toBe("push-failed");
    expect(err.log ?? "").toStartWith("git push -u origin main failed");
    expect(err.log).not.toContain("SECRET");
  });

  test("a failed remote add is also a typed, redacted error", async () => {
    const remote = "https://x-access-token:SECRET@github.com/acme/repo.git";
    const p = probesWithZone({
      home: "/home/x",
      exec: (argv) => (argv[0] === "git" && argv[1] === "remote" ? { code: 1, stdout: "", stderr: `fatal: bad remote ${remote}` } : { code: 0, stdout: "", stderr: "" }),
    });

    let thrown: unknown;
    try {
      await publishTeam(p, "acme", remote);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UserActionableError);
    const err = thrown as UserActionableError;
    expect(err.code).toBe("git-remote-failed");
    expect(err.log ?? "").toStartWith("git remote add origin failed");
    expect(err.log).not.toContain("SECRET");
  });

  test("a credential-bearing remote is stripped of userinfo before it reaches the returned result (the JSON envelope's source)", async () => {
    const p = probesWithZone({ home: "/home/x" });
    const result = await publishTeam(p, "acme", "https://x-access-token:SECRET@github.com/acme/repo.git");

    expect(result.remote).toBe("https://github.com/acme/repo.git");
    expect(result.detail).not.toContain("SECRET");
  });
});

  test("a rejected push on an org that has been pushed before says the org moved, never that the repo is not empty", async () => {
    const p = probesWithZone({
      home: "/home/x",
      exec: (argv) =>
        argv[0] === "git" && argv.includes("push")
          ? { code: 1, stdout: "", stderr: "! [rejected]        main -> main (fetch first)\nerror: failed to push some refs" }
          : { code: 0, stdout: "", stderr: "" },
    });
    await expect(publishTeam(p, "acme", null)).rejects.toMatchObject({
      code: "org-moved",
      message: "The org repo has changes this Mac does not have yet",
      why: "Someone else pushed first, so pull their changes before you publish again.",
      next: "rt team pull --team acme",
      thenRun: "rt team publish --team acme",
    });
  });

const publishHomes: string[] = [];
afterEach(() => { for (const home of publishHomes.splice(0)) rmSync(home, { recursive: true, force: true }); });

function historyWorld(initial = false) {
  const home = mkdtempSync(join(tmpdir(), "rt-publish-history-"));
  publishHomes.push(home);
  const dir = join(home, ".mattstack", "teams", "acme");
  const remote = join(home, "remote.git");
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, env: childEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (path: string, body: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };
  const store = "mattstack/org/settings.org.jsonc";
  const roles = (teams: string[], username = "dev2") => {
    write(store, JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: Object.fromEntries(teams.map((team) => [team, { owners: ["dev2"] }])) } }));
    const local = teamLocalPath(home, "acme"); mkdirSync(dirname(local), { recursive: true }); writeFileSync(local, JSON.stringify({ forgeUsername: username }));
  };
  roles(["widgets", "gadgets"]);
  write(".gitignore", "*.tmp\n");
  write("mattstack/teams/widgets/source.txt", "seed\n");
  write("mattstack/teams/gadgets/destination.txt", "seed\n");
  git("init", "-q", "-b", "main"); git("config", "user.name", "dev2"); git("config", "user.email", "dev2@example.test");
  git("add", "--", ".gitignore", "mattstack"); git("commit", "-q", "-m", "scaffold");
  if (initial) git("init", "--bare", "-q", remote);
  else git("clone", "--bare", "-q", dir, remote);
  git("remote", "add", "origin", remote);
  const base = git("rev-parse", "HEAD").trim();
  if (!initial) git("update-ref", "refs/remotes/origin/main", base);
  let pushes = 0;
  let fail: string | null = null;
  let onInspect: (() => void) | null = null;
  const p = fakeProbes({ home });
  p.exists = existsSync;
  p.readFile = (file) => existsSync(file) ? readFileSync(file, "utf8") : null;
  p.exec = async (argv, opts) => {
    if (argv.includes("push")) { pushes++; return { code: 0, stdout: "", stderr: "" }; }
    if (fail && argv.includes(fail)) return { code: 128, stdout: "", stderr: "inspection failed" };
    const r = await runCapture([argv[0]!, "-c", "core.hooksPath=/dev/null", ...argv.slice(1)], { cwd: opts?.cwd, env: { ...childEnv(), ...opts?.env }, timeoutMs: 5000 });
    if (argv.includes("diff-tree")) onInspect?.();
    return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
  };
  const commit = (path: string, body: string) => { write(path, body); git("add", "--", path); git("commit", "-q", "-m", "pending"); };
  return { p, dir, remote, git, write, roles, commit, base, pushes: () => pushes, fail: (verb: string) => { fail = verb; }, onInspect: (fn: () => void) => { onInspect = fn; } };
}

describe("publication authorizes the actual main history and destination", () => {
  for (const history of ["revoked", "reverted", "rename", "merge"] as const) test(`${history} unowned pending history refuses before push`, async () => {
    const w = historyWorld();
    const widget = "mattstack/teams/widgets/source.txt";
    const gadget = "mattstack/teams/gadgets/destination.txt";
    if (history === "rename") { w.git("mv", widget, "mattstack/teams/gadgets/moved.txt"); w.git("commit", "-q", "-m", "rename"); }
    else if (history === "merge") {
      w.git("checkout", "-q", "-b", "side"); w.commit(gadget, "side\n"); w.git("checkout", "-q", "main"); w.git("merge", "--no-ff", "--no-commit", "side");
      w.write(widget, "merge-produced\n"); w.git("add", "--", widget); w.git("commit", "-q", "-m", "merge resolution");
    } else { w.commit(widget, "pending\n"); if (history === "reverted") w.git("revert", "--no-edit", "HEAD"); }
    w.roles(["gadgets"]);
    await expect(publishTeam(w.p, "acme", null)).rejects.toMatchObject({ code: "team-pull-only" });
    expect(w.pushes()).toBe(0);
  });

  test("an owner may publish only its owned main changes, even without tracking refs", async () => {
    const w = historyWorld(); w.commit("mattstack/teams/gadgets/destination.txt", "owned\n"); w.roles(["gadgets"]); w.git("update-ref", "-d", "refs/remotes/origin/main");
    await expect(publishTeam(w.p, "acme", null)).resolves.toMatchObject({ pushed: true }); expect(w.pushes()).toBe(1);
  });

  test("authorization reads the role after history inspection", async () => {
    const w = historyWorld(); w.commit("mattstack/teams/widgets/source.txt", "pending\n"); w.onInspect(() => w.roles(["gadgets"]));
    await expect(publishTeam(w.p, "acme", null)).rejects.toMatchObject({ code: "team-pull-only" }); expect(w.pushes()).toBe(0);
  });

  for (const failure of ["rev-list", "diff-tree", "ls-remote"] as const) test(`${failure} failure refuses rather than sending uninspected history`, async () => {
    const w = historyWorld(); w.commit("mattstack/teams/widgets/source.txt", "pending\n"); w.fail(failure);
    await expect(publishTeam(w.p, "acme", null)).rejects.toMatchObject({ code: "team-pull-only" }); expect(w.pushes()).toBe(0);
  });

  for (const branchUnowned of [false, true]) test(`the checked-out branch's own history is what is authorized and pushed, never main's (${branchUnowned})`, async () => {
    const w = historyWorld();
    w.git("push", "-q", w.remote, `${w.base}:refs/heads/other`);
    w.git("update-ref", "refs/remotes/origin/other", w.base);
    w.commit(branchUnowned ? "mattstack/teams/gadgets/destination.txt" : "mattstack/teams/widgets/source.txt", "main pending\n");
    w.git("checkout", "-q", "-b", "other", w.base); w.commit(branchUnowned ? "mattstack/teams/widgets/source.txt" : "mattstack/teams/gadgets/destination.txt", "other pending\n"); w.roles(["gadgets"]);
    const pushed: string[][] = [];
    const exec = w.p.exec;
    w.p.exec = async (argv, opts) => { if (argv.includes("push")) pushed.push(argv); return exec(argv, opts); };
    if (branchUnowned) await expect(publishTeam(w.p, "acme", null)).rejects.toMatchObject({ code: "team-pull-only" });
    else await expect(publishTeam(w.p, "acme", null)).resolves.toMatchObject({ pushed: true });
    expect(pushed.map((argv) => argv.at(-1))).toEqual(branchUnowned ? [] : ["refs/heads/other:refs/heads/other"]);
  });

  test("a branch named +main pushes its own ref, never a forced main", async () => {
    const w = historyWorld();
    w.git("checkout", "-q", "-b", "+main", w.base); w.commit("mattstack/teams/gadgets/destination.txt", "branch pending\n"); w.roles(["gadgets"], "dev1");
    const pushed: string[][] = [];
    const exec = w.p.exec;
    w.p.exec = async (argv, opts) => { if (argv.includes("push")) pushed.push(argv); return exec(argv, opts); };
    await publishTeam(w.p, "acme", null);
    expect(pushed.map((argv) => argv.at(-1))).toEqual(["refs/heads/+main:refs/heads/+main"]);
  });

  for (const destination of ["explicit", "pushurl"] as const) test(`a changed ${destination} cannot reuse the old origin baseline`, async () => {
    const w = historyWorld(); w.commit("mattstack/teams/gadgets/destination.txt", "owned\n"); w.roles(["gadgets"]);
    const empty = join(dirname(w.remote), "empty.git"); w.git("init", "--bare", "-q", empty);
    if (destination === "pushurl") w.git("config", "remote.origin.pushurl", empty);
    await expect(publishTeam(w.p, "acme", destination === "explicit" ? empty : null)).rejects.toMatchObject({ code: "team-pull-only" }); expect(w.pushes()).toBe(0);
  });

  for (const initial of [false, true]) test(`admin publication preserves scaffold/recovery, initial=${initial}`, async () => {
    const w = historyWorld(initial); w.roles(["widgets", "gadgets"], "dev1");
    if (!initial) w.commit(".gitignore", "*.tmp\n.DS_Store\n");
    await expect(publishTeam(w.p, "acme", null)).resolves.toMatchObject({ pushed: true }); expect(w.pushes()).toBe(1);
  });

  for (const username of ["dev9", null]) test(`real pending history cannot be published by ${username ?? "unknown"}`, async () => {
    const w = historyWorld(); w.roles(["gadgets"], username as unknown as string);
    await expect(publishTeam(w.p, "acme", null)).rejects.toMatchObject({ code: "team-pull-only" }); expect(w.pushes()).toBe(0);
  });
});

for (const blocked of ["commits", "paths", "multiple-urls", "missing-main", "missing-object", "malformed-tip"] as const) test(`${blocked} publication inspection fails closed before push`, async () => {
  const w = historyWorld(); w.commit("mattstack/teams/gadgets/destination.txt", "pending\n");
  const exec = w.p.exec;
  w.p.exec = async (argv, opts) => {
    if (blocked === "multiple-urls" && argv.includes("get-url")) return { code: 0, stdout: `${w.remote}\n${w.remote}-other\n`, stderr: "" };
    if (blocked === "missing-main" && argv.includes("rev-list")) return { code: 128, stdout: "", stderr: "unknown main" };
    if (blocked === "missing-object" && argv.includes("ls-remote")) return { code: 0, stdout: `${"b".repeat(40)}\trefs/heads/main\n`, stderr: "" };
    if (blocked === "malformed-tip" && argv.includes("ls-remote")) return { code: 0, stdout: "not-a-sha\trefs/heads/main\n", stderr: "" };
    if (blocked === "commits" && argv.includes("rev-list")) return { code: 0, stdout: `${"a".repeat(40)}\n`.repeat(1001), stderr: "" };
    if (blocked === "paths" && argv.includes("diff-tree")) return { code: 0, stdout: Array.from({ length: 10001 }, (_, i) => `mattstack/teams/gadgets/${i}\0`).join(""), stderr: "" };
    return exec(argv, opts);
  };
  await expect(publishTeam(w.p, "acme", null)).rejects.toMatchObject({ code: "team-pull-only" });
  expect(w.pushes()).toBe(0);
});
