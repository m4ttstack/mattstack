/**
 * rt settings schema lock|diff: the lock file that pins every composite
 * key's JSON Schema. Dev-time verbs; they load zod, which the rest of rt
 * never does.
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import * as out from "../lib/ui/out.ts";
import type { CellInput, FailureInput } from "../lib/ui/out.ts";
import { buildLock, checkLockAgainst, classifyLockDiff, isMissingPathAtRef, LOCK_PATH as DEFAULT_LOCK_PATH, readBreakingChanges, type Lock } from "../lib/settings/schema-lock.ts";
import { applyDrafts, draftMigrations, MIGRATION_SCHEMAS_PATH, MIGRATIONS_INDEX_PATH, type Draft } from "../lib/settings/schema-draft.ts";
import { getDef } from "../lib/settings/registry.ts";

const LOCK_REL = "packages/rt-client/src/settings/schema.lock.json";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function settingsSchemaLock(args: string[], deps: { lockPath?: string } = {}): Promise<void> {
  const LOCK_PATH = deps.lockPath ?? DEFAULT_LOCK_PATH;
  out.payloadOnStdout();
  const target = flagValue(args, "--out") ?? LOCK_PATH;
  // A compiled rt resolves LOCK_PATH inside its own bundle (/$bunfs/...), where the lock
  // file is absent and nothing can be written; from source the committed file exists.
  if (target === LOCK_PATH && (LOCK_PATH.startsWith("/$bunfs/") || !existsSync(LOCK_PATH))) {
    out.fail({ title: "This has to run from source", why: "The compiled rt has no checkout to write the lock into.", next: out.cmd("bun run cli.ts settings schema lock") });
    process.exitCode = 1;
    return;
  }
  writeFileSync(target, `${JSON.stringify(buildLock(), null, 2)}\n`);
  out.payload(`${target}\n`);
}

type Git = (args: string[], cwd: string) => { status: number | null; stdout: string; stderr: string };
// isMissingPathAtRef matches git's English wording.
const realGit: Git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });

function parseLock(raw: string, source: string): Lock | Error {
  try {
    return JSON.parse(raw) as Lock;
  } catch (err) {
    return new Error(`${source} is not valid JSON: ${(err as Error).message}`);
  }
}

/** Only a path git confirms is absent from the ref's tree reads as `{}`; every other failure is an error. */
function lockAtRef(ref: string, repoRoot: string, git: Git): Lock | Error {
  if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repoRoot).status !== 0) return new Error(`unknown git ref ${ref} (run git fetch origin?)`);
  const show = git(["show", `${ref}:${LOCK_REL}`], repoRoot);
  if (show.status === 0) return parseLock(show.stdout, `${ref}:${LOCK_REL}`);
  if (isMissingPathAtRef(show.stderr)) return {};
  return new Error(`git show ${ref}:${LOCK_REL} failed: ${show.stderr.trim() || `exit ${show.status}`}`);
}

function lockAtPath(path: string): Lock | Error {
  if (existsSync(path)) return parseLock(readFileSync(path, "utf8"), path);
  out.print(out.line("warn", "No lock file there, so diffing against an empty lock", path));
  return {};
}

/** The highest v* tag by version sort, or null when the checkout has none. */
function latestReleaseTag(repoRoot: string, git: Git): string | null {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"], repoRoot);
  if (tags.status !== 0) return null;
  return tags.stdout.split("\n").map((t) => t.trim()).find((t) => t !== "") ?? null;
}

export async function settingsSchemaDiff(
  args: string[],
  deps: { repoRoot?: string; git?: Git; shippedLock?: Lock | null; migrationsIndexPath?: string; migrationSchemasPath?: string } = {},
): Promise<void> {
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const fail = (message: string, more: Partial<FailureInput> = {}) => {
    out.fail({ title: message, ...more });
    process.exitCode = 1;
  };
  // A compiled rt diffs its own bundled registry and has no checkout for git to read.
  if (repoRoot.startsWith("/$bunfs/")) return fail("This has to run from source", { why: "The compiled rt has no checkout to diff.", next: out.cmd("bun run cli.ts settings schema diff") });
  const against = flagValue(args, "--against");
  const againstRef = flagValue(args, "--against-ref");
  if (against !== undefined && againstRef !== undefined) return fail("Pass --against <file> or --against-ref <ref>, not both");
  const prev = against !== undefined ? lockAtPath(against) : lockAtRef(againstRef ?? "origin/main", repoRoot, deps.git ?? realGit);
  if (prev instanceof Error) return fail(prev.message);

  const next = buildLock();
  const changes = classifyLockDiff(prev, next);
  // deps.shippedLock, given, skips resolving a ref entirely: a test supplying it needs no
  // git tag/show call at all, real or faked.
  let shipped: Lock | null;
  let shippedRef: string | null;
  if (deps.shippedLock !== undefined) {
    shipped = deps.shippedLock;
    shippedRef = flagValue(args, "--shipped-ref") ?? null;
  } else {
    shippedRef = flagValue(args, "--shipped-ref") ?? latestReleaseTag(repoRoot, deps.git ?? realGit);
    shipped = null;
    if (shippedRef !== null) {
      const atRef = lockAtRef(shippedRef, repoRoot, deps.git ?? realGit);
      if (atRef instanceof Error) return fail(atRef.message);
      shipped = atRef;
    }
  }
  const { ok, problems } = checkLockAgainst(prev, next, readBreakingChanges(), { shipped, mode: "ci" });
  let drafts: Draft[] = [];
  if (args.includes("--draft")) {
    const indexPath = deps.migrationsIndexPath ?? MIGRATIONS_INDEX_PATH;
    const schemasPath = deps.migrationSchemasPath ?? MIGRATION_SCHEMAS_PATH;
    drafts = draftMigrations(prev, next, (key) => {
      const def = getDef(key);
      return def?.merge === "deep" && def.type === "object";
    });
    if (drafts.length > 0) {
      const files = applyDrafts(drafts, { index: readFileSync(indexPath, "utf8"), schemas: readFileSync(schemasPath, "utf8") });
      writeFileSync(indexPath, files.index);
      writeFileSync(schemasPath, files.schemas);
    }
  }
  if (json) {
    out.json({ ok, shipped: shippedRef, changes, problems, drafts }, 2);
  } else if (changes.length === 0) {
    out.print(out.line("done", "No schema changes"));
  } else {
    out.print(
      out.table(changes.map((c): CellInput[] => [{ text: c.kind, role: c.kind === "breaking" ? "warn" : "done" }, out.key(c.key), c.detail])),
      ...problems.map((p) => out.line("failed", p)),
      ...drafts.flatMap((d) => [
        out.line("done", `Drafted ${d.key}`, d.kind === "step" ? `migrateFrom version ${d.version}` : `renamedFrom ${d.from}`),
        ...d.notes.map((n) => out.callout("note", n)),
      ]),
      ...(drafts.length > 0 ? [out.callout("next", ["review the drafts, add real examples, set storeVersion, then run ", out.cmd("bun run cli.ts settings schema lock")])] : []),
    );
  }
  if (!ok) process.exitCode = 1;
}
