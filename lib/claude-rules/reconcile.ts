import { join, resolve } from "path";
import { cswapConfigDirs } from "../cswap.ts";
import type { Probes } from "../setup/probes.ts";
import { claudeConfigDirs } from "../setup/tools-install.ts";
import { memberPackSources, readPackRules, writePackEntry } from "./packs.ts";
import { claudeRulesDir, distinctConfigDirs, linkConfigDir, mattstackRulesSource, realPath } from "./paths.ts";

export interface ClaudeRulesResult {
  mattstack: "linked" | "ok" | { skipped: string };
  /** `unreadable`: git could not read the pack, so its entry was left as it was. */
  packs: { entry: string; state: "written" | "ok" | "removed" | "unreadable" }[];
  links: { configDir: string; state: "created" | "ok" | "foreign" }[];
}

const MATTSTACK_ENTRY = "mattstack";

function removeEntry(p: Probes, path: string): void {
  if (p.readlink(path) !== null) p.removeFile(path);
  else p.removeDir(path);
}

function pointMattstack(p: Probes, dir: string, source: { path: string } | { skipped: string }): ClaudeRulesResult["mattstack"] {
  const entry = join(dir, MATTSTACK_ENTRY);
  const present = p.exists(entry) || p.readlink(entry) !== null;
  if ("skipped" in source) {
    if (present) removeEntry(p, entry);
    return source;
  }
  const current = p.readlink(entry);
  if (current !== null && realPath(resolve(dir, current)) === realPath(source.path)) return "ok";
  if (present) removeEntry(p, entry);
  p.symlink(source.path, entry);
  return "linked";
}

/** rt owns every entry in the rules folder: anything it did not write this run is removed. */
export async function reconcileClaudeRules(p: Probes): Promise<ClaudeRulesResult> {
  const dir = claudeRulesDir(p.home);
  p.mkdirp(dir);
  const configDirs = distinctConfigDirs(claudeConfigDirs(p, cswapConfigDirs(p)));

  const mattstack = pointMattstack(p, dir, mattstackRulesSource(p, configDirs[0]!));

  const packs: ClaudeRulesResult["packs"] = [];
  const kept = new Set([MATTSTACK_ENTRY]);
  for (const src of memberPackSources(p)) {
    let files: Map<string, string> | null;
    try {
      files = await readPackRules(p, src);
    } catch {
      packs.push({ entry: src.entry, state: "unreadable" });
      kept.add(src.entry);
      continue;
    }
    if (files === null) continue;
    packs.push({ entry: src.entry, state: writePackEntry(p, dir, src.entry, files) });
    kept.add(src.entry);
  }
  for (const name of p.readDir(dir).sort()) {
    if (kept.has(name)) continue;
    removeEntry(p, join(dir, name));
    packs.push({ entry: name, state: "removed" });
  }

  const links = configDirs.map((configDir) => ({ configDir, state: linkConfigDir(p, configDir, dir) }));
  return { mattstack, packs, links };
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function claudeRulesDetail(r: ClaudeRulesResult): string {
  const packs = r.packs.filter((x) => x.state === "written" || x.state === "ok").length;
  const unreadable = r.packs.filter((x) => x.state === "unreadable").length;
  const what = [...(typeof r.mattstack === "string" ? ["mattstack's rules"] : []), ...(packs > 0 ? [count(packs, "pack")] : [])];
  const linked = r.links.filter((l) => l.state !== "foreign").length;
  const parts = [`Linked ${what.length > 0 ? what.join(" and ") : "the shared rules folder"} into ${count(linked, "Claude folder")}`];
  if (unreadable > 0) parts.push(`could not read ${count(unreadable, "pack")} from the org's data branch, so left ${unreadable === 1 ? "it as it was" : "them as they were"}`);
  if (typeof r.mattstack !== "string") parts.push(`left out mattstack's rules: ${r.mattstack.skipped}`);
  for (const l of r.links.filter((x) => x.state === "foreign")) parts.push(`rt did not make ${join(l.configDir, "rules", "mattstack")}, so rt left it alone`);
  return parts.join("; ");
}
