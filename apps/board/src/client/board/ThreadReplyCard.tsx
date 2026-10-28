import { useState, type ReactNode } from 'react';
import { AnimatePresence, domAnimation, LazyMotion, m } from 'motion/react';

import { Button, ICONS } from '@mattstack/tui-kit';
import { commentState } from './CommentComposer.tsx';
import { CommentMarkdown } from './CommentMarkdown.tsx';
import { Disclosure } from './Disclosure.tsx';
import { SearchCheckIcon } from './icons.tsx';
import { CommentEditor, DraftMeta } from './ReviewDraftCard.tsx';

export interface ThreadMessage {
  /** Absent on the viewer's own message, which needs no name. */
  who?: string;
  text: string;
}

export interface ThreadReplyCardProps {
  /** The thread's file:line, or "General thread". */
  label: string;
  status: { text: string; hue: 'green' | 'amber' | 'accent' | 'muted' };
  /** The fix commit a respond reply points at. */
  sha?: string;
  /** The review round the thread was opened in. */
  round?: number;
  messages: ThreadMessage[];
  /** Said in place of the other side's message when they never replied. */
  silence?: string;
  check?: { note: string; settled: boolean };
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

/** A reply on a review thread, shaped like a finding card: the header's
    tick posts the reply, the thread reads as who said what, and the reply
    is the click-to-edit comment. Unticked, the card folds to its header,
    which keeps the resolve tick so a thread can close without a reply. */
export function ThreadReplyCard(p: ThreadReplyCardProps) {
  const { edited } = commentState(p.draft, p.value, true);
  const label = `Reply on ${p.label}`;
  const reset = (resetText?: string) => (
    <DraftMeta edited label={label} resetText={resetText} onReset={p.onReset} />
  );
  return (
    <article
      className="tui-review-card tui-reply-card"
      data-off={p.posting ? undefined : ''}
      aria-label={p.label}
    >
      <div className="tui-review-card-head tui-reply-head">
        <label className="tui-review-finding-row tui-reply-head-label">
          <input
            type="checkbox"
            className="tui-gate-choice-input"
            data-type="checkbox"
            data-checked={p.posting ? '' : undefined}
            checked={p.posting}
            aria-label={`${p.label}: post reply`}
            onChange={e => p.onPosting(e.currentTarget.checked)}
          />
          <span
            className="tui-review-finding-title tui-reply-title"
            data-file={p.label.includes(':') ? '' : undefined}
          >
            {p.label}
            {p.round !== undefined && (
              <span className="tui-respond-pill tui-reply-round">
                Round {p.round}
              </span>
            )}
          </span>
          <span className="tui-reply-status" data-hue={p.status.hue}>
            {p.status.text}
            {p.sha && <code className="tui-reply-sha">{p.sha}</code>}
          </span>
        </label>
        {!p.posting && p.resolve && (
          <ResolveTick label={p.label} resolve={p.resolve} />
        )}
      </div>
      <LazyMotion features={domAnimation}>
        <AnimatePresence initial={false}>
          {p.posting && (
            <m.div
              key="body"
              className="tui-review-card-body"
              initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
              animate={{
                height: 'auto',
                opacity: 1,
                transitionEnd: { overflow: 'visible' },
              }}
              exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            >
              {(p.messages.length > 0 || p.silence || p.check) && (
                <section className="tui-reply-thread" aria-label="Thread">
                  {p.messages.map((msg, i) => (
                    <Message key={i} {...msg} />
                  ))}
                  {p.silence && (
                    <p className="tui-reply-silence">{p.silence}</p>
                  )}
                  {p.check && <AgentCheck {...p.check} />}
                </section>
              )}
              <section
                className="tui-review-section"
                data-section="comment"
                data-draft-part=""
                data-edited={edited || undefined}
                aria-label="Reply"
              >
                <CommentEditor
                  label={label}
                  draft={p.draft}
                  value={p.value}
                  variant="plain"
                  heading="Editing reply"
                  actions={edited && reset()}
                  badge={
                    edited && (
                      <>
                        <span className="tui-cte-badge-state">Edited</span>
                        <span
                          className="tui-cte-badge-sep"
                          aria-hidden="true"
                        />
                        {reset('Reset')}
                      </>
                    )
                  }
                  onChange={p.onChange}
                />
                {p.resolve && (
                  <ResolveTick label={p.label} resolve={p.resolve} />
                )}
              </section>
            </m.div>
          )}
        </AnimatePresence>
      </LazyMotion>
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

/** What the agent found on the thread, behind a badge: verified when the
    author's change or pushback holds, else still open. */
function AgentCheck({ note, settled }: { note: string; settled: boolean }) {
  const [open, setOpen] = useState(false);
  const label = settled ? 'Agent verified' : 'Agent: still open';
  return (
    <div className="tui-reply-check">
      <Button
        type="button"
        variant="outline"
        intent={settled ? 'ok' : 'warn'}
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <SearchCheckIcon />
        {label}
        <span className="tui-reply-check-chevron" data-open={open || undefined}>
          {ICONS['chevron-right']}
        </span>
      </Button>
      <Disclosure open={open}>
        <p className="tui-reply-check-note">{note}</p>
      </Disclosure>
    </div>
  );
}
