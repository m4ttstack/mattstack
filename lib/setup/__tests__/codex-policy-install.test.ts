import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { PolicyProof } from "../../agent-integrations/contracts.ts";
import { parseCodexPolicyHookCommand } from "../../agent-integrations/codex/hook-manifest.ts";
import { createCodexPolicy, type CodexPolicyChecker } from "../../agent-integrations/codex/policy.ts";
import {
  applyCodexPolicyInstall, codexPolicyRecovery, planCodexPolicyInstall, type ListedPolicyHook, type PolicyInstallDeps, type PolicyInstallPlan,
} from "../../agent-integrations/codex/policy-install.ts";
import { codexPolicyStep, createCodexPolicyStep } from "../../agent-integrations/codex/install.ts";
import { setupCodexPolicy, type CodexPolicyDeps } from "../../../commands/setup.ts";
import { TREE } from "../../command-tree-def.ts";
import { renderPlain } from "../../ui/out-plain.ts";
import type { ApplyContext } from "../apply.ts";
import type { IntegrationSelection } from "../integration-selection.ts";
import { readSetupState } from "../state.ts";
import { INTEGRATION_STEP_IDS, knownStepIds, STEP_IDS } from "../contract.ts";
import { STEPS } from "../steps/index.ts";
import { setupSteps } from "../steps/agent-integrations.ts";
import { fakeProbes } from "./fakes.ts";

const SNAKE: Record<string, string> = { PreToolUse: "pre_tool_use", Stop: "stop" };
const LISTED: Record<string, string> = { PreToolUse: "preToolUse", Stop: "stop" };

type World = {
  root: string;
  home: string;
  codexHome: string;
  config: string;
  hooksPath: string;
  main: string;
  tree: string;
  untrusted: string;
  rtSource: string;
  /** Changing it changes every native hash, as a Codex that hashes differently would. */
  hashSalt: string;
  /** Folders whose repo turns hooks off (`[features] hooks = false`): hooks/list is empty there. */
  hooksOff: Set<string>;
  /** A symlink to the Codex home, used as the profile when set. */
  profileLink?: string;
  listCalls: string[];
  deps: Partial<PolicyInstallDeps>;
};

let world: World;

const git = (cwd: string, ...args: string[]): string => {
  const run = Bun.spawnSync(["git", ...args], { cwd, env: { PATH: process.env.PATH ?? "", HOME: world.home, GIT_CONFIG_NOSYSTEM: "1" } });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString();
};

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function readConfig(w: World): Record<string, any> {
  return existsSync(w.config) ? (Bun.TOML.parse(readFileSync(w.config, "utf8")) as Record<string, any>) : {};
}

/** The main checkout a linked worktree's project layer comes from. */
const checkoutOf = (cwd: string): string => (cwd === world.tree ? world.main : cwd);

function listFile(sourcePath: string, source: string, config: Record<string, any>): ListedPolicyHook[] {
  if (!existsSync(sourcePath)) return [];
  const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as { hooks?: Record<string, { hooks: { command: string }[] }[]> };
  const listed: ListedPolicyHook[] = [];
  for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
    groups.forEach((group, g) => group.hooks.forEach((handler, h) => {
      const key = `${sourcePath}:${SNAKE[event] ?? event.toLowerCase()}:${g}:${h}`;
      const currentHash = `sha256:${sha(world.hashSalt + JSON.stringify(handler))}`;
      const held = config.hooks?.state?.[key]?.trusted_hash;
      listed.push({
        key, eventName: LISTED[event] ?? event, handlerType: "command", command: handler.command, sourcePath, source, enabled: true,
        currentHash, trustStatus: held === currentHash ? "trusted" : held === undefined ? "untrusted" : "modified",
      });
    }));
  }
  return listed;
}

