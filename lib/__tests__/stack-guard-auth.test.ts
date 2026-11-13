import { describe, expect, test } from "bun:test";

import { checkStackMembership, createStackGuardRunners, type StackGuardAuth } from "../stack-guard.ts";
import { fakeProbes, ok, type ExecScript } from "../setup/__tests__/fakes.ts";
import type { ForgeTokenLookup } from "../team/forge-token.ts";
import type { ExecResult, Probes } from "../setup/probes.ts";

const TOKEN = "glpat-LEAKCHECK000000000";
const CWD = "/work/x";

type ExecOpts = Parameters<Probes["exec"]>[1];
interface Call { argv: string[]; opts: ExecOpts }

function fakeAuth(lookup: ForgeTokenLookup | (() => Promise<ForgeTokenLookup>), confirmed: string | null = null): StackGuardAuth & { reads: number } {
  const auth = {
    reads: 0,
    confirmedHost: () => confirmed,
    tokenFor: async (_remote: string): Promise<ForgeTokenLookup> => {
      auth.reads++;
      return typeof lookup === "function" ? lookup() : lookup;
    },
  };
  return auth;
}

function forge(remote: string, cliResult: ExecResult = ok("[]")): { calls: Call[]; script: ExecScript } {
  const calls: Call[] = [];
  const script: ExecScript = (argv, opts) => {
    calls.push({ argv, opts });
    if (argv[0] === "git" && argv[1] === "remote") return ok(`${remote}\n`);
    if (argv[0] === "glab" || argv[0] === "gh") return cliResult;
    return ok('{"stacks":[]}');
  };
  return { calls, script };
}

function cliCalls(calls: Call[]): Call[] {
  return calls.filter((c) => c.argv[0] === "glab" || c.argv[0] === "gh");
}

async function run(remote: string, auth?: StackGuardAuth, cliResult?: ExecResult) {
  const f = forge(remote, cliResult);
  const runners = createStackGuardRunners(fakeProbes({ exec: f.script }), auth);
  const verdict = await checkStackMembership({ cwd: CWD, branch: "feat", defaultBranch: "main", runners });
  return { verdict, cli: cliCalls(f.calls) };
}

