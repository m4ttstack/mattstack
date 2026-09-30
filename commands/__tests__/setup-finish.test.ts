import { describe, expect, test } from "bun:test";
import { setupFinish, type FinishDeps } from "../setup.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { isSetupFinished, readSetupState } from "../../lib/setup/state.ts";

function deps(): FinishDeps & { probes: ReturnType<typeof fakeProbes>; lines: string[] } {
  const lines: string[] = [];
  return {
    probes: fakeProbes({ now: new Date("2026-09-30T12:00:00.000Z") }),
    print: (s) => lines.push(s),
    exit: (code: number) => {
      throw new Error(`exit ${code}`);
    },
    lines,
  };
}

describe("setupFinish", () => {
  test("records setup as finished on this Mac", async () => {
    const d = deps();
    await setupFinish([], {}, d);
    expect(isSetupFinished(readSetupState(d.probes))).toBe(true);
    expect(d.lines).toEqual(["setup finish: setup is finished on this Mac"]);
  });

  test("--json answers with the recorded moment", async () => {
    const d = deps();
    await setupFinish(["--json"], {}, d);
    expect(JSON.parse(d.lines[0]!)).toMatchObject({ contract: 1, ok: true, finishedAt: "2026-09-30T12:00:00.000Z" });
  });
});
