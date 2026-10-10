/** What the row menu offers, as data. One MR's actions come from
    rowActions; the bulk menu groups several MRs' lists (bulkActions), so the
    one-row and bulk menus can never disagree about what an MR can take.
    DOM-free, so both menus and their tests share it. */
import { mergeBlockedReason } from '@mattstack/glance';
import type { BoardMR } from '../../data.ts';
import type { MrAction } from '../../mr-action.ts';
import { hasStackDescendants, isOwnMr, stackParents } from '../../view.ts';
import type { BoardMRWithReview } from '../types.ts';
import {
  askOutstanding,
  DOCTOR_ACTIVE,
  doctorInterrupted,
  doctorItemLabel,
  firstReviewTargets,
  getSlackMarks,
  laneInterrupted,
  nudgeTargets,
  respondAskBlock,
  respondAskTarget,
  respondItemLabel,
  reviewLogged,
  reviewMenuItems,
  SEAT_HINT,
} from './format.ts';
import { laneDismissed } from './row-status.ts';

export type Lane = 'review' | 'respond' | 'doctor';
export type Section =
  'top' | 'agent' | 'sessions' | 'gitlab' | 'slack' | 'more';

export type ActionGlyph =
  | {
      kind: 'menu';
      name:
        'file' | 'people' | 'copy' | 'branch' | 'dismiss' | 'note' | 'refresh';
    }
  | { kind: 'flag'; name: 'conflicts' | 'auto-merge' | 'draft' }
  | { kind: 'out' }
  | { kind: 'agent-cloud' }
  | { kind: 'agent' }
  | { kind: 'slack' }
  | { kind: 'emoji'; glyph: string };

export type LaunchFlow =
  | 'review'
  | 're-review'
  | 'resume-review'
  | 'respond'
  | 'resume-respond'
  | 'doctor'
  | 'rebase-local';

export type ActionRequest =
  | { kind: 'launch'; flow: LaunchFlow; intent?: 'focus' }
  | { kind: 'mr'; action: MrAction }
  | { kind: 'refresh' }
  | { kind: 'draft'; draft: boolean }
  | { kind: 'react'; emoji: string; glyph: string; remove: boolean }
  | {
      kind: 'ask';
      ask: 'review' | 're-review' | 'respond';
      reviewer?: string;
      note?: string;
    }
  | { kind: 'post-slack' }
  | { kind: 'copy' }
  | { kind: 'note' }
  | { kind: 'open'; url: string }
  | { kind: 'view-report'; lane: 'review' | 'respond' }
  | { kind: 'dismiss'; lane: Lane }
  | { kind: 'stand-down'; on: boolean };

export interface MenuEntry {
  key: string;
  section: Section;
  label: string;
  /** Null for an agent action, which leads with the bot mark in its lane's
      color instead. */
  glyph: ActionGlyph | null;
  lane?: Lane;
  hint?: string;
  /** The first click arms the item and swaps its label for this; the
      second click fires it. */
  confirm?: string;
  /** A redo starts its lane over from scratch, so it asks first in a
      dialog (redo-copy.ts) rather than firing on the click. */
  redo?: Lane;
  /** Shown with this reason under the label, and never clickable. */
  blocked?: string;
  /** Alt-click opens the note box before firing. */
  notable?: boolean;
  marked?: boolean;
  /** The menu stays open while it runs, so several can be set in a row. */
  keepOpen?: boolean;
  pick?: {
    title: string;
    aria: string;
    options: Array<{ value: string; label?: string; hint?: string }>;
  };
}

export interface RowAction extends MenuEntry {
  request: ActionRequest;
  /** Present only when the action can join the bulk menu: its grouped
      wording ("review" covers a first review and a redo). */
  bulk?: string;
}

/** A pick option for a teammate's agent: the username stays the payload. */
function peerOption(env: ActionEnv, value: string) {
  const name = env.names?.get(value);
  return name ? { value, label: name } : { value };
}

