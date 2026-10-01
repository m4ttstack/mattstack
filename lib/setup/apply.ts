/**
 * The apply engine — runs the contract-pinned step list, emitting the NDJSON
 * stream `rt setup apply --json` and mattstack.app's Install button both read
 * (docs/superpowers/specs/2026-08-21-rt-setup-contract.md, "rt setup apply").
 */

import { appBundlePath } from "../deps/resolve.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { setSettingsNoticeSink } from "../settings/write.ts";
import { createRealTeamSecretsSeams } from "../secrets/team-store.ts";
import type { SecretsSeamsFactory } from "../team/join.ts";
import type { RelayClient } from "../team/relay-client.ts";
import { STEP_IDS, type EventId, type NeedRequest, type StepId, type StepKind, type StepState, type TeamRef } from "./contract.ts";
import type { Emit } from "./emit.ts";
import { UserActionableError } from "./errors.ts";
import { readIntent, teamRefFromIntent, clearIntent, type SetupIntent } from "./intent.ts";
import { askAppDirectly, awaitNeed, hasDirectRoute, type NeedReply } from "./need.ts";
import type { Probes } from "./probes.ts";
import { realSecretPresence } from "./plan.ts";
import { readPackRequirements, type PackRequirements } from "./requirements.ts";
import { STEPS } from "./steps/index.ts";
import { MIGRATIONS, migrationEventId, type MigrationDef } from "./migrations/index.ts";
import { readSetupState, setupStatePath, storedVersion, updateSetupState } from "./state.ts";
import { discoverTeams, readTeamSnapshot, type TeamSnapshot } from "./team-settings.ts";
import type { SecretPresence } from "./validators/accounts.ts";

export type StepOutcome =
  | { state: "done"; detail?: string }
  | { state: "partial"; detail: string; remedy?: string }
  | { state: "skipped"; detail: string }
  | { state: "needs-you"; detail: string }
  | { state: "failed"; detail: string; remedy?: string };

export interface ApplyContext {
  p: Probes;
  emit: Emit;
  /**
   * Emits a `log` event under `id`. Step bodies MUST call `ctx.redact(value)`
   * for every secret they read or receive — an API token, a `need` reply, a
   * value pulled through `secrets`/`relay` — BEFORE it can reach a log line
   * or a `StepOutcome.detail`/`remedy`. Only exact values registered that way
   * are scrubbed; this is not a pattern scanner.
   */
  log(id: EventId, line: string): void;
  intent: SetupIntent | null;
  team: TeamRef;
  snapshot: TeamSnapshot | null;
  reqs: PackRequirements[];
  /** Re-reads `snapshot` and `reqs` from disk; the engine calls it after a done or partial `reloadsTeam` step. */
  reloadTeam?: () => void;
  nonInteractive: boolean;
  /** Set only for `rt setup update`: a step must not re-assert anything the member undid since rt put it there (a disabled or removed plugin, an editor rt never installed into). */
  update?: true;
  teamOfOne: boolean;
  appPath: string | null;
  ci: boolean;
  secrets: SecretsSeams;
  /**
   * Builds a team's secret-store seams (ageKeySeam + a sops execSeam pinned
   * to that team's clone root) for one `slug`. Every step that needs to read
   * or write a TEAM-scoped secret (secrets.write's `team-<slug>-<domain>`
   * staged entries, team.join's switchboard-token read) must go through this
   * rather than calling `createRealTeamSecretsSeams` directly — a step that
   * bypasses it and builds its own real seam can never be driven by a fully
   * faked `ctx.secrets` in a test, and would reach the real keychain/sops
   * even under one.
   */
  teamSecrets: SecretsSeamsFactory;
  relay: RelayClient;
  /**
   * The credential-presence check `composePlan`'s account validators (and
   * `verify`) read secrets through. A step must never build its own
   * `realSecretPresence()`/real seams — that bypasses this field and, like
   * `secrets`/`teamSecrets` above, can never be driven by a faked context in
   * a test.
   */
  secretPresence: SecretPresence;
  /**
   * Registers `value` as a secret literal: every `log` line and every `step`
   * event's `detail`/`remedy` emitted afterward has exact occurrences of it
   * replaced with `***` before reaching `emit`. Deliberately exact-string
   * only, never a regex/pattern scrubber — a heuristic over arbitrary command
   * output is false confidence and mangles legitimate text. An unregistered
   * secret is not caught.
   */
  redact(value: string): void;
  /**
   * "no-app" is an rt-side judgment (not the app's), made when a quick
   * pre-check finds no live tray.sock on a run the app did not spawn (a
   * nonInteractive one, or any request the app serves as a plain route);
   * otherwise the real app-gone/timeout dance in `awaitNeed` decides. Typed over
   * `EventId` (not `StepId`) so `rt uninstall`'s action ids — which share
   * this same need protocol and this same context type — typecheck too.
   */
  need(id: EventId, request: NeedRequest): Promise<NeedReply | "timeout" | "app-gone" | "no-app" | "app-unanswerable" | "needs-terminal">;
}

