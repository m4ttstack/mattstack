import { useState, type ReactNode } from 'react';
import { Flag, ThumbsUp } from 'lucide-react';
import { AnimatePresence, domAnimation, LazyMotion, m } from 'motion/react';

import { Button, CHECK_ICON, Icon, ICONS } from '@mattstack/tui-kit';
import { commentState } from './CommentComposer.tsx';
import { CommentMarkdown } from './CommentMarkdown.tsx';
import { Disclosure } from './Disclosure.tsx';
import type { FindingEntry, VerdictCall } from './gate-ctx.ts';
import { CodeSection, CommentEditor, DraftMeta } from './ReviewDraftCard.tsx';

/** The parts every gate card is built from: a review finding, a re-review
    thread, a respond plan thread and a respond post reply are the same
    card with different contents. */

export type StatusHue = 'green' | 'amber' | 'accent' | 'muted';

/** A card's state on the right of its head: a dot and a word in its hue. */
export function StatusMark({
  text,
  hue,
  children,
}: {
  text: string;
  hue: StatusHue;
  children?: ReactNode;
}) {
  return (
    <span className="tui-reply-status" data-hue={hue}>
      {text}
      {children}
    </span>
  );
}

/** A file:line label anchors a diff; "General thread" and "Overview
    comment" do not. */
export const isAnchor = (label: string) => /:\d+$/.test(label);

/** The card's title: a file:line in mono, anything else in the sans. */
export function CardTitle({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <span
      className="tui-review-finding-title tui-reply-title"
      data-file={isAnchor(label) ? '' : undefined}
    >
      {label}
      {children}
    </span>
  );
}

/** The card's body, folding away with the head's tick. Clips only while it
    eases: open, a popover inside it must be free to spill out. */
