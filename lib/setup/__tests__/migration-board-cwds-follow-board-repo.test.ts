import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { removeIndexRow, updateRepoIndexAsync } from "../../repo-index.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { storedValue } from "../../settings/presence.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { makeBoardCwdsFollowBoardRepoMigration } from "../migrations/board-cwds-follow-board-repo.ts";
import { readSetupState } from "../state.ts";
import { fakeProbes } from "./fakes.ts";

const WIDGETS = "gitlab.example.com/acme/widgets";
const GADGETS = "gitlab.example.com/acme/gadgets";
const SPROCKETS = "gitlab.example.com/acme/sprockets";
const all = (path: string) => ({ review: path, respond: path, doctor: path });

describe("2026-10-29-board-cwds-follow-board-repo", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;
  let restarts: number;
  let restartResult: () => Promise<boolean>;
  let dirs: Record<string, string[]>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-board-cwds-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
    restarts = 0;
    restartResult = async () => true;
    dirs = {};
  });

  afterEach(() => {
    for (const identity of [WIDGETS, GADGETS, SPROCKETS]) removeIndexRow(serializeIdentity({ kind: "remote", id: identity }));
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(path: string, body: unknown) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(body));
  }

  function team(store: Record<string, unknown> = { "mattstack.tracking": { repos: { [GADGETS]: {}, [WIDGETS]: {} } }, "board.projects": ["acme/widgets"] }) {
    const org = join(home, ".mattstack", "orgs", "acme");
    write(join(org, "mattstack", "org", "settings.org.jsonc"), {});
    write(join(org, "mattstack", "teams", "widgets", "settings.team.jsonc"), store);
    write(join(home, ".mattstack", "user", "settings.user.jsonc"), { "mattstack.activeTeam": "widgets" });
  }

  async function register(identity: string, name: string): Promise<string> {
    const dir = join(home, "code", name);
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", "-q", dir]);
    expect((await updateRepoIndexAsync(serializeIdentity({ kind: "remote", id: identity }), dir)).ok).toBe(true);
    dirs[dir] = [];
    return dir;
  }

  function run() {
    const p = fakeProbes({ home, dirs });
    const migration = makeBoardCwdsFollowBoardRepoMigration({
      restartBoard: () => {
        restarts++;
        return restartResult();
      },
    });
    return { p, outcome: migration.run({ p, log: () => {} } as unknown as ApplyContext) };
  }

  test("a missing board.cwds is written from the board repo and the board restarts", async () => {
    team();
    await register(GADGETS, "gadgets");
    const widgets = await register(WIDGETS, "widgets");
    const { p, outcome } = run();
    expect(await outcome).toEqual({ state: "done", detail: "The board's agents start in ~/code/widgets" });
    expect(restarts).toBe(1);
    expect(storedValue<unknown>("board.cwds")).toEqual(all(widgets));
    expect(readSetupState(p).boardCwdsWritten).toEqual(all(widgets));
    expect(readSetupState(p).boardRestartPending).toBeUndefined();
  });

  test("a board.cwds pointing at a folder that is gone is rewritten", async () => {
    team();
    const widgets = await register(WIDGETS, "widgets");
    setSetting("board.cwds", { review: join(home, "gone"), respond: widgets, doctor: widgets }, "machine");
    expect((await run().outcome).state).toBe("done");
    expect(storedValue<unknown>("board.cwds")).toEqual(all(widgets));
    expect(restarts).toBe(1);
  });

  test("a board.cwds pointing at a folder that is no tracked checkout is rewritten", async () => {
    team();
    const widgets = await register(WIDGETS, "widgets");
    const notes = join(home, "notes");
    dirs[notes] = [];
    setSetting("board.cwds", { review: notes, respond: widgets, doctor: widgets }, "machine");
    expect((await run().outcome).state).toBe("done");
    expect(storedValue<unknown>("board.cwds")).toEqual(all(widgets));
  });

  test("the old uniform value on another tracked repo is repointed", async () => {
    team();
    const gadgets = await register(GADGETS, "gadgets");
    const widgets = await register(WIDGETS, "widgets");
    setSetting("board.cwds", all(gadgets), "machine");
    expect((await run().outcome).state).toBe("done");
    expect(storedValue<unknown>("board.cwds")).toEqual(all(widgets));
  });

  test("a board.cwds pointing at a real checkout is left alone", async () => {
    team();
    const gadgets = await register(GADGETS, "gadgets");
    const widgets = await register(WIDGETS, "widgets");
    const mine = { review: gadgets, respond: widgets, doctor: widgets };
    setSetting("board.cwds", mine, "machine");
    const { p, outcome } = run();
    expect(await outcome).toEqual({ state: "skipped", detail: "You set the board's folders yourself, so rt left them alone" });
    expect(restarts).toBe(0);
    expect(storedValue<unknown>("board.cwds")).toEqual(mine);
    expect(readSetupState(p).boardCwdsWritten).toBeUndefined();
  });

  test("a board.cwds already at the board repo is recorded as rt's, nothing restarts", async () => {
    team();
    const widgets = await register(WIDGETS, "widgets");
    setSetting("board.cwds", all(widgets), "machine");
    const { p, outcome } = run();
    expect(await outcome).toEqual({ state: "skipped", detail: "The board already starts in ~/code/widgets" });
    expect(restarts).toBe(0);
    expect(readSetupState(p).boardCwdsWritten).toEqual(all(widgets));
    expect(readSetupState(p).boardRestartPending).toBeUndefined();
  });

  test("no team or no board repo: skipped, nothing written", async () => {
    expect(await run().outcome).toEqual({ state: "skipped", detail: "This Mac has no team" });
    team({ "board.projects": ["acme/widgets"] });
    const { p, outcome } = run();
    expect(await outcome).toEqual({ state: "skipped", detail: "None of the team's repos is the board's" });
    expect(storedValue<unknown>("board.cwds")).toBeUndefined();
    expect(readSetupState(p).boardCwdsWritten).toBeUndefined();
    expect(restarts).toBe(0);
  });

  test("a board repo not on this Mac yet: skipped, nothing written", async () => {
    team();
    expect(await run().outcome).toEqual({ state: "skipped", detail: "widgets is not on this Mac yet" });
    expect(storedValue<unknown>("board.cwds")).toBeUndefined();
  });

  test("a board repo not on this Mac yet: the old uniform value is recorded as rt's", async () => {
    team();
    const gadgets = await register(GADGETS, "gadgets");
    setSetting("board.cwds", all(gadgets), "machine");
    const { p, outcome } = run();
    expect(await outcome).toEqual({ state: "skipped", detail: "widgets is not on this Mac yet" });
    expect(storedValue<unknown>("board.cwds")).toEqual(all(gadgets));
    expect(readSetupState(p).boardCwdsWritten).toEqual(all(gadgets));
    expect(restarts).toBe(0);
  });

  test("a board repo not on this Mac yet: differing values on real checkouts are not recorded", async () => {
    team({ "mattstack.tracking": { repos: { [GADGETS]: {}, [SPROCKETS]: {}, [WIDGETS]: {} } }, "board.projects": ["acme/widgets"] });
    const gadgets = await register(GADGETS, "gadgets");
    const sprockets = await register(SPROCKETS, "sprockets");
    setSetting("board.cwds", { review: gadgets, respond: sprockets, doctor: sprockets }, "machine");
    const { p, outcome } = run();
    expect(await outcome).toEqual({ state: "skipped", detail: "widgets is not on this Mac yet" });
    expect(readSetupState(p).boardCwdsWritten).toBeUndefined();
  });

  test("no board repo: a broken value is recorded as rt's", async () => {
    team({ "mattstack.tracking": { repos: { [GADGETS]: {} } }, "board.projects": ["acme/widgets"] });
    const broken = { review: join(home, "gone"), respond: join(home, "gone") };
    setSetting("board.cwds", broken, "machine");
    const first = run();
    expect(await first.outcome).toEqual({ state: "skipped", detail: "None of the team's repos is the board's" });
    expect(readSetupState(first.p).boardCwdsWritten).toEqual(broken);
  });

  test("a restart that fails still records the write, with the note to restart by hand", async () => {
    team();
    const widgets = await register(WIDGETS, "widgets");
    restartResult = async () => {
      throw new Error("deck is not running");
    };
    const { p, outcome } = run();
    const result = await outcome;
    expect(result.state).toBe("done");
    expect(result.state === "done" && result.detail).toEndWith("Restart the board from deck to use it");
    expect(storedValue<unknown>("board.cwds")).toEqual(all(widgets));
    expect(readSetupState(p).boardCwdsWritten).toEqual(all(widgets));
    expect(readSetupState(p).boardRestartPending).toBe(true);
  });

  test("it runs last among the migrations", () => {
    expect(MIGRATIONS.at(-1)!.id).toBe("2026-10-29-board-cwds-follow-board-repo");
  });
});
