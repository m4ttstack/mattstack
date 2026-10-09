/**
 * The shepherd-side herd tools: start a herd, spawn and manage worker
 * panes, and (worker side) herd_milestone. No import of commands/herd.ts
 * or commands/chat.ts (both pull in TUI-adjacent modules lib/mcp stays
 * clear of).
 */
import {
  herdAttend, herdClose, herdFollowUp, herdList, herdMilestone, herdResume, herdSpawn, herdStart, herdStatus, herdWrapUp,
} from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { readFileSync } from "fs";
import { resolveRepoTarget } from "./mr-target.ts";
import { runRtVerb } from "./rt-verb.ts";
import {
  boundCaller, callerRefusal, callerWorker, checkOptional, checkRequired, checkStringArray, err, fromResponse, ok, resolveSoleHerd,
  type McpToolDef, type ToolContext,
} from "./shared.ts";
import { checkReadRootPath, checkTempRootPath, readRootsForThisProcess, tempRootsForThisProcess, type ReadRoots } from "./temp-root-guard.ts";

export interface HerdToolDeps {
  start: typeof herdStart; spawn: typeof herdSpawn; close: typeof herdClose; followUp: typeof herdFollowUp; status: typeof herdStatus; list: typeof herdList;
  attend: typeof herdAttend; wrapUp: typeof herdWrapUp; resume: typeof herdResume; milestone: typeof herdMilestone;
  verb: typeof runRtVerb;
  tempRoots: () => string[];
  readRoots: () => ReadRoots;
}

export const realHerdToolDeps: HerdToolDeps = {
  start: herdStart, spawn: herdSpawn, close: herdClose, followUp: herdFollowUp, status: herdStatus, list: herdList,
  attend: herdAttend, wrapUp: herdWrapUp, resume: herdResume, milestone: herdMilestone, verb: runRtVerb,
  tempRoots: tempRootsForThisProcess, readRoots: readRootsForThisProcess,
};

/** herd:spawn provisions a worktree and launches an agent; the default 60s budget is too tight. */
const SPAWN_TIMEOUT_MS = 300_000;
const HERD_PROP = { herd: { type: "string", description: "Herd id; defaults to HERD_ID, else the sole active herd." } };
const NO_SESSION = "CLAUDE_CODE_SESSION_ID is not set; this tool runs inside a Claude Code session";
/** account, model and effort reach cswap and claude as argv; a leading `-` would be parsed as an option. */
const LAUNCH_TOKEN = /^[A-Za-z0-9._@:][A-Za-z0-9._@:[\]-]*$/;
const IN_WORKER = "HERD_JOB is set, so this is a herd worker pane; only the shepherd session runs this tool";
const IN_WORKER_SESSION = "this session is a herd worker; only the shepherd session runs this tool";
const WORKER_MODES = ["herdr", "headless"];
const ASSIGNMENT_FIELDS = ["harness", "model", "effort", "account"];
const TOKEN_RULE = "a plain token (letters, digits, . _ @ : [ ] -, not starting with -)";

/**
 * The session this call acts as: with agent.integrations.enabled on, the
 * verified caller's own session (how a Codex shepherd is known); off, or for
 * an unbound Claude Code session, CLAUDE_CODE_SESSION_ID as before.
 */
async function callerSessionId(env: NodeJS.ProcessEnv, context?: ToolContext): Promise<{ session: string } | { error: string }> {
  const caller = await boundCaller(context);
  if (caller === null) return env.CLAUDE_CODE_SESSION_ID ? { session: env.CLAUDE_CODE_SESSION_ID } : { error: NO_SESSION };
  if (!caller.ok) return { error: callerRefusal(caller.error) };
  if (caller.data.binding.attemptId !== undefined) return { error: IN_WORKER_SESSION };
  return { session: caller.data.binding.native.value };
}