export interface ActionEnv {
  local: boolean;
  slackEnabled: boolean;
  /** Auto-doctor on for this board; undefined = unknown. */
  triageEnabled?: boolean;
  /** The tier a menu-launched doctor runs at; undefined = unknown. */
  doctorTier?: 'api' | 'checkout';
  /** The board tab the menu was opened on, which picks the launch's pack. */
  tab?: string;
  /** The rt repos (as stamped on a row's `rtRepo`) whose Code Owner section
      names carry Slack channels; absent means none. */
  ownerSlackRepos?: string[];
  /** The board's seat; null on an "all" board. */
  self: string | null;
  roster: string[];
  /** Full names by username, for labels that read as a person. */
  names?: ReadonlyMap<string, string>;
  /** Enrolled peer usernames when the relay has said; undefined = unknown. */
  peers?: string[];
  /** Every MR on the board, for the stack checks. */
  allMrs: BoardMR[];
}

export interface RunOpts {
  note?: string;
  pick?: string;
}

const FILE: ActionGlyph = { kind: 'menu', name: 'file' };
const PEOPLE: ActionGlyph = { kind: 'menu', name: 'people' };
const DISMISS: ActionGlyph = { kind: 'menu', name: 'dismiss' };
const COPY: ActionGlyph = { kind: 'menu', name: 'copy' };
const NOTE: ActionGlyph = { kind: 'menu', name: 'note' };
const REFRESH: ActionGlyph = { kind: 'menu', name: 'refresh' };
const DRAFT: ActionGlyph = { kind: 'flag', name: 'draft' };
const AGENT_CLOUD: ActionGlyph = { kind: 'agent-cloud' };
const SLACK: ActionGlyph = { kind: 'slack' };
const GITLAB_GLYPH: Record<MrAction, ActionGlyph> = {
  merge: { kind: 'flag', name: 'conflicts' },
  rebase: { kind: 'menu', name: 'branch' },
  setAutoMerge: { kind: 'flag', name: 'auto-merge' },
  cancelAutoMerge: { kind: 'flag', name: 'auto-merge' },
};

function agentItem(
  lane: Lane,
  key: string,
  label: string,
  request: ActionRequest,
  extra: Partial<RowAction> = {}
): RowAction {
  return { key, section: 'agent', label, glyph: null, lane, request, ...extra };
}

function item(
  section: Section,
  key: string,
  label: string,
  glyph: ActionGlyph,
  request: ActionRequest,
  extra: Partial<RowAction> = {}
): RowAction {
  return { key, section, label, glyph, request, ...extra };
}

const block = (
  reason: string | null | false | undefined
): Partial<RowAction> => (reason ? { blocked: reason } : {});

/** Block reasons that only say there is nothing yet to act on; the session
    rows carrying them are left out rather than shown disabled. */
const ABSENT = new Set(['no session', 'no report yet', 'nothing to dismiss']);

/** Every action this MR offers, in menu order, each in one section. A row
    is omitted for who is looking (local board, own MR, seat, Slack on, an
    opted-in repo) and in these state cases: call doctor on a healthy MR,
    rebase locally on a current one, and a session row (resume, view report,
    dismiss) with nothing to act on. Every other state blocks
    the row with a reason instead of removing it. */
