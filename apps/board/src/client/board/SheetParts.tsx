import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  CornerUpLeft,
  MessageSquare,
  ThumbsUp,
} from 'lucide-react';
import { domAnimation, LazyMotion, m, MotionConfig } from 'motion/react';

import type { GateItemDisplay } from '@mattstack/gate-kit/react';
import { Button, Chip, Markdown } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import { AnsweredChip, type GateFormState } from './GateForm.tsx';

function RecommendedChip() {
  return (
    <Chip
      intent="ok"
      variant="outline"
      uppercase
      data-gate="recommended"
      className="tui-gate-recommended"
    >
      recommended
    </Chip>
  );
}

/** What a question's choices read and write: a live form, or a recorded
    answer shown read-only. */
type ChoiceState = Pick<
  GateFormState,
  'selections' | 'setSingle' | 'toggleMulti'
>;

function Choices({
  q,
  form,
  disabled = false,
  renderLabel,
}: {
  q: GateItemDisplay;
  form: ChoiceState;
  disabled?: boolean;
  /** A choice's own label markup; returning undefined keeps the default. */
  renderLabel?: (value: string, chip: ReactNode) => ReactNode;
}) {
  const current = form.selections[q.name];
  const picked = new Set(Array.isArray(current) ? current : []);
  return (
    <div
      className="tui-gate-choices"
      role={q.multiple ? 'group' : 'radiogroup'}
      aria-label={q.prompt}
    >
      {q.choices.map(choice => {
        const checked = q.multiple
          ? picked.has(choice.value)
          : current === choice.value;
        const chip = choice.recommended ? <RecommendedChip /> : null;
        const custom = renderLabel?.(choice.value, chip);
        const input = (
          <input
            type={q.multiple ? 'checkbox' : 'radio'}
            className="tui-gate-choice-input"
            data-type={q.multiple ? 'checkbox' : 'radio'}
            data-checked={checked ? '' : undefined}
            name={q.name}
            value={choice.value}
            checked={checked}
            disabled={disabled}
            onClick={() => {
              if (!q.multiple && q.writeIn && checked)
                form.setSingle(q.name, '');
            }}
            onChange={e =>
              q.multiple
                ? form.toggleMulti(
                    q.name,
                    choice.value,
                    e.currentTarget.checked
                  )
                : form.setSingle(q.name, choice.value)
            }
          />
        );
        return (
          <label
            className="tui-gate-choice"
            data-checked={checked || undefined}
            data-recommended={choice.recommended ? 'true' : undefined}
            key={choice.value}
          >
            {q.multiple ? (
              <span className="tui-check">
                {input}
                <span className="tui-check-tick" aria-hidden="true" />
              </span>
            ) : (
              input
            )}
            <span className="tui-gate-choice-label">
              {custom ?? (
                <>
                  <span className="tui-gate-choice-label-row">
                    <span title={choice.description}>{choice.label}</span>
                    {chip}
                  </span>
                  {choice.subtitle && (
                    <span className="tui-gate-choice-subtitle">
                      {choice.subtitle}
                    </span>
                  )}
                </>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function Note({ q, form }: { q: GateItemDisplay; form: GateFormState }) {
  const v = form.selections[q.name];
  const picked = Array.isArray(v)
    ? v.length > 0
    : typeof v === 'string' && v !== '';
  return (
    <input
      type="text"
      className="tui-gate-note"
      aria-label={`Note for ${q.prompt}`}
      placeholder={
        q.writeIn && !picked
          ? 'Write your own answer, or pick one above'
          : 'Add a note'
      }
      value={form.notes[q.name] ?? ''}
      onChange={e => form.setNote(q.name, e.currentTarget.value)}
    />
  );
}

/** A question's own context when it is prose; a structured context that
    has no card here renders nothing rather than raw JSON. */
function ProseContext({
  q,
  structured,
}: {
  q: GateItemDisplay;
  structured: boolean;
}) {
  if (!q.context || structured) return null;
  return (
    <div className="tui-gate-question-context">
      <Markdown unstyled linkTargetBlank>
        {q.context}
      </Markdown>
    </div>
  );
}

type RowChip = {
  text: string;
  intent: 'ok' | 'muted' | 'accent';
  title?: string;
} | null;

interface SheetRow {
  key: string;
  text: ReactNode;
  /** The row's full text on hover, for a dock that clips it. */
  title?: string;
  chips: RowChip[];
}

/** A break opportunity after every slash, so a path that wraps in a narrow
    dock splits between segments, never inside one. */
function slashBreaks(text: string): ReactNode {
  const parts = text.split('/');
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) =>
    i === parts.length - 1 ? [part] : [`${part}/`, <wbr key={i} />]
  );
}

/** The dock's one line per decision: its chips, then what it decides. A
    null chip keeps its slot empty so every row's text starts at one edge. */
function SheetRows({ card, rows }: { card: string; rows: SheetRow[] }) {
  return (
    <div className="tui-sheet-card-list" data-card={card}>
      {rows.map(r => (
        <div className="tui-sheet-card-row" key={r.key}>
          {r.chips.map((c, i) =>
            c ? (
              <Chip
                key={c.text}
                intent={c.intent}
                variant="outline"
                uppercase
                className="tui-sheet-card-chip"
                title={c.title}
              >
                {c.text}
              </Chip>
            ) : (
              <span
                key={`slot-${i}`}
                className="tui-sheet-card-chip-slot"
                aria-hidden="true"
              />
            )
          )}
          <span
            className="tui-sheet-card-text"
            title={r.title ?? (typeof r.text === 'string' ? r.text : undefined)}
          >
            {typeof r.text === 'string' ? slashBreaks(r.text) : r.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Ref for a sheet's pinned panel (its dock, or the lost panel): keeps the
    panel's height on its scroller as --sheet-dock-h, which the stacked
    layout reserves as scroll padding, so a control scrolled into view clears
    the panel however tall its rows make it. */
function reserveDock(panel: HTMLElement | null) {
  const body = panel?.closest<HTMLElement>('.tui-sheet-body');
  if (!panel || !body || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() =>
    body.style.setProperty(
      '--sheet-dock-h',
      `${Math.ceil(panel.getBoundingClientRect().height)}px`
    )
  );
  observer.observe(panel);
  return () => {
    observer.disconnect();
    body.style.removeProperty('--sheet-dock-h');
  };
}

/** The rail once another surface answered the gate first: the answer that
    won, and a way on to the next gate. */
function SheetLost({
  gate,
  lost,
  onContinue,
}: {
  gate: GateRow;
  lost: NonNullable<GateFormState['lost']>;
  onContinue: () => void;
}) {
  return (
    <div className="tui-sheet-lost" ref={reserveDock}>
      <span className="tui-gate-error">answered elsewhere</span>
      <AnsweredChip
        startOpen
        row={{
          subject: gate.subject,
          kind: gate.kind,
          status: 'answered',
          questions: gate.questions,
          answer: { answers: lost.answers, by: lost.by },
        }}
      />
      <Button
        type="button"
        variant="filled"
        intent="accent"
        size="lg"
        onClick={onContinue}
      >
        continue
      </Button>
    </div>
  );
}

/** The round a review or respond gate is on, as the first thing the main
    column says, with a one-line account of what this round holds. */
function RoundHeading({
  round,
  noun = 'Round',
  revise,
  summary,
  aside,
}: {
  round?: number;
  /** What the round is called ahead of its number. */
  noun?: string;
  /** Re-adjudications past the round, shown after it. */
  revise?: number;
  summary?: string;
  /** Held at the band's right edge. */
  aside?: ReactNode;
}) {
  const text = [
    round !== undefined ? `${noun} ${round}` : undefined,
    revise !== undefined
      ? `${round !== undefined ? 'revise' : 'Revise'} ${revise}`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  if (!text && !aside) return null;
  return (
    <div className="tui-sheet-round">
      {text && <h2 className="tui-sheet-round-n">{text}</h2>}
      {summary && <span className="tui-sheet-round-summary">{summary}</span>}
      {aside && <div className="tui-sheet-round-aside">{aside}</div>}
    </div>
  );
}

const RESPOND_PHASES = ['Plan', 'Fix', 'Post'] as const;

interface Step {
  label: string;
  /** Shown in a done step's dot in place of the check. */
  icon?: ReactNode;
}

/** Steps in order: the one at `at` lit, the ones before it done. `groups`
    splits them into runs that belong together, set apart by a divider. */
function StepTrack({
  groups,
  at,
  label,
}: {
  groups: Step[][];
  at: number;
  label: string;
}) {
  const steps = groups.flatMap((g, gi) =>
    g.map((step, si) => ({ ...step, starts: gi > 0 && si === 0 }))
  );
  return (
    <ol className="tui-phase-track" aria-label={label}>
      {steps.map((step, i) => (
        <li
          key={i}
          className="tui-phase"
          data-done={i < at || undefined}
          data-group-start={step.starts || undefined}
          aria-current={i === at ? 'step' : undefined}
        >
          <span className="tui-phase-dot" aria-hidden>
            {i < at && (step.icon ?? <Check size={12} strokeWidth={3} />)}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

/** Where a respond run is: you plan, the agent fixes, you post. */
function PhaseTrack({ at }: { at: (typeof RESPOND_PHASES)[number] }) {
  return (
    <StepTrack
      groups={[RESPOND_PHASES.map(p => ({ label: p }))]}
      at={RESPOND_PHASES.indexOf(at)}
      label="Respond steps"
    />
  );
}

const STEP_ICON = { size: 11, strokeWidth: 2.5 } as const;

/** How a review got here, one group per round: the review, with what it
    posted, and the author's response to it; an approval needs no response.
    This round's group ends on the response still to come.
    `outcomes` are the recorded rounds' posts in round order; a round with
    none recorded shows a plain check. */
function ReviewTrack({
  round,
  outcomes = [],
}: {
  round: number;
  outcomes?: readonly string[];
}) {
  const groups = Array.from({ length: round }, (_, i): Step[] => {
    const review = `Review ${i + 1}`;
    if (i === round - 1) return [{ label: review }, { label: 'Response' }];
    const outcome = outcomes[i];
    if (outcome === 'approve')
      return [{ label: review, icon: <ThumbsUp {...STEP_ICON} /> }];
    return [
      {
        label: review,
        icon:
          outcome === 'comment' ? <MessageSquare {...STEP_ICON} /> : undefined,
      },
      { label: 'Response', icon: <CornerUpLeft {...STEP_ICON} /> },
    ];
  });
  return (
    <StepTrack
      groups={groups}
      at={groups.flat().length - 2}
      label="Review timeline"
    />
  );
}

/** A keyboard hint, drawn from `data-keys` by CSS so it stays out of the
    control's text and accessible name: the label carries the meaning.
    `onFill` sits it inside a filled button. */
function KeyCap({ keys, onFill = false }: { keys: string; onFill?: boolean }) {
  return (
    <kbd
      className="tui-key-cap"
      data-keys={keys}
      data-variant={onFill ? 'on-fill' : undefined}
      aria-hidden="true"
    />
  );
}

/** The submit chord, shown on every sheet's primary button. */
const SUBMIT_KEYS = '⌘↵';

export {
  Choices,
  KeyCap,
  Note,
  ProseContext,
  reserveDock,
  PhaseTrack,
  ReviewTrack,
  RoundHeading,
  SheetLost,
  SheetRows,
  SUBMIT_KEYS,
};
export type { ChoiceState, RowChip, SheetRow };

/** The nearest ancestor that scrolls: the findings column on a wide
    screen, the whole sheet once it stacks. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === 'auto' || y === 'scroll') return p;
  }
  return null;
}

/** A sheet list's last line. It rises in as it scrolls into view, the check
    popping a beat after, and resets when it leaves, so every arrival at
    the bottom plays it again. */
export function SheetEnd({ children }: { children: ReactNode }) {
  const slot = useRef<HTMLDivElement | null>(null);
  // Shown only when the list overflows their scroller; the line's own
  // height is left out of that sum, so it never shows just to scroll to
  // itself.
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = slot.current;
    const scroller = el && scrollParent(el);
    if (!el || !scroller) return;
    const measure = () =>
      setOverflows(
        scroller.scrollHeight - el.offsetHeight > scroller.clientHeight + 1
      );
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(scroller);
      for (const child of scroller.children) sizes.observe(child);
    };
    const children = new MutationObserver(watch);
    children.observe(scroller, { childList: true });
    watch();
    measure();
    return () => {
      sizes.disconnect();
      children.disconnect();
    };
  }, []);
  return (
    <div ref={slot}>
      {overflows && (
        <LazyMotion features={domAnimation}>
          <MotionConfig reducedMotion="user">
            <m.div
              className="tui-sheet-end"
              initial="away"
              whileInView="here"
              viewport={{ amount: 0.8 }}
              variants={{
                away: { opacity: 0, y: 14 },
                here: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
                },
              }}
            >
              <m.span
                className="tui-sheet-end-icon"
                aria-hidden
                variants={{
                  away: { scale: 0.4, opacity: 0 },
                  here: {
                    scale: 1,
                    opacity: 1,
                    transition: {
                      type: 'spring',
                      stiffness: 520,
                      damping: 18,
                      delay: 0.12,
                    },
                  },
                }}
              >
                <CheckCheck size={18} />
              </m.span>
              <p>{children}</p>
            </m.div>
          </MotionConfig>
        </LazyMotion>
      )}
    </div>
  );
}
