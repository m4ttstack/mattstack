import { describe, expect, test } from "bun:test";
import { homeRestore, type AgeKeyInputSeam, type HomeRestoreDeps } from "../home.ts";
import { homeRepoTarget, runHomeRestore } from "../../lib/home/restore.ts";
import type { AgeExecResult, AgeKeySeam } from "../../lib/home/age-key.ts";
import { UserActionableError } from "../../lib/errors.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecResult } from "../../lib/setup/probes.ts";

const HOME = "/fake-home";
const GIT_DIR = `${HOME}/.mattstack/user/.git`;
const MACHINE_KEY = `${HOME}/.mattstack/machine-key`;
const INTENT = `${HOME}/.mattstack/rt/setup-intent.json`;

// Obvious placeholders: no real age key is ever in a fixture.
const PASTED_KEY = "AGE-SECRET-KEY-1PLACEHOLDERPASTED";
const OTHER_KEY = "AGE-SECRET-KEY-1PLACEHOLDEROTHER";
const RECIPIENTS: Record<string, string> = { [PASTED_KEY]: "age1placeholderpasted", [OTHER_KEY]: "age1placeholderother" };

const REPO = "janedoe/mattstack-home";
const URL = "https://github.com/janedoe/mattstack-home.git";

/** An in-memory keychain behind the age seam; the real keychain is never reached. */
class FakeKeychain implements AgeKeySeam {
  calls: string[][] = [];
  constructor(
    public stored: string | null = null,
    private readonly events: string[] = [],
    private readonly locked = false,
  ) {}

