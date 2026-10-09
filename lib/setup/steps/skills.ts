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
import { installCronTrigger, peerTrigger, resolveBoardTriage, triageTrigger } from "../cron-install.ts";
import { linkBundledSkills } from "../skills-link-bundled.ts";
import { materializeSkills, materializeTally } from "../skills-materialize.ts";
import { linkPersonalSkills } from "../../skills/writing-style-sources.ts";
import { forgeLogin } from "../../team/forge.ts";
import { resolveForge } from "./forge-identity.ts";
import { repoBasename, skippedIdentities } from "./repos.ts";
import { toFailedOutcome, unwritten } from "./step-utils.ts";
import { codexUserSkillsDir } from "../../agent-integrations/codex/skills.ts";
import { harnessSelected, noHarnessDetail, selectionFor, stepSelectionFor, type IntegrationSelection } from "../integration-selection.ts";
import { codexHomeOf } from "../validators/codex.ts";

// ─── skills.materialize ──────────────────────────────────────────────────────

async function skillsMaterializeRun(ctx: ApplyContext): Promise<StepOutcome> {
  const result = await materializeSkills(ctx.p, {}, selectionFor(ctx));
  if (result.skipped) return { state: "skipped", detail: result.reason };

  for (const r of result.repos.filter((r) => !r.ok && !r.noManifest)) ctx.log("skills.materialize", `${r.name}: ${r.detail}`);
  return { state: "done", detail: materializeTally(result.repos) };
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
  const selection = stepSelectionFor(ctx);
  if (selection.switchOn) return skillsLinkForHosts(ctx, skillsHosts(ctx, selection));
  const personal = linkPersonalSkills(ctx.p.home);
  for (const a of personal?.actions ?? []) {
    if (a.kind === "conflict" || a.kind === "skip") ctx.log("skills.link", `personal ${a.name}: ${a.detail ?? a.kind}`);
  }
  const personalCount = personal?.actions.filter((a) => a.kind === "create" || a.kind === "relink" || a.kind === "ok").length ?? 0;
  const personalNote = personal ? `, ${personalCount} personal` : "";

  const root = appBundlePath(ctx.p);
  if (!root) return personal ? { state: "done", detail: `Linked your personal skills only; rt is not running from the app${personalNote}` } : { state: "skipped", detail: "rt is not running from the app" };

  const results = linkBundledSkills({
    skillsRoot: join(root, HELPERS_DIR, "skills"),
    hostSkillsDir: join(ctx.p.home, ".claude", "skills"),
    isBundled: (app) => bundledToolPath(ctx.p, app) !== null,
  });
  if (results.length === 0) return personal ? { state: "done", detail: `The app ships no skills${personalNote}` } : { state: "skipped", detail: "The app ships no skills" };

  for (const r of results.filter((x) => x.skipped)) ctx.log("skills.link", `${r.app}: ${r.skipped}`);
  const linked = results.filter((r) => !r.skipped);
  const total = linked.reduce((n, r) => n + r.linked, 0);
  return { state: "done", detail: `Linked ${total} skill${total === 1 ? "" : "s"} from ${linked.length} app${linked.length === 1 ? "" : "s"}${personalNote}` };
}

/** Where Codex's own build of each app's skills lands in the bundle, beside Claude's `skills/`. */
const CODEX_BUNDLED_SKILLS = ["skills-targets", "codex"];

type SkillsHost = { harness: string; dir: string; bundled: string };

/** Each selected harness's own skills folder, with the bundle folder holding the skills built for it. */
function skillsHosts(ctx: ApplyContext, selection: IntegrationSelection): SkillsHost[] {
  const hosts: SkillsHost[] = [];
  if (harnessSelected(selection, "claude")) hosts.push({ harness: "claude", dir: join(ctx.p.home, ".claude", "skills"), bundled: join(HELPERS_DIR, "skills") });
  const codexHome = harnessSelected(selection, "codex") ? codexHomeOf(ctx.p) : null;
  if (codexHome !== null) hosts.push({ harness: "codex", dir: codexUserSkillsDir(codexHome), bundled: join(HELPERS_DIR, ...CODEX_BUNDLED_SKILLS) });
  return hosts;
}

async function skillsLinkForHosts(ctx: ApplyContext, hosts: SkillsHost[]): Promise<StepOutcome> {
  if (hosts.length === 0) return { state: "skipped", detail: noHarnessDetail(ctx) };

  let personalCount = 0;
  let hasPersonal = false;
  for (const host of hosts) {
    const personal = linkPersonalSkills(ctx.p.home, host.dir);
    if (!personal) continue;
    hasPersonal = true;
    for (const a of personal.actions) {
      if (a.kind === "conflict" || a.kind === "skip") ctx.log("skills.link", `personal ${a.name} (${host.harness}): ${a.detail ?? a.kind}`);
    }
    personalCount = Math.max(personalCount, personal.actions.filter((a) => a.kind === "create" || a.kind === "relink" || a.kind === "ok").length);
  }
  const personalNote = hasPersonal ? `, ${personalCount} personal` : "";

  const root = appBundlePath(ctx.p);
  if (!root) return hasPersonal ? { state: "done", detail: `Linked your personal skills only; rt is not running from the app${personalNote}` } : { state: "skipped", detail: "rt is not running from the app" };

  let total = 0;
  const apps = new Set<string>();
  for (const host of hosts) {
    const results = linkBundledSkills({ skillsRoot: join(root, host.bundled), hostSkillsDir: host.dir, isBundled: (app) => bundledToolPath(ctx.p, app) !== null });
    if (results.length === 0) ctx.log("skills.link", `${host.harness}: this build ships no skills for it`);
    for (const r of results.filter((x) => x.skipped)) ctx.log("skills.link", `${r.app} (${host.harness}): ${r.skipped}`);
    for (const r of results.filter((x) => !x.skipped)) {
      total += r.linked;
      apps.add(r.app);
    }
  }
  if (apps.size === 0) return hasPersonal ? { state: "done", detail: `The app ships no skills${personalNote}` } : { state: "skipped", detail: "The app ships no skills" };
  return { state: "done", detail: `Linked ${total} skill${total === 1 ? "" : "s"} from ${apps.size} app${apps.size === 1 ? "" : "s"}${personalNote}` };
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
      ctx.log("board.keys", "gitq.workSlots: no repo root yet, so it is left unset");
    }
  }

  await seedOwnHandle(ctx, written);

  return { state: "done", detail: written.length > 0 ? `Wrote ${written.join(", ")}` : "Nothing to write" };
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

function hookOn(key: "board.reReview" | "board.peerAsks"): boolean {
  if (!getDef(key)) return false;
  return getSetting<{ enabled?: boolean }>(key).value?.enabled === true;
}

async function cronTriageRun(ctx: ApplyContext): Promise<StepOutcome> {
  const reReview = hookOn("board.reReview");
  const peerAsks = hookOn("board.peerAsks");
  if (!reReview && !peerAsks) return { state: "skipped", detail: "The board's re-review and peer ask hooks are off" };

  const board = resolveTool(ctx.p, "board").exec;
  const resolution = resolveBoardTriage(ctx.p, getKnownRepos(), board);

  if (resolution.kind === "missing") {
    return { state: "skipped", detail: "The board binary was not found. Run rt deps resolve board first" };
  }

  if (reReview) installCronTrigger(triageTrigger(resolution.run));
  if (peerAsks) installCronTrigger(peerTrigger(resolution.run));
  return { state: "done", detail: "Installed the board triage skill" };
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
