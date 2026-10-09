import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { __test__ as bundleLayoutTest } from "../../bundle-layout.ts";
import { closeStateDb } from "../../state/index.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import type { RelayClient } from "../../team/relay-client.ts";
import { codexMcpStep, createCodexInstall } from "../../agent-integrations/codex/install.ts";
import { createClaudeInstall } from "../../agent-integrations/claude/install.ts";
import { codexMcpEntry, codexMcpFingerprint, editCodexMcpEntry, readCodexMcpState, renderCodexMcpTable } from "../../agent-integrations/codex/mcp-config.ts";
import { personalSkillsDir } from "../../skills/writing-style-sources.ts";
import { stepsForRun, type ApplyContext, type StepOutcome } from "../apply.ts";
import type { Row } from "../contract.ts";
import { fastBrowserHost, herdrHosts, type IntegrationSelection } from "../integration-selection.ts";
import { composePlan } from "../plan.ts";
import type { Probes } from "../probes.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { STEPS } from "../steps/index.ts";
import { createIntegrationSteps, HARNESS_INSTALLS, recordIntegrationChoice, setupSteps } from "../steps/agent-integrations.ts";
import { codexMcpRow, codexToolRow } from "../validators/codex.ts";
import { toolRows } from "../validators/tools.ts";
import { fakeProbes, ok, type ExecScript } from "./fakes.ts";

const OFF: IntegrationSelection = { switchOn: false };
const CODEX_ONLY: IntegrationSelection = { switchOn: true, enabled: ["codex"] };
const CLAUDE_ONLY: IntegrationSelection = { switchOn: true, enabled: ["claude"] };
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

