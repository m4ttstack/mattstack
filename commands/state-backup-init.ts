/**
 * rt state backup init -- bootstrap encrypted state backup (R055).
 *
 *   rt state backup init
 *
 * Installs LFS in the home repo, adds the `*.age` LFS tracking rule to
 * .gitattributes, creates recipients.txt with this machine's personal age
 * key, runs the first full backup, and verifies a decrypt round-trip plus
 * the LFS filter attaching to the produced .age files. Requires
 * `rt home init` to have already run (the home repo must exist as a git
 * repo); `age`, `zstd` and `git-lfs` come from mattstack.app, or from PATH
 * on a machine running rt from source.
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { ensureAgeKey, readAgeKey, createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { recipientsPath, backupDestDir } from "../lib/state/backup-sources.ts";
import { runFullBackup } from "../lib/state/backup-orchestrator.ts";
import { restorePipelineFromStdin } from "../lib/state/backup-pipeline.ts";
import { BACKUP_TOOLS, findBackupTool } from "../lib/state/backup-tools.ts";
import { writeLfsFilterConfig } from "../lib/state/backup-lfs.ts";
import { mattstackHome } from "../lib/rt-paths.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { childEnv } from "../lib/subprocess.ts";

import * as out from "../lib/ui/out.ts";
import { createStepRunner } from "../lib/ui/steps.ts";

export async function stateBackupInit(_args: string[], _ctx: CommandContext = {}): Promise<void> {
  const resolved = new Map(BACKUP_TOOLS.map((name) => [name, findBackupTool(name)]));
  const absent = BACKUP_TOOLS.filter((name) => !resolved.get(name));
  if (absent.length > 0) {
    out.fail({ title: `rt cannot find ${absent.join(", ")}`, why: "They ship inside mattstack.app.", next: out.cmd(`brew install ${absent.join(" ")}`) });
    process.exit(1);
  }
  const gitLfs = resolved.get("git-lfs")!;
  const homeRepo = join(mattstackHome(), "user");
  if (!existsSync(join(homeRepo, ".git"))) {
    out.fail({ title: "Your home repo is not set up yet", next: out.cmd("rt home init") });
    process.exit(1);
  }
  const steps = createStepRunner();
  async function stage<T>(pending: string, done: string | ((value: T) => string), failure: string, task: () => Promise<T>, hint?: (value: T) => string | undefined): Promise<T> {
    const opts = { done: typeof done === "string" ? done : pending, doneHint: undefined as string | undefined, error: failure, errorHint: undefined as string | undefined };
    try {
      return await steps.run(pending, async () => {
        try {
          const value = await task();
          opts.done = typeof done === "string" ? done : done(value);
          opts.doneHint = hint?.(value);
          return value;
        } catch (err) {
          opts.errorHint = (err instanceof Error ? err.message : String(err)).split("\n")[0];
          throw err;
        }
      }, opts);
    } catch (err) {
      out.fail({ title: failure }, out.verbatim((err instanceof Error ? err.message : String(err)).split("\n"), "what failed"));
      process.exit(1);
    }
  }
  await stage("Checking the backup tools", "age, zstd and git-lfs are here", "The backup tools could not be checked", async () => {});
  await stage("Setting up Git LFS in your home repo", "Git LFS is set up", "Git LFS did not install in your home repo", async () => {
    // Invoke the resolved binary because git's subcommand lookup only uses PATH.
    const installed = Bun.spawnSync([gitLfs, "install", "--local"], { cwd: homeRepo, env: { ...process.env } });
    if (installed.exitCode !== 0) throw new Error(installed.stderr.toString());
    writeLfsFilterConfig(homeRepo, gitLfs);
    const attrs = join(homeRepo, ".gitattributes");
    const existing = existsSync(attrs) ? readFileSync(attrs, "utf-8") : "";
    if (!existing.includes("*.age filter=lfs")) writeFileSync(attrs, existing + "*.age filter=lfs diff=lfs merge=lfs -text\n");
  }, () => "now tracks encrypted backups");
  const seams = await stage("Adding this Mac's key", "This Mac can decrypt your backups", "This Mac's key could not be added", async () => {
    const seam = createRealAgeKeySeam();
    const { publicKey } = await ensureAgeKey(seam);
    mkdirSync(backupDestDir(), { recursive: true });
    const recip = recipientsPath();
    const content = existsSync(recip) ? readFileSync(recip, "utf-8") : "";
    if (!content.includes(publicKey)) writeFileSync(recip, content.trimEnd() + (content ? "\n" : "") + publicKey + "\n");
    return seam;
  });
  const result = await stage("Backing up for the first time", result => `Backed up ${result.backed.length} source(s)`, "The first backup did not finish", async () => {
    const result = await runFullBackup();
    if (result.errors.length) throw new Error(result.errors.join("\n"));
    return result;
  }, result => `${result.backed.map(b => `${b.app}: ${b.sizeBytes < 1048576 ? `${Math.round(b.sizeBytes / 1024)} KB` : `${(b.sizeBytes / 1048576).toFixed(1)} MB`}`).join(", ")}`);
  await stage("Checking a backup can be decrypted", () => result.backed.length ? "A backup decrypts" : "No backup to check yet", "A backup could not be decrypted", async () => {
    const first = result.backed[0];
    if (!first) return;
    const verifyDir = await mkdtemp(join(tmpdir(), "backup-verify-"));
    try {
      const key = await readAgeKey(seams);
      if (!("key" in key)) throw new Error("This Mac has no key to decrypt your backups");
      await restorePipelineFromStdin(first.path, join(verifyDir, "verify.db"), key.key);
    } finally { rmSync(verifyDir, { recursive: true, force: true }); }
  }, () => result.backed.length ? undefined : "nothing to check yet");
  const confirmed = await stage("Checking Git LFS took the backup", confirmed => confirmed ? "Git LFS stores the encrypted files" : "Finished checking Git LFS", "Git LFS could not be checked", async () => {
    const first = result.backed[0];
    if (!first) return false;
    const checked = Bun.spawnSync(["git", "check-attr", "filter", "--", first.path], { cwd: homeRepo, env: childEnv() });
    return checked.exitCode === 0 && checked.stdout.toString().includes("filter: lfs");
  }, confirmed => confirmed ? undefined : "not confirmed yet");
  if (!confirmed) out.print(out.line("warn", "Git LFS has not taken the encrypted files yet"), out.callout("next", out.cmd("rt state backup status")));
  out.print(out.summary("done", "Encrypted backup is set up", ["the daemon backs up every 4 hours"]));
}
