import { describe, expect, test } from "bun:test";
import { findAgentWithKey, looksLikeSshAuthFailure, type AgentProbeDeps } from "../ssh-agent.ts";

function deps(over: Partial<AgentProbeDeps> & { keys?: Record<string, 0 | 1 | 2> } = {}): AgentProbeDeps & { checked: string[] } {
  const checked: string[] = [];
  return {
    checked,
    launchdSocket: over.launchdSocket ?? (async () => undefined),
    envSocket: over.envSocket ?? undefined,
    scanSockets: over.scanSockets ?? (() => []),
    check: over.check ?? (async (sock) => {
      checked.push(sock);
      return over.keys?.[sock] ?? 2;
    }),
  };
}

describe("findAgentWithKey", () => {
  test("the preferred socket wins when it holds a key, and nothing else is probed", async () => {
    const d = deps({ keys: { "/herdr.agent": 0, "/launchd": 0 }, launchdSocket: async () => "/launchd" });
    expect(await findAgentWithKey("/herdr.agent", d)).toEqual({ socket: "/herdr.agent", preferred: true });
    expect(d.checked).toEqual(["/herdr.agent"]);
  });

  test("a dead preferred socket falls through to launchd's agent", async () => {
    const d = deps({ keys: { "/launchd": 0 }, launchdSocket: async () => "/launchd" });
    expect(await findAgentWithKey("/herdr.agent", d)).toEqual({ socket: "/launchd", preferred: false });
  });

  test("an agent with no key is skipped for a later one that has one", async () => {
    const d = deps({
      keys: { "/launchd": 1, "/tmp/ssh-x/agent.1": 0 },
      launchdSocket: async () => "/launchd",
      envSocket: "/launchd",
      scanSockets: () => ["/tmp/ssh-x/agent.1"],
    });
    expect(await findAgentWithKey("/herdr.agent", d)).toEqual({ socket: "/tmp/ssh-x/agent.1", preferred: false });
    expect(d.checked).toEqual(["/herdr.agent", "/launchd", "/tmp/ssh-x/agent.1"]);
  });

  test("no agent holding a key returns undefined", async () => {
    const d = deps({ keys: { "/launchd": 1 }, launchdSocket: async () => "/launchd", scanSockets: () => ["/a", "/b"] });
    expect(await findAgentWithKey("/herdr.agent", d)).toBeUndefined();
  });

  test("a missing preferred socket starts at the candidates", async () => {
    const d = deps({ keys: { "/env": 0 }, envSocket: "/env" });
    expect(await findAgentWithKey(undefined, d)).toEqual({ socket: "/env", preferred: false });
  });
});

describe("looksLikeSshAuthFailure", () => {
  test("matches git's publickey refusal", () => {
    expect(looksLikeSshAuthFailure("git@gitlab.com: Permission denied (publickey).\nfatal: Could not read from remote repository.")).toBe(true);
  });

  test("matches an unreachable agent", () => {
    expect(looksLikeSshAuthFailure("Could not open a connection to your authentication agent.")).toBe(true);
  });

  test("ignores a network failure", () => {
    expect(looksLikeSshAuthFailure("ssh: Could not resolve hostname gitlab.com: nodename nor servname provided")).toBe(false);
  });
});
