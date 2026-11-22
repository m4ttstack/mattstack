/**
 * `linear.mcp` adds ONE `mcpServers` entry, named `linear`, to Claude
 * Code's config so the pack skills' `mcp__linear__*` calls resolve on a
 * machine that never configured one by hand.
 *
 * This is the deliberate, scoped exception to plugins.install's rule that the
 * installer never touches ~/.claude.json: that rule still holds for
 * plugins.install itself, and this step touches nothing else in the file.
 * An entry already named `linear` is left exactly as it is, whatever it is.
 */
import type { StepOutcome, StepDef, ApplyContext } from "../apply.ts";
import { toFailedOutcome } from "./step-utils.ts";
import { claudeJsonPath, nameTaken, readClaudeConfig, withLinearEntry, writeClaudeConfig, type ClaudeConfig } from "../linear-mcp.ts";

const ALREADY_SET_UP: StepOutcome = { state: "skipped", detail: "Already set up" };

function readConfig(ctx: ApplyContext, path: string): { config: ClaudeConfig } | StepOutcome {
  const read = readClaudeConfig(ctx.p, path);
  if (!read.ok && read.reason === "unparsable") {
    return { state: "failed", detail: `${path} is not valid JSON`, remedy: "Fix or remove that file, then Retry." };
  }
  if (!read.ok && read.reason === "unreadable") {
    return { state: "failed", detail: `Could not read ${path}`, remedy: "Check that file's permissions, then Retry." };
  }
  // Only `absent` may reach the empty config: every other reason means a file
  // is there, and the write below replaces whatever is at the path.
  return { config: read.ok ? read.config : {} };
}

async function linearMcpRun(ctx: ApplyContext): Promise<StepOutcome> {
  const path = claudeJsonPath(ctx.p);
  const before = readConfig(ctx, path);
  if (!("config" in before)) return before;
  if (nameTaken(before.config)) return ALREADY_SET_UP;

  const key = await ctx.secretPresence.has("rt", "linearApiKey");
  if (key === null) return { state: "skipped", detail: "No Linear account connected yet. Connect Linear, then Retry" };
  ctx.redact(key);

  // Claude Code keeps writing this file while it runs, so the copy the write
  // starts from is read after the key's await, with no await before the write.
  const current = readConfig(ctx, path);
  if (!("config" in current)) return current;
  if (nameTaken(current.config)) return ALREADY_SET_UP;
  writeClaudeConfig(ctx.p, path, withLinearEntry(current.config, key));
  ctx.log("linear.mcp", `added linear to ${path}`);
  return { state: "done", detail: `Added Linear to ${path}` };
}

export async function installLinearMcp(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await linearMcpRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const linearMcpStep: StepDef = {
  id: "linear.mcp",
  title: "Configure Linear MCP",
  kind: "rt",
  applies: () => true,
  run: installLinearMcp,
};
