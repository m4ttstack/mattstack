import { ActionIcon, HybridMenu, RailEntry } from '@mattstack/app-kit/core';
import type { ActionIconProps } from '@mattstack/app-kit/core';
import { useColorScheme } from '@mattstack/app-kit/hooks';
import { Icon, type IconName } from '@mattstack/app-kit/icons';

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

export type ColorSchemeControlProps =
  | { variant?: 'rail'; expanded: boolean }
  | {
      /** A bare icon button, for chrome outside the shell rail (a phone drawer, say). */
      variant: 'button';
      size?: ActionIconProps['size'];
      /** @default 18 */
      iconSize?: number;
    };

/** The one colour-scheme switcher: System, Light or Dark, its icon showing the stored choice. */
export function ColorSchemeControl(props: ColorSchemeControlProps) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const icon = SCHEME_ICON[colorScheme as ColorSchemePreference] ?? 'monitor';
  return (
    <HybridMenu
      options={OPTIONS}
      value={colorScheme}
      onChange={value => setColorScheme(value as ColorSchemePreference)}
      target={
        props.variant === 'button' ? (
          <ActionIcon
            variant="subtle"
            size={props.size ?? 'lg'}
            aria-label="Color scheme"
          >
            <Icon name={icon} size={props.iconSize ?? 18} />
          </ActionIcon>
        ) : (
          <RailEntry
            icon={icon}
            label="Color scheme"
            expanded={props.expanded}
          />
        )
      }
    />
  );
}