export function rowActions(
  mrx: BoardMRWithReview,
  env: ActionEnv
): RowAction[] {
  const own = isOwnMr(mrx, env.self);
  const top: RowAction[] = [];
  const agent: RowAction[] = [];
  const sessions: RowAction[] = [];
  const gitlab: RowAction[] = [];
  const slack: RowAction[] = [];
  const more: RowAction[] = [];

  if (env.local) {
    const reviewItems = reviewMenuItems(
      mrx.review?.status,
      laneInterrupted(mrx.orphan, mrx.review),
      reviewLogged(mrx),
      mrx.review?.rounds
    );
    const followUpOffered = reviewItems.some(it => it.kind === 'follow-up');
    for (const it of reviewItems) {
      if (it.kind === 'focus')
        agent.push(
          agentItem('review', 'focus-review', it.label, {
            kind: 'launch',
            flow: 'review',
            intent: 'focus',
          })
        );
      else if (it.kind === 'follow-up')
        (own ? sessions : agent).push(
          agentItem(
            'review',
            're-review',
            it.label,
            { kind: 'launch', flow: 're-review' },
            {
              notable: true,
              bulk: 'follow-up review',
              ...(own ? { section: 'sessions' as const } : {}),
            }
          )
        );
      else
        (own || followUpOffered ? sessions : agent).push(
          agentItem(
            'review',
            'review',
            it.label,
            { kind: 'launch', flow: 'review' },
            {
              notable: true,
              bulk: 'review',
              ...(own || followUpOffered
                ? { section: 'sessions' as const }
                : {}),
              ...(it.kind === 'redo' ? { redo: 'review' as const } : {}),
            }
          )
        );
    }
    sessions.push(
      agentItem(
        'review',
        'resume-review',
        'resume review',
        { kind: 'launch', flow: 'resume-review' },
        {
          section: 'sessions',
          notable: true,
          ...block(!mrx.review?.sessionId && 'no session'),
        }
      )
    );
    if (own) {
      const label = respondItemLabel(
        mrx.respond?.status,
        laneInterrupted(mrx.orphan, mrx.respond)
      );
      agent.push(
        label === 'focus response'
          ? agentItem('respond', 'focus-respond', label, {
              kind: 'launch',
              flow: 'respond',
              intent: 'focus',
            })
          : agentItem(
              'respond',
              'respond',
              label,
              { kind: 'launch', flow: 'respond' },
              {
                notable: true,
                ...(label === 'redo response'
                  ? { redo: 'respond' as const }
                  : {}),
              }
            )
      );
      sessions.push(
        agentItem(
          'respond',
          'resume-respond',
          'resume response',
          { kind: 'launch', flow: 'resume-respond' },
          {
            section: 'sessions',
            notable: true,
            ...block(!mrx.respond?.sessionId && 'no session'),
          }
        )
      );
    }
    if (own && (mrx.blockers?.pipelineFailing || mrx.blockers?.hasConflicts)) {
      const label = doctorItemLabel(
        mrx.doctor?.status,
        doctorInterrupted(mrx),
        env.doctorTier
      );
      agent.push(
        label === 'focus doctor'
          ? agentItem('doctor', 'focus-doctor', label, {
              kind: 'launch',
              flow: 'doctor',
              intent: 'focus',
            })
          : agentItem(
              'doctor',
              'doctor',
              label,
              { kind: 'launch', flow: 'doctor' },
              {
                notable: true,
                bulk: doctorItemLabel(undefined, false, env.doctorTier),
                ...(label === 'redo doctor' ? { redo: 'doctor' as const } : {}),
              }
            )
      );
    }
    if (
      own &&
      (!mrx.doctorSkillTabs || mrx.doctorSkillTabs.includes(env.tab ?? '')) &&
      (mrx.blockers?.hasConflicts ||
        mrx.rebaseButton.visible ||
        (mrx.behindTarget ?? 0) > 0)
    )
      agent.push(
        agentItem(
          'doctor',
          'rebase-local',
          'rebase locally',
          { kind: 'launch', flow: 'rebase-local' },
          { notable: true }
        )
      );
  }

  sessions.push(
    item(
      'sessions',
      'view-review',
      'view agent review',
      FILE,
      { kind: 'view-report', lane: 'review' },
      block(!mrx.review?.reportReady && 'no report yet')
    )
  );
  if (own || mrx.respond?.reportReady)
    sessions.push(
      item(
        'sessions',
        'view-respond',
        'view agent response',
        FILE,
        { kind: 'view-report', lane: 'respond' },
        block(!mrx.respond?.reportReady && 'no report yet')
      )
    );
  if (env.local)
    for (const lane of ['review', 'respond', 'doctor'] as const) {
      const state = mrx[lane];
      const live = state?.status === 'error' && !laneDismissed(state);
      // A live error line must never lose its dismiss, whoever owns the MR.
      if (lane !== 'review' && !own && !live) continue;
      sessions.push(
        item(
          'sessions',
          `dismiss-${lane}`,
          `dismiss ${lane} line`,
          DISMISS,
          { kind: 'dismiss', lane },
          block(!live && 'nothing to dismiss')
        )
      );
    }
  if (env.local && own) {
    const peers = nudgeTargets(mrx, env.peers);
    for (const peer of peers)
      sessions.push(
        item(
          'sessions',
          `nudge-${peer.reviewer}`,
          `ask ${peer.reviewer}'s agent to re-review`,
          PEOPLE,
          { kind: 'ask', ask: 're-review', reviewer: peer.reviewer }
        )
      );
    const askTargets = firstReviewTargets(mrx, env.roster, env.peers);
    (askTargets.length ? agent : sessions).push(
      item(
        askTargets.length ? 'agent' : 'sessions',
        'request-review',
        'request review from…',
        AGENT_CLOUD,
        { kind: 'ask', ask: 'review' },
        askTargets.length
          ? {
              pick: {
                title: 'request review from',
                aria: 'request review',
                options: askTargets.map(value => peerOption(env, value)),
              },
              bulk: 'request review from…',
            }
          : {
              blocked: askOutstanding(mrx)
                ? 'ask already sent'
                : env.peers &&
                    !env.roster.some(
                      u => u !== mrx.author.username && env.peers!.includes(u)
                    )
                  ? 'no teammate boards connected'
                  : 'no teammate left to ask',
            }
      )
    );
  }
  if (env.local && env.self !== null && !own) {
    const target = respondAskTarget(mrx, env.peers);
    const who = target ?? mrx.author.username;
    agent.push(
      item(
        'agent',
        'ask-respond',
        `ask ${who}'s agent to respond`,
        PEOPLE,
        { kind: 'ask', ask: 'respond', reviewer: who },
        target ? {} : { blocked: respondAskBlock(mrx) }
      )
    );
  }
  if (env.local && env.self === null)
    agent.push(
      item(
        'agent',
        'seat-hint',
        'author actions',
        PEOPLE,
        { kind: 'open', url: '' },
        { blocked: SEAT_HINT }
      )
    );
  if (!env.local)
    agent.push(
      item(
        'agent',
        'local-hint',
        'agent actions',
        PEOPLE,
        { kind: 'open', url: '' },
        { blocked: 'need a local board' }
      )
    );

  if (env.local && own) {
    // glance hides both buttons on a draft or an MR that is not open; the
    // board lists only open MRs, so a hidden button past draft is a state
    // the row blocks rather than one it trusts.
    const hidden = mrx.isDraft ? 'draft' : 'not mergeable yet';
    gitlab.push(
      item(
        'gitlab',
        'merge',
        'merge',
        GITLAB_GLYPH.merge,
        { kind: 'mr', action: 'merge' },
        {
          bulk: 'merge',
          confirm: 'really merge?',
          ...block(
            mergeBlockedReason(mrx) || (!mrx.mergeButton.visible && hidden)
          ),
        }
      )
    );
    gitlab.push(
      item(
        'gitlab',
        'rebase',
        'rebase on target',
        GITLAB_GLYPH.rebase,
        { kind: 'mr', action: 'rebase' },
        {
          bulk: 'rebase on target',
          ...block(
            mrx.rebaseButton.loading
              ? 'rebasing'
              : !mrx.rebaseButton.visible &&
                  mrx.behindTarget === 0 &&
                  'up to date'
          ),
        }
      )
    );
    // An armed auto-merge stays cancellable on a draft, where glance hides
    // the button: GitLab's cancel checks only that auto-merge is on.
    const autoMerge = mrx.autoMergeButton;
    gitlab.push(
      autoMerge.isActive
        ? item(
            'gitlab',
            'cancelAutoMerge',
            'cancel auto-merge',
            GITLAB_GLYPH.cancelAutoMerge,
            { kind: 'mr', action: 'cancelAutoMerge' },
            { bulk: 'cancel auto-merge' }
          )
        : item(
            'gitlab',
            'setAutoMerge',
            'set auto-merge',
            GITLAB_GLYPH.setAutoMerge,
            { kind: 'mr', action: 'setAutoMerge' },
            {
              bulk: 'set auto-merge',
              ...block(!autoMerge.visible && hidden),
            }
          )
    );
    gitlab.push(
      mrx.isDraft
        ? item(
            'gitlab',
            'mark-ready',
            'mark ready',
            DRAFT,
            { kind: 'draft', draft: false },
            { bulk: 'mark ready' }
          )
        : item(
            'gitlab',
            'mark-draft',
            'mark as draft',
            DRAFT,
            { kind: 'draft', draft: true },
            { bulk: 'mark as draft' }
          )
    );
  }
  gitlab.push(
    item(
      'gitlab',
      'open-gitlab',
      'open in gitlab',
      { kind: 'out' },
      { kind: 'open', url: mrx.webUrl ?? '' }
    )
  );
  if (env.local)
    gitlab.push(
      item('gitlab', 'refresh-mr', 'refresh from gitlab', REFRESH, {
        kind: 'refresh',
      })
    );

  const s = mrx.slack;
  if (env.local && env.slackEnabled) {
    const found = s?.status === 'found';
    if (found) {
      const reactions = s.reactions ?? [];
      for (const m of getSlackMarks()) {
        const marked = reactions.includes(m.emoji);
        const label = marked ? `unmark ${m.word}` : `mark as ${m.word}`;
        slack.push(
          item(
            'slack',
            `${marked ? 'unreact' : 'react'}-${m.emoji}`,
            label,
            { kind: 'emoji', glyph: m.glyph },
            { kind: 'react', emoji: m.emoji, glyph: m.glyph, remove: marked },
            { marked, keepOpen: true, bulk: label }
          )
        );
      }
    }
    slack.push(
      item(
        'slack',
        'open-slack-post',
        'open MR post in slack',
        SLACK,
        { kind: 'open', url: (found && s.permalink) || '' },
        block(!found ? 'no thread' : !s.permalink && 'no link yet')
      )
    );
    if (own) {
      // The author leads with posting while anything is left to post. In a
      // repo whose code owners have channels the item is never blocked: a
      // push can reset approvals, and the dialog reads them fresh. With no
      // record of what the dialog offered, a team thread still offers the
      // code owners.
      const owners =
        !!mrx.rtRepo && !!env.ownerSlackRepos?.includes(mrx.rtRepo);
      const left = mrx.ownerPostsLeft;
      const othersLeft =
        owners && (left ? left.some(c => c !== mrx.slackChannel) : found);
      const leads = !found || othersLeft;
      (leads ? top : slack).push(
        item(
          leads ? 'top' : 'slack',
          'post-slack',
          othersLeft ? 'post to other codeowners…' : 'post to slack',
          SLACK,
          { kind: 'post-slack' },
          block(!owners && found && 'posted')
        )
      );
    }
  }
  slack.push(item('slack', 'copy', 'copy for slack', COPY, { kind: 'copy' }));
  more.push(
    item('more', 'note', mrx.note ? 'edit note' : 'add a note', NOTE, {
      kind: 'note',
    })
  );
  if (env.local && own) {
    // Auto-doctor only ever acts on the seat's own MRs. Matched by url: the MR
    // handed in can be a copy (optimistic overlay, live slack marks), and the
    // stack walk compares objects.
    const onBoard = env.allMrs.find(m => m.webUrl === mrx.webUrl) ?? mrx;
    const doctorActive =
      !!mrx.doctor?.status && DOCTOR_ACTIVE.has(mrx.doctor.status);
    more.push(
      item(
        'more',
        'stand-down',
        mrx.standDown
          ? 're-enable auto-doctor'
          : `auto-doctor: ignore this ${hasStackDescendants(onBoard, env.allMrs) ? 'stack' : 'MR'}`,
        DISMISS,
        { kind: 'stand-down', on: !mrx.standDown },
        block(
          !mrx.standDown &&
            env.triageEnabled === false &&
            !doctorActive &&
            'auto-doctor is off'
        )
      )
    );
  }

  return [
    ...top,
    ...agent,
    ...sessions.filter(a => !a.blocked || !ABSENT.has(a.blocked.trim())),
    ...gitlab,
    ...slack,
    ...more,
  ];
}

