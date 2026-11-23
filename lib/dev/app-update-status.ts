/**
 * `~/.mattstack/rt/app-update.json`, which the version ping reads. On a dev
 * Mac nothing else writes it. A leaf: the daemon imports it, and nothing here
 * may pull in the CLI.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

export interface DevAutoStatus { offeredVersion: string | null; heldVersion: string | null; hold: string | null }

const FILE = "app-update.json";

/** Written through a rename, as the tray writes it, so the ping never reads half a file. */
export function writeAppUpdateStatus(rtDir: string, status: DevAutoStatus, now: Date = new Date()): void {
  const path = join(rtDir, FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ lastCheckAt: now.toISOString(), ...status }));
  renameSync(tmp, path);
}

/** The recorded hold, or null when none is recorded or the file cannot be read. */
export function readAppUpdateHold(rtDir: string): string | null {
  const path = join(rtDir, FILE);
  if (!existsSync(path)) return null;
  try {
    const hold = (JSON.parse(readFileSync(path, "utf8")) as { hold?: unknown }).hold;
    return typeof hold === "string" ? hold : null;
  } catch {
    return null;
  }
}
