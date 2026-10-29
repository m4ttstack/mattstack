import { useEffect, useRef } from 'react';
import { CornerDownRight, Info, MessageSquare, Wrench } from 'lucide-react';

import type { GateItemDisplay } from '@mattstack/gate-kit/react';
import { LabeledSeg, Tooltip } from '@mattstack/tui-kit';
import { commentState } from './CommentComposer.tsx';
import type { ThreadCtx } from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import {
  AgentCheck,
  Answer,
  CardTitle,
  CommentArea,
  DraftField,
  GateCard,
  SaidBox,
  StatusMark,
  THREAD_CALL,
  ThreadCode,
} from './GateParts.tsx';
import { SeverityPill } from './RespondCards.tsx';

const LATER_TIP =
  'Your reply will be drafted during the Post step. The agent writes the draft and you can edit it freely at that point.';

/** One reviewer thread on the plan gate, in the review finding's card: the
    tick keeps it (unticked posts nothing and changes nothing), the code the
    reviewer commented on, the agent's verdict beside the choice between
    fixing the code and replying, the reviewer's comment, and what answers
    it. The answers are the gate's own `fix:`, `reply:` and `skip:`
    options; the flow does not change. */
export function PlanThreadCard({
  q,
  ctx,
  form,
  reviewer,
  draft,
  mr,
}: {
  q: GateItemDisplay;
  ctx: ThreadCtx;
  form: GateFormState;
  /** The reviewer's name as the sheet shows people. */
  reviewer: string;
  /** The drafted reply's exact words, when the agent drafted one. */
  draft?: string;
  mr?: { url?: string; ref?: string; revision?: string };
}) {
  const by = (prefix: string) =>
    q.choices.find(c => c.value.startsWith(prefix));
  const fix = by('fix:');
  const reply = by('reply:');
  const skip = by('skip:');
  const current = form.selections[q.name];
  const picked = typeof current === 'string' ? current : undefined;
  const recommended =
    q.choices.find(c => c.recommended && c !== skip) ?? fix ?? reply;
  // Re-ticking a thread brings back the choice it had before it was
  // skipped, else the agent's pick.
  const lastKept = useRef<string | undefined>(undefined);
  if (picked && picked !== skip?.value) lastKept.current = picked;

  useEffect(() => {
    if (picked === undefined && recommended)
      form.setSingle(q.name, recommended.value);
    // Seeds once per thread; a thread with a pick keeps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.name]);

  const choose = (value: string) => form.setSingle(q.name, value);
  const kept = picked !== skip?.value;
  const answer = picked ?? recommended?.value;
  const fixing = !!fix && answer === fix.value;
  const replying = !!reply && answer === reply.value;
  const call = THREAD_CALL[ctx.verdict.call];
  const label = q.prompt;
  const value = replying ? form.texts[q.name] : undefined;
  const { edited } = commentState(draft ?? '', value, true);

  return (
    <GateCard
      label={label}
      className="tui-plan-card"
      checked={kept}
      tickLabel={`${label}: respond`}
      onCheck={on => {
        const next = on
          ? (lastKept.current ?? recommended?.value)
          : skip?.value;
        if (next) choose(next);
      }}
      head={
        <>
          <CardTitle label={label} />
          <SeverityPill severity={ctx.severity} />
          <StatusMark
            text={kept ? call.text : 'Skipped'}
            hue={kept ? call.hue : 'muted'}
          />
        </>
      }
    >
      <ThreadCode label={label} mr={mr} />
      <CommentArea label="Response" edited={edited}>
        <div className="tui-plan-verdict">
          {call.check && ctx.verdict.note ? (
            <AgentCheck note={ctx.verdict.note} verdict={call.check} />
          ) : (
            <span />
          )}
          {fix && reply && (
            <LabeledSeg
              soft
              className="tui-plan-switch"
              legend="Fix or reply"
              options={[fix.value, reply.value]}
              labels={{
                [fix.value]: (
                  <>
                    <Wrench size={14} aria-hidden />
                    Fix the code
                  </>
                ),
                [reply.value]: (
                  <>
                    <MessageSquare size={14} aria-hidden />
                    Reply only
                  </>
                ),
              }}
              value={replying ? reply.value : fix.value}
              onChange={choose}
            />
          )}
        </div>
        <SaidBox
          who={reviewer}
          text={ctx.claim.summary}
          points={ctx.claim.points}
        />
        {fixing && (
          <p className="tui-plan-fix">
            <CornerDownRight size={16} aria-hidden />
            <span>{fix.subtitle ?? fix.label}</span>
          </p>
        )}
        {replying && (
          <Answer>
            {draft !== undefined ? (
              <DraftField
                label={`Reply on ${label}`}
                draft={draft}
                value={value}
                heading="Editing reply"
                lead="You:"
                onChange={t => form.setText(q.name, t)}
                onReset={() => form.clearText(q.name)}
              />
            ) : (
              <p className="tui-plan-later">
                Drafted at posting
                <Tooltip tip={LATER_TIP}>
                  <button
                    type="button"
                    className="tui-plan-later-info"
                    aria-label={LATER_TIP}
                  >
                    <Info size={14} aria-hidden />
                  </button>
                </Tooltip>
              </p>
            )}
          </Answer>
        )}
      </CommentArea>
    </GateCard>
  );
}