export interface StepDef {
  id: StepId;
  title: string;
  kind: StepKind;
  applies(ctx: ApplyContext): boolean;
  run(ctx: ApplyContext): Promise<StepOutcome>;
  /** The step lands or changes the team clone (team.create, team.join): once it is done or partial, `ctx.snapshot`/`ctx.reqs` are re-read so the steps after it see the team that now exists on disk rather than the one read at apply start. */
  reloadsTeam?: boolean;
  /** The step writes what `intercepts.install` builds its rules from (the repo index or a settings store): an `--only` run of it that lands anything is followed by `intercepts.install`, so a late retry cannot leave the shims behind. */
  feedsIntercepts?: boolean;
  /** Steps an `--only` run of this one needs behind it: each that applies and is not `satisfied` runs first, in registry order. Every listed step must sit earlier in the registry and define `satisfied`. */
  prerequisites?: StepId[];
  /** Whether what this step produces is already complete on disk, judged as strictly as the step's own done check. Read only when the step is an `--only` run's prerequisite; absent reads as unsatisfied. */
  satisfied?(ctx: ApplyContext): boolean | Promise<boolean>;
  /** Safe for `rt setup update` to re-run unattended after an app update: idempotent, never prompts or needs the app, never overwrites a value the user chose. */
  updateSafe?: true;
}

const INTERCEPTS_STEP: StepId = "intercepts.install";

// Re-exported for backward compatibility (and so callers that already import
// it from here, like apply.test.ts, keep working) — the implementation lives
// in need.ts so a step file can import it without a steps/index.ts -> apply.ts
// -> steps/index.ts runtime cycle (apply.ts imports STEPS from steps/index.ts;
// need.ts imports nothing from either).
export { outcomeFromNeed } from "./need.ts";

function stepEventFields(outcome: StepOutcome): { detail?: string; remedy?: string } {
  if (outcome.state === "failed" || outcome.state === "partial") return { detail: outcome.detail, ...(outcome.remedy !== undefined ? { remedy: outcome.remedy } : {}) };
  return outcome.detail !== undefined ? { detail: outcome.detail } : {};
}

/**
 * Resolves `--from` to a start index into `applicable`, or throws a
 * user-actionable exit-2 error before anything reaches the stream.
 *
 * Three cases: no `from` starts at 0; `from` present in `applicable` starts
 * exactly there; `from` a real step id that THIS run's `applies()` gated out
 * (an idempotent step Retry names after it already ran) resumes at the first
 * applicable step at-or-after its position in the contract's full order —
 * never at 0, which would silently redo every already-completed step. An id
 * that is not a step id at all is a typo, not a resume point, and must never
 * quietly re-run the whole install.
 */
function resumeStart(applicable: StepDef[], from: StepId | undefined): number {
  if (from === undefined) return 0;

  if (!STEP_IDS.includes(from)) {
    throw new UserActionableError("unknown-step", `unknown --from step id "${from}" — valid ids: ${STEP_IDS.join(", ")}`);
  }

  const exact = applicable.findIndex((s) => s.id === from);
  if (exact >= 0) return exact;

  const fromPos = STEP_IDS.indexOf(from);
  const next = applicable.findIndex((s) => STEP_IDS.indexOf(s.id) >= fromPos);
  return next < 0 ? applicable.length : next; // nothing left to run — everything at or after `from` is already gone from this run
}

/**
 * Resolves `--only` to the index of the step it names, applying the same
 * refusal `resumeStart` does to an id that is not a step id at all. A real id
 * this run's `applies()` gated out runs nothing (past the end), never the step
 * that happens to sit at its position: running a different one would be worse
 * than running none.
 */
function onlyIndex(applicable: StepDef[], only: StepId): number {
  if (!STEP_IDS.includes(only)) {
    throw new UserActionableError("unknown-step", `unknown --only step id "${only}"; valid ids: ${STEP_IDS.join(", ")}`);
  }
  const exact = applicable.findIndex((s) => s.id === only);
  return exact < 0 ? applicable.length : exact;
}

