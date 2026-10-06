import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { agentIntegrations, COMMAND_NAMES, paneSpawn, type IntegrationSummary } from "../src/index.ts";
import { fakeDaemon } from "./fake-daemon.ts";

const SUMMARY: IntegrationSummary = {
  id: "codex", label: "Codex", enabled: true, readiness: { ready: false, reason: "no connection" },
  capabilities: ["launch"], options: [{ name: "model", kind: "text" }],
};

test("agent:integrations is cataloged", () => {
  expect([...COMMAND_NAMES]).toContain("agent:integrations");
});

test("agentIntegrations sends the mode and returns the daemon's summaries in the response envelope", async () => {
  const fake = fakeDaemon({ "agent:integrations": { ok: true, data: { integrations: [SUMMARY] } } });
  const res = await agentIntegrations({ mode: "headless" }, { sockPath: fake.sock });
  fake.stop();
  expect(res).toEqual({ ok: true, data: { integrations: [SUMMARY] } });
  expect(fake.seen).toEqual([{ cmd: "agent:integrations", payload: { mode: "headless" } }]);
});

test("agentIntegrations degrades to ok:false with no daemon", async () => {
  const res = await agentIntegrations({ mode: "herdr" }, { sockPath: "/nonexistent/rt.sock" });
  expect(res.ok).toBe(false);
});

test("paneSpawn forwards provider", async () => {
  const fake = fakeDaemon({ "pane:spawn": { ok: true, data: { pane: { paneId: "w1:p1" }, ready: true } } });
  await paneSpawn({ cwd: "/tmp/x", provider: "codex" }, { sockPath: fake.sock });
  fake.stop();
  expect(fake.seen[0]?.payload).toEqual({ cwd: "/tmp/x", provider: "codex" });
});

test("the integration types carry no runtime import", () => {
  const source = readFileSync(join(import.meta.dir, "..", "src", "agent-integrations.ts"), "utf8");
  expect(source).not.toMatch(/^\s*import\b/m);
});
