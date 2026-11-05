import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { CircleDashed, MessageSquareOff } from 'lucide-react';

import { Chip, ICONS } from '@mattstack/tui-kit';
import { commentState } from './CommentComposer.tsx';
import { CommentMarkdown } from './CommentMarkdown.tsx';
import {
  AgentCheck,
  Answer,
  CardTitle,
  CommentArea,
  DraftField,
  SaidBox,
  StatusMark,
  ThreadCode,
  VerdictMark,
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
  /** The head's mark; absent when no agent call is known for the thread. */
  verdict?: AgentVerdict;
  draft: string;
  value: string | undefined;
  posting: boolean;
  onPosting: (on: boolean) => void;
  /** Absent when the thread cannot be resolved (an Overview comment). */
  resolve?: { on: boolean; onChange: (on: boolean) => void };
  onChange: (text: string) => void;
  onReset: () => void;
}

function ReplyTick({
  label,
  text,
  on,
  inputRef,
  onChange,
}: {
  label: string;
  text: string;
  on: boolean;
  inputRef: Ref<HTMLInputElement>;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="tui-reply-tick">
      <input
        type="checkbox"
        className="tui-gate-choice-input"
        data-type="checkbox"
        data-checked={on ? '' : undefined}
        checked={on}
        aria-label={label}
        ref={inputRef}
        onChange={e => onChange(e.currentTarget.checked)}
      />
      {text}
    </label>
  );
}

/** A reply that will not post, greyed and read-only; ticking "Post reply"
    is the one way back to editing it. */
function HeldReply({
  label,
  selfId,
  text,
  untouched,
}: {
  label: string;
  selfId?: string;
  text: string;
  /** Nothing happens to the thread at all: no reply and no resolve. */
  untouched: boolean;
}) {
  return (
    <div className="tui-reply-held" role="group" aria-label={label}>
      <div className="tui-reply-held-head">
        <CommentAuthor id={selfId} name="You:" />
        <Chip
          intent="muted"
          variant="outline"
          icon={
            untouched ? (
              <CircleDashed size={12} />
            ) : (
              <MessageSquareOff size={12} />
            )
          }
        >
          {untouched ? 'No reply, stays unresolved' : 'Not posting'}
        </Chip>
      </div>
      <div className="tui-reply-held-text">
        {text.trim() === '' ? (
          <p className="tui-field-preview-empty">Empty comment</p>
        ) : (
          <CommentMarkdown>{text}</CommentMarkdown>
        )}
      </div>
    </div>
  );
}

/** A reply on a review thread: the head shows what the agent found, and
    the two ticks on the reply's tab say what happens to the thread. */
export function ThreadReplyCard(p: ThreadReplyCardProps) {
  const { edited } = commentState(p.draft, p.value, true);
  const label = `Reply on ${p.label}`;
  const stacked = p.layout === 'stacked';
  const said = stacked ? p.messages.find(m => m.who) : undefined;
  const postTick = useRef<HTMLInputElement>(null);
  const resolveTick = useRef<HTMLInputElement>(null);
  const refocus = useRef<typeof postTick | null>(null);
  // A tab tick remounts when the reply swaps between its field and its held
  // box; keyboard focus follows it.
  useLayoutEffect(() => {
    refocus.current?.current?.focus();
    refocus.current = null;
  });
  const tab = (
    <>
      <ReplyTick
        label={`${p.label}: post reply`}
        text="Post reply"
        on={p.posting}
        inputRef={postTick}
        onChange={on => {
          refocus.current = postTick;
          p.onPosting(on);
        }}
      />
      {p.resolve && (
        <>
          <span className="tui-reply-tab-sep" aria-hidden="true" />
          <ReplyTick
            label={`${p.label}: resolve thread`}
            text="Resolve thread"
            on={p.resolve.on}
            inputRef={resolveTick}
            onChange={on => {
              refocus.current = resolveTick;
              p.resolve?.onChange(on);
            }}
          />
        </>
      )}
    </>
  );
  const field = p.posting ? (
    <DraftField
      label={label}
      draft={p.draft}
      value={p.value}
      heading="Editing reply"
      lead={<CommentAuthor id={p.selfId} name="You:" />}
      footer={tab}
      onChange={p.onChange}
      onReset={p.onReset}
    />
  ) : (
    <div className="tui-cte-wrap">
      <HeldReply
        label={`${label}, not posting`}
        selfId={p.selfId}
        text={p.value ?? p.draft}
        untouched={!!p.resolve && !p.resolve.on}
      />
      <div className="tui-cte-footer">{tab}</div>
    </div>
  );
  return (
    <article className="tui-review-card tui-reply-card" aria-label={p.label}>
      <div className="tui-review-card-head tui-reply-head">
        <div className="tui-reply-head-label">
          <VerdictMark verdict={p.verdict} />
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
        </div>
      </div>
      <div className="tui-review-card-body">
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
          edited={p.posting && edited}
          className={stacked ? 'tui-stacked-area' : undefined}
        >
          {p.check && <AgentCheck {...p.check} />}
          {said && (
            <SaidBox who={said.who!} whoId={said.whoId} text={said.text} />
          )}
          <div className="tui-reply-band">
            {said ? <Answer>{field}</Answer> : field}
          </div>
        </CommentArea>
      </div>
    </article>
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
