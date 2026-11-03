import { describe, expect, test } from "bun:test";
import { STEP_IDS } from "../contract.ts";
import { drawPhaseWords, PHASE_WORDS, STEP_PHASES } from "../run-phases.ts";

describe("STEP_PHASES", () => {
  test("every step id has a positive weight and a paused line starting Couldn't", () => {
    expect(Object.keys(STEP_PHASES).sort()).toEqual([...STEP_IDS].sort());
    for (const id of STEP_IDS) {
      const { weight, paused } = STEP_PHASES[id];
      expect(weight).toBeGreaterThan(0);
      expect(paused.startsWith("Couldn't ")).toBe(true);
    }
  });

  test("a paused step still says plainly what broke", () => {
    expect(STEP_PHASES["repos.clone"]).toEqual({ weight: 10, paused: "Couldn't clone your repos" });
    expect(STEP_PHASES.verify).toEqual({ weight: 2, paused: "Couldn't check everything" });
  });
});

describe("drawPhaseWords", () => {
  test("the pool holds at least 100 distinct words", () => {
    expect(new Set(PHASE_WORDS).size).toBe(PHASE_WORDS.length);
    expect(PHASE_WORDS.length).toBeGreaterThanOrEqual(100);
  });

  test("one run never shows a word twice while the pool lasts", () => {
    const drawn = drawPhaseWords(STEP_IDS.length);
    expect(drawn).toHaveLength(STEP_IDS.length);
    expect(new Set(drawn).size).toBe(drawn.length);
    for (const word of drawn) expect(PHASE_WORDS).toContain(word);
  });

  test("the draw follows the random source, so two runs read differently", () => {
    expect(drawPhaseWords(3, () => 0)).toEqual(PHASE_WORDS.slice(0, 3));
    expect(drawPhaseWords(3, () => 0.999)).toEqual([...PHASE_WORDS].reverse().slice(0, 3));
  });

  test("a run longer than the pool refills it without repeating the last word", () => {
    const drawn = drawPhaseWords(PHASE_WORDS.length + 5, () => 0.999);
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).not.toBe(drawn[i - 1]);
  });
});
