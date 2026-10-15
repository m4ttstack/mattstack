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
  /** A clone on `branch`; `status` and `unpushed` answer git status and the unpushed-commit list. */
  const clone = (branch: string, opts: { status?: string; unpushed?: string; touched?: string } = {}) =>
    fakeProbes({
      home: "/h",
      exec: (argv) => {
        if (argv.includes("symbolic-ref")) return ok(`${branch}\n`);
        if (argv.includes("status")) return ok(opts.status ?? "");
        if (argv.includes("rev-list")) return ok(opts.unpushed ?? "");
        if (argv.includes("diff-tree")) return ok(opts.touched ?? "");
        return ok("");
      },
    });
  type MoveData = NonNullable<NonNullable<Parameters<typeof createTeamSnapshotHandlers>[1]>["moveData"]>;
  const handlers = (probes: ReturnType<typeof clone>, moveData: MoveData) => {
    const dirs: string[] = [];
    const h = createTeamSnapshotHandlers(handle, { probes, moveData: async (p, dir, opts) => { dirs.push(dir); return moveData(p, dir, opts); } });
    return { h, dirs };
  };

  test("a clone the pull's own hook already moved reads moved", async () => {
    const { h, dirs } = handlers(clone("mattstack"), async () => null);
    expect(await h["team:pull"]({ slug: "acme" })).toEqual({ ok: true, data: { outcome: "moved", detail: "Moved your copy of the org to the mattstack branch" } });
    expect(dirs).toEqual([]);
  });

  test("a clean clone still on main runs the move once more and reads moved, with the commits it carried", async () => {
    const { h, dirs } = handlers(clone("main"), async () => ({ kind: "moved", branch: "mattstack", carried: 2 }));
    expect(await h["team:pull"]({ slug: "acme" })).toEqual({ ok: true, data: { outcome: "moved", detail: "Moved your copy of the org to the mattstack branch, with your 2 unpublished commits" } });
    expect(dirs).toEqual(["/h/.mattstack/orgs/acme"]);
  });

  test("a dirty clone is explained without a second move: skipped with its files and the pull remedy", async () => {
    const { h, dirs } = handlers(clone("main", { status: " M mattstack/org/settings.org.jsonc\n" }), async () => ({ kind: "failed", log: "raced" }));
    expect(await h["team:pull"]({ slug: "acme" })).toEqual({
      ok: true,
      data: { outcome: "skipped", detail: "Your copy of the org has unsaved changes: mattstack/org/settings.org.jsonc. Save or discard those changes, then run rt team pull", hold: { moved: "mattstack" }, needsYou: true },
    });
    expect(dirs).toEqual([]);
  });

  test("commits outside the org's data name an org admin, never rt team publish", async () => {
    const { h, dirs } = handlers(clone("main", { unpushed: "abc123\n", touched: "apps/x/readme.md\n" }), async () => null);
    const res = await h["team:pull"]({ slug: "acme" });
    expect(res.data.detail).toBe("rt could not carry 1 unpublished commit to the org's data branch, because it changes files outside the org's data. Ask an org admin to help move it");
    expect(res.data.detail).not.toContain("rt team publish");
    expect(dirs).toEqual([]);
  });

  test("commits that clash with the data branch are explained from the second try", async () => {
    const { h } = handlers(clone("main"), async () => ({ kind: "held", why: "uncarried", commits: 1, reason: "clash" }));
    const res = await h["team:pull"]({ slug: "acme" });
    expect(res.data.detail).toBe("rt could not carry 1 unpublished commit to the org's data branch, because it clashes with changes already there. Ask an org admin to help move it");
  });

  test("a move that failed is the error path", async () => {
    const { h } = handlers(clone("main"), async () => ({ kind: "failed", log: "fatal: could not read from remote repository" }));
    const res = await h["team:pull"]({ slug: "acme" });
    expect(res).toMatchObject({ ok: false, failure: { code: "data-branch-move-failed", message: "rt could not move your copy of the org to the mattstack branch" } });
    expect(res.error).toContain("could not read from remote repository");
  });

  test("nothing left to move, or an origin it could not ask, returns the pull as it was", async () => {
    expect(await handlers(clone("main"), async () => null).h["team:pull"]({ slug: "acme" })).toEqual({ ok: true, data: HOLD });
    expect(await handlers(clone("main"), async () => ({ kind: "unchecked", log: "offline" })).h["team:pull"]({ slug: "acme" })).toEqual({ ok: true, data: HOLD });
  });
});
