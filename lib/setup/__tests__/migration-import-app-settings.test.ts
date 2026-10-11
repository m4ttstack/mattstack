import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { updateRepoIndex } from "../../repo-index.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { boardCopies, importAppSettingsMigration } from "../migrations/import-app-settings.ts";
import { importLegacySettingsMigration } from "../migrations/import-legacy-settings.ts";
import { fakeProbes } from "./fakes.ts";

const NOTHING = { state: "skipped", detail: "There were no old board or gitq settings to copy" };

describe("2026-10-11-import-app-settings", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-import-apps-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const boardFile = () => join(home, ".mattstack", "board", "config.json");
  const gitqFile = (name: string) => join(home, ".mattstack", "gitq", name);
  function run(files: Record<string, unknown> = {}, env: Record<string, string> = {}) {
    const body = Object.fromEntries(Object.entries(files).map(([path, v]) => [path, typeof v === "string" ? v : JSON.stringify(v)]));
    const p = fakeProbes({ home, env, files: body });
    return { p, outcome: importAppSettingsMigration.run({ p } as unknown as ApplyContext) };
  }
  const stores = (key: string) => getSetting(key).provenance.filter((row) => row.scope !== "default").map((row) => row.scope);

  test("runs right after the hooks and writing-style import", () => {
    expect(MIGRATIONS.at(-1)).toBe(importAppSettingsMigration);
    expect(MIGRATIONS.at(-2)).toBe(importLegacySettingsMigration);
    expect(importAppSettingsMigration.id).toBe("2026-10-11-import-app-settings");
  });

  test("with no old files it is skipped", async () => {
    expect(await run().outcome).toEqual(NOTHING);
  });

  test("copies the board's personal fields into your user and machine settings and moves the file aside", async () => {
    const { p, outcome } = run({
      [boardFile()]: {
        gitlabHost: "gitlab.example.com",
        projects: ["acme/widgets"],
        members: [{ username: "dev1" }, { username: "dev2", hidden: true }],
        defaultMember: "dev1",
        gateGraceMinutes: 45,
        reviewsWorkspace: "rev",
        reviewCwd: "/work/widgets",
        triage: { enabled: true, maxConcurrent: 4, doctorSkill: "acme:doctor" },
      },
    });
    expect(await outcome).toEqual({
      state: "done",
      detail: "Copied 7 old board or gitq settings into your settings. Your old board file also holds team settings, which a team admin sets",
    });
    expect(getSetting("board.defaultMember").value).toBe("dev1");
    expect(getSetting("board.gateGraceMinutes").value).toBe(45);
    expect(getSetting("board.hiddenMembers").value).toEqual(["dev2"]);
    expect(getSetting("board.workspaces").value).toMatchObject({ reviews: "rev" });
    expect(stores("board.workspaces")).toEqual(["user"]);
    expect(getSetting("board.cwds").value).toEqual({ review: "/work/widgets" });
    expect(stores("board.cwds")).toEqual(["machine"]);
    expect(getSetting("board.triage").value).toMatchObject({ enabled: true });
    expect(getSetting("board.triageMaxConcurrent").value).toBe(4);
    expect(getSetting("board.gitlabHost").value).toBeUndefined();
    expect(p.calls.renames).toContainEqual([boardFile(), `${boardFile()}.imported`]);
  });

  test("a value a store already holds is kept, and the file still moves aside", async () => {
    setSetting("board.defaultMember", "dev2", "user");
    const { p, outcome } = run({ [boardFile()]: { defaultMember: "dev1" } });
    expect(await outcome).toEqual(NOTHING);
    expect(getSetting("board.defaultMember").value).toBe("dev2");
    expect(p.calls.renames).toContainEqual([boardFile(), `${boardFile()}.imported`]);
  });

  test("a file that will not parse is left where it is and is not a failure", async () => {
    const { p, outcome } = run({ [boardFile()]: "{ not json" });
    expect(await outcome).toEqual({ state: "skipped", detail: "There were no old board or gitq settings to copy. 1 old file has a value rt could not read, so rt left it where it is" });
    expect(p.calls.renames).toEqual([]);
  });

  test("a field its key refuses is not copied, the rest are, and the file stays", async () => {
    const { p, outcome } = run({ [boardFile()]: { defaultMember: "dev1", gateGraceMinutes: "soon" } });
    expect(await outcome).toEqual({
      state: "done",
      detail: "Copied 1 old board or gitq setting into your settings. 1 old file has a value rt could not read, so rt left it where it is",
    });
    expect(getSetting("board.defaultMember").value).toBe("dev1");
    expect(p.calls.renames).toEqual([]);
  });

  test("a second run copies nothing more", async () => {
    await run({ [boardFile()]: { defaultMember: "dev1" } }).outcome;
    expect(await run().outcome).toEqual(NOTHING);
  });

  test("copies gitq's settings.json and config.json into their keys", async () => {
    const { p, outcome } = run({
      [gitqFile("settings.json")]: { maxWorkSlots: 5, workSlotLocation: "root", forges: { "gitlab.example.com": { provider: "gitlab" } } },
      [gitqFile("config.json")]: { repos: [{ path: "/work/widgets" }], port: 11009 },
    });
    expect((await outcome).state).toBe("done");
    expect(getSetting("gitq.workSlots").value).toEqual({ maxWorkSlots: 5, workSlotLocation: "root" });
    expect(stores("gitq.workSlots")).toEqual(["machine"]);
    expect(getSetting("gitq.forges").value).toEqual({ "gitlab.example.com": { provider: "gitlab" } });
    expect(stores("gitq.forges")).toEqual(["user"]);
    expect(getSetting("gitq.board").value).toEqual({ repos: [{ path: "/work/widgets" }], port: 11009 });
    expect(p.calls.renames).toContainEqual([gitqFile("settings.json"), `${gitqFile("settings.json")}.imported`]);
    expect(p.calls.renames).toContainEqual([gitqFile("config.json"), `${gitqFile("config.json")}.imported`]);
  });

  test("GITQ_APP_ROOT names gitq's folder, as it does for gitq", async () => {
    const root = join(home, "elsewhere");
    await run({ [join(root, "settings.json")]: { maxWorkSlots: 2 } }, { GITQ_APP_ROOT: root }).outcome;
    expect(getSetting("gitq.workSlots").value).toMatchObject({ maxWorkSlots: 2 });
  });

  test("a gitq board config gitq itself would refuse is not copied", async () => {
    expect(await run({ [gitqFile("config.json")]: { repos: [] } }).outcome).toEqual({
      state: "skipped",
      detail: "There were no old board or gitq settings to copy. 1 old file has a value rt could not read, so rt left it where it is",
    });
    expect(getSetting("gitq.board").value).toBeUndefined();
  });

  const remoteRow = (name: string) => serializeIdentity({ kind: "remote", id: `gitlab.example.com/acme/${name}` });
  function registerRepo(key: string, name: string): string {
    const dir = join(home, "checkouts", `${key}-${name}`);
    mkdirSync(dir, { recursive: true });
    updateRepoIndex(key, dir);
    return dir;
  }

  test("a gitq.board saved as repo names gets each repo's folder from the repo index", async () => {
    const dir = registerRepo(remoteRow("widgets"), "widgets");
    setSetting("gitq.board", { repos: ["widgets"], port: 11008 }, "machine");
    expect(await run().outcome).toEqual({ state: "done", detail: "Gave each repo on your gitq board its folder" });
    expect(getSetting("gitq.board").value).toEqual({ repos: [{ path: realpathSync(dir), name: "widgets" }], port: 11008 });
  });

  test("a repo the index keys by its bare name still counts", async () => {
    const dir = registerRepo("gadgets", "gadgets");
    setSetting("gitq.board", { repos: ["gadgets"] }, "machine");
    expect((await run().outcome).state).toBe("done");
    expect(getSetting("gitq.board").value).toEqual({ repos: [{ path: realpathSync(dir), name: "gadgets" }] });
  });

  test("two repos sharing a name are never guessed between", async () => {
    registerRepo(remoteRow("widgets"), "widgets");
    registerRepo(serializeIdentity({ kind: "remote", id: "gitlab.example.com/other/widgets" }), "widgets-2");
    setSetting("gitq.board", { repos: ["widgets"] }, "machine");
    expect((await run().outcome).detail).toContain("not on this Mac");
    expect(getSetting("gitq.board").value).toEqual({ repos: ["widgets"] });
  });

  test("a gitq.board naming a repo this Mac does not have is left as it was", async () => {
    setSetting("gitq.board", { repos: ["nowhere"], port: 11008 }, "machine");
    expect(await run().outcome).toEqual({ state: "skipped", detail: "There were no old board or gitq settings to copy. Some repos on your gitq board are not on this Mac, so rt left that setting as it was" });
    expect(getSetting("gitq.board").value).toEqual({ repos: ["nowhere"], port: 11008 });
  });

  test("a bare name the index lacks is resolved from gitq's own config file, which then moves aside", async () => {
    setSetting("gitq.board", { repos: ["nowhere"], port: 11008 }, "machine");
    const { p, outcome } = run({ [gitqFile("config.json")]: { repos: [{ path: "/work/nowhere", name: "nowhere" }] } });
    expect((await outcome).state).toBe("done");
    expect(getSetting("gitq.board").value).toEqual({ repos: [{ path: "/work/nowhere", name: "nowhere" }], port: 11008 });
    expect(p.calls.renames).toContainEqual([gitqFile("config.json"), `${gitqFile("config.json")}.imported`]);
  });

  test("a bare name nothing resolves keeps gitq's config file where it is", async () => {
    setSetting("gitq.board", { repos: ["nowhere", "elsewhere"] }, "machine");
    const { p, outcome } = run({ [gitqFile("config.json")]: { repos: [{ path: "/work/nowhere", name: "nowhere" }] } });
    expect((await outcome).detail).toBe("There were no old board or gitq settings to copy. Some repos on your gitq board are not on this Mac, so rt left that setting and your old gitq file as it was");
    expect(getSetting("gitq.board").value).toEqual({ repos: ["nowhere", "elsewhere"] });
    expect(p.calls.renames).toEqual([]);
  });

  test("boardCopies maps only fields that have a user or machine key", () => {
    expect(boardCopies({ title: "Widgets", claudeCommand: "x", rtRepos: { a: "b" }, staleAfterDays: null })).toEqual([]);
    expect(boardCopies({ respondCwd: "/r" })).toEqual([{ key: "board.cwds", scope: "machine", value: { respond: "/r" } }]);
  });
});
