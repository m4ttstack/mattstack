import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_PLUGINS } from "../../lib/setup/base-plugins.ts";

// `rt setup update` only updates BASE_PLUGINS, so a catalog plugin missing
// from it stays at whatever version a member first installed, release after release.
const ROOT = join(import.meta.dir, "..", "..");
const catalog = JSON.parse(readFileSync(join(ROOT, "marketplace", "marketplace.json"), "utf8")) as {
  name: string;
  plugins: { name: string }[];
};

describe("mattstack marketplace catalog", () => {
  test("every plugin it publishes is one rt setup installs and updates", () => {
    const unmanaged = catalog.plugins.map((p) => `${p.name}@${catalog.name}`).filter((id) => !BASE_PLUGINS.includes(id));
    expect(unmanaged).toEqual([]);
  });
});
