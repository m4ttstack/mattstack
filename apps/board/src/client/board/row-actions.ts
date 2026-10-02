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
      name: 'file' | 'people' | 'copy' | 'branch' | 'dismiss' | 'note';
    }
  | { kind: 'flag'; name: 'conflicts' | 'auto-merge' | 'draft' }
  | { kind: 'out' }
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
  | { kind: 'draft'; draft: boolean }
  | { kind: 'react'; emoji: string; glyph: string; remove: boolean }
  | { kind: 'find-thread' }
  | { kind: 'ask'; ask: 'review' | 're-review' | 'respond'; reviewer?: string }
  | { kind: 'post-slack' }
  | { kind: 'post-owners' }
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
    options: Array<{ value: string; hint?: string }>;
  };
}

export interface RowAction extends MenuEntry {
  request: ActionRequest;
  /** Present only when the action can join the bulk menu: its grouped
      wording ("call doctor" covers "call doctor again" too). */
  bulk?: string;
}

export interface ActionEnv {
  local: boolean;
  slackEnabled: boolean;
  /** Auto-doctor on for this board; undefined = unknown. */
  triageEnabled?: boolean;
  /** The rt repos (as stamped on a row's `rtRepo`) whose Code Owner section
      names carry Slack channels; absent means none. */
  ownerSlackRepos?: string[];
  /** The board's seat; null on an "all" board. */
  self: string | null;
  roster: string[];
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
const DRAFT: ActionGlyph = { kind: 'flag', name: 'draft' };
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

/** Every action this MR offers, in menu order, each in one section. Who is
    looking (local board, own MR, seat, Slack on) decides whether a row
    exists; the MR's own state only blocks it, with a reason, so no action
    can vanish because of a wrong guess about state. */
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
    const reviewRunning =
      mrx.review?.status === 'queued' || mrx.review?.status === 'reviewing';
    const reviewItems = reviewMenuItems(
      mrx.review?.status,
      laneInterrupted(mrx.orphan, mrx.review),
      reviewLogged(mrx)
    );
    const reReviewOffered = reviewItems.some(it => it.kind === 're-review');
    for (const it of reviewItems) {
      if (reviewRunning)
        agent.push(
          agentItem('review', 'focus-review', it.label, {
            kind: 'launch',
            flow: 'review',
            intent: 'focus',
          })
        );
      else if (it.kind === 're-review')
        agent.push(
          agentItem(
            'review',
            're-review',
            it.label,
            { kind: 'launch', flow: 're-review' },
            { notable: true, bulk: 're-review' }
          )
        );
      else if (reReviewOffered)
        sessions.push(
          agentItem(
            'review',
            'review',
            'review from scratch',
            { kind: 'launch', flow: 'review' },
            { section: 'sessions', notable: true, bulk: 'review' }
          )
        );
      else
        agent.push(
          agentItem(
            'review',
            'review',
            it.label,
            { kind: 'launch', flow: 'review' },
            { notable: true, bulk: 'review' }
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
      // Both words ride the focus intent: the launch route already re-opens
      // a dead pane, the label only says which of the two it will do.
      const focuses =
        label === 'focus response' || label === 'relaunch response';
      agent.push(
        focuses
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
              { notable: true }
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
      const label = doctorItemLabel(mrx.doctor?.status);
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
              { notable: true, bulk: 'call doctor' }
            )
      );
    }
    if (
      own &&
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
      // A lane line that is live stays dismissable on any MR, own or not.
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
    const peers = nudgeTargets(mrx);
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
    if (!peers.length)
      sessions.push(
        item(
          'sessions',
          'nudge-none',
          "ask a reviewer's agent to re-review",
          PEOPLE,
          { kind: 'ask', ask: 're-review' },
          {
            blocked: askOutstanding(mrx)
              ? 'ask already sent'
              : 'no peer review',
          }
        )
      );
    const askTargets = firstReviewTargets(mrx, env.roster, env.peers);
    sessions.push(
      item(
        'sessions',
        'request-review',
        'request review from…',
        PEOPLE,
        { kind: 'ask', ask: 'review' },
        askTargets.length
          ? {
              pick: {
                title: 'request review from',
                aria: 'request review',
                options: askTargets.map(value => ({ value })),
              },
              bulk: 'request review from…',
            }
          : {
              blocked: askOutstanding(mrx)
                ? 'ask already sent'
                : 'everyone engaged',
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
    const autoMerge = mrx.autoMergeButton;
    gitlab.push(
      autoMerge.visible && autoMerge.isActive
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

  const s = mrx.slack;
  if (env.local && env.slackEnabled) {
    const found = s?.status === 'found';
    if (found) {
      const reactions = s.reactions ?? [];
      for (const m of getSlackMarks()) {
        const marked = reactions.includes(m.emoji);
        const label = marked ? `unmark ${m.word}` : `mark as ${m.word}`;
        top.push(
          item(
            'top',
            `${marked ? 'unreact' : 'react'}-${m.emoji}`,
            label,
            { kind: 'emoji', glyph: m.glyph },
            { kind: 'react', emoji: m.emoji, glyph: m.glyph, remove: marked },
            { marked, keepOpen: true, bulk: label }
          )
        );
      }
    } else
      top.push(
        item(
          'top',
          'find-thread',
          s?.status === 'notfound'
            ? 'no thread, find it again'
            : 'find slack thread',
          SLACK,
          { kind: 'find-thread' },
          { bulk: 'find slack threads' }
        )
      );
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
    if (own)
      slack.push(
        item(
          'slack',
          'post-slack',
          mrx.slackChannel ? `post to #${mrx.slackChannel}` : 'post to slack',
          SLACK,
          { kind: 'post-slack' },
          block(found && 'thread exists')
        )
      );
    if (own && !!mrx.rtRepo && env.ownerSlackRepos?.includes(mrx.rtRepo))
      slack.push(
        item('slack', 'post-owners', 'post to code owners…', SLACK, {
          kind: 'post-owners',
        })
      );
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

  return [...top, ...agent, ...sessions, ...gitlab, ...slack, ...more];
}

/** Launches past this many ask for a second click. */
export const LAUNCH_CONFIRM_OVER = 3;

export interface BulkEntry extends MenuEntry {
  request: ActionRequest;
  /** The checked MRs that need the action; the rest are already there. */
  targets: BoardMRWithReview[];
  /** How many MRs are checked, so a run can say how many it skipped. */
  selected: number;
  /** request review from…: who can be asked on which of the targets. */
  pickTargets?: Map<string, BoardMRWithReview[]>;
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
    case 'find-thread':
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
  'find-thread',
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
    // Ladder position lands as a fraction so every mark still sorts between
    // the react slot and find-thread.
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
    n > LAUNCH_CONFIRM_OVER ? `really start ${n} re-reviews?` : undefined,
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
    const actions = rowActions(mr, env).filter(a => !a.blocked);
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
    }
  >();
  for (const [key, first] of firstOf) {
    const targets: BoardMRWithReview[] = [];
    const picks = new Map<string, BoardMRWithReview[]>();
    let fits = true;
    for (const { mr, actions, offered, own: isOwn } of rows) {
      const offeredAction = actions.find(a => a.key === key);
      if (offeredAction) {
        targets.push(mr);
        for (const o of offeredAction.pick?.options ?? [])
          picks.set(o.value, [...(picks.get(o.value) ?? []), mr]);
      } else if (!alreadyThere(key, offered, isOwn)) fits = false;
    }
    if (fits) groups.set(key, { first, targets, picks });
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
      label: g.first.bulk ?? g.first.label,
      glyph: g.first.glyph,
      lane: g.first.lane,
      request: g.first.request,
      targets: g.targets,
      selected: mrs.length,
      confirm: BULK_CONFIRM[key]?.(g.targets.length),
      blocked: key === 'merge' ? mergeBlock(mrs, env.allMrs) : undefined,
    };
    if (g.first.pick) {
      entry.pick = {
        ...g.first.pick,
        options: [...g.picks.keys()].map(value => ({ value })),
      };
      entry.pickTargets = g.picks;
    }
    return entry;
  });
  return entries.sort(
    (x, y) =>
      SECTION_RANK[BULK_SECTION[x.section]] -
        SECTION_RANK[BULK_SECTION[y.section]] ||
      bulkRank(x.key) - bulkRank(y.key)
  );
}
