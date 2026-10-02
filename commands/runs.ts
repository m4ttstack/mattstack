/**
 * rt runs: the run DB.
 *   rt runs [--repo R] [--json]           list, newest first
 *   rt runs show <runId> [--repo R] [--json]
 *   rt runs abandon <runId> [--repo R] [--reason TEXT]
 * Reads go through the daemon's runs:* commands; the pipeline's write verbs
 * live in runs-write.ts and open the run DB directly.
 */
import { daemonQuery } from "../lib/daemon-client.ts";
import { tryResolveRepoArg } from "../lib/repo-arg.ts";
import { repoLabel, repoLabelQualified } from "../lib/repo-label.ts";
import { parseIdentity, repoIdentitySlug } from "../lib/settings/identity.ts";
import { listRunRepoDirs } from "../lib/runs/store.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import type { RunDetail, RunSummary } from "../packages/rt-client/src/commands.ts";

function fail(f: out.FailureInput): never {
  out.fail(f);
  process.exit(1);
}

const NO_DAEMON: out.FailureInput = {
  title: "The rt daemon is not running",
  why: "It keeps the record of your runs.",
  next: out.cmd("rt daemon start"),
};

const FLAG_QUESTION: Record<"--repo" | "--reason", [title: string, usage: string]> = {
  "--repo": ["Which repo?", "rt runs --repo <repo>"],
  "--reason": ["What is the reason?", "rt runs abandon <run> --reason <text>"],
};

function flagValue(args: string[], flag: "--repo" | "--reason"): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  // A dangling flag (nothing after it, or the next token is itself a flag)
  // must fail loudly: falling back to "no value" would turn `rt runs --repo`
  // into an unscoped list instead of an error.
  if (v === undefined || v.startsWith("--")) fail(usageFailure(...FLAG_QUESTION[flag]));
  return v;
}

// Index-based scan, not value comparison: a positional that EQUALS a flag's
// value, e.g. `rt runs show abc --repo abc`, must still parse.
const FLAGS_WITH_VALUES = new Set(["--repo", "--reason"]);
function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.has(a)) i++; // skip the flag's value slot
      continue;
    }
    return a;
  }
  return undefined;
}

const RUN_STATUS: Record<string, RenderStatus> = { running: "running", done: "done", failed: "failed", abandoned: "off", redirected: "skipped" };
const RUN_HEADERS = ["STATUS", "RUN", "REPO", "TYPE", "STAGE", "STARTED"];

export function runRow(r: RunSummary): out.CellInput[] {
  const status = RUN_STATUS[r.status];
  const stage = r.status === "running" && r.current_stage ? r.current_stage : "";
  const when = new Date(r.started_at).toISOString().slice(0, 16).replace("T", " ");
  return [status ? { text: r.status, role: status } : r.status, out.strong(r.id), repoLabel(r.repo), r.work_type, out.dim(stage), out.dim(when)];
}

export function runDetailBlocks(d: RunDetail): Block[] {
  const blocks: Block[] = [out.table([runRow(d.run)], RUN_HEADERS)];
  if (d.schemaAhead) blocks.push(out.line("warn", "A newer rt wrote this run", "some of it may be missing here"));
  if (d.stages.length > 0) {
    const stages: Block[] = [];
    for (const s of d.stages) {
      stages.push(out.line(RUN_STATUS[s.status] ?? "pending", s.name, `attempt ${s.attempt}${s.status === "redirected" ? ", redirected" : ""}`));
      if (s.reason) stages.push(out.callout("why", s.reason));
      if (s.detail_path) stages.push(out.callout("note", s.detail_path));
    }
    blocks.push(out.section("Stages", undefined, ...stages));
  }
  if (d.fields.length > 0) blocks.push(out.section("Fields", undefined, out.table(d.fields.map((f) => [out.key(f.key), f.value, out.dim(f.produced_by)]))));
  if (d.decisions.length > 0) blocks.push(out.section("Decisions", undefined, out.table(d.decisions.map((x) => [out.key(x.contract), x.scope, x.selection, out.dim(x.decided_by)]))));
  return blocks;
}

/** Base for resolveRunsRepoArg's user-facing failures -- both need the same
    fail()/JSON-envelope handling in resolveRepoFilter below. */
abstract class RunsRepoArgError extends Error {}

/** Thrown by `resolveRunsRepoArg` when `arg` neither resolves through the
    identity resolver nor names an existing run directory. */
export class UnknownRunsRepo extends RunsRepoArgError {
  constructor(readonly arg: string) {
    super(`unknown repo: ${arg}`);
  }
}

/** Thrown by `resolveRunsRepoArg` when `arg` matches more than one
    registered repo. An ambiguous selector must never fall through to the
    run-dir fallback below, even when it happens to equal a legacy dir name --
    that fallback exists for a resolver that found nothing, not one that
    found too much. */
export class AmbiguousRunsRepo extends RunsRepoArgError {
  constructor(readonly arg: string, readonly matches: string[]) {
    super(`--repo "${arg}" matches more than one repo: ${matches.join(", ")} (pass the full identity)`);
  }
}

/**
 * On disk, a run dir's name is `repoIdentitySlug` of the raw identity id
 * (e.g. "gitlab.com-acme-acme-dev" for "gitlab.com/acme/acme-dev"), never the
 * wire form resolveRepoArg returns (that form's ":" and "%" never named a
 * real dir). This only translates a resolved identity into the key that
 * already names them; it does not rename anything on disk.
 */
export function runDisplayKey(identity: string): string {
  const parsed = parseIdentity(identity);
  return parsed ? repoIdentitySlug(parsed.id) : identity;
}

