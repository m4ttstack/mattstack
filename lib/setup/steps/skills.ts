/**
 * `skills.materialize`, `board.keys`, `cron.triage` — three small rt-only
 * steps that share no state, kept in one file because none is big enough to
 * earn its own. Each wraps an existing, already-tested library
 * (`materializeSkills`, `getDef`/`setSetting`, `resolveBoardTriage`/
 * `installCronTrigger`) rather than re-deriving its logic.
 */

import { join } from "path";
import { HELPERS_DIR } from "../../bundle-layout.ts";
import { getKnownRepos } from "../../repo-index.ts";
import { appBundlePath, bundledToolPath, resolveTool } from "../../deps/resolve.ts";
import { getDef, isMigrated } from "../../settings/registry.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import type { StepId } from "../contract.ts";
import { installCronTrigger, resolveBoardTriage, triageTrigger } from "../cron-install.ts";
import { linkBundledSkills } from "../skills-link-bundled.ts";
import { materializeSkills, materializeTally } from "../skills-materialize.ts";
import { isPackDir } from "../../skills/init.ts";
import { linkPersonalSkills } from "../../skills/writing-style-sources.ts";
import { forgeLogin } from "../../team/forge.ts";
import { resolveForge } from "./forge-identity.ts";
import { repoBasename, skippedIdentities } from "./repos.ts";
import { toFailedOutcome, unwritten } from "./step-utils.ts";

// ─── skills.materialize ──────────────────────────────────────────────────────

