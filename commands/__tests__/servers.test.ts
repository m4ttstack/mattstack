import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { EnrichedBranch, MRInfo } from "../../lib/enrich.ts";
import type { RoleConfig } from "../../lib/endpoint/config.ts";
import { groupServers, type ServerGroup } from "../../lib/endpoint/server-groups.ts";
import type { RunningServer, ServerRules, ServerSnapshot } from "../../lib/endpoint/servers.ts";
import type { FreshServers, StopOutcome } from "../../lib/endpoint/servers-system.ts";
import { writeInterceptRules } from "../../lib/endpoint/shim.ts";
import { saveClaims } from "../../lib/endpoint/store.ts";
import { UserActionableError } from "../../lib/errors.ts";
import type { LinearTicket } from "../../lib/linear.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { __test__ as pickTest, type PickHandle } from "../../lib/ui/pick.ts";
import { installFakePick } from "../../lib/ui/pick-fake.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { branchesOf, pickView, realServersDeps, serverBlocks, serverHints, serversCommand, type Lookup, type ServersDeps } from "../servers.ts";

const IDENTITY = "remote:example.com%2Facme%2Fsample-app";
const TREE = "/trees/calm-marble";
const LSTART = "Tue Nov 24 14:45:47 2026";

function server(over: Partial<RunningServer> = {}): RunningServer {
  return {
    role: "api", port: 10400, listening: true, worktree: { path: TREE, name: "calm-marble" }, branch: "web-214-login-rate-limit",
    pid: 10, pids: [10, 11], startTime: LSTART, etime: "22:10:03", leftBehind: false, agent: null, inside: null, removed: false, ...over,
  };
}

function ticket(identifier: string, title: string, stateName: string): LinearTicket {
  return { id: identifier, identifier, title, description: null, url: `https://linear.app/x/issue/${identifier}`, stateName, stateColor: null, branchName: null };
}

function mr(iid: number, over: Partial<MRInfo> = {}): MRInfo {
  return {
    provider: "gitlab", iid, title: "MR", webUrl: null, state: "opened", isDraft: false,
    author: { id: "u1", name: "a", avatarUrl: null }, assignees: [], createdAt: null, sourceBranch: "b", targetBranch: "main",
    behindTarget: null, diff: null, pipeline: null, reviews: [], sha: "abc123", ...over,
  } as unknown as MRInfo;
}

function group(over: Partial<ServerGroup>): ServerGroup {
  return { key: "k", ticketId: null, ticket: null, title: "main", detached: false, mr: null, servers: [], ...over };
}

const alone = (s: RunningServer) => ({ server: s, branch: null, mr: null });

const GROUPS: ServerGroup[] = [
  group({
    key: "WEB-240", ticketId: "WEB-240", ticket: ticket("WEB-240", "Split the settings page", "In Progress"), title: "Split the settings page",
    servers: [{
      server: server({ port: 10402, etime: "3-02:11:00" }), branch: "web-240-shell",
      mr: mr(420, { pipeline: { status: "failed" } as MRInfo["pipeline"] }),
    }],
  }),
  group({
    key: "WEB-198", ticketId: "WEB-198", ticket: ticket("WEB-198", "Fix rounding in order totals", "Done"), title: "Fix rounding in order totals",
    mr: mr(398, { state: "merged" }),
    servers: [alone(server({ listening: false, etime: "22:00:03" })), alone(server({ role: "web", port: 4003, etime: "22:00:03" }))],
  }),
];

describe("serverBlocks", () => {
  test("the list is a tree per ticket: id, state, title and MR, then each server", () => {
    expect(renderPlain(serverBlocks("sample-app", GROUPS))).toBe(
      "sample-app\n" +
      "WEB-240  [In Progress]  Split the settings page\n" +
      "  - api  :10402  3d  web-240-shell  !420 open  checks failed\n" +
      "WEB-198  [Done]  Fix rounding in order totals  !398 merged\n" +
      "  - api  :10400  22h  not listening\n" +
      "  - web  :4003   22h\n",
    );
  });

  test("a server with no port says no port, and a detached group says detached", () => {
    const detached = group({
      key: "/trees/slow-comet", title: "slow-comet", detached: true,
      servers: [alone(server({ port: null, listening: false, agent: "claude", etime: "41:10" }))],
    });
    expect(renderPlain(serverBlocks("sample-app", [detached]))).toBe("sample-app\nslow-comet  detached\n  - api  no port  41m  Claude session, not listening\n");
  });

  test("a ticket id with no title yet is not printed twice", () => {
    const bare = group({ key: "WEB-240", ticketId: "WEB-240", title: "WEB-240", servers: [alone(server())] });
    expect(renderPlain(serverBlocks("sample-app", [bare]))).toBe("sample-app\nWEB-240\n  - api  :10400  22h10m\n");
  });

  test("no servers is one off line", () => {
    expect(renderPlain(serverBlocks("sample-app", []))).toBe("[off] No dev servers are running here  sample-app\n");
  });
});

