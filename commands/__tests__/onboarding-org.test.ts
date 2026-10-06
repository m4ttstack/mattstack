import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { activeTeam, currentRole, readForgeUsername, readStore, setSetting } from "../../packages/rt-client/src/index.ts";
import { orgSettingsPath, userSettingsPath } from "../../lib/rt-paths.ts";
import type { SecretsSeams } from "../../lib/secrets/store.ts";
import { createApplyContext, runApplyWith, runUpdateWith, type ApplyContext, type StepDef } from "../../lib/setup/apply.ts";
import type { ApplyEvent } from "../../lib/setup/contract.ts";
import { readIntent } from "../../lib/setup/intent.ts";
import { MIGRATIONS } from "../../lib/setup/migrations/index.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import { createRealProbes, type Probes } from "../../lib/setup/probes.ts";
import { orgPullStep, recordForgeIdentity, teamIdentityStep } from "../../lib/setup/steps/org.ts";
import * as materializer from "../../lib/setup/skills-materialize.ts";
import { pluginsInstallStep } from "../../lib/setup/steps/plugins.ts";
import { teamCreateStep, teamJoinStep } from "../../lib/setup/steps/team.ts";
import { orgRows } from "../../lib/setup/validators/org.ts";
import { forgeLogin } from "../../lib/team/forge.ts";
import { createTeam, scaffoldFiles } from "../../lib/team/create.ts";
import { encodeCode, seal } from "../../lib/team/invite-crypto.ts";
import { joinDryRun } from "../../lib/team/join.ts";
import type { RelayClient } from "../../lib/team/relay-client.ts";
import { updateTeamLocal } from "../../lib/team/team-local.ts";
import type { InvitePointer } from "../../lib/setup/intent.ts";
import { teamUse, type TeamDeps } from "../team.ts";

const REMOTE = "https://github.com/acme/org.git";
const PENDING_MAIN = "a".repeat(40);
const GITHUB = { provider: "github" as const, host: "github.com" };
const NOW = new Date("2026-10-01T00:00:00.000Z");
const ID_HEX = "0102030405060708090a0b0c0d0e0f10";
const KEY = new Uint8Array(32).fill(7);
const CODE = encodeCode(ID_HEX, KEY);
const FAKE_PUBLIC_KEY = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const deckPath = () => join(home, "bin", "deck");
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const origin = (remote: string) => `[remote "origin"]\n\turl = ${remote}\n`;

const POINTER: InvitePointer = {
  v: 2, team: "acme", name: "Acme", remote: REMOTE, owner: "dev1", forge: "github.com",
  createdAt: "2026-10-01T00:00:00.000Z", username: "dev2", teams: ["gadgets", "widgets"],
};

