import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export const ORG = "acme";

export function cloneDirOf(home: string): string {
  return join(home, ".mattstack", "orgs", ORG);
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe", env: { PATH: process.env.PATH ?? "", LC_ALL: "C" } });
}

function put(root: string, rel: string, body: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}

/** A real org clone on its `mattstack` data branch: base pack `base`, teams `widgets` (active) and `gadgets`, each with committed rules. */
export function makeOrg(home: string): string {
  const clone = cloneDirOf(home);
  mkdirSync(clone, { recursive: true });
  git(clone, "init", "-q", "-b", "mattstack");
  put(clone, "mattstack/org/settings.org.jsonc", "{}\n");
  put(clone, "mattstack/org/packs/base/rules/base.md", "# Base rule\n");
  put(clone, "mattstack/teams/widgets/plugin/rules/widgets.md", "# Widgets rule\n");
  put(clone, "mattstack/teams/widgets/plugin/rules/notes.txt", "not a rule\n");
  put(clone, "mattstack/teams/gadgets/plugin/rules/gadgets.md", "# Gadgets rule\n");
  put(clone, "mattstack/teams/gadgets/plugin/rules/code.review.md", "# Dotted rule\n");
  put(clone, "mattstack/teams/gadgets/plugin/rules/ticket style.md", "# Spaced rule\n");
  commit(clone, "seed");
  put(home, ".mattstack/rt/teams/acme.json", JSON.stringify({ dataBranch: "mattstack" }));
  setActiveTeam(home, "widgets");
  return clone;
}

export function commit(clone: string, message: string): void {
  git(clone, "add", "-A");
  git(clone, "commit", "-qm", message);
}

export function writeInClone(home: string, rel: string, body: string): void {
  put(cloneDirOf(home), rel, body);
}

export function setActiveTeam(home: string, team: string): void {
  put(home, ".mattstack/user/settings.user.jsonc", JSON.stringify({ "mattstack.activeTeam": team }));
}