test("the hints name the agent, then what is odd about the server", () => {
  expect(serverHints(server())).toEqual([]);
  expect(serverHints(server({ agent: "codex", leftBehind: true }))).toEqual(["codex session", "left behind"]);
  expect(serverHints(server({ agent: "claude", removed: true }))).toEqual(["Claude session", "worktree removed"]);
  expect(serverHints(server({ inside: "claude", listening: false }))).toEqual(["Claude session inside", "not listening"]);
  expect(serverHints(server({ inside: "shell" }))).toEqual(["shell inside"]);
});

test("a removed worktree is never the first branch looked up, since git is run in the first one's folder", () => {
  const gone = server({ worktree: { path: "/trees/.trash/old-1", name: "old-1" }, branch: "web-198-order-totals", removed: true });
  expect(branchesOf([gone, server()]).map((b) => b.path)).toEqual([TREE, "/trees/.trash/old-1"]);
});

test("one lookup per worktree, and none for a detached one", () => {
  expect(branchesOf([
    server({ role: "api" }),
    server({ role: "web" }),
    server({ worktree: { path: "/trees/slow-comet", name: "slow-comet" }, branch: null }),
  ])).toEqual([{ path: TREE, branch: "web-214-login-rate-limit" }]);
});

const role = (over: Partial<RoleConfig>): RoleConfig => ({ pool: [], needs: [], preserveEnv: [], env: {}, ...over });

const RULES: ServerRules = {
  rules: [{
    command: "doppler", repo: IDENTITY, repoRemote: null,
    matches: [
      { cwdGlob: "apps/api{,/**}", role: "api" },
      { cwdGlob: "apps/web{,/**}", role: "web" },
    ],
  }],
  roles: { api: role({ pool: [10401] }), web: role({ pool: [4001] }) },
  claims: [
    { worktree: TREE, role: "api", port: 10401, ts: "2026-11-24T20:45:47.000Z" },
    { worktree: TREE, role: "web", port: 4001, ts: "2026-11-24T20:45:47.000Z" },
  ],
};

const proc = (pid: number, ppid: number, args: string) => ({ pid, ppid, etime: "18:00:00", startTime: LSTART, command: args.split(" ")[0]!, args });

const SNAPSHOT: ServerSnapshot = {
  procs: [
    proc(10, 1, "rt intercept run doppler -- run -- parcel"),
    proc(11, 10, "parcel"),
    proc(20, 1, "rt intercept run doppler -- run -- node src/server"),
    proc(21, 20, "node src/server"),
    proc(77, 1, "-zsh"),
    proc(process.pid, 77, "rt servers"),
  ],
  cwds: new Map([[10, `${TREE}/apps/web`], [11, `${TREE}/apps/web`], [20, `${TREE}/apps/api`], [21, `${TREE}/apps/api`]]),
  listeners: new Map([[11, [4001]], [21, [10401]]]),
  worktrees: [{ path: "/code/sample-app", branch: "main" }, { path: TREE, branch: "web-214-login-rate-limit" }],
};

const ENRICHED = new Map<string, EnrichedBranch>([[TREE, {
  path: TREE, dirName: "calm-marble", branch: "web-214-login-rate-limit", linearId: "WEB-214",
  ticket: ticket("WEB-214", "Add a login rate limit", "In Review"), mr: null,
}]]);

const CTX = {
  identity: { repoName: "sample-app", identity: IDENTITY, repoRoot: "/code/sample-app", dataDir: "/data", remoteUrl: "git@example.com:acme/sample-app.git", baseUrl: "" },
};

interface Over {
  rules?: ServerRules;
  snapshots?: Array<ServerSnapshot | null>;
  enrich?: () => Promise<Map<string, EnrichedBranch>>;
  pick?: number[] | null;
  canAsk?: boolean;
  /** The wait ends before the lookup answers; otherwise it ends only when it is cancelled. */
  deadlinePasses?: boolean;
  outcomes?: (picked: RunningServer[]) => StopOutcome[];
}