const SECRETS: SecretsSeams = {
  ageKeySeam: {
    run: async (cmd) => {
      if (cmd[1] === "find-generic-password") return { code: 0, stdout: "AGE-SECRET-KEY-1QQQ\n", stderr: "" };
      if (cmd[0] === "age-keygen" && cmd[1] === "-y") return { code: 0, stdout: `${FAKE_PUBLIC_KEY}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  },
  execSeam: {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    fileExists: () => false, statFile: () => null, readFile: () => "", writeFile: () => {},
    ensureDir: () => {}, chmod: () => {}, fsyncAndRename: () => {}, removeFile: () => {},
  },
};

const ORIG_HOME = process.env.HOME;
let home: string;
let scratch: string[];
let execCalls: string[][];
let login: string | null;
let remoteTree: string | null;
let daemon: Probes["daemon"];
let redeemCalls: string[];
let marketplaces: Map<string, string>;
let installed: Map<string, boolean>;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-onboarding-")));
  process.env.HOME = home;
  scratch = [home];
  execCalls = [];
  login = "dev1";
  remoteTree = null;
  daemon = async () => null;
  redeemCalls = [];
  marketplaces = new Map();
  installed = new Map();
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "claude"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(deckPath(), "#!/bin/sh\n", { mode: 0o755 });
  mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });
  writeFileSync(join(home, ".mattstack", "user", ".git", "config"), origin("https://github.com/dev2/home.git"));
});

afterEach(() => {
  process.env.HOME = ORIG_HOME;
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function pMarketName(p: Probes, source: string): string {
  const raw = p.readFile(join(source, ".claude-plugin", "marketplace.json"));
  if (raw) return (JSON.parse(raw) as { name: string }).name;
  return source.includes("claude-plugins-official") ? "claude-plugins-official" : "mattstack";
}

function probes(): Probes {
  const real = createRealProbes();
  return {
    ...real,
    home,
    env: { HOME: home, PATH: join(home, "bin"), USER: "localdev" },
    now: () => NOW,
    exists: (path) => !path.startsWith("/Applications/") && real.exists(path),
    exec: async (argv, opts) => {
      execCalls.push(argv);
      const bin = basename(argv[0]!);
      if (bin === "gh") return login === null ? { code: 1, stdout: "", stderr: "not logged in" } : ok(JSON.stringify({ login }));
      if (bin === "git" && argv.includes("clone")) {
        const dir = argv.at(-1)!;
        if (remoteTree === null) return { code: 128, stdout: "", stderr: "fatal: repository not found" };
        cpSync(remoteTree, dir, { recursive: true });
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, ".git", "config"), origin(REMOTE));
        return ok();
      }
      if (bin === "git" && argv[1] === "init" && opts?.cwd) mkdirSync(join(opts.cwd, ".git"), { recursive: true });
      if (bin === "git" && argv[1] === "remote" && argv[2] === "add" && opts?.cwd) writeFileSync(join(opts.cwd, ".git", "config"), origin(argv[4]!));
      if (bin === "git" && argv.includes("symbolic-ref")) return ok("main\n");
      if (bin === "git" && argv[1] === "remote" && argv[2] === "get-url") {
        expect(argv).toEqual(["git", "remote", "get-url", "--push", "--all", "origin"]);
        return ok(`${REMOTE}\n`);
      }
      if (bin === "git" && argv.includes("ls-remote") && argv.includes("--refs")) {
        expect(argv.slice(-3)).toEqual(["--", REMOTE, "refs/heads/main"]);
        return ok();
      }
      if (bin === "git" && argv[1] === "rev-list") {
        expect(argv).toEqual(["git", "rev-list", "--max-count=1001", "refs/heads/main"]);
        return ok(`${PENDING_MAIN}\n`);
      }
      if (bin === "git" && argv[1] === "diff-tree") {
        expect(argv.at(-1)).toBe(PENDING_MAIN);
        return ok(`${Object.keys(scaffoldFiles("acme", "Acme", REMOTE)).join("\0")}\0`);
      }
      if (bin === "claude") {
        const [, , verb, sub, target] = argv;
        if (verb === "list") return ok(JSON.stringify([...installed].map(([id, enabled]) => ({ id, enabled, version: "0.1.0" }))));
        if (verb === "marketplace" && sub === "list") return ok(JSON.stringify([...marketplaces].map(([name, path]) => ({ name, source: "directory", path }))));
        if (verb === "marketplace" && sub === "add" && target) {
          const file = pMarketName(real, target);
          marketplaces.set(file, target);
          return ok(`Successfully added marketplace: ${file}`);
        }
        if (verb === "install" && sub) installed.set(sub, true);
        if (verb === "enable" && sub) installed.set(sub, true);
        if (verb === "disable" && sub) installed.set(sub, false);
      }
      return ok();
    },
    daemon: (cmd, payload, timeoutMs) => daemon(cmd, payload, timeoutMs),
    tray: async () => ({ status: 0, json: null }),
    fetch: async () => ({ status: 0, body: "", headers: {} }),
    runRt: async () => { throw new Error("No rt subprocess is allowed in this harness"); },
  };
}

function relayServing(pointer: InvitePointer): RelayClient {
  return {
    create: async () => { throw new Error("create is not used by join"); },
    fetch: async () => ({ ciphertext: await seal(pointer, KEY, ID_HEX) }),
    redeem: async (id) => { redeemCalls.push(id); return "redeemed"; },
    reply: async () => {},
    readReply: async () => { throw new Error("readReply is not used by join"); },
    delete: async () => { throw new Error("delete is not used by join"); },
  };
}

const NO_RELAY = relayServing(POINTER);

async function context(p: Probes, events: ApplyEvent[], opts: { relay?: RelayClient; update?: true } = {}): Promise<ApplyContext> {
  return createApplyContext({
    probes: p,
    emit: (event) => { events.push(event); },
    secrets: SECRETS,
    teamSecrets: () => SECRETS,
    relay: opts.relay ?? NO_RELAY,
    secretPresence: { has: async () => null },
    flags: { nonInteractive: true, teamOfOne: false, ci: false, ...(opts.update ? { update: true as const } : {}) },
  });
}

function settled(events: ApplyEvent[], id: string): { state: string; detail?: string; remedy?: string } | undefined {
  const steps = events.filter((e): e is Extract<ApplyEvent, { event: "step" }> => e.event === "step" && e.id === id && e.state !== "running");
  const last = steps.at(-1);
  return last ? { state: last.state, ...(last.detail !== undefined ? { detail: last.detail } : {}), ...(last.remedy !== undefined ? { remedy: last.remedy } : {}) } : undefined;
}

function orgTree(roster: { username: string; teams: string[] }[]): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-onboarding-org-")));
  scratch.push(dir);
  const write = (rel: string, value: unknown) => {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  };
  write("mattstack/mattstack.jsonc", { role: "org", org: "acme" });
  write("mattstack/org/settings.org.jsonc", {
    "mattstack.integrations": { forge: GITHUB },
    "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] }, gadgets: { owners: ["dev1"] } } },
    "mattstack.roster": roster,
  });
  for (const team of ["widgets", "gadgets"]) {
    write(`mattstack/teams/${team}/settings.team.jsonc`, { "board.title": team });
    write(`mattstack/teams/${team}/packs/${team}/.claude-plugin/plugin.json`, { name: team, version: "0.1.0" });
    write(`mattstack/teams/${team}/packs/${team}/pack/skills.jsonc`, {});
    write(`mattstack/teams/${team}/packs/${team}/requirements.jsonc`, { tools: [{ name: `${team}-tool`, why: "Run the team tools" }], integrations: [] });
  }
  write(".claude-plugin/marketplace.json", {
    name: "acme",
    owner: { name: "Acme" },
    plugins: ["widgets", "gadgets"].map((team) => ({ name: team, source: `./mattstack/teams/${team}/packs/${team}` })),
  });
  return dir;
}

function cloneHere(tree: string): string {
  const dir = join(home, ".mattstack", "teams", "acme");
  cpSync(tree, dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), origin(REMOTE));
  return dir;
}

const packInstalls = () => execCalls.filter((a) => basename(a[0]!) === "claude" && a[1] === "plugin" && a[2] === "install").map((a) => a.at(-1)!).filter((id) => id.endsWith("@acme"));
const activeTeamSetting = () => readStore(userSettingsPath()).global["mattstack.activeTeam"];
describe("onboarding in an org", () => {
  test("create: roles wait for the forge login, then the creator is admin, owner and on the roster with the first team active", async () => {
    const p = probes();
    login = null;
    const first = await createTeam(p, { name: "Acme", remote: REMOTE, others: false }, SECRETS.ageKeySeam, { forgeLogin, forgeToken: async () => null });
    expect(first.rolesDeferred).toBe(true);
    expect(readForgeUsername("acme")).toBeNull();

    login = "dev1";
    const events: ApplyEvent[] = [];
    const result = await runApplyWith([teamCreateStep, orgPullStep, teamIdentityStep], await context(p, events));
    expect(result).toEqual({ ok: true });
    const pushIndex = execCalls.findIndex((argv) => argv.includes("push"));
    expect(pushIndex).toBeGreaterThan(3);
    expect(execCalls.slice(pushIndex - 4, pushIndex).map((argv) => argv[1])).toEqual(["remote", "ls-remote", "rev-list", "diff-tree"]);

    const org = readStore(orgSettingsPath("acme")).global;
    expect(org["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { acme: { owners: ["dev1"] } } });
    expect(org["mattstack.roster"]).toEqual([{ username: "dev1", agePublicKey: FAKE_PUBLIC_KEY, teams: ["acme"] }]);
    expect(readForgeUsername("acme")).toBe("dev1");
    expect(activeTeam()).toMatchObject({ org: "acme", team: "acme", reason: "first-team" });
    expect(currentRole("acme")).toEqual({ kind: "admin" });
    expect(settled(events, "team.identity")).toEqual({ state: "skipped", detail: "Already recorded" });
    expect(settled(events, "org.pull")).toMatchObject({ state: "skipped" });

    const plan = await composePlan({ p, secrets: { has: async () => null }, ci: false, mode: "status", orgs: ["acme"] });
    const ids = plan.groups.flatMap((g) => g.rows.map((r) => r.id));
    for (const id of ["team.none", "team.identity", "team.push-access"]) expect(ids).not.toContain(id);
  });

  test("join dry run: the teams come from the pointer, and nothing is cloned", async () => {
    const p = probes();
    const result = await joinDryRun(p, relayServing(POINTER), CODE);
    expect(result.teams).toEqual(["gadgets", "widgets"]);
    expect(existsSync(join(home, ".mattstack", "teams", "acme"))).toBe(false);
    expect(readIntent(p)?.mode).toBe("join");
  });

  test("join: Install records who you are, starts you on the invite's first team, and installs that team's pack alone", async () => {
    const p = probes();
    login = "dev2";
    remoteTree = orgTree([{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["gadgets", "widgets"] }]);
    const relay = relayServing(POINTER);
    await joinDryRun(p, relay, CODE);

    const events: ApplyEvent[] = [];
    const ctx = await context(p, events, { relay });
    expect(ctx.reqs).toEqual([]);
    const result = await runApplyWith([teamJoinStep, orgPullStep, teamIdentityStep, pluginsInstallStep], ctx);
    expect(ctx.reqs).toMatchObject([{ pack: "gadgets", tools: [{ name: "gadgets-tool" }] }]);
    expect(result).toEqual({ ok: true });

    expect(readForgeUsername("acme")).toBe("dev2");
    expect(activeTeamSetting()).toBe("gadgets");
    expect(activeTeam()).toMatchObject({ team: "gadgets", reason: "chosen" });
    expect(packInstalls()).toEqual(["gadgets@acme"]);
    expect(redeemCalls).toEqual([ID_HEX]);
  });

  test("join: a clone whose roster does not list the invitee stops before the invite is used, and a rerun resumes", async () => {
    const p = probes();
    login = "dev2";
    remoteTree = orgTree([{ username: "dev1", teams: ["widgets"] }]);
    const relay = relayServing(POINTER);
    await joinDryRun(p, relay, CODE);

    const events: ApplyEvent[] = [];
    const result = await runApplyWith([teamJoinStep, pluginsInstallStep], await context(p, events, { relay }));
    expect(result).toEqual({ ok: false, failedStep: "team.join" });
    expect(settled(events, "team.join")).toEqual({
      state: "failed",
      detail: "Your admin's roster change has not reached the org repo yet; try again in a minute",
      remedy: "Retry in a minute. You do not need a new code",
    });
    expect(redeemCalls).toEqual([]);
    expect(readIntent(p)?.mode).toBe("join");
    expect(activeTeamSetting()).toBeUndefined();
    expect(packInstalls()).toEqual([]);

    const org = orgSettingsPath("acme");
    const store = readStore(org).global;
    p.writeFile(org, JSON.stringify({ ...store, "mattstack.roster": [{ username: "dev2", teams: ["gadgets", "widgets"] }] }));
    const retryEvents: ApplyEvent[] = [];
    const retried = await runApplyWith([teamJoinStep, orgPullStep, teamIdentityStep, pluginsInstallStep], await context(p, retryEvents, { relay }));
    expect(retried).toEqual({ ok: true });
    expect(settled(retryEvents, "team.join")?.state).toBe("done");
    expect(redeemCalls).toEqual([ID_HEX]);
    expect(readIntent(p)).toBeNull();
    expect(readForgeUsername("acme")).toBe("dev2");
    expect(activeTeam()).toMatchObject({ team: "gadgets", reason: "chosen" });
    expect(packInstalls()).toEqual(["gadgets@acme"]);
    expect(execCalls.filter((a) => a[0] === "git" && a.includes("clone"))).toHaveLength(1);
  });

  test("join: a different forge login is refused at Install, naming both, with the invite unspent and nothing recorded", async () => {
    const p = probes();
    login = "trillian";
    remoteTree = orgTree([{ username: "dev2", teams: ["gadgets", "widgets"] }]);
    const relay = relayServing(POINTER);
    await joinDryRun(p, relay, CODE);

    const events: ApplyEvent[] = [];
    const result = await runApplyWith([teamJoinStep, pluginsInstallStep], await context(p, events, { relay }));
    expect(result).toEqual({ ok: false, failedStep: "team.join" });
    expect(settled(events, "team.join")).toEqual({
      state: "failed",
      detail: "This invite is for dev2; you're signed in as trillian.",
      remedy: "Ask for an invite for trillian, or connect dev2's token.",
    });
    expect(redeemCalls).toEqual([]);
    expect(readForgeUsername("acme")).toBeNull();
    expect(activeTeamSetting()).toBeUndefined();
    expect(readIntent(p)?.mode).toBe("join");
  });

  test("join: an invite from before teams is refused, leaving no intent and no clone", async () => {
    const p = probes();
    const old = { ...POINTER, v: 1 } as unknown as InvitePointer;
    await expect(joinDryRun(p, relayServing(old), CODE)).rejects.toMatchObject({
      code: "invite-outdated",
      message: "That invite was made by an older mattstack. Ask for a new invite.",
    });
    expect(readIntent(p)).toBeNull();
    expect(existsSync(join(home, ".mattstack", "teams", "acme"))).toBe(false);
  });

  test("a second team: your first team holds until you switch, and the switch turns the packs over and restarts the apps", async () => {
    const p = probes();
    const dir = cloneHere(orgTree([{ username: "dev2", teams: ["gadgets"] }]));
    updateTeamLocal(p, "acme", { forgeUsername: "dev2" });
    expect(activeTeam()).toMatchObject({ team: "gadgets", listedOn: ["gadgets"] });
    const store = join(dir, "mattstack", "org", "settings.org.jsonc");
    const org = JSON.parse(p.readFile(store)!) as Record<string, unknown>;
    writeFileSync(store, JSON.stringify({ ...org, "mattstack.roster": [{ username: "dev2", teams: ["gadgets", "widgets"] }] }));
    expect(activeTeam()).toMatchObject({ team: "gadgets", listedOn: ["gadgets", "widgets"] });

    const lines: string[] = [];
    const deps: TeamDeps = { probes: p, print: (line) => { lines.push(line); }, deckPath, secrets: SECRETS, secretPresence: { has: async () => null } };
    await teamUse(["widgets", "--json"], {}, deps);

    const { contract: _contract, at: _at, ...body } = JSON.parse(lines[0]!);
    expect(body).toMatchObject({ team: "widgets", previous: "gadgets", disabled: "gadgets@acme", restarted: ["board", "boxscore"] });
    expect(activeTeamSetting()).toBe("widgets");
    const claude = execCalls.filter((a) => basename(a[0]!) === "claude").map((a) => a.slice(1).join(" "));
    expect(claude).toContain("plugin enable widgets@acme");
    expect(claude).toContain("plugin disable gadgets@acme");
    expect(execCalls).toContainEqual([deckPath(), "restart", "board"]);
    expect(execCalls).toContainEqual([deckPath(), "restart", "boxscore"]);
  });

  for (const hasClaude of [true, false]) {
    test(`team switching with Claude ${hasClaude ? "available" : "missing"} materializes once and reports installation truthfully`, async () => {
      const p = probes();
      cloneHere(orgTree([{ username: "dev2", teams: ["gadgets", "widgets"] }]));
      updateTeamLocal(p, "acme", { forgeUsername: "dev2" });
      if (!hasClaude) rmSync(join(home, "bin", "claude"));
      const materialize = materializer.materializeSkills;
      const outcomes: Awaited<ReturnType<typeof materialize>>[] = [];
      const scan = spyOn(materializer, "materializeSkills").mockImplementation(async (...args) => {
        const result = await materialize(...args);
        outcomes.push(result);
        return result;
      });
      try {
        const lines: string[] = [];
        await teamUse(["widgets", "--json"], {}, { probes: p, print: (line) => { lines.push(line); }, deckPath, secrets: SECRETS, secretPresence: { has: async () => null } });
        const result = JSON.parse(lines[0]!);
        expect(result.pack).toMatchObject({ installed: hasClaude, enabled: hasClaude });
        expect(activeTeamSetting()).toBe("widgets");
        expect(outcomes).toHaveLength(1);
        expect(outcomes[0]).toMatchObject({ skipped: true, repos: [] });
        if (!hasClaude) expect(result.pack.detail).toContain("Claude Code is not installed");
      } finally { scan.mockRestore(); }
    });
  }

  test("the update run from the old layout: the migration, then the pull that brings the org layout, then identity, then the install against what the pull brought", async () => {
    const p = probes();
    setSetting("board.peerAsks", { enabled: false }, "user");
    const user = readStore(userSettingsPath()).global;
    writeFileSync(userSettingsPath(), JSON.stringify({ ...user, "board.defaultPack": "widgets" }));
    const dir = join(home, ".mattstack", "teams", "acme");
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), origin(REMOTE));
    mkdirSync(join(dir, "mattstack"), { recursive: true });
    writeFileSync(join(dir, "mattstack", "settings.team.jsonc"), JSON.stringify({ "board.title": "Acme" }));

    const converted = orgTree([{ username: "dev2", teams: ["gadgets", "widgets"] }]);
    login = "dev2";
    daemon = async (cmd) => {
      if (cmd !== "team:pull") return null;
      expect(readStore(userSettingsPath()).global["board.defaultPack"]).toBeUndefined();
      rmSync(join(dir, "mattstack"), { recursive: true, force: true });
      cpSync(converted, dir, { recursive: true });
      return { ok: true, data: { outcome: "fast-forwarded", detail: null } };
    };

    const verify: StepDef = { id: "verify", title: "Verify", kind: "rt", updateSafe: true, applies: () => true, run: async () => ({ state: "done", detail: "" }) };

    const events: ApplyEvent[] = [];
    const ctx = await context(p, events, { update: true });
    expect(ctx.reqs).toEqual([]);
    const result = await runUpdateWith([orgPullStep, teamIdentityStep, pluginsInstallStep, verify], MIGRATIONS, ctx);
    expect(result.ok).toBe(true);
    expect(ctx.reqs).toMatchObject([{ pack: "gadgets", tools: [{ name: "gadgets-tool" }] }]);
    expect(readForgeUsername("acme")).toBe("dev2");
    expect(activeTeam()).toMatchObject({ team: "gadgets", reason: "first-team" });

    const expectedOrder = ["migration.2026-10-01-board-peer-trigger", "migration.2026-10-01-unset-board-default-pack", "migration.2026-10-02-retire-switchboard-url", "org.pull", "team.identity", "plugins.install", "verify"];
    const order = events.filter((e) => e.event === "step" && e.state === "running").map((e) => (e as { id: string }).id);
    expect(order).toEqual(expectedOrder);
    expect(events.find((e) => e.event === "plan")).toMatchObject({ steps: expectedOrder.map((id) => ({ id })) });
    expect(settled(events, "migration.2026-10-01-board-peer-trigger")).toEqual({ state: "skipped", detail: "Automatic peer asks are off" });
    expect(settled(events, "migration.2026-10-01-unset-board-default-pack")).toEqual({ state: "done", detail: "Removed the old default pack setting" });
    expect(settled(events, "org.pull")).toEqual({ state: "done", detail: "Pulled acme" });
    expect(settled(events, "team.identity")).toEqual({ state: "done", detail: "You are dev2" });
    expect(settled(events, "plugins.install")).toMatchObject({ state: "done" });
    expect(packInstalls()).toEqual(["gadgets@acme"]);
  });

  test("restore: a Mac with no machine-local record gets its role back from the roster", async () => {
    const p = probes();
    cloneHere(orgTree([{ username: "dev1", teams: ["widgets"] }]));
    expect(readForgeUsername("acme")).toBeNull();
    expect(() => setSetting("board.gitlabHost", "gitlab.example.com", "org")).toThrow("can't tell who you are");

    login = "dev1";
    const events: ApplyEvent[] = [];
    await runApplyWith([teamIdentityStep], await context(p, events));
    expect(settled(events, "team.identity")).toEqual({ state: "done", detail: "You are dev1" });
    expect(currentRole("acme")).toEqual({ kind: "admin" });
    setSetting("board.gitlabHost", "gitlab.example.com", "org");
    expect(readStore(orgSettingsPath("acme")).global["board.gitlabHost"]).toBe("gitlab.example.com");
  });

  test("restore with no forge token: the row says so, and it clears once the forge is connected", async () => {
    const p = probes();
    cloneHere(orgTree([{ username: "dev1", teams: ["widgets"] }]));
    login = null;
    const events: ApplyEvent[] = [];
    await runApplyWith([teamIdentityStep], await context(p, events));
    expect(settled(events, "team.identity")).toEqual({ state: "needs-you", detail: "rt can't tell who you are on GitHub. Connect your GitHub account in Setup" });

    const noStatus = async () => [];
    expect((await orgRows(p, "acme", { forge: GITHUB, readStatus: noStatus })).map((r) => r.id)).toEqual(["team.identity"]);
    await recordForgeIdentity(p, "acme", GITHUB, "token", async () => "dev1");
    expect(await orgRows(p, "acme", { forge: GITHUB, readStatus: noStatus })).toEqual([]);
    expect(currentRole("acme")).toEqual({ kind: "admin" });
  });
  test("a recorded member without a team gets shared org settings until the pulled roster assigns a team", async () => {
    const p = probes();
    const dir = cloneHere(orgTree([{ username: "dev2", teams: [] }]));
    login = "dev2";
    const events: ApplyEvent[] = [];
    expect(await runApplyWith([teamIdentityStep, pluginsInstallStep], await context(p, events))).toEqual({ ok: true });
    expect(packInstalls()).toEqual([]);
    const missing = await orgRows(p, "acme", { forge: GITHUB, readStatus: async () => [] });
    expect(missing.map((r) => r.id)).toEqual(["team.none"]);
    expect(missing[0]!.detail).toContain("No team lists dev2");
    expect(missing[0]!.detail).toContain("no team pack is available");

    const changed = orgTree([{ username: "dev2", teams: ["widgets"] }]);
    daemon = async (cmd) => {
      if (cmd !== "team:pull") return null;
      cpSync(changed, dir, { recursive: true });
      return { ok: true, data: { outcome: "fast-forwarded", detail: null } };
    };
    const refreshedEvents: ApplyEvent[] = [];
    const result = await runApplyWith([orgPullStep, teamIdentityStep, pluginsInstallStep], await context(p, refreshedEvents));
    expect(settled(refreshedEvents, "plugins.install")).toMatchObject({ state: "done" });
    expect(result).toEqual({ ok: true });
    expect(activeTeam()).toMatchObject({ team: "widgets", reason: "first-team" });
    expect(packInstalls()).toEqual(["widgets@acme"]);
    expect(await orgRows(p, "acme", { forge: GITHUB, readStatus: async () => [] })).toEqual([]);
  });

  test("an admin's push-access row clears when the daemon no longer reports a forge refusal", async () => {
    const p = probes();
    cloneHere(orgTree([{ username: "dev1", teams: ["widgets"] }]));
    login = "dev1";
    expect(await runApplyWith([teamIdentityStep], await context(p, []))).toEqual({ ok: true });
    let refused = true;
    daemon = async (cmd) => cmd === "team:snapshot-status" ? { ok: true, data: [{ slug: "acme", lastPushError: refused ? "remote: Write access to repository not granted" : null }] } : null;
    const plan = () => composePlan({ p, secrets: { has: async () => null }, ci: false, mode: "status", orgs: ["acme"] });
    const rows = (await plan()).groups.flatMap((g) => g.rows).filter((r) => r.id === "team.push-access");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toContain("org repo refused the push");
    refused = false;
    expect((await plan()).groups.flatMap((g) => g.rows.map((r) => r.id))).not.toContain("team.push-access");
  });

});
