import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { machineSettingsPath, userSettingsPath } from "../../lib/rt-paths.ts";
import { getSetting } from "../../lib/settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../lib/settings/write.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { realHarnessesDeps, setupHarnesses, type HarnessesDeps } from "../setup-harnesses.ts";
import { capturePlain, expectOneJsonLine, realJson } from "./helpers/json-line.ts";

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

const origHome = process.env.HOME;
let home: string;
let quiet: CapturedOut;
let previousNoticeSink: ReturnType<typeof setSettingsNoticeSink>;

beforeEach(() => {
  delete process.env.RT_BATCH;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-setup-harnesses-")));
  process.env.HOME = home;
  previousNoticeSink = setSettingsNoticeSink(() => {});
  quiet = capturePlain();
});

afterEach(() => {
  quiet.restore();
  setSettingsNoticeSink(previousNoticeSink);
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function deps(overrides: Partial<HarnessesDeps> = {}) {
  const picks: string[] = [];
  const d: HarnessesDeps = {
    ...realHarnessesDeps(),
    json: realJson,
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    isTTY: () => false,
    switchOn: () => true,
    pickHarnesses: async () => {
      picks.push("harnesses");
      return null;
    },
    pickDefault: async () => {
      picks.push("default");
      return null;
    },
    ...overrides,
  };
  return { d, picks };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ExitSentinel) return err.code;
    throw err;
  }
}

const machine = (key: string): unknown => getSetting(key).provenance.at(-1)?.scope;

