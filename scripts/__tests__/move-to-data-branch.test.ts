import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { orgDir } from "../../lib/rt-paths.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";

const MARKER = "mattstack/mattstack.jsonc";
const ORG_STORE = "mattstack/org/settings.org.jsonc";
const script = join(import.meta.dir, "..", "move-to-data-branch.ts");
const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

const origHome = process.env.HOME;
let home: string;
let origin: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-data-branch-home-")));
  process.env.HOME = home;
  origin = join(home, "origin.git");
  mkdirSync(scratch());
});
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

const scratch = () => join(home, "tmp");
const env = () => ({ ...childEnv(), HOME: home, TMPDIR: scratch(), ...GIT_ENV });

function git(dir: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", dir, ...argv], { encoding: "utf8", env: env(), stdio: "pipe" });
}

const remote = (...argv: string[]) => git(origin, ...argv);
const files = (ref: string) => remote("ls-tree", "-r", "--name-only", ref).trim().split("\n").filter(Boolean);
const show = (ref: string, rel: string) => remote("show", `${ref}:${rel}`);
const marker = (ref: string) => JSON.parse(show(ref, MARKER));
const branches = () => remote("for-each-ref", "--format=%(refname:short)", "refs/heads").trim().split("\n").filter(Boolean).sort();

/** A layout 3 org clone that also holds application code, pushed to a bare origin. */
function org(opts: { layout?: number } = {}): string {
  seedOrg({
    layout: opts.layout ?? 3,
    username: "me",
    roles: { admins: ["me"], teams: { widgets: { owners: ["owner1"] } } },
    roster: [{ username: "me", teams: ["widgets"] }],
    teams: { widgets: { "board.title": "Widgets" } },
  });
  const dir = orgDir("acme");
  for (const [rel, text] of Object.entries({
    "apps/web/index.ts": "export const web = 1;\n",
    ".gitignore": "node_modules/\n",
    ".sops.yaml": "creation_rules: []\n",
    ".claude-plugin/marketplace.json": "{}\n",
  })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: env() });
  git(dir, "remote", "add", "origin", origin);
  git(dir, "push", "-q", "origin", "main");
  return dir;
}

const run = (dir: string, admin: string, ...extra: string[]) => Bun.spawnSync(["bun", script, dir, "--admin", admin, ...extra], { env: env(), stdout: "pipe", stderr: "pipe" });
const out = (r: ReturnType<typeof run>) => r.stdout.toString();
const err = (r: ReturnType<typeof run>) => r.stderr.toString();

const state = (dir: string) => JSON.stringify({ head: git(dir, "rev-parse", "HEAD"), status: git(dir, "status", "--porcelain", "--ignored"), branches: git(dir, "branch", "--list"), worktrees: git(dir, "worktree", "list") });

const DATA_FILES = [".claude-plugin/marketplace.json", ".gitignore", ".sops.yaml", "README.md", "mattstack/mattstack.jsonc", "mattstack/org/settings.org.jsonc", "mattstack/teams/widgets/settings.team.jsonc"];

test("plan mode prints the plan and changes nothing, locally or on origin", () => {
  const dir = org();
  const before = state(dir);
  const originBefore = remote("show-ref");
  const result = run(dir, "me");
  expect(result.exitCode).toBe(0);
  expect(out(result)).toContain("mattstack");
  expect(out(result)).toContain("Nothing was written");
  expect(state(dir)).toBe(before);
  expect(remote("show-ref")).toBe(originBefore);
});

