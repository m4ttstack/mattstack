import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { setSetting } from "../../lib/settings/write.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { __test__, openDirectoryInEditor, openInEditor } from "../code.ts";
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
          "  why: rt ran false and it failed, or it is not installed. Clearing your saved editor makes rt ask again.\n" +
          "  next: rt settings set rt.workspacePrefs '{}' --scope machine\n",
      );
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("the opener rt nav calls writes its line on stderr", async () => {
    setSetting("rt.workspacePrefs", { editors: { [basename(folder)]: "true" } }, "machine");
    const release = ui.holdStdout();
    try {
      await openDirectoryInEditor(folder);
    } finally {
      release();
    }
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe(`[ok] Opened ${basename(folder)} in true\n`);
  });

  test("no editor under rt nav leaves stdout empty", async () => {
    __test__.setDetectEditors(() => []);
    const origPath = process.env.PATH;
    process.env.PATH = "";
    const release = ui.holdStdout();
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(openDirectoryInEditor(folder)).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toStartWith("rt could not find an editor it can open");
    } finally {
      release();
      exitSpy.mockRestore();
      process.env.PATH = origPath;
      __test__.setDetectEditors(undefined);
    }
  });
});
