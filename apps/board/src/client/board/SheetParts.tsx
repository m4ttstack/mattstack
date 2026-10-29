import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { CheckCheck, Sun } from 'lucide-react';
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

/** A review or respond sheet's sticky band: what the gate asks of you on
    the left, where it sits in the review loop at the right edge. */
function SheetHeading({
  icon,
  title,
  aside,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="tui-sheet-round">
      <h2 className="tui-sheet-round-n">
        {icon}
        {title}
      </h2>
      {aside && <div className="tui-sheet-round-aside">{aside}</div>}
    </div>
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
  SheetHeading,
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

/** A sheet list's last line, shown only once the list scrolls. */
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
        <SheetMarker icon={<CheckCheck size={18} />}>{children}</SheetMarker>
      )}
    </div>
  );
}

/** Stands in for an empty sheet list, in the end line's look. */
export function SheetEmpty({ children }: { children: ReactNode }) {
  return <SheetMarker icon={<Sun size={18} />}>{children}</SheetMarker>;
}

/** Rises in as it scrolls into view, the icon popping a beat after, and
    resets when it leaves, so every arrival plays it again. */
function SheetMarker({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
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
            {icon}
          </m.span>
          <p>{children}</p>
        </m.div>
      </MotionConfig>
    </LazyMotion>
  );
}
