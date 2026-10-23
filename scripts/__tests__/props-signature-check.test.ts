import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { blockTreesIn } from "../ci/props-signature-check.ts";

const SCRIPT = join(import.meta.dir, "..", "ci", "props-signature-check.ts");

function write(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
}

const engine = (props: string) => `---\nname: launch\ntype: pipeline-step\n${props}---\n# launch\n`;
const child = (props: string) => `---\n${props}---\n# Quick checks\n`;

test("blockTreesIn finds engines at every depth and includes at attachments/<name>", () => {
  const root = mkdtempSync(join(tmpdir(), "props-signature-plugin-"));
  write(root, {
    "skills/launch/index.block.md": engine(""),
    "skills/helper/index.block.md": "---\nname: helper\n---\n# helper\n",
    "skills/slotted/SKILL.md": "---\nname: slotted\n---\n# slotted\n",
    "attachments/pipeline/land/index.block.md": engine(""),
    "attachments/pipeline/notes/index.block.md": "---\n---\n# notes\n",
    "attachments/ask-protocol/index.block.md": "---\n---\n# Ask\n",
  });
  expect(blockTreesIn(root)).toEqual([
    { engine: "launch", dir: join(root, "skills/launch") },
    { engine: "ask-protocol", dir: join(root, "attachments/ask-protocol") },
    { engine: "land", dir: join(root, "attachments/pipeline/land") },
  ]);
});

function gitIn(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" },
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}

function repo(tagged: Record<string, string> | null, head: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), "props-signature-repo-"));
  gitIn(cwd, "init", "-q", "-b", "main");
  gitIn(cwd, "config", "commit.gpgsign", "false");
  write(cwd, { "README.md": "x\n", ...(tagged ?? {}) });
  gitIn(cwd, "add", "-A");
  gitIn(cwd, "commit", "-q", "-m", "release");
  if (tagged !== null) gitIn(cwd, "tag", "v1.0.0");
  write(cwd, head);
  write(cwd, { "README.md": "y\n" });
  gitIn(cwd, "add", "-A");
  gitIn(cwd, "commit", "-q", "-m", "change");
  return cwd;
}

function run(cwd: string, prBody: string, event = "pull_request") {
  const env: Record<string, string | undefined> = { ...process.env, PR_BODY: prBody, GITHUB_EVENT_NAME: event };
  const r = Bun.spawnSync(["bun", SCRIPT, "--base", "HEAD^1"], { cwd, env });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const P = "plugins/mattstack/attachments/pipeline/launch";
const released = {
  [`${P}/index.block.md`]: engine(""),
  [`${P}/flow/index.block.md`]: "---\n---\n# Flow\n",
  [`${P}/flow/quick-checks.block.md`]: child('props:\n  rules: { merge: add, default: "" }\n'),
};

test("a removed prop fails the check and leaves no temp tree in the repo", () => {
  const cwd = repo(released, { [`${P}/flow/quick-checks.block.md`]: child("") });
  const r = run(cwd, "");
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("launch/flow/quick-checks.rules");
  expect(r.stderr).toContain("Edit the PR body, then push a commit");
  expect(readdirSync(cwd).sort()).toEqual([".git", "README.md", "plugins"]);
});

test("the props-change line waives it", () => {
  const cwd = repo(released, { [`${P}/flow/quick-checks.block.md`]: child("") });
  const r = run(cwd, "Drops it.\nprops-change: launch/flow/quick-checks.rules: renamed to checks\n");
  expect(r.code).toBe(0);
});

test("an engine that was not a block tree at the tag is skipped", () => {
  const cwd = repo(
    { "plugins/mattstack/attachments/pipeline/launch/SKILL.md": "---\nname: launch\ntype: pipeline-step\n---\n# launch\n" },
    { ...released, [`${P}/flow/quick-checks.block.md`]: child("props:\n  rules: { merge: add }\n") },
  );
  rmSync(join(cwd, P, "SKILL.md"));
  const r = run(cwd, "");
  expect(r.code).toBe(0);
});

test("no reachable v* tag skips", () => {
  const cwd = repo(null, released);
  const r = run(cwd, "");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("skipped");
});

test("an event that is not a pull request skips", () => {
  const cwd = repo(released, { [`${P}/flow/quick-checks.block.md`]: child("") });
  const r = run(cwd, "", "push");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("skipped");
});
