/**
 * A CJS bundler (the VS Code extension's esbuild) turns import.meta into an
 * empty object, so a module-scope createRequire(import.meta.url) throws the
 * moment the bundle loads. dist must not carry one.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("dist/index.js", () => {
  test("has no module-scope createRequire(import.meta.url)", () => {
    const js = readFileSync(join(import.meta.dir, "..", "dist", "index.js"), "utf8");
    expect(js).not.toMatch(/^var \w+ = [^;\n]*createRequire\(import\.meta\.url\)/m);
  });
});
