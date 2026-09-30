/**
 * `team.create` / `team.join` — thin StepDef wrappers over the T16/T18 team
 * library (lib/team/create.ts, publish.ts, join.ts): every git/relay/forge
 * call lives there, never reimplemented or shelled out to the `rt team` CLI
 * here.
 */

import { createTeam, type CreateTeamOpts } from "../../team/create.ts";
import { forgeLogin } from "../../team/forge.ts";
import { JoinKeyExchangeError, JoinPeeringStoreError, joinRedeem, realJoinRedeemSeams, type JoinResult } from "../../team/join.ts";
import { personalStoreReady, readSecret, writeSecret } from "../../secrets/store.ts";
import { readTeamLocal, updateTeamLocal } from "../../team/team-local.ts";
import { boardEnvHasSwitchboardToken } from "../../team/board-token.ts";
import { parse } from "jsonc-parser";
import { join } from "path";
import { discoverTeams, readTeamSnapshot } from "../team-settings.ts";
import { isValidHttpsUrl } from "../host-validate.ts";
import type { Probes } from "../probes.ts";
import { publishTeam } from "../../team/publish.ts";
import { forgeTokenFor } from "./forge-token.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import type { StepId } from "../contract.ts";
import { UserActionableError } from "../errors.ts";
import { readIntent } from "../intent.ts";
import { discoverTeams, parseOriginUrl } from "../team-settings.ts";
import { toFailedOutcome } from "./step-utils.ts";

/**
 * Resolves this run's create opts from whichever source triggered
 * `applies()`: an explicit `intent.mode === "create"` carries its own
 * name/remote/others already, resolved earlier by `rt team create`; the
 * team-of-one headless path has neither, so it falls back to
 * RT_TEAM_NAME/RT_TEAM_REMOTE and a `gh`-derived repo owner. Returns null for
 * the one case that must never reach `createTeam` at all — team-of-one with
 * no remote source — so the caller can report an honest skip instead of
 * `createTeam` throwing `remote-required` (that error is a real failure only
 * when an intent explicitly asked for create).
 */
async function resolveCreateOpts(ctx: ApplyContext): Promise<CreateTeamOpts | "no-remote-source"> {
  const { p } = ctx;
  const intentTeam = ctx.intent?.mode === "create" ? ctx.intent.team : undefined;

  if (intentTeam) {
    const createRepoOwner = intentTeam.remote ? undefined : ((await forgeLogin(p, "github", "github.com")) ?? undefined);
    return { name: intentTeam.name, remote: intentTeam.remote || null, createRepoOwner, others: intentTeam.others };
  }

  const envRemote = p.env.RT_TEAM_REMOTE ?? null;
  const createRepoOwner = envRemote ? undefined : ((await forgeLogin(p, "github", "github.com")) ?? undefined);
  if (!envRemote && !createRepoOwner) return "no-remote-source";
  return { name: p.env.RT_TEAM_NAME ?? "personal", remote: envRemote, createRepoOwner, others: false };
}

async function teamCreateRun(ctx: ApplyContext): Promise<StepOutcome> {
  const opts = await resolveCreateOpts(ctx);
  if (opts === "no-remote-source") {
    return { state: "skipped", detail: "no git remote available (set RT_TEAM_REMOTE or run gh auth login)" };
  }

  let created;
  try {
    created = await createTeam(ctx.p, opts, ctx.secrets.ageKeySeam);
  } catch (err) {
    // createTeam's own git-step failures are all UserActionableError, but its
    // ensureAgeKey call (a keychain/age-keygen subprocess) is not wrapped and
    // can throw a plain Error — that must still become a failed step, not a
    // crash.
    if (err instanceof UserActionableError) return { state: "failed", detail: err.message };
    return toFailedOutcome(err);
  }

  try {
    const published = await publishTeam(ctx.p, created.slug, null, { token: await forgeTokenFor(ctx, created.remote), tokenRemote: created.remote });
    return { state: "done", detail: published.detail };
  } catch (err) {
    if (err instanceof UserActionableError) {
      const remedy = err.code === "push-denied" ? "Check your push access to the team repo, then Retry" : undefined;
      return { state: "failed", detail: err.message, ...(remedy !== undefined ? { remedy } : {}) };
    }
    return toFailedOutcome(err);
  }
}

