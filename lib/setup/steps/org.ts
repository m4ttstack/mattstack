import { join } from "path";
import { claimPendingAdmin } from "../../team/create.ts";
import { tokenLookupRemoteForHost } from "../../team/forge-token.ts";
import { forgeLogin } from "../../team/forge.ts";
import { readTeamLocal, updateTeamLocal } from "../../team/team-local.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { discoverOrgs, forgeFromRemote, parseOriginUrl, probeUserSettingsReader } from "../team-settings.ts";
import { trustedForgeTokenFor } from "./forge-token.ts";
import { toFailedOutcome } from "./step-utils.ts";

const PULL_TIMEOUT_MS = 180_000;

interface PullReply {
  ok: boolean;
  data?: { outcome: string; detail: string | null };
  error?: string;
  failure?: { code: string; message: string };
}

export function cloneSlugs(p: Pick<Probes, "readDir" | "exists" | "home">): string[] {
  const teams = join(p.home, ".mattstack", "teams");
  return p
    .readDir(teams)
    .filter((name) => p.exists(join(teams, name, ".git", "config")))
    .sort();
}

async function orgPullRun(ctx: ApplyContext): Promise<StepOutcome> {
  const slugs = cloneSlugs(ctx.p);
  if (slugs.length === 0) return { state: "skipped", detail: "No org on this Mac" };
  const notes: string[] = [];
  const skips: string[] = [];
  const stuck: string[] = [];
  for (const slug of slugs) {
    try {
      const res = (await ctx.p.daemon("team:pull", { slug }, PULL_TIMEOUT_MS)) as PullReply | null;
      if (res === null) skips.push("The rt daemon is not running, so the org is pulled once it is");
      else if (!res.ok && res.failure?.code === "no-team") skips.push(`Team sync has not started for ${slug} yet, so it is pulled once it does`);
      else if (!res.ok || !res.data || ["conflict", "skipped"].includes(res.data.outcome))
        stuck.push(`${slug} was not pulled: ${res.data?.detail ?? res.failure?.message ?? res.error ?? res.data?.outcome ?? "the daemon gave no reason"}`);
      else notes.push(res.data.outcome === "up-to-date" ? `${slug} is already up to date` : `Pulled ${slug}`);
    } catch (err) {
      stuck.push(`${slug} was not pulled: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.reloadTeam?.();
  if (stuck.length) return { state: "partial", detail: [...notes, ...skips, ...stuck].join("; "), remedy: "Run rt team status to see what is in the way" };
  if (skips.length) return { state: "skipped", detail: [...notes, ...skips].join("; ") };
  return { state: "done", detail: notes.join("; ") };
}

export const identitySeams = { login: forgeLogin };

export function cloneOrigin(p: Pick<Probes, "readFile" | "home">, slug: string): string | null {
  const raw = p.readFile(join(p.home, ".mattstack", "teams", slug, ".git", "config"));
  return raw === null ? null : parseOriginUrl(raw);
}

async function storedTokenFor(ctx: ApplyContext, host: string): Promise<string | null> {
  const token = await trustedForgeTokenFor(ctx, tokenLookupRemoteForHost(host), {
    read: probeUserSettingsReader(ctx.p),
  });
  if (token) ctx.redact(token);
  return token;
}

export async function recordForgeIdentity(
  p: Probes,
  slug: string,
  forge: { provider: "github" | "gitlab"; host: string } | null,
  token: string | null,
  login: typeof forgeLogin = identitySeams.login,
): Promise<{ username: string | null; outcome: "already" | "recorded" | "unknown"; admin?: { claimed: boolean; published: boolean; detail?: string } }> {
  const stored = readTeamLocal(p, slug).forgeUsername;
  const username = stored ?? (forge ? await login(p, forge.provider, forge.host, token) : (p.env.USER ?? null));
  if (!username) return { username: null, outcome: "unknown" };
  if (!stored) updateTeamLocal(p, slug, { forgeUsername: username });
  const admin = await claimPendingAdmin(p, slug, username, token);
  return { username, outcome: stored ? "already" : "recorded", ...(admin.claimed ? { admin } : {}) };
}

async function teamIdentityRun(ctx: ApplyContext): Promise<StepOutcome> {
  const slug = ctx.team.slug || discoverOrgs(ctx.p)[0] || cloneSlugs(ctx.p)[0] || "";
  if (slug === "") return { state: "skipped", detail: "No org on this Mac" };

  const remote = cloneOrigin(ctx.p, slug);
  const declared = ctx.snapshot?.integrations.forge ?? (remote ? forgeFromRemote(remote) : null);
  const record = readTeamLocal(ctx.p, slug);
  const wanted = declared !== null && (!record.forgeUsername || record.creatorPending !== undefined);
  const token = wanted ? await (ctx.identity?.token ?? storedTokenFor)(ctx, declared.host) : null;
  if (token) ctx.redact(token);
  const result = await recordForgeIdentity(ctx.p, slug, declared, token, ctx.identity?.login);
  if (result.username) ctx.reloadTeam?.();
  if (result.admin?.detail) ctx.log("team.identity", result.admin.detail);
  if (result.admin?.claimed) {
    if (result.admin.published) return { state: "done", detail: `You are ${result.username}, and this org's admin now` };
    const pending = readTeamLocal(ctx.p, slug).creatorPending !== undefined;
    return {
      state: "partial",
      detail: `You are ${result.username} and this org's admin now, but rt could not ${pending ? "save" : "push"} that`,
      remedy: pending ? "Run rt setup apply --only team.identity" : "Run rt team publish",
    };
  }
  if (result.outcome === "already") return { state: "skipped", detail: "Already recorded" };
  if (result.outcome === "recorded") return { state: "done", detail: `You are ${result.username}` };
  if (!declared) return { state: "needs-you", detail: "rt can't tell who you are, and this org is on no forge it knows" };
  const name = declared.provider === "gitlab" ? "GitLab" : "GitHub";
  return { state: "needs-you", detail: `rt can't tell who you are on ${name}. Connect your ${name} account in Setup` };
}

const safe =
  (run: (ctx: ApplyContext) => Promise<StepOutcome>) =>
  async (ctx: ApplyContext): Promise<StepOutcome> => {
    try {
      return await run(ctx);
    } catch (err) {
      return toFailedOutcome(err);
    }
  };

export const orgPullStep: StepDef = {
  id: "org.pull",
  title: "Pull your org",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: async (ctx) => {
    try {
      return await orgPullRun(ctx);
    } catch (err) {
      return { state: "partial", detail: err instanceof Error ? err.message : String(err), remedy: "Run rt team status to see what is in the way" };
    }
  },
};

export const teamIdentityStep: StepDef = {
  id: "team.identity",
  title: "Record who you are",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: safe(teamIdentityRun),
};