describe("rt setup harnesses", () => {
  test("a valid choice writes both settings at machine scope", async () => {
    await setupHarnesses(["claude", "codex", "--default", "codex"], {}, deps().d);
    expect(getSetting("agent.integrations").value).toEqual(["claude", "codex"]);
    expect(getSetting("agent.provider").value).toBe("codex");
    expect(machine("agent.integrations")).toBe("machine");
    expect(machine("agent.provider")).toBe("machine");
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("with --default left out, the current default is kept when it is in the list", async () => {
    setSetting("agent.provider", "codex", "user");
    await setupHarnesses(["claude", "codex"], {}, deps().d);
    expect(getSetting("agent.provider").value).toBe("codex");
    expect(machine("agent.provider")).toBe("machine");
  });

  test("with --default left out and the current default not in the list, the first id becomes the default", async () => {
    setSetting("agent.provider", "claude", "user");
    await setupHarnesses(["codex"], {}, deps().d);
    expect(getSetting("agent.integrations").value).toEqual(["codex"]);
    expect(getSetting("agent.provider").value).toBe("codex");
  });

  test("an unknown id is a usage failure naming the valid ids, exit 2, nothing written", async () => {
    const code = await exitCode(() => setupHarnesses(["claude", "gemini", "--json"], {}, deps().d));
    expect(code).toBe(2);
    const body = expectOneJsonLine(quiet.stdout()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("usage");
    expect(body.error.message).toBe("rt has no integration called gemini. Choose from claude and codex.");
    expect(existsSync(machineSettingsPath())).toBe(false);
  });

  test("a default outside the list is a usage failure naming the valid ids, exit 2, nothing written", async () => {
    const code = await exitCode(() => setupHarnesses(["claude", "--default", "codex"], {}, deps().d));
    expect(code).toBe(2);
    expect(quiet.stderr()).toStartWith("codex is not in the list you turned on. Choose your default from claude.");
    expect(quiet.stderr()).toContain("rt setup harnesses <ids…> --default <id>");
    expect(existsSync(machineSettingsPath())).toBe(false);
  });

  test("--none writes an empty list and leaves the default alone", async () => {
    await setupHarnesses(["--none", "--json"], {}, deps().d);
    expect(getSetting("agent.integrations").value).toEqual([]);
    expect(machine("agent.integrations")).toBe("machine");
    expect(machine("agent.provider")).toBe("default");
    const body = expectOneJsonLine(quiet.stdout()) as Record<string, unknown>;
    expect(body).toMatchObject({ contract: 1, ok: true, enabled: [], default: null });
  });

  test("--none with ids is a usage failure", async () => {
    const code = await exitCode(() => setupHarnesses(["claude", "--none"], {}, deps().d));
    expect(code).toBe(2);
    expect(existsSync(machineSettingsPath())).toBe(false);
  });

  test("a store that cannot be read is a plain failure with a next, exit 2", async () => {
    const { d } = deps({
      write: () => {
        throw new Error("machine.jsonc: unexpected token at line 3");
      },
    });
    const code = await exitCode(() => setupHarnesses(["claude"], {}, d));
    expect(code).toBe(2);
    expect(quiet.stderr()).toStartWith("Could not save your choice");
    expect(quiet.stderr()).toContain("machine.jsonc: unexpected token at line 3");
    expect(quiet.stderr()).toContain("rt settings check");
  });

  test("a store that cannot be read keeps the --json envelope", async () => {
    const { d } = deps({ write: () => { throw new Error("boom"); } });
    const code = await exitCode(() => setupHarnesses(["claude", "--json"], {}, d));
    expect(code).toBe(2);
    const body = expectOneJsonLine(quiet.stdout()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("settings-unwritable");
    expect(quiet.stderr()).toBe("");
  });

  test("a refusal from the write is a failure in plain words", async () => {
    const { d } = deps({ write: () => ({ ok: false, error: { code: "refused", message: "This Mac has its own list of integrations, which would hide this change." } }) });
    const code = await exitCode(() => setupHarnesses(["claude", "--json"], {}, d));
    expect(code).toBe(2);
    const body = expectOneJsonLine(quiet.stdout()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code: "refused", message: "This Mac has its own list of integrations, which would hide this change." });
  });

  test("--json prints { ok, enabled, default } in one envelope with nothing on stderr", async () => {
    await setupHarnesses(["codex", "claude", "--json"], {}, deps().d);
    const body = expectOneJsonLine(quiet.stdout()) as Record<string, unknown>;
    expect(body).toMatchObject({ contract: 1, ok: true, enabled: ["codex", "claude"], default: "claude" });
    expect(Object.keys(body).sort()).toEqual(["at", "contract", "default", "enabled", "ok"]);
    expect(quiet.stderr()).toBe("");
  });

  test("human output is one plain line", async () => {
    await setupHarnesses(["claude", "codex", "--default", "codex"], {}, deps().d);
    expect(quiet.stdout()).toBe("[ok] Turned on Claude Code and Codex  Codex is your default\n");
  });

  test("with the integrations switch off, the choice is still saved and one line says when it applies", async () => {
    const { d } = deps({ switchOn: () => false });
    await setupHarnesses(["codex"], {}, d);
    expect(getSetting("agent.integrations").value).toEqual(["codex"]);
    expect(quiet.stdout()).toBe(
      "[ok] Turned on Codex  Codex is your default\n[off] Agent integrations are off on this Mac, so this applies once they are turned on\n",
    );
  });

  test("with the switch off, --json keeps the same envelope", async () => {
    const { d } = deps({ switchOn: () => false });
    await setupHarnesses(["codex", "--json"], {}, d);
    const body = expectOneJsonLine(quiet.stdout()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["at", "contract", "default", "enabled", "ok"]);
  });

  test("no ids off a terminal is a usage failure and opens no picker", async () => {
    const t = deps();
    const code = await exitCode(() => setupHarnesses([], {}, t.d));
    expect(code).toBe(2);
    expect(t.picks).toEqual([]);
    expect(quiet.stderr()).toStartWith("Which agent apps should rt turn on?");
    expect(quiet.stderr()).toContain("rt setup harnesses <ids…> --default <id>");
  });

  test("no ids under --json at a terminal is a usage failure envelope", async () => {
    const t = deps({ isTTY: () => true });
    const code = await exitCode(() => setupHarnesses(["--json"], {}, t.d));
    expect(code).toBe(2);
    expect(t.picks).toEqual([]);
    expect((expectOneJsonLine(quiet.stdout()) as { error: { code: string } }).error.code).toBe("usage");
  });

  test("no ids under RT_BATCH at a terminal is a usage failure", async () => {
    process.env.RT_BATCH = "1";
    const t = deps({ isTTY: () => true });
    const code = await exitCode(() => setupHarnesses([], {}, t.d));
    expect(code).toBe(2);
    expect(t.picks).toEqual([]);
  });

  test("at a terminal, no ids opens the harness picker, then the default picker", async () => {
    const seen: { options?: string[]; initial?: string[]; defaults?: string[]; current?: string } = {};
    const t = deps({
      isTTY: () => true,
      pickHarnesses: async (options, initial) => {
        seen.options = options.map((o) => o.id);
        seen.initial = initial;
        return ["claude", "codex"];
      },
      pickDefault: async (options, current) => {
        seen.defaults = options.map((o) => o.id);
        seen.current = current;
        return "codex";
      },
    });
    await setupHarnesses([], {}, t.d);
    expect(seen).toEqual({ options: ["claude", "codex"], initial: ["claude"], defaults: ["claude", "codex"], current: "claude" });
    expect(getSetting("agent.integrations").value).toEqual(["claude", "codex"]);
    expect(getSetting("agent.provider").value).toBe("codex");
  });

  test("a single pick needs no default picker", async () => {
    const t = deps({ isTTY: () => true, pickHarnesses: async () => ["codex"] });
    await setupHarnesses([], {}, t.d);
    expect(t.picks).toEqual([]);
    expect(getSetting("agent.provider").value).toBe("codex");
  });

  test("cancelling the picker writes nothing and exits 0", async () => {
    const t = deps({ isTTY: () => true });
    const code = await exitCode(() => setupHarnesses([], {}, t.d));
    expect(code).toBe(0);
    expect(existsSync(machineSettingsPath())).toBe(false);
  });

  test("the machine store holds both keys after a write", async () => {
    await setupHarnesses(["claude"], {}, deps().d);
    const text = readFileSync(machineSettingsPath(), "utf8");
    expect(text).toContain("agent.integrations");
    expect(text).toContain("agent.provider");
  });
});
