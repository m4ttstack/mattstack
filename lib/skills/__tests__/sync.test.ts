import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { PackInfo } from "../packs.ts";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { childEnv, runCapture } from "../../subprocess.ts";
import { bumpPatchVersion, type RunResult, type SyncDeps, syncPack } from "../sync.ts";
import { skillsChanges } from "../../../commands/skills.ts";
import { captureSkills } from "./helpers.ts";

type Call = { cmd: string; args: string[]; cwd?: string };

function tmp(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function fixturePack(name: string, marketplace: string | null, version: string, parent?: string): PackInfo {
  const dir = parent ? join(parent, name) : tmp(`rt-sync-${name}-`);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version }, null, 2) + "\n");
  writeFileSync(join(dir, "surface.jsonc"), `{ "public": [] }\n`);
  return { name, dir, layout: "flat", surfacePath: join(dir, "surface.jsonc"), marketplace };
}

function blobOf(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function pluginId(info: PackInfo): string {
  return `${info.name}@${info.marketplace}`;
}

function readVersion(dir: string): string {
  return JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).version as string;
}

type World = {
  calls: Call[];
  gitStatus?: Record<string, string>;
  statusFail?: Record<string, string>;
  branch?: string;
  branchByDir?: Record<string, string>;
  branchFail?: Record<string, string>;
  installed?: Record<string, string>;
  drift?: boolean[];
  lintHits?: number[];
  lintStrict?: boolean[];
  checkThrows?: boolean;
  compileOk?: boolean;
  compileErrors?: string[];
  /** What the fake compile reports it wrote and removed. */
  compileWrites?: { written: string[]; removed: string[] };
  pullFail?: Record<string, string>;
  pullBumps?: Record<string, string>;
  updateFail?: Record<string, string>;
  cswapSessionsDir?: string;
  configDir?: string;
  claudeBinOverride?: string | null;
  mainVersions?: Record<string, string>;
  marketplaceUpdateFail?: Record<string, string>;
  cacheUpdateTo?: Record<string, string>;
  /** Listed ahead of the installed entries: the same plugin id at another scope. */
  shadowEntries?: { id: string; scope: string; version: string }[];
  scopeOf?: Record<string, string>;
  /** What `git rev-parse --show-prefix` prints in a dir: the pack's place inside its repo. */
  prefix?: Record<string, string>;
  /** Git subcommands that fail, keyed by subcommand name. */
  gitFail?: Record<string, string>;
};

/**
 * Simulates the real world closely enough that verify-installed sees a
 * matching version after a successful "claude plugin update": the fake
 * update handler copies the current source manifest into the fake
 * installed copy, the same effect the real CLI has on disk.
 */
function makeDeps(pack: PackInfo, engine: PackInfo, world: World): SyncDeps {
  const claudeBin = world.claudeBinOverride === undefined ? "/usr/local/bin/claude" : world.claudeBinOverride;
  const installedVersions = new Map<string, string>(Object.entries(world.installed ?? {}));
  const installDirs = new Map<string, string>();
  const driftAnswers = [...(world.drift ?? [])];
  const lintHitsAnswers = [...(world.lintHits ?? [])];
  const lintStrictAnswers = [...(world.lintStrict ?? [])];

  function installDirFor(id: string): string {
    let dir = installDirs.get(id);
    if (!dir) {
      dir = tmp("rt-sync-installed-");
      installDirs.set(id, dir);
    }
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: id.split("@")[0], version: installedVersions.get(id) }, null, 2) + "\n",
    );
    return dir;
  }

  function sourceDirFor(id: string): string | null {
    if (id === pluginId(pack)) return pack.dir;
    if (id === pluginId(engine)) return engine.dir;
    return null;
  }

  for (const id of installedVersions.keys()) installDirFor(id);
  /** The commits the fake git made, by the short sha its summary line printed. */
  const made = new Map<string, string>();
  /** Each fake commit's parent, so the chain and HEAD read the way a real repo's do. */
  const parents = new Map<string, string>();
  let head = "b".repeat(40);

  const run = async (cmd: string, args: string[], opts?: { cwd?: string }): Promise<RunResult> => {
    world.calls.push({ cmd, args, cwd: opts?.cwd });

    if (cmd === "git") {
      const cwd = opts?.cwd ?? "";
      if (args[0] === "--no-optional-locks") args = args.slice(1);
      if (args[0] === "status") {
        const stderr = world.statusFail?.[cwd];
        if (stderr) return { code: 1, stdout: "", stderr };
        return { code: 0, stdout: world.gitStatus?.[cwd] ?? "", stderr: "" };
      }
      if (args[0] === "branch") {
        const stderr = world.branchFail?.[cwd];
        if (stderr) return { code: 1, stdout: "", stderr };
        const value = world.branchByDir ? (world.branchByDir[cwd] ?? "main") : (world.branch ?? "main");
        return { code: 0, stdout: value, stderr: "" };
      }
      if (args[0] === "show") {
        const [ref, path] = args[1]!.split(/:(.*)/s);
        if (ref !== "main") return { code: 128, stdout: "", stderr: `unknown ref ${ref}` };
        const rel = path!.replace(/\/?\.claude-plugin\/plugin\.json$/, "");
        const onMain = world.mainVersions?.[rel];
        if (onMain) return { code: 0, stdout: JSON.stringify({ version: onMain }), stderr: "" };
        return { code: 0, stdout: readFileSync(join(cwd, path!), "utf8"), stderr: "" };
      }
      if (args[0] === "pull") {
        const stderr = world.pullFail?.[cwd];
        if (stderr) return { code: 1, stdout: "", stderr };
        const bumpTo = world.pullBumps?.[cwd];
        if (bumpTo) {
          const manifestPath = join(cwd, ".claude-plugin", "plugin.json");
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: bumpTo }, null, 2) + "\n");
          return { code: 0, stdout: `Updating to ${bumpTo}`, stderr: "" };
        }
        return { code: 0, stdout: "Already up to date.", stderr: "" };
      }
      const failure = world.gitFail?.[args[0]!];
      if (failure) return { code: 1, stdout: "", stderr: failure };
      if (args[0] === "commit") {
        const sha = createHash("sha1").update(`commit ${made.size}`).digest("hex");
        made.set(sha.slice(0, 7), sha);
        parents.set(sha, head);
        head = sha;
        return { code: 0, stdout: `[main ${sha.slice(0, 7)}] ${args[2]}\n`, stderr: "" };
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: `${head}\n`, stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        const ref = args[2]!;
        const found = ref.endsWith("^1") ? parents.get(ref.slice(0, -2)) : made.get(ref.replace("^{commit}", ""));
        return found ? { code: 0, stdout: `${found}\n`, stderr: "" } : { code: 128, stdout: "", stderr: `fatal: Needed a single revision` };
      }
      if (args[0] === "update-ref") {
        const [target, oldValue] = args.slice(-2) as [string, string];
        if (head !== oldValue) return { code: 128, stdout: "", stderr: `fatal: update_ref failed for ref 'HEAD': is at ${head} but expected ${oldValue}` };
        head = target.endsWith("~1") ? (parents.get(target.slice(0, -2)) ?? head) : target;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "write-tree" || (args[0] === "rev-parse" && args[1]!.endsWith("^{tree}"))) return { code: 0, stdout: `${"e".repeat(40)}\n`, stderr: "" };
      if (args[0] === "hash-object") {
        const paths = args.slice(args.indexOf("--") + 1);
        return { code: 0, stdout: paths.map((p) => blobOf(readFileSync(join(cwd, p)))).join("\n") + "\n", stderr: "" };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-prefix") return { code: 0, stdout: `${world.prefix?.[cwd] ?? ""}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    }

    if (cmd === claudeBin) {
      if (args[0] === "plugin" && args[1] === "list") {
        const shadows = (world.shadowEntries ?? []).map((e) => {
          const dir = tmp("rt-sync-shadow-");
          mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
          writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: e.id.split("@")[0], version: e.version }));
          return { id: e.id, installPath: dir, scope: e.scope, enabled: true };
        });
        const list = [
          ...shadows,
          ...[...installedVersions.keys()].map((id) => ({ id, installPath: installDirFor(id), enabled: true, ...(world.scopeOf?.[id] ? { scope: world.scopeOf[id] } : {}) })),
        ];
        return { code: 0, stdout: JSON.stringify(list), stderr: "" };
      }
      if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "update") {
        const stderr = world.marketplaceUpdateFail?.[args[3]!];
        if (stderr) return { code: 1, stdout: "", stderr };
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "plugin" && args[1] === "update") {
        const id = args[2]!;
        const stderr = world.updateFail?.[id];
        if (stderr) return { code: 2, stdout: "", stderr };
        const movedTo = world.cacheUpdateTo?.[id];
        if (movedTo) {
          // Claude Code installs a new version into a new cache folder.
          installedVersions.set(id, movedTo);
          installDirs.delete(id);
          installDirFor(id);
          return { code: 0, stdout: "", stderr: "" };
        }
        const sourceDir = sourceDirFor(id);
        if (sourceDir) {
          installedVersions.set(id, readVersion(sourceDir));
          installDirFor(id);
        }
        return { code: 0, stdout: "", stderr: "" };
      }
    }

    return { code: 0, stdout: "", stderr: "" };
  };

  return {
    run,
    claudeBin,
    checkPack: async () => {
      world.calls.push({ cmd: "checkPack", args: [] });
      if (world.checkThrows) throw new Error("checkPack: manifest discovery found nothing");
      const next = driftAnswers.shift();
      if (next === undefined) throw new Error("checkPack: fixture ran out of configured drift answers");
      return { drift: next, lintHits: lintHitsAnswers.shift() ?? 0, strict: lintStrictAnswers.shift() ?? false };
    },
    compilePack: async () => ({ ok: world.compileOk ?? true, errors: world.compileErrors ?? [], written: world.compileWrites?.written ?? [], removed: world.compileWrites?.removed ?? [] }),
    materialize: async () => ({ ok: true, detail: "materialized 1" }),
    configDir: world.configDir ?? tmp("rt-sync-config-"),
    cswapSessionsDir: world.cswapSessionsDir ?? join(tmpdir(), "rt-sync-no-such-cswap-dir"),
    inTreeRoot: null,
  };
}

function stepNames(steps: { name: string }[]): string[] {
  return steps.map((s) => s.name);
}

