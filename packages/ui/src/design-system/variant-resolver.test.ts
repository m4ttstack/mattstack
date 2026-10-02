import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { describe, expect, it } from 'vitest';

import { baseTheme } from './base-theme';
import { variantColorResolver } from './variant-resolver';

// `createTheme` (and so `baseTheme`) returns a MantineThemeOverride, not the
// full MantineTheme the resolver's input type requires; merge onto the
// default the same way MantineProvider does before resolving it.
const theme = mergeMantineTheme(DEFAULT_THEME, baseTheme);

const HUES = ['accent', 'ok', 'bad', 'warn', 'purple', 'cyan'] as const;

describe('filled labels', () => {
  it.each(HUES)('%s reads its on-fill token', hue => {
    const result = variantColorResolver({
      color: hue,
      theme,
      variant: 'filled',
    });
    expect(result.color).toBe(`var(--tk-on-fill-${hue})`);
  });

  it('a non-hue colour keeps Mantine default', () => {
    const result = variantColorResolver({
      color: 'gray',
      theme,
      variant: 'filled',
    });
    expect(result.color).toBe('var(--mantine-color-white)');
  });

  it('other variants are untouched', () => {
    const result = variantColorResolver({
      color: 'ok',
      theme,
      variant: 'light',
    });
    expect(result.color).not.toBe('var(--tk-on-fill-ok)');
  });
});

describe('quiet tones', () => {
  it('quiet is a raised fill with a muted label and no rule', () => {
    const result = variantColorResolver({
      color: 'accent',
      theme,
      variant: 'quiet',
    });
    expect(result.background).toBe('var(--tk-raised)');
    expect(result.color).toBe('var(--tk-text-3)');
    expect(result.border).toContain('solid transparent');
  });

  it('quiet-outline is a card fill with a muted label and the kit border', () => {
    const result = variantColorResolver({
      color: 'accent',
      theme,
      variant: 'quiet-outline',
    });
    expect(result.background).toBe('var(--tk-card)');
    expect(result.color).toBe('var(--tk-text-3)');
    expect(result.border).toContain('solid var(--tk-border)');
  });

  it('panel-outline is a panel fill with a body label and a soft rule', () => {
    const result = variantColorResolver({
      color: 'accent',
      theme,
      variant: 'panel-outline',
    });
    expect(result.background).toBe('var(--tk-panel)');
    expect(result.color).toBe('var(--tk-text-1)');
    expect(result.border).toContain('solid var(--tk-line-3)');
  });

  it.each(['quiet', 'quiet-outline', 'panel-outline'])(
    '%s ignores the colour, so the primary default changes nothing',
    variant => {
      const plain = variantColorResolver({ color: 'accent', theme, variant });
      const tinted = variantColorResolver({ color: 'warn', theme, variant });
      expect(tinted).toEqual(plain);
    }
  );
});

describe('wash tone', () => {
  it('washes a kit hue behind a label in that hue', () => {
    const result = variantColorResolver({
      color: 'accent',
      theme,
      variant: 'wash',
    });
    expect(result.background).toContain('var(--tk-fill-accent) 10%');
    expect(result.background).toContain('var(--tk-fill-accent) 20%');
    expect(result.color).toBe('var(--tk-text-accent)');
  });

  it('a colour outside the kit hues falls back to the light variant', () => {
    const wash = variantColorResolver({
      color: 'gray',
      theme,
      variant: 'wash',
    });
    const light = variantColorResolver({
      color: 'gray',
      theme,
      variant: 'light',
    });
    expect(wash).toEqual(light);
  });
});
