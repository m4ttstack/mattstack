import { createTheme, virtualColor } from '@mantine/core';

import { ramp } from './ramps';

/**
 * Tokyo Day / Tokyo Night's `MantineThemeOverride` -- the brand values a
 * mantine-kit app merges on top of its own kit-owned `baseTheme` (see the
 * consuming app's `AGENTS.md` section 4 for the three-file theme split this
 * slots into: kit `base-theme.ts`, app `app-theme.ts` re-exporting
 * `tokyoTheme` from here, kit `theme.ts` merging the two). This package
 * ships data only -- no React, no components.
 */
/**
 * Each hue is a PAIR of real ten-shade ramps joined by `virtualColor`, which
 * is what picks between them per color scheme. The concrete `*Day`/`*Night`
 * entries have to be registered as colors in their own right -- `virtualColor`
 * takes color NAMES, not tuples, and resolves them out of this same map.
 *
 * `primaryShade` is where the generated picks put Radix step 9 (index 6 in
 * Day, index 3 in Night); moving either number without regenerating
 * `ramps.ts` re-points every primary surface.
 */
const virtual = (name: string, hue: string) =>
  virtualColor({ name, light: `${hue}Day`, dark: `${hue}Night` });

export const tokyoTheme = /* @__PURE__ */ createTheme({
  primaryColor: 'accent',
  primaryShade: { light: 6, dark: 3 },
  colors: {
    accentDay: ramp('accentDay'),
    accentNight: ramp('accentNight'),
    okDay: ramp('okDay'),
    okNight: ramp('okNight'),
    warnDay: ramp('warnDay'),
    warnNight: ramp('warnNight'),
    badDay: ramp('badDay'),
    badNight: ramp('badNight'),
    purpleDay: ramp('purpleDay'),
    purpleNight: ramp('purpleNight'),
    cyanDay: ramp('cyanDay'),
    cyanNight: ramp('cyanNight'),
    goldDay: ramp('goldDay'),
    goldNight: ramp('goldNight'),

    accent: virtual('accent', 'accent'),
    ok: virtual('ok', 'ok'),
    warn: virtual('warn', 'warn'),
    bad: virtual('bad', 'bad'),
    purple: virtual('purple', 'purple'),
    cyan: virtual('cyan', 'cyan'),
    gold: virtual('gold', 'gold'),
    // Mantine reads `gray` only in light and `dark` only in dark, so neither
    // needs a virtual pair.
    gray: ramp('grayDay'),
    dark: ramp('darkNight'),
    // Mantine built-ins re-pointed, so stray stock-colour usage inside the
    // kit's own components still lands in palette.
    blue: virtual('blue', 'accent'),
    green: virtual('green', 'ok'),
    red: virtual('red', 'bad'),
    yellow: virtual('yellow', 'warn'),
    violet: virtual('violet', 'purple'),
  },
  // Rows and menus 6, controls and code 8, sheets and message boxes 12.
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  defaultRadius: 'md',
  // Four text steps and a heading step, each a whole pixel or more apart:
  // xs 12 meta (counts, chips, badges, labels), sm 13 chrome (buttons,
  // inputs, nav rows), md 14 titles, lg 15 prose, xl 20 headings.
  fontSizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    md: '0.875rem',
    lg: '0.9375rem',
    xl: '1.25rem',
  },
  spacing: {
    xs: '0.3rem',
    sm: '0.45rem',
    md: '0.6rem',
    lg: '0.7rem',
    xl: '0.9rem',
    // The ladder above is tui-kit's dense scale, sized for text rows inside a
    // panel. Bordered surfaces need more room than that before their content
    // stops touching the border: `xxl` is what a row-sized card takes, `xxxl`
    // what a full panel takes.
    xxl: '1.125rem',
    xxxl: '1.5rem',
  },
  lineHeights: { md: '1.55' },
  // UI and headings read in Inter (its faces live in tokyo-theme.css); the
  // monospace slot stays JetBrains Mono for code, tabular numbers, and data
  // tables.
  fontFamily:
    "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontFamilyMonospace:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  headings: {
    fontFamily:
      "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    // h2 is the body ladder's heading step (xl, 20px); one step above it for
    // a page title, and the rest descend through the body sizes.
    sizes: {
      h1: { fontSize: '1.5rem', lineHeight: '1.3', fontWeight: '700' },
      h2: { fontSize: '1.25rem', lineHeight: '1.35', fontWeight: '700' },
      h3: { fontSize: '1.0625rem', lineHeight: '1.4', fontWeight: '700' },
      h4: { fontSize: '0.9375rem', lineHeight: '1.45', fontWeight: '600' },
      h5: { fontSize: '0.875rem', lineHeight: '1.45', fontWeight: '600' },
      h6: { fontSize: '0.8125rem', lineHeight: '1.5', fontWeight: '600' },
    },
  },
  shadows: {
    // Floating surfaces (menus, popovers, cards): the frame's hairline under
    // one soft shadow.
    md: '0 4px 16px rgb(0 0 0 / 14%)',
    lg: '0 12px 40px rgba(0, 0, 0, 0.25)',
    xl: '-6px 0 32px rgba(0, 0, 0, 0.3)',
  },
});
