/**
 * What setup installs for Codex: the Mattstack MCP entry in the selected
 * Codex home's user config. The CLI, its sign-in and the skills links are
 * shared setup's rows and steps; project hooks and trust are a separate,
 * reviewed install.
 */

import { dirname, isAbsolute, join } from "path";
import type { ApplyContext, StepDef, StepOutcome } from "../../setup/apply.ts";
import { harnessSelected, selectionFor } from "../../setup/integration-selection.ts";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { readSetupState, updateSetupState } from "../../setup/state.ts";
import { toFailedOutcome } from "../../setup/steps/step-utils.ts";
import { codexHomeOf, codexMcpRow, codexToolRow, desiredCodexMcpEntry } from "../../setup/validators/codex.ts";
import type { HarnessInstall, InstallAdapter } from "../install.ts";
import { CODEX_MCP_SERVER, codexConfigFile, codexMcpFingerprint, editCodexMcpEntry, readCodexMcpState } from "./mcp-config.ts";

type WriteProbes = Pick<Probes, "mkdirp" | "writeFile" | "rename" | "chmod" | "removeFile" | "fileMode" | "readlink">;

/** Atomic, mode-preserving, and through a symlink to the file it names, the way `claude.permissions` writes Claude's settings. */
function replaceText(p: WriteProbes, linkPath: string, text: string): void {
  const link = p.readlink(linkPath);
  const path = link === null ? linkPath : isAbsolute(link) ? link : join(dirname(linkPath), link);
  const tmp = `${path}.rt-tmp`;
  const mode = p.fileMode(path) ?? 0o600;
  p.mkdirp(dirname(path));
  p.removeFile(tmp);
  p.writeFile(tmp, text, mode);
  p.chmod(tmp, mode);
  try {
    p.rename(tmp, path);
  } catch (err) {
    p.removeFile(tmp);
    throw err;
  }
}

async function codexMcpRun(ctx: ApplyContext): Promise<StepOutcome> {
  const home = codexHomeOf(ctx.p);
  if (home === null) return { state: "failed", detail: "CODEX_HOME does not name a folder", remedy: "Set CODEX_HOME to Codex's folder, then Retry." };
  const desired = desiredCodexMcpEntry(ctx.p, home);
  if (desired === null) return { state: "failed", detail: "rt is not on this Mac's PATH yet", remedy: "Run rt setup apply --only path.link, then Retry." };

  const path = codexConfigFile(home);
  const before = ctx.p.readFile(path);
  if (before === null && ctx.p.exists(path)) return { state: "failed", detail: `Could not read ${path}`, remedy: "Check that file's permissions, then Retry." };

  const state = readCodexMcpState(before, desired);
  if (state.kind === "unparsable") return { state: "failed", detail: `${path} is not valid TOML`, remedy: "Fix or remove that file, then Retry." };
  if (state.kind === "current") return { state: "skipped", detail: "Already set up" };
  const owned = state.kind === "other" && readSetupState(ctx.p).codexMcp?.[path] === state.fingerprint;
  if (state.kind === "other" && !owned) {
    return { state: "needs-you", detail: `Codex has its own ${CODEX_MCP_SERVER} server in ${path}, so rt left it alone` };
  }

  const edit = editCodexMcpEntry(before, desired, owned ? "replace" : "append");
  if (!edit.ok) {
    return {
      state: "failed",
      detail: `rt could not add its entry to ${path} without changing your other Codex settings`,
      remedy: "Check how that file lists its MCP servers, then Retry.",
    };
  }
  if (ctx.p.readFile(path) !== before) return { state: "failed", detail: `${path} changed while rt was reading it`, remedy: "Retry." };

  replaceText(ctx.p, path, edit.text);
  const fingerprint = codexMcpFingerprint(desired);
  updateSetupState(ctx.p, (s) => ({ ...s, codexMcp: { ...(s.codexMcp ?? {}), [path]: fingerprint } }));
  ctx.log("codex.mcp", `${owned ? "updated" : "added"} ${CODEX_MCP_SERVER} in ${path}`);
  return { state: "done", detail: owned ? `Updated Mattstack in ${path}` : `Added Mattstack to ${path}` };
}

export async function installCodexMcp(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await codexMcpRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const codexMcpStep: StepDef = {
  id: "codex.mcp",
  title: "Add Mattstack to Codex",
  kind: "rt",
  applies: (ctx) => harnessSelected(selectionFor(ctx), "codex"),
  run: installCodexMcp,
};

type McpGet = { transport?: { command?: unknown; args?: unknown } };

/** Whether Codex itself reads the entry rt wrote, as `codex mcp get --json` prints it. */
async function codexReadsEntry(p: Probes): Promise<string | null> {
  const home = codexHomeOf(p);
  const desired = home === null ? null : desiredCodexMcpEntry(p, home);
  if (desired === null) return "rt's MCP entry has no rt to start";
  const res = await p.exec(["codex", "mcp", "get", CODEX_MCP_SERVER, "--json"], { timeoutMs: 5000 });
  if (res.code !== 0) return "Codex could not show rt's MCP entry";
  let got: McpGet;
  try {
    got = JSON.parse(res.stdout) as McpGet;
  } catch {
    return "Codex's description of rt's MCP entry could not be read";
  }
  const same = got.transport?.command === desired.command && Bun.deepEquals(got.transport?.args, desired.args);
  return same ? null : "Codex starts a different mattstack server";
}

export function createCodexInstall(deps: { p?: Probes } = {}): InstallAdapter {
  const probes = (): Probes => deps.p ?? createRealProbes();
  return {
    steps: () => [codexMcpStep],
    async verify() {
      const p = probes();
      const tool = await codexToolRow(p);
      if (tool.status !== "ready") return { ok: true, data: { ready: false, reason: tool.detail } };
      const mcp = codexMcpRow(p);
      if (mcp.status !== "ready") return { ok: true, data: { ready: false, reason: mcp.detail } };
      const fault = await codexReadsEntry(p);
      return { ok: true, data: fault === null ? { ready: true } : { ready: false, reason: fault } };
    },
    reconcile: async () => [],
  };
}

export const codexInstall: HarnessInstall = { id: "codex", loadInstall: async () => createCodexInstall() };
