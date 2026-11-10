import { useEffect, useState } from 'react';

/** Where an MR's row sits on screen, followed through scrolls and resizes. */
function useRowRect(mrUrl: string | null | undefined): DOMRect | null {
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
    drawer stays tied to the MR it belongs to. Render it just before the
    drawer and give the drawer's panel `tui-spotlit`, which clears the
    drawer's own wash and blur. */
export function RowSpotlight({ mrUrl }: { mrUrl: string | null | undefined }) {
  const rect = useRowRect(mrUrl);
  if (!rect) return null;
  return (
    <div
      className="tui-row-spot"
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
