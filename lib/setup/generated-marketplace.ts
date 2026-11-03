/**
 * Claude Code loads a directory-source plugin from its source folder and
 * ignores the cache, so nothing rt applies to an installed team pack would
 * reach a session. A git-subdir source loads from the cache instead, but its
 * url must be a real URL, so the committed org marketplace.json cannot carry
 * one that works on every member's Mac. rt writes a per-Mac copy carrying the
 * org marketplace's own name, with one git-subdir entry per team pack
 * pointing at this Mac's org clone, and registers that folder under the same
 * name. The org file is read at the data branch, never the working tree, so
 * the copy lists only what a member can install.
 */

import { join } from "path";
import { pathToFileURL } from "url";
import { stripJsonc } from "../jsonc.ts";
import { generatedMarketplaceDir, orgDirUnder } from "../rt-paths.ts";
import { knownDataBranch } from "../team/org-branch.ts";
import { PACK_EXEC_TIMEOUT_MS } from "./plugin-calls.ts";
import type { Probes } from "./probes.ts";

export interface RenderedMarketplace {
  /** The generated marketplace.json text, or null when the org file did not parse or has no name. */
  json: string | null;
  /** Entries left out, each with its reason: the org file is only supposed to carry `./<rel>` sources. */
  dropped: string[];
}

export function renderGeneratedMarketplace(orgFile: string, cloneDir: string, ref: string): RenderedMarketplace {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(stripJsonc(orgFile)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { json: null, dropped: [] };
    parsed = value as Record<string, unknown>;
  } catch {
    return { json: null, dropped: [] };
  }
  if (typeof parsed.name !== "string" || parsed.name === "") return { json: null, dropped: [] };

  const url = pathToFileURL(cloneDir).href;
  const dropped: string[] = [];
  const plugins: unknown[] = [];
  for (const entry of Array.isArray(parsed.plugins) ? parsed.plugins : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : "(unnamed)";
    if (typeof e.source !== "string" || !e.source.startsWith("./") || e.source.length <= 2) {
      dropped.push(`${name}: its source is not a ./ folder in the org repo`);
      continue;
    }
    const path = e.source.slice(2).replace(/\/+$/, "");
    if (path.split("/").includes("..")) {
      dropped.push(`${name}: its source climbs out of the org repo`);
      continue;
    }
    plugins.push({ ...e, source: { source: "git-subdir", url, path, ref } });
  }

  const owner = parsed.owner && typeof parsed.owner === "object" ? parsed.owner : { name: parsed.name };
  return { json: `${JSON.stringify({ ...parsed, owner, plugins }, null, 2)}\n`, dropped };
}

/** The org's data branch; `main` for a layout 3 org, which has none. */
export function generatedMarketplaceRef(p: Pick<Probes, "readFile" | "home">, cloneDir: string): string {
  return knownDataBranch(p, cloneDir) ?? "main";
}

export interface GeneratedMarketplaceResult {
  /** The generated folder, the one `claude plugin marketplace add` takes. */
  path: string;
  changed: boolean;
  /** Set when nothing was written: the clone has no such ref or file, or the file did not parse. */
  skipped?: string;
  dropped: string[];
}

export async function writeGeneratedMarketplace(
  p: Pick<Probes, "exec" | "readFile" | "writeFile" | "rename" | "mkdirp" | "home">,
  org: string,
): Promise<GeneratedMarketplaceResult> {
  const path = generatedMarketplaceDir(p.home, org);
  const cloneDir = orgDirUnder(p.home, org);
  const ref = generatedMarketplaceRef(p, cloneDir);
  const shown = await p.exec(["git", "-C", cloneDir, "show", `${ref}:.claude-plugin/marketplace.json`], { env: { LC_ALL: "C" }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
  if (shown.code !== 0) return { path, changed: false, skipped: `the org repo has no .claude-plugin/marketplace.json on ${ref}`, dropped: [] };

  const rendered = renderGeneratedMarketplace(shown.stdout, cloneDir, ref);
  if (rendered.json === null) return { path, changed: false, skipped: `the org repo's marketplace.json on ${ref} did not parse`, dropped: [] };

  const file = join(path, ".claude-plugin", "marketplace.json");
  if (p.readFile(file) === rendered.json) return { path, changed: false, dropped: rendered.dropped };
  p.mkdirp(join(path, ".claude-plugin"));
  const tmp = `${file}.tmp-${process.pid}`;
  p.writeFile(tmp, rendered.json);
  p.rename(tmp, file);
  return { path, changed: true, dropped: rendered.dropped };
}
