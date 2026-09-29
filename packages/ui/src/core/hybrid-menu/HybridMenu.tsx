import { useState } from 'react';
import type { ReactNode } from 'react';
import { Menu, Text, Tooltip } from '@mantine/core';
import type {
  MantineColor,
  MantineTransition,
  MenuItemProps,
  MenuProps,
} from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';

import { Icons } from '@mattstack/app-kit/icons';
import classes from './HybridMenu.module.css';

export interface HybridMenuOption {
  label: string;
  value: string;
  icon?: ReactNode;
  color?: MantineColor;
  disabled?: boolean;
  disableTooltip?: string;
}

export interface HybridMenuAction extends MenuItemProps {
  label: string;
  onClick: () => void;
  disableTooltip?: string;
  testId?: string;
}

export interface HybridMenuProps {
  options: HybridMenuOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  actions?: HybridMenuAction[];
  /** The menu's target. Either a node, or a render prop given the open state + currently selected option. */
  target:
    | ReactNode
    | ((targetProps: {
        menuOpened: boolean;
        selectedOption: HybridMenuOption | undefined;
      }) => ReactNode);
  disableAllValues?: boolean;
  disableAllValuesTooltip?: string;
  disableAllActions?: boolean;
  disableAllActionsTooltip?: string;
  /** Dropdown placement against the target; the pop-in grows from the
   *  corner nearest the target, after any flip. @default 'bottom-end' */
  position?: MenuProps['position'];
}

/** Mantine's pop with its origin left to a CSS variable, which the module
 *  sets from the dropdown's resolved (post-flip) placement. No slide: the
 *  flip lands after the first frame, and a transitioned translate would
 *  carry the pre-flip direction into the first open. */
const POP_FROM_ANCHOR: MantineTransition = {
  in: { opacity: 1, transform: 'scale(1)' },
  out: { opacity: 0, transform: 'scale(.9)' },
  common: { transformOrigin: 'var(--pop-origin)' },
  transitionProperty: 'transform, opacity',
};

/**
 * A menu that's part `Select` (a list of mutually-exclusive `options`, one
 * of them checked) and part action menu (a divider, then plain `actions`
 * below it) -- hence "hybrid".
 *
 * Uses `@mantine/core`'s own `MantineColor` for options/actions' color
 * values.
 */
export function HybridMenu({
  options,
  value,
  defaultValue,
  target,
  actions = [],
  onChange,
  disableAllActions = false,
  disableAllActionsTooltip = 'These actions are not allowed.',
  disableAllValues = false,
  disableAllValuesTooltip = 'Changing the value is not allowed.',
  position = 'bottom-end',
}: HybridMenuProps) {
  const [opened, setOpened] = useState(false);
  const [_value, handleChange] = useUncontrolled({
    value,
    defaultValue,
    onChange,
  });

  return (
    <Menu
      opened={opened}
      onChange={setOpened}
      width="auto"
      styles={{ dropdown: { minWidth: 120 } }}
      classNames={{ dropdown: classes.dropdown }}
      position={position}
      transitionProps={{ transition: POP_FROM_ANCHOR }}
    >
      <Menu.Target>
        {typeof target === 'function'
          ? target({
              menuOpened: opened,
              selectedOption: options.find(o => o.value === _value),
            })
          : target}
      </Menu.Target>
      <Menu.Dropdown>
        <Tooltip
          label={disableAllValuesTooltip}
          position="top"
          offset={10}
          disabled={!disableAllValues}
        >
          <div>
            {options.map(item => (
              <Tooltip
                key={item.value}
                disabled={!item.disabled}
                position="left"
                offset={10}
                withArrow
                label={item.disableTooltip}
              >
                <div>
                  <Menu.Item
                    disabled={disableAllValues || item.disabled}
                    onClick={() => handleChange(item.value)}
                    color={item.color}
                    leftSection={item.icon}
                    rightSection={
                      <span
                        style={{
                          visibility:
                            item.value === _value ? 'visible' : 'hidden',
                        }}
                      >
                        <Icons.check size={14} />
                      </span>
                    }
                  >
                    <Text fw={item.value === _value ? 500 : 400} size="sm">
                      {item.label}
                    </Text>
                  </Menu.Item>
                </div>
              </Tooltip>
            ))}
          </div>
        </Tooltip>

        {actions.length > 0 && (
          <>
            <Menu.Divider />
            <Tooltip
              label={disableAllActionsTooltip}
              disabled={!disableAllActions}
            >
              <div>
                {actions.map(
                  ({
                    label,
                    onClick,
                    disableTooltip,
                    testId,
                    ...menuItemProps
                  }) => (
                    <Tooltip
                      key={label}
                      disabled={!menuItemProps.disabled || !disableTooltip}
                      label={disableTooltip}
                      position="left"
                      offset={10}
                      withArrow
                    >
                      <div>
                        <Menu.Item
                          onClick={() => {
                            onClick();
                            setOpened(false);
                          }}
                          {...menuItemProps}
                          disabled={menuItemProps.disabled || disableAllActions}
                          data-testid={testId}
                        >
                          {label}
                        </Menu.Item>
                      </div>
                    </Tooltip>
                  )
                )}
              </div>
            </Tooltip>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
