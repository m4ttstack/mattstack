import { resumeAgentPane, resumePackEnv } from './agent-launch.ts';
import type { BoardConfig } from './config.ts';
import { reviewSkillForTab } from './data.ts';
import {
  dispatchPrompt,
  launchLegacyResume,
  launchRespond,
  launchReview,
  mrTabLabel,
  statusBinPath,
  type SkillPathResolver,
} from './herdr.ts';
import { launchErrorMessage } from './launch-error.ts';
import {
  laneBoardTab,
  packForLaunch,
  resolveLaunchSkill,
} from './manifest-bindings.ts';
import { respondFilePath, writeRespondState } from './respond-state.ts';
import {
  readReviewStates,
  reviewFilePath,
  reviewReportPath,
  writeReviewState,
} from './review-state.ts';
import { resolveSkillPath } from './skill-path.ts';

/** How the re-review actually started. Callers that only want the board's
    optimistic response ignore this; triage awaits it to learn whether the pane
    came up at all. */
export type ReReviewLaunch =
  | { kind: 'resumed' }
  | { kind: 'launched' }
  | { kind: 'error'; message: string };

/** The skill and pack a launch resolves for one board tab (or none). */
export interface TabLaunch {
  skill: string;
  pack?: string;
}

/** A review launch for board tab `tab`: the tab's `reviewSkill` when it
    names one, else the pack's `board:review` binding; the pack is the tab's,
    else `board.defaultPack`, either way. */
export function reviewLaunchForTab(
  cfg: BoardConfig,
  mrUrl: string,
  tab: string | undefined,
  mattstackHome?: string
): TabLaunch {
  const pack = packForLaunch(cfg, tab) ?? undefined;
  const skill = reviewSkillForTab(cfg, tab, mrUrl, (kind, url, t) =>
    resolveLaunchSkill(kind, url, cfg, packForLaunch(cfg, t), mattstackHome)
  );
  return { skill, pack };
}

/** The launch settings every board launch shares, from the board's config. */
interface LaunchCtx {
  cwd: string;
  /** The serialized rt repo identity (`repoIdentityField`'s output), threaded
      to startAgentPane as `repo` -- never a bare GitLab project path. */
  repo: string;
  workspaceLabel: string;
  author?: string;
  /** cswap account, --model, and --effort forwarded to launchReview's
      startAgentPane call (the board.agent.* settings). Unused on the legacy
      resume path, which takes claudeCommand below instead. */
  account?: string;
  model?: string;
  effort?: string;
  /** Verbatim claudeCommand escape hatch (config.claudeCommand), forwarded to
      the legacy resume path only -- the rt agent daemon path above has no
      field for an arbitrary shell command, so it uses account/model/effort. */
  claudeCommand?: string;
  /** Operator note from the human who launched the re-review (see operatorNoteParagraph). */
  note?: string;
}

/** A re-review's settings. The skill and pack come from the board tab the
    lane launched from, else `boardTabId` (the tab asking, absent for
    triage), resolved through `forTab`. */
export interface ReReviewCtx extends LaunchCtx {
  /** false launches a plain first review instead of the re-review framing
      (a peer's first-look ask). Absent means re-review. */
  reReview?: boolean;
  boardTabId?: string;
  forTab(tab: string | undefined): TabLaunch;
}

/** A peer respond ask's settings: it has no board tab, so the caller
    resolves the skill and pack up front. */
export interface RespondAskCtx extends LaunchCtx {
  skill: string;
  /** Team pack the launched wrapper resolves bindings with; rides the pane as MATTSTACK_PACK. */
  pack?: string;
}

/** Seams for the herdr launchers and the review state store, so tests can drive
    the decision without spawning panes or touching the real state dir. */
export interface ReReviewIo {
  launchLegacyResume: typeof launchLegacyResume;
  launchReview: typeof launchReview;
  resumeAgentPane: typeof resumeAgentPane;
  writeReviewState: typeof writeReviewState;
  readReviewStates: typeof readReviewStates;
  reviewFilePath: typeof reviewFilePath;
}

export const defaultReReviewIo: ReReviewIo = {
  launchLegacyResume,
  launchReview,
  resumeAgentPane,
  writeReviewState,
  readReviewStates,
  reviewFilePath,
};

/** Start a re-review of an MR: resume the prior session if there is one, else
    launch a fresh review with the re-review framing. Unlike the board's other
    launches this awaits the pane and settles the state file before returning,
    so a caller that needs the outcome (triage) can have it; the HTTP handler
    keeps its optimistic response by calling this with `void`.

    Note this does NOT dedup against a live review. The server focuses the
    existing tab before it ever gets here, and triage refuses a nudge outright
    while a review is in flight.

    Resume is THREE-way: an agentId on file resumes through the rt agent
    daemon (resumeAgentPane); a bare sessionId (a state that predates rt agent
    adoption, or that raced this rollout) resumes the legacy way
    (launchLegacyResume, `claude --resume`); neither on file launches a fresh
    review with the re-review framing (the wrapper reads any prior report at
    reportPath, and falls back to a normal review if the author hasn't acted).
    Both resume arms carry the SAME re-review prompt, built once below. */
