import { describe, test, expect } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { flavorHintPath, flavorMismatchBlocks, stillShuttingDownBlock } from "../daemon.ts";

describe("flavor-aware daemon output", () => {
  test("hint path follows the flavor", () => {
    expect(flavorHintPath("dev")).toContain("mattstack-dev.app");
    expect(flavorHintPath("prod")).not.toContain("mattstack-dev.app");
  });

  test("stop's mismatch says the other daemon is still running and which app to open", () => {
    const text = renderPlain(flavorMismatchBlocks("stop", { flavor: "prod", pid: 42 }, "dev"));
    expect(text).toStartWith("[warning] A prod daemon is still running  pid 42; you stopped the dev one\n");
    expect(text).toContain(`next: open ${flavorHintPath("dev")}`);
    expect(text).toContain("note: Quit it first if it is running.");
  });

  test("start and restart's mismatch says the other daemon answered", () => {
    for (const op of ["start", "restart"] as const) {
      expect(renderPlain(flavorMismatchBlocks(op, { flavor: "prod", pid: 7 }, "dev"))).toStartWith("[warning] A prod daemon answered instead of the dev one  pid 7\n");
    }
    expect(renderPlain(flavorMismatchBlocks("start", { flavor: "unknown flavor", pid: null }, "dev"))).not.toContain("pid");
  });

  test("still shutting down is pending, with the pid when known", () => {
    expect(renderPlain([stillShuttingDownBlock({ pid: 123 })])).toBe("[not yet] The daemon is still shutting down  pid 123\n");
    expect(renderPlain([stillShuttingDownBlock({ pid: null })])).toBe("[not yet] The daemon is still shutting down\n");
  });
});
