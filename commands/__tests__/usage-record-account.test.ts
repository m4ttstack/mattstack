import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import * as out from "../../lib/ui/out.ts";
import { resolveLeaf } from "../../lib/command-tree-resolve.ts";
import { TREE } from "../../lib/command-tree-def.ts";
import { MODULE_REGISTRY } from "../../lib/module-registry.ts";
import { recordAccountWith } from "../usage.ts";

let dir: string;
let io: CapturedOut;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "record-account-"));
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
});
afterEach(() => {
  io.restore();
  rmSync(dir, { recursive: true, force: true });
});

const writeConfig = (account: string) =>
  writeFileSync(
    join(dir, ".claude.json"),
    JSON.stringify({ oauthAccount: { accountUuid: account, emailAddress: "a@b.c" } }),
  );

describe("recordAccountWith", () => {
  test("records one line for a valid config and prints nothing", async () => {
    writeConfig("uuid-1");
    const path = join(dir, "usage", "accounts.jsonl");
    await recordAccountWith(
      "s1",
      { env: { CLAUDE_CONFIG_DIR: dir }, home: dir, now: () => 1000, path },
    );
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("uuid-1");
    expect(lines[0]).toContain("s1");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });

  test("writes nothing for a missing config", async () => {
    const path = join(dir, "usage", "accounts.jsonl");
    await recordAccountWith(
      "s1",
      { env: { CLAUDE_CONFIG_DIR: join(dir, "none") }, home: dir, now: () => 1000, path },
    );
    expect(existsSync(path)).toBe(false);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });

  test("an unwritable path prints nothing and does not throw", async () => {
    writeConfig("uuid-1");
    const blocker = join(dir, "file");
    writeFileSync(blocker, "x");
    await recordAccountWith(
      "s1",
      { env: { CLAUDE_CONFIG_DIR: dir }, home: dir, now: () => 1000, path: join(blocker, "sub", "a.jsonl") },
    );
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });

  test("a missing session is a usage failure", async () => {
    let code: number | undefined;
    await recordAccountWith(
      undefined,
      { env: {}, home: dir, now: () => 1, path: join(dir, "a.jsonl"), exit: (c: number) => { code = c; } },
    );
    expect(code).toBe(2);
    expect(io.stderr() + io.stdout()).toContain("record-account");
  });
});

describe("usageRecordAccountCommand through dispatch", () => {
  const saved = { home: process.env.HOME, config: process.env.CLAUDE_CONFIG_DIR };
  afterEach(() => {
    process.env.HOME = saved.home;
    if (saved.config === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved.config;
  });

  test("the tree's handler reads --session from argv and writes a line", async () => {
    writeConfig("uuid-1");
    process.env.HOME = dir;
    process.env.CLAUDE_CONFIG_DIR = dir;
    const leaf = resolveLeaf(TREE, ["usage", "record-account", "--session", "s1"]);
    expect(leaf?.path).toEqual(["usage", "record-account"]);
    const mod = await MODULE_REGISTRY[leaf!.node.module!]!();
    const handler = mod[leaf!.node.fn!] as (args: string[], ctx: unknown) => Promise<void>;
    await handler(leaf!.rest, {});
    const lines = readFileSync(join(dir, ".mattstack", "rt", "usage", "accounts.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("s1");
    expect(lines[0]).toContain("uuid-1");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });
});
