import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import { setSshHostResolver } from "../../../lib/enrich.ts";
import { configParamsNameHelper, createOriginAuth, forgeName, helperEnv, rtSelfHelper, sshToHttps, type OriginAuth, type OriginAuthSeams, type OriginAuthVerdict, type SkipReason } from "../origin-auth.ts";
import { git, makeRepo } from "./helpers.ts";

const TOKEN = "glpat-LEAKCHECK000000000";

function reasonOf(v: OriginAuthVerdict): SkipReason | null {
  return v.ok ? null : v.reason;
}

interface FakeSeams extends OriginAuthSeams {
  lookupCalls: number;
}

function fakeSeams(lookup: () => Promise<ForgeTokenLookup> = async () => ({ kind: "token", token: TOKEN })): FakeSeams {
  const seams: FakeSeams = {
    lookupCalls: 0,
    confirmedHost: () => "gitlab.acme.internal",
    lookup: async () => {
      seams.lookupCalls++;
      return lookup();
    },
  };
  return seams;
}

let seams: FakeSeams;
let auth: OriginAuth;
let root: string;
const PROMPT_VARS = ["GIT_TERMINAL_PROMPT", "GIT_ASKPASS", "GIT_CONFIG_PARAMETERS"] as const;
let savedPromptVars: Record<string, string | undefined>;