function makeCtx(p: Probes, overrides: Partial<ApplyContext> = {}): { ctx: ApplyContext; logs: { id: string; line: string }[] } {
  const logs: { id: string; line: string }[] = [];
  const ctx: ApplyContext = {
    p,
    emit: () => {},
    log: (id, line) => logs.push({ id, line }),
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
  return { ctx, logs };
}

const detailOf = (o: StepOutcome): string | undefined => ("detail" in o ? o.detail : undefined);
const remedyOf = (o: StepOutcome): string | undefined => ("remedy" in o ? o.remedy : undefined);

type Spawn = { argv: string[]; env?: Record<string, string> };

/** A Mac with Codex, herdr and Fast Browser and no Claude anywhere. */
function codexMac(home: string, opts: { loggedIn?: boolean; files?: Record<string, string>; exec?: ExecScript } = {}) {
  const spawns: Spawn[] = [];
  const exec: ExecScript = (argv, execOpts) => {
    spawns.push({ argv, ...(execOpts?.env ? { env: execOpts.env } : {}) });
    const custom = opts.exec?.(argv, execOpts);
    if (custom) return custom;
    const cmd = argv.join(" ");
    if (argv[0] === "sw_vers") return ok("15.6");
    if (argv[0] === "claude" || basename(argv[0] ?? "") === "claude") return { code: 127, stdout: "", stderr: "ENOENT: claude" };
    if (cmd === "codex --version") return ok("codex-cli 0.160.0");
    if (cmd === "codex login status") return opts.loggedIn === false ? { code: 1, stdout: "Not logged in\n", stderr: "" } : ok("Logged in using ChatGPT\n");
    if (cmd === "codex plugin list --json") return ok('{"installed":[],"available":[]}');
    if (cmd === "herdr --version") return ok("herdr 0.8.0");
    if (cmd === "herdr integration status") return ok("claude: not installed\ncodex: current (v3)\n");
    return ok();
  };
  const p = fakeProbes({
    home,
    env: { PATH: "/usr/local/bin" },
    files: { "/usr/local/bin/fast-browser": "bin", "/usr/local/bin/herdr": "bin", "/usr/local/bin/codex": "bin", [join(home, ".local", "bin", "rt")]: "rt", ...(opts.files ?? {}) },
    exec,
  });
  return { p, spawns };
}

const namesClaude = (s: Spawn): boolean =>
  s.argv.some((a) => basename(a) === "claude" || a === "claude") || Object.keys(s.env ?? {}).some((k) => k.startsWith("CLAUDE"));

const secrets = { async has() { return null; } };

async function codexOnlyPlan(p: Probes, integrations: IntegrationSelection = CODEX_ONLY) {
  return composePlan({ p, secrets, ci: false, mode: "plan", orgs: [], waived: [], integrations });
}

const toolsGroup = (plan: Awaited<ReturnType<typeof codexOnlyPlan>>): Row[] => plan.groups.find((g) => g.id === "tools")!.rows;

describe("setup for the enabled harnesses", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    bundleLayoutTest.resetBundleLayoutMemo();
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-agent-integrations-home-")));
    process.env.HOME = home;
    closeStateDb();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("Codex-only setup has no Claude prerequisite or spawn", async () => {
    const { p, spawns } = codexMac(home);
    const plan = await codexOnlyPlan(p);
    const requiredTools = toolsGroup(plan).filter((r) => r.required).map((r) => r.id);
    expect(requiredTools).not.toContain("tool.claude");
    expect(requiredTools).toContain("tool.codex");
    const rowIds = toolsGroup(plan).map((r) => r.id);
    for (const claudeRow of ["tool.claude", "tool.plugins", "tool.linear-mcp"]) expect(rowIds).not.toContain(claudeRow);

    const steps = setupSteps(STEPS, CODEX_ONLY);
    const ids = steps.map((s) => s.id);
    for (const claudeStep of ["plugins.install", "linear.mcp", "claude.permissions"]) expect(ids).not.toContain(claudeStep);
    expect(ids).toContain("codex.mcp");

    const dir = join(personalSkillsDir(home), "my-voice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: my-voice\ndescription: x\n---\nbody\n");

    const { ctx } = makeCtx(p, { integrations: CODEX_ONLY });
    const before = spawns.length;
    const outcomes: Record<string, StepOutcome> = {};
    for (const id of ["skills.link", "codex.mcp", "fastbrowser.setup", "herdr.integration"]) outcomes[id] = await steps.find((s) => s.id === id)!.run(ctx);
    expect(Object.fromEntries(Object.entries(outcomes).map(([id, o]) => [id, o.state]))).toEqual({
      "skills.link": "done", "codex.mcp": "done", "fastbrowser.setup": "done", "herdr.integration": "done",
    });

    expect(spawns.filter(namesClaude)).toEqual([]);
    const ran = spawns.slice(before);
    expect(ran.map((s) => s.argv)).toEqual([
      ["/usr/local/bin/fast-browser", "setup", "--host", "codex"],
      ["herdr", "integration", "install", "codex"],
    ]);
    expect(ran[1]!.env).toEqual({ CODEX_HOME: join(home, ".codex") });

    expect(Object.keys(p.calls.writes).filter((path) => path.startsWith(join(home, ".claude")))).toEqual([]);
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(lstatSync(join(home, ".codex", "skills", "my-voice")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, ".codex", "skills", "my-voice"))).toBe(realpathSync(dir));
    expect(p.calls.writes[join(home, ".codex", "config.toml")]).toContain("[mcp_servers.mattstack]");
  });

  test("an update run on a Codex-only Mac runs no Claude step", () => {
    const { p } = codexMac(home);
    const { ctx } = makeCtx(p, { integrations: CODEX_ONLY });
    const updateSafe = stepsForRun(ctx).filter((s) => s.updateSafe).map((s) => s.id);
    expect(updateSafe).not.toContain("plugins.install");
    expect(updateSafe).not.toContain("claude.permissions");
    expect(updateSafe).toContain("skills.link");
  });

  test("installing team packs never reaches Claude while it is turned off", async () => {
    const { p, spawns } = codexMac(home);
    const outcome = await STEPS.find((s) => s.id === "plugins.install")!.run(makeCtx(p, { integrations: CODEX_ONLY }).ctx);
    expect(outcome).toEqual({ state: "skipped", detail: "Claude Code is turned off on this Mac" });
    expect(spawns).toEqual([]);
  });

  test("both hosts can be enabled", async () => {
    const steps: string[] = setupSteps(STEPS, BOTH).map((s) => s.id);
    for (const id of ["plugins.install", "linear.mcp", "claude.permissions", "codex.mcp"]) expect(steps).toContain(id);
    expect(fastBrowserHost(BOTH)).toBe("both");
    expect(herdrHosts(BOTH)).toEqual(["claude", "codex"]);

    const { p, spawns } = codexMac(home);
    const { ctx } = makeCtx(p, { integrations: BOTH });
    await STEPS.find((s) => s.id === "fastbrowser.setup")!.run(ctx);
    await STEPS.find((s) => s.id === "herdr.integration")!.run(ctx);
    expect(spawns.map((s) => s.argv)).toEqual([
      ["/usr/local/bin/fast-browser", "setup", "--host", "both", "--source", "https://github.com/m4ttstack/mattstack-marketplace.git"],
      ["herdr", "integration", "install", "claude"],
      ["herdr", "integration", "install", "codex"],
    ]);
    expect(spawns.map((s) => s.env)).toEqual([undefined, { CLAUDE_CONFIG_DIR: join(home, ".claude") }, { CODEX_HOME: join(home, ".codex") }]);

    const plan = await codexOnlyPlan(codexMac(home).p, BOTH);
    const required = toolsGroup(plan).filter((r) => r.required).map((r) => r.id);
    expect(required).toContain("tool.claude");
    expect(required).toContain("tool.codex");
  });

  test("Claude-only with the switch on keeps Claude's steps and installs nothing for Codex", () => {
    const steps = setupSteps(STEPS, CLAUDE_ONLY).map((s) => s.id);
    expect(steps).toContain("plugins.install");
    expect(steps).not.toContain("codex.mcp");
    expect(fastBrowserHost(CLAUDE_ONLY)).toBe("claude");
    expect(herdrHosts(CLAUDE_ONLY)).toEqual(["claude"]);
  });

  test("no harness enabled: no host setup runs", async () => {
    const none: IntegrationSelection = { switchOn: true, enabled: [] };
    const { p, spawns } = codexMac(home);
    const { ctx } = makeCtx(p, { integrations: none });
    expect((await STEPS.find((s) => s.id === "fastbrowser.setup")!.run(ctx)).state).toBe("skipped");
    expect((await STEPS.find((s) => s.id === "herdr.integration")!.run(ctx)).state).toBe("skipped");
    expect(spawns).toEqual([]);
  });

  test("with the switch off, setup is today's: the same registry and the Claude host", () => {
    expect(setupSteps(STEPS, OFF)).toBe(STEPS);
    expect(fastBrowserHost(OFF)).toBe("claude");
    expect(herdrHosts(OFF)).toEqual(["claude"]);
    const { p } = codexMac(home);
    expect(codexMcpStep.applies(makeCtx(p, { integrations: OFF }).ctx)).toBe(false);
    expect(codexMcpStep.applies(makeCtx(p, { integrations: CODEX_ONLY }).ctx)).toBe(true);
  });

  test("with the switch off, the tools rows are Claude's and never Codex's", async () => {
    const { p, spawns } = codexMac(home);
    const rows = await toolRows(p, [], { hasBrew: false, secrets, integrations: OFF });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("tool.claude");
    expect(ids).not.toContain("tool.codex");
    expect(ids).not.toContain("tool.codex-mcp");
    expect(spawns.some((s) => s.argv[0] === "codex")).toBe(false);
  });

  describe("Codex sign-in and tools", () => {
    test("auth failure offers a remedy and does not hold Install", async () => {
      const row = await codexToolRow(codexMac(home, { loggedIn: false }).p);
      expect(row.status).toBe("needs-you");
      expect(row.required).toBe(false);
      expect(row.action).toEqual({ type: "steps", label: "Show steps…", steps: ["Open a terminal", "Run: codex login", "Follow the sign-in prompt"] });
    });

    test("Codex missing is required and says how to install it", async () => {
      const row = await codexToolRow(codexMac(home, { exec: (argv) => (argv[0] === "codex" ? { code: 127, stdout: "", stderr: "ENOENT: codex" } : undefined) as never }).p);
      expect(row.status).toBe("missing");
      expect(row.required).toBe(true);
      expect(row.action?.type).toBe("steps");
    });

    test("signed in reads ready with its version", async () => {
      expect(await codexToolRow(codexMac(home).p)).toMatchObject({ status: "ready", detail: "Codex 0.160.0, signed in" });
    });

    test("herdr reads its Codex integration on a Codex-only Mac", async () => {
      const { p } = codexMac(home);
      const rows = await toolRows(p, [], { hasBrew: false, secrets, integrations: CODEX_ONLY });
      expect(rows.find((r) => r.id === "tool.herdr")).toMatchObject({ status: "ready", detail: "herdr 0.8.0, Codex integration installed" });
    });

    test("the writing style reads Codex's skills, not Claude's", async () => {
      const { p, spawns } = codexMac(home);
      const rows = await toolRows(p, [], { hasBrew: false, secrets, integrations: CODEX_ONLY });
      expect(rows.some((r) => r.id === "skills.writing-style")).toBe(true);
      expect(spawns.map((s) => s.argv.join(" "))).toContain("codex plugin list --json");
      expect(spawns.filter(namesClaude)).toEqual([]);
    });

    test("team packs say they need Claude rather than vanishing", async () => {
      const { p } = codexMac(home);
      const rows = await toolRows(p, [{ pack: "widgets", tools: [], integrations: [] }], { hasBrew: false, secrets, integrations: CODEX_ONLY });
      expect(rows.find((r) => r.id === "pack.widgets")).toMatchObject({ status: "skipped", required: false });
    });
  });

  describe("codex.mcp", () => {
    const configPath = () => join(home, ".codex", "config.toml");
    const desired = () => codexMcpEntry(join(home, ".local", "bin", "rt"), join(home, ".codex"));
    const run = async (p: Probes) => codexMcpStep.run(makeCtx(p, { integrations: CODEX_ONLY }).ctx);

    const USER_CONFIG = [
      "# my settings",
      'model = "o3"',
      'approval_policy = "never"',
      'sandbox_mode = "workspace-write"',
      "",
      '[projects."/work/app"]',
      'trust_level = "trusted"',
      "",
      "# a server of mine",
      "[mcp_servers.other]",
      'command = "other-mcp"',
      "",
    ].join("\n");

    test("adds the entry with explicit harness, profile and tool approval", async () => {
      const { p } = codexMac(home);
      const outcome = await run(p);
      expect(outcome).toEqual({ state: "done", detail: `Added Mattstack to ${configPath()}` });
      const text = p.readFile(configPath())!;
      expect(text).toBe(renderCodexMcpTable(desired()));
      expect(Bun.TOML.parse(text)).toEqual({
        mcp_servers: {
          mattstack: {
            command: join(home, ".local", "bin", "rt"),
            args: ["mcp", "serve", "--harness", "codex", "--profile", join(home, ".codex")],
            default_tools_approval_mode: "approve",
          },
        },
      });
      expect(readSetupState(p).codexMcp).toEqual({ [configPath()]: codexMcpFingerprint(desired()) });
    });

    test("repeated install is idempotent", async () => {
      const { p } = codexMac(home);
      await run(p);
      const renames = p.calls.renames.length;
      const after = p.readFile(configPath());
      expect(await run(p)).toEqual({ state: "skipped", detail: "Already set up" });
      expect(p.calls.renames.length).toBe(renames);
      expect(p.readFile(configPath())).toBe(after);
      expect(codexMcpRow(p)).toMatchObject({ status: "ready" });
    });

    test("no unrelated host setting changes: only the one table is appended", async () => {
      const { p } = codexMac(home, { files: { [join(home, ".codex", "config.toml")]: USER_CONFIG } });
      expect((await run(p)).state).toBe("done");
      const text = p.readFile(configPath())!;
      expect(text.startsWith(USER_CONFIG)).toBe(true);
      const { mcp_servers: servers, ...rest } = Bun.TOML.parse(text) as Record<string, Record<string, unknown>>;
      const { mcp_servers: beforeServers, ...beforeRest } = Bun.TOML.parse(USER_CONFIG) as Record<string, Record<string, unknown>>;
      expect(rest).toEqual(beforeRest);
      expect(servers!.other).toEqual(beforeServers!.other);
      expect(Object.keys(p.calls.writes).filter((path) => !path.startsWith(join(home, ".codex")) && !path.includes("setup-state"))).toEqual([]);
    });

    test("a mattstack server the member wrote is left alone", async () => {
      const mine = `${USER_CONFIG}\n[mcp_servers.mattstack]\ncommand = "my-rt"\n`;
      const { p } = codexMac(home, { files: { [join(home, ".codex", "config.toml")]: mine } });
      const outcome = await run(p);
      expect(outcome.state).toBe("needs-you");
      expect(p.readFile(configPath())).toBe(mine);
      expect(codexMcpRow(p)).toMatchObject({ status: "needs-you", action: { type: "steps" } });
    });

    test("rt's own out-of-date entry is replaced and nothing else moves", async () => {
      const old = codexMcpEntry("/old/rt", join(home, ".codex"));
      const [top, tables] = [USER_CONFIG.slice(0, USER_CONFIG.indexOf("[projects")), USER_CONFIG.slice(USER_CONFIG.indexOf("[projects"))];
      const text = `${top}${renderCodexMcpTable(old)}\n${tables}`;
      const { p } = codexMac(home, { files: { [join(home, ".codex", "config.toml")]: text } });
      updateSetupState(p, (s) => ({ ...s, codexMcp: { [configPath()]: codexMcpFingerprint(old) } }));
      expect(codexMcpRow(p)).toMatchObject({ status: "missing" });
      expect(await run(p)).toEqual({ state: "done", detail: `Updated Mattstack in ${configPath()}` });
      const after = p.readFile(configPath())!;
      expect(after).toContain("# my settings");
      expect(after).toContain("# a server of mine");
      const parsed = Bun.TOML.parse(after) as { mcp_servers: Record<string, unknown> };
      expect(parsed.mcp_servers.mattstack).toEqual(desired());
      expect(parsed.mcp_servers.other).toEqual({ command: "other-mcp" });
    });

    test("an unparsable config fails with a remedy and is not written", async () => {
      const { p } = codexMac(home, { files: { [join(home, ".codex", "config.toml")]: "model = \n[[" } });
      const outcome = await run(p);
      expect(outcome.state).toBe("failed");
      expect(remedyOf(outcome)).toBe("Fix or remove that file, then Retry.");
      expect(p.calls.renames).toEqual([]);
    });

    test("an entry that could only land by changing other settings is refused", async () => {
      const inline = 'mcp_servers = { other = { command = "x" } }\n';
      const { p } = codexMac(home, { files: { [join(home, ".codex", "config.toml")]: inline } });
      const outcome = await run(p);
      expect(outcome.state).toBe("failed");
      expect(detailOf(outcome)).toContain("without changing your other Codex settings");
      expect(p.calls.renames).toEqual([]);
    });

    test("a config edited while rt was reading it is not overwritten", async () => {
      const { p } = codexMac(home, { files: { [join(home, ".codex", "config.toml")]: USER_CONFIG } });
      let reads = 0;
      const racing: Probes = { ...p, readFile: (path) => (path === configPath() && ++reads > 1 ? `${USER_CONFIG}# edited\n` : p.readFile(path)) };
      const outcome = await codexMcpStep.run(makeCtx(racing, { integrations: CODEX_ONLY }).ctx);
      expect(outcome.state).toBe("failed");
      expect(p.calls.renames).toEqual([]);
    });

    test("the edit helpers keep everything else", () => {
      const entry = codexMcpEntry("/rt", "/h/.codex");
      expect(readCodexMcpState(null, entry)).toEqual({ kind: "absent" });
      expect(readCodexMcpState("[[", entry)).toEqual({ kind: "unparsable" });
      const added = editCodexMcpEntry(USER_CONFIG, entry, "append");
      expect(added.ok && readCodexMcpState(added.text, entry)).toEqual({ kind: "current" });
      expect(editCodexMcpEntry(USER_CONFIG, entry, "replace")).toEqual({ ok: false, reason: "not-found" });
    });
  });

  describe("install adapters", () => {
    test("each harness supplies its own steps, in contract order, each once", () => {
      expect(HARNESS_INSTALLS.map((h) => h.id)).toEqual(["claude", "codex"]);
      expect(createIntegrationSteps(["codex", "claude", "codex", "nope"]).map((s) => s.id)).toEqual(["plugins.install", "linear.mcp", "claude.permissions", "codex.mcp"]);
      expect(createIntegrationSteps([])).toEqual([]);
    });

    test("no new step is update-safe", () => {
      expect(createIntegrationSteps(["codex"]).filter((s) => s.updateSafe)).toEqual([]);
    });

    test("reconcile changes nothing yet", async () => {
      const { ctx } = makeCtx(codexMac(home).p);
      for (const make of [createClaudeInstall, createCodexInstall]) {
        for (const mode of ["update", "restore", "uninstall"] as const) expect(await make().reconcile(mode, ctx)).toEqual([]);
      }
    });

    test("Codex readiness: CLI, sign-in, MCP entry and Codex reading it", async () => {
      const get = (command: string) => ok(JSON.stringify({ name: "mattstack", transport: { type: "stdio", command, args: ["mcp", "serve", "--harness", "codex", "--profile", join(home, ".codex")] } }));
      const signedOut = codexMac(home, { loggedIn: false }).p;
      expect(await createCodexInstall({ p: signedOut }).verify()).toEqual({ ok: true, data: { ready: false, reason: "Not signed in yet. Run codex login and sign in" } });

      const { p } = codexMac(home, { exec: (argv) => (argv.join(" ").startsWith("codex mcp get") ? get(join(home, ".local", "bin", "rt")) : (undefined as never)) });
      expect((await createCodexInstall({ p }).verify()).ok && (await createCodexInstall({ p }).verify())).toMatchObject({ ok: true, data: { ready: false } });
      await codexMcpStep.run(makeCtx(p, { integrations: CODEX_ONLY }).ctx);
      expect(await createCodexInstall({ p }).verify()).toEqual({ ok: true, data: { ready: true } });

      const stale = codexMac(home, { exec: (argv) => (argv.join(" ").startsWith("codex mcp get") ? get("/elsewhere/rt") : (undefined as never)) }).p;
      await codexMcpStep.run(makeCtx(stale, { integrations: CODEX_ONLY }).ctx);
      expect(await createCodexInstall({ p: stale }).verify()).toEqual({ ok: true, data: { ready: false, reason: "Codex starts a different mattstack server" } });
    });
  });

  describe("recording the integration choice", () => {
    test("a store that cannot be read is a failed write with a way forward", () => {
      const outcome = recordIntegrationChoice({ enabled: ["codex"] }, "user", () => {
        throw new Error("settings.user.jsonc is not valid JSONC");
      });
      expect(outcome.state).toBe("failed");
      expect(detailOf(outcome)).toContain("settings.user.jsonc is not valid JSONC");
      expect(remedyOf(outcome)).toBeDefined();
    });

    test("a refusal is a failed write; a saved choice is done", () => {
      expect(recordIntegrationChoice({ enabled: ["claude"], defaultHarness: "codex" }, "user", () => ({ ok: false, error: { code: "invalid", message: "codex is your default, but it is not turned on." } })))
        .toMatchObject({ state: "failed", detail: "codex is your default, but it is not turned on." });
      expect(recordIntegrationChoice({ enabled: ["codex"] }, "user", () => ({ ok: true, data: undefined }))).toEqual({ state: "done", detail: "Turned on codex" });
    });
  });
});
