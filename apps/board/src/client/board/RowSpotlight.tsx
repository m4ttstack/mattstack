import { useEffect, useState } from 'react';

import { useLingering } from './use-lingering.ts';

type Box = Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>;

const sameBox = (a: Box | null | undefined, b: Box | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height);

/** Where an MR's row sits on screen. Any DOM change on the page, a resize
    of the row itself, a scroll or a window resize re-measures it, batched
    to one read per frame, so the box follows rows that are inserted,
    re-sorted, replaced or grown underneath it. */
function useRowRect(mrUrl: string | null): Box | null {
  const [rect, setRect] = useState<Box | null>(null);
  useEffect(() => {
    if (!mrUrl) {
      setRect(null);
      return;
    }
    const selector = `.tui-row[data-mr-url="${CSS.escape(mrUrl)}"]`;
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => schedule());
    let row: Element | null = null;
    let last: Box | null | undefined;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const next = document.querySelector(selector);
      if (next !== row) {
        if (row) resize?.unobserve(row);
        if (next) resize?.observe(next);
        row = next;
      }
      const r = row?.getBoundingClientRect();
      // A row under a display:none ancestor measures all zeros; a spot
      // there would wash the whole board with no hole.
      const box =
        r && (r.width || r.height)
          ? { top: r.top, left: r.left, width: r.width, height: r.height }
          : null;
      // Same numbers set no state, so the spot's own style write never
      // feeds back into another render.
      if (sameBox(last, box)) return;
      last = box;
      setRect(box);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [mrUrl]);
  return rect;
}

/** A light wash over the board with the drawer's own row left bright, so a
    drawer stays tied to the MR it belongs to. It outlives the drawer by its
    fade, so render it beside the drawer's condition, never inside it, and
    give the drawer's panel `tui-spotlit` to clear the drawer's own wash. */
export function RowSpotlight({
  mrUrl,
  open,
}: {
  mrUrl: string | null | undefined;
  open: boolean;
}) {
  const { shown, leaving } = useLingering(open && mrUrl ? mrUrl : null);
  const rect = useRowRect(shown);
  if (!rect) return null;
  return (
    <div
      className="tui-row-spot"
      data-leaving={leaving ? 'true' : undefined}
      aria-hidden
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