/** The worker-selection inputs, each a plain token, checked before anything is called. */
function checkSelectionInput(input: Record<string, unknown>): string | undefined {
  for (const k of ["account", "model", "effort", "harness"] as const) {
    if (typeof input[k] === "string" && !LAUNCH_TOKEN.test(input[k] as string)) return `${k} must be ${TOKEN_RULE}; got ${JSON.stringify(input[k])}`;
  }
  if (input.mode !== undefined && !WORKER_MODES.includes(input.mode as string)) return `mode must be one of ${WORKER_MODES.join(", ")}`;
  const a = input.assignment;
  if (a === undefined) return undefined;
  if (typeof a !== "object" || a === null || Array.isArray(a)) return "assignment must be an object naming at least a harness";
  const fields = a as Record<string, unknown>;
  const extra = Object.keys(fields).find((k) => !ASSIGNMENT_FIELDS.includes(k));
  if (extra !== undefined) return `assignment takes only ${ASSIGNMENT_FIELDS.join(", ")}; got ${extra}`;
  if (typeof fields.harness !== "string") return "assignment must name a harness";
  for (const k of ASSIGNMENT_FIELDS) {
    if (fields[k] !== undefined && (typeof fields[k] !== "string" || !LAUNCH_TOKEN.test(fields[k] as string))) return `assignment.${k} must be ${TOKEN_RULE}`;
  }
  return undefined;
}

/**
 * Every tool runs with no permission prompt, so a pane reading untrusted
 * text must not reach another session's herd: only the session the daemon
 * records as the herd's shepherd (herd:start, then each herd:resume) may
 * spawn into, close or wrap it up.
 */
async function requireShepherd(herd: string, env: NodeJS.ProcessEnv, status: typeof herdStatus, context?: ToolContext): Promise<string | null> {
  const me = await callerSessionId(env, context);
  if ("error" in me) return me.error;
  const res = await status({ herd });
  if (!res.ok) return fromResponse(res).error ?? `cannot read herd "${herd}"`;
  if (res.data?.herd?.shepherdSession !== me.session) {
    return `this session is not the shepherd of herd "${herd}"; run herd_resume on it first to take it over`;
  }
  return null;
}

