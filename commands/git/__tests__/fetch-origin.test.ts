import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import type { CloneDeps } from "../clone-state.ts";
import { createOriginAuth, type OriginAuthVerdict } from "../origin-auth.ts";
import { authWouldGoAhead, fetchFailureOf, fetchOrigin, httpsSwitchViable, type FetchDeps } from "../shared.ts";
import * as out from "../../../lib/ui/out.ts";
import { git, makeRepo } from "./helpers.ts";

const TOKEN = "glpat-LEAKCHECK000000000";
const DENIED = "git@gitlab.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";
const NO_USER = "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled";
const REFUSED = `remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://oauth2:${TOKEN}@gitlab.com/acme/x.git/'`;

type Result = { ok: true } | { ok: false; output: string };

const GITLAB_OK: OriginAuthVerdict = { ok: true, url: "https://gitlab.com/acme/x.git", host: "gitlab.com", forge: "gitlab" };
const GITHUB_OK: OriginAuthVerdict = { ok: true, url: "https://github.com/acme/x.git", host: "github.com", forge: "github" };
const NO_TOKEN: OriginAuthVerdict = { ok: false, reason: "no-token", url: "https://gitlab.com/acme/x.git", host: "gitlab.com", forge: "gitlab" };

function fakeAuth(verdict: OriginAuthVerdict) {
  const seams = { confirmedHost: () => "gitlab.acme.internal", lookup: async (): Promise<ForgeTokenLookup> => ({ kind: "token", token: TOKEN }) };
  return { ...createOriginAuth(seams), forOrigin: async () => verdict };
}

function deps(
  results: Result[],
  found?: { socket: string; preferred: boolean },
  opts: { verdict?: OriginAuthVerdict; viable?: boolean } = {},
) {
  const runs: (string | undefined)[] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const d: FetchDeps = {
    env: { SSH_AUTH_SOCK: "/herdr.sock.agent" },
    run: async (_cwd, env) => (runs.push(env.SSH_AUTH_SOCK), envs.push(env), results.shift()!),
    findAgent: async () => found,
    auth: fakeAuth(opts.verdict ?? GITLAB_OK),
    helper: "!helper",
    switchViable: async () => opts.viable ?? false,
  };
  return { d, runs, envs };
}

async function failureOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return fetchFailureOf(err);
  }
  throw new Error("fetch did not fail");
}

