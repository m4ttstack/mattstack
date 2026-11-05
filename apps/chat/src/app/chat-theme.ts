import { createTheme, HoverCard, Menu, Popover } from '@mattstack/app-kit/core';

import menu from './menu.module.css';

/**
 * Chat's theme. Its type ladder is the only one it has: Four text steps plus a
 * heading step, each a whole pixel or more apart:
 *
 * | step | px | carries                                                  |
 * |------|----|----------------------------------------------------------|
 * | xs   | 12 | meta: agent rows, DM names, chips, badges, counts, labels |
 * | sm   | 13 | chrome: room names, buttons, inputs, menu items           |
 * | md   | 14 | titles                                                    |
 * | lg   | 15 | message prose                                             |
 * | xl   | 20 | headings                                                  |
 *
 * Merged at the ROOT provider, not through `ThemeOverrideWrapper`. A scoped
 * override emits its variables on a wrapper element, so portalled content
 * (menus, tooltips, modals, the composer's dropdown) fell through to tokyo's
 * own 10.56/11.2/12.16 ladder and `size="xs"` meant two different sizes
 * depending on whether the element was portalled. At the root there is one
 * answer for both.
 */
export const chatTheme = createTheme({
  // The mock's corners: rows and menus 6, code blocks 8, the message box 12.
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  defaultRadius: 'md',
  // Slack's floating surfaces: the frame's hairline under one soft shadow.
  shadows: { md: '0 4px 16px rgb(0 0 0 / 14%)' },
  // Inter, not the suite's system stack: at chat's 12 to 14px SF renders too
  // light for reading long posts on the soft page background.
  fontFamily: "'Inter Variable', -apple-system, 'Segoe UI', sans-serif",
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
  fontSizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    md: '0.875rem',
    lg: '0.9375rem',
    xl: '1.25rem',
  },
});
