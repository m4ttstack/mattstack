import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { restoreHome } from "../../lib/__tests__/home-env.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { DiscoveredPlugin } from "../../lib/plugins.ts";
import { pluginListBlocks, runList, runNew, runValidate, scaffoldedBlocks, validateBlocks } from "../plugin.ts";

let home: string;
let savedHome: string | undefined;
let io: CapturedOut;
let exit: ReturnType<typeof spyOn>;
let savedTTY: boolean | undefined;

function writePlugin(dirName: string, manifest: unknown, files: Record<string, string> = {}): string {
  const dir = join(home, ".mattstack", "user", "plugins", dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const good = (name: string) => ({ name, apiVersion: 1, commands: { [name]: { description: "d", module: "./main.ts" } } });

beforeEach(() => {
  savedHome = process.env.HOME;
  savedTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true, writable: true });
  home = mkdtempSync(join(tmpdir(), "rt-plugin-cmd-"));
  process.env.HOME = home;
  io = captureOut();
  out.__test__.setHuman(() => false);
  exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as typeof process.exit);
});

afterEach(() => {
  exit.mockRestore();
  io.restore();
  Object.defineProperty(process.stdin, "isTTY", { value: savedTTY, configurable: true, writable: true });
  restoreHome(savedHome);
  rmSync(home, { recursive: true, force: true });
});

/** stdout is exactly one line, and that line is compact JSON. */
function envelopeLine(): Record<string, unknown> {
  const text = io.stdout();
  expect(text.endsWith("\n")).toBe(true);
  const line = text.slice(0, -1);
  expect(line).not.toContain("\n");
  const value = JSON.parse(line) as Record<string, unknown>;
  expect(JSON.stringify(value)).toBe(line);
  return value;
}

