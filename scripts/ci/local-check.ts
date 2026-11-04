/**
 * The local pre-push check for this repo: `rt check` runs it with
 * RT_CHECK_BASE, RT_CHECK_HEAD, RT_CHECK_TREE and optionally RT_CHECK_FULL=1.
 * It picks the unit tests the shards would run for base..head
 * (scripts/ci/test-scope.ts decides), runs them in parallel processes, and
 * prints one JSON summary object as the last line of stdout. The exit code
 * is the verdict; progress and the tests' own output go to stderr.
 */
import { availableParallelism } from "os";
import { spawnSync } from "child_process";
import { join } from "path";
import { boundedTestNames } from "../../lib/check/summary.ts";
import { childEnv } from "../../lib/subprocess.ts";
import {
  collectSources,
  decide,
  ROOT,
  selectedTests,
  unitDirs,
  type Mode,
} from "./test-scope.ts";

const MAX_PROCESSES = 6;
const TEST_TIMEOUT_MS = "20000";

export type Plan = {
  mode: Mode;
  buildClient: boolean;
  dirs: string[];
  changedArg: string | null;
  extra: string[];
  processes: number;
};

export type Summary = {
  mode: Mode | "error";
  selected: number;
  passed: number;
  failed: number;
  durationMs: number;
  failures: string[];
  failedTests?: string[];
};

export function processCount(cores: number): number {
  return Math.min(MAX_PROCESSES, Math.max(1, Math.floor(cores / 2)));
}

export function planLocalCheck(
  base: string,
  head: string,
  full: boolean,
  scope: ReturnType<typeof collectSources>,
  changed: string[],
): Plan {
  const decision = decide({ event: "pull_request", changed, ...scope });
  const processes = processCount(availableParallelism());
  if (full || decision.mode === "full") {
    return { mode: "full", buildClient: true, dirs: unitDirs(), changedArg: null, extra: [], processes };
  }
  const extra = (decision.extra ?? []).map((f) => `./${f}`);
  const reached = selectedTests(changed, scope.tests, scope.graph).length;
  if (decision.mode === "skip" || (reached === 0 && extra.length === 0)) {
    return { mode: "skip", buildClient: false, dirs: [], changedArg: null, extra: [], processes: 0 };
  }
  return {
    mode: "changed",
    buildClient: false,
    dirs: unitDirs(),
    changedArg: `--changed=${base}`,
    extra,
    processes: Math.min(processes, Math.max(1, reached)),
  };
}

const ANSI = /\x1b\[[0-9;]*m/g;
const FILE_HEADER = /^(?:::group::)?(\S+\.test\.tsx?):$/;
const FAILED_TEST = /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/;

// bun prints a file's header just before the first thing that file reports,
// so a (fail) line belongs to the header above it. A file that fails to load
// has no (fail) line: it reports "# Unhandled error between tests" there
// and still counts in "N fail". A long run lists its (fail) lines again at the
// end, so a name is kept once.
export function parseTestOutput(output: string): { passed: number; failed: number; failures: string[]; failedTests: string[]; summarised: boolean } {
  let passed = 0;
  let failed = 0;
  let summarised = false;
  let file: string | null = null;
  const failures: string[] = [];
  const failedTests: string[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(ANSI, "");
    const header = FILE_HEADER.exec(line);
    if (header) {
      file = header[1]!;
      continue;
    }
    const failing = line.startsWith("(fail) ") || line === "# Unhandled error between tests";
    if (failing && file && !failures.includes(file)) failures.push(file);
    const name = FAILED_TEST.exec(line)?.[1];
    if (name && !failedTests.includes(name)) failedTests.push(name);
    const count = /^\s*(\d+) (pass|fail)$/.exec(line);
    if (!count) continue;
    summarised = true;
    if (count[2] === "pass") passed += Number(count[1]);
    else failed += Number(count[1]);
  }
  return { passed, failed, failures, failedTests, summarised };
}

type Ran = { red: boolean; passed: number; failed: number; failures: string[]; failedTests: string[] };

// bun writes its file headers, failures and summary to stderr; stdout carries
// only the version line. A red process always counts at least one failure, so
// a crash reads "1 failed", never "0 failed" beside a red verdict.
export function judgeRun(exitCode: number, stderr: string): Ran {
  const parsed = parseTestOutput(stderr);
  const red = exitCode !== 0 || !parsed.summarised;
  return { red, passed: parsed.passed, failed: red ? Math.max(1, parsed.failed) : parsed.failed, failures: parsed.failures, failedTests: parsed.failedTests };
}

export function summarise(mode: Mode, ran: Ran[], durationMs: number): Summary {
  const passed = ran.reduce((n, r) => n + r.passed, 0);
  const failed = ran.reduce((n, r) => n + r.failed, 0);
  const selected = passed + failed;
  const failedTests = boundedTestNames([...new Set(ran.flatMap((r) => r.failedTests))]);
  return {
    mode: selected === 0 ? "skip" : mode,
    selected,
    passed,
    failed,
    durationMs,
    failures: [...new Set(ran.flatMap((r) => r.failures))],
    ...(failedTests.length > 0 ? { failedTests } : {}),
  };
}

// Each child leads its own group, so a cancel reaches the processes it spawned,
// not only bun.
const live = new Set<ReturnType<typeof Bun.spawn>>();

async function inOwnGroup(args: string[], cwd: string): Promise<{ code: number; output: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, ...args], { cwd, env: childEnv(), stdout: "pipe", stderr: "pipe", detached: true });
  live.add(proc);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  live.delete(proc);
  return { code, output: `${out}${err}`, stderr: err };
}

