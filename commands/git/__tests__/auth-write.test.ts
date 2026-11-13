import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSshHostResolver } from "../../../lib/enrich.ts";
import { shellQuote } from "../../../lib/herdr-launch.ts";
import { rtCredentialHelper } from "../../../lib/setup/steps/repos.ts";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { runGit } from "../../../lib/worktree/git-async.ts";
import { authCommand, type AuthDeps } from "../auth.ts";
import { createOriginAuth } from "../origin-auth.ts";
import { exitCodeOf, git, inDir, makeRepo, TOKEN, trapExit } from "./helpers.ts";

const KEY = "credential.https://gitlab.com.helper";
const LOCK_FAIL = { stdout: "", stderr: "error: could not lock config file", exitCode: 255 };

function helperUndo(repo: string): string {
  return `git -C ${shellQuote(repo)} config --unset-all ${KEY}`;
}

function originUndo(repo: string, url: string, push = false): string {
  return `git -C ${shellQuote(repo)} remote set-url ${push ? "--push " : ""}origin ${url}`;
}

/** Real git except where `fails` says so. */
function gitFailing(fails: (args: string[]) => boolean): NonNullable<AuthDeps["git"]> {
  return async (cwd, args) => (fails(args) ? LOCK_FAIL : runGit(cwd, args));
}

let root: string;
let link: string;
let io: CapturedOut;
let exit: { restore(): void };

interface Opts {
  interactive?: boolean;
  answer?: boolean;
  lookup?: () => Promise<ForgeTokenLookup>;
  linkExists?: boolean;
  git?: AuthDeps["git"];
}

interface Harness {
  deps: AuthDeps;
  prompts: string[];
  printed: string[];
}

function harness(opts: Opts = {}): Harness {
  const prompts: string[] = [];
  const printed: string[] = [];
  const lookup = opts.lookup ?? (async (): Promise<ForgeTokenLookup> => ({ kind: "token", token: TOKEN }));
  const deps: AuthDeps = {
    auth: createOriginAuth({ confirmedHost: () => "gitlab.acme.internal", lookup }),
    rtLink: link,
    rtLinkExists: () => opts.linkExists ?? true,
    entries: () => [],
    interactive: opts.interactive ?? true,
    confirm: async (message) => {
      prompts.push(message);
      return opts.answer ?? true;
    },
    print: (line) => printed.push(line),
    ...(opts.git ? { git: opts.git } : {}),
  };
  return { deps, prompts, printed };
}

function repoWith(origin: string | null, name = "repo"): string {
  const repo = makeRepo(root, name);
  if (origin !== null) git(repo, "remote", "add", "origin", origin);
  return repo;
}

function config(repo: string): string {
  return readFileSync(join(repo, ".git", "config"), "utf8");
}

function helpers(repo: string, key = KEY): string[] {
  try {
    return git(repo, "config", "--local", "--get-all", "-z", key).split("\0").slice(0, -1);
  } catch {
    return [];
  }
}

async function run(args: string[], h: Harness): Promise<number | null> {
  return exitCodeOf(() => authCommand(args, {}, h.deps));
}

function globalConfigPaths(): string[] {
  const home = process.env.HOME!;
  return [join(home, ".gitconfig"), join(home, ".config", "git", "config")];
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-auth-write-")));
  link = join(root, "rt-link");
  writeFileSync(link, "#!/bin/sh\n");
  io = captureOut();
  out.__test__.reset();
  out.__test__.setHuman(() => false);
  exit = trapExit();
});

afterEach(() => {
  exit.restore();
  io.restore();
  setSshHostResolver(null);
  rmSync(root, { recursive: true, force: true });
});

