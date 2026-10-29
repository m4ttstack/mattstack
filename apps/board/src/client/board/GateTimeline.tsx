import type { ReactNode } from 'react';
import { Check, MessageSquare } from 'lucide-react';

import { AvatarTile } from './PersonLead.tsx';

export type ReviewOutcome = 'comment' | 'approve';

export const RESPONSE_STEPS = ['Plan', 'Fix', 'Post'] as const;
export type ResponseStep = (typeof RESPONSE_STEPS)[number];

type MarkState = 'done' | 'current' | 'next';

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
}: {
  round: number;
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
      <li className="tui-tl-round">Round {round}</li>
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
