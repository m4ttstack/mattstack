import { realpathSync } from "fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "path";
import type { ResolveNext } from "../runs/engine.ts";
import { flagValue } from "../cli-args.ts";
import { runEngineOp, runWriteVerb, type EngineOp, type WriteVerb } from "../../commands/runs-write.ts";
import { listRuns } from "../../packages/rt-client/src/index.ts";
import { packPluginIdentity } from "../skills/provenance.ts";
import { isPathComponent, runsRoot } from "../runs/paths.ts";
import { checkOptional, checkRequired, err, fromResponse, ok, type McpToolDef, type ToolResult } from "./shared.ts";

export interface RunToolDeps {
  write: typeof runWriteVerb;
  list: typeof listRuns;
  realpath: (p: string) => string;
  isPackRoot: (packRoot: string) => boolean;
  engine: typeof runEngineOp;
}

export const realRunToolDeps: RunToolDeps = {
  write: runWriteVerb,
  list: listRuns,
  realpath: (p) => realpathSync(p),
  isPackRoot: (p) => packPluginIdentity(p) !== null,
  engine: runEngineOp,
};

// A quote or substitution in the compiled flag string would need a shell to
// mean anything; a whitespace split cannot honor it, so it is refused rather
// than passed through with a different meaning.
const SHELL_SYNTAX = /['"`$\\]/;

// Matches rt_verb's CONTROL_CHAR, minus tab/LF/CR (\x09,\x0a,\x0d), which
// \s already splits on rather than needing a separate refusal.
const CONTROL_CHAR = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export function splitFlags(flags: string): { ok: true; args: string[] } | { ok: false; error: string } {
  if (SHELL_SYNTAX.test(flags)) return { ok: false, error: "flags must be plain flag tokens; quotes, $ and backticks are refused" };
  if (CONTROL_CHAR.test(flags)) return { ok: false, error: "flags must not contain control characters" };
  return { ok: true, args: flags.split(/\s+/).filter((a) => a !== "") };
}

// The set run-start's own CLI parses (commands/runs-write.ts) minus the ones
// this tool appends itself (--pack-dirs, --ticket, --spawned-by): a flags
// string that named one of those would let its value win over the tool's
// own append, since flagValue resolves the FIRST occurrence in argv.
const RUN_START_FLAGS = new Set(["--repo", "--work-type", "--pipeline", "--run-id", "--mattstack-sha", "--mattstack-dirty", "--pack-sha"]);

function checkRunStartFlags(args: string[]): string | undefined {
  for (const a of args) {
    if (!a.startsWith("--")) continue;
    const name = a.split("=")[0]!;
    if (!RUN_START_FLAGS.has(name)) {
      return `flags may only set ${[...RUN_START_FLAGS].sort().join(", ")}; refuses ${name}`;
    }
  }
  return undefined;
}

export function packRootFrom(skillDir: string, realpath: (p: string) => string): string {
  return realpath(resolve(skillDir, "..", ".."));
}

type Prepared = { args: string[]; packRoot: string };

/** What run_start and run_enter share: the flag string, the skill's pack root and the argv both pass to the run-start parser. */
function prepareStart(input: Record<string, unknown>, deps: RunToolDeps): Prepared | { error: string } {
  const bad = checkRequired(input, [{ name: "flags", type: "string" }, { name: "skillDir", type: "string" }]) ?? checkOptional(input, [{ name: "ticket", type: "string" }, { name: "spawnedBy", type: "string" }]);
  if (bad) return { error: bad };
  const skillDir = input.skillDir as string;
  if (!isAbsolute(skillDir)) return { error: '"skillDir" must be an absolute path' };
  const split = splitFlags(input.flags as string);
  if (!split.ok) return { error: split.error };
  const flagsBad = checkRunStartFlags(split.args);
  if (flagsBad) return { error: flagsBad };
  let packRoot: string;
  try { packRoot = packRootFrom(skillDir, deps.realpath); } catch { return { error: `skillDir ${skillDir} does not resolve` }; }
  if (!deps.isPackRoot(packRoot)) return { error: `skillDir ${skillDir} does not resolve to a pack (no .claude-plugin/plugin.json under ${packRoot})` };
  const args = [...split.args, "--pack-dirs", packRoot];
  if (typeof input.ticket === "string") args.push("--ticket", input.ticket);
  if (typeof input.spawnedBy === "string") args.push("--spawned-by", input.spawnedBy);
  return { args, packRoot };
}

/** realpath of the nearest existing ancestor plus the missing tail, so a path that is not there yet still compares against a realpathed root. */
function realpathLoose(p: string, realpath: (p: string) => string): string {
  try { return realpath(p); } catch { /* fall through to the parent */ }
  const parent = dirname(p);
  return parent === p ? p : join(realpathLoose(parent, realpath), basename(p));
}

/** A handed runDb names a run of the flags' own repo under the runs root. The run may be gone (pruned), so the file need not exist: the path is confined by its real location, and what comes back is rebuilt under the runs root as given, the form enterRun compares. */
function confineHandedRunDb(runDb: string, repo: string, env: NodeJS.ProcessEnv, realpath: (p: string) => string): { ok: true; path: string } | { ok: false; error: string } {
  if (!isAbsolute(runDb)) return { ok: false, error: '"runDb" must be an absolute path' };
  const rawRoot = typeof env.RT_RUNS_ROOT === "string" && env.RT_RUNS_ROOT !== "" ? env.RT_RUNS_ROOT : runsRoot();
  if (!rawRoot) return { ok: false, error: "no runs root is configured" };
  const root = realpathLoose(resolve(rawRoot), realpath);
  let real: string;
  try { real = realpath(runDb); } catch { real = realpathLoose(resolve(runDb), realpath); }
  const base = join(root, repo) + sep;
  if (!real.startsWith(base)) return { ok: false, error: `runDb must be under the runs root for repo ${repo} (${join(root, repo)})` };
  if (basename(real) !== "state.db") return { ok: false, error: 'runDb must name a run store\'s "state.db"' };
  return { ok: true, path: join(rawRoot, repo, real.slice(base.length)) };
}

const RUN_DB_PROPS = {
  runDb: { type: "string", description: "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is this session's run, else the newest running one whose worktree holds cwd." },
  cwd: { type: "string", description: "Absolute worktree path, used only when runDb is omitted." },
};

const NO_RUN = "pass runDb (from run_start) or cwd (the worktree); this server's own directory is not the run's";

function parseOut(out: string): unknown {
  try { return JSON.parse(out); } catch { return null; }
}

/** A caller-supplied runDb must resolve under the runs root and name the
    run store's own file, or it is a path into arbitrary state the daemon
    was never asked to write. The root is realpathed too (tolerating one
    that does not exist yet): a root behind a symlink (macOS /var and /tmp)
    would otherwise fail confinement against the runDb run_start returned. */
function checkRunDb(runDb: string, env: NodeJS.ProcessEnv, realpath: (p: string) => string): { ok: true; real: string } | { ok: false; error: string } {
  if (!isAbsolute(runDb)) return { ok: false, error: '"runDb" must be an absolute path' };
  let real: string;
  try { real = realpath(runDb); } catch { return { ok: false, error: `runDb ${runDb} does not resolve` }; }
  const rawRoot = typeof env.RT_RUNS_ROOT === "string" && env.RT_RUNS_ROOT !== "" ? env.RT_RUNS_ROOT : runsRoot();
  if (!rawRoot) return { ok: false, error: "no runs root is configured" };
  let root = rawRoot;
  try { root = realpath(rawRoot); } catch { /* root need not exist yet; compare against it unresolved */ }
  if (real !== root && !real.startsWith(root.endsWith("/") ? root : `${root}/`)) return { ok: false, error: `runDb must be under the runs root (${root})` };
  if (basename(real) !== "state.db") return { ok: false, error: 'runDb must name a run store\'s "state.db"' };
  return { ok: true, real };
}

/** The pair every run tool but run_start and run_list resolves its DB from. */
function runTarget(input: Record<string, unknown>, env: NodeJS.ProcessEnv, realpath: (p: string) => string): { env: NodeJS.ProcessEnv; cwd: string } | { error: string } {
  const bad = checkOptional(input, [{ name: "runDb", type: "string" }, { name: "cwd", type: "string" }]);
  if (bad) return { error: bad };
  if (input.cwd !== undefined && !isAbsolute(input.cwd as string)) return { error: '"cwd" must be an absolute path' };
  if (typeof input.runDb === "string") {
    const db = checkRunDb(input.runDb, env, realpath);
    if (!db.ok) return { error: db.error };
    return { env: { ...env, RT_RUN_DB: db.real }, cwd: typeof input.cwd === "string" ? input.cwd : "/" };
  }
  if (typeof input.cwd === "string") {
    const { RT_RUN_DB: _unchecked, ...rest } = env;
    return { env: rest, cwd: input.cwd };
  }
  return { error: NO_RUN };
}

const NO_VERB = { none: "MCP only; no rt runs verb" };
const RESOLVE_NEXT = ["retry", "redirect", "iterate", "hold", "abandon", "done"];

function engineFailure(r: { out: string; code: number }, label: string): string {
  const body = parseOut(r.out) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : `${label} failed (exit ${r.code})`;
}

export function runToolDefs(deps: RunToolDeps = realRunToolDeps): McpToolDef[] {
  async function engine(op: EngineOp, input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<ToolResult> {
    const target = runTarget(input, env, deps.realpath);
    if ("error" in target) return err(target.error);
    const r = await deps.engine(op, target.env, target.cwd);
    if (r.code !== 0) return err(engineFailure(r, `run_${op.op}`));
    return ok(parseOut(r.out) ?? { ok: true });
  }

  async function write(verb: WriteVerb, args: string[], input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<ToolResult> {
    const target = runTarget(input, env, deps.realpath);
    if ("error" in target) return err(target.error);
    const r = await deps.write(verb, args, target.env, target.cwd);
    const body = parseOut(r.out);
    if (r.code === 0) return ok(body ?? { ok: true });
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `rt runs ${verb} failed (exit ${r.code})`;
    return err(message);
  }

  return [
    {
      name: "run_start",
      description: "Start a pipeline run and get back its runDb. flags is the compiled run-start flag string verbatim (the {{run-start.flags}} text: --repo, --work-type, --pipeline and friends); skillDir is the loaded skill's own directory (its pack root is derived from it). Pass the returned runDb to every other run_* tool.",
      inputSchema: {
        type: "object",
        properties: {
          flags: { type: "string" },
          skillDir: { type: "string", description: "Absolute path of the loaded skill's directory (CLAUDE_SKILL_DIR)." },
          ticket: { type: "string" },
          spawnedBy: { type: "string" },
        },
        required: ["flags", "skillDir"],
        additionalProperties: false,
      },
      shellForms: ["rt runs run-start", { id: "run-db-env", pattern: /(?<![\w-])(export|unset)\s+RT_RUN_DB\b/, example: "export RT_RUN_DB=/x", note: "keep the runDb run_start returns and pass it on every run_* call" }],
      async handler(input, env) {
        const prepared = prepareStart(input, deps);
        if ("error" in prepared) return err(prepared.error);
        // run-start never resolves a DB, so the pack root stands in for cwd.
        const r = await deps.write("run-start", prepared.args, env, prepared.packRoot);
        const body = parseOut(r.out) as { ok?: boolean; error?: string } | null;
        if (r.code !== 0 || !body?.ok) return err(body?.error ?? `rt runs run-start failed (exit ${r.code})`);
        return ok(body);
      },
    },
    {
      name: "run_stage",
      description: "Record a stage transition on a run: start, done, fail (with reason and detailPath) or redirect (with to and reason).",
      inputSchema: {
        type: "object",
        properties: {
          ...RUN_DB_PROPS,
          action: { type: "string", enum: ["start", "done", "fail", "redirect"] },
          stage: { type: "string" },
          reason: { type: "string" },
          detailPath: { type: "string" },
          to: { type: "string" },
        },
        required: ["action", "stage"],
        additionalProperties: false,
      },
      shellForms: ["rt runs stage-start", "rt runs stage-done", "rt runs stage-fail", "rt runs stage-redirect"],
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "action", type: "string" }, { name: "stage", type: "string" }]) ?? checkOptional(input, [{ name: "reason", type: "string" }, { name: "detailPath", type: "string" }, { name: "to", type: "string" }]);
        if (bad) return err(bad);
        const stage = input.stage as string;
        switch (input.action) {
          case "start": return write("stage-start", ["--stage", stage], input, env);
          case "done": return write("stage-done", ["--stage", stage], input, env);
          case "fail": {
            const args = ["--stage", stage];
            if (typeof input.reason === "string") args.push("--reason", input.reason);
            if (typeof input.detailPath === "string") args.push("--detail-path", input.detailPath);
            return write("stage-fail", args, input, env);
          }
          case "redirect": {
            if (typeof input.to !== "string") return err('"to" is required for a redirect');
            const args = ["--stage", stage, "--to", input.to];
            if (typeof input.reason === "string") args.push("--reason", input.reason);
            return write("stage-redirect", args, input, env);
          }
          default: return err('"action" must be start, done, fail or redirect');
        }
      },
    },
    {
      name: "run_field_set",
      description: "Write one run field (key, value) as produced by a stage.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, key: { type: "string" }, value: { type: "string" }, stage: { type: "string" } }, required: ["key", "value", "stage"], additionalProperties: false },
      shellForms: ["rt runs field set"],
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "key", type: "string" }, { name: "value", type: "string" }, { name: "stage", type: "string" }]);
        if (bad) return err(bad);
        return write("field", ["set", input.key as string, input.value as string, "--stage", input.stage as string], input, env);
      },
    },
    {
      name: "run_field_get",
      description: "Read one run field; errors when the key is not set.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, key: { type: "string" } }, required: ["key"], additionalProperties: false },
      shellForms: ["rt runs field get"],
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "key", type: "string" }]);
        if (bad) return err(bad);
        const target = runTarget(input, env, deps.realpath);
        if ("error" in target) return err(target.error);
        const r = await deps.write("field", ["get", input.key as string], target.env, target.cwd);
        if (r.code === 3) return err(`field "${String(input.key)}" is not set on this run`);
        if (r.code !== 0) return err((parseOut(r.out) as { error?: string } | null)?.error ?? `rt runs field get failed (exit ${r.code})`);
        return ok({ value: r.out });
      },
    },
    {
      name: "run_decision",
      description: "Record a decision on the run; selection is a JSON object and is serialized by the tool.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, contract: { type: "string" }, scope: { type: "string" }, selection: { type: "object" }, decidedBy: { type: "string" } }, required: ["contract", "scope", "selection", "decidedBy"], additionalProperties: false },
      shellForms: ["rt runs decision"],
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "contract", type: "string" }, { name: "scope", type: "string" }, { name: "selection", type: "object" }, { name: "decidedBy", type: "string" }]);
        if (bad) return err(bad);
        return write("decision", ["record", "--contract", input.contract as string, "--scope", input.scope as string, "--selection", JSON.stringify(input.selection), "--decided-by", input.decidedBy as string], input, env);
      },
    },
    {
      name: "run_status",
      description: "Set the run's terminal status: done, failed or abandoned.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, status: { type: "string", enum: ["done", "failed", "abandoned"] } }, required: ["status"], additionalProperties: false },
      shellForms: ["rt runs run-status"],
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "status", type: "string" }]);
        if (bad) return err(bad);
        return write("run-status", ["--status", input.status as string], input, env);
      },
    },
    {
      name: "run_snapshot",
      description: "The run's stages, fields and decisions.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS }, additionalProperties: false },
      shellForms: ["rt runs snapshot"],
      async handler(input, env) { return write("snapshot", [], input, env); },
    },
    {
      name: "run_enter",
      description: "Start, resume or inherit a pipeline run and return where it stands, or the candidate runs to choose between. It returns results and opens no gates; the skill asks any question the result raises.",
      inputSchema: {
        type: "object",
        properties: {
          flags: { type: "string", description: "The compiled run-start flag string verbatim (--repo and --work-type come from it)." },
          skillDir: { type: "string", description: "Absolute path of the loaded skill's directory (CLAUDE_SKILL_DIR)." },
          stage: { type: "string", description: "A standalone verb's own stage name; the run's manifest is that one stage." },
          pipeline: { type: "string", description: "The pipelines.json key to run when the flags' --pipeline is not one." },
          runDb: { type: "string", description: "The runDb a parent run handed down; inherited when its run is still running." },
          resume: { type: "string", description: "A run id in this repo to resume." },
          fresh: { type: "boolean", description: "Start a new run without listing candidates." },
          ticket: { type: "string" },
          spawnedBy: { type: "string" },
        },
        required: ["flags", "skillDir"],
        additionalProperties: false,
      },
      shellForms: NO_VERB,
      async handler(input, env) {
        const bad = checkOptional(input, [{ name: "stage", type: "string" }, { name: "pipeline", type: "string" }, { name: "runDb", type: "string" }, { name: "resume", type: "string" }, { name: "fresh", type: "boolean" }]);
        if (bad) return err(bad);
        const prepared = prepareStart(input, deps);
        if ("error" in prepared) return err(prepared.error);
        const { args, packRoot } = prepared;
        if (typeof input.resume === "string" && !isPathComponent(input.resume)) return err('"resume" must be a run id, a single path component');
        let handedRunDb: string | undefined;
        if (typeof input.runDb === "string") {
          let repo: string | undefined;
          try { repo = flagValue(args, "--repo"); } catch (e) { return err((e as Error).message); }
          if (repo === undefined || !isPathComponent(repo)) return err('flags must name --repo as a single path component to confine "runDb"');
          const handed = confineHandedRunDb(input.runDb, repo, env, deps.realpath);
          if (!handed.ok) return err(handed.error);
          handedRunDb = handed.path;
        }
        const op: EngineOp = { op: "enter", args, packRoot };
        if (typeof input.stage === "string") op.stage = input.stage;
        if (typeof input.pipeline === "string") op.pipeline = input.pipeline;
        if (handedRunDb !== undefined) op.handedRunDb = handedRunDb;
        if (typeof input.resume === "string") op.resume = input.resume;
        if (typeof input.fresh === "boolean") op.fresh = input.fresh;
        const r = await deps.engine(op, env, packRoot);
        if (r.code !== 0) return err(engineFailure(r, "run_enter"));
        return ok(parseOut(r.out) ?? { ok: true });
      },
    },
    {
      name: "run_next",
      description: "Read how a stage ended and move the run on: starts the next stage when every produce is set, or reports failed, held, waiting or the last stage. It returns results and opens no gates.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, stage: { type: "string" } }, required: ["stage"], additionalProperties: false },
      shellForms: NO_VERB,
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "stage", type: "string" }]);
        if (bad) return err(bad);
        return engine({ op: "next", stage: input.stage as string }, input, env);
      },
    },
    {
      name: "run_resolve",
      description: "Apply a gate's answer to a stage: retry, redirect, iterate, hold, abandon or done. It applies the answer it is given and opens no gates.",
      inputSchema: {
        type: "object",
        properties: { ...RUN_DB_PROPS, stage: { type: "string" }, next: { type: "string", enum: RESOLVE_NEXT }, to: { type: "string" }, note: { type: "string" }, decidedBy: { type: "string" } },
        required: ["stage", "next", "decidedBy"],
        additionalProperties: false,
      },
      shellForms: NO_VERB,
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "stage", type: "string" }, { name: "next", type: "string" }, { name: "decidedBy", type: "string" }])
          ?? checkOptional(input, [{ name: "to", type: "string" }, { name: "note", type: "string" }]);
        if (bad) return err(bad);
        if (!RESOLVE_NEXT.includes(input.next as string)) return err(`"next" must be ${RESOLVE_NEXT.join(", ")}`);
        const op: EngineOp = { op: "resolve", stage: input.stage as string, next: input.next as ResolveNext, decidedBy: input.decidedBy as string };
        if (typeof input.to === "string") op.to = input.to;
        if (typeof input.note === "string") op.note = input.note;
        return engine(op, input, env);
      },
    },
    {
      name: "run_hold",
      description: "Record that a stage is held, with an optional reason. It returns the result and opens no gates.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, stage: { type: "string" }, reason: { type: "string" }, decidedBy: { type: "string" } }, required: ["stage", "decidedBy"], additionalProperties: false },
      shellForms: NO_VERB,
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "stage", type: "string" }, { name: "decidedBy", type: "string" }]) ?? checkOptional(input, [{ name: "reason", type: "string" }]);
        if (bad) return err(bad);
        const op: EngineOp = { op: "hold", stage: input.stage as string, decidedBy: input.decidedBy as string };
        if (typeof input.reason === "string") op.reason = input.reason;
        return engine(op, input, env);
      },
    },
    {
      name: "run_close",
      description: "Close a standalone verb's own run as done, failed or abandoned; a run the verb inherited is refused. It returns the result and opens no gates.",
      inputSchema: {
        type: "object",
        properties: { ...RUN_DB_PROPS, workType: { type: "string" }, stage: { type: "string" }, outcome: { type: "string", enum: ["done", "failed", "abandoned"] }, reason: { type: "string" }, detailPath: { type: "string" } },
        required: ["workType", "stage", "outcome"],
        additionalProperties: false,
      },
      shellForms: NO_VERB,
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "workType", type: "string" }, { name: "stage", type: "string" }, { name: "outcome", type: "string" }])
          ?? checkOptional(input, [{ name: "reason", type: "string" }, { name: "detailPath", type: "string" }]);
        if (bad) return err(bad);
        if (input.outcome !== "done" && input.outcome !== "failed" && input.outcome !== "abandoned") return err('"outcome" must be done, failed or abandoned');
        const op: EngineOp = { op: "close", workType: input.workType as string, stage: input.stage as string, outcome: input.outcome };
        if (typeof input.reason === "string") op.reason = input.reason;
        if (typeof input.detailPath === "string") op.detailPath = input.detailPath;
        return engine(op, input, env);
      },
    },
    {
      name: "run_budget",
      description: "Count against a named budget on the run and return spent, remaining and whether it is exhausted. It counts past the limit, never refuses and opens no gates.",
      inputSchema: {
        type: "object",
        properties: { ...RUN_DB_PROPS, key: { type: "string" }, limit: { type: "integer", minimum: 1 }, increment: { type: "integer", minimum: 0 }, stage: { type: "string", description: "Scopes the counter to this stage's latest attempt." } },
        required: ["key", "limit"],
        additionalProperties: false,
      },
      shellForms: NO_VERB,
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "key", type: "string" }, { name: "limit", type: "number" }]) ?? checkOptional(input, [{ name: "increment", type: "number" }, { name: "stage", type: "string" }]);
        if (bad) return err(bad);
        if (!Number.isInteger(input.limit) || (input.limit as number) < 1) return err('"limit" must be an integer of at least 1');
        if (input.increment !== undefined && (!Number.isInteger(input.increment) || (input.increment as number) < 0)) return err('"increment" must be an integer of at least 0');
        const op: EngineOp = { op: "budget", key: input.key as string, limit: input.limit as number };
        if (typeof input.increment === "number") op.increment = input.increment;
        if (typeof input.stage === "string") op.stage = input.stage;
        return engine(op, input, env);
      },
    },
    {
      name: "run_list",
      description: "List runs the daemon knows, newest first, optionally narrowed to one repo directory name.",
      inputSchema: { type: "object", properties: { repo: { type: "string" } }, additionalProperties: false },
      shellForms: [{ id: "rt-runs", pattern: /(?<![\w-])rt\s+runs\b/, example: "rt runs --repo x", note: "run_start, run_stage, run_field_set, run_field_get, run_decision, run_status, run_snapshot, run_enter, run_next, run_resolve, run_hold, run_close, run_budget, run_list" }],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "repo", type: "string" }]);
        if (bad) return err(bad);
        return fromResponse(await deps.list(typeof input.repo === "string" ? input.repo : undefined, {}));
      },
    },
  ];
}
