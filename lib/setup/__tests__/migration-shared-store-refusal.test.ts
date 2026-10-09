import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { teamSettingsPath, userSettingsPath } from "../../../packages/rt-client/src/settings/paths.ts";
import { readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { pruneStoreName, renameRepoSection, setSetting, setSettingsNoticeSink, SharedStoreWriteRefused, unsetSetting } from "../../settings/write.ts";
import { runUpdateWith, type ApplyContext, type StepOutcome } from "../apply.ts";
import { SHARED_STORE_REFUSAL, type MigrationDef } from "../migrations/index.ts";
import { fakeProbes } from "./fakes.ts";

function writeOrgSlack(): void {
  setSetting("board.slack", { singleTemplate: "org" }, "org");
}

function migration(id: string, run: () => StepOutcome | Promise<StepOutcome>): MigrationDef {
  return { id, title: id, run: async () => run() };
}

describe("a migration cannot write the org or team stores", () => {
  const origHome = process.env.HOME;
  let home: string;
  let teamStore: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;
  const ctx = () => ({ p: fakeProbes({ home }), emit: () => {}, log: () => {} }) as unknown as ApplyContext;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-refusal-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
    const seeded = seedOrg({
      org: "acme",
      username: "me",
      roster: [{ username: "me", teams: ["claim"] }],
      roles: { admins: ["me"], teams: { claim: { owners: ["me"] } } },
      teams: { claim: {} },
    });
    const dir = join(home, ".mattstack", "orgs", seeded.org);
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), "");
    teamStore = seeded.teamStores.claim!;
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("a team write fails the migration with the refusal sentence and leaves the team store alone", async () => {
    const before = readFileSync(teamStore, "utf8");
    const m = migration("2099-01-01-team-write", () => {
      setSetting("board.slack", { singleTemplate: "x" }, "team", { team: "claim" });
      return { state: "done" };
    });

    const result = await runUpdateWith([], [m], ctx());

    expect(result.outcomes).toEqual([{ id: "migration.2099-01-01-team-write", state: "failed", detail: SHARED_STORE_REFUSAL }]);
    expect(readFileSync(teamStore, "utf8")).toBe(before);
  });

  test("a user write is allowed", async () => {
    const m = migration("2099-01-01-user-write", () => {
      setSetting("rt.logLevel", "debug", "user");
      return { state: "done" };
    });

    const result = await runUpdateWith([], [m], ctx());

    expect(result.outcomes).toEqual([{ id: "migration.2099-01-01-user-write", state: "done" }]);
    expect(readStore(userSettingsPath()).global["rt.logLevel"]).toBe("debug");
  });

  test("the allowlisted migration may write a team store", async () => {
    const m = migration("2026-10-07-sdm-resources-key", () => {
      setSetting("board.slack", { singleTemplate: "x" }, "team", { team: "claim" });
      return { state: "done" };
    });

    const result = await runUpdateWith([], [m], ctx());

    expect(result.outcomes).toEqual([{ id: "migration.2026-10-07-sdm-resources-key", state: "done" }]);
    expect(readStore(teamStore).global["board.slack"]).toEqual({ singleTemplate: "x" });
  });

  test("the refusal is lifted once a migration that hit it has thrown", async () => {
    const m = migration("2099-01-01-throws", () => {
      setSetting("board.slack", { singleTemplate: "x" }, "team", { team: "claim" });
      throw new Error("unreachable");
    });

    await runUpdateWith([], [m], ctx());
    setSetting("board.slack", { singleTemplate: "after" }, "team", { team: "claim" });

    expect(readStore(teamStore).global["board.slack"]).toEqual({ singleTemplate: "after" });
  });

  test("a helper outside the migrations folder is refused when a migration calls it", async () => {
    const m = migration("2099-01-01-helper", () => {
      writeOrgSlack();
      return { state: "done" };
    });

    const result = await runUpdateWith([], [m], ctx());

    expect(result.outcomes).toEqual([{ id: "migration.2099-01-01-helper", state: "failed", detail: SHARED_STORE_REFUSAL }]);
  });

  test("unset, prune and section rename are refused on a shared store, and a rename in the user store is not", async () => {
    const caught: Record<string, unknown> = {};
    const attempt = (name: string, write: () => unknown) => {
      try {
        caught[name] = write();
      } catch (err) {
        caught[name] = err;
      }
    };
    const m = migration("2099-01-01-every-writer", () => {
      attempt("unset", () => unsetSetting("board.slack", "team", { team: "claim" }));
      attempt("prune", () => pruneStoreName("board.slack", "board.slackOld", "team", { team: "claim" }));
      attempt("rename", () => renameRepoSection(teamSettingsPath("acme", "claim"), "old", "new"));
      attempt("renameUser", () => renameRepoSection(userSettingsPath(), "old", "new"));
      return { state: "done" };
    });

    await runUpdateWith([], [m], ctx());

    for (const name of ["unset", "prune", "rename"]) {
      expect(caught[name]).toBeInstanceOf(SharedStoreWriteRefused);
      expect((caught[name] as Error).message).toBe(SHARED_STORE_REFUSAL);
    }
    expect(caught.renameUser).toEqual({ status: "none", keys: 0 });
  });
});
