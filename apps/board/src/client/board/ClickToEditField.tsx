import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  MotionConfig,
} from 'motion/react';

import { sourceOffset } from './caret-map.ts';
import { CommentMarkdown } from './CommentMarkdown.tsx';
import { CheckGlyph, PencilLineIcon } from './icons.tsx';

const FLASH_MS = 1600;
const FADE_MS = 150;

type CaretDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAtPoint(x: number, y: number) {
  const doc = document as CaretDocument;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = doc.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** The click's offset in the rendered text of `root`, or its end when the
    click missed the text. */
function renderedOffset(root: HTMLElement, x: number, y: number): number {
  const all = root.textContent ?? '';
  const hit = caretAtPoint(x, y);
  if (!hit || hit.node.nodeType !== Node.TEXT_NODE || !root.contains(hit.node))
    return all.length;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n === hit.node) return total + hit.offset;
    total += n.textContent?.length ?? 0;
  }
  return all.length;
}

const SWAP = { duration: 0.15, ease: [0.4, 0, 0.2, 1] as const };
const STILL = { duration: 0 };

/** Each face fades over the other; the leaving one is popped out of flow
    and stops taking clicks, so the box sizes to the face arriving. */
const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, pointerEvents: 'none' as const },
  transition: SWAP,
};

function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

/** A comment that reads rendered and edits raw. A click on the text opens
    the Markdown with the caret where you clicked; Tab onto it opens it with
    the caret at the end. Leaving the field renders it again; Escape does
    too and keeps focus on it, so a second Escape reaches the sheet. A click
    on a link follows the link, and a drag that selects text stays put. */