describe("rt plugin validate --json", () => {
  test("a sound plugin is ok with no problems", async () => {
    const dir = writePlugin("sound-tool", good("sound-tool"), { "main.ts": "export async function run() {}\n" });
    await runValidate(["sound-tool", "--json"], {});
    const body = envelopeLine();
    expect(Object.keys(body)).toEqual(["contract", "at", "ok", "plugins"]);
    expect(body.contract).toBe(1);
    expect(body.ok).toBe(true);
    expect(body.plugins).toEqual([{ name: "sound-tool", dir, ok: true, problems: [] }]);
  });

  test("the flag may come first: the name is the first argument that is not a flag", async () => {
    writePlugin("sound-tool", good("sound-tool"), { "main.ts": "export async function run() {}\n" });
    await runValidate(["--json", "sound-tool"], {});
    expect((envelopeLine().plugins as Array<{ name: string }>).map((p) => p.name)).toEqual(["sound-tool"]);
  });

  test("a plugin with problems lists them, is not ok, and exits 1", async () => {
    const dir = writePlugin("holey-tool", good("holey-tool"));
    await expect(runValidate(["holey-tool", "--json"], {})).rejects.toThrow("exit 1");
    const body = envelopeLine();
    expect(body.ok).toBe(false);
    expect(body.plugins).toEqual([{ name: "holey-tool", dir, ok: false, problems: ["holey-tool: module ./main.ts not found"] }]);
    expect(io.stderr()).toBe("");
  });

  test("an unknown name is one envelope with an error, exit 1", async () => {
    await expect(runValidate(["nope", "--json"], {})).rejects.toThrow("exit 1");
    const body = envelopeLine();
    expect(body.ok).toBe(false);
    expect(body.plugins).toEqual([]);
    expect(body.error).toBe('no plugin named "nope"');
  });

  test("no plugins at all is ok with an empty list", async () => {
    await runValidate(["--json"], {});
    const body = envelopeLine();
    expect(body.ok).toBe(true);
    expect(body.plugins).toEqual([]);
  });

  test("a plugin that prints at import cannot break the envelope", async () => {
    const prints = ["log", "info", "debug", "dir", "table"].map((m) => `console.${m}("${m.toUpperCase()} at import");\n`).join("");
    writePlugin("loud-tool", good("loud-tool"), { "main.ts": `${prints}export async function run() {}\n` });
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await runValidate(["loud-tool", "--json"], {});
      expect(log).not.toHaveBeenCalled();
      expect(error.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual(["LOG at import", "INFO at import", "DEBUG at import", "DIR at import", "TABLE at import"]);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    expect(envelopeLine().ok).toBe(true);
  });
});

describe("plugin output", () => {
  const plugin = (dirName: string, over: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin => ({ dirName, dir: `/h/plugins/${dirName}`, manifest: null, errors: [], ...over });

  test("list: a loaded plugin names its commands, a broken one says why it is not loaded", () => {
    const loaded = plugin("my-tool", { manifest: { name: "my-tool", apiVersion: 1, commands: { standup: { description: "d", module: "./s.ts" }, notes: { description: "d", module: "./n.ts" } } } as DiscoveredPlugin["manifest"] });
    const broken = plugin("bad-tool", { errors: ["plugin.json is unreadable or not valid JSON (Unexpected token)"] });
    expect(renderPlain(pluginListBlocks([loaded, broken]))).toBe(
      "[ok] my-tool  2 commands: standup, notes\n[warning] bad-tool  not loaded: plugin.json is unreadable or not valid JSON (Unexpected token)\n",
    );
  });

  test("list and validate with no plugins say how to make one", () => {
    expect(renderPlain(pluginListBlocks([]))).toBe("[not yet] No plugins yet\n  next: rt plugin new\n");
  });

  test("validate: each plugin is a row, with its problems under it", () => {
    expect(
      renderPlain(
        validateBlocks([
          { name: "my-tool", dir: "/h/plugins/my-tool", ok: true, problems: [] },
          { name: "holey-tool", dir: "/h/plugins/holey-tool", ok: false, problems: ["standup: module ./s.ts not found", 'notes: ./n.ts does not export "run"'] },
        ]),
      ),
    ).toBe('[ok] my-tool\n[failed] holey-tool\n  why: standup: module ./s.ts not found\n       notes: ./n.ts does not export "run"\n');
  });

  test("a hostile problem string cannot forge a row", () => {
    const text = renderPlain(validateBlocks([{ name: "x\n[ok] forged", dir: "/h", ok: false, problems: ["bad\n[ok] also forged"] }]));
    expect(text.split("\n").some((l) => l.startsWith("[ok] "))).toBe(false);
    expect(text).toBe("[failed] x [ok] forged\n  why: bad [ok] also forged\n");
  });

  test("new: what comes after the scaffold, for each way the install can go", () => {
    expect(renderPlain(scaffoldedBlocks("my-tool", "/h/plugins/my-tool", { pm: "bun", ok: true }))).toBe("  next: Edit /h/plugins/my-tool/my-tool.ts, then run rt my-tool\n");
    expect(renderPlain(scaffoldedBlocks("my-tool", "/h/plugins/my-tool", { pm: "bun", ok: false }))).toBe(
      "[warning] bun install did not finish  editor types will be missing until it does\n  fix: Run bun install in /h/plugins/my-tool\n  next: Edit /h/plugins/my-tool/my-tool.ts, then run rt my-tool\n",
    );
    expect(renderPlain(scaffoldedBlocks("my-tool", "/h/plugins/my-tool", null))).toBe(
      "[skipped] Editor types were not installed  neither bun nor npm is on your PATH\n  fix: Install bun, then run bun install in /h/plugins/my-tool\n  next: Edit /h/plugins/my-tool/my-tool.ts, then run rt my-tool\n",
    );
  });

  test("new with no name off a terminal asks for one, exit 1", async () => {
    await expect(runNew([], {})).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe("What should the plugin be called?\n  next: rt plugin new <name>\n");
    expect(io.stdout()).toBe("");
  });

  test("new with a bad name says what a name looks like, exit 1", async () => {
    await expect(runNew(["Bad Name"], {})).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe("A plugin name is lowercase words joined by dashes\n  why: Bad Name is not.\n  next: rt plugin new my-plugin\n");
  });

  test("new with a name already taken says where that plugin is, exit 1", async () => {
    const dir = writePlugin("my-tool", good("my-tool"));
    await expect(runNew(["my-tool"], {})).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe(`A plugin called my-tool already exists\n  why: It is at ${dir}.\n`);
    expect(io.stdout()).toBe("");
  });

  test("validate an unknown plugin points at the list, exit 1", async () => {
    await expect(runValidate(["nope"], {})).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe("No plugin is called nope\n  next: rt plugin list\n");
  });

  test("list prints through the layer", async () => {
    await runList([], {});
    expect(io.stdout()).toBe("[not yet] No plugins yet\n  next: rt plugin new\n");
  });
});