describe("the stack check with rt's forge token", () => {
  test("GitLab: a held token for a passing host goes as GITLAB_TOKEN with GITLAB_HOST, cwd the checkout", async () => {
    const { cli } = await run("https://gitlab.com/acme/x.git", fakeAuth({ kind: "token", token: TOKEN }));
    expect(cli).toHaveLength(2);
    for (const glabCall of cli) {
      expect(glabCall.argv[0]).toBe("glab");
      expect(glabCall.opts?.env).toEqual({ GITLAB_TOKEN: TOKEN, GITLAB_HOST: "gitlab.com" });
      expect(glabCall.opts?.cwd).toBe(CWD);
      expect(glabCall.argv.join(" ")).not.toContain("LEAKCHECK");
    }
  });

  test("GitLab self-hosted, confirmed (gitlab.acme.internal): GITLAB_HOST is that host", async () => {
    const { cli } = await run("git@gitlab.acme.internal:acme/x.git", fakeAuth({ kind: "token", token: TOKEN }, "gitlab.acme.internal"));
    for (const c of cli) {
      expect(c.opts?.env).toEqual({ GITLAB_TOKEN: TOKEN, GITLAB_HOST: "gitlab.acme.internal" });
      expect(c.opts?.cwd).toBe(CWD);
    }
  });

  test("GitLab, unconfirmed host: glabEnv as today and no token read", async () => {
    const auth = fakeAuth({ kind: "token", token: TOKEN });
    const { cli } = await run("https://gitlab.acme.internal/acme/x.git", auth);
    expect(auth.reads).toBe(0);
    for (const c of cli) {
      expect(c.opts?.env).toEqual({ GITLAB_HOST: "gitlab.acme.internal" });
      expect(c.opts?.cwd).toBeUndefined();
    }
  });

  test("GitLab over http: no token, even for a confirmed host", async () => {
    const auth = fakeAuth({ kind: "token", token: TOKEN }, "gitlab.acme.internal");
    const { cli } = await run("http://gitlab.acme.internal/acme/x.git", auth);
    expect(auth.reads).toBe(0);
    for (const c of cli) expect(JSON.stringify(c.opts ?? {})).not.toContain("LEAKCHECK");
  });

  test("GitHub: github.com with a token gets GH_TOKEN and never a GitLab token", async () => {
    const { cli } = await run("https://github.com/acme/x.git", fakeAuth({ kind: "token", token: TOKEN }));
    expect(cli).toHaveLength(2);
    for (const c of cli) {
      expect(c.argv[0]).toBe("gh");
      expect(c.opts?.env).toEqual({ GH_TOKEN: TOKEN });
      expect(c.opts?.env?.GITLAB_TOKEN).toBeUndefined();
      expect(c.opts?.cwd).toBe(CWD);
      expect(c.argv.join(" ")).not.toContain("LEAKCHECK");
    }
  });

  test("GitHub Enterprise or any other host: no token, as today", async () => {
    const auth = fakeAuth({ kind: "token", token: TOKEN }, "github.acme.internal");
    const { cli } = await run("https://github.acme.internal/acme/x.git", auth);
    expect(auth.reads).toBe(0);
    for (const c of cli) expect(JSON.stringify(c.opts ?? {})).not.toContain("LEAKCHECK");
  });

  test("no token held: the CLI's own login, env as today", async () => {
    const { cli } = await run("https://gitlab.com/acme/x.git", fakeAuth({ kind: "absent" }));
    for (const c of cli) {
      expect(c.opts?.env).toBeUndefined();
      expect(c.opts?.cwd).toBeUndefined();
    }
  });

  test("a lookup that throws or is unreadable falls back to the CLI's own login", async () => {
    for (const auth of [
      fakeAuth(async () => { throw new Error(`store said ${TOKEN}`); }),
      fakeAuth({ kind: "unreadable", reason: `sops: ${TOKEN}` }),
    ]) {
      const { verdict, cli } = await run("https://gitlab.com/acme/x.git", auth);
      expect(verdict.verdict).toBe("clear");
      for (const c of cli) {
        expect(c.opts?.env).toBeUndefined();
        expect(c.opts?.cwd).toBeUndefined();
      }
    }
  });

  test("without auth the runners behave exactly as before", async () => {
    const gitlab = await run("https://gitlab.acme.internal/acme/x.git");
    for (const c of gitlab.cli) {
      expect(c.opts?.env).toEqual({ GITLAB_HOST: "gitlab.acme.internal" });
      expect(c.opts?.cwd).toBeUndefined();
    }
    const github = await run("https://github.com/acme/x.git");
    for (const c of github.cli) {
      expect(c.opts?.env).toBeUndefined();
      expect(c.opts?.cwd).toBeUndefined();
    }
  });

  test("a glab failure that echoes the token reaches the hint redacted", async () => {
    const { verdict } = await run(
      "https://gitlab.com/acme/x.git",
      fakeAuth({ kind: "token", token: TOKEN }),
      { code: 1, stdout: "", stderr: `401 Unauthorized: token ${TOKEN} rejected` },
    );
    expect(verdict.verdict).toBe("unverified");
    if (verdict.verdict !== "unverified") return;
    expect(verdict.refusal.hint).toContain("401 Unauthorized");
    expect(verdict.refusal.hint).not.toContain("LEAKCHECK");
  });

  test("the token is read once for both listings", async () => {
    const auth = fakeAuth({ kind: "token", token: TOKEN });
    const { cli } = await run("https://gitlab.com/acme/x.git", auth);
    expect(cli).toHaveLength(2);
    expect(auth.reads).toBe(1);
  });
});
