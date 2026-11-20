import { useEffect, useLayoutEffect, useRef } from 'react';

const SVG = 'http://www.w3.org/2000/svg';
/** After a chip that ends the message: WebKit puts no caret after a
    non-editable inline at the end of a block without it. */
const CARET_ROOM = '\u200B';
const LINK_GLYPH = 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8';

/** The kit Icon's geometry, built by hand: the chip lives in a
    contenteditable that React does not render into. */
function linkGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    width: '12',
    height: '12',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, v);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', LINK_GLYPH);
  svg.append(path);
  return svg;
}

function chip(label: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'tui-owners-link';
  el.contentEditable = 'false';
  el.dataset.link = '';
  el.append(linkGlyph(), label);
  return el;
}

function touchesChip(range: AbstractRange, el: HTMLElement): boolean {
  const live = document.createRange();
  live.setStart(range.startContainer, range.startOffset);
  live.setEnd(range.endContainer, range.endOffset);
  return [...el.querySelectorAll('.tui-owners-link')].some(chip => {
    const around = document.createRange();
    around.selectNode(chip);
    return (
      live.compareBoundaryPoints(Range.START_TO_END, around) > 0 &&
      live.compareBoundaryPoints(Range.END_TO_START, around) < 0
    );
  });
}

/** The ranges an input would change: the browser's own when it says, else
    the selection, widened one step for a delete from a caret. */
function changedRanges(e: InputEvent, el: HTMLElement): AbstractRange[] {
  const given = e.getTargetRanges?.() ?? [];
  if (given.length) return given;
  const sel = getSelection();
  if (!sel?.rangeCount) return [];
  const range = sel.getRangeAt(0).cloneRange();
  if (range.collapsed && e.inputType.startsWith('delete')) {
    const node = range.startContainer;
    const backward = e.inputType.includes('Backward');
    const sibling =
      node === el
        ? el.childNodes[range.startOffset - (backward ? 1 : 0)]
        : node.nodeType === Node.TEXT_NODE &&
            range.startOffset === (backward ? 0 : node.textContent!.length)
          ? backward
            ? node.previousSibling
            : node.nextSibling
          : null;
    if (sibling) range.selectNode(sibling);
  }
  return [range];
}

const isChip = (node: Node | null): boolean =>
  node instanceof HTMLElement && 'link' in node.dataset;

/** Puts the caret spot back after a chip that now ends the message. */
function keepCaretRoom(el: HTMLElement) {
  const last = el.lastChild;
  if (isChip(last)) el.append(CARET_ROOM);
  else if (
    last?.nodeType === Node.TEXT_NODE &&
    !last.textContent &&
    isChip(last.previousSibling)
  )
    last.textContent = CARET_ROOM;
}

/** The message as Slack gets it: each chip back to the full link, and the
    caret spot (one leading U+200B right after a chip) dropped. */
function readMessage(el: HTMLElement, link: string): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      out +=
        isChip(node.previousSibling) && text.startsWith(CARET_ROOM)
          ? text.slice(CARET_ROOM.length)
          : text;
    } else if (isChip(node)) out += link;
    else if (node.nodeName === 'BR') out += '\n';
    else if (node instanceof HTMLElement) out += readMessage(node, link);
  }
  return out;
}

function drawMessage(
  el: HTMLElement,
  text: string,
  link: string,
  label: string
) {
  const parts = link ? text.split(link) : [text];
  const nodes: Node[] = [];
  parts.forEach((part, i) => {
    if (i > 0) nodes.push(chip(label));
    if (part) nodes.push(document.createTextNode(part));
  });
  el.replaceChildren(...nodes);
  keepCaretRoom(el);
}

/** One channel's message, editable, with the MR link drawn as a chip that
    cannot be deleted: the board finds the post by that link. Plain text in,
    plain text out. */
function OwnerMessageEditor({
  value,
  link,
  linkLabel,
  label,
  disabled,
  onChange,
}: {
  value: string;
  link: string;
  linkLabel: string;
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drawn = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const guard = (e: InputEvent) => {
      if (changedRanges(e, el).some(r => touchesChip(r, el)))
        e.preventDefault();
    };
    el.addEventListener('beforeinput', guard);
    return () => el.removeEventListener('beforeinput', guard);
  }, []);
  useLayoutEffect(() => {
    if (!ref.current || value === drawn.current) return;
    drawMessage(ref.current, value, link, linkLabel);
    drawn.current = value;
  }, [value, link, linkLabel]);
  return (
    <div className="tui-owners-message">
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        className="tui-draft-body tui-owners-message-text"
        contentEditable={disabled ? false : 'plaintext-only'}
        suppressContentEditableWarning
        onInput={e => {
          keepCaretRoom(e.currentTarget);
          const next = readMessage(e.currentTarget, link);
          drawn.current = next;
          onChange(next);
        }}
      />
    </div>
  );
}

export { OwnerMessageEditor, readMessage };
