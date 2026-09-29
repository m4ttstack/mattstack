import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rtCredentialHelper } from "../../../lib/setup/steps/repos.ts";
import { gitCredentialReply } from "../credential.ts";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt git cred ")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("rt git credential", () => {
  test("the helper value an rt-made clone carries makes git call rt with the operation and take its answer", () => {
    const repo = join(root, "repo");
    const rt = join(root, "bin dir", "rt");
    const argsLog = join(root, "args");
    execFileSync("mkdir", ["-p", join(root, "bin dir")]);
    writeFileSync(rt, `#!/bin/sh\necho "$@" > '${argsLog}'\necho username=x-access-token\necho password=tok_rt\n`);
    chmodSync(rt, 0o755);
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
    execFileSync("git", ["init", "-q", repo], { env });
    execFileSync("git", ["-C", repo, "config", "--add", "credential.https://github.com.helper", rtCredentialHelper(rt)], { env });

    const fill = (host: string) =>
      spawnSync("git", ["credential", "fill"], { cwd: repo, env, input: `protocol=https\nhost=${host}\n\n`, encoding: "utf8" }).stdout;

    expect(fill("github.com")).toContain("password=tok_rt");
    expect(readFileSync(argsLog, "utf8").trim()).toBe("git credential get");
    rmSync(argsLog);
    fill("gitlab.com");
    expect(() => readFileSync(argsLog)).toThrow();
  });

  test("the verb answers only a host rt may send its token to", async () => {
    const tokens: Record<string, string> = { "https://github.com/mattstack/identity": "tok_gh", "https://gitlab.evil.example/mattstack/identity": "tok_gl" };
    const deps = {
      confirmedHost: () => null,
      lookupStored: async (remote: string) => tokens[remote] ?? null,
    };
    expect(await gitCredentialReply("get", "protocol=https\nhost=github.com\n\n", deps)).toContain("password=tok_gh");
    expect(await gitCredentialReply("get", "protocol=https\nhost=gitlab.evil.example\n\n", deps)).toBe("");
    expect(await gitCredentialReply("get", "protocol=https\nhost=gitlab.evil.example\n\n", { ...deps, confirmedHost: () => "gitlab.evil.example" })).toContain("password=tok_gl");
  });

  test("a store rt cannot read is an empty answer, never a crash git reports", async () => {
    const deps = { confirmedHost: () => null, lookupStored: async () => { throw new Error("keychain locked"); } };
    expect(await gitCredentialReply("get", "protocol=https\nhost=github.com\n\n", deps)).toBe("");
  });
});
