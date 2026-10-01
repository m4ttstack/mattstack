/**
 * How a setup run reaches a person. The NDJSON stream is the app's contract
 * and goes through each verb's json seam; this emitter turns the same events
 * into rt-ui steps with titles, not ids. A helper that is missing or dies
 * never costs the person a line: the plain path prints the same words.
 */
import { interactive } from "../ui/gate.ts";
import * as out from "../ui/out.ts";
import type { Block, RenderStatus } from "../ui/protocol.ts";
import { openStep, type StepHandle } from "../ui/spawn.ts";
import type { ApplyEvent, EventId, StepState } from "./contract.ts";

export type Emit = (ev: ApplyEvent) => void;

export interface StepEmitterLabels {
  done: string;
  needsYou: string;
  failed: string;
}

export interface StepEmitterOptions {
  labels: StepEmitterLabels;
  /** Every streamed line, so the log keeps what the screen erases. */
  log: (id: EventId, line: string) => void;
  /** Whether rt-ui may draw the steps; defaults to the stdin gate. */
  interactive?: boolean;
}

export interface StepEmitter {
  emit: Emit;
  /** A settings tip raised while `id` ran; drawn as a tip callout under its step. */
  tip(id: EventId, line: string): void;
  /** Resolves once every step line and the summary are drawn. Await it before exiting. */
  flush(): Promise<void>;
}

type FinalState = Exclude<StepState, "pending" | "running">;
type StepEvent = Extract<ApplyEvent, { event: "step" }>;
type DoneEvent = Extract<ApplyEvent, { event: "done" }>;

interface Running {
  id: EventId;
  title: string;
  handle: StepHandle | null;
  subs: string[];
  tips: string[];
}

const FINAL_STATUS: Record<Exclude<FinalState, "failed">, Exclude<RenderStatus, "failed">> = {
  done: "done",
  skipped: "skipped",
  "needs-you": "needs-you",
  partial: "warn",
};

const SKIPPED_RUN: Record<NonNullable<DoneEvent["skipped"]>, string> = {
  "not-set-up": "Setup has not finished on this Mac yet",
  current: "Nothing to update",
  running: "Another update is already running",
};

const WAITING_FOR_APP = "Waiting for mattstack.app to finish this step";
const SUB_LINES_KEPT = 5;

// The helper paints a step's title and hint as given, so a child's escape or newline must be gone before it gets there.
const ESCAPES = /[\x1b]\[[0-9;?]*[ -/]*[@-~]|[\x1b]\][^\x07\x1b\n]*(?:\x07|[\x1b]\\)|[\x1b][@-Z\\-_]/g;
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

function oneLine(s: string): string {
  return s.replace(ESCAPES, "").replace(/[\r\n\t]+/g, " ").replace(CONTROLS, "");
}

// The helper only narrates a step; one that cannot start leaves the run on the plain path.
function tryOpenStep(title: string): StepHandle | null {
  try {
    return openStep(title);
  } catch {
    return null;
  }
}

interface Tally {
  done: number;
  skipped: number;
  needsYou: number;
  partial: number;
  failed: number;
}

function countsOf(t: Tally): string[] | undefined {
  const parts: string[] = [];
  if (t.done) parts.push(`${t.done} done`);
  if (t.skipped) parts.push(`${t.skipped} skipped`);
  if (t.needsYou) parts.push(`${t.needsYou} ${t.needsYou === 1 ? "needs" : "need"} you`);
  if (t.partial) parts.push(`${t.partial} with a caveat`);
  if (t.failed) parts.push(`${t.failed} failed`);
  return parts.length > 0 ? parts : undefined;
}