/**
 * The `--only` queue: the named step, preceded by every prerequisite this run
 * still has to land. A satisfied prerequisite is trusted whole, so its own
 * prerequisites are never walked. One this run gates out is dropped silently,
 * the same way a full run would never reach it.
 */
async function onlyQueue(applicable: StepDef[], target: StepDef, ctx: ApplyContext): Promise<StepDef[]> {
  const picked = new Set<StepDef>([target]);
  const visit = async (step: StepDef): Promise<void> => {
    for (const id of step.prerequisites ?? []) {
      const pre = applicable.find((s) => s.id === id);
      if (!pre || picked.has(pre) || (await pre.satisfied?.(ctx)) === true) continue;
      picked.add(pre);
      await visit(pre);
    }
  };
  await visit(target);
  return applicable.filter((s) => picked.has(s));
}

/** Slots a follow-on step into the unrun part of `queue` at its registry position, so it never waits behind a later step that can fail. */
function enqueueInOrder(queue: StepDef[], next: number, step: StepDef, applicable: StepDef[]): void {
  if (queue.includes(step)) return;
  const at = applicable.indexOf(step);
  const later = queue.findIndex((s, i) => i >= next && applicable.indexOf(s) > at);
  if (later < 0) queue.push(step);
  else queue.splice(later, 0, step);
}

/**
 * Best-effort bookkeeping after the run: never allowed to suppress the terminal `done` event a throw would otherwise swallow. A failure here becomes a `log` warning (tagged with the last step that actually ran) instead of an exception.
 *
 * `lastApplyAt` is written for any terminal outcome, but the intent is the
 * in-flight create/join choice every step still to come reads: only a run that
 * could have finished the install may clear it. `--only` runs one row's step
 * (and what it needs) and leaves the rest untouched, so it never does; `--from`
 * resumes and then runs everything left, so it does.
 * `lastApplyOk` follows the same line: only a run that could have
 * finished the install sets it.
 */
function persistTerminalState(ctx: ApplyContext, ok: boolean, lastRanId: EventId | undefined, oneStepOnly: boolean): void {
  try {
    updateSetupState(ctx.p, (s) => ({ ...s, lastApplyAt: ctx.p.now().toISOString(), ...(oneStepOnly ? {} : { lastApplyOk: ok }) }));
    if (ok && !oneStepOnly) clearIntent(ctx.p);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (lastRanId) ctx.emit({ event: "log", id: lastRanId, line: `warn: setup state not persisted: ${message}` });
  }
}

/**
 * A state file from before `finishedAt` (v1, or none at all) is judged by the
 * daemon and setup intent on disk (parseSetupState). That is written down
 * before a run's first step or migration, while the daemon on disk can only
 * be one this run did not install and the intent one it did not change.
 */
function settleLegacyFinish(ctx: ApplyContext): void {
  const raw = ctx.p.readFile(setupStatePath(ctx.p.home));
  if (raw !== null && storedVersion(raw) >= 2) return;
  try {
    updateSetupState(ctx.p, (s) => s);
  } catch {
    // persistTerminalState makes the same write at the end and reports it.
  }
}

/**
 * Runs an explicit step list against a context — the seam `runApply` closes
 * over `STEPS` for. `plan` lists every applicable step for this run, even
 * ones before `--from`: the app merges `plan` by id and drops `step` events
 * for ids it never saw listed, so a full plan is the only safe choice. Steps
 * before `--from` get NO `step` event at all — the shipped app deliberately
 * preserves a retried run's earlier `done` rows, and a `skipped` event here
 * would overwrite them. `--only` runs the named step behind its unsatisfied
 * `prerequisites` (plus `intercepts.install` after a `feedsIntercepts` step)
 * and is silent about every other id for the same reason.
 */
