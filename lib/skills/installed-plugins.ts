import { lstatSync, realpathSync } from "fs";
import { isAbsolute, join, normalize, relative, sep } from "path";
import type { FaultCode, HarnessId, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import type { SkillAdapter } from "../agent-integrations/contracts.ts";
import { isInsideRoot } from "../daemon/upload-guard.ts";
import type { PluginListEntry } from "./sources.ts";

export type PluginFs = { exists(p: string): boolean; readDir(p: string): string[] };

export const ENGINE_PACK_REF = "mattstack@mattstack";

export const PLUGIN_REF_RE = /^([a-z0-9][a-z0-9-]*)@([a-z0-9][a-z0-9-]*)$/;

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
export function findInstalledPluginDir(
  fs: PluginFs, home: string, ref: string, cacheRoot = join(home, ".claude", "plugins", "cache"),
): string | null {
  const m = PLUGIN_REF_RE.exec(ref);
  if (!m) return null;
  const root = join(cacheRoot, m[2]!, m[1]!);
  let best: string | null = null;
  for (const version of fs.readDir(root)) {
    if (!fs.exists(join(root, version))) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best === null ? null : join(root, best);
}

/** What one harness CLI run for a listing returned. `status` is null when it did not exit on its own (a timeout or a spawn failure). */
export type RunResult = { status: number | null; stdout: string; stderr: string; timedOut?: boolean };
export type SkillRunner = (
  bin: string, args: string[], opts: { env: Record<string, string | undefined>; timeoutMs: number },
) => Promise<RunResult>;

/** Bounded: a hung harness CLI must not hold its caller forever. */
export const PLUGIN_LIST_TIMEOUT_MS = 10_000;

export const spawnRunner: SkillRunner = async (bin, args, opts) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([bin, ...args], { env: opts.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    return { status: null, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs);
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    return timedOut ? { status: null, stdout, stderr, timedOut } : { status, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

/** The first line a failed listing printed, so a fault never carries a whole log. */
export function listingFault(label: string, res: RunResult, timeoutMs: number): Outcome<never> {
  if (res.timedOut) return fail("transient", `${label} timed out after ${timeoutMs / 1000}s`);
  const first = res.stderr.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? `exit ${String(res.status)}`;
  return fail("not-ready", `${label} failed: ${first}`);
}

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** A marketplace, plugin or version name that can be one path component and nothing more. */
export function isCacheSegment(value: unknown): value is string {
  return typeof value === "string" && SEGMENT_RE.test(value) && !value.includes("..");
}

function canonical(path: string): boolean {
  return isAbsolute(path) && normalize(path) === path && !path.endsWith(sep);
}

/**
 * The realpath of `installPath` when it is exactly the version folder
 * `<cacheRoot>/<marketplace>/<plugin>/<version>` for `id`
 * (`plugin@marketplace`), with no symlink at any level below the cache root;
 * otherwise null. That folder is the narrowest root a plugin has: never its
 * cache parent, a profile folder or anything else under home.
 */
export function admitPluginVersionDir(cacheRoot: string, id: string, installPath: string): string | null {
  const [name, marketplace, ...extra] = id.split("@");
  if (extra.length > 0 || !isCacheSegment(name) || !isCacheSegment(marketplace)) return null;
  if (!canonical(installPath) || !canonical(cacheRoot)) return null;
  let cacheReal: string;
  try {
    cacheReal = realpathSync(cacheRoot);
  } catch {
    return null;
  }
  const base = isInsideRoot(installPath, cacheRoot) ? cacheRoot : isInsideRoot(installPath, cacheReal) ? cacheReal : null;
  if (base === null) return null;
  const parts = relative(base, installPath).split(sep);
  if (parts.length !== 3 || parts[0] !== marketplace || parts[1] !== name || !isCacheSegment(parts[2])) return null;
  let walked = cacheReal;
  for (const part of parts) {
    walked = join(walked, part);
    try {
      const st = lstatSync(walked);
      if (st.isSymbolicLink() || !st.isDirectory()) return null;
    } catch {
      return null;
    }
  }
  return walked;
}

function fail(code: FaultCode, message: string): Outcome<never> {
  return { ok: false, error: { code, message } };
}

/** `relativePath` inside `root` as a realpath; refused when it is not a plain relative path or resolves out of `root`. */
export function resolveInside(root: string, relativePath: string): Outcome<string> {
  if (relativePath === "" || isAbsolute(relativePath) || normalize(relativePath) !== relativePath
    || relativePath.split("/").some((s) => s === "" || s === "." || s === "..")) {
    return fail("refused", `"${relativePath}" is not a plain relative path inside the plugin`);
  }
  let real: string;
  try {
    real = realpathSync(join(root, relativePath));
  } catch {
    return fail("invalid", `${relativePath} does not exist in ${root}`);
  }
  if (!isInsideRoot(real, root)) return fail("refused", `${relativePath} resolves outside ${root}`);
  return { ok: true, data: real };
}

export type HarnessPluginSource = {
  harness: HarnessId;
  /** The cache every installed version folder of this harness and profile must sit in. */
  cacheRoot: () => Outcome<string>;
  /** What the harness itself reports as installed, each entry tagged with harness and profile. */
  list: () => Promise<Outcome<PluginListEntry[]>>;
};

async function listed(source: HarnessPluginSource): Promise<Outcome<{ cache: string; entries: PluginListEntry[] }>> {
  const cache = source.cacheRoot();
  if (!cache.ok) return cache;
  const list = await source.list();
  return list.ok ? { ok: true, data: { cache: cache.data, entries: list.data } } : list;
}

/** One root per admitted installed version folder, in listing order. */
export function admitRoots(cacheRoot: string, entries: readonly PluginListEntry[]): string[] {
  const roots: string[] = [];
  for (const entry of entries) {
    const root = admitPluginVersionDir(cacheRoot, entry.id, entry.installPath);
    if (root !== null && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

/**
 * A skill adapter over one harness's own listing. Only version folders
 * `admitPluginVersionDir` accepts become roots or resolve resources; a
 * listed entry that fails it stays in the inventory as the harness reported
 * it, and is refused when asked for by name. A fault in this harness is
 * returned as is: nothing here reads another harness instead.
 */
export function pluginResourceAdapter(source: HarnessPluginSource): SkillAdapter {
  return {
    async inventory() {
      const found = await listed(source);
      return found.ok ? { ok: true, data: found.data.entries } : found;
    },
    async resourceRoots() {
      const found = await listed(source);
      return found.ok ? { ok: true, data: admitRoots(found.data.cache, found.data.entries) } : found;
    },
    async resolveResource(plugin, relativePath) {
      const found = await listed(source);
      if (!found.ok) return found;
      const matches = found.data.entries.filter((e) => (plugin.includes("@") ? e.id === plugin : e.id.split("@")[0] === plugin));
      if (matches.length === 0) return fail("invalid", `${plugin} is not installed for ${source.harness}`);
      if (matches.length > 1) {
        return fail("ambiguous", `${plugin} names ${matches.length} installed ${source.harness} plugins (${matches.map((e) => e.id).join(", ")}); name one as plugin@marketplace`);
      }
      const entry = matches[0]!;
      const root = admitPluginVersionDir(found.data.cache, entry.id, entry.installPath);
      if (root === null) {
        return fail("refused", `${entry.id} is installed at ${entry.installPath}, which is not a version folder in the ${source.harness} plugin cache`);
      }
      return resolveInside(root, relativePath);
    },
    async maintain() {
      return fail("unsupported", `skill maintenance through the ${source.harness} integration is not available yet`);
    },
  };
}
