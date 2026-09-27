/**
 * rt ci lease CLI, driven as a real spawned binary (bun cli.ts), not
 * in-process: proves the module-registry entry and the command-tree
 * wiring actually resolve `rt ci lease ...` end to end, not just the
 * exported functions ci.test.ts calls directly.
 *
 * Named no-* per AGENTS.md: a test that spawns cli.ts is not selected by
 * `bun test --changed`, so it must carry this prefix to run on a
 * TypeScript-only PR at all.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { childEnv } from "../../lib/subprocess.ts";

const MR_URL = "https://gitlab.example.com/acme/proj/-/merge_requests/7";
const CLI_PATH = join(import.meta.dir, "..", "..", "cli.ts");

async function runCli(args: string[], env: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("rt ci lease CLI (spawned binary)", () => {
  test(
    "claim then show report the session owner; a second session's claim is refused",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "rt-ci-cli-spawn-"));
      const dir = join(home, "attendants");
      const base = { ...childEnv(), HOME: home, MATTSTACK_ATTENDANTS_DIR: dir, RT_SKIP_SETUP: "1", CI: "true" };
      try {
        const claim = await runCli(["ci", "lease", "claim", MR_URL, "--json"], { ...base, CLAUDE_CODE_SESSION_ID: "cli-test" });
        expect(claim.code).toBe(0);
        expect(JSON.parse(claim.stdout)).toMatchObject({ claimed: true });

        const show = await runCli(["ci", "lease", "show", MR_URL, "--json"], { ...base, CLAUDE_CODE_SESSION_ID: "cli-test" });
        expect(show.code).toBe(0);
        expect(JSON.parse(show.stdout)).toMatchObject({ lease: { owner: "session:cli-test" }, mine: true });

        const otherClaim = await runCli(["ci", "lease", "claim", MR_URL, "--json"], { ...base, CLAUDE_CODE_SESSION_ID: "other" });
        expect(otherClaim.code).toBe(3);
        expect(JSON.parse(otherClaim.stdout)).toMatchObject({ claimed: false });
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
