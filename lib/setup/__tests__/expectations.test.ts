import { describe, expect, test } from "bun:test";
import { row, type Action, type Group, type Row, type RowStatus } from "../contract.ts";
import { applyExpectations, ROW_TARGETS } from "../expectations.ts";

const RECHECK: Action = { type: "run", label: "Re-check", verb: ["setup", "status"] };
const DOWNLOAD_CHROME: Action = { type: "open-url", label: "Download", url: "https://www.google.com/chrome/" };
const ADD_LINEAR_MCP: Action = { type: "run", label: "Add to Claude", verb: ["setup", "apply", "--only", "linear.mcp"] };
const OPEN_KEYBOARD: Action = { type: "open-settings", label: "Open Keyboard Settings", target: "keyboard" };

function rowOf(id: string, status: RowStatus, over: Partial<Row> = {}): Row {
  return row({ id, kind: "tool", title: id, why: "why", required: false, optionalNote: "Works without this.", status, detail: "detail", ...over });
}

function one(r: Row): Row {
  const groups: Group[] = [{ id: "tools", title: "Tools", rows: [r] }];
  return applyExpectations(groups)[0]!.rows[0]!;
}

describe("applyExpectations", () => {
  test("an install row with something to press becomes required, and loses its works-without note", () => {
    const out = one(rowOf("tool.chrome", "missing", { action: DOWNLOAD_CHROME }));
    expect(out).toMatchObject({ required: true, optionalNote: null, action: DOWNLOAD_CHROME });
    expect(out.finishGated).toBeUndefined();
  });

  test("an install row with only Re-check, or nothing, waits for Finish instead", () => {
    for (const action of [RECHECK, null]) {
      const out = one(rowOf("tool.editor", "missing", { action }));
      expect(out).toMatchObject({ required: false, finishGated: true, waivable: false, optionalNote: null, action: RECHECK });
    }
  });

  test("a finish row that is not ready blocks Finish, never Install", () => {
    const out = one(rowOf("tool.linear-mcp", "needs-you", { action: ADD_LINEAR_MCP }));
    expect(out).toMatchObject({ required: false, finishGated: true, waivable: false, optionalNote: null, action: ADD_LINEAR_MCP });
  });

  test("a validator's required state is never lowered", () => {
    const input = rowOf("tool.herdr", "missing", { required: true, optionalNote: null, action: { type: "install", label: "Install", tool: "herdr", via: "brew" } });
    expect(one(input)).toEqual(input);
  });

  test("ready and skipped rows keep their gate", () => {
    for (const [id, target] of Object.entries(ROW_TARGETS)) {
      if (target === "info") continue;
      for (const status of ["ready", "skipped"] as const) {
        const input = rowOf(id, status);
        expect(one(input)).toEqual({ ...input, optionalNote: null });
      }
    }
  });

  test("a skip row is finish-gated and waivable", () => {
    const out = one(rowOf("tool.mission-control", "needs-you", { action: OPEN_KEYBOARD }));
    expect(out).toMatchObject({ required: false, finishGated: true, waivable: true, action: OPEN_KEYBOARD });
  });

  test("an info row is never a task, whatever its state", () => {
    const connect: Action = { type: "connect", label: "Connect", integration: "gitlab", fields: [] };
    for (const status of ["needs-you", "ready", "error"] as const) {
      const out = one(rowOf("team.push-access", status, { required: true, action: connect, finishGated: true, waivable: false }));
      expect(out).toMatchObject({ required: false, information: true, status });
      expect(out.finishGated).toBeUndefined();
      expect(out.waivable).toBeUndefined();
    }
  });

  test("an id with no target keeps the validator's shape", () => {
    const input = rowOf("perm.fda", "needs-you", { required: true, optionalNote: null });
    expect(one(input)).toEqual(input);
  });
});
