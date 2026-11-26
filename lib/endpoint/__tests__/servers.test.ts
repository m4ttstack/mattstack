import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { RoleConfig } from "../config.ts";
import {
  ancestorPids,
  findServers,
  interceptCommandOf,
  parseServerProcs,
  type ServerRules,
  type ServerSnapshot,
} from "../servers.ts";

const LSTART = "Tue Nov 24 14:45:47 2026";

test("a ps row splits into pid, ppid, etime, start time, command and the full command line", () => {
  expect(parseServerProcs(
    `  101     1 18:00:00 ${LSTART}     rt intercept run doppler -- run -- parcel src/index.html\nnot a row\n`,
    new Map([[101, "/Applications/mattstack.app/Contents/MacOS/rt"]]),
  )).toEqual([
    { pid: 101, ppid: 1, etime: "18:00:00", startTime: LSTART, command: "rt", args: "rt intercept run doppler -- run -- parcel src/index.html" },
  ]);
});

test("a command whose path holds a space is read whole", () => {
  const [proc] = parseServerProcs(
    `  101     1 18:00:00 ${LSTART}     /Users/me/Application Support/Claude/claude --resume x\n`,
    new Map([[101, "/Users/me/Application Support/Claude/claude"]]),
  );
  expect(proc!.command).toBe("claude");
});

test("a process that started after its command was read takes it from its command line", () => {
  expect(parseServerProcs(`  101     1 00:00 ${LSTART}     /usr/local/bin/node server.js\n`, new Map())[0]!.command).toBe("node");
});

test("a single-digit day in the start time is kept with one space", () => {
  expect(parseServerProcs("  102   101 05:12 Sun Nov  1 04:05:06 2026     node server.js", new Map())[0]!.startTime).toBe("Sun Nov 1 04:05:06 2026");
});

test("an intercepted command is read from the installed rt and from a source checkout", () => {
  const want = { command: "doppler", args: ["run", "--", "parcel"] };
  expect(interceptCommandOf("rt intercept run doppler -- run -- parcel")).toEqual(want);
  expect(interceptCommandOf("/Applications/mattstack.app/Contents/MacOS/rt intercept run doppler -- run -- parcel")).toEqual(want);
  expect(interceptCommandOf("/Users/me/.bun/bin/bun run --preload=/Users/me/restore-cwd.ts /code/rt/cli.ts intercept run doppler -- run -- parcel")).toEqual(want);
});

test("an intercepted command with no arguments has none", () => {
  expect(interceptCommandOf("rt intercept run doppler --")).toEqual({ command: "doppler", args: [] });
});

test("a shell, an agent or a search holding the same words is not an intercepted command", () => {
  expect(interceptCommandOf("/bin/zsh -c eval 'rt intercept run doppler -- run -- parcel'")).toBeNull();
  expect(interceptCommandOf("grep intercept run doppler -- run")).toBeNull();
  expect(interceptCommandOf("rt intercept status")).toBeNull();
});

test("a bun process that only mentions an intercepted command is not one", () => {
  expect(interceptCommandOf("bun /opt/bin/codex exec fix /code/rt/cli.ts intercept run doppler -- run -- node src/server")).toBeNull();
  expect(interceptCommandOf("bun run --preload=/x.ts /code/rt/cli.ts chat post room why is /code/rt/cli.ts intercept run doppler -- run")).toBeNull();
  expect(interceptCommandOf("rt chat post room why is rt intercept run doppler -- run")).toBeNull();
});

const MAIN = "/code/sample-app";
const TREE = "/trees/calm-marble";

function role(over: Partial<RoleConfig>): RoleConfig {
  return { pool: [], needs: [], preserveEnv: [], env: {}, ...over };
}

function rules(claims: Array<{ worktree: string; role: string; port: number; pid?: number }> = []): ServerRules {
  return {
    rules: [{
      command: "doppler",
      repo: "sample-app",
      repoRemote: "https://example.com/sample-app.git",
      matches: [
        { cwdGlob: "apps/api{,/**}", argPattern: "src/server", role: "api" },
        { cwdGlob: "apps/web{,/**}", argPattern: "parcel", role: "web" },
        { cwdGlob: "apps/docs{,/**}", argPattern: "parcel", role: "docs" },
      ],
    }],
    roles: { api: role({ pool: [10400, 10401] }), web: role({ pool: [4001], needs: ["api"] }), docs: role({ fixedPort: 4002 }) },
    claims: claims.map((c) => ({ ...c, ts: "2026-11-24T20:45:47.000Z" })),
  };
}