describe("syncPack", () => {
  test("1: no-op ends the chain at check", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards", "pull-engine", "pull-pack", "update-engine", "materialize", "check"]);
    expect(report.ok).toBe(true);
    expect(report.restartNeeded).toBe(false);
    expect(calls.some((c) => c.args.includes("update"))).toBe(false);
  });

  test("2: lag only skips the compile leg but still updates the pack", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });

    const report = await syncPack(pack, engine, deps);

    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName.bump).toBe("skipped");
    expect(byName.compile).toBe("skipped");
    expect(byName.recheck).toBe("skipped");
    expect(byName["commit-push"]).toBe("skipped");
    expect(byName["update-pack"]).toBe("ran");
    expect(byName["verify-installed"]).toBe("ran");
    expect(report.restartNeeded).toBe(true);
    expect(report.ok).toBe(true);
  });

  test("3: drift bumps, compiles, commits, pushes, and updates", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true, false],
    });

    const report = await syncPack(pack, engine, deps);

    expect(readVersion(pack.dir)).toBe("0.5.3");
    const commitPush = calls.filter((c) => c.cwd === pack.dir && c.cmd === "git");
    expect(commitPush.some((c) => c.args[0] === "push")).toBe(true);
    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName.bump).toBe("ran");
    expect(byName.compile).toBe("ran");
    expect(byName["commit-push"]).toBe("ran");
    expect(byName["update-pack"]).toBe("ran");
    expect(report.ok).toBe(true);
  });

  test("4: drift surviving recompile refuses at recheck", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true, true],
    });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards", "pull-engine", "pull-pack", "update-engine", "materialize", "check", "bump", "compile", "recheck"]);
    const recheck = report.steps.find((s) => s.name === "recheck")!;
    expect(recheck.status).toBe("refused");
    expect(recheck.detail).toContain("mattstack:editing-skills");
    expect(report.ok).toBe(false);
  });

  test("5: dirty pack checkout refuses guards with no further calls", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, gitStatus: { [pack.dir]: " M x.ts" } });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("refused");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "branch")).toBe(false);
    expect(calls.some((c) => c.args[0] === "pull")).toBe(false);
  });

  test("6: engine off main refuses guards", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, branch: "feature" });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain("engine checkout is on feature, not main");
    expect(report.steps[0]!.detail).toContain("main");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "pull")).toBe(false);
  });

  test("7: missing marketplace refuses guards naming the pack", async () => {
    const pack = fixturePack("acme", null, "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain("The acme pack was not installed from a directory marketplace");
    expect(report.steps[0]!.detail).toContain("marketplace");
    expect(calls).toEqual([]);
  });

  test("8: claudeBin null refuses guards naming the probed locations", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, claudeBinOverride: null });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain(".claude/local/claude");
    expect(report.steps[0]!.detail).toContain("/opt/homebrew/bin/claude");
    expect(report.steps[0]!.detail).toContain("Install it, then run this again");
    expect(calls).toEqual([]);
  });

  test("9: update-engine is skipped when current and runs otherwise", async () => {
    const pack1 = fixturePack("acme", "local", "1.0.0");
    const engine1 = fixturePack("beacon", "local", "2.0.0");
    const calls1: Call[] = [];
    const deps1 = makeDeps(pack1, engine1, {
      calls: calls1,
      installed: { [pluginId(pack1)]: "1.0.0", [pluginId(engine1)]: "2.0.0" },
      drift: [false],
    });
    const report1 = await syncPack(pack1, engine1, deps1);
    expect(report1.steps.find((s) => s.name === "update-engine")!.status).toBe("skipped");
    expect(calls1.some((c) => c.args[0] === "plugin" && c.args[1] === "update" && c.args[2] === pluginId(engine1))).toBe(false);

    const pack2 = fixturePack("acme", "local", "1.0.0");
    const engine2 = fixturePack("beacon", "local", "2.0.0");
    const calls2: Call[] = [];
    const deps2 = makeDeps(pack2, engine2, {
      calls: calls2,
      installed: { [pluginId(pack2)]: "1.0.0", [pluginId(engine2)]: "1.9.0" },
      drift: [false],
    });
    const report2 = await syncPack(pack2, engine2, deps2);
    expect(report2.steps.find((s) => s.name === "update-engine")!.status).toBe("ran");
    expect(calls2.some((c) => c.args[0] === "plugin" && c.args[1] === "update" && c.args[2] === pluginId(engine2))).toBe(true);
  });

  test("10: the mattstack pack case runs one pull and one update, not two", async () => {
    const mattstack = fixturePack("mattstack", "local", "1.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(mattstack, mattstack, {
      calls,
      installed: { [pluginId(mattstack)]: "0.9.0" },
      drift: [false],
    });

    const report = await syncPack(mattstack, mattstack, deps);

    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName["pull-engine"]).toBe("skipped");
    expect(byName["update-engine"]).toBe("skipped");
    expect(byName["pull-pack"]).toBe("ran");
    expect(byName["update-pack"]).toBe("ran");
    expect(calls.filter((c) => c.args[0] === "pull").length).toBe(1);
    expect(calls.filter((c) => c.args[0] === "plugin" && c.args[1] === "update").length).toBe(1);
  });

  test("10b: an installed-cache engine is refreshed through Claude Code before check, never git-checked or pulled", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = { ...fixturePack("mattstack", "mattstack", "2.0.0"), installedCache: true };
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      cacheUpdateTo: { [pluginId(engine)]: "2.1.0" },
      drift: [false],
      gitStatus: { [engine.dir]: " M would-refuse-if-checked" },
    });

    const report = await syncPack(pack, engine, deps);

    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s]));
    expect(report.ok).toBe(true);
    expect(byName.guards!.detail).toContain("installed cache");
    expect(byName["pull-engine"]!.status).toBe("skipped");
    expect(byName["update-engine"]!.status).toBe("ran");
    expect(byName["update-engine"]!.detail).toContain("2.0.0 -> 2.1.0");
    expect(byName["update-pack"]!.status).toBe("ran");
    expect(report.versions.engine).toEqual({ before: "2.0.0", after: "2.1.0" });
    expect(calls.some((c) => c.cwd === engine.dir)).toBe(false);

    const order = calls.map((c) => (c.cmd === "checkPack" ? "check" : c.args.slice(0, 3).join(" ")));
    const refresh = order.indexOf("plugin marketplace update");
    const update = order.indexOf(`plugin update ${pluginId(engine)}`);
    expect(calls[refresh]!.args).toEqual(["plugin", "marketplace", "update", "mattstack"]);
    expect(calls[update]!.args).toEqual(["plugin", "update", pluginId(engine), "-y"]);
    expect(refresh).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(refresh);
    expect(order.indexOf("check")).toBeGreaterThan(update);
  });

  test("10g: a project-scope cached engine is updated at its own scope and its version read back from that entry", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = { ...fixturePack("mattstack", "mattstack", "2.0.0"), installedCache: true, scope: "project" };
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      scopeOf: { [pluginId(engine)]: "project" },
      shadowEntries: [{ id: pluginId(engine), scope: "user", version: "1.5.0" }],
      cacheUpdateTo: { [pluginId(engine)]: "2.1.0" },
      drift: [false],
    });

    const report = await syncPack(pack, engine, deps);

    const marketUpdate = calls.find((c) => c.args[1] === "marketplace" && c.args[2] === "update")!;
    const engineUpdate = calls.find((c) => c.args[1] === "update" && c.args[2] === pluginId(engine))!;
    expect(marketUpdate.args).toEqual(["plugin", "marketplace", "update", "mattstack"]);
    expect(engineUpdate.args).toEqual(["plugin", "update", pluginId(engine), "--scope", "project", "-y"]);
    expect(report.versions.engine).toEqual({ before: "2.0.0", after: "2.1.0" });
    expect(report.steps.find((s) => s.name === "update-engine")!.detail).toContain("2.0.0 -> 2.1.0");
  });

  test("10d: an installed-cache engine whose marketplace cannot refresh refuses before check, compile or commit", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = { ...fixturePack("mattstack", "mattstack", "2.0.0"), installedCache: true };
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      marketplaceUpdateFail: { mattstack: "network unreachable" },
      drift: [true, false],
    });

    const report = await syncPack(pack, engine, deps);

    const last = report.steps.at(-1)!;
    expect(last.name).toBe("update-engine");
    expect(last.status).toBe("refused");
    expect(last.detail).toContain("network unreachable");
    expect(last.detail).toContain("old engine");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.cmd === "checkPack")).toBe(false);
    expect(calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  test("10e: an installed-cache engine whose plugin update fails refuses before check", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = { ...fixturePack("mattstack", "mattstack", "2.0.0"), installedCache: true };
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      updateFail: { [pluginId(engine)]: "cache locked" },
      drift: [true, false],
    });

    const report = await syncPack(pack, engine, deps);

    const last = report.steps.at(-1)!;
    expect(last.name).toBe("update-engine");
    expect(last.status).toBe("refused");
    expect(last.detail).toContain("cache locked");
    expect(calls.some((c) => c.cmd === "checkPack")).toBe(false);
  });

  test("10f: an installed-cache engine already current is refreshed but needs no restart", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = { ...fixturePack("mattstack", "mattstack", "2.0.0"), installedCache: true };
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps.find((s) => s.name === "update-engine")!.status).toBe("skipped");
    expect(calls.some((c) => c.args[1] === "marketplace" && c.args[2] === "update")).toBe(true);
    expect(report.restartNeeded).toBe(false);
    expect(report.ok).toBe(true);
  });

  test("10c: an installed-cache engine keeps every check on the pack checkout", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = { ...fixturePack("mattstack", "mattstack", "2.0.0"), installedCache: true };
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, gitStatus: { [pack.dir]: " M x.ts" } });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain("pack checkout at");
    expect(report.steps[0]!.detail).toContain("has uncommitted changes");
  });

  test("11: cswap sweep warns about exactly the divergent session", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const configDir = tmp("rt-sync-config-");
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    const cswapSessionsDir = tmp("rt-sync-cswap-");
    mkdirSync(join(cswapSessionsDir, "aligned"), { recursive: true });
    symlinkSync(join(configDir, "plugins"), join(cswapSessionsDir, "aligned", "plugins"));
    mkdirSync(join(cswapSessionsDir, "stale", "plugins"), { recursive: true });

    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      configDir,
      cswapSessionsDir,
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.warnings.length).toBe(1);
    expect(report.warnings[0]).toContain("stale");
    expect(report.steps.find((s) => s.name === "cswap-sweep")!.status).toBe("ran");
    expect(report.steps.find((s) => s.name === "cswap-sweep")!.detail).toBe("1 cswap account links another plugins folder");
  });

  test("12: a failed update-pack fails the step with stderr in the detail", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      updateFail: { [pluginId(pack)]: "boom: registry unreachable" },
    });

    const report = await syncPack(pack, engine, deps);

    const updatePack = report.steps.find((s) => s.name === "update-pack")!;
    expect(updatePack.status).toBe("failed");
    expect(updatePack.detail).toContain("boom: registry unreachable");
    expect(report.ok).toBe(false);
    expect(report.steps.some((s) => s.name === "verify-installed")).toBe(false);
  });

  test("13: bumpPatchVersion increments the patch and rewrites the manifest", () => {
    const pack = fixturePack("acme", "local", "0.5.9");

    const { before, after } = bumpPatchVersion(pack.dir);

    expect(before).toBe("0.5.9");
    expect(after).toBe("0.5.10");
    const raw = readFileSync(join(pack.dir, ".claude-plugin", "plugin.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "version": "0.5.10"');
  });

  test("materialize runs between update-engine and check and reports its detail", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const deps = makeDeps(pack, engine, {
      calls: [],
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });

    const report = await syncPack(pack, engine, deps);

    const names = stepNames(report.steps);
    expect(names.indexOf("materialize")).toBe(names.indexOf("update-engine") + 1);
    expect(names.indexOf("check")).toBe(names.indexOf("materialize") + 1);
    expect(report.steps.find((s) => s.name === "materialize")).toEqual({ name: "materialize", status: "ran", detail: "materialized 1" });
  });

  test("materialize warnings reach the report's warnings and leave the step ran", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const deps = makeDeps(pack, engine, {
      calls: [],
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });
    deps.materialize = async () => ({ ok: true, detail: "materialized 1", warnings: ["repo-a: could not set aside /h/gadgets/skills.jsonc: EACCES"] });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps.find((s) => s.name === "materialize")?.status).toBe("ran");
    expect(report.warnings).toContain("repo-a: could not set aside /h/gadgets/skills.jsonc: EACCES");
  });

  test("materialize is asked about the pack being synced", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const deps = makeDeps(pack, engine, {
      calls: [],
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });
    const asked: string[] = [];
    deps.materialize = async (name) => {
      asked.push(name);
      return { ok: true, detail: "materialized 1" };
    };

    await syncPack(pack, engine, deps);

    expect(asked).toEqual(["acme"]);
  });

  test("a failed materialize stops the chain before check", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const deps = makeDeps(pack, engine, {
      calls: [],
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });
    deps.materialize = async () => ({ ok: false, detail: "widgets: widgets extends acme-base@acme, which is not installed" });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards", "pull-engine", "pull-pack", "update-engine", "materialize"]);
    expect(report.steps.at(-1)).toEqual({ name: "materialize", status: "failed", detail: "widgets: widgets extends acme-base@acme, which is not installed" });
    expect(report.ok).toBe(false);
  });

  test("14: a throwing checkPack fails the check step without escaping syncPack", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      checkThrows: true,
    });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards", "pull-engine", "pull-pack", "update-engine", "materialize", "check"]);
    const check = report.steps.find((s) => s.name === "check")!;
    expect(check.status).toBe("failed");
    expect(check.detail).toContain("manifest discovery found nothing");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "plugin" && c.args[1] === "update")).toBe(false);
  });

  test("15: a worktrees directory refuses guards before any calls", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    mkdirSync(join(pack.dir, ".worktrees"), { recursive: true });
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain(join(pack.dir, ".worktrees"));
    expect(report.steps[0]!.detail).toContain("Remove it, then run this again");
    expect(calls).toEqual([]);
  });

  test("16: a pull that rewrites the manifest to a higher version is read post-pull, not stale from guards", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      pullBumps: { [pack.dir]: "0.5.3", [engine.dir]: "2.1.0" },
    });

    const report = await syncPack(pack, engine, deps);

    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName["update-engine"]).toBe("ran");
    expect(byName["update-pack"]).toBe("ran");
    expect(byName["verify-installed"]).toBe("ran");
    expect(report.versions.engine).toEqual({ before: "2.0.0", after: "2.1.0" });
    expect(report.versions.pack).toEqual({ source: "0.5.3", installedBefore: "0.5.2", installedAfter: "0.5.3" });
    expect(report.ok).toBe(true);
  });

  test("17: a failing git status fails guards (not refuses) carrying stderr", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, statusFail: { [engine.dir]: "fatal: not a git repository" } });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("failed");
    expect(report.steps[0]!.detail).toContain("fatal: not a git repository");
    expect(report.ok).toBe(false);
  });

  test("18: a failing git branch fails guards carrying stderr", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, branchFail: { [engine.dir]: "fatal: ambiguous HEAD" } });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("failed");
    expect(report.steps[0]!.detail).toContain("fatal: ambiguous HEAD");
    expect(report.ok).toBe(false);
  });

  test("19: a failing claude plugin list fails guards with stderr, not a JSON parse error", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls });
    const originalRun = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (args[0] === "plugin" && args[1] === "list") return { code: 1, stdout: "", stderr: "claude: command not found" };
      return originalRun(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("failed");
    expect(report.steps[0]!.detail).toContain("claude: command not found");
    expect(report.steps[0]!.detail).not.toContain("Unexpected end of JSON input");
  });

  test("20: pack checkout off main refuses guards", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, branchByDir: { [engine.dir]: "main", [pack.dir]: "feature" } });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain("pack checkout is on feature, not main");
    expect(report.steps[0]!.detail).toContain("main");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "pull")).toBe(false);
  });

  test("21: a compile refusal reverts the version bump write-back so the tree stays clean", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true],
      compileOk: false,
      compileErrors: ["boom: template placeholder unresolved"],
    });

    const report = await syncPack(pack, engine, deps);

    const compile = report.steps.find((s) => s.name === "compile")!;
    expect(compile.status).toBe("refused");
    expect(compile.detail).toContain("boom: template placeholder unresolved");
    expect(compile.detail).toContain("rt put the version back to 0.5.2");
    expect(readVersion(pack.dir)).toBe("0.5.2");
    expect(report.ok).toBe(false);
  });

  test("22: a recheck refusal names the uncommitted bump and compiled output", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true, true],
    });

    const report = await syncPack(pack, engine, deps);

    const recheck = report.steps.find((s) => s.name === "recheck")!;
    expect(recheck.status).toBe("refused");
    expect(recheck.detail).toContain("0.5.2 -> 0.5.3");
    expect(recheck.detail).toContain("uncommitted version bump");
    expect(recheck.detail).toContain("compiled output");
    expect(recheck.detail).toContain("from this working tree");
    // the tree is left as-is (no write-back) on a recheck refusal
    expect(readVersion(pack.dir)).toBe("0.5.3");
  });

  test("23: commit-push stages plugin.json and exactly the files compile wrote and removed, by literal name, never a whole folder", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    mkdirSync(join(pack.dir, "skills"), { recursive: true });
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true, false],
      compileWrites: { written: ["skills/work/SKILL.md"], removed: ["attachments/work/SKILL.md"] },
    });

    const report = await syncPack(pack, engine, deps);

    const git = (verb: string) => calls.find((c) => c.cwd === pack.dir && c.cmd === "git" && c.args[0] === verb)!;
    expect(git("add").args).toEqual(["add", "--", ":(literal).claude-plugin/plugin.json", ":(literal)skills/work/SKILL.md"]);
    expect(git("rm").args).toEqual(["rm", "--cached", "--ignore-unmatch", "--quiet", "--", ":(literal)attachments/work/SKILL.md"]);
    expect(report.steps.find((s) => s.name === "commit-push")!.status).toBe("ran");
  });

  test("24: installedEngineAfter is honest when the chain stops after update-engine", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "1.9.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "1.8.0" },
      drift: [true, true],
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps.find((s) => s.name === "update-engine")!.status).toBe("ran");
    expect(report.steps.find((s) => s.name === "recheck")!.status).toBe("refused");
    expect(report.versions.engine).toEqual({ before: "1.8.0", after: "1.9.0" });
  });

  test("25: a dangling cswap plugins symlink warns instead of silently skipping", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const configDir = tmp("rt-sync-config-");
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    const cswapSessionsDir = tmp("rt-sync-cswap-dangling-");
    const missingTarget = join(cswapSessionsDir, "no-such-target");
    mkdirSync(join(cswapSessionsDir, "dangling"), { recursive: true });
    symlinkSync(missingTarget, join(cswapSessionsDir, "dangling", "plugins"));

    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      configDir,
      cswapSessionsDir,
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.warnings.length).toBe(1);
    expect(report.warnings[0]).toContain("dangling");
  });

  test("26: check step refuses on strict lint hits even with no content drift", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      lintHits: [2],
      lintStrict: [true],
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.ok).toBe(false);
    const checkStep = report.steps.find((s) => s.name === "check")!;
    expect(checkStep.status).toBe("refused");
    expect(checkStep.detail).toContain("mcp lint");
    expect(checkStep.detail).toContain("Fix them before syncing");
    expect(checkStep.detail).not.toContain("rt skills check");
    const names = stepNames(report.steps);
    expect(names.at(-1)).toBe("check");
    for (const later of ["bump", "compile", "recheck", "commit-push", "update-pack"]) expect(names).not.toContain(later);
  });

  test("27: check step is advisory-only on lint hits when the pack is not strict", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      lintHits: [2],
      lintStrict: [false],
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.ok).toBe(true);
    const checkStep = report.steps.find((s) => s.name === "check")!;
    expect(checkStep.status).toBe("ran");
    expect(checkStep.detail).toContain("mcp lint found 2 hits, advisory for this pack");
    expect(checkStep.detail).not.toContain("strictLint");
  });

  test("28: check step carries no lint text at zero hits, even under a strict pack", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      lintHits: [0],
      lintStrict: [true],
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.ok).toBe(true);
    const checkStep = report.steps.find((s) => s.name === "check")!;
    expect(checkStep.status).toBe("ran");
    expect(checkStep.detail).not.toContain("mcp lint");
    expect(checkStep.detail).toMatch(/^the compiled skills are (current|out of date)$/);
  });
});

