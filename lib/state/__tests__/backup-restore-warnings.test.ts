import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { restoreHome } from "../../__tests__/home-env.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnings } from "../../ui/warn.ts";
import * as tools from "../backup-tools.ts";
import { pullHomeRepo } from "../backup-restore.ts";

let home: string;
let originalHome: string | undefined;
beforeEach(() => {
  warnings.reset();
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "rt-pull-warning-"));
  process.env.HOME = home;
});
afterEach(() => {
  warnings.reset();
  restoreHome(originalHome);
  rmSync(home, { recursive: true, force: true });
});

test("failed git and LFS pulls log both failures and show one local-copy warning", async () => {
  const io = captureOut();
  const logged: Array<{ module: string; message: string }> = [];
  setWarningLog((module, message) => logged.push({ module, message }));
  const tool = spyOn(tools, "findBackupTool").mockReturnValue("/fake/git-lfs");
  const spawn = spyOn(Bun, "spawnSync").mockReturnValue({ exitCode: 7, stdout: Buffer.from(""), stderr: Buffer.from("offline") } as ReturnType<typeof Bun.spawnSync>);
  try {
    expect(await pullHomeRepo()).toEqual({ pullOk: false, lfsOk: false });
    expect(logged).toEqual([
      { module: "state", message: "git pull failed (exit 7); restoring from local backups" },
      { module: "state", message: "git lfs pull failed (exit 7); restoring from local backups" },
    ]);
    expect(io.stderr()).toBe("[warning] rt could not pull the latest backups  restoring from the copies on this Mac\n");
    expect(io.stdout()).toBe("");
  } finally {
    spawn.mockRestore();
    tool.mockRestore();
    warnings.reset();
    io.restore();
  }
});
