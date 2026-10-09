/**
 * Codex's rows: the CLI and its sign-in, and the Mattstack MCP entry in its
 * user config. Shown only while the integrations switch is on and Codex is
 * enabled; nothing here runs or reads Claude.
 */

import { join } from "path";
import { codexHomeFor, parseCodexPluginList } from "../../agent-integrations/codex/skills.ts";
import { codexConfigFile, codexMcpEntry, readCodexMcpState, type CodexMcpEntry } from "../../agent-integrations/codex/mcp-config.ts";
import { resolveTool } from "../../deps/resolve.ts";
import { applyStepAction, row, type Action, type Row } from "../contract.ts";
import type { ExecResult, Probes } from "../probes.ts";
import type { PluginEntry } from "../../skills/writing-style-sources.ts";
import { readSetupState } from "../state.ts";

const PROBE_TIMEOUT_MS = 5000;

const CODEX_INSTALL_STEPS: Action = {
  type: "steps",
  label: "Show steps…",
  steps: ["Open a terminal", "Run: npm install -g @openai/codex", "Then run: codex --version"],
};
const CODEX_SIGNIN_STEPS: Action = { type: "steps", label: "Show steps…", steps: ["Open a terminal", "Run: codex login", "Follow the sign-in prompt"] };
const removeOwnEntry = (path: string): Action => ({
  type: "steps",
  label: "Show steps…",
  steps: [`Open ${path}`, "Remove the [mcp_servers.mattstack] table", "Then run: rt setup apply --only codex.mcp"],
});
const SIGNIN_LATER = { required: false, optionalNote: "Sign in after Install: run codex login." };

function exec(p: Probes, argv: string[]): Promise<ExecResult> {
  return p.exec(argv, { timeoutMs: PROBE_TIMEOUT_MS });
}

function versionOf(stdout: string): string {
  return stdout.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? stdout.trim();
}

/** The Codex home setup installs into: CODEX_HOME, else ~/.codex. Null when CODEX_HOME names no folder. */
export function codexHomeOf(p: Pick<Probes, "env" | "home">): string | null {
  const home = codexHomeFor(undefined, { ...p.env, HOME: p.home });
  return home.ok ? home.data.home : null;
}

/** The rt the MCP entry starts: the PATH link Install makes, else the copy rt resolves. */
export function codexMcpCommand(p: Probes): string | null {
  const linked = join(p.home, ".local", "bin", "rt");
  if (p.exists(linked)) return linked;
  return resolveTool(p, "rt").chosen;
}

export function desiredCodexMcpEntry(p: Probes, codexHome: string): CodexMcpEntry | null {
  const rt = codexMcpCommand(p);
  return rt === null ? null : codexMcpEntry(rt, codexHome);
}

export async function codexToolRow(p: Probes): Promise<Row> {
  const base = { id: "tool.codex", kind: "tool" as const, title: "Codex", why: "Runs the agent sessions rt drives and hands work off to.", required: true, recheck: "on-activate" as const };

  const versionRes = await exec(p, ["codex", "--version"]);
  if (versionRes.code === 127) return row({ ...base, status: "missing", detail: "Codex is not installed", action: CODEX_INSTALL_STEPS });
  if (versionRes.code === 124) return row({ ...base, status: "error", detail: "Codex did not answer in time" });
  if (versionRes.code !== 0) return row({ ...base, status: "error", detail: `Could not run Codex (exit ${versionRes.code})` });
  const named = `Codex ${versionOf(versionRes.stdout)}`;

  const authRes = await exec(p, ["codex", "login", "status"]);
  if (authRes.code === 124) return row({ ...base, status: "error", detail: "Codex's sign-in check did not answer in time" });
  // codex-cli 0.160 prints "Not logged in" and exits 1 when signed out.
  if (authRes.code === 0) return row({ ...base, status: "ready", detail: `${named}, signed in` });
  return row({ ...base, ...SIGNIN_LATER, status: "needs-you", detail: "Not signed in yet. Run codex login and sign in", action: CODEX_SIGNIN_STEPS });
}

export function codexMcpRow(p: Probes): Row {
  const base = {
    id: "tool.codex-mcp",
    kind: "tool" as const,
    title: "Mattstack in Codex",
    why: "Codex reaches rt's tools through this MCP server.",
    required: false,
    optionalNote: "Installed by Install (codex.mcp).",
  };
  const home = codexHomeOf(p);
  if (home === null) return row({ ...base, status: "error", detail: "CODEX_HOME does not name a folder" });
  const path = codexConfigFile(home);
  const desired = desiredCodexMcpEntry(p, home);
  const add = applyStepAction("Add to Codex", "codex.mcp");
  if (desired === null) return row({ ...base, status: "missing", detail: "rt is not on this Mac's PATH yet", action: add });

  const text = p.readFile(path);
  if (text === null && p.exists(path)) return row({ ...base, status: "error", detail: `Could not read ${path}` });
  const state = readCodexMcpState(text, desired);
  if (state.kind === "unparsable") return row({ ...base, status: "error", detail: `${path} is not valid TOML` });
  if (state.kind === "current") return row({ ...base, status: "ready", detail: "Codex starts rt's MCP server" });
  if (state.kind === "other") {
    if (readSetupState(p).codexMcp?.[path] === state.fingerprint) return row({ ...base, status: "missing", detail: "The entry rt added to Codex is out of date", action: add });
    return row({ ...base, status: "needs-you", detail: "Codex has its own mattstack server, so rt left it alone", action: removeOwnEntry(path) });
  }
  return row({ ...base, status: "missing", detail: "Not added to Codex yet", action: add });
}

/** Codex's installed plugins in the writing-style inventory's shape, or null when they cannot be listed. */
export function codexPluginEntries(listing: ExecResult, codexHome: string): PluginEntry[] | null {
  if (listing.code !== 0) return null;
  const parsed = parseCodexPluginList(listing.stdout, codexHome, codexHome);
  if (!parsed.ok) return null;
  return parsed.data.map((e) => ({ id: e.id, enabled: e.enabled !== false, installPath: e.installPath, harness: "codex" }));
}

export function codexPluginListing(p: Probes): Promise<ExecResult> {
  return exec(p, ["codex", "plugin", "list", "--json"]);
}
