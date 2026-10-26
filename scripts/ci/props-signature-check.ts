import { existsSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isBlockTree, loadBlockTree } from "../../lib/skills/blocks/tree.ts";
import { breakingChanges, checkPropsSignature, signatureOf } from "../../lib/skills/blocks/signature.ts";
import { childEnv } from "../../lib/subprocess.ts";

const PLUGIN = "plugins/mattstack";
const ROOTS = ["attachments", "skills"];

function dirsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function isEngine(dir: string, name: string): boolean {
  return loadBlockTree(dir, { idPrefix: name, relRoot: name }).root.frontmatter.type === "pipeline-step";
}

/** Engines sit at skills/<name>, attachments/<name> or attachments/<group>/<name>; an include is any block tree at attachments/<name>. */
export function blockTreesIn(pluginDir: string): { engine: string; dir: string }[] {
  const out: { engine: string; dir: string }[] = [];
  for (const name of dirsIn(join(pluginDir, "skills"))) {
    const dir = join(pluginDir, "skills", name);
    if (isBlockTree(dir) && isEngine(dir, name)) out.push({ engine: name, dir });
  }
  for (const name of dirsIn(join(pluginDir, "attachments"))) {
    const dir = join(pluginDir, "attachments", name);
    if (isBlockTree(dir)) {
      out.push({ engine: name, dir });
      continue;
    }
    for (const inner of dirsIn(dir)) {
      const innerDir = join(dir, inner);
      if (isBlockTree(innerDir) && isEngine(innerDir, inner)) out.push({ engine: inner, dir: innerDir });
    }
  }
  return out;
}

function git(args: string[]) {
  return Bun.spawnSync(["git", ...args], { env: childEnv() });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The tag's trees unpack into `tmp`; returns the exit code, so the caller removes `tmp` on every path. */
function compareAgainstTag(tag: string, tmp: string): number {
  const listed = git(["ls-tree", "--name-only", tag, `${PLUGIN}/`]);
  const present = new Set(listed.stdout.toString().split("\n").filter(Boolean));
  const paths = ROOTS.map((r) => `${PLUGIN}/${r}`).filter((p) => present.has(p));
  if (paths.length > 0) {
    const tar = join(tmp, "tree.tar");
    const archive = git(["archive", "--format=tar", "-o", tar, tag, "--", ...paths]);
    if (archive.exitCode !== 0) {
      console.error(`git archive ${tag} failed: ${archive.stderr.toString().trim()}`);
      return 2;
    }
    const untar = Bun.spawnSync(["tar", "-xf", tar, "-C", tmp], { env: childEnv() });
    if (untar.exitCode !== 0) {
      console.error(`Unpacking ${tag}'s plugin trees failed: ${untar.stderr.toString().trim()}`);
      return 2;
    }
  }
  // A released tree today's loader refuses has no signature to compare against, and no PR can change the tag.
  let before;
  try {
    before = signatureOf(blockTreesIn(join(tmp, PLUGIN)));
  } catch (err) {
    console.log(`Props signature check skipped: ${tag}'s block trees do not load today: ${errorText(err)}`);
    return 0;
  }
  let after;
  try {
    after = signatureOf(blockTreesIn(PLUGIN));
  } catch (err) {
    console.error(`A block tree failed to load, so its props cannot be compared: ${errorText(err)}`);
    return 2;
  }
  const errors = checkPropsSignature({ changes: breakingChanges(before, after), prBody: process.env.PR_BODY ?? "" });
  for (const e of errors) console.error(e);
  if (errors.length === 0) console.log(`Props signature matches ${tag}, or every change is waived.`);
  return errors.length ? 1 : 0;
}

function main(): number {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event !== undefined && event !== "pull_request") {
    console.log(`Props signature check skipped: the ${event} event has no PR body to read waivers from.`);
    return 0;
  }
  const i = process.argv.indexOf("--base");
  const base = (i === -1 ? undefined : process.argv[i + 1]) ?? "HEAD^1";
  const describe = git(["describe", "--tags", "--abbrev=0", "--match", "v*", base]);
  if (describe.exitCode !== 0) {
    console.log(`Props signature check skipped: no v* release tag is reachable from ${base}.`);
    return 0;
  }
  const tag = describe.stdout.toString().trim();
  const tmp = mkdtempSync(join(tmpdir(), "props-signature-"));
  try {
    return compareAgainstTag(tag, tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(main());
