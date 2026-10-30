import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupHomeBackup, type HomeBackupDeps } from "../setup.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { readSetupState, updateSetupState } from "../../lib/setup/state.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

let cap: CapturedOut;
beforeEach(() => {
  cap = capturePlain();
});
afterEach(() => cap.restore());

const HOME = "/fake-home";
const URL = "https://github.com/me/mattstack-home.git";

function deps(): HomeBackupDeps & { lines: unknown[]; exitCodes: number[] } {
  const lines: unknown[] = [];
  const exitCodes: number[] = [];
  return {
    probes: fakeProbes({ home: HOME }),
    json: (v) => lines.push(v),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    lines,
    exitCodes,
  };
}

describe("setupHomeBackup", () => {
  test("backup local clears a staged remote", async () => {
    const d = deps();
    updateSetupState(d.probes, (s) => ({ ...s, homeBackup: { mode: "remote", url: URL } }));

    await setupHomeBackup(["local", "--json"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "local" });
    expect(d.lines[0]).toMatchObject({ homeBackup: { mode: "local" } });
  });

  test("backup remote keeps a staged url", async () => {
    const d = deps();
    updateSetupState(d.probes, (s) => ({ ...s, homeBackup: { mode: "remote", url: URL } }));

    await setupHomeBackup(["remote", "--json"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "remote", url: URL });
    expect(d.lines[0]).toMatchObject({ homeBackup: { mode: "remote", url: URL } });
  });

  test("backup remote with nothing staged writes the bare choice", async () => {
    const d = deps();

    await setupHomeBackup(["remote"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "remote" });
    expect(cap.stdout()).toContain("remote repo");
  });

  test("an unknown choice is a usage error", async () => {
    const d = deps();

    await expect(setupHomeBackup(["github", "--json"], {}, d)).rejects.toThrow("exit sentinel");

    expect(d.exitCodes).toEqual([2]);
    expect(d.lines[0]).toMatchObject({ error: { code: "usage" } });
    expect(readSetupState(d.probes).homeBackup).toBeUndefined();
  });
});
