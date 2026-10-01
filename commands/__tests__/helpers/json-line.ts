import { expect } from "bun:test";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";

/**
 * Phase 2's capture with the human gate closed: the test reads plain text
 * and never spawns rt-ui, even when bun test runs in a terminal. restore()
 * resets the gate; so does reset(), so a test that calls cap.reset() must
 * call setHuman again.
 */
export function capturePlain(): CapturedOut {
  const cap = captureOut();
  out.__test__.setHuman(() => false);
  return cap;
}

/** Exactly one JSON object on stdout, compact, newline-terminated: the shape every --json envelope has today. Returns the parsed value. */
export function expectOneJsonLine(stdout: string): unknown {
  const parsed: unknown = JSON.parse(stdout.trimEnd());
  expect(stdout).toBe(JSON.stringify(parsed) + "\n");
  return parsed;
}

/** The real json seam for a shape test: whatever the verb hands it lands on the captured stdout exactly as rt prints it. */
export const realJson = (value: unknown): void => out.json(value);
