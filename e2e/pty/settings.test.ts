/**
 * The whole-binary gate for one settings verb: the compiled rt at a real
 * terminal, drawing its confirmation and share tip through the real rt-ui.
 * Here the screen is the evidence on purpose: what this gate protects is
 * that the styled path runs at a TTY (the plain fallback paints `[ok]`,
 * never a glyph or a rail).
 */
import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createTestHome } from "../harness.ts";
import { startInteractive, type TermwrightSession } from "../interactive.ts";

const REPO_ROOT = import.meta.dir.replace("/e2e/pty", "");
const RT_UI_BIN = join(REPO_ROOT, "ui", "dist", "rt-ui");
const PAINT_TIMEOUT = 15_000;

beforeAll(() => {
  // HOME is the run's throwaway dir, so the module cache lands in it and
  // must stay deletable.
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

describe("rt settings set through a pty", () => {
  test("draws the confirmation and the share tip in the rt-ui theme", async () => {
    const home = createTestHome();
    const session = await startInteractive({
      args: ["settings", "set", "rt.logLevel", '"debug"', "--scope", "user"],
      home: home.path,
      cols: 120,
      rows: 20,
      env: { RT_UI_BIN, RT_LOG_LEVEL: "" },
      holdOpen: true,
    });
    open = { session, cleanup: home.cleanup };

    await session.waitForText("__rt_exit=0", PAINT_TIMEOUT);
    const screen = await session.screen();
    expect(screen).toContain("✓ Saved rt.logLevel  your user settings");
    expect(screen).toContain("▌ tip Saved rt.logLevel on this Mac only.");
    expect(screen).toContain("▌ next rt home remote set");
    expect(screen).not.toContain("[ok]");
    expect(readFileSync(join(home.path, ".mattstack", "user", "settings.user.jsonc"), "utf8")).toContain('"rt.logLevel"');
  });
});
