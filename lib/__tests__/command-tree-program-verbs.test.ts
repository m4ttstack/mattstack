import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { dispatch, isNodeVisible, showPicker, type CommandNode, type VerbFilter } from "../command-tree.ts";
import { TREE } from "../command-tree-def.ts";
import { setSetting } from "../settings/write.ts";
import { installFakePick } from "../ui/pick-fake.ts";

const noop = async () => {};

const tree: Record<string, CommandNode> = {
  cd: { description: "Pick a directory", handler: noop },
  herd: { description: "Run a herd", audience: "program", handler: noop },
  pane: { description: "Panes", audience: "program", handler: noop },
  worktree: {
    description: "Worktrees",
    subcommands: {
      list: { description: "List worktrees", handler: noop },
      provision: { description: "Provision a worktree", handler: noop },
    },
  },
};

const filter = (f: Partial<VerbFilter> = {}): VerbFilter => ({ all: false, show: new Set(), hide: new Set(), ...f });

describe("isNodeVisible (audience and verb filter)", () => {
  const program: CommandNode = { description: "x", audience: "program" };
  const human: CommandNode = { description: "x" };

  test("a program verb is hidden by default", () => {
    expect(isNodeVisible(program, false)).toBe(false);
    expect(isNodeVisible(program, false, "pane", filter())).toBe(false);
  });

  test("show names a program verb back in, and * shows them all", () => {
    expect(isNodeVisible(program, false, "pane", filter({ show: new Set(["pane"]) }))).toBe(true);
    expect(isNodeVisible(program, false, "pane", filter({ show: new Set(["*"]) }))).toBe(true);
  });

  test("hide takes any verb out, and beats show", () => {
    expect(isNodeVisible(human, false, "nav", filter({ hide: new Set(["nav"]) }))).toBe(false);
    expect(isNodeVisible(program, false, "pane", filter({ show: new Set(["*"]), hide: new Set(["pane"]) }))).toBe(false);
  });

  test("--all shows every verb but never a hidden or dev-only node", () => {
    const all = filter({ all: true, hide: new Set(["pane"]) });
    expect(isNodeVisible(program, false, "pane", all)).toBe(true);
    expect(isNodeVisible({ description: "x", hidden: true }, false, "x", all)).toBe(false);
    expect(isNodeVisible({ description: "x", devOnly: true }, false, "x", all)).toBe(false);
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

  test("rt.picker.show lists the named program verb only", async () => {
    setSetting("rt.picker.show", ["pane"], "user");
    await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("pane");
    expect(stdout()).not.toContain("herd");
  });

  test("rt.picker.hide matches a nested verb by its path", async () => {
    setSetting("rt.picker.hide", ["worktree provision"], "user");
    await expect(dispatch(tree, ["worktree", "--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("list");
    expect(stdout()).not.toContain("provision");
  });

  test("the picker leaves program verbs out by default", async () => {
    const fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    try {
      await showPicker(tree, ["rt"]);
      expect(fake.calls[0]!.request.rows.map((r) => r.value)).toEqual(["cd", "worktree"]);
    } finally {
      fake.restore();
    }
  });

  test("a hidden verb still runs by name", async () => {
    setSetting("rt.picker.hide", ["herd"], "user");
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
    for (const name of ["state", "skills", "herd", "gate", "runs", "events", "reconciler", "release", "daemon", "pane"]) {
      expect(programVerbs, name).toContain(name);
    }
  });
});
