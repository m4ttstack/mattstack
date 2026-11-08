import { useLayoutEffect } from 'react';

import { ActionIcon, Box, Menu } from '@mattstack/app-kit/core';
import { useLocalStorage } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import { setAppTone } from './app-tone';

/** The theme's own hues, so each holds up in both colour schemes. `tone`
 *  names the fill and small-text tokens the chrome mixes from. */
export const APP_HUES = [
  { id: 'pink', label: 'Pink', tone: 'bad' },
  { id: 'purple', label: 'Purple', tone: 'purple' },
  { id: 'blue', label: 'Blue', tone: 'accent' },
  { id: 'cyan', label: 'Cyan', tone: 'cyan' },
  { id: 'green', label: 'Green', tone: 'ok' },
  { id: 'orange', label: 'Orange', tone: 'warn' },
] as const;

export type AppHue = (typeof APP_HUES)[number]['id'];

/** The app's hue as the viewer last picked it in this browser, or the app's
 *  own. Writes the chrome's two hue tokens on the document root and makes
 *  the hue the theme's primary colour. */
export function useAppHue(app: string, fallback: AppHue) {
  const [picked, setPicked] = useLocalStorage<AppHue | null>({
    key: `${app}-theme-color`,
    defaultValue: null,
  });
  const hue =
    APP_HUES.find(h => h.id === picked) ??
    APP_HUES.find(h => h.id === fallback) ??
    APP_HUES[2];
  useLayoutEffect(() => {
    const { style } = document.documentElement;
    style.setProperty('--tk-app-hue', `var(--tk-fill-${hue.tone})`);
    style.setProperty('--tk-app-ink-tint', `var(--tk-text-${hue.tone}-small)`);
    setAppTone(hue.tone);
  }, [hue.tone]);
  return [hue.id, setPicked] as const;
}

/** The top bar's palette menu: a per-browser choice of the chrome's hue. */
export function HueControl({
  value,
  onChange,
  size,
  iconSize,
}: {
  value: AppHue;
  onChange: (hue: AppHue) => void;
  size: number;
  iconSize: number;
}) {
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={size}
          aria-label="Theme colour"
        >
          <Icon name="palette" size={iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {APP_HUES.map(hue => (
          <Menu.Item
            key={hue.id}
            onClick={() => onChange(hue.id)}
            aria-current={hue.id === value || undefined}
            leftSection={
              <Box
                w={12}
                h={12}
                style={{
                  borderRadius: '50%',
                  background: `var(--tk-fill-${hue.tone})`,
                }}
              />
            }
            rightSection={
              hue.id === value ? <Icon name="check" size={14} /> : undefined
            }
          >
            {hue.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