beforeEach(() => {
  seams = fakeSeams();
  auth = createOriginAuth(seams);
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt origin auth ")));
  savedPromptVars = Object.fromEntries(PROMPT_VARS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  setSshHostResolver(null);
  rmSync(root, { recursive: true, force: true });
  for (const k of PROMPT_VARS) {
    if (savedPromptVars[k] === undefined) delete process.env[k];
    else process.env[k] = savedPromptVars[k];
  }
});

describe("verdict", () => {
  test("verdict passes an https gitlab.com origin with a token held", async () => {
    expect(await auth.verdict("https://gitlab.com/acme/x.git")).toEqual({ ok: true, url: "https://gitlab.com/acme/x.git", host: "gitlab.com", forge: "gitlab" });
  });

  test("verdict passes an https github.com origin as github", async () => {
    expect(await auth.verdict("https://github.com/acme/x.git")).toEqual({ ok: true, url: "https://github.com/acme/x.git", host: "github.com", forge: "github" });
  });

  test("verdict checks in order: http before host, host before token", async () => {
    expect(reasonOf(await auth.verdict("http://gitlab.com/acme/x.git"))).toBe("http");
    expect(reasonOf(await auth.verdict("git@gitlab.com:acme/x.git"))).toBe("ssh");
    expect(reasonOf(await auth.verdict("ssh://git@gitlab.com/acme/x.git"))).toBe("ssh");
    expect(reasonOf(await auth.verdict("file:///tmp/x.git"))).toBe("not-https");
    expect(reasonOf(await auth.verdict("/tmp/x.git"))).toBe("not-https");
    expect(reasonOf(await auth.verdict("https://evil.example/acme/x.git"))).toBe("not-forge");
    expect(seams.lookupCalls).toBe(0);
  });

  test("a null URL is no-origin", async () => {
    expect(await auth.verdict(null)).toEqual({ ok: false, reason: "no-origin", url: null, host: null, forge: null });
  });

  test("a confirmed self-hosted GitLab passes, matched without case", async () => {
    expect((await auth.verdict("https://GitLab.Acme.Internal/acme/x.git")).ok).toBe(true);
  });

  test("an unconfirmed GitLab host is refused before any token read", async () => {
    expect(reasonOf(await auth.verdict("https://gitlab.other.org/acme/x.git"))).toBe("unconfirmed");
    expect(seams.lookupCalls).toBe(0);
  });

  test("a confirmed host of github.com never gets the GitLab token", async () => {
    const s = fakeSeams();
    s.confirmedHost = () => "github.com";
    const a = createOriginAuth(s);
    expect(reasonOf(await a.verdict("https://gitlab.acme.internal/acme/x.git"))).toBe("unconfirmed");
  });

  test("absent reads as no-token; a throw, unreadable or withheld as unreadable", async () => {
    const url = "https://gitlab.com/acme/x.git";
    expect(reasonOf(await createOriginAuth(fakeSeams(async () => ({ kind: "absent" }))).verdict(url))).toBe("no-token");
    expect(reasonOf(await createOriginAuth(fakeSeams(async () => { throw new Error(`sops failed ${TOKEN}`); })).verdict(url))).toBe("unreadable");
    expect(reasonOf(await createOriginAuth(fakeSeams(async () => ({ kind: "unreadable", reason: "keychain locked" }))).verdict(url))).toBe("unreadable");
    expect(reasonOf(await createOriginAuth(fakeSeams(async () => ({ kind: "withheld", host: "gitlab.com" }))).verdict(url))).toBe("unreadable");
  });

  test("a thrown lookup's message never reaches tokenFor's answer", async () => {
    const a = createOriginAuth(fakeSeams(async () => { throw new Error(`sops failed ${TOKEN}`); }));
    expect(JSON.stringify(await a.tokenFor("https://gitlab.com/acme/x.git"))).not.toContain("LEAKCHECK");
  });

  test("tokenFor reads once per forge per run", async () => {
    await auth.verdict("https://gitlab.com/a/b.git");
    await auth.verdict("https://gitlab.com/c/d.git");
    expect(seams.lookupCalls).toBe(1);
    await auth.verdict("https://github.com/c/d.git");
    expect(seams.lookupCalls).toBe(2);
  });

  test("a verdict never carries the token", async () => {
    expect(JSON.stringify(await auth.verdict("https://gitlab.com/acme/x.git"))).not.toContain("LEAKCHECK");
  });

  test("createOriginAuth(null) reads https URLs as no-token and never reads", async () => {
    const a = createOriginAuth(null);
    expect(reasonOf(await a.verdict("https://gitlab.com/acme/x.git"))).toBe("no-token");
    expect(reasonOf(await a.verdict("http://gitlab.com/acme/x.git"))).toBe("http");
    expect(reasonOf(await a.verdict("git@gitlab.com:acme/x.git"))).toBe("ssh");
    expect(a.confirmedHost()).toBeNull();
  });
});

describe("helperEnv", () => {
  test("helperEnv appends two pairs after existing ones and silences prompts", () => {
    const env = helperEnv("gitlab.com", { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "1", GIT_CONFIG_KEY_1: "c.d", GIT_CONFIG_VALUE_1: "2" }, "!rt git credential");
    expect(env.GIT_CONFIG_COUNT).toBe("4");
    expect(env.GIT_CONFIG_KEY_0).toBe("a.b");
    expect(env.GIT_CONFIG_VALUE_1).toBe("2");
    expect([env.GIT_CONFIG_KEY_2, env.GIT_CONFIG_VALUE_2]).toEqual(["credential.https://gitlab.com.helper", ""]);
    expect([env.GIT_CONFIG_KEY_3, env.GIT_CONFIG_VALUE_3]).toEqual(["credential.https://gitlab.com.helper", "!rt git credential"]);
    expect([env.GIT_TERMINAL_PROMPT, env.GIT_ASKPASS]).toEqual(["0", ""]);
  });

  test("helperEnv treats a non-numeric count as 0", () => {
    expect(helperEnv("gitlab.com", { GIT_CONFIG_COUNT: "x" }, "!h").GIT_CONFIG_COUNT).toBe("2");
    expect(helperEnv("gitlab.com", { GIT_CONFIG_COUNT: "-3" }, "!h").GIT_CONFIG_COUNT).toBe("2");
  });

  test("helperEnv leaves its base untouched", () => {
    const base = { GIT_CONFIG_COUNT: "1" };
    helperEnv("gitlab.com", base, "!h");
    expect(base).toEqual({ GIT_CONFIG_COUNT: "1" });
  });

  test("helperEnv puts no token anywhere in the env", () => {
    expect(JSON.stringify(helperEnv("gitlab.com", {}, rtSelfHelper(["/opt/rt"])))).not.toContain("LEAKCHECK");
  });

  test("rtSelfHelper quotes each argv element and appends git credential", () => {
    expect(rtSelfHelper(["/Apps/My rt/rt"])).toBe("!'/Apps/My rt/rt' git credential");
    expect(rtSelfHelper(["/opt/bun", "--no-env-file", "/opt/rt/cli.ts"])).toBe("!/opt/bun --no-env-file /opt/rt/cli.ts git credential");
  });

  test("forgeName names each forge", () => {
    expect([forgeName("gitlab"), forgeName("github")]).toEqual(["GitLab", "GitHub"]);
  });
});

describe("helperEnv with real git", () => {
  /** A global helper that logs every call, standing in for the keychain, and a fake rt helper that answers get. */
  function fakes(): { env: NodeJS.ProcessEnv; rt: string; log: () => string } {
    const logFile = join(root, "global-helper.log");
    const logger = join(root, "global-helper.sh");
    writeFileSync(logger, `#!/bin/sh\necho "$1 $(cat | tr '\\n' ' ')" >> '${logFile}'\n`);
    chmodSync(logger, 0o755);
    const fakeRt = join(root, "fake-rt.sh");
    writeFileSync(fakeRt, `#!/bin/sh\ncat >/dev/null\nif [ "$1" = get ]; then printf 'username=oauth2\\npassword=${TOKEN}\\n'; fi\n`);
    chmodSync(fakeRt, 0o755);
    const globalConfig = join(root, "global.gitconfig");
    writeFileSync(globalConfig, `[credential]\n\thelper = !'${logger}'\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
    return { env, rt: `!'${fakeRt}'`, log: () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "") };
  }

  function credential(op: "fill" | "approve", env: NodeJS.ProcessEnv, input: string): string {
    return spawnSync("git", ["credential", op], { cwd: root, env, encoding: "utf8", input }).stdout;
  }

  test("the empty value clears the global helper: fill asks only rt's, and approve never reaches the global one", () => {
    const { env, rt, log } = fakes();
    const run = helperEnv("gitlab.com", env, rt);
    const filled = credential("fill", run, "protocol=https\nhost=gitlab.com\n\n");
    expect(filled).toContain("password=glpat-LEAKCHECK");
    credential("approve", run, `${filled}\n`);
    expect(log()).toBe("");
  });

  test("a helper already passed through GIT_CONFIG_COUNT is cleared too", () => {
    const { env, rt, log } = fakes();
    const logger = join(root, "global-helper.sh");
    const run = helperEnv("gitlab.com", { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: `!'${logger}'` }, rt);
    const filled = credential("fill", run, "protocol=https\nhost=gitlab.com\n\n");
    expect(filled).toContain("password=glpat-LEAKCHECK");
    credential("approve", run, `${filled}\n`);
    expect(log()).toBe("");
  });

  test("rt's helper is never asked for another host", () => {
    const { env, rt, log } = fakes();
    const filled = credential("fill", helperEnv("gitlab.com", env, rt), "protocol=https\nhost=github.com\n\n");
    expect(filled).not.toContain("LEAKCHECK");
    expect(log()).toContain("get");
  });
});

describe("configParamsNameHelper", () => {
  test("is true for any credential helper key, in either quoting git uses", () => {
    expect(configParamsNameHelper({ GIT_CONFIG_PARAMETERS: "'credential.helper'='!x'" })).toBe(true);
    expect(configParamsNameHelper({ GIT_CONFIG_PARAMETERS: "'core.pager'='less' 'credential.https://gitlab.com.helper'='store'" })).toBe(true);
    expect(configParamsNameHelper({ GIT_CONFIG_PARAMETERS: "'credential.helper=store'" })).toBe(true);
    expect(configParamsNameHelper({ GIT_CONFIG_PARAMETERS: "'Credential.HTTPS://GitLab.com.Helper'='x'" })).toBe(true);
  });

  test("is false when unset or naming no credential helper", () => {
    expect(configParamsNameHelper({})).toBe(false);
    expect(configParamsNameHelper({ GIT_CONFIG_PARAMETERS: "'core.pager'='less' 'credential.username'='me'" })).toBe(false);
  });
});

describe("sshToHttps", () => {
  test("sshToHttps maps scp and ssh:// forms", async () => {
    expect(await sshToHttps("git@gitlab.com:group/sub/repo")).toBe("https://gitlab.com/group/sub/repo.git");
    expect(await sshToHttps("git@github.com:acme/x.git")).toBe("https://github.com/acme/x.git");
    expect(await sshToHttps("ssh://git@gitlab.acme.internal:2222/group/repo.git")).toBe("https://gitlab.acme.internal/group/repo.git");
    expect(await sshToHttps("https://gitlab.com/a/b.git")).toBeNull();
    expect(await sshToHttps("git@evil.example:a/b.git")).toBeNull();
  });

  test("sshToHttps maps an alias through ssh config and refuses one that is not a forge", async () => {
    setSshHostResolver(async ({ alias }) => (alias === "github-work" ? "github.com" : null));
    expect(await sshToHttps("github-work:acme/x.git")).toBe("https://github.com/acme/x.git");
    expect(await sshToHttps("myhost:acme/x.git")).toBeNull();
  });
});

describe("forOrigin and guardPrompts", () => {
  test("forOrigin reads the push URL when asked and applies insteadOf", async () => {
    const repo = makeRepo(root);
    git(repo, "remote", "add", "origin", "https://gitlab.com/acme/x.git");
    git(repo, "config", "remote.origin.pushurl", "git@gitlab.com:acme/x.git");
    expect((await auth.forOrigin(repo, false)).ok).toBe(true);
    expect(reasonOf(await auth.forOrigin(repo, true))).toBe("ssh");

    git(repo, "config", "url.git@gitlab.com:.insteadOf", "https://gitlab.com/");
    expect(reasonOf(await auth.forOrigin(repo, false))).toBe("ssh");
  });

  test("forOrigin with no origin is no-origin", async () => {
    const repo = makeRepo(root);
    expect(reasonOf(await auth.forOrigin(repo, false))).toBe("no-origin");
  });

  test("guardPrompts sets both vars when either URL passes and its undo restores the old values", async () => {
    const repo = makeRepo(root);
    git(repo, "remote", "add", "origin", "git@gitlab.com:acme/x.git");
    git(repo, "config", "remote.origin.pushurl", "https://gitlab.com/acme/x.git");
    process.env.GIT_ASKPASS = "/usr/bin/editor-askpass";
    delete process.env.GIT_TERMINAL_PROMPT;
    const undo = await auth.guardPrompts(repo, { push: true });
    expect([process.env.GIT_TERMINAL_PROMPT, process.env.GIT_ASKPASS]).toEqual(["0", ""]);
    undo();
    expect(process.env.GIT_ASKPASS).toBe("/usr/bin/editor-askpass");
    expect("GIT_TERMINAL_PROMPT" in process.env).toBe(false);
  });

  test("guardPrompts reads only the fetch URL without push", async () => {
    const repo = makeRepo(root);
    git(repo, "remote", "add", "origin", "git@gitlab.com:acme/x.git");
    git(repo, "config", "remote.origin.pushurl", "https://gitlab.com/acme/x.git");
    delete process.env.GIT_TERMINAL_PROMPT;
    const undo = await auth.guardPrompts(repo, { push: false });
    expect("GIT_TERMINAL_PROMPT" in process.env).toBe(false);
    undo();
  });

  test("guardPrompts changes nothing when git's own -c names a credential helper", async () => {
    const repo = makeRepo(root);
    git(repo, "remote", "add", "origin", "https://gitlab.com/acme/x.git");
    process.env.GIT_CONFIG_PARAMETERS = "'credential.helper'='!x'";
    delete process.env.GIT_TERMINAL_PROMPT;
    const undo = await auth.guardPrompts(repo, { push: true });
    expect("GIT_TERMINAL_PROMPT" in process.env).toBe(false);
    undo();
  });

  test("guardPrompts changes nothing when no URL passes", async () => {
    const repo = makeRepo(root);
    git(repo, "remote", "add", "origin", "https://gitlab.com/acme/x.git");
    const a = createOriginAuth(fakeSeams(async () => ({ kind: "absent" })));
    process.env.GIT_ASKPASS = "/usr/bin/editor-askpass";
    delete process.env.GIT_TERMINAL_PROMPT;
    const undo = await a.guardPrompts(repo, { push: true });
    expect(process.env.GIT_ASKPASS).toBe("/usr/bin/editor-askpass");
    expect("GIT_TERMINAL_PROMPT" in process.env).toBe(false);
    undo();
    expect(process.env.GIT_ASKPASS).toBe("/usr/bin/editor-askpass");
    expect("GIT_TERMINAL_PROMPT" in process.env).toBe(false);
  });
});
