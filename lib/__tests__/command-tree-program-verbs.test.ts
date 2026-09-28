import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { dispatch, isNodeVisible, showPicker, type CommandNode } from "../command-tree.ts";
import { TREE } from "../command-tree-def.ts";
import { setSetting } from "../settings/write.ts";
import { installFakePick } from "../ui/pick-fake.ts";

const noop = async () => {};

const tree: Record<string, CommandNode> = {
  cd: { description: "Pick a directory", handler: noop },
  herd: { description: "Run a herd", audience: "program", handler: noop },
};

describe("isNodeVisible (audience)", () => {
  test("a program verb is hidden unless program verbs are shown", () => {
    const node: CommandNode = { description: "x", audience: "program" };
    expect(isNodeVisible(node, false)).toBe(false);
    expect(isNodeVisible(node, false, true)).toBe(true);
  });

  test("showing program verbs never reveals a hidden node", () => {
    expect(isNodeVisible({ description: "x", audience: "program", hidden: true }, false, true)).toBe(false);
  });
});

describe("program verbs in listings", () => {
  const origHome = process.env.HOME;
  let home: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  const stdout = () => logSpy.mock.calls.flat().join("\n");

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-program-verbs-")));
    process.env.HOME = home;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit sentinel");
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("--help leaves program verbs out by default", async () => {
    await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("cd");
    expect(stdout()).not.toContain("herd");
  });

  test("--all --help lists program verbs, and the next listing hides them again", async () => {
    await expect(dispatch(tree, ["--all", "--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("herd");
    logSpy.mockClear();
    await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).not.toContain("herd");
  });

  test("rt.picker.showProgramVerbs lists program verbs", async () => {
    setSetting("rt.picker.showProgramVerbs", true, "user");
    await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("herd");
  });

  test("the picker leaves program verbs out by default", async () => {
    const fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    try {
      await showPicker(tree, ["rt"]);
      expect(fake.calls[0]!.request.rows.map((r) => r.value)).toEqual(["cd"]);
    } finally {
      fake.restore();
    }
  });

  test("a program verb still runs by name", async () => {
    let ran = false;
    const t: Record<string, CommandNode> = {
      herd: { description: "Run a herd", audience: "program", handler: async () => { ran = true; } },
    };
    await dispatch(t, ["herd"]);
    expect(ran).toBe(true);
  });
});

describe("the real tree's split", () => {
  const programVerbs = Object.entries(TREE)
    .filter(([, n]) => n.audience === "program")
    .map(([name]) => name);

  test("verbs typed by hand stay visible", () => {
    for (const name of ["git", "sync", "run", "runner", "glitter", "cd", "nav", "code", "worktree", "mr", "chat", "settings", "cswap"]) {
      expect(programVerbs, name).not.toContain(name);
    }
  });

  test("verbs only the apps, skills and daemon run are program verbs", () => {
    for (const name of ["state", "skills", "herd", "gate", "runs", "events", "reconciler", "release"]) {
      expect(programVerbs, name).toContain(name);
    }
  });
});