async function runBun(args: string[], label: string, cwd: string): Promise<Ran> {
  const { code, output, stderr } = await inOwnGroup(["test", ...args], cwd);
  process.stderr.write(`--- ${label} (exit ${code})\n${output}\n`);
  return judgeRun(code, stderr);
}

// The full suite includes dist-freshness, and CI's postinstall builds the same dist.
async function buildRtClient(cwd: string): Promise<void> {
  const { code, output } = await inOwnGroup(["run", "build"], join(cwd, "packages", "rt-client"));
  process.stderr.write(`--- rt-client build (exit ${code})\n${output}\n`);
  if (code !== 0) throw new Error(`the rt-client build exited ${code}`);
}

export type Steps = {
  build: () => Promise<void>;
  test: (args: string[], label: string) => Promise<Ran>;
};

export async function runPlan(plan: Plan, steps: Steps): Promise<Ran[]> {
  if (plan.mode === "skip") return [];
  if (plan.buildClient) await steps.build();
  const shardArgs = (i: number) => [
    ...plan.dirs,
    `--shard=${i}/${plan.processes}`,
    "--timings=test-timings.json",
    "--timeout",
    TEST_TIMEOUT_MS,
    ...(plan.changedArg ? [plan.changedArg] : []),
  ];
  const ran = await Promise.all(Array.from({ length: plan.processes }, (_, i) => steps.test(shardArgs(i + 1), `shard ${i + 1}/${plan.processes}`)));
  if (plan.extra.length) ran.push(await steps.test([...plan.extra, "--timeout", TEST_TIMEOUT_MS], "read-by-path tests"));
  return ran;
}

function changedFiles(base: string, head: string, cwd: string): string[] {
  const diff = spawnSync("git", ["diff", "--no-renames", "--name-only", `${base}..${head}`], { cwd, encoding: "utf8" });
  if (diff.status !== 0) throw new Error(`git diff ${base}..${head} failed: ${diff.stderr}`);
  return diff.stdout.split("\n").filter(Boolean);
}

async function main(started: number): Promise<number> {
  const base = process.env.RT_CHECK_BASE;
  if (!base) {
    console.error("local-check: RT_CHECK_BASE is required (the ref the diff starts from)");
    return 2;
  }
  const head = process.env.RT_CHECK_HEAD || "HEAD";
  const cwd = process.env.RT_CHECK_TREE || ROOT;
  const full = process.env.RT_CHECK_FULL === "1";

  const scope = collectSources();
  const changed = changedFiles(base, head, cwd);
  const plan = planLocalCheck(base, head, full, scope, changed);
  const reached = plan.mode === "changed" ? selectedTests(changed, scope.tests, scope.graph) : plan.mode === "full" ? scope.tests : [];
  const files = new Set([...reached, ...plan.extra.map((f) => f.replace(/^\.\//, ""))]).size;
  console.error(`local-check: ${plan.mode}, ${files} test file(s), ${plan.processes} process(es)`);

  const ran = await runPlan(plan, { build: () => buildRtClient(cwd), test: (args, label) => runBun(args, label, cwd) });
  printSummary(summarise(plan.mode, ran, Date.now() - started));
  return ran.some((r) => r.red) ? 1 : 0;
}

function printSummary(summary: Summary): void {
  console.log(JSON.stringify(summary));
}

// A group that has already exited throws ESRCH, and the summary must still print.
export function stopGroups(pids: number[], kill: (pid: number) => void = (pid) => process.kill(pid, "SIGTERM")): void {
  for (const pid of pids) {
    try {
      kill(-pid);
    } catch {
      continue;
    }
  }
}

async function guarded(): Promise<number> {
  const started = Date.now();
  for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
    process.on(signal, () => {
      stopGroups([...live].map((proc) => proc.pid));
      console.error(`local-check: ${signal}, stopped ${live.size} process(es)`);
      printSummary({ mode: "error", selected: 0, passed: 0, failed: 0, durationMs: Date.now() - started, failures: [] });
      process.exit(code);
    });
  }
  try {
    return await main(started);
  } catch (error) {
    console.error(`local-check: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    printSummary({ mode: "error", selected: 0, passed: 0, failed: 0, durationMs: Date.now() - started, failures: [] });
    return 1;
  }
}

if (import.meta.main) process.exit(await guarded());
