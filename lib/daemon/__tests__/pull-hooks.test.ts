import { describe, expect, test } from "bun:test";
import { composePullHooks } from "../pull-hooks.ts";

describe("composePullHooks", () => {
  test("runs each hook in order and a throw does not stop the next", async () => {
    const order: string[] = [];
    const hook = composePullHooks([
      async (slug) => { order.push(`a:${slug}`); throw new Error("a broke"); },
      async (slug) => { order.push(`b:${slug}`); },
    ]);
    await expect(hook("acme")).resolves.toBeUndefined();
    expect(order).toEqual(["a:acme", "b:acme"]);
  });
});