  async run(cmd: string[], opts?: { input?: string }): Promise<AgeExecResult> {
    this.calls.push(cmd);
    if (cmd[1] === "find-generic-password") {
      if (this.locked) return { code: 51, stdout: "", stderr: "User interaction is not allowed." };
      return this.stored === null
        ? { code: 44, stdout: "", stderr: "The specified item could not be found in the keychain." }
        : { code: 0, stdout: `${this.stored}\n`, stderr: "" };
    }
    if (cmd[0] === "age-keygen" && cmd[1] === "-y") {
      const recipient = RECIPIENTS[opts?.input ?? ""];
      return recipient ? { code: 0, stdout: `${recipient}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "malformed secret key" };
    }
    if (cmd[1] === "add-generic-password") {
      this.stored = cmd[cmd.indexOf("-w") + 1]!;
      this.events.push("key-stored");
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`FakeKeychain: unexpected call ${cmd[0]} ${cmd[1]}`);
  }

  get writes(): number {
    return this.calls.filter((c) => c[1] === "add-generic-password").length;
  }
}

type InitBehavior = "ok" | "clone-fails" | "profile-fails";

/** Stands in for the `rt home init` subprocess: what it leaves on disk is what the real one would. */
function world(opts: { keychain?: string | null; locked?: boolean; init?: InitBehavior[]; files?: Record<string, string>; dirs?: Record<string, string[]> } = {}) {
  const events: string[] = [];
  const initCalls: string[][] = [];
  const behaviors = [...(opts.init ?? ["ok"])];
  const keychain = new FakeKeychain(opts.keychain ?? null, events, opts.locked ?? false);
  const p = fakeProbes({
    home: HOME,
    files: opts.files,
    dirs: opts.dirs,
    runRt: async (args): Promise<ExecResult> => {
      initCalls.push(args);
      events.push("init");
      const behavior = behaviors.shift() ?? "ok";
      if (behavior === "clone-fails") {
        return { code: 1, stdout: "", stderr: "rt could not clone your home repo\nwhat it said:\nfatal: repository not found\n" };
      }
      if (!p.exists(GIT_DIR)) {
        p.mkdirp(GIT_DIR);
        p.writeFile(`${GIT_DIR}/config`, `[remote "origin"]\n\turl = ${args[args.indexOf("--url") + 1]}\n`);
      }
      if (behavior === "profile-fails") {
        return { code: 1, stdout: "", stderr: "That machine profile will not work\nwhy: This Mac's default profile name already belongs to another Mac's profile.\n" };
      }
      if (!p.exists(MACHINE_KEY)) p.writeFile(MACHINE_KEY, "this-mac");
      return { code: 0, stdout: "[ok] This Mac is set up\n", stderr: "" };
    },
  });
  return { p, keychain, events, initCalls };
}

function intentOf(p: ReturnType<typeof fakeProbes>): unknown {
  const raw = p.readFile(INTENT);
  return raw === null ? null : JSON.parse(raw);
}

async function failure(run: Promise<unknown>): Promise<UserActionableError> {
  try {
    await run;
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("expected the restore to fail");
}

function mentionsKey(err: UserActionableError): boolean {
  const text = [err.message, err.why, err.next, err.thenRun, err.log, JSON.stringify(err.extra)].join("\n");
  return text.includes("PLACEHOLDERPASTED") || text.includes("PLACEHOLDEROTHER");
}

describe("homeRepoTarget", () => {
  test("owner/repo is a GitHub home repo, the host rt itself creates them on", () => {
    expect(homeRepoTarget(REPO)).toEqual({ url: URL, homeRepo: REPO });
    expect(homeRepoTarget(" janedoe/mattstack-home.git\n")).toEqual({ url: URL, homeRepo: REPO });
  });

  test("host/owner/repo names its own host", () => {
    expect(homeRepoTarget("gitlab.example.com/janedoe/mattstack-home")).toEqual({
      url: "https://gitlab.example.com/janedoe/mattstack-home.git",
      homeRepo: REPO,
    });
  });

  test("a clone URL is used as given, and its last two segments are the repo", () => {
    expect(homeRepoTarget("git@github.com:janedoe/mattstack-home.git")).toEqual({ url: "git@github.com:janedoe/mattstack-home.git", homeRepo: REPO });
    expect(homeRepoTarget("https://gitlab.com/acme/widgets/mattstack-home.git")).toEqual({
      url: "https://gitlab.com/acme/widgets/mattstack-home.git",
      homeRepo: "widgets/mattstack-home",
    });
    expect(homeRepoTarget("ssh://git@gitlab.example.com:2222/janedoe/mattstack-home.git").homeRepo).toBe(REPO);
  });

  test("a bad host is refused", () => {
    for (const bad of ["bad_host.com/janedoe/mattstack-home", "https://-bad-/janedoe/mattstack-home.git", "widgets/sub/mattstack-home"]) {
      expect(() => homeRepoTarget(bad)).toThrow("That host name will not work");
    }
  });

  test("something that is not a repo is refused", () => {
    for (const bad of ["mattstack-home", "janedoe/../etc", "", "janedoe/"]) {
      expect(() => homeRepoTarget(bad)).toThrow(UserActionableError);
    }
  });

  test("a URL carrying a password is refused without echoing it", () => {
    try {
      homeRepoTarget("https://janedoe:hunter2@github.com/janedoe/mattstack-home.git");
      throw new Error("expected a refusal");
    } catch (err) {
      expect((err as UserActionableError).code).toBe("bad-repo");
      expect(JSON.stringify(err) + (err as Error).message).not.toContain("hunter2");
    }
  });
});

describe("runHomeRestore", () => {
  test("a fresh Mac: the key goes in first, init clones into a new profile, the intent is recorded last", async () => {
    const { p, keychain, events, initCalls } = world();
    const result = await runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY });

    expect(result).toEqual({ url: URL, homeRepo: REPO, key: "imported" });
    expect(keychain.stored).toBe(PASTED_KEY);
    expect(events).toEqual(["key-stored", "init"]);
    expect(initCalls).toEqual([["home", "init", "--url", URL, "--no-materialize", "--new-profile"]]);
    expect(intentOf(p)).toEqual({ v: 1, at: "2026-01-01T00:00:00.000Z", mode: "restore", restore: { homeRepo: REPO, url: URL } });
    expect(initCalls.flat().join(" ")).not.toContain("PLACEHOLDER");
  });

  test("the same key already in the keychain is kept, never written again", async () => {
    const { p, keychain } = world({ keychain: PASTED_KEY });
    const result = await runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY });
    expect(result.key).toBe("kept");
    expect(keychain.writes).toBe(0);
    expect(intentOf(p)).not.toBeNull();
  });

  test("a different key in the keychain is refused with a next, and nothing else runs", async () => {
    const { p, keychain, initCalls } = world({ keychain: OTHER_KEY });
    const err = await failure(runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY }));
    expect(err.code).toBe("other-key");
    expect(err.next).toBe("rt home key import --force");
    expect(err.thenRun).toBe(`rt home restore ${REPO} --stdin`);
    expect(keychain.stored).toBe(OTHER_KEY);
    expect(keychain.calls.some((c) => c.includes("-U"))).toBe(false);
    expect(initCalls).toEqual([]);
    expect(intentOf(p)).toBeNull();
    expect(mentionsKey(err)).toBe(false);
  });

  test("something that is not a recovery key is refused before the keychain is read", async () => {
    const { p, keychain, initCalls } = world();
    for (const bad of ["not a key", "AGE-SECRET-KEY-1PLACEHOLDERGARBLED"]) {
      const err = await failure(runHomeRestore(p, keychain, { repo: REPO, privateKey: bad }));
      expect(err.code).toBe("bad-key");
      expect([err.message, err.why].join(" ")).not.toContain("GARBLED");
    }
    expect(keychain.calls.some((c) => c[1] === "find-generic-password")).toBe(false);
    expect(initCalls).toEqual([]);
  });

  test("a locked keychain stops the restore with nothing written", async () => {
    const { p, keychain, initCalls } = world({ locked: true });
    const err = await failure(runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY }));
    expect(err.code).toBe("keychain");
    expect(keychain.writes).toBe(0);
    expect(initCalls).toEqual([]);
    expect(mentionsKey(err)).toBe(false);
  });

  test("a bad host is refused before the key is touched", async () => {
    const { p, keychain, initCalls } = world();
    const err = await failure(runHomeRestore(p, keychain, { repo: "bad_host.com/janedoe/mattstack-home", privateKey: PASTED_KEY }));
    expect(err.code).toBe("bad-host");
    expect(keychain.calls).toEqual([]);
    expect(initCalls).toEqual([]);
  });

  test("a different settings repo already on this Mac is left alone", async () => {
    const { p, keychain, initCalls } = world({
      dirs: { [GIT_DIR]: [] },
      files: { [`${GIT_DIR}/config`]: '[remote "origin"]\n\turl = https://github.com/janedoe/other-home.git\n' },
    });
    const err = await failure(runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY }));
    expect(err.code).toBe("other-home-repo");
    expect(keychain.writes).toBe(0);
    expect(initCalls).toEqual([]);
  });

  test("retry after the clone failed: the key is kept, the clone runs again, the intent lands", async () => {
    const { p, keychain, initCalls } = world({ init: ["clone-fails", "ok"] });
    const err = await failure(runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY }));
    expect(err.code).toBe("init-failed");
    expect(err.message).toBe("rt could not clone your home repo: fatal: repository not found");
    expect(err.next).toBe(`rt home restore ${REPO} --stdin`);
    expect(keychain.stored).toBe(PASTED_KEY);
    expect(intentOf(p)).toBeNull();

    const result = await runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY });
    expect(result.key).toBe("kept");
    expect(keychain.writes).toBe(1);
    expect(initCalls).toHaveLength(2);
    expect(intentOf(p)).not.toBeNull();
  });

  test("retry after init stopped at the profile choice: a named profile finishes it", async () => {
    const { p, keychain, initCalls } = world({ init: ["profile-fails", "ok"] });
    const err = await failure(runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY }));
    expect(err.code).toBe("profile");
    expect(err.next).toBe(`rt home restore ${REPO} --stdin --profile <name>`);
    expect(intentOf(p)).toBeNull();

    await runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY, profile: "janes-new-mac" });
    expect(initCalls[1]).toEqual(["home", "init", "--url", URL, "--no-materialize", "--profile", "janes-new-mac", "--new-profile"]);
    expect(intentOf(p)).not.toBeNull();
  });

  test("retry once the clone, key and profile are in place: init runs with no profile flag and the intent lands", async () => {
    const { p, keychain, initCalls } = world({
      keychain: PASTED_KEY,
      dirs: { [GIT_DIR]: [] },
      files: { [`${GIT_DIR}/config`]: `[remote "origin"]\n\turl = ${URL}\n`, [MACHINE_KEY]: "this-mac" },
    });
    const result = await runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY, profile: "ignored" });
    expect(result.key).toBe("kept");
    expect(initCalls).toEqual([["home", "init", "--url", URL, "--no-materialize"]]);
    expect(intentOf(p)).not.toBeNull();
  });

  test("a second run after a full restore changes nothing but the intent's time", async () => {
    const { p, keychain, initCalls } = world();
    await runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY });
    const again = await runHomeRestore(p, keychain, { repo: REPO, privateKey: PASTED_KEY });
    expect(again).toEqual({ url: URL, homeRepo: REPO, key: "kept" });
    expect(keychain.writes).toBe(1);
    expect(initCalls[1]).toEqual(["home", "init", "--url", URL, "--no-materialize"]);
  });
});

class Exit extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

function cliDeps(w: ReturnType<typeof world>, key: string, stdinUsed: { value: boolean } = { value: false }) {
  const lines: unknown[] = [];
  const input: AgeKeyInputSeam = {
    fromStdin: async () => {
      stdinUsed.value = true;
      return key;
    },
    fromPrompt: async () => key,
  };
  const deps: HomeRestoreDeps = {
    probes: w.p,
    ageKeySeam: w.keychain,
    input,
    json: (v) => lines.push(v),
    exit: (code) => {
      throw new Exit(code);
    },
  };
  return { deps, lines };
}

describe("rt home restore", () => {
  test("--json success is one envelope with the repo, its URL and what happened to the key", async () => {
    const w = world();
    const stdinUsed = { value: false };
    const { deps, lines } = cliDeps(w, PASTED_KEY, stdinUsed);
    await homeRestore([REPO, "--stdin", "--json"], {}, deps);
    expect(stdinUsed.value).toBe(true);
    expect(lines).toEqual([{ contract: 1, at: "2026-01-01T00:00:00.000Z", ok: true, repo: REPO, url: URL, key: "imported" }]);
  });

  test("--json failure is the error envelope, exit 2, and never carries the key", async () => {
    const w = world({ keychain: OTHER_KEY });
    const { deps, lines } = cliDeps(w, PASTED_KEY);
    const exit = await homeRestore([REPO, "--stdin", "--json"], {}, deps).catch((e) => e);
    expect(exit).toBeInstanceOf(Exit);
    expect((exit as Exit).code).toBe(2);
    expect(lines).toHaveLength(1);
    expect((lines[0] as { error: { code: string } }).error.code).toBe("other-key");
    expect(JSON.stringify(lines)).not.toContain("PLACEHOLDER");
  });

  test("a recovery key passed on the command line is refused and never reaches the keychain", async () => {
    const w = world();
    const { deps, lines } = cliDeps(w, PASTED_KEY);
    await homeRestore([REPO, PASTED_KEY, "--json"], {}, deps).catch(() => {});
    expect((lines[0] as { error: { code: string } }).error.code).toBe("key-on-argv");
    expect(JSON.stringify(lines)).not.toContain("PLACEHOLDER");
    expect(w.keychain.calls).toEqual([]);
  });

  test("--profile's value is not mistaken for the repo", async () => {
    const w = world();
    const { deps } = cliDeps(w, PASTED_KEY);
    await homeRestore(["--profile", "janes-new-mac", REPO, "--stdin", "--json"], {}, deps);
    expect(w.initCalls[0]).toEqual(["home", "init", "--url", URL, "--no-materialize", "--profile", "janes-new-mac", "--new-profile"]);
  });

  test("no repo asks which one", async () => {
    const w = world();
    const { deps, lines } = cliDeps(w, PASTED_KEY);
    await homeRestore(["--stdin", "--json"], {}, deps).catch(() => {});
    expect((lines[0] as { error: { code: string; message: string } }).error).toEqual({ code: "usage", message: "Which settings repo should rt restore?" });
  });
});
