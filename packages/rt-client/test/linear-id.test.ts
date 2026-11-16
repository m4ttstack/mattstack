import { describe, expect, test } from "bun:test";
import { extractLinearId } from "../src/linear-id.ts";

describe("extractLinearId", () => {
  test("takes a segment that is exactly the id, last segment first", () => {
    expect(extractLinearId("feature/acme-1287")).toBe("ACME-1287");
    expect(extractLinearId("acme-1/feature/acme-2")).toBe("ACME-2");
  });

  test("falls back to an id that prefixes a segment", () => {
    expect(extractLinearId("feature/acme-1287-add-photos")).toBe("ACME-1287");
    expect(extractLinearId("acme-1287_add")).toBe("ACME-1287");
  });

  test("is null for a branch with no id", () => {
    expect(extractLinearId("main")).toBeNull();
    expect(extractLinearId("feature/add-photos")).toBeNull();
  });
});
