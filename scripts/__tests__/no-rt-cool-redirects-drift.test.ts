import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { rtCoolRedirects } from "../lib/docs-moves.ts";

test("the committed rt.cool _redirects matches the moves table", () => {
  const committed = readFileSync(join(import.meta.dir, "..", "..", "website", "redirects", "rt-cool", "_redirects"), "utf8");
  expect(committed).toBe(rtCoolRedirects());
});