interface Row { pid: number; ppid: number; args: string; cwd: string; ports?: number[]; command?: string }

function snap(rows: Row[], worktrees: ServerSnapshot["worktrees"] = [
  { path: MAIN, branch: "main" },
  { path: TREE, branch: "feature/login" },
]): ServerSnapshot {
  return {
    procs: rows.map(({ pid, ppid, args, command = args.split(" ")[0]!.split("/").pop()! }) => ({ pid, ppid, args, command, etime: "18:00:00", startTime: LSTART })),
    cwds: new Map(rows.map((r) => [r.pid, r.cwd])),
    listeners: new Map(rows.filter((r) => r.ports).map((r) => [r.pid, r.ports!])),
    worktrees,
  };
}

const API_RUN = "rt intercept run doppler -- run -- node src/server";
const WEB_RUN = "rt intercept run doppler -- run -- parcel src/index.html";

function apiTree(cwd: string, ports: number[] = [], ppid = 1): Row[] {
  return [
    { pid: 10, ppid, args: API_RUN, cwd },
    { pid: 11, ppid: 10, args: "doppler run -- node src/server", cwd },
    { pid: 12, ppid: 11, args: "node watch.js", cwd },
    { pid: 13, ppid: 12, args: "node src/server", cwd, ...(ports.length ? { ports } : {}) },
  ];
}

const API = `${TREE}/apps/api`;
const WEB = `${TREE}/apps/web`;

test("a server is its whole tree, its role and the port claimed for it", () => {
  const found = findServers(snap(apiTree(API, [9229, 10400])), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found).toEqual([{
    role: "api", port: 10400, listening: true, worktree: { path: TREE, name: "calm-marble" }, branch: "feature/login",
    pid: 10, pids: [10, 11, 12, 13], startTime: LSTART, etime: "18:00:00", leftBehind: false, agent: null, inside: null, removed: false,
  }]);
});

test("a one-off run of the same tool matches no rule and is left out", () => {
  expect(findServers(snap([{ pid: 10, ppid: 1, args: "rt intercept run doppler -- secrets", cwd: API }]), rules())).toEqual([]);
});

test("a process in another repo's folder is left out", () => {
  expect(findServers(snap(apiTree("/code/other/apps/api", [10400])), rules())).toEqual([]);
});

test("a folder that only starts with a worktree's path is not inside it", () => {
  expect(findServers(snap(apiTree(`${TREE}-old/apps/api`, [10400])), rules())).toEqual([]);
});

test("a fixed-port role shows with no claim row", () => {
  const found = findServers(snap([
    { pid: 10, ppid: 1, args: WEB_RUN, cwd: `${TREE}/apps/docs` },
    { pid: 11, ppid: 10, args: "parcel src/index.html", cwd: `${TREE}/apps/docs`, ports: [1234, 4002] },
  ]), rules());
  expect(found[0]).toMatchObject({ role: "docs", port: 4002, listening: true });
});

test("a needed role's claim is not a server of its own", () => {
  const found = findServers(snap([
    { pid: 20, ppid: 1, args: WEB_RUN, cwd: WEB },
    { pid: 21, ppid: 20, args: "parcel src/index.html", cwd: WEB, ports: [4001] },
  ]), rules([{ worktree: TREE, role: "web", port: 4001, pid: 20 }, { worktree: TREE, role: "api", port: 10400, pid: 20 }]));
  expect(found.map((s) => s.role)).toEqual(["web"]);
});

test("a run with no claim takes the lowest port its tree listens on", () => {
  const found = findServers(snap(apiTree(API, [4100, 9229])), rules());
  expect(found[0]).toMatchObject({ port: 4100, listening: true });
});

test("a claim from another worktree is not this server's port", () => {
  const found = findServers(snap(apiTree(API, [4100, 10400])), rules([{ worktree: MAIN, role: "api", port: 10400 }]));
  expect(found[0]!.port).toBe(4100);
});

test("a tree that listens on nothing shows its claimed port as not listening", () => {
  const found = findServers(snap(apiTree(API)), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found[0]).toMatchObject({ port: 10400, listening: false });
});