async function herdFor(input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<{ herd: string } | { error: string }> {
  if (typeof input.herd === "string") return { herd: input.herd };
  if (env.HERD_ID) return { herd: env.HERD_ID };
  return resolveSoleHerd();
}

export function herdToolDefs(deps: HerdToolDeps = realHerdToolDeps): McpToolDef[] {
  return [
    {
      name: "herd_start",
      description: "Start a herd (room, workspace, gate subscription) for this shepherd session. repo is the repo's identity, checkout path or label.",
      inputSchema: { type: "object", properties: { name: { type: "string" }, repo: { type: "string" }, hidden: { type: "boolean" } }, required: ["name", "repo"], additionalProperties: false },
      shellForms: ["rt herd start"],
      async handler(input, env, _signal, context) {
        if (env.HERD_JOB) return err(IN_WORKER);
        const bad = checkRequired(input, [{ name: "name", type: "string" }, { name: "repo", type: "string" }]) ?? checkOptional(input, [{ name: "hidden", type: "boolean" }]);
        if (bad) return err(bad);
        const me = await callerSessionId(env, context);
        if ("error" in me) return err(me.error);
        const target = await resolveRepoTarget({ repoName: input.repo });
        if (!target.ok) return err(target.error);
        const payload: Commands["herd:start"]["payload"] = { name: input.name as string, repo: target.identity, session: me.session };
        if (typeof input.hidden === "boolean") payload.hidden = input.hidden;
        if (env.HERDR_PANE_ID) payload.callerPane = env.HERDR_PANE_ID;
        return fromResponse(await deps.start(payload));
      },
    },
    {
      name: "herd_spawn",
      description: "Spawn a worker for a job (provisions its worktree, launches the selected harness with the brief). brief is an absolute path to a .md brief file (herd_brief's out) inside the Claude Code temp root or an installed plugin or pack root; its contents become the worker's prompt and must not start with \"-\"; omitted, the job's stored brief is reused. harness, account, model and effort are plain tokens: harness with its options is your own choice of worker, assignment is the user's explicit one and wins. Choose only an enabled, ready harness from agent integrations metadata; a harness that cannot run the job refuses, and none is substituted. A respawn naming no harness, options or mode keeps the job's recorded selection. Only the herd's shepherd session may call it. Takes minutes.",
      inputSchema: {
        type: "object",
        properties: {
          ...HERD_PROP, job: { type: "string" }, brief: { type: "string", description: "Absolute path to the brief file; its contents are sent, not the path." },
          harness: { type: "string", description: "The harness you chose for this worker (claude, codex)." },
          model: { type: "string" }, effort: { type: "string" }, account: { type: "string", description: "A cswap account; Claude Code workers only." },
          mode: { type: "string", enum: WORKER_MODES, description: "herdr (a pane) or headless; omitted, the first mode the harness can run the job in." },
          assignment: {
            type: "object", description: "The user's explicit worker for this job; wins over harness, model, effort and account.",
            properties: { harness: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, account: { type: "string" } },
            required: ["harness"], additionalProperties: false,
          },
          disposable: { type: "boolean" },
        },
        required: ["job"], additionalProperties: false,
      },
      shellForms: ["rt herd spawn", { id: "rt-herd", pattern: /(?<![\w-])rt\s+herd\b/, example: "rt herd stop", note: "herd_start, herd_spawn, herd_brief, herd_close, herd_follow_up, herd_status, herd_list, herd_attend, herd_wrap_up, herd_resume, herd_ask, herd_answer, herd_report, herd_milestone" }],
      async handler(input, env, _signal, context) {
        if (env.HERD_JOB) return err(IN_WORKER);
        // The server does not enforce additionalProperties, and a caller-chosen dir would land the worker in a folder whose
        // .claude/settings.json the caller wrote, with the daemon auto-accepting its trust dialog.
        if ("dir" in input) return err("dir is not accepted: herd_spawn always provisions the job's own worktree");
        const bad = checkRequired(input, [{ name: "job", type: "string" }])
          ?? checkOptional(input, [{ name: "brief", type: "string" }, { name: "harness", type: "string" }, { name: "model", type: "string" }, { name: "effort", type: "string" }, { name: "account", type: "string" }, { name: "mode", type: "string" }, { name: "disposable", type: "boolean" }])
          ?? checkSelectionInput(input);
        if (bad) return err(bad);
        // herd:spawn takes the brief TEXT (the CLI reads --brief <file> itself), so the file is read here, after confinement.
        let brief: string | undefined;
        if (typeof input.brief === "string") {
          const rr = deps.readRoots();
          const check = checkReadRootPath(input.brief, rr.roots, rr.pluginListError);
          if (!check.ok) return err(`brief: ${check.error}`);
          try {
            brief = readFileSync(check.realpath, "utf8");
          } catch (e) {
            return err(`brief: cannot read ${input.brief}: ${(e as Error).message}`);
          }
          // The brief becomes claude's last argv token with no `--` before it, so leading text of `-` is parsed as an option.
          if (brief.trimStart().startsWith("-")) return err("brief: the brief's content must not start with \"-\" (it would be read as a claude option); open it with a heading or prose");
        }
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        const owner = await requireShepherd(h.herd, env, deps.status, context);
        if (owner) return err(owner);
        const payload: Commands["herd:spawn"]["payload"] = { herd: h.herd, job: input.job as string };
        if (brief !== undefined) payload.brief = brief;
        for (const k of ["harness", "model", "effort", "account"] as const) if (typeof input[k] === "string") payload[k] = input[k] as string;
        if (typeof input.mode === "string") payload.mode = input.mode as "herdr" | "headless";
        if (input.assignment !== undefined) payload.assignment = input.assignment as Commands["herd:spawn"]["payload"]["assignment"];
        if (typeof input.disposable === "boolean") payload.disposable = input.disposable;
        return fromResponse(await deps.spawn(payload, { timeoutMs: SPAWN_TIMEOUT_MS }));
      },
    },
    {
      name: "herd_brief",
      description: "Assemble a job brief from the shepherd skill's job template plus a strategy body or method file; fill repeats per template slot as \"slot=value\". Writes to out when given, else returns the brief. out must be an absolute path inside the Claude Code temp root; template, strategies and methodFile must be absolute paths inside the Claude Code temp root or an installed plugin or pack root.",
      inputSchema: { type: "object", properties: { job: { type: "string" }, template: { type: "string" }, strategy: { type: "string" }, strategies: { type: "string" }, methodFile: { type: "string" }, fill: { type: "array", items: { type: "string" } }, out: { type: "string" } }, required: ["job", "template"], additionalProperties: false },
      shellForms: ["rt herd brief"],
      async handler(input) {
        const bad = checkRequired(input, [{ name: "job", type: "string" }, { name: "template", type: "string" }]) ?? checkOptional(input, [{ name: "strategy", type: "string" }, { name: "strategies", type: "string" }, { name: "methodFile", type: "string" }, { name: "out", type: "string" }]) ?? checkStringArray(input, "fill");
        if (bad) return err(bad);
        if (typeof input.out === "string") {
          const check = checkTempRootPath(input.out, deps.tempRoots());
          if (!check.ok) return err(`out: ${check.error}`);
        }
        const readRoots = deps.readRoots();
        for (const field of ["template", "strategies", "methodFile"] as const) {
          if (typeof input[field] !== "string") continue;
          const check = checkReadRootPath(input[field], readRoots.roots, readRoots.pluginListError);
          if (!check.ok) return err(`${field}: ${check.error}`);
        }
        const args = ["herd", "brief", "--job", input.job as string, "--template", input.template as string];
        if (typeof input.strategy === "string") args.push("--strategy", input.strategy);
        if (typeof input.strategies === "string") args.push("--strategies", input.strategies);
        if (typeof input.methodFile === "string") args.push("--method-file", input.methodFile);
        for (const f of (input.fill as string[] | undefined) ?? []) args.push("--fill", f);
        if (typeof input.out === "string") args.push("--out", input.out);
        const r = await deps.verb({ args });
        return r.ok ? ok(r.body) : err(r.error);
      },
    },
    {
      name: "herd_close",
      description: "Close one job's pane. Only the herd's shepherd session may call it.",
      inputSchema: { type: "object", properties: { ...HERD_PROP, job: { type: "string" } }, required: ["job"], additionalProperties: false },
      shellForms: ["rt herd close"],
      async handler(input, env, _signal, context) {
        if (env.HERD_JOB) return err(IN_WORKER);
        const bad = checkRequired(input, [{ name: "job", type: "string" }]);
        if (bad) return err(bad);
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        const owner = await requireShepherd(h.herd, env, deps.status, context);
        if (owner) return err(owner);
        return fromResponse(await deps.close({ herd: h.herd, job: input.job as string }));
      },
    },
    {
      name: "herd_follow_up",
      description: "Reopen a done job for a follow-up round in its same pane: it goes back to active, which stops the watchdog's done-not-closed nag until the job's next report. Only the herd's shepherd session may call it.",
      inputSchema: { type: "object", properties: { ...HERD_PROP, job: { type: "string" } }, required: ["job"], additionalProperties: false },
      shellForms: ["rt herd follow-up"],
      async handler(input, env, _signal, context) {
        if (env.HERD_JOB) return err(IN_WORKER);
        const bad = checkRequired(input, [{ name: "job", type: "string" }]);
        if (bad) return err(bad);
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        const owner = await requireShepherd(h.herd, env, deps.status, context);
        if (owner) return err(owner);
        return fromResponse(await deps.followUp({ herd: h.herd, job: input.job as string }));
      },
    },
    {
      name: "herd_status",
      description: "One herd: jobs, panes, gates, subscription, unread.",
      inputSchema: { type: "object", properties: { ...HERD_PROP }, additionalProperties: false },
      shellForms: ["rt herd status"],
      async handler(input, env) {
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        return fromResponse(await deps.status({ herd: h.herd }));
      },
    },
    {
      name: "herd_list",
      description: "Active herds (all: true includes finished ones).",
      inputSchema: { type: "object", properties: { all: { type: "boolean" } }, additionalProperties: false },
      shellForms: ["rt herd list"],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "all", type: "boolean" }]);
        if (bad) return err(bad);
        return fromResponse(await deps.list(input.all === true ? { all: true } : {}));
      },
    },
    {
      name: "herd_attend",
      description: "Open a job's pane in a tab of this shepherd's workspace. Only the herd's shepherd session may call it.",
      inputSchema: { type: "object", properties: { ...HERD_PROP, job: { type: "string" } }, required: ["job"], additionalProperties: false },
      shellForms: ["rt herd attend"],
      async handler(input, env, _signal, context) {
        if (env.HERD_JOB) return err(IN_WORKER);
        const bad = checkRequired(input, [{ name: "job", type: "string" }]);
        if (bad) return err(bad);
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        const owner = await requireShepherd(h.herd, env, deps.status, context);
        if (owner) return err(owner);
        if (!env.HERDR_WORKSPACE_ID) return err("HERDR_WORKSPACE_ID is not set; this tool runs from a herdr pane");
        return fromResponse(await deps.attend({ herd: h.herd, job: input.job as string, callerWorkspace: env.HERDR_WORKSPACE_ID }));
      },
    },
    {
      name: "herd_wrap_up",
      description: "Close panes, dispose the named worktrees, delete job dirs and archive the room in one pass, driven by the wrap-up form's answers. herd is required; only the herd's shepherd session may call it.",
      inputSchema: { type: "object", properties: { herd: { type: "string", description: "Herd id." }, closePanes: { type: "boolean" }, dispose: { type: "array", items: { type: "string" } }, deleteJobDirs: { type: "boolean" }, archiveRoom: { type: "boolean" } }, required: ["herd"], additionalProperties: false },
      shellForms: ["rt herd wrap-up"],
      async handler(input, env, _signal, context) {
        if (env.HERD_JOB) return err(IN_WORKER);
        const bad = checkRequired(input, [{ name: "herd", type: "string" }]) ?? checkOptional(input, [{ name: "closePanes", type: "boolean" }, { name: "deleteJobDirs", type: "boolean" }, { name: "archiveRoom", type: "boolean" }]) ?? checkStringArray(input, "dispose");
        if (bad) return err(bad);
        const herd = input.herd as string;
        const owner = await requireShepherd(herd, env, deps.status, context);
        if (owner) return err(owner);
        const payload: Commands["herd:wrap-up"]["payload"] = { herd };
        for (const k of ["closePanes", "deleteJobDirs", "archiveRoom"] as const) if (typeof input[k] === "boolean") payload[k] = input[k] as boolean;
        if (Array.isArray(input.dispose)) payload.dispose = input.dispose as string[];
        return fromResponse(await deps.wrapUp(payload));
      },
    },
    {
      name: "herd_resume",
      description: "Re-attach this session to a herd: re-subscribes to its gates and returns the open ones plus status. Any session but a worker pane may take a herd over this way.",
      inputSchema: { type: "object", properties: { herd: { type: "string" } }, required: ["herd"], additionalProperties: false },
      shellForms: ["rt herd resume"],
      async handler(input, env, _signal, context) {
        if (env.HERD_JOB) return err(IN_WORKER);
        const bad = checkRequired(input, [{ name: "herd", type: "string" }]);
        if (bad) return err(bad);
        const me = await callerSessionId(env, context);
        if ("error" in me) return err(me.error);
        const payload: Commands["herd:resume"]["payload"] = { herd: input.herd as string, session: me.session };
        if (env.HERDR_PANE_ID) payload.callerPane = env.HERDR_PANE_ID;
        return fromResponse(await deps.resume(payload));
      },
    },
    {
      name: "herd_milestone",
      description: "Worker side: announce an artifact (a spec, a plan, a PR) to the shepherd and open the milestone gate, using HERD_ID, HERD_JOB and this pane's session.",
      inputSchema: { type: "object", properties: { artifact: { type: "string" }, summary: { type: "string" } }, required: ["artifact"], additionalProperties: false },
      shellForms: ["rt herd milestone"],
      async handler(input, env, _signal, context) {
        const w = await callerWorker(env, context);
        if ("error" in w) return err(w.error);
        const bad = checkRequired(input, [{ name: "artifact", type: "string" }]) ?? checkOptional(input, [{ name: "summary", type: "string" }]);
        if (bad) return err(bad);
        const payload: Commands["herd:milestone"]["payload"] = { ...w, artifact: input.artifact as string };
        if (typeof input.summary === "string") payload.summary = input.summary;
        return fromResponse(await deps.milestone(payload));
      },
    },
  ];
}
