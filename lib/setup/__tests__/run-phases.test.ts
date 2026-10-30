import { describe, expect, test } from "bun:test";
import { STEP_IDS } from "../contract.ts";
import { STEP_PHASES } from "../run-phases.ts";

describe("STEP_PHASES", () => {
  test("every step id has a phase, a positive weight and a paused line starting Couldn't", () => {
    expect(Object.keys(STEP_PHASES).sort()).toEqual([...STEP_IDS].sort());
    for (const id of STEP_IDS) {
      const { phase, weight, paused } = STEP_PHASES[id];
      expect(phase.length).toBeGreaterThan(0);
      expect(weight).toBeGreaterThan(0);
      expect(paused.startsWith("Couldn't ")).toBe(true);
    }
  });

  test("the bar's heaviest phases carry the spec's words", () => {
    expect(STEP_PHASES["repos.clone"]).toEqual({ phase: "Cloning your repos", weight: 10, paused: "Couldn't clone your repos" });
    expect(STEP_PHASES["org.pull"]).toEqual({ phase: "Getting your team's settings", weight: 1, paused: "Couldn't get your team's settings" });
    expect(STEP_PHASES.verify).toEqual({ phase: "Checking everything", weight: 2, paused: "Couldn't check everything" });
  });
});
