import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { dispatch, type CommandNode } from "../command-tree.ts";
import { toCommandNode } from "../plugins.ts";
import { verbHelpRequested } from "../cli-verb-help.ts";
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const noop = async () => {};

function makeTree(onRun?: (args: string[]) => void): Record<string, CommandNode> {
  return {
    daemon: {
      description: "Manage the daemon",
      subcommands: {
        status: { description: "Show daemon status", handler: noop },
        logs: { description: "View logs", handler: noop },
        secret: { description: "Hidden verb", hidden: true, handler: noop },
        lab: { description: "Dev-only verb", devOnly: true, handler: noop },
      },
    },
    join: {
      description: "Join a room",
      aliases: ["j"],
      args: [
        { name: "Room", type: "text", hint: "room to join" },
        { name: "Handle", flag: "--as", type: "text", hint: "post as this handle" },
        { name: "Force", flag: "--force", type: "boolean", hint: "skip confirmation" },
      ],
      handler: async (args) => onRun?.(args),
    },
    run: {
      description: "Run things",
      module: "./commands/fake.ts",
      fn: "run",
      handler: async (args) => onRun?.(args),
      subcommands: {
        once: { description: "Run once", handler: noop },
      },
    },
  };
}

let io: ReturnType<typeof captureOut>;
let exitSpy: ReturnType<typeof spyOn>;
let batch: string | undefined;

beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
  batch = process.env.RT_BATCH;
  delete process.env.RT_BATCH;
  exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit sentinel");
  });
});

afterEach(() => {
  io.restore();
  exitSpy.mockRestore();
  if (batch === undefined) delete process.env.RT_BATCH;
  else process.env.RT_BATCH = batch;
});

const stdout = () => io.stdout();

