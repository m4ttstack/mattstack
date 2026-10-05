import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome, rt } from "../harness.ts";
import { startInteractive } from "../interactive.ts";

const RT_UI_BIN = join(import.meta.dir, "../../ui/dist/rt-ui");

test("backup init retains the failed LFS stage after tools finish and never reaches the key stage", async () => {
  const home = createTestHome();
  let session: Awaited<ReturnType<typeof startInteractive>> | undefined;
  try {
    const bin = join(home.path, "bin");
    const app = join(home.path, "mattstack.app");
    mkdirSync(bin);
    mkdirSync(app);
    mkdirSync(join(home.path, ".mattstack/user/.git"), { recursive: true });
    for (const tool of ["age", "zstd", "git-lfs"]) {
      writeFileSync(join(bin, tool), tool === "git-lfs" ? "#!/bin/sh\necho hooks-locked >&2\nexit 1\n" : "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    const pinned = await rt(["settings", "set", "mattstack.appPath", JSON.stringify(app), "--scope", "machine"], { home: home.path });
    expect(pinned.exitCode).toBe(0);
    const fixture = Bun.spawnSync([join(bin, "git-lfs"), "install", "--local"]);
    expect(fixture.stderr.toString()).toBe("hooks-locked\n");
    const probe = await rt(["state", "backup", "init"], { home: home.path, env: { PATH: `${bin}:/usr/bin:/bin` } });
    expect(probe.stderr).toContain("hooks-locked");
    session = await startInteractive({ args: ["state", "backup", "init"], home: home.path, env: { RT_UI_BIN, RT_LOG_LEVEL: "", PATH: `${bin}:/usr/bin:/bin`, RT_UI_BACKGROUND: "dark", MATTSTACK_FLAVOR: "prod", NO_COLOR: "0", COLORTERM: "truecolor" }, cols: 100, rows: 30, holdOpen: true });
    await session.waitForText("__rt_exit=", 30_000);
    await session.waitForIdle();
    const screen = await session.screen();

    expect(screen).toContain("age, zstd and git-lfs are here");
    expect(screen).toContain("Git LFS did not install in your home repo");
    expect(screen).toContain("hooks-locked");
    expect(screen).toContain("__rt_exit=1");
    expect(screen).not.toContain("Adding this Mac's key");
    expect(screen).not.toContain("Encrypted backup is set up");
    expect(screen).not.toMatch(/^\s+at /m);
    expect(screen).not.toContain("UserActionableError");
  } finally {
    await session?.stop();
    home.cleanup();
  }
}, 60_000);
