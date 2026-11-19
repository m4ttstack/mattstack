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
/** A tree entry name never holds `/`; a leading dot would hide the file. */
const RULE_FILE = /^[^.].*\.md$/;

const GIT_OPTS = { env: { LC_ALL: "C" }, timeoutMs: PACK_EXEC_TIMEOUT_MS };

/** `git ls-tree -z` entries under `path` at `ref`, or null when git could not read the ref. */
async function treeEntries(p: Probes, cloneDir: string, ref: string, path: string): Promise<{ mode: string; type: string; id: string; path: string }[] | null> {
  const listed = await p.exec(["git", "-C", cloneDir, "ls-tree", "-z", ref, `${path}/`], GIT_OPTS);
  if (listed.code !== 0) return null;
  return listed.stdout
    .split("\0")
    .map((line) => line.match(/^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ mode: m[1]!, type: m[2]!, id: m[3]!, path: m[4]! }));
}

/** Base packs are listed at the data ref like their rules; a ref git cannot read falls back to the working tree, whose packs then read as unreadable and keep their entries. */
export async function memberPackSources(p: Probes): Promise<PackRulesSource[]> {
  const sources: PackRulesSource[] = [];
  for (const org of discoverOrgs(p)) {
    const cloneDir = orgDirUnder(p.home, org);
    const ref = generatedMarketplaceRef(p, cloneDir);
    const atRef = await treeEntries(p, cloneDir, ref, "mattstack/org/packs");
    const names = atRef === null ? p.readDir(join(cloneDir, "mattstack", "org", "packs")) : atRef.filter((e) => e.type === "tree").map((e) => basename(e.path));
    const bases = names.filter((name) => PLAIN_NAME.test(name)).sort();
    for (const base of bases) sources.push({ entry: packEntryName(org, base), cloneDir, ref, repoPath: `mattstack/org/packs/${base}/rules` });
    const team = activeTeamFor(p, org).team;
    if (team === null) continue;
    const entry = bases.includes(team) ? `${packEntryName(org, team)}-team` : packEntryName(org, team);
    sources.push({ entry, cloneDir, ref, repoPath: `mattstack/teams/${team}/plugin/rules` });
  }
  return sources;
}

/** Null when the ref publishes no rules for the pack; throws when git could not read the ref. */
export async function readPackRules(p: Probes, src: PackRulesSource): Promise<Map<string, string> | null> {
  // A path the ref lacks lists nothing and exits 0, so a nonzero exit is always a fault, never "no rules".
  const entries = await treeEntries(p, src.cloneDir, src.ref, src.repoPath);
  if (entries === null) throw new Error(`git ls-tree ${src.ref} ${src.repoPath} failed`);
  // Regular files only: a committed symlink's blob is its target path, not a rule. Reading by blob id keeps one listing's revision even if a pull moves the ref meanwhile.
  const rules = entries.filter((e) => (e.mode === "100644" || e.mode === "100755") && e.type === "blob" && RULE_FILE.test(basename(e.path)));
  if (rules.length === 0) return null;
  const files = new Map<string, string>();
  for (const rule of rules) {
    const shown = await p.exec(["git", "-C", src.cloneDir, "cat-file", "blob", rule.id], GIT_OPTS);
    if (shown.code !== 0) throw new Error(`git cat-file blob ${rule.id} exited ${shown.code}: ${shown.stderr.trim()}`);
    files.set(basename(rule.path), shown.stdout);
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
