import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ORG_LAYOUT } from "../../team/org-marker.ts";
import type { MaterializeFs } from "../materialize.ts";

const FIX = join(import.meta.dir, "fixtures", "compile-native");

export const realMaterializeFs: MaterializeFs = {
  exists: existsSync,
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  writeFile: (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); },
  mkdirp: (p) => mkdirSync(p, { recursive: true }),
  readDir: (p) => (existsSync(p) ? readdirSync(p) : []),
  rename: renameSync,
};

export function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function setPackVersion(packDir: string, version: string): void {
  writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version }));
}

/**
 * A temp HOME holding an acme org clone whose widgets team carries the
 * compile-native pack (acme 0.1.0: a work verb and three stages), bound by
 * its own fragment, plus that version installed in the plugin cache. The
 * engine plugins live under `mattstackDir` (mattstack 1.0.0).
 */
export function renderWorld(made: string[], opts: { husks?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-render-world-")));
  made.push(home);
  cpSync(join(FIX, "mattstack-home", "plugins"), join(home, "engine", "plugins"), { recursive: true });
  const mattstackDir = join(home, "engine");
  const mattstackRoot = join(home, ".mattstack");
  const orgDir = join(mattstackRoot, "orgs", "acme");
  writeFile(join(orgDir, ".git", "config"), "");
  writeFile(join(orgDir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: ORG_LAYOUT }));
  writeFile(join(orgDir, "mattstack", "org", "settings.org.jsonc"), JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": ["acme/widgets"] }));
  const teamDir = join(orgDir, "mattstack", "teams", "widgets");
  writeFile(join(teamDir, "settings.team.jsonc"), "{}");
  const packDir = join(teamDir, "plugin");
  cpSync(join(FIX, "pack"), packDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(FIX, "mattstack-home", "repos", "my-repo", "skills.jsonc"), "utf8").replace(/^\/\/.*$/m, ""));
  writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ ...(opts.husks ? { husks: true } : {}), ...manifest }));
  const installed = join(home, ".claude", "plugins", "cache", "acme-market", "acme", "0.1.0");
  cpSync(packDir, installed, { recursive: true });
  const root = join(mattstackRoot, "rt", "rendered");
  return { home, mattstackRoot, mattstackDir, orgDir, packDir, installed, root };
}