/** `no-join-intent` (the real code `joinRedeem` throws for this) only ever means one thing at this point in the run: `applies()` gated this step in from a `ctx.intent` snapshot taken before the run started, and a prior drive of this exact step already redeemed the invite and cleared it — `joinRedeem` clears intent on full success. That is a completed join, not a missing one. */
function noJoinIntentOnDisk(ctx: ApplyContext): boolean {
  const intent = readIntent(ctx.p);
  return intent?.mode !== "join" || !intent.join;
}

/** A joined team with no stored board token is never "done": `partial` keeps the Install screen on the remedy instead of advancing past it. */
export function outcomeFromJoin(result: JoinResult): StepOutcome {
  if (result.access === "ok") {
    if (result.peering === "unavailable") {
      return { state: "partial", detail: result.message, ...(result.peeringFix !== undefined ? { remedy: result.peeringFix } : {}) };
    }
    return { state: "done", detail: result.message };
  }
  if (result.access === "denied") {
    return { state: "failed", detail: result.message, remedy: "Ask the owner to grant access, then Retry" };
  }
  return { state: "failed", detail: result.message, remedy: "Check your network, then Retry" };
}

/** Both post-redeem errors fire after the invite is spent, so their fix is never "get a new code". */
export function outcomeFromJoinError(err: unknown): StepOutcome {
  if (err instanceof JoinKeyExchangeError) {
    return {
      state: "failed",
      detail: err.message,
      remedy: "Unlock your keychain, then Retry — the invite is already redeemed, so Retry resumes here without a new code",
    };
  }
  if (err instanceof JoinPeeringStoreError) {
    return {
      state: "failed",
      detail: err.message,
      remedy: "Fix the secrets store (Retry from home.init if it never ran), then Retry: the invite is already redeemed, so Retry resumes here without a new code",
    };
  }
  if (err instanceof UserActionableError && err.code === "secrets-store-not-ready") {
    return { state: "failed", detail: err.message, remedy: "Retry from home.init (or run `rt home init`), then Retry: no new code needed" };
  }
  if (err instanceof UserActionableError) return { state: "failed", detail: err.message };
  return toFailedOutcome(err);
}

/** A finished join clears its intent, so the stamp it leaves is what keeps the step in a later plan while the board may still lack its token. */
function peeringPendingTeams(ctx: ApplyContext): string[] {
  return discoverTeams(ctx.p).filter((slug) => readTeamLocal(ctx.p, slug).peeringPending === true);
}

const REINVITE_FIX =
  "ask the team's owner for a new invite (`rt team invite --handle <your forge username>`) and run `rt team join` with it, or ask them to re-invite your board from the board's members panel";

const ALREADY_JOINED: StepOutcome = { state: "skipped", detail: "already joined — no invite in progress" };

/** Reads the one team's own store, never the resolver's multi-team overlay, so each stamp is judged by its own team's declaration. */
function declaresHttpsSwitchboard(p: Probes, slug: string): boolean {
  const raw = p.readFile(join(p.home, ".mattstack", "teams", slug, "mattstack", "settings.team.jsonc"));
  const parsed: unknown = raw === null ? undefined : parse(raw, [], { allowTrailingComma: true });
  const store = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const url = readTeamSnapshot(p, slug, { read: <T>(key: string) => store[key] as T | undefined, warn: () => {} }).integrations.switchboard?.url;
  return !!url && isValidHttpsUrl(url);
}

