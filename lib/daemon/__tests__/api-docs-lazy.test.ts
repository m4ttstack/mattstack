import { describe, expect, test } from "bun:test";
import { join } from "path";
import { childEnv } from "../../subprocess.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const DOCS_ONLY = /\/@scalar\/api-reference\/|\/api-docs-scalar\.ts$|\/@hono\/zod-openapi\/|\/daemon-api\/(document|client|index)\.ts$/;

// A fresh process, because this test runner has already loaded the docs graph
// through other test files.
function loadedAfter(script: string): string[] {
  const proc = Bun.spawnSync(["bun", "-e", `${script}\nconsole.log(JSON.stringify(Object.keys(require.cache)));`], {
    cwd: ROOT,
    env: childEnv(),
  });
  if (proc.exitCode !== 0) throw new Error(`bun -e failed:\n${proc.stderr.toString()}`);
  const ids = JSON.parse(proc.stdout.toString().trim().split("\n").at(-1)!) as string[];
  return ids.filter((id) => DOCS_ONLY.test(id));
}

describe("daemon docs payload loads lazily", () => {
  test("importing api-app.ts and building the index loads nothing from Scalar (package.json included) or @hono/zod-openapi", () => {
    const loaded = loadedAfter(`
      const { createApiApp } = await import("./lib/daemon/api-app.ts");
      const { apiIndex, docsHtml } = await import("./lib/daemon/api-docs.ts");
      createApiApp({ handleCommand: async () => ({ ok: true }), log: console, apiToken: "t", port: () => 1 });
      apiIndex(1);
      docsHtml();
    `);
    expect(loaded).toEqual([]);
  }, 30_000);

  test("the docs loaders do pull them in, so the probe above can see them", () => {
    const loaded = loadedAfter(`
      const { openApiJson, scalarJs } = await import("./lib/daemon/api-docs.ts");
      await openApiJson();
      await scalarJs();
      await import("./node_modules/@scalar/api-reference/package.json");
    `);
    expect(loaded.some((id) => id.includes("/@scalar/api-reference/dist/"))).toBe(true);
    expect(loaded.some((id) => id.endsWith("/@scalar/api-reference/package.json"))).toBe(true);
    expect(loaded.some((id) => id.includes("/@hono/zod-openapi/"))).toBe(true);
  }, 30_000);
});