export function createStepEmitter(opts: StepEmitterOptions): StepEmitter {
  const human = opts.interactive ?? interactive();
  const titles = new Map<string, string>();
  const tally: Tally = { done: 0, skipped: 0, needsYou: 0, partial: 0, failed: 0 };
  let current: Running | null = null;
  let queue: Promise<void> = Promise.resolve();

  const chain = (fn: () => void | Promise<void>): void => {
    queue = queue.then(fn);
  };
  const titleOf = (id: EventId): string => titles.get(id) ?? id;

  function start(id: EventId): void {
    const title = titleOf(id);
    current = { id, title, handle: human ? tryOpenStep(title) : null, subs: [], tips: [] };
  }

  function stream(line: string): void {
    if (!current) {
      out.print(out.line("warn", line.replace(/^warn: /, "")));
      return;
    }
    for (const row of line.split(/\r\n|\r|\n/)) {
      current.subs.push(row);
      if (current.subs.length > SUB_LINES_KEPT) current.subs.shift();
      if (row !== "") current.handle?.sub(row);
    }
  }

  function count(state: FinalState): void {
    if (state === "done") tally.done++;
    else if (state === "skipped") tally.skipped++;
    else if (state === "needs-you") tally.needsYou++;
    else if (state === "partial") tally.partial++;
    else tally.failed++;
  }

  async function finish(ev: StepEvent & { state: FinalState }, running: Running): Promise<void> {
    let status: RenderStatus;
    let painted = false;
    const title = oneLine(running.title);
    const hint = ev.detail === undefined ? undefined : oneLine(ev.detail);
    if (ev.state === "failed") {
      status = "failed";
      if (running.handle) painted = await running.handle.fail(title, hint);
    } else {
      const ending = FINAL_STATUS[ev.state];
      status = ending;
      // A plain done passes no status: the helper's default ending is the check mark, and the wire carries no status key.
      if (running.handle) painted = await running.handle.done(title, hint, ev.state === "done" ? undefined : ending);
    }
    const blocks: Block[] = [];
    if (!painted) {
      blocks.push(out.line(status, running.title, ev.detail));
      if (ev.state === "failed" && running.subs.length > 0) blocks.push(out.verbatim(running.subs));
    }
    if (ev.remedy) blocks.push(out.callout("fix", ev.remedy));
    if (running.tips.length > 0) blocks.push(out.callout("tip", ...running.tips));
    out.print(...blocks);
  }

  function close(ev: DoneEvent): void {
    if (ev.skipped) {
      out.print(out.line("skipped", SKIPPED_RUN[ev.skipped]));
      return;
    }
    const status: RenderStatus = !ev.ok ? "failed" : tally.needsYou > 0 ? "needs-you" : tally.partial > 0 ? "warn" : "done";
    const title = status === "failed" ? opts.labels.failed : status === "done" ? opts.labels.done : opts.labels.needsYou;
    out.print(out.summary(status, title, countsOf(tally)));
  }

  const emit: Emit = (ev) => {
    switch (ev.event) {
      case "plan":
        for (const s of ev.steps) titles.set(s.id, s.title);
        return;
      case "step": {
        if (ev.state === "pending") return;
        if (ev.state === "running") {
          chain(() => start(ev.id));
          return;
        }
        const final = ev as StepEvent & { state: FinalState };
        count(final.state);
        chain(async () => {
          const running = current ?? { id: final.id, title: titleOf(final.id), handle: null, subs: [], tips: [] };
          current = null;
          await finish(final, running);
        });
        return;
      }
      case "log":
        opts.log(ev.id, ev.line);
        chain(() => stream(ev.line));
        return;
      case "need":
        opts.log(ev.id, WAITING_FOR_APP);
        chain(() => stream(WAITING_FOR_APP));
        return;
      case "done":
        chain(() => close(ev));
        return;
    }
  };

  return {
    emit,
    tip(id, line) {
      opts.log(id, line);
      chain(() => {
        if (current) current.tips.push(line);
        else out.print(out.callout("tip", line));
      });
    },
    async flush() {
      await queue;
    },
  };
}

/** TTY rendering of the same stream: one line per step transition, log lines dimmed. */
export function createHumanEmitter(print: (s: string) => void): Emit {
  const glyph: Record<StepState, string> = { pending: "\u00b7", running: "\u2026", done: "\u2713", partial: "~", failed: "\u2717", skipped: "-", "needs-you": "!" };
  return (ev) => {
    if (ev.event === "plan") print(`  ${ev.steps.length} steps`);
    else if (ev.event === "step") print(`  ${glyph[ev.state]} ${ev.id}${ev.detail ? `  ${ev.detail}` : ""}${ev.remedy ? `\n      \u2192 ${ev.remedy}` : ""}`);
    else if (ev.event === "log") print(`      ${ev.line}`);
    else if (ev.event === "need") print(`  ? ${ev.id} \u2014 waiting for mattstack.app (${ev.request.type})`);
    else if (ev.skipped === "not-set-up") print("  - skipped: setup has not finished on this Mac");
    else if (ev.skipped === "current") print("  - skipped: already applied for this version");
    else if (ev.skipped === "running") print("  - skipped: another update run is in progress");
    else if (ev.failedSteps && ev.failedSteps.length > 0) print(`  \u2717 failed: ${ev.failedSteps.join(", ")}`);
    else print(ev.ok ? "  \u2713 done" : `  \u2717 stopped at ${ev.failedStep}`);
  };
}
