import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDef } from "../registry-machinery.ts";
import { validateWrite } from "../validate-write.ts";

const def = getDef("mattstack.directory")!;

describe("validateWrite: mattstack.directory", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-directory-write-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("refuses two teams on one code owners channel, naming both", () => {
    const verdict = validateWrite(
      def,
      { teams: { a: { slack: { codeOwnersChannel: "shared" } }, b: { slack: { codeOwnersChannel: "#Shared" } } } },
      { scope: "org" },
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("two teams claim #shared as their code owners channel: a, b");
  });

  test("accepts a kind no app reads", () => {
    expect(validateWrite(def, { teams: { a: { slack: { channels: [{ name: "a-x", kind: "oncall" }] } } } }, { scope: "org" }).ok).toBe(true);
  });
});
