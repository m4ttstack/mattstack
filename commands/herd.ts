/**
 * rt herd ... CLI over the herd registry. Thin client, same idiom as
 * commands/gate.ts: parse args, call the wrapper, print a line or --json.
 *
 *   rt herd start --name <n> [--repo <path>] [--hidden]
 *   rt herd spawn --herd <id> --job <name> [--brief <file>] [--dir <path>] [--model M] [--effort E] [--account A] [--disposable]
 *   rt herd ask --questions <json> [--context <text>]
 *   rt herd milestone --artifact <path> [--summary <text>]
 *   rt herd answer <gate>
 *   rt herd report [--file <path>]
 *   rt herd gates [--herd <id>]
 *   rt herd status [--herd <id>]
 *   rt herd list [--all]
 *   rt herd resume [<id>]
 *   rt herd close <job> --herd <id>
 *   rt herd follow-up <job> --herd <id>
 *   rt herd attend <job> --herd <id>
 *   rt herd wrap-up <id> [--close-panes] [--dispose <job>...] [--delete-job-dirs] [--archive-room]
 *   rt herd stop --hidden
 *   rt herd brief --job <name> --template <path> [--strategy <name> --strategies <path>] [--method-file <path>] [--fill <name>=<value> ...] [--out <path>]
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  herdStart, herdSpawn, herdAsk, herdMilestone, herdAnswer, herdReport, herdGates,
  herdStatus, herdList, herdResume, herdClose, herdFollowUp, herdAttend, herdWrapUp, herdStopHidden,
} from "../packages/rt-client/src/index.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import type { Commands, GateRow, HerdListRow, HerdStatusData, RtResponse } from "../packages/rt-client/src/index.ts";
import { resolveRepoArg, currentRepoIdentity } from "../lib/repo-arg.ts";
import { assembleBrief, type BriefInputs } from "../lib/herd-brief.ts";
import { selfPaneRef } from "../lib/self-pane.ts";
import { callerCswapAccount } from "../lib/cswap.ts";
import { shellQuote } from "../lib/herdr-launch.ts";

function fail(msg: string): never {
  out.diagnostic(`rt herd: ${msg}\n`);
  process.exit(1);
}

// Index-based scan, same reasoning as commands/gate.ts's positional(): a
// positional that equals a flag's value must still parse as positional.
const FLAGS_WITH_VALUES = new Set([
  "--name", "--repo", "--herd", "--job", "--brief", "--dir", "--model", "--effort",
  "--account", "--questions", "--context", "--artifact", "--summary", "--file",
  "--dispose", "--session",
]);

export function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.has(a)) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

export function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export function flagValues(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1]) out.push(args[++i]!);
  return out;
}

const has = (args: string[], flag: string) => args.includes(flag);
/** A cold worktree provision, the trust wait and the wait for the worker's session all run inside one spawn; herd_spawn allows the same. */
const SPAWN_TIMEOUT_MS = 300_000;

function unwrap<T>(res: RtResponse<T>, label: string): T {
  if (!res.ok || res.data === undefined) fail(res.error ?? `${label} failed`);
  return res.data;
}

function say(text: string): void {
  out.payload(`${text}\n`);
}

function show(blocks: () => Block[], frozen: () => string): void {
  if (out.isHuman()) out.print(...blocks());
  else say(frozen());
}

function emit(json: boolean, data: unknown, line: string): void {
  if (json) out.json(data, 2);
  else say(line);
}

const JOB_STATUS: Record<HerdStatusData["jobs"][number]["status"], { word: string; role: Segment["role"] }> = {
  spawning: { word: "starting", role: "pending" },
  active: { word: "working", role: "running" },
  "at-gate": { word: "waiting on you", role: "needs-you" },
  "at-milestone": { word: "waiting on you", role: "needs-you" },
  "stuck-at-modal": { word: "stuck at a prompt", role: "needs-you" },
  done: { word: "done", role: "done" },
  closed: { word: "closed", role: "off" },
  crashed: { word: "crashed", role: "failed" },
};