describe("fetchOrigin", () => {
  test("a clean fetch runs once", async () => {
    const { d, runs } = deps([{ ok: true }]);
    await fetchOrigin("/r", d);
    expect(runs).toEqual(["/herdr.sock.agent"]);
  });

  test("a clean fetch reports usedRtToken false", async () => {
    const { d } = deps([{ ok: true }]);
    expect(await fetchOrigin("/r", d)).toEqual({ env: d.env, usedRtToken: false, forge: null, host: null });
  });

  test("an SSH refusal retries through an agent that holds a key", async () => {
    const { d, runs } = deps([{ ok: false, output: DENIED }, { ok: true }], { socket: "/keys/agent.1", preferred: false });
    await fetchOrigin("/r", d);
    expect(runs).toEqual(["/herdr.sock.agent", "/keys/agent.1"]);
  });

  test("an SSH refusal with no agent holding a key says so and names ssh-add", async () => {
    const { d } = deps([{ ok: false, output: DENIED }]);
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.title).toBe("Could not fetch from origin: no SSH key is loaded");
    expect(f.next).toEqual(["Load your key in any terminal with ", out.cmd("ssh-add")]);
    expect(f.details).toBe(DENIED);
  });

  test("an agent holding a key that origin refuses says the forge refused your SSH key", async () => {
    const { d, runs } = deps([{ ok: false, output: DENIED }], { socket: "/herdr.sock.agent", preferred: true });
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.title).toBe("Could not fetch from origin: the forge refused your SSH key");
    expect(f.why).toContain("SSH");
    expect(f.next).toBeUndefined();
    expect(f.details).toBe(DENIED);
    expect(runs).toEqual(["/herdr.sock.agent"]);
  });

  test("an agent retry origin also refuses says the forge refused your SSH key", async () => {
    const { d } = deps([{ ok: false, output: DENIED }, { ok: false, output: DENIED }], { socket: "/keys/agent.1", preferred: false });
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.title).toBe("Could not fetch from origin: the forge refused your SSH key");
    expect(f.details).toBe(DENIED);
  });

  test("the SSH failures name rt git auth --https only when the switch could go ahead", async () => {
    const noKey = await failureOf(fetchOrigin("/r", deps([{ ok: false, output: DENIED }], undefined, { viable: true }).d));
    expect(noKey.next).toEqual(["Load your key with ", out.cmd("ssh-add"), ", or let rt sign in over HTTPS with ", out.cmd("rt git auth --https")]);
    expect(noKey.why).toBe("git reached origin over SSH, but no ssh-agent on this Mac holds a key. Load yours, or switch this clone to HTTPS.");

    const refused = await failureOf(fetchOrigin("/r", deps([{ ok: false, output: DENIED }], { socket: "/s", preferred: true }, { viable: true }).d));
    expect(refused.next).toEqual(["Let rt sign in over HTTPS with ", out.cmd("rt git auth --https")]);

    const noKeyOff = await failureOf(fetchOrigin("/r", deps([{ ok: false, output: DENIED }], undefined, { viable: false }).d));
    expect(noKeyOff.next).toEqual(["Load your key in any terminal with ", out.cmd("ssh-add")]);
    expect(noKeyOff.why).toBe("git reached origin over SSH, but no ssh-agent on this Mac holds a key. Load yours, then run this again.");

    const refusedOff = await failureOf(fetchOrigin("/r", deps([{ ok: false, output: DENIED }], { socket: "/s", preferred: true }, { viable: false }).d));
    expect(refusedOff.next).toBeUndefined();
  });

  test("a switchViable that throws reads as not viable", async () => {
    const { d } = deps([{ ok: false, output: DENIED }]);
    d.switchViable = async () => { throw new Error("boom"); };
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.next).toEqual(["Load your key in any terminal with ", out.cmd("ssh-add")]);
  });

  test("resolves to the env that reached origin", async () => {
    const { d } = deps([{ ok: false, output: DENIED }, { ok: true }], { socket: "/keys/agent.1", preferred: false });
    expect((await fetchOrigin("/r", d)).env.SSH_AUTH_SOCK).toBe("/keys/agent.1");
    const clean = deps([{ ok: true }]);
    expect((await fetchOrigin("/r", clean.d)).env).toBe(clean.d.env);
  });

  test("any other failure keeps the plain title and git's words", async () => {
    const { d, runs } = deps([{ ok: false, output: "fatal: unable to access 'https://x/': Could not resolve host" }]);
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f).toEqual({ title: "Could not fetch from origin", details: "fatal: unable to access 'https://x/': Could not resolve host" });
    expect(runs.length).toBe(1);
  });

  test("an https auth failure retries once with rt's helper and reports it", async () => {
    const { d, envs } = deps([{ ok: false, output: NO_USER }, { ok: true }]);
    const o = await fetchOrigin("/r", d);
    expect([o.usedRtToken, o.forge, o.host]).toEqual([true, "gitlab", "gitlab.com"]);
    expect(envs.length).toBe(2);
    expect(envs[1]!.GIT_CONFIG_KEY_1).toBe("credential.https://gitlab.com.helper");
    expect(envs[1]!.GIT_CONFIG_VALUE_0).toBe("");
    expect(envs[1]!.GIT_CONFIG_VALUE_1).toBe("!helper");
    expect(o.env.GIT_CONFIG_COUNT).toBe("2");
    expect(JSON.stringify(envs)).not.toContain("LEAKCHECK");
  });

  test("a second auth failure says rt's token was refused too and names the reconnect", async () => {
    const { d } = deps([{ ok: false, output: NO_USER }, { ok: false, output: REFUSED }]);
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.title).toBe("Could not fetch from origin: the forge refused rt's token as well");
    expect(f.why).toContain("gitlab.com");
    expect(JSON.stringify(f.next)).toContain("rt setup gitlab connect");
    expect(f.details).toContain("Authentication failed");
    expect(JSON.stringify(f)).not.toContain("LEAKCHECK");
  });

  test("GitHub's refusal names rt setup github connect", async () => {
    const { d } = deps([{ ok: false, output: NO_USER }, { ok: false, output: REFUSED }], undefined, { verdict: GITHUB_OK });
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.why).toContain("github.com");
    expect(f.next).toEqual(["Connect GitHub again with ", out.cmd("rt setup github connect")]);
  });

  test("a retry that fails for another reason keeps the plain failure with the retry's words", async () => {
    const { d } = deps([{ ok: false, output: NO_USER }, { ok: false, output: "fatal: Could not resolve host" }]);
    expect(await failureOf(fetchOrigin("/r", d))).toEqual({ title: "Could not fetch from origin", details: "fatal: Could not resolve host" });
  });

  test("a token run's non-auth failure carries no token", async () => {
    const echoed = `fatal: unable to access 'https://oauth2:${TOKEN}@gitlab.com/acme/x.git/': The requested URL returned error: 500`;
    const { d } = deps([{ ok: false, output: NO_USER }, { ok: false, output: echoed }]);
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.title).toBe("Could not fetch from origin");
    expect(f.details).toContain("returned error: 500");
    expect(JSON.stringify(f)).not.toContain("LEAKCHECK");
  });

  test("a first-run failure that echoes a credentialed URL carries no token", async () => {
    const echoed = `fatal: unable to access 'https://user:${TOKEN}@gitlab.com/acme/x.git/': Could not resolve host`;
    const { d } = deps([{ ok: false, output: echoed }]);
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.details).toContain("Could not resolve host");
    expect(JSON.stringify(f)).not.toContain("LEAKCHECK");
  });

  test("an https auth failure with no usable token keeps git's plain failure and does not retry", async () => {
    const { d, runs } = deps([{ ok: false, output: NO_USER }], undefined, { verdict: NO_TOKEN });
    expect(await failureOf(fetchOrigin("/r", d))).toEqual({ title: "Could not fetch from origin", details: NO_USER });
    expect(runs.length).toBe(1);
  });

  test("a credential helper named in GIT_CONFIG_PARAMETERS skips the retry: it would come after rt's", async () => {
    const { d, runs } = deps([{ ok: false, output: NO_USER }, { ok: true }]);
    d.env = { ...d.env, GIT_CONFIG_PARAMETERS: "'credential.helper'='!x'" };
    expect(await failureOf(fetchOrigin("/r", d))).toEqual({ title: "Could not fetch from origin", details: NO_USER });
    expect(runs.length).toBe(1);
  });

  test("GIT_CONFIG_PARAMETERS naming no credential helper still retries", async () => {
    const { d } = deps([{ ok: false, output: NO_USER }, { ok: true }]);
    d.env = { ...d.env, GIT_CONFIG_PARAMETERS: "'core.pager'='less'" };
    expect((await fetchOrigin("/r", d)).usedRtToken).toBe(true);
  });

  test("a non-auth failure never retries", async () => {
    const { d, runs } = deps([{ ok: false, output: "fatal: 'origin' does not appear to be a git repository" }]);
    await failureOf(fetchOrigin("/r", d));
    expect(runs.length).toBe(1);
  });
});

