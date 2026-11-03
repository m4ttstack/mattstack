import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeProbes, type ExecScript } from "./fakes.ts";
import { readToolNotices, runToolNotices, toolNotice, toolNoticesPath, writeToolNotices, type ToolNotices } from "../tool-notices.ts";
import { createToolNoticePullHook } from "../../daemon/tool-notice-pull-hook.ts";

const dop = { name: "doppler", title: "Doppler" };
const ld = { name: "ldcli", title: "ldcli" };

const rec = (r: Partial<ToolNotices> = {}): ToolNotices => ({ pending: [], told: [], acked: [], ...r });

describe("toolNotice", () => {
  test("the first missing read only marks it pending", () => {
    expect(toolNotice([dop], rec())).toEqual({ notice: null, record: rec({ pending: ["doppler"] }) });
  });
  test("a second missing read names the tool", () => {
    expect(toolNotice([dop], rec({ pending: ["doppler"] }))).toEqual({
      notice: { title: "Your team needs Doppler", message: "Open setup to install it" },
      record: rec({ told: ["doppler"] }),
    });
  });
  test("several tools count and list", () => {
    expect(toolNotice([dop, ld], rec({ pending: ["doppler", "ldcli"] })).notice).toEqual({ title: "Your team needs 2 new tools", message: "Doppler and ldcli" });
  });
  test("three tools list with commas", () => {
    const third = { name: "gh", title: "GitHub CLI" };
    expect(toolNotice([dop, ld, third], rec({ pending: ["doppler", "ldcli", "gh"] })).notice?.message).toBe("Doppler, ldcli and GitHub CLI");
  });
  test("a tool already told sends nothing", () => {
    expect(toolNotice([dop], rec({ told: ["doppler"] })).notice).toBeNull();
  });
  test("a read that is no longer missing clears pending, so one bad read never notifies", () => {
    expect(toolNotice([], rec({ pending: ["doppler"] })).record).toEqual(rec());
  });
  test("a resolved tool stays told until acked, then drops off", () => {
    expect(toolNotice([], rec({ told: ["doppler"] })).record).toEqual(rec({ told: ["doppler"] }));
    expect(toolNotice([], rec({ told: ["doppler"], acked: ["doppler"] })).record).toEqual(rec());
  });
  test("only the new name counts toward the notice", () => {
    expect(toolNotice([dop, ld], rec({ told: ["doppler"], pending: ["ldcli"] })).notice?.title).toBe("Your team needs ldcli");
  });
  test("an acked tool that is missing again starts over at pending", () => {
    expect(toolNotice([dop], rec({ told: ["doppler"], acked: ["doppler"] }))).toEqual({ notice: null, record: rec({ pending: ["doppler"] }) });
  });
});

const HOME = "/fake-home";
const RT = `${HOME}/.mattstack/rt`;
const STATE = `${RT}/setup-state.json`;
const RECORD = `${RT}/tool-notices.json`;
const FINISHED = JSON.stringify({ v: 2, finishedAt: "2026-10-01T00:00:00.000Z" });
const TOOL_MISSING: ExecScript = () => ({ code: 127, stdout: "", stderr: "" });

function requirements(tools: unknown[]): string {
  return JSON.stringify({ tools, integrations: [] });
}

