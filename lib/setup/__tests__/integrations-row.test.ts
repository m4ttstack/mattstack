import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { HarnessId } from "../../../packages/rt-client/src/agent-integrations.ts";
import { userSettingsPath } from "../../rt-paths.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import type { Row } from "../contract.ts";
import { toolRows } from "../validators/tools.ts";
import type { SecretPresence } from "../validators/accounts.ts";
import { fakeProbes } from "./fakes.ts";

const secrets: SecretPresence = { async has() { return null; } };
const origHome = process.env.HOME;
let home: string;
let previousNoticeSink: ReturnType<typeof setSettingsNoticeSink>;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-integrations-row-")));
  process.env.HOME = home;
  previousNoticeSink = setSettingsNoticeSink(() => {});
});

afterEach(() => {
  setSettingsNoticeSink(previousNoticeSink);
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

async function integrationsRow(enabled: HarnessId[]): Promise<Row> {
  const rows = await toolRows(fakeProbes({ home }), [], { hasBrew: true, secrets, integrations: { switchOn: true, enabled } });
  const row = rows.find((r) => r.id === "tool.integrations");
  if (!row) throw new Error("no tool.integrations row");
  return row;
}

const OPTIONS = [
  { id: "claude", label: "Claude Code", detail: "rt sets up Claude Code and can hand work to it" },
  { id: "codex", label: "Codex", detail: "rt sets up Codex and can hand work to it" },
];

describe("tool.integrations", () => {
  test("ready: offers the harness picker to change the choice, with the current set and default", async () => {
    setSetting("agent.integrations", ["claude", "codex"], "machine");
    setSetting("agent.provider", "codex", "machine");
    const row = await integrationsRow(["claude", "codex"]);
    expect(row.status).toBe("ready");
    expect(row.action).toEqual({
      type: "choose-harnesses",
      label: "Change…",
      verb: ["setup", "harnesses"],
      subtitle: "Turn on the agent apps you use, then pick the one rt agent starts by default.",
      footnote: "You can also run rt setup harnesses in a terminal.",
      options: OPTIONS,
      enabled: ["claude", "codex"],
      defaultHarness: "codex",
    });
  });

  test("none turned on: needs you, and the picker is the fix", async () => {
    setSetting("agent.integrations", [], "machine");
    const row = await integrationsRow([]);
    expect(row.status).toBe("needs-you");
    expect(row.detail).toBe("No agent integration is turned on");
    expect(row.action?.type).toBe("choose-harnesses");
    expect(row.action?.label).toBe("Choose…");
    expect((row.action as { enabled: string[]; defaultHarness: string | null }).enabled).toEqual([]);
    expect((row.action as { enabled: string[]; defaultHarness: string | null }).defaultHarness).toBeNull();
  });

  test("a default that is not turned on: the problem is the detail and the picker fixes it", async () => {
    setSetting("agent.integrations", ["claude"], "machine");
    setSetting("agent.provider", "codex", "user");
    const row = await integrationsRow(["claude"]);
    expect(row.status).toBe("needs-you");
    expect(row.detail).toBe("codex is your default for rt agent, but it is not turned on.");
    expect(row.action?.type).toBe("choose-harnesses");
    expect((row.action as { defaultHarness: string | null }).defaultHarness).toBeNull();
  });

  test("a list in your user settings that cannot be read: the steps name the command that removes it", async () => {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), '{ "agent.integrations": "codex" }\n');
    const row = await integrationsRow(["claude"]);
    expect(row.status).toBe("needs-you");
    expect(row.action).toEqual({
      type: "steps",
      label: "Show steps…",
      steps: ["Open a terminal", "Run: rt settings unset agent.integrations --scope user"],
    });
  });
});
