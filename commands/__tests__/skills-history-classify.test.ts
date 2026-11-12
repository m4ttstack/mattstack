/**
 * The --json envelope of rt skills history-classify is frozen byte for byte: the console's Changes tab parses it.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { skillsHistoryClassify } from "../skills-history-classify.ts";
import { clearIdentityMemo } from "../../lib/settings/identity.ts";
import { CLASSIFY_RULE } from "../../lib/skills/history-classify.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

const MANIFEST = "teams/acme/plugin/.claude-plugin/plugin.json";

describe("rt skills history-classify", () => {
  const origHome = process.env.HOME;
  let home: string;
  let repo: string;
  let cap: ReturnType<typeof captureOut>;
  let exit: ReturnType<typeof spyOn<typeof process, "exit">>;

  function git(...args: string[]): string {
    return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: repo }).toString().trim();
  }

  function commitFile(rel: string, text: string, message: string): string {
    mkdirSync(join(repo, rel, ".."), { recursive: true });
    writeFileSync(join(repo, rel), text);
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  }

  const manifest = (version: string) => JSON.stringify({ name: "acme", version }, null, 2) + "\n";

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-history-classify-cmd-")));
    process.env.HOME = home;
    clearIdentityMemo();
    repo = join(home, "org");
    mkdirSync(repo);
    git("init", "-q", "-b", "main");
    git("remote", "add", "origin", "https://example.com/acme/org.git");
    cap = captureOut();
    out.__test__.setHuman(() => false);
    exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Exit(code ?? 0);
    }) as never);
  });

  afterEach(() => {
    exit.mockRestore();
    cap.restore();
    process.env.HOME = origHome;
    clearIdentityMemo();
    rmSync(home, { recursive: true, force: true });
  });

  test("--json answers the version-only shas and caches under the org clone's identity", async () => {
    commitFile(MANIFEST, manifest("0.4.11"), "seed");
    const bump = commitFile(MANIFEST, manifest("0.4.12"), "bump");
    const edit = commitFile("teams/acme/plugin/fills/goal.md", "Ship it.\n", "edit");

    await skillsHistoryClassify(["--repo-dir", repo, "--sha", bump, "--sha", edit, "--json"]);

    expect(cap.stdout()).toBe(`{"versionOnly":["${bump}"]}\n`);
    expect(cap.stderr()).toBe("");
    const cache = join(home, ".mattstack", "rt", "cache", "history-classify", "remote:example.com%2Facme%2Forg.json");
    expect(existsSync(cache)).toBe(true);
    expect(JSON.parse(readFileSync(cache, "utf8"))).toEqual({ rule: CLASSIFY_RULE, shas: { [bump]: true, [edit]: false } });
  });

  test("--json with none version-only answers an empty list", async () => {
    commitFile(MANIFEST, manifest("0.4.11"), "seed");
    const edit = commitFile("teams/acme/plugin/fills/goal.md", "Ship it.\n", "edit");

    await skillsHistoryClassify(["--repo-dir", repo, "--sha", edit, "--json"]);

    expect(cap.stdout()).toBe(`{"versionOnly":[]}\n`);
    expect(cap.stderr()).toBe("");
  });

  test("a folder that is not a git repo fails with exit 2", async () => {
    const plain = join(home, "plain");
    mkdirSync(plain);
    await expect(skillsHistoryClassify(["--repo-dir", plain, "--sha", "abc1234", "--json"])).rejects.toThrow(Exit);
    expect(exit).toHaveBeenCalledWith(2);
    expect(JSON.parse(cap.stdout()).error.code).toBe("not-a-repo");
  });

  test("a value that is not a sha fails with exit 2", async () => {
    await expect(skillsHistoryClassify(["--repo-dir", repo, "--sha", "--oops", "--json"])).rejects.toThrow(Exit);
    expect(exit).toHaveBeenCalledWith(2);
    expect(JSON.parse(cap.stdout()).error.code).toBe("usage");
  });

  test("a missing --repo-dir asks for it", async () => {
    await expect(skillsHistoryClassify(["--sha", "abc1234"])).rejects.toThrow(Exit);
    expect(exit).toHaveBeenCalledWith(2);
    expect(cap.stderr()).toStartWith("Which org clone");
  });
});