test("a tree with no port and no claim has a null port", () => {
  expect(findServers(snap(apiTree(API)), rules())[0]).toMatchObject({ port: null, listening: false });
});

test("a detached worktree's server is listed with no branch", () => {
  const found = findServers(snap(apiTree(API, [10400]), [{ path: MAIN, branch: "main" }, { path: TREE, branch: null }]), rules());
  expect(found.map((s) => [s.worktree.name, s.branch])).toEqual([["calm-marble", null]]);
});

test("a tree nested in the main checkout owns its own server", () => {
  const nested = `${MAIN}/.worktrees/fix`;
  const found = findServers(snap(apiTree(`${nested}/apps/api`, [10400]), [{ path: MAIN, branch: "main" }, { path: nested, branch: "fix" }]), rules());
  expect(found.map((s) => [s.worktree.path, s.branch])).toEqual([[nested, "fix"]]);
});

test("the same intercepted command nested in itself is one server", () => {
  const found = findServers(snap([
    ...apiTree(API).slice(0, 2),
    { pid: 12, ppid: 11, args: API_RUN, cwd: API },
    { pid: 13, ppid: 12, args: "node src/server", cwd: API, ports: [10400] },
  ]), rules());
  expect(found.map((s) => [s.pid, s.pids, s.port])).toEqual([[10, [10, 11, 12, 13], 10400]]);
});

test("a nested server of another role is its own row and its pids leave the outer tree", () => {
  const found = findServers(snap([
    ...apiTree(API).slice(0, 2),
    { pid: 20, ppid: 11, args: WEB_RUN, cwd: WEB },
    { pid: 21, ppid: 20, args: "parcel src/index.html", cwd: WEB, ports: [4001] },
  ]), rules());
  expect(found.map((s) => [s.role, s.pids, s.port])).toEqual([["api", [10, 11], null], ["web", [20, 21], 4001]]);
});

test("the same role in two worktrees is two servers, sorted by worktree name", () => {
  const found = findServers(snap([
    { pid: 30, ppid: 1, args: API_RUN, cwd: `${MAIN}/apps/api`, ports: [10400] },
    { pid: 10, ppid: 1, args: API_RUN, cwd: API, ports: [10401] },
  ]), rules());
  expect(found.map((s) => [s.worktree.name, s.pid])).toEqual([["calm-marble", 10], ["sample-app", 30]]);
});

test("a live agent above the server is named", () => {
  const found = findServers(snap([
    { pid: 5, ppid: 1, args: "claude --resume x", cwd: TREE },
    { pid: 6, ppid: 5, args: "/bin/zsh -c eval 'rt intercept run doppler -- run -- node src/server'", cwd: API },
    ...apiTree(API, [10400], 6),
  ]), rules());
  expect(found.map((s) => [s.pid, s.agent])).toEqual([[10, "claude"]]);
});

test("an agent inside a tree, and everything under it, is not in the tree's pids", () => {
  const found = findServers(snap([
    ...apiTree(API).slice(0, 2),
    { pid: 12, ppid: 11, args: "claude --resume x", cwd: API },
    { pid: 13, ppid: 12, args: "node helper.js", cwd: API, ports: [10400] },
  ]), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found.map((s) => [s.pids, s.port, s.listening])).toEqual([[[10, 11], 10400, false]]);
});

const SPACED_AGENT = { args: "/Users/me/Application Support/Claude/claude.app/Contents/MacOS/claude --resume x", command: "claude" };

test("an agent whose path holds a space is named above a server and spared inside one", () => {
  const above = findServers(snap([{ pid: 5, ppid: 1, cwd: API, ...SPACED_AGENT }, ...apiTree(API, [10400], 5)]), rules());
  expect(above.map((s) => [s.pid, s.agent])).toEqual([[10, "claude"]]);
  const inside = findServers(snap([
    ...apiTree(API).slice(0, 2),
    { pid: 12, ppid: 11, cwd: API, ...SPACED_AGENT },
    { pid: 13, ppid: 12, args: "node helper.js", cwd: API },
  ]), rules());
  expect(inside.map((s) => s.pids)).toEqual([[10, 11]]);
});

