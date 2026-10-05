// RT-25: the dev-mode wrapper must not use bun's --tsconfig-override.
// That flag trips a bun fd-bookkeeping bug (oven-sh/bun#22023) that makes
// every dev-mode rt command trail an "Internal error: directory mismatch"
// line on exit. Instead the wrapper cds into the rt source repo (so bun
// resolves rt's own tsconfig from cwd) and a preload script restores the
// user's launch cwd before any other module loads.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enableDevMode, installProdRt, renderDevModePreload, renderDevModeWrapper } from "../../commands/settings.ts";

import { closeStateDb } from "../state/index.ts";
import { restoreHome } from "./home-env.ts";

const SOURCE = "/Users/someone/checkouts/repo-tools";
const BUN = "/Users/someone/.bun/bin/bun";

describe("renderDevModeWrapper", () => {
  const wrapper = renderDevModeWrapper(SOURCE, BUN);
  const preload = join(process.env.HOME!, ".mattstack", "rt", "dev-restore-cwd.ts");

  test("does not use --tsconfig-override (bun#22023 regression guard)", () => {
    expect(wrapper).not.toContain("--tsconfig-override");
  });

  test("captures the launch cwd, then cds into the source repo before exec", () => {
    const exportIdx = wrapper.indexOf(`export RT_LAUNCH_CWD="$PWD"`);
    const cdIdx = wrapper.indexOf(`cd "${SOURCE}"`);
    const execIdx = wrapper.indexOf(`exec "${BUN}"`);
    expect(exportIdx).toBeGreaterThan(-1);
    expect(cdIdx).toBeGreaterThan(exportIdx);
    expect(execIdx).toBeGreaterThan(cdIdx);
  });

  test("labels every process it launches as the dev app's before exec", () => {
    const exportIdx = wrapper.indexOf("export MATTSTACK_FLAVOR=dev\n");
    expect(exportIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeLessThan(wrapper.indexOf(`exec "${BUN}"`));
  });

  test("preloads the cwd-restore script and runs cli.ts with forwarded args", () => {
    expect(wrapper).toContain(`--preload="${preload}"`);
    expect(wrapper).toContain(`"${SOURCE}/cli.ts" "$@"`);
  });

  test("fails loudly when the source checkout is gone instead of exec'ing from the wrong cwd", () => {
    expect(wrapper).toMatch(/cd "[^"]+" \|\| \{/);
  });

  test("appends the tool dirs to PATH rather than prepending (RT-160): launchd only needs them present, and a prepend shadows the caller's own order for every validator that reads PATH", () => {
    const pathLine = wrapper.split("\n").find((l) => l.startsWith("export PATH="));
    // ${PATH:+$PATH:} not a bare $PATH: — an empty inherited PATH would leave
    // a leading empty component, which zsh resolves as the CURRENT directory,
    // and the wrapper has just cd'd into the source checkout.
    expect(pathLine).toBe(`export PATH="\${PATH:+\$PATH:}/Users/someone/.bun/bin:/opt/homebrew/bin:/usr/local/bin"`);
  });
});

describe("renderDevModePreload", () => {
  test("names what writes it, with no ticket ids", () => {
    const preload = renderDevModePreload();
    expect(preload).not.toMatch(/\b[A-Z]+-\d+\b/);
    expect(preload).toContain("rt settings source-path");
  });

  test("restores RT_LAUNCH_CWD before other modules load, then scrubs it", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt25-")));
    const launchDir = realpathSync(mkdtempSync(join(tmpdir(), "rt25-launch-")));
    const preloadPath = join(dir, "dev-restore-cwd.ts");
    const entryPath = join(dir, "print.ts");
    writeFileSync(preloadPath, renderDevModePreload());
    writeFileSync(
      entryPath,
      `console.log(JSON.stringify({ cwd: process.cwd(), pwd: process.env.PWD, launch: process.env.RT_LAUNCH_CWD ?? null }));\n`,
    );

    const proc = Bun.spawn([process.execPath, "run", `--preload=${preloadPath}`, entryPath], {
      cwd: dir,
      env: { ...process.env, RT_LAUNCH_CWD: launchDir, PWD: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(await proc.exited).toBe(0);
    expect(stderr).not.toContain("Internal error");

    const seen = JSON.parse(stdout.trim());
    expect(seen.cwd).toBe(launchDir);
    expect(seen.pwd).toBe(launchDir);
    expect(seen.launch).toBeNull();
  });

  test("survives a launch cwd that no longer exists", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt25-")));
    const preloadPath = join(dir, "dev-restore-cwd.ts");
    const entryPath = join(dir, "print.ts");
    writeFileSync(preloadPath, renderDevModePreload());
    writeFileSync(entryPath, `console.log(process.cwd());\n`);

    const proc = Bun.spawn([process.execPath, "run", `--preload=${preloadPath}`, entryPath], {
      cwd: dir,
      env: { ...process.env, RT_LAUNCH_CWD: join(dir, "deleted-subdir-that-never-existed") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
  });
});

describe("dev-mode paths after HOME changes", () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "rt-devmode-home-"));
    closeStateDb();
    process.env.HOME = home;
  });

  afterEach(() => {
    closeStateDb();
    restoreHome(savedHome);
    rmSync(home, { recursive: true, force: true });
  });

  test("the wrapper loads the preload from the current HOME", () => {
    const preload = join(home, ".mattstack", "rt", "dev-restore-cwd.ts");
    expect(renderDevModeWrapper(SOURCE, BUN)).toContain(`--preload="${preload}"`);
  });

  test("enabling dev mode writes its preload beside the current HOME's state", () => {
    enableDevMode(SOURCE);

    const preload = join(home, ".mattstack", "rt", "dev-restore-cwd.ts");
    expect(existsSync(preload)).toBe(true);
    expect(readFileSync(join(home, ".local", "bin", "rt"), "utf8")).toContain(`--preload="${preload}"`);
  });

  test("installing prod removes the current HOME's dev preload", () => {
    const runtime = join(home, ".mattstack", "rt");
    const preload = join(runtime, "dev-restore-cwd.ts");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(preload, "export {};\n");
    const prodBinary = join(home, "prod-rt");
    writeFileSync(prodBinary, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));

    installProdRt(prodBinary);

    expect(readlinkSync(join(home, ".local", "bin", "rt"))).toBe(prodBinary);
    expect(existsSync(preload)).toBe(false);
  });
});
