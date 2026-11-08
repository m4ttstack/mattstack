/** Boxscore's mark for the top bar: the favicon's bar chart on a tile in a
    light step of the app's hue, so it follows the bar and the viewer's pick.
    The bars keep the iconset's ink. */
export function AppMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      <rect width="32" height="32" rx="7.2" fill="var(--tk-app-mark)" />
      <g fill="#1d1830">
        <rect x="9.4" y="16" width="3.6" height="7" rx="1" />
        <rect x="14.2" y="12" width="3.6" height="11" rx="1" />
        <rect x="19" y="9" width="3.6" height="14" rx="1" />
      </g>
    </svg>
  );
}
