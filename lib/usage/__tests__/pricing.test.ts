import { expect, test } from "bun:test";
import { costOf, type TokenTotals } from "../pricing.ts";

const M = 1_000_000;
const each: TokenTotals = { input: M, output: M, cacheRead: M, cacheWrite5m: M, cacheWrite1h: M };
const near = (a: number | null, b: number) => expect(a).toBeCloseTo(b, 9);

test("opus 5.5 prices each field", () => {
  near(costOf("claude-opus-5-5", each, "standard"), 4 + 20 + 0.2 + 5 + 8);
});

test("fast mode doubles Opus 5.5 input, output and cache rates", () => {
  near(costOf("claude-opus-5-5", each, "fast"), 2 * (4 + 20 + 0.2 + 5 + 8));
});

test("fast mode prices as standard on a model without it", () => {
  near(costOf("claude-sonnet-5-5", each, "fast"), costOf("claude-sonnet-5-5", each, null)!);
});

test("fable 5.2 prices each field, and doubles in fast mode", () => {
  const standard = 8 + 40 + 0.2 + 10 + 16;
  near(costOf("claude-fable-5-2", each, "standard"), standard);
  near(costOf("claude-fable-5-2", each, "fast"), 2 * standard);
});

test("null speed prices as standard", () => {
  near(costOf("claude-opus-5-5", each, null), costOf("claude-opus-5-5", each, "standard")!);
});

test("haiku 5.5 uses the higher rate past 100K prompt tokens", () => {
  const low: TokenTotals = { input: 100_000, output: M, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  near(costOf("claude-haiku-5-5", low, null), 0.1 * 0.1 + 0.5);
  const high: TokenTotals = { ...low, input: 100_001 };
  near(costOf("claude-haiku-5-5", high, null), 0.5 * 0.100001 + 2.5);
});

test("haiku 5.5 counts cache tokens toward the threshold", () => {
  const t: TokenTotals = { input: 1, output: 0, cacheRead: 100_000, cacheWrite5m: 0, cacheWrite1h: 0 };
  near(costOf("claude-haiku-5-5", t, null), 0.5 * 0.000001 + 0.05 * 0.1);
});

test("cache read multipliers differ by model", () => {
  const r = { input: 0, output: 0, cacheRead: M, cacheWrite5m: 0, cacheWrite1h: 0 };
  near(costOf("claude-fable-5-1", r, null), 0.25);
  near(costOf("claude-fable-5", r, null), 1);
  near(costOf("claude-sonnet-5-5", r, null), 0.1);
  near(costOf("claude-sonnet-5", r, null), 0.2);
  near(costOf("claude-haiku-4-5", r, null), 0.1);
});

test("a date suffix is stripped before lookup", () => {
  near(costOf("claude-haiku-4-5-20251001", each, null), costOf("claude-haiku-4-5", each, null)!);
});

test("an unknown model returns null", () => {
  expect(costOf("claude-mystery-9", each, null)).toBeNull();
});
