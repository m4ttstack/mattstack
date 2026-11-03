/**
 * The one `rt setup apply` behind the app's progress bar. It holds the run
 * lock, appends every event it streams to the events file and records each
 * finished step in setup state, so an app relaunched mid-run attaches to a
 * run that is still going and resumes one that died.
 */

import { dirname, join } from "path";
import type { ApplyEvent, StepId } from "./contract.ts";
import type { Emit } from "./emit.ts";
import type { Probes } from "./probes.ts";
import { setupStatePath, type SetupRun } from "./state.ts";

/** A pid can be reused after its run died, so age is the second proof of a stale lock. A run takes about ten minutes. */
export const APPLY_RUN_LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const ATTACH_POLL_MS = 250;

type DoneEvent = Extract<ApplyEvent, { event: "done" }>;

export function applyRunLockPath(home: string): string {
  return join(home, ".mattstack", "rt", "setup-apply.lock");
}

export function applyEventsPath(home: string): string {
  return join(home, ".mattstack", "rt", "setup-run.ndjson");
}

/** Appends each event to the events file as one line, then forwards it. A forward that throws (the app quit and its pipe closed) never ends the run. */
export function recordingEmit(p: Probes, inner: Emit, opts: { truncate: boolean }): Emit {
  const path = applyEventsPath(p.home);
  let recording = true;
  try {
    p.mkdirp(dirname(path));
    if (opts.truncate) p.writeFile(path, "");
  } catch {
    // A file this run could not empty would hand an attach the last run's events as this one's.
    recording = false;
  }
  return (ev) => {
    if (recording) {
      try {
        p.appendFile(path, `${JSON.stringify(ev)}\n`);
      } catch {
        // The stream still reaches the app; only a relaunch would miss this event.
      }
    }
    try {
      inner(ev);
    } catch {
      // The run goes on for the next app to attach to.
    }
  };
}

/** The first applicable step a run that died partway had not finished. */
export function resumePoint(run: SetupRun | undefined, applicable: StepId[]): StepId | undefined {
  if (run === undefined || run.endedAt !== undefined) return undefined;
  return applicable.find((id) => !run.done.includes(id));
}

function parseEvents(text: string): ApplyEvent[] {
  const events: ApplyEvent[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    try {
      events.push(JSON.parse(line) as ApplyEvent);
    } catch {
      continue;
    }
  }
  return events;
}

/** A need with a later event for its id was answered while nobody was attached; performing it again would repeat the work. */
function answeredLater(batch: ApplyEvent[], at: number): boolean {
  const need = batch[at]!;
  if (need.event !== "need") return false;
  return batch.slice(at + 1).some((ev) => "id" in ev && ev.id === need.id);
}

function readRun(p: Pick<Probes, "readFile" | "home">): SetupRun | undefined {
  const raw = p.readFile(setupStatePath(p.home));
  if (raw === null) return undefined;
  try {
    return (JSON.parse(raw) as { run?: SetupRun }).run;
  } catch {
    return undefined;
  }
}

/**
 * The holder writes its record's end, lets go of the lock, and only then
 * appends `done`, so a free lock can come a moment before the `done`. Before
 * its `plan` the holder may not have written its record's start, and the
 * record could still be the last run's.
 */
function doneAfterHolder(p: Pick<Probes, "readFile" | "home">, sawPlan: boolean): DoneEvent {
  const run = sawPlan ? readRun(p) : undefined;
  if (run?.endedAt === undefined) return { event: "done", ok: false };
  return { event: "done", ok: run.ok === true, ...(run.failed ? { failedStep: run.failed.step } : {}) };
}

/** Replays the events file, then follows it until a `done`. A holder that dies first ends the attach failed. */
export async function attachToRun(
  p: Pick<Probes, "readFile" | "home">,
  out: (event: ApplyEvent) => void,
  opts: { holderAlive: () => boolean; sleep?: (ms: number) => Promise<void>; pollMs?: number },
): Promise<{ ok: boolean }> {
  const path = applyEventsPath(p.home);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let read = 0;
  let sawPlan = false;
  for (;;) {
    // Liveness before the file: whatever a dead holder wrote is in the read that follows.
    const alive = opts.holderAlive();
    const text = p.readFile(path) ?? "";
    // A new run emptied the file: follow it from its start.
    if (text.length < read) read = 0;
    const end = text.lastIndexOf("\n") + 1;
    if (end > read) {
      const batch = parseEvents(text.slice(read, end));
      read = end;
      for (const [at, ev] of batch.entries()) {
        if (ev.event === "plan") sawPlan = true;
        if (answeredLater(batch, at)) continue;
        out(ev);
        if (ev.event === "done") return { ok: ev.ok };
      }
    }
    if (!alive) {
      const done = doneAfterHolder(p, sawPlan);
      out(done);
      return { ok: done.ok };
    }
    await sleep(opts.pollMs ?? ATTACH_POLL_MS);
  }
}