test("--write pushes a data branch of exactly the org's paths and commits the pointer to main", () => {
  const dir = org();
  const mainBefore = remote("rev-parse", "main").trim();
  const before = state(dir);
  const result = run(dir, "me", "--write");
  expect(err(result)).not.toContain("refused");
  expect(result.exitCode).toBe(0);

  expect(files("mattstack").sort()).toEqual(DATA_FILES);
  expect(marker("mattstack")).toEqual({ role: "org", org: "acme", layout: 4, dataBranch: "mattstack" });
  expect(show("mattstack", ".gitignore")).toContain("node_modules/");
  expect(show("mattstack", ".gitignore")).toContain("mattstack/org/admin-secrets/*.tmp");
  expect(show("mattstack", "README.md")).toMatch(/never merged/i);
  expect(remote("log", "--format=%s", "mattstack").trim()).toBe("org data moves to its own branch");
  expect(() => remote("merge-base", "main", "mattstack")).toThrow();

  expect(files("main").sort()).toEqual([".gitignore", "apps/web/index.ts", MARKER]);
  expect(show("main", "apps/web/index.ts")).toBe("export const web = 1;\n");
  expect(marker("main")).toEqual({ role: "org", org: "acme", layout: 4, dataBranch: "mattstack" });
  expect(remote("log", "-1", "--format=%s", "main").trim()).toBe("mattstack: org data lives on the mattstack branch");
  expect(remote("rev-parse", "main~1").trim()).toBe(mainBefore);

  expect(state(dir)).toBe(before);
  expect(git(dir, "worktree", "list").trim().split("\n")).toHaveLength(1);
  expect(readdirSync(scratch())).toEqual([]);
});

test("the forge access steps print last, in order", () => {
  const dir = org();
  const result = out(run(dir, "me", "--write"));
  const on = result.indexOf("rt team manage-membership on");
  const apply = result.indexOf("rt team forge-access --apply");
  expect(on).toBeGreaterThan(-1);
  expect(apply).toBeGreaterThan(on);
  expect(result.trimEnd().endsWith("rt team forge-access --apply")).toBe(true);
});

test("a refused push of main lands the pointer on mattstack-pointer instead", () => {
  const dir = org();
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/main ] && { echo "protected branch" >&2; exit 1; }; done\nexit 0\n');
  chmodSync(hook, 0o755);
  const mainBefore = remote("rev-parse", "main").trim();
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(0);
  expect(remote("rev-parse", "main").trim()).toBe(mainBefore);
  expect(branches()).toEqual(["main", "mattstack", "mattstack-pointer"]);
  expect(marker("mattstack-pointer")).toEqual({ role: "org", org: "acme", layout: 4, dataBranch: "mattstack" });
  expect(files("mattstack-pointer").sort()).toEqual([".gitignore", "apps/web/index.ts", MARKER]);
  expect(out(result)).toContain("mattstack-pointer");
  expect(out(result)).toMatch(/lands? it by the repo's own rules/i);
});

test("an edit made to main between the data push and the pointer is carried across", () => {
  const dir = org();
  const flag = join(home, "edited");
  const hook = join(origin, "hooks", "post-receive");
  const edit = join(home, "edit-clone");
  writeFileSync(
    hook,
    `#!/bin/sh
unset GIT_DIR
while read old new ref; do
  if [ "$ref" = refs/heads/mattstack ] && [ ! -e "${flag}" ]; then
    : > "${flag}"
    git clone -q "${origin}" "${edit}" >/dev/null 2>&1
    echo '{ "late": true }' > "${edit}/${ORG_STORE}"
    git -C "${edit}" add -A >/dev/null 2>&1
    git -C "${edit}" commit -q -m "late edit" >/dev/null 2>&1
    git -C "${edit}" push -q origin main >/dev/null 2>&1
  fi
done
exit 0
`,
  );
  chmodSync(hook, 0o755);
  const result = run(dir, "me", "--write");
  expect(err(result)).not.toContain("refused");
  expect(result.exitCode).toBe(0);
  expect(existsSync(flag)).toBe(true);
  expect(show("mattstack", ORG_STORE)).toContain("late");
  expect(remote("log", "--format=%s", "mattstack").trim().split("\n")).toEqual(["org data: carry changes made on main", "org data moves to its own branch"]);
  expect(files("main").sort()).toEqual([".gitignore", "apps/web/index.ts", MARKER]);
  expect(remote("log", "-2", "--format=%s", "main").trim().split("\n")).toEqual(["mattstack: org data lives on the mattstack branch", "late edit"]);
});

test("--no-pointer --data-branch pushes only the trial branch and leaves main alone", () => {
  const dir = org();
  const mainBefore = remote("rev-parse", "main").trim();
  const result = run(dir, "me", "--write", "--no-pointer", "--data-branch", "mattstack-trial");
  expect(result.exitCode).toBe(0);
  expect(branches()).toEqual(["main", "mattstack-trial"]);
  expect(remote("rev-parse", "main").trim()).toBe(mainBefore);
  expect(marker("mattstack-trial")).toEqual({ role: "org", org: "acme", layout: 4, dataBranch: "mattstack-trial" });
  expect(files("mattstack-trial").sort()).toEqual(DATA_FILES);
});

