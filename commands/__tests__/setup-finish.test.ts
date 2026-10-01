import { describe, expect, test } from "bun:test";
import { setupFinish, type AfterFinish, type FinishDeps } from "../setup.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { isSetupFinished, readSetupState } from "../../lib/setup/state.ts";
import { capturePlain } from "./helpers/json-line.ts";

function deps(): FinishDeps & { probes: ReturnType<typeof fakeProbes>; lines: string[] } {
  const lines: string[] = [];
  return {
    probes: fakeProbes({ now: new Date("2026-09-30T12:00:00.000Z") }),
    json: (v) => lines.push(JSON.stringify(v)),
    exit: (code: number) => {
      throw new Error(`exit ${code}`);
    },
    lines,
  };
}

function after(run: AfterFinish["update"] = async () => {}): AfterFinish & { calls: boolean[]; warnings: string[] } {
  const calls: boolean[] = [];
  const warnings: string[] = [];
  return {
    update: async (opts) => {
      calls.push(opts.json);
      await run(opts);
    },
    warn: (title, detail) => warnings.push(`${title}: ${detail}`),
    calls,
    warnings,
  };
}

describe("setupFinish", () => {
  test("records setup as finished on this Mac", async () => {
    const d = deps();
    const cap = capturePlain();
    try {
      await setupFinish([], {}, d, after());
      expect(isSetupFinished(readSetupState(d.probes))).toBe(true);
      expect(cap.stdout()).toBe("[ok] Setup is finished on this Mac\n");
    } finally {
      cap.restore();
    }
    expect(d.lines).toEqual([]);
  });

  test("--json answers with the recorded moment", async () => {
    const d = deps();
    await setupFinish(["--json"], {}, d, after());
    expect(JSON.parse(d.lines[0]!)).toMatchObject({ contract: 1, ok: true, finishedAt: "2026-09-30T12:00:00.000Z" });
  });

  test("starts an update run once Finish is on record, so nothing waits for the next launch", async () => {
    const d = deps();
    let finishedWhenUpdateRan = false;
    const a = after(async () => {
      finishedWhenUpdateRan = isSetupFinished(readSetupState(d.probes));
    });
    await setupFinish(["--json"], {}, d, a);
    expect(a.calls).toEqual([true]);
    expect(finishedWhenUpdateRan).toBe(true);
    expect(d.lines).toHaveLength(1);
  });

  test("an update run that throws does not undo or fail the Finish", async () => {
    const d = deps();
    const a = after(async () => {
      throw new Error("boom");
    });
    await setupFinish([], {}, d, a);
    expect(isSetupFinished(readSetupState(d.probes))).toBe(true);
    expect(a.warnings).toEqual(["The update after Finish did not finish: boom"]);
  });
});
