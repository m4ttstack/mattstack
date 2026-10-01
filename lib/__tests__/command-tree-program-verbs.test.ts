import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { dispatch, isNodeVisible, showPicker, type CommandNode, type VerbFilter } from "../command-tree.ts";
import { TREE } from "../command-tree-def.ts";
import { getDef } from "../settings/registry.ts";
import { setSetting, setSettingsNoticeSink, type SettingsNoticeSink } from "../settings/write.ts";
import { installFakePick } from "../ui/pick-fake.ts";
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const noop = async () => {};

const tree: Record<string, CommandNode> = {
  cd: { description: "Pick a directory", handler: noop },
  herd: { description: "Run a herd", handler: noop },
  worktree: {
    description: "Worktrees",
    subcommands: {
      list: { description: "List worktrees", handler: noop },
      provision: { description: "Provision a worktree", handler: noop },
    },
  },
};

const filter = (f: Partial<VerbFilter> = {}): VerbFilter => ({ all: false, hidden: new Set(), ...f });

describe("isNodeVisible (rt.picker.hidden)", () => {
  const node: CommandNode = { description: "x" };

  test("a verb named in the hidden list is left out", () => {
    expect(isNodeVisible(node, false, "herd", filter({ hidden: new Set(["herd"]) }))).toBe(false);
    expect(isNodeVisible(node, false, "cd", filter({ hidden: new Set(["herd"]) }))).toBe(true);
  });

  test("--all shows every verb but never a hidden or dev-only node", () => {
    const all = filter({ all: true, hidden: new Set(["herd"]) });
    expect(isNodeVisible(node, false, "herd", all)).toBe(true);
    expect(isNodeVisible({ description: "x", hidden: true }, false, "x", all)).toBe(false);
    expect(isNodeVisible({ description: "x", devOnly: true }, false, "x", all)).toBe(false);
  });
});

describe("rt.picker.hidden in listings", () => {
  const origHome = process.env.HOME;
  let home: string;
  let io: ReturnType<typeof captureOut>;
  let exitSpy: ReturnType<typeof spyOn>;
  let sink: SettingsNoticeSink;
  const stdout = () => io.stdout();

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-program-verbs-")));
    process.env.HOME = home;
    io = captureOut();
    ui.__test__.setHuman(() => false);
    sink = setSettingsNoticeSink(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit sentinel");
    });
  });

  afterEach(() => {
    io.restore();
    setSettingsNoticeSink(sink);
    exitSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("--help leaves the default hidden verbs out", async () => {
    await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("cd");
    expect(stdout()).not.toContain("herd");
  });

  test("--all --help lists hidden verbs, and the next listing hides them again", async () => {
    await expect(dispatch(tree, ["--all", "--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("herd");
    io.restore();
    io = captureOut();
    ui.__test__.setHuman(() => false);
    await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).not.toContain("herd");
  });

  test("--help --all lists hidden verbs too", async () => {
    await expect(dispatch(tree, ["--help", "--all"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("herd");
  });

  test("an edited list replaces the default", async () => {
    setSetting("rt.picker.hidden", ["cd"], "user");
    await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("herd");
    expect(stdout()).not.toContain("Pick a directory");
  });

  test("an entry matches a nested verb by its path", async () => {
    setSetting("rt.picker.hidden", ["worktree provision"], "user");
    await expect(dispatch(tree, ["worktree", "--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toContain("list");
    expect(stdout()).not.toContain("provision");
  });

  test("the picker leaves the default hidden verbs out", async () => {
    const fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    try {
      await showPicker(tree, ["rt"]);
      expect(fake.calls[0]!.request.rows.map((r) => r.value)).toEqual(["cd", "worktree"]);
    } finally {
      fake.restore();
    }
  });

  test("a hidden verb still runs by name", async () => {
    let ran = false;
    const t: Record<string, CommandNode> = {
      herd: { description: "Run a herd", handler: async () => { ran = true; } },
    };
    await dispatch(t, ["herd"]);
    expect(ran).toBe(true);
  });
});

describe("the rt.picker.hidden default", () => {
  const hidden = getDef("rt.picker.hidden")!.default as string[];

  test("names only real verb paths", () => {
    for (const entry of hidden) {
      let level: Record<string, CommandNode> | undefined = TREE;
      for (const word of entry.split(" ")) {
        expect(Object.keys(level ?? {}), entry).toContain(word);
        level = level![word]!.subcommands;
      }
    }
  });

  test("keeps the verbs typed by hand visible", () => {
    for (const name of ["git", "sync", "run", "runner", "glitter", "cd", "nav", "code", "worktree", "cswap"]) {
      expect(hidden, name).not.toContain(name);
    }
  });

  test("hides the verbs only the apps, skills and daemon run", () => {
    for (const name of ["state", "skills", "herd", "gate", "runs", "events", "reconciler", "release", "daemon", "pane", "uninstall", "chat", "settings"]) {
      expect(hidden, name).toContain(name);
    }
  });

  test("leaves only the store verbs in the settings picker", () => {
    for (const path of ["settings source-path", "settings schema", "settings test-push", "settings extension"]) {
      expect(hidden, path).toContain(path);
    }
  });
});
