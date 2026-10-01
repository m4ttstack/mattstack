/**
 * The error seam with a real terminal in front of it: the compiled rt
 * spawning the real rt-ui over a pty. The session holds the pty open after rt
 * exits, since the termwright daemon otherwise goes with it; its exitCode is
 * the daemon's, not rt's, and e2e/tests/errors.test.ts pins the exit codes.
 */
import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome } from "../harness.ts";
import { startInteractive, type TermwrightSession } from "../interactive.ts";

const REPO_ROOT = import.meta.dir.replace("/e2e/pty", "");
const RT_UI_BIN = join(REPO_ROOT, "ui", "dist", "rt-ui");
const PAINT_TIMEOUT = 15_000;

beforeAll(() => {
  // The helper draws the failure; a run against a stale or missing one would
  // gate nothing. HOME is the run's throwaway dir, so the module cache lands
  // in it and must stay deletable.
  execFileSync("bun", ["run", "ui:build"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, GOFLAGS: [process.env.GOFLAGS, "-modcacherw"].filter(Boolean).join(" ") },
  });
  if (!existsSync(RT_UI_BIN)) throw new Error(`ui:build produced no binary at ${RT_UI_BIN}`);
});

let open: { session: TermwrightSession; cleanupHome: () => void } | null = null;

afterEach(async () => {
  if (!open) return;
  await open.session.stop();
  open.cleanupHome();
  open = null;
});

function installThrowingPlugin(home: string): void {
  const dir = join(home, ".mattstack", "user", "plugins", "pty-seam");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ name: "pty-seam", apiVersion: 1, commands: { "pty-seam-boom": { description: "throws", module: "./boom.ts", hidden: true } } }, null, 2),
  );
  writeFileSync(join(dir, "boom.ts"), 'export async function run() { throw new Error("kaboom from the pty gate"); }\n');
}

function cliLog(home: string): string {
  const dir = join(home, ".mattstack", "rt", "logs");
  return readdirSync(dir)
    .filter((f) => f.startsWith("cli.") && f.endsWith(".log"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("");
}

// startInteractive spreads the developer's environment; an RT_LOG_LEVEL=debug
// shell would paint the stack and fail the unexpected-error test.
async function start(home: string, args: string[]): Promise<TermwrightSession> {
  return startInteractive({ args, home, cols: 100, rows: 24, env: { RT_UI_BIN, RT_LOG_LEVEL: "" }, holdOpen: true });
}

describe("the error seam through a pty", () => {
  test("an expected failure paints one failure block with no verb prefix and exits 2", async () => {
    const home = createTestHome();
    const session = await start(home.path, ["repos", "reidentify", "github.com/acme/only-one"]);
    open = { session, cleanupHome: home.cleanup };

    await session.waitForText("__rt_exit=2", PAINT_TIMEOUT);
    const screen = await session.screen();
    expect(screen).toContain("✗");
    expect(screen).toContain("takes two identities");
    expect(screen).not.toContain("rt repos reidentify:");
    expect(screen).not.toContain("    at ");
  });

  test("an unexpected error paints one line, points at the log, keeps the stack there and exits 1", async () => {
    const home = createTestHome();
    installThrowingPlugin(home.path);
    const session = await start(home.path, ["pty-seam-boom"]);
    open = { session, cleanupHome: home.cleanup };

    await session.waitForText("__rt_exit=1", PAINT_TIMEOUT);
    const screen = await session.screen();
    expect(screen).toContain("✗");
    expect(screen).toContain("rt hit an unexpected error");
    expect(screen).toContain("kaboom from the pty gate");
    expect(screen).toContain("rt daemon logs");
    expect(screen).not.toContain("    at ");

    const log = cliLog(home.path);
    expect(log).toContain("kaboom from the pty gate");
    expect(log).toContain("    at ");
  });
});
