import { describe, expect, test } from "bun:test";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import * as out from "../../../lib/ui/out.ts";
import { createOriginAuth, type OriginAuthVerdict } from "../origin-auth.ts";
import { PushFailed, pushOrigin, type PushDeps, type RemoteOutcome } from "../shared.ts";

const TOKEN = "glpat-LEAKCHECK000000000";
const DENIED = "git@gitlab.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";
const NO_USER = "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled";
const REFUSED = `remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://oauth2:${TOKEN}@gitlab.com/acme/x.git/'`;
const ARGS = ["push", "--force-with-lease", "origin", "feat"];

type Result = { ok: true } | { ok: false; output: string };

const PUSH_OK: OriginAuthVerdict = { ok: true, url: "https://gitlab.com/acme/x.git", host: "gitlab.com", forge: "gitlab" };
const NO_TOKEN: OriginAuthVerdict = { ok: false, reason: "no-token", url: "https://gitlab.com/acme/x.git", host: "gitlab.com", forge: "gitlab" };

const plainFetch = (): RemoteOutcome => ({ env: { SSH_AUTH_SOCK: "/herdr.sock.agent" }, usedRtToken: false, forge: null, host: null });
const tokenFetch = (): RemoteOutcome => ({ env: { GIT_CONFIG_COUNT: "2" }, usedRtToken: true, forge: "gitlab", host: "gitlab.com" });

function deps(results: Result[], opts: { verdict?: OriginAuthVerdict; found?: { socket: string; preferred: boolean }; viable?: boolean } = {}) {
  const envs: NodeJS.ProcessEnv[] = [];
  const argv: string[][] = [];
  const forOrigin: boolean[] = [];
  const seams = { confirmedHost: () => "gitlab.acme.internal", lookup: async (): Promise<ForgeTokenLookup> => ({ kind: "token", token: TOKEN }) };
  const d: PushDeps = {
    run: async (_cwd, args, env) => (argv.push(args), envs.push(env), results.shift()!),
    findAgent: async () => opts.found,
    auth: {
      ...createOriginAuth(seams),
      forOrigin: async (_cwd, push) => (forOrigin.push(push), opts.verdict ?? PUSH_OK),
    },
    helper: "!helper",
    switchViable: async () => opts.viable ?? false,
  };
  return { d, envs, argv, forOrigin };
}

async function failureOf(p: Promise<unknown>): Promise<out.FailureInput> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PushFailed) return err.failure;
    throw err;
  }
  throw new Error("push did not fail");
}

