import { test, expect } from "bun:test";
import { admit, ADMIT_UNFLOORED, installArgs, updateArgs } from "../plugin-calls.ts";

test("a fitting floor admits and builds argv", () => {
  const a = admit("0.31.0", "0.31.0");
  expect(a.ok).toBe(true);
  if (!a.ok) throw new Error("unreachable");
  expect(updateArgs(a, "acme-skills@acme-market", ["-y"])).toEqual(["plugin", "update", "acme-skills@acme-market", "-y"]);
  expect(installArgs(a, "acme-skills@acme-market")).toEqual(["plugin", "install", "acme-skills@acme-market"]);
});

test("a floor above the engine refuses with both versions", () => {
  expect(admit("0.31.0", "0.30.28")).toEqual({ ok: false, floor: "0.31.0", engine: "0.30.28" });
});

test("no floor and unknown engine admit", () => {
  expect(admit(null, "0.1.0").ok).toBe(true);
  expect(admit("0.31.0", null).ok).toBe(true);
  expect(updateArgs(ADMIT_UNFLOORED, "fast-browser@mattstack")).toEqual(["plugin", "update", "fast-browser@mattstack"]);
});
