/**
 * rt plugin (manage user plugins, ~/.mattstack/user/plugins).
 * Discovery/merge lives in lib/plugins.ts; these are the management verbs.
 */

import { spawnSync } from "child_process";
import { join } from "path";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { envelope } from "../lib/setup/contract.ts";
import { scaffoldPlugin, discoverPlugins, deepValidate, pluginsDir, PluginScaffoldError, type DiscoveredPlugin } from "../lib/plugins.ts";
import type { CommandContext } from "../lib/command-tree.ts";

export function scaffoldedBlocks(name: string, dir: string, install: { pm: string; ok: boolean } | null): Block[] {
  const blocks: Block[] = [];
  if (!install) {
    blocks.push(out.line("skipped", "Editor types were not installed", "neither bun nor npm is on your PATH"));
    blocks.push(out.callout("fix", ["Install bun, then run ", out.cmd("bun install"), " in ", out.strong(dir)]));
  } else if (!install.ok) {
    blocks.push(out.line("warn", `${install.pm} install did not finish`, "editor types will be missing until it does"));
    blocks.push(out.callout("fix", ["Run ", out.cmd(`${install.pm} install`), " in ", out.strong(dir)]));
  }
  blocks.push(out.callout("next", ["Edit ", out.strong(`${dir}/${name}.ts`), ", then run ", out.cmd(`rt ${name}`)]));
  return blocks;
}

export async function runNew(args: string[], _ctx: CommandContext): Promise<void> {
  let name = args[0];
  if (!name && process.stdin.isTTY) {
    const { textInput } = await import("../lib/rt-render.ts");
    name = await textInput({ message: "Plugin name (kebab-case)", placeholder: "my-plugin" });
  }
  if (!name) {
    out.fail(usageFailure("What should the plugin be called?", "rt plugin new <name>"));
    process.exit(1);
  }

  let dir: string;
  try {
    dir = scaffoldPlugin(name);
  } catch (err) {
    if (!(err instanceof PluginScaffoldError)) throw err;
    out.fail(
      err.code === "exists"
        ? { title: `A plugin called ${name} already exists`, why: `It is at ${join(pluginsDir(), name)}.` }
        : { title: "A plugin name is lowercase words joined by dashes", why: `${name} is not.`, next: out.cmd("rt plugin new my-plugin") },
    );
    process.exit(1);
  }
  out.print(out.line("done", `Created the ${name} plugin`, dir));

  const pm = Bun.which("bun") ? "bun" : Bun.which("npm") ? "npm" : null;
  const install = pm ? { pm, ok: spawnSync(pm, ["install"], { cwd: dir, stdio: "inherit" }).status === 0 } : null;
  out.print(...scaffoldedBlocks(name, dir, install));
}

export function pluginListBlocks(plugins: DiscoveredPlugin[]): Block[] {
  if (plugins.length === 0) return [out.line("pending", "No plugins yet"), out.callout("next", out.cmd("rt plugin new"))];
  return plugins.map((p) => {
    if (!p.manifest) return out.line("warn", p.dirName, `not loaded: ${p.errors[0]}`);
    const names = Object.keys(p.manifest.commands);
    return out.line("done", p.dirName, `${names.length} ${names.length === 1 ? "command" : "commands"}: ${names.join(", ")}`);
  });
}

export async function runList(_args: string[], _ctx: CommandContext): Promise<void> {
  out.print(...pluginListBlocks(discoverPlugins()));
}

export interface PluginValidation {
  /** The plugin's folder name. */
  name: string;
  dir: string;
  ok: boolean;
  /** One line per problem; empty when ok. */
  problems: string[];
}

export async function validatePlugins(plugins: DiscoveredPlugin[]): Promise<PluginValidation[]> {
  const results: PluginValidation[] = [];
  for (const p of plugins) {
    const problems = await deepValidate(p);
    results.push({ name: p.dirName, dir: p.dir, ok: problems.length === 0, problems });
  }
  return results;
}

export function validateBlocks(results: PluginValidation[]): Block[] {
  return results.flatMap((r) => (r.ok ? [out.line("done", r.name)] : [out.line("failed", r.name), out.callout("why", ...r.problems)]));
}

// Validating a plugin imports its modules, which runs their top-level code;
// any of these console methods there would land on stdout beside the
// envelope (Bun writes dir and table to stdout too).
const STDOUT_PRINTS = ["log", "info", "debug", "dir", "table"] as const;

async function withPluginPrintsOnStderr<T>(fn: () => Promise<T>): Promise<T> {
  const c = console as unknown as Record<(typeof STDOUT_PRINTS)[number] | "error", (...args: unknown[]) => void>;
  const saved = STDOUT_PRINTS.map((m) => [m, c[m]] as const);
  for (const m of STDOUT_PRINTS) c[m] = c.error;
  try {
    return await fn();
  } finally {
    for (const [m, f] of saved) c[m] = f;
  }
}

export async function runValidate(args: string[], _ctx: CommandContext): Promise<void> {
  const json = args.includes("--json");
  const only = args.find((a) => !a.startsWith("--"));
  const plugins = discoverPlugins().filter((p) => !only || p.dirName === only);
  if (only && plugins.length === 0) {
    if (json) out.json(envelope({ ok: false, plugins: [], error: `no plugin named "${only}"` }));
    else out.fail({ title: `No plugin is called ${only}`, next: out.cmd("rt plugin list") });
    process.exit(1);
  }
  if (json) {
    const results = await withPluginPrintsOnStderr(() => validatePlugins(plugins));
    const ok = results.every((r) => r.ok);
    out.json(envelope({ ok, plugins: results }));
    if (!ok) process.exit(1);
    return;
  }
  if (plugins.length === 0) {
    out.print(...pluginListBlocks([]));
    return;
  }
  const results = await validatePlugins(plugins);
  out.print(...validateBlocks(results));
  if (results.some((r) => !r.ok)) process.exit(1);
}