describe("pushOrigin", () => {
  test("a clean push runs once under the fetch's env and returns its outcome", async () => {
    const from = plainFetch();
    const { d, envs, argv } = deps([{ ok: true }]);
    expect(await pushOrigin("/r", "feat", ARGS, from, d)).toBe(from);
    expect(envs).toEqual([from.env]);
    expect(argv).toEqual([ARGS]);
  });

  test("a push whose fetch already used rt's token and still fails on auth says rt's token was refused", async () => {
    const { d, envs, forOrigin } = deps([{ ok: false, output: REFUSED }]);
    const f = await failureOf(pushOrigin("/r", "feat", ARGS, tokenFetch(), d));
    expect(f.title).toBe("Could not push feat: the forge refused rt's token as well");
    expect(f.why).toContain("gitlab.com");
    expect(f.next).toEqual(["Connect GitLab again with ", out.cmd("rt setup gitlab connect")]);
    expect(envs.length).toBe(1);
    expect(forOrigin).toEqual([true]);
  });

  test("a token fetch then an http push URL on the same host keeps git's plain failure: rt's token was never offered", async () => {
    const http: OriginAuthVerdict = { ok: false, reason: "http", url: "http://gitlab.com/acme/x.git", host: "gitlab.com", forge: "gitlab" };
    const { d, envs } = deps([{ ok: false, output: NO_USER }], { verdict: http });
    const f = await failureOf(pushOrigin("/r", "feat", ARGS, tokenFetch(), d));
    expect(f).toEqual({ title: "Could not push feat", details: NO_USER });
    expect(envs.length).toBe(1);
  });

  test("a push to another host than the token fetch's retries once with rt's helper for the push host", async () => {
    const pushHost: OriginAuthVerdict = { ok: true, url: "https://gitlab.acme.internal/acme/x.git", host: "gitlab.acme.internal", forge: "gitlab" };
    const from = tokenFetch();
    const { d, envs } = deps([{ ok: false, output: NO_USER }, { ok: true }], { verdict: pushHost });
    const o = await pushOrigin("/r", "feat", ARGS, from, d);
    expect([o.usedRtToken, o.forge, o.host]).toEqual([true, "gitlab", "gitlab.acme.internal"]);
    expect(envs.length).toBe(2);
    expect(envs[1]!.GIT_CONFIG_KEY_2).toBe("credential.https://gitlab.acme.internal.helper");
    expect(envs[1]!.GIT_CONFIG_VALUE_3).toBe("!helper");
    expect(envs[1]!.GIT_CONFIG_COUNT).toBe("4");
  });

  test("a push to another host the forge also refuses names the push host", async () => {
    const pushHost: OriginAuthVerdict = { ok: true, url: "https://gitlab.acme.internal/acme/x.git", host: "gitlab.acme.internal", forge: "gitlab" };
    const { d } = deps([{ ok: false, output: NO_USER }, { ok: false, output: REFUSED }], { verdict: pushHost });
    const f = await failureOf(pushOrigin("/r", "feat", ARGS, tokenFetch(), d));
    expect(f.title).toBe("Could not push feat: the forge refused rt's token as well");
    expect(f.why).toContain("gitlab.acme.internal");
  });

  test("a push to another host with no usable token keeps the plain failure", async () => {
    const pushHost: OriginAuthVerdict = { ok: false, reason: "unconfirmed", url: "https://gitlab.example.test/acme/x.git", host: "gitlab.example.test", forge: "gitlab" };
    const { d, envs } = deps([{ ok: false, output: NO_USER }], { verdict: pushHost });
    expect(await failureOf(pushOrigin("/r", "feat", ARGS, tokenFetch(), d))).toEqual({ title: "Could not push feat", details: NO_USER });
    expect(envs.length).toBe(1);
  });

  test("a push that fails on auth after a plain fetch retries once when the push URL passes", async () => {
    const from = plainFetch();
    const { d, envs } = deps([{ ok: false, output: NO_USER }, { ok: true }]);
    const o = await pushOrigin("/r", "feat", ARGS, from, d);
    expect([o.usedRtToken, o.forge, o.host]).toEqual([true, "gitlab", "gitlab.com"]);
    expect(envs.length).toBe(2);
    expect(envs[1]!.GIT_CONFIG_KEY_1).toBe("credential.https://gitlab.com.helper");
    expect(envs[1]!.GIT_CONFIG_VALUE_0).toBe("");
    expect(envs[1]!.GIT_CONFIG_VALUE_1).toBe("!helper");
    expect(envs[1]!.SSH_AUTH_SOCK).toBe("/herdr.sock.agent");
    expect(o.env).toBe(envs[1]!);
    expect(JSON.stringify(envs)).not.toContain("LEAKCHECK");
  });

  test("the push retry checks the push URL, not the fetch URL", async () => {
    const { d, forOrigin } = deps([{ ok: false, output: NO_USER }, { ok: true }]);
    await pushOrigin("/r", "feat", ARGS, plainFetch(), d);
    expect(forOrigin).toEqual([true]);
  });

  test("a retry the forge also refuses says rt's token was refused", async () => {
    const { d } = deps([{ ok: false, output: NO_USER }, { ok: false, output: REFUSED }]);
    const f = await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), d));
    expect(f.title).toBe("Could not push feat: the forge refused rt's token as well");
    expect(f.details).toContain("Authentication failed");
  });

  test("an auth failure with no usable token for the push URL keeps the plain failure and does not retry", async () => {
    const { d, envs } = deps([{ ok: false, output: NO_USER }], { verdict: NO_TOKEN });
    expect(await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), d))).toEqual({ title: "Could not push feat", details: NO_USER });
    expect(envs.length).toBe(1);
  });

  test("a retry that fails for another reason keeps the plain failure with the retry's words", async () => {
    const { d } = deps([{ ok: false, output: NO_USER }, { ok: false, output: "fatal: Could not resolve host" }]);
    expect(await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), d))).toEqual({ title: "Could not push feat", details: "fatal: Could not resolve host" });
  });

  test("an SSH push refusal with no agent key says no SSH key is loaded", async () => {
    const { d, envs } = deps([{ ok: false, output: DENIED }]);
    const f = await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), d));
    expect(f.title).toBe("Could not push feat: no SSH key is loaded");
    expect(f.next).toEqual(["Load your key in any terminal with ", out.cmd("ssh-add")]);
    expect(f.details).toBe(DENIED);
    expect(envs.length).toBe(1);
  });

  test("an SSH push refusal with a loaded key says the forge refused your SSH key", async () => {
    const { d } = deps([{ ok: false, output: DENIED }], { found: { socket: "/herdr.sock.agent", preferred: true } });
    const f = await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), d));
    expect(f.title).toBe("Could not push feat: the forge refused your SSH key");
    expect(f.next).toBeUndefined();
    expect(f.details).toBe(DENIED);
  });

  test("an SSH push refusal with a key in another agent retries once through that agent and succeeds", async () => {
    const from = plainFetch();
    const { d, envs, argv } = deps([{ ok: false, output: DENIED }, { ok: true }], { found: { socket: "/other.agent", preferred: false } });
    const outcome = await pushOrigin("/r", "feat", ARGS, from, d);
    expect(envs.map((e) => e.SSH_AUTH_SOCK)).toEqual(["/herdr.sock.agent", "/other.agent"]);
    expect(argv).toEqual([ARGS, ARGS]);
    expect(outcome.env.SSH_AUTH_SOCK).toBe("/other.agent");
    expect(outcome.usedRtToken).toBe(false);
  });

  test("an SSH push the other agent's key is also refused on says the forge refused your SSH key, with the retry's words", async () => {
    const again = "git@gitlab.com: Permission denied (publickey).";
    const { d, envs } = deps([{ ok: false, output: DENIED }, { ok: false, output: again }], { found: { socket: "/other.agent", preferred: false } });
    const f = await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), d));
    expect(envs.length).toBe(2);
    expect(f.title).toBe("Could not push feat: the forge refused your SSH key");
    expect(f.details).toBe(again);
  });

  test("an SSH push retry through another agent that fails for another reason keeps the plain failure, redacted", async () => {
    const echoed = `fatal: unable to access 'https://oauth2:${TOKEN}@gitlab.com/acme/x.git/': The requested URL returned error: 500`;
    const { d } = deps([{ ok: false, output: DENIED }, { ok: false, output: echoed }], { found: { socket: "/other.agent", preferred: false } });
    const f = await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), d));
    expect(f.title).toBe("Could not push feat");
    expect(JSON.stringify(f)).not.toContain("LEAKCHECK");
  });

  test("the SSH push failures name rt git auth --https only when the switch could go ahead", async () => {
    const noKey = await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), deps([{ ok: false, output: DENIED }], { viable: true }).d));
    expect(noKey.next).toEqual(["Load your key with ", out.cmd("ssh-add"), ", or let rt sign in over HTTPS with ", out.cmd("rt git auth --https")]);
    const refused = await failureOf(
      pushOrigin("/r", "feat", ARGS, plainFetch(), deps([{ ok: false, output: DENIED }, { ok: false, output: DENIED }], { viable: true, found: { socket: "/k", preferred: false } }).d),
    );
    expect(refused.next).toEqual(["Let rt sign in over HTTPS with ", out.cmd("rt git auth --https")]);
  });

  test("any other push failure keeps the plain title and git's output", async () => {
    const rejected = " ! [rejected]        feat -> feat (stale info)\nerror: failed to push some refs";
    const { d } = deps([{ ok: false, output: rejected }]);
    expect(await failureOf(pushOrigin("/r", "feat", ARGS, plainFetch(), d))).toEqual({ title: "Could not push feat", details: rejected });
  });

  test("no push failure carries the token", async () => {
    const echoed = `fatal: unable to access 'https://oauth2:${TOKEN}@gitlab.com/acme/x.git/': The requested URL returned error: 500`;
    const cases: [Result[], RemoteOutcome][] = [
      [[{ ok: false, output: REFUSED }], tokenFetch()],
      [[{ ok: false, output: echoed }], tokenFetch()],
      [[{ ok: false, output: NO_USER }, { ok: false, output: REFUSED }], plainFetch()],
      [[{ ok: false, output: NO_USER }, { ok: false, output: echoed }], plainFetch()],
      [[{ ok: false, output: echoed }], plainFetch()],
    ];
    for (const [results, from] of cases) {
      const f = await failureOf(pushOrigin("/r", "feat", ARGS, from, deps(results).d));
      expect(JSON.stringify(f)).not.toContain("LEAKCHECK");
    }
  });
});
