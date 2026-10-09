import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { PolicyProof } from "../../agent-integrations/contracts.ts";
import { CODEX_POLICY_EVENTS, parseCodexPolicyHookCommand } from "../../agent-integrations/codex/hook-manifest.ts";
import { createCodexPolicy } from "../../agent-integrations/codex/policy.ts";
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
  main: string;
  tree: string;
  rtSource: string;
  /** Changing it changes every native hash, as a Codex that hashes differently would. */
  hashSalt: string;
  /** Folders hooks/list answers with nothing for, as Codex does outside a trusted project boundary. */
  omit: Set<string>;
  listCalls: string[];
  deps: Partial<PolicyInstallDeps>;
};

let world: World;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readConfig(w: World): Record<string, any> {
  return existsSync(w.config) ? (Bun.TOML.parse(readFileSync(w.config, "utf8")) as Record<string, any>) : {};
}

/** The main checkout of a linked worktree, the way trust.ts and policy.ts follow it. */
function boundaryOf(w: World, cwd: string): string {
  return cwd === w.tree ? w.main : cwd;
}

/**
 * A stand-in for Codex 0.162's hooks/list: project hooks appear only once
 * the project boundary is trusted, a linked worktree's come from its main
 * checkout, and each carries a native key, hash and trust status.
 */
async function fakeListHooks(cwd: string): Promise<Outcome<ListedPolicyHook[]>> {
  world.listCalls.push(cwd);
  if (world.omit.has(cwd)) return { ok: true, data: [] };
  const boundary = boundaryOf(world, cwd);
  const config = readConfig(world);
  if (config.projects?.[boundary]?.trust_level !== "trusted") return { ok: true, data: [] };
  const sourcePath = join(boundary, ".codex", "hooks.json");
  if (!existsSync(sourcePath)) return { ok: true, data: [] };
  const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as { hooks?: Record<string, { hooks: { command: string }[] }[]> };
  const listed: ListedPolicyHook[] = [];
  for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
    groups.forEach((group, g) => group.hooks.forEach((handler, h) => {
      const key = `${sourcePath}:${SNAKE[event] ?? event.toLowerCase()}:${g}:${h}`;
      const currentHash = `sha256:${sha(world.hashSalt + JSON.stringify(handler))}`;
      const trusted = config.hooks?.state?.[key]?.trusted_hash === currentHash;
      listed.push({
        key, eventName: LISTED[event] ?? event, handlerType: "command", command: handler.command, sourcePath, source: "project",
        enabled: true, currentHash, trustStatus: trusted ? "trusted" : "untrusted",
      });
    }));
  }
  return { ok: true, data: listed };
}