/** Launches past this many ask for a second click. */
export const LAUNCH_CONFIRM_OVER = 3;

export interface BulkEntry extends MenuEntry {
  section: BulkSection;
  request: ActionRequest;
  /** The checked MRs that need the action; the rest are already there. */
  targets: BoardMRWithReview[];
  /** How many MRs are checked, so a run can say how many it skipped. */
  selected: number;
  /** request review from…: who can be asked on which of the targets. */
  pickTargets?: Map<string, BoardMRWithReview[]>;
  /** How many targets already had a run, when any did (see `redo`). */
  redoCount?: number;
}

/** Bulk keys someone else's MR can never reach, so it never counts as
    already there for them: checking it hides the action. */
const AUTHOR_ONLY_BULK = new Set([
  'merge',
  'rebase',
  'setAutoMerge',
  'cancelAutoMerge',
  'doctor',
  'mark-ready',
  'mark-draft',
  'request-review',
]);

/** A checked MR that does not offer a bulk action is either already where
    the action would take it (skipped) or cannot get there (the action
    hides). Read off the MR's own rowActions keys, so the rules stay there. */
function alreadyThere(
  key: string,
  offered: ReadonlySet<string>,
  own: boolean
): boolean {
  if (!own && AUTHOR_ONLY_BULK.has(key)) return false;
  const mark = /^(un)?react-(.+)$/.exec(key);
  if (mark) return offered.has(`${mark[1] ? '' : 'un'}react-${mark[2]}`);
  switch (key) {
    // Reviewed, or a review or doctor is running; healthy; up to date;
    // thread already found. None of these has a "cannot" case on a local
    // board.
    case 'review':
    case 'doctor':
    case 'rebase':
      return true;
    case 're-review':
      return offered.has('focus-review');
    case 'setAutoMerge':
      return offered.has('cancelAutoMerge');
    case 'cancelAutoMerge':
      return offered.has('setAutoMerge');
    case 'mark-ready':
      return offered.has('mark-draft');
    case 'mark-draft':
      return offered.has('mark-ready');
    default:
      return false;
  }
}

