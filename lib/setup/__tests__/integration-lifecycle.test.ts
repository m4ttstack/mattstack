import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import type { Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createClaudeInstall } from "../../agent-integrations/claude/install.ts";
import { codexMcpStep, codexPolicyStep, createCodexInstall } from "../../agent-integrations/codex/install.ts";
import { applyCodexPolicyInstall, planCodexPolicyInstall, type ListedPolicyHook, type PolicyInstallDeps } from "../../agent-integrations/codex/policy-install.ts";
import { homeInUse, runningCodexHomes } from "../../agent-integrations/codex/running.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import { closeStateDb } from "../../state/index.ts";
import type { RelayClient } from "../../team/relay-client.ts";
import { stepsForRun, type ApplyContext, type StepOutcome } from "../apply.ts";
import { BASE_PLUGINS } from "../base-plugins.ts";
import { noHarnessDetail, type IntegrationSelection } from "../integration-selection.ts";
import { createRealProbes, type Probes } from "../probes.ts";
import { findEnginePackDir, materializeSkills } from "../skills-materialize.ts";
import { ownedResources, readSetupState } from "../state.ts";
import { STEPS } from "../steps/index.ts";
import { computeUninstallActions, runUninstall } from "../uninstall.ts";
import { fakeProbes, ok, type ExecScript } from "./fakes.ts";

const OFF: IntegrationSelection = { switchOn: false };
const CODEX_ONLY: IntegrationSelection = { switchOn: true, enabled: ["codex"] };
const BOTH: IntegrationSelection = { switchOn: true, enabled: ["claude", "codex"] };

const fakeSecrets: SecretsSeams = {
  ageKeySeam: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
  execSeam: {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    fileExists: () => false,
    statFile: () => null,
    readFile: () => "",
    writeFile: () => {},
    ensureDir: () => {},
    chmod: () => {},
    fsyncAndRename: () => {},
    removeFile: () => {},
  },
};

const fakeRelay: RelayClient = {
  create: async () => ({ id: "", creatorSecret: "" }),
  fetch: async () => "gone",
  redeem: async () => "already",
  reply: async () => {},
  readReply: async () => "none",
  delete: async () => {},
};

function makeCtx(p: Probes, overrides: Partial<ApplyContext> = {}): { ctx: ApplyContext; events: unknown[] } {
  const events: unknown[] = [];
  const ctx: ApplyContext = {
    p,
    emit: (ev) => events.push(ev),
    log: () => {},
    intent: null,
    team: { slug: "", name: "", mode: "none" },
    snapshot: null,
    reqs: [],
    nonInteractive: true,
    teamOfOne: false,
    appPath: null,
    ci: false,
    secrets: fakeSecrets,
    teamSecrets: () => fakeSecrets,
    relay: fakeRelay,
    secretPresence: { has: async () => null },
    redact: () => {},
    need: async () => "no-app",
    ...overrides,
  };
  return { ctx, events };
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const SNAKE: Record<string, string> = { PreToolUse: "pre_tool_use", Stop: "stop" };
const LISTED: Record<string, string> = { PreToolUse: "preToolUse", Stop: "stop" };

/** A Mac whose only harness is Codex, on a temporary home, with every Codex file the member also edits. */
type World = {
  home: string;
  codexHome: string;
  config: string;
  hooksPath: string;
  rtSource: string;
  bindings: SessionBinding[];
  /** The Codex homes running `codex` processes use; null when `ps` cannot be read. */
  running: string[] | null;
  spawns: string[][];
  deps: Partial<PolicyInstallDeps>;
  p: Probes;
};

let world: World;
const origHome = process.env.HOME;

function readConfig(): Record<string, any> {
  return existsSync(world.config) ? (Bun.TOML.parse(readFileSync(world.config, "utf8")) as Record<string, any>) : {};
}

/** Codex's hooks/list over the user hooks file, hashing each handler the way a real Codex would: by its definition. */
async function fakeListHooks(): Promise<Outcome<ListedPolicyHook[]>> {
  if (!existsSync(world.hooksPath)) return { ok: true, data: [] };
  const parsed = JSON.parse(readFileSync(world.hooksPath, "utf8")) as { hooks?: Record<string, { hooks: { command: string }[] }[]> };
  const config = readConfig();
  const listed: ListedPolicyHook[] = [];
  for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
    groups.forEach((group, g) => group.hooks.forEach((handler, h) => {
      const key = `${world.hooksPath}:${SNAKE[event] ?? event.toLowerCase()}:${g}:${h}`;
      const currentHash = `sha256:${sha(JSON.stringify(handler))}`;
      const held = config.hooks?.state?.[key]?.trusted_hash;
      listed.push({
        key, eventName: LISTED[event] ?? event, handlerType: "command", command: handler.command, sourcePath: world.hooksPath, source: "user",
        enabled: true, currentHash, trustStatus: held === currentHash ? "trusted" : held === undefined ? "untrusted" : "modified",
      });
    }));
  }
  return { ok: true, data: listed };
}