export async function runApplyWith(steps: StepDef[], ctx: ApplyContext, opts: { from?: StepId; only?: StepId } = {}): Promise<{ ok: boolean; failedStep?: StepId }> {
  const applicable = steps.filter((s) => s.applies(ctx));
  let queue: StepDef[];
  if (opts.only !== undefined) {
    const target = applicable[onlyIndex(applicable, opts.only)];
    queue = target ? await onlyQueue(applicable, target, ctx) : [];
  } else {
    queue = applicable.slice(resumeStart(applicable, opts.from));
  }

  ctx.emit({ event: "plan", steps: applicable.map((s) => ({ id: s.id, title: s.title, kind: s.kind })) });
  settleLegacyFinish(ctx);

  let lastRanId: StepId | undefined;
  let result: { ok: boolean; failedStep?: StepId } = { ok: true };
  let hasBug = false;
  let bug: unknown;

  try {
    for (let i = 0; i < queue.length; i++) {
      const step = queue[i]!;
      lastRanId = step.id;
      ctx.emit({ event: "step", id: step.id, state: "running" });

      let outcome: StepOutcome;
      const outerSink = setSettingsNoticeSink((line) => ctx.log(step.id, line));
      try {
        outcome = await step.run(ctx);
      } catch (err) {
        if (err instanceof UserActionableError) {
          const remedy = typeof err.extra.remedy === "string" ? err.extra.remedy : undefined;
          outcome = { state: "failed", detail: err.message, ...(remedy !== undefined ? { remedy } : {}) };
        } else {
          // A bug, not a user-actionable failure: report it on the stream as
          // any other failed step, but rethrow (below, after the terminal
          // `done` is guaranteed) so the process crashes at exit 1 instead of
          // exiting cleanly at 2 like a real setup problem would.
          const message = err instanceof Error ? err.message : String(err);
          ctx.emit({ event: "step", id: step.id, state: "failed", detail: `bug: ${message}` });
          result = { ok: false, failedStep: step.id };
          hasBug = true;
          bug = err;
          break;
        }
      } finally {
        setSettingsNoticeSink(outerSink);
      }

      if (outcome.state === "failed" && opts.only !== undefined && step.id !== opts.only && step.id !== INTERCEPTS_STEP) {
        outcome = { ...outcome, detail: `${step.title}: ${outcome.detail}` };
      }
      ctx.emit({ event: "step", id: step.id, state: outcome.state, ...stepEventFields(outcome) });

      if (outcome.state === "failed") {
        result = { ok: false, failedStep: step.id };
        break;
      }
      if (step.reloadsTeam && (outcome.state === "done" || outcome.state === "partial")) ctx.reloadTeam?.();
      if (opts.only !== undefined && step.feedsIntercepts && (outcome.state === "done" || outcome.state === "partial")) {
        const follow = applicable.find((s) => s.id === INTERCEPTS_STEP);
        if (follow) enqueueInOrder(queue, i + 1, follow, applicable);
      }
      // Only "failed" stops the run.
    }
  } finally {
    // `lastApplyAt` is written on every terminal outcome, success or
    // failure — a run that dies at step 20 still answers "when did apply
    // last run". `done` is emitted here, in a `finally`, so no exit path
    // (early return, a rethrown bug) can leave the stream without its one
    // required terminal event.
    persistTerminalState(ctx, result.ok, lastRanId, opts.only !== undefined);
    ctx.emit({ event: "done", ok: result.ok, ...(result.failedStep !== undefined ? { failedStep: result.failedStep } : {}) });
  }

  if (hasBug) throw bug;
  return result;
}

export async function runApply(ctx: ApplyContext, opts: { from?: StepId; only?: StepId } = {}): Promise<{ ok: boolean; failedStep?: StepId }> {
  return runApplyWith(STEPS, ctx, opts);
}

export interface UpdateOutcome {
  id: EventId;
  state: StepState;
  detail?: string;
}

export interface UpdateRunResult {
  ok: boolean;
  failedSteps: EventId[];
  outcomes: UpdateOutcome[];
}

interface UpdateItem {
  id: EventId;
  title: string;
  run(ctx: ApplyContext): Promise<StepOutcome>;
  migrationId?: string;
}

function updateItems(steps: StepDef[], migrations: MigrationDef[], applied: readonly string[]): UpdateItem[] {
  const pending = migrations.filter((m) => !applied.includes(m.id)).map<UpdateItem>((m) => ({ id: migrationEventId(m.id), title: m.title, run: (ctx) => m.run(ctx), migrationId: m.id }));
  const safe = steps.filter((s) => s.updateSafe && s.id !== "verify").map<UpdateItem>((s) => ({ id: s.id, title: s.title, run: (ctx) => s.run(ctx) }));
  const verify = steps.find((s) => s.id === "verify" && s.updateSafe);
  return [...pending, ...safe, ...(verify ? [{ id: verify.id, title: verify.title, run: (ctx: ApplyContext) => verify.run(ctx) }] : [])];
}

