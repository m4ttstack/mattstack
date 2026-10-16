import { describe, expect, test } from "bun:test";
import { collisions, measureLane, parseNumstat, readGithubMerge, type GithubGet, type LaneDeps } from "../herd-lanes.ts";

describe("herd lanes", () => {
  test("parseNumstat totals insertions and deletions and keeps binary paths", () => {
    const drift = parseNumstat("3\t1\tlib/a.ts\n10\t0\tlib/b.ts\n-\t-\tassets/logo.png\n");
    expect(drift).toEqual({
      files: [
        { path: "lib/a.ts", added: 3, removed: 1 },
        { path: "lib/b.ts", added: 10, removed: 0 },
        { path: "assets/logo.png", added: 0, removed: 0 },
      ],
      filesChanged: 3, insertions: 13, deletions: 1,
    });
    expect(parseNumstat("")).toEqual({ files: [], filesChanged: 0, insertions: 0, deletions: 0 });
  });

  test("collisions lists a file two jobs changed", () => {
    expect(collisions([
      { job: "a", files: ["lib/x.ts", "lib/only-a.ts"] },
      { job: "b", files: ["lib/x.ts"] },
      { job: "c", files: ["lib/only-c.ts"] },
    ])).toEqual([{ path: "lib/x.ts", jobs: ["a", "b"] }]);
  });

  test("commits and drift come from merge-base against the default ref", async () => {
    const calls: Array<{ cwd: string; args: string[] }> = [];
    const deps: LaneDeps = {
      git: async (cwd, args) => {
        calls.push({ cwd, args });
        if (args[0] === "diff") return { stdout: "2\t2\tlib/a.ts\n", exitCode: 0 };
        if (args[0] === "rev-list") return { stdout: "4\n", exitCode: 0 };
        return { stdout: "", exitCode: 1 };
      },
      defaultRef: async () => "origin/main",
      merge: async () => { throw new Error("not read here"); },
    };
    const lane = await measureLane(deps, "/w/a");
    expect(lane).toEqual({ ok: true, base: "origin/main", commits: 4, drift: { files: [{ path: "lib/a.ts", added: 2, removed: 2 }], filesChanged: 1, insertions: 2, deletions: 2 } });
    expect(calls).toContainEqual({ cwd: "/w/a", args: ["diff", "--numstat", "--no-renames", "--merge-base", "origin/main"] });
    expect(calls).toContainEqual({ cwd: "/w/a", args: ["rev-list", "--count", "origin/main..HEAD"] });
  });

  test("a failed git read is reported, not counted as zero", async () => {
    const deps: LaneDeps = {
      git: async () => ({ stdout: "", exitCode: 128 }),
      defaultRef: async () => "origin/main",
      merge: async () => { throw new Error("not read here"); },
    };
    const lane = await measureLane(deps, "/w/a");
    expect(lane.ok).toBe(false);
  });
});

describe("readGithubMerge", () => {
  const answer = (status: number, body: unknown): GithubGet => async () => new Response(JSON.stringify(body), { status });

  test("asks for the branch's newest pull request in any state", async () => {
    const paths: string[] = [];
    await readGithubMerge(async (path) => { paths.push(path); return new Response("[]", { status: 200 }); }, "o/r", "feat/x");
    expect(paths).toEqual(["/repos/o/r/pulls?head=o%3Afeat%2Fx&state=all&per_page=1"]);
  });

  test("a 401 reads unknown with the status and no token", async () => {
    const merge = await readGithubMerge(answer(401, { message: "Bad credentials" }), "o/r", "a");
    expect(merge).toMatchObject({ forge: "github", state: "unknown", url: null, number: null, mergedAt: null });
    expect(merge.error).toContain("401");
  });

  test("a 5xx reads unknown", async () => {
    expect((await readGithubMerge(answer(502, "bad gateway"), "o/r", "a")).state).toBe("unknown");
  });

  test("a transport throw reads unknown", async () => {
    const merge = await readGithubMerge(async () => { throw new Error("ECONNRESET"); }, "o/r", "a");
    expect(merge).toMatchObject({ state: "unknown", error: "ECONNRESET" });
  });

  test("an empty listing reads none", async () => {
    expect(await readGithubMerge(answer(200, []), "o/r", "a")).toEqual({ forge: "github", state: "none", url: null, number: null, mergedAt: null });
  });

  test("maps open, closed and merged from the first pull request", async () => {
    const pr = (o: Record<string, unknown>) => answer(200, [{ number: 5, html_url: "https://github.com/o/r/pull/5", merged_at: null, ...o }]);
    expect(await readGithubMerge(pr({ state: "open" }), "o/r", "a")).toEqual({ forge: "github", state: "open", url: "https://github.com/o/r/pull/5", number: 5, mergedAt: null });
    expect((await readGithubMerge(pr({ state: "closed" }), "o/r", "a")).state).toBe("closed");
    expect(await readGithubMerge(pr({ state: "closed", merged_at: "2026-10-16T00:00:00Z" }), "o/r", "a")).toMatchObject({ state: "merged", mergedAt: "2026-10-16T00:00:00Z" });
  });
});
