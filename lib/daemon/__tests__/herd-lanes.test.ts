import { describe, expect, test } from "bun:test";
import { collisions, measureLane, parseNumstat, type LaneDeps } from "../herd-lanes.ts";

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
    expect(calls).toContainEqual({ cwd: "/w/a", args: ["diff", "--numstat", "--merge-base", "origin/main"] });
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
