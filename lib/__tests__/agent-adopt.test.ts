import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { firstCwd, locateTranscript, type TranscriptDeps } from "../agent-adopt.ts";

const SID = "3b9e2f1a-0c4d-4e8f-9a7b-1c2d3e4f5a6b";

function transcript(configDir: string, project: string, lines: object[], mtimeSec?: number): string {
  const dir = join(configDir, "projects", project);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${SID}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (mtimeSec !== undefined) utimesSync(path, mtimeSec, mtimeSec);
  return path;
}

function home(): string {
  return mkdtempSync(join(tmpdir(), "rt-adopt-"));
}

function deps(h: string, accounts: { number: number; email: string }[] = []): TranscriptDeps {
  return { home: h, cswapAccounts: async () => accounts };
}

const LINES = [
  { type: "summary", summary: "x" },
  { type: "user", cwd: "/Users/me/src/app" },
  { type: "user", cwd: "/Users/me/worktrees/ron" },
];

describe("firstCwd", () => {
  test("skips lines without a cwd and returns the first absolute one", () => {
    const h = home();
    const path = transcript(join(h, ".claude"), "-Users-me-src-app", LINES);
    expect(firstCwd(path)).toBe("/Users/me/src/app");
  });

  test("null when no line carries a cwd", () => {
    const h = home();
    const path = transcript(join(h, ".claude"), "p", [{ type: "summary" }]);
    expect(firstCwd(path)).toBeNull();
  });
});

describe("locateTranscript", () => {
  test("~/.claude copy resolves with no account", async () => {
    const h = home();
    transcript(join(h, ".claude"), "-Users-me-src-app", LINES);
    const hit = await locateTranscript(SID, undefined, deps(h));
    expect(hit).toMatchObject({ cwd: "/Users/me/src/app" });
    expect(hit?.account).toBeUndefined();
  });

  test("a cswap-only copy resolves to that dir's account email", async () => {
    const h = home();
    transcript(join(h, ".claude-swap-backup", "sessions", "2-me_example.com"), "p", LINES);
    const hit = await locateTranscript(SID, undefined, deps(h, [{ number: 2, email: "me@example.com" }]));
    expect(hit).toMatchObject({ cwd: "/Users/me/src/app", account: "me@example.com" });
  });

  test("the preferred account wins when its dir holds a copy", async () => {
    const h = home();
    transcript(join(h, ".claude"), "p", LINES);
    transcript(join(h, ".claude-swap-backup", "sessions", "1-work_example.com"), "p", LINES);
    const hit = await locateTranscript(SID, "work@example.com", deps(h, [{ number: 1, email: "work@example.com" }]));
    expect(hit?.account).toBe("work@example.com");
  });

  test("among cswap copies the newest wins", async () => {
    const h = home();
    const root = join(h, ".claude-swap-backup", "sessions");
    transcript(join(root, "1-a_example.com"), "p", LINES, 1_000);
    transcript(join(root, "2-b_example.com"), "p", LINES, 2_000);
    const hit = await locateTranscript(SID, undefined, deps(h, [
      { number: 1, email: "a@example.com" },
      { number: 2, email: "b@example.com" },
    ]));
    expect(hit?.account).toBe("b@example.com");
  });

  test("null when no dir holds the transcript", async () => {
    expect(await locateTranscript(SID, undefined, deps(home()))).toBeNull();
  });

  test("a session id with a path separator is refused before any read", async () => {
    const h = home();
    transcript(join(h, ".claude"), "p", LINES);
    expect(await locateTranscript(`../${SID}`, undefined, deps(h))).toBeNull();
    expect(await locateTranscript("a/b", undefined, deps(h))).toBeNull();
  });
});