/**
 * Runs are keyed by their on-disk run-dir name: the display key derived
 * below for runs written after the cutover, but whatever key its pipeline
 * used for a run written before it. Resolve `--repo` like every other
 * command when the arg matches a known repo; when the identity resolver
 * finds NOTHING, forward it verbatim ONLY if a run dir already exists under
 * that literal name (a pre-cutover key). When the resolver instead finds
 * more than one repo, the arg must stay unresolved -- an ambiguous selector
 * that happens to equal a legacy dir name is not "no match", and silently
 * picking the dir would resolve the ambiguity by accident.
 */
export async function resolveRunsRepoArg(arg: string): Promise<string> {
  const resolution = await tryResolveRepoArg(arg);
  if (resolution.kind === "resolved") return runDisplayKey(resolution.identity);
  if (resolution.kind === "ambiguous") {
    throw new AmbiguousRunsRepo(arg, resolution.matches);
  }
  if (listRunRepoDirs().includes(arg)) return arg;
  throw new UnknownRunsRepo(arg);
}

function repoArgFailure(err: RunsRepoArgError): out.FailureInput {
  if (err instanceof AmbiguousRunsRepo) {
    return { title: `More than one repo is called ${err.arg}`, why: `It could be ${err.matches.map(repoLabelQualified).join(" or ")}. Use the full name of the one you mean.` };
  }
  if (err instanceof UnknownRunsRepo) return { title: `rt does not know a repo called ${err.arg}` };
  return { title: err.message };
}

/**
 * Shared `--repo` handling for every runs subcommand: resolves the flag (if
 * present) and exits on an unknown repo, matching the output mode (`--json`
 * envelope vs plain stderr) the rest of each command already uses.
 */
async function resolveRepoFilter(args: string[]): Promise<string | undefined> {
  const repoArg = flagValue(args, "--repo");
  if (!repoArg) return undefined;
  try {
    return await resolveRunsRepoArg(repoArg);
  } catch (err) {
    if (!(err instanceof RunsRepoArgError)) throw err;
    if (args.includes("--json")) {
      out.json({ ok: false, error: err.message });
      process.exit(1);
    }
    fail(repoArgFailure(err));
  }
}

async function fetchRunsForPicker(args: string[]): Promise<RunSummary[]> {
  const repo = await resolveRepoFilter(args);
  const res = await daemonQuery("runs:list", { repo }, 10_000);
  if (!res || !res.ok) return [];
  return (res.data as { runs: RunSummary[] }).runs;
}

async function pickRunId(runs: RunSummary[], message: string): Promise<string | null> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const idWidth = Math.max(...runs.map((r) => r.id.length));
  const options = runs.map((r) => ({
    value: r.id,
    label: r.id.padEnd(idWidth),
    hint: `${repoLabel(r.repo)}  ${r.status}${r.current_stage ? ` @ ${r.current_stage}` : ""}`,
  }));
  return filterableSelect({ message, options, stderr: true });
}

export async function runsList(args: string[]): Promise<void> {
  const stray = positional(args);
  if (stray) {
    out.fail({ title: `rt runs has no command called ${stray}`, next: out.cmd("rt runs --help") });
    process.exit(2);
  }
  const repo = await resolveRepoFilter(args);
  const res = await daemonQuery("runs:list", { repo }, 10_000);
  if (!res) fail(NO_DAEMON);
  if (!res.ok) fail({ title: "Could not list your runs", why: res.error });
  const data = res.data as { runs: RunSummary[] };
  if (args.includes("--json")) {
    out.json(data);
    return;
  }
  if (data.runs.length === 0) {
    out.print(out.line("skipped", "No runs yet"));
    return;
  }
  out.print(out.table(data.runs.map(runRow), RUN_HEADERS));
}

export async function runsShow(args: string[]): Promise<void> {
  let runId = positional(args);
  const json = args.includes("--json");
  if (!runId) {
    const runs = process.stdin.isTTY && !json && !process.env.RT_BATCH
      ? await fetchRunsForPicker(args)
      : [];
    if (runs.length === 0) fail(usageFailure("Which run?", "rt runs show <run>"));
    const picked = await pickRunId(runs, "pick a run to show");
    if (!picked) process.exit(0);
    runId = picked;
  }
  const repo = await resolveRepoFilter(args);
  const res = await daemonQuery("runs:get", { runId, repo }, 10_000);
  if (!res) fail(NO_DAEMON);
  if (!res.ok) fail({ title: "Could not read that run", why: res.error });
  const data = res.data as RunDetail;
  if (json) {
    out.json(data);
    return;
  }
  out.print(...runDetailBlocks(data));
}

export async function runsAbandon(args: string[]): Promise<void> {
  let runId = positional(args);
  const json = args.includes("--json");
  if (!runId) {
    const runs = process.stdin.isTTY && !json && !process.env.RT_BATCH
      ? await fetchRunsForPicker(args)
      : [];
    const targets = runs.filter((r) => r.status === "running");
    const pick = targets.length > 0 ? targets : runs;
    if (pick.length === 0) fail(usageFailure("Which run?", "rt runs abandon <run>"));
    const picked = await pickRunId(pick, "pick a run to abandon");
    if (!picked) process.exit(0);
    runId = picked;
  }
  const repo = await resolveRepoFilter(args);
  const reason = flagValue(args, "--reason") ?? "reconciled by hand";
  const res = await daemonQuery("runs:abandon", { runId, repo, reason });
  if (!res) fail(NO_DAEMON);
  if (!res.ok) fail({ title: "Could not abandon that run", why: res.error });
  out.print(out.line("done", `Marked ${runId} abandoned`));
}
