import {
  DEFAULT_THEME,
  defaultVariantColorsResolver,
  mergeMantineTheme,
} from '@mantine/core';
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

  it('soft-outline is no fill with a muted glyph and a soft rule', () => {
    const result = variantColorResolver({
      color: 'accent',
      theme,
      variant: 'soft-outline',
    });
    expect(result.background).toBe('transparent');
    expect(result.color).toBe('var(--tk-text-3)');
    expect(result.border).toContain('solid var(--tk-line-3)');
  });

  it('card-outline is a card fill with a body label and the kit border', () => {
    const result = variantColorResolver({
      color: 'accent',
      theme,
      variant: 'card-outline',
    });
    expect(result.background).toBe('var(--tk-card)');
    expect(result.hover).toBe('var(--mantine-color-default-hover)');
    expect(result.color).toBe('var(--tk-text-1)');
    expect(result.border).toContain('solid var(--tk-border)');
  });

  it.each([
    'quiet',
    'quiet-outline',
    'panel-outline',
    'soft-outline',
    'card-outline',
  ])(
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
    expect(result.background).toBe(
      'color-mix(in srgb, var(--tk-fill-accent) var(--ui-wash), transparent)'
    );
    expect(result.hover).toBe(
      'color-mix(in srgb, var(--tk-fill-accent) var(--ui-wash-hover), transparent)'
    );
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

describe('tint tones', () => {
  const TINT =
    'color-mix(in srgb, var(--tk-fill-warn) var(--ui-tint), transparent)';

  it('tint mixes a kit hue at the tint strength behind a label in that hue, with no rule', () => {
    const result = variantColorResolver({
      color: 'warn',
      theme,
      variant: 'tint',
    });
    expect(result.background).toBe(TINT);
    expect(result.hover).toBe(TINT);
    expect(result.color).toBe('var(--tk-text-warn)');
    expect(result.border).toContain('solid transparent');
  });

  it("tint-outline rules the same tint in the hue's fill", () => {
    const result = variantColorResolver({
      color: 'warn',
      theme,
      variant: 'tint-outline',
    });
    expect(result.background).toBe(TINT);
    expect(result.color).toBe('var(--tk-text-warn)');
    expect(result.border).toContain('solid var(--tk-fill-warn)');
  });

  it("hue-outline is a card fill ringed in the hue's fill, with a label in that hue", () => {
    const result = variantColorResolver({
      color: 'warn',
      theme,
      variant: 'hue-outline',
    });
    expect(result.background).toBe('var(--tk-card)');
    expect(result.color).toBe('var(--tk-text-warn)');
    expect(result.border).toContain('solid var(--tk-fill-warn)');
  });

  it.each([
    ['tint', 'light'],
    ['tint-outline', 'light'],
    ['hue-outline', 'outline'],
  ])(
    '%s on a colour outside the kit hues reads as the %s variant',
    (variant, fallback) => {
      expect(variantColorResolver({ color: 'gray', theme, variant })).toEqual(
        variantColorResolver({ color: 'gray', theme, variant: fallback })
      );
    }
  );
});

it('a variant named like an Object property is no tone of the kit', () => {
  expect(
    variantColorResolver({ color: 'warn', theme, variant: 'constructor' })
  ).toEqual(
    defaultVariantColorsResolver({
      color: 'warn',
      theme,
      variant: 'constructor',
    })
  );
});