export function herdListBlocks(herds: HerdListRow[], all = false): Block[] {
  if (herds.length === 0) return all ? [out.line("skipped", "No herds")] : [out.line("skipped", "No herds"), out.callout("next", out.cmd("rt herd list --all"))];
  return [
    out.table(
      herds.map((h) => [out.strong(h.id), { text: h.status, role: h.status === "active" ? "running" : "off" }, out.dim(`room ${h.room}`), `${h.jobs} ${h.jobs === 1 ? "job" : "jobs"}`]),
    ),
  ];
}

export function herdGatesBlocks(gates: GateRow[]): Block[] {
  if (gates.length === 0) return [out.line("skipped", "No open gates")];
  return [out.table(gates.map((g) => [out.strong(g.id), g.kind, g.subject, out.dim(g.questions.map((q) => q.label).join(" | "))]))];
}

export function herdStatusBlocks(data: HerdStatusData): Block[] {
  const id = data.herd.id;
  const facts = [out.kv("unread", String(data.unread)), out.kv("push", `${data.push.state}, last delivery ${pushAge(data.push.lastDelivery)}`)];
  const problems: Block[] = [];
  if (!data.subscription) problems.push(out.line("needs-you", "This session is not subscribed to the herd"), out.callout("next", out.cmd(`rt herd resume ${id}`)));
  else if (data.subscription.dead) problems.push(out.line("warn", "The herd subscription stopped delivering"), out.callout("next", out.cmd(`rt herd resume ${id}`)));
  if (!data.lifecycleConnected) problems.push(out.line("warn", "Lifecycle events are not reaching the herd"));
  if (data.hiddenUp === false) problems.push(out.line("warn", "The hidden herd session is down"));
  if (data.push.state === "unreachable") problems.push(out.line("warn", "This session's inbox cannot be reached", `last delivery ${pushAge(data.push.lastDelivery)}`));
  const rows: out.CellInput[][] = [];
  for (const j of data.jobs) {
    const s = j.sessionDead ? { word: "session gone", role: "failed" as const } : JOB_STATUS[j.status];
    const poked = j.watchdog && j.watchdog.strikes > 0 ? `poked ${j.watchdog.strikes}x${j.watchdog.lastPokeAt === null ? "" : ` ${ago(j.watchdog.lastPokeAt)}`}` : "";
    const worker = [j.harness, j.model, j.mode].filter(Boolean).join(" ");
    const where = j.mode === "headless" ? "no pane" : `pane ${j.pane ?? "-"}`;
    const liveness = j.sessionDead ? "" : j.mode === "headless" ? j.liveness ?? "" : j.paneStatus ?? "-";
    rows.push([out.strong(j.name), { text: s.word, role: s.role }, out.dim(where), out.dim([worker, liveness, j.openGate ? `gate ${j.openGate}` : "", poked].filter(Boolean).join(" · "))]);
    if (j.sessionDead) problems.push(out.line("failed", j.mode === "headless" ? `${j.name}: the worker session is gone` : `${j.name}: the pane is open but Claude is gone`), out.callout("next", out.cmd(`rt herd spawn --herd ${j.herd} --job ${j.name}`)));
    if (j.status === "stuck-at-modal") problems.push(out.line("needs-you", `${j.name} is waiting at a trust prompt`, `accept it in pane ${j.pane ?? "-"}`));
    const terminal = j.lastGateStatus === "answered" || j.lastGateStatus === "closed";
    if (terminal && j.lastGateDelivery === "dead-pane") problems.push(out.line("needs-you", `${j.name} did not see the update to gate ${j.lastGate}`), out.callout("next", out.cmd(`rt chat dm ${shellQuote(j.handleName ?? j.handle)} ${shellQuote(`Please read the update to gate ${j.lastGate}.`)}`)));
    if (j.lastGateConsumed === false) problems.push(out.line("warn", `${j.name} has not read the update to gate ${j.lastGate}`));
  }
  return [out.section(id, `room ${data.herd.room}`, ...facts, ...(rows.length > 0 ? [out.table(rows)] : [out.line("skipped", "No jobs yet")]), ...problems)];
}

