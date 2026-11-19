import { basename, dirname, join } from "path";
import { orgDirUnder } from "../rt-paths.ts";
import { generatedMarketplaceRef } from "../setup/generated-marketplace.ts";
import { PACK_EXEC_TIMEOUT_MS } from "../setup/pack-cache.ts";
import type { Probes } from "../setup/probes.ts";
import { discoverOrgs } from "../setup/team-settings.ts";
import { activeTeamFor } from "../team/active-team.ts";
import { packEntryName } from "./paths.ts";

export interface PackRulesSource {
  entry: string;
  cloneDir: string;
  ref: string;
  /** The pack's rules folder inside the org repo, e.g. `mattstack/teams/widgets/plugin/rules`. */
  repoPath: string;
}

/** Folder names come from a repo other people write; only a plain name may reach a path. */
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function memberPackSources(p: Probes): PackRulesSource[] {
  const sources: PackRulesSource[] = [];
  for (const org of discoverOrgs(p)) {
    const cloneDir = orgDirUnder(p.home, org);
    const ref = generatedMarketplaceRef(p, cloneDir);
    const bases = p.readDir(join(cloneDir, "mattstack", "org", "packs")).filter((name) => PLAIN_NAME.test(name)).sort();
    for (const base of bases) sources.push({ entry: packEntryName(org, base), cloneDir, ref, repoPath: `mattstack/org/packs/${base}/rules` });
    const team = activeTeamFor(p, org).team;
    if (team !== null) sources.push({ entry: packEntryName(org, team), cloneDir, ref, repoPath: `mattstack/teams/${team}/plugin/rules` });
  }
  return sources;
}

export async function readPackRules(p: Probes, src: PackRulesSource): Promise<Map<string, string> | null> {
  const opts = { env: { LC_ALL: "C" }, timeoutMs: PACK_EXEC_TIMEOUT_MS };
  const listed = await p.exec(["git", "-C", src.cloneDir, "ls-tree", src.ref, `${src.repoPath}/`], opts);
  if (listed.code !== 0) return null;
  const paths = listed.stdout
    .split("\n")
    .map((line) => line.match(/^\d+ blob [0-9a-f]+\t(.+)$/)?.[1])
    .filter((path): path is string => path !== undefined && path.endsWith(".md") && PLAIN_NAME.test(basename(path, ".md")));
  if (paths.length === 0) return null;
  const files = new Map<string, string>();
  for (const path of paths) {
    const shown = await p.exec(["git", "-C", src.cloneDir, "show", `${src.ref}:${path}`], opts);
    if (shown.code !== 0) return null;
    files.set(basename(path), shown.stdout);
  }
  return files;
}

function holdsExactly(p: Probes, dir: string, files: Map<string, string>): boolean {
  if (p.readlink(dir) !== null) return false;
  const names = p.readDir(dir);
  if (names.length !== files.size) return false;
  return names.every((name) => files.has(name) && p.readFile(join(dir, name)) === files.get(name));
}

/** The temp folder sits outside `rulesDir`, since Claude loads every `.md` under it, a half-written folder included. */
export function writePackEntry(p: Probes, rulesDir: string, entry: string, files: Map<string, string>): "written" | "ok" {
  const target = join(rulesDir, entry);
  if (holdsExactly(p, target, files)) return "ok";
  const scratch = join(dirname(rulesDir), ".rules-tmp");
  const temp = join(scratch, `${entry}.${process.pid}.new`);
  const old = join(scratch, `${entry}.${process.pid}.old`);
  p.removeDir(temp);
  p.removeDir(old);
  p.mkdirp(temp);
  for (const [name, body] of files) p.writeFile(join(temp, name), body);
  p.mkdirp(rulesDir);
  if (p.exists(target) || p.readlink(target) !== null) p.rename(target, old);
  p.rename(temp, target);
  p.removeDir(old);
  return "written";
}
