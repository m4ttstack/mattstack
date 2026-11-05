import { useLayoutEffect } from 'react';
import { ActionIcon, Box, Menu } from '@mattstack/app-kit/core';
import { useLocalStorage } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';

/** The theme's own hues, so each holds up in both colour schemes. */
const COLORS = [
  { id: 'pink', label: 'Pink', tone: 'bad' },
  { id: 'purple', label: 'Purple', tone: 'purple' },
  { id: 'blue', label: 'Blue', tone: 'accent' },
  { id: 'cyan', label: 'Cyan', tone: 'cyan' },
  { id: 'green', label: 'Green', tone: 'ok' },
  { id: 'orange', label: 'Orange', tone: 'warn' },
] as const;

type ColorId = (typeof COLORS)[number]['id'];

function useThemeColor() {
  const [id, setId] = useLocalStorage<ColorId>({
    key: 'chat-theme-color',
    defaultValue: 'pink',
  });
  const color = COLORS.find(c => c.id === id) ?? COLORS[0];
  useLayoutEffect(() => {
    const { style } = document.documentElement;
    style.setProperty('--chat-hue', `var(--tk-fill-${color.tone})`);
    style.setProperty('--chat-ink-tint', `var(--tk-text-${color.tone}-small)`);
  }, [color.tone]);
  return [color.id, setId] as const;
}

/** A per-browser choice of the chrome's colour, kept beside the settings gear. */
export function ThemeColorButton() {
  const [current, setCurrent] = useThemeColor();
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={26}
          aria-label="Theme colour"
        >
          <Icon name="palette" size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {COLORS.map(color => (
          <Menu.Item
            key={color.id}
            onClick={() => setCurrent(color.id)}
            aria-current={color.id === current || undefined}
            leftSection={
              <Box
                w={12}
                h={12}
                style={{
                  borderRadius: '50%',
                  background: `var(--tk-fill-${color.tone})`,
                }}
              />
            }
            rightSection={
              color.id === current ? <Icon name="check" size={14} /> : undefined
            }
          >
            {color.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