/** The job's identity alone. Verbs that do not open a gate need this and no
    more: a session id they never send must not be a reason to refuse. */
export function jobEnv(env: Record<string, string | undefined>): { herd: string; job: string } {
  const herd = env.HERD_ID, job = env.HERD_JOB;
  if (!herd || !job) throw new Error("HERD_ID and HERD_JOB are not set; this verb runs inside a herd worker pane");
  return { herd, job };
}

export function workerEnv(env: Record<string, string | undefined>): { herd: string; job: string; session: string; pane?: string } {
  const { herd, job } = jobEnv(env);
  const session = env.CLAUDE_CODE_SESSION_ID;
  if (!session) throw new Error("CLAUDE_CODE_SESSION_ID is not set; this verb runs inside a Claude Code session");
  return { herd, job, session, ...(env.HERDR_PANE_ID && { pane: env.HERDR_PANE_ID }) };
}

export function buildAskPayload(
  args: string[], env: Record<string, string | undefined>, worker: () => ReturnType<typeof workerCallPayload> = () => workerEnv(env),
): Commands["herd:ask"]["payload"] {
  const raw = flagValue(args, "--questions");
  if (!raw) throw new Error("usage: rt herd ask --questions <json> [--context <text>]");
  let questions: unknown;
  try {
    questions = JSON.parse(raw);
  } catch {
    throw new Error(`--questions is not valid JSON: ${raw}`);
  }
  if (!Array.isArray(questions)) throw new Error("--questions must be a JSON array");
  const w = worker();
  const context = flagValue(args, "--context");
  return { ...w, questions: questions as Commands["herd:ask"]["payload"]["questions"], ...(context && { context }) };
}

export function buildSpawnPayload(args: string[]): Commands["herd:spawn"]["payload"] {
  const herd = flagValue(args, "--herd") ?? process.env.HERD_ID;
  const job = flagValue(args, "--job");
  if (!herd || !job) throw new Error("usage: rt herd spawn --herd <id> --job <name> [--brief <file>] [--dir <path>] [--model M] [--effort E] [--account A] [--disposable]");
  const briefFile = flagValue(args, "--brief");
  const brief = briefFile ? readFileSync(briefFile, "utf8") : undefined;
  const p: Commands["herd:spawn"]["payload"] = { herd, job };
  if (brief !== undefined) p.brief = brief;
  const dir = flagValue(args, "--dir");
  if (dir) p.dir = dir;
  const options: { model?: string; effort?: string; account?: string } = {};
  for (const k of ["model", "effort", "account"] as const) {
    const v = flagValue(args, `--${k}`);
    if (v) options[k] = v;
  }
  // A person naming a harness here is the user's explicit assignment, which wins over any shepherd choice.
  const harness = flagValue(args, "--harness");
  if (harness) p.assignment = { harness, ...options };
  else Object.assign(p, options);
  const mode = flagValue(args, "--mode");
  if (mode) {
    if (mode !== "herdr" && mode !== "headless") throw new Error(`--mode must be herdr or headless; got ${mode}`);
    p.mode = mode;
  }
  if (args.includes("--disposable")) p.disposable = true;
  return p;
}

/**
 * The caller's cswap account as a hint, for a spawn that names no account:
 * the daemon applies it only when the worker's harness takes an account
 * (Claude Code), since the CLI cannot know which harness a respawn keeps.
 */
