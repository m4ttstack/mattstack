/** Commands a restart would cut off for longer than the 5s drain. */
export const LONG_COMMANDS: ReadonlySet<string> = new Set([
  "worktree:provision",
  "worktree:create",
  "worktree:stop-holders",
  "worktree:sync",
  "worktree:push-branch",
  "worktree:triage-dispose",
  "mr:action",
  "mr:fetch-job-trace",
  "mr:upload",
  "mr:describe-with-attachments",
  "mr:attach-upload",
]);

export interface BusyTracker {
  /** Called for every command; returns the function to call when it ends. A command not in LONG_COMMANDS is not counted. */
  begin(cmd: string): () => void;
  /** Long commands in flight, sorted, de-duplicated. */
  running(): string[];
}

const noop = (): void => {};

export function createBusyTracker(): BusyTracker {
  const counts = new Map<string, number>();
  return {
    begin(cmd) {
      if (!LONG_COMMANDS.has(cmd)) return noop;
      counts.set(cmd, (counts.get(cmd) ?? 0) + 1);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        const left = (counts.get(cmd) ?? 1) - 1;
        if (left > 0) counts.set(cmd, left);
        else counts.delete(cmd);
      };
    },
    running: () => [...counts.keys()].sort(),
  };
}

export interface BusyProbes {
  tracker: BusyTracker;
  pendingReady(): number;
  creating(): boolean;
}

export function busyReasons(p: BusyProbes): string[] {
  const reasons = p.tracker.running().map((cmd) => `command:${cmd}`);
  if (p.pendingReady() > 0) reasons.push("worktree-install");
  if (p.creating()) reasons.push("worktree-create");
  return reasons;
}
