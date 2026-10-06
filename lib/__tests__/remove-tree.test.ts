import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { removeTree } from "./remove-tree.ts";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function makeTree(): string {
  root = mkdtempSync(join(tmpdir(), "remove-tree-"));
  const tree = join(root, "123-home-abc");
  mkdirSync(join(tree, ".mattstack", "rt", "logs"), { recursive: true });
  writeFileSync(join(tree, ".mattstack", "rt", "logs", "cli.log"), "x");
  return tree;
}

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

test("a tree another remover finishes while this one is failing counts as removed", () => {
  const tree = makeTree();
  let calls = 0;
  const loseTheRace = (path: string) => {
    calls++;
    rmSync(path, { recursive: true, force: true });
    if (calls === 1) throw codedError("ENOTEMPTY");
  };
  expect(() => removeTree(tree, loseTheRace)).not.toThrow();
  expect(existsSync(tree)).toBe(false);
});

test("a tree whose entries vanish under this remover counts as removed", () => {
  const tree = makeTree();
  const vanishing = (path: string) => {
    rmSync(path, { recursive: true, force: true });
    throw codedError("ENOENT");
  };
  expect(() => removeTree(tree, vanishing)).not.toThrow();
  expect(existsSync(tree)).toBe(false);
});

test("a read-only tree is made writable and removed", () => {
  const tree = makeTree();
  chmodSync(join(tree, ".mattstack", "rt"), 0o500);
  removeTree(tree);
  expect(existsSync(tree)).toBe(false);
});

test("a failure that is not the tree vanishing still throws", () => {
  const tree = makeTree();
  const denied = () => {
    throw codedError("EACCES");
  };
  expect(() => removeTree(tree, denied)).toThrow("EACCES");
});