function makeWorld(): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-policy-install-")));
  const home = join(root, "home");
  const codexHome = join(home, "codex-profile");
  const main = join(root, "repos", "app");
  const tree = join(home, ".mattstack", "rt", "worktrees", "app", "t1");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(join(main, ".git", "worktrees", "t1"), { recursive: true });
  writeFileSync(join(main, ".git", "worktrees", "t1", "commondir"), "../..\n");
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "t1")}\n`);
  const rtSource = join(root, "app", "Contents", "Helpers", "rt");
  mkdirSync(dirname(rtSource), { recursive: true });
  writeFileSync(rtSource, "Ïúíþ compiled rt build 1", { mode: 0o755 });
  const w: World = {
    root, home, codexHome, config: join(codexHome, "config.toml"), main, tree, rtSource, hashSalt: "", omit: new Set(), listCalls: [],
    deps: {},
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

async function plan(cwd: string = world.tree): Promise<PolicyInstallPlan> {
  const planned = await planCodexPolicyInstall({ cwd, profile: world.codexHome }, world.deps);
  if (!planned.ok) throw new Error(`plan failed: ${planned.error.message}`);
  return planned.data;
}

async function approve(p: PolicyInstallPlan): Promise<Outcome<void>> {
  return applyCodexPolicyInstall(p, p.reviews.map((r) => r.id), world.deps);
}

/** Both review stages, each approved as a person would. */
async function installBoth(cwd: string = world.tree): Promise<{ folder: PolicyInstallPlan; hooks: PolicyInstallPlan }> {
  const folder = await plan(cwd);
  expect(folder.stage).toBe("folder");
  expect(await approve(folder)).toEqual({ ok: true, data: undefined });
  const hooks = await plan(cwd);
  expect(hooks.stage).toBe("hooks");
  expect(await approve(hooks)).toEqual({ ok: true, data: undefined });
  return { folder, hooks };
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

function stateOf() {
  return readSetupState(fakeProbes({ home: world.home, files: existsSync(join(world.home, ".mattstack", "rt", "setup-state.json")) ? { [join(world.home, ".mattstack", "rt", "setup-state.json")]: readFileSync(join(world.home, ".mattstack", "rt", "setup-state.json"), "utf8") } : {} }));
}

const policy = () => createCodexPolicy({ env: { HOME: world.home, CODEX_HOME: world.codexHome } });
const launch = (cwd: string) => ({
  reservationId: "r1", cwd, mode: "headless" as const, selection: { harness: "codex" as const, options: {} },
  required: ["gate-policy", "continuation-policy"] as const, access: { readRoots: [] },
});

describe("Codex policy install", () => {
  test("nested worktree trust uses actual boundary", async () => {
    const before = new Set(allPaths(world.root));
    const folder = await plan(world.tree);
    expect(folder.boundary).toBe(world.main);
    expect(folder.hooksPath).toBe(join(world.main, ".codex", "hooks.json"));
    expect(folder.stage).toBe("folder");
    expect(folder.reviews).toHaveLength(1);
    const review = folder.reviews[0]!;
    expect(review.stage).toBe("folder");
    expect(review.boundary).toBe(world.main);
    expect(review.commands).toHaveLength(2);
    for (const command of review.commands) expect(parseCodexPolicyHookCommand(command.command)?.executable).toBe(folder.artifact.path);
    expect(folder.artifact.path.startsWith(join(world.home, ".mattstack", "rt", "codex-policy", "bin"))).toBe(true);
    expect(folder.artifact.path).toContain(folder.artifact.digest.slice(0, 16));

    expect(await approve(folder)).toEqual({ ok: true, data: undefined });
    let config = readConfig(world);
    expect(Object.keys(config.projects)).toEqual([world.main]);
    expect(config.projects[world.main]).toEqual({ trust_level: "trusted" });
    expect(config.hooks).toBeUndefined();

    const hooks = await plan(world.tree);
    expect(hooks.stage).toBe("hooks");
    expect(world.listCalls).toContain(world.tree);
    const hookReview = hooks.reviews[0]!;
    expect(hookReview.stage).toBe("hooks");
    expect(hookReview.hooks.map((h) => h.key)).toEqual([
      `${world.main}/.codex/hooks.json:pre_tool_use:0:0`,
      `${world.main}/.codex/hooks.json:stop:0:0`,
    ]);
    for (const hook of hookReview.hooks) expect(hook.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await approve(hooks)).toEqual({ ok: true, data: undefined });

    config = readConfig(world);
    expect(Object.keys(config.projects)).toEqual([world.main]);
    expect(Object.keys(config.hooks.state).sort()).toEqual(hookReview.hooks.map((h) => h.key).sort());

    const created = allPaths(world.root).filter((p) => !before.has(p));
    expect(created.filter((p) => p.endsWith("/.git") || p.includes("/.git/"))).toEqual([]);
    expect(created.some((p) => p.startsWith(join(world.tree, ".codex")))).toBe(false);
    expect(statSync(join(world.tree, ".git")).isFile()).toBe(true);
    expect(dirname(world.main)).not.toBe(world.main);
    expect(config.projects[dirname(world.main)]).toBeUndefined();
    expect(config.projects[world.tree]).toBeUndefined();

    expect((await plan(world.tree)).stage).toBe("installed");
    const prepared = await policy().prepare(launch(world.tree));
    expect(prepared.ok).toBe(true);
  });

  test("a folder outside any git checkout is refused and never made one", async () => {
    const loose = join(world.root, "loose");
    mkdirSync(loose);
    const planned = await planCodexPolicyInstall({ cwd: loose, profile: world.codexHome }, world.deps);
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error.code).toBe("refused");
    expect(existsSync(join(loose, ".git"))).toBe(false);
    expect(existsSync(world.config)).toBe(false);
  });

  test("trust given only to the nested folder does not stand in for the boundary", async () => {
    writeFileSync(world.config, `[projects.${JSON.stringify(world.tree)}]\ntrust_level = "trusted"\n`);
    const folder = await plan(world.tree);
    expect(folder.stage).toBe("folder");
    expect(folder.boundary).toBe(world.main);
  });

  test("trusting the folder cannot read as ready when hooks/list omits the project hooks", async () => {
    const folder = await plan(world.tree);
    expect(await approve(folder)).toEqual({ ok: true, data: undefined });
    world.omit.add(world.tree);
    const planned = await planCodexPolicyInstall({ cwd: world.tree, profile: world.codexHome }, world.deps);
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.error.code).toBe("not-ready");
      expect(planned.error.message).toContain("does not load");
    }
    expect(readConfig(world).hooks).toBeUndefined();
  });

  test("existing hook entries survive", async () => {
    const hooksPath = join(world.main, ".codex", "hooks.json");
    mkdirSync(dirname(hooksPath), { recursive: true });
    const userFile = {
      description: "team hooks",
      hooks: {
        PreToolUse: [{ matcher: "shell", hooks: [{ type: "command", command: "/usr/local/bin/audit", timeout: 3 }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "/usr/local/bin/hello" }] }],
      },
    };
    writeFileSync(hooksPath, JSON.stringify(userFile, null, 2));
    const userConfig = `# my settings\napproval_policy = "never"\n\n[mcp_servers.other]\ncommand = "x"\n`;
    writeFileSync(world.config, userConfig);

    const { hooks } = await installBoth();
    const written = JSON.parse(readFileSync(hooksPath, "utf8"));
    expect(written.description).toBe("team hooks");
    expect(written.hooks.SessionStart).toEqual(userFile.hooks.SessionStart);
    expect(written.hooks.PreToolUse[0]).toEqual(userFile.hooks.PreToolUse[0]);
    expect(written.hooks.PreToolUse).toHaveLength(2);
    expect(written.hooks.Stop).toHaveLength(1);
    expect(hooks.reviews[0]!.hooks.map((h) => h.key)).toContain(`${hooksPath}:pre_tool_use:1:0`);

    const config = readFileSync(world.config, "utf8");
    expect(config.startsWith(userConfig)).toBe(true);
    expect(Bun.TOML.parse(config)).toMatchObject({ approval_policy: "never", mcp_servers: { other: { command: "x" } } });

    const before = readFileSync(hooksPath, "utf8");
    const again = await plan();
    expect(again.stage).toBe("installed");
    expect(await approve(again)).toEqual({ ok: true, data: undefined });
    expect(readFileSync(hooksPath, "utf8")).toBe(before);
    expect(await policy().prepare(launch(world.tree))).toMatchObject({ ok: true });
  });

  test("an identical entry the member installed is used but never adopted", async () => {
    const first = await plan(world.main);
    const hooksPath = join(world.main, ".codex", "hooks.json");
    mkdirSync(dirname(hooksPath), { recursive: true });
    const handlers = first.reviews[0]!.commands;
    writeFileSync(hooksPath, JSON.stringify({
      hooks: Object.fromEntries(handlers.map((h) => [h.event, [{ hooks: [{ type: "command", command: h.command, timeout: 10 }] }]])),
    }, null, 2));
    writeFileSync(world.config, `[projects.${JSON.stringify(world.main)}]\ntrust_level = "trusted"\n`);
    const handBefore = readFileSync(hooksPath, "utf8");

    const folder = await plan(world.main);
    expect(folder.stage).toBe("folder");
    expect(folder.hooksFile.text).toBeNull();
    expect(folder.config.addFolder).toBe(false);
    expect(await approve(folder)).toEqual({ ok: true, data: undefined });
    expect(readFileSync(hooksPath, "utf8")).toBe(handBefore);

    const state = stateOf().codexPolicy!;
    expect(state.hooks[hooksPath] ?? []).toEqual([]);
    expect(state.trust[world.config]?.folders ?? []).toEqual([]);
  });

  test("new hash requires fresh review", async () => {
    const { hooks: first } = await installBoth();
    const oldId = first.reviews[0]!.id;

    world.hashSalt = "codex changed how it hashes";
    const changed = await plan();
    expect(changed.stage).toBe("hooks");
    const newId = changed.reviews[0]!.id;
    expect(newId).not.toBe(oldId);
    expect(await applyCodexPolicyInstall(changed, [oldId], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await applyCodexPolicyInstall(changed, [], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await applyCodexPolicyInstall(changed, [oldId, newId], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readConfig(world).hooks.state[changed.reviews[0]!.hooks[0]!.key].trusted_hash).not.toBe(changed.reviews[0]!.hooks[0]!.hash);
    expect(await approve(changed)).toEqual({ ok: true, data: undefined });
    const state = readConfig(world).hooks.state as Record<string, { trusted_hash: string }>;
    for (const hook of changed.reviews[0]!.hooks) expect(state[hook.key]!.trusted_hash).toBe(hook.hash);
    expect((await plan()).stage).toBe("installed");
  });

  test("an updated rt asks again, replaces only its own entries and keeps the old executable", async () => {
    const { folder: first } = await installBoth();
    const oldArtifact = first.artifact.path;
    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 2");

    const next = await plan();
    expect(next.stage).toBe("folder");
    expect(next.artifact.path).not.toBe(oldArtifact);
    expect(await approve(next)).toEqual({ ok: true, data: undefined });
    const hooksFile = JSON.parse(readFileSync(next.hooksPath, "utf8"));
    expect(hooksFile.hooks.PreToolUse).toHaveLength(1);
    expect(parseCodexPolicyHookCommand(hooksFile.hooks.PreToolUse[0].hooks[0].command)?.executable).toBe(next.artifact.path);
    expect(existsSync(oldArtifact)).toBe(true);

    const rehash = await plan();
    expect(rehash.stage).toBe("hooks");
    expect(await approve(rehash)).toEqual({ ok: true, data: undefined });
    expect((await plan()).stage).toBe("installed");
  });

  test("a changed script artifact needs a fresh review even when the native hash is unchanged", async () => {
    const { hooks: installed } = await installBoth();
    writeFileSync(installed.artifact.path, "tampered");
    const again = await plan();
    expect(again.stage).toBe("folder");
    expect(await applyCodexPolicyInstall(again, [installed.reviews[0]!.id], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readFileSync(installed.artifact.path, "utf8")).toBe("tampered");
    expect(await approve(again)).toEqual({ ok: true, data: undefined });
    expect(sha(readFileSync(installed.artifact.path, "utf8"))).toBe(again.artifact.digest);
  });

  test("an artifact replaced after the review was planned is refused", async () => {
    const folder = await plan();
    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 3");
    expect(await approve(folder)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(existsSync(folder.artifact.path)).toBe(false);
  });

  test("concurrent config edit refuses patch", async () => {
    writeFileSync(world.config, `approval_policy = "never"\n`);
    const folder = await plan();
    writeFileSync(world.config, `approval_policy = "never"\n# edited meanwhile\n`);
    const applied = await approve(folder);
    expect(applied).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readFileSync(world.config, "utf8")).toBe(`approval_policy = "never"\n# edited meanwhile\n`);
    expect(existsSync(folder.hooksPath)).toBe(false);

    const replanned = await plan();
    expect(await approve(replanned)).toEqual({ ok: true, data: undefined });
    const hooks = await plan();
    mkdirSync(dirname(hooks.hooksPath), { recursive: true });
    writeFileSync(hooks.hooksPath, `${readFileSync(hooks.hooksPath, "utf8")}\n`);
    expect(await approve(hooks)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readConfig(world).hooks).toBeUndefined();
  });

  test("denied review writes nothing and leaves managed work blocked", async () => {
    const folder = await plan();
    expect(await applyCodexPolicyInstall(folder, [], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await applyCodexPolicyInstall(folder, ["made-up"], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(existsSync(world.config)).toBe(false);
    expect(existsSync(folder.hooksPath)).toBe(false);
    expect(existsSync(folder.artifact.path)).toBe(false);
    expect(await policy().prepare(launch(world.tree))).toMatchObject({ ok: false, error: { code: "not-ready" } });

    expect(await approve(folder)).toEqual({ ok: true, data: undefined });
    const hooks = await plan();
    expect(await applyCodexPolicyInstall(hooks, [folder.reviews[0]!.id], world.deps)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await policy().prepare(launch(world.tree))).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("trust does not hot-reload an old worker", async () => {
    await installBoth();
    const first = await policy().prepare(launch(world.tree));
    if (!first.ok) throw new Error(first.error.message);
    const binding: SessionBinding = {
      key: "codex:old", identity: "id-old", native: { harness: "codex", profile: world.codexHome, kind: "id", value: "thread-old" },
      attachment: { generation: 2, mode: "headless" },
    };
    const proof: PolicyProof = {
      sessionKey: binding.key, generation: 1, revision: first.data.revision, verified: ["gate-policy", "continuation-policy"], observedAt: 1, kind: "receipts",
      evidence: { turnId: "t", nonce: "n", sourcePath: join(world.main, ".codex", "hooks.json"), manifest: "old-manifest", runs: { PreToolUse: "a", Stop: "b" } },
    };

    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 2");
    const touched: string[] = [];
    world.deps.attachedSessions = (profile) => {
      touched.push(profile);
      return [binding];
    };
    await installBoth();
    const recovery = await codexPolicyRecovery(world.codexHome, world.deps);
    expect(recovery.map((b) => b.key)).toEqual(["codex:old"]);
    expect(touched).toEqual([world.codexHome]);

    const next = await policy().prepare(launch(world.tree));
    if (!next.ok) throw new Error(next.error.message);
    expect(next.data.revision).not.toBe(first.data.revision);
    const kept = await policy().verify(binding, next.data, { kind: "resume", retained: proof });
    expect(kept).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("hooks listed inside the project config are never installed twice", async () => {
    mkdirSync(join(world.main, ".codex"), { recursive: true });
    writeFileSync(join(world.main, ".codex", "config.toml"), `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "/bin/true"\n`);
    const planned = await planCodexPolicyInstall({ cwd: world.tree, profile: world.codexHome }, world.deps);
    expect(planned).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(existsSync(join(world.main, ".codex", "hooks.json"))).toBe(false);
  });

  test("a folder the member told Codex not to trust is left alone", async () => {
    writeFileSync(world.config, `[projects.${JSON.stringify(world.main)}]\ntrust_level = "untrusted"\n`);
    const planned = await planCodexPolicyInstall({ cwd: world.tree, profile: world.codexHome }, world.deps);
    expect(planned).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  test("another rt policy hook this Mac did not add is refused", async () => {
    const hooksPath = join(world.main, ".codex", "hooks.json");
    mkdirSync(dirname(hooksPath), { recursive: true });
    const foreign = `'/opt/other/rt' agent policy-hook --installation 'elsewhere' --event 'Stop' --executable '/opt/other/rt'`;
    writeFileSync(hooksPath, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: foreign, timeout: 10 }] }] } }));
    const planned = await planCodexPolicyInstall({ cwd: world.tree, profile: world.codexHome }, world.deps);
    expect(planned).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  test("a member's own trust for an older hook version is not overwritten", async () => {
    const { hooks } = await installBoth();
    const key = hooks.reviews[0]!.hooks[0]!.key;
    const text = readFileSync(world.config, "utf8");
    // The member re-trusted the hook themselves, so the entry is no longer the one rt wrote.
    writeFileSync(world.config, text.replace(hooks.reviews[0]!.hooks[0]!.hash, "sha256:" + "0".repeat(64)));
    world.hashSalt = "new";
    const planned = await planCodexPolicyInstall({ cwd: world.tree, profile: world.codexHome }, world.deps);
    expect(planned).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(readConfig(world).hooks.state[key].trusted_hash).toBe("sha256:" + "0".repeat(64));
  });

  test("a script wrapper is never named as the hook executable", async () => {
    writeFileSync(world.rtSource, "#!/bin/sh\nexec bun cli.ts \"$@\"\n");
    const planned = await planCodexPolicyInstall({ cwd: world.tree, profile: world.codexHome }, world.deps);
    expect(planned).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });
});

describe("codex.policy step contract", () => {
  test("is a Codex step only, outside the shared contract and never update-safe", () => {
    expect((INTEGRATION_STEP_IDS as readonly string[]).includes("codex.policy")).toBe(true);
    expect((STEP_IDS as readonly string[]).includes("codex.policy")).toBe(false);
    expect(codexPolicyStep.updateSafe).toBeUndefined();
    const off = setupSteps(STEPS, { switchOn: false });
    expect(off).toBe(STEPS);
    expect(knownStepIds(off)).toEqual([...STEP_IDS]);
    expect(knownStepIds(setupSteps(STEPS, { switchOn: true, enabled: ["claude"] }))).toEqual([...STEP_IDS]);
    expect(setupSteps(STEPS, { switchOn: true, enabled: ["codex"] }).map((s) => s.id)).toContain("codex.policy");
  });

  test("hooks run only through the reviewed events", () => {
    expect([...CODEX_POLICY_EVENTS]).toEqual(["PreToolUse", "Stop"]);
  });
});

describe("codex.policy step", () => {
  const ctxFor = (selection: IntegrationSelection): ApplyContext => ({
    p: fakeProbes({ home: world.home, env: { HOME: world.home, CODEX_HOME: world.codexHome } }),
    integrations: selection,
  } as unknown as ApplyContext);
  const step = () => createCodexPolicyStep({
    targets: async () => [world.main],
    plan: (input) => planCodexPolicyInstall(input, world.deps),
  });

  test("reports a pending review and writes nothing", async () => {
    const outcome = await step().run({ ...ctxFor({ switchOn: true, enabled: ["codex"] }), log: () => {} } as ApplyContext);
    expect(outcome.state).toBe("needs-you");
    expect(outcome.detail).toContain("rt setup codex-policy");
    expect(existsSync(world.config)).toBe(false);
    expect(existsSync(join(world.main, ".codex"))).toBe(false);
    expect(existsSync(join(world.home, ".mattstack", "rt", "codex-policy"))).toBe(false);
  });

  test("is done once every repo's policy is installed", async () => {
    await installBoth(world.main);
    const outcome = await step().run({ ...ctxFor({ switchOn: true, enabled: ["codex"] }), log: () => {} } as ApplyContext);
    expect(outcome).toEqual({ state: "done", detail: "Codex's policy is set up in your repo" });
  });

  test("applies only with Codex selected", () => {
    expect(step().applies(ctxFor({ switchOn: false }))).toBe(false);
    expect(step().applies(ctxFor({ switchOn: true, enabled: ["claude"] }))).toBe(false);
    expect(step().applies(ctxFor({ switchOn: true, enabled: ["codex"] }))).toBe(true);
  });
});

describe("rt setup codex-policy", () => {
  type Run = { shown: string; failed: string[]; exitCode: number | undefined; confirms: string[] };

  async function run(args: string[], opts: { tty?: boolean; enabled?: boolean; answers?: boolean[] } = {}): Promise<Run> {
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
      targets: async () => [world.main],
      plan: (input) => planCodexPolicyInstall(input, world.deps),
      apply: (plan, reviewed) => applyCodexPolicyInstall(plan, reviewed, world.deps),
      recovery: (profile) => codexPolicyRecovery(profile, world.deps),
    };
    try {
      await setupCodexPolicy(args, {}, deps);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("exit ")) throw err;
    }
    return { shown: shown.join("\n"), failed, exitCode, confirms };
  }

  test("needs a person at a terminal and writes nothing without one", async () => {
    const result = await run([], { tty: false, answers: [true, true] });
    expect(result.exitCode).toBe(2);
    expect(result.failed).toEqual(["Reviewing Codex's policy needs you at a terminal"]);
    expect(result.confirms).toEqual([]);
    expect(existsSync(world.config)).toBe(false);
  });

  test("does nothing while Codex is not turned on", async () => {
    const result = await run([], { enabled: false, answers: [true, true] });
    expect(result.exitCode).toBe(2);
    expect(result.confirms).toEqual([]);
    expect(existsSync(world.config)).toBe(false);
  });

  test("shows the exact boundary, commands and hashes, one review at a time", async () => {
    const result = await run([], { answers: [true, true] });
    expect(result.exitCode).toBeUndefined();
    expect(result.confirms).toEqual(["Trust this folder and add rt's hooks to it?", "Trust these hooks in Codex?"]);
    expect(result.shown).toContain(world.main);
    expect(result.shown).toContain(join(world.main, ".codex", "hooks.json"));
    expect(result.shown).toContain("agent policy-hook --installation");
    expect(result.shown).toMatch(/sha256:[0-9a-f]{64}/);
    expect(result.shown).toContain(`${join(world.main, ".codex", "hooks.json")}:stop:0:0`);
    expect(result.shown).toContain("Codex's policy is set up");
    expect((await plan(world.main)).stage).toBe("installed");
  });

  test("a declined folder review never reaches the hooks review", async () => {
    const result = await run([], { answers: [false] });
    expect(result.exitCode).toBe(1);
    expect(result.confirms).toEqual(["Trust this folder and add rt's hooks to it?"]);
    expect(result.shown).toContain("Managed Codex work stays blocked");
    expect(existsSync(world.config)).toBe(false);
    expect(world.listCalls).toEqual([]);
  });

  test("approving the folder is not approving the hooks", async () => {
    const result = await run([], { answers: [true, false] });
    expect(result.exitCode).toBe(1);
    expect(readConfig(world).projects[world.main]).toEqual({ trust_level: "trusted" });
    expect(readConfig(world).hooks).toBeUndefined();
    expect(await policy().prepare(launch(world.main))).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("is hidden from agents: no --json, not agent-safe, terminal only", () => {
    const node = TREE.setup!.subcommands!["codex-policy"]!;
    expect(node.agentSafe).toBeUndefined();
    expect(node.requiresTTY).toBe(true);
    expect(node.args?.some((a) => a.flag === "--json")).toBe(false);
  });
});
