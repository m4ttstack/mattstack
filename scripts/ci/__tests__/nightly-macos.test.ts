import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ROOT } from "../test-scope.ts";

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = {
  if?: string;
  needs?: string;
  "runs-on"?: string;
  permissions?: Record<string, string>;
  strategy?: { matrix: { shard: number[] } };
  steps: Step[];
};
const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "nightly-macos.yml"), "utf8")) as {
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
};

test("it runs on a schedule and by hand", () => {
  expect(workflow.on.schedule).toEqual([{ cron: expect.any(String) }]);
  expect(Object.keys(workflow.on)).toContain("workflow_dispatch");
});

test("the whole suite runs in three shards on macOS", () => {
  const unit = workflow.jobs.unit!;
  expect(unit["runs-on"]).toBe("macos-latest");
  expect(unit.strategy?.matrix.shard).toEqual([1, 2, 3]);
  const run = unit.steps.map((step) => step.run ?? "").join("\n");
  expect(run).toContain('scripts/ci/unit-halves.sh "$SHARD" 3 $dirs');
  expect(run).not.toContain("--changed");
  expect(run).not.toContain("macos-only-tests");
});

test("only a scheduled red reports, and it may write issues", () => {
  const report = workflow.jobs.report!;
  expect(report.needs).toBe("unit");
  expect(report.if).toBe("failure() && github.event_name == 'schedule'");
  expect(report.permissions).toEqual({ issues: "write" });
});

describe("the report step", () => {
  const step = workflow.jobs.report!.steps.find((s) => s.run)!;
  const TITLE = step.env!.TITLE!;
  let dir: string;
  let calls: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nightly-report-"));
    calls = join(dir, "calls");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // gh's --jq filter runs inside gh, so the stub answers with what the filter
  // selects: the open issue's number, or nothing.
  function report(openIssue: string): string[] {
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/bash\nprintf '%s\\n' "$*" >> "$CALLS"\n[ "$1 $2" = "issue list" ] && [ -n "$OPEN_ISSUE" ] && echo "$OPEN_ISSUE"\nexit 0\n`,
    );
    chmodSync(join(dir, "gh"), 0o755);
    const run = Bun.spawnSync(["bash", "-e", "-c", step.run!], {
      env: { PATH: `${dir}:${process.env.PATH}`, CALLS: calls, OPEN_ISSUE: openIssue, TITLE, RUN: "https://example.invalid/run/1" },
    });
    expect(run.exitCode).toBe(0);
    return existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  }

  test("no open issue: it opens one naming the run", () => {
    const made = report("");
    expect(made).toHaveLength(2);
    expect(made[1]).toStartWith(`issue create --title ${TITLE} --body `);
    expect(made[1]).toContain("https://example.invalid/run/1");
  });

  test("an open issue: it comments on that one and opens nothing", () => {
    const made = report("42");
    expect(made).toHaveLength(2);
    expect(made[1]).toStartWith("issue comment 42 --body ");
    expect(made[1]).toContain("https://example.invalid/run/1");
  });
});
