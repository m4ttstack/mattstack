import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { setSetting } from "../../lib/settings/write.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { openDirectoryInEditor, openInEditor } from "../code.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

describe("rt code: what a person reads", () => {
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let folder: string;
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-code-output-home-")));
    folder = realpathSync(mkdtempSync(join(tmpdir(), "rt-code-output-repo-")));
    process.env.HOME = home;
    closeStateDb();
    execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: folder, stdio: "pipe" });
    process.chdir(folder);
    io = captureOut();
    ui.__test__.reset();
    ui.__test__.setHuman(() => false);
  });

  afterEach(() => {
    io.restore();
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
  });

  test("opened: one done line naming the folder and the editor", async () => {
    setSetting("rt.workspacePrefs", { editors: { [basename(folder)]: "true" } }, "machine");

    await openInEditor([]);

    expect(io.stdout()).toBe(`[ok] Opened ${basename(folder)} in true\n`);
    expect(io.stderr()).toBe("");
  });

  test("an editor that fails is a failure on stderr with the command that resets it, exit 1", async () => {
    setSetting("rt.workspacePrefs", { editors: { [basename(folder)]: "false" } }, "machine");
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(openInEditor([])).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe(
        "false did not open\n" +
          "  why: rt ran false and it failed, or it is not installed.\n" +
          "  next: rt settings set rt.workspacePrefs '{}' --scope machine\n" +
          "  That clears your saved editor, so rt asks again.\n",
      );
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("the opener rt nav calls prints as it does today", async () => {
    setSetting("rt.workspacePrefs", { editors: { [basename(folder)]: "true" } }, "machine");
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      await openDirectoryInEditor(folder);
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0]![0])).toStartWith("\n  ");
      expect(String(errSpy.mock.calls[0]![0])).toContain(`Opened ${basename(folder)} in true`);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("");
    } finally {
      errSpy.mockRestore();
    }
  });
});
