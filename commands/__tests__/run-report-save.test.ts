import { describe, expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { __test__ } from "../run.ts";

const { reportSaveBlocks } = __test__;

describe("reportSaveBlocks", () => {
  test("a successful save names the preset", () => {
    expect(renderPlain(reportSaveBlocks("preset", "nightly", { ok: true }))).toBe("[ok] Saved the preset nightly\n");
  });
  test("a missing identity leaves a warning with the override command", () => {
    expect(renderPlain(reportSaveBlocks("preset", "nightly", { ok: false, reason: "no-identity" }))).toBe(
      "[warning] The preset was not saved  rt cannot tell which repo this is\n  next: rt settings set rt.repoIdentityOverrides\n",
    );
  });
  test("a failed write carries its own message", () => {
    expect(renderPlain(reportSaveBlocks("preset", "nightly", { ok: false, reason: "write-failed", message: "disk full" }))).toBe(
      "[warning] The preset was not saved  disk full\n",
    );
  });
});
