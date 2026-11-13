import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { Badge, ICONS, Popover, SideDrawer, Tooltip } from '@mattstack/tui-kit';
import { mrNoun } from '../../mr-ref.ts';
import { cancelRebase } from '../api.ts';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { clauseOf } from './clause.ts';
import { cleanTitle } from './format.ts';
import { AgentGlyph, ChevronGlyph, CloudSpinner, Sun } from './icons.tsx';
import { heldOrder, laneOf, moreAction, moreKey } from './more-actions.ts';
import { mrRef } from './MrLinks.tsx';
import type { Candidate, RowStatus, Verb } from './row-status.ts';
import { RowSpotlight } from './RowSpotlight.tsx';
import {
  liveSyncLines,
  shownSyncLog,
  subscribeSyncLines,
  takeAutoOpen,
  tidySyncLog,
} from './sync-lines.ts';
import { syncSteps, type SyncView } from './sync-steps.ts';
import { SyncSteps } from './SyncSteps.tsx';
import { useLingering } from './use-lingering.ts';

const NO_PACK_TIP =
  'No pack selected. Launched the generic skill. Set a pack on the tab, or join a team that has one.';

/** How long an armed merge waits for its second click. */
export const MERGE_ARM_MS = 4000;

/** The primary verb holds the line's right end at rest; the secondaries
    appear under the pointer to its LEFT, so it never moves. */
function ordered(verbs: Verb[]): Array<{ verb: Verb; primary: boolean }> {
  const [primary, ...rest] = verbs;
  return [
    ...rest.map(verb => ({ verb, primary: false })),
    ...(primary ? [{ verb: primary, primary: true }] : []),
  ];
}

function runVerb(verb: Verb, mr: BoardMRWithReview, ctx: RowContext): void {
  switch (verb.kind) {
    case 'focus':
      ctx.onFocusPane(mr, verb.domain ?? 'review');
      return;
    case 'resume':
      if (verb.domain === 'respond') ctx.onResumeRespond(mr);
      else ctx.onResumeReview(mr);
      return;
    case 'redo':
      ctx.onRedo(mr, verb.domain ?? 'review');
      return;
    case 'clear':
      if (verb.agentId) ctx.onClearOrphan(verb.agentId);
      return;
    case 'dismiss':
      if (verb.domain) ctx.onDismissLane(mr, verb.domain);
      return;
    case 'answer':
      if (verb.gateId) ctx.onOpenGate(verb.gateId);
      return;
    case 'read-review':
      ctx.onOpenReview(mr);
      return;
    case 'read-respond':
      ctx.onOpenRespond(mr);
      return;
    case 'resume-respond':
      ctx.onResumeRespond(mr);
      return;
    case 'launch-review':
      ctx.onLaunch(mr);
      return;
    case 'launch-respond':
    case 'restart-respond':
      ctx.onRespond(mr, undefined, undefined, verb.person);
      return;
    case 'call-doctor':
      ctx.onDoctor(mr);
      return;
    case 're-review':
      ctx.onReReview(mr);
      return;
    case 'read-note':
      if (verb.draft) ctx.onOpenDraft(mr, verb.draft);
      return;
    case 'view-peer':
    case 'open-mr':
      if (mr.webUrl) window.open(mr.webUrl, '_blank', 'noopener');
      return;
    case 'merge':
      ctx.onMerge(mr);
      return;
    default: {
      const never: never = verb.kind;
      return never;
    }
  }
}

/** rt sync's output as the terminal draws it: rt-ui's glyph, the title,
    and the hint in its quieter column. */
/** A path wraps after its slashes, never inside a segment. */
function breakAfterSlashes(text: string) {
  return text
    .split('/')
    .flatMap((part, i, all) =>
      i < all.length - 1 ? [part, '/', <wbr key={i} />] : [part]
    );
}

