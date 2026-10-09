import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, userSettingsPath } from "../../rt-paths.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import { runUpdateWith, type ApplyContext } from "../../setup/apply.ts";
import { MIGRATIONS } from "../../setup/migrations/index.ts";
import { readSetupState } from "../../setup/state.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import {
  enabledIntegrations, integrationPreferenceProblems, validateIntegrationPreference, writeIntegrationChoice,
} from "../preferences.ts";
import { harnessEnabled } from "../switch.ts";

const MIGRATION_ID = "2026-10-09-record-enabled-integrations";

const origHome = process.env.HOME;
const origPath = process.env.PATH;
let home: string;
let previousNoticeSink: ReturnType<typeof setSettingsNoticeSink>;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-integration-prefs-")));
  process.env.HOME = home;
  previousNoticeSink = setSettingsNoticeSink(() => {});
});

afterEach(() => {
  setSettingsNoticeSink(previousNoticeSink);
  process.env.HOME = origHome;
  process.env.PATH = origPath;
  rmSync(home, { recursive: true, force: true });
});

function storeWrongType(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '{ "agent.integrations": "codex" }\n');
}

function installFakeBinaries(...names: string[]): void {
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, name), 0o755);
  }
  process.env.PATH = `${bin}:${origPath ?? ""}`;
}

describe("enabledIntegrations", () => {
  test("upgrade keeps Claude and adds configured Codex", () => {
    setSetting("agent.provider", "codex", "user");
    expect(enabledIntegrations()).toEqual(["claude", "codex"]);
  });

  test("an upgrade with no provider set keeps Claude alone", () => {
    expect(enabledIntegrations()).toEqual(["claude"]);
  });

  test("empty preference enables none", () => {
    setSetting("agent.integrations", [], "user");
    expect(enabledIntegrations()).toEqual([]);
  });

  test("installed binary does not enable itself", () => {
    installFakeBinaries("claude", "codex");
    setSetting("agent.integrations", [], "user");
    expect(enabledIntegrations()).toEqual([]);
    const on = harnessEnabled();
    expect([on("claude"), on("codex")]).toEqual([false, false]);
  });

  test("keeps the user's order", () => {
    setSetting("agent.integrations", ["codex", "claude"], "user");
    expect(enabledIntegrations()).toEqual(["codex", "claude"]);
  });

  test("machine scope overrides user scope", () => {
    setSetting("agent.integrations", ["claude", "codex"], "user");
    setSetting("agent.integrations", ["codex"], "machine");
    expect(enabledIntegrations()).toEqual(["codex"]);
  });

  test("a stored value that is not a list of ids reads as the upgrade set", () => {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), '{ "agent.integrations": "codex", "agent.provider": "codex" }\n');
    expect(enabledIntegrations()).toEqual(["claude", "codex"]);
  });

  test("an absent list gives harnessEnabled the same answer it gave before the setting existed", () => {
    setSetting("agent.provider", "codex", "user");
    const on = harnessEnabled();
    expect([on("claude"), on("codex"), on("other")]).toEqual([true, true, false]);
  });
});

describe("validateIntegrationPreference", () => {
  test("accepts registered ids in the user's order", () => {
    expect(validateIntegrationPreference(["codex", "claude"])).toEqual({ ok: true, data: ["codex", "claude"] });
  });

  test("accepts an empty list", () => {
    expect(validateIntegrationPreference([])).toEqual({ ok: true, data: [] });
  });

  test("refuses an id rt does not know", () => {
    expect(validateIntegrationPreference(["claude", "gemini"])).toEqual({
      ok: false, error: { code: "invalid", message: "rt has no integration called gemini. Choose from claude and codex." },
    });
  });

  test("refuses a duplicate", () => {
    expect(validateIntegrationPreference(["codex", "claude", "codex"])).toEqual({
      ok: false, error: { code: "invalid", message: "codex is listed twice. List each integration once." },
    });
  });
});

describe("writeIntegrationChoice", () => {
  test("writes the chosen list and default through the resolver", () => {
    expect(writeIntegrationChoice({ enabled: ["codex"], defaultHarness: "codex" }, "user")).toEqual({ ok: true, data: undefined });
    expect(getSetting("agent.integrations").value).toEqual(["codex"]);
    expect(getSetting("agent.provider").value).toBe("codex");
    expect(getSetting("agent.integrations").provenance.at(-1)?.scope).toBe("user");
  });

  test("an empty choice writes an empty list and leaves the default alone", () => {
    expect(writeIntegrationChoice({ enabled: [] }, "machine")).toEqual({ ok: true, data: undefined });
    expect(getSetting("agent.integrations").value).toEqual([]);
    expect(getSetting("agent.provider").provenance.at(-1)?.scope).toBe("default");
  });

  test("refuses a default outside the chosen list and writes nothing", () => {
    expect(writeIntegrationChoice({ enabled: ["claude"], defaultHarness: "codex" }, "user")).toEqual({
      ok: false, error: { code: "invalid", message: "codex is your default, but it is not turned on. Turn it on, or pick claude as your default." },
    });
    expect(getSetting("agent.integrations").value).toBeUndefined();
    expect(getSetting("agent.provider").provenance.at(-1)?.scope).toBe("default");
  });

  test("a user write this Mac's own list would hide is refused and changes nothing; a machine write works", async () => {
    setSetting("agent.provider", "codex", "user");
    await MIGRATIONS.find((m) => m.id === MIGRATION_ID)!.run({} as ApplyContext);
    const user = readFileSync(userSettingsPath(), "utf8");
    const machine = readFileSync(machineSettingsPath(), "utf8");

    expect(writeIntegrationChoice({ enabled: ["codex"], defaultHarness: "codex" }, "user")).toEqual({
      ok: false,
      error: {
        code: "refused",
        message: "This Mac has its own list of integrations, which would hide this change. Change this Mac's list instead: rt settings set agent.integrations '[\"codex\"]' --scope machine",
      },
    });
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(user);
    expect(readFileSync(machineSettingsPath(), "utf8")).toBe(machine);

    expect(writeIntegrationChoice({ enabled: ["codex"], defaultHarness: "codex" }, "machine")).toEqual({ ok: true, data: undefined });
    expect(enabledIntegrations()).toEqual(["codex"]);
    expect(getSetting("agent.provider").provenance.at(-1)?.scope).toBe("machine");
  });

  test("refuses an invalid list and writes nothing", () => {
    expect(writeIntegrationChoice({ enabled: ["claude", "claude"] }, "user").ok).toBe(false);
    expect(getSetting("agent.integrations").value).toBeUndefined();
  });
});