async function skillsMaterializeRun(ctx: ApplyContext): Promise<StepOutcome> {
  const result = await materializeSkills(ctx.p, {});
  if (result.skipped) return { state: "skipped", detail: result.reason };

  for (const r of result.repos.filter((r) => !r.ok && !r.noManifest)) ctx.log("skills.materialize", `${r.name}: ${r.detail}`);
  const tally = materializeTally(result.repos);

  // board.keys is not update-safe, so this is the only place an updating member gets a default pack.
  try {
    seedDefaultPack(ctx, "skills.materialize");
  } catch (err) {
    ctx.log("skills.materialize", `board.defaultPack: not seeded: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { state: "done", detail: tally };
}

async function skillsMaterializeRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await skillsMaterializeRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const skillsMaterializeStep: StepDef = {
  id: "skills.materialize",
  title: "Materialize skills",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: skillsMaterializeRunSafe,
};

// ─── skills.link ─────────────────────────────────────────────────────────────

async function skillsLinkRun(ctx: ApplyContext): Promise<StepOutcome> {
  const personal = linkPersonalSkills(ctx.p.home);
  for (const a of personal?.actions ?? []) {
    if (a.kind === "conflict" || a.kind === "skip") ctx.log("skills.link", `personal ${a.name}: ${a.detail ?? a.kind}`);
  }
  const personalCount = personal?.actions.filter((a) => a.kind === "create" || a.kind === "relink" || a.kind === "ok").length ?? 0;
  const personalNote = personal ? `, ${personalCount} personal` : "";

  const root = appBundlePath(ctx.p);
  if (!root) return personal ? { state: "done", detail: `linked personal skills only (not running from an app bundle)${personalNote}` } : { state: "skipped", detail: "not running from an app bundle" };

  const results = linkBundledSkills({
    skillsRoot: join(root, HELPERS_DIR, "skills"),
    claudeSkillsDir: join(ctx.p.home, ".claude", "skills"),
    isBundled: (app) => bundledToolPath(ctx.p, app) !== null,
  });
  if (results.length === 0) return personal ? { state: "done", detail: `bundle ships no skills${personalNote}` } : { state: "skipped", detail: "bundle ships no skills" };

  for (const r of results.filter((x) => x.skipped)) ctx.log("skills.link", `${r.app}: ${r.skipped}`);
  const linked = results.filter((r) => !r.skipped);
  const total = linked.reduce((n, r) => n + r.linked, 0);
  return { state: "done", detail: `linked ${total} skill(s) from ${linked.length} app(s)${personalNote}` };
}

async function skillsLinkRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await skillsLinkRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const skillsLinkStep: StepDef = {
  id: "skills.link",
  title: "Link bundled skills",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: skillsLinkRunSafe,
};

// ─── board.keys ──────────────────────────────────────────────────────────────

/**
 * The tracking identities (less any `RT_SKIP_REPOS` entry), split into the
 * ones with a registered repo, named by basename (what `repos.clone` calls
 * its destination) and located where the index says it lives, and the ones
 * still missing. Rows are keyed by serialized identity; a legacy row keyed by
 * that basename still counts.
 */
function trackedRepos(ctx: ApplyContext): { found: { name: string; path: string }[]; missing: string[] } {
  const skip = skippedIdentities(ctx.p.env);
  const identities = (ctx.snapshot?.trackingIdentities ?? []).filter((id) => !skip.has(id) && !skip.has(repoBasename(id)));
  const known = getKnownRepos().filter((r) => r.registered !== false && r.worktrees[0]);
  const found: { name: string; path: string }[] = [];
  const missing: string[] = [];
  for (const identity of identities) {
    const name = repoBasename(identity);
    const row = known.find((r) => r.repoName === serializeIdentity({ kind: "remote", id: identity })) ?? known.find((r) => r.repoName === name);
    if (row) found.push({ name, path: row.worktrees[0]!.path });
    else missing.push(name);
  }
  return { found, missing };
}

/** True only when a key is both registered AND write-eligible — a def missing from the registry (or shipped `migrated: false`) is logged and left alone rather than letting `setSetting`'s own refusal crash the step. */
function writable(ctx: ApplyContext, key: string, stepId: StepId = "board.keys"): boolean {
  const def = getDef(key);
  if (!def || !isMigrated(def)) {
    ctx.log(stepId, `${key}: key not in registry yet`);
    return false;
  }
  return true;
}

function isUnset(key: string): boolean {
  return getSetting(key).value === undefined;
}

/**
 * The joiner's own forge handle, which is both who their board runs as and
 * who agents address in chat. Neither key has a writer anywhere else, and
 * chat.humanHandle's registry default is somebody else's handle, so an
 * unseeded machine is wrong rather than merely unconfigured.
 */
async function seedOwnHandle(ctx: ApplyContext, written: string[]): Promise<void> {
  const wantsChatHandle = writable(ctx, "chat.humanHandle") && unwritten("chat.humanHandle");
  const wantsDefaultMember = writable(ctx, "board.defaultMember") && unwritten("board.defaultMember");
  if (!wantsChatHandle && !wantsDefaultMember) return;

  const forge = await resolveForge(ctx);
  if (!forge) {
    ctx.log("board.keys", "chat.humanHandle/board.defaultMember: no forge connected, left unset");
    return;
  }

  const login = await forgeLogin(ctx.p, forge.provider, forge.host, forge.token);
  if (!login) {
    ctx.log("board.keys", "chat.humanHandle/board.defaultMember: forge login unavailable, left unset");
    return;
  }

  if (wantsChatHandle) {
    setSetting("chat.humanHandle", login, "user");
    written.push("chat.humanHandle");
  }
  if (wantsDefaultMember) {
    setSetting("board.defaultMember", login, "user");
    written.push("board.defaultMember");
  }
}

/** The alphabetically first pack under the team's mattstack/packs; the pack `rt setup` installs first is the one a fresh board should launch with. */
function firstTeamPack(ctx: ApplyContext): string | null {
  if (!ctx.team.slug) return null;
  const packs = join(ctx.p.home, ".mattstack", "teams", ctx.team.slug, "mattstack", "packs");
  return ctx.p.readDir(packs).filter((name) => isPackDir(ctx.p, join(packs, name))).sort()[0] ?? null;
}

/** Writes board.defaultPack only while no store has written it, so a pack the member chose is never replaced. */
function seedDefaultPack(ctx: ApplyContext, stepId: StepId): boolean {
  if (!writable(ctx, "board.defaultPack", stepId) || !unwritten("board.defaultPack")) return false;
  const pack = firstTeamPack(ctx);
  if (!pack) {
    ctx.log(stepId, "board.defaultPack: the team has no packs, left unset");
    return false;
  }
  setSetting("board.defaultPack", pack, "user");
  ctx.log(stepId, `board.defaultPack: set to ${pack}`);
  return true;
}

async function boardKeysRun(ctx: ApplyContext): Promise<StepOutcome> {
  const written: string[] = [];
  const { found, missing } = trackedRepos(ctx);
  const root = getSetting<string[]>("rt.repoRoots").value?.[0];
  // Both keys are written once and never topped up, so they wait until every tracked repo is registered.
  const waiting = missing.length > 0 ? `waiting on ${missing.join(", ")} (not registered yet), left unset; written on the next run once repos.clone lands them` : null;

  if (writable(ctx, "board.cwds") && isUnset("board.cwds")) {
    const cwd = found[0]?.path;
    if (waiting) ctx.log("board.keys", `board.cwds: ${waiting}`);
    else if (!cwd) ctx.log("board.keys", "board.cwds: the team tracks no repos, left unset");
    else {
      setSetting("board.cwds", { review: cwd, respond: cwd, doctor: cwd }, "machine");
      written.push("board.cwds");
    }
  }

  if (writable(ctx, "gitq.board") && isUnset("gitq.board")) {
    if (waiting) ctx.log("board.keys", `gitq.board: ${waiting}`);
    else {
      setSetting("gitq.board", { repos: found.map((r) => r.name), port: 11008 }, "machine");
      written.push("gitq.board");
    }
  }

  if (writable(ctx, "gitq.workSlots") && isUnset("gitq.workSlots")) {
    if (root) {
      setSetting("gitq.workSlots", { workSlotLocation: join(root, ".gitq-slots"), maxWorkSlots: 3 }, "machine");
      written.push("gitq.workSlots");
    } else {
      ctx.log("board.keys", "gitq.workSlots: no repo root yet — left unset");
    }
  }

  if (seedDefaultPack(ctx, "board.keys")) written.push("board.defaultPack");

  await seedOwnHandle(ctx, written);

  return { state: "done", detail: written.length > 0 ? `wrote: ${written.join(", ")}` : "nothing to write" };
}

async function boardKeysRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await boardKeysRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const boardKeysStep: StepDef = {
  id: "board.keys",
  feedsIntercepts: true,
  title: "Generate board keys",
  kind: "rt",
  applies: () => true,
  run: boardKeysRunSafe,
};

// ─── cron.triage ─────────────────────────────────────────────────────────────

async function cronTriageRun(ctx: ApplyContext): Promise<StepOutcome> {
  const def = getDef("board.reReview");
  if (!def) return { state: "skipped", detail: "board.reReview not registered" };

  const enabled = getSetting<{ enabled?: boolean }>("board.reReview").value?.enabled === true;
  if (!enabled) return { state: "skipped", detail: "board.reReview disabled" };

  const board = resolveTool(ctx.p, "board").exec;
  const resolution = resolveBoardTriage(ctx.p, getKnownRepos(), board);

  if (resolution.kind === "missing") {
    return { state: "skipped", detail: "board binary not found — resolve it first (`rt deps resolve board`)" };
  }

  installCronTrigger(triageTrigger(resolution.run));
  return { state: "done", detail: "installed board-triage" };
}

async function cronTriageRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await cronTriageRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const cronTriageStep: StepDef = {
  id: "cron.triage",
  feedsIntercepts: true,
  title: "Install triage cron",
  kind: "rt",
  applies: () => true,
  run: cronTriageRunSafe,
};
