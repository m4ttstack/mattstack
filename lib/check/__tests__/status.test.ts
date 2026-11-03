import { afterEach, describe, expect, test } from "bun:test";
import { serializeIdentity } from "../../settings/identity.ts";
import { __test__ as warnTest, setWarningLog } from "../../ui/warn.ts";
import type { RunResult } from "../../subprocess.ts";
import type { CheckResult } from "../run.ts";
import { postStatus, stateFor, STATUS_CONTEXT, type StatusDeps } from "../status.ts";

const github = serializeIdentity({ kind: "remote", id: "github.com/acme/widgets" });
const gitlab = serializeIdentity({ kind: "remote", id: "gitlab.com/acme/widgets" });
const unknown = serializeIdentity({ kind: "remote", id: "git.example.org/acme/widgets" });

type Configured = Extract<CheckResult, { configured: true }>;

function result(over: Partial<Configured> = {}): Configured {
  return {
    configured: true,
    verdict: "green",
    summary: { mode: "changed", selected: 95, passed: 95, failed: 0, durationMs: 41_000, failures: [] },
    sha: "abc123",
    base: "base456",
    dirty: false,
    command: "bun x",
    outputTail: "",
    fromCache: false,
    ...over,
  };
}

function harness(run: Partial<RunResult> = {}) {
  const calls: { argv: string[]; opts: unknown }[] = [];
  const deps: StatusDeps = {
    exec: async (argv, opts) => {
      calls.push({ argv, opts });
      return { stdout: "", stderr: "", exitCode: 0, ...run };
    },
    hostname: () => "hilbert.local",
  };
  return { calls, deps };
}

afterEach(() => warnTest.reset());

describe("postStatus", () => {
  test("a github identity posts through gh api with context, state and description", async () => {
    const { calls, deps } = harness();
    const out = await postStatus(github, "abc123", result(), deps);
    expect(calls[0]!.argv).toEqual([
      "gh", "api", "repos/acme/widgets/statuses/abc123",
      "-f", "state=success",
      "-f", `context=${STATUS_CONTEXT}`,
      "-f", "description=changed: 95 tests in 41s on hilbert",
    ]);
    expect(out).toEqual({ posted: true, context: STATUS_CONTEXT, state: "success", description: "changed: 95 tests in 41s on hilbert" });
  });

  test("a dirty result is not posted", async () => {
    const { calls, deps } = harness();
    const out = await postStatus(github, "abc123", result({ dirty: true }), deps);
    expect(out).toEqual({ posted: false, reason: "dirty-tree" });
    expect(calls).toHaveLength(0);
  });

  test("a gitlab identity is not posted and says so", async () => {
    const { calls, deps } = harness();
    const out = await postStatus(gitlab, "abc123", result(), deps);
    expect(out).toEqual({ posted: false, reason: "gitlab-not-supported" });
    expect(calls).toHaveLength(0);
  });

  test("an unrecognised host is not posted", async () => {
    const { deps } = harness();
    expect(await postStatus(unknown, "abc123", result(), deps)).toEqual({ posted: false, reason: "unknown-host" });
  });

  test("a forge refusal never fails the push", async () => {
    const logged: string[] = [];
    setWarningLog((_m, message) => logged.push(message));
    const { deps } = harness({ exitCode: 1, stderr: "gh: Not Found" });
    const out = await postStatus(github, "abc123", result(), deps);
    expect(out).toMatchObject({ posted: false, reason: "gh-failed" });
    expect((out as { detail?: string }).detail).toContain("gh: Not Found");
    expect(logged.some((m) => m.includes("gh: Not Found"))).toBe(true);
  });

  test("a gh call carries stderr capture and a 15s timeout", async () => {
    const { calls, deps } = harness();
    await postStatus(github, "abc123", result(), deps);
    expect(calls[0]!.opts).toMatchObject({ stderr: "pipe", timeoutMs: 15_000 });
  });
});

test("red maps to failure and error to error", () => {
  expect(stateFor("green")).toBe("success");
  expect(stateFor("red")).toBe("failure");
  expect(stateFor("error")).toBe("error");
});