describe("integrationPreferenceProblems", () => {
  test("none with an absent list", () => {
    setSetting("agent.provider", "codex", "user");
    expect(integrationPreferenceProblems()).toEqual([]);
  });

  test("a default outside the enabled set is reported and neither value is replaced", () => {
    setSetting("agent.integrations", ["claude"], "user");
    setSetting("agent.provider", "codex", "user");
    expect(integrationPreferenceProblems()).toEqual([{
      code: "default-not-enabled",
      message: "codex is your default for rt agent, but it is not turned on. Add it to agent.integrations, or set agent.provider to claude.",
    }]);
    expect(enabledIntegrations()).toEqual(["claude"]);
    expect(getSetting("agent.provider").value).toBe("codex");
  });

  test("an empty list is a choice, not a problem", () => {
    setSetting("agent.integrations", [], "user");
    expect(integrationPreferenceProblems()).toEqual([]);
  });

  test("a stored value of the wrong type is reported, not lost", () => {
    storeWrongType(userSettingsPath());
    expect(integrationPreferenceProblems()).toEqual([{
      code: "invalid-preference",
      message: 'agent.integrations in your user settings needs fixing: it must be a list of integration names, such as ["claude"].',
    }]);
  });

  test("an id rt does not know is reported", () => {
    setSetting("agent.integrations", ["claude", "gemini"], "user");
    expect(integrationPreferenceProblems()).toEqual([{
      code: "invalid-preference",
      message: "agent.integrations needs fixing: rt has no integration called gemini. Choose from claude and codex.",
    }]);
  });
});

describe(MIGRATION_ID, () => {
  const migration = MIGRATIONS.find((m) => m.id === MIGRATION_ID)!;

  test("writes the upgrade set once, is recorded done, and a second run changes nothing", async () => {
    setSetting("agent.provider", "codex", "user");
    const p = fakeProbes({ home });
    const ctx = { p, emit: () => {} } as unknown as ApplyContext;

    const first = await runUpdateWith([], [migration], ctx);
    expect(first.outcomes).toEqual([{ id: `migration.${MIGRATION_ID}`, state: "done", detail: "Kept claude and codex turned on, as this Mac had them" }]);
    expect(readSetupState(p).migrations).toEqual([MIGRATION_ID]);
    expect(getSetting("agent.integrations")).toMatchObject({ value: ["claude", "codex"], provenance: [{ scope: "machine" }] });
    const written = readFileSync(machineSettingsPath(), "utf8");

    expect(await runUpdateWith([], [migration], ctx)).toEqual({ ok: true, failedSteps: [], outcomes: [] });
    expect(readFileSync(machineSettingsPath(), "utf8")).toBe(written);
    expect(await migration.run(ctx)).toEqual({ state: "skipped", detail: "You already chose which integrations are on" });
    expect(readFileSync(machineSettingsPath(), "utf8")).toBe(written);
  });

  test("writes Claude alone when no provider is set", async () => {
    expect(await migration.run({} as ApplyContext)).toEqual({ state: "done", detail: "Kept claude turned on, as this Mac had it" });
    expect(getSetting("agent.integrations").value).toEqual(["claude"]);
  });

  test("a stored value of the wrong type counts as present: skipped, and nothing is written over or above it", async () => {
    storeWrongType(userSettingsPath());
    const user = readFileSync(userSettingsPath(), "utf8");
    expect(await migration.run({} as ApplyContext)).toEqual({ state: "skipped", detail: "You already chose which integrations are on" });
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(user);
    expect(existsSync(machineSettingsPath())).toBe(false);
  });

  test("leaves an explicit choice alone, the empty list included", async () => {
    setSetting("agent.integrations", [], "user");
    setSetting("agent.provider", "codex", "user");
    expect(await migration.run({} as ApplyContext)).toEqual({ state: "skipped", detail: "You already chose which integrations are on" });
    expect(enabledIntegrations()).toEqual([]);
  });
});