export async function withCallerAccount(
  p: Commands["herd:spawn"]["payload"],
  resolveAccount: () => Promise<string | undefined> = () => callerCswapAccount(process.env),
): Promise<Commands["herd:spawn"]["payload"]> {
  if (p.account || p.assignment?.account) return p;
  const account = await resolveAccount();
  return account ? { ...p, callerAccount: account } : p;
}

export function buildWrapUpPayload(args: string[]): Commands["herd:wrap-up"]["payload"] {
  const herd = positional(args);
  if (!herd) throw new Error("usage: rt herd wrap-up <id> [--close-panes] [--dispose <job>...] [--delete-job-dirs] [--archive-room]");
  return {
    herd,
    closePanes: has(args, "--close-panes"),
    dispose: flagValues(args, "--dispose"),
    deleteJobDirs: has(args, "--delete-job-dirs"),
    archiveRoom: has(args, "--archive-room"),
  };
}

/** A shepherd usually runs one herd, and an id it could have looked up is
    friction; two or none is genuinely ambiguous and gets the usage instead. */
export function soleHerdId(herds: Array<{ id: string }>): string | null {
  return herds.length === 1 ? herds[0]!.id : null;
}

export function renderHerdRow(h: HerdListRow): string {
  return `${h.id}  ${h.status}  room ${h.room}  ${h.jobs} ${h.jobs === 1 ? "job" : "jobs"}`;
}

async function soleHerd(usage: string): Promise<string> {
  const id = soleHerdId(unwrap(await herdList({}), "list").herds);
  if (id) return id;
  fail(`${usage} (rt herd list shows the herds)`);
}

async function repoFor(args: string[]): Promise<string> {
  const arg = flagValue(args, "--repo");
  if (arg) return resolveRepoArg(arg, fail);
  const id = currentRepoIdentity();
  if (!id) fail("not inside a repo: pass --repo <path>");
  return id;
}

export async function start(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const name = flagValue(args, "--name");
  if (!name) fail("usage: rt herd start --name <n> [--repo <path>] [--hidden]");
  const session = flagValue(args, "--session") ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!session) fail("run inside a Claude Code session (or pass --session <id>)");
  const data = unwrap(await herdStart({ name, repo: await repoFor(args), session, hidden: has(args, "--hidden"), callerPane: selfPaneRef() }), "start");
  emit(json, data, `herd ${data.herd}\nroom ${data.room}\nworkspace ${data.workspace}\nsubscription ${data.subscription}${data.hidden ? "\nhidden: yes" : ""}`);
}

export async function spawn(args: string[]): Promise<void> {
  const json = has(args, "--json");
  let payload: Commands["herd:spawn"]["payload"];
  try {
    payload = buildSpawnPayload(args);
  } catch (e) {
    fail((e as Error).message);
  }
  const data = unwrap(await herdSpawn(await withCallerAccount(payload), { timeoutMs: SPAWN_TIMEOUT_MS }), "spawn");
  const trustNote = data.trust === "stuck" ? " (STUCK AT TRUST MODAL)"
    : data.trust === "needs-person" ? " (TRUST PROMPT LEFT TO YOU: this repo pre-approves tool permissions)"
    : data.trust === "accepted" ? " (trust dialog accepted)" : "";
  const upNote = data.sessionUp === false ? " (SESSION NOT UP YET)" : "";
  emit(json, data, `${data.job} pane ${data.pane} worktree ${data.worktree} session ${data.sessionId}${data.wasOnDeck === false ? " (cold provision)" : ""}${trustNote}${upNote}`);
}

export async function ask(args: string[]): Promise<void> {
  const json = has(args, "--json");
  let payload: Commands["herd:ask"]["payload"];
  try {
    const { native } = await workerSession(args);
    payload = buildAskPayload(args, process.env, () => workerCallPayload(process.env, native));
  } catch (e) {
    fail((e as Error).message);
  }
  const data = unwrap(await herdAsk(payload), "ask");
  emit(json, data, `holding at gate ${data.gate}`);
}