test("a left-behind tree never climbs into an agent or an app in the same folder", () => {
  const under = (top: { args: string; command: string }) => findServers(snap([
    { pid: 9, ppid: 1, cwd: API, ...top },
    { pid: 11, ppid: 9, args: "doppler run -- node src/server", cwd: API },
    { pid: 13, ppid: 11, args: "node src/server", cwd: API, ports: [10400] },
  ]), rules([{ worktree: TREE, role: "api", port: 10400 }])).map((s) => [s.pid, s.pids]);
  expect(under(SPACED_AGENT)).toEqual([[11, [11, 13]]]);
  expect(under({ args: "/Applications/Ghostty.app/Contents/MacOS/ghostty", command: "ghostty" })).toEqual([[11, [11, 13]]]);
});

test("a server whose rt process is gone is left behind, from the topmost process in the same folder", () => {
  const found = findServers(
    snap(apiTree(API, [10400]).slice(1).map((r) => (r.pid === 11 ? { ...r, ppid: 1 } : r))),
    rules([{ worktree: TREE, role: "api", port: 10400 }]),
  );
  expect(found).toEqual([{
    role: "api", port: 10400, listening: true, worktree: { path: TREE, name: "calm-marble" }, branch: "feature/login",
    pid: 11, pids: [11, 12, 13], startTime: LSTART, etime: "18:00:00", leftBehind: true, agent: null, inside: null, removed: false,
  }]);
});

test("a left-behind tree never climbs into the process that started other servers", () => {
  const found = findServers(snap([
    { pid: 9, ppid: 1, args: "turbo run dev", cwd: TREE },
    { pid: 11, ppid: 9, args: "doppler run -- node src/server", cwd: API },
    { pid: 13, ppid: 11, args: "node src/server", cwd: API, ports: [10400] },
    { pid: 15, ppid: 9, args: "node other.js", cwd: TREE },
  ]), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found.map((s) => [s.pid, s.pids])).toEqual([[11, [11, 13]]]);
});

test("a left-behind tree never climbs into a shell in the same folder", () => {
  const found = findServers(snap([
    { pid: 8, ppid: 1, args: "-zsh", cwd: API },
    { pid: 13, ppid: 8, args: "node src/server", cwd: API, ports: [10400] },
  ]), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found.map((s) => [s.pid, s.pids])).toEqual([[13, [13]]]);
});

test("a left-behind tree climbs through a Python that only runs from a framework app", () => {
  const python = "/opt/homebrew/Cellar/python@3.13/3.13.1/Frameworks/Python.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python";
  const found = findServers(snap([
    { pid: 12, ppid: 1, args: `${python} -m uvicorn --reload`, cwd: API },
    { pid: 13, ppid: 12, args: `${python} -c from multiprocessing`, cwd: API, ports: [10400] },
  ]), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found.map((s) => [s.pid, s.pids])).toEqual([[12, [12, 13]]]);
});

test("an app holding a role's port is never a server", () => {
  const found = findServers(snap([
    { pid: 13, ppid: 1, args: "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper --type=utility", command: "Cursor Helper", cwd: API, ports: [10400] },
  ]), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found).toEqual([]);
});

test("a session or an interactive shell inside a tree is named, and a script's shell is not", () => {
  const inside = (args: string) => findServers(snap([...apiTree(API).slice(0, 2), { pid: 12, ppid: 11, args, cwd: API }]), rules()).map((s) => s.inside);
  expect(inside("claude --resume x")).toEqual(["claude"]);
  expect(inside("node /opt/bin/codex")).toEqual(["codex"]);
  expect(inside("/bin/zsh -il")).toEqual(["shell"]);
  expect(inside("-zsh")).toEqual(["shell"]);
  expect(inside("bash --norc")).toEqual(["shell"]);
  expect(inside("bash --rcfile /tmp/session.rc -i")).toEqual(["shell"]);
  expect(inside("bash --init-file /tmp/session.rc")).toEqual(["shell"]);
  expect(inside("zsh -o vi")).toEqual(["shell"]);
  expect(inside("bash -i --rcfile /tmp/my session.rc")).toEqual(["shell"]);
  expect(inside("bash --rcfile /tmp/my session.rc")).toEqual(["shell"]);
  expect(inside("fish -C source x.fish")).toEqual(["shell"]);
  expect(inside("fish -lC source x.fish")).toEqual(["shell"]);
  expect(inside("fish --init-command=source x.fish")).toEqual(["shell"]);
  expect(inside("fish --init-command source x.fish")).toEqual(["shell"]);
  expect(inside("bash -o pipefail -c node src/server")).toEqual([null]);
  expect(inside("/bin/zsh -lc node src/server")).toEqual([null]);
  expect(inside("zsh -i -c npm run dev")).toEqual([null]);
  expect(inside("bash -C scripts/start.sh")).toEqual([null]);
  expect(inside("fish --command node")).toEqual([null]);
  expect(inside("fish --command=node")).toEqual([null]);
  expect(inside("fish -lc node")).toEqual([null]);
  expect(inside("sh -c node src/server")).toEqual([null]);
  expect(inside("/bin/bash scripts/start.sh")).toEqual([null]);
  expect(inside("node src/server")).toEqual([null]);
});

