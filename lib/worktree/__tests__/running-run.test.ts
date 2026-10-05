import { expect, test } from "bun:test";
import { runningRunDetail, parseRunningRunDetail } from "../running-run.ts";

test("the running-run detail and its parser agree", () => {
  const detail = runningRunDetail("run-42", "review");
  expect(detail).toBe("running run run-42 at review; rt runs abandon run-42");
  expect(parseRunningRunDetail(detail)).toEqual({ id: "run-42", stage: "review" });
  expect(parseRunningRunDetail("something else")).toBeNull();
});