export async function milestone(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const artifact = flagValue(args, "--artifact");
  if (!artifact) fail("usage: rt herd milestone --artifact <path> [--summary <text>]");
  let w: ReturnType<typeof workerCallPayload>;
  try {
    const { native } = await workerSession(args);
    w = workerCallPayload(process.env, native);
  } catch (e) {
    fail((e as Error).message);
  }
  const summary = flagValue(args, "--summary");
  // The shepherd reads this path from its own cwd, which is never the worker's.
  const data = unwrap(await herdMilestone({ ...w, artifact: resolve(artifact), ...(summary && { summary }) }), "milestone");
  emit(json, data, `holding at gate ${data.gate}`);
}

/**
 * Every non-answered status has to read as "no answer exists", because the
 * worker's next move on seeing one is to keep waiting, not to proceed. An
 * `answered` row whose `answer` is null is the same case: rendering it as an
 * answer of `{}` would invite the worker to invent one.
 */
export function renderAnswer(gate: string, data: Commands["herd:answer"]["data"]): string {
  if (data.status === "open") return `gate ${gate} is still open`;
  if (data.status === "closed") return `gate ${gate} closed (${data.closedReason ?? "no reason"}); do not invent an answer`;
  if (data.status === "parked") return `gate ${gate} is parked; do not invent an answer, wait for it to be answered`;
  if (!data.answer) return `gate ${gate} is marked answered but carries no answer; do not invent one, ask the shepherd`;
  return `gate ${gate} answered by ${data.answer.by}:\n${JSON.stringify(data.answer.answers, null, 2)}`;
}

export async function answer(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const gate = positional(args);
  if (!gate) fail("usage: rt herd answer <gate>");
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  const data = unwrap(await herdAnswer({ gate, ...(sessionId ? { sessionId } : {}) }), "answer");
  emit(json, data, renderAnswer(gate, data));
}

export type ReportCaller = { session?: string; harness?: string; bound: boolean };

/**
 * The session a report is authorized by. Off, none is sent. On, the bound
 * session this command runs in, else an unbound Claude worker's own
 * CLAUDE_CODE_SESSION_ID (one spawned with the switch off, which its job row
 * records).
 */
export function reportSession(switchOn: boolean, native: { harness: string; value: string } | undefined, env: Record<string, string | undefined>): ReportCaller {
  if (!switchOn) return { bound: false };
  if (native) return { session: native.value, ...(native.harness !== "claude" && { harness: native.harness }), bound: true };
  return env.CLAUDE_CODE_SESSION_ID ? { session: env.CLAUDE_CODE_SESSION_ID, bound: false } : { bound: false };
}

/** The session this command's own evidence names, bound or replaced; undefined with the switch off. */
async function workerSession(args: string[]): Promise<{ on: boolean; native?: { harness: string; value: string } }> {
  const { integrationsEnabled, resolveCliWorkerSession } = await import("../lib/agent-integrations/context.ts");
  if (!integrationsEnabled()) return { on: false };
  const native = resolveCliWorkerSession(args, process.env);
  return { on: true, ...(native && { native }) };
}

async function reportCaller(args: string[]): Promise<ReportCaller> {
  const { on, native } = await workerSession(args);
  return reportSession(on, native, process.env);
}

/**
 * The worker identity an ask or a milestone sends. With no session the
 * command's evidence names (the switch off, an unbound Claude worker), the
 * environment's, as before. Otherwise that session, with HERD_ID and
 * HERD_JOB only as a request: the daemon checks them against the session's
 * own attempt, and a replaced worker is refused there. A Codex worker's
 * environment belongs to its app server, so its pane is left to the job row.
 */
