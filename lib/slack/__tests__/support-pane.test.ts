import { expect, test } from "bun:test";
import type { Logger } from "pino";
import type { HerdrRunner } from "../../agent-herdr.ts";
import { bgSocketPath } from "../../daemon/bg-service.ts";
import { closeSupportPane } from "../support-pane.ts";

function harness(runner: HerdrRunner) {
  const sockets: (string | null)[] = [];
  const warned: unknown[][] = [];
  const log = { warn: (...args: unknown[]) => warned.push(args) } as unknown as Logger;
  return { sockets, warned, deps: { herdrRunnerFor: (s: string | null) => (sockets.push(s), runner), log } };
}

test("closeSupportPane closes a visible pane by its bare id on the default socket", async () => {
  const calls: string[][] = [];
  const h = harness(async (args) => (calls.push(args), { exitCode: 0, stdout: "" }));
  expect(await closeSupportPane(h.deps, "w1:p2")).toBe(true);
  expect(calls).toEqual([["pane", "close", "w1:p2"]]);
  expect(h.sockets).toEqual([null]);
});

test("closeSupportPane strips a bg: ref and uses the background socket", async () => {
  const calls: string[][] = [];
  const h = harness(async (args) => (calls.push(args), { exitCode: 0, stdout: "" }));
  expect(await closeSupportPane(h.deps, "bg:p9")).toBe(true);
  expect(calls).toEqual([["pane", "close", "p9"]]);
  expect(h.sockets).toEqual([bgSocketPath()]);
});

test("closeSupportPane logs and returns false when herdr fails, and never throws", async () => {
  const failed = harness(async () => ({ exitCode: 1, stdout: "no such pane" }));
  expect(await closeSupportPane(failed.deps, "bg:p9")).toBe(false);
  expect(failed.warned).toHaveLength(1);
  const threw = harness(async () => {
    throw new Error("herdr missing");
  });
  expect(await closeSupportPane(threw.deps, "w1:p2")).toBe(false);
  expect(threw.warned).toHaveLength(1);
});

test("closeSupportPane with no pane does nothing", async () => {
  const h = harness(async () => ({ exitCode: 0, stdout: "" }));
  expect(await closeSupportPane(h.deps, null)).toBe(false);
  expect(h.sockets).toEqual([]);
});