test("a clone already on layout 4 is refused and left alone", () => {
  const dir = org({ layout: 4 });
  const before = state(dir);
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(err(result)).toContain("not on layout 3");
  expect(state(dir)).toBe(before);
  expect(branches()).toEqual(["main"]);
});

test("a dirty clone is refused", () => {
  const dir = org();
  writeFileSync(join(dir, "apps/web/index.ts"), "changed\n");
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(err(result)).toContain("uncommitted changes");
  expect(branches()).toEqual(["main"]);
});

test("--admin naming someone the org does not list is refused", () => {
  const dir = org();
  const result = run(dir, "stranger", "--write");
  expect(result.exitCode).toBe(2);
  expect(err(result)).toContain("stranger is not an admin of this org");
  expect(branches()).toEqual(["main"]);
});

test("a data branch name origin already has is refused", () => {
  const dir = org();
  git(dir, "push", "-q", "origin", "main:refs/heads/mattstack");
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(err(result)).toContain("origin already has a branch named mattstack");
  expect(remote("rev-parse", "mattstack").trim()).toBe(remote("rev-parse", "main").trim());
});

test("a clone that differs from origin's main is refused", () => {
  const dir = org();
  writeFileSync(join(dir, "apps/web/index.ts"), "changed\n");
  git(dir, "commit", "-qam", "unpushed");
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(err(result)).toContain("does not match origin");
  expect(branches()).toEqual(["main"]);
});

test("a cone-sparse clone converts to a data branch without application code", () => {
  const dir = org();
  git(dir, "sparse-checkout", "set", "--cone", "mattstack", ".claude-plugin");
  expect(existsSync(join(dir, "apps"))).toBe(false);
  const before = state(dir);
  const result = run(dir, "me", "--write");
  expect(err(result)).not.toContain("refused");
  expect(result.exitCode).toBe(0);
  expect(files("mattstack").sort()).toEqual(DATA_FILES);
  expect(files("main").sort()).toEqual([".gitignore", "apps/web/index.ts", MARKER]);
  expect(state(dir)).toBe(before);
  expect(git(dir, "config", "--get", "core.sparseCheckout").trim()).toBe("true");
});

test("a failure mid-run still removes the temp worktrees", () => {
  const dir = org();
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\necho 'no pushes today' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const before = state(dir);
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(1);
  expect(err(result)).toContain("no pushes today");
  expect(readdirSync(scratch())).toEqual([]);
  expect(state(dir)).toBe(before);
  expect(branches()).toEqual(["main"]);
});

test("a pointer push that fails after the data branch landed says the branch exists", () => {
  const dir = org();
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do case "$ref" in refs/heads/main|refs/heads/mattstack-pointer) echo "closed" >&2; exit 1;; esac; done\nexit 0\n');
  chmodSync(hook, 0o755);
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(1);
  expect(err(result)).toContain("mattstack branch is already on origin");
  expect(err(result)).toContain("--no-pointer");
  expect(branches()).toEqual(["main", "mattstack"]);
  expect(readdirSync(scratch())).toEqual([]);
});

test("the commands a refusal or a stopped move names quote a clone path with a space", () => {
  const dir = join(home, "acme org");
  renameSync(org(), dir);
  writeFileSync(join(dir, "apps/web/index.ts"), "changed\n");
  git(dir, "commit", "-qam", "unpushed");
  const refused = run(dir, "me", "--write");
  expect(err(refused)).toContain(`git -C '${dir}' switch main`);
  git(dir, "reset", "-q", "--hard", "origin/main");
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do case "$ref" in refs/heads/main|refs/heads/mattstack-pointer) echo "closed" >&2; exit 1;; esac; done\nexit 0\n');
  chmodSync(hook, 0o755);
  const stopped = run(dir, "me", "--write");
  expect(stopped.exitCode).toBe(1);
  expect(err(stopped)).toContain(`git -C '${dir}' push origin --delete mattstack`);
});
