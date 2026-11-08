/** Chat's mark for the top bar: the favicon's bubble on a tile in a light step
    of the app's hue, so it follows the bar and the viewer's pick. The bubble
    keeps the iconset's ink. */
export function AppMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      <rect width="64" height="64" rx="14.4" fill="var(--tk-app-mark)" />
      <g transform="translate(7.8 11.25) scale(2)" fill="#1d1830">
        <path d="M6.5 2h11A4.5 4.5 0 0 1 22 6.5v5a4.5 4.5 0 0 1-4.5 4.5H13l-8.5 6.5L6 16a4.5 4.5 0 0 1-4-4.5v-5A4.5 4.5 0 0 1 6.5 2z" />
      </g>
    </svg>
  );
}
