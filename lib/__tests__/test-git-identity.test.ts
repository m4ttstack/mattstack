import { expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

test("a commit under an empty home finds an email, whatever this machine's hostname", () => {
  const home = mkdtempSync(join(tmpdir(), "git-identity-"));
  const env = { PATH: process.env.PATH, EMAIL: process.env.EMAIL, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_COMMITTER_NAME: "t" };
  const out = Bun.spawnSync(["git", "var", "GIT_COMMITTER_IDENT"], { cwd: home, env });
  expect(out.stdout.toString()).toContain("<rt-tests@example.invalid>");
});