test("a session inside a nested server counts for every server above it", () => {
  const found = findServers(snap([
    ...apiTree(API).slice(0, 2),
    { pid: 20, ppid: 11, args: WEB_RUN, cwd: WEB },
    { pid: 21, ppid: 20, args: "claude", cwd: WEB },
    { pid: 30, ppid: 1, args: API_RUN, cwd: `${MAIN}/apps/api` },
  ]), rules());
  expect(found.map((s) => [s.role, s.worktree.name, s.inside])).toEqual([
    ["api", "calm-marble", "claude"], ["web", "calm-marble", "claude"], ["api", "sample-app", null],
  ]);
});

test("a server in a removed worktree rt still keeps is listed with that tree's branch", () => {
  const kept = "/trees/.trash/calm-marble-1795633493000";
  const found = findServers(snap(apiTree(`${kept}/apps/api`, [10400]), [
    { path: MAIN, branch: "main" },
    { path: kept, branch: "feature/login", removed: true },
  ]), rules());
  expect(found.map((s) => [s.worktree.name, s.branch, s.removed, s.port])).toEqual([["calm-marble-1795633493000", "feature/login", true, 10400]]);
});

test("a server in a claimed worktree git no longer lists is still this repo's", () => {
  const found = findServers(snap(apiTree(API, [10400]), [{ path: MAIN, branch: "main" }]), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found.map((s) => [s.worktree.path, s.branch, s.removed, s.port])).toEqual([[TREE, null, true, 10400]]);
});

test("a claimed folder that still exists but git does not list is not this repo's", () => {
  const other = realpathSync(mkdtempSync(join(tmpdir(), "rt-clone-")));
  try {
    const found = findServers(
      snap(apiTree(join(other, "apps", "api"), [10400]), [{ path: MAIN, branch: "main" }]),
      rules([{ worktree: other, role: "api", port: 10400 }]),
    );
    expect(found).toEqual([]);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

describe("a claimed folder git dropped while the folder stayed", () => {
  let dir: string;
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-dropped-"))); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const findIn = (tree: string, gitFile: string) => {
    const main = join(dir, "main");
    mkdirSync(join(main, ".git", "worktrees"), { recursive: true });
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, ".git"), gitFile);
    return findServers(
      snap(apiTree(join(tree, "apps", "api"), [10400]), [{ path: main, branch: "main" }]),
      rules([{ worktree: tree, role: "api", port: 10400 }]),
    );
  };

  test("is this repo's when its .git points into this repo's worktrees", () => {
    const tree = join(dir, "calm-marble");
    const found = findIn(tree, `gitdir: ${join(dir, "main", ".git", "worktrees", "calm-marble")}\n`);
    expect(found.map((s) => [s.worktree.path, s.branch, s.removed])).toEqual([[tree, null, true]]);
  });

  test("is this repo's when that gitdir is written relative to the folder", () => {
    const tree = join(dir, "calm-marble");
    expect(findIn(tree, "gitdir: ../main/.git/worktrees/calm-marble\n").map((s) => s.removed)).toEqual([true]);
  });

  test("is another repo's when its .git points anywhere else", () => {
    mkdirSync(join(dir, "other", ".git", "worktrees"), { recursive: true });
    expect(findIn(join(dir, "calm-marble"), `gitdir: ${join(dir, "other", ".git", "worktrees", "calm-marble")}\n`)).toEqual([]);
  });
});

test("a claimed worktree git still lists is not a removed one", () => {
  const found = findServers(snap(apiTree(API, [10400])), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found.map((s) => [s.branch, s.removed])).toEqual([["feature/login", false]]);
});

