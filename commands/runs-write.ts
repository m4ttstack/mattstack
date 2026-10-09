/**
 * rt runs <write verb>: the pipeline's write side of the run DB. Parsing and
 * printing only; every mutation lives in lib/runs/write.ts.
 *   rt runs run-start   --repo R --work-type T --pipeline P [--run-id ID] [--spawned-by S]
 *                       [--pack-dirs "DIR:DIR"] [--ticket ID] [--mattstack-sha SHA]
 *                       [--mattstack-dirty 0|1] [--pack-sha NAME=VALUE]
 *   rt runs run-status  --status done|failed|abandoned
 *   rt runs stage-start --stage NAME
 *   rt runs stage-done  --stage NAME
 *   rt runs stage-fail  --stage NAME [--reason TEXT] [--detail-path PATH]
 *   rt runs stage-redirect --stage FROM --to TO [--reason TEXT]
 *   rt runs field set   KEY VALUE --stage NAME
 *   rt runs field get   KEY
 *   rt runs decision record --contract C --scope S --selection JSON --decided-by W
 *   rt runs snapshot
 * Decision scopes are free-form. decisions upserts on (run_id, contract,
 * scope), so a gate that can fire more than once inside one attempt appends
 * its own discriminator after the attempt (`ci:<stage>:<attempt>:<branch>`);
 * snapshot returns every row.
 * Every verb but run-start reads RT_RUN_DB; when it is unset, the running run
 * this session recorded, else the newest running run whose worktree holds the
 * cwd, stands in (lib/runs/resolve-db.ts) and JSON envelopes gain
 * "runDbResolved". With agent.integrations.enabled on, a caller its session
 * binding names writes only to a run it owns and records that binding as the
 * run's identity; a caller with no session evidence, or a Claude session no
 * binding names, keeps the environment path. Output is JSON on stdout for
 * every outcome except `field get`. Exit 1 sqlite, 2 usage or environment,
 * 3 not found.
 */
import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import type { CallerContext, Outcome, SessionBinding } from "../packages/rt-client/src/agent-integrations.ts";
import { flagValue, required, Usage } from "../lib/cli-args.ts";
import { emitRunUpdated } from "../lib/runs/emit.ts";
import { resolveOwnedRun, resolveRunDb, type RunDbResolution, type RunDbSource } from "../lib/runs/resolve-db.ts";
import { runStart } from "../lib/runs/start.ts";
import { runsRoot } from "../lib/runs/store.ts";
import {
  decisionRecord, fieldGet, fieldSet, openRunDb, runIdentity, runStatus, snapshot, stageEnd, stageStart,
  type Fail,
} from "../lib/runs/write.ts";
import * as out from "../lib/ui/out.ts";

export type WriteVerb = "run-start" | "run-status" | "stage-start" | "stage-done" | "stage-fail" | "stage-redirect" | "field" | "decision" | "snapshot";
export type CliResult = { out: string; code: number };

/** The verified caller, or null for the environment path. Omitted, the CLI resolves it from its own environment. */
export type RunCaller = Outcome<CallerContext> | null;
export type RunWriteOpts = { caller?: RunCaller };

type Access = "write" | "read";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function fail(f: Fail): CliResult {
  return { out: json({ ok: false, error: f.error }), code: f.code };
}

// A caller who exported RT_RUN_DB sees the envelope the fallback never existed for.
function ok(resolved: RunDbSource, payload: object = {}): CliResult {
  const body = resolved === "env" ? { ok: true, ...payload } : { ok: true, ...payload, runDbResolved: resolved };
  return { out: json(body), code: 0 };
}

function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) { i++; continue; }
    out.push(a);
  }
  return out;
}

async function emitted(env: NodeJS.ProcessEnv, ident: { repo: string; runId: string } | null, stage: string | null, kind: string): Promise<void> {
  if (!ident) return;
  await emitRunUpdated({ repo: ident.repo, runId: ident.runId, stage, kind }, env);
}

/** Loaded only with the switch on, so the environment path never opens state.db. */
async function cliCaller(env: NodeJS.ProcessEnv): Promise<RunCaller> {
  const { integrationsEnabled } = await import("../lib/agent-integrations/switch.ts");
  if (!integrationsEnabled()) return null;
  const { extractCliEvidence, resolveCallerOrEnvironmentNow } = await import("../lib/agent-integrations/context.ts");
  const evidence = extractCliEvidence([], env);
  if (!evidence.ok) return evidence;
  if (!evidence.data.native && evidence.data.raw === undefined) return null;
  return resolveCallerOrEnvironmentNow(evidence.data);
}

