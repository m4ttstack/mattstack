import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { credentialHelperReply, gitWithRtCredential } from "../git-credential.ts";
import { expectNoToken, rtHelperHost } from "./rt-credential-argv.ts";

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

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-git-cred-")));
  repo = join(home, "repo");
  execFileSync("git", ["init", "-q", repo], { env: isolatedEnv() });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("gitWithRtCredential", () => {
  const pair = (host: string, helper: string) => [
    "git",
    "-c",
    `credential.https://${host}.helper=`,
    "-c",
    `credential.https://${host}.helper=${helper}`,
  ];

  test.each([
    ["github.com", "https://github.com/acme/app.git", "github.com"],
    ["a GitLab host", "https://gitlab.example.com/acme/app.git", "gitlab.example.com"],
    ["an upper-case scheme and host", "HTTPS://GitLab.Example.com/acme/app.git", "gitlab.example.com"],
    ["a remote with userinfo", "https://oauth2@gitlab.com/acme/app.git", "gitlab.com"],
  ])("offer true on https %s: helper pair for the host, env unchanged, offered true", (_label, remote, host) => {
    expect(gitWithRtCredential(["fetch"], true, { A: "1" }, { remote, helper: "!stub" })).toEqual({
      argv: [...pair(host, "!stub"), "fetch"],
      env: { A: "1" },
      offered: true,
    });
  });

  test.each([
    ["an scp-style ssh remote", "git@github.com:acme/app.git"],
    ["cleartext http", "http://github.com/acme/app.git"],
    ["a local path", "/tmp/acme/app"],
    ["no remote", null],
  ])("%s gets plain git and offered false", (_label, remote) => {
    expect(gitWithRtCredential(["fetch"], true, { A: "1" }, { remote, helper: "!stub" })).toEqual({ argv: ["git", "fetch"], env: { A: "1" }, offered: false });
  });

  test("offer false on https: plain git, offered false", () => {
    expect(gitWithRtCredential(["fetch"], false, { A: "1" }, { remote: "https://github.com/acme/app.git", helper: "!stub" })).toEqual({
      argv: ["git", "fetch"],
      env: { A: "1" },
      offered: false,
    });
  });

  test("the default helper is rt git credential from rt's CLI entry", () => {
    const { argv } = gitWithRtCredential(["fetch"], true, {}, { remote: "https://github.com/a/b.git" });
    expect(rtHelperHost(argv)).toBe("github.com");
    expect(argv[4]).toEndWith(" git credential");
    expect(argv[4]).toContain("cli.ts");
  });

  describe("with real git and no network", () => {
    let stub: string;
    let log: string;
    let globalConfig: string;

    beforeEach(() => {
      stub = join(home, "stub-helper.sh");
      log = join(home, "helper.log");
      globalConfig = join(home, "global.gitconfig");
      writeFileSync(stub, "#!/bin/sh\ncat >/dev/null\necho username=x-access-token\necho password=tok_rt\n");
      chmodSync(stub, 0o755);
      const logger = join(home, "logger.sh");
      writeFileSync(logger, `#!/bin/sh\necho "$1 $(cat | tr '\\n' ' ')" >> '${log}'\n`);
      chmodSync(logger, 0o755);
      writeFileSync(globalConfig, `[credential]\n\thelper = ${logger}\n`);
    });

    function git(argv: string[], env: Record<string, string>, sub: "fill" | "approve", input: string): string {
      const [cmd, ...rest] = argv;
      return spawnSync(cmd!, [...rest, "credential", sub], {
        cwd: repo,
        env: { ...isolatedEnv(env), GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_PARAMETERS: `'credential.helper=${join(home, "logger.sh")}'` },
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

    test.each([
      ["gitlab.example.com", "https://gitlab.example.com/acme/app.git"],
      ["github.com", "https://github.com/acme/app.git"],
    ])("the helper answers %s, approve reaches no other helper, another host gets nothing", (host, remote) => {
      const built = gitWithRtCredential([], true, {}, { remote, helper: `!${stub}` });
      expectNoToken(built.env, "tok_rt");
      expect(built.argv.join(" ")).not.toContain("tok_rt");

      expect(git(built.argv, built.env, "fill", `protocol=https\nhost=${host}\n\n`)).toContain("password=tok_rt");
      git(built.argv, built.env, "approve", `protocol=https\nhost=${host}\nusername=x-access-token\npassword=tok_rt\n\n`);
      expect(readLog()).toBe("");

      const other = host === "github.com" ? "gitlab.com" : "github.com";
      expect(git(built.argv, built.env, "fill", `protocol=https\nhost=${other}\n\n`)).not.toContain("tok_rt");
    });
  });

  test("no call site offers a token through an unscoped credential.helper", () => {
    const grep = spawnSync("git", ["grep", "-l", "-F", "credential.helper=", "--", "lib", "commands", ":!*__tests__*"], {
      cwd: join(import.meta.dir, "..", "..", ".."),
      encoding: "utf8",
    });
    expect(grep.status).toBe(1);
    expect(grep.stdout).toBe("");
  });

  test("the guard pattern does not match the builder", () => {
    expect(/\bgitWithToken\s*\(/.test("gitWithRtCredential(")).toBe(false);
  });
});

describe("rtHelperHost", () => {
  const key = (host: string) => `credential.https://${host}.helper`;

  test("the real default pair returns its host", () => {
    expect(rtHelperHost(gitWithRtCredential(["fetch"], true, {}, { remote: "https://gitlab.example.com/a/b.git" }).argv)).toBe("gitlab.example.com");
  });

  test("plain git returns null", () => {
    expect(rtHelperHost(["git", "fetch"])).toBeNull();
  });

  test("two clears in a row throw", () => {
    expect(() => rtHelperHost(["git", "-c", `${key("github.com")}=`, "-c", `${key("github.com")}=`, "fetch"])).toThrow();
  });

  test("a pair naming another helper throws", () => {
    expect(() => rtHelperHost(["git", "-c", `${key("github.com")}=`, "-c", `${key("github.com")}=!osxkeychain`, "fetch"])).toThrow();
  });

  test("mismatched hosts throw", () => {
    expect(() => rtHelperHost(["git", "-c", `${key("github.com")}=`, "-c", `${key("gitlab.com")}=!rt git credential`, "fetch"])).toThrow();
  });

  test("a half pair throws", () => {
    expect(() => rtHelperHost(["git", "-c", `${key("github.com")}=`, "fetch"])).toThrow();
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
