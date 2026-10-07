import { afterEach, describe, expect, test } from "bun:test";
import type { ApplyContext } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { convergeOrgFolder, DAEMON_SLOW_REMEDY, DAEMON_STALE_REMEDY, ORG_FOLDER_REMEDY, orgFolderSeams, orgFolderStep } from "../steps/org-folder.ts";
import { fakeProbes as baseFakeProbes, ok, type ExecScript } from "./fakes.ts";

const HOME = "/h";
const MS = `${HOME}/.mattstack`;
const ORGS = `${MS}/orgs`;
const TEAMS = `${MS}/teams`;
const RT = `${MS}/rt`;
/** Details spell home as ~. */
const T = (path: string) => `~${path.slice(HOME.length)}`;
const marker = (org: string, role: "org" | "team" = "org") => JSON.stringify({ role, org });
const gitConfig = (url = "https://gitlab.example.com/acme/org.git") => `[remote "origin"]\n\turl = ${url}\n`;

/** A clone fixture: its files, and the directory keys the fake needs to answer `exists(dir)`. */
function clone(root: string, folder: string, org: string, opts: { url?: string; role?: "org" | "team"; rebasing?: boolean } = {}) {
  const dir = `${root}/${folder}`;
  return {
    files: {
      [`${dir}/mattstack/mattstack.jsonc`]: marker(org, opts.role),
      [`${dir}/.git/config`]: gitConfig(opts.url),
      ...(opts.rebasing ? { [`${dir}/.git/rebase-merge/head-name`]: "refs/heads/main" } : {}),
    },
    dirs: {
      [dir]: [".git", "mattstack"],
      [`${dir}/.git`]: ["config", ...(opts.rebasing ? ["rebase-merge"] : [])],
      ...(opts.rebasing ? { [`${dir}/.git/rebase-merge`]: ["head-name"] } : {}),
    },
  };
}

type Fixture = ReturnType<typeof clone>;
function merge(...fixtures: Fixture[]): Fixture {
  return { files: Object.assign({}, ...fixtures.map((f) => f.files)), dirs: Object.assign({}, ...fixtures.map((f) => f.dirs)) };
}

function fakeProbes(opts: { roots?: Partial<Record<"orgs" | "teams", string[]>>; fixture?: Fixture; files?: Record<string, string>; dirs?: Record<string, string[]>; dirty?: string[]; gitBroken?: string[]; daemon?: Probes["daemon"]; exec?: ExecScript } = {}) {
  return baseFakeProbes({
    home: HOME,
    files: { ...(opts.fixture?.files ?? {}), ...(opts.files ?? {}) },
    dirs: {
      [MS]: ["orgs", "teams", "rt"],
      [ORGS]: opts.roots?.orgs ?? [],
      [TEAMS]: opts.roots?.teams ?? [],
      [RT]: ["teams", "invites"],
      [`${RT}/teams`]: [],
      [`${RT}/invites`]: [],
      ...(opts.fixture?.dirs ?? {}),
      ...(opts.dirs ?? {}),
    },
    daemon: opts.daemon,
    exec: (argv, o) => {
      if (argv[0] === "git" && argv[3] === "status") {
        if (opts.gitBroken?.includes(argv[2]!)) return { code: 128, stdout: "", stderr: "fatal: detected dubious ownership" };
        return ok(opts.dirty?.includes(argv[2]!) ? " M mattstack/org/settings.org.jsonc\n" : "");
      }
      return opts.exec?.(argv, o) ?? ok("");
    },
  });
}

function makeCtx(p: Probes, overrides: Partial<ApplyContext> = {}): { ctx: ApplyContext; logs: string[] } {
  const logs: string[] = [];
  const ctx = { p, emit: () => {}, log: (_id: string, line: string) => { logs.push(line); }, intent: null, team: { slug: "", name: "", mode: "none" }, snapshot: null, reqs: [], nonInteractive: true, teamOfOne: false, appPath: null, ci: false, secrets: {} as never, teamSecrets: () => ({}) as never, relay: {} as never, secretPresence: { has: async () => null }, redact: () => {}, need: async () => "no-app", ...overrides } as ApplyContext;
  return { ctx, logs };
}

const origSeams = { ...orgFolderSeams };
afterEach(() => Object.assign(orgFolderSeams, origSeams));

