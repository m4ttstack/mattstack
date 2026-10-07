// Headless policy engine, second entry point of this repo (working name).
// rt cron is the intended caller (spec §5); a human running it by hand gets
// the same one idempotent evaluation pass. The board server NEVER runs this.
import { deckAppUrl } from '@mattstack/app-server/event-bridge';
import { GitLabProvider, parseRepoId, type MRDetail } from '@mattstack/glance';
import {
  listOrgs,
  readDiscussions,
  readProjectMRs,
} from '@mattstack/rt-client';
import {
  loadAgentSettings,
  loadConfig,
  loadGitLabToken,
  loadSwitchboardToken,
  repoIdentityField,
} from '../src/config.ts';
import { buildBoard, projectPathFromWebUrl } from '../src/data.ts';
import {
  doctorFilePath,
  readDoctorStates,
  writeDoctorState,
} from '../src/doctor-state.ts';
import { launchDoctor, sendPaneText } from '../src/herdr.ts';
import { latchGateway } from '../src/latch/gateway.ts';
import { packForLaunch } from '../src/manifest-bindings.ts';
import { makeSwitchboardClient } from '../src/peer/client.ts';
import { makeEnvelope } from '../src/peer/envelope.ts';
import { runPeerTick } from '../src/peer/inbox.ts';
import { makeAskLauncher, makeRepoForMrUrl } from '../src/peer/launch-ask.ts';
import { boardMaterializeDeps } from '../src/peer/materialize-deps.ts';
import {
  markNudgeHandled,
  markNudgeNotified,
  readNudges,
  reviewerDisplayName,
} from '../src/peer/nudges.ts';
import { drainOutbox, enqueueOutbox } from '../src/peer/outbox.ts';
import { readRespondStates } from '../src/respond-state.ts';
import { launchReReview, reviewLaunchForTab } from '../src/review-launch.ts';
import {
  dropPrunedReviewState,
  readPrunedReviewStates,
  readReviewStates,
  resurrectReviewState,
} from '../src/review-state.ts';
import { createBoardAttendants } from '../src/triage/attendant.ts';
import { appendAudit } from '../src/triage/audit.ts';
import {
  loadPeerAsksAlwaysAllow,
  loadPeerAsksConfig,
  loadReReviewConfig,
  loadTriageConfig,
} from '../src/triage/config.ts';
import type { OwnMrFacts } from '../src/triage/edge.ts';
import { runLatchPass, type LatchMrFacts } from '../src/triage/latch.ts';
import {
  CRON_CLAIM_STALE_MS,
  readMemory,
  releaseCron,
  tryClaimCron,
  writeMemory,
} from '../src/triage/memory-store.ts';
import {
  askNotice,
  boardAskLink,
  boardMrLink,
  notifyEscalation,
} from '../src/triage/notify.ts';
import { runNudgePass } from '../src/triage/nudge.ts';
import {
  claimCronWaiting,
  needsOwnMrs,
  triageShouldRun,
} from '../src/triage/peer-pass.ts';
import { collectProjectPRs } from '../src/triage/projects.ts';
import {
  numericPipelineId,
  resolveDispatchIdentity,
  runTriage,
} from '../src/triage/run.ts';
import { triageOwns } from '../src/triage/seat.ts';

// A peer pass is only useful on a board that peers. Checked before the claim
// so a machine outside any team, or without a token, exits quietly without
// queueing behind a full pass.
async function peerPreflight(): Promise<boolean> {
  try {
    return listOrgs().length > 0 && !!(await loadSwitchboardToken());
  } catch {
    return false;
  }
}

// Decide whether to run BEFORE taking the lock, because process.exit() skips
// finally blocks and would strand the lock file. Three switches: board.triage
// gates the doctor sweep, board.reReview the latch pass, board.peerAsks the
// automatic nudge pass. A full run needs any one of them; --peer (the
// board-peer cron trigger) needs board.peerAsks.
const peerMode = process.argv.includes('--peer');
const triage = loadTriageConfig();
const reReview = loadReReviewConfig();
const peerAsks = loadPeerAsksConfig();
if (
  !triageShouldRun(peerMode, {
    triage: triage.enabled,
    reReview: reReview.enabled,
    peerAsks: peerAsks.enabled,
  })
)
  process.exit(0);

// One run at a time: a slow run plus a fresh trigger must not interleave
// dispatches. A stale claim (crashed run) is reclaimed. Both passes wait for a
// held claim: a full pass that exits behind a short peer pass would leave its
// doctor and latch work for the next MR change.
if (peerMode && !(await peerPreflight())) process.exit(0);

const lockToken = await claimCronWaiting({
  tryClaim: tryClaimCron,
  maxWaitMs: peerMode ? CRON_CLAIM_STALE_MS : 30_000,
});
if (lockToken === false) {
  process.exit(0);
}