function refusal(error: { message: string }): CliResult {
  return { out: json({ ok: false, error: `this call cannot be attributed to a session: ${error.message}` }), code: 2 };
}

/** Resolves the caller once, and only for a verb that reaches a run. */
class Caller {
  private pending: Promise<RunCaller> | undefined;
  constructor(private readonly env: NodeJS.ProcessEnv, private readonly given: RunWriteOpts) {}
  get(): Promise<RunCaller> {
    if ("caller" in this.given) return Promise.resolve(this.given.caller ?? null);
    return (this.pending ??= cliCaller(this.env));
  }
}

export async function runWriteVerb(
  verb: WriteVerb, args: string[], env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd(), opts: RunWriteOpts = {},
): Promise<CliResult> {
  try {
    return await dispatch(verb, args, env, cwd, new Caller(env, opts));
  } catch (err) {
    if (err instanceof Usage) return { out: json({ ok: false, error: err.message }), code: 2 };
    return { out: json({ ok: false, error: `sqlite write failed: ${String(err)}` }), code: 1 };
  }
}

async function dispatch(verb: WriteVerb, args: string[], env: NodeJS.ProcessEnv, cwd: string, caller: Caller): Promise<CliResult> {
  switch (verb) {
    case "run-start": {
      const repo = required(args, "--repo");
      const workType = required(args, "--work-type");
      const pipeline = required(args, "--pipeline");
      const dirty = flagValue(args, "--mattstack-dirty");
      if (dirty !== undefined && dirty !== "0" && dirty !== "1") throw new Usage("--mattstack-dirty must be 0 or 1");
      const packDirs = (flagValue(args, "--pack-dirs") ?? "").split(":").filter((d) => d !== "");
      const who = await caller.get();
      if (who && !who.ok) return refusal(who.error);
      const r = runStart(env.RT_RUNS_ROOT ?? runsRoot(), {
        repo, workType, pipeline,
        runId: flagValue(args, "--run-id"),
        spawnedBy: flagValue(args, "--spawned-by"),
        packDirs,
        ticket: flagValue(args, "--ticket"),
        mattstackSha: flagValue(args, "--mattstack-sha"),
        mattstackDirty: dirty === "1",
        packSha: flagValue(args, "--pack-sha"),
        env,
        ...(who && { binding: who.data.binding }),
      });
      if (!r.ok) return fail(r);
      await emitted(env, { repo, runId: r.runId }, null, "run-start");
      return { out: json({ ok: true, runId: r.runId, runDb: r.runDb }), code: 0 };
    }
    case "run-status": {
      const status = required(args, "--status");
      return withRunDbAsync(env, cwd, caller, "write", async ({ db, resolved }) => {
        const r = runStatus(db, status);
        if (!r.ok) return fail(r);
        await emitted(env, runIdentity(db), null, "run-status");
        return ok(resolved);
      });
    }
    case "stage-start": {
      const stage = required(args, "--stage");
      return withRunDbAsync(env, cwd, caller, "write", async ({ db, resolved, binding }) => {
        const r = stageStart(db, stage, env, Date.now(), binding);
        if (!r.ok) return fail(r);
        await emitted(env, runIdentity(db), stage, "stage-start");
        return ok(resolved);
      });
    }
    case "stage-done":
    case "stage-fail": {
      const stage = required(args, "--stage");
      const reason = flagValue(args, "--reason");
      const detailPath = flagValue(args, "--detail-path");
      return withRunDbAsync(env, cwd, caller, "write", async ({ db, resolved }) => {
        const r = stageEnd(db, stage, verb === "stage-done" ? "done" : "failed", { reason, detailPath });
        if (!r.ok) return fail(r);
        await emitted(env, runIdentity(db), stage, verb);
        return ok(resolved);
      });
    }
    case "stage-redirect": {
      const stage = required(args, "--stage");
      const to = required(args, "--to");
      const reason = flagValue(args, "--reason") ?? `redirected to ${to}`;
      return withRunDbAsync(env, cwd, caller, "write", async ({ db, resolved }) => {
        const r = stageEnd(db, stage, "redirected", { reason, requireRunning: true });
        if (!r.ok) return fail(r);
        await emitted(env, runIdentity(db), stage, "stage-redirect");
        return ok(resolved);
      });
    }
    case "field": {
      const [sub, key, value] = positionals(args);
      if (sub === "set") {
        if (!key || value === undefined) throw new Usage("field set needs KEY VALUE");
        const stage = required(args, "--stage");
        return withRunDbAsync(env, cwd, caller, "write", async ({ db, resolved }) => {
          const r = fieldSet(db, key, value, stage);
          if (!r.ok) return fail(r);
          await emitted(env, runIdentity(db), stage, "field-set");
          return ok(resolved);
        });
      }
      if (sub === "get") {
        if (!key) throw new Usage("field get needs KEY");
        return withRunDbAsync(env, cwd, caller, "read", async ({ db }) => {
          const r = fieldGet(db, key);
          return r.ok ? { out: r.value, code: 0 } : { out: "", code: 3 };
        });
      }
      throw new Usage("field needs set|get");
    }
    case "decision": {
      const [sub] = positionals(args);
      if (sub !== "record") throw new Usage("decision needs record");
      const o = {
        contract: required(args, "--contract"),
        scope: required(args, "--scope"),
        selection: required(args, "--selection"),
        decidedBy: required(args, "--decided-by"),
      };
      return withRunDbAsync(env, cwd, caller, "write", async ({ db, resolved }) => {
        const r = decisionRecord(db, o);
        if (!r.ok) return fail(r);
        await emitted(env, runIdentity(db), o.scope, "decision");
        return ok(resolved);
      });
    }
    case "snapshot":
      return withRunDbAsync(env, cwd, caller, "read", async ({ db, resolved }) => {
        const r = snapshot(db);
        return r.ok ? ok(resolved, { run: r.run, stages: r.stages, fields: r.fields, decisions: r.decisions }) : fail(r);
      });
  }
}

