import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("no HTTP route reaches a logins verb", () => {
  const src = readFileSync(join(import.meta.dir, "..", "api-server.ts"), "utf8");
  expect(src).not.toContain("logins:");
});
