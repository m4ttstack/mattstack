import type { ReactNode } from 'react';

import { Chip, ICONS } from '@mattstack/tui-kit';
import { commentState } from './CommentComposer.tsx';
import { CommentMarkdown } from './CommentMarkdown.tsx';
import {
  AgentCheck,
  Answer,
  CardTitle,
  CommentArea,
  DraftField,
  GateCard,
  SaidBox,
  StatusMark,
  ThreadCode,
  type AgentVerdict,
  type StatusHue,
} from './GateParts.tsx';
import { CommentAuthor } from './PersonLead.tsx';

export interface ThreadMessage {
  /** Absent on the viewer's own message, which needs no name. */
  who?: string;
  /** The username their invader is generated from. */
  whoId?: string;
  text: string;
}

export interface ThreadReplyCardProps {
  /** The thread's file:line, or "General thread". */
  label: string;
  status: { text: string; hue: StatusHue };
  /** The fix commit a respond reply points at. */
  sha?: string;
  /** The review round the thread was opened in. */
  round?: number;
  /** Beside the title, as the plan card shows the thread's severity. */
  tag?: ReactNode;
  /** `conversation`: the thread reads as who said what above the reply (a
      re-review). `stacked`: the agent's check, the comment being answered
      in its box, and the reply hung under it (a respond post). */
  layout?: 'conversation' | 'stacked';
  /** The MR, for the code a file:line thread was left on. */
  mr?: { url?: string; ref?: string; revision?: string };
  messages: ThreadMessage[];
  /** Your username, for the invader beside your reply. */
  selfId?: string;
  /** Said in place of the other side's message when they never replied. */
  silence?: string;
  check?: { note: string; verdict: AgentVerdict };
  draft: string;
  value: string | undefined;
  posting: boolean;
  onPosting: (on: boolean) => void;
  /** Absent when the thread cannot be resolved (an Overview comment). */
  resolve?: { on: boolean; onChange: (on: boolean) => void };
  onChange: (text: string) => void;
  onReset: () => void;
}

function ResolveTick({
  label,
  resolve,
}: {
  label: string;
  resolve: NonNullable<ThreadReplyCardProps['resolve']>;
}) {
  return (
    <label className="tui-reply-resolve">
      <input
        type="checkbox"
        className="tui-gate-choice-input"
        data-type="checkbox"
        data-checked={resolve.on ? '' : undefined}
        checked={resolve.on}
        aria-label={`${label}: resolve thread`}
        onChange={e => resolve.onChange(e.currentTarget.checked)}
      />
      Resolve thread
    </label>
  );
}

/** A reply on a review thread, in the finding card: the head's tick posts
    the reply, and the reply is the click-to-edit comment. Unticked, the
    card folds to its head, which keeps the resolve tick so a thread can
    close without a reply. */
export function ThreadReplyCard(p: ThreadReplyCardProps) {
  const { edited } = commentState(p.draft, p.value, true);
  const label = `Reply on ${p.label}`;
  const stacked = p.layout === 'stacked';
  const said = stacked ? p.messages.find(m => m.who) : undefined;
  const field = (
    <DraftField
      label={label}
      draft={p.draft}
      value={p.value}
      heading="Editing reply"
      lead={stacked ? <CommentAuthor id={p.selfId} name="You:" /> : undefined}
      footer={p.resolve && <ResolveTick label={p.label} resolve={p.resolve} />}
      onChange={p.onChange}
      onReset={p.onReset}
    />
  );
  return (
    <GateCard
      label={p.label}
      checked={p.posting}
      tickLabel={`${p.label}: post reply`}
      onCheck={p.onPosting}
      head={
        <>
          <CardTitle label={p.label}>
            {p.round !== undefined && (
              <span className="tui-respond-pill tui-reply-round">
                Round {p.round}
              </span>
            )}
          </CardTitle>
          {p.tag}
          <StatusMark {...p.status}>
            {p.sha && <code className="tui-reply-sha">{p.sha}</code>}
          </StatusMark>
        </>
      }
      aside={
        !p.posting &&
        p.resolve && <ResolveTick label={p.label} resolve={p.resolve} />
      }
    >
      <ThreadCode label={p.label} mr={p.mr} />
      {!stacked && (p.messages.length > 0 || p.silence) && (
        <section className="tui-reply-thread" aria-label="Thread">
          {p.messages.map((msg, i) => (
            <Message key={i} {...msg} />
          ))}
          {p.silence && (
            <div className="tui-reply-msg tui-reply-silence">
              <Chip
                intent="muted"
                variant="outline"
                icon={ICONS['triangle-alert']}
              >
                {p.silence}
              </Chip>
            </div>
          )}
        </section>
      )}
      <CommentArea
        label="Reply"
        edited={edited}
        className={stacked ? 'tui-stacked-area' : undefined}
      >
        {p.check && <AgentCheck {...p.check} />}
        {said ? (
          <>
            <SaidBox who={said.who!} whoId={said.whoId} text={said.text} />
            <Answer>{field}</Answer>
          </>
        ) : (
          field
        )}
      </CommentArea>
    </GateCard>
  );
}

function Message({ who, text }: ThreadMessage): ReactNode {
  return (
    <div className="tui-reply-msg">
      {who && <span className="tui-reply-name">{who}</span>}
      <div className="tui-reply-text">
        <CommentMarkdown>{text}</CommentMarkdown>
      </div>
    </div>
  );
}

export type { AgentVerdict };
