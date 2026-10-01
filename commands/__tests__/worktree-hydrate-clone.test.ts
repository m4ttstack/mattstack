import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { worktreeHydrateClone } from "../worktree.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const realExit = process.exit;
let exitCode: number | undefined;
let io: ReturnType<typeof captureOut> | undefined;

function arm() {
  exitCode = undefined;
  io?.restore();
  io = captureOut();
  ui.__test__.reset();
  ui.__test__.setHuman(() => false);
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error("__exit__"); }) as never;
}
afterEach(() => { process.exit = realExit; io?.restore(); io = undefined; });

async function run(args: string[]): Promise<number | undefined> {
  arm();
  try { await worktreeHydrateClone(args, {}); } catch (e) { if ((e as Error).message !== "__exit__") throw e; }
  return exitCode;
}

describe("worktreeHydrateClone", () => {
  test("usage exit 2 on missing args or src === dst", async () => {
    expect(await run([])).toBe(2);
    expect(await run(["/a"])).toBe(2);
    expect(await run(["/a", "/a"])).toBe(2);
    expect(io!.stderr()).toBe("usage: rt worktree hydrate-clone <src> <dst>\n");
  });

  test("clones and exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rthc-"));
    mkdirSync(join(dir, "src", "n"), { recursive: true });
    writeFileSync(join(dir, "src", "n", "f"), "x");
    expect(await run([join(dir, "src"), join(dir, "dst")])).toBe(0);
    expect(existsSync(join(dir, "dst", "n", "f"))).toBe(true);
  });

  test("EEXIST exits 5 with a clonefile: line on stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rthc-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "dst"));
    expect(await run([join(dir, "src"), join(dir, "dst")])).toBe(5);
    expect(io!.stderr()).toMatch(/^clonefile: /);
    expect(io!.stdout()).toBe("");
  });
});
