import { describe, expect, test } from "bun:test";
import { PEER_INBOX_EVENT } from "../../daemon/peer-waker.ts";
import {
  installCronTrigger,
  peerTrigger,
  removeCronTrigger,
  triageTrigger,
  type CronTrigger,
  type InstallCronTriggerDeps,
} from "../cron-install.ts";

function fakeDeps(overrides: Partial<InstallCronTriggerDeps> = {}): InstallCronTriggerDeps & { setSettingCalls: [string, unknown, string][] } {
  const setSettingCalls: [string, unknown, string][] = [];
  return {
    getSetting: (() => ({ value: { triggers: [] }, provenance: [] })) as InstallCronTriggerDeps["getSetting"],
    setSetting: ((key: string, value: unknown, scope: string) => {
      setSettingCalls.push([key, value, scope]);
    }) as InstallCronTriggerDeps["setSetting"],
    setSettingCalls,
    ...overrides,
  };
}

describe("triageTrigger", () => {
  test("names the board tool, so the daemon runs the running app's board", () => {
    expect(triageTrigger()).toEqual({ name: "board-triage", event: "project-mrs", tool: "board", run: ["triage"], debounceMs: 5000 });
  });
});

describe("installCronTrigger", () => {
  test("writes {triggers} via setSetting with machine scope", () => {
    const deps = fakeDeps();
    const trigger = triageTrigger();

    const result = installCronTrigger(trigger, deps);

    expect(result).toEqual({ written: true });
    expect(deps.setSettingCalls).toEqual([["rt.cron", { triggers: [trigger] }, "machine"]]);
  });

  test("replaces an existing trigger of the same name instead of duplicating it", () => {
    const stale: CronTrigger = { name: "board-triage", event: "project-mrs", run: ["bun", "run", "/old/board/bin/triage.ts"], debounceMs: 5000 };
    const other: CronTrigger = { name: "other-trigger", event: "x", run: ["y"] };
    const deps = fakeDeps({
      getSetting: (() => ({ value: { triggers: [stale, other] }, provenance: [] })) as InstallCronTriggerDeps["getSetting"],
    });
    const trigger = triageTrigger();

    installCronTrigger(trigger, deps);

    expect(deps.setSettingCalls).toEqual([["rt.cron", { triggers: [other, trigger] }, "machine"]]);
  });
});

describe("removeCronTrigger", () => {
  test("drops the named trigger and leaves the rest", () => {
    const target: CronTrigger = { name: "board-triage", event: "project-mrs", run: ["bun", "run", "/x/bin/triage.ts"], debounceMs: 5000 };
    const other: CronTrigger = { name: "other-trigger", event: "x", run: ["y"] };
    const deps = fakeDeps({
      getSetting: (() => ({ value: { triggers: [target, other] }, provenance: [] })) as InstallCronTriggerDeps["getSetting"],
    });

    const result = removeCronTrigger("board-triage", deps);

    expect(result).toEqual({ written: true, removed: true });
    expect(deps.setSettingCalls).toEqual([["rt.cron", { triggers: [other] }, "machine"]]);
  });

  test("removing a trigger that was never installed is a coherent no-op", () => {
    const other: CronTrigger = { name: "other-trigger", event: "x", run: ["y"] };
    const deps = fakeDeps({
      getSetting: (() => ({ value: { triggers: [other] }, provenance: [] })) as InstallCronTriggerDeps["getSetting"],
    });

    const result = removeCronTrigger("board-triage", deps);

    expect(result).toEqual({ written: true, removed: false });
    expect(deps.setSettingCalls).toEqual([["rt.cron", { triggers: [other] }, "machine"]]);
  });
});

describe("peerTrigger", () => {
  test("is the board tool's triage pass with --peer, on the waker's event, with a short debounce", () => {
    expect(peerTrigger()).toEqual({ name: "board-peer", event: "peer-inbox", tool: "board", run: ["triage", "--peer"], debounceMs: 300 });
  });

  test("listens on exactly the event the daemon waker broadcasts", () => {
    expect(peerTrigger().event).toBe(PEER_INBOX_EVENT);
  });
});