describe("in-tree engine", () => {
  test("skips every git step for an engine inside inTreeRoot and still refreshes the plugin", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3", tmp("rt-sync-checkout-"));
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.2", "acme@mattstack": "0.1.0" }, drift: [false] };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: dirname(engine.dir) };
    const report = await syncPack(pack, engine, deps);
    const gitInEngine = world.calls.filter((c) => c.cmd === "git" && c.cwd === engine.dir);
    expect(gitInEngine).toEqual([]);
    expect(world.calls.filter((c) => c.cmd === "git" && c.cwd === dirname(engine.dir)).map((c) => c.args.join(" "))).toEqual([
      "branch --show-current",
      "show main:mattstack/.claude-plugin/plugin.json",
    ]);
    expect(world.calls.filter((c) => c.cmd === "git" && c.cwd === pack.dir).map((c) => c.args[0])).toEqual(["status", "branch", "pull"]);
    expect(report.steps.find((s) => s.name === "pull-engine")).toMatchObject({ status: "skipped" });
    expect(report.steps.find((s) => s.name === "update-engine")).toMatchObject({ status: "ran" });
  });

  test("an engine outside inTreeRoot still runs its git steps", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" }, drift: [false] };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: engine.dir.slice(0, -1) };
    await syncPack(pack, engine, deps);
    const gitInEngine = world.calls.filter((c) => c.cmd === "git" && c.cwd === engine.dir).map((c) => c.args[0]);
    expect(gitInEngine).toEqual(["status", "branch", "pull"]);
  });
});

