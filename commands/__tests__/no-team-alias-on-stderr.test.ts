/**
 * A store that still spells `${team:<name>}` must not print its deprecation on
 * every command: the CLI logs it and stays quiet. Spawns cli.ts, so named no-*
 * per AGENTS.md to run on a TypeScript-only PR.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { childEnv } from "../../lib/subprocess.ts";
import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "cli.ts");

test(
  "the alias reaches the CLI log, not stderr",
  async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-team-alias-cli-")));
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      seedOrg({ org: "acme", settings: { "board.title": "${team:acme}/title" } });
    } finally {
      process.env.HOME = prevHome;
    }
    try {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "settings", "get", "board.title", "--json"], {
        env: { ...childEnv(), HOME: home, RT_SKIP_SETUP: "1", CI: "true" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout).value).toBe(`${join(home, ".mattstack", "orgs", "acme")}/title`);
      expect(stderr).not.toContain("deprecated");
      const logs = join(home, ".mattstack", "rt", "logs");
      const cliLog = readdirSync(logs).filter((f) => f.startsWith("cli.")).map((f) => readFileSync(join(logs, f), "utf8")).join("");
      expect(cliLog).toContain("${team:acme} is deprecated; use ${org}");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
  30_000,
);