/**
 * A stand-in for Codex 0.162's hooks/list (userhooks spike): user hooks
 * from `$CODEX_HOME/hooks.json` for every folder, with no folder trust;
 * a project layer's hooks beside them; nothing at all where a repo turns
 * hooks off.
 */
async function fakeListHooks(cwd: string): Promise<Outcome<ListedPolicyHook[]>> {
  world.listCalls.push(cwd);
  if (world.hooksOff.has(cwd)) return { ok: true, data: [] };
  const config = readConfig(world);
  return {
    ok: true,
    data: [...listFile(world.hooksPath, "user", config), ...listFile(join(checkoutOf(cwd), ".codex", "hooks.json"), "project", config)],
  };
}

function makeWorld(): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-policy-install-")));
  const home = join(root, "home");
  const codexHome = join(home, "codex-profile");
  const main = join(root, "repos", "app");
  const untrusted = join(root, "repos", "stranger");
  const tree = join(home, ".mattstack", "rt", "worktrees", "app", "t1");
  mkdirSync(codexHome, { recursive: true });
  for (const repo of [main, untrusted]) {
    mkdirSync(repo, { recursive: true });
    const init = Bun.spawnSync(["git", "init", "-q", repo], { env: { PATH: process.env.PATH ?? "", HOME: home, GIT_CONFIG_NOSYSTEM: "1" } });
    if (init.exitCode !== 0) throw new Error(init.stderr.toString());
    writeFileSync(join(repo, "README.md"), "hello\n");
  }
  mkdirSync(join(main, ".git", "worktrees", "t1"), { recursive: true });
  writeFileSync(join(main, ".git", "worktrees", "t1", "commondir"), "../..\n");
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "t1")}\n`);
  const rtSource = join(root, "app", "Contents", "Helpers", "rt");
  mkdirSync(dirname(rtSource), { recursive: true });
  writeFileSync(rtSource, "Ïúíþ compiled rt build 1", { mode: 0o755 });
  const w: World = {
    root, home, codexHome, config: join(codexHome, "config.toml"), hooksPath: join(codexHome, "hooks.json"), main, tree, untrusted, rtSource,
    hashSalt: "", hooksOff: new Set(), listCalls: [], deps: {},
  };
  w.deps = {
    env: { HOME: home, CODEX_HOME: codexHome },
    home,
    rtSource: () => w.rtSource,
    listHooks: (cwd) => fakeListHooks(cwd),
    attachedSessions: () => [],
    now: () => new Date("2026-10-09T12:00:00Z"),
    randomId: () => "mac-1",
  };
  return w;
}

beforeEach(() => {
  world = makeWorld();
});

afterEach(() => {
  rmSync(world.root, { recursive: true, force: true });
});

async function plan(cwd?: string): Promise<PolicyInstallPlan> {
  const planned = await planCodexPolicyInstall({ ...(cwd !== undefined && { cwd }), profile: profileOf() }, world.deps);
  if (!planned.ok) throw new Error(`plan failed: ${planned.error.message}`);
  return planned.data;
}

async function approve(p: PolicyInstallPlan): Promise<Outcome<void>> {
  return applyCodexPolicyInstall(p, p.reviews.map((r) => r.id), world.deps);
}

/** The untrusted definitions, then the one review approved as a person would. */
async function install(cwd?: string): Promise<{ definitions: PolicyInstallPlan; hooks: PolicyInstallPlan }> {
  const definitions = await plan(cwd);
  expect(definitions.stage).toBe("definitions");
  expect(definitions.reviews).toEqual([]);
  expect(await applyCodexPolicyInstall(definitions, [], world.deps)).toEqual({ ok: true, data: undefined });
  const hooks = await plan(cwd);
  expect(hooks.stage).toBe("hooks");
  expect(await approve(hooks)).toEqual({ ok: true, data: undefined });
  expect((await plan(cwd)).stage).toBe("installed");
  return { definitions, hooks };
}

function allPaths(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    found.push(path);
    if (lstatSync(path).isDirectory()) found.push(...allPaths(path));
  }
  return found;
}

/** Every path under the repos and the pool tree, with each file's bytes, and each repo's full git status. */
function repoFootprint(): string {
  const trees = [join(world.root, "repos"), world.tree];
  const files = trees.flatMap(allPaths).sort().map((p) => (lstatSync(p).isFile() ? `${p} ${sha(readFileSync(p, "utf8"))}` : p));
  const status = [world.main, world.untrusted].map((r) => git(r, "status", "--porcelain", "--ignored", "--untracked-files=all"));
  return JSON.stringify({ files, status });
}

function stateOf() {
  const path = join(world.home, ".mattstack", "rt", "setup-state.json");
  return readSetupState(fakeProbes({ home: world.home, files: existsSync(path) ? { [path]: readFileSync(path, "utf8") } : {} }));
}

/** The profile rt is given: the Codex home itself, or a symlink to it when a test sets `world.profileLink`. */
const profileOf = (): string => world.profileLink ?? world.codexHome;

const policy = (checker?: CodexPolicyChecker) =>
  createCodexPolicy({ env: { HOME: world.home, CODEX_HOME: profileOf() }, ...(checker && { checker: async () => checker }) });
const launch = (cwd: string) => ({
  reservationId: "r1", cwd, mode: "headless" as const, selection: { harness: "codex" as const, options: {} },
  required: ["gate-policy", "continuation-policy"] as const, access: { readRoots: [] },
});
const binding = (value = "thread-1"): SessionBinding => ({
  key: `codex:${value}`, identity: `id-${value}`, native: { harness: "codex", profile: profileOf(), kind: "id", value },
  attachment: { generation: 1, mode: "headless" },
});

/** A live session whose hooks/list is the fake's, and whose check turn is only counted. */
function countingChecker(): CodexPolicyChecker & { turns: number } {
  const c = {
    turns: 0,
    listHooks: async (cwd: string) => fakeListHooks(cwd) as Promise<Outcome<never[]>>,
    policyCheck: async () => {
      c.turns++;
      return { ok: false as const, error: { code: "not-ready" as const, message: "stub check turn" } };
    },
  };
  return c as unknown as CodexPolicyChecker & { turns: number };
}

describe("Codex policy install in the user layer", () => {
  test("install touches nothing under any repo", async () => {
    const before = repoFootprint();
    await install(world.main);
    world.hashSalt = "a new Codex";
    const again = await plan(world.tree);
    expect(again.stage).toBe("hooks");
    expect(await approve(again)).toEqual({ ok: true, data: undefined });
    const checker = countingChecker();
    for (const cwd of [world.main, world.tree]) {
      const prepared = await policy(checker).prepare(launch(cwd));
      if (!prepared.ok) throw new Error(prepared.error.message);
      await policy(checker).verify(binding(`thread-${cwd.length}`), prepared.data, { kind: "launch" });
    }
    expect(checker.turns).toBe(2);
    expect(world.listCalls).toEqual(expect.arrayContaining([world.main, world.tree]));
    expect(repoFootprint()).toBe(before);
    expect(existsSync(join(world.main, ".codex"))).toBe(false);
    expect(readFileSync(join(world.main, ".git", "info", "exclude"), "utf8")).not.toContain("codex");
    expect(readConfig(world).projects).toBeUndefined();
  });

  test("one review shows the Codex home, program, commands and hashes", async () => {
    const definitions = await plan();
    expect(definitions.hooksPath).toBe(world.hooksPath);
    expect(definitions.artifact.path.startsWith(join(world.home, ".mattstack", "rt", "codex-policy", "bin"))).toBe(true);
    expect(definitions.artifact.path).toContain(definitions.artifact.digest.slice(0, 16));
    expect(await applyCodexPolicyInstall(definitions, [], world.deps)).toEqual({ ok: true, data: undefined });
    expect(readConfig(world)).toEqual({});

    const hooks = await plan();
    const review = hooks.reviews[0]!;
    expect(review).toMatchObject({ codexHome: world.codexHome, hooksPath: world.hooksPath, configPath: world.config, executable: definitions.artifact.path, digest: definitions.artifact.digest });
    expect(review.commands).toHaveLength(2);
    for (const c of review.commands) expect(parseCodexPolicyHookCommand(c.command)?.executable).toBe(definitions.artifact.path);
    expect(review.hooks.map((h) => h.key)).toEqual([`${world.hooksPath}:pre_tool_use:0:0`, `${world.hooksPath}:stop:0:0`]);
    for (const h of review.hooks) expect(h.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await approve(hooks)).toEqual({ ok: true, data: undefined });
    expect(Object.keys(readConfig(world).hooks.state).sort()).toEqual(review.hooks.map((h) => h.key).sort());
  });

  test("a worktree and a folder Codex does not trust both read ready after a user-layer install", async () => {
    await install();
    for (const cwd of [world.tree, world.untrusted, world.main]) {
      expect({ cwd, prepared: await policy().prepare(launch(cwd)) }).toMatchObject({ cwd, prepared: { ok: true } });
    }
  });

  test("a repo that turns hooks off reads not ready per session, with no check turn", async () => {
    await install();
    world.hooksOff.add(world.untrusted);
    const checker = countingChecker();
    const p = policy(checker);
    const prepared = await p.prepare(launch(world.untrusted));
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(await p.verify(binding(), prepared.data, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("0 copies") } });
    expect(checker.turns).toBe(0);

    const other = await p.prepare(launch(world.main));
    if (!other.ok) throw new Error(other.error.message);
    await p.verify(binding("thread-2"), other.data, { kind: "launch" });
    expect(checker.turns).toBe(1);
  });

  test("a changed definition reads modified and stays not ready until it is reviewed again", async () => {
    const { hooks: first } = await install();
    world.hashSalt = "codex hashes the new definition differently";
    const checker = countingChecker();
    const p = policy(checker);
    const prepared = await p.prepare(launch(world.main));
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(await p.verify(binding(), prepared.data, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("modified") } });
    expect(checker.turns).toBe(0);

    const again = await plan();
    expect(again.stage).toBe("hooks");
    expect(again.reviews[0]!.id).not.toBe(first.reviews[0]!.id);
    expect(await applyCodexPolicyInstall(again, [first.reviews[0]!.id], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await applyCodexPolicyInstall(again, [first.reviews[0]!.id, again.reviews[0]!.id], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await applyCodexPolicyInstall(again, [], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await approve(again)).toEqual({ ok: true, data: undefined });
    const reviewed = await p.prepare(launch(world.main));
    if (!reviewed.ok) throw new Error(reviewed.error.message);
    await p.verify(binding(), reviewed.data, { kind: "launch" });
    expect(checker.turns).toBe(1);
  });

  test("a second copy of rt's hooks in a project layer is not ready", async () => {
    await install();
    const layer = join(world.main, ".codex", "hooks.json");
    mkdirSync(dirname(layer), { recursive: true });
    writeFileSync(layer, readFileSync(world.hooksPath, "utf8"));
    expect(await policy().prepare(launch(world.tree))).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("twice") } });
    const planned = await planCodexPolicyInstall({ cwd: world.main, profile: world.codexHome }, world.deps);
    expect(planned).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("more than one") } });
  });

  test("rt's hooks listed inline in the profile config as well are refused", async () => {
    const { definitions } = await install();
    const inline = `\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(definitions.manifest.commands[1]!.command)}\ntimeout = 10\n`;
    writeFileSync(world.config, readFileSync(world.config, "utf8") + inline);
    expect(await planCodexPolicyInstall({ profile: world.codexHome }, world.deps)).toMatchObject({ ok: false, error: { code: "refused", message: expect.stringContaining("inline") } });
    expect(await policy().prepare(launch(world.main))).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("inline") } });
  });

  test("existing hook entries survive with every byte outside rt's group", async () => {
    const original = [
      "{",
      '    "description": "my hooks",',
      '    "hooks": {',
      '        "PreToolUse": [',
      '            { "matcher": "shell", "hooks": [ { "type": "command", "command": "/usr/local/bin/audit" } ] }',
      "        ],",
      '        "SessionStart": [{ "hooks": [{ "type": "command", "command": "/usr/local/bin/hello" }] }]',
      "    }",
      "}",
      "",
    ].join("\n");
    writeFileSync(world.hooksPath, original);
    const userConfig = `# my settings\napproval_policy = "never"\n\n[mcp_servers.other]\ncommand = "x"\n`;
    writeFileSync(world.config, userConfig);
    const { hooks } = await install();
    const text = readFileSync(world.hooksPath, "utf8");
    let at = 0;
    for (const ch of original) {
      at = text.indexOf(ch, at);
      expect(at).toBeGreaterThanOrEqual(0);
      at++;
    }
    expect(text.startsWith(original.split("\n").slice(0, 5).join("\n"))).toBe(true);
    expect(text).toContain(original.split("\n")[6]!);
    const parsed = JSON.parse(text);
    expect(parsed.hooks.PreToolUse).toHaveLength(2);
    expect(parsed.hooks.Stop).toHaveLength(1);
    expect(hooks.reviews[0]!.hooks.map((h) => h.key)).toContain(`${world.hooksPath}:pre_tool_use:1:0`);
    expect(readFileSync(world.config, "utf8").startsWith(userConfig)).toBe(true);
    const settled = await plan();
    expect(settled.stage).toBe("installed");
    expect(await approve(settled)).toEqual({ ok: true, data: undefined });
    expect(readFileSync(world.hooksPath, "utf8")).toBe(text);
  });

  test("an identical entry the member installed is used but never adopted", async () => {
    const first = await plan();
    writeFileSync(world.hooksPath, JSON.stringify({
      hooks: Object.fromEntries(first.manifest.commands.map((h) => [h.event, [{ hooks: [{ type: "command", command: h.command, timeout: 10 }] }]])),
    }, null, 2));
    const hand = readFileSync(world.hooksPath, "utf8");
    const definitions = await plan();
    expect(definitions.stage).toBe("definitions");
    expect(definitions.hooksFile.text).toBeNull();
    expect(await applyCodexPolicyInstall(definitions, [], world.deps)).toEqual({ ok: true, data: undefined });
    expect(readFileSync(world.hooksPath, "utf8")).toBe(hand);
    expect(stateOf().codexPolicy!.hooks[world.hooksPath] ?? []).toEqual([]);
  });

  test("an updated rt replaces only its own entries in place and keeps the old program", async () => {
    const { definitions: first } = await install();
    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 2");
    const next = await plan();
    expect(next.stage).toBe("definitions");
    expect(next.artifact.path).not.toBe(first.artifact.path);
    expect(await applyCodexPolicyInstall(next, [], world.deps)).toEqual({ ok: true, data: undefined });
    const file = JSON.parse(readFileSync(world.hooksPath, "utf8"));
    expect(file.hooks.PreToolUse).toHaveLength(1);
    expect(parseCodexPolicyHookCommand(file.hooks.PreToolUse[0].hooks[0].command)?.executable).toBe(next.artifact.path);
    expect(existsSync(first.artifact.path)).toBe(true);
    const rehash = await plan();
    expect(rehash.stage).toBe("hooks");
    expect(rehash.config.replace.sort()).toEqual(rehash.reviews[0]!.hooks.map((h) => h.key).sort());
    expect(await approve(rehash)).toEqual({ ok: true, data: undefined });
    expect((await plan()).stage).toBe("installed");
  });

  test("a hook program changed after the review is refused at launch and needs a fresh review", async () => {
    const { hooks } = await install();
    writeFileSync(hooks.artifact.path, "tampered after review");
    expect(await policy().prepare(launch(world.main))).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining(hooks.artifact.path) } });
    const again = await plan();
    expect(again.stage).toBe("definitions");
    expect(await applyCodexPolicyInstall(again, [hooks.reviews[0]!.id], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await applyCodexPolicyInstall(again, [], world.deps)).toEqual({ ok: true, data: undefined });
    expect(sha(readFileSync(hooks.artifact.path, "utf8"))).toBe(again.artifact.digest);
  });

  test("a hook program the review never recorded is refused at launch", async () => {
    const { hooks } = await install();
    const statePath = join(world.home, ".mattstack", "rt", "setup-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    delete state.codexPolicy.artifacts[hooks.artifact.path];
    writeFileSync(statePath, JSON.stringify(state));
    expect(await policy().prepare(launch(world.main))).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("concurrent config edit refuses patch", async () => {
    const definitions = await plan();
    writeFileSync(world.hooksPath, `{"hooks":{}}\n`);
    expect(await applyCodexPolicyInstall(definitions, [], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readFileSync(world.hooksPath, "utf8")).toBe(`{"hooks":{}}\n`);

    const fresh = await plan();
    expect(await applyCodexPolicyInstall(fresh, [], world.deps)).toEqual({ ok: true, data: undefined });
    const hooks = await plan();
    writeFileSync(world.config, `approval_policy = "never"\n# edited meanwhile\n`);
    expect(await approve(hooks)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readFileSync(world.config, "utf8")).toBe(`approval_policy = "never"\n# edited meanwhile\n`);
  });

  test("denied review trusts nothing and leaves managed work blocked", async () => {
    const definitions = await plan();
    expect(await applyCodexPolicyInstall(definitions, ["made-up"], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(existsSync(world.hooksPath)).toBe(false);
    expect(await applyCodexPolicyInstall(definitions, [], world.deps)).toEqual({ ok: true, data: undefined });
    const hooks = await plan();
    expect(await applyCodexPolicyInstall(hooks, [], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readConfig(world).hooks).toBeUndefined();
    expect(await policy().prepare(launch(world.main))).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("has not trusted") } });
  });

  test("trust does not hot-reload an old worker", async () => {
    await install();
    const first = await policy().prepare(launch(world.tree));
    if (!first.ok) throw new Error(first.error.message);
    const old = binding("thread-old");
    const proof: PolicyProof = {
      sessionKey: old.key, generation: 1, revision: first.data.revision, verified: ["gate-policy", "continuation-policy"], observedAt: 1, kind: "receipts",
      evidence: { turnId: "t", nonce: "n", sourcePath: world.hooksPath, manifest: "old-manifest", runs: { PreToolUse: "a", Stop: "b" } },
    };
    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 2");
    const touched: string[] = [];
    world.deps.attachedSessions = (profile) => {
      touched.push(profile);
      return [old];
    };
    await install();
    expect((await codexPolicyRecovery(world.codexHome, world.deps)).map((b) => b.key)).toEqual([old.key]);
    expect(touched).toEqual([world.codexHome]);
    const next = await policy().prepare(launch(world.tree));
    if (!next.ok) throw new Error(next.error.message);
    expect(next.data.revision).not.toBe(first.data.revision);
    expect(await policy().verify({ ...old, attachment: { generation: 2, mode: "headless" } }, next.data, { kind: "resume", retained: proof })).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("a member's own trust for another hook version is not overwritten", async () => {
    const { hooks } = await install();
    const hook = hooks.reviews[0]!.hooks[0]!;
    writeFileSync(world.config, readFileSync(world.config, "utf8").replace(hook.hash, `sha256:${"0".repeat(64)}`));
    world.hashSalt = "new";
    expect(await planCodexPolicyInstall({ profile: world.codexHome }, world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readConfig(world).hooks.state[hook.key].trusted_hash).toBe(`sha256:${"0".repeat(64)}`);
  });

  test("a script wrapper is never named as the hook program", async () => {
    writeFileSync(world.rtSource, "#!/bin/sh\nexec bun cli.ts \"$@\"\n");
    expect(await planCodexPolicyInstall({ profile: world.codexHome }, world.deps)).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("the hook program is never written through a folder rt does not own", async () => {
    const definitions = await plan();
    const elsewhere = join(world.root, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(dirname(dirname(definitions.artifact.path)), { recursive: true });
    symlinkSync(elsewhere, dirname(definitions.artifact.path));
    expect(await applyCodexPolicyInstall(definitions, [], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(existsSync(world.hooksPath)).toBe(false);
  });

  test("a symlinked Codex home installs once and reads ready through either spelling", async () => {
    world.profileLink = join(world.home, "codex-link");
    symlinkSync(world.codexHome, world.profileLink);
    world.deps.env = { HOME: world.home, CODEX_HOME: world.profileLink };
    const { hooks } = await install(world.main);
    expect(hooks.hooksPath).toBe(join(world.profileLink, "hooks.json"));
    expect(hooks.reviews[0]!.hooks[0]!.key.startsWith(world.hooksPath)).toBe(true);
    const checker = countingChecker();
    const prepared = await policy(checker).prepare(launch(world.tree));
    if (!prepared.ok) throw new Error(prepared.error.message);
    await policy(checker).verify(binding(), prepared.data, { kind: "launch" });
    expect(checker.turns).toBe(1);
  });

  test("a profile that turns hooks off is refused", async () => {
    writeFileSync(world.config, "[features]\nhooks = false\n");
    expect(await planCodexPolicyInstall({ profile: world.codexHome }, world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
  });
});

describe("codex.policy step", () => {
  const ctxFor = (selection: IntegrationSelection): ApplyContext => ({
    p: fakeProbes({ home: world.home, env: { HOME: world.home, CODEX_HOME: world.codexHome } }),
    integrations: selection,
    log: () => {},
  } as unknown as ApplyContext);
  const step = () => createCodexPolicyStep({
    plan: (input) => planCodexPolicyInstall(input, world.deps),
    apply: (p, reviewed) => applyCodexPolicyInstall(p, reviewed, world.deps),
  });

  test("is a Codex step only, outside the shared contract and never update-safe", () => {
    expect((INTEGRATION_STEP_IDS as readonly string[]).includes("codex.policy")).toBe(true);
    expect((STEP_IDS as readonly string[]).includes("codex.policy")).toBe(false);
    expect(codexPolicyStep.updateSafe).toBeUndefined();
    const off = setupSteps(STEPS, { switchOn: false });
    expect(off).toBe(STEPS);
    expect(knownStepIds(off)).toEqual([...STEP_IDS]);
    expect(knownStepIds(setupSteps(STEPS, { switchOn: true, enabled: ["claude"] }))).toEqual([...STEP_IDS]);
    expect(setupSteps(STEPS, { switchOn: true, enabled: ["codex"] }).map((s) => s.id)).toContain("codex.policy");
    expect(step().applies(ctxFor({ switchOn: false }))).toBe(false);
    expect(step().applies(ctxFor({ switchOn: true, enabled: ["claude"] }))).toBe(false);
    expect(step().applies(ctxFor({ switchOn: true, enabled: ["codex"] }))).toBe(true);
  });

  test("writes only untrusted definitions, then reports the review it waits on", async () => {
    const before = repoFootprint();
    const outcome = await step().run(ctxFor({ switchOn: true, enabled: ["codex"] }));
    expect(outcome.state).toBe("needs-you");
    expect(outcome.detail).toContain("rt setup codex-policy");
    expect(existsSync(world.hooksPath)).toBe(true);
    expect(readConfig(world)).toEqual({});
    expect(repoFootprint()).toBe(before);
  });

  test("is done once the hooks are trusted", async () => {
    await install();
    expect(await step().run(ctxFor({ switchOn: true, enabled: ["codex"] }))).toEqual({ state: "done", detail: "Codex's policy is set up for every repo" });
  });
});

describe("rt setup codex-policy", () => {
  type Run = { shown: string; failed: string[]; exitCode: number | undefined; confirms: string[] };

  async function run(opts: { tty?: boolean; enabled?: boolean; answers?: boolean[] } = {}): Promise<Run> {
    const shown: string[] = [];
    const failed: string[] = [];
    const confirms: string[] = [];
    const answers = [...(opts.answers ?? [])];
    let exitCode: number | undefined;
    const deps: CodexPolicyDeps = {
      isTTY: () => opts.tty ?? true,
      confirm: async (message) => {
        confirms.push(message);
        return answers.shift() ?? false;
      },
      show: (...blocks) => shown.push(renderPlain(blocks)),
      fail: (f) => failed.push(f.title),
      exit: ((code: number) => {
        exitCode = code;
        throw new Error(`exit ${code}`);
      }) as (code: number) => never,
      codexEnabled: () => opts.enabled ?? true,
      profile: () => world.codexHome,
      plan: (input) => planCodexPolicyInstall(input, world.deps),
      apply: (p, reviewed) => applyCodexPolicyInstall(p, reviewed, world.deps),
      recovery: (profile) => codexPolicyRecovery(profile, world.deps),
    };
    try {
      await setupCodexPolicy([], {}, deps);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("exit ")) throw err;
    }
    return { shown: shown.join("\n"), failed, exitCode, confirms };
  }

  test("needs a person at a terminal and writes nothing without one", async () => {
    const result = await run({ tty: false, answers: [true] });
    expect(result.exitCode).toBe(2);
    expect(result.failed).toEqual(["Reviewing Codex's policy needs you at a terminal"]);
    expect(result.confirms).toEqual([]);
    expect(existsSync(world.hooksPath)).toBe(false);
  });

  test("does nothing while Codex is not turned on", async () => {
    const result = await run({ enabled: false, answers: [true] });
    expect(result.exitCode).toBe(2);
    expect(result.confirms).toEqual([]);
    expect(existsSync(world.hooksPath)).toBe(false);
  });

  test("one confirm, showing the exact Codex home, program, commands and hashes", async () => {
    const before = repoFootprint();
    const result = await run({ answers: [true] });
    expect(result.exitCode).toBeUndefined();
    expect(result.confirms).toEqual(["Trust these hooks in Codex?"]);
    expect(result.shown).toContain(world.codexHome);
    expect(result.shown).toContain(world.hooksPath);
    expect(result.shown).toContain("agent policy-hook --installation");
    expect(result.shown).toMatch(/sha256:[0-9a-f]{64}/);
    expect(result.shown).toContain(`${world.hooksPath}:stop:0:0`);
    expect(result.shown).toContain("Codex's policy is set up");
    expect((await plan()).stage).toBe("installed");
    expect(repoFootprint()).toBe(before);
  });

  test("a declined review trusts nothing", async () => {
    const result = await run({ answers: [false] });
    expect(result.exitCode).toBe(1);
    expect(result.shown).toContain("Managed Codex work stays blocked");
    expect(readConfig(world).hooks).toBeUndefined();
    expect(await policy().prepare(launch(world.main))).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("is hidden from agents: no --json, not agent-safe, terminal only", () => {
    const node = TREE.setup!.subcommands!["codex-policy"]!;
    expect(node.agentSafe).toBeUndefined();
    expect(node.hidden).toBe(true);
    expect(node.requiresTTY).toBe(true);
    expect(node.args?.some((a) => a.flag === "--json")).toBe(false);
  });
});
