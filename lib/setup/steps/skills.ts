/**
 * `skills.materialize`, `skills.link`, `board.keys`, `board.cwds`,
 * `board.restart`, `cron.triage` — small rt-only steps, kept in one file
 * because none is big enough to earn its own. Each wraps an existing, already-tested library
 * (`materializeSkills`, `getDef`/`setSetting`, `resolveTool`/
 * `installCronTrigger`) rather than re-deriving its logic.
 */

import { join } from "path";
import { HELPERS_DIR } from "../../bundle-layout.ts";
import { appBundlePath, bundledToolPath, resolveTool, restartAppWithDeck } from "../../deps/resolve.ts";
import { getDef, isMigrated } from "../../settings/registry.ts";
import { storedValue } from "../../settings/presence.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import { planBoardCwds, type BoardCwds } from "../board-folder.ts";
import type { StepId } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { tildify } from "../repo-placement.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { installCronTrigger, peerTrigger, triageTrigger } from "../cron-install.ts";
import { linkBundledSkills } from "../skills-link-bundled.ts";
import { materializeSkills, materializeTally } from "../skills-materialize.ts";
import { linkPersonalSkills } from "../../skills/writing-style-sources.ts";
import { forgeLogin } from "../../team/forge.ts";
import { resolveForge } from "./forge-identity.ts";
import { repoBasename, trackedRepos } from "./repos.ts";
import { toFailedOutcome, unwritten } from "./step-utils.ts";

// ─── skills.materialize ──────────────────────────────────────────────────────

async function skillsMaterializeRun(ctx: ApplyContext): Promise<StepOutcome> {
  const result = await materializeSkills(ctx.p, {});
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
    claudeSkillsDir: join(ctx.p.home, ".claude", "skills"),
    isBundled: (app) => bundledToolPath(ctx.p, app) !== null,
  });
  if (results.length === 0) return personal ? { state: "done", detail: `The app ships no skills${personalNote}` } : { state: "skipped", detail: "The app ships no skills" };

  for (const r of results.filter((x) => x.skipped)) ctx.log("skills.link", `${r.app}: ${r.skipped}`);
  const linked = results.filter((r) => !r.skipped);
  const total = linked.reduce((n, r) => n + r.linked, 0);
  return { state: "done", detail: `Linked ${total} skill${total === 1 ? "" : "s"} from ${linked.length} app${linked.length === 1 ? "" : "s"}${personalNote}` };
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