describe("rt git auth, plain form", () => {
  test("plain form on a pending clone writes the two values after a yes", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const h = harness();
    expect(await run([repo], h)).toBeNull();
    expect(h.prompts).toHaveLength(1);
    expect(helpers(repo)).toEqual(["", rtCredentialHelper(link)]);
    expect(io.stdout()).toContain(KEY);
    expect(io.stdout()).toContain("keychain");
  });

  test("path defaults to the repo root of the current folder", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    mkdirSync(join(repo, "sub"));
    const h = harness();
    expect(await inDir(join(repo, "sub"), () => run(["--yes"], h))).toBeNull();
    expect(helpers(repo)).toEqual(["", rtCredentialHelper(link)]);
  });

  test("the done line names the exact undo", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    await run([repo], harness());
    expect(io.stdout()).toContain("now uses rt's GitLab token");
    expect(io.stdout()).toContain(helperUndo(repo));
  });

  test("--json success is the frozen shape", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const h = harness();
    expect(await run([repo, "--yes", "--json"], h)).toBeNull();
    expect(h.printed).toHaveLength(1);
    expect(JSON.parse(h.printed[0]!)).toEqual({ ok: true, path: repo, host: "gitlab.com", changed: true, undo: [helperUndo(repo)] });
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });

  test("a no at the prompt writes nothing", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const before = config(repo);
    const h = harness({ answer: false });
    expect(await run([repo], h)).toBeNull();
    expect(h.prompts).toHaveLength(1);
    expect(config(repo)).toBe(before);
    expect(io.stdout()).toContain("nothing changed");
  });

  test("without a terminal it refuses with needs-consent unless --yes", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const before = config(repo);
    const h = harness({ interactive: false });
    expect(await run([repo], h)).toBe(1);
    expect(h.prompts).toHaveLength(0);
    expect(config(repo)).toBe(before);
    expect(io.stderr()).toContain(`rt git auth ${shellQuote(repo)} --yes`);

    io.clear();
    expect(await run([repo, "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "needs-consent" });
    expect(config(repo)).toBe(before);

    expect(await run([repo, "--yes"], h)).toBeNull();
    expect(h.prompts).toHaveLength(0);
    expect(helpers(repo)).toEqual(["", rtCredentialHelper(link)]);
  });

  test("already wired: done and nothing written", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    await run([repo, "--yes"], harness());
    const before = config(repo);
    io.clear();
    const h = harness();
    expect(await run([repo], h)).toBeNull();
    expect(h.prompts).toHaveLength(0);
    expect(config(repo)).toBe(before);
    expect(io.stdout()).toContain("already uses rt's GitLab token");

    expect(await run([repo, "--json"], h)).toBeNull();
    expect(JSON.parse(h.printed[0]!)).toEqual({ ok: true, path: repo, host: "gitlab.com", changed: false, undo: [] });
  });

  test("foreign helper entries: refused, entries named, nothing written", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    git(repo, "config", "--local", "--add", KEY, "!f() { echo password=hunter2-secret; }; f");
    const before = config(repo);
    const h = harness();
    expect(await run([repo], h)).toBe(1);
    expect(h.prompts).toHaveLength(0);
    expect(config(repo)).toBe(before);
    expect(io.stderr()).toContain("has its own credential helper for gitlab.com");
    expect(io.stderr()).toContain(KEY);
    expect(io.stderr()).toContain(`rt did not make ${KEY}, so rt left it alone`);
    expect(io.stderr()).not.toContain("hunter2");
    expect(io.stdout()).not.toContain("hunter2");

    io.clear();
    expect(await run([repo, "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "own-helper" });
  });

  test("each refusal writes nothing and carries its code and next", async () => {
    const plain = join(root, "plain");
    mkdirSync(plain);
    const cases: Array<{ name: string; origin: string | null; args?: string[]; opts?: Opts; code: string; next?: string; noRepo?: boolean }> = [
      { name: "not-a-repo", origin: null, code: "not-a-repo", noRepo: true },
      { name: "no-origin", origin: null, code: "no-origin" },
      { name: "http", origin: "http://gitlab.com/acme/x.git", code: "http-origin" },
      { name: "file", origin: "file:///tmp/x.git", code: "not-https" },
      { name: "evil", origin: "https://evil.example/acme/x.git", code: "not-a-forge" },
      { name: "unreadable", origin: "https://gitlab.com/acme/x.git", opts: { lookup: async () => ({ kind: "unreadable", reason: "sops failed" }) }, code: "token-unreadable" },
      { name: "nolink", origin: "https://gitlab.com/acme/x.git", opts: { linkExists: false }, code: "no-rt-link" },
      { name: "unconfirmed", origin: "https://gitlab.other.org/acme/x.git", code: "unconfirmed-host", next: "rt setup gitlab connect --host gitlab.other.org" },
      { name: "notoken", origin: "https://gitlab.com/acme/x.git", opts: { lookup: async () => ({ kind: "absent" }) }, code: "no-token", next: "rt setup gitlab connect" },
      { name: "notoken-gh", origin: "https://github.com/acme/x.git", opts: { lookup: async () => ({ kind: "absent" }) }, code: "no-token", next: "rt setup github connect" },
      { name: "unmappable", origin: "myhost:acme/x.git", args: ["--https"], code: "unmappable-ssh" },
      { name: "needs-consent", origin: "https://gitlab.com/acme/x.git", opts: { interactive: false }, code: "needs-consent" },
    ];
    setSshHostResolver(async () => null);
    for (const c of cases) {
      const path = c.noRepo ? plain : repoWith(c.origin, c.name);
      const before = c.noRepo ? "" : config(path);
      const h = harness(c.opts);
      io.clear();
      expect([c.name, await run([path, ...(c.args ?? [])], h)]).toEqual([c.name, 1]);
      if (c.next) expect(io.stderr()).toContain(c.next);
      expect(io.stderr()).toContain("refused");
      io.clear();
      expect([c.name, await run([path, ...(c.args ?? []), "--json"], h)]).toEqual([c.name, 1]);
      expect([c.name, JSON.parse(io.stdout())]).toEqual([c.name, { ok: false, error: c.code }]);
      expect(h.prompts).toHaveLength(0);
      if (!c.noRepo) expect([c.name, config(path)]).toEqual([c.name, before]);
    }
  }, 30_000);

  test("a clone whose git config cannot be read is refused with a fixed message", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const h = harness();
    h.deps.auth = { ...h.deps.auth, verdict: async () => { throw new Error(`boom ${TOKEN}`); } };
    expect(await run([repo], h)).toBe(1);
    expect(io.stderr()).toContain("rt could not read this clone's git config");
    expect(io.stderr()).not.toContain("boom");
    expect(io.stderr()).not.toContain("LEAKCHECK");
    io.clear();
    expect(await run([repo, "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "config-unreadable" });
  });

  test("an origin read git fails on (not just absent) is refused config-unreadable and writes nothing", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    const before = config(repo);
    const h = harness({ git: gitFailing((args) => args.includes("remote.origin.pushurl")) });
    expect(await run(["--https", repo, "--yes", "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "config-unreadable" });
    expect(config(repo)).toBe(before);
  });

  test("ssh origin, plain form: refused ssh-origin, names --https only when the state is off", async () => {
    const ready = repoWith("git@gitlab.com:acme/x.git", "ready");
    const h = harness();
    expect(await run([ready], h)).toBe(1);
    expect(io.stderr()).toContain(`rt git auth --https ${shellQuote(ready)}`);
    io.clear();
    expect(await run([ready, "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "ssh-origin" });

    const unconfirmed = repoWith("git@gitlab.other.org:acme/x.git", "unconfirmed");
    const before = config(unconfirmed);
    io.clear();
    expect(await run([unconfirmed], h)).toBe(1);
    expect(io.stderr()).not.toContain("--https");
    io.clear();
    expect(await run([unconfirmed, "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "ssh-origin" });
    expect(config(unconfirmed)).toBe(before);
    expect(git(ready, "remote", "get-url", "origin")).toBe("git@gitlab.com:acme/x.git");
  });

  test("usage: --check with a path, two paths, an unknown flag", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    for (const args of [["--check", repo], [repo, repo], [repo, "--bogus"]]) {
      io.clear();
      expect(await run([...args, "--json"], harness())).toBe(1);
      expect(JSON.parse(io.stdout()).error).toStartWith("usage: rt git auth");
    }
  });
});

describe("rt git auth --https", () => {
  test("--https switches origin and writes the helper after a yes", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    const h = harness();
    expect(await run(["--https", repo], h)).toBeNull();
    expect(h.prompts).toHaveLength(1);
    expect(git(repo, "remote", "get-url", "origin")).toBe("https://gitlab.com/acme/x.git");
    expect(helpers(repo)).toEqual(["", rtCredentialHelper(link)]);
    expect(io.stdout()).toContain("git@gitlab.com:acme/x.git");
    expect(io.stdout()).toContain("https://gitlab.com/acme/x.git");
  });

  test("--https --json success carries from and to", async () => {
    const repo = repoWith("ssh://git@gitlab.com:2222/acme/x.git");
    const h = harness();
    expect(await run(["--https", repo, "--yes", "--json"], h)).toBeNull();
    expect(JSON.parse(h.printed[0]!)).toEqual({
      ok: true, path: repo, host: "gitlab.com", changed: true,
      from: "ssh://git@gitlab.com:2222/acme/x.git", to: "https://gitlab.com/acme/x.git",
      undo: [originUndo(repo, "ssh://git@gitlab.com:2222/acme/x.git"), helperUndo(repo)],
    });
    expect(io.stderr()).toBe("");
  });

  test("a no at the --https prompt switches nothing", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    const before = config(repo);
    const h = harness({ answer: false });
    expect(await run(["--https", repo], h)).toBeNull();
    expect(h.prompts).toEqual(["Switch origin and add rt's helper?"]);
    expect(config(repo)).toBe(before);
  });

  test("--https rewrites a same-repo ssh pushurl and leaves a different one alone, saying so", async () => {
    const same = repoWith("git@gitlab.com:acme/x.git", "same");
    git(same, "config", "remote.origin.pushurl", "ssh://git@gitlab.com/acme/x.git");
    expect(await run(["--https", same, "--yes"], harness())).toBeNull();
    expect(git(same, "config", "--get-all", "remote.origin.pushurl")).toBe("https://gitlab.com/acme/x.git");
    expect(io.stdout()).toContain(originUndo(same, "ssh://git@gitlab.com/acme/x.git", true));

    const other = repoWith("git@gitlab.com:acme/x.git", "other");
    git(other, "config", "remote.origin.pushurl", "git@gitlab.com:acme/fork.git");
    io.clear();
    expect(await run(["--https", other, "--yes"], harness())).toBeNull();
    expect(git(other, "config", "--get-all", "remote.origin.pushurl")).toBe("git@gitlab.com:acme/fork.git");
    expect(git(other, "remote", "get-url", "origin")).toBe("https://gitlab.com/acme/x.git");
    expect(io.stdout()).toContain("push URL");
  });

  test("--https refuses an insteadOf rule that maps back, names it, writes nothing", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    git(repo, "config", "--local", "url.git@gitlab.com:.insteadOf", "https://gitlab.com/");
    const before = config(repo);
    const h = harness();
    expect(await run(["--https", repo], h)).toBe(1);
    expect(h.prompts).toHaveLength(0);
    expect(config(repo)).toBe(before);
    expect(io.stderr()).toContain("url.git@gitlab.com:.insteadOf https://gitlab.com/");
    io.clear();
    expect(await run(["--https", repo, "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "insteadof-maps-back" });
  });

  test("--https refuses an alias that is not a forge (unmappable-ssh) and maps one that is", async () => {
    setSshHostResolver(async ({ alias }) => (alias === "work" ? "gitlab.com" : null));
    const bad = repoWith("myhost:acme/x.git", "bad");
    const before = config(bad);
    io.clear();
    expect(await run(["--https", bad, "--yes"], harness())).toBe(1);
    expect(io.stderr()).toContain("its SSH host is not a known forge");
    expect(config(bad)).toBe(before);

    const good = repoWith("git@work:acme/x.git", "good");
    expect(await run(["--https", good, "--yes"], harness())).toBeNull();
    expect(git(good, "remote", "get-url", "origin")).toBe("https://gitlab.com/acme/x.git");
    expect(helpers(good)).toEqual(["", rtCredentialHelper(link)]);
  });

  test("--https refuses an alias that only looks like a forge as unconfirmed and writes nothing", async () => {
    setSshHostResolver(async () => null);
    const repo = repoWith("git@gitlab.work:acme/x.git");
    const before = config(repo);
    expect(await run(["--https", repo, "--yes"], harness())).toBe(1);
    expect(io.stderr()).toContain("rt setup gitlab connect --host gitlab.work");
    io.clear();
    expect(await run(["--https", repo, "--yes", "--json"], harness())).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "unconfirmed-host" });
    expect(config(repo)).toBe(before);
  });

  test("--https on an https origin behaves as the plain form", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const h = harness();
    expect(await run(["--https", repo, "--yes", "--json"], h)).toBeNull();
    expect(JSON.parse(h.printed[0]!)).toEqual({ ok: true, path: repo, host: "gitlab.com", changed: true, undo: [helperUndo(repo)] });
    expect(git(repo, "remote", "get-url", "origin")).toBe("https://gitlab.com/acme/x.git");
  });

  test("--https names both undo commands", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    await run(["--https", repo, "--yes"], harness());
    expect(io.stdout()).toContain(originUndo(repo, "git@gitlab.com:acme/x.git"));
    expect(io.stdout()).toContain(helperUndo(repo));
  });

  test("--https on an ssh clone rt already wired switches origin and adds no second pair", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    for (const v of ["", rtCredentialHelper(link)]) git(repo, "config", "--local", "--add", KEY, v);
    const h = harness();
    expect(await run(["--https", repo, "--yes", "--json"], h)).toBeNull();
    expect(helpers(repo)).toEqual(["", rtCredentialHelper(link)]);
    expect(JSON.parse(h.printed[0]!).undo).toEqual([originUndo(repo, "git@gitlab.com:acme/x.git")]);
  });

  test("an old origin holding credentials is never printed and its undo is left out, saying so", async () => {
    const origins: Array<[string, string]> = [["pw", `ssh://sam:${TOKEN}@gitlab.com/acme/x.git`], ["scp", `${TOKEN}@gitlab.com:acme/x.git`]];
    for (const [name, origin] of origins) {
      const repo = repoWith(origin, name);
      io.clear();
      // The --json run before this one moved human text to stderr for the rest of the process.
      out.__test__.reset();
      out.__test__.setHuman(() => false);
      expect([name, await run(["--https", repo, "--yes"], harness())]).toEqual([name, null]);
      expect(git(repo, "remote", "get-url", "origin")).toBe("https://gitlab.com/acme/x.git");
      expect(io.stdout()).not.toContain("LEAKCHECK");
      expect(io.stdout()).not.toContain("set-url");
      expect(io.stdout()).toContain("credentials rt will not print");
      expect(io.stdout()).toContain(helperUndo(repo));

      const fresh = repoWith(origin, `${name}-json`);
      const h = harness();
      expect([name, await run(["--https", fresh, "--yes", "--json"], h)]).toEqual([name, null]);
      expect(h.printed[0]).not.toContain("LEAKCHECK");
      const env = JSON.parse(h.printed[0]!);
      expect(env.changed).toBe(true);
      expect(env.undo).toEqual([helperUndo(fresh)]);
    }
  });

  test("an origin switch that fails changes nothing", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    const before = config(repo);
    const h = harness({ git: gitFailing((args) => args[0] === "remote" && args[1] === "set-url" && !args.includes("--push")) });
    expect(await run(["--https", repo, "--yes", "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "origin-switch-failed" });
    expect(config(repo)).toBe(before);
  });

  test("a push URL switch that fails after origin switched reports it with origin's undo", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    git(repo, "config", "remote.origin.pushurl", "git@gitlab.com:acme/x.git");
    const h = harness({ git: gitFailing((args) => args.includes("--push")) });
    expect(await run(["--https", repo, "--yes"], h)).toBe(1);
    expect(git(repo, "remote", "get-url", "origin")).toBe("https://gitlab.com/acme/x.git");
    expect(helpers(repo)).toEqual([]);
    expect(io.stderr()).toContain("Switched origin to https, but not its push URL");
    expect(io.stderr()).toContain(originUndo(repo, "git@gitlab.com:acme/x.git"));

    const again = repoWith("git@gitlab.com:acme/y.git", "again");
    git(again, "config", "remote.origin.pushurl", "git@gitlab.com:acme/y.git");
    io.clear();
    expect(await run(["--https", again, "--yes", "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "push-switch-failed", undo: [originUndo(again, "git@gitlab.com:acme/y.git")] });
  });

  test("a helper write that fails after the origin switch reports the switch, the failure and both undo commands", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    const h = harness({ git: gitFailing((args) => args.includes("--add") && args.at(-1) !== "") });
    expect(await run(["--https", repo, "--yes"], h)).toBe(1);
    expect(git(repo, "remote", "get-url", "origin")).toBe("https://gitlab.com/acme/x.git");
    expect(helpers(repo)).toEqual([]);
    const err = io.stderr();
    expect(err).toContain("Switched origin to https");
    expect(err).toContain(originUndo(repo, "git@gitlab.com:acme/x.git"));
    expect(err).toContain(helperUndo(repo));

    const again = repoWith("git@gitlab.com:acme/y.git", "again");
    io.clear();
    expect(await run(["--https", again, "--yes", "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "helper-write-failed", undo: [originUndo(again, "git@gitlab.com:acme/y.git"), helperUndo(again)] });
  });

  test("a plain helper write that fails leaves no half pair behind", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const h = harness({ git: gitFailing((args) => args.includes("--add") && args.at(-1) !== "") });
    expect(await run([repo, "--yes", "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "helper-write-failed" });
    expect(helpers(repo)).toEqual([]);
  });

  test("when removing the half pair fails too, the failure names the undo", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const h = harness({ git: gitFailing((args) => (args.includes("--add") && args.at(-1) !== "") || args.includes("--unset-all")) });
    expect(await run([repo, "--yes"], h)).toBe(1);
    expect(helpers(repo)).toEqual([""]);
    expect(io.stderr()).toContain(helperUndo(repo));
    expect(io.stderr()).not.toContain("Nothing changed");

    const again = repoWith("https://gitlab.com/acme/y.git", "again");
    io.clear();
    expect(await run([again, "--yes", "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "helper-write-failed", undo: [helperUndo(again)] });
  });
});

/** A fake rt that answers `git credential get` with the token, and a clone helper that logs what git hands it. */
function credentialFakes(): { otherHelper: string; otherLog: () => string } {
  writeFileSync(link, `#!/bin/sh\ncat >/dev/null\nif [ "$3" = get ]; then printf 'username=oauth2\\npassword=${TOKEN}\\n'; fi\n`);
  chmodSync(link, 0o755);
  const log = join(root, "other-helper.log");
  const script = join(root, "other-helper.sh");
  writeFileSync(script, `#!/bin/sh\necho "$1 $(cat | tr '\\n' ' ')" >> '${log}'\n`);
  chmodSync(script, 0o755);
  return { otherHelper: script, otherLog: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

/** Real `git credential fill` then `approve`, as a fetch does, with no system or global helper. */
function fillThenApprove(repo: string): string {
  const empty = join(root, "empty.gitconfig");
  writeFileSync(empty, "");
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: empty, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" };
  const fill = spawnSync("git", ["credential", "fill"], { cwd: repo, env, encoding: "utf8", input: "protocol=https\nhost=gitlab.com\n\n" });
  spawnSync("git", ["credential", "approve"], { cwd: repo, env, encoding: "utf8", input: `${fill.stdout}\n` });
  return fill.stdout;
}

describe("rt git auth and the clone's other helpers", () => {
  test("a local helper before where rt writes: rt's pair clears it, and approve never hands it the token", async () => {
    const { otherHelper, otherLog } = credentialFakes();
    const repo = repoWith("https://gitlab.com/acme/x.git");
    git(repo, "config", "--local", "credential.helper", otherHelper);
    expect(await run([repo, "--yes"], harness())).toBeNull();
    expect(fillThenApprove(repo)).toContain("LEAKCHECK");
    expect(otherLog()).not.toContain("LEAKCHECK");
  });

  test("a username section first and a local helper after: refused own-helper, nothing written, the helper never sees the token", async () => {
    const { otherHelper, otherLog } = credentialFakes();
    const repo = repoWith("https://gitlab.com/acme/x.git");
    git(repo, "config", "--local", "credential.https://gitlab.com.username", "me");
    git(repo, "config", "--local", "credential.helper", otherHelper);
    const before = config(repo);
    const h = harness();
    expect(await run([repo, "--yes"], h)).toBe(1);
    expect(config(repo)).toBe(before);
    expect(io.stderr()).toContain("has its own credential helper for gitlab.com");
    expect(io.stderr()).toContain("credential.helper");
    expect(io.stderr()).not.toContain(otherHelper);
    io.clear();
    expect(await run([repo, "--yes", "--json"], h)).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "own-helper" });
    fillThenApprove(repo);
    expect(otherLog()).not.toContain("LEAKCHECK");
  });

  test("a helper after a section rt cannot see from its keys: written, checked, taken back and refused", async () => {
    const { otherHelper, otherLog } = credentialFakes();
    const repo = repoWith("https://gitlab.com/acme/x.git");
    writeFileSync(join(repo, ".git", "config"), `${config(repo)}[credential "https://gitlab.com"]\n[credential]\n\thelper = ${otherHelper}\n`);
    expect(await run([repo, "--yes"], harness())).toBe(1);
    expect(helpers(repo)).toEqual([]);
    expect(io.stderr()).toContain("has its own credential helper for gitlab.com");
    expect(io.stderr()).not.toContain(otherHelper);
    fillThenApprove(repo);
    expect(otherLog()).not.toContain("LEAKCHECK");
  });

  test("a helper added after rt wired the clone: refused own-helper, names how to remove rt's helper", async () => {
    const { otherHelper } = credentialFakes();
    const repo = repoWith("https://gitlab.com/acme/x.git");
    expect(await run([repo, "--yes"], harness())).toBeNull();
    git(repo, "config", "credential.helper", otherHelper);
    const before = config(repo);
    io.clear();
    expect(await run([repo], harness())).toBe(1);
    expect(config(repo)).toBe(before);
    expect(io.stderr()).toContain("another credential helper comes after rt's");
    expect(io.stderr()).toContain(helperUndo(repo));
    expect(io.stderr()).not.toContain("already uses");
    expect(io.stderr()).not.toContain(otherHelper);
  });
});

/** A linked worktree of `repo` with per-worktree config switched on. */
function linkedWorktree(repo: string): string {
  const linked = join(root, "linked");
  git(repo, "worktree", "add", "-q", "-b", "linked", linked);
  git(repo, "config", "extensions.worktreeConfig", "true");
  return linked;
}

describe("rt git auth and helpers in other worktrees", () => {
  test("a helper in a linked worktree's config.worktree: refused own-helper from the main root, and the helper never sees the token", async () => {
    const { otherHelper, otherLog } = credentialFakes();
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const linked = linkedWorktree(repo);
    git(linked, "config", "--worktree", "credential.helper", otherHelper);
    const before = config(repo);
    expect(await run([repo, "--yes"], harness())).toBe(1);
    expect(config(repo)).toBe(before);
    expect(io.stderr()).toContain("has its own credential helper for gitlab.com");
    expect(io.stderr()).not.toContain(otherHelper);
    fillThenApprove(linked);
    expect(otherLog()).not.toContain("LEAKCHECK");
  });

  test("a worktree helper that appears while rt writes: the re-check takes rt's pair back", async () => {
    const { otherHelper, otherLog } = credentialFakes();
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const linked = linkedWorktree(repo);
    let planted = false;
    const plant: NonNullable<AuthDeps["git"]> = async (cwd, args) => {
      const res = await runGit(cwd, args);
      if (!planted && args[0] === "config" && args.includes("--add")) {
        planted = true;
        git(linked, "config", "--worktree", "credential.helper", otherHelper);
      }
      return res;
    };
    expect(await run([repo, "--yes"], harness({ git: plant }))).toBe(1);
    expect(helpers(repo)).toEqual([]);
    expect(io.stderr()).toContain("has its own credential helper for gitlab.com");
    fillThenApprove(linked);
    expect(otherLog()).not.toContain("LEAKCHECK");
  });

  test("a worktree rt cannot read: refused config-unreadable, nothing written", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    rmSync(linkedWorktree(repo), { recursive: true, force: true });
    const before = config(repo);
    expect(await run([repo, "--yes", "--json"], harness())).toBe(1);
    expect(JSON.parse(io.stdout())).toMatchObject({ ok: false, error: "config-unreadable" });
    expect(config(repo)).toBe(before);
  });
});

describe("rt git auth leaks and scope", () => {
  test("no token value in config, remote URL, printed output or the envelope", async () => {
    const plainRepo = repoWith("https://gitlab.com/acme/x.git", "plain");
    const sshRepo = repoWith("git@gitlab.com:acme/y.git", "ssh");
    const h = harness();
    await run([plainRepo], h);
    await run(["--https", sshRepo], h);
    await run([plainRepo, "--json"], h);
    await run(["--https", sshRepo, "--json"], h);
    for (const repo of [plainRepo, sshRepo]) {
      expect(readFileSync(join(repo, ".git/config"), "utf8")).not.toContain("LEAKCHECK");
      expect(git(repo, "remote", "get-url", "origin")).not.toContain("LEAKCHECK");
    }
    expect(io.stdout()).not.toContain("LEAKCHECK");
    expect(io.stderr()).not.toContain("LEAKCHECK");
    expect(h.printed.join("\n")).not.toContain("LEAKCHECK");
    expect(h.prompts.join("\n")).not.toContain("LEAKCHECK");
  });

  test("global config is never touched", async () => {
    for (const p of globalConfigPaths()) expect(existsSync(p)).toBe(false);
    await run([repoWith("https://gitlab.com/acme/x.git", "plain"), "--yes"], harness());
    await run(["--https", repoWith("git@gitlab.com:acme/y.git", "ssh"), "--yes"], harness());
    for (const p of globalConfigPaths()) expect(existsSync(p)).toBe(false);
  });
});
