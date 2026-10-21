import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

import { Markdown } from '@mattstack/tui-kit';
import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import { postedText } from './respond-post.ts';

type FieldMode = 'write' | 'preview';

/** The selected tab of the Write/Preview pair nearest `el`: the field's own,
    found by walking out to the first ancestor that holds a tab list. */
function fieldTab(el: HTMLElement): HTMLElement | null {
  for (
    let at: HTMLElement | null = el.parentElement;
    at && at.getAttribute('role') !== 'dialog';
    at = at.parentElement
  ) {
    const tab = at.querySelector<HTMLElement>(
      '[role="tablist"] [role="tab"][aria-selected="true"]'
    );
    if (tab) return tab;
  }
  return null;
}

/** Runs a reset that also returns its field to Write, then focuses the
    field's text area, which Preview had unmounted. */
function resetToWrite(button: HTMLElement, scope: string, reset: () => void) {
  const part = button.closest(scope);
  flushSync(reset);
  part?.querySelector('textarea')?.focus();
}

/** Write and Preview over one comment field. */
function FieldTabs({
  label,
  mode,
  onMode,
}: {
  label: string;
  mode: FieldMode;
  onMode: (mode: FieldMode) => void;
}) {
  return (
    <span
      className="tui-field-tabs"
      role="tablist"
      aria-label={`${label}: view`}
    >
      {(['write', 'preview'] as const).map(m => (
        <button
          key={m}
          type="button"
          role="tab"
          className="tui-field-tab"
          aria-selected={mode === m}
          onClick={() => onMode(m)}
        >
          {m === 'write' ? 'Write' : 'Preview'}
        </button>
      ))}
    </span>
  );
}

/** A comment's text: an auto-growing text area in Write, the same text
    rendered as Markdown in Preview. In Write, Tab indents by two spaces;
    Shift-Tab and Escape still leave the field. */