/**
 * The update run: pending migrations, then every update-safe step in
 * contract order, then verify. No failed outcome stops the run; every
 * item's outcome is collected and `done` names every failure. A migration
 * that throws a plain Error is one more failed outcome, but a step that does
 * is a bug: the run stops there and rethrows after `done`. Migrations that
 * end done or skipped are recorded one at a time, so a crash mid-run loses
 * nothing already recorded. The setup intent is never cleared: an update is
 * not an install.
 */
export async function runUpdateWith(steps: StepDef[], migrations: MigrationDef[], ctx: ApplyContext): Promise<UpdateRunResult> {
  settleLegacyFinish(ctx);
  const items = updateItems(steps, migrations, readSetupState(ctx.p).migrations);
  ctx.emit({ event: "plan", steps: items.map((i) => ({ id: i.id, title: i.title, kind: "rt" as const })) });

  const outcomes: UpdateOutcome[] = [];
  const failedSteps: EventId[] = [];
  let lastRanId: EventId | undefined;
  let bug: { err: unknown } | null = null;

  try {
    for (const item of items) {
      lastRanId = item.id;
      ctx.emit({ event: "step", id: item.id, state: "running" });
      let outcome: StepOutcome;
      try {
        outcome = await item.run(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof UserActionableError) {
          const remedy = typeof err.extra.remedy === "string" ? err.extra.remedy : undefined;
          outcome = { state: "failed", detail: err.message, ...(remedy !== undefined ? { remedy } : {}) };
        } else if (item.migrationId !== undefined) {
          // Migrations run first, so rethrowing here would skip every step and
          // verify; a buggy one fails alone and stays unrecorded instead.
          ctx.log(item.id, `warn: bug: ${message}`);
          outcome = { state: "failed", detail: `bug: ${message}` };
        } else {
          ctx.emit({ event: "step", id: item.id, state: "failed", detail: `bug: ${message}` });
          outcomes.push({ id: item.id, state: "failed", detail: `bug: ${message}` });
          failedSteps.push(item.id);
          bug = { err };
          break;
        }
      }
      ctx.emit({ event: "step", id: item.id, state: outcome.state, ...stepEventFields(outcome) });
      outcomes.push({ id: item.id, state: outcome.state, ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}) });
      if (outcome.state === "failed") failedSteps.push(item.id);
      if (item.migrationId !== undefined && (outcome.state === "done" || outcome.state === "skipped")) {
        const id = item.migrationId;
        updateSetupState(ctx.p, (s) => ({ ...s, migrations: [...s.migrations, id] }));
      }
    }
  } finally {
    const ok = failedSteps.length === 0;
    persistTerminalState(ctx, ok, lastRanId, true);
    ctx.emit({
      event: "done",
      ok,
      ...(failedSteps.length > 0 ? { failedStep: failedSteps[0], failedSteps } : {}),
    });
  }

  if (bug) throw bug.err;
  return { ok: failedSteps.length === 0, failedSteps, outcomes };
}

export async function runUpdate(ctx: ApplyContext): Promise<UpdateRunResult> {
  return runUpdateWith(STEPS, MIGRATIONS, ctx);
}

export interface CreateApplyContextDeps {
  probes: Probes;
  emit: Emit;
  secrets: SecretsSeams;
  /** Defaults to `createRealTeamSecretsSeams` — override for a fully-faked run/test so a team-secret read/write can never fall through to a real keychain/sops. */
  teamSecrets?: SecretsSeamsFactory;
  relay: RelayClient;
  /** Defaults to `realSecretPresence()` — override for a fully-faked run/test so `verify` (and anything else reading `ctx.secretPresence`) can never reach the real keychain/sops. */
  secretPresence?: SecretPresence;
  /** `tty` defaults to whether stdin is a terminal: an admin prompt is only raised for a person at one. */
  flags: { nonInteractive: boolean; teamOfOne: boolean; ci: boolean; appMayDrive?: boolean; tty?: boolean; update?: true };
  /** Threaded straight into `awaitNeed`'s poll loop for the reachable/interactive branch of `need()` — real timers and `Date.now` by default. Tests inject a fake clock/sleep so that branch is driven deterministically instead of pinned to a real 10-minute deadline and 1 s polls. */
  needOpts?: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number };
}

/** Cheap tray reachability probe, distinct from the polling `awaitNeed` does — an id that has never been requested reads as `pending` (200) just like a real one, so this checks a path no `need` id will ever use. */
async function trayReachable(p: Probes): Promise<boolean> {
  const res = await p.tray("/version", { method: "GET" });
  return res.status !== 0;
}

