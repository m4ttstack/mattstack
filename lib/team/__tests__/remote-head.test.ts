import { describe, expect, test } from "bun:test";
import type { Probes } from "../../setup/probes.ts";
import { remoteHead } from "../remote-head.ts";
import { expectNoToken, rtHelperHost } from "./rt-credential-argv.ts";

const SHA = "a".repeat(40);
const REF = "refs/heads/mattstack";

interface Seen {
  argv: string[];
  env: Record<string, string> | undefined;
}

function probesAnswering(stdout: string, code = 0): { p: Probes; seen: Seen[] } {
  const seen: Seen[] = [];
  const p = {
    exec: async (argv: string[], opts?: { env?: Record<string, string> }) => {
      seen.push({ argv, env: opts?.env });
      return { code, stdout, stderr: "" };
    },
  } as unknown as Probes;
  return { p, seen };
}

describe("remoteHead names rt git credential", () => {
  for (const [forge, remote, host] of [
    ["GitHub", "https://github.com/acme/team.git", "github.com"],
    ["GitLab", "https://gitlab.com/acme/team.git", "gitlab.com"],
  ] as const) {
    test(`a token on a ${forge} remote names the helper for ${host}`, async () => {
      const { p, seen } = probesAnswering("");
      await remoteHead(p, "/tmp/clone", remote, REF, "tok_rt", remote);
      expect(seen).toHaveLength(1);
      expect(rtHelperHost(seen[0]!.argv)).toBe(host);
      expect(seen[0]!.argv).toContain("ls-remote");
    });

    test(`the env holds no token on a ${forge} remote`, async () => {
      const { p, seen } = probesAnswering("");
      await remoteHead(p, "/tmp/clone", remote, REF, "tok_rt", remote);
      expectNoToken(seen[0]!.env, "tok_rt");
      expect(seen[0]!.env).toEqual({ GIT_TERMINAL_PROMPT: "0" });
      expect(seen[0]!.argv.join(" ")).not.toContain("tok_rt");
    });
  }

  for (const remote of ["https://github.com/acme/team.git", "https://gitlab.com/acme/team.git"]) {
    test(`no token: plain ls-remote on ${new URL(remote).host}`, async () => {
      const { p, seen } = probesAnswering("");
      await remoteHead(p, "/tmp/clone", remote, REF, null, remote);
      expect(rtHelperHost(seen[0]!.argv)).toBeNull();
      expect(seen[0]!.argv).toEqual(["git", "ls-remote", "--refs", "--", remote, REF]);
    });
  }

  for (const remote of ["https://github.com/acme/team.git", "https://gitlab.com/acme/team.git"]) {
    test(`an empty token: plain ls-remote on ${new URL(remote).host}`, async () => {
      const { p, seen } = probesAnswering("");
      await remoteHead(p, "/tmp/clone", remote, REF, "", remote);
      expect(rtHelperHost(seen[0]!.argv)).toBeNull();
      expect(seen[0]!.argv).toEqual(["git", "ls-remote", "--refs", "--", remote, REF]);
    });
  }

  test("a remote with no https host gets plain ls-remote even with a token", async () => {
    const { p, seen } = probesAnswering("");
    await remoteHead(p, "/tmp/clone", "origin", REF, "tok_rt", "git@github.com:acme/team.git");
    expect(rtHelperHost(seen[0]!.argv)).toBeNull();
  });

  test("one row for the ref: its sha", async () => {
    const { p } = probesAnswering(`${SHA}\t${REF}\n`);
    expect(await remoteHead(p, "/tmp/clone", "origin", REF, null, null)).toEqual({ ok: true, sha: SHA });
  });

  test("no row: sha null", async () => {
    const { p } = probesAnswering("");
    expect(await remoteHead(p, "/tmp/clone", "origin", REF, null, null)).toEqual({ ok: true, sha: null });
  });

  test("two rows: not ok", async () => {
    const { p } = probesAnswering(`${SHA}\t${REF}\n${SHA}\trefs/heads/other\n`);
    expect((await remoteHead(p, "/tmp/clone", "origin", REF, null, null)).ok).toBe(false);
  });

  test("a row for another ref: not ok", async () => {
    const { p } = probesAnswering(`${SHA}\trefs/heads/other\n`);
    expect((await remoteHead(p, "/tmp/clone", "origin", REF, null, null)).ok).toBe(false);
  });

  test("a failing ls-remote: not ok", async () => {
    const { p } = probesAnswering("", 128);
    expect((await remoteHead(p, "/tmp/clone", "origin", REF, null, null)).ok).toBe(false);
  });
});
