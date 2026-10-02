import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import type { StackRefusal } from "../../lib/stack-guard.ts";
import { reportSync, type SyncSummary } from "../sync.ts";

const refusal: StackRefusal = {
  kind: "stack-refusal",
  branch: "feature",
  source: "gitq",
  stack: { name: "s1", root: "master", parent: "master", children: [] },
  mrs: null,
  tool: "gitq sync --stack s1",
  hint: "feature is in stack s1, so changing it on its own would break the stack",
};

const summary = (over: Partial<SyncSummary>): SyncSummary => ({ branch: "feature", worktree: "/tmp/sample-app", resetResult: null, rebaseResult: null, pushed: false, ...over });

let io: CapturedOut;

beforeEach(() => {
  io = captureOut({ console: true });
  out.__test__.reset();
  out.__test__.setHuman(() => false);
});
afterEach(() => {
  io.restore();
});

describe("reportSync under --json", () => {
  test("a stack refusal is the refusal on stdout, two-space indented, and the code is 4", () => {
    expect(reportSync(summary({ error: "refused", refusal }), true)).toBe(4);
    expect(io.stdout()).toBe(JSON.stringify(refusal, null, 2) + "\n");
    expect(io.stderr()).toBe("");
  });

  test("a sync that worked prints nothing and the code is 0", () => {
    expect(reportSync(summary({ pushed: true }), true)).toBe(0);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });
});
