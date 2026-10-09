import { describe, expect, test } from "bun:test";
import {
  defaultHarness,
  enabledHarnesses,
  integrationsSwitchOn,
  nativeCallerFromEnv,
  selectLaunchHarness,
  type IntegrationSummary,
  type LaunchHarnessIo,
} from "../src/index.ts";

type Read = Parameters<typeof integrationsSwitchOn>[0];

function reader(values: Record<string, unknown>): Read {
  return ((key: string) => ({ value: values[key] })) as unknown as Read;
}
const throwing = (() => {
  throw new Error("stores unreadable");
}) as unknown as Read;

const summary = (id: string, enabled: boolean): IntegrationSummary => ({
  id, label: id, enabled, readiness: { ready: true }, capabilities: [], options: [],
});

function io(over: Partial<LaunchHarnessIo> & { ids?: [string, boolean][] }): LaunchHarnessIo & { calls: number } {
  const state = { calls: 0 };
  const base: LaunchHarnessIo = {
    switchOn: () => true,
    defaultHarness: () => undefined,
    agentIntegrations: async () => {
      state.calls++;
      return { ok: true, data: { integrations: (over.ids ?? []).map(([id, on]) => summary(id, on)) } };
    },
    ...over,
  };
  return Object.assign(base, { get calls() { return state.calls; } });
}

describe("settings reads", () => {
  test("the switch is on only for a stored true, and off when unreadable", () => {
    expect(integrationsSwitchOn(reader({ "agent.integrations.enabled": true }))).toBe(true);
    expect(integrationsSwitchOn(reader({ "agent.integrations.enabled": false }))).toBe(false);
    expect(integrationsSwitchOn(reader({}))).toBe(false);
    expect(integrationsSwitchOn(throwing)).toBe(false);
  });

  test("the default harness is agent.provider, undefined when unset or unreadable", () => {
    expect(defaultHarness(reader({ "agent.provider": "codex" }))).toBe("codex");
    expect(defaultHarness(reader({ "agent.provider": "" }))).toBeUndefined();
    expect(defaultHarness(throwing)).toBeUndefined();
  });

  test("an absent integrations list reads as Claude plus the default; an explicit list is kept", () => {
    expect(enabledHarnesses(reader({}))).toEqual(["claude"]);
    expect(enabledHarnesses(reader({ "agent.provider": "codex" }))).toEqual(["claude", "codex"]);
    expect(enabledHarnesses(reader({ "agent.integrations": ["codex"], "agent.provider": "claude" }))).toEqual(["codex"]);
    expect(enabledHarnesses(reader({ "agent.integrations": [] }))).toEqual([]);
    expect(enabledHarnesses(reader({ "agent.integrations": "codex" }))).toEqual(["claude"]);
    expect(enabledHarnesses(throwing)).toEqual(["claude"]);
  });
});

describe("nativeCallerFromEnv", () => {
  test("switch off: only Claude Code's variable counts, raw", () => {
    expect(nativeCallerFromEnv({ CLAUDE_CODE_SESSION_ID: "c1", CODEX_THREAD_ID: "t1" }, false)).toEqual({ sessionId: "c1" });
    expect(nativeCallerFromEnv({ CODEX_THREAD_ID: "t1" }, false)).toEqual({});
  });

  test("switch on: a Codex thread or a Claude session names its harness", () => {
    expect(nativeCallerFromEnv({ CODEX_THREAD_ID: "t1" }, true)).toEqual({ sessionId: "t1", harness: "codex" });
    expect(nativeCallerFromEnv({ CLAUDE_CODE_SESSION_ID: "c1" }, true)).toEqual({ sessionId: "c1", harness: "claude" });
    expect(nativeCallerFromEnv({ CLAUDE_CODE_SESSION_ID: "  " }, true)).toEqual({});
  });

  test("switch on: an environment naming both names neither, and carries both", () => {
    expect(nativeCallerFromEnv({ CODEX_THREAD_ID: "t1", CLAUDE_CODE_SESSION_ID: "c1" }, true))
      .toEqual({ both: { codex: "t1", claude: "c1" } });
  });
});

describe("selectLaunchHarness", () => {
  test("switch off: undefined, with no daemon call", async () => {
    const fake = io({ switchOn: () => false });
    expect(await selectLaunchHarness(fake, "gitq")).toBeUndefined();
    expect(fake.calls).toBe(0);
  });

  test("the default wins when it is on, else the first one on", async () => {
    expect(await selectLaunchHarness(io({ ids: [["claude", true], ["codex", true]], defaultHarness: () => "codex" }), "gitq")).toBe("codex");
    expect(await selectLaunchHarness(io({ ids: [["claude", false], ["codex", true]] }), "gitq")).toBe("codex");
    expect(await selectLaunchHarness(io({ ids: [["claude", true], ["codex", false]], defaultHarness: () => "codex" }), "gitq")).toBe("claude");
  });

  test("refuses, naming the surface, when none is on or the read fails", async () => {
    await expect(selectLaunchHarness(io({ ids: [["claude", false]] }), "gitq"))
      .rejects.toThrow("No agent is turned on, so gitq cannot start one. Turn one on in setup.");
    await expect(selectLaunchHarness(io({ agentIntegrations: async () => ({ ok: false, error: "no daemon" }) }), "gitq"))
      .rejects.toThrow("gitq could not read which agents are turned on: no daemon");
  });
});
