import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { peerTrigger, triageTrigger, type CronTrigger } from "../cron-install.ts";
import type { MigrationDef } from "./index.ts";

const TOOL_FORM: Record<string, CronTrigger> = {
  "board-triage": triageTrigger(),
  "board-peer": peerTrigger(),
};

function sameArgs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((arg, i) => arg === b[i]);
}

/** Keeps each trigger's own event and debounce, so a hand-tuned schedule survives the move. */
function toToolForm(trigger: CronTrigger): CronTrigger | null {
  const target = TOOL_FORM[trigger.name];
  if (!target) return null;
  if (trigger.tool === target.tool && sameArgs(trigger.run, target.run)) return null;
  const moved: CronTrigger = { name: trigger.name, event: trigger.event, tool: target.tool, run: [...target.run] };
  if (trigger.debounceMs !== undefined) moved.debounceMs = trigger.debounceMs;
  return moved;
}

export const boardCronByToolMigration: MigrationDef = {
  id: "2026-10-10-board-cron-by-tool",
  title: "Run the board's schedules from the app that is running",
  async run() {
    const triggers = getSetting<{ triggers?: CronTrigger[] }>("rt.cron", { expand: false }).value?.triggers ?? [];
    let changed = false;
    const next = triggers.map((trigger) => {
      const moved = toToolForm(trigger);
      if (!moved) return trigger;
      changed = true;
      return moved;
    });
    if (!changed) return { state: "skipped", detail: "There were no board schedules to move" };
    setSetting("rt.cron", { triggers: next }, "machine");
    return { state: "done", detail: "The board's schedules now run the board in the app that is running" };
  },
};