function SyncLogBody({
  lines,
  running,
  branch,
}: {
  lines: readonly string[];
  running: boolean;
  branch?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);
  const shown = tidySyncLog(lines, branch, running);
  return (
    <div className="tui-synclog-body" role="log" aria-live="polite">
      {branch && lines.length > 0 && (
        <div className="tui-synclog-branch" title={branch}>
          {branch}
        </div>
      )}
      {lines.length === 0 && (
        <div className="tui-synclog-line" data-status="pending">
          <span className="tui-synclog-glyph" aria-hidden>
            ◌
          </span>
          <span className="tui-synclog-title">
            {running ? 'Starting rt sync' : 'No output was saved'}
          </span>
        </div>
      )}
      {shown.map((line, i) => {
        // A running line kept on a stopped sync is done drawing.
        const stale =
          line.status === 'running' && (!running || i < shown.length - 1);
        return (
          <div
            key={i}
            className="tui-synclog-line"
            data-status={line.status ?? 'text'}
            data-past={stale ? 'true' : undefined}
          >
            <span className="tui-synclog-glyph" aria-hidden>
              {line.glyph ?? ''}
            </span>
            <span className="tui-synclog-text">
              <span className="tui-synclog-title">{line.title}</span>
              {line.hint && (
                <span className="tui-synclog-hint">
                  {breakAfterSlashes(line.hint)}
                </span>
              )}
            </span>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/** The saved sync log joined with whatever this page streamed since. */
function useSyncLog(
  mr: BoardMRWithReview,
  saved: readonly string[] | undefined,
  running: boolean
): readonly string[] {
  const streamed = useSyncExternalStore(subscribeSyncLines, () =>
    liveSyncLines(mr.webUrl ?? '')
  );
  return shownSyncLog(saved, running ? streamed : undefined);
}

/** Four pips, one per sync step: the row's at-a-glance progress. */
function StepPips({ view }: { view: SyncView }) {
  return (
    <span className="tui-sync-pips" aria-hidden>
      {view.steps.map(step => (
        <span key={step.key} className="tui-sync-pip" data-state={step.state} />
      ))}
    </span>
  );
}

function SyncLogWord({
  mr,
  word,
  lines,
  view,
  running,
  handoff,
}: {
  mr: BoardMRWithReview;
  word: string;
  lines: readonly string[];
  view: SyncView;
  running: boolean;
  handoff?: { onFocus: () => void };
}) {
  const url = mr.webUrl ?? '';
  const [open, setOpen] = useState(() => takeAutoOpen(url));
  useEffect(() => {
    if (takeAutoOpen(url)) setOpen(true);
  }, [url, lines.length]);
  const close = () => setOpen(false);
  const drawer = useLingering(open ? true : null);
  return (
    <>
      <button
        type="button"
        className="tui-status-word tui-status-word-log"
        title="Show the sync steps"
        data-open={open ? 'true' : undefined}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {word}
        {/* Pips are progress; a finished sync's word says how it ended. */}
        {running && <StepPips view={view} />}
      </button>
      {createPortal(
        <RowSpotlight mrUrl={mr.webUrl} open={open} />,
        document.body
      )}
      {drawer.shown &&
        createPortal(
          // A portal still bubbles React events to the row, whose own click
          // opens the MR.
          <div
            className="tui-sync-drawer-host"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onContextMenu={e => e.stopPropagation()}
          >
            <SideDrawer
              side="right"
              className="tui-cd-panel tui-sync-drawer tui-spotlit"
              ariaLabel={`rt sync for ${mrRef(mr)}`}
              data-closing={drawer.leaving ? 'true' : undefined}
              onClose={close}
            >
              <div className="tui-cd-head">
                <button
                  className="tui-modal-x"
                  onClick={close}
                  aria-label="close"
                >
                  {ICONS.close}
                </button>
              </div>
              <div className="tui-cd-title">
                <span className="tui-cd-iid">{mrRef(mr)}</span>{' '}
                {cleanTitle(mr.title)}
              </div>
              <SyncSteps
                view={view}
                raw={
                  <SyncLogBody
                    lines={lines}
                    running={running}
                    branch={mr.sourceBranch}
                  />
                }
                {...(handoff ? { handoff } : {})}
                {...(url && mr.doctor?.status === 'forge-rebasing'
                  ? { onCancel: () => cancelRebase(url) }
                  : {})}
              />
            </SideDrawer>
          </div>,
          document.body
        )}
    </>
  );
}

const DOCTOR_AT_WORK = new Set([
  'diagnosing',
  'rebasing',
  'fixing',
  'watching',
]);

/** The row's other status lines, behind a count: the line shows only the
    hottest, and the rest are often finished runs rather than live ones. */
function MoreStatuses({
  mr,
  more,
  ctx,
}: {
  mr: BoardMRWithReview;
  more: readonly Candidate[];
  ctx: RowContext;
}) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  // A poll can re-rank the statuses; while the list is open it keeps the
  // order it opened with, so a line cannot swap under the pointer.
  const [order, setOrder] = useState<string[] | null>(null);
  const toggle = (next: boolean) => {
    setOrder(next ? more.map(moreKey) : null);
    setOpen(next);
  };
  return (
    <Popover
      open={open}
      onOpenChange={toggle}
      // The list, not its first action, takes focus: a ringed "focus" on
      // every open reads as the thing to press.
      initialFocus={list}
      align="start"
      sideOffset={6}
      ariaLabel={`other statuses for ${mrRef(mr)}`}
      classNames={{ popup: 'tui-status-more-pop' }}
      trigger={
        <button
          type="button"
          className="tui-status-more"
          data-open={open ? 'true' : undefined}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.stopPropagation()}
        >
          +{more.length} more
        </button>
      }
    >
      <div
        ref={list}
        tabIndex={-1}
        className="tui-status-more-list"
        onClick={e => e.stopPropagation()}
        onContextMenu={e => e.stopPropagation()}
      >
        {heldOrder(more, order).map(l => {
          const key = moreKey(l);
          const detail = l.detail ? clauseOf(l.detail) : null;
          const action = moreAction(l, mr);
          const run = (e: { stopPropagation(): void }) => {
            e.stopPropagation();
            toggle(false);
            if (action) runVerb(action.verb, mr, ctx);
          };
          const pill = action && (
            <>
              {action.lane && <AgentGlyph />}
              {action.verb.label}
              <span className="tui-status-more-chevron" aria-hidden>
                <ChevronGlyph />
              </span>
            </>
          );
          const body = (
            <span className="tui-status-more-stack">
              {l.source && (
                <span className="tui-status-more-source">
                  {l.source === 'MR' ? mrNoun(mr) : l.source}
                </span>
              )}
              <span className="tui-status-more-text">
                <span className="tui-status-word">{l.word}</span>
                {l.spin === true && (
                  <span className="tui-status-ring" aria-hidden />
                )}
                {/* The list is where a clipped detail is read in full. */}
                {detail && (
                  <span className="tui-status-detail">
                    {detail.full ?? detail.text}
                  </span>
                )}
              </span>
            </span>
          );
          if (!action)
            return (
              <div
                key={key}
                className="tui-status-more-line"
                data-tone={l.tone}
              >
                {body}
              </div>
            );
          // Starting an agent takes a click on the action itself; a look or a
          // tidy-up runs from anywhere on the line.
          if (action.launches)
            return (
              <div
                key={key}
                className="tui-status-more-line"
                data-tone={l.tone}
                data-lane={action.lane}
                data-action="launch"
              >
                {body}
                <button
                  type="button"
                  className="tui-status-more-verb"
                  data-verb={action.verb.kind}
                  onClick={run}
                >
                  {pill}
                </button>
              </div>
            );
          return (
            <button
              key={key}
              type="button"
              className="tui-status-more-line"
              data-tone={l.tone}
              data-lane={action.lane}
              data-verb={action.verb.kind}
              data-action="line"
              onClick={run}
            >
              {body}
              <span className="tui-status-more-verb">{pill}</span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

/** The row's one status line. Verbs are buttons so the row's own click
    (open in GitLab) ignores them; the first verb shows at rest, the rest
    only under the pointer (style.css keys on `data-secondary`). */
export function StatusLine({
  mr,
  status,
  ctx,
}: {
  mr: BoardMRWithReview;
  status: RowStatus;
  ctx: RowContext;
}) {
  const { line, more } = status;
  // Merge is the one irreversible verb: the first click arms it, the second
  // fires, and an unanswered arm lapses on a timer rather than on the pointer
  // leaving, so a drift off the button does not eat the confirmation.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), MERGE_ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  // /mr/action refuses a non-local request, so a remote board never shows
  // merge, the same as the row menu's gitlab section.
  const verbs = ctx.local
    ? line.verbs
    : line.verbs.filter(verb => verb.kind !== 'merge');
  const hot = line.tone === 'bad' || line.tone === 'warn';
  const syncing =
    mr.doctor?.status === 'syncing' || mr.doctor?.status === 'forge-rebasing';
  const syncLines = useSyncLog(mr, line.syncLog, syncing);
  const view = line.syncLog
    ? syncSteps(syncLines, syncing, mr.doctor?.forge)
    : null;
  const handoff =
    view?.outcome === 'paused' && DOCTOR_AT_WORK.has(mr.doctor?.status ?? '')
      ? { onFocus: () => ctx.onFocusPane(mr, 'doctor') }
      : undefined;
  // The word follows the sync's step; a doctor on its conflicts says so.
  const word =
    view?.phase?.word ?? (handoff ? 'resolving conflicts' : line.word);
  const shownDetail = view?.phase
    ? view.phase.detail
    : handoff
      ? 'doctor'
      : line.detail;
  const detail = shownDetail ? clauseOf(shownDetail) : null;
  return (
    <div className="tui-status" data-tone={line.tone}>
      {line.spin === 'cloud' && <CloudSpinner />}
      {view ? (
        <SyncLogWord
          mr={mr}
          word={word}
          lines={syncLines}
          view={view}
          running={syncing}
          {...(handoff ? { handoff } : {})}
        />
      ) : (
        <span className="tui-status-word" title={line.word}>
          {line.word}
        </span>
      )}
      {/* A sync's running pip already moves. */}
      {line.spin === true && !view && (
        <span className="tui-status-ring" aria-hidden />
      )}
      {line.tone === 'clear' && (
        <span className="tui-status-sun" aria-hidden>
          <Sun />
        </span>
      )}
      {detail && (
        <span className="tui-status-detail" title={detail.full ?? undefined}>
          {detail.text}
        </span>
      )}
      {line.noPack && (
        <Tooltip tip={NO_PACK_TIP} className="tui-status-nopack">
          <Badge intent="muted" aria-label={NO_PACK_TIP}>
            no pack
          </Badge>
        </Tooltip>
      )}
      {more.length > 0 && <MoreStatuses mr={mr} more={more} ctx={ctx} />}
      {verbs.length > 0 && (
        <span className="tui-status-verbs">
          {ordered(verbs).map(({ verb, primary }) => {
            const lane = laneOf(verb);
            const merge = verb.kind === 'merge';
            return (
              <button
                key={`${verb.kind}-${verb.label}`}
                type="button"
                className="tui-status-verb"
                data-verb={verb.kind}
                data-lane={lane}
                data-decide={verb.kind === 'answer' ? 'true' : undefined}
                data-armed={merge && armed ? 'true' : undefined}
                data-hot={hot && primary ? 'true' : undefined}
                data-secondary={primary ? undefined : 'true'}
                onClick={e => {
                  e.stopPropagation();
                  if (merge && !armed) {
                    setArmed(true);
                    return;
                  }
                  setArmed(false);
                  runVerb(verb, mr, ctx);
                }}
                onBlur={merge ? () => setArmed(false) : undefined}
              >
                {lane && <AgentGlyph />}
                {merge && armed ? 'really merge?' : verb.label}
              </button>
            );
          })}
        </span>
      )}
    </div>
  );
}