export type BulkSection = 'agent' | 'gitlab' | 'slack';
/** The bulk menu keeps its three headings; each row section folds onto one. */
export const BULK_SECTION: Record<Section, BulkSection> = {
  top: 'slack',
  agent: 'agent',
  sessions: 'agent',
  gitlab: 'gitlab',
  slack: 'slack',
  more: 'slack',
};
const SECTION_RANK: Record<BulkSection, number> = {
  agent: 0,
  gitlab: 1,
  slack: 2,
};
const BULK_RANK = [
  'review',
  're-review',
  'doctor',
  'request-review',
  'rebase',
  'setAutoMerge',
  'cancelAutoMerge',
  'mark-ready',
  'mark-draft',
  'merge',
  'react',
];

function bulkRank(key: string): number {
  const emoji = key.startsWith('react-')
    ? key.slice('react-'.length)
    : key.startsWith('unreact-')
      ? key.slice('unreact-'.length)
      : null;
  if (emoji !== null) {
    const marks = getSlackMarks();
    const rung = marks.findIndex(m => m.emoji === emoji);
    // Ladder position lands as a fraction so every mark still sorts after
    // the react slot.
    return (
      BULK_RANK.indexOf('react') +
      (rung === -1 ? marks.length : rung) / (marks.length + 1)
    );
  }
  const i = BULK_RANK.indexOf(key);
  return i === -1 ? BULK_RANK.length : i;
}