function seams(opts: { locate?: (newPath: string) => Promise<{ ok: boolean; error?: string }>; marketplace?: typeof orgFolderSeams.marketplace } = {}) {
  const located: { newPath: string; repo?: string }[] = [];
  const marketplaces: { dir: string; stalePaths: string[] }[] = [];
  orgFolderSeams.identity = async (dir) => `gitlab.example.com/acme/org@${dir}`;
  orgFolderSeams.locate = (async (req: { newPath: string; repo?: string }) => {
    located.push(req);
    const r = await (opts.locate ?? (async () => ({ ok: true })))(req.newPath);
    return r.ok ? { via: "local", ok: true, dryRun: false, result: {} as never } : { via: "local", ok: false, error: r.error ?? "locate failed" };
  }) as typeof orgFolderSeams.locate;
  orgFolderSeams.marketplace = opts.marketplace ?? (async (_ctx, c) => { marketplaces.push(c); return { state: "done", detail: "acme already points at the clone" }; });
  return { located, marketplaces };
}

const legacy = (folder = "acme", org = "acme", opts: Parameters<typeof clone>[3] = {}) => clone(TEAMS, folder, org, opts);
const placed = (folder = "acme", org = "acme", opts: Parameters<typeof clone>[3] = {}) => clone(ORGS, folder, org, opts);

