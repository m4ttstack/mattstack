import type { ApplyEvent, StepState } from "./contract.ts";

export type Emit = (ev: ApplyEvent) => void;

export function createNdjsonEmitter(write: (line: string) => void = (l) => process.stdout.write(l)): Emit {
  return (ev) => write(`${JSON.stringify(ev)}\n`);
}

/** TTY rendering of the same stream: one line per step transition, log lines dimmed. */
export function createHumanEmitter(print: (s: string) => void = console.log): Emit {
  const glyph: Record<StepState, string> = { pending: "·", running: "…", done: "✓", partial: "~", failed: "✗", skipped: "-", "needs-you": "!" };
  return (ev) => {
    if (ev.event === "plan") print(`  ${ev.steps.length} steps`);
    else if (ev.event === "step") print(`  ${glyph[ev.state]} ${ev.id}${ev.detail ? `  ${ev.detail}` : ""}${ev.remedy ? `\n      → ${ev.remedy}` : ""}`);
    else if (ev.event === "log") print(`      ${ev.line}`);
    else if (ev.event === "need") print(`  ? ${ev.id} — waiting for mattstack.app (${ev.request.type})`);
    else if (ev.skipped === "not-set-up") print("  - skipped: this Mac has not been set up yet");
    else if (ev.skipped === "current") print("  - skipped: already applied for this version");
    else if (ev.skipped === "running") print("  - skipped: another update run is in progress");
    else if (ev.failedSteps && ev.failedSteps.length > 0) print(`  ✗ failed: ${ev.failedSteps.join(", ")}`);
    else print(ev.ok ? "  ✓ done" : `  ✗ stopped at ${ev.failedStep}`);
  };
}
