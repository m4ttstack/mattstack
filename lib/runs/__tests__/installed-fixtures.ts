import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { childEnv } from "../../subprocess.ts";

export const PACK_REL = "mattstack/teams/acme/plugin";

export function tmp(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function git(dir: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdout: "pipe", stderr: "pipe", env: childEnv() });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

function commitFile(dir: string, rel: string, text: string, message: string): string {
  put(join(dir, rel), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", message);
  return git(dir, "rev-parse", "--short", "HEAD");
}

const manifest = (version: string, extra: Record<string, unknown> = {}) => JSON.stringify({ name: "acme", version, ...extra });

export function bumpAcme(dir: string, version: string, extra: Record<string, unknown> = {}): string {
  return commitFile(dir, `${PACK_REL}/.claude-plugin/plugin.json`, manifest(version, extra), `skills sync: acme v${version}`);
}

/** An org clone at `dir` whose data branch bumps acme 0.4.10 → 0.4.12, then carries another team's commit. */
export function seedOrgClone(dir: string): { sync11: string } {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "mattstack");
  bumpAcme(dir, "0.4.10");
  const sync11 = bumpAcme(dir, "0.4.11");
  bumpAcme(dir, "0.4.11", { description: "same version, new words" });
  bumpAcme(dir, "0.4.12");
  commitFile(dir, "mattstack/teams/widgets/plugin/.claude-plugin/plugin.json", JSON.stringify({ name: "widgets", version: "1.0.0" }), "skills sync: widgets v1.0.0");
  return { sync11 };
}

/** Moves the clone onto a trial branch holding its own 0.4.11 bump, so HEAD's history names a different commit than the data branch's. */
export function moveToTrial(dir: string, sync11: string): void {
  git(dir, "switch", "-q", "-c", "trial", `${sync11}~1`);
  bumpAcme(dir, "0.4.11", { description: "trial" });
  bumpAcme(dir, "0.4.13");
}

export type LockSeed = { mattstack?: string; sha?: string; dirty?: 0 | 1 };

/** The work skill of an acme pack at `packRoot`, compiled against `lock`. */
export function seedPack(packRoot: string, version: string, lock: LockSeed = { mattstack: "0.32.56" }): string {
  put(join(packRoot, ".claude-plugin", "plugin.json"), manifest(version));
  const target = "skills/work";
  put(join(packRoot, "pack", "compiled.lock.json"), JSON.stringify({
    targets: { [target]: { acme: version, ...(lock.mattstack ? { mattstack: lock.mattstack } : {}) } },
    bases: {},
    mattstackSha: lock.sha ? { [target]: lock.sha } : {},
    mattstackDirty: lock.dirty !== undefined ? { [target]: lock.dirty } : {},
  }));
  const skillDir = join(packRoot, target);
  put(join(skillDir, "SKILL.md"), "---\nname: work\n---\n");
  return skillDir;
}

/** An installed acme at `version` in a plugin cache under `market`. */
export function installedSkill(version: string, lock?: LockSeed, cache = join(tmp("rt-installed-home-"), ".claude", "plugins", "cache"), market = "acme-plugins"): string {
  return seedPack(join(cache, market, "acme", version), version, lock);
}

/** A HOME whose one org clone `acme` serves the `acme-plugins` marketplace from its `mattstack` data branch. */
export function homeWithOrgClone(): { home: string; clone: string; sync11: string } {
  const home = tmp("rt-installed-home-");
  const clone = join(home, ".mattstack", "orgs", "acme");
  const { sync11 } = seedOrgClone(clone);
  put(join(home, ".mattstack", "rt", "marketplaces", "acme", ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "acme-plugins", plugins: [] }));
  put(join(home, ".mattstack", "rt", "teams", "acme.json"), JSON.stringify({ dataBranch: "mattstack" }));
  return { home, clone, sync11 };
}
