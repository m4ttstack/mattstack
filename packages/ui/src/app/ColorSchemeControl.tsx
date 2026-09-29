import { HybridMenu, RailEntry } from '@mattstack/app-kit/core';
import { useColorScheme } from '@mattstack/app-kit/hooks';
import type { IconName } from '@mattstack/app-kit/icons';

type ColorSchemePreference = 'auto' | 'light' | 'dark';

const OPTIONS: { label: string; value: ColorSchemePreference }[] = [
  { label: 'System', value: 'auto' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

/** The icon shows the stored choice, so System reads as system rather than as the scheme it resolved to. */
const SCHEME_ICON: Record<ColorSchemePreference, IconName> = {
  auto: 'monitor',
  light: 'sun',
  dark: 'moon',
};

export function ColorSchemeControl({ expanded }: { expanded: boolean }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  return (
    <HybridMenu
      options={OPTIONS}
      value={colorScheme}
      onChange={value => setColorScheme(value as ColorSchemePreference)}
      target={
        <RailEntry
          icon={SCHEME_ICON[colorScheme as ColorSchemePreference] ?? 'monitor'}
          label="Color scheme"
          expanded={expanded}
        />
      }
    />
  );
}
