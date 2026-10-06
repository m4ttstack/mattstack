import { expect, test } from "bun:test";
import { SMOKE_CHECKS, evaluate } from "../lib/docs-smoke.ts";

test("checks the docs home, an rt page, a gitq page and an rt.cool redirect", () => {
  expect(SMOKE_CHECKS.map((c) => c.url)).toEqual([
    "https://docs.mattstack.dev/",
    "https://docs.mattstack.dev/rt/reference/cd",
    "https://docs.mattstack.dev/gitq",
    "https://rt.cool/reference/cd",
  ]);
});

test("a page passes on 200", () => {
  expect(evaluate({ url: "u", status: 200 }, { status: 200, location: null })).toBeNull();
  expect(evaluate({ url: "u", status: 200 }, { status: 404, location: null })).toBe("u: expected 200, got 404");
});

test("a redirect must name the right location, not only the right status", () => {
  const c = { url: "r", status: 301, location: "https://docs.mattstack.dev/rt/reference/cd" };
  expect(evaluate(c, { status: 301, location: "https://docs.mattstack.dev/rt/reference/cd" })).toBeNull();
  expect(evaluate(c, { status: 301, location: "https://docs.mattstack.dev/" })).toBe(
    "r: redirects to https://docs.mattstack.dev/, expected https://docs.mattstack.dev/rt/reference/cd",
  );
});