test("two listeners of one left-behind tree are one row", () => {
  const found = findServers(snap([
    { pid: 11, ppid: 1, args: "doppler run -- node src/server", cwd: API },
    { pid: 13, ppid: 11, args: "node src/server", cwd: API, ports: [10400] },
    { pid: 14, ppid: 11, args: "node src/server", cwd: API, ports: [10400] },
  ]), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found.map((s) => [s.pid, s.pids])).toEqual([[11, [11, 13, 14]]]);
});

test("a left-behind fixed port counts only from that role's folder", () => {
  const found = findServers(snap([
    { pid: 30, ppid: 1, args: "node serve.js", cwd: `${TREE}/apps/docs`, ports: [4002] },
    { pid: 31, ppid: 1, args: "node serve.js", cwd: API, ports: [4002] },
  ]), rules());
  expect(found.map((s) => [s.role, s.port, s.pid, s.leftBehind])).toEqual([["docs", 4002, 30, true]]);
});

test("an agent or shell holding a role's port is never a server", () => {
  const found = findServers(snap([
    { pid: 40, ppid: 1, args: "claude --resume x", cwd: API, ports: [10400] },
    { pid: 41, ppid: 1, args: "-zsh", cwd: `${TREE}/apps/docs`, ports: [4002] },
  ]), rules([{ worktree: TREE, role: "api", port: 10400 }]));
  expect(found).toEqual([]);
});

test("a listener on a claimed port from another worktree is not that claim's server", () => {
  const found = findServers(
    snap([{ pid: 13, ppid: 1, args: "node src/server", cwd: `${MAIN}/apps/api`, ports: [10400] }]),
    rules([{ worktree: TREE, role: "api", port: 10400 }]),
  );
  expect(found).toEqual([]);
});

test("a role's port held inside another server's tree is not left behind", () => {
  const found = findServers(snap([
    { pid: 20, ppid: 1, args: WEB_RUN, cwd: WEB },
    { pid: 21, ppid: 20, args: "node all-in-one.js", cwd: WEB, ports: [4001, 10400] },
  ]), rules([{ worktree: TREE, role: "web", port: 4001 }, { worktree: TREE, role: "api", port: 10400 }]));
  expect(found.map((s) => [s.role, s.leftBehind])).toEqual([["web", false]]);
});

describe("another repo's checkout inside this one", () => {
  let dir: string;
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-nested-"))); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const anyApi: ServerRules = { ...rules(), rules: [{ command: "doppler", repo: "sample-app", repoRemote: null, matches: [{ cwdGlob: "**/apps/api", role: "api" }] }] };

  test("its servers are not this repo's, running or left behind", () => {
    mkdirSync(join(dir, "vendor", "other", ".git"), { recursive: true });
    const cwd = join(dir, "vendor", "other", "apps", "api");
    const trees = [{ path: dir, branch: "main" }];
    expect(findServers(snap([{ pid: 10, ppid: 1, args: API_RUN, cwd }], trees), anyApi)).toEqual([]);
    expect(findServers(
      snap([{ pid: 13, ppid: 1, args: "node src/server", cwd, ports: [10400] }], trees),
      { ...anyApi, claims: [{ worktree: dir, role: "api", port: 10400, ts: "2026-11-24T20:45:47.000Z" }] },
    )).toEqual([]);
  });

  test("a folder of this repo's own at the same depth still counts", () => {
    mkdirSync(join(dir, ".git"), { recursive: true });
    const found = findServers(snap([{ pid: 10, ppid: 1, args: API_RUN, cwd: join(dir, "vendor", "apps", "api") }], [{ path: dir, branch: "main" }]), anyApi);
    expect(found.map((s) => s.role)).toEqual(["api"]);
  });
});

test("ancestors run nearest first and stop below pid 1", () => {
  const { procs } = snap([
    { pid: 5, ppid: 1, args: "a", cwd: "/" },
    { pid: 6, ppid: 5, args: "b", cwd: "/" },
    { pid: 7, ppid: 6, args: "c", cwd: "/" },
  ]);
  expect(ancestorPids(procs, 7)).toEqual([6, 5]);
});

test("a ppid loop ends the ancestor walk", () => {
  const { procs } = snap([{ pid: 5, ppid: 6, args: "a", cwd: "/" }, { pid: 6, ppid: 5, args: "b", cwd: "/" }]);
  expect(ancestorPids(procs, 5)).toEqual([6]);
});