describe("in-tree pack", () => {
  test("a pack inside inTreeRoot skips its git guard and pull and still refreshes the plugin", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.1");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" }, drift: [false] };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: pack.dir };
    const report = await syncPack(pack, engine, deps);
    expect(report.ok).toBe(true);
    expect(world.calls.filter((c) => c.cmd === "git" && c.cwd === pack.dir).map((c) => c.args[0])).toEqual(["branch", "show"]);
    expect(world.calls.filter((c) => c.cmd === "git" && c.cwd === engine.dir).map((c) => c.args[0])).toEqual(["status", "branch", "pull"]);
    expect(report.steps.find((s) => s.name === "pull-pack")).toMatchObject({ status: "skipped" });
    expect(report.steps.find((s) => s.name === "update-pack")).toMatchObject({ status: "ran" });
    expect(report.versions.pack.source).toBe("0.1.1");
  });

  test("the in-tree mattstack pack syncing itself runs only read-only git against main", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.2" }, drift: [false] };
    const deps = { ...makeDeps(engine, engine, world), inTreeRoot: engine.dir };
    const report = await syncPack(engine, engine, deps);
    expect(report.ok).toBe(true);
    expect(world.calls.filter((c) => c.cmd === "git").map((c) => c.args.join(" "))).toEqual([
      "branch --show-current",
      "show main:.claude-plugin/plugin.json",
    ]);
    expect(report.steps.find((s) => s.name === "update-pack")).toMatchObject({ status: "ran" });
    expect(report.versions.pack.installedAfter).toBe("1.2.3");
  });
});

describe("guards message", () => {
  test("names both checkouts when git ran for each", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" }, drift: [false] };
    const report = await syncPack(pack, engine, makeDeps(pack, engine, world));
    expect(report.steps.find((s) => s.name === "guards")!.detail).toBe("engine and pack checkouts clean on main");
  });

  test("says the engine git checks were skipped when only the engine is in-tree", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" }, drift: [false] };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: engine.dir };
    const report = await syncPack(pack, engine, deps);
    expect(report.steps.find((s) => s.name === "guards")!.detail).toBe("pack checkout clean on main; the engine is in the shared checkout, so its git checks are skipped");
  });

  test("says every git check was skipped when the pack is the in-tree engine", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3" }, drift: [false] };
    const deps = { ...makeDeps(engine, engine, world), inTreeRoot: engine.dir };
    const report = await syncPack(engine, engine, deps);
    expect(report.steps.find((s) => s.name === "guards")!.detail).toBe("the engine and the pack are in the shared checkout, so git checks are skipped");
  });
});

describe("inTreeRoot realpath", () => {
  test("an inTreeRoot reached through a symlink still matches the realpath'd engine dir", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const link = join(tmp("rt-sync-link-"), "checkout");
    symlinkSync(engine.dir, link);
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" }, drift: [false] };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: link };
    await syncPack(pack, engine, deps);
    expect(world.calls.filter((c) => c.cmd === "git" && c.cwd === engine.dir).map((c) => c.args[0])).toEqual(["branch", "show"]);
  });

  test("an inTreeRoot that does not exist leaves every git step in place", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" }, drift: [false] };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: join(tmpdir(), "rt-sync-no-such-root") };
    const report = await syncPack(pack, engine, deps);
    expect(report.ok).toBe(true);
    expect(world.calls.filter((c) => c.cmd === "git" && c.cwd === engine.dir).map((c) => c.args[0])).toEqual(["status", "branch", "pull"]);
  });
});

describe("in-tree plugins install from main", () => {
  test("reads the in-tree engine version from main, not the working tree", async () => {
    const root = tmp("rt-sync-checkout-");
    const engine = fixturePack("mattstack", "mattstack", "9.9.9", join(root, "plugins"));
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = {
      calls: [],
      installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" },
      drift: [false],
      mainVersions: { "plugins/mattstack": "1.2.3" },
    };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: root };
    const report = await syncPack(pack, engine, deps);
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "update-engine")).toMatchObject({ status: "skipped", detail: "engine already at 1.2.3" });
    expect(world.calls.filter((c) => c.cmd === "git" && c.cwd === root).map((c) => c.args.join(" "))).toContain(
      "show main:plugins/mattstack/.claude-plugin/plugin.json",
    );
  });

  test("reads the in-tree pack version from main, not the working tree", async () => {
    const root = tmp("rt-sync-checkout-");
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.5.0", join(root, "plugins"));
    const world: World = {
      calls: [],
      installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" },
      drift: [false],
      mainVersions: { "plugins/acme": "0.1.0" },
    };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: root };
    const report = await syncPack(pack, engine, deps);
    expect(report.ok).toBe(true);
    expect(report.versions.pack.source).toBe("0.1.0");
    expect(stepNames(report.steps)).not.toContain("update-pack");
  });

  test("warns without failing when the shared checkout is on another branch", async () => {
    const root = tmp("rt-sync-checkout-");
    const engine = fixturePack("mattstack", "mattstack", "1.2.3", join(root, "plugins"));
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = {
      calls: [],
      installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" },
      drift: [false],
      branchByDir: { [root]: "feature-x" },
    };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: root };
    const report = await syncPack(pack, engine, deps);
    expect(report.ok).toBe(true);
    const pullEngine = report.steps.find((s) => s.name === "pull-engine")!;
    expect(pullEngine.status).toBe("skipped");
    expect(pullEngine.detail).toContain(`the shared checkout at ${root} is on feature-x, not main`);
    expect(pullEngine.detail).toContain("installs from main");
    expect(report.warnings.some((w) => w.startsWith(`The shared checkout at ${root} is on feature-x`))).toBe(true);
  });

  test("names a detached shared checkout as detached", async () => {
    const root = tmp("rt-sync-checkout-");
    const engine = fixturePack("mattstack", "mattstack", "1.2.3", join(root, "plugins"));
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = {
      calls: [],
      installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" },
      drift: [false],
      branchByDir: { [root]: "" },
    };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: root };
    const report = await syncPack(pack, engine, deps);
    expect(report.ok).toBe(true);
    const detail = report.steps.find((s) => s.name === "pull-engine")!.detail;
    expect(detail).toContain(`the shared checkout at ${root} is detached`);
    expect(detail).not.toContain('""');
  });

  test("says nothing about the branch when the shared checkout is on main", async () => {
    const root = tmp("rt-sync-checkout-");
    const engine = fixturePack("mattstack", "mattstack", "1.2.3", join(root, "plugins"));
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" }, drift: [false] };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: root };
    const report = await syncPack(pack, engine, deps);
    expect(report.warnings).toEqual([]);
    expect(report.steps.find((s) => s.name === "pull-engine")!.detail).not.toContain("branch");
  });
});

describe("in-tree pack drift", () => {
  test("refuses before writing anything and never commits or pushes in the shared checkout", async () => {
    const root = tmp("rt-sync-checkout-");
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.0", join(root, "plugins"));
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.3", "acme@mattstack": "0.1.0" }, drift: [true, false] };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: root };
    const report = await syncPack(pack, engine, deps);
    expect(report.ok).toBe(false);
    const bump = report.steps.find((s) => s.name === "bump")!;
    expect(bump.status).toBe("refused");
    expect(bump.detail).toContain("shared checkout");
    expect(bump.detail).toContain("pull request");
    expect(stepNames(report.steps)).not.toContain("commit-push");
    expect(world.calls.some((c) => c.cmd === "git" && (c.args[0] === "commit" || c.args[0] === "push" || c.args[0] === "add"))).toBe(false);
    expect(readVersion(pack.dir)).toBe("0.1.0");
  });
});

