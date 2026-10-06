import { describe, expect, test } from "bun:test";
import { resolveSharedCheckout, SHARED_CHECKOUT_CANDIDATES } from "../shared-checkout.ts";

describe("resolveSharedCheckout", () => {
  test("prefers the mattstack folder when both exist", () => {
    expect(resolveSharedCheckout("/h", () => true)).toBe("/h/Documents/GitHub/mattstack");
  });
  test("falls back to repo-tools when only it has a cli.ts", () => {
    expect(resolveSharedCheckout("/h", (p) => p === "/h/Documents/GitHub/repo-tools/cli.ts")).toBe("/h/Documents/GitHub/repo-tools");
  });
  test("names the mattstack folder when neither exists", () => {
    expect(resolveSharedCheckout("/h", () => false)).toBe("/h/Documents/GitHub/mattstack");
  });
  test("the stored source path wins when it holds a cli.ts", () => {
    expect(resolveSharedCheckout("/h", (p) => p === "/h/code/mattstack/cli.ts" || p.startsWith("/h/Documents"), "/h/code/mattstack")).toBe("/h/code/mattstack");
  });
  test("a stored path without a cli.ts falls back to the candidates", () => {
    expect(resolveSharedCheckout("/h", (p) => p === "/h/Documents/GitHub/mattstack/cli.ts", "/h/gone")).toBe("/h/Documents/GitHub/mattstack");
  });
  test("no stored path behaves as before", () => {
    expect(resolveSharedCheckout("/h", () => true, null)).toBe("/h/Documents/GitHub/mattstack");
  });
  test("the candidate order is mattstack then repo-tools", () => {
    expect([...SHARED_CHECKOUT_CANDIDATES]).toEqual(["Documents/GitHub/mattstack", "Documents/GitHub/repo-tools"]);
  });
});
