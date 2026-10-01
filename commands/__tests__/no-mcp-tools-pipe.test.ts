/**
 * `rt mcp tools --json` read through a pipe, as the plugin reference check
 * reads it. The roster is larger than a pipe buffer, so a write the CLI does
 * not wait for arrives cut off.
 *
 * Named no-* per AGENTS.md: a test that spawns cli.ts is not selected by
 * `bun test --changed`, so it must carry this prefix to run on a
 * TypeScript-only PR at all.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { childEnv } from "../../lib/subprocess.ts";
import { mcpToolsPayload } from "../mcp.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "cli.ts");

test(
  "the full roster arrives through a pipe as one JSON document",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "rt-mcp-tools-pipe-"));
    try {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "mcp", "tools", "--json"], {
        env: { ...childEnv(), HOME: home, RT_SKIP_SETUP: "1", RT_BATCH: "1", CI: "true" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout) as { tools: Array<{ name: string }> };
      expect(parsed.tools.map((t) => t.name)).toEqual(mcpToolsPayload().tools.map((t) => t.name));
      expect(stdout.length).toBeGreaterThan(65536);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
  60_000,
);
