import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSetting } from "../../settings/write.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import type { RelayClient } from "../../team/relay-client.ts";
import type { ApplyContext } from "../apply.ts";
import { BASE_PLUGINS, MODS_PLUGIN, modsPluginWanted } from "../base-plugins.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { MATTSTACK_MARKETPLACE_SOURCE, OFFICIAL_MARKETPLACE_SOURCE, pluginsInstallStep } from "../steps/plugins.ts";
import { fakeProbes, ok } from "./fakes.ts";
import type { Probes } from "../probes.ts";

const noop = async () => ({ code: 0, stdout: "", stderr: "" });
const fakeSecrets: SecretsSeams = {
  ageKeySeam: { run: noop },
  execSeam: {
    run: noop,
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

function makeCtx(p: Probes, overrides: Partial<ApplyContext> = {}): ApplyContext {
  return {
    p,
    emit: () => {},
    log: () => {},
    intent: null,
    team: { slug: "", name: "", mode: "none" },
    snapshot: null,
    reqs: [],
    nonInteractive: false,
    teamOfOne: false,
    appPath: null,
    ci: false,
    secrets: fakeSecrets,
    teamSecrets: () => fakeSecrets,
    relay: fakeRelay,
    secretPresence: { has: async () => null },
    redact: () => {},
    async need() {
      return "no-app";
    },
    ...overrides,
  };
}

const MARKETPLACES = [
  { name: "mattstack", source: "git", url: MATTSTACK_MARKETPLACE_SOURCE },
  { name: "claude-plugins-official", source: "github", repo: OFFICIAL_MARKETPLACE_SOURCE },
];

/** A claude whose plugin list is `installed` (id to enabled), changed by every install, enable, disable and uninstall it is asked to run. */
function memberClaude(installed: Record<string, boolean>, opts: { noUpdateCommand?: boolean } = {}) {
  const execCalls: string[][] = [];
  const p = fakeProbes({
    home: process.env.HOME!,
    env: { PATH: "/usr/local/bin" },
    files: { "/usr/local/bin/claude": "bin" },
    exec: async (argv) => {
      execCalls.push(argv);
      const [, , verb, id] = argv;
      if (verb === "update" && opts.noUpdateCommand) return { code: 1, stdout: "", stderr: "error: unknown command 'update'" };
      if (verb === "list") return ok(JSON.stringify(Object.entries(installed).map(([pid, on]) => ({ id: pid, version: "1.0.0", enabled: on, scope: "user" }))));
      if (verb === "marketplace") return ok(JSON.stringify(MARKETPLACES));
      if (verb === "install") installed[id!] = true;
      if (verb === "enable") installed[id!] = true;
      if (verb === "uninstall") {
        if (!(id! in installed)) return { code: 1, stdout: "", stderr: `Plugin "${id}" is not installed` };
        delete installed[id!];
      }
      return ok("");
    },
  });
  return { p, execCalls };
}

const baseline = (): Record<string, boolean> => Object.fromEntries(BASE_PLUGINS.map((id) => [id, true]));
const naming = (calls: string[][], verb: string) => calls.filter((a) => a[2] === verb && a[3] === MODS_PLUGIN);

describe("the mods plugin in plugins.install", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mods-plugin-home-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const switchOn = () => setSetting("agent.integrations.enabled", true, "machine");
  const switchOff = () => setSetting("agent.integrations.enabled", false, "machine");

  test("modsPluginWanted follows the switch", () => {
    expect(modsPluginWanted()).toBe(false);
    switchOn();
    expect(modsPluginWanted()).toBe(true);
    switchOff();
    expect(modsPluginWanted()).toBe(false);
  });

  test.each([false, true])("switch on installs and enables mattstack-mods (update %s)", async (update) => {
    switchOn();
    const installed = baseline();
    const { p, execCalls } = memberClaude(installed);

    expect((await pluginsInstallStep.run(makeCtx(p, update ? { update } : {}))).state).toBe("done");
    expect(naming(execCalls, "install")).toHaveLength(1);
    expect(naming(execCalls, "enable")).toHaveLength(1);
    expect(installed[MODS_PLUGIN]).toBe(true);
    expect(readSetupState(p).plugins).toContain(MODS_PLUGIN);
  });

  test.each([false, true])("switch off removes it when rt installed it (update %s)", async (update) => {
    switchOff();
    const installed = { ...baseline(), [MODS_PLUGIN]: true };
    const { p, execCalls } = memberClaude(installed);
    updateSetupState(p, (s) => ({ ...s, plugins: ["chat@mattstack", MODS_PLUGIN] }));

    expect((await pluginsInstallStep.run(makeCtx(p, update ? { update } : {}))).state).toBe("done");
    expect(naming(execCalls, "uninstall")).toHaveLength(1);
    expect(MODS_PLUGIN in installed).toBe(false);
    expect(readSetupState(p).plugins).toEqual(["chat@mattstack"]);
  });

  test.each([false, true])("switch off leaves a user-installed copy alone (update %s)", async (update) => {
    switchOff();
    const withMods = { ...baseline(), [MODS_PLUGIN]: true };
    const { p, execCalls } = memberClaude(withMods);
    const outcome = await pluginsInstallStep.run(makeCtx(p, update ? { update } : {}));

    expect(outcome.state).toBe("done");
    expect(execCalls.some((a) => a.includes(MODS_PLUGIN))).toBe(false);
    expect(withMods[MODS_PLUGIN]).toBe(true);
    expect(readSetupState(p).plugins).toEqual([]);
  });

  test("switch off with nothing recorded runs exactly the commands a machine without the plugin runs", async () => {
    switchOff();
    const withMods = memberClaude({ ...baseline(), [MODS_PLUGIN]: true });
    const without = memberClaude(baseline());
    const a = await pluginsInstallStep.run(makeCtx(withMods.p, { update: true }));
    const b = await pluginsInstallStep.run(makeCtx(without.p, { update: true }));

    expect(withMods.execCalls).toEqual(without.execCalls);
    expect(a).toEqual(b);
  });

  test.each([false, true])("a disabled mods copy is not re-enabled by a full apply (claude without plugin update: %s)", async (noUpdateCommand) => {
    switchOn();
    const installed = { ...baseline(), [MODS_PLUGIN]: false };
    const { p, execCalls } = memberClaude(installed, { noUpdateCommand });
    updateSetupState(p, (s) => ({ ...s, plugins: [MODS_PLUGIN] }));

    expect((await pluginsInstallStep.run(makeCtx(p))).state).toBe("done");
    expect(naming(execCalls, "install")).toEqual([]);
    expect(naming(execCalls, "enable")).toEqual([]);
    expect(installed[MODS_PLUGIN]).toBe(false);
  });

  test("a user who disabled it is not re-enabled", async () => {
    switchOn();
    const installed = { ...baseline(), [MODS_PLUGIN]: false };
    const { p, execCalls } = memberClaude(installed);
    updateSetupState(p, (s) => ({ ...s, plugins: [MODS_PLUGIN] }));

    expect((await pluginsInstallStep.run(makeCtx(p, { update: true }))).state).toBe("done");
    expect(naming(execCalls, "install")).toEqual([]);
    expect(naming(execCalls, "enable")).toEqual([]);
    expect(installed[MODS_PLUGIN]).toBe(false);
    expect(readSetupState(p).plugins).toEqual([MODS_PLUGIN]);
  });

  test("a user who removed it after rt installed it is not reinstalled", async () => {
    switchOn();
    const installed = baseline();
    const { p, execCalls } = memberClaude(installed);
    updateSetupState(p, (s) => ({ ...s, plugins: [MODS_PLUGIN] }));

    expect((await pluginsInstallStep.run(makeCtx(p, { update: true }))).state).toBe("done");
    expect(execCalls.some((a) => a.includes(MODS_PLUGIN))).toBe(false);
    expect(MODS_PLUGIN in installed).toBe(false);
  });

  test("repeat runs are idempotent", async () => {
    switchOn();
    const installed = baseline();
    const { p, execCalls } = memberClaude(installed);

    const first = await pluginsInstallStep.run(makeCtx(p, { update: true }));
    const stateAfterFirst = readSetupState(p).plugins;
    execCalls.length = 0;
    const second = await pluginsInstallStep.run(makeCtx(p, { update: true }));

    expect(second).toEqual(first);
    expect(naming(execCalls, "install")).toEqual([]);
    expect(naming(execCalls, "enable")).toEqual([]);
    expect(readSetupState(p).plugins).toEqual(stateAfterFirst);

    switchOff();
    await pluginsInstallStep.run(makeCtx(p, { update: true }));
    execCalls.length = 0;
    await pluginsInstallStep.run(makeCtx(p, { update: true }));
    expect(naming(execCalls, "uninstall")).toEqual([]);
    expect(MODS_PLUGIN in installed).toBe(false);
    expect(readSetupState(p).plugins).not.toContain(MODS_PLUGIN);
  });
});
