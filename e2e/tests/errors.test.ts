import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome, rt } from "../harness.ts";

/**
 * The error seam through the real binary with stdout and stderr piped: the
 * failure block prints plainly, the stack prints under it, and the exit
 * codes are the contract's.
 */
function installThrowingPlugin(home: string): void {
  const dir = join(home, ".mattstack", "user", "plugins", "e2e-seam");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ name: "e2e-seam", apiVersion: 1, commands: { "e2e-seam-boom": { description: "throws", module: "./boom.ts", hidden: true } } }, null, 2),
  );
  writeFileSync(join(dir, "boom.ts"), 'export async function run() { throw new Error("kaboom from the seam test"); }\n');
}

function cliLog(home: string): string {
  const dir = join(home, ".mattstack", "rt", "logs");
  return readdirSync(dir)
    .filter((f) => f.startsWith("cli.") && f.endsWith(".log"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("");
}

describe("the error seam off a terminal", () => {
  let home: string;
  let cleanup: () => void;

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
    installThrowingPlugin(home);
  });

  afterAll(() => cleanup());

  test("an unexpected error prints one line, the stack under it, exits 1, and the log has the stack", async () => {
    const result = await rt(["e2e-seam-boom"], { home });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("rt hit an unexpected error  kaboom from the seam test\n  next: rt daemon logs\nstack:\n  Error: kaboom from the seam test\n");
    expect(result.stderr).not.toContain("[failed]");
    expect(result.stderr).toContain("      at ");
    const seamLines = cliLog(home)
      .split("\n")
      .filter((l) => l.includes('"module":"cli"') && l.includes("kaboom from the seam test") && l.includes('"stack":'));
    expect(seamLines).toHaveLength(1);
  }, 30_000);

  test("--json: an unexpected error leaves stdout empty and exits 1", async () => {
    const result = await rt(["e2e-seam-boom", "--json"], { home });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("rt hit an unexpected error");
  }, 30_000);

  test("an expected failure prints the failure block without the verb prefix and exits 2", async () => {
    const result = await rt(["repos", "reidentify", "github.com/acme/only-one"], { home });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("reidentify takes two identities, got 1; usage: rt repos reidentify");
    expect(result.stderr).not.toContain("[failed]");
    expect(result.stderr).not.toContain("rt repos reidentify:");
    expect(result.stderr).not.toContain("    at ");
  }, 30_000);

  test("an expected failure under --json keeps stdout for the envelope", async () => {
    const result = await rt(["repos", "reidentify", "github.com/acme/only-one", "--json"], { home });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain("[failed]");
    const body = JSON.parse(result.stdout.trim());
    expect(body.contract).toBe(1);
    expect(body.error.code).toBe("usage");
  }, 30_000);
});
