import { describe, expect, test } from "bun:test";
import { STEPS } from "../steps/index.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import type { StepId } from "../contract.ts";

const UPDATE_SAFE: StepId[] = [
  "path.link",
  "settings.seed",
  "skills.materialize",
  "skills.link",
  "intercepts.install",
  "plugins.install",
  "claude.permissions",
  "fastbrowser.setup",
  "herdr.integration",
  "extension.install",
  "verify",
];

describe("update-safe steps", () => {
  test("exactly the audited set is flagged, in contract order", () => {
    expect(STEPS.filter((s) => s.updateSafe).map((s) => s.id)).toEqual(UPDATE_SAFE);
  });

  test("an update-safe step never needs the app", () => {
    for (const s of STEPS.filter((s) => s.updateSafe)) expect(s.kind).toBe("rt");
  });

  test("an update-safe step applies unconditionally, so an update run is never silently narrower than its plan", () => {
    const ctx = {} as Parameters<(typeof STEPS)[number]["applies"]>[0];
    for (const s of STEPS.filter((s) => s.updateSafe)) expect(s.applies(ctx)).toBe(true);
  });
});

describe("migrations registry", () => {
  test("ids are unique and dated", () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
  });

  test("ids are in date order", () => {
    const ids = MIGRATIONS.map((m) => m.id.slice(0, 10));
    expect(ids).toEqual([...ids].sort());
  });
});
