/**
 * The whole-binary gate for a setup run at a terminal: the real rt driving
 * the real rt-ui over a pty. It waits on the one step's title, never its id,
 * and reads the final screen for a summary and the absence of a stack. The
 * session holds the pty open after rt exits, so the screen outlives the run
 * and rt's own exit status is the `__rt_exit=<code>` line it prints.
 */
import { test, expect, beforeAll, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { createTestHome } from "../harness.ts";
import { startInteractive, type TermwrightSession } from "../interactive.ts";

const REPO_ROOT = import.meta.dir.replace("/e2e/pty", "");
const RT_UI_BIN = join(REPO_ROOT, "ui", "dist", "rt-ui");
const PAINT_TIMEOUT = 30_000;

beforeAll(() => {
  execFileSync("bun", ["run", "ui:build"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, GOFLAGS: [process.env.GOFLAGS, "-modcacherw"].filter(Boolean).join(" ") },
  });
  if (!existsSync(RT_UI_BIN)) throw new Error(`ui:build produced no binary at ${RT_UI_BIN}`);
});

let open: { session: TermwrightSession; cleanup: () => void } | null = null;

afterEach(async () => {
  if (!open) return;
  await open.session.stop();
  open.cleanup();
  open = null;
});

test("setup apply --from verify draws the verify step by its title and ends in a summary, with no stack on screen", async () => {
  const home = createTestHome();
  // Verify is the last contract step, so --from runs it alone (the same flags e2e/tests/setup.test.ts streams).
  const session = await startInteractive({
    args: ["setup", "apply", "--non-interactive", "--team-of-one", "--from", "verify"],
    home: home.path,
    env: { RT_UI_BIN, RT_LOG_LEVEL: "" },
    cols: 100,
    rows: 30,
    holdOpen: true,
  });
  open = { session, cleanup: home.cleanup };

  await session.waitForText("__rt_exit=", PAINT_TIMEOUT);
  const screen = await session.screen();

  expect(screen).toContain("Verify your setup");
  expect(screen).toMatch(/__rt_exit=[02]\b/);
  expect(screen).toMatch(/Setup (is done|needs you|stopped)/);
  expect(screen).not.toMatch(/^\s*[✓✗◆!\-]\s+verify(\s|$)/m);
  expect(screen).not.toMatch(/^\s+at /m);
  expect(screen).not.toContain("UserActionableError");
});