function createRedactor(): { redact(value: string): void; wrap(emit: Emit): Emit } {
  const secrets = new Set<string>();

  function apply(text: string): string {
    let out = text;
    for (const secret of secrets) {
      if (secret) out = out.split(secret).join("***");
    }
    return out;
  }

  return {
    redact(value) {
      if (value) secrets.add(value);
    },
    wrap(emit) {
      return (ev) => {
        if (ev.event === "log") {
          emit({ ...ev, line: apply(ev.line) });
        } else if (ev.event === "step") {
          emit({ ...ev, ...(ev.detail !== undefined ? { detail: apply(ev.detail) } : {}), ...(ev.remedy !== undefined ? { remedy: apply(ev.remedy) } : {}) });
        } else {
          emit(ev);
        }
      };
    },
  };
}

export async function createApplyContext(deps: CreateApplyContextDeps): Promise<ApplyContext> {
  const { probes: p, secrets, relay, flags, needOpts } = deps;

  const intent = readIntent(p);
  const team = teamRefFromIntent(intent, discoverTeams(p));
  const snapshot = team.slug ? readTeamSnapshot(p, team.slug) : null;
  const reqs = team.slug ? readPackRequirements(p, team.slug) : [];
  const appPath = appBundlePath(p);

  const redactor = createRedactor();
  const emit = redactor.wrap(deps.emit);

  // The raw invite decryption key is the highest-value secret the engine
  // itself constructs (readIntent reads it straight off disk) — every other
  // secret a step body handles has to be registered by that step.
  if (intent?.mode === "join" && intent.join) redactor.redact(intent.join.keyB64);

  const ctx: ApplyContext = {
    p,
    emit,
    log(id, line) {
      emit({ event: "log", id, line });
    },
    intent,
    team,
    snapshot,
    reqs,
    reloadTeam() {
      if (!ctx.team.slug) return;
      ctx.snapshot = readTeamSnapshot(p, ctx.team.slug);
      ctx.reqs = readPackRequirements(p, ctx.team.slug);
    },
    nonInteractive: flags.nonInteractive,
    ...(flags.update ? { update: true as const } : {}),
    teamOfOne: flags.teamOfOne,
    appPath,
    ci: flags.ci,
    secrets,
    teamSecrets: deps.teamSecrets ?? createRealTeamSecretsSeams,
    relay,
    secretPresence: deps.secretPresence ?? realSecretPresence(),
    redact: redactor.redact,
    async need(id: EventId, request: NeedRequest): Promise<NeedReply | "timeout" | "app-gone" | "no-app" | "app-unanswerable" | "needs-terminal"> {
      // The app pumps needs only for the rt it spawned, which it marks with
      // RT_APP_SOCKET. Any other run asks the app's plain route for the same
      // work, failing fast when no app is there to take it. An admin prompt
      // is raised only for a person at an interactive terminal: an agent's
      // shell must never put a real password dialog on screen.
      if (!p.env.RT_APP_SOCKET && hasDirectRoute(request)) {
        if (!(await trayReachable(p))) return "no-app";
        const prompts = request.type === "app-privileged";
        if (prompts && flags.nonInteractive) return "app-unanswerable";
        if (prompts && !(flags.tty ?? process.stdin.isTTY === true)) return "needs-terminal";
        if (prompts) emit({ event: "log", id, line: "approve the admin prompt mattstack.app shows" });
        const direct = await askAppDirectly(p.tray, request);
        if (direct !== null) return direct;
      }
      // Reachability is checked BEFORE the `need` event goes out: a
      // nonInteractive run with no live tray.sock has nobody to answer it,
      // so emitting first would strand an unanswerable `need` on the stream.
      // A REACHABLE tray is no better for a nonInteractive run: needs ride
      // the app's own stdout pipe, so only an app-driven run services
      // them — a standalone run would poll ten minutes and fail anyway.
      // Refuse fast with the way out instead. Setup's app spawn never
      // passes --non-interactive, so onboarding keeps emit-and-wait; but
      // uninstall derives nonInteractive from a missing TTY, which the
      // app-driven spawn also lacks — those callers set appMayDrive and
      // keep the wait (their needs ARE serviced).
      if (flags.nonInteractive) {
        if (!(await trayReachable(p))) return "no-app";
        if (!flags.appMayDrive) return "app-unanswerable";
      }
      emit({ event: "need", id, request });
      return awaitNeed(p.tray, id, needOpts);
    },
  };
  return ctx;
}
