/**
 * `rt mcp tools --json` read through a pipe, as the plugin-mattstack CI job
 * reads it to regenerate the tools reference. Once dispatch has touched
 * process.stdout, Bun cuts a large console.log to a pipe at 64 KiB. Only a
 * spawned cli.ts writing into a shell pipe shows the cut: an in-process call
 * never does, and neither does Bun.spawn's own stdout pipe.
 *
 * Named no-* per AGENTS.md: a test that spawns cli.ts is not selected by
 * `bun test --changed`, so it must carry this prefix to run on a PR at all.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { childEnv } from "../../lib/subprocess.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "cli.ts");

test(
  "mcp tools --json reaches a pipe whole: it parses and lists mr_review_submit",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "rt-mcp-tools-pipe-"));
    try {
      const proc = Bun.spawn(["bash", "-c", 'set -o pipefail; bun run "$1" mcp tools --json | cat', "bash", CLI_PATH], {
        env: { ...childEnv(), HOME: home, RT_SKIP_SETUP: "1", CI: "true" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(code, stderr).toBe(0);
      const payload = JSON.parse(stdout) as { tools: Array<{ name: string }> };
      expect(payload.tools.map((t) => t.name)).toContain("mr_review_submit");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
  30_000,
);
