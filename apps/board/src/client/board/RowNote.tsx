import { useEffect, useState } from 'react';

import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { ago } from './format.ts';
import { LinkGlyph } from './icons.tsx';
import { mrRef } from './MrLinks.tsx';
import { splitNoteLinks } from './note-links.ts';

const STALE_AFTER_MS = 7 * 24 * 3600_000;

/** The row's last line (B10): a line the seat wrote to its future self.
    One line of words ending in when it was written, its links by host on a
    line below; under the pointer edit and clear take the age's place.
    Editing turns the same line into a field. */
export function RowNote({
  mr,
  ctx,
  editing,
  now,
}: {
  mr: BoardMRWithReview;
  ctx: RowContext;
  editing: boolean;
  now: number;
}) {
  const note = mr.note ?? '';
  const [text, setText] = useState(note);
  // A reload while the box is open must not overwrite what is being typed,
  // so the draft only re-seeds when the editor opens (or the row changes).
  useEffect(() => {
    if (editing) setText(note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mr.webUrl]);
  const ref = useAutoGrowTextarea([editing, text]);
  // The tool and the menu item both mean "write the note now", so the caret
  // lands in the box, after the text.
  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing, ref]);

  const open = () => ctx.onEditNote(mr.webUrl ?? null);
  // Saving the text unchanged only closes the editor, so reading a long
  // note in the editor does not reset when it was written.
  const save = () =>
    text.trim() === note.trim()
      ? ctx.onEditNote(null)
      : ctx.onSaveNote(mr, text);
  const clears = !!note.trim() && !text.trim();

  if (editing)
    return (
      // The row opens the MR on a click; none inside the note reaches it.
      <div
        className="tui-row-note"
        data-editing="true"
        onClick={e => e.stopPropagation()}
      >
        <div className="tui-row-note-field">
          <textarea
            ref={ref}
            className="tui-row-note-input"
            rows={1}
            value={text}
            placeholder="a note for yourself…"
            maxLength={2000}
            aria-label={`note on ${mrRef(mr)}`}
            title="↵ saves · ⇧↵ new line · esc cancels"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                ctx.onEditNote(null);
              }
            }}
            onChange={e => setText(e.currentTarget.value)}
          />
          <button
            type="button"
            className="tui-row-note-save"
            data-clear={clears ? 'true' : undefined}
            onClick={save}
          >
            {clears ? 'clear note' : 'save'}
            <span className="tui-key-cap" data-keys="↵" aria-hidden />
          </button>
        </div>
      </div>
    );

  const { prose, links } = splitNoteLinks(note);
  const at = mr.noteAt ? Date.parse(mr.noteAt) : NaN;
  const stale = now - at > STALE_AFTER_MS;
  return (
    // The row opens the MR on a click; anywhere in the note opens the
    // editor instead.
    <div
      className="tui-row-note"
      onClick={e => {
        e.stopPropagation();
        open();
      }}
    >
      <div className="tui-row-note-line">
        <span className="tui-row-note-text" title={note}>
          {prose}
        </span>
        {!Number.isNaN(at) && (
          <span
            className="tui-row-note-age"
            data-stale={stale ? 'true' : undefined}
            title={`saved ${new Date(at).toLocaleString()}`}
          >
            noted {ago(mr.noteAt!, now)}
            {stale ? ' ago' : ''}
          </span>
        )}
        <span className="tui-row-note-verbs">
          <button
            type="button"
            className="tui-status-verb tui-row-note-verb"
            data-tone="accent"
            onClick={e => {
              e.stopPropagation();
              open();
            }}
          >
            edit
          </button>
          <button
            type="button"
            className="tui-status-verb tui-row-note-verb"
            onClick={e => {
              e.stopPropagation();
              ctx.onSaveNote(mr, '');
            }}
          >
            clear
          </button>
        </span>
      </div>
      {links.length > 0 && (
        <div className="tui-row-note-links">
          {links.map(link => (
            <a
              key={link.url}
              className="tui-row-note-link"
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={link.url}
              aria-label={`${link.host}: ${link.url}`}
              onClick={e => e.stopPropagation()}
            >
              <LinkGlyph />
              <span className="tui-row-note-link-host">{link.host}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