export function ClickToEditField({
  label,
  text,
  variant = 'boxed',
  stripe,
  hint = true,
  readOnly = false,
  invalid = false,
  describedBy,
  onChange,
  onEditing,
  heading,
  actions,
}: {
  label: string;
  text: string;
  variant?: 'boxed' | 'bare' | 'filled' | 'plain';
  stripe?: 'always' | 'focus';
  hint?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (text: string) => void;
  onEditing?: (editing: boolean) => void;
  /** Names the mode while writing, e.g. "Editing comment". */
  heading?: string;
  /** Controls on the header's right, such as a reset. */
  actions?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const view = useRef<HTMLDivElement | null>(null);
  const caret = useRef<number | null>(null);
  const pressed = useRef(false);
  const refocus = useRef(false);
  const faces = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  // The box eases across a swap and at rest (a reset changing the text);
  // a line typed in Write grows it at once, so the caret's line is never
  // clipped mid-ease.
  const [swapping, setSwapping] = useState(false);
  // Closing on a changed text flashes "Comment updated" in the pill, then
  // fades it; the label holds through the fade so it never swaps mid-ease.
  const openedWith = useRef(text);
  const [flash, setFlash] = useState<'shown' | 'fading' | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const id = window.setTimeout(
      () => setFlash(flash === 'shown' ? 'fading' : null),
      flash === 'shown' ? FLASH_MS : FADE_MS
    );
    return () => window.clearTimeout(id);
  }, [flash]);

  useLayoutEffect(() => {
    const el = faces.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const open = (at: number) => {
    openedWith.current = text;
    setFlash(null);
    caret.current = at;
    setSwapping(true);
    setEditing(true);
    onEditing?.(true);
  };
  const close = (keepFocus: boolean) => {
    refocus.current = keepFocus;
    if (text !== openedWith.current) setFlash('shown');
    setSwapping(true);
    setEditing(false);
    onEditing?.(false);
  };

  useLayoutEffect(() => {
    if (editing) {
      const el = area.current;
      if (!el) return;
      grow(el);
      if (caret.current !== null) {
        el.focus({ preventScroll: true });
        el.setSelectionRange(caret.current, caret.current);
        caret.current = null;
      }
    } else if (refocus.current) {
      view.current?.focus({ preventScroll: true });
    }
  }, [editing, text]);

  const onViewClick = (e: MouseEvent<HTMLDivElement>) => {
    pressed.current = false;
    if (readOnly) return;
    if ((e.target as HTMLElement).closest('a')) return;
    const picked = window.getSelection();
    if (
      picked &&
      !picked.isCollapsed &&
      e.currentTarget.contains(picked.anchorNode)
    )
      return;
    const at = renderedOffset(e.currentTarget, e.clientX, e.clientY);
    open(sourceOffset(text, e.currentTarget.textContent ?? '', at));
  };

  const onViewFocus = () => {
    if (refocus.current) {
      refocus.current = false;
      return;
    }
    if (pressed.current || readOnly) return;
    open(text.length);
  };

  const onAreaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey)
      return;
    e.preventDefault();
    e.stopPropagation();
    if (document.execCommand?.('insertText', false, '  ')) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    caret.current = start + 2;
    onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
  };

  const showHeading = editing && !!heading;
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <div className="tui-cte-stack">
          <AnimatePresence initial={false}>
            {(showHeading || actions) && (
              <m.div
                key="head"
                className="tui-cte-head"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SWAP}
              >
                <div className="tui-cte-head-row">
                  <span className="tui-cte-heading">
                    {showHeading && (
                      <>
                        <PencilLineIcon />
                        {heading}
                      </>
                    )}
                  </span>
                  {actions}
                </div>
              </m.div>
            )}
          </AnimatePresence>
          <div className="tui-cte-wrap">
            <m.div
              className="tui-cte"
              data-variant={variant}
              data-stripe={stripe}
              data-editing={editing || undefined}
              data-invalid={invalid || undefined}
              initial={false}
              animate={{ height }}
              transition={swapping || !editing ? SWAP : STILL}
              onAnimationComplete={() => setSwapping(false)}
            >
              <div ref={faces} className="tui-cte-faces">
                <AnimatePresence mode="popLayout" initial={false}>
                  {editing ? (
                    <m.div key="write" {...FADE}>
                      <textarea
                        ref={area}
                        className="tui-composer-input tui-cte-input"
                        rows={1}
                        value={text}
                        aria-label={label}
                        aria-invalid={invalid || undefined}
                        aria-describedby={describedBy}
                        onChange={e => onChange(e.currentTarget.value)}
                        onKeyDown={onAreaKeyDown}
                        onBlur={() => {
                          // Escape's close moves focus to the view, which blurs
                          // this still-mounted area; that blur must not undo it.
                          if (!refocus.current) close(false);
                        }}
                      />
                    </m.div>
                  ) : (
                    <m.div key="read" {...FADE}>
                      <div
                        ref={view}
                        className="tui-cte-view"
                        role="textbox"
                        aria-multiline="true"
                        aria-readonly={readOnly || undefined}
                        aria-label={label}
                        aria-invalid={invalid || undefined}
                        aria-describedby={describedBy}
                        tabIndex={readOnly ? undefined : 0}
                        onMouseDown={() => {
                          pressed.current = true;
                        }}
                        onFocus={onViewFocus}
                        onClick={onViewClick}
                      >
                        {text.trim() === '' ? (
                          <p className="tui-field-preview-empty">
                            Empty comment
                          </p>
                        ) : (
                          <CommentMarkdown>{text}</CommentMarkdown>
                        )}
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>
              </div>
            </m.div>
            {hint && (editing || variant === 'plain') && (
              // At rest, plain's hint is the hover "Click to edit" pill; the
              // textbox already says it edits, so the pill stays out of the
              // accessibility tree.
              <span
                // A fresh node per mode: the rest pill must start hidden, not
                // fade out from Write's fully shown row.
                key={editing ? 'write' : 'rest'}
                className="tui-cte-hint"
                aria-hidden={!editing || undefined}
                data-flash={editing ? undefined : (flash ?? undefined)}
              >
                {editing ? (
                  <>
                    <span>Markdown supported</span>
                    <span>esc to finish</span>
                  </>
                ) : flash ? (
                  <>
                    <CheckGlyph />
                    Comment updated
                  </>
                ) : (
                  <>
                    <PencilLineIcon />
                    Click to edit
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
