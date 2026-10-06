import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import type { GateDomain } from '@mattstack/gate-kit';
import {
  ICONS,
  Panel,
  SideDrawer,
  ToastHost,
  useToasts,
} from '@mattstack/tui-kit';
import type { TabConfig } from '../../config.ts';
import type { BoardMR } from '../../data.ts';
import { inferRoster } from '../../data.ts';
import type { GateRow } from '../../gates/store.ts';
import type { DeclineReason } from '../../peer/envelope.ts';
import { sectionStatus } from '../../sections.ts';
import {
  menuActsOnSelection,
  postableOf,
  selectionOf,
  tabChangeClearsSelection,
} from '../../selection.ts';
import { ALL_TURN } from '../../turn.ts';
import {
  arrangeGroups,
  dataAgeLabel,
  effectiveSeat,
  effectiveSort,
  filterByMember,
  filterByShow,
  filterByTab,
  freshnessBanner,
  GROUP_KEYS,
  groupOnLeavingSeat,
  isOwnMr,
  NEEDS_ME_TAB,
  nestStacks,
  oldestFirst,
  parseViewState,
  rosterUsernamesFor,
  serializeViewState,
  tabDimsEmpty,
} from '../../view.ts';
import type { GroupKey, ShowItem, StackNode, ViewState } from '../../view.ts';
import {
  acceptAsk,
  declineAsk,
  postAction,
  setAlwaysAllow,
  type ActionResult,
} from '../api.ts';
import type {
  AskKind,
  BoardData,
  BoardMRWithReview,
  DraftInfo,
  RowContext,
  RowMenuState,
  ThemeMode,
} from '../types.ts';
import {
  dispatchRowAction,
  runBulk,
  runOne,
  type LaunchOpts,
  type RowHandlers,
  type RunnerDeps,
} from './action-runner.ts';
import { ActionMenu } from './ActionMenu.tsx';
import { AppMark } from './AppMark.tsx';
import { AskConfirmDialog } from './AskConfirmDialog.tsx';
import { firstName, verbLane } from './asks/ask-copy.ts';
import { AsksButton } from './asks/AsksButton.tsx';
import { CommentsDrawer } from './CommentsDrawer.tsx';
import { ConsoleSettingsModal } from './ConsoleSettingsModal.tsx';
import {
  Controls,
  RefreshControl,
  ThemeControl,
  TURN_SETTINGS_LABEL,
} from './Controls.tsx';
import type { QueueEntry } from './decision-queue.ts';
import {
  decidedEntries,
  gateReadOnlyReason,
  useDecisionQueue,
} from './decision-queue.ts';
import {
  DecisionQueueComplete,
  DecisionQueueModal,
} from './DecisionQueueModal.tsx';
import {
  askParam,
  gateDeepLinkAction,
  gateParam,
  linkedGroupLabel,
  mrForGate,
  mrParam,
  stripDeepLinkParams,
  viewStateForMr,
} from './deep-link.ts';
import { DraftModal } from './DraftModal.tsx';
import { draftKey, mrLine } from './format.ts';
import {
  useBoardData,
  useLaunchAction,
  useMerging,
  useOptimisticLifecycle,
} from './hooks.ts';
import { assignMemberLooks } from './invadr-colors.ts';
import { MemberInvadr, MemberLooksProvider } from './MemberInvadr.tsx';
import { mrRef } from './MrLinks.tsx';
import { NEED_LABEL, NEED_ORDER, needOf } from './needs-me.ts';
import { overlay, overlayMerging } from './optimistic.ts';
import { OwnersPostModal } from './OwnersPostModal.tsx';
import { RespondModal, ReviewModal } from './ReviewModal.tsx';
import {
  bulkActions,
  type ActionEnv,
  type LaunchFlow,
  type RowAction,
  type RunOpts,
} from './row-actions.ts';
import { reviewGroupHue, statusGroupHue } from './row-status.ts';
import { RowMenu } from './RowMenu.tsx';
import { RowView } from './RowView.tsx';
import { SelectionBar } from './SelectionBar.tsx';
import { SettingsModal } from './SettingsModal.tsx';
import { ShowChips } from './ShowChips.tsx';
import { Sidebar } from './Sidebar.tsx';
import { useStaleTabTitle } from './stale-tab-title.ts';
import { TabBar } from './TabBar.tsx';
import { turnSummary } from './turn-summary.ts';
import { TurnSummary } from './TurnSummary.tsx';

declare global {
  interface Window {
    __applyTheme: () => void;
  }
}

// ── toggles ────────────────────────────────────────────────────────────────

const THEME_KEY = 'mrs-theme';
const STATE_KEY = 'mrs-view-state';
const GROUP_BEFORE_SEAT_KEY = 'mrs-group-before-seat';
const PANEL_COLLAPSED_KEY = 'mrs-panel-collapsed';

/** Drops `title` from the folded-panel set tui-kit's Panel persists under
    PANEL_COLLAPSED_KEY (a JSON array of titles), so that panel mounts open. */
/** Grouping by need only means something on the seat tab, as a group or a
    Sort split. */
function groupKeysFor(isSeatTab: boolean): readonly GroupKey[] {
  return isSeatTab ? GROUP_KEYS : GROUP_KEYS.filter(k => k !== 'needs');
}

function unfoldPanel(title: string): void {
  try {
    const folded: unknown = JSON.parse(
      localStorage.getItem(PANEL_COLLAPSED_KEY) ?? '[]'
    );
    if (!Array.isArray(folded) || !folded.includes(title)) return;
    localStorage.setItem(
      PANEL_COLLAPSED_KEY,
      JSON.stringify(folded.filter(t => t !== title))
    );
  } catch {
    // Unreadable or blocked storage leaves the panel as the user folded it.
  }
}

/** Keeps the grouping you had before the seat tab, so leaving it can hand it
    back. Blocked storage costs only that memory, never the tab switch. */
function rememberGroupBeforeSeat(group: GroupKey): void {
  if (group === 'needs') return;
  try {
    localStorage.setItem(GROUP_BEFORE_SEAT_KEY, group);
  } catch {}
}

function groupBeforeSeat(): string | null {
  try {
    return localStorage.getItem(GROUP_BEFORE_SEAT_KEY);
  } catch {
    return null;
  }
}

// A gate stuck on delivery or left execution-unassigned stays in the
// decision queue despite being `answered` -- it still needs a human action
// (focus-pane / retry), and the row's status line only points at the queue,
// which is the one place that action renders.
const needsQueue = (gate: GateRow): boolean =>
  gate.status === 'open' ||
  gate.status === 'parked' ||
  gate.execution === 'unassigned' ||
  gate.delivery?.outcome === 'stuck';

/** The tabs the board shows: the configured ones plus the built-in seat tab
    whenever the board has a seat (never on an "all" board, where nobody's
    move is anybody's). The config editor keeps `data.tabs` alone. */
function boardTabs(d: Pick<BoardData, 'tabs' | 'defaultMember'>): TabConfig[] {
  return d.defaultMember === 'all' ? d.tabs : [...d.tabs, NEEDS_ME_TAB];
}

// Module scope, not inline in useLaunchAction's call below: an inline arrow
// is a new function every render, which breaks the memo chain running
// through launch, runner, runRowAction and rowHandlers.
const resumeReviewFailureMessage = (
  result: ActionResult,
  mr: BoardMR
): string =>
  `resume review failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`;
const resumeRespondFailureMessage = (
  result: ActionResult,
  mr: BoardMR
): string =>
  `resume respond failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`;

// ── board ──────────────────────────────────────────────────────────────────

