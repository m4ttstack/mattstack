import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createCodexSkills } from "../../lib/agent-integrations/codex/skills.ts";
import type { SkillRunner } from "../../lib/skills/installed-plugins.ts";
import type { InitDeps } from "../../lib/skills/init.ts";
import { selectSkillsHarness, type HostChoice, type SkillsHost } from "../../lib/skills/maintain-host.ts";
import type { PackInfo } from "../../lib/skills/packs.ts";
import { syncPack, type SyncDeps } from "../../lib/skills/sync.ts";
import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { skillsAudit } from "../skills-audit.ts";
import { skillsInit } from "../skills-init.ts";
import { skillsLink } from "../skills-link.ts";
import { realWritingStyleDeps, writingStyleUse } from "../skills-writing-style.ts";

let root: string;
let home: string;
let codexHome: string;
let io: CapturedOut;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-harness-")));
  home = join(root, "home");
  codexHome = join(home, ".codex");
  mkdirSync(codexHome, { recursive: true });
  io = captureSkills();
  process.exitCode = 0;
});

afterEach(() => {
  io.restore();
  process.exitCode = 0;
  rmSync(root, { recursive: true, force: true });
});

type Call = { bin: string; args: string[]; codexHome: string | undefined };

/** A fake `codex` CLI: what it lists installed is what its `plugin add` last installed. */
function fakeCodex(opts: { installed?: Record<string, string>; next?: Record<string, string>; failAdd?: string } = {}) {
  const calls: Call[] = [];
  const installed = new Map(Object.entries(opts.installed ?? {}));
  const place = (id: string, version: string) => {
    const [name, market] = id.split("@") as [string, string];
    const dir = join(codexHome, "plugins", "cache", market, name, version);
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version }));
  };
  for (const [id, version] of installed) place(id, version);
  const run: SkillRunner = async (bin, args, o) => {
    calls.push({ bin, args, codexHome: o.env.CODEX_HOME });
    const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
    if (args[0] === "plugin" && args[1] === "list") {
      const rows = [...installed].map(([id, version]) => {
        const [name, marketplaceName] = id.split("@");
        return { pluginId: id, name, marketplaceName, version, installed: true, enabled: true };
      });
      return ok(JSON.stringify({ installed: rows }));
    }
    if (args[0] === "plugin" && args[1] === "add") {
      if (opts.failAdd) return { status: 1, stdout: "", stderr: opts.failAdd };
      const id = args[2]!;
      const version = opts.next?.[id] ?? "1.0.0";
      installed.set(id, version);
      place(id, version);
      return ok(`Added plugin \`${id}\``);
    }
    return ok();
  };
  const skills = createCodexSkills({ env: { HOME: home, CODEX_HOME: codexHome }, bin: () => "/fake/codex", run });
  const host: SkillsHost = { harness: "codex", label: "Codex", bin: "/fake/codex", skills, env: { CODEX_HOME: codexHome } };
  return { calls, host };
}

const codexOnly = (host: SkillsHost): HostChoice => ({
  select: async (explicit) => (explicit === undefined || explicit === "codex" ? { ok: true, data: "codex" } : { ok: false, error: { code: "refused", message: `${explicit} is not turned on` } }),
  hostFor: () => host,
});

function noClaude(calls: Call[]) {
  for (const c of calls) {
    expect(c.bin).not.toContain("claude");
    expect(c.args.join(" ")).not.toContain(".claude/");
    expect(c.codexHome).toBe(codexHome);
  }
}

