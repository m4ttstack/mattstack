/**
 * rt plugin (manage user plugins, ~/.mattstack/user/plugins).
 * Discovery/merge lives in lib/plugins.ts; these are the management verbs.
 */

import { spawnSync } from "child_process";
import { bold, cyan, dim, green, reset, yellow } from "../lib/tui.ts";
import { scaffoldPlugin, discoverPlugins, deepValidate, type DiscoveredPlugin } from "../lib/plugins.ts";
import * as out from "../lib/ui/out.ts";
import { envelope } from "../lib/setup/contract.ts";
import type { CommandContext } from "../lib/command-tree.ts";

export async function runNew(args: string[], _ctx: CommandContext): Promise<void> {
  let name = args[0];
  if (!name && process.stdin.isTTY) {
    const { textInput } = await import("../lib/rt-render.ts");
    name = await textInput({ message: "Plugin name (kebab-case)", placeholder: "my-plugin" });
  }
  if (!name) {
    console.error(`\n  ${yellow}usage: rt plugin new <name>${reset}\n`);
    process.exit(1);
  }

  const dir = scaffoldPlugin(name);
  console.log(`\n  ${green}created${reset} ${dir}\n`);

  const pm = Bun.which("bun") ? "bun" : Bun.which("npm") ? "npm" : null;
  if (pm) {
    const result = spawnSync(pm, ["install"], { cwd: dir, stdio: "inherit" });
    if (result.status !== 0) console.error(`  ${yellow}${pm} install failed; run it manually in ${dir}${reset}`);
  } else {
    console.log(`  ${dim}no bun/npm on PATH; for IDE types run 'bun install' in ${dir}${reset}`);
  }

  console.log(`\n  ${bold}next steps${reset}`);
  console.log(`  ${dim}edit${reset}  ${dir}/${name}.ts`);
  console.log(`  ${dim}run${reset}   ${cyan}rt ${name}${reset}\n`);
}

function countCommands(commands: Record<string, unknown>): number {
  return Object.keys(commands).length;
}

export async function runList(_args: string[], _ctx: CommandContext): Promise<void> {
  const plugins = discoverPlugins();
  if (plugins.length === 0) {
    console.log(`\n  ${dim}no plugins installed ... create one with${reset} ${cyan}rt plugin new${reset}\n`);
    return;
  }
  console.log("");
  for (const p of plugins) {
    if (p.manifest) {
      const names = Object.keys(p.manifest.commands).join(", ");
      console.log(`  ${green}ok${reset}    ${bold}${p.dirName}${reset}  ${dim}${countCommands(p.manifest.commands)} commands: ${names}${reset}`);
    } else {
      console.log(`  ${yellow}skip${reset}  ${bold}${p.dirName}${reset}  ${dim}${p.errors[0]}${reset}`);
    }
  }
  console.log("");
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
    else console.error(`\n  ${yellow}no plugin named "${only}"${reset}\n`);
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
    console.log(`\n  ${dim}no plugins installed ... create one with${reset} ${cyan}rt plugin new${reset}\n`);
    return;
  }

  let failures = 0;
  console.log("");
  for (const p of plugins) {
    const problems = await deepValidate(p);
    if (problems.length === 0) {
      console.log(`  ${green}ok${reset}    ${bold}${p.dirName}${reset}`);
    } else {
      failures++;
      console.log(`  ${yellow}fail${reset}  ${bold}${p.dirName}${reset}`);
      for (const problem of problems) console.log(`        ${dim}${problem}${reset}`);
    }
  }
  console.log("");
  if (failures > 0) process.exit(1);
}