describe("commit-pending", () => {
  const gitIn = (calls: Call[], dir: string) => calls.filter((c) => c.cmd === "git" && c.cwd === dir);
  const byName = (steps: { name: string; status: string; detail: string }[]) => Object.fromEntries(steps.map((s) => [s.name, s]));
  const committed = (calls: Call[]) => calls.some((c) => c.cmd === "git" && c.args[0] === "commit");
  const touch = (dir: string, rel: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), "edited\n");
  };

  test("stages pending pack edits after pulling and commits them with the bump, then pushes and updates the cache even with no drift", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    touch(pack.dir, "pack/skills.jsonc");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      gitStatus: { [pack.dir]: " M pack/skills.jsonc\n" },
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false, false],
    };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    const steps = byName(report.steps);
    expect(report.ok).toBe(true);
    expect(steps["commit-pending"]).toMatchObject({ status: "ran", detail: "staged 1 file" });
    expect(steps.bump!.status).toBe("ran");
    expect(steps["commit-push"]!.status).toBe("ran");
    expect(steps["update-pack"]!.status).toBe("ran");
    expect(steps["verify-installed"]!.status).toBe("ran");
    expect(readVersion(pack.dir)).toBe("1.0.1");
    expect(stepNames(report.steps).slice(0, 4)).toEqual(["guards", "pull-engine", "pull-pack", "commit-pending"]);

    const order = world.calls
      .filter((c) => c.cmd === "checkPack" || (c.cwd === pack.dir && ["pull", "add", "commit", "push"].includes(c.args[0]!)))
      .map((c) => (c.cmd === "checkPack" ? "check" : c.args[0] === "commit" ? `commit ${c.args[2]}` : c.args.join(" ")));
    expect(order).toEqual([
      "pull --ff-only",
      "add -- :(literal)pack/skills.jsonc",
      "check",
      "check",
      "commit skills: acme pending changes",
      "add -- :(literal).claude-plugin/plugin.json",
      "commit skills sync: acme v1.0.1",
      "push",
    ]);
  });

  test("stages by literal path only the pending files whose worktree side differs, deletions included", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      gitStatus: { [pack.dir]: " D attachments/old/SKILL.md\n?? skills/new/SKILL.md\n M surface.jsonc\nD  pack/gone.jsonc\nM  pack/staged.jsonc\n?? skills/vanished/SKILL.md\n" },
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [true, false],
    };
    touch(pack.dir, "skills/new/SKILL.md");

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    expect(byName(report.steps)["commit-pending"]).toMatchObject({ status: "ran", detail: "staged 6 files" });
    expect(gitIn(world.calls, pack.dir).find((c) => c.args[0] === "add")!.args).toEqual([
      "add",
      "--",
      ":(literal)attachments/old/SKILL.md",
      ":(literal)skills/new/SKILL.md",
      ":(literal)surface.jsonc",
    ]);
  });

  test("refuses when the pack has edits outside its scope, naming every one", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = { calls: [], gitStatus: { [pack.dir]: " M README.md\n M pack/skills.jsonc\n?? notes/todo.md\n" } };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    const guards = report.steps.find((s) => s.name === "guards")!;
    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(guards.status).toBe("refused");
    expect(guards.detail).toContain("README.md");
    expect(guards.detail).toContain("notes/todo.md");
    expect(guards.detail).not.toContain("pack/skills.jsonc");
    expect(world.calls.some((c) => c.cmd === "git" && ["pull", "add", "commit", "push"].includes(c.args[0]!))).toBe(false);
  });

  test("a staged rename into the pack from outside its scope refuses, naming the outside side", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = { calls: [], gitStatus: { [pack.dir]: "R  README.md -> pack/README.md\n" } };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    const guards = report.steps.find((s) => s.name === "guards")!;
    expect(guards.status).toBe("refused");
    expect(guards.detail).toContain("outside the pack: README.md.");
    expect(world.calls.some((c) => c.cmd === "git" && ["add", "commit"].includes(c.args[0]!))).toBe(false);
  });

  test("a pack inside a larger repo reads its paths relative to the pack and refuses on repo files beside it", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      prefix: { [pack.dir]: "packs/acme/" },
      gitStatus: { [pack.dir]: " M packs/acme/pack/skills.jsonc\n M packs/acme/README.md\n M package.json\n" },
    };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    const guards = report.steps.find((s) => s.name === "guards")!;
    expect(guards.status).toBe("refused");
    expect(guards.detail).toContain("README.md, ../../package.json");
    expect(guards.detail).not.toContain("pack/skills.jsonc");
  });

  test("a pack inside a larger repo stages its own files by pack-relative path", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      prefix: { [pack.dir]: "packs/acme/" },
      gitStatus: { [pack.dir]: " M packs/acme/pack/skills.jsonc\n" },
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [true, false],
    };
    touch(pack.dir, "pack/skills.jsonc");

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    expect(report.ok).toBe(true);
    expect(gitIn(world.calls, pack.dir).find((c) => c.args[0] === "add")!.args).toEqual(["add", "--", ":(literal)pack/skills.jsonc"]);
  });

  test("a clean pack skips the step and syncs as usual", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false] };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    expect(report.ok).toBe(true);
    expect(byName(report.steps)["commit-pending"]).toMatchObject({ status: "skipped" });
    expect(stepNames(report.steps).at(-1)).toBe("check");
    expect(world.calls.some((c) => c.cmd === "git" && ["add", "commit", "push"].includes(c.args[0]!))).toBe(false);
  });

  test("a failed staging stops the chain before anything is bumped or committed", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      gitStatus: { [pack.dir]: " M pack/skills.jsonc\n" },
      gitFail: { add: "fatal: Unable to create '.git/index.lock': File exists." },
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false, false],
    };
    touch(pack.dir, "pack/skills.jsonc");

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    expect(report.ok).toBe(false);
    expect(stepNames(report.steps).at(-1)).toBe("commit-pending");
    expect(byName(report.steps)["commit-pending"]).toMatchObject({ status: "failed" });
    expect(byName(report.steps)["commit-pending"]!.detail).toContain("index.lock");
    expect(readVersion(pack.dir)).toBe("1.0.0");
    expect(committed(world.calls)).toBe(false);
  });

  test("a failed pending commit stops commit-push before the bump commit or push", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      gitStatus: { [pack.dir]: " M pack/skills.jsonc\n" },
      gitFail: { commit: "fatal: unable to write new index file" },
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false, false],
    };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    expect(report.ok).toBe(false);
    expect(byName(report.steps)["commit-push"]).toMatchObject({ status: "failed" });
    expect(byName(report.steps)["commit-push"]!.detail).toContain("unable to write new index file");
    const git = gitIn(world.calls, pack.dir).map((c) => c.args[0]);
    expect(git.filter((a) => a === "commit")).toHaveLength(1);
    expect(git).not.toContain("push");
  });

  test("a materialize failure after staging leaves the edits uncommitted", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      gitStatus: { [pack.dir]: " M pack/skills.jsonc\n" },
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false, false],
    };
    const deps = makeDeps(pack, engine, world);
    deps.materialize = async () => ({ ok: false, detail: "acme: acme extends acme-base@acme, which is not installed" });

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(stepNames(report.steps).at(-1)).toBe("materialize");
    expect(committed(world.calls)).toBe(false);
  });

  test("a compile refusal after staging leaves the edits uncommitted and reverts the bump", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      gitStatus: { [pack.dir]: " M pack/skills.jsonc\n" },
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [true],
      compileOk: false,
      compileErrors: ["boom: template placeholder unresolved"],
    };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true });

    const compile = byName(report.steps).compile!;
    expect(compile.status).toBe("refused");
    expect(compile.detail).toContain("rt put the version back to 1.0.0");
    expect(compile.detail).toContain("still staged");
    expect(readVersion(pack.dir)).toBe("1.0.0");
    expect(committed(world.calls)).toBe(false);
  });

  test("an in-tree pack with pending edits refuses, since sync never commits in the shared checkout", async () => {
    const root = tmp("rt-sync-checkout-");
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.0", join(root, "plugins"));
    const world: World = { calls: [], gitStatus: { [pack.dir]: " M plugins/acme/pack/skills.jsonc\n" } };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: root };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const guards = report.steps.find((s) => s.name === "guards")!;
    expect(guards.status).toBe("refused");
    expect(guards.detail).toContain("is in the shared checkout at");
    expect(world.calls.some((c) => c.cmd === "git" && ["add", "commit", "push", "pull"].includes(c.args[0]!))).toBe(false);
  });

  test("an --expect that does not match the pending read refuses at the safety checks, before anything is pulled or staged", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    touch(pack.dir, "pack/skills.jsonc");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = {
      calls: [],
      gitStatus: { [pack.dir]: " M pack/skills.jsonc\n" },
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false, false],
    };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world), { commitPending: true, expect: "0".repeat(64) });

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]).toMatchObject({ status: "refused" });
    expect(report.steps[0]!.detail).toContain("changed since");
    expect(world.calls.some((c) => c.cmd === "git" && ["pull", "add", "commit", "push"].includes(c.args[0]!))).toBe(false);
  });

  test("without commit-pending a dirty pack is refused as before and no commit-pending step appears", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = { calls: [], gitStatus: { [pack.dir]: " M pack/skills.jsonc\n" } };

    const report = await syncPack(pack, engine, makeDeps(pack, engine, world));

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.detail).toContain("has uncommitted changes");
    expect(gitIn(world.calls, pack.dir).map((c) => c.args)).toEqual([["status", "--porcelain"]]);
  });
});

/** Every git spawn costs real time on a busy machine, and these tests make a few dozen. */
const REAL_GIT_TIMEOUT_MS = 60_000;

const REAL_GIT_ENV = { ...childEnv(), GIT_AUTHOR_NAME: "ci", GIT_AUTHOR_EMAIL: "ci@example.com", GIT_COMMITTER_NAME: "ci", GIT_COMMITTER_EMAIL: "ci@example.com" };

async function realGit(cwd: string, args: string[]): Promise<RunResult> {
  const r = await runCapture(["git", ...args], { cwd, env: REAL_GIT_ENV, stderr: "pipe", timeoutMs: REAL_GIT_TIMEOUT_MS });
  return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
}

function mustGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: REAL_GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A committed pack on main that tracks a local bare remote, so pull and push run for real with no network. */
function realPackRepo(packRel: "" | "packs"): { root: string; remote: string; pack: PackInfo } {
  const remote = tmp("rt-sync-remote-");
  mustGit(remote, "init", "-q", "--bare", "-b", "main");
  const root = packRel ? tmp("rt-sync-repo-") : "";
  const pack = fixturePack("acme", "local", "1.0.0", packRel ? join(root, packRel) : undefined);
  const repoRoot = root || pack.dir;
  mkdirSync(join(pack.dir, "pack"), { recursive: true });
  mkdirSync(join(pack.dir, "attachments", "old"), { recursive: true });
  mkdirSync(join(pack.dir, "skills", "keep"), { recursive: true });
  writeFileSync(join(pack.dir, "skills", "keep", "SKILL.md"), "keep\n");
  writeFileSync(join(pack.dir, "pack", "skills.jsonc"), "{}\n");
  writeFileSync(join(pack.dir, "attachments", "old", "SKILL.md"), "old\n");
  writeFileSync(join(pack.dir, "README.md"), "readme\n");
  if (packRel) writeFileSync(join(repoRoot, "package.json"), "{}\n");
  mustGit(repoRoot, "init", "-q", "-b", "main");
  mustGit(repoRoot, "add", "-A");
  mustGit(repoRoot, "commit", "-q", "-m", "base");
  mustGit(repoRoot, "remote", "add", "origin", remote);
  mustGit(repoRoot, "push", "-q", "-u", "origin", "main");
  return { root: repoRoot, remote, pack };
}

/** Real git for every call inside the pack's repo; the engine, the claude CLI and the compile seams stay fake. */
function realGitDeps(root: string, pack: PackInfo, engine: PackInfo, world: World): SyncDeps {
  const base = makeDeps(pack, engine, world);
  return {
    ...base,
    run: async (cmd, args, opts) => {
      const cwd = opts?.cwd ?? "";
      if (cmd !== "git" || !(cwd === root || cwd.startsWith(`${root}/`))) return base.run(cmd, args, opts);
      world.calls.push({ cmd, args, cwd });
      return realGit(cwd, args);
    },
  };
}

const remoteLog = (remote: string) => mustGit(remote, "log", "--format=%s", "main").trim().split("\n");

const byStep = (steps: { name: string; status: string; detail: string }[]) => Object.fromEntries(steps.map((s) => [s.name, s]));

/** A compile that rewrites one skill, adds another and drops a third, the way a real recompile touches a pack. */
function rebuildingCompile(pack: PackInfo): SyncDeps["compilePack"] {
  return async () => {
    writeFileSync(join(pack.dir, "skills", "keep", "SKILL.md"), "keep, recompiled\n");
    mkdirSync(join(pack.dir, "attachments", "fresh"), { recursive: true });
    writeFileSync(join(pack.dir, "attachments", "fresh", "SKILL.md"), "fresh\n");
    rmSync(join(pack.dir, "attachments", "old"), { recursive: true });
    return { ok: true, errors: [], written: ["skills/keep/SKILL.md", "attachments/fresh/SKILL.md"], removed: ["attachments/old/SKILL.md"] };
  };
}

/** The compiled files and the version are as the base commit left them. */
function expectBuildPutBack(pack: PackInfo): void {
  expect(readVersion(pack.dir)).toBe("1.0.0");
  expect(readFileSync(join(pack.dir, "skills", "keep", "SKILL.md"), "utf8")).toBe("keep\n");
  expect(readFileSync(join(pack.dir, "attachments", "old", "SKILL.md"), "utf8")).toBe("old\n");
  expect(existsSync(join(pack.dir, "attachments", "fresh"))).toBe(false);
}

