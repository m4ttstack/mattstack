import { expect, test } from "bun:test";
import { MIGRATION_IDS } from "../migrations/ids.ts";
import { MIGRATIONS } from "../migrations/index.ts";

test("MIGRATION_IDS lists every migration in run order", () => {
  expect([...MIGRATION_IDS]).toEqual(MIGRATIONS.map((m) => m.id));
});
