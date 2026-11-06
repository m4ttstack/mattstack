import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BUNFIG_GUARD, launcherArgs } from "../build-apps.ts";

const canCompile = process.platform === "darwin" && spawnSync("clang", ["--version"]).status === 0;
const arch = process.arch === "arm64" ? "arm64" : "x86_64";

/** A Contents/Helpers stand-in: the compiled launcher, bun, and an app
    bundle whose main.js reports what it saw. */
function helpers(dotenv: boolean, opts: { bundle?: boolean } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "helper-launcher-")));
  const out = join(dir, "probe");
  const cc = spawnSync("clang", launcherArgs({ name: "probe", dotenv, arch, out }), { encoding: "utf8" });
  if (cc.status !== 0) throw new Error(cc.stderr);
  symlinkSync(process.execPath, join(dir, "bun"));
  if (opts.bundle !== false) {
    mkdirSync(join(dir, "probe-app"));
    writeFileSync(join(dir, "probe-app", "bunfig.toml"), BUNFIG_GUARD);
    writeFileSync(join(dir, "probe-app", "main.js"),
      "console.log(JSON.stringify({ argv0: process.argv0, args: process.argv.slice(2), foo: process.env.FOO ?? null, preload: globalThis.__preloaded === true }));");
  }
  return { dir, launcher: out };
}

/** A cwd carrying the two files a plain `bun` would pick up from it. */
function hostileCwd() {
  const cwd = mkdtempSync(join(tmpdir(), "helper-launcher-cwd-"));
  writeFileSync(join(cwd, ".env"), "FOO=from-cwd-dotenv\n");
  writeFileSync(join(cwd, "bunfig.toml"), 'preload = ["./pre.js"]\n');
  writeFileSync(join(cwd, "pre.js"), "globalThis.__preloaded = true;\n");
  return cwd;
}

function run(launcher: string, args: string[], cwd: string) {
  const r = spawnSync(launcher, args, { cwd, encoding: "utf8", env: { HOME: cwd, PATH: "/usr/bin:/bin" } });
  return { status: r.status, stderr: r.stderr, seen: r.status === 0 ? JSON.parse(r.stdout) : null };
}

describe.skipIf(!canCompile)("the Contents/Helpers launcher", () => {
  test("runs the bundle on the sibling bun, passing args and its own path as argv0", () => {
    const { launcher } = helpers(true);
    const r = run(launcher, ["--version", "two words"], hostileCwd());
    expect(r.status).toBe(0);
    expect(r.seen.argv0).toBe(launcher);
    expect(r.seen.args).toEqual(["--version", "two words"]);
  });

  test("through a symlink on PATH, still finds the bundle and hands out the real path", () => {
    const { launcher } = helpers(true);
    const bin = mkdtempSync(join(tmpdir(), "helper-launcher-bin-"));
    symlinkSync(launcher, join(bin, "probe"));
    const r = run(join(bin, "probe"), [], hostileCwd());
    expect(r.status).toBe(0);
    expect(r.seen.argv0).toBe(launcher);
  });

  test("never reads a bunfig.toml from the cwd, and reads its .env only when built to", () => {
    const withEnv = run(helpers(true).launcher, [], hostileCwd());
    expect(withEnv.seen).toMatchObject({ foo: "from-cwd-dotenv", preload: false });
    const withoutEnv = run(helpers(false).launcher, [], hostileCwd());
    expect(withoutEnv.seen).toMatchObject({ foo: null, preload: false });
  });

  test("names the missing bundle instead of handing bun a bad path", () => {
    const { dir, launcher } = helpers(true, { bundle: false });
    const r = run(launcher, [], hostileCwd());
    expect(r.status).toBe(127);
    expect(r.stderr).toContain(`app bundle missing at ${join(dir, "probe-app", "main.js")}`);
  });
});
