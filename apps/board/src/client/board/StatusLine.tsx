import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Badge, Popover, Tooltip } from '@mattstack/tui-kit';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { AskGlyph } from './ask-glyph.tsx';
import { clauseOf } from './clause.ts';
import { AgentGlyph, CloudSpinner, Sun } from './icons.tsx';
import type { Candidate, RowStatus, Verb, VerbKind } from './row-status.ts';
import {
  liveSyncLines,
  parseSyncLine,
  shownSyncLog,
  subscribeSyncLines,
  takeAutoOpen,
} from './sync-lines.ts';

type Lane = 'review' | 'respond' | 'doctor';

const NO_PACK_TIP =
  'No pack selected. Launched the generic skill. Set a pack on the tab, or join a team that has one.';

/** How long an armed merge waits for its second click. */
export const MERGE_ARM_MS = 4000;

/** The lane an agent verb launches, re-runs or jumps into. The color of the
    verb is the lane, so a reader knows which agent a click starts before
    reading the word; `resume`, `redo` and `focus` name theirs on the verb. */
const AGENT_LANE: Partial<Record<VerbKind, Lane>> = {
  'launch-review': 'review',
  're-review': 'review',
  'launch-respond': 'respond',
  'restart-respond': 'respond',
  'resume-respond': 'respond',
  'call-doctor': 'doctor',
};

function laneOf(verb: Verb): Lane | undefined {
  if (verb.kind === 'resume' || verb.kind === 'redo' || verb.kind === 'focus')
    return verb.domain;
  return AGENT_LANE[verb.kind];
}

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
function SyncLogBody({
  lines,
  running,
}: {
  lines: readonly string[];
  running: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);
  return (
    <div className="tui-synclog-body" role="log" aria-live="polite">
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
      {lines.map((raw, i) => {
        const line = parseSyncLine(raw);
        // A running step that later lines have moved past is done drawing.
        const stale =
          line.status === 'running' && (!running || i < lines.length - 1);
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
                <span className="tui-synclog-hint">{line.hint}</span>
              )}
            </span>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function SyncLogWord({
  mr,
  word,
  saved,
  running,
}: {
  mr: BoardMRWithReview;
  word: string;
  saved: readonly string[];
  running: boolean;
}) {
  const url = mr.webUrl ?? '';
  const streamed = useSyncExternalStore(subscribeSyncLines, () =>
    liveSyncLines(url)
  );
  const [open, setOpen] = useState(() => takeAutoOpen(url));
  useEffect(() => {
    if (takeAutoOpen(url)) setOpen(true);
  }, [url, streamed]);
  const lines = shownSyncLog(saved, running ? streamed : undefined);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      sideOffset={6}
      ariaLabel={`rt sync output for !${mr.iid}`}
      classNames={{ popup: 'tui-synclog' }}
      trigger={
        <button
          type="button"
          className="tui-status-word tui-status-word-log"
          title={open ? 'hide the rt sync output' : 'show the rt sync output'}
          data-open={open ? 'true' : undefined}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {word}
          <span className="tui-status-word-caret" aria-hidden>
            <AskGlyph name="chevron-down" size={12} />
          </span>
        </button>
      }
    >
      {/* The popup renders in a portal, but React still bubbles its clicks
          to the row, whose own click opens the MR. */}
      <div className="tui-synclog-inner" onClick={e => e.stopPropagation()}>
        <div className="tui-synclog-head">
          <span className="tui-synclog-cmd">rt sync</span>
          <span className="tui-synclog-branch">{mr.sourceBranch}</span>
        </div>
        <SyncLogBody lines={lines} running={running} />
      </div>
    </Popover>
  );
}

/** The row's other status lines, behind a count: the line shows only the
    hottest, and the rest are often finished runs rather than live ones. */
function MoreStatuses({
  mr,
  more,
}: {
  mr: BoardMRWithReview;
  more: readonly Candidate[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      sideOffset={6}
      ariaLabel={`other statuses for !${mr.iid}`}
      classNames={{ popup: 'tui-status-more-pop' }}
      trigger={
        <button
          type="button"
          className="tui-status-more"
          data-open={open ? 'true' : undefined}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          +{more.length} more
        </button>
      }
    >
      <div className="tui-status-more-list" onClick={e => e.stopPropagation()}>
        {more.map((l, i) => {
          const detail = l.detail ? clauseOf(l.detail) : null;
          return (
            <div key={i} className="tui-status-more-line" data-tone={l.tone}>
              <span className="tui-status-more-word">{l.word}</span>
              {detail && (
                <span className="tui-status-more-detail">
                  {detail.full ?? detail.text}
                </span>
              )}
            </div>
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
  const detail = line.detail ? clauseOf(line.detail) : null;
  return (
    <div className="tui-status" data-tone={line.tone}>
      {line.spin === 'cloud' && <CloudSpinner />}
      {line.syncLog ? (
        <SyncLogWord
          mr={mr}
          word={line.word}
          saved={line.syncLog}
          running={mr.doctor?.status === 'syncing'}
        />
      ) : (
        <span className="tui-status-word" title={line.word}>
          {line.word}
        </span>
      )}
      {line.spin === true && <span className="tui-status-ring" aria-hidden />}
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
      {more.length > 0 && <MoreStatuses mr={mr} more={more} />}
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
