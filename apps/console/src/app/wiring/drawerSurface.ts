import { useSchemeColors } from '@mattstack/app-kit/hooks';

/**
 * The panel surface both of this surface's drawers are drawn on.
 *
 * Mantine paints a drawer with `--mantine-color-body` -- the PAGE colour --
 * and `tokyo-theme.css` documents why the theme cannot repoint that token
 * without repainting every Modal, Popover and Drawer in the app. The
 * artboards put the drawer on the panel surface instead, so it is set here,
 * per component, where it is a local decision rather than a theme change.
 *
 * Shared rather than copied: two drawers on one surface sitting on two
 * different colours is a worse defect than either colour alone.
 */
export function useDrawerSurface() {
  const { bg } = useSchemeColors();
  const surface = { background: bg.level2 };
  // The kit border role itself: Mantine's default-border token, which the
  // theme points at it, is reset a step lighter by Mantine's dark scheme.
  const rule = '1px solid var(--tk-border)';

  return {
    content: { ...surface, borderLeft: rule },
    header: { ...surface, borderBottom: rule },
  };
}
