import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { restoreHome } from "../../lib/__tests__/home-env.ts";
import { runValidate } from "../plugin.ts";

let home: string;
let savedHome: string | undefined;
let io: CapturedOut;
let exit: ReturnType<typeof spyOn>;

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
