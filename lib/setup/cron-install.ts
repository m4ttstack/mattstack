/**
 * Writes/removes a daemon cron trigger in the rt.cron machine setting — used
 * by `rt cron install`/`rt cron remove` and the apply engine's cron.triage
 * step.
 */

import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";

export interface CronTrigger {
  name: string;
  event: string;
  run: string[];
  tool?: string;
  repoName?: string;
  debounceMs?: number;
}

export interface TriageTrigger extends CronTrigger {
  name: "board-triage";
  event: "project-mrs";
  tool: "board";
  debounceMs: 5000;
}

/** The daemon resolves `tool` from the running app at fire time, so switching apps never strands the trigger. */
export function triageTrigger(): TriageTrigger {
  return { name: "board-triage", event: "project-mrs", tool: "board", run: ["triage"], debounceMs: 5000 };
}

export interface PeerTrigger extends CronTrigger {
  name: "board-peer";
  event: "peer-inbox";
  tool: "board";
  debounceMs: 300;
}

export function peerTrigger(): PeerTrigger {
  return { name: "board-peer", event: "peer-inbox", tool: "board", run: ["triage", "--peer"], debounceMs: 300 };
}

export interface InstallCronTriggerDeps {
  getSetting: typeof getSetting;
  setSetting: typeof setSetting;
}

function realInstallCronTriggerDeps(): InstallCronTriggerDeps {
  return { getSetting, setSetting };
}

type CronConfigValue = { triggers?: CronTrigger[] };

// rt.cron's registry def scopes to ["machine"] only, with no repoScoped
// sharding — getSetting("rt.cron") therefore reads exactly the one machine
// store file, the same physical source a raw machine-only read would use.
// Unlike rt.repoTracking (which loadRepoTracking() folds with a SEPARATE
// team-declared key), there is no second source rt.cron could be merging in.
function readTriggers(getter: typeof getSetting): CronTrigger[] {
  return getter<CronConfigValue>("rt.cron", { expand: false }).value?.triggers ?? [];
}

/** Replaces any existing trigger of the same name and writes the whole list back to the machine store. */
export function installCronTrigger(
  trigger: CronTrigger,
  deps: InstallCronTriggerDeps = realInstallCronTriggerDeps(),
): { written: true } {
  const triggers = readTriggers(deps.getSetting).filter((t) => t.name !== trigger.name);
  triggers.push(trigger);
  deps.setSetting("rt.cron", { triggers }, "machine");
  return { written: true };
}

/** Drops a trigger by name; a no-op (still `written:true`) when it wasn't installed. */
export function removeCronTrigger(
  name: string,
  deps: InstallCronTriggerDeps = realInstallCronTriggerDeps(),
): { written: true; removed: boolean } {
  const before = readTriggers(deps.getSetting);
  const triggers = before.filter((t) => t.name !== name);
  deps.setSetting("rt.cron", { triggers }, "machine");
  return { written: true, removed: triggers.length !== before.length };
}