describe("branch --help", () => {
  test("prints subcommand names and descriptions to stdout, exits 0", async () => {
    await expect(dispatch(makeTree(), ["daemon", "--help"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(stdout()).toContain("status");
    expect(stdout()).toContain("Show daemon status");
    expect(stdout()).toContain("logs");
  });

  test("root --help lists top-level commands", async () => {
    await expect(dispatch(makeTree(), ["--help"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(stdout()).toContain("join");
    expect(stdout()).toContain("Join a room");
  });

  test("hidden subcommands are excluded; devOnly follows dev-mode detection", async () => {
    const isDev = existsSync(join(homedir(), ".local/bin/rt"));
    await expect(dispatch(makeTree(), ["daemon", "-h"])).rejects.toThrow("exit sentinel");
    expect(stdout()).not.toContain("secret");
    expect(stdout().includes("lab")).toBe(isDev);
  });
});

describe("leaf --help", () => {
  test("prints usage from args metadata, description, aliases; handler not called", async () => {
    let ran = false;
    const tree = makeTree(() => { ran = true; });
    await expect(dispatch(tree, ["join", "--help"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(ran).toBe(false);
    const out = stdout();
    expect(out).toContain("rt join <room>");
    expect(out).toContain("--as");
    expect(out).toContain("--force");
    expect(out).toContain("Join a room");
    expect(out).toContain("aliases: j");
    expect(out).toContain("room to join");
  });

  test("-h behaves the same as --help", async () => {
    let ran = false;
    const tree = makeTree(() => { ran = true; });
    await expect(dispatch(tree, ["join", "-h"])).rejects.toThrow("exit sentinel");
    expect(ran).toBe(false);
    expect(stdout()).toContain("rt join <room>");
  });

  test("only intercepts as the first arg: later --help reaches the handler", async () => {
    let captured: string[] | undefined;
    const tree = makeTree((args) => { captured = args; });
    await dispatch(tree, ["join", "myroom", "--help"]);
    expect(captured).toEqual(["myroom", "--help"]);
  });

  test("context node --help renders without resolving identity", async () => {
    const tree: Record<string, CommandNode> = {
      cmd: { description: "needs a worktree", context: "worktree", handler: noop },
    };
    await expect(dispatch(tree, ["cmd", "--help"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(stdout()).toContain("needs a worktree");
  });

  test("help output carries no ANSI when stdout is not a TTY", async () => {
    await expect(dispatch(makeTree(), ["join", "--help"])).rejects.toThrow("exit sentinel");
    if (!process.stdout.isTTY) expect(stdout()).not.toContain("\x1b[");
  });
});

describe("branch+handler --help", () => {
  test("shows own usage plus subcommand listing; handler not called", async () => {
    let ran = false;
    const tree = makeTree(() => { ran = true; });
    await expect(dispatch(tree, ["run", "--help"])).rejects.toThrow("exit sentinel");
    expect(ran).toBe(false);
    const out = stdout();
    expect(out).toContain("Run things");
    expect(out).toContain("once");
    expect(out).toContain("Run once");
  });
});

describe("passThroughHelp", () => {
  test("a passThroughHelp leaf receives --help as an ordinary arg", async () => {
    let captured: string[] | undefined;
    const tree: Record<string, CommandNode> = {
      wrapped: {
        description: "exec wrapper",
        passThroughHelp: true,
        handler: async (args) => { captured = args; },
      },
    };
    await dispatch(tree, ["wrapped", "--help"]);
    expect(captured).toEqual(["--help"]);
  });

  test("toCommandNode marks exec plugin nodes passThroughHelp", () => {
    const node = toCommandNode("p", "/tmp/p", { description: "x", exec: "echo" });
    expect(node.passThroughHelp).toBe(true);
  });

  test("toCommandNode leaves module plugin nodes intercepted", () => {
    const node = toCommandNode("p", "/tmp/p", { description: "x", module: "./m.ts" });
    expect(node.passThroughHelp).toBeUndefined();
  });
});

describe("verbHelpRequested", () => {
  test("true for --help/-h as first remaining token", () => {
    expect(verbHelpRequested(["--help"])).toBe(true);
    expect(verbHelpRequested(["-h", "x"])).toBe(true);
  });
  test("false otherwise, including value-position --help", () => {
    expect(verbHelpRequested([])).toBe(false);
    expect(verbHelpRequested(["--text", "--help"])).toBe(false);
  });
});

describe("self-dispatching leaves guard --help (RT-114)", () => {
  // Self-dispatching leaf = tree leaf whose module routes its own verbs.
  // Structural enforcement, same idiom as no-ui-in-cli.test.ts: the module
  // source must consult verbHelpRequested.
  for (const mod of ["commands/agent.ts", "commands/chat.ts"]) {
    test(`${mod} consults verbHelpRequested`, () => {
      expect(readFileSync(mod, "utf8")).toContain("verbHelpRequested(");
    });
  }
});

const fruit = (): Record<string, CommandNode> => ({
  fruit: {
    description: "Work with fruit",
    subcommands: {
      peel: { description: "Peel one", handler: noop },
      slice: { description: "Slice one", handler: noop },
    },
  },
});

const FRUIT_HELP = "usage: rt fruit <command>\n  Work with fruit\n\nCommands\npeel   Peel one\nslice  Slice one\n";

describe("the dispatcher's plain output", () => {
  test("branch help is a usage line, the description and the commands, on stdout", async () => {
    await expect(dispatch(fruit(), ["fruit", "--help"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(stdout()).toBe(FRUIT_HELP);
    expect(io.stderr()).toBe("");
  });

  test("a bare branch off a terminal prints the same help on stdout and exits 0", async () => {
    await expect(dispatch(fruit(), ["fruit"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(stdout()).toBe(FRUIT_HELP);
    expect(io.stderr()).toBe("");
  });

  test("leaf help lists its arguments under a heading", async () => {
    await expect(dispatch(makeTree(), ["join", "--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toBe(
      "usage: rt join <room> [--as <handle>] [--force]\n" +
        "  Join a room\n" +
        "aliases: j\n" +
        "\n" +
        "Arguments\n" +
        "<room>         room to join\n" +
        "--as <handle>  post as this handle\n" +
        "--force        skip confirmation\n",
    );
  });

  test("an unknown command is a failure on stderr that names where to look, exit 1", async () => {
    await expect(dispatch(fruit(), ["fruit", "bogus"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
    expect(stdout()).toBe("");
    expect(io.stderr()).toBe("rt fruit has no command called bogus\n  next: rt fruit --help\n  Commands here: peel, slice\n");
  });

  test("an unknown command name carrying an escape cannot repaint the terminal", async () => {
    await expect(dispatch(fruit(), ["fruit", "bo\x1b[2Jgus"])).rejects.toThrow("exit sentinel");
    expect(io.stderr()).not.toContain("\x1b");
    expect(io.stderr()).toStartWith("rt fruit has no command called bogus\n");
  });

  test("a command that needs a terminal says so on stderr and exits 1", async () => {
    const tree: Record<string, CommandNode> = { needy: { description: "Needs a terminal", requiresTTY: true, handler: noop } };
    await expect(dispatch(tree, ["needy"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
    expect(stdout()).toBe("");
    // toEndWith: run from a terminal, the dispatcher's screen clear comes first.
    expect(io.stderr()).toEndWith("rt needy needs an interactive terminal\n  why: It asks questions or draws a screen, so a script or a pipe cannot run it.\n");
    expect(io.stderr()).not.toContain("[failed]");
  });
});
