import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ROOT } from "../test-scope.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unit-halves-"));
  writeFileSync(
    join(dir, "bun"),
    `#!/bin/bash\nprintf '%s\\n' "$*" >> "$CALLS"\necho "output of $*"\ncase "$*" in *"--shard=$FAIL_HALF/"*) exit 1 ;; esac\n`,
  );
  chmodSync(join(dir, "bun"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function halves(shard: string, total: string, failHalf = "none") {
  const calls = join(dir, "calls");
  const run = Bun.spawnSync(["bash", join(ROOT, "scripts/ci/unit-halves.sh"), shard, total, "./lib", "--flag"], {
    env: { PATH: `${dir}:${process.env.PATH}`, CALLS: calls, FAIL_HALF: failHalf },
  });
  return {
    code: run.exitCode,
    out: run.stdout.toString(),
    calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").sort() : [],
  };
}

test("a shard runs as its two halves, and passes the caller's arguments and the timeout to each", () => {
  const { code, calls } = halves("2", "3");
  expect(code).toBe(0);
  expect(calls).toEqual(["test ./lib --flag --shard=3/6 --timeout 20000", "test ./lib --flag --shard=4/6 --timeout 20000"]);
});

test("the only shard of one is halves one and two of two", () => {
  expect(halves("1", "1").calls.map((c) => /--shard=(\S+)/.exec(c)?.[1])).toEqual(["1/2", "2/2"]);
});

test("each half's log prints whole, under its own group", () => {
  const { out } = halves("1", "3");
  expect(out).toContain("::group::half 1 of 6\noutput of test ./lib --flag --shard=1/6 --timeout 20000\n::endgroup::");
  expect(out).toContain("::group::half 2 of 6\noutput of test ./lib --flag --shard=2/6 --timeout 20000\n::endgroup::");
});

test.each(["1", "2"])("a failure in half %s fails the shard, and both logs still print", (half) => {
  const { code, out } = halves("1", "1", half);
  expect(code).toBe(1);
  expect(out).toContain("::group::half 1 of 2");
  expect(out).toContain("::group::half 2 of 2");
  expect(out).toContain("a half of shard 1 failed");
});