export function workerCallPayload(
  env: Record<string, string | undefined>, native: { harness: string; value: string } | undefined,
): { herd?: string; job?: string; session: string; pane?: string; harness?: string } {
  if (!native) return workerEnv(env);
  const job = env.HERD_ID && env.HERD_JOB ? { herd: env.HERD_ID, job: env.HERD_JOB } : {};
  return {
    ...job, session: native.value,
    ...(native.harness === "claude" ? env.HERDR_PANE_ID && { pane: env.HERDR_PANE_ID } : { harness: native.harness }),
  };
}

/**
 * The job a report names: HERD_ID and HERD_JOB, or, for a headless worker
 * whose environment has neither, nothing at all when its bound session was
 * resolved (integrations on), so the daemon takes the job from that
 * session's attempt.
 */
export function reportJob(env: Record<string, string | undefined>, caller: ReportCaller): Partial<ReturnType<typeof jobEnv>> | { error: string } {
  try {
    return jobEnv(env);
  } catch (e) {
    return caller.bound ? {} : { error: (e as Error).message };
  }
}

export async function report(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const caller = await reportCaller(args);
  const w = reportJob(process.env, caller);
  if ("error" in w) fail(w.error);
  const file = flagValue(args, "--file");
  let body: string;
  if (file) {
    try {
      body = readFileSync(file, "utf8");
    } catch (e) {
      fail((e as Error).message);
    }
  } else {
    body = await Bun.stdin.text();
  }
  if (!body.trim()) fail("empty report body (pass --file <path> or pipe the body on stdin)");
  const data = unwrap(await herdReport({ ...w, body, ...(caller.session !== undefined && { session: caller.session }), ...(caller.harness !== undefined && { harness: caller.harness }) }), "report");
  emit(json, data, `reported (message #${data.message})`);
}

export async function gates(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const herd = flagValue(args, "--herd") ?? process.env.HERD_ID ?? await soleHerd("usage: rt herd gates --herd <id>");
  const data = unwrap(await herdGates({ herd }), "gates");
  if (json) return void out.json(data, 2);
  show(
    () => herdGatesBlocks(data.gates),
    () => data.gates.length === 0 ? "no open gates" : data.gates.map((g) => `${g.id}  ${g.kind}  ${g.subject}  ${g.questions.map((q) => q.label).join(" | ")}`).join("\n"),
  );
}

/** Wall-clock, not an injected `now()`: this formats a timestamp for a
    one-shot CLI render, and there is no seam worth threading for it. */