describe("httpsSwitchViable", () => {
  let root: string;
  let link: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt switch viable ")));
    link = join(root, "rt-link");
    writeFileSync(link, "#!/bin/sh\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function cloneDeps(linkExists = true): CloneDeps {
    const auth = createOriginAuth({ confirmedHost: () => "gitlab.acme.internal", lookup: async () => ({ kind: "token", token: TOKEN }) });
    return { auth, rtLink: link, rtLinkExists: () => linkExists };
  }

  test("is true only for an off clone", async () => {
    const repo = makeRepo(root);
    git(repo, "remote", "add", "origin", "git@gitlab.com:acme/x.git");
    expect(await httpsSwitchViable(repo, cloneDeps())).toBe(true);
    expect(await httpsSwitchViable(repo, cloneDeps(false))).toBe(false);
    git(repo, "config", "--local", "--add", "credential.https://gitlab.com.helper", "osxkeychain");
    expect(await httpsSwitchViable(repo, cloneDeps())).toBe(false);
  });

  test("is false when git cannot read the clone's config", async () => {
    const repo = makeRepo(root);
    git(repo, "remote", "add", "origin", "git@gitlab.com:acme/x.git");
    writeFileSync(join(repo, ".git", "config"), "[core\nbroken = = =\n");
    expect(await httpsSwitchViable(repo, cloneDeps())).toBe(false);
  });
});

describe("authWouldGoAhead", () => {
  let root: string;
  let link: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt auth pending ")));
    link = join(root, "rt-link");
    writeFileSync(link, "#!/bin/sh\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function cloneDeps(): CloneDeps {
    const auth = createOriginAuth({ confirmedHost: () => "gitlab.acme.internal", lookup: async () => ({ kind: "token", token: TOKEN }) });
    return { auth, rtLink: link, rtLinkExists: () => true };
  }

  test("is true only for a pending clone", async () => {
    const repo = makeRepo(root);
    git(repo, "remote", "add", "origin", "https://gitlab.com/acme/x.git");
    expect(await authWouldGoAhead(repo, cloneDeps())).toBe(true);
    git(repo, "config", "--local", "--add", "credential.https://gitlab.com.helper", "osxkeychain");
    expect(await authWouldGoAhead(repo, cloneDeps())).toBe(false);
  });

  test("is false for an ssh clone and when git cannot read the clone's config", async () => {
    const ssh = makeRepo(root, "ssh");
    git(ssh, "remote", "add", "origin", "git@gitlab.com:acme/x.git");
    expect(await authWouldGoAhead(ssh, cloneDeps())).toBe(false);
    const broken = makeRepo(root, "broken");
    git(broken, "remote", "add", "origin", "https://gitlab.com/acme/x.git");
    writeFileSync(join(broken, ".git", "config"), "[core\nbroken = = =\n");
    expect(await authWouldGoAhead(broken, cloneDeps())).toBe(false);
  });
});
