import {
  loadAgentSettings,
  resolveLaunchRepo,
  type BoardConfig,
} from '../config.ts';
import { projectPathFromWebUrl } from '../data.ts';
import { packForLaunch, resolveLaunchSkill } from '../manifest-bindings.ts';
import {
  launchReReview,
  launchRespondAsk,
  reviewLaunchForTab,
  type ReReviewLaunch,
} from '../review-launch.ts';
import type { AskKind } from './envelope.ts';

/** The rt agent daemon's `repo` identity for a launch, resolved the same way
    BoardMR.rtRepo is (config.rtRepos keyed by the MR's GitLab project path),
    since a launch works from mrUrl alone and never builds a BoardMR. */
export function makeRepoForMrUrl(
  boardConfig: BoardConfig
): (mrUrl: string) => string {
  return mrUrl => {
    const projectPath =
      projectPathFromWebUrl(mrUrl, boardConfig.gitlabHost) ?? '';
    return resolveLaunchRepo(
      boardConfig.rtRepos[projectPath] ?? null,
      boardConfig.gitlabHost,
      projectPath,
      mrUrl
    );
  };
}

/** Launches the agent a peer ask calls for. Headless: no board tab, so a
    re-review keeps its lane's and everything else takes the default pack. */
export function makeAskLauncher(
  boardConfig: BoardConfig
): (mrUrl: string, iid: number, kind: AskKind) => Promise<ReReviewLaunch> {
  const launchPack = packForLaunch(boardConfig, undefined);
  const repoForMrUrl = makeRepoForMrUrl(boardConfig);
  return (mrUrl, iid, kind) =>
    kind === 'respond'
      ? launchRespondAsk(mrUrl, iid, {
          cwd: boardConfig.respondCwd || boardConfig.reviewCwd,
          repo: repoForMrUrl(mrUrl),
          workspaceLabel: boardConfig.respondsWorkspace,
          skill: resolveLaunchSkill('respond', mrUrl, boardConfig, launchPack),
          pack: launchPack ?? undefined,
          ...loadAgentSettings(),
        })
      : launchReReview(mrUrl, iid, {
          reReview: kind !== 'review',
          cwd: boardConfig.reviewCwd,
          repo: repoForMrUrl(mrUrl),
          workspaceLabel: boardConfig.reviewsWorkspace,
          forTab: tab => reviewLaunchForTab(boardConfig, mrUrl, tab),
          ...loadAgentSettings(),
          claudeCommand: boardConfig.claudeCommand,
        });
}