function ago(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const pushAge = (lastDelivery: HerdStatusData["push"]["lastDelivery"]): string => (lastDelivery ? ago(lastDelivery.at) : "never");

/** A missing subscription and an answered-but-undelivered gate are the two
    states the shepherd must act on, so both name their own remedy inline. */
export function renderStatus(data: HerdStatusData): string {
  const sub = data.subscription ? `subscription ${data.subscription.id}${data.subscription.dead ? " DEAD" : ""}` : "subscription MISSING (run rt herd resume)";
  const push = `push: ${data.push.state} (last delivery ${pushAge(data.push.lastDelivery)})`;
  const lines = [
    `${data.herd.id}  room ${data.herd.room}  unread ${data.unread}  lifecycle ${data.lifecycleConnected ? "connected" : "OFF"}${data.hiddenUp === null ? "" : `  hidden ${data.hiddenUp ? "up" : "DOWN"}`}  ${push}  ${sub}`,
  ];
  for (const j of data.jobs) {
    // Both terminal states, because both are a wake the pane never got: a
    // closed gate leaves a form-blocked worker just as stuck as an unread
    // answer does, and the dead-pane retry is what it is waiting on.
    const terminal = j.lastGateStatus === "answered" || j.lastGateStatus === "closed";
    const notWoken = terminal && j.lastGateDelivery === "dead-pane" ? `  gate ${j.lastGate} ${j.lastGateStatus}, worker not woken: rt chat dm ${j.handleName ?? j.handle}` : "";
    // Independent of notWoken: a delivered nudge can still sit UNCONSUMED
    // (the pane never read it), and a dead-pane row can be both at once.
    const unconsumed = j.lastGateConsumed === false ? `  gate ${j.lastGate} UNCONSUMED` : "";
    // The worker never read its brief, and nothing else on the row says so:
    // the pane reads blocked exactly as a mid-run permission prompt does.
    const atModal = j.status === "stuck-at-modal" ? `  STUCK AT TRUST MODAL: accept it in pane ${j.pane ?? "-"}; the watchdog resumes watching once the agent is idle or working` : "";
    // The shell outlives a killed claude, so the row's own status is the last
    // thing the worker managed to record and says nothing about right now.
    const dead = j.sessionDead ? `  SESSION DEAD (pane alive, no claude): rt herd spawn --herd ${j.herd} --job ${j.name}` : "";
    const poked = j.watchdog && j.watchdog.strikes > 0 ? `  poked ${j.watchdog.strikes}x${j.watchdog.lastPokeAt === null ? "" : ` ${ago(j.watchdog.lastPokeAt)}`}` : "";
    lines.push(`  ${j.name.padEnd(24)} ${j.status.padEnd(14)} pane ${j.pane ?? "-"}  ${j.paneStatus ?? "-"}${j.openGate ? `  gate ${j.openGate}` : ""}${notWoken}${unconsumed}${atModal}${dead}${poked}`);
  }
  return lines.join("\n");
}

export async function status(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const herd = flagValue(args, "--herd") ?? process.env.HERD_ID ?? await soleHerd("usage: rt herd status --herd <id>");
  const data = unwrap(await herdStatus({ herd }), "status");
  if (json) out.json(data, 2);
  else show(() => herdStatusBlocks(data), () => renderStatus(data));
}

export async function list(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const data = unwrap(await herdList({ all: has(args, "--all") }), "list");
  if (json) return void out.json(data, 2);
  show(
    () => herdListBlocks(data.herds, has(args, "--all")),
    () => data.herds.length === 0 ? "no herds" : data.herds.map(renderHerdRow).join("\n"),
  );
}

export function renderResumed(herd: string, data: Commands["herd:resume"]["data"]): string {
  const name = data.status.herd.shepherdName ?? data.handle;
  return `resumed ${herd} as ${name}: subscription ${data.subscription}, ${data.gates.length} open gate(s), ${data.unread} unread`;
}

export async function resume(args: string[]): Promise<void> {
  const json = has(args, "--json");
  // HERD_ID deliberately not consulted: every worker pane carries it, and a
  // worker resuming would re-point the shepherd's subscription at itself.
  const herd = positional(args) ?? await soleHerd("usage: rt herd resume <id>");
  const session = flagValue(args, "--session") ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!session) fail("run inside a Claude Code session (or pass --session <id>)");
  const data = unwrap(await herdResume({ herd, session, callerPane: selfPaneRef() }), "resume");
  if (json) {
    emit(true, data, "");
    return;
  }
  say(renderResumed(herd, data));
  for (const g of data.gates) say(`  ${g.id}  ${g.kind}  ${g.subject}`);
}

export async function close(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const job = positional(args);
  const herd = flagValue(args, "--herd") ?? process.env.HERD_ID;
  if (!job || !herd) fail("usage: rt herd close <job> --herd <id>");
  const data = unwrap(await herdClose({ herd, job }), "close");
  emit(json, data, `${data.job} closed`);
  if (!json && data.warning) say(`  ${data.warning}`);
}

export async function followUp(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const job = positional(args);
  const herd = flagValue(args, "--herd") ?? process.env.HERD_ID;
  if (!job || !herd) fail("usage: rt herd follow-up <job> --herd <id>");
  const data = unwrap(await herdFollowUp({ herd, job }), "follow-up");
  emit(json, data, `${data.job} is in a follow-up round; it reads as active until its next report`);
}

