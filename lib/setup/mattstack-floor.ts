import { join } from "path";
import { stripJsonc } from "../jsonc.ts";
import { readFloor, type Floor } from "../engine-floor.ts";
import type { ExecResult, Probes } from "./probes.ts";
import { parseMarketplaceList } from "./marketplace-list.ts";

/**
 * The engine floor the mattstack plugin's catalog entry publishes, read from
 * the registered marketplace's checkout. Only an inline (relative-path) entry
 * carries one: a dev marketplace points `git-subdir` at a repo, and holds nothing.
 */
export async function mattstackFloor(p: Probes, run: (args: string[]) => Promise<ExecResult>, opts: { refresh: boolean }): Promise<Floor> {
  // A failed refresh is ignored: offline, the cached checkout still answers.
  if (opts.refresh) await run(["plugin", "marketplace", "update", "mattstack"]);
  const listed = await run(["plugin", "marketplace", "list", "--json"]);
  if (listed.code !== 0) return null;
  const location = parseMarketplaceList(listed.stdout)?.find((m) => m.name === "mattstack")?.installLocation;
  if (!location) return null;
  const raw = p.readFile(join(location, ".claude-plugin", "marketplace.json"));
  if (raw === null) return null;
  try {
    const plugins = (JSON.parse(stripJsonc(raw)) as { plugins?: unknown }).plugins;
    if (!Array.isArray(plugins)) return null;
    const entry = plugins.find((e): e is { source?: unknown } => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "mattstack");
    if (typeof entry?.source !== "string") return null;
    return readFloor(p.readFile, join(location, entry.source));
  } catch {
    return null;
  }
}
