import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { setupFinish, REAL_AFTER_FINISH, type AfterFinish, type FinishDeps } from "../setup.ts";
import { logsDir } from "../../lib/rt-paths.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { isSetupFinished, readSetupState } from "../../lib/setup/state.ts";
import { capturePlain, realJson } from "./helpers/json-line.ts";

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
    warn: (_json, title, detail) => warnings.push(`${title}: ${detail}`),
    calls,
    warnings,
  };
}

let quiet: CapturedOut;
beforeEach(() => {
  quiet = capturePlain();
});
afterEach(() => quiet.restore());

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

  test("--json: a throwing update run leaves stdout as the one envelope and the warning in the log", async () => {
    const d = { ...deps(), json: realJson };
    const a = { ...after(async () => { throw new Error("update boom"); }), warn: REAL_AFTER_FINISH.warn };
    const cap = capturePlain();
    try {
      await setupFinish(["--json"], {}, d, a);
      const lines = cap.stdout().trimEnd().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ contract: 1, ok: true });
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
    }
    const log = readdirSync(logsDir()).filter((f) => f.startsWith("cli.")).map((f) => readFileSync(`${logsDir()}/${f}`, "utf8")).join("");
    expect(log).toContain("The update after Finish did not finish: update boom");
  });

  test("human mode: the real warn path is a warning line on stdout", async () => {
    const d = deps();
    const a = { ...after(async () => { throw new Error("update boom"); }), warn: REAL_AFTER_FINISH.warn };
    const cap = capturePlain();
    try {
      await setupFinish([], {}, d, a);
      expect(cap.stdout()).toEndWith("[warning] The update after Finish did not finish  update boom\n");
    } finally {
      cap.restore();
    }
  });
});
