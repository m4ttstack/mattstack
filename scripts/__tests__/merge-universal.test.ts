import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { mergeUniversal } from "../merge-universal.ts";

let work: string;
let src: string;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "merge-universal-"));
  src = join(work, "hello.c");
  writeFileSync(src, `#include <stdio.h>\nint main(void){puts("hello");return 0;}\n`);
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

let n = 0;
function slices(): { arm: string; intel: string; out: string } {
  const root = join(work, `case-${n++}`);
  return { arm: join(root, "arm64"), intel: join(root, "x86_64"), out: join(root, "universal") };
}

function binary(path: string, arch: string): void {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("cc", ["-arch", arch, "-o", path, src]);
}

function text(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

const archs = (path: string) => execFileSync("lipo", ["-archs", path], { encoding: "utf8" }).trim().split(" ").sort();

describe.skipIf(process.platform !== "darwin")("mergeUniversal", () => {
  test("lipos a binary pair, including one nested in a tool's tree, and keeps its mode", () => {
    const s = slices();
    binary(join(s.arm, "jq"), "arm64");
    binary(join(s.intel, "jq"), "x86_64");
    binary(join(s.arm, "node", "bin", "node"), "arm64");
    binary(join(s.intel, "node", "bin", "node"), "x86_64");
    const report = mergeUniversal(s.arm, s.intel, s.out);
    expect(report.lipoed.sort()).toEqual(["jq", "node/bin/node"]);
    expect(archs(join(s.out, "jq"))).toEqual(["arm64", "x86_64"]);
    expect(archs(join(s.out, "node", "bin", "node"))).toEqual(["arm64", "x86_64"]);
    expect(statSync(join(s.out, "jq")).mode & 0o111).not.toBe(0);
  });

  test("copies identical scripts once, and ships the arm64 copy of a file that differs, naming it", () => {
    const s = slices();
    text(join(s.arm, "fast-browser", "bin", "fb.mjs"), "same");
    text(join(s.intel, "fast-browser", "bin", "fb.mjs"), "same");
    text(join(s.arm, "node", "include", "config.gypi"), "arm");
    text(join(s.intel, "node", "include", "config.gypi"), "intel");
    const report = mergeUniversal(s.arm, s.intel, s.out);
    expect(readFileSync(join(s.out, "fast-browser", "bin", "fb.mjs"), "utf8")).toBe("same");
    expect(readFileSync(join(s.out, "node", "include", "config.gypi"), "utf8")).toBe("arm");
    expect(report.differing).toEqual(["node/include/config.gypi"]);
  });

  test("keeps a symlink both slices agree on", () => {
    const s = slices();
    for (const root of [s.arm, s.intel]) {
      text(join(root, "node", "lib", "cli.js"), "x");
      mkdirSync(join(root, "node", "bin"), { recursive: true });
      symlinkSync("../lib/cli.js", join(root, "node", "bin", "npm"));
    }
    mergeUniversal(s.arm, s.intel, s.out);
    expect(readlinkSync(join(s.out, "node", "bin", "npm"))).toBe("../lib/cli.js");
  });

  test("leaves the fetch stamps behind", () => {
    const s = slices();
    for (const root of [s.arm, s.intel]) text(join(root, "jq.sha256"), "abc");
    text(join(s.arm, "notes"), "n");
    text(join(s.intel, "notes"), "n");
    mergeUniversal(s.arm, s.intel, s.out);
    expect(existsSync(join(s.out, "jq.sha256"))).toBe(false);
  });

  test("refuses a binary the x86_64 slice lacks", () => {
    const s = slices();
    binary(join(s.arm, "gh"), "arm64");
    mkdirSync(s.intel, { recursive: true });
    expect(() => mergeUniversal(s.arm, s.intel, s.out)).toThrow(/gh is a binary with no x86_64 counterpart/);
  });

  test("refuses an x86_64 slice holding an arm64 binary", () => {
    const s = slices();
    binary(join(s.arm, "sops"), "arm64");
    binary(join(s.intel, "sops"), "arm64");
    expect(() => mergeUniversal(s.arm, s.intel, s.out)).toThrow(/sops in the x86_64 slice is arm64/);
  });

  test("refuses a binary only the x86_64 slice carries", () => {
    const s = slices();
    mkdirSync(s.arm, { recursive: true });
    binary(join(s.intel, "extra"), "x86_64");
    expect(() => mergeUniversal(s.arm, s.intel, s.out)).toThrow(/extra is a binary only the x86_64 slice carries/);
  });

  test("refuses to run when a slice was never fetched", () => {
    const s = slices();
    mkdirSync(s.arm, { recursive: true });
    expect(() => mergeUniversal(s.arm, s.intel, s.out)).toThrow(/missing/);
  });
});
