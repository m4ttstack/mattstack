import {
  MARK_INK,
  MARK_STROKE,
  markPaths,
  markTile,
  type AppName,
} from './marks';

/** An app's mark inline. Inside a MattstackShell the tile follows the bar's
    hue (`--tk-app-mark`), so the viewer's palette pick recolours it; anywhere
    else it is the app's own colour. */
export function AppMark({ app, size = 26 }: { app: AppName; size?: number }) {
  const { shapes, lines } = markPaths(app);
  const stroke = {
    stroke: MARK_INK,
    strokeWidth: MARK_STROKE,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      <rect
        width="32"
        height="32"
        rx="7.2"
        fill={`var(--tk-app-mark, ${markTile(app)})`}
      />
      {shapes ? <path d={shapes} fill={MARK_INK} {...stroke} /> : null}
      {lines ? <path d={lines} fill="none" {...stroke} /> : null}
    </svg>
  );
}
