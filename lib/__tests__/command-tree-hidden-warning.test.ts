import { test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { dispatch, type CommandNode } from "../command-tree.ts";
import { UserActionableError } from "../errors.ts";
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnings } from "../ui/warn.ts";

// mock.module mutates the live namespace in place, so the real binding is
// captured before any mock is installed.
const realResolve = await import("../settings/resolve.ts");
const realGetSetting = realResolve.getSetting;

const noop = async () => {};
const tree: Record<string, CommandNode> = {
  cd: { description: "Pick a directory", handler: noop },
  herd: { description: "Run a herd", handler: noop },
};

let io: ReturnType<typeof captureOut>;
let exitSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
  warnings.reset();
  exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit sentinel");
  });
  mock.module("../settings/resolve.ts", () => ({
    ...realResolve,
    getSetting: () => {
      throw new Error("store unreadable");
    },
  }));
});
afterEach(() => {
  mock.module("../settings/resolve.ts", () => ({ ...realResolve, getSetting: realGetSetting }));
  warnings.reset();
  exitSpy.mockRestore();
  io.restore();
});

test("an unreadable hidden-commands setting still lists every command, and warns on stderr", async () => {
  await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
  expect(io.stderr()).toBe("rt: rt.picker.hidden could not be read, listing every verb: store unreadable\n");
  expect(io.stdout()).toContain("herd");
  expect(io.stdout()).toContain("cd");
});

test("in the CLI the person reads one warn line and the command that checks settings", async () => {
  const logged: string[] = [];
  setWarningLog((module, message) => {
    logged.push(`${module}: ${message}`);
  });
  await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
  expect(logged).toEqual(["command-tree: rt.picker.hidden could not be read, listing every verb: store unreadable"]);
  expect(io.stderr()).toBe("[warning] Your list of hidden commands could not be read  every command is listed\n  next: rt settings check\n");
});

test("a settings error that names its own next step shows that command instead of the generic one", async () => {
  mock.module("../settings/resolve.ts", () => ({
    ...realResolve,
    getSetting: () => {
      throw new UserActionableError("settings-unreadable", "The settings store cannot be read", {}, { next: "rt settings repair demo" });
    },
  }));
  setWarningLog(() => {});
  await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
  expect(io.stderr()).toContain("next: rt settings repair demo\n");
  expect(io.stderr()).not.toContain("rt settings check");
});
