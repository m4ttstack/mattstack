import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeArm64Path } from "./fake-arm64-host.ts";

const REPO = join(import.meta.dir, "..", "..");
const SCRIPT = join(REPO, "scripts", "fetch-deps.sh");

let work: string;
let depsRoot: string;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "fetch-x86-"));
  depsRoot = join(work, "deps");
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

function runScript(slice: string, lockPath: string): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [SCRIPT, slice], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: fakeArm64Path(work), RT_DEPS_LOCK: lockPath, RT_DEPS_ROOT: depsRoot, RT_DEPS_CACHE: join(work, "cache") },
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

function file(name: string, body: string): { path: string; sha: string } {
  const path = join(work, name);
  writeFileSync(path, body);
  return { path, sha: execFileSync("shasum", ["-a", "256", path], { encoding: "utf8" }).split(" ")[0]! };
}

function lock(name: string, row: Record<string, unknown>): string {
  const lockPath = join(work, `${name}.lock`);
  writeFileSync(lockPath, JSON.stringify({
    schema: 1, arch: "arm64",
    tools: [{
      name, version: "1.0.0", license: "MIT",
      bundlePath: `Contents/Helpers/${name}`, exec: [`Contents/Helpers/${name}`],
      exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
      ...row,
    }],
  }));
  return lockPath;
}

test("x86_64 fetches each row's Intel pin into deps/x86_64, leaving deps/arm64 to the arm64 pin", () => {
  const arm = file("raw-arm64", "arm64 bytes");
  const intel = file("raw-amd64", "intel bytes");
  const lockPath = lock("rawtool", {
    url: `file://${arm.path}`, sha256: arm.sha, archive: "raw", extract: "",
    x86_64: { url: `file://${intel.path}`, sha256: intel.sha, extract: "" },
  });
  const a = runScript("arm64", lockPath);
  expect(a.code, a.out).toBe(0);
  const x = runScript("x86_64", lockPath);
  expect(x.code, x.out).toBe(0);
  expect(readFileSync(join(depsRoot, "arm64", "rawtool"), "utf8")).toBe("arm64 bytes");
  expect(readFileSync(join(depsRoot, "x86_64", "rawtool"), "utf8")).toBe("intel bytes");
  expect(readFileSync(join(depsRoot, "x86_64", "rawtool.sha256"), "utf8").trim()).toBe(intel.sha);
});

test("x86_64 refuses a prebuilt row with no Intel pin", () => {
  const arm = file("raw-only", "arm64 only");
  const lockPath = lock("armonly", { url: `file://${arm.path}`, sha256: arm.sha, archive: "raw", extract: "" });
  const res = runScript("x86_64", lockPath);
  expect(res.code).not.toBe(0);
  expect(res.out).toContain("armonly has no x86_64 pin");
});

test("make-src compiles the x86_64 slice for Intel", () => {
  const stage = join(work, "stage-toolx", "toolx-1.0.0");
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "toolx.c"), `#include <stdio.h>\nint main(void){puts("toolx");return 0;}\n`);
  writeFileSync(join(stage, "Makefile"), "toolx: toolx.c\n\t$(CC) -o $@ $<\n");
  const tgz = join(work, "toolx-1.0.0.tar.gz");
  execFileSync("tar", ["czf", tgz, "-C", join(work, "stage-toolx"), "toolx-1.0.0"]);
  const sha = execFileSync("shasum", ["-a", "256", tgz], { encoding: "utf8" }).split(" ")[0]!;
  const lockPath = lock("toolx", { url: `file://${tgz}`, sha256: sha, archive: "make-src", extract: "toolx-1.0.0" });
  const res = runScript("x86_64", lockPath);
  expect(res.code, res.out).toBe(0);
  expect(execFileSync("lipo", ["-archs", join(depsRoot, "x86_64", "toolx")], { encoding: "utf8" }).trim()).toBe("x86_64");
}, 60_000);

test("an unknown slice is a usage error", () => {
  const res = runScript("universal", join(work, "none.lock"));
  expect(res.code).toBe(2);
  expect(res.out).toContain("usage");
});