function harness(over: Over = {}) {
  const snapshots = [...(over.snapshots ?? [SNAPSHOT, SNAPSHOT])];
  const calls = {
    snapshot: 0, enrich: 0, pick: 0, stop: 0, slept: [] as number[], spare: new Set<number>(), picked: [] as RunningServer[],
    fresh: null as FreshServers | null, exits: [] as number[], cancelled: false, landedAtPick: undefined as Lookup["landed"] | undefined,
  };
  const deps: ServersDeps = {
    rules: () => over.rules ?? RULES,
    snapshot: async () => {
      calls.snapshot++;
      return snapshots.shift() ?? null;
    },
    enrich: () => {
      calls.enrich++;
      return over.enrich ? over.enrich() : Promise.resolve(ENRICHED);
    },
    pick: async (_label, _servers, lookup) => {
      calls.pick++;
      calls.landedAtPick = lookup.landed;
      return over.pick ?? null;
    },
    stop: async (picked, fresh, spare) => {
      calls.stop++;
      calls.picked = picked;
      calls.fresh = fresh;
      calls.spare = spare;
      return over.outcomes ? over.outcomes(picked) : picked.map((s) => ({ server: s, result: "stopped" as const }));
    },
    canAsk: () => over.canAsk ?? false,
    sleep: (ms, cancel) => {
      calls.slept.push(ms);
      if (over.deadlinePasses) return Promise.resolve();
      // Settles in the same tick as the cancel, so cancelling must never be what decides the race.
      return {
        then: (done: () => unknown) => new Promise((resolve) => cancel.addEventListener("abort", () => {
          calls.cancelled = true;
          resolve(done());
        })),
      } as unknown as Promise<void>;
    },
    exit: (code) => { calls.exits.push(code); },
  };
  return { calls, run: (args: string[] = []) => serversCommand(args, CTX, deps) };
}

const NEVER = () => new Promise<Map<string, EnrichedBranch>>(() => {});

