import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { credentialHelperReply, gitWithToken } from "../git-credential.ts";

let home: string;
let repo: string;

/** Git with no global or system config, so the machine's own helpers (osxkeychain) never answer. */
function isolatedEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

function credentialFill(argvPrefix: string[], env: Record<string, string>): string {
  const [cmd, ...rest] = argvPrefix;
  const r = spawnSync(cmd!, [...rest, "credential", "fill"], {
    cwd: repo,
    env: isolatedEnv(env),
    input: "protocol=https\nhost=github.com\npath=acme/app.git\n\n",
    encoding: "utf8",
  });
  return r.stdout;
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-git-cred-")));
  repo = join(home, "repo");
  execFileSync("git", ["init", "-q", repo], { env: isolatedEnv() });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("gitWithToken", () => {
  test("hands git the token through the inline helper and env, never argv", () => {
    const git = gitWithToken([], "tok_rt", {});
    expect(git.argv.join(" ")).not.toContain("tok_rt");
    expect(credentialFill(git.argv, git.env)).toContain("password=tok_rt");
  });

  test("keepUserHelpers: a helper the repo already has answers first", () => {
    const helper = join(home, "user-helper.sh");
    writeFileSync(helper, "#!/bin/sh\necho username=me\necho password=user_secret\n");
    chmodSync(helper, 0o755);
    execFileSync("git", ["-C", repo, "config", "credential.helper", helper], { env: isolatedEnv() });

    const kept = gitWithToken([], "tok_rt", {}, { keepUserHelpers: true });
    expect(credentialFill(kept.argv, kept.env)).toContain("password=user_secret");

    const replaced = gitWithToken([], "tok_rt", {});
    expect(credentialFill(replaced.argv, replaced.env)).toContain("password=tok_rt");
  });

  test("keepUserHelpers: rt's token fills in when the user's helpers have nothing", () => {
    const git = gitWithToken([], "tok_rt", {}, { keepUserHelpers: true });
    expect(credentialFill(git.argv, git.env)).toContain("password=tok_rt");
  });

  test("no token: plain git, nothing added", () => {
    expect(gitWithToken(["fetch"], null, { A: "1" }, { keepUserHelpers: true })).toEqual({ argv: ["git", "fetch"], env: { A: "1" } });
  });
});

describe("credentialHelperReply", () => {
  const lookup = async (host: string) => (host === "github.com" ? "tok_rt" : null);

  test("get over https answers with the token rt holds for that host", async () => {
    expect(await credentialHelperReply("get", "protocol=https\nhost=github.com\n\n", lookup)).toBe("username=x-access-token\npassword=tok_rt\n");
  });

  test("a host rt holds nothing for gets an empty reply, so git moves on", async () => {
    expect(await credentialHelperReply("get", "protocol=https\nhost=gitlab.evil.example\n\n", lookup)).toBe("");
  });

  test("cleartext http never gets the token", async () => {
    expect(await credentialHelperReply("get", "protocol=http\nhost=github.com\n\n", lookup)).toBe("");
  });

  test("store and erase are ignored: the token lives in rt's store, not git's", async () => {
    expect(await credentialHelperReply("store", "protocol=https\nhost=github.com\nusername=x\npassword=y\n\n", lookup)).toBe("");
    expect(await credentialHelperReply("erase", "protocol=https\nhost=github.com\n\n", lookup)).toBe("");
  });
});
