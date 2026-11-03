import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CheckRun } from "../../lib/check/index.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import { serializeIdentity } from "../../lib/settings/identity.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { checkCommand, type CheckCommandDeps } from "../check.ts";

const identity = serializeIdentity({ kind: "remote", id: "github.com/acme/widgets" });
const ctx = { identity: { repoName: "widgets", identity, repoRoot: "/tree", dataDir: "/data", remoteUrl: "", baseUrl: "" } } as CommandContext;

type Configured = Extract<CheckRun["result"], { configured: true }>;

function result(over: Partial<Configured> = {}): Configured {
  return {
    configured: true,
    verdict: "green",
    summary: { mode: "changed", selected: 95, passed: 95, failed: 0, durationMs: 41_200, failures: [] },
    sha: "abc123def456",
    base: "base456",
    dirty: false,
    command: "bun x",
    outputTail: "",
    fromCache: false,
    ...over,
  };
}

const posted: CheckRun["status"] = { posted: true, context: "rt/local-check", state: "success", description: "changed: 95 tests in 41s on hilbert" };

function deps(run: CheckRun) {
  const calls: Parameters<CheckCommandDeps["run"]>[] = [];
  const d: CheckCommandDeps = {
    run: async (...a) => {
      calls.push(a);
      return run;
    },
    hostname: () => "hilbert.local",
  };
  return { d, calls };
}

let io: CapturedOut;
beforeEach(() => {
  io = captureOut();
  out.__test__.setHuman(() => false);
  process.exitCode = 0;
});
afterEach(() => {
  io.restore();
  process.exitCode = 0;
});

describe("rt check", () => {
  test("unconfigured prints a refused note and exits 0", async () => {
    const { d } = deps({ result: { configured: false }, status: null });
    await checkCommand([], ctx, d);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toContain("No pre-push check is configured for widgets");
    expect(io.stderr()).toContain("rt settings set rt.check");
    expect(process.exitCode).toBe(0);
  });

  test("green prints the result line and that the status was posted", async () => {
    const { d } = deps({ result: result(), status: posted });
    await checkCommand([], ctx, d);
    expect(io.stdout()).toContain("changed: 95 tests in 41s on hilbert");
    expect(io.stdout()).toContain("Posted rt/local-check on abc123d");
    expect(io.stderr()).toBe("");
    expect(process.exitCode).toBe(0);
  });

  test("red fails with the failing files as a verbatim block", async () => {
    const r = result({
      verdict: "red",
      summary: { mode: "changed", selected: 95, passed: 93, failed: 2, durationMs: 41_200, failures: ["lib/a.test.ts", "lib/b.test.ts"] },
    });
    const { d } = deps({ result: r, status: { posted: false, reason: "not-on-remote" } });
    await checkCommand([], ctx, d);
    expect(io.stderr()).toStartWith("2 of 95 tests failed");
    expect(io.stderr()).toContain("lib/a.test.ts");
    expect(io.stderr()).toContain("lib/b.test.ts");
    expect(io.stderr()).toContain("rt check");
    expect(io.stdout()).toContain("not on the remote");
    expect(process.exitCode).toBe(1);
  });

  test("an error shows the reason and the output tail", async () => {
    const r = result({ verdict: "error", reason: "timed out after 600s", outputTail: "last line one\nlast line two" });
    const { d } = deps({ result: r, status: null });
    await checkCommand([], ctx, d);
    expect(io.stderr()).toStartWith("The check did not finish: timed out after 600s");
    expect(io.stderr()).toContain("last line two");
    expect(process.exitCode).toBe(1);
  });

  test("a cached result says so", async () => {
    const { d } = deps({ result: result({ fromCache: true }), status: posted });
    await checkCommand([], ctx, d);
    expect(io.stdout()).toContain("Reused the green run for this commit");
  });

  test("--no-status skips posting and says the status was not posted", async () => {
    const { d, calls } = deps({ result: result(), status: null });
    await checkCommand(["--no-status"], ctx, d);
    expect(calls[0]![1]).toEqual({ full: false, post: false });
    expect(io.stdout()).toContain("The result was not posted, as you asked");
  });

  test("--full and --base reach the run, against the tree root", async () => {
    const { d, calls } = deps({ result: result(), status: posted });
    await checkCommand(["--full", "--base", "origin/dev"], ctx, d);
    expect(calls[0]).toEqual(["/tree", { full: true, post: true, base: "origin/dev" }]);
  });

  test("--base=<ref> reaches the run like --base <ref>", async () => {
    const { d, calls } = deps({ result: result(), status: posted });
    await checkCommand(["--base=origin/dev"], ctx, d);
    expect(calls[0]).toEqual(["/tree", { full: false, post: true, base: "origin/dev" }]);
  });

  test("--base= with no ref asks for one and runs nothing", async () => {
    const { d, calls } = deps({ result: result(), status: posted });
    await checkCommand(["--base="], ctx, d);
    expect(io.stderr()).toStartWith("Which ref should the check diff against?");
    expect(calls).toHaveLength(0);
  });

  test("--base without a ref asks for one and runs nothing", async () => {
    const { d, calls } = deps({ result: result(), status: posted });
    await checkCommand(["--base"], ctx, d);
    expect(io.stderr()).toStartWith("Which ref should the check diff against?");
    expect(calls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });
});
