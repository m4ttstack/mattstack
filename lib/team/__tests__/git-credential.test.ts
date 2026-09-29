import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
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
    const git = gitWithToken([], "tok_rt", {}, { remote: "https://github.com/acme/app.git" });
    expect(git.argv.join(" ")).not.toContain("tok_rt");
    expect(credentialFill(git.argv, git.env)).toContain("password=tok_rt");
  });

  describe("scoped to one host", () => {
    let log: string;
    let globalConfig: string;

    beforeEach(() => {
      log = join(home, "helper.log");
      globalConfig = join(home, "global.gitconfig");
      const logger = join(home, "logger.sh");
      writeFileSync(logger, `#!/bin/sh\necho "$1 $(cat | tr '\\n' ' ')" >> '${log}'\n`);
      chmodSync(logger, 0o755);
      writeFileSync(globalConfig, `[credential]\n\thelper = ${logger}\n`);
    });

    function run(argv: string[], env: Record<string, string>, sub: "fill" | "approve", input: string): string {
      const [cmd, ...rest] = argv;
      return spawnSync(cmd!, [...rest, "credential", sub], {
        cwd: repo,
        env: { ...isolatedEnv(env), GIT_CONFIG_GLOBAL: globalConfig },
        input,
        encoding: "utf8",
      }).stdout;
    }
    const readLog = () => {
      try {
        return readFileSync(log, "utf8");
      } catch {
        return "";
      }
    };

    test("the checked host gets rt's token and no other helper is consulted", () => {
      const git = gitWithToken([], "tok_rt", {}, { remote: "https://github.com/acme/app.git" });
      expect(run(git.argv, git.env, "fill", "protocol=https\nhost=github.com\n\n")).toContain("password=tok_rt");
      expect(readLog()).toBe("");
    });

    test("a successful auth's store never hands the token to the user's helpers (a keychain would keep it)", () => {
      const git = gitWithToken([], "tok_rt", {}, { remote: "https://github.com/acme/app.git" });
      run(git.argv, git.env, "approve", "protocol=https\nhost=github.com\nusername=x-access-token\npassword=tok_rt\n\n");
      expect(readLog()).not.toContain("tok_rt");
    });

    test("any other host (a submodule, a redirect) never gets the token", () => {
      const git = gitWithToken([], "tok_rt", {}, { remote: "https://github.com/acme/app.git" });
      expect(run(git.argv, git.env, "fill", "protocol=https\nhost=gitlab.com\n\n")).not.toContain("tok_rt");
    });

    test("cleartext http on the same host never gets the token", () => {
      const git = gitWithToken([], "tok_rt", {}, { remote: "https://github.com/acme/app.git" });
      expect(run(git.argv, git.env, "fill", "protocol=http\nhost=github.com\n\n")).not.toContain("tok_rt");
    });
  });

  test.each([
    ["an scp-style ssh remote", "git@github.com:acme/app.git"],
    ["cleartext http", "http://github.com/acme/app.git"],
    ["a local path", "/tmp/acme/app"],
    ["no remote", null],
  ])("%s gets no token and no helper", (_label, remote) => {
    expect(gitWithToken(["fetch"], "tok_rt", { A: "1" }, { remote })).toEqual({ argv: ["git", "fetch"], env: { A: "1" } });
  });

  test("no call site offers a token through an unscoped credential.helper", () => {
    const grep = spawnSync("git", ["grep", "-l", "-F", "credential.helper=", "--", "lib", "commands", ":!*__tests__*"], {
      cwd: join(import.meta.dir, "..", "..", ".."),
      encoding: "utf8",
    });
    expect(grep.status).toBe(1);
    expect(grep.stdout).toBe("");
  });

  test("no token: plain git, nothing added", () => {
    expect(gitWithToken(["fetch"], null, { A: "1" }, { remote: "https://github.com/acme/app.git" })).toEqual({ argv: ["git", "fetch"], env: { A: "1" } });
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