function CommentField({
  label,
  text,
  mode,
  readOnly = false,
  invalid = false,
  describedBy,
  onChange,
}: {
  label: string;
  text: string;
  mode: FieldMode;
  readOnly?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (text: string) => void;
}) {
  const ref = useAutoGrowTextarea([text, mode]);
  const caret = useRef<number | null>(null);
  // The last height the text area grew to, so Preview opens at the same
  // size instead of jumping the card.
  const height = useRef<number | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.offsetHeight > 0)
      height.current = ref.current.offsetHeight;
  });
  // The grow hook measures once per text; a width change (the sheet
  // settling, a late web font) rewraps the text, so it measures again.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const regrow = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      regrow();
    });
    observer.observe(el);
    void document.fonts?.ready.then(regrow);
    return () => observer.disconnect();
  }, [ref, mode]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current === null || !el) return;
    el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text, ref]);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === 'Escape') {
      // The first Escape only leaves the field, landing on its own Write
      // tab so the keyboard carries on from here: a blur would drop focus
      // to the body, outside the sheet's Tab trap. The sheet's own Escape
      // closes it on the next press.
      e.stopPropagation();
      (fieldTab(el) ?? el.closest<HTMLElement>('[role="dialog"]'))?.focus();
      return;
    }
    if (
      e.key !== 'Tab' ||
      e.shiftKey ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      readOnly
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    // insertText keeps the browser's undo history; a DOM without it gets
    // the spaces spliced in by hand.
    if (document.execCommand?.('insertText', false, '  ')) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    caret.current = start + 2;
    onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
  };
  if (mode === 'preview')
    return (
      <div
        className="tui-field-preview"
        role="tabpanel"
        aria-label={`${label}: preview`}
        style={
          height.current !== null
            ? ({ '--field-h': `${height.current}px` } as CSSProperties)
            : undefined
        }
      >
        {text.trim() === '' ? (
          <p className="tui-field-preview-empty">Nothing to preview</p>
        ) : (
          <Markdown linkTargetBlank>{text}</Markdown>
        )}
      </div>
    );
  return (
    <textarea
      ref={ref}
      className="tui-composer-input"
      rows={1}
      value={text}
      readOnly={readOnly}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={e => onChange(e.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  );
}

/** The edit state of one comment: what the field shows, whether it differs
    from the draft as it would post, and whether it is blank. */
function commentState(
  draft: string,
  value: string | undefined,
  canEdit: boolean
) {
  const text = canEdit ? (value ?? draft) : draft;
  const edited =
    canEdit && value !== undefined && postedText(value) !== postedText(draft);
  const empty = canEdit && value !== undefined && value.trim() === '';
  return { text, edited, empty };
}

/** A strip's location: a diff line in mono, else a plain name such as
    "Overview comment". */
function StripWhere({ where }: { where: string }) {
  return (
    <span
      className="tui-composer-where"
      data-mono={/:\d+$/.test(where) || undefined}
    >
      {where}
    </span>
  );
}

/** A comment or reply that posts under the developer's name, framed as one
    card: a strip saying where it posts over an always-editable field, and
    a footer with the card's own controls and the Write and Preview tabs.
    `value` is the edit, absent when there is none, and `reset` drops it.
    `canEdit` false shows the draft read-only under a grey strip, for a
    reply this gate will not post. `where` names the thread in the strip
    in place of `kicker`; `status` sits beside it. */
/** The strip names either the thread (`where`, with an optional `status`)
    or what the text posts as (`kicker`); one of the two, never neither. */
type StripLead =
  | { where: string; status?: ReactNode; kicker?: string }
  | { where?: undefined; status?: undefined; kicker: string };

function CommentComposer({
  label,
  kicker,
  heldKicker,
  heldMeta,
  where,
  status,
  noun,
  draft,
  value,
  canEdit = true,
  onChange,
  onReset,
  onRemove,
  controls,
}: StripLead & {
  label: string;
  heldKicker?: string;
  heldMeta?: string;
  noun: 'reply' | 'comment';
  draft: string;
  value: string | undefined;
  canEdit?: boolean;
  onChange: (text: string) => void;
  onReset: () => void;
  onRemove?: () => void;
  controls?: ReactNode;
}) {
  const { text, edited, empty } = commentState(draft, value, canEdit);
  const [mode, setMode] = useState<FieldMode>('write');
  const emptyHint = useId();
  const kickerId = useId();
  return (
    <div className="tui-composer-wrap">
      <div
        className="tui-composer"
        data-held={canEdit ? undefined : ''}
        data-edited={edited ? '' : undefined}
      >
        <div className="tui-composer-strip">
          {where !== undefined ? (
            <span className="tui-composer-lead" id={kickerId}>
              <StripWhere where={where} />
              {status}
            </span>
          ) : (
            <span className="tui-composer-k" id={kickerId}>
              {canEdit ? kicker : (heldKicker ?? kicker)}
            </span>
          )}
          {canEdit ? (
            <span className="tui-composer-meta">
              {edited ? (
                <>
                  <span className="tui-composer-edited">edited</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    className="tui-composer-act"
                    aria-label={`${label}: reset to draft`}
                    onClick={e =>
                      resetToWrite(e.currentTarget, '.tui-composer', () => {
                        onReset();
                        setMode('write');
                      })
                    }
                  >
                    reset
                  </button>
                </>
              ) : (
                <span>posts as you</span>
              )}
              {onRemove && (
                <button
                  type="button"
                  className="tui-composer-act"
                  aria-label={`${label}: remove`}
                  onClick={onRemove}
                >
                  × remove
                </button>
              )}
            </span>
          ) : (
            heldMeta && (
              <span className="tui-composer-meta" id={`${kickerId}-meta`}>
                {heldMeta}
              </span>
            )
          )}
        </div>
        <CommentField
          label={label}
          text={text}
          mode={mode}
          readOnly={!canEdit}
          invalid={empty}
          describedBy={
            !canEdit
              ? [kickerId, heldMeta ? `${kickerId}-meta` : null]
                  .filter(Boolean)
                  .join(' ')
              : empty
                ? emptyHint
                : undefined
          }
          onChange={onChange}
        />
        <div className="tui-composer-foot">
          {controls}
          <FieldTabs label={label} mode={mode} onMode={setMode} />
        </div>
      </div>
      {empty && (
        <span className="tui-gate-error" id={emptyHint}>
          the {noun} is empty
        </span>
      )}
    </div>
  );
}

/** A reply that posts as it stands, in the composer's frame: read-only
    text under the strip. `held` mutes it, for a reply direction or a reply
    that only carries intent. */
function CommentFrame({
  kicker,
  meta,
  held = false,
  edited = false,
  kind,
  text,
}: {
  kicker: string;
  meta?: string;
  held?: boolean;
  edited?: boolean;
  kind?: string;
  text: string;
}) {
  return (
    <div
      className="tui-composer"
      data-held={held ? '' : undefined}
      data-edited={edited ? '' : undefined}
      data-kind={kind}
    >
      <div className="tui-composer-strip">
        <span className="tui-composer-k">{kicker}</span>
        {meta && <span className="tui-composer-meta">{meta}</span>}
      </div>
      <div className="tui-composer-text">{text}</div>
    </div>
  );
}

export {
  resetToWrite,
  CommentComposer,
  CommentField,
  CommentFrame,
  FieldTabs,
  commentState,
  type FieldMode,
};