const BULK_CONFIRM: Record<string, (n: number) => string | undefined> = {
  merge: n => `really merge ${n}?`,
  review: n =>
    n > LAUNCH_CONFIRM_OVER ? `really start ${n} reviews?` : undefined,
  're-review': n =>
    n > LAUNCH_CONFIRM_OVER
      ? `really start ${n} follow-up reviews?`
      : undefined,
  doctor: n =>
    n > LAUNCH_CONFIRM_OVER ? `really call doctor on ${n}?` : undefined,
};

/** Merging a child before its parent lands it in the parent's branch, not
    the target, so a checked child of an open MR stops the whole merge. */
function mergeBlock(checked: BoardMR[], allMrs: BoardMR[]): string | undefined {
  const parentByUrl = new Map(
    [...stackParents(allMrs)].map(([child, parent]) => [child.webUrl, parent])
  );
  for (const mr of checked) {
    const parent = parentByUrl.get(mr.webUrl);
    if (parent) return `!${mr.iid} sits on !${parent.iid}, which is still open`;
  }
  return undefined;
}

/** An unknown behind count leaves the row's rebase enabled, but a bulk
    rebase only targets an MR GitLab or the behind count says is behind;
    the rest count as already there. */
function rebaseNeeded(mr: BoardMR): boolean {
  return mr.rebaseButton.visible || (mr.behindTarget ?? 0) > 0;
}