/** A pack that is its own engine, with its source at 1.0.0 and nothing to recompile. */
function syncWorld(host: SkillsHost): { pack: PackInfo; deps: SyncDeps } {
  const dir = join(root, "pack");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "1.0.0" }));
  const pack: PackInfo = { name: "acme", dir, layout: "flat", surfacePath: join(dir, "pack", "surface.jsonc"), marketplace: "acme-market" };
  const deps: SyncDeps = {
    mayCompile: () => true,
    run: async (cmd, args) => {
      if (cmd !== "git") throw new Error(`sync ran ${cmd}, not git`);
      if (args[0] === "branch") return { code: 0, stdout: "main\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    claudeBin: null,
    checkPack: async () => ({ drift: false, lintHits: 0, strict: false }),
    compilePack: async () => { throw new Error("nothing to compile"); },
    materialize: async () => ({ ok: true, detail: "materialized" }),
    configDir: join(home, ".claude"),
    cswapSessionsDir: join(root, "no-cswap"),
    inTreeRoot: null,
    host,
  };
  return { pack, deps };
}

function skillDir(parent: string, dirName: string, name: string): string {
  const dir = join(parent, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\nbody\n`);
  return dir;
}

describe("skills maintenance through the selected integration", () => {
  test("Codex init sync link audit and style need no Claude", async () => {
    // The configured default: agent.provider when it is on, else the first one on; Claude while the switch is off.
    expect(await selectSkillsHarness(undefined, { switchOn: () => true, enabled: () => ["codex"], preferred: () => "claude" })).toEqual({ ok: true, data: "codex" });
    expect(await selectSkillsHarness(undefined, { switchOn: () => true, enabled: () => ["claude", "codex"], preferred: () => "codex" })).toEqual({ ok: true, data: "codex" });
    expect(await selectSkillsHarness(undefined, { switchOn: () => false, enabled: () => ["codex"], preferred: () => "codex" })).toEqual({ ok: true, data: "claude" });
    expect(await selectSkillsHarness("codex", { switchOn: () => false, enabled: () => ["codex"], preferred: () => undefined })).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await selectSkillsHarness("claude", { switchOn: () => true, enabled: () => ["codex"], preferred: () => undefined })).toMatchObject({ ok: false, error: { code: "refused" } });

    // init: Codex registers the org's marketplace and installs the pack from it.
    const init = fakeCodex();
    const orgDir = join(home, ".mattstack", "teams", "acme");
    expect(await init.host.skills.maintain("init", orgDir, { plugin: "acme@acme-market" })).toEqual({ ok: true, data: undefined });
    expect(init.calls.map((c) => c.args)).toEqual([["plugin", "marketplace", "add", orgDir], ["plugin", "add", "acme@acme-market"]]);
    noClaude(init.calls);
    writeFileSync(join(codexHome, "config.toml"), `[marketplaces.acme-market]\nsource_type = "local"\nsource = "${orgDir}"\n`);
    const again = fakeCodex();
    await again.host.skills.maintain("init", orgDir, { plugin: "acme@acme-market" });
    expect(again.calls.map((c) => c.args)).toEqual([["plugin", "add", "acme@acme-market"]]);

    // init's receipt keeps its envelope; a Codex Mac with no codex is told so.
    const minimal = { gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }), engineDescription: () => "work", harness: "codex", skills: null } as unknown as InitDeps;
    await skillsInit(["--json"], {}, minimal);
    const receipt = JSON.parse(io.stdout()) as { error: { code: string; message: string; refused: boolean } };
    expect(Object.keys(receipt)).toEqual(["contract", "at", "error"]);
    expect(receipt.error.code).toBe("codex-missing");
    expect(receipt.error.refused).toBe(true);
    expect(receipt.error.message).toContain("Codex is not on your PATH");
    expect(process.exitCode).toBe(2);
    io.clear();

    // sync: the installed pack lags its source, so Codex updates it and the listing confirms.
    const sync = fakeCodex({ installed: { "acme@acme-market": "0.9.0" } });
    const world = syncWorld(sync.host);
    const report = await syncPack(world.pack, world.pack, world.deps);
    expect(Object.keys(report)).toEqual(["ok", "pack", "steps", "versions", "warnings", "restartNeeded"]);
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "update-pack")).toEqual({ name: "update-pack", status: "ran", detail: "updated acme@acme-market" });
    expect(report.steps.find((s) => s.name === "verify-installed")?.status).toBe("ran");
    expect(report.steps.find((s) => s.name === "cswap-sweep")?.status).toBe("skipped");
    expect(report.versions.pack).toEqual({ source: "1.0.0", installedBefore: "0.9.0", installedAfter: "1.0.0" });
    expect(sync.calls.map((c) => c.args)).toContainEqual(["plugin", "add", "acme@acme-market"]);
    noClaude(sync.calls);

    // link: links land in Codex's own skills folder, under the envelope's existing keys.
    const link = fakeCodex();
    const src = join(root, "bundle");
    const skill = skillDir(src, "ship", "ship");
    await skillsLink(["--from", src, "--json"], {}, codexOnly(link.host));
    const linked = JSON.parse(io.stdout()) as Record<string, unknown>;
    expect(Object.keys(linked)).toEqual(["contract", "at", "ok", "dryRun", "skillsDir", "claudeSkillsDir", "changed", "actions"]);
    expect(linked.claudeSkillsDir).toBe(join(codexHome, "skills"));
    expect(readlinkSync(join(codexHome, "skills", "ship"))).toBe(skill);
    expect(existsSync(join(home, ".claude"))).toBe(false);
    io.clear();

    // audit: a locked-down codex exec run whose last agent message is the report.
    const audit = fakeCodex();
    const packDir = join(root, "audit-pack");
    mkdirSync(packDir);
    let argv: string[] = [];
    let stdin: string | undefined;
    let runHome: string | undefined;
    const events = [
      { type: "thread.started", thread_id: "t" },
      { type: "item.completed", item: { id: "i0", type: "agent_message", text: "thinking" } },
      { type: "item.completed", item: { id: "i1", type: "agent_message", text: "findings: 0" } },
      { type: "turn.completed" },
    ].map((e) => JSON.stringify(e)).join("\n");
    await skillsAudit(["--pack-dir", packDir, "--json"], {}, {
      ...codexOnly(audit.host),
      run: async (a, o) => { argv = a; stdin = o?.stdin; runHome = o?.env?.CODEX_HOME; return { stdout: events, stderr: "", exitCode: 0 }; },
    });
    expect(runHome).toBe(codexHome);
    expect(argv.slice(0, 3)).toEqual(["/fake/codex", "exec", "--json"]);
    expect(argv).toContain("--sandbox=read-only");
    expect(argv).toContain("--ignore-user-config");
    expect(argv.at(-1)).toBe("-");
    expect(stdin).toContain("You are auditing a mattstack skill pack");
    const audited = JSON.parse(io.stdout()) as Record<string, unknown>;
    expect(Object.keys(audited)).toEqual(["pack", "packDir", "files", "report", "advisory", "claudeExit"]);
    expect(audited.report).toBe("findings: 0");
    io.clear();

    // style: a skill Codex reports installed is usable; personal styles link into Codex's folder.
    const pluginDir = join(codexHome, "plugins", "cache", "mk", "voices", "1.0.0");
    skillDir(join(pluginDir, "skills"), "writing-style-team", "writing-style-team");
    const style = fakeCodex({ installed: { "voices@mk": "1.0.0" } });
    mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });
    skillDir(join(home, ".mattstack", "user", "skills"), "my-voice", "my-voice");
    const printed: string[] = [];
    const writes: unknown[] = [];
    const deps = {
      ...realWritingStyleDeps(style.host),
      home: () => home,
      now: () => new Date("2026-10-09T00:00:00Z"),
      print: (s: string) => { printed.push(s); },
      exit: (code: number): never => { throw new Error(`exit ${code}`); },
      writeSetting: (key: string, value: unknown, scope: string) => { writes.push([key, value, scope]); },
      resolve: () => ({ skill: "mattstack:writing-style-conversational", source: "fallback" as const }),
    };
    await writingStyleUse(["voices:writing-style-team", "--json"], {}, deps);
    expect(JSON.parse(printed[0]!)).toEqual({ contract: 1, at: "2026-10-09T00:00:00.000Z", skill: "voices:writing-style-team", scope: "user" });
    expect(writes).toEqual([["skills.writingStyle", "voices:writing-style-team", "user"]]);
    expect(lstatSync(join(codexHome, "skills", "my-voice")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, ".claude"))).toBe(false);
    noClaude(style.calls);
  });

  test("maintenance failure does not update installed-version state", async () => {
    // sync: Codex refuses the update, so the run fails and the installed version stays as it was.
    const sync = fakeCodex({ installed: { "acme@acme-market": "0.9.0" }, failAdd: "plugin source unreadable" });
    const world = syncWorld(sync.host);
    const report = await syncPack(world.pack, world.pack, world.deps);
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)).toEqual({ name: "update-pack", status: "failed", detail: "Updating acme@acme-market failed: plugin source unreadable" });
    expect(report.versions.pack).toEqual({ source: "1.0.0", installedBefore: "0.9.0", installedAfter: "0.9.0" });
    expect(report.restartNeeded).toBe(false);
    expect(existsSync(join(codexHome, "plugins", "cache", "acme-market", "acme", "1.0.0"))).toBe(false);

    // init: a failed install stays failed, in Codex's own words.
    const init = fakeCodex({ failAdd: "no such plugin" });
    expect(await init.host.skills.maintain("init", join(root, "org"), { plugin: "acme@acme-market" })).toEqual({
      ok: false, error: { code: "not-ready", message: "Installing acme@acme-market in Codex failed (exit 1): no such plugin" },
    });

    // link: a Codex home rt cannot place fails the run and links nothing anywhere.
    const src = join(root, "bundle");
    skillDir(src, "ship", "ship");
    const nowhere = createCodexSkills({ env: { HOME: home, CODEX_HOME: "relative/codex" }, bin: () => "/fake/codex" });
    const { exitCode, errors } = await runExpectingCleanExit(() => skillsLink(["--from", src], {}, codexOnly({ harness: "codex", label: "Codex", bin: "/fake/codex", skills: nowhere })));
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("does not name a Codex home folder");
    expect(existsSync(join(codexHome, "skills"))).toBe(false);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });
});