export function CardBody({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {open && (
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
            {children}
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}

/** A thread card: the tick and everything beside it are one label, so the
    whole head toggles the card; `aside` sits outside it, in the head's
    right end, for a control of its own. */
export function GateCard({
  label,
  checked,
  tickLabel,
  onCheck,
  head,
  aside,
  className,
  children,
}: {
  label: string;
  checked: boolean;
  tickLabel: string;
  onCheck: (on: boolean) => void;
  head: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={`tui-review-card tui-reply-card${className ? ` ${className}` : ''}`}
      data-off={checked ? undefined : ''}
      aria-label={label}
    >
      <div className="tui-review-card-head tui-reply-head">
        <label className="tui-review-finding-row tui-reply-head-label">
          <input
            type="checkbox"
            className="tui-gate-choice-input"
            data-type="checkbox"
            data-checked={checked ? '' : undefined}
            checked={checked}
            aria-label={tickLabel}
            onChange={e => onCheck(e.currentTarget.checked)}
          />
          {head}
        </label>
        {aside}
      </div>
      <CardBody open={checked}>{children}</CardBody>
    </article>
  );
}

/** The code a thread was left on, through the review card's code section;
    nothing for a thread with no file:line. */
export function ThreadCode({
  label,
  mr,
}: {
  label: string;
  mr?: { url?: string; ref?: string; revision?: string };
}) {
  if (!isAnchor(label) || !mr?.url) return null;
  return (
    <CodeSection
      mrUrl={mr.url}
      mrRef={mr.ref}
      mrRevision={mr.revision}
      finding={
        {
          id: label,
          severity: 'minor',
          title: label,
          body: '',
          file: label,
        } as FindingEntry
      }
      pins={[]}
    />
  );
}

/** The card's grey comment area; `edited` marks a changed draft inside it,
    which its reset finds by `data-draft-part`. */
export function CommentArea({
  label,
  edited = false,
  className,
  children,
}: {
  label: string;
  edited?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`tui-review-section${className ? ` ${className}` : ''}`}
      data-section="comment"
      data-draft-part=""
      data-edited={edited || undefined}
      aria-label={label}
    >
      {children}
    </section>
  );
}

/** A drafted comment or reply: the click-to-edit field, with "Edited |
    Reset" on its border at rest and the reset beside its heading while
    writing. */
export function DraftField({
  label,
  draft,
  value,
  heading,
  lead,
  footer,
  onChange,
  onReset,
  onEditing,
}: {
  label: string;
  draft: string;
  value: string | undefined;
  heading: string;
  lead?: ReactNode;
  footer?: ReactNode;
  onChange: (text: string) => void;
  onReset: () => void;
  onEditing?: (editing: boolean) => void;
}) {
  const { edited } = commentState(draft, value, true);
  const reset = (resetText?: string) => (
    <DraftMeta edited label={label} resetText={resetText} onReset={onReset} />
  );
  return (
    <CommentEditor
      label={label}
      draft={draft}
      value={value}
      variant="plain"
      heading={heading}
      lead={lead}
      footer={footer}
      actions={edited && reset()}
      badge={
        edited && (
          <>
            <span className="tui-cte-badge-state">Edited</span>
            <span className="tui-cte-badge-sep" aria-hidden="true" />
            {reset('Reset')}
          </>
        )
      }
      onEditing={onEditing}
      onChange={onChange}
    />
  );
}

/** The comment being answered, in a read-only box shaped like the field
    that answers it: who wrote it, then their words. */
export function SaidBox({
  who,
  text,
  points = [],
}: {
  who: string;
  text: string;
  points?: string[];
}) {
  return (
    <div className="tui-plan-said">
      <span className="tui-plan-said-who">{who}</span>
      <CommentMarkdown>{text}</CommentMarkdown>
      {points.length > 0 && (
        <ul className="tui-thread-points">
          {points.map((point, i) => (
            <li key={i}>
              <CommentMarkdown>{point}</CommentMarkdown>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What answers the comment above it, hung under it on a rounded elbow. */
export function Answer({ children }: { children: ReactNode }) {
  return <div className="tui-plan-answer">{children}</div>;
}

/** How the agent judged the thread: a change or a pushback that holds, or
    one that does not yet; on the plan gate, whether it agrees with the
    ask. */
export type AgentVerdict =
  'verified' | 'accepted' | 'flagged' | 'pushback' | 'clarify';

const VERDICT = {
  verified: {
    label: 'Agent verified',
    intent: 'ok',
    icon: <Icon d={CHECK_ICON} />,
  },
  accepted: {
    label: 'Agent accepted',
    intent: 'accent',
    icon: <ThumbsUp size={14} aria-hidden />,
  },
  flagged: {
    label: 'Agent flagged',
    intent: 'warn',
    icon: <Flag size={14} aria-hidden />,
  },
  pushback: {
    label: 'Agent pushes back',
    intent: 'warn',
    icon: <Flag size={14} aria-hidden />,
  },
  clarify: {
    label: 'Agent asks first',
    intent: 'warn',
    icon: <Flag size={14} aria-hidden />,
  },
} as const;

/** What the agent found on the thread, behind a button; its note hangs
    from the button on a rule in its tone. */
export function AgentCheck({
  note,
  verdict,
}: {
  note: string;
  verdict: AgentVerdict;
}) {
  // Only a settled verdict starts folded; anything that disagrees or asks
  // opens with its note showing.
  const [open, setOpen] = useState(
    verdict !== 'verified' && verdict !== 'accepted'
  );
  const v = VERDICT[verdict];
  return (
    <div
      className="tui-reply-check"
      data-verdict={verdict}
      data-open={open || undefined}
    >
      <Button
        type="button"
        variant="filled"
        intent={v.intent}
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {v.icon}
        {v.label}
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

/** A respond thread's verdict call: the word its card's head shows, and
    the agent check it opens with, if any. */
export const THREAD_CALL: Record<
  VerdictCall,
  { text: string; hue: StatusHue; check?: AgentVerdict }
> = {
  valid: { text: 'Valid', hue: 'green', check: 'verified' },
  'valid-low-value': {
    text: 'Valid, low value',
    hue: 'green',
    check: 'verified',
  },
  pushback: { text: 'Pushback', hue: 'amber', check: 'pushback' },
  'needs-clarification': {
    text: 'Needs clarification',
    hue: 'amber',
    check: 'clarify',
  },
  'no-ask': { text: 'No ask', hue: 'muted' },
};