function makeWorld(): World {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-lifecycle-")));
  const codexHome = join(home, ".codex");
  mkdirSync(codexHome, { recursive: true });
  const rtSource = join(home, "app", "Contents", "Helpers", "rt");
  mkdirSync(dirname(rtSource), { recursive: true });
  writeFileSync(rtSource, "Ïúíþ compiled rt build 1", { mode: 0o755 });
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "rt"), "rt", { mode: 0o755 });
  const spawns: string[][] = [];
  const exec: ExecScript = (argv) => {
    spawns.push(argv);
    return ok();
  };
  const w = {
    home, codexHome, config: join(codexHome, "config.toml"), hooksPath: join(codexHome, "hooks.json"), rtSource, bindings: [] as SessionBinding[], running: [] as string[] | null, spawns,
  } as World;
  w.deps = {
    env: { HOME: home, CODEX_HOME: codexHome },
    home,
    rtSource: () => w.rtSource,
    listHooks: () => fakeListHooks(),
    attachedSessions: () => w.bindings,
    codexBindings: () => w.bindings,
    runningCodexHomes: async () => w.running,
    now: () => new Date("2026-10-09T12:00:00Z"),
    randomId: () => "mac-1",
    // The person at macOS's owner check says yes; owner-auth.test.ts covers every other answer.
    confirmOwner: async () => ({ ok: true }),
  };
  w.p = { ...createRealProbes(), home, env: { HOME: home, CODEX_HOME: codexHome, PATH: "/usr/bin:/bin" }, exec: async (argv) => exec(argv) };
  return w;
}

const adapter = () => createCodexInstall({ p: world.p, policy: { overrides: world.deps } });
const ctxFor = (overrides: Partial<ApplyContext> = {}) => makeCtx(world.p, { integrations: CODEX_ONLY, ...overrides }).ctx;

/** Install, then the one review a person approves at a terminal. */
async function installAndReview(): Promise<void> {
  const outcomes = await adapter().reconcile("restore", ctxFor());
  expect(outcomes[1]!.state).toBe("needs-you");
  const planned = await planCodexPolicyInstall({ profile: world.codexHome }, world.deps);
  if (!planned.ok || planned.data.stage !== "hooks") throw new Error(`expected a review, got ${JSON.stringify(planned)}`);
  expect(await applyCodexPolicyInstall(planned.data, planned.data.reviews.map((r) => r.id), world.deps)).toEqual({ ok: true, data: undefined });
}

/** The member's own settings beside rt's: another server, their own hook and their own trust for it. */
const MEMBER_CONFIG = [
  "# mine",
  'model = "o3"',
  "",
  "[mcp_servers.other]",
  'command = "other-mcp"',
  "",
  '[hooks.state."member-hook"]',
  'trusted_hash = "sha256:member"',
  "",
].join("\n");
const MEMBER_HOOK = { hooks: [{ type: "command", command: "/usr/local/bin/my-hook", timeout: 5 }] };

function seedMember(): void {
  writeFileSync(world.config, MEMBER_CONFIG);
  writeFileSync(world.hooksPath, `${JSON.stringify({ hooks: { Stop: [MEMBER_HOOK] } }, null, 2)}\n`);
}

/** Everything the member set themselves, read back from the files. */
function memberValues() {
  const config = readConfig();
  const hooks = JSON.parse(readFileSync(world.hooksPath, "utf8")) as { hooks: Record<string, unknown[]> };
  return {
    model: config.model,
    other: config.mcp_servers?.other,
    trust: config.hooks?.state?.["member-hook"],
    hook: hooks.hooks.Stop!.filter((g) => Bun.deepEquals(g, MEMBER_HOOK)),
  };
}

function snapshotFiles(): Record<string, string | null> {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
  return { config: read(world.config), hooks: read(world.hooksPath) };
}

function artifactPaths(): string[] {
  const bin = join(world.home, ".mattstack", "rt", "codex-policy", "bin");
  return existsSync(bin) ? readdirSync(bin).map((d) => join(bin, d, "rt")).filter(existsSync) : [];
}

const binding = (value: string): SessionBinding => ({
  key: `codex:${value}`, identity: `id-${value}`, native: { harness: "codex", profile: world.codexHome, kind: "id", value },
  attachment: { generation: 1, mode: "headless" },
});

