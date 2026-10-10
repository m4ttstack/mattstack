import { test, expect } from "bun:test";
import { checkEngineFloor } from "../ci/engine-floor-check.ts";

const REF = "plugins/mattstack/attachments/mcp-tools/reference.md";
const FLOOR = "plugins/mattstack/pack/requires.json";

test("a tool reference change without a floor change fails", () => {
  const errors = checkEngineFloor({ changed: [REF], prBody: "", floor: "0.31.0", baseFloor: "0.31.0", pluginVersion: "0.31.2" });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("Edit the PR body, then push a commit (re-running the job reads the old body).");
});
test("the waiver line passes it", () => {
  expect(checkEngineFloor({ changed: [REF], prBody: "engine-floor: unchanged (docs only)", floor: "0.31.0", baseFloor: "0.31.0", pluginVersion: "0.31.2" })).toEqual([]);
});
test("a floor change passes it", () => {
  expect(checkEngineFloor({ changed: [REF, FLOOR], prBody: "", floor: "0.31.2", baseFloor: "0.31.0", pluginVersion: "0.31.2" })).toEqual([]);
});
test("a floor above the plugin version always fails", () => {
  expect(checkEngineFloor({ changed: [FLOOR], prBody: "", floor: "0.32.0", baseFloor: "0.31.0", pluginVersion: "0.31.2" })).toHaveLength(1);
});
test("unrelated changes pass", () => {
  expect(checkEngineFloor({ changed: ["lib/x.ts"], prBody: "", floor: "0.31.0", baseFloor: "0.31.0", pluginVersion: "0.31.2" })).toEqual([]);
});
test("a floor file edit that keeps minEngine still fails", () => {
  expect(checkEngineFloor({ changed: [REF, FLOOR], prBody: "", floor: "0.31.0", baseFloor: "0.31.0", pluginVersion: "0.31.2" })).toHaveLength(1);
});
test("a floor added where the base had none counts as raised", () => {
  expect(checkEngineFloor({ changed: [REF, FLOOR], prBody: "", floor: "0.31.2", baseFloor: null, pluginVersion: "0.31.2" })).toEqual([]);
});