type RunDbHandle = { db: Database; resolved: RunDbSource; binding?: SessionBinding };

/**
 * A write by a verified caller goes only to a run it owns. A read with an
 * explicit RT_RUN_DB never resolves a caller, so the Stop hook's snapshot
 * stays on its fast path; without one, a verified caller's owned run is the
 * session rung and the directory rung stays.
 */
async function locate(env: NodeJS.ProcessEnv, cwd: string, caller: Caller, access: Access): Promise<(RunDbResolution & { binding?: SessionBinding }) | CliResult> {
  if (access === "read" && env.RT_RUN_DB) return resolveRunDb(env, cwd);
  const who = await caller.get();
  if (who === null) return resolveRunDb(env, cwd);
  if (!who.ok) return access === "write" ? refusal(who.error) : resolveRunDb(env, cwd);
  if (access === "read") return resolveRunDb(env, cwd, who.data);
  const owned = resolveOwnedRun(who.data, env.RT_RUN_DB || undefined, { root: env.RT_RUNS_ROOT ?? runsRoot(), cwd });
  if (!owned.ok) return { out: json({ ok: false, error: owned.error.message }), code: 2 };
  return { ok: true, db: owned.data.db, resolved: env.RT_RUN_DB ? "env" : "session", binding: who.data.binding };
}

async function withRunDbAsync(env: NodeJS.ProcessEnv, cwd: string, caller: Caller, access: Access, body: (run: RunDbHandle) => Promise<CliResult>): Promise<CliResult> {
  const found = await locate(env, cwd, caller, access);
  if ("code" in found) return found;
  if (!found.ok) return { out: json({ ok: false, error: found.error }), code: 2 };
  if (!existsSync(found.db)) return { out: json({ ok: false, error: `run DB not found: ${found.db}` }), code: 2 };
  let db: Database | undefined;
  try {
    db = openRunDb(found.db);
    return await body({ db, resolved: found.resolved, ...(found.binding && { binding: found.binding }) });
  } catch (err) {
    return { out: json({ ok: false, error: `sqlite write failed: ${String(err)}` }), code: 1 };
  } finally {
    db?.close();
  }
}

async function finish(result: CliResult): Promise<void> {
  if (result.out !== "") out.payload(`${result.out}\n`);
  if (result.code !== 0) process.exit(result.code);
}

export async function runsRunStart(args: string[]): Promise<void> { await finish(await runWriteVerb("run-start", args)); }
export async function runsRunStatus(args: string[]): Promise<void> { await finish(await runWriteVerb("run-status", args)); }
export async function runsStageStart(args: string[]): Promise<void> { await finish(await runWriteVerb("stage-start", args)); }
export async function runsStageDone(args: string[]): Promise<void> { await finish(await runWriteVerb("stage-done", args)); }
export async function runsStageFail(args: string[]): Promise<void> { await finish(await runWriteVerb("stage-fail", args)); }
export async function runsStageRedirect(args: string[]): Promise<void> { await finish(await runWriteVerb("stage-redirect", args)); }
export async function runsField(args: string[]): Promise<void> { await finish(await runWriteVerb("field", args)); }
export async function runsDecision(args: string[]): Promise<void> { await finish(await runWriteVerb("decision", args)); }
export async function runsSnapshot(args: string[]): Promise<void> { await finish(await runWriteVerb("snapshot", args)); }