export async function launchReReview(
  mrUrl: string,
  iid: number,
  ctx: ReReviewCtx,
  io: ReReviewIo = defaultReReviewIo,
  resolvePath: SkillPathResolver = resolveSkillPath
): Promise<ReReviewLaunch> {
  const existing = io.readReviewStates().get(mrUrl);
  const statePath = io.reviewFilePath(mrUrl);
  const boardTabId = laneBoardTab(existing?.boardTabId, ctx.boardTabId);
  const { skill, pack } = ctx.forTab(boardTabId);
  const lane = { boardTabId: boardTabId ?? '', noPack: !pack };
  const prompt = await dispatchPrompt(
    'board:review',
    {
      mrUrl,
      statePath,
      statusBin: statusBinPath(),
      reportPath: reviewReportPath(statePath),
      skill,
      reReview: ctx.reReview ?? true,
      note: ctx.note,
    },
    resolvePath
  );

  if (existing?.agentId) {
    io.writeReviewState(statePath, { status: 'reviewing', ...lane });
    try {
      const result = await io.resumeAgentPane({
        agentId: existing.agentId,
        prompt,
        workspaceLabel: ctx.workspaceLabel,
        tabLabel: mrTabLabel(iid, ctx.author, 'RE'),
        env: resumePackEnv(pack),
      });
      if (!result.focusedExisting) {
        io.writeReviewState(statePath, {
          status: 'reviewing',
          tabId: result.tabId,
          workspaceId: result.workspaceId,
          agentId: result.agentId,
          paneId: result.paneId,
        });
      }
      return { kind: 'resumed' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`re-review resume failed: ${message}`);
      io.writeReviewState(statePath, {
        status: 'error',
        message: launchErrorMessage('re-review', err),
      });
      return { kind: 'error', message };
    }
  }

  if (existing?.sessionId) {
    io.writeReviewState(statePath, { status: 'reviewing', ...lane });
    try {
      const { tabId, workspaceId } = await io.launchLegacyResume({
        mrUrl,
        iid,
        cwd: ctx.cwd,
        repo: ctx.repo,
        workspaceLabel: ctx.workspaceLabel,
        statePath,
        sessionId: existing.sessionId,
        workspaceKind: 'review',
        prompt,
        tabPrefix: 'RE',
        author: ctx.author,
        claudeCommand: ctx.claudeCommand,
        pack,
      });
      io.writeReviewState(statePath, {
        status: 'reviewing',
        tabId,
        workspaceId,
      });
      return { kind: 'resumed' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`re-review resume failed: ${message}`);
      io.writeReviewState(statePath, {
        status: 'error',
        message: launchErrorMessage('re-review', err),
      });
      return { kind: 'error', message };
    }
  }

  io.writeReviewState(statePath, { mrUrl, iid, status: 'queued', ...lane });
  try {
    const result = await io.launchReview({
      mrUrl,
      iid,
      cwd: ctx.cwd,
      repo: ctx.repo,
      workspaceLabel: ctx.workspaceLabel,
      statePath,
      skill,
      reReview: ctx.reReview ?? true,
      author: ctx.author,
      account: ctx.account,
      model: ctx.model,
      effort: ctx.effort,
      note: ctx.note,
      pack,
    });
    if (!result.focusedExisting) {
      io.writeReviewState(statePath, {
        status: 'queued',
        tabId: result.tabId,
        workspaceId: result.workspaceId,
        agentId: result.agentId,
        paneId: result.paneId,
      });
    }
    return { kind: 'launched' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`re-review launch failed: ${message}`);
    io.writeReviewState(statePath, {
      status: 'error',
      message: launchErrorMessage('re-review', err),
    });
    return { kind: 'error', message };
  }
}

/** Seams for the respond-ask launcher, mirroring ReReviewIo. */
export interface RespondAskIo {
  launchRespond: typeof launchRespond;
  respondFilePath: typeof respondFilePath;
  writeRespondState: typeof writeRespondState;
}

export const defaultRespondAskIo: RespondAskIo = {
  launchRespond,
  respondFilePath,
  writeRespondState,
};

/** Start a respond pane for a peer's respond-request, awaited so triage can
    learn whether it came up. Fresh launch only: the guardrail already rejects
    while a respond is in flight, and a done/errored lane wants the wrapper's
    own fresh triage, not a resumed session. */
export async function launchRespondAsk(
  mrUrl: string,
  iid: number,
  ctx: RespondAskCtx,
  io: RespondAskIo = defaultRespondAskIo,
  resolvePath: SkillPathResolver = resolveSkillPath
): Promise<ReReviewLaunch> {
  const statePath = io.respondFilePath(mrUrl);
  io.writeRespondState(statePath, {
    mrUrl,
    iid,
    status: 'queued',
    boardTabId: '',
    noPack: !ctx.pack,
  });
  try {
    const result = await io.launchRespond(
      {
        mrUrl,
        iid,
        cwd: ctx.cwd,
        repo: ctx.repo,
        workspaceLabel: ctx.workspaceLabel,
        statePath,
        skill: ctx.skill,
        author: ctx.author,
        account: ctx.account,
        model: ctx.model,
        effort: ctx.effort,
        note: ctx.note,
        pack: ctx.pack,
      },
      undefined,
      resolvePath
    );
    if (!result.focusedExisting) {
      io.writeRespondState(statePath, {
        status: 'queued',
        tabId: result.tabId,
        workspaceId: result.workspaceId,
        agentId: result.agentId,
        paneId: result.paneId,
      });
    }
    return { kind: 'launched' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`respond ask launch failed: ${message}`);
    io.writeRespondState(statePath, {
      status: 'error',
      message: launchErrorMessage('respond', err),
    });
    return { kind: 'error', message };
  }
}