function finishedMac(opts: { home?: string; tools?: unknown[]; state?: string; exec?: ExecScript; extra?: Record<string, string>; orgs?: string[] } = {}) {
  const home = opts.home ?? HOME;
  const root = `${home}/.mattstack/orgs/acme`;
  const rt = `${home}/.mattstack/rt`;
  return fakeProbes({
    home,
    dirs: { [`${home}/.mattstack/orgs`]: opts.orgs ?? ["acme"], [`${root}/mattstack/teams`]: ["widgets"] },
    files: {
      [`${root}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }] }),
      [`${root}/mattstack/teams/widgets/plugin/requirements.jsonc`]: requirements(opts.tools ?? [{ name: "doppler", why: "secrets", connect: { integration: "doppler" } }]),
      [`${home}/.mattstack/user/settings.user.jsonc`]: JSON.stringify({ "mattstack.activeTeam": "widgets" }),
      [`${rt}/teams/acme.json`]: JSON.stringify({ forgeUsername: "dev1" }),
      [`${rt}/setup-state.json`]: opts.state ?? FINISHED,
      ...opts.extra,
    },
    exec: opts.exec ?? TOOL_MISSING,
  });
}

function collector() {
  const sent: { title: string; message: string; id: string }[] = [];
  return { sent, notify: (title: string, message: string, id: string) => { sent.push({ title, message, id }); } };
}

describe("readToolNotices", () => {
  test("a missing file reads as an empty record", () => {
    expect(readToolNotices(fakeProbes({ home: HOME }))).toEqual(rec());
  });
  test("a corrupt file reads as an empty record", () => {
    expect(readToolNotices(fakeProbes({ home: HOME, files: { [RECORD]: "{ not json" } }))).toEqual(rec());
    expect(readToolNotices(fakeProbes({ home: HOME, files: { [RECORD]: "null" } }))).toEqual(rec());
    expect(readToolNotices(fakeProbes({ home: HOME, files: { [RECORD]: '{"pending":"doppler","told":[1]}' } }))).toEqual(rec());
  });
  test("a written record reads back from its own file, and no temp file stays", () => {
    const p = fakeProbes({ home: HOME });
    writeToolNotices(p, rec({ told: ["doppler"] }));
    expect(toolNoticesPath(HOME)).toBe(RECORD);
    expect(readToolNotices(p)).toEqual(rec({ told: ["doppler"] }));
    expect(Object.keys(p.calls.writes)).toEqual([RECORD]);
  });
});

describe("runToolNotices", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const dir of tmp.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("two pulls in a row notify once, with the integration's title and an id of the sorted names", async () => {
    const p = finishedMac();
    const { sent, notify } = collector();
    await runToolNotices(p, "acme", notify);
    expect(sent).toEqual([]);
    await runToolNotices(p, "acme", notify);
    await runToolNotices(p, "acme", notify);
    expect(sent).toEqual([{ title: "Your team needs Doppler", message: "Open setup to install it", id: "setup_update:tools:doppler" }]);
  });

  test("a tool with no integration goes by its name, and the id sorts", async () => {
    const p = finishedMac({ tools: [{ name: "ldcli", why: "flags" }, { name: "awscli", why: "cloud" }], extra: { [RECORD]: JSON.stringify(rec({ pending: ["ldcli", "awscli"] })) } });
    const { sent, notify } = collector();
    await runToolNotices(p, "acme", notify);
    expect(sent).toEqual([{ title: "Your team needs 2 new tools", message: "ldcli and awscli", id: "setup_update:tools:awscli,ldcli" }]);
  });

  test("an unfinished Mac sends nothing", async () => {
    const p = finishedMac({ state: JSON.stringify({ v: 2 }), extra: { [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
    const { sent, notify } = collector();
    await runToolNotices(p, "acme", notify);
    expect(sent).toEqual([]);
    expect(p.calls.exec).toEqual([]);
  });

  test("an optional tool sends nothing", async () => {
    const p = finishedMac({ tools: [{ name: "doppler", why: "secrets", optional: true }], extra: { [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
    const { sent, notify } = collector();
    await runToolNotices(p, "acme", notify);
    expect(sent).toEqual([]);
    expect(p.calls.exec).toEqual([]);
  });

  test("a tool whose row reads error or a timeout is not missing", async () => {
    for (const code of [1, 124]) {
      const p = finishedMac({ exec: () => ({ code, stdout: "", stderr: "" }), extra: { [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
      const { sent, notify } = collector();
      await runToolNotices(p, "acme", notify);
      expect(sent).toEqual([]);
      expect(readToolNotices(p)).toEqual(rec());
    }
  });

  test("a live setup run or update lock skips the pass and writes nothing", async () => {
    const pending = JSON.stringify(rec({ pending: ["doppler"] }));
    const running = finishedMac({ state: JSON.stringify({ v: 2, finishedAt: "x", run: { startedAt: "x", done: [] } }), extra: { [RECORD]: pending } });
    const intent = finishedMac({ extra: { [RECORD]: pending, [`${RT}/setup-intent.json`]: "{}" } });

    const home = mkdtempSync(join(tmpdir(), "tool-notices-"));
    tmp.push(home);
    mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
    writeFileSync(join(home, ".mattstack", "rt", "setup-update.lock"), String(process.pid));
    const locked = finishedMac({ home, extra: { [`${home}/.mattstack/rt/tool-notices.json`]: pending } });

    for (const p of [running, intent, locked]) {
      const { sent, notify } = collector();
      await runToolNotices(p, "acme", notify);
      expect(sent).toEqual([]);
      expect(Object.keys(p.calls.writes)).toEqual([]);
      expect(p.calls.exec).toEqual([]);
    }
  });

  test("a finished run does not stand the pass down", async () => {
    const p = finishedMac({ state: JSON.stringify({ v: 2, finishedAt: "x", run: { startedAt: "x", done: [], endedAt: "y", ok: true } }) });
    const { notify } = collector();
    await runToolNotices(p, "acme", notify);
    expect(readToolNotices(p)).toEqual(rec({ pending: ["doppler"] }));
  });

  test("a pull of a clone setup does not read does nothing, and the first org by name is the one it reads", async () => {
    const other = finishedMac({ orgs: ["zeta", "acme"], extra: { [`${HOME}/.mattstack/orgs/zeta/mattstack/org/settings.org.jsonc`]: "{}", [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
    const { sent, notify } = collector();
    await runToolNotices(other, "zeta", notify);
    expect(sent).toEqual([]);
    expect(Object.keys(other.calls.writes)).toEqual([]);
    await runToolNotices(other, "acme", notify);
    expect(sent.length).toBe(1);
  });

  test("a clone with no org store is no org of this Mac", async () => {
    const p = finishedMac();
    const { notify } = collector();
    await runToolNotices(p, "stale", notify);
    expect(Object.keys(p.calls.writes)).toEqual([]);
  });

  test("a sent notice records in tool-notices.json and leaves setup-state untouched", async () => {
    const p = finishedMac({ extra: { [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
    const { notify } = collector();
    await runToolNotices(p, "acme", notify);
    expect(readToolNotices(p)).toEqual(rec({ told: ["doppler"] }));
    expect(p.calls.writes[STATE]).toBeUndefined();
    expect(p.readFile(STATE)).toBe(FINISHED);
    expect(p.calls.renames.every(([, to]) => to === RECORD)).toBe(true);
  });

  test("a notify that throws leaves the names pending", async () => {
    const p = finishedMac({ extra: { [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
    await expect(runToolNotices(p, "acme", () => { throw new Error("no socket"); })).rejects.toThrow("no socket");
    expect(readToolNotices(p)).toEqual(rec({ pending: ["doppler"] }));
  });

  test("a record that will not write sends nothing", async () => {
    const p = finishedMac({ extra: { [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
    p.rename = () => { throw new Error("disk full"); };
    const { sent, notify } = collector();
    await expect(runToolNotices(p, "acme", notify)).rejects.toThrow("disk full");
    expect(sent).toEqual([]);
  });
});

describe("createToolNoticePullHook", () => {
  function fakeLog() {
    const calls: { level: string; args: unknown[] }[] = [];
    const mk = (level: string) => (...args: unknown[]) => { calls.push({ level, args }); };
    return { calls, debug: mk("debug"), info: mk("info"), warn: mk("warn") };
  }

  test("sends through the member's setup_update setting with the notice's id", async () => {
    const p = finishedMac({ extra: { [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
    const sends: unknown[][] = [];
    const hook = createToolNoticePullHook({ log: fakeLog(), probes: p, send: (...args) => { sends.push(args); } });
    await hook("acme");
    expect(sends).toEqual([["setup_update", "Your team needs Doppler", "Open setup to install it", undefined, undefined, "setup_update:tools:doppler"]]);
  });

  test("a failure logs and never breaks the pull", async () => {
    const p = finishedMac({ extra: { [RECORD]: JSON.stringify(rec({ pending: ["doppler"] })) } });
    const log = fakeLog();
    const hook = createToolNoticePullHook({ log, probes: p, send: () => { throw new Error("no socket"); } });
    await expect(hook("acme")).resolves.toBeUndefined();
    expect(log.calls.some((c) => c.level === "warn")).toBe(true);
    expect(readToolNotices(p)).toEqual(rec({ pending: ["doppler"] }));
  });
});
