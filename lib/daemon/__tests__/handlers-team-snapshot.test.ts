import { describe, test, expect } from "bun:test";
import { createTeamSnapshotHandlers } from "../handlers/team-snapshot.ts";
import { UserActionableError } from "../../errors.ts";
import { fakeProbes, ok } from "../../setup/__tests__/fakes.ts";

const fakeHandle = {
  status: () => [{ slug: "acme", id: "team:acme" }],
  pullNow: async (slug: string) => {
    if (slug !== "acme") throw new UserActionableError("no-team", `team "${slug}" is not cloned locally`);
    return { outcome: "up-to-date" as const, detail: null };
  },
} as unknown as import("../team-snapshots.ts").TeamSnapshotsHandle;

describe("team snapshot handlers", () => {
  test("status returns every entry; pull routes by slug; unknown slug is a user error, not a throw", async () => {
    const h = createTeamSnapshotHandlers(fakeHandle);
    expect(await h["team:snapshot-status"]({})).toEqual({ ok: true, data: [{ slug: "acme", id: "team:acme" }] });
    expect(await h["team:pull"]({ slug: "acme" })).toEqual({ ok: true, data: { outcome: "up-to-date", detail: null } });
    const bad = await h["team:pull"]({ slug: "nope" });
    expect(bad.ok).toBe(false);
    expect((bad as { error: string; failure: { code: string } }).error).toContain("not cloned");
    expect((bad as { error: string; failure: { code: string } }).failure.code).toBe("no-team");
  });
});

describe("team:pull on a clone whose org moved its data", () => {
  const HOLD = { outcome: "skipped" as const, detail: "Your org's data moved to the mattstack branch. rt switches this Mac over when your copy has no unsaved changes.", hold: { moved: "mattstack" } };
  const handle = { status: () => [{ slug: "acme", repoDir: "/h/.mattstack/orgs/acme" }], pullNow: async () => HOLD } as unknown as import("../team-snapshots.ts").TeamSnapshotsHandle;
  const onBranch = (branch: string) => fakeProbes({ home: "/h", exec: (argv) => (argv.includes("symbolic-ref") ? ok(`${branch}\n`) : ok("")) });
  type MoveData = NonNullable<Parameters<typeof createTeamSnapshotHandlers>[1]>["moveData"];
  const handlers = (branch: string, moveData: MoveData) => {
    const dirs: string[] = [];
    const h = createTeamSnapshotHandlers(handle, { probes: onBranch(branch), moveData: async (p, dir, opts) => { dirs.push(dir); return moveData!(p, dir, opts); } });
    return { h, dirs };
  };

  test("a clone the pull's own hook already moved reads moved", async () => {
    const { h, dirs } = handlers("mattstack", async () => null);
    expect(await h["team:pull"]({ slug: "acme" })).toEqual({ ok: true, data: { outcome: "moved", detail: "Moved your copy of the org to the mattstack branch" } });
    expect(dirs).toEqual([]);
  });

  test("a clone still on main runs the move once more and reads moved when it lands", async () => {
    const { h, dirs } = handlers("main", async () => ({ kind: "moved", branch: "mattstack" }));
    expect(await h["team:pull"]({ slug: "acme" })).toEqual({ ok: true, data: { outcome: "moved", detail: "Moved your copy of the org to the mattstack branch" } });
    expect(dirs).toEqual(["/h/.mattstack/orgs/acme"]);
  });

  test("a dirty clone is skipped with its files and the pull remedy", async () => {
    const { h } = handlers("main", async () => ({ kind: "held", why: "dirty", files: ["mattstack/org/settings.org.jsonc"] }));
    expect(await h["team:pull"]({ slug: "acme" })).toEqual({
      ok: true,
      data: { outcome: "skipped", detail: "Your copy of the org has unsaved changes: mattstack/org/settings.org.jsonc. Save or discard those changes, then run rt team pull", hold: { moved: "mattstack" } },
    });
  });

  test("unpublished commits name rt team publish first", async () => {
    const { h } = handlers("main", async () => ({ kind: "held", why: "unpushed", commits: 2 }));
    const res = await h["team:pull"]({ slug: "acme" });
    expect(res.data.detail).toBe("Your copy of the org has 2 commits that are not published yet. Run rt team publish first, then rt team pull");
  });

  test("a move that failed is the error path", async () => {
    const { h } = handlers("main", async () => ({ kind: "failed", log: "fatal: could not read from remote repository" }));
    const res = await h["team:pull"]({ slug: "acme" });
    expect(res).toMatchObject({ ok: false, failure: { code: "data-branch-move-failed", message: "rt could not move your copy of the org to the mattstack branch" } });
    expect(res.error).toContain("could not read from remote repository");
  });

  test("nothing left to move returns the pull as it was", async () => {
    const { h } = handlers("main", async () => null);
    expect(await h["team:pull"]({ slug: "acme" })).toEqual({ ok: true, data: HOLD });
  });
});
