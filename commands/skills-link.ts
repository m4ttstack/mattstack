/**
 * rt skills link -- reconcile agent-skill symlinks for the current repo.
 *
 * Links every `skills/<dir>/SKILL.md` in the repo you run it from into
 * ~/.claude/skills/<frontmatter name>, replacing the estate's hand-managed
 * symlink convention with a verb. Creates missing links, repoints links whose
 * target moved inside the repo, prunes links whose target is gone, and
 * reports (never touches) names owned by anything outside this repo.
 *
 * `--from <dir>` names the source directory instead of deriving it from a
 * checkout, so the mattstack installer can link an app's skills out of the
 * .app bundle, where no repo exists.
 */

import { execFileSync } from "child_process";
import { existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { pruneLinksFrom, readSkillsIgnore, reconcileSkillLinks, type LinkAction, type ReconcileResult } from "../lib/skills/link.ts";
import { envelope } from "../lib/setup/contract.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";

function fail(title: string, next?: string): never {
  out.fail({ title, ...(next ? { next: out.cmd(next) } : {}) });
  process.exit(1);
}

const ROW: Record<LinkAction["kind"], { status: RenderStatus; done: string; would: string }> = {
  create: { status: "done", done: "linked", would: "would link" },
  ok: { status: "done", done: "already linked", would: "already linked" },
  relink: { status: "done", done: "relinked", would: "would relink" },
  prune: { status: "off", done: "link removed", would: "would remove the link" },
  conflict: { status: "needs-you", done: "left alone", would: "left alone" },
  skip: { status: "skipped", done: "not linked", would: "not linked" },
};

/** The skills source: `--from` verbatim when given, else `<repo root>/skills`. */
export function resolveSkillsDir(opts: {
  from?: string;
  repoRoot: () => string | null;
}): { dir: string } | { error: string; next?: string } {
  if (opts.from !== undefined) {
    const dir = resolve(opts.from);
    if (!existsSync(dir)) return { error: `${dir} does not exist` };
    if (!statSync(dir).isDirectory()) return { error: `${dir} is not a directory` };
    return { dir };
  }
  const root = opts.repoRoot();
  if (root === null) {
    return { error: "You are not inside a git repo", next: "rt skills link --from <folder>" };
  }
  const dir = join(root, "skills");
  if (!existsSync(dir)) return { error: `This repo has no skills folder (${dir})` };
  return { dir };
}

function gitRepoRoot(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export async function skillsLink(args: string[]): Promise<void> {
  let dryRun = false;
  let json = false;
  let from: string | undefined;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run": dryRun = true; break;
      case "--json": json = true; break;
      case "--from": {
        const value = args[++i];
        if (value === undefined) fail("--from needs a folder");
        from = value;
        break;
      }
      default: fail(`rt skills link does not take ${args[i]}`);
    }
  }

  const claudeSkillsDir = join(process.env.HOME ?? "", ".claude", "skills");
  const source = resolveSkillsDir({ from, repoRoot: gitRepoRoot });

  if ("error" in source) {
    // A --from that has vanished is the uninstall case, not a bad argument:
    // drop the links that pointed into it. With none to drop it IS a bad
    // argument (a typo), so the original error still stands.
    if (from !== undefined) {
      const gone = pruneLinksFrom({ skillsDir: resolve(from), claudeSkillsDir, dryRun });
      if (gone.actions.length > 0) {
        report(resolve(from), claudeSkillsDir, gone, dryRun, json);
        return;
      }
    }
    fail(source.error, source.next);
  }

  // `.skillsignore` names skills the source declines to DISTRIBUTE, so it
  // binds the bundle path (--from) and not a checkout: in this estate a user
  // never has a checkout, so linking from a repo is the author linking their
  // own work, author-only skills included.
  const ignore = from === undefined ? [] : readSkillsIgnore(source.dir);

  report(source.dir, claudeSkillsDir, reconcileSkillLinks({ skillsDir: source.dir, claudeSkillsDir, dryRun, ignore }), dryRun, json);
}

export function linkBlocks(skillsDir: string, claudeSkillsDir: string, result: ReconcileResult, dryRun: boolean): Block[] {
  const changes = new Set<LinkAction["kind"]>(["create", "relink", "prune"]);
  const rows = result.actions.map((a) => {
    const word = dryRun ? ROW[a.kind].would : ROW[a.kind].done;
    return out.line(dryRun && changes.has(a.kind) ? "pending" : ROW[a.kind].status, a.name, a.detail ? `${word}: ${a.detail}` : word);
  });
  const conflicts = result.actions.filter((a) => a.kind === "conflict").length;
  return [
    out.section("Skill links", dryRun ? "dry run" : undefined, out.kv("From", skillsDir), out.kv("To", claudeSkillsDir), ...rows),
    ...(conflicts > 0 ? [out.callout("note", "rt never removes a link it did not make. Sort these out by hand.")] : []),
    ...(!result.changed && conflicts === 0 ? [out.summary("done", "Everything is already linked")] : []),
  ];
}

function report(skillsDir: string, claudeSkillsDir: string, result: ReconcileResult, dryRun: boolean, json: boolean): void {
  if (json) {
    out.json(envelope({ ok: true, dryRun, skillsDir, claudeSkillsDir, changed: result.changed, actions: result.actions }));
    return;
  }
  out.print(...linkBlocks(skillsDir, claudeSkillsDir, result, dryRun));
}