describe("serversCommand", () => {
  let io: CapturedOut;
  beforeEach(() => {
    io = captureOut();
    io.reset();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    process.exitCode = 0;
  });

  test("a repo with no intercept rules says that instead, and reads no processes", async () => {
    const { run, calls } = harness({ rules: { ...RULES, rules: [] } });
    await run();
    expect(io.stdout()).toBe("[off] rt does not intercept any commands here  sample-app\n");
    expect(calls.snapshot).toBe(0);
  });

  test("when it cannot ask it lists and never picks or stops", async () => {
    const { run, calls } = harness();
    await run();
    expect(io.stdout()).toBe(
      "sample-app\n" +
      "WEB-214  [In Review]  Add a login rate limit\n" +
      "  - api  :10401  18h\n" +
      "  - web  :4001   18h\n",
    );
    expect([calls.pick, calls.stop]).toEqual([0, 0]);
  });

  test("a lookup that answers in time is printed, its wait is cancelled and nothing forces an exit", async () => {
    const { run, calls } = harness();
    await run();
    expect(io.stdout()).toContain("[In Review]  Add a login rate limit");
    expect(calls.cancelled).toBe(true);
    expect(calls.exits).toEqual([]);
  });

  test("a lookup still running when the output is done is not waited on, and the exit code stands", async () => {
    const listed = harness({ enrich: NEVER, deadlinePasses: true });
    await listed.run();
    const slow = { enrich: NEVER, deadlinePasses: true, canAsk: true };
    const escaped = harness({ ...slow, pick: null });
    await escaped.run();
    const stopped = harness({ ...slow, pick: [10] });
    await stopped.run();
    const failed = harness({ ...slow, pick: [10], outcomes: ([s]) => [{ server: s!, result: "failed", why: "It did not stop." }] });
    await failed.run();
    expect([listed, escaped, stopped, failed].map((h) => h.calls.exits)).toEqual([[0], [0], [0], [1]]);
  });

  test("nothing running is one line, at a terminal too, and no picker opens", async () => {
    const empty = { ...SNAPSHOT, procs: SNAPSHOT.procs.slice(4) };
    const { run, calls } = harness({ snapshots: [{ ...empty, listeners: new Map() }], canAsk: true });
    await run();
    expect(io.stdout()).toBe("[off] No dev servers are running here  sample-app\n");
    expect([calls.pick, calls.enrich]).toEqual([0, 0]);
  });

  test("the list waits three seconds for ticket data, then prints without it", async () => {
    const { run, calls } = harness({ enrich: NEVER, deadlinePasses: true });
    await run();
    expect(calls.slept).toEqual([3_000]);
    expect(io.stdout()).toContain("WEB-214  web-214-login-rate-limit\n");
  });

  test("a failed ticket lookup still lists", async () => {
    const { run } = harness({ enrich: () => Promise.reject(new Error("offline")) });
    await run();
    expect(io.stdout()).toContain(":10401");
    expect(process.exitCode).toBeFalsy();
  });

  test("--json is frozen, with an empty stderr, and never picks or looks up tickets", async () => {
    const { run, calls } = harness({ canAsk: true, snapshots: [{ ...SNAPSHOT, procs: SNAPSHOT.procs.filter((p) => p.pid < 20), listeners: new Map([[11, [4001]]]) }] });
    await run(["--json"]);
    expect(io.stdout()).toBe(
      `{"ok":true,"repo":"${IDENTITY}","servers":[{"role":"web","port":4001,"listening":true,` +
      `"worktree":{"path":"/trees/calm-marble","name":"calm-marble"},"branch":"web-214-login-rate-limit","pid":10,"pids":[10,11],` +
      `"startedAt":"${new Date(LSTART).toISOString()}","leftBehind":false,"agent":null}]}\n`,
    );
    expect(io.stderr()).toBe("");
    expect([calls.pick, calls.enrich]).toEqual([0, 0]);
  });

  test("--json with no rules is an empty list", async () => {
    const { run } = harness({ rules: { ...RULES, rules: [] } });
    await run(["--json"]);
    expect(io.stdout()).toBe(`{"ok":true,"repo":"${IDENTITY}","servers":[]}\n`);
    expect(io.stderr()).toBe("");
  });

  test("a failed read is the typed failure, and nothing is listed, with --json or without", async () => {
    for (const args of [[], ["--json"]]) {
      const error = await harness({ snapshots: [null] }).run(args).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(UserActionableError);
      expect(error).toMatchObject({
        code: "servers-read-failed", message: "rt could not read what is running", why: "The process list did not answer.", next: "rt servers",
      });
    }
    expect([io.stdout(), io.stderr()]).toEqual(["", ""]);
  });

  test("the picker waits for ticket data and opens on it", async () => {
    let answer!: (data: Map<string, EnrichedBranch>) => void;
    const { run, calls } = harness({ canAsk: true, enrich: () => new Promise((resolve) => { answer = resolve; }), pick: null });
    const done = run();
    await Bun.sleep(5);
    expect(calls.pick).toBe(0);
    answer(ENRICHED);
    await done;
    expect(calls.landedAtPick).toBe(ENRICHED);
    expect(calls.cancelled).toBe(true);
  });

  test("a lookup slower than ten seconds opens the picker without it", async () => {
    const { run, calls } = harness({ canAsk: true, enrich: NEVER, deadlinePasses: true, pick: null });
    await run();
    expect(calls.slept).toEqual([10_000]);
    expect([calls.pick, calls.landedAtPick]).toEqual([1, null]);
  });

  test("picking re-reads, then stops the picked ones and names each by port and title", async () => {
    const { run, calls } = harness({
      canAsk: true, pick: [10, 20],
      outcomes: (picked) => picked.map((s) => ({ server: s, result: s.role === "web" ? "stopped" : "gone" })).reverse() as StopOutcome[],
    });
    await run();
    expect(calls.snapshot).toBe(2);
    expect(calls.picked.map((s) => s.pid)).toEqual([20, 10]);
    expect(io.stdout()).toBe("[ok] Stopped web  :4001, Add a login rate limit\n[skipped] api had already stopped  :10401, Add a login rate limit\n");
    expect(process.exitCode).toBeFalsy();
  });

  test("only the picked servers are stopped", async () => {
    const { run, calls } = harness({ canAsk: true, pick: [10] });
    await run();
    expect(calls.picked.map((s) => s.pid)).toEqual([10]);
  });

  test("a stopped server with no port is named by its title", async () => {
    const { run } = harness({ canAsk: true, pick: [10], rules: { ...RULES, claims: [] }, snapshots: [{ ...SNAPSHOT, listeners: new Map() }, SNAPSHOT] });
    await run();
    expect(io.stdout()).toBe("[ok] Stopped web  Add a login rate limit\n");
  });

  test("a stop while ticket data is still missing is named by its branch", async () => {
    const { run } = harness({ canAsk: true, pick: [10], enrich: NEVER, deadlinePasses: true });
    await run();
    expect(io.stdout()).toBe("[ok] Stopped web  :4001, web-214-login-rate-limit\n");
  });

  test("a refused tree is a refusal with its reason, not a failed stop", async () => {
    const { run } = harness({ canAsk: true, pick: [20], outcomes: ([s]) => [{ server: s!, result: "refused", why: "Claude is running inside it." }] });
    await run();
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("[refused] Left api running  :10401, Add a login rate limit\n  why: Claude is running inside it.\n");
    expect(process.exitCode).toBe(1);
  });

  test("a stop that failed is a failure with its reason", async () => {
    const { run } = harness({ canAsk: true, pick: [20], outcomes: ([s]) => [{ server: s!, result: "failed", why: "It did not stop." }] });
    await run();
    expect(io.stderr()).toBe("Could not stop api  :10401, Add a login rate limit\n  why: It did not stop.\n");
    expect(process.exitCode).toBe(1);
  });

  test("escaping the picker, or picking nothing, stops nothing", async () => {
    for (const pick of [null, []]) {
      io.clear();
      const { run, calls } = harness({ canAsk: true, pick });
      await run();
      expect(io.stdout()).toBe("[skipped] Nothing selected\n");
      expect([calls.stop, calls.snapshot]).toEqual([0, 1]);
    }
  });

  test("a re-read that fails after the pick stops nothing", async () => {
    const { run, calls } = harness({ canAsk: true, pick: [10], snapshots: [SNAPSHOT, null] });
    await expect(run()).rejects.toBeInstanceOf(UserActionableError);
    expect(calls.stop).toBe(0);
  });

  test("the stop compares against the re-read, and spares rt's ancestors as they are then", async () => {
    const later = "Wed Nov 25 09:00:00 2026";
    const reread: ServerSnapshot = {
      ...SNAPSHOT,
      procs: [
        ...SNAPSHOT.procs.filter((p) => p.pid >= 20 && p.pid !== process.pid && p.pid !== 77),
        { ...proc(10, 1, "rt intercept run doppler -- run -- parcel"), startTime: later },
        proc(88, 1, "-zsh"),
        proc(process.pid, 88, "rt servers"),
      ],
    };
    const { run, calls } = harness({ canAsk: true, pick: [10], snapshots: [SNAPSHOT, reread] });
    await run();
    expect(calls.picked.map((s) => [s.pid, s.startTime])).toEqual([[10, LSTART]]);
    expect(calls.fresh!.servers.map((s) => [s.pid, s.startTime])).toEqual([[20, LSTART], [10, later]]);
    expect(calls.fresh!.procs).toContainEqual(expect.objectContaining({ pid: 10, startTime: later }));
    expect(calls.spare).toEqual(new Set([process.pid, 88]));
  });
});

