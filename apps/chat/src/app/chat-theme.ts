import { createTheme, HoverCard, Menu, Popover } from '@mattstack/app-kit/core';

import menu from './menu.module.css';

/**
 * Chat's theme: what the kit does not carry yet. The type ladder, Inter,
 * radii and the soft float shadow are tokyo's.
 *
 * Merged at the ROOT provider, not through `ThemeOverrideWrapper`, so
 * portalled content (menus, tooltips, modals) reads the same values as the
 * page.
 */
export const chatTheme = createTheme({
  components: {
    Popover: Popover.extend({ defaultProps: { radius: 'sm' } }),
    HoverCard: HoverCard.extend({ defaultProps: { radius: 'sm' } }),
    Menu: Menu.extend({
      classNames: {
        dropdown: menu.menuDropdown,
        item: menu.menuItem,
        itemSection: menu.menuItemSection,
        label: menu.menuLabel,
        divider: menu.menuDivider,
      },
    }),
  },
});
