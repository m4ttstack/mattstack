/**
 * `claude.permissions` unions rt's baseline `permissions.allow` entries
 * (`base-permissions.ts`) into Claude Code's settings.json for every
 * configured Claude config dir (`claudeConfigDirs`, the same enumeration
 * `plugins.install` uses), so a freshly set up machine's agents don't stall
 * on permission prompts for the calls Install already trusts.
 *
 * File handling mirrors `linear.mcp`: absent starts from an empty object,
 * unparsable and unreadable both fail with a remedy naming the path, and
 * every other top-level key (and every other key under `permissions`)
 * survives the write untouched. It differs from `linear.mcp` in the two
 * ways `claude-permissions.ts`'s header explains: one union per config dir,
 * and the file's existing mode is preserved rather than tightened to 0600.
 */
import { join } from "path";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import { missingCrossSessionInbound, missingDefaultMode, missingPermissions, readClaudeSettings, withPermissions, writeClaudeSettings } from "../claude-permissions.ts";
import type { Probes } from "../probes.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { claudeConfigDirs } from "../tools-install.ts";
import { toFailedOutcome } from "./step-utils.ts";

/** Pane automation is built against Claude Code's fullscreen mode, where the input docks to the bottom row. */
const SEEDED_TUI = "fullscreen";

export interface DirPermissionsOutcome {
  path: string;
  wrote: boolean;
  /** True when this call added `tui` to the file. */
  seededTui?: boolean;
  failed?: { detail: string; remedy: string };
}

/** One config dir's worth of read -> union -> write, exported so multi-dir behavior is testable without an ApplyContext. */
export function applyBaselinePermissions(
  p: Pick<Probes, "readFile" | "exists" | "mkdirp" | "writeFile" | "rename" | "chmod" | "removeFile" | "fileMode" | "readlink">,
  dir: string,
  seedTui = true,
): DirPermissionsOutcome {
  const path = join(dir, "settings.json");
  const read = readClaudeSettings(p, path);
  if (!read.ok && read.reason === "unparsable") {
    return { path, wrote: false, failed: { detail: `${path} is not valid JSON`, remedy: "Fix or remove that file, then Retry." } };
  }
  if (!read.ok && read.reason === "unreadable") {
    return { path, wrote: false, failed: { detail: `Could not read ${path}`, remedy: "Check that file's permissions, then Retry." } };
  }
  // Only `absent` may reach the empty settings: every other reason means a
  // file is there, and the write below replaces whatever is at the path.
  const settings = read.ok ? read.settings : {};
  const toAdd = missingPermissions(settings);
  const seededTui = seedTui && settings.tui === undefined;
  if (toAdd.length === 0 && !missingDefaultMode(settings) && !missingCrossSessionInbound(settings) && !seededTui) return { path, wrote: false };

  const next = withPermissions(settings, toAdd);
  writeClaudeSettings(p, path, seededTui ? { ...next, tui: SEEDED_TUI } : next);
  return { path, wrote: true, seededTui };
}

async function claudePermissionsRun(ctx: ApplyContext): Promise<StepOutcome> {
  const written: string[] = [];
  const fullscreen: string[] = [];
  // An update run never re-seeds a dir rt already set: the key being gone
  // then means the member removed it.
  const alreadySeeded = ctx.update ? new Set(readSetupState(ctx.p).claudeFullscreenDirs) : new Set<string>();

  for (const dir of claudeConfigDirs(ctx.p, [])) {
    const outcome = applyBaselinePermissions(ctx.p, dir, !alreadySeeded.has(dir));
    if (outcome.failed) return { state: "failed", detail: outcome.failed.detail, remedy: outcome.failed.remedy };
    if (outcome.wrote) written.push(outcome.path);
    if (outcome.seededTui) fullscreen.push(dir);
  }

  if (fullscreen.length > 0) {
    updateSetupState(ctx.p, (s) => ({ ...s, claudeFullscreenDirs: [...s.claudeFullscreenDirs, ...fullscreen] }));
  }
  if (written.length === 0) return { state: "skipped", detail: "Baseline permissions already present" };
  ctx.log("claude.permissions", `added baseline permissions to ${written.join(", ")}`);
  const folders = `${written.length} Claude config folder${written.length === 1 ? "" : "s"}`;
  const detail = `Added baseline permissions to ${folders}`;
  if (fullscreen.length === 0) return { state: "done", detail };
  return { state: "done", detail: `${detail} and set Claude Code to fullscreen. To change it back, set "tui" in settings.json to "default".` };
}

export async function installClaudePermissions(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await claudePermissionsRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const claudePermissionsStep: StepDef = {
  id: "claude.permissions",
  title: "Seed baseline Claude permissions",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: installClaudePermissions,
};