test("rows with the same role and port say which worktree, so no two picks read the same", () => {
  const twin = (pid: number, name: string, over: Partial<RunningServer> = {}) => server({ pid, port: null, listening: false, worktree: { path: `/trees/${name}`, name }, branch: name, ...over });
  const view = (servers: RunningServer[]) =>
    pickView(groupServers(servers, new Map())).rows.map((r) => r.left.slice(0, 2).map((s) => s.text).join("").replace(/ +/g, " ")).sort();
  expect(view([twin(10, "calm-marble"), twin(20, "old-pond"), server({ pid: 30, role: "web", port: 4001 })])).toEqual(["api no port calm-marble", "api no port old-pond", "web :4001"]);
  expect(view([twin(10, "calm-marble"), twin(20, "calm-marble")])).toEqual(["api no port calm-marble 10", "api no port calm-marble 20"]);
});

describe("realServersDeps.pick", () => {
  let fake: ReturnType<typeof installFakePick> | undefined;
  afterEach(() => {
    fake?.restore();
    fake = undefined;
  });
  const SERVERS = [server({ pid: 10, role: "web", port: 4001 }), server({ pid: 20, port: 10401 })];
  const CANCELLED = [{ kind: "result" as const, result: { action: "cancel", value: null, query: "" } }];
  const landed = (data: Map<string, EnrichedBranch>): Lookup => ({ answer: Promise.resolve(data), landed: data });
  const late = (data: Map<string, EnrichedBranch>): Lookup => ({ answer: Promise.resolve(data), landed: null });

  test("the filter is exact, so marking what it shows never marks a near match", async () => {
    fake = installFakePick([{ kind: "result", result: { action: "select", value: null, values: ["20"], query: "" } }]);
    expect(await realServersDeps.pick("sample-app", SERVERS, landed(new Map()))).toEqual([20]);
    expect(fake.calls[0]!.request).toMatchObject({ multi: true, exact: true, breadcrumb: ["rt", "servers", "sample-app"] });
    expect(fake.calls[0]!.request.actions!.map((a) => [a.id, a.label, a.key])).toEqual([["select", "stop", "enter"]]);
  });

  test("it opens on the ticket data that landed, and nothing redraws after", async () => {
    fake = installFakePick(CANCELLED);
    expect(await realServersDeps.pick("sample-app", SERVERS, landed(ENRICHED))).toBeNull();
    const { request, updates } = fake.calls[0]!;
    expect(request.groupHeadings!["WEB-214"]!.left.at(-1)).toEqual({ text: "Add a login rate limit", bold: true });
    expect(updates).toEqual([]);
  });

  test("ticket data that was too slow lands as one update over the same rows", async () => {
    fake = installFakePick(CANCELLED);
    await realServersDeps.pick("sample-app", SERVERS, late(ENRICHED));
    const { request, updates } = fake.calls[0]!;
    expect(request.groupHeadings!["WEB-214"]!.left.map((s) => s.text)).toEqual(["WEB-214", "  web-214-login-rate-limit"]);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.groupHeadings!["WEB-214"]!.left.at(-1)).toEqual({ text: "Add a login rate limit", bold: true });
    expect(updates[0]!.rows!.map((r) => r.value)).toEqual(request.rows.map((r) => r.value));
  });

  test("a late answer that reaches a picker already closing does not lose the pick", async () => {
    pickTest.setImpl(() => ({
      update: () => { throw new Error("EPIPE"); },
      modal: async () => null,
      result: Bun.sleep(5).then(() => ({ t: "result", action: "select", value: null, values: ["20"], query: "" }) as const),
    }) as unknown as PickHandle);
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      expect(await realServersDeps.pick("sample-app", SERVERS, late(ENRICHED))).toEqual([20]);
      await Bun.sleep(5);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      pickTest.setImpl(undefined);
    }
  });

  test("a late lookup that found nothing leaves the rows standing", async () => {
    fake = installFakePick(CANCELLED);
    await realServersDeps.pick("sample-app", SERVERS, late(new Map()));
    expect(fake.calls[0]!.updates).toEqual([]);
  });
});

