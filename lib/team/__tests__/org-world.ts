import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { createRealProbes } from "../../setup/probes.ts";
import { childEnv } from "../../subprocess.ts";

const worlds: { home: string; prior: string | undefined }[] = [];

/** Restores HOME and removes every world made since the last call. */
export function cleanupOrgWorlds(): void {
  for (const { home, prior } of worlds.splice(0).reverse()) {
    process.env.HOME = prior;
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * A real acme org clone under a temp HOME (HOME points at it until cleanup),
 * pushed once to a bare origin. dev1 is the admin and dev2 owns widgets.
 */
export function orgWorld(username = "dev1", extra: { settings?: Record<string, unknown> } = {}) {
  const prior = process.env.HOME;
  const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-org-world-")));
  worlds.push({ home, prior });
  process.env.HOME = home;
  seedOrg({ org: "acme", username, settings: extra.settings, roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } }, teams: { widgets: { "board.title": "widgets" } } });
  const root = join(home, ".mattstack", "orgs", "acme");
  const remote = join(home, "origin.git");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "marketplace.json"), `${JSON.stringify({ name: "acme", owner: { name: "acme" }, plugins: [] }, null, 2)}\n`);
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: root, env: childEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.name", username);
  git("config", "user.email", `${username}@example.test`);
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  execFileSync("git", ["init", "--bare", "-q", remote], { env: childEnv() });
  git("remote", "add", "origin", remote);
  git("push", "-q", "-u", "origin", "main");
  const p = createRealProbes();
  const pushes: string[][] = [];
  const realExec = p.exec.bind(p);
  p.exec = (argv, opts) => {
    if (argv.includes("push")) pushes.push(argv);
    return realExec(argv, opts);
  };
  const atOrigin = (...args: string[]) => execFileSync("git", ["--git-dir", remote, ...args], { env: childEnv(), encoding: "utf8" });
  return { home, root, remote, git, p, pushes, atOrigin };
}