describe("org.folder: the step", () => {
  test("is update-safe, applies always and is rt-kind", () => {
    expect(orgFolderStep).toMatchObject({ id: "org.folder", kind: "rt", updateSafe: true });
    expect(orgFolderStep.applies({} as ApplyContext)).toBe(true);
  });

  test("skipped with no org and names a stray folder", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["notes"] }, dirs: { [`${TEAMS}/notes`]: ["readme.md"] }, files: { [`${TEAMS}/notes/readme.md`]: "x" } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("skipped");
    expect(out.detail).toContain("No org on this Mac");
    expect(out.detail).toContain(`not an org clone, left alone: ${T(`${TEAMS}/notes`)}`);
    expect(out.detail).not.toContain(HOME + "/");
  });

  test("a clean move from teams/ without a daemon: records, folder, index scoped to the clone's identity, marketplace", async () => {
    const s = seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), files: { [`${RT}/teams/acme.json`]: '{"forgeUsername":"dev1"}' } });
    let reloaded = 0;
    const out = await convergeOrgFolder(makeCtx(p, { reloadTeam: () => { reloaded += 1; } }).ctx);
    expect(out).toMatchObject({ state: "done" });
    expect(out.detail).toContain(`Moved acme to ~/.mattstack/orgs/acme`);
    expect(p.calls.renames).toContainEqual([`${TEAMS}/acme`, `${ORGS}/acme`]);
    expect(s.located).toEqual([{ newPath: `${ORGS}/acme`, repo: `gitlab.example.com/acme/org@${ORGS}/acme` }]);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [`${TEAMS}/acme`] }]);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(true);
    expect(reloaded).toBe(1);
  });

  test("a rename inside orgs/ copies the record to the new name and removes the old one", async () => {
    seams();
    const p = fakeProbes({ roots: { orgs: ["widgets"] }, fixture: placed("widgets", "acme"), files: { [`${RT}/teams/widgets.json`]: '{"forgeUsername":"dev1"}', [`${RT}/invites/widgets.json`]: "{}" } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(p.calls.renames).toContainEqual([`${ORGS}/widgets`, `${ORGS}/acme`]);
    expect(JSON.parse(p.readFile(`${RT}/teams/acme.json`)!)).toMatchObject({ forgeUsername: "dev1" });
    expect(p.readFile(`${RT}/invites/acme.json`)).toBe("{}");
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(p.exists(`${RT}/invites/widgets.json`)).toBe(false);
  });

  test("a member's clone still on the one-team layout moves the same way", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy("acme", "acme", { role: "team" }) });
    expect((await convergeOrgFolder(makeCtx(p).ctx)).state).toBe("done");
    expect(p.calls.renames).toContainEqual([`${TEAMS}/acme`, `${ORGS}/acme`]);
  });

  test("every piece already matching is done with no work", async () => {
    const s = seams({ locate: async () => ({ ok: false, error: "nothing-lost: the row already carries this path" }) });
    const p = fakeProbes({ roots: { orgs: ["acme"] }, fixture: placed() });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(out.detail).toContain("acme already in place");
    expect(p.calls.renames).toEqual([]);
    expect(s.located.map((l) => l.newPath)).toEqual([`${ORGS}/acme`]);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [] }]);
  });

  test("a folder in place with a stale index row runs only the index piece and is done when it relocates", async () => {
    const s = seams();
    const p = fakeProbes({ roots: { orgs: ["acme"] }, fixture: placed() });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(out.detail).toContain("acme already in place");
    expect(p.calls.renames).toEqual([]);
    expect(s.located.map((l) => l.newPath)).toEqual([`${ORGS}/acme`]);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [] }]);
  });

  test("a folder in place with a stale index row runs only the index piece, and an index failure is failed", async () => {
    seams({ locate: async () => ({ ok: false, error: "identity-mismatch: another repo" }) });
    const p = fakeProbes({ roots: { orgs: ["acme"] }, fixture: placed() });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain("identity-mismatch");
    expect(p.calls.renames).toEqual([]);
  });

  test("a leftover old-name record is removed and named; a record with no movedFrom is left alone", async () => {
    seams();
    const p = fakeProbes({
      roots: { orgs: ["acme"] },
      fixture: placed(),
      dirs: { [`${RT}/teams`]: ["acme.json", "widgets.json", "gadgets.json"] },
      files: { [`${RT}/teams/acme.json`]: JSON.stringify({ forgeUsername: "dev1", movedFrom: "widgets" }), [`${RT}/teams/widgets.json`]: "{}", [`${RT}/teams/gadgets.json`]: "{}" },
    });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(out.detail).toContain(`removed ${T(`${RT}/teams/widgets.json`)}`);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(p.exists(`${RT}/teams/gadgets.json`)).toBe(true);
    expect(JSON.parse(p.readFile(`${RT}/teams/acme.json`)!).movedFrom).toBeUndefined();
  });

  test("an unmarked or malformed folder is skipped and named, each in its own words", async () => {
    seams();
    const p = fakeProbes({
      roots: { orgs: ["acme", "broken", "notes"] },
      fixture: placed(),
      dirs: { [`${ORGS}/broken`]: ["mattstack", ".git"], [`${ORGS}/notes`]: ["readme.md"] },
      files: { [`${ORGS}/broken/mattstack/mattstack.jsonc`]: "{ nope", [`${ORGS}/broken/.git/config`]: gitConfig(), [`${ORGS}/notes/readme.md`]: "x" },
    });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(out.detail).toContain(`not an org clone, left alone: ${T(`${ORGS}/notes`)}`);
    expect(out.detail).toContain(`${T(`${ORGS}/broken`)} has a marker rt could not read (it is not valid JSON), left alone`);
    expect(out.detail).not.toContain(`left alone: ${T(`${ORGS}/broken`)}`);
  });

  test("a dirty clone is refused with the commit-or-discard wording and nothing moves", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirty: [`${TEAMS}/acme`] });
    const out = await convergeOrgFolder(makeCtx(p, { update: true }).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain(`${T(`${TEAMS}/acme`)} has uncommitted changes`);
    expect(out.detail).toContain("uncommitted changes");
    expect(out.detail).toContain("Commit them if they are yours");
    expect(p.calls.renames).toEqual([]);
  });

  test("a git status that cannot be read is refused: unknown is dirty", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), gitBroken: [`${TEAMS}/acme`] });
    const out = await convergeOrgFolder(makeCtx(p, { update: true }).ctx);
    expect(out.state).toBe("failed");
    expect(out.detail).toContain("dubious ownership");
    expect(p.calls.renames).toEqual([]);
  });

  test("a clone mid-rebase is refused", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy("acme", "acme", { rebasing: true }) });
    const out = await convergeOrgFolder(makeCtx(p, { update: true }).ctx);
    expect(out.state).toBe("failed");
    expect(out.detail).toContain("rebase");
    expect(p.calls.renames).toEqual([]);
  });

  test("a target that exists with a different origin is refused; the same origin in both roots too", async () => {
    seams();
    const other = fakeProbes({ roots: { teams: ["acme"], orgs: ["acme"] }, fixture: merge(legacy(), placed("acme", "acme", { url: "https://gitlab.example.com/widgets/org.git" })) });
    const out1 = await convergeOrgFolder(makeCtx(other, { update: true }).ctx);
    expect(out1.state).toBe("failed");
    expect(out1.detail).toContain("different origin");
    expect(other.calls.renames).toEqual([]);
    const same = fakeProbes({ roots: { teams: ["acme"], orgs: ["acme"] }, fixture: merge(legacy(), placed()) });
    const out2 = await convergeOrgFolder(makeCtx(same, { update: true }).ctx);
    expect(out2.state).toBe("failed");
    expect(out2.detail).toContain("Move the old copy aside");
    expect(same.calls.renames).toEqual([]);
  });

  test("a second clone with the same org is refused", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme", "acme-copy"] }, fixture: merge(legacy(), legacy("acme-copy", "acme")) });
    const out = await convergeOrgFolder(makeCtx(p, { update: true }).ctx);
    expect(out.state).toBe("failed");
    expect(out.detail).toContain("acme-copy");
    expect(out.detail).toContain("second clone");
    expect(p.calls.renames.length).toBe(1);
  });

  test("a second clone is refused as a second clone even when the first clone's move failed", async () => {
    seams();
    const sent: unknown[] = [];
    const p = fakeProbes({
      roots: { teams: ["acme", "acme-copy"] },
      fixture: merge(legacy(), legacy("acme-copy", "acme")),
      dirs: { [RT]: ["teams", "invites", "rt.sock"] },
      files: { [`${RT}/rt.sock`]: "" },
      daemon: async (_cmd, payload) => {
        sent.push(payload);
        return { ok: false, error: "move-failed: folder: busy", failure: { code: "move-failed", message: "folder: busy" } } as never;
      },
    });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("failed");
    expect(out.detail).toContain("folder: busy");
    expect(out.detail).toContain(`${T(`${TEAMS}/acme-copy`)} is a second clone`);
    expect(sent).toEqual([{ from: `${TEAMS}/acme`, to: `${ORGS}/acme` }]);
    expect(p.calls.renames).toEqual([]);
  });

  test("with a daemon present the move goes through org:move and the step renames nothing itself", async () => {
    const s = seams();
    const sent: { cmd: string; payload: unknown }[] = [];
    const p = fakeProbes({
      roots: { teams: ["acme"] },
      fixture: legacy(),
      dirs: { [RT]: ["teams", "invites", "rt.sock"] },
      files: { [`${RT}/rt.sock`]: "" },
      daemon: async (cmd, payload) => {
        sent.push({ cmd, payload });
        return { ok: true, data: { ok: true, from: `${TEAMS}/acme`, to: `${ORGS}/acme`, records: { teams: "none", invites: "none" }, folderMoved: true, index: "already", removed: [] } };
      },
    });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(sent).toEqual([{ cmd: "org:move", payload: { from: `${TEAMS}/acme`, to: `${ORGS}/acme` } }]);
    expect(p.calls.renames).toEqual([]);
    expect(s.located).toEqual([]);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [`${TEAMS}/acme`] }]);
  });

  test("a live daemon pid with no socket file still sends the move through org:move", async () => {
    seams();
    const sent: string[] = [];
    const p = fakeProbes({
      roots: { teams: ["acme"] },
      fixture: legacy(),
      dirs: { [RT]: ["teams", "invites", "rt.pid"] },
      files: { [`${RT}/rt.pid`]: `${process.pid}\n` },
      daemon: async (cmd) => {
        sent.push(cmd);
        return { ok: true, data: { ok: true, from: `${TEAMS}/acme`, to: `${ORGS}/acme`, records: { teams: "none", invites: "none" }, folderMoved: true, index: "already", removed: [] } };
      },
    });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(sent).toEqual(["org:move"]);
    expect(p.calls.renames).toEqual([]);
  });

  test("a daemon that does not know org:move fails with the restart remedy, and so does one that does not answer", async () => {
    seams();
    const withSock = (daemon: Probes["daemon"]) => fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirs: { [RT]: ["teams", "invites", "rt.sock"] }, files: { [`${RT}/rt.sock`]: "" }, daemon });
    const stale = withSock(async () => ({ ok: false, code: "unknown-command", version: "2.0.0", error: 'daemon at version 2.0.0 does not know "org:move"' }) as never);
    expect(await convergeOrgFolder(makeCtx(stale).ctx)).toMatchObject({ state: "failed", remedy: DAEMON_STALE_REMEDY });
    expect(stale.calls.renames).toEqual([]);
  });

  test("a daemon that does not answer in time and left the folder in place fails with the wait-then-force remedy", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirs: { [RT]: ["teams", "invites", "rt.sock"] }, files: { [`${RT}/rt.sock`]: "" }, daemon: async () => null });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: DAEMON_SLOW_REMEDY });
    expect(out.detail).toContain(`The rt daemon did not answer within two minutes and may still be moving ${T(`${TEAMS}/acme`)}`);
    expect(p.calls.renames).toEqual([]);
  });

  test("a daemon that does not answer in time but moved the folder anyway is treated as moved", async () => {
    const s = seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirs: { [RT]: ["teams", "invites", "rt.sock"], [ORGS]: [] }, files: { [`${RT}/rt.sock`]: "" } });
    p.daemon = async () => {
      p.rename(`${TEAMS}/acme`, `${ORGS}/acme`);
      return null;
    };
    let reloaded = 0;
    const out = await convergeOrgFolder(makeCtx(p, { reloadTeam: () => { reloaded += 1; } }).ctx);
    expect(out.state).toBe("done");
    expect(out.detail).toContain("Moved acme to ~/.mattstack/orgs/acme after the rt daemon stopped answering");
    expect(out.detail).toContain("the next rt setup update checks its records and repo index row");
    expect(s.located).toEqual([]);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [`${TEAMS}/acme`] }]);
    expect(reloaded).toBe(1);
  });

  test("a daemon refusal is failed with the daemon's message", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirs: { [RT]: ["teams", "invites", "rt.sock"] }, files: { [`${RT}/rt.sock`]: "" }, daemon: async () => ({ ok: false, error: "move-failed: index: identity-mismatch: another repo", failure: { code: "move-failed", message: "index: identity-mismatch: another repo" } }) as never });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain("identity-mismatch");
  });

  test("a refusal in a full apply is partial with the same detail and remedy, so Install goes on", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirty: [`${TEAMS}/acme`] });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "partial", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain(`${T(`${TEAMS}/acme`)} has uncommitted changes`);
    expect(p.calls.renames).toEqual([]);
  });

  test("a move failure stays failed in a full apply too", async () => {
    seams();
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirs: { [RT]: ["teams", "invites", "rt.sock"] }, files: { [`${RT}/rt.sock`]: "" }, daemon: async () => ({ ok: false, error: "move-failed: folder: busy", failure: { code: "move-failed", message: "folder: busy" } }) as never });
    expect(await convergeOrgFolder(makeCtx(p).ctx)).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
  });

  for (const [stage, words] of [["index", "its repo index row was not updated"], ["cleanup", "its old records were not removed"]] as const) {
    test(`a daemon move that failed at ${stage} after the folder moved says the folder moved`, async () => {
      seams();
      const data = { ok: false, from: `${TEAMS}/acme`, to: `${ORGS}/acme`, records: { teams: "none", invites: "none" }, folderMoved: true, index: stage === "index" ? "failed" : "moved", removed: [], stage, error: "boom" };
      const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirs: { [RT]: ["teams", "invites", "rt.sock"] }, files: { [`${RT}/rt.sock`]: "" }, daemon: async () => ({ ok: false, error: `move-failed: ${stage}: boom`, failure: { code: "move-failed", message: `${stage}: boom` }, data }) as never });
      const out = await convergeOrgFolder(makeCtx(p).ctx);
      expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
      expect(out.detail).toContain(`${T(`${TEAMS}/acme`)} moved to ${T(`${ORGS}/acme`)} but ${words}: boom`);
      expect(out.detail).not.toContain("was not moved");
    });
  }

  test("a local move that failed at the index after the folder moved says the folder moved", async () => {
    seams({ locate: async () => ({ ok: false, error: "identity-mismatch: another repo" }) });
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy() });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain(`${T(`${TEAMS}/acme`)} moved to ${T(`${ORGS}/acme`)} but its repo index row was not updated: identity-mismatch`);
  });

  test("a move that failed before the folder moved still says it was not moved", async () => {
    seams();
    const data = { ok: false, from: `${TEAMS}/acme`, to: `${ORGS}/acme`, records: { teams: "none", invites: "none" }, folderMoved: false, index: "failed", removed: [], stage: "folder", error: "EBUSY" };
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy(), dirs: { [RT]: ["teams", "invites", "rt.sock"] }, files: { [`${RT}/rt.sock`]: "" }, daemon: async () => ({ ok: false, error: "move-failed: folder: EBUSY", failure: { code: "move-failed", message: "folder: EBUSY" }, data }) as never });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.detail).toContain(`${T(`${TEAMS}/acme`)} was not moved (folder): EBUSY`);
  });

  test("the marketplace piece failing ends partial with the commands as the remedy", async () => {
    seams({ marketplace: async () => ({ state: "partial", detail: "claude is missing", commands: ["claude plugin marketplace remove acme", `claude plugin marketplace add ${ORGS}/acme`] }) });
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy() });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "partial", remedy: `Run claude plugin marketplace remove acme, then claude plugin marketplace add ${ORGS}/acme` });
    expect(p.calls.renames).toContainEqual([`${TEAMS}/acme`, `${ORGS}/acme`]);
  });

  test("a marketplace partial with no commands takes the fix-then-rerun remedy and names its cause", async () => {
    seams({ marketplace: async () => ({ state: "partial", detail: "the plugin list could not be read" }) });
    const p = fakeProbes({ roots: { teams: ["acme"] }, fixture: legacy() });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "partial", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain("the plugin list could not be read");
  });

  test("mixed partials run the handed-back commands, then the update again", async () => {
    seams({
      marketplace: async (_ctx, c) =>
        c.dir === `${ORGS}/acme`
          ? { state: "partial", detail: "two plugins were handed back", commands: ["claude plugin install tools@acme --scope project"] }
          : { state: "partial", detail: "the plugin list could not be read" },
    });
    const p = fakeProbes({ roots: { orgs: ["acme"], teams: ["widgets"] }, fixture: merge(placed(), legacy("widgets", "widgets", { url: "https://gitlab.example.com/widgets/org.git" })) });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "partial", remedy: "Run claude plugin install tools@acme --scope project, then rt setup update --force" });
    expect(out.detail).toContain("the plugin list could not be read");
  });

  test("a refused clone still carries another clone's handed-back commands in the failed detail", async () => {
    seams({
      marketplace: async () => ({ state: "partial", detail: "two plugins were handed back", commands: ["claude plugin install tools@acme --scope project"] }),
    });
    const p = fakeProbes({ roots: { orgs: ["acme"], teams: ["widgets"] }, fixture: merge(placed(), legacy("widgets", "widgets")), dirty: [`${TEAMS}/widgets`] });
    const out = await convergeOrgFolder(makeCtx(p, { update: true }).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain("uncommitted changes");
    expect(out.detail).toContain("acme: two plugins were handed back. Run: claude plugin install tools@acme --scope project");
  });

  test("each marketplace outcome is logged under org.folder, with its commands on a partial", async () => {
    seams({ marketplace: async () => ({ state: "partial", detail: "two plugins were handed back", commands: ["claude plugin install tools@acme --scope project"] }) });
    const p = fakeProbes({ roots: { orgs: ["acme"] }, fixture: placed() });
    const ids: string[] = [];
    const { ctx, logs } = makeCtx(p);
    const log = ctx.log;
    ctx.log = (id, line) => { ids.push(id); log(id, line); };
    await convergeOrgFolder(ctx);
    expect(ids).toEqual(["org.folder"]);
    expect(logs).toEqual(["marketplace partial: acme: two plugins were handed back. Run: claude plugin install tools@acme --scope project"]);
  });

  test("a rerun after an interruption between the move and the index piece finishes the rest", async () => {
    const s = seams();
    const p = fakeProbes({ roots: { orgs: ["acme"] }, fixture: placed(), dirs: { [`${RT}/teams`]: ["widgets.json", "acme.json"] }, files: { [`${RT}/teams/widgets.json`]: "{}", [`${RT}/teams/acme.json`]: JSON.stringify({ movedFrom: "widgets" }) } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(s.located.map((l) => l.newPath)).toEqual([`${ORGS}/acme`]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [] }]);
  });
});