describe("realServersDeps.rules", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-servers-rules-"));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    closeStateDb();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("only this repo's rules and claims are read", () => {
    const other = "remote:example.com%2Facme%2Fother-tool";
    const matches = [{ cwdGlob: "apps/api", role: "api" }];
    const claim = { worktree: TREE, role: "api", port: 10400, ts: "2026-11-24T20:45:47.000Z" };
    writeInterceptRules([
      { command: "doppler", repo: other, repoRemote: null, matches },
      { command: "doppler", repo: IDENTITY, repoRemote: null, matches },
    ]);
    saveClaims(other, [{ ...claim, port: 4001 }]);
    saveClaims(IDENTITY, [claim]);
    const read = realServersDeps.rules(IDENTITY);
    expect(read.rules.map((r) => r.repo)).toEqual([IDENTITY]);
    expect(read.claims).toEqual([claim]);
  });
});

test("the real gate needs a TTY on all three streams and no RT_BATCH", () => {
  const saved = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY, stderr: process.stderr.isTTY, batch: process.env.RT_BATCH };
  const set = (stdin: boolean, stdout: boolean, stderr: boolean, batch?: string) => {
    Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true, writable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true, writable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: stderr, configurable: true, writable: true });
    if (batch === undefined) delete process.env.RT_BATCH;
    else process.env.RT_BATCH = batch;
    return realServersDeps.canAsk();
  };
  try {
    expect([set(true, true, true), set(true, true, true, "1"), set(false, true, true), set(true, false, true), set(true, true, false)])
      .toEqual([true, false, false, false, false]);
  } finally {
    Object.defineProperty(process.stdin, "isTTY", { value: saved.stdin, configurable: true, writable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: saved.stdout, configurable: true, writable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: saved.stderr, configurable: true, writable: true });
    if (saved.batch === undefined) delete process.env.RT_BATCH;
    else process.env.RT_BATCH = saved.batch;
  }
});
