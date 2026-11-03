/**
 * rt check: run the repo's own pre-push check in this tree and post the
 * result on the commit.
 *
 *   rt check [--full] [--no-status] [--base <ref>] [--json]
 */
import { checkTree, realCheckDeps, type CheckRun } from "../lib/check/index.ts";
import { describe } from "../lib/check/summary.ts";
import type { CheckResult } from "../lib/check/run.ts";
import type { StatusOutcome } from "../lib/check/status.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { repoLabel } from "../lib/repo-label.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";
import type { Block } from "../lib/ui/protocol.ts";

type Configured = Extract<CheckResult, { configured: true }>;

export type CheckCommandDeps = {
  run: (tree: string, opts: { full: boolean; base?: string; post: boolean }) => Promise<CheckRun>;
  hostname: () => string;
};

const realDeps: CheckCommandDeps = {
  run: (tree, opts) => checkTree(tree, opts, realCheckDeps),
  hostname: realCheckDeps.hostname,
};

const USAGE = "rt check [--full] [--no-status] [--base <ref>] [--json]";

const NOT_POSTED: Record<Exclude<StatusOutcome, { posted: true }>["reason"], string> = {
  "dirty-tree": "You have uncommitted changes, so the result was not posted",
  "not-on-remote": "This commit is not on the remote yet, so the result was not posted",
  "gitlab-not-supported": "This repo is on GitLab, which rt cannot post a result to yet",
  "unknown-host": "rt does not know how to post a result to this repo's host",
  "gh-failed": "The result could not be posted",
  "head-moved": "The branch moved while the check ran, so the result was not posted",
};

function statusBlock(status: StatusOutcome | null, sha: string): Block {
  if (status === null) return out.line("skipped", "The result was not posted, as you asked");
  if (status.posted) return out.line("done", `Posted ${status.context} on ${sha.slice(0, 7)}`);
  return out.line("skipped", NOT_POSTED[status.reason], status.detail);
}

function failureCount(r: Configured): string {
  const { failed, selected } = r.summary;
  if (failed === null) return "The check failed";
  return selected === null ? `${failed} tests failed` : `${failed} of ${selected} tests failed`;
}

function tailLines(r: Configured): string[] {
  return r.outputTail === "" ? [] : r.outputTail.split("\n");
}

/** The envelope is frozen; `reason` is added only when the result has one. */
export function checkEnvelope(run: CheckRun): unknown {
  const r = run.result;
  if (!r.configured) return { configured: false };
  return {
    configured: true,
    verdict: r.verdict,
    sha: r.sha,
    base: r.base,
    dirty: r.dirty,
    fromCache: r.fromCache,
    summary: r.summary,
    status: run.status,
    ...(r.reason ? { reason: r.reason } : {}),
  };
}

export function unconfiguredBlocks(label: string): Block[] {
  return [
    out.line("refused", `No pre-push check is configured for ${label}`),
    out.callout("next", ["Set the command with ", out.cmd("rt settings set rt.check")]),
  ];
}

export function greenBlocks(r: Configured, status: StatusOutcome | null, machine: string): Block[] {
  return [
    out.line("done", describe(r.verdict, r.summary, machine), r.fromCache ? "Reused the green run for this commit" : undefined),
    statusBlock(status, r.sha),
  ];
}

function report(run: CheckRun, machine: string, label: string): void {
  const r = run.result;
  if (!r.configured) {
    out.note(...unconfiguredBlocks(label));
    return;
  }
  if (r.verdict === "green") {
    out.print(...greenBlocks(r, run.status, machine));
    return;
  }
  const lines = r.summary.failures.length > 0 ? r.summary.failures : tailLines(r);
  const caption = r.summary.failures.length > 0 ? "Failing" : "Last output";
  const verbatim = lines.length > 0 ? [out.verbatim(lines, caption)] : [];
  if (r.verdict === "red") {
    out.fail({ title: failureCount(r), next: out.cmd("rt check") }, ...verbatim);
  } else {
    out.fail({ title: `The check did not finish: ${r.reason ?? "it stopped early"}`, next: out.cmd("rt check") }, ...verbatim);
  }
  out.print(statusBlock(run.status, r.sha));
  process.exitCode = 1;
}

function parseBase(args: string[]): string | null | undefined {
  const joined = args.find((a) => a.startsWith("--base="));
  if (joined !== undefined) return joined.slice("--base=".length) || null;
  const at = args.indexOf("--base");
  if (at === -1) return undefined;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

export async function checkCommand(args: string[], ctx: CommandContext, deps: CheckCommandDeps = realDeps): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();

  const baseArg = parseBase(args);
  if (baseArg === null) {
    out.fail(usageFailure("Which ref should the check diff against?", USAGE));
    process.exitCode = 1;
    return;
  }

  const identity = ctx.identity!;
  const run = await withTransientStep("Running this repo's check", () =>
    deps.run(identity.repoRoot, {
      full: args.includes("--full"),
      post: !args.includes("--no-status"),
      ...(baseArg ? { base: baseArg } : {}),
    }),
  );

  if (json) {
    out.json(checkEnvelope(run));
    if (run.result.configured && run.result.verdict !== "green") process.exitCode = 1;
    return;
  }
  report(run, deps.hostname().split(".")[0] ?? "", repoLabel(identity.identity));
}
