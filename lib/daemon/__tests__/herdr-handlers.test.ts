import { expect, test } from "bun:test";
import { createHerdrHandlers } from "../handlers/herdr.ts";
import type { HerdrStartResult } from "../../herdr/start.ts";

test("herdr:start returns the starter's result as data", async () => {
  const result: HerdrStartResult = { state: "started", bin: "/opt/acme/herdr" };
  const h = createHerdrHandlers({ start: async () => result });
  expect(await h["herdr:start"]({})).toEqual({ ok: true, data: result });
});

test("herdr:start carries a failure's detail in data, not as an error", async () => {
  const result: HerdrStartResult = { state: "failed", bin: "/opt/acme/herdr", detail: "herdr did not answer" };
  const h = createHerdrHandlers({ start: async () => result });
  expect(await h["herdr:start"]({})).toEqual({ ok: true, data: result });
});
