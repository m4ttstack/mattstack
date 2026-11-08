/** Console's mark for the top bar: the favicon's prompt glyph on a tile in a
    light step of the app's hue, so it follows the bar and the viewer's pick.
    The glyph keeps the iconset's ink. */
export function AppMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      <rect width="32" height="32" rx="7.2" fill="var(--tk-app-mark)" />
      <path
        d="M10.5 10.5 L16 16 L10.5 21.5"
        stroke="#1d1830"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 21.5 L22.5 21.5"
        stroke="#1d1830"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
