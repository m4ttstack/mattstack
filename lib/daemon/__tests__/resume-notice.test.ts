import { describe, expect, test } from "bun:test";

import { withResumeNotice } from "../command-router.ts";
import type { CommandResult } from "../handlers/types.ts";

function handlers(result: CommandResult<"agent:resume">) {
  return { "agent:resume": async (_payload: unknown) => result };
}

describe("withResumeNotice", () => {
  test("a successful resume tells the reconciler which agent relaunched", async () => {
    const seen: string[] = [];
    const wrapped = withResumeNotice(
      handlers({ ok: true, data: { id: "ag-1" } as never }),
      { resumed: (id) => seen.push(id) },
    );
    await wrapped["agent:resume"]({ id: "ag-1" });
    expect(seen).toEqual(["ag-1"]);
  });

  test("a failed resume tells it nothing", async () => {
    const seen: string[] = [];
    const wrapped = withResumeNotice(handlers({ ok: false, error: "no agent" }), {
      resumed: (id) => seen.push(id),
    });
    const res = await wrapped["agent:resume"]({ id: "ag-1" });
    expect(res.ok).toBe(false);
    expect(seen).toEqual([]);
  });
});
