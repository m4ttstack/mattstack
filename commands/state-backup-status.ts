import * as out from "../lib/ui/out.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { mattstackHome } from "../lib/rt-paths.ts";
import { isBackupConfigured } from "../lib/state/backup-orchestrator.ts";
import { backupDestDir, recipientsPath } from "../lib/state/backup-sources.ts";
import { findBackupTool } from "../lib/state/backup-tools.ts";
import { originPushState } from "../lib/setup/home-git.ts";
import { execWithTimeout } from "../lib/setup/probes.ts";
import type { CommandContext } from "../lib/command-tree.ts";

const PUSH_WORDS: Record<string, string> = { synced: "up to date", "no remote tracking ref": "no remote", unknown: "unknown" };
const LFS_WORDS: Record<string, string> = { "filter active": "on", "filter not configured": "off", "git-lfs not found": "not installed", unknown: "unknown" };

function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function stateBackupStatus(args: string[], _ctx: CommandContext): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();

  if (!isBackupConfigured()) {
    if (json) out.json({ configured: false });
    else out.print(out.line("off", "Encrypted backup is not set up"), out.callout("next", out.cmd("rt state backup init")));
    return;
  }

  const recip = readFileSync(recipientsPath(), "utf-8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"));

  const baseDir = backupDestDir();
  const apps = ["rt", "board", "gitq"];
  const status: Array<{ app: string; lastBackup: string | null; count: number; totalBytes: number }> = [];

  for (const app of apps) {
    const appDir = join(baseDir, app);
    if (!existsSync(appDir)) {
      status.push({ app, lastBackup: null, count: 0, totalBytes: 0 });
      continue;
    }

    const files = readdirSync(appDir)
      .filter((f) => f.endsWith(".zst.age"))
      .sort()
      .reverse();

    let totalBytes = 0;
    for (const f of files) {
      totalBytes += statSync(join(appDir, f)).size;
    }

    status.push({
      app,
      lastBackup: files[0] ?? null,
      count: files.length,
      totalBytes,
    });
  }

  if (json) {
    out.json({ configured: true, recipients: recip.length, apps: status });
    return;
  }

  const homeRepo = join(mattstackHome(), "user");
  let pushState = "unknown";
  let lfsState = "unknown";

  if (existsSync(join(homeRepo, ".git"))) {
    const ps = await originPushState(execWithTimeout, homeRepo);
    switch (ps.kind) {
      case "up-to-date": pushState = "synced"; break;
      case "ahead": pushState = `${ps.count} commit(s) ahead`; break;
      case "no-ref": pushState = "no remote tracking ref"; break;
      default: pushState = "unknown";
    }

    const gitLfs = findBackupTool("git-lfs");
    if (!gitLfs) {
      lfsState = "git-lfs not found";
    } else {
      const checkAttr = Bun.spawnSync(
        ["git", "check-attr", "filter", "--", "*.age"],
        { cwd: homeRepo, stderr: "pipe", env: { ...process.env } },
      );
      const attrOut = checkAttr.stdout.toString();
      lfsState = attrOut.includes("filter: lfs") ? "filter active" : "filter not configured";
    }
  }

  const pushed = /^(\d+) commit\(s\) ahead$/.exec(pushState);
  out.print(
    out.line("done", "Encrypted backup is set up", `${recip.length} ${recip.length === 1 ? "key" : "keys"} can decrypt it`),
    out.kv("backups", "every 4 hours"),
    out.kv("pushed", pushed ? `${pushed[1]} not pushed yet` : (PUSH_WORDS[pushState] ?? pushState)),
    out.kv("Git LFS", LFS_WORDS[lfsState] ?? lfsState),
    out.table(status.map((s) => s.lastBackup
      ? [out.strong(s.app), `${s.count} backup${s.count === 1 ? "" : "s"}`, formatBytes(s.totalBytes), out.dim(`latest ${s.lastBackup}`)]
      : [out.strong(s.app), out.dim("no backups")])),
  );
}
