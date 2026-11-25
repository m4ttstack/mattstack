import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { DAEMON_ROUTES } from "../../../../packages/rt-client/src/daemon-api/routes.ts";

describe("who can ask", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "__tests__" || name === "node_modules") return [];
      return statSync(path).isDirectory() ? sources(path) : /\.(ts|mts)$/.test(name) ? [path] : [];
    });
  }

  test("no command tree verb, MCP tool or HTTP route names text:seal or text:open", () => {
    const root = join(import.meta.dir, "..", "..", "..", "..");
    const files = [...sources(join(root, "commands")), ...sources(join(root, "lib", "mcp")), join(root, "lib", "command-tree-def.ts"), join(root, "lib", "module-registry.ts")];
    expect(files.filter((f) => /text:(seal|open)\b|text(Seal|Open)\b/.test(readFileSync(f, "utf8")))).toEqual([]);
    expect(JSON.stringify(DAEMON_ROUTES)).not.toMatch(/text:(seal|open)/);
  });
});
