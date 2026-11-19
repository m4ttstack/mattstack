import { realpathSync } from "fs";
import { join, relative, resolve, isAbsolute } from "path";
import type { Probes } from "../setup/probes.ts";

const MATTSTACK_MARKETPLACE = "mattstack";

export function claudeRulesDir(home: string): string {
  return join(home, ".mattstack", "claude", "rules");
}

export function packEntryName(org: string, pack: string): string {
  return `${org}-${pack}`;
}

/** Claude may store the path it was given or its realpath (macOS tmp folders differ); both sides realpath when they exist. */
export function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Claude Code does not load a rules link whose target sits outside the home folder. */
function insideHome(path: string, home: string): boolean {
  const rel = relative(realPath(home), realPath(path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function mattstackRulesSource(p: Pick<Probes, "readFile" | "exists" | "home">, configDir: string): { path: string } | { skipped: string } {
  const raw = p.readFile(join(configDir, "plugins", "known_marketplaces.json"));
  if (raw === null) return { skipped: "Claude has no marketplaces registered yet" };
  let known: unknown;
  try {
    known = JSON.parse(raw);
  } catch {
    return { skipped: "Claude's marketplace list could not be read" };
  }
  const loc = (known as Record<string, { installLocation?: unknown } | undefined>)?.[MATTSTACK_MARKETPLACE]?.installLocation;
  if (typeof loc !== "string" || loc === "") return { skipped: "the mattstack marketplace is not registered with Claude" };
  if (!insideHome(loc, p.home)) return { skipped: "the mattstack marketplace is outside the home folder, where Claude does not load rules" };
  const rules = join(loc, "plugins", "mattstack", "rules");
  if (!p.exists(rules)) return { skipped: "the mattstack marketplace has no rules yet" };
  return { path: rules };
}

export function linkConfigDir(p: Probes, configDir: string, target: string): "created" | "ok" | "foreign" {
  const rulesDir = join(configDir, "rules");
  const link = join(rulesDir, "mattstack");
  const existing = p.readlink(link);
  if (existing !== null) return realPath(resolve(rulesDir, existing)) === realPath(target) ? "ok" : "foreign";
  if (p.exists(link)) return "foreign";
  p.mkdirp(rulesDir);
  p.symlink(target, link);
  return "created";
}

/** One config dir per distinct `plugins/` folder, keeping the first (the default dir leads). */
export function distinctConfigDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  return dirs.filter((dir) => {
    const key = realPath(join(dir, "plugins"));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
