import { expect, test } from "bun:test";

import { launchArgv, OwnedResources, parseHerdrOutput } from "../lab";

test("partial launch cleanup attempts each owned workspace even after failure", async () => {
  const closed: string[] = [];
  const resources = new OwnedResources(async id => {
    closed.push(id);
    if (id === "w1") throw new Error("close failed");
  });
  resources.add("w1");
  resources.add("w2");
  const rows = await resources.stop();
  expect(closed).toEqual(["w2", "w1"]);
  expect(rows.map(r => r.ok)).toEqual([true, false]);
  expect(() => resources.require("foreign")).toThrow("owned");
  expect((await resources.stop()).length).toBe(1);
});
test("worker launch preserves authentication and scopes config to invocation", () => {
  const args = launchArgv("/repo/worker", ['mcp_servers.probe.command="bun"']);
  expect(args).toContain("-C");
  expect(args).toContain("/repo/worker");
  expect(args).toContain('mcp_servers.probe.command="bun"');
  expect(args.some(a => /^(HOME|CODEX_HOME)=/.test(a))).toBe(false);
  expect(args).not.toContain("daemon");
});

test("successful pane run with empty stdout is not a failed launch", () => {
  expect(parseHerdrOutput("")).toEqual({});
  expect(parseHerdrOutput('{"result":{"id":"w1"}}')).toEqual({
    result: { id: "w1" },
  });
});
test("shared-service probes explicitly connect to the discovered endpoint", () => {
  const args = launchArgv("/repo/worker", [], "/home/codex/control.sock");
  expect(
    args.slice(args.indexOf("--remote"), args.indexOf("--remote") + 2)
  ).toEqual(["--remote", "unix:///home/codex/control.sock"]);
});
test("remote worker attaches an already-created native thread without unsupported add-dir", () => {
  const args = launchArgv("/repo/worker", [], "/home/codex/control.sock", "T1");
  expect(args).toContain("resume");
  expect(args).toContain("T1");
  expect(args).not.toContain("--add-dir");
});
test("pane read plain text is preserved for failure diagnosis", () => {
  expect(parseHerdrOutput("READY\n")).toEqual({ output: "READY\n" });
});

test("attached worker does not submit a second unsolicited startup turn", () => {
  expect(launchArgv("/worker", [], "/control", "T1").at(-1)).toBe("T1");
});
test("owned active turns are interrupted independently during cleanup", async () => {
  const { OwnedTurns } = await import("../lab");
  const calls: string[] = [];
  const turns = new OwnedTurns(new Set(["T1", "T2"]));
  turns.observe({
    method: "turn/started",
    params: { threadId: "foreign", turn: { id: "bad" } },
  });
  turns.observe({
    method: "turn/started",
    params: { threadId: "T1", turn: { id: "A" } },
  });
  turns.observe({
    method: "turn/started",
    params: { threadId: "T2", turn: { id: "B" } },
  });
  turns.observe({
    method: "turn/completed",
    params: { threadId: "T1", turn: { id: "old" } },
  });
  const rows = await turns.stop(async (t, id) => {
    calls.push(`${t}/${id}`);
    if (t === "T1") throw Error("failed");
  });
  expect(calls).toEqual(["T1/A", "T2/B"]);
  expect(rows.map(r => r.ok)).toEqual([false, true]);
});
