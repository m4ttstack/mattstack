import { useEffect, useState } from 'react';

/** Matches the wash's fade in style.css. */
const SPOT_FADE_MS = 150;

/** Where an MR's row sits on screen, followed through scrolls and resizes. */
function useRowRect(mrUrl: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!mrUrl) {
      setRect(null);
      return;
    }
    const measure = () => {
      const row = document.querySelector(
        `.tui-row[data-mr-url="${CSS.escape(mrUrl)}"]`
      );
      setRect(row ? row.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
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
  const [shown, setShown] = useState<string | null>(
    open && mrUrl ? mrUrl : null
  );
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open && mrUrl) {
      setShown(mrUrl);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, SPOT_FADE_MS);
    return () => clearTimeout(t);
  }, [open, mrUrl]);
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