try {
  const boardConfig = loadConfig();
  // Triage has no board tab: a re-review keeps its lane's, everything else
  // carries the default pack.
  const launchPack = packForLaunch(boardConfig, undefined);
  const memory = readMemory();

  // The same deck lookup the server's gate bridge rule uses, made at most
  // once per run and only when something actually notifies. Null (deck not
  // answering) sends the notification without a click target.
  let boardUrl: Promise<string | null> | undefined;
  const notify = async (title: string, message: string, mrUrl: string) => {
    if (triage.notify !== 'rt') return;
    boardUrl ??= deckAppUrl('board');
    const base = await boardUrl;
    await notifyEscalation(title, message, triage.notify, {
      url: base ? boardMrLink(base, mrUrl) : null,
    });
  };

  const repoForMrUrl = makeRepoForMrUrl(boardConfig);

  // The GitLab token's user, cached so steady-state runs are pure socket
  // reads. An MR is triage's only when this user AND the seat authored it
  // (triageOwns), so a seatless board runs no auto-doctor and no respond ask.
  // Throw rather than process.exit(1) on a resolution failure: an exit here
  // would skip the finally block and strand the lock until the stale window
  // reclaims it.
  let username = '';
  const resolveUsername = async (): Promise<string> => {
    const resolved = await resolveDispatchIdentity(memory, async () => {
      const token = await loadGitLabToken();
      if (!token)
        throw new Error('triage: no gitlab token available for identity');
      return new GitLabProvider(boardConfig.gitlabHost, token).validateToken();
    });
    if (!resolved)
      throw new Error('triage: no gitlab token available for identity');
    return resolved;
  };
  if (!peerMode) username = await resolveUsername();

  // SCOPE (review fix 1): triage's MR scope is deliberately the BOARD's
  // visibility scope -- buildBoard applies the member, own-draft, stale-window,
  // ticket-prefix, and project filters -- intersected with triageOwns.
  // Tradeoff: an own MR the board filters out (stale, wrong ticket prefix, or
  // a draft when config.defaultMember differs from the token identity) is out
  // of auto-triage reach. In exchange, every doctor state and held draft the
  // engine writes lives inside the window the board renders, so the board's
  // prune sweeps (server.ts /data.json) can never silently delete live auto
  // state, the in-flight dedup always sees what the board sees (no duplicate
  // panes), and the concurrency cap never undercounts.
  const fetchOwnMrs = async (): Promise<OwnMrFacts[]> => {
    const { prs, tags, windows } = await collectProjectPRs(
      boardConfig,
      readProjectMRs
    );
    return buildBoard(prs, boardConfig, undefined, tags, windows)
      .filter(
        m => !!m.webUrl && triageOwns(m, boardConfig.defaultMember, username)
      )
      .map(m => ({
        mrUrl: m.webUrl!,
        iid: m.iid,
        pipelineId: m.pipeline ? numericPipelineId(m.pipeline.id) : null,
        pipelineState: m.pipelineState,
        needsRebase: m.blockers.needsRebase,
        author: m.author.username,
        // BOARD-12: the stack chain is reconstructed from these three.
        sourceBranch: m.sourceBranch,
        targetBranch: m.targetBranch,
        isStacked: !!m.isStacked,
      }));
  };

  // The latch pass's mirror image of fetchOwnMrs: every MR this board holds a
  // done review state for, whatever its outcome, rather than the MRs this
  // identity authored. Approve-outcome states stay in scope so a half-finished
  // spend can be repaired; without them nothing ever would be. A commented
  // TOMBSTONE also qualifies: its MR left the board with review state and came
  // back without it, and the pass decides between resurrecting and dropping.
  const fetchLatchMrs = async (): Promise<LatchMrFacts[]> => {
    const states = readReviewStates();
    const pruned = readPrunedReviewStates();
    const inScope = (url: string | null | undefined): boolean => {
      if (!url) return false;
      if (states.get(url)?.status === 'done') return true;
      const tomb = pruned.get(url);
      return tomb?.status === 'done' && tomb.outcome === 'comment';
    };
    const { prs, tags, windows } = await collectProjectPRs(
      boardConfig,
      readProjectMRs
    );
    return buildBoard(prs, boardConfig, undefined, tags, windows)
      .filter(m => inScope(m.webUrl))
      .map(m => ({
        mrUrl: m.webUrl!,
        iid: m.iid,
        projectId: parseRepoId(m.repositoryId),
        projectPath:
          projectPathFromWebUrl(m.webUrl!, boardConfig.gitlabHost) ?? '',
        // Encoded, not the bare rtRepos value: readDetail below passes this
        // straight to readDiscussions, which is daemon-identity-keyed.
        rtRepo: repoIdentityField(m.rtRepo) ?? '',
        approvedBySelf: m.reviews.approvedBy.some(
          r => r.username.toLowerCase() === username.toLowerCase()
        ),
      }));
  };

  if (!peerMode) {
    const result = await runTriage({
      triage,
      doctorCwd: boardConfig.doctorCwd || boardConfig.reviewCwd,
      doctorsWorkspace: boardConfig.doctorsWorkspace,
      ...loadAgentSettings(),
      repoForMr: repoForMrUrl,
      // Same resolved identity fetchOwnMrs just filtered by (MAT-351 re-check).
      identity: username,
      fetchOwnMrs,
      readDoctorStates,
      launchDoctor,
      pack: launchPack ?? undefined,
      writeDoctorState,
      doctorFilePath: mrUrl => doctorFilePath(mrUrl),
      appendAudit,
      notify,
      memory,
      writeMemory,
      readFreshMemory: readMemory,
      sendPaneText,
      now: () => Date.now(),
      attendants: createBoardAttendants(),
    });
    console.log(
      `triage: dispatched ${result.dispatched}, escalated ${result.escalated}, skipped ${result.skipped}`
    );
  }

  const switchboardToken = await loadSwitchboardToken();
  if (listOrgs().length > 0 && switchboardToken) {
    const client = makeSwitchboardClient(
      boardConfig.switchboard.url,
      switchboardToken
    );
    if (peerMode)
      await runPeerTick(
        client,
        boardMaterializeDeps(line => console.error(line))
      );
    let ownUrls = new Set<string>();
    let nudgeReady = true;
    if (!peerMode || needsOwnMrs(readNudges())) {
      try {
        if (peerMode) username = await resolveUsername();
        ownUrls = new Set((await fetchOwnMrs()).map(m => m.mrUrl));
      } catch (err) {
        if (!peerMode) throw err;
        // An empty set would reject a pending respond ask as not-your-mr.
        nudgeReady = false;
        console.error(
          `peer pass: own MRs unavailable, respond asks wait (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }
    if (nudgeReady) {
      const nudgeResult = await runNudgePass({
        readNudges,
        markNudgeHandled: (id, r, reason, opts) =>
          markNudgeHandled(id, r, reason, undefined, undefined, opts),
        readReviewStates,
        readRespondStates,
        isOwnMr: mrUrl => ownUrls.has(mrUrl),
        launchAsk: makeAskLauncher(boardConfig),
        alwaysAllow: loadPeerAsksAlwaysAllow(),
        markNudgeNotified: id => markNudgeNotified(id),
        // Best effort: runNudgePass awaits this before marking the ask
        // notified, so a throw here would abort the pass.
        notifyAsk: async n => {
          try {
            boardUrl ??= deckAppUrl('board');
            const base = await boardUrl;
            const fromName =
              reviewerDisplayName(n.from, boardConfig.members, new Map()) ??
              n.from;
            const { title, message } = askNotice(n, fromName);
            await notifyEscalation(title, message, 'rt', {
              url: base ? boardAskLink(base, n.id) : null,
              category: 'peer-ask',
            });
          } catch {
            // the held ask still shows in the inbox
          }
        },
        publishOutcome: (to, payload) =>
          enqueueOutbox(makeEnvelope(to, 'nudge-outcome', payload)),
        memory,
        cfg: { ...triage, enabled: peerAsks.enabled },
        appendAudit,
        notify,
        now: () => Date.now(),
      });
      await drainOutbox(d => client.publish(d));
      console.log(
        `nudges: dispatched ${nudgeResult.dispatched}, rejected ${nudgeResult.rejected}, expired ${nudgeResult.expired}, held ${nudgeResult.held}, skipped ${nudgeResult.skipped}`
      );
    }
  }

  // The latch pass writes to GitLab, so without a token there is nothing it
  // can do. Both passes bank cooldown and budget counters into the same
  // memory, and this one runs whether or not a switchboard is configured, so
  // the persist below sits outside that block.
  const latchToken = await loadGitLabToken();
  if (!peerMode && latchToken && username && reReview.enabled) {
    try {
      const latchResult = await runLatchPass({
        readReviewStates,
        readPrunedReviewStates,
        resurrectReviewState,
        dropPrunedReviewState,
        fetchLatchMrs,
        readDetail: async mr => {
          const res = await readDiscussions(mr.rtRepo, mr.iid);
          if (!res.ok || !res.data) return null;
          return { discussions: res.data.discussions } as MRDetail;
        },
        gateway: latchGateway(boardConfig.gitlabHost, latchToken),
        self: username,
        launchReReview: (mrUrl, iid) =>
          launchReReview(mrUrl, iid, {
            cwd: boardConfig.reviewCwd,
            repo: repoForMrUrl(mrUrl),
            workspaceLabel: boardConfig.reviewsWorkspace,
            forTab: tab => reviewLaunchForTab(boardConfig, mrUrl, tab),
            ...loadAgentSettings(),
            claudeCommand: boardConfig.claudeCommand,
          }),
        memory,
        cfg: triage,
        reReview,
        appendAudit,
        notify,
        now: () => Date.now(),
      });
      console.log(`latch pass: ${JSON.stringify(latchResult)}`);
    } catch (err) {
      // The pass makes many unguarded GitLab calls. A throw here must not cost
      // BOTH passes their cooldown and budget counters, which the persist
      // below banks.
      console.error(`latch pass failed: ${err}`);
    }
  }
  writeMemory(memory);
} finally {
  releaseCron(lockToken);
}