describe("commit-pending against real git", () => {
  test("a staged deletion, an unstaged deletion and an edit land as one commit, pushed with the bump, and leave the tree clean", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    mustGit(root, "rm", "-q", "attachments/old/SKILL.md");
    rmSync(join(pack.dir, "skills"), { recursive: true });
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true });

    expect(report.ok).toBe(true);
    expect(remoteLog(remote)).toEqual(["skills sync: acme v1.0.1", "skills: acme pending changes", "base"]);
    expect(mustGit(root, "show", "--name-status", "--format=", "HEAD~1").trim().split("\n").sort()).toEqual(["D\tattachments/old/SKILL.md", "D\tskills/keep/SKILL.md", "M\tpack/skills.jsonc"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("");
  }, REAL_GIT_TIMEOUT_MS);

  test("a pack inside a larger repo commits only its own files", async () => {
    const { root, remote, pack } = realPackRepo("packs");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true });

    expect(report.ok).toBe(true);
    expect(remoteLog(remote)).toEqual(["skills sync: acme v1.0.1", "skills: acme pending changes", "base"]);
    expect(mustGit(root, "show", "--name-only", "--format=", "HEAD~1").trim()).toBe("packs/acme/pack/skills.jsonc");
  }, REAL_GIT_TIMEOUT_MS);

  test("a pack inside a larger repo refuses on a dirty file beside it, naming it from the pack", async () => {
    const { root, remote, pack } = realPackRepo("packs");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    writeFileSync(join(root, "package.json"), '{ "name": "acme" }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true });

    expect(report.steps.find((s) => s.name === "guards")).toMatchObject({ status: "refused" });
    expect(report.steps[0]!.detail).toContain("outside the pack: ../../package.json.");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a staged rename across the scope boundary refuses and commits nothing", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    mustGit(root, "mv", "README.md", "pack/README.md");
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true });

    expect(report.steps[0]).toMatchObject({ name: "guards", status: "refused" });
    expect(report.steps[0]!.detail).toContain("outside the pack: README.md.");
    expect(mustGit(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(mustGit(root, "status", "--porcelain")).toBe("R  README.md -> pack/README.md\n");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a compile refusal after staging leaves no new commit and the edit still pending", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = {
      calls: [],
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [true],
      compileOk: false,
      compileErrors: ["boom"],
    };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "compile", status: "refused" });
    expect(mustGit(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\n");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test.each<[string, (dir: string) => void, string]>([
    ["a new file under a pack root", (dir) => writeFileSync(join(dir, "pack", "late.jsonc"), "{}\n"), "M  pack/skills.jsonc\n?? pack/late.jsonc\n"],
    ["a listed file edited again", (dir) => writeFileSync(join(dir, "pack", "skills.jsonc"), '{ "bindings": { "later": {} } }\n'), "MM pack/skills.jsonc\n"],
  ])("%s while the pack is pulled refuses before anything is staged or committed", async (_label, move, after) => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    mustGit(root, "add", "pack/skills.jsonc");
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const deps = realGitDeps(root, pack, engine, world);
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "pull") move(pack.dir);
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "commit-pending", status: "refused" });
    expect(report.steps.at(-1)!.detail).toContain("changed while rt was syncing it");
    expect(world.calls.some((c) => c.cmd === "git" && ["add", "commit", "push"].includes(c.args[0]!))).toBe(false);
    expect(mustGit(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(mustGit(root, "status", "--porcelain")).toBe(after);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("the version commit holds the manifest and exactly what compile wrote and removed, never a file dropped beside them", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = async () => {
      writeFileSync(join(pack.dir, "skills", "keep", "SKILL.md"), "keep, recompiled\n");
      mkdirSync(join(pack.dir, "attachments", "fresh"), { recursive: true });
      writeFileSync(join(pack.dir, "attachments", "fresh", "SKILL.md"), "fresh\n");
      rmSync(join(pack.dir, "attachments", "old"), { recursive: true });
      return { ok: true, errors: [], written: ["skills/keep/SKILL.md", "attachments/fresh/SKILL.md"], removed: ["attachments/old/SKILL.md", "attachments/old/stray.md"] };
    };
    const checkPack = deps.checkPack;
    deps.checkPack = async (name) => {
      const answer = await checkPack(name);
      if (world.calls.filter((c) => c.cmd === "checkPack").length === 2) {
        writeFileSync(join(pack.dir, "skills", "keep", "hand.md"), "dropped in by hand\n");
        writeFileSync(join(pack.dir, "attachments", "fresh", "hand.md"), "dropped in by hand\n");
      }
      return answer;
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.ok).toBe(true);
    expect(remoteLog(remote)).toEqual(["skills sync: acme v1.0.1", "skills: acme pending changes", "base"]);
    expect(mustGit(root, "show", "--name-status", "--format=", "HEAD").trim().split("\n").sort()).toEqual([
      "A\tattachments/fresh/SKILL.md",
      "D\tattachments/old/SKILL.md",
      "M\t.claude-plugin/plugin.json",
      "M\tskills/keep/SKILL.md",
    ]);
    expect(mustGit(root, "status", "--porcelain")).toBe("?? attachments/fresh/hand.md\n?? skills/keep/hand.md\n");
  }, REAL_GIT_TIMEOUT_MS);

  test.each<[string, string, string]>([
    ["a pack file", "attachments/old/extra.md", "attachments/old/extra.md"],
    ["a file beside the pack", "../outside.md", "../outside.md"],
  ])("%s another process stages before the pending commit refuses it, naming the file, with nothing committed or pushed", async (_label, rel, named) => {
    const { root, remote, pack } = realPackRepo("packs");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.materialize = async () => {
      writeFileSync(join(pack.dir, rel), "staged by someone else\n");
      mustGit(pack.dir, "add", "--", rel);
      return { ok: true, detail: "materialized 1" };
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(report.steps.at(-1)!.detail).toContain(named);
    expect(report.steps.at(-1)!.detail).not.toContain("pack/skills.jsonc");
    expect(mustGit(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a listed file another process stages again with new content before the pending commit refuses it, with nothing committed or pushed", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.materialize = async () => {
      writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": { "unseen": {} } }\n');
      mustGit(root, "add", "pack/skills.jsonc");
      return { ok: true, detail: "materialized 1" };
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(report.steps.at(-1)!.detail).toContain("pack/skills.jsonc");
    expect(world.calls.some((c) => c.cmd === "git" && ["commit", "push"].includes(c.args[0]!))).toBe(false);
    expect(mustGit(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a refusal before the pending commit puts the version and the rebuilt skills back and leaves the pack edits staged", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    deps.materialize = async () => {
      writeFileSync(join(pack.dir, "pack", "extra.jsonc"), "{}\n");
      mustGit(root, "add", "pack/extra.jsonc");
      return { ok: true, detail: "materialized 1" };
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(report.steps.at(-1)!.detail).toContain("put the version and the rebuilt skills back");
    expectBuildPutBack(pack);
    expect(mustGit(root, "status", "--porcelain")).toBe("A  pack/extra.jsonc\nM  pack/skills.jsonc\n");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  /** Stages `rel` with `text` the moment rt's pending commit lands, as another process might; `first` runs before the stage. */
  function stageAfterPendingCommit(deps: SyncDeps, root: string, rel: string, text: (now: string | null) => string, first?: () => void): void {
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      const res = await run(cmd, args, opts);
      if (cmd === "git" && args[0] === "commit" && args.includes("skills: acme pending changes")) {
        first?.();
        const path = join(root, rel);
        writeFileSync(path, text(existsSync(path) ? readFileSync(path, "utf8") : null));
        mustGit(root, "add", rel);
      }
      return res;
    };
  }

  test("a file staged between the pending commit and the version commit refuses, undoes rt's own commit and leaves the pack edits staged", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    stageAfterPendingCommit(deps, root, "skills/keep/slipped-in.md", () => "staged by someone else\n");

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(report.steps.at(-1)!.detail).toContain("skills/keep/slipped-in.md");
    expect(report.steps.at(-1)!.detail).toContain("put the version and the rebuilt skills back, so your pack edits are still staged, not committed");
    expect(world.calls.some((c) => c.cmd === "git" && c.args[0] === "push")).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(remoteLog(remote)).toEqual(["base"]);
    expectBuildPutBack(pack);
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\nA  skills/keep/slipped-in.md\n");
    expect(mustGit(root, "reflog", "-1", "--format=%gs").trim()).toBe("rt skills sync: undo acme pending changes");

    mustGit(root, "rm", "-q", "--cached", "skills/keep/slipped-in.md");
    rmSync(join(pack.dir, "skills", "keep", "slipped-in.md"));
    const again: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const next = realGitDeps(root, pack, engine, again);
    next.compilePack = rebuildingCompile(pack);

    const retry = await syncPack(pack, engine, next, { commitPending: true, expect: await changesSignature(pack.dir) });

    expect(retry.ok).toBe(true);
    expect(remoteLog(remote)).toEqual(["skills sync: acme v1.0.1", "skills: acme pending changes", "base"]);
    expect(mustGit(root, "show", "--name-only", "--format=", "HEAD~1").trim()).toBe("pack/skills.jsonc");
  }, REAL_GIT_TIMEOUT_MS);

  test("rt leaves its own commit in place, and names it, once HEAD has moved past it", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const deps = realGitDeps(root, pack, engine, world);
    let rtCommit = "";
    stageAfterPendingCommit(deps, root, "skills/keep/slipped-in.md", () => "staged by someone else\n", () => {
      rtCommit = mustGit(root, "rev-parse", "HEAD").trim();
      mustGit(root, "commit", "-q", "--allow-empty", "-m", "someone else");
    });

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(report.steps.at(-1)!.detail).toContain(rtCommit.slice(0, 12));
    expect(report.steps.at(-1)!.detail).toContain("not pushed; HEAD has moved past it");
    const moves = world.calls.filter((c) => c.cmd === "git" && (c.args[0] === "update-ref" || c.args[0] === "reset" && c.args[1] === "--soft"));
    expect(moves.map((c) => c.args.slice(-3))).toEqual([["HEAD", `${rtCommit}~1`, rtCommit]]);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["someone else", "skills: acme pending changes", "base"]);
    expect(remoteLog(remote)).toEqual(["base"]);
    expect(readVersion(pack.dir)).toBe("1.0.0");
  }, REAL_GIT_TIMEOUT_MS);

  test("a commit rt cannot identify, because a ref is named like its short sha, is left in place and named, never undone", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const deps = realGitDeps(root, pack, engine, world);
    const run = deps.run;
    let printed = "";
    deps.run = async (cmd, args, opts) => {
      const res = await run(cmd, args, opts);
      const short = cmd === "git" && args[0] === "commit" && args.includes("skills: acme pending changes") ? /\[main ([0-9a-f]+)\]/.exec(res.stdout)?.[1] : undefined;
      if (short) {
        printed = short;
        mustGit(root, "tag", short, "HEAD~1");
      }
      return res;
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    const detail = report.steps.at(-1)!.detail;
    expect(detail.split("could not tell which commit git made")).toHaveLength(2);
    expect(printed).toMatch(/^[0-9a-f]{7,}$/);
    expect(detail).toContain(`rt's commit ${printed} (skills: acme pending changes), which is not pushed; rt left it in place. Look over the commit, then run this again`);
    expect(world.calls.some((c) => c.cmd === "git" && c.args[0] === "update-ref")).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["skills: acme pending changes", "base"]);
    expect(readVersion(pack.dir)).toBe("1.0.0");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a file staged while rt makes its pending commit is caught by the tree check, and rt undoes that commit", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "commit" && args.includes("skills: acme pending changes")) {
        writeFileSync(join(pack.dir, "skills", "keep", "sneaked.md"), "staged by someone else\n");
        mustGit(root, "add", "skills/keep/sneaked.md");
      }
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain("while rt committed your pack edits: skills/keep/sneaked.md");
    expect(detail).toContain("still staged, not committed");
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\nA  skills/keep/sneaked.md\n");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a failed push undoes both of rt's commits and puts the build back, so the pack edits are still staged", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const run = deps.run;
    deps.run = async (cmd, args, opts) => (cmd === "git" && args[0] === "push" ? { code: 1, stdout: "", stderr: "fatal: could not read from remote repository" } : run(cmd, args, opts));

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "failed" });
    expect(detail).toContain("git push failed: fatal: could not read from remote repository. The push may have reached the remote, and the next sync's pull will show it; rt put the version and the rebuilt skills back");
    expect(detail).toContain("still staged, not committed");
    expect(detail).not.toContain("pushed nothing");
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "reflog", "-1", "--format=%gs").trim()).toBe("rt skills sync: undo acme pending changes and v1.0.1");
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\n");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a clean pack whose push fails has its version commit undone and the build put back", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const run = deps.run;
    deps.run = async (cmd, args, opts) => (cmd === "git" && args[0] === "push" ? { code: 1, stdout: "", stderr: "fatal: could not read from remote repository" } : run(cmd, args, opts));

    const report = await syncPack(pack, engine, deps);

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "failed" });
    expect(detail).toContain("The push may have reached the remote, and the next sync's pull will show it; rt put the version and the rebuilt skills back, so nothing is committed");
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "reflog", "-1", "--format=%gs").trim()).toBe("rt skills sync: undo acme v1.0.1");
    expect(mustGit(root, "status", "--porcelain")).toBe("");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a clean pack's version commit that HEAD has moved past when its push fails is kept and named as holding the build", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    let versionSha = "";
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "push") {
        versionSha = mustGit(root, "rev-parse", "HEAD").trim();
        mustGit(root, "commit", "-q", "--allow-empty", "-m", "someone else");
        return { code: 1, stdout: "", stderr: "fatal: could not read from remote repository" };
      }
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps);

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "failed" });
    expect(detail).toContain(
      `The push may have reached the remote, and the next sync's pull will show it; the version bump and the rebuilt skills are in rt's commit ${versionSha.slice(0, 12)} (skills sync: acme v1.0.1); HEAD has moved past it, so rt left it in place. Run this again once that is sorted`,
    );
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["someone else", "skills sync: acme v1.0.1", "base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("");
    expect(readVersion(pack.dir)).toBe("1.0.1");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a commit another process makes on top of rt's pending commit refuses the version commit, keeps rt's commit named and puts the build back", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    let rtCommit = "";
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      const res = await run(cmd, args, opts);
      if (cmd === "git" && args[0] === "commit" && args.includes("skills: acme pending changes")) {
        rtCommit = mustGit(root, "rev-parse", "HEAD").trim();
        mustGit(root, "commit", "-q", "--allow-empty", "-m", "someone else");
      }
      return res;
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain(`Something was committed in ${pack.dir} on top of rt's commit of your pack edits`);
    expect(detail).toContain(`your pack edits stay in rt's commit ${rtCommit.slice(0, 12)} (skills: acme pending changes), which is not pushed; HEAD has moved past it`);
    expect(world.calls.filter((c) => c.cmd === "git" && c.args[0] === "commit")).toHaveLength(1);
    expect(world.calls.some((c) => c.cmd === "git" && c.args[0] === "push")).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["someone else", "skills: acme pending changes", "base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a commit another process makes between rt's two commits is never rewound by a failed push: rt keeps both commits and names them", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    let pendingSha = "";
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "commit" && args.includes("skills sync: acme v1.0.1")) {
        pendingSha = mustGit(root, "rev-parse", "HEAD").trim();
        const other = mustGit(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "someone else").trim();
        mustGit(root, "update-ref", "HEAD", other);
      }
      if (cmd === "git" && args[0] === "push") return { code: 1, stdout: "", stderr: "fatal: could not read from remote repository" };
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const versionSha = mustGit(root, "rev-parse", "HEAD").trim();
    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "failed" });
    expect(detail).toContain("git push failed: fatal: could not read from remote repository. The push may have reached the remote, and the next sync's pull will show it");
    expect(detail).toContain(`your pack edits stay in rt's commits ${pendingSha.slice(0, 12)} (skills: acme pending changes) and ${versionSha.slice(0, 12)} (skills sync: acme v1.0.1); a commit rt did not make sits between them, so rt left them in place; the version bump and the rebuilt skills are in them`);
    expect(world.calls.some((c) => c.cmd === "git" && c.args[0] === "update-ref")).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["skills sync: acme v1.0.1", "someone else", "skills: acme pending changes", "base"]);
    expect(readVersion(pack.dir)).toBe("1.0.1");
    expect(mustGit(root, "status", "--porcelain")).toBe("");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a file staged while rt makes its version commit is caught by the tree check, and rt undoes both commits", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "commit" && args.includes("skills sync: acme v1.0.1")) {
        writeFileSync(join(pack.dir, "skills", "keep", "sneaked.md"), "staged by someone else\n");
        mustGit(root, "add", "skills/keep/sneaked.md");
      }
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain(`Something was staged in ${pack.dir} while rt committed the version bump: skills/keep/sneaked.md`);
    expect(detail).toContain("still staged, not committed");
    expect(world.calls.some((c) => c.cmd === "git" && c.args[0] === "push")).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\nA  skills/keep/sneaked.md\n");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a file staged after the version index check and before the version commit is caught by the tree check, and rt undoes both commits", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const run = deps.run;
    let sneaked = false;
    deps.run = async (cmd, args, opts) => {
      if (!sneaked && cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
        sneaked = true;
        writeFileSync(join(pack.dir, "skills", "keep", "sneaked.md"), "staged by someone else\n");
        mustGit(root, "add", "skills/keep/sneaked.md");
      }
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(sneaked).toBe(true);
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain(`Something was staged in ${pack.dir} while rt committed the version bump: skills/keep/sneaked.md`);
    expect(detail).toContain("still staged, not committed");
    expect(world.calls.some((c) => c.cmd === "git" && c.args[0] === "push")).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\nA  skills/keep/sneaked.md\n");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test.each<[string, string, string]>([
    ["inside the pack", "packs/acme/skills/keep/sneaked.md", "M  packs/acme/pack/skills.jsonc\nA  packs/acme/skills/keep/sneaked.md\n"],
    ["beside the pack", "outside.md", "A  outside.md\nM  packs/acme/pack/skills.jsonc\n"],
  ])("a file %s of a subdirectory pack that slips into rt's commit is named from the repo root", async (_label, rel, porcelain) => {
    const { root, remote, pack } = realPackRepo("packs");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "commit" && args.includes("skills: acme pending changes")) {
        writeFileSync(join(root, rel), "staged by someone else\n");
        mustGit(root, "add", rel);
      }
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain(`Something was staged in ${root} while rt committed your pack edits: ${rel}.`);
    expect(detail).not.toContain("../");
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe(porcelain);
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a repo root rt cannot read still refuses a file that slipped into its commit, naming the pack instead", async () => {
    const { root, remote, pack } = realPackRepo("packs");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
      if (cmd === "git" && args[0] === "commit" && args.includes("skills: acme pending changes")) {
        writeFileSync(join(root, "outside.md"), "staged by someone else\n");
        mustGit(root, "add", "outside.md");
      }
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain(`Something was staged in ${pack.dir} while rt committed your pack edits: outside.md.`);
    expect(detail).toContain("put the version and the rebuilt skills back, so your pack edits are still staged, not committed");
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("A  outside.md\nM  packs/acme/pack/skills.jsonc\n");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  const indexLocked = "fatal: Unable to create '.git/index.lock': File exists.";
  const indexCorrupt = "fatal: index file corrupt";
  test.each<[string, () => (cmd: string, args: string[]) => boolean, string, (dir: string) => string]>([
    ["git write-tree before the pending commit", () => (cmd, args) => cmd === "git" && args[0] === "write-tree", indexLocked, () => `git write-tree failed: ${indexLocked}`],
    ["the pending git commit", () => (cmd, args) => cmd === "git" && args[0] === "commit" && args.includes("skills: acme pending changes"), indexLocked, () => `git commit failed: ${indexLocked}`],
    ["index check before the pending commit", () => (cmd, args) => cmd === "git" && args[0] === "diff" && args[1] === "--cached", indexCorrupt, (dir) => `git diff --cached failed in ${dir}: ${indexCorrupt}.`],
    ["git ls-files before the version add", () => (cmd, args) => cmd === "git" && args[0] === "ls-files" && args.includes("--ignored"), indexCorrupt, (dir) => `git ls-files failed in ${dir}: ${indexCorrupt}.`],
    [
      "index check after the version add",
      () => {
        let checks = 0;
        return (cmd, args) => cmd === "git" && args[0] === "diff" && args[1] === "--cached" && ++checks === 2;
      },
      indexCorrupt,
      (dir) => `git diff --cached failed in ${dir}: ${indexCorrupt}.`,
    ],
  ])("a failing %s puts the build back and leaves the pack edits staged", async (_label, failing, stderr, lead) => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const fails = failing();
    const run = deps.run;
    deps.run = async (cmd, args, opts) => (fails(cmd, args) ? { code: 128, stdout: "", stderr } : run(cmd, args, opts));

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "failed" });
    expect(detail).toContain(`${lead(pack.dir)} rt pushed nothing and put the version and the rebuilt skills back, so your pack edits are still staged, not committed`);
    expect(world.calls.some((c) => c.cmd === "git" && c.args[0] === "push")).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\n");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a version git add that fails stages nothing, so the put-back never claims that staging is still in the index", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const run = deps.run;
    const locked = { code: 128, stdout: "", stderr: "fatal: Unable to create '.git/index.lock': File exists." };
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "add" && args.includes(":(literal).claude-plugin/plugin.json")) return locked;
      if (cmd === "git" && args[0] === "reset" && args[1] === "-q") return locked;
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "failed" });
    expect(detail).toContain("git add failed: fatal: Unable to create '.git/index.lock': File exists. rt pushed nothing and put the version and the rebuilt skills back, so your pack edits are still staged, not committed");
    expect(detail).not.toContain("still in the index");
    expect(world.calls.some((c) => c.cmd === "git" && c.args[0] === "reset")).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\n");
    expectBuildPutBack(pack);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a HEAD rt cannot read after a refused undo is reported as unreadable, not as moved", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const deps = realGitDeps(root, pack, engine, world);
    stageAfterPendingCommit(deps, root, "skills/keep/slipped-in.md", () => "staged by someone else\n");
    const run = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "update-ref") return { code: 128, stdout: "", stderr: "fatal: cannot lock ref 'HEAD'" };
      if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return { code: 128, stdout: "", stderr: "fatal: bad object HEAD" };
      return run(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(detail).toContain("rt could not read HEAD (fatal: bad object HEAD)");
    expect(detail).not.toContain("moved past");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a manifest another process edits and stages before the version commit is left as found and named", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    stageAfterPendingCommit(deps, root, ".claude-plugin/plugin.json", (now) => JSON.stringify({ ...JSON.parse(now!), description: "edited elsewhere" }, null, 2) + "\n");

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain("except .claude-plugin/plugin.json, which it left as it found it; .claude-plugin/plugin.json still carries rt's version bump (1.0.0 -> 1.0.1)");
    const manifest = JSON.parse(readFileSync(join(pack.dir, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest).toMatchObject({ version: "1.0.1", description: "edited elsewhere" });
    expect(mustGit(root, "show", ":.claude-plugin/plugin.json")).toContain("edited elsewhere");
    expect(readFileSync(join(pack.dir, "skills", "keep", "SKILL.md"), "utf8")).toBe("keep\n");
    expect(existsSync(join(pack.dir, "attachments", "fresh"))).toBe(false);
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("rt's own version staging that it could not take back is named as still in the index", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const deps = realGitDeps(root, pack, engine, world);
    stageAfterPendingCommit(deps, root, "skills/keep/slipped-in.md", () => "staged by someone else\n");
    const run = deps.run;
    deps.run = async (cmd, args, opts) =>
      cmd === "git" && args[0] === "reset" && args[1] === "-q" ? { code: 128, stdout: "", stderr: "fatal: Unable to create '.git/index.lock': File exists." } : run(cmd, args, opts);

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain(
      "rt pushed nothing and undid its commit, but could not take its own version staging back out of the index (fatal: Unable to create '.git/index.lock': File exists.), so that staging is still in the index: .claude-plugin/plugin.json; the worktree keeps the version bump (1.0.0 -> 1.0.1) and the rebuilt skills, and your pack edits are still staged, not committed",
    );
    expect(mustGit(root, "log", "--format=%s").trim().split("\n")).toEqual(["base"]);
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a bump another process stages along with everything else before the pending commit is left as found and named", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = rebuildingCompile(pack);
    const checkPack = deps.checkPack;
    deps.checkPack = async (name) => {
      const answer = await checkPack(name);
      if (world.calls.filter((c) => c.cmd === "checkPack").length === 2) mustGit(root, "add", "-A");
      return answer;
    };

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    const detail = report.steps.at(-1)!.detail;
    expect(report.steps.at(-1)).toMatchObject({ name: "commit-push", status: "refused" });
    expect(detail).toContain("left what it built as it found it (.claude-plugin/plugin.json");
    expect(detail).toContain("still carries rt's version bump (1.0.0 -> 1.0.1)");
    expect(detail).not.toContain("put the version and the rebuilt skills back");
    expect(readVersion(pack.dir)).toBe("1.0.1");
    expect(mustGit(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a clean pack inside a larger repo commits its rebuilt skills, read from the pack", async () => {
    const { root, remote, pack } = realPackRepo("packs");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = async () => {
      writeFileSync(join(pack.dir, "skills", "keep", "SKILL.md"), "keep, recompiled\n");
      return { ok: true, errors: [], written: ["skills/keep/SKILL.md"], removed: [] };
    };

    const report = await syncPack(pack, engine, deps);

    expect(report.ok).toBe(true);
    expect(mustGit(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual(["packs/acme/.claude-plugin/plugin.json", "packs/acme/skills/keep/SKILL.md"]);
    expect(remoteLog(remote)).toEqual(["skills sync: acme v1.0.1", "base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a compiled file the pack ignores stays out of the version commit instead of failing the add", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(root, ".gitignore"), "*.log\n");
    mustGit(root, "add", ".gitignore");
    mustGit(root, "commit", "-q", "-m", "ignore logs");
    mustGit(root, "push", "-q");
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [true, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.compilePack = async () => {
      writeFileSync(join(pack.dir, "skills", "keep", "SKILL.md"), "keep, recompiled\n");
      writeFileSync(join(pack.dir, "skills", "keep", "build.log"), "noise\n");
      return { ok: true, errors: [], written: ["skills/keep/SKILL.md", "skills/keep/build.log"], removed: [] };
    };

    const report = await syncPack(pack, engine, deps);

    expect(report.ok).toBe(true);
    expect(mustGit(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual([".claude-plugin/plugin.json", "skills/keep/SKILL.md"]);
    expect(remoteLog(remote)[0]).toBe("skills sync: acme v1.0.1");
  }, REAL_GIT_TIMEOUT_MS);

  test("an unstaged deletion the pulled commits also delete is no longer staged, and the rest commits", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const other = tmp("rt-sync-other-");
    mustGit(other, "clone", "-q", remote, "clone");
    const clone = join(other, "clone");
    mustGit(clone, "rm", "-q", "attachments/old/SKILL.md");
    mustGit(clone, "commit", "-q", "-m", "upstream drops old");
    mustGit(clone, "push", "-q");
    rmSync(join(pack.dir, "attachments", "old", "SKILL.md"));
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true });

    expect(report.ok).toBe(true);
    expect(byStep(report.steps)["commit-pending"]).toMatchObject({ status: "ran", detail: "staged 1 file" });
    expect(remoteLog(remote)).toEqual(["skills sync: acme v1.0.1", "skills: acme pending changes", "upstream drops old", "base"]);
    expect(mustGit(root, "show", "--name-only", "--format=", "HEAD~1").trim()).toBe("pack/skills.jsonc");
    expect(mustGit(root, "status", "--porcelain")).toBe("");
  }, REAL_GIT_TIMEOUT_MS);

  test("a staged rename commits, its destination's later edit included, without naming the source to git add", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    mustGit(root, "mv", "attachments/old/SKILL.md", "attachments/old/RENAMED.md");
    mustGit(root, "mv", "pack/skills.jsonc", "pack/renamed.jsonc");
    writeFileSync(join(pack.dir, "pack", "renamed.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true });

    expect(report.ok).toBe(true);
    expect(remoteLog(remote)).toHaveLength(3);
    const tree = mustGit(root, "ls-tree", "-r", "--name-only", "HEAD~1").trim().split("\n");
    expect(tree).toContain("attachments/old/RENAMED.md");
    expect(tree).toContain("pack/renamed.jsonc");
    expect(tree).not.toContain("attachments/old/SKILL.md");
    expect(tree).not.toContain("pack/skills.jsonc");
    expect(mustGit(root, "show", "HEAD~1:pack/renamed.jsonc")).toBe('{ "bindings": {} }\n');
    expect(mustGit(root, "status", "--porcelain")).toBe("");
    const adds = world.calls.filter((c) => c.cmd === "git" && c.args[0] === "add").map((c) => c.args);
    expect(adds[0]).toEqual(["add", "--", ":(literal)pack/renamed.jsonc"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a materialize failure after staging leaves no new commit and the edit still pending", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };
    const deps = realGitDeps(root, pack, engine, world);
    deps.materialize = async () => ({ ok: false, detail: "acme: not installed" });

    const report = await syncPack(pack, engine, deps, { commitPending: true });

    expect(report.steps.at(-1)).toMatchObject({ name: "materialize", status: "failed" });
    expect(mustGit(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(mustGit(root, "status", "--porcelain")).toBe("M  pack/skills.jsonc\n");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);
});

/** What `rt skills changes --json` prints for the pack, read through the verb itself. */
async function changesSignature(packDir: string): Promise<string> {
  const io = captureSkills();
  try {
    await skillsChanges(["--pack", "acme", "--pack-dir", packDir, "--json"]);
    return JSON.parse(io.stdout()).signature as string;
  } finally {
    io.restore();
  }
}

describe("--expect against real git", () => {
  test("the signature rt skills changes printed lets the sync through", async () => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    writeFileSync(join(pack.dir, "skills", "fresh.md"), "fresh\n");
    const signature = await changesSignature(pack.dir);
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true, expect: signature });

    expect(report.ok).toBe(true);
    expect(remoteLog(remote)).toEqual(["skills sync: acme v1.0.1", "skills: acme pending changes", "base"]);
  }, REAL_GIT_TIMEOUT_MS);

  test("a pack inside a larger repo signs the same way changes does", async () => {
    const { root, remote, pack } = realPackRepo("packs");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const signature = await changesSignature(pack.dir);
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true, expect: signature });

    expect(report.ok).toBe(true);
    expect(remoteLog(remote)).toHaveLength(3);
  }, REAL_GIT_TIMEOUT_MS);

  test.each<[string, (dir: string) => void]>([
    ["a listed file edited again", (dir) => writeFileSync(join(dir, "pack", "skills.jsonc"), '{ "bindings": { "later": {} } }\n')],
    ["a new file in scope", (dir) => writeFileSync(join(dir, "attachments", "old", "late.md"), "late\n")],
  ])("%s after the signature was read refuses with nothing pulled, staged, committed or pushed", async (_label, move) => {
    const { root, remote, pack } = realPackRepo("");
    const engine = fixturePack("beacon", "local", "2.0.0");
    writeFileSync(join(pack.dir, "pack", "skills.jsonc"), '{ "bindings": {} }\n');
    const signature = await changesSignature(pack.dir);
    move(pack.dir);
    const before = mustGit(root, "status", "--porcelain");
    const world: World = { calls: [], installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" }, drift: [false, false] };

    const report = await syncPack(pack, engine, realGitDeps(root, pack, engine, world), { commitPending: true, expect: signature });

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]).toMatchObject({ status: "refused" });
    expect(report.steps[0]!.detail).toContain("changed since");
    expect(world.calls.some((c) => c.cmd === "git" && ["pull", "add", "commit", "push"].includes(c.args[0]!))).toBe(false);
    expect(mustGit(root, "status", "--porcelain")).toBe(before);
    expect(mustGit(root, "diff", "--cached", "--name-only")).toBe("");
    expect(remoteLog(remote)).toEqual(["base"]);
  }, REAL_GIT_TIMEOUT_MS);
});