/** The board takes its token from its own .env first (where its peer-join writes) and rt's secret second, so either one clears the stamp. */
async function recheckPendingPeering(ctx: ApplyContext, stamped: string[]): Promise<StepOutcome> {
  // A team that dropped its switchboard, or broke its URL, has nothing a re-invite could peer.
  const pending = stamped.filter((slug) => declaresHttpsSwitchboard(ctx.p, slug));
  for (const slug of stamped) if (!pending.includes(slug)) updateTeamLocal(ctx.p, slug, { peeringPending: false });
  if (pending.length === 0) return ALREADY_JOINED;

  if (!boardEnvHasSwitchboardToken(ctx.p)) {
    let token: string | null;
    try {
      token = await readSecret("rt", "switchboardToken", ctx.secrets);
    } catch (err) {
      return {
        state: "partial",
        detail: `could not read your secrets store (${err instanceof Error ? err.message : String(err)}) to check your board's switchboard token`,
        remedy: "Unlock your keychain, then Retry",
      };
    }
    if (token === null) {
      return { state: "partial", detail: `joined ${pending.join(", ")}, but this machine's board has no switchboard token, so it does not peer`, remedy: REINVITE_FIX };
    }
    ctx.redact(token);
  }
  for (const slug of pending) updateTeamLocal(ctx.p, slug, { peeringPending: false });
  return ALREADY_JOINED;
}

async function teamJoinRun(ctx: ApplyContext): Promise<StepOutcome> {
  if (noJoinIntentOnDisk(ctx)) {
    const pending = peeringPendingTeams(ctx);
    return pending.length > 0 ? recheckPendingPeering(ctx, pending) : ALREADY_JOINED;
  }

  // realJoinRedeemSeams()'s ageKeySeam is overridden with ctx.secrets.ageKeySeam
  // — the one already threaded through the whole apply run (and what tests
  // fake) — so join's own key exchange never reaches for a second,
  // independently-real keychain seam. ctx.teamSecrets is the same discipline
  // for the team-secret (switchboard token) read.
  const seams = {
    ...realJoinRedeemSeams(),
    ageKeySeam: ctx.secrets.ageKeySeam,
    forgeToken: (_p: unknown, remote: string) => forgeTokenFor(ctx, remote),
    localStoreReady: () => personalStoreReady(ctx.secrets),
    writeLocalSecret: (key: string, value: string) => writeSecret("rt", key, value, ctx.secrets),
  };

  try {
    return outcomeFromJoin(await joinRedeem(ctx.p, ctx.relay, ctx.teamSecrets, {}, seams));
  } catch (err) {
    return outcomeFromJoinError(err);
  }
}

/** A create or join that stopped partway leaves a folder without these, and must run again. */
function teamCloned(ctx: ApplyContext): boolean {
  if (ctx.team.slug === "" || !discoverTeams(ctx.p).includes(ctx.team.slug)) return false;
  const config = ctx.p.readFile(join(ctx.p.home, ".mattstack", "teams", ctx.team.slug, ".git", "config"));
  return config !== null && parseOriginUrl(config) !== null;
}

const HOME_STEPS: StepId[] = ["home.init", "home.restore"];

export const teamCreateStep: StepDef = {
  reloadsTeam: true,
  id: "team.create",
  feedsIntercepts: true,
  title: "Create your team",
  kind: "rt",
  prerequisites: HOME_STEPS,
  satisfied: teamCloned,
  applies: (ctx) => ctx.intent?.mode === "create" || (ctx.teamOfOne && ctx.intent === null && ctx.team.slug === ""),
  run: teamCreateRun,
};

export const teamJoinStep: StepDef = {
  reloadsTeam: true,
  id: "team.join",
  feedsIntercepts: true,
  title: "Join your team",
  titleFor: (ctx) => (ctx.intent?.mode === "join" ? "Join your team" : "Team membership"),
  kind: "rt",
  prerequisites: HOME_STEPS,
  satisfied: teamCloned,
  applies: (ctx) => ctx.intent?.mode === "join" || peeringPendingTeams(ctx).length > 0,
  run: teamJoinRun,
};