/** The bulk menu: an action shows when every checked MR either offers it
    (a target) or is already where it leads (skipped); one checked MR that
    cannot get there hides it. Eligibility comes only from rowActions; what
    is added here exists only for a group (confirms, the stack block, mark
    over unmark, the merged picker). */
export function bulkActions(
  mrs: BoardMRWithReview[],
  env: ActionEnv
): BulkEntry[] {
  if (!env.local) return [];
  const rows = mrs.map(mr => {
    const actions = rowActions(mr, env).filter(
      a => !a.blocked && (a.key !== 'rebase' || rebaseNeeded(mr))
    );
    return {
      mr,
      actions,
      offered: new Set(actions.map(a => a.key)),
      own: isOwnMr(mr, env.self),
    };
  });
  const firstOf = new Map<string, RowAction>();
  for (const { actions } of rows)
    for (const action of actions)
      if (action.bulk && !firstOf.has(action.key))
        firstOf.set(action.key, action);

  const groups = new Map<
    string,
    {
      first: RowAction;
      targets: BoardMRWithReview[];
      picks: Map<string, BoardMRWithReview[]>;
      redo?: Lane;
      redoCount: number;
    }
  >();
  for (const [key, first] of firstOf) {
    const targets: BoardMRWithReview[] = [];
    const picks = new Map<string, BoardMRWithReview[]>();
    let redo: Lane | undefined;
    let redoCount = 0;
    let fits = true;
    for (const { mr, actions, offered, own: isOwn } of rows) {
      const offeredAction = actions.find(a => a.key === key);
      if (offeredAction) {
        targets.push(mr);
        if (offeredAction.redo) {
          redo = offeredAction.redo;
          redoCount++;
        }
        for (const o of offeredAction.pick?.options ?? [])
          picks.set(o.value, [...(picks.get(o.value) ?? []), mr]);
      } else if (!alreadyThere(key, offered, isOwn)) fits = false;
    }
    if (fits) groups.set(key, { first, targets, picks, redo, redoCount });
  }
  for (const key of [...groups.keys()])
    if (
      key.startsWith('unreact-') &&
      groups.has(`react-${key.slice('unreact-'.length)}`)
    )
      groups.delete(key);

  const entries = [...groups].map(([key, g]): BulkEntry => {
    const entry: BulkEntry = {
      key,
      section: BULK_SECTION[g.first.section],
      label:
        g.redo && g.redoCount === g.targets.length
          ? g.first.label
          : (g.first.bulk ?? g.first.label),
      glyph: g.first.glyph,
      lane: g.first.lane,
      request: g.first.request,
      targets: g.targets,
      selected: mrs.length,
      confirm: g.redo ? undefined : BULK_CONFIRM[key]?.(g.targets.length),
      ...(g.redo ? { redo: g.redo, redoCount: g.redoCount } : {}),
      blocked: key === 'merge' ? mergeBlock(mrs, env.allMrs) : undefined,
    };
    if (g.first.pick) {
      entry.pick = {
        ...g.first.pick,
        options: [...g.picks.keys()].map(value => peerOption(env, value)),
      };
      entry.pickTargets = g.picks;
    }
    return entry;
  });
  return entries.sort(
    (x, y) =>
      SECTION_RANK[x.section] - SECTION_RANK[y.section] ||
      bulkRank(x.key) - bulkRank(y.key)
  );
}