export async function attend(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const job = positional(args);
  const herd = flagValue(args, "--herd") ?? process.env.HERD_ID;
  const callerWorkspace = process.env.HERDR_WORKSPACE_ID;
  if (!job || !herd) fail("usage: rt herd attend <job> --herd <id>");
  if (!callerWorkspace) fail("HERDR_WORKSPACE_ID is not set; run from a herdr pane");
  const data = unwrap(await herdAttend({ herd, job, callerWorkspace }), "attend");
  emit(json, data, `attached in tab ${data.tab}; detach with ctrl+b q, then close the tab`);
}

export async function wrapUp(args: string[]): Promise<void> {
  const json = has(args, "--json");
  let payload: Commands["herd:wrap-up"]["payload"];
  try {
    payload = buildWrapUpPayload(args);
  } catch (e) {
    fail((e as Error).message);
  }
  const data = unwrap(await herdWrapUp(payload), "wrap-up");
  if (json) {
    emit(true, data, "");
    return;
  }
  say(`closed ${data.closed.length} pane(s)${data.workspaceClosed ? ", workspace closed" : ""}; disposed ${data.disposed.join(", ") || "none"}; job dirs ${data.deletedJobDirs ? "deleted" : "kept"}; room ${data.archived ? "archived" : "kept"}`);
  for (const r of data.refused) say(`  refused ${r.tree}: ${r.reason}`);
}

export async function stop(args: string[]): Promise<void> {
  if (!has(args, "--hidden")) fail("usage: rt herd stop --hidden");
  const data = unwrap(await herdStopHidden({}), "stop");
  emit(has(args, "--json"), data, "hidden herd session stopped");
}

const BRIEF_USAGE =
  "usage: rt herd brief --job <name> --template <path> [--strategy <name> --strategies <path>] [--method-file <path>] [--fill <name>=<value> ...] [--out <path>]";

export function buildBriefInputs(args: string[]): BriefInputs {
  const job = flagValue(args, "--job");
  const templatePath = flagValue(args, "--template");
  if (!job || !templatePath) throw new Error(BRIEF_USAGE);

  const strategyName = flagValue(args, "--strategy");
  const strategiesPath = flagValue(args, "--strategies");
  const methodFilePath = flagValue(args, "--method-file");
  if (methodFilePath && (strategyName || strategiesPath)) {
    throw new Error("--method-file is mutually exclusive with --strategy/--strategies");
  }
  if (!methodFilePath && !(strategyName && strategiesPath)) {
    throw new Error("pass either --method-file <path>, or both --strategy <name> and --strategies <path>");
  }

  const template = readFileSync(templatePath, "utf8");
  const method: BriefInputs["method"] = methodFilePath
    ? { kind: "file", content: readFileSync(methodFilePath, "utf8") }
    : { kind: "strategy", strategies: readFileSync(strategiesPath!, "utf8"), name: strategyName! };

  const fills: Record<string, string> = {};
  for (const raw of flagValues(args, "--fill")) {
    const eq = raw.indexOf("=");
    if (eq < 0) throw new Error(`--fill must be name=value, got: ${raw}`);
    fills[raw.slice(0, eq)] = raw.slice(eq + 1);
  }

  return { template, job, fills, method };
}

export async function brief(args: string[]): Promise<void> {
  const json = has(args, "--json");
  let inputs: BriefInputs;
  try {
    inputs = buildBriefInputs(args);
  } catch (e) {
    fail((e as Error).message);
  }

  const result = assembleBrief(inputs);
  if (!result.ok) {
    fail(result.error);
  }

  const outPath = flagValue(args, "--out");
  if (outPath) {
    const resolved = resolve(outPath);
    try {
      writeFileSync(resolved, result.brief);
    } catch (e) {
      fail(`cannot write --out ${resolved}: ${(e as Error).message}`);
    }
    emit(true, { ok: true, path: resolved }, "");
    return;
  }
  emit(json, { ok: true, brief: result.brief }, result.brief);
}
