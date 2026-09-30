import { join } from "path";

export type PluginFs = { exists(p: string): boolean; readDir(p: string): string[] };

export const ENGINE_PACK_REF = "mattstack@mattstack";

const REF_RE = /^([a-z0-9][a-z0-9-]*)@([a-z0-9][a-z0-9-]*)$/i;

/** Dotted-numeric compare, missing segments treated as 0; version dirs here are plain "x.y.z". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Claude Code installs every plugin, dev marketplaces included, under ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/. */
export function findInstalledPluginDir(fs: PluginFs, home: string, ref: string): string | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const root = join(home, ".claude", "plugins", "cache", m[2]!, m[1]!);
  let best: string | null = null;
  for (const version of fs.readDir(root)) {
    if (!fs.exists(join(root, version))) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best === null ? null : join(root, best);
}
