import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UPLOAD_MAX_BYTES } from "../../daemon/upload-guard.ts";
import { parseUploads, serializeUploads, sha256Of, type UploadEntry } from "../uploads-field.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test("unreadable or foreign values parse to empty", () => {
  expect(parseUploads("nope")).toEqual({});
  expect(parseUploads(null)).toEqual({});
  expect(parseUploads('{"v":2}')).toEqual({});
});

test("both entry shapes round-trip", () => {
  const map: Record<string, UploadEntry> = {
    "/a/one.png": { sha256: "aa", project: "host/o/r", url: "/u/one.png", markdown: "![one](/u/one.png)", at: 1 },
    "/a/two.png": { linked: true, at: 2 },
  };
  expect(parseUploads(serializeUploads(map))).toEqual(map);
});

test("sha256Of hashes the file bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "uploads-field-"));
  dirs.push(dir);
  const file = join(dir, "f.png");
  writeFileSync(file, "abc");
  expect(sha256Of(file)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Of reads nothing that is not an uploadable regular file", () => {
  const dir = mkdtempSync(join(tmpdir(), "uploads-field-"));
  dirs.push(dir);
  const fifo = join(dir, "pipe.png");
  expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
  expect(() => sha256Of(fifo)).toThrow("not a regular file");
  const big = join(dir, "big.png");
  writeFileSync(big, "");
  truncateSync(big, UPLOAD_MAX_BYTES + 1);
  expect(() => sha256Of(big)).toThrow("upload cap");
  const text = join(dir, "notes.txt");
  writeFileSync(text, "abc");
  expect(() => sha256Of(text)).toThrow("extension");
  expect(() => sha256Of("/dev/zero")).toThrow();
}, 5000);
