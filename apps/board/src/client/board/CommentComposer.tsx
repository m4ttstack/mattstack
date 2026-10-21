import { useId, type ReactNode } from 'react';

import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';

/** A comment or reply that posts under the developer's name, framed like a
    small composer: a strip saying where it posts over an always-editable
    text area. `value` is the edit, absent when there is none, and `reset`
    drops it. `canEdit` false shows the draft read-only under `heldKicker`,
    for a reply this gate will not post. `onRemove`, when given, puts a
    remove button in the strip. `controls` sit under the frame. */
function CommentComposer({
  label,
  kicker,
  heldKicker,
  noun,
  draft,
  value,
  canEdit = true,
  onChange,
  onReset,
  onRemove,
  controls,
}: {
  label: string;
  kicker: string;
  heldKicker?: string;
  noun: 'reply' | 'comment';
  draft: string;
  value: string | undefined;
  canEdit?: boolean;
  onChange: (text: string) => void;
  onReset: () => void;
  onRemove?: () => void;
  controls?: ReactNode;
}) {
  const text = canEdit ? (value ?? draft) : draft;
  const edited =
    canEdit && value !== undefined && value.trim() !== draft.trim();
  const empty = canEdit && value !== undefined && value.trim() === '';
  const ref = useAutoGrowTextarea([text]);
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
          <span className="tui-composer-k" id={kickerId}>
            {canEdit ? kicker : (heldKicker ?? kicker)}
          </span>
          {canEdit && (
            <span className="tui-composer-meta">
              {edited ? (
                <>
                  <span>edited</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    className="tui-composer-act"
                    aria-label={`${label}: reset to draft`}
                    onClick={() => {
                      onReset();
                      ref.current?.focus();
                    }}
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
          )}
        </div>
        <textarea
          ref={ref}
          className="tui-composer-input"
          rows={1}
          value={text}
          readOnly={!canEdit}
          aria-label={label}
          aria-invalid={empty || undefined}
          aria-describedby={!canEdit ? kickerId : empty ? emptyHint : undefined}
          onChange={e => onChange(e.currentTarget.value)}
          onKeyDown={e => {
            // The first Escape only leaves the field, for the sheet itself:
            // a blur would drop focus to the body, outside the sheet's Tab
            // trap. The sheet's own Escape closes it on the next press.
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
          }}
        />
      </div>
      {empty && (
        <span className="tui-gate-error" id={emptyHint}>
          the {noun} is empty
        </span>
      )}
      {controls && <div className="tui-composer-foot">{controls}</div>}
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

export { CommentComposer, CommentFrame };