const stateOf = () => readSetupState(world.p);
const namesClaude = (argv: string[]) => argv.some((a) => a === "claude" || basename(a) === "claude");

describe("Codex ownership across update, restore and uninstall", () => {
  beforeEach(() => {
    world = makeWorld();
    process.env.HOME = world.home;
    closeStateDb();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(world.home, { recursive: true, force: true });
  });

  test("every lifecycle mode keeps the member's values, and repeating a mode edits nothing more", async () => {
    seedMember();
    const before = memberValues();
    for (const mode of ["restore", "update", "uninstall"] as const) {
      if (mode === "update") await installAndReview();
      await adapter().reconcile(mode, ctxFor());
      expect(memberValues()).toEqual(before);
      const settled = snapshotFiles();
      await adapter().reconcile(mode, ctxFor());
      expect(snapshotFiles()).toEqual(settled);
      expect(memberValues()).toEqual(before);
    }
  });

  test("an update run lists Codex's steps only while Codex is on; switched off it is the update it always was", () => {
    const safe = (integrations: IntegrationSelection) => stepsForRun(ctxFor({ integrations })).filter((s) => s.updateSafe).map((s) => s.id);
    expect(safe(OFF)).toEqual(STEPS.filter((s) => s.updateSafe).map((s) => s.id));
    expect(safe(CODEX_ONLY)).toContain("codex.mcp");
    expect(safe(CODEX_ONLY)).toContain("codex.policy");
    expect(safe({ switchOn: true, enabled: ["claude"] })).not.toContain("codex.mcp");
  });

  test("an update keeps every value the member set, and a second update edits nothing", async () => {
    seedMember();
    await installAndReview();
    const before = memberValues();

    const first = await adapter().reconcile("update", ctxFor());
    expect(first).toEqual([{ state: "skipped", detail: "Already set up" }, { state: "skipped", detail: "Already set up" }]);
    const settled = snapshotFiles();
    const again = await adapter().reconcile("update", ctxFor());
    expect(again).toEqual(first);
    expect(snapshotFiles()).toEqual(settled);
    expect(memberValues()).toEqual(before);
  });

  test("an update refreshes the hooks rt added for a new rt, which then wait on review; the old program goes once no session holds it", async () => {
    await installAndReview();
    const [oldProgram] = artifactPaths();
    world.bindings = [binding("t1")];
    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 2", { mode: 0o755 });

    const outcomes = await adapter().reconcile("update", ctxFor());
    expect(outcomes[1]).toMatchObject({ state: "needs-you", detail: expect.stringContaining("rt setup codex-policy") });
    const hooksText = readFileSync(world.hooksPath, "utf8");
    expect(hooksText).not.toContain(oldProgram!);
    expect(existsSync(oldProgram!)).toBe(true);

    world.bindings = [];
    world.running = [world.codexHome];
    await adapter().reconcile("update", ctxFor());
    expect(existsSync(oldProgram!)).toBe(true);

    world.running = null;
    await adapter().reconcile("update", ctxFor());
    expect(existsSync(oldProgram!)).toBe(true);

    world.running = ["/elsewhere/.codex"];
    await adapter().reconcile("update", ctxFor());
    expect(existsSync(oldProgram!)).toBe(false);
    expect(artifactPaths()).toHaveLength(1);
    expect(Object.keys(stateOf().codexPolicy!.artifacts)).toEqual(artifactPaths());
  });

  test("a review that is still pending stays visible on every update, which writes nothing", async () => {
    expect((await adapter().reconcile("restore", ctxFor()))[1]!.state).toBe("needs-you");
    const before = snapshotFiles();
    const outcomes = await adapter().reconcile("update", ctxFor());
    expect(outcomes[1]).toEqual({ state: "needs-you", detail: "Codex's policy hooks still wait on your review. Review them in the app's setup checklist, or in a terminal: rt setup codex-policy" });
    expect(snapshotFiles()).toEqual(before);
  });

  test("an interrupted update retries to the same end, with one copy of each hook", async () => {
    await installAndReview();
    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 2", { mode: 0o755 });
    let calls = 0;
    const interrupted = createCodexInstall({
      p: world.p,
      policy: {
        overrides: world.deps,
        plan: async (input, overrides) => {
          if (++calls === 2) throw new Error("rt was stopped");
          return planCodexPolicyInstall(input, overrides);
        },
      },
    });
    expect((await interrupted.reconcile("update", ctxFor()))[1]).toMatchObject({ state: "failed", detail: "rt was stopped" });

    const retried = await adapter().reconcile("update", ctxFor());
    expect(retried[1]!.state).toBe("needs-you");
    expect(retried[1]).toMatchObject({ detail: expect.stringContaining("rt setup codex-policy") });
    const hooks = JSON.parse(readFileSync(world.hooksPath, "utf8")) as { hooks: Record<string, unknown[]> };
    expect(Object.values(hooks.hooks).map((groups) => groups.length)).toEqual([1, 1]);
    expect(stateOf().codexPolicy!.hooks[world.hooksPath]).toHaveLength(2);
  });

  test("an update never adds back the entry or the hooks the member took out", async () => {
    seedMember();
    await installAndReview();
    writeFileSync(world.config, MEMBER_CONFIG);
    writeFileSync(world.hooksPath, `${JSON.stringify({ hooks: { Stop: [MEMBER_HOOK] } }, null, 2)}\n`);
    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 2", { mode: 0o755 });
    const before = snapshotFiles();

    const outcomes = await adapter().reconcile("update", ctxFor());
    expect(outcomes).toEqual([
      { state: "skipped", detail: `You took Mattstack out of ${world.config}, so rt left it out` },
      { state: "skipped", detail: `You took rt's policy hooks out of ${world.hooksPath}, so rt left them out` },
    ]);
    expect(snapshotFiles()).toEqual(before);
  });

  test("an update adopts nothing rt did not record adding", async () => {
    writeFileSync(world.config, `${MEMBER_CONFIG}\n[mcp_servers.mattstack]\ncommand = "their-mattstack"\n`);
    seedMember();
    const before = snapshotFiles();
    const outcomes = await adapter().reconcile("update", ctxFor());
    expect(outcomes.map((o) => o.state)).toEqual(["skipped", "skipped"]);
    expect(snapshotFiles()).toEqual(before);
    expect(stateOf().codexMcp).toBeUndefined();
    expect(stateOf().codexPolicy).toBeUndefined();
  });

  test("a hook definition the member changed stays changed and untrusted: an update never rewrites it or writes trust", async () => {
    await installAndReview();
    const trusted = readConfig().hooks.state;
    const hooks = JSON.parse(readFileSync(world.hooksPath, "utf8"));
    hooks.hooks.PreToolUse[0].hooks[0].timeout = 30;
    writeFileSync(world.hooksPath, JSON.stringify(hooks, null, 2));
    const before = snapshotFiles();

    const outcomes = await adapter().reconcile("update", ctxFor());
    expect(outcomes[1]!.state).not.toBe("done");
    expect(snapshotFiles()).toEqual(before);
    expect(readConfig().hooks.state).toEqual(trusted);

    writeFileSync(world.rtSource, "Ïúíþ compiled rt build 2", { mode: 0o755 });
    expect((await adapter().reconcile("update", ctxFor()))[1]).toEqual({
      state: "skipped", detail: `You changed rt's policy hooks in ${world.hooksPath}, so rt left them as they are`,
    });
    expect(snapshotFiles()).toEqual(before);
  });

  test("a partial install resumes without adopting the member's keys", async () => {
    seedMember();
    expect((await codexMcpStep.run(ctxFor())).state).toBe("done");
    const resumed = await adapter().reconcile("restore", ctxFor());
    expect(resumed.map((o) => o.state)).toEqual(["skipped", "needs-you"]);
    await installAndReview();

    const owned = stateOf().codexPolicy!;
    expect(Object.keys(owned.trust[world.config]!.hooks).every((k) => k.startsWith(`${world.hooksPath}:`))).toBe(true);
    expect(Object.keys(owned.trust[world.config]!.hooks)).not.toContain("member-hook");
    expect(owned.hooks[world.hooksPath]).not.toContain("/usr/local/bin/my-hook");
    expect(memberValues().trust).toEqual({ trusted_hash: "sha256:member" });
  });

  test("uninstall takes back only rt's unchanged entries and leaves the member's settings exactly", async () => {
    seedMember();
    await installAndReview();
    const before = memberValues();
    const program = artifactPaths();
    expect(program).toHaveLength(1);

    const outcomes = await adapter().reconcile("uninstall", ctxFor());
    expect(outcomes.every((o) => o.state === "done")).toBe(true);
    const config = readConfig();
    expect(config.mcp_servers?.mattstack).toBeUndefined();
    expect(Object.keys(config.hooks.state)).toEqual(["member-hook"]);
    const hooks = JSON.parse(readFileSync(world.hooksPath, "utf8"));
    expect(hooks).toEqual({ hooks: { Stop: [MEMBER_HOOK] } });
    expect(memberValues()).toEqual(before);
    expect(readFileSync(world.config, "utf8")).toBe(MEMBER_CONFIG);
    expect(artifactPaths()).toEqual([]);
    expect(stateOf().codexMcp).toBeUndefined();
    expect(stateOf().codexPolicy).toBeUndefined();

    const settled = snapshotFiles();
    expect(await adapter().reconcile("uninstall", ctxFor())).toEqual([]);
    expect(snapshotFiles()).toEqual(settled);
  });

  test("uninstall leaves entries the member changed and says so", async () => {
    seedMember();
    await installAndReview();
    const text = readFileSync(world.config, "utf8").replace('default_tools_approval_mode = "approve"', 'default_tools_approval_mode = "prompt"');
    const key = Object.keys(stateOf().codexPolicy!.trust[world.config]!.hooks)[0]!;
    writeFileSync(world.config, `${text}`.replace(`[hooks.state.${JSON.stringify(key)}]\n`, `[hooks.state.${JSON.stringify(key)}]\nenabled = true\n`));
    const before = readConfig();

    const outcomes = await adapter().reconcile("uninstall", ctxFor());
    const kept = outcomes.filter((o) => o.state === "needs-you").map((o) => ("detail" in o ? o.detail : ""));
    expect(kept.some((d) => d.includes("Mattstack in") && d.includes("changed after rt added it"))).toBe(true);
    expect(kept.some((d) => d.includes("hook trust"))).toBe(true);
    const after = readConfig();
    expect(after.mcp_servers.mattstack).toEqual(before.mcp_servers.mattstack);
    expect(after.hooks.state[key]).toEqual(before.hooks.state[key]);
    expect(after.hooks.state["member-hook"]).toEqual(before.hooks.state["member-hook"]);
  });

  const keptNotes = (outcomes: StepOutcome[]) => outcomes.filter((o) => o.state === "needs-you").map((o) => ("detail" in o ? o.detail : ""));

  test("uninstall keeps the hook program while Codex runs on that home, never ends it, and says what to do by hand", async () => {
    await installAndReview();
    world.bindings = [binding("t1")];
    world.running = [world.codexHome];
    const program = artifactPaths();

    const outcomes = await adapter().reconcile("uninstall", ctxFor());
    expect(keptNotes(outcomes)).toEqual([
      `rt's Codex hook program in ${dirname(program[0]!)}, because Codex is still running on ${world.codexHome}. Quit Codex there, then delete that folder`,
    ]);
    expect(artifactPaths()).toEqual(program);
    expect(Object.keys(stateOf().codexPolicy!.artifacts)).toEqual(program);
    expect(stateOf().codexPolicy!.retainedFor).toEqual([world.codexHome]);
    expect(world.bindings).toHaveLength(1);
    expect(world.spawns).toEqual([]);

    world.running = [];
    await adapter().reconcile("uninstall", ctxFor());
    expect(artifactPaths()).toEqual([]);
    expect(stateOf().codexPolicy).toBeUndefined();
  });

  test("a session still recorded as attached after the daemon stopped, with no Codex running, has ended: its program goes", async () => {
    await installAndReview();
    world.bindings = [binding("t1")];
    world.running = [];
    expect(keptNotes(await adapter().reconcile("uninstall", ctxFor()))).toEqual([]);
    expect(artifactPaths()).toEqual([]);
    expect(stateOf().codexPolicy).toBeUndefined();
  });

  test("when the process table cannot be read the program stays, with a note that needs no rt", async () => {
    await installAndReview();
    world.running = null;
    expect(keptNotes(await adapter().reconcile("uninstall", ctxFor()))).toEqual([
      `rt's Codex hook program in ${dirname(artifactPaths()[0]!)}, because rt could not tell whether Codex is still running. Once Codex is closed, delete that folder`,
    ]);
    expect(artifactPaths()).toHaveLength(1);
  });

  test("an interrupted uninstall keeps the record of what it still owns, and forgets what it already took out", async () => {
    await installAndReview();
    world.deps.runningCodexHomes = async () => {
      throw new Error("rt was stopped");
    };
    await expect(adapter().reconcile("uninstall", ctxFor())).rejects.toThrow("rt was stopped");
    const left = stateOf().codexPolicy!;
    expect(left.hooks).toEqual({});
    expect(left.trust).toEqual({});
    expect(Object.keys(left.artifacts)).toEqual(artifactPaths());
    expect(left.retainedFor).toEqual([world.codexHome]);
  });

  test("delete-data keeps a hook program a running Codex holds and removes everything else", async () => {
    await installAndReview();
    world.running = [world.codexHome];
    const [program] = artifactPaths();
    mkdirSync(join(world.home, ".mattstack", "user"), { recursive: true });
    writeFileSync(join(world.home, ".mattstack", "user", "settings.jsonc"), "{}");
    const actions = [
      { id: "integrations.remove" as const, title: "Remove what rt added to Codex", kind: "rt" as const },
      { id: "data" as const, title: "Delete ~/.mattstack (settings, teams, secrets)", kind: "rt" as const },
    ];
    const { ctx } = makeCtx(world.p, { integrations: CODEX_ONLY });
    const result = await runUninstall(ctx, actions, { detectEditors: () => [], harnessInstalls: [{ id: "codex", loadInstall: async () => adapter() }] });
    expect(result.ok).toBe(true);
    expect(existsSync(program!)).toBe(true);
    expect(readdirSync(join(world.home, ".mattstack"))).toEqual(["rt"]);
    expect(readdirSync(join(world.home, ".mattstack", "rt"))).toEqual(["codex-policy"]);
    expect(result.stayed.filter((s) => s.includes(dirname(program!)))).toEqual([
      `rt's Codex hook program in ${dirname(program!)}, because Codex is still running on ${world.codexHome}. Quit Codex there, then delete that folder`,
    ]);
  });

  const removeAll = async () => {
    const actions = [
      { id: "integrations.remove" as const, title: "Remove what rt added to Codex", kind: "rt" as const },
      { id: "data" as const, title: "Delete ~/.mattstack (settings, teams, secrets)", kind: "rt" as const },
    ];
    const { ctx } = makeCtx(world.p, { integrations: CODEX_ONLY });
    return runUninstall(ctx, actions, { detectEditors: () => [], harnessInstalls: [{ id: "codex", loadInstall: async () => adapter() }] });
  };

  /** Every file under `dir`, relative to it. */
  function filesUnder(dir: string, prefix = ""): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`])).sort();
  }

  test("delete-data never follows a symlinked ~/.mattstack: only the link goes", async () => {
    const outside = join(world.home, "elsewhere", "mattstack");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(world.home, ".mattstack"));
    await installAndReview();
    world.running = [world.codexHome];
    const before = filesUnder(outside);

    const result = await removeAll();
    expect(result.ok).toBe(true);
    expect(existsSync(join(world.home, ".mattstack"))).toBe(false);
    expect(filesUnder(outside)).toEqual(before);
    expect(filesUnder(outside).some((f) => f.startsWith("rt/codex-policy/bin/"))).toBe(true);
    expect(result.stayed).toContain(`${join(world.home, ".mattstack")} was a link, so rt removed only the link and left what it points to`);
  });

  test("delete-data never follows a symlinked bin folder: only the link goes", async () => {
    await installAndReview();
    world.running = [world.codexHome];
    const bin = join(world.home, ".mattstack", "rt", "codex-policy", "bin");
    const outside = join(world.home, "elsewhere", "bin");
    mkdirSync(dirname(outside), { recursive: true });
    renameSync(bin, outside);
    symlinkSync(outside, bin);
    const before = filesUnder(outside);

    const result = await removeAll();
    expect(result.ok).toBe(true);
    expect(filesUnder(outside)).toEqual(before);
    expect(existsSync(bin)).toBe(false);
    expect(result.stayed).toContain(`${bin} was a link, so rt removed only the link and left what it points to`);
  });

  test("retained homes go once no recorded program needs them", async () => {
    await installAndReview();
    world.running = [world.codexHome];
    await adapter().reconcile("uninstall", ctxFor());
    expect(stateOf().codexPolicy!.retainedFor).toEqual([world.codexHome]);

    world.running = [];
    await installAndReview();
    await adapter().reconcile("update", ctxFor());
    expect(stateOf().codexPolicy!.retainedFor).toBeUndefined();
    expect(artifactPaths()).toHaveLength(1);
  });

  test("delete-data with no Codex running removes all of ~/.mattstack", async () => {
    await installAndReview();
    const actions = [
      { id: "integrations.remove" as const, title: "Remove what rt added to Codex", kind: "rt" as const },
      { id: "data" as const, title: "Delete ~/.mattstack (settings, teams, secrets)", kind: "rt" as const },
    ];
    const { ctx } = makeCtx(world.p, { integrations: CODEX_ONLY });
    expect((await runUninstall(ctx, actions, { detectEditors: () => [], harnessInstalls: [{ id: "codex", loadInstall: async () => adapter() }] })).ok).toBe(true);
    expect(existsSync(join(world.home, ".mattstack"))).toBe(false);
  });

  test("`rt uninstall` plans the Codex removal only where rt recorded writing for Codex, and keeps what the member changed", async () => {
    const quiet = { detectEditors: () => [] };
    expect(computeUninstallActions(world.p, { keepData: true }, quiet).map((a) => a.id)).not.toContain("integrations.remove");
    seedMember();
    await installAndReview();
    expect(ownedResources(stateOf()).filter((r) => r.integration === "codex").map((r) => r.kind).sort()).toEqual(["artifact", "hook", "hook", "mcp", "trust", "trust"]);
    const actions = computeUninstallActions(world.p, { keepData: true }, quiet).filter((a) => a.id === "integrations.remove");
    expect(actions).toEqual([{ id: "integrations.remove", title: "Remove what rt added to Codex", kind: "rt" }]);

    writeFileSync(world.config, readFileSync(world.config, "utf8").replace('default_tools_approval_mode = "approve"', 'default_tools_approval_mode = "prompt"'));
    const { ctx, events } = makeCtx(world.p, { integrations: CODEX_ONLY });
    const result = await runUninstall(ctx, actions, { ...quiet, harnessInstalls: [{ id: "codex", loadInstall: async () => adapter() }] });
    expect(result.ok).toBe(true);
    expect(result.stayed.some((s) => s.includes("changed after rt added it"))).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ event: "step", id: "integrations.remove", state: "done" }));
  });
});

describe("Claude's update and restore", () => {
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-lifecycle-claude-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("update preserves user-disabled plugin, and a second update makes no further edits", async () => {
    const execCalls: string[][] = [];
    const installed = BASE_PLUGINS.map((id) => ({ id, version: "1.0.0", enabled: id !== "chat@mattstack" }));
    const p = fakeProbes({
      home,
      env: { PATH: "/usr/local/bin" },
      files: { "/usr/local/bin/claude": "bin" },
      exec: async (argv) => {
        execCalls.push(argv);
        if (argv[2] === "list") return ok(JSON.stringify(installed));
        if (argv[2] === "marketplace" && argv[3] === "list") return ok("[]");
        return ok("");
      },
    });
    const { ctx } = makeCtx(p, { integrations: BOTH });
    await createClaudeInstall({ p }).reconcile("update", ctx);
    expect(execCalls.filter((a) => (a[2] === "enable" || a[2] === "install") && a[3] === "chat@mattstack")).toEqual([]);
    const settled = { ...p.calls.writes };
    execCalls.length = 0;
    await createClaudeInstall({ p }).reconcile("update", ctx);
    expect(execCalls.filter((a) => a[2] === "enable" || a[2] === "install")).toEqual([]);
    expect(p.calls.writes).toEqual(settled);
  });

  test("update re-runs only the update-safe steps", async () => {
    const ran: string[] = [];
    const claude = createClaudeInstall();
    const steps = claude.steps().map((s) => ({ ...s, run: async () => (ran.push(s.id), { state: "done" } as StepOutcome) }));
    const { runAdapterSteps } = await import("../../agent-integrations/install.ts");
    await runAdapterSteps(steps, "update", makeCtx(fakeProbes({ home })).ctx);
    expect(ran).toEqual(["plugins.install", "claude.permissions"]);
  });
});

describe("restore without Claude", () => {
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-lifecycle-restore-")));
    process.env.HOME = home;
    closeStateDb();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  const claudeCache = (h: string) => `${h}/.claude/plugins/cache/mattstack/mattstack`;
  const codexCache = (h: string) => `${h}/.codex/plugins/cache/mattstack/mattstack`;

  test("the engine pack comes from the selected harness's plugins, not Claude's cache", () => {
    const dirs = { [claudeCache("/h")]: ["0.30.0"], [`${claudeCache("/h")}/0.30.0`]: [], [codexCache("/h")]: ["0.29.0"], [`${codexCache("/h")}/0.29.0`]: [] };
    const p = fakeProbes({ home: "/h", dirs });
    expect(findEnginePackDir(p, CODEX_ONLY)).toBe(`${codexCache("/h")}/0.29.0`);
    expect(findEnginePackDir(p, OFF)).toBe(`${claudeCache("/h")}/0.30.0`);
    expect(findEnginePackDir(p, BOTH)).toBe(`${claudeCache("/h")}/0.30.0`);
    const codexOnlyMac = fakeProbes({ home: "/h", dirs: { [codexCache("/h")]: ["0.29.0"], [`${codexCache("/h")}/0.29.0`]: [] } });
    expect(findEnginePackDir(codexOnlyMac, OFF)).toBeNull();
    expect(findEnginePackDir(codexOnlyMac, BOTH)).toBe(`${codexCache("/h")}/0.29.0`);
  });

  test("a Codex-only restore runs no Claude command and completes skill materialization", async () => {
    const spawns: string[][] = [];
    const p = fakeProbes({
      home,
      env: { PATH: "/usr/local/bin" },
      dirs: { [codexCache(home)]: ["0.29.0"], [`${codexCache(home)}/0.29.0`]: ["pack"] },
      files: { [`${codexCache(home)}/0.29.0/pack/skills.jsonc`]: "{}", [join(home, ".local", "bin", "rt")]: "rt" },
      exec: async (argv) => (spawns.push(argv), ok()),
    });
    expect((await materializeSkills(p, {}, CODEX_ONLY)).skipped).toBe(false);
    const { ctx } = makeCtx(p, { integrations: CODEX_ONLY, intent: { v: 1, at: "2026-10-09T00:00:00Z", mode: "restore", restore: { homeRepo: "acme/home" } } });
    const materialize = await STEPS.find((s) => s.id === "skills.materialize")!.run(ctx);
    expect(materialize.state).toBe("done");
    await createCodexInstall({ p, policy: { plan: async () => ({ ok: false, error: { code: "not-ready", message: "Codex is not running" } }) } }).reconcile("restore", ctx);
    expect(spawns.filter(namesClaude)).toEqual([]);
  });
});

describe("which Codex homes a running Codex uses", () => {
  test("reads codex processes and their CODEX_HOME, else HOME's .codex, from the process table", async () => {
    const calls: string[][] = [];
    const ps = async (argv: string[]) => {
      calls.push(argv);
      if (argv[1] === "-A") {
        return {
          exitCode: 0,
          stdout: ["  11 /Applications/My Tools/codex", "  12 /usr/bin/vim", "  13 /usr/local/bin/node", "  14 /bin/zsh", "  15 /usr/local/bin/node"].join("\n"),
        };
      }
      if (argv.includes("pid=,args=")) {
        return { exitCode: 0, stdout: ["13 node /usr/local/lib/node_modules/@openai/codex/bin/codex.js", "15 node server.js"].join("\n") };
      }
      return { exitCode: 0, stdout: ["11 /Applications/My Tools/codex app-server HOME=/Users/a CODEX_HOME=/Users/a/work", "13 node codex.js HOME=/Users/b"].join("\n") };
    };
    expect(await runningCodexHomes({ home: "/Users/x", ps })).toEqual(["/Users/a/work", "/Users/b/.codex"]);
    expect(calls.at(-1)).toEqual(["ps", "eww", "-o", "pid=,command=", "-p", "11,13"]);
  });

  test("a node it cannot read counts as Codex, so nothing in use is deleted", async () => {
    const ps = async (argv: string[]) => {
      if (argv[1] === "-A") return { exitCode: 0, stdout: "  13 /usr/local/bin/node" };
      if (argv.includes("pid=,args=")) return { exitCode: 1, stdout: "" };
      return { exitCode: 0, stdout: "13 node x HOME=/Users/b" };
    };
    expect(await runningCodexHomes({ home: "/Users/x", ps })).toEqual(["/Users/b/.codex"]);
  });

  test("an unreadable process table is unknown, and no codex process is none", async () => {
    expect(await runningCodexHomes({ home: "/h", ps: async () => ({ exitCode: 1, stdout: "" }) })).toBeNull();
    expect(await runningCodexHomes({ home: "/h", ps: async () => ({ exitCode: 0, stdout: "  1 /sbin/launchd" }) })).toEqual([]);
  });

  test("a home ps cut at a space still matches", () => {
    expect(homeInUse(["/Users/a/My"], "/Users/a/My Codex")).toBe(true);
    expect(homeInUse(["/Users/a/My"], "/Users/a/Mine")).toBe(false);
    expect(homeInUse(["/Users/a/.codex"], "/Users/a/.codex")).toBe(true);
  });
});

describe("lifecycle wiring", () => {
  test("Codex's own steps are update-safe, never need the app, and only ever apply to Codex", () => {
    for (const step of [codexMcpStep, codexPolicyStep]) {
      expect(step.updateSafe).toBe(true);
      expect(step.kind).toBe("rt");
    }
  });

  test("an update says Codex is left to Install only under an update", () => {
    expect(noHarnessDetail({ integrations: CODEX_ONLY, update: true })).toBe("Codex is set up by Install, not by an update");
    expect(noHarnessDetail({ integrations: CODEX_ONLY })).toBe("No agent integration is turned on");
    expect(noHarnessDetail({ integrations: { switchOn: true, enabled: [] }, update: true })).toBe("No agent integration is turned on");
  });

  test("switched off, uninstall plans exactly what it always did", () => {
    const p = fakeProbes({ home: "/h" });
    expect(computeUninstallActions(p, { keepData: true }, { detectEditors: () => [] }).map((a) => a.id)).toEqual(["services.unregister"]);
  });
});