/** True only when a key is both registered AND write-eligible — a def missing from the registry (or shipped `migrated: false`) is logged and left alone rather than letting `setSetting`'s own refusal crash the step. */
function writable(ctx: ApplyContext, key: string, stepId: StepId = "board.keys"): boolean {
  const def = getDef(key);
  if (!def || !isMigrated(def)) {
    ctx.log(stepId, `${key}: key not in registry yet`);
    return false;
  }
  return true;
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
  // Written once and never topped up, so it waits until every tracked repo is registered.
  const waiting = missing.length > 0 ? `waiting on ${missing.join(", ")} (not registered yet), left unset; written on the next run once repos.clone lands them` : null;

  if (writable(ctx, "gitq.board") && unwritten("gitq.board")) {
    if (waiting) ctx.log("board.keys", `gitq.board: ${waiting}`);
    else if (found.length === 0) ctx.log("board.keys", "gitq.board: the team tracks no repos, left unset");
    else {
      setSetting("gitq.board", { repos: found.map((r) => ({ path: r.path, name: r.name })), port: 11008 }, "machine");
      written.push("gitq.board");
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

// ─── board.cwds ──────────────────────────────────────────────────────────────

/** The board's repo, and where it is registered on this Mac (null until `repos.clone` lands it). */
function boardTarget(ctx: ApplyContext): { identity: string | null; path: string | null } {
  const identity = ctx.snapshot?.boardRepo ?? null;
  if (identity === null) return { identity, path: null };
  return { identity, path: trackedRepos(ctx).found.find((r) => r.identity === identity)?.path ?? null };
}

function boardCwdsPlan(ctx: ApplyContext, target: string | null) {
  return planBoardCwds({
    current: storedValue<Partial<BoardCwds>>("board.cwds"),
    rtWrote: readSetupState(ctx.p).boardCwdsWritten,
    target,
    mode: "install",
    exists: (path) => ctx.p.exists(path),
    isTrackedCheckout: () => true,
  });
}

async function boardCwdsRun(ctx: ApplyContext): Promise<StepOutcome> {
  const { identity, path } = boardTarget(ctx);
  if (identity === null) return { state: "skipped", detail: "None of the team's repos is the board's" };
  const name = repoBasename(identity);
  if (path === null) return { state: "skipped", detail: `Waits until ${name} is on this Mac` };
  if (!writable(ctx, "board.cwds", "board.cwds")) return { state: "skipped", detail: "This rt doesn't know the board.cwds setting" };

  const plan = boardCwdsPlan(ctx, path);
  if ("leave" in plan) {
    if (plan.leave === "hand-set") return { state: "skipped", detail: "You set the board's folders yourself, so rt left them alone" };
    return { state: "done", detail: `The board already starts in ${tildify(ctx.p.home, path)}` };
  }
  setSetting("board.cwds", plan.write, "machine");
  updateSetupState(ctx.p, (s) => ({ ...s, boardCwdsWritten: plan.write, boardRestartPending: true }));
  return { state: "done", detail: `The board's agents start in ${tildify(ctx.p.home, path)}` };
}

async function boardCwdsRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await boardCwdsRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

function boardCwdsSatisfied(ctx: ApplyContext): boolean {
  const { identity, path } = boardTarget(ctx);
  if (identity === null) return true;
  if (path === null) return false;
  const plan = boardCwdsPlan(ctx, path);
  return "leave" in plan && plan.leave === "current";
}

export const boardCwdsStep: StepDef = {
  id: "board.cwds",
  feedsIntercepts: true,
  title: "Point the board at your repo",
  titleFor: (ctx) => {
    const repo = ctx.snapshot?.boardRepo;
    return repo ? `Point the board at ${repoBasename(repo)}` : boardCwdsStep.title;
  },
  kind: "rt",
  applies: () => true,
  prerequisites: ["repos.clone"],
  satisfied: boardCwdsSatisfied,
  run: boardCwdsRunSafe,
};

// ─── board.restart ───────────────────────────────────────────────────────────

/** The board reads `board.cwds` once at boot. */
export interface BoardRestartSeams {
  restartBoard(p: Probes): Promise<boolean>;
}

export function makeBoardRestartStep(seams: BoardRestartSeams = { restartBoard: (p) => restartAppWithDeck(p, "board") }): StepDef {
  async function run(ctx: ApplyContext): Promise<StepOutcome> {
    if (readSetupState(ctx.p).boardRestartPending !== true) return { state: "skipped", detail: "Nothing new for the board to read" };
    let restarted = false;
    try {
      restarted = await seams.restartBoard(ctx.p);
    } catch (err) {
      ctx.log("board.restart", `deck restart board threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!restarted) return { state: "partial", detail: "deck didn't restart the board, so it still uses its old folders", remedy: "Run deck restart board" };
    updateSetupState(ctx.p, ({ boardRestartPending: _, ...s }) => s);
    return { state: "done", detail: "Restarted the board" };
  }

  return {
    id: "board.restart",
    title: "Restart the board",
    kind: "rt",
    applies: () => true,
    prerequisites: ["board.cwds"],
    async run(ctx) {
      try {
        return await run(ctx);
      } catch (err) {
        return toFailedOutcome(err);
      }
    },
  };
}

export const boardRestartStep = makeBoardRestartStep();

// ─── cron.triage ─────────────────────────────────────────────────────────────

function hookOn(key: "board.reReview" | "board.peerAsks"): boolean {
  if (!getDef(key)) return false;
  return getSetting<{ enabled?: boolean }>(key).value?.enabled === true;
}

async function cronTriageRun(ctx: ApplyContext): Promise<StepOutcome> {
  const reReview = hookOn("board.reReview");
  const peerAsks = hookOn("board.peerAsks");
  if (!reReview && !peerAsks) return { state: "skipped", detail: "The board's re-review and peer ask hooks are off" };

  if (resolveTool(ctx.p, "board").exec === null) {
    return { state: "skipped", detail: "The board binary was not found. Run rt deps resolve board first" };
  }

  if (reReview) installCronTrigger(triageTrigger());
  if (peerAsks) installCronTrigger(peerTrigger());
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
