import { flushSync } from 'react-dom';

import { postedText } from './respond-post.ts';

/** Runs a reset that also returns its field to Write, then focuses the
    field's text area, which Preview had unmounted. */
function resetToWrite(button: HTMLElement, scope: string, reset: () => void) {
  const part = button.closest(scope);
  flushSync(reset);
  part?.querySelector('textarea')?.focus();
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

export { resetToWrite, CommentFrame, commentState };