export function Board() {
  const [theme, setTheme] = useState<ThemeMode>(
    () => (localStorage.getItem(THEME_KEY) as ThemeMode) ?? 'system'
  );

  // View state (member/group/sort). Members are validated once data arrives.
  const [state, setState] = useState<ViewState>(() => {
    let stored: Partial<ViewState> | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    } catch {
      stored = null;
    }
    return parseViewState(location.search, stored, []);
  });
  const validatedOnce = useRef(false);
  // What a `?gate=<id>` or `?mr=<url>` deep link resolved to on first load,
  // consumed by the scroll/flash/strip effect below once that row has
  // actually rendered. A gate link finds its row by iid, an MR link by url.
  const [deepLink, setDeepLink] = useState<{
    gateId: string | null;
    iid: number | null;
    mrUrl: string | null;
  } | null>(null);

  const pickTheme = (m: ThemeMode) => {
    localStorage.setItem(THEME_KEY, m);
    window.__applyTheme();
    setTheme(m);
  };
  const update = (patch: Partial<ViewState>) => {
    const clearsSelection = tabChangeClearsSelection(patch, state.tab);
    // Each tab has its own roster (a codeowners tab's is inferred from the rows
    // in view), so a member picked on one tab usually does not exist on the
    // next: carrying it over would land on an empty board. The seat tab's
    // whole point is its grouping by need, so it opens grouped that way and
    // hands back the grouping you had before on the way out.
    const entersSeat = patch.tab === NEEDS_ME_TAB.id && state.tab !== patch.tab;
    const leavesSeat =
      patch.tab !== undefined &&
      patch.tab !== NEEDS_ME_TAB.id &&
      state.tab === NEEDS_ME_TAB.id;
    if (entersSeat && !patch.group) rememberGroupBeforeSeat(state.group);
    const next = {
      ...state,
      ...patch,
      ...(clearsSelection ? { member: 'all' } : {}),
      ...(entersSeat && !patch.group ? { group: 'needs' as const } : {}),
      ...(leavesSeat && state.group === 'needs'
        ? {
            group: groupOnLeavingSeat(groupBeforeSeat()),
          }
        : {}),
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    history.replaceState(
      null,
      '',
      serializeViewState(next) || location.pathname
    );
    setState(next);
    if (clearsSelection) setSelected(new Set());
  };

  // Re-resolve the view state's member against the roster the instant real
  // data arrives: on the first load, that's URL/localStorage/defaultMember
  // resolved against the now-known roster; on every later load, just drop a
  // member who's no longer on the (visible) roster. Passed into useBoardData
  // (rather than a separate effect keyed on `data`) so it runs in the same
  // batch as setData -- see that hook's doc comment. Deliberately empty deps:
  // it only closes over the (stable) validatedOnce ref and setState.
  const onData = useCallback((d: BoardData) => {
    const usernames = d.members.map(m => m.username);
    if (!validatedOnce.current) {
      validatedOnce.current = true;
      let stored: Partial<ViewState> | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
      } catch {
        stored = null;
      }
      // Tab validated once here, same as member -- never re-derived from the
      // URL on later polls, so a live tab pick survives the 60s refresh cycle.
      // Two passes because the member's valid set depends on which tab wins:
      // a codeowners tab's roster is its own authors, so a stored pick there
      // would otherwise be dropped as "not on the team" on every reload.
      const tabs = boardTabs(d);
      const tabIds = tabs.map(t => t.id);
      const firstPass = parseViewState(
        location.search,
        stored,
        usernames,
        d.defaultMember,
        tabIds
      );
      const tab = tabs.find(t => t.id === firstPass.tab) ?? tabs[0];
      const validMembers = [...rosterUsernamesFor(d.mrs, tab, usernames, tabs)];
      let resolved = parseViewState(
        location.search,
        stored,
        validMembers,
        d.defaultMember,
        tabIds
      );
      const gateId = gateParam(location.search);
      const linkedIid = gateId ? mrForGate(d.mrs, gateId) : null;
      const linkedUrl = gateId ? null : mrParam(location.search);
      if (linkedIid !== null) {
        // The stored/URL filters resolved above may hide the linked MR (wrong
        // tab, a member pick, a Show pick) -- a deep link has to land, so
        // widen whatever would otherwise keep the row off-screen.
        resolved = viewStateForMr(
          resolved,
          d.mrs,
          tabs,
          new Set(usernames),
          m => m.iid === linkedIid,
          d.turn ?? ALL_TURN
        );
        setDeepLink({ gateId: gateId!, iid: linkedIid, mrUrl: null });
      } else if (
        gateId &&
        (d.queueExtras ?? []).some(g => g.gateId === gateId)
      ) {
        // A human-owned gate with no MR row (a pane-attention gate) has no
        // row to widen filters for or flash, but it can still open the modal.
        setDeepLink({ gateId, iid: null, mrUrl: null });
      } else if (linkedUrl !== null) {
        // An MR the board does not hold leaves the view alone; the effect
        // finds no row for it and only strips the param.
        resolved = viewStateForMr(
          resolved,
          d.mrs,
          tabs,
          new Set(usernames),
          m => m.webUrl === linkedUrl,
          d.turn ?? ALL_TURN
        );
        setDeepLink({ gateId: null, iid: null, mrUrl: linkedUrl });
      }
      // Landing on the seat tab without a grouping in the URL means its own
      // grouping; a grouping the user picked there rides in the URL.
      if (
        resolved.tab === NEEDS_ME_TAB.id &&
        !new URLSearchParams(location.search).has('group')
      ) {
        rememberGroupBeforeSeat(resolved.group);
        resolved = { ...resolved, group: 'needs' };
      }
      setState(resolved);
    } else {
      // Validated against the ACTIVE TAB's roster: a codeowners tab's is
      // inferred from the rows in view, so checking the config roster alone
      // would drop a legitimately picked author on the next poll.
      setState(prev => {
        // A tab dropped in the settings modal must not linger as the active
        // id, or re-adding one with that id would silently jump to it.
        const tabs = boardTabs(d);
        const tab = tabs.find(t => t.id === prev.tab) ?? tabs[0]!;
        const next = tab.id === prev.tab ? prev : { ...prev, tab: tab.id };
        if (next.member === 'all') return next;
        return rosterUsernamesFor(d.mrs, tab, usernames, tabs).has(next.member)
          ? next
          : { ...next, member: 'all' };
      });
    }
  }, []);

  // Data fetching (initial load, 60s poll, visibilitychange, SSE, the scoped
  // 15s member poll, and refreshNow) all live in useBoardData now. See that
  // hook's doc comment for why the fast-poll-while-active interval stays here
  // instead -- it needs `data` (this hook's own output) to compute the
  // predicate it would need to take as an argument.
  const { data, loadError, load, refreshNow, refreshing, setData } =
    useBoardData(state.member, onData);

  // Selection for the multi-copy bar, keyed by webUrl so it survives the
  // refresh poll and every member/group/sort change. Deliberately not
  // persisted: a reload should not hand you yesterday's selection.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleSelect = useCallback((webUrl: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(webUrl)) next.add(webUrl);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const [showSettings, setShowSettings] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Row action menu (right-click) and transient toasts.
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  // An ask waiting on the confirm dialog; send runs it with the typed note.
  const [pendingAsk, setPendingAsk] = useState<{
    kind: AskKind;
    reviewer: string;
    subject: string;
    send: (note: string) => void;
  } | null>(null);
  // The MR whose saved review is open in the modal, if any.
  const [reviewModal, setReviewModal] = useState<BoardMRWithReview | null>(
    null
  );
  // The MR whose saved respond adjudication is open in the modal, if any.
  const [respondModal, setRespondModal] = useState<BoardMRWithReview | null>(
    null
  );
  // The held draft open in its drawer, if any, and the drafts already acted on
  // this session (optimistic — the next /data.json pull drops resolved drafts).
  const [draftModal, setDraftModal] = useState<{
    mr: BoardMRWithReview;
    draft: DraftInfo;
  } | null>(null);
  const [ownersPost, setOwnersPost] = useState<BoardMR | null>(null);
  const [draftResolved, setDraftResolved] = useState<
    ReadonlyMap<string, 'posted' | 'dismissed'>
  >(new Map());
  const openDraft = useCallback(
    (mr: BoardMRWithReview, draft: DraftInfo) => setDraftModal({ mr, draft }),
    []
  );
  const [commentsFor, setCommentsFor] = useState<BoardMR | null>(null);
  const { toasts, addToast, startToast } = useToasts();

  // A drawer action succeeded: swap the chip to its resolved state, close the
  // drawer, and confirm with a toast (the board's transient-confirmation form).
  const handleDraftResolved = useCallback(
    (outcome: 'posted' | 'dismissed') => {
      if (!draftModal) return;
      const { mr, draft } = draftModal;
      setDraftResolved(prev =>
        new Map(prev).set(draftKey(mr.webUrl ?? '', draft.kind), outcome)
      );
      setDraftModal(null);
      addToast(
        outcome === 'posted'
          ? `held note posted to !${mr.iid}`
          : `held note dismissed on !${mr.iid}`
      );
    },
    [draftModal, addToast]
  );

  const applyHidden = useCallback((username: string, hidden: boolean) => {
    setData(prev =>
      prev
        ? {
            ...prev,
            // Predict what the reload will send, so nothing flickers when it lands:
            // a checked-out member's MRs aren't fetched, so they have no count.
            allMembers: prev.allMembers.map(m =>
              m.username === username
                ? { ...m, hidden, count: hidden ? null : m.count }
                : m
            ),
          }
        : prev
    );
  }, []);

  // Check a member in/out. The box flips locally first and never waits on the
  // network: the POST is quick, but the reload behind it refetches the team from
  // GitLab (~25s, since a checked-in member's MRs aren't in the snapshot). The
  // board catches up when that lands; a failed POST flips the box back.
  const toggleMember = useCallback(
    (username: string, hidden: boolean) => {
      applyHidden(username, hidden);
      postAction('/settings', { username, hidden }).then(result => {
        if (!result.ok) {
          applyHidden(username, !hidden);
          addToast(`could not check ${username} ${hidden ? 'out' : 'in'}`);
          return;
        }
        load();
      });
    },
    [applyHidden, load, addToast]
  );

  // Optimistic review/respond/doctor state: show a "queued" badge the instant
  // a launch is requested, before the server's state file round-trips back
  // via /data.json. Cleared per MR once the server reports real status for
  // that axis.
  const optimisticLifecycle = useOptimisticLifecycle(data);
  const merging = useMerging(data);

  const openRowMenu = useCallback((e: React.MouseEvent, mr: BoardMR) => {
    e.preventDefault();
    setRowMenu({ x: e.clientX, y: e.clientY, mr });
  }, []);

  // Six "launch a pane" flows collapse onto useLaunchAction: claim optimistic
  // queued state (skipped for resume, whose axis is null), toast, POST, and
  // reconcile on the answer. See launch-flow.ts's runLaunchFlow for the
  // shared shape; note is folded into `extra` since JSON.stringify already
  // drops it when undefined, matching every one of today's payloads.
  const launchReview = useLaunchAction({
    axis: 'review',
    path: '/review',
    verbing: 'launching review',
    started: 'review started',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    startToast,
    reload: load,
  });
  const reReviewAction = useLaunchAction({
    axis: 'review',
    path: '/review',
    verbing: 're-reviewing',
    started: 're-review started',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    startToast,
    reload: load,
  });
  const respondAction = useLaunchAction({
    axis: 'respond',
    path: '/respond',
    verbing: 'launching response',
    started: 'response started',
    noun: 'response',
    optimistic: optimisticLifecycle,
    addToast,
    startToast,
    reload: load,
  });
  const doctorAction = useLaunchAction({
    axis: 'doctor',
    path: '/doctor',
    verbing: 'calling doctor',
    started: 'doctor called',
    noun: 'doctor',
    optimistic: optimisticLifecycle,
    addToast,
    startToast,
    reload: load,
  });
  // Resume actions: axis null means useLaunchAction's setQueued/rollback are
  // no-ops, matching today's handleResume (which never claimed a badge before
  // the reload settled). Bespoke failureMessage restores handleResume's own
  // failure wording, including the server's response text when it sends one
  // (e.g. "no session id on file") -- the shared default failure toast has no
  // way to carry that detail.
  const resumeReviewAction = useLaunchAction({
    axis: null,
    path: '/review',
    verbing: 'resuming review',
    started: 'review resumed',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    startToast,
    reload: load,
    failureMessage: resumeReviewFailureMessage,
  });
  const resumeRespondAction = useLaunchAction({
    axis: null,
    path: '/respond',
    verbing: 'resuming respond',
    started: 'response resumed',
    noun: 'respond',
    optimistic: optimisticLifecycle,
    addToast,
    startToast,
    reload: load,
    failureMessage: resumeRespondFailureMessage,
  });

  // Each flow's payload lives here once: the row menu, the bulk menu, the
  // status line's verbs and the decision queue all launch through it.
  const launch = useCallback(
    (flow: LaunchFlow, mr: BoardMR, opts: LaunchOpts = {}) => {
      const { note, intent, quiet } = opts;
      switch (flow) {
        case 'review':
          return launchReview(mr, { tabId: state.tab }, note, intent, quiet);
        case 're-review':
          return reReviewAction(
            mr,
            { reReview: true, tabId: state.tab },
            note,
            undefined,
            quiet
          );
        case 'resume-review':
          return resumeReviewAction(
            mr,
            { resume: true, tabId: state.tab },
            note,
            undefined,
            quiet
          );
        case 'respond':
          return respondAction(mr, { tabId: state.tab }, note, intent, quiet);
        case 'resume-respond':
          return resumeRespondAction(
            mr,
            { resume: true, tabId: state.tab },
            note,
            undefined,
            quiet
          );
        case 'doctor':
          return doctorAction(mr, { tabId: state.tab }, note, intent, quiet);
        case 'rebase-local':
          // The doctor chassis scoped to a checkout rebase: the fallback when
          // the GitLab-side rebase can't (conflicts) or didn't work.
          return doctorAction(
            mr,
            { mode: 'rebase', tabId: state.tab },
            note,
            undefined,
            quiet
          );
      }
    },
    [
      launchReview,
      reReviewAction,
      resumeReviewAction,
      respondAction,
      resumeRespondAction,
      doctorAction,
      state.tab,
    ]
  );
  const handleLaunch = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('review', mr, { note, intent }),
    [launch]
  );
  const handleReReview = useCallback(
    (mr: BoardMR, note?: string) => void launch('re-review', mr, { note }),
    [launch]
  );
  const handleRespond = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('respond', mr, { note, intent }),
    [launch]
  );
  const handleDoctor = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('doctor', mr, { note, intent }),
    [launch]
  );
  const handleResumeRespond = useCallback(
    (mr: BoardMR, note?: string) => void launch('resume-respond', mr, { note }),
    [launch]
  );

  // A gate's "focus pane" escape hatch: jump into whichever domain's pane
  // opened the gate, via the exact same launch endpoint a fresh launch from
  // the row would use -- the server-side dedup (existing tabId + in-flight
  // status) re-focuses that pane, and the focus intent makes a gone pane a
  // refusal rather than a fresh launch, so this never invents a distinct
  // focus call.
  const handleFocusPane = useCallback(
    (mr: BoardMR, domain: GateDomain) =>
      void launch(
        domain === 'review' || domain === 'respond' ? domain : 'doctor',
        mr,
        { intent: 'focus' }
      ),
    [launch]
  );

  // The status line's clear verb: tombstones the dead run daemon-side
  // regardless of whether an attention gate exists to resume from.
  const handleClearOrphan = useCallback(
    (agentId: string) => {
      postAction('/reconciler/clear', { agentId }).then(result => {
        if (!result.ok) {
          addToast(`could not clear the executor (${result.status})`);
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  // Dismiss a failed lane's line from the row (B8). The lane keeps its state
  // and its report; the stamp only outranks it until something writes the
  // lane again, so this is a "stop telling me" and never a delete.
  const handleDismissLane = useCallback(
    (mr: BoardMR, lane: 'review' | 'respond' | 'doctor') => {
      if (!mr.webUrl) return;
      postAction('/dismiss', { mrUrl: mr.webUrl, lane }).then(result => {
        if (!result.ok) {
          addToast(`could not dismiss the ${lane} line (${result.status})`);
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  const handleAskDismiss = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      postAction('/nudge/dismiss', { mrUrl: mr.webUrl }).then(result => {
        if (!result.ok) {
          addToast(`could not dismiss the ask (${result.status})`);
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  const [asksOpen, setAsksOpen] = useState(false);
  const [askFlashId, setAskFlashId] = useState<string | null>(null);
  const askLinkConsumed = useRef(false);

  // `?ask=<id>`: open the inbox once, flash the card only when it is still
  // pending, and strip the param so a refresh doesn't replay it.
  useEffect(() => {
    if (!data || askLinkConsumed.current) return;
    const id = askParam(location.search);
    if (id === null) return;
    askLinkConsumed.current = true;
    history.replaceState(
      null,
      '',
      stripDeepLinkParams(location.search) || location.pathname
    );
    setAsksOpen(true);
    if (data.asks?.pending.some(a => a.id === id)) setAskFlashId(id);
  }, [data]);

  useEffect(() => {
    if (askFlashId === null || !asksOpen) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(`[data-ask-id="${CSS.escape(askFlashId)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    );
    return () => cancelAnimationFrame(frame);
  }, [askFlashId, asksOpen]);

  useEffect(() => {
    if (askFlashId === null) return;
    const timer = setTimeout(() => setAskFlashId(null), 2600);
    return () => clearTimeout(timer);
  }, [askFlashId]);
  const askFailure = (r: ActionResult) =>
    r.text || (r.status ? `failed (${r.status})` : "couldn't reach the board");
  const handleAskAccept = useCallback(
    async (id: string, alwaysAllow: boolean) => {
      const r = await acceptAsk(id, alwaysAllow);
      load();
      if (!r.ok) throw new Error(askFailure(r));
    },
    [load]
  );
  const handleAskDecline = useCallback(
    async (id: string, reason: DeclineReason | null, note: string) => {
      const r = await declineAsk(id, reason, note);
      load();
      if (!r.ok) throw new Error(askFailure(r));
    },
    [load]
  );
  const handleAskAllow = useCallback(
    async (username: string, allow: boolean) => {
      const r = await setAlwaysAllow(username, allow);
      if (!r.ok) addToast(`could not change always allow (${askFailure(r)})`);
      load();
    },
    [addToast, load]
  );
  const handleAskFocus = useCallback(
    (mrUrl: string) => {
      const mr = data?.mrs.find(m => m.webUrl === mrUrl);
      if (!mr) {
        addToast('That MR is not on this board.');
        return;
      }
      const asks = data?.asks;
      const ask = [...(asks?.pending ?? []), ...(asks?.history ?? [])].find(
        a => a.mrUrl === mrUrl
      );
      setAsksOpen(false);
      handleFocusPane(mr, ask ? verbLane(ask.kind) : 'review');
    },
    [data, addToast, handleFocusPane]
  );

  // Row menu's "never diagnose this stack" toggle. Turning it on mutes
  // auto-doctor for this MR and every descendant (server-enforced) and
  // clears whatever's currently on this row; turning it off just clears the
  // flag, it never re-launches anything.
  const handleStandDown = useCallback(
    (mr: BoardMR, on: boolean) => {
      if (!mr.webUrl) return;
      postAction('/triage/stand-down', {
        mrUrl: mr.webUrl,
        iid: mr.iid,
        on,
      }).then(result => {
        if (!result.ok) {
          addToast(
            `could not ${on ? 'stand down' : 're-enable'} auto-doctor (${result.status})`
          );
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  // The row's own note (B10). One row's editor is open at a time; saving
  // writes through and reloads, so the band renders from the stored note
  // rather than from what was typed.
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const handleSaveNote = useCallback(
    (mr: BoardMR, text: string) => {
      if (!mr.webUrl) return;
      setNoteEditing(null);
      postAction('/note', { mrUrl: mr.webUrl, text }).then(result => {
        if (!result.ok) {
          addToast(`could not save the note on !${mr.iid} (${result.status})`);
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  const handleCopy = useCallback(
    (mr: BoardMR) => {
      const text = data
        ? mrLine(mr, data.slackTemplates)
        : (mr.webUrl ?? mr.title);
      navigator.clipboard?.writeText(text).then(
        () => addToast(`copied !${mr.iid} for slack`),
        () => {}
      );
    },
    [addToast, data]
  );

  const [postingSummary, setPostingSummary] = useState(false);

  const handlePostSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      const toast = startToast(`posting !${mr.iid} to slack…`);
      postAction('/slack/post', { mrUrls: [mr.webUrl] }).then(result => {
        if (!result.ok)
          return toast.fail(
            `slack post failed for !${mr.iid} (${result.status})`
          );
        toast.done(
          result.body?.linked
            ? `!${mr.iid} already in slack... linked`
            : `posted !${mr.iid} to slack`
        );
        load();
      });
    },
    [startToast, load]
  );

  /** `onPosted` runs only when the message actually landed -- the selection bar
      uses it to clear the selection, and a failed post must leave the selection
      intact so the user can retry. */
  const handlePostSummary = useCallback(
    (mrs: BoardMR[], header?: string, onPosted?: () => void) => {
      const urls = mrs.map(m => m.webUrl).filter((u): u is string => !!u);
      if (!urls.length) return;
      setPostingSummary(true);
      const toast = startToast(
        `posting ${urls.length} MR${urls.length === 1 ? '' : 's'} to slack…`
      );
      postAction(
        '/slack/post',
        header ? { mrUrls: urls, header } : { mrUrls: urls }
      )
        .then(result => {
          const body: unknown = result.body;
          if (!result.ok)
            return toast.fail(
              `slack post failed (${result.status})${typeof body === 'string' ? `: ${body}` : ''}`
            );
          toast.done(
            `posted ${urls.length} MR${urls.length === 1 ? '' : 's'} to slack`
          );
          onPosted?.();
          load();
        })
        .finally(() => setPostingSummary(false));
    },
    [startToast, load]
  );

  const runner: RunnerDeps = useMemo(
    () => ({
      post: (path, payload) => postAction(path, payload),
      launch,
      addToast,
      startToast,
      reload: fresh => void load(fresh),
      merging: { start: merging.start, fail: merging.fail },
    }),
    [launch, addToast, startToast, load, merging.start, merging.fail]
  );
  const rowHandlers: RowHandlers = useMemo(
    () => ({
      copy: handleCopy,
      note: mr => setNoteEditing(mr.webUrl ?? null),
      open: url => window.open(url, '_blank', 'noopener'),
      viewReport: (mr, lane) =>
        (lane === 'review' ? setReviewModal : setRespondModal)(
          mr as BoardMRWithReview
        ),
      dismiss: handleDismissLane,
      standDown: handleStandDown,
      postSlack: handlePostSlack,
      postOwners: setOwnersPost,
    }),
    [handleCopy, handleDismissLane, handleStandDown, handlePostSlack]
  );
  // Retry sends the same kind of ask to the same teammate: /nudge replaces
  // the recorded ask for the MR, so the new one scraps the old.
  const handleAskRetry = useCallback(
    (mr: BoardMRWithReview) => {
      const sent = mr.sentNudge;
      if (!sent) return;
      void runOne(
        { kind: 'ask', ask: sent.kind ?? 're-review', reviewer: sent.reviewer },
        mr,
        runner
      );
    },
    [runner]
  );
  const runRowAction = useCallback(
    (action: RowAction, mr: BoardMR, opts: RunOpts) => {
      const req = action.request;
      if (req.kind !== 'ask') {
        return dispatchRowAction(req, mr, opts, runner, rowHandlers);
      }
      setPendingAsk({
        kind: req.ask,
        reviewer: opts.pick ?? req.reviewer ?? '',
        subject: mrRef(mr),
        send: note =>
          void dispatchRowAction(
            { ...req, note: note.trim() || undefined },
            mr,
            opts,
            runner,
            rowHandlers
          ),
      });
      return undefined;
    },
    [runner, rowHandlers]
  );

  // Poll faster while a review, response, or doctor run is active, or a fired
  // merge waits to leave, so the row updates promptly instead of waiting for
  // the normal 60s cadence.
  // Stays here rather than inside useBoardData -- see that hook's doc comment.
  const fastPoll = optimisticLifecycle.active || merging.merging.size > 0;
  useEffect(() => {
    if (!fastPoll) return;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 4000);
    return () => clearInterval(t);
  }, [fastPoll, load]);

  // The pure filter/group/sort pipeline (overlay -> tabFiltered ->
  // filterByShow(filterByMember(...)) -> groupMRs(...).map(sortMRs...)),
  // hoisted above the loading guard below and memoized so it has exactly one
  // source of truth: the render body reads its fields instead of
  // recomputing them, and the decision queue below reads the same `groups`
  // the rows actually render -- header count and queue order can never drift
  // from what's on screen. Sitting above the guard (rather than after it,
  // where `groups` used to live) is what lets this and useDecisionQueue be
  // called unconditionally, as every hook in this component must be: a
  // render where `data` is still null must call exactly the hooks it always
  // calls, never fewer.
  const boardView = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const self = data.defaultMember === 'all' ? null : data.defaultMember;
    const tabs = boardTabs(data);
    // tabs is always non-empty (server falls back to IMPLICIT_TABS);
    // state.tab itself may briefly lag on the very first render before
    // onData's validation pass lands, so fall back to the first tab rather
    // than trust it blindly.
    const activeTab = tabs.find(t => t.id === state.tab) ?? tabs[0]!;
    const isCodeownersTab = activeTab.source.kind === 'codeowners';
    const isSeatTab = activeTab.source.kind === 'needs-me';
    // A codeowners tab's "who counts as roster" set for excludeMembers.
    const rosterUsernames = new Set(data.members.map(m => m.username));
    // Server state wins; otherwise show an optimistic "queued" badge if pending.
    const mrs = overlayMerging(
      overlay(data.mrs, optimisticLifecycle.state),
      merging.merging
    );
    const turnCfg = data.turn ?? ALL_TURN;
    const need = (mr: BoardMRWithReview) =>
      self === null ? null : needOf(mr, self, now, draftResolved, turnCfg);
    const needsMe = (rows: BoardMRWithReview[]) =>
      rows.filter(mr => need(mr) !== null);
    const tabFiltered = isSeatTab
      ? needsMe(filterByTab(mrs, activeTab, rosterUsernames, tabs))
      : filterByTab(mrs, activeTab, rosterUsernames, tabs);
    // The seat tab's count shows on the tab strip from every tab.
    const needsMeCount =
      self === null
        ? null
        : needsMe(filterByTab(mrs, NEEDS_ME_TAB, rosterUsernames, tabs)).length;
    // Codeowners and seat tabs bypass member filtering entirely (and the
    // sidebar that drives it) -- their rows are scoped by section or by
    // need, not by roster author, and may come from outside the team. Inferring
    // a roster from the rows in view keeps the author filter (and the settings
    // gears that live in this panel) available.
    const inferred = isCodeownersTab || isSeatTab;
    // Offered items are the ones the toolbar renders. Drafts never appear on
    // an "all" board (buildBoard drops every draft when no single
    // defaultMember owns one), and Needs me is already turn-based.
    const offered: ShowItem[] = [
      ...(data.slackEnabled ? (['posted', 'notPosted'] as const) : []),
      ...(isSeatTab ? [] : (['authorTurn'] as const)),
      ...(data.defaultMember !== 'all' ? (['myDrafts'] as const) : []),
    ];
    // The roster counts what this tab shows under the current Show picks,
    // so a member's number matches the rows that appear when they're picked.
    const visible = filterByShow(tabFiltered, state.off, offered, turnCfg).rows;
    const visibleBy = new Map<string, number>();
    for (const mr of visible)
      visibleBy.set(
        mr.author.username,
        (visibleBy.get(mr.author.username) ?? 0) + 1
      );
    const roster = (inferred ? inferRoster(tabFiltered) : data.members).map(
      m => ({ ...m, count: visibleBy.get(m.username) ?? 0 })
    );
    const rosterTotal = visible.length;
    const memberFiltered = filterByMember(tabFiltered, state.member);
    const { rows: filtered, counts: showCounts } = filterByShow(
      memberFiltered,
      state.off,
      offered,
      turnCfg
    );
    // Counts what the board shows, after the person and Show picks, the way
    // the roster's numbers do.
    const summary = turnSummary(
      filtered,
      turnCfg,
      self === null ? null : mr => need(mr) !== null
    );
    const sub = effectiveSort(
      state.sort,
      state.group,
      groupKeysFor(isSeatTab),
      state.member
    );
    const groups = arrangeGroups(
      filtered,
      state.group,
      sub,
      data.members.map(m => m.username),
      now,
      mr => {
        const n = need(mr);
        return n && { label: NEED_LABEL[n], order: NEED_ORDER.indexOf(n) };
      }
    );
    return {
      tabs,
      activeTab,
      isCodeownersTab,
      isSeatTab,
      inferred,
      needsMeCount,
      mrs,
      roster,
      rosterTotal,
      offered,
      showCounts,
      memberFiltered,
      summary,
      filtered,
      groups,
    };
  }, [data, optimisticLifecycle.state, merging.merging, state, draftResolved]);
  // Looks follow the roster on screen, so whoever this tab lists gets the
  // most distinct colours first: the team in roster order, or an inferred
  // roster (codeowners, Needs me) alphabetically. Every other author follows
  // alphabetically so their rows still match. Joined to a string so a poll
  // with the same people keeps the memo.
  const lookIds = useMemo(() => {
    if (!data || !boardView) return '';
    const listed = boardView.inferred
      ? boardView.roster.map(m => m.username).sort()
      : data.members.map(m => m.username);
    const seen = new Set(listed);
    const others = [...new Set(data.mrs.map(mr => mr.author.username))]
      .filter(u => !seen.has(u))
      .sort();
    return [...listed, ...others].join('\n');
  }, [data, boardView]);
  const rosterNames = useMemo(
    () =>
      new Map(
        (data?.allMembers ?? []).flatMap(m =>
          m.name ? [[m.username, m.name] as const] : []
        )
      ),
    [data?.allMembers]
  );
  const memberLooks = useMemo(
    () => assignMemberLooks(lookIds ? lookIds.split('\n') : []),
    [lookIds]
  );

  // Actionable gates on every row the board holds, visible rows first in
  // board order (group order, the group's own sort, stack nesting: exactly
  // what `boardView.groups` renders), then the rows the current tab or
  // filter hides, in the same sort. A decision is owed whichever author is
  // picked, so the queue button never vanishes behind a filter.
  const queueEntries = useMemo(() => {
    if (!boardView) return [];
    const out: QueueEntry[] = [];
    const seen = new Set<BoardMRWithReview>();
    const collectMr = (mr: BoardMRWithReview) => {
      if (seen.has(mr)) return;
      seen.add(mr);
      for (const gate of mr.gates) if (needsQueue(gate)) out.push({ gate, mr });
    };
    const collect = (node: StackNode<BoardMRWithReview>) => {
      collectMr(node.mr);
      node.children.forEach(collect);
    };
    for (const g of boardView.groups)
      for (const part of g.sub ?? [g]) nestStacks(part.mrs).forEach(collect);
    for (const mr of oldestFirst(boardView.mrs)) collectMr(mr);
    // Human-owned, non-MR gates (queueExtras -- a pane-attention gate is the
    // first kind of these) join the same queue with no `mr` at all.
    for (const gate of data?.queueExtras ?? [])
      if (needsQueue(gate)) out.push({ gate });
    return out;
  }, [boardView, data]);
  // Positive answer evidence for the queue's reconcile, from the RAW data:
  // a gate answered on another surface must retire even if its MR is
  // currently filtered out of view.
  const answeredGateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const mr of data?.mrs ?? [])
      for (const gate of mr.gates)
        if (gate.status === 'answered') ids.add(gate.gateId);
    for (const gate of data?.queueExtras ?? [])
      if (gate.status === 'answered') ids.add(gate.gateId);
    return ids;
  }, [data]);
  const queue = useDecisionQueue(queueEntries, answeredGateIds);
  const activeGateId = queue.active?.gate.gateId ?? null;
  const retireActiveGate = () => {
    if (activeGateId === null) return;
    queue.noteAnswered(activeGateId);
    void load();
  };

  // Panel applies its stored folded state in a passive mount effect, which
  // runs after this layout effect: unfolding the linked row's panel here is
  // what keeps that row mounted for the flash below. The modal path flashes
  // nothing, so it leaves the panels as they were.
  useLayoutEffect(() => {
    if (deepLink === null || !boardView) return;
    if (
      deepLink.gateId !== null &&
      gateDeepLinkAction(queueEntries, deepLink.gateId) === 'modal'
    )
      return;
    const label = linkedGroupLabel(boardView.groups, deepLink);
    if (label !== null) unfoldPanel(label);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot link consumption, same as the effect below
  }, [deepLink]);

  // `?gate=<id>` / `?mr=<url>` deep link: by the time this runs, the linked
  // row and queue entries have already rendered (deepLink is set in the same
  // batch as the data that produced them). history.replaceState strips the
  // param so a refresh doesn't re-open. A gate still owed an answer opens the
  // decision modal at that gate; an answered or unknown one, and every MR
  // link, degrades to the row scroll+flash.
  //
  // Deliberately keyed on deepLink alone: this is a one-shot consumption
  // of the link, and re-running it when a poll reshuffles queueEntries would
  // re-scroll or re-open mid-flash. The closure's queueEntries/queue are from
  // the same batch that set deepLink, which is exactly the snapshot the
  // link should act on.
  useEffect(() => {
    if (deepLink === null) return;
    // An empty relative url is a no-op for replaceState (it keeps the
    // current query) -- fall back to the bare pathname, same as update().
    history.replaceState(
      null,
      '',
      stripDeepLinkParams(location.search) || location.pathname
    );
    if (
      deepLink.gateId !== null &&
      gateDeepLinkAction(queueEntries, deepLink.gateId) === 'modal'
    ) {
      queue.openAt(deepLink.gateId);
      setDeepLink(null);
      return;
    }
    const row =
      deepLink.mrUrl !== null
        ? document.querySelector(
            `[data-mr-url="${CSS.escape(deepLink.mrUrl)}"]`
          )
        : deepLink.iid !== null
          ? document.querySelector(
              `[data-mr-iid="${CSS.escape(String(deepLink.iid))}"]`
            )
          : null;
    if (!row) {
      setDeepLink(null);
      return;
    }
    row.scrollIntoView({ block: 'center' });
    row.classList.add('tui-row-flash');
    // Resetting deepLink changes this effect's own dependency, which
    // re-runs its cleanup -- doing that synchronously here would clearTimeout
    // the flash removal before it ever fires. Reset it from inside the
    // timeout instead, once the flash has actually been removed.
    const t = setTimeout(() => {
      row.classList.remove('tui-row-flash');
      setDeepLink(null);
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot link consumption; see above
  }, [deepLink]);

  const now = Date.now();
  const freshness = data
    ? freshnessBanner({
        fetchError: data.fetchError,
        dataSyncedAt: data.dataSyncedAt,
        syncError: data.syncError,
        now,
      })
    : null;
  useStaleTabTitle(freshness !== null);

  if (!data) {
    return (
      <p className="tui-loading">
        {loadError ? '✗ failed to load board data' : 'fetching…'}
      </p>
    );
  }

  const {
    tabs,
    activeTab,
    isCodeownersTab,
    isSeatTab,
    needsMeCount,
    mrs,
    roster,
    rosterTotal,
    offered,
    showCounts,
    memberFiltered,
    summary,
    filtered,
    groups,
  } = boardView!;

  const dataAge = dataAgeLabel(data.dataSyncedAt, now);
  // An explicit board window wider than rt actually syncs is config drift the
  // board can't self-correct, so it needs to be visible. Unset follows rt.
  const windowMismatch =
    data.staleAfterDays !== null &&
    data.scopeWindowDays !== null &&
    data.staleAfterDays > data.scopeWindowDays
      ? `board shows ${data.staleAfterDays} days but rt syncs ${data.scopeWindowDays} days... align configs`
      : null;

  const activeSection =
    activeTab.source.kind === 'codeowners'
      ? sectionStatus(activeTab.source.section, data.scopeKnownSections)
      : null;
  const unknownTabs = data.tabs.flatMap(t =>
    t.source.kind === 'codeowners' &&
    sectionStatus(t.source.section, data.scopeKnownSections).unknown
      ? [t.id]
      : []
  );
  // A wrong name is not "still syncing": the unknown state owns the tab.
  const tabSyncing =
    activeTab.source.kind === 'codeowners' &&
    !activeSection?.unknown &&
    data.scopeUncoveredSections.includes(activeTab.source.section);
  const activeMember =
    state.member !== 'all'
      ? (roster.find(m => m.username === state.member) ?? null)
      : null;
  // Show each row's author only when the view mixes authors: the All view
  // grouped by anything but author (where the group header isn't the name),
  // or a codeowners tab, which is never narrowed to one author.
  const showAuthor = state.member === 'all' && state.group !== 'author';
  // Under author grouping (or an author sub-group) the header IS the name,
  // so rows normally drop the author tag -- but a stack pulled to its root's
  // group can carry a co-author's MR under someone else's header. Tag the rows whenever a group
  // turns out to hold more than one author, so nothing is misattributed.
  const showAuthorIn = (g: { mrs: BoardMR[]; author?: string }) =>
    (showAuthor && g.author === undefined) ||
    (state.member === 'all' &&
      new Set(g.mrs.map(m => m.author.username)).size > 1);
  const flatMrs = groups.flatMap(g => g.mrs);
  // Drawn from `mrs`, not `filtered` -- that's what lets a selection span
  // member filters.
  const selectedMrs = selectionOf(mrs, selected);
  const seat = effectiveSeat(data.defaultMember, data.tokenUser);
  const postableMrs = postableOf(flatMrs, seat);
  const postableSelected = postableOf(selectedMrs, seat);
  const rowCtx: RowContext = {
    local: data.local,
    self: seat,
    slackTemplates: data.slackTemplates,
    slackEnabled: data.slackEnabled,
    onContext: openRowMenu,
    onOpenReview: setReviewModal,
    onOpenRespond: setRespondModal,
    onOpenDraft: openDraft,
    onOpenComments: setCommentsFor,
    draftResolved,
    onResumeRespond: handleResumeRespond,
    onFocusPane: handleFocusPane,
    onLaunch: handleLaunch,
    onReReview: handleReReview,
    onRespond: handleRespond,
    onDoctor: handleDoctor,
    onOpenGate: queue.openAt,
    selected,
    onToggleSelect: toggleSelect,
    onClearOrphan: handleClearOrphan,
    onMerge: mr => void runOne({ kind: 'mr', action: 'merge' }, mr, runner),
    onDismissLane: handleDismissLane,
    onAskRetry: handleAskRetry,
    onAskDismiss: handleAskDismiss,
    onStandDown: handleStandDown,
    noteEditing,
    onEditNote: setNoteEditing,
    onSaveNote: handleSaveNote,
  };
  const actionEnv: ActionEnv = {
    local: data.local,
    slackEnabled: data.slackEnabled,
    triageEnabled: data.triageEnabled,
    ownerSlackRepos: data.ownerSlackRepos,
    self: seat,
    roster: data.members.map(m => m.username),
    peers: data.peers,
    allMrs: data.mrs,
  };
  // A remote board has no bulk actions (each needs the local server), so a
  // right-click there keeps the row's own menu instead of an empty one.
  const bulkEntries =
    data.local &&
    rowMenu &&
    menuActsOnSelection(rowMenu.mr, selected, selectedMrs.length)
      ? bulkActions(selectedMrs, actionEnv)
      : null;
  const openSettings = () => {
    setMenuOpen(false);
    setShowSettings(true);
  };
  const openConfig = () => {
    setMenuOpen(false);
    setShowConfig(true);
  };
  // Refs go stale between sweeps, so taking Not Posted off re-checks Slack
  // (forced sweep, server-side); newly found rows land on the reload. The
  // other items ride the regular poll. Quiet unless it fails: a toast on
  // every chip click reads like something went wrong.
  const toggleShow = (item: ShowItem) => {
    const turningOff = !state.off.includes(item);
    update({
      off: turningOff
        ? [...state.off, item]
        : state.off.filter(i => i !== item),
    });
    if (!(turningOff && item === 'notPosted' && data.local)) return;
    postAction('/slack/refresh', {}).then(result => {
      if (!result.ok)
        return addToast(`could not re-check Slack (${result.status})`);
      load();
    });
  };
  const inferredNote = isCodeownersTab
    ? 'authors in this queue'
    : isSeatTab
      ? 'authors needing you'
      : undefined;
  const rosterEmpty = isCodeownersTab
    ? 'nobody in this queue'
    : isSeatTab
      ? 'nobody needs you right now ✓'
      : 'no one on the roster yet';
  const controlProps = {
    state,
    update,
    groupKeys: groupKeysFor(isSeatTab),
    theme,
    pickTheme,
    onRefresh: refreshNow,
    refreshing,
    canPostSummary: data.slackEnabled && data.local && postableMrs.length > 0,
    postingSummary,
    onPostSummary: () => handlePostSummary(postableMrs),
    show:
      offered.length > 0
        ? {
            offered,
            off: state.off,
            counts: showCounts,
            // BoardData carries no board-wide channel; a row's resolved
            // slackChannel is the tab's override or slack.channel.
            channel:
              activeTab.slackChannel ??
              memberFiltered.find(mr => mr.slackChannel)?.slackChannel ??
              null,
            toggle: toggleShow,
            turn: data.turn ?? ALL_TURN,
          }
        : null,
    onOpenTurnSettings: openConfig,
  };

  /** A group's header band colour: its status pill's hue, its review
      state's hue, or its author's avatar colour; any other grouping keeps
      the neutral band. */
  const groupBand = (g: {
    label: string;
    author?: string;
  }): { hue?: string; style?: CSSProperties } => {
    if (state.group === 'status') return { hue: statusGroupHue(g.label) };
    if (state.group === 'review') return { hue: reviewGroupHue(g.label) };
    const look =
      state.group === 'author' && g.author
        ? memberLooks.get(g.author)
        : undefined;
    if (!look) return {};
    return {
      hue: 'author',
      style: {
        '--pill': look.fill,
        '--pill-text': 'var(--text-1)',
      } as CSSProperties,
    };
  };

  return (
    <MemberLooksProvider value={memberLooks}>
      <div className="tui tui-app">
        {/* Desktop roster (hidden on mobile, where it moves into the drawer).
          Also hidden on a codeowners tab: it isn't filtered by member, so the
          roster has nothing to drive. */}
        <Sidebar
          members={roster}
          total={rosterTotal}
          active={state.member}
          onPick={member => update({ member })}
          onSettings={openSettings}
          scopeUncovered={data.scopeUncovered}
          note={inferredNote}
          empty={rosterEmpty}
          dimEmpty={tabDimsEmpty(activeTab)}
          queue={
            queueEntries.length > 0
              ? { count: queueEntries.length, open: queue.openAtStart }
              : null
          }
        />

        <div className="tui-main">
          <header className="tui-header">
            {/* Mobile-only: burger opens the drawer with roster + controls. */}
            <button
              className="tui-burger"
              onClick={() => setMenuOpen(true)}
              aria-label="open menu"
            >
              {ICONS.menu}
            </button>
            <div className="tui-header-title">
              <h1>
                <AppMark />
                <span>{data.title.toLowerCase()}</span>{' '}
                {activeMember && (
                  <span className="tui-author">
                    --author @{activeMember.username}
                  </span>
                )}
              </h1>
              <TurnSummary
                counts={summary}
                synced={dataAge}
                onNeedsMe={
                  needsMeCount === null
                    ? null
                    : () => update({ tab: NEEDS_ME_TAB.id })
                }
              />
            </div>
            <div className="tui-controls tui-controls-header">
              <Controls {...controlProps} />
            </div>
            {controlProps.show && <ShowChips show={controlProps.show} />}
            <div className="tui-header-corner">
              <AsksButton
                asks={data.asks}
                open={asksOpen}
                onOpenChange={setAsksOpen}
                flashId={askFlashId}
                names={rosterNames}
                onAccept={handleAskAccept}
                onDecline={handleAskDecline}
                onAllow={handleAskAllow}
                onFocus={handleAskFocus}
                onNotice={addToast}
              />
              <RefreshControl onRefresh={refreshNow} refreshing={refreshing} />
              <ThemeControl theme={theme} pickTheme={pickTheme} />
            </div>
            {/* A selection takes over the tab band: the actions sit where
                the tabs were, and clearing it brings the tabs back. */}
            {selectedMrs.length > 0 ? (
              <SelectionBar
                selectedMrs={selectedMrs}
                inViewCount={selectionOf(filtered, selected).length}
                templates={data.slackTemplates}
                onClear={clearSelection}
                posting={postingSummary}
                onActions={
                  data.local
                    ? (x, y) => {
                        const first = selectedMrs[0];
                        if (first) setRowMenu({ x, y, mr: first });
                      }
                    : undefined
                }
                slackPost={
                  data.slackEnabled && data.local && postableSelected.length > 0
                    ? {
                        count: postableSelected.length,
                        // Clear only on success: the posted MRs drop out of
                        // postableSelected, so leaving them checked would sit the
                        // bar there with no post button and read like a bug.
                        send: header =>
                          handlePostSummary(
                            postableSelected,
                            header,
                            clearSelection
                          ),
                      }
                    : null
                }
              />
            ) : (
              <TabBar
                tabs={tabs}
                active={state.tab}
                counts={
                  needsMeCount === null
                    ? {}
                    : { [NEEDS_ME_TAB.id]: needsMeCount }
                }
                onPick={tab => update({ tab })}
                syncing={tabSyncing}
                unknown={unknownTabs}
                trailing={
                  <button
                    type="button"
                    className="tui-show-chips-settings"
                    onClick={openConfig}
                  >
                    {ICONS.settings} {TURN_SETTINGS_LABEL}
                  </button>
                }
              />
            )}
          </header>

          {freshness && (
            <div
              className="tui-banner"
              data-intent={freshness.intent === 'bad' ? 'bad' : undefined}
              role="status"
              title={freshness.title}
            >
              {freshness.text}
            </div>
          )}
          {windowMismatch && (
            <div className="tui-banner">⚠ {windowMismatch}</div>
          )}

          {data.switchboardTokenMissing && (
            <div className="tui-banner" data-intent="bad" role="alert">
              ⚠ no switchboard token, so peer asks can't reach this board ·{' '}
              {data.canInvite ? (
                <>
                  run <code>rt team peer</code> to connect it
                </>
              ) : (
                <>
                  ask the team owner to invite you again (
                  <code>rt team invite</code>), then run{' '}
                  <code>rt team join</code> with the new invite
                </>
              )}
            </div>
          )}

          {activeTab.source.kind === 'codeowners' && activeSection?.unknown && (
            <div className="tui-banner" data-intent="bad" role="alert">
              ⚠ no CODEOWNERS section "{activeTab.source.section}"
              {activeSection.suggestion && (
                <> · did you mean "{activeSection.suggestion}"?</>
              )}
              <button
                type="button"
                className="tui-banner-btn"
                onClick={openConfig}
              >
                fix in settings
              </button>
            </div>
          )}

          {filtered.length === 0 &&
          !data.fetchError &&
          freshness?.intent !== 'bad' &&
          !activeSection?.unknown ? (
            <p className="tui-empty">
              {memberFiltered.length > 0
                ? 'nothing to show with these picks'
                : 'nothing waiting on review ✓'}
            </p>
          ) : (
            groups.map(g => {
              const band = groupBand(g);
              return (
                // Panel lays its own style over a passed one, so the band's
                // colour rides this wrapper and reaches the panel by
                // inheritance; display: contents keeps it out of layout.
                <div key={g.label} className="tui-group" style={band.style}>
                  <Panel
                    title={g.label}
                    count={g.mrs.length}
                    data-hue={band.hue}
                    // Pins the LEGACY persistence key: the recipe defaults to its own
                    // "tui-panel-collapsed", and switching would orphan every panel a
                    // user has already folded up.
                    storageKey={PANEL_COLLAPSED_KEY}
                  >
                    {g.sub ? (
                      g.sub.map(part => (
                        <section
                          key={part.label}
                          className="tui-subgroup"
                          aria-label={part.label}
                        >
                          <h3 className="tui-subgroup-head">
                            {part.author && (
                              <MemberInvadr
                                id={part.author}
                                className="tui-subgroup-avatar"
                              />
                            )}
                            <span>{part.label}</span>
                            <span className="tui-subgroup-count">
                              {part.mrs.length}
                            </span>
                          </h3>
                          <RowView
                            mrs={part.mrs}
                            now={now}
                            showAuthor={showAuthorIn(part)}
                            ctx={rowCtx}
                          />
                        </section>
                      ))
                    ) : (
                      <RowView
                        mrs={g.mrs}
                        now={now}
                        showAuthor={showAuthorIn(g)}
                        ctx={rowCtx}
                      />
                    )}
                  </Panel>
                </div>
              );
            })
          )}
        </div>

        {/* Mobile drawer: roster + controls, tucked behind the burger. */}
        {menuOpen && (
          <SideDrawer
            // `side` replaces the two class-name props: it drives the panel's
            // width, border edge, shadow, padding/gap and the overlay's
            // stacking + alignment. The one thing it does NOT carry is this
            // drawer's below-720px-only existence, which is a board layout
            // decision -- style.css keeps that as a two-rule display gate on
            // [data-part="sidedrawer-overlay"][data-side="left"].
            side="left"
            ariaLabel="menu"
            onClose={() => setMenuOpen(false)}
          >
            <div className="tui-drawer-head">
              <span className="tui-modal-title">❯ menu</span>
              <button
                className="tui-modal-x"
                onClick={() => setMenuOpen(false)}
                aria-label="close menu"
              >
                {ICONS.close}
              </button>
            </div>
            <Sidebar
              members={roster}
              total={rosterTotal}
              active={state.member}
              onPick={member => {
                update({ member });
                setMenuOpen(false);
              }}
              onSettings={openSettings}
              scopeUncovered={data.scopeUncovered}
              note={inferredNote}
              empty={rosterEmpty}
              dimEmpty={tabDimsEmpty(activeTab)}
              queue={
                queueEntries.length > 0
                  ? {
                      count: queueEntries.length,
                      open: () => {
                        setMenuOpen(false);
                        queue.openAtStart();
                      },
                    }
                  : null
              }
            />
            <div className="tui-drawer-controls">
              <Controls {...controlProps} stacked />
            </div>
          </SideDrawer>
        )}

        {showSettings && (
          <SettingsModal
            members={data.allMembers}
            canInvite={data.canInvite}
            local={data.local}
            defaultMember={data.defaultMember}
            onToggle={toggleMember}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showConfig && (
          <ConsoleSettingsModal
            onSaved={() =>
              void postAction('/api/config/reload', {}).then(() => load())
            }
            onClose={() => setShowConfig(false)}
          />
        )}

        {rowMenu &&
          (bulkEntries ? (
            <ActionMenu
              x={rowMenu.x}
              y={rowMenu.y}
              subject={`${selectedMrs.length} selected`}
              entries={bulkEntries}
              empty={`nothing fits all ${selectedMrs.length}`}
              flat
              onClose={() => setRowMenu(null)}
              onRun={(key, opts) => {
                const entry = bulkEntries.find(e => e.key === key);
                if (!entry) return undefined;
                const req = entry.request;
                if (req.kind !== 'ask') return runBulk(entry, opts, runner);
                if (!opts.pick) return undefined;
                const count = entry.pickTargets?.get(opts.pick)?.length ?? 0;
                setPendingAsk({
                  kind: req.ask,
                  reviewer: opts.pick,
                  subject: `${count} MRs`,
                  send: note =>
                    void runBulk(
                      {
                        ...entry,
                        request: { ...req, note: note.trim() || undefined },
                      },
                      opts,
                      runner
                    ),
                });
                return undefined;
              }}
            />
          ) : (
            <RowMenu
              menu={rowMenu}
              env={actionEnv}
              onRun={runRowAction}
              onClose={() => setRowMenu(null)}
            />
          ))}

        <AskConfirmDialog
          open={pendingAsk !== null}
          kind={pendingAsk?.kind ?? 'review'}
          reviewerName={firstName(undefined, pendingAsk?.reviewer ?? '')}
          subject={pendingAsk?.subject ?? ''}
          onSend={note => {
            pendingAsk?.send(note);
            setPendingAsk(null);
          }}
          onCancel={() => setPendingAsk(null)}
        />

        {reviewModal && (
          <ReviewModal mr={reviewModal} onClose={() => setReviewModal(null)} />
        )}
        {respondModal && (
          <RespondModal
            mr={respondModal}
            onClose={() => setRespondModal(null)}
          />
        )}

        {queue.open && queue.active && activeGateId && (
          <DecisionQueueModal
            key={activeGateId}
            gate={queue.active.gate}
            mr={queue.active.mr}
            position={queue.position}
            states={queue.states}
            nextPeek={queue.nextPeek}
            onClose={queue.close}
            onNext={queue.next}
            onBack={queue.back}
            canBack={queue.canBack}
            canNext={queue.canNext}
            onFocusPane={handleFocusPane}
            onAnswered={retireActiveGate}
            onContinue={retireActiveGate}
            onLostChange={lost => queue.hold(lost ? activeGateId : null)}
            readOnly={gateReadOnlyReason(
              queue.active.gate,
              queue.active.mr,
              effectiveSeat(data.defaultMember, data.tokenUser)
            )}
            people={
              new Map(
                data.members.flatMap(m =>
                  m.name ? [[m.username, m.name] as const] : []
                )
              )
            }
          />
        )}
        {queue.open && queue.complete && (
          <DecisionQueueComplete
            decided={decidedEntries(queue.answeredIds, data, queue.seenEntries)}
            onClose={queue.close}
          />
        )}

        {draftModal && (
          <DraftModal
            mr={draftModal.mr}
            draft={draftModal.draft}
            local={data.local}
            canPost={isOwnMr(
              draftModal.mr,
              effectiveSeat(data.defaultMember, data.tokenUser)
            )}
            onResolved={handleDraftResolved}
            onClose={() => setDraftModal(null)}
          />
        )}

        {ownersPost && (
          <OwnersPostModal
            mr={ownersPost}
            onPosted={channels => {
              addToast(
                `posted !${ownersPost.iid} to ${channels.map(c => `#${c}`).join(', ')}`
              );
              setOwnersPost(null);
            }}
            onClose={() => setOwnersPost(null)}
          />
        )}

        {commentsFor && (
          <CommentsDrawer
            mr={
              data.mrs.find(
                m => !!m.webUrl && m.webUrl === commentsFor.webUrl
              ) ?? commentsFor
            }
            local={data.local}
            self={effectiveSeat(data.defaultMember, data.tokenUser)}
            onClose={() => setCommentsFor(null)}
          />
        )}

        <ToastHost toasts={toasts} />
      </div>
    </MemberLooksProvider>
  );
}
