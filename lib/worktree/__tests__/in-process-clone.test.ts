import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CLONE_EXIT } from "../clonefile.ts";
import { copyClone } from "./in-process-clone.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "in-process-clone-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("the copy stands in for a clone: a tree and its symlinks arrive", async () => {
  mkdirSync(join(dir, "src", "n"), { recursive: true });
  writeFileSync(join(dir, "src", "n", "f"), "x");
  symlinkSync("n/f", join(dir, "src", "link"));
  expect(await copyClone(join(dir, "src"), join(dir, "dst"))).toEqual({ exitCode: CLONE_EXIT.ok, stderr: "" });
  expect(readFileSync(join(dir, "dst", "n", "f"), "utf8")).toBe("x");
  expect(readlinkSync(join(dir, "dst", "link"))).toBe("n/f");
});

test("an existing destination is refused, a dangling symlink included, as clonefile refuses it", async () => {
  writeFileSync(join(dir, "src"), "x");
  mkdirSync(join(dir, "taken"));
  symlinkSync(join(dir, "nowhere"), join(dir, "dangling"));
  for (const dst of ["taken", "dangling"]) {
    expect(await copyClone(join(dir, "src"), join(dir, dst))).toEqual({ exitCode: CLONE_EXIT.exist, stderr: "clonefile: File exists" });
  }
  expect(lstatSync(join(dir, "dangling")).isSymbolicLink()).toBe(true);
  expect(existsSync(join(dir, "nowhere"))).toBe(false);
});

test("a failed copy comes back as a failed clone, never a rejection", async () => {
  const result = await copyClone(join(dir, "missing"), join(dir, "dst"));
  expect(result.exitCode).toBe(CLONE_EXIT.other);
  expect(result.stderr).toStartWith("clonefile: ");
});
