import type { ReactNode } from 'react';
import { useState } from 'react';
import { Check, ChevronDown, MessageSquare } from 'lucide-react';

import { Popover } from '@mattstack/tui-kit';
import { AvatarTile } from './PersonLead.tsx';

export type ReviewOutcome = 'comment' | 'approve';

export const RESPONSE_STEPS = ['Plan', 'Fix', 'Post'] as const;
export type ResponseStep = (typeof RESPONSE_STEPS)[number];

type MarkState = 'done' | 'current' | 'next';

/** One round as the round menu lists it: who did what, in order. `now`
    marks the step a gate is on, in its phase's colour. */
export interface RoundEntry {
  round: number;
  events: { id?: string; text: string; now?: 'review' | 'response' }[];
}

function RoundChip({
  round,
  history,
}: {
  round: number;
  history?: RoundEntry[];
}) {
  const [open, setOpen] = useState(false);
  if (!history || history.length < 2)
    return <span className="tui-tl-round-chip">Round {round}</span>;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      sideOffset={8}
      ariaLabel="Earlier rounds"
      trigger={
        <button type="button" className="tui-tl-round-chip" data-menu>
          Round {round}
          <ChevronDown size={14} aria-hidden />
        </button>
      }
    >
      <div className="tui-tl-history">
        {history.map(entry => (
          <div
            key={entry.round}
            className="tui-tl-history-round"
            data-current={entry.round === round || undefined}
          >
            <span className="tui-tl-history-n">Round {entry.round}</span>
            <ul>
              {entry.events.map((e, i) => (
                <li key={i} data-now={e.now}>
                  {e.id ? (
                    <AvatarTile id={e.id} />
                  ) : (
                    <span className="tui-tl-history-blank" aria-hidden />
                  )}
                  {e.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Popover>
  );
}

function Mark({ state, icon }: { state: MarkState; icon?: ReactNode }) {
  return (
    <span className="tui-tl-mark" aria-hidden>
      {state === 'done' ? icon : state === 'current' && <span />}
    </span>
  );
}

/** Where a gate sits in the review-and-response loop: the round, the
    review that opened it, then the response that answers it. */
export function GateTimeline({
  round,
  review,
  response,
  history,
}: {
  round: number;
  /** Every round so far, this one last; the round chip opens it once
      there is more than one. */
  history?: RoundEntry[];
  /** `outcome` once the review is posted; absent while it is the step you
      are on. */
  review: { id?: string; label: string; outcome?: ReviewOutcome };
  /** `at` while you are responding; absent while the response is still to
      come. */
  response: { id?: string; label: string; at?: ResponseStep };
}) {
  const reviewing = review.outcome === undefined;
  const at = response.at ? RESPONSE_STEPS.indexOf(response.at) : -1;
  return (
    <ol className="tui-tl" aria-label="Review timeline">
      <li className="tui-tl-round">
        <RoundChip round={round} history={history} />
      </li>
      <li
        className="tui-tl-step"
        data-phase="review"
        data-state={reviewing ? 'current' : 'done'}
        data-outcome={review.outcome}
        aria-current={reviewing ? 'step' : undefined}
      >
        <Mark
          state={reviewing ? 'current' : 'done'}
          icon={
            review.outcome === 'approve' ? (
              <Check size={15} strokeWidth={2.5} />
            ) : (
              <MessageSquare size={13} strokeWidth={2.25} />
            )
          }
        />
        {review.id && <AvatarTile id={review.id} />}
        {review.label}
      </li>
      {response.at ? (
        <li className="tui-tl-response">
          <span className="tui-tl-response-label">{response.label}</span>
          <ol className="tui-tl-response-steps">
            {RESPONSE_STEPS.map((step, i) => {
              const state: MarkState =
                i < at ? 'done' : i === at ? 'current' : 'next';
              return (
                <li
                  key={step}
                  className="tui-tl-step"
                  data-phase="response"
                  data-state={state}
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  <Mark
                    state={state}
                    icon={<Check size={12} strokeWidth={3} />}
                  />
                  {step}
                </li>
              );
            })}
          </ol>
        </li>
      ) : (
        <li className="tui-tl-step" data-phase="response" data-state="next">
          <Mark state="next" />
          {response.id && <AvatarTile id={response.id} />}
          {response.label}
        </li>
      )}
    </ol>
  );
}
