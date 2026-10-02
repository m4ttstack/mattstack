/**
 * rt deps — resolve bundled tools by absolute path and expose them on PATH.
 *
 *   rt deps resolve <tool> [--json]
 *   rt deps link <tool> [--force] [--json]
 *   rt deps unlink <tool> [--json]
 *   rt deps reconcile [--json]
 *
 * All four are thin CLI shells over lib/deps/resolve.ts and lib/deps/links.ts
 * — this module only parses args, wires the real Probes seam, and renders.
 */

import { join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/errors.ts";
import { createRealProbes, type Probes } from "../lib/setup/probes.ts";
import { DEFAULT_EXPOSED, isOurLink, link, reconcile, unlink } from "../lib/deps/links.ts";
import { resolveTool, type ToolResolution } from "../lib/deps/resolve.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

function tool(args: string[]): string | undefined {
  return args.find((a) => !a.startsWith("--"));
}

async function pickTool(message: string, tools: readonly string[]): Promise<string | null> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  return filterableSelect({ message, options: tools.map((name) => ({ value: name, label: name })), stderr: true });
}

/** The positional, or an interactive pick when it's omitted on a TTY; a usage failure in every other case (no TTY, --json, RT_BATCH). */
async function requireTool(args: string[], usage: string, message: string, candidates: () => readonly string[]): Promise<string> {
  const t = tool(args);
  if (t) return t;
  if (process.stdin.isTTY && !args.includes("--json") && !process.env.RT_BATCH) {
    const picked = await pickTool(message, candidates());
    if (!picked) process.exit(0);
    return picked;
  }
  out.fail(usageFailure("Which tool?", usage));
  process.exit(1);
}

/** Tools currently exposed by one of our tagged links, else the known-tool set (never empty, so the picker always has candidates). */
function linkedTools(p: Probes): readonly string[] {
  const linked = p.readDir(join(p.home, ".local", "bin")).filter((name) => isOurLink(p, name));
  return linked.length ? linked : DEFAULT_EXPOSED;
}

export function resolveBlocks(r: ToolResolution): Block[] {
  return [
    out.kv("Tool", r.tool),
    out.kv("Bundled", r.bundled ?? "not bundled"),
    out.kv("Your copy", r.userCopy ?? "none on your PATH"),
    out.kv("Linked", r.linked ? "yes" : "no"),
    out.kv("Uses", r.chosen ?? "nothing found"),
  ];
}

export async function depsResolve(args: string[], _ctx: CommandContext = {}, p: Probes = createRealProbes()): Promise<void> {
  const t = await requireTool(args, "rt deps resolve <tool>", "Resolve which tool?", () => DEFAULT_EXPOSED);

  const resolution = resolveTool(p, t);

  if (args.includes("--json")) {
    out.json(envelope(resolution));
    return;
  }
  out.print(...resolveBlocks(resolution));
}

export async function depsLink(args: string[], _ctx: CommandContext = {}, p: Probes = createRealProbes()): Promise<void> {
  const t = await requireTool(args, "rt deps link <tool>", "Link which tool?", () => DEFAULT_EXPOSED);

  const outcome = link(p, t, { force: args.includes("--force") });
  const json = args.includes("--json");

  // Every refusal exits 2. Under --json that is the contract's {error}
  // envelope, the shape `rt tools install` uses, so an app decoding a row
  // action reads one path. Only no-bundle is a failure; the others are rt
  // declining by policy, which is never coral.
  if (!outcome.ok) {
    if (json || outcome.reason === "no-bundle") return exitUserError(new UserActionableError(outcome.reason, outcome.detail), json, "deps link");
    const forceClears = outcome.reason === "user-copy" || outcome.reason === "occupied";
    out.note(out.line("refused", outcome.detail), ...(forceClears ? [out.callout("next", out.cmd(`rt deps link ${t} --force`))] : []));
    process.exit(2);
  }

  if (json) {
    out.json(envelope(outcome));
    return;
  }
  out.print(out.line("done", outcome.state === "already" ? `${t} is already linked` : `Linked ${t}`, outcome.path));
}

export async function depsUnlink(args: string[], _ctx: CommandContext = {}, p: Probes = createRealProbes()): Promise<void> {
  const t = await requireTool(args, "rt deps unlink <tool>", "Unlink which tool?", () => linkedTools(p));

  const outcome = unlink(p, t);

  if (args.includes("--json")) {
    out.json(envelope(outcome));
    return;
  }
  if (!outcome.removed) {
    out.note(out.line("refused", `${t} is not a link rt made`, "left as it is"));
    return;
  }
  out.print(out.line("done", `Unlinked ${t}`));
}

export async function depsReconcile(args: string[], _ctx: CommandContext = {}, p: Probes = createRealProbes()): Promise<void> {
  const outcome = reconcile(p);

  if (args.includes("--json")) {
    out.json(envelope(outcome));
    return;
  }
  if (outcome.removed.length === 0) {
    out.print(out.line("skipped", "Nothing to tidy"));
    return;
  }
  out.print(out.line("done", "Removed links you no longer need", outcome.removed.join(", ")), out.callout("note", "Your own copy of each is on your PATH now."));
}
