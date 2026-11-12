import { describe, expect, test } from "bun:test";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

const REPO = "remote:github.com%2Fo%2Fr";

function handlers(selfUsername: (repoName: string, repoPath: string) => Promise<string | null>) {
  return createMRHandlers(
    { cache: fakeStore({}), repoIndex: () => ({ [REPO]: "/repo" }), log: { warn() {}, info() {}, debug() {}, error() {} } as any },
    () => {},
    { selfUsername },
  );
}

describe("forge:self", () => {
  test("answers the login", async () => {
    const calls: [string, string][] = [];
    const h = handlers(async (repoName, repoPath) => { calls.push([repoName, repoPath]); return "octo"; });
    expect(await h["forge:self"]({ repoName: REPO })).toEqual({ ok: true, data: { username: "octo" } });
    expect(calls).toEqual([[REPO, "/repo"]]);
  });

  test("null answers ok false", async () => {
    const h = handlers(async () => null);
    expect(await h["forge:self"]({ repoName: REPO })).toEqual({ ok: false, error: `could not read the token's own user for ${REPO}` });
  });

  test("a non-identity repoName is refused before the seam", async () => {
    let called = false;
    const h = handlers(async () => { called = true; return "octo"; });
    expect(await h["forge:self"]({ repoName: "o/r" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(called).toBe(false);
  });

  test("a throwing seam answers ok false with its text", async () => {
    const h = handlers(async () => { throw new Error("boom"); });
    expect(await h["forge:self"]({ repoName: REPO })).toEqual({ ok: false, error: "Error: boom" });
  });
});
