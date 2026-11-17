import { Group, Radio, Stack, Text } from '@mattstack/app-kit/core';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { ENUMS } from '@mattstack/settings-kit/shapes';

import classes from './OptionList.module.css';

/** The options this enum explains one line each, or null when it explains
    none and keeps the dropdown. */
export function explainedOptions(
  def: SettingDefWire
): [value: string, line: string][] | null {
  const options = ENUMS[def.key];
  const lines = def.optionDescriptions;
  if (!options || !lines) return null;
  return options.map(o => [o, lines[o] ?? '']);
}

/** Every option of a choice setting with its line, the one in effect
    picked. Picking another saves it the way the header's dropdown does. */
export function OptionList({
  def,
  options,
  onSave,
}: {
  def: SettingDefWire;
  options: [value: string, line: string][];
  onSave: (value: string) => void;
}) {
  const value =
    typeof def.effective.value === 'string' ? def.effective.value : '';
  return (
    <Radio.Group
      value={value}
      onChange={v => {
        if (v !== value) onSave(v);
      }}
    >
      <Stack gap={6}>
        {options.map(([option, line]) => (
          <Radio.Card
            key={option}
            value={option}
            variant="wash"
            className={classes.option}
          >
            <Group gap={12} wrap="nowrap" align="flex-start">
              <Radio.Indicator size="sm" className={classes.indicator} />
              <Text
                fz="sm"
                ff="monospace"
                fw={500}
                w={72}
                className={classes.value}
              >
                {option}
              </Text>
              <Text fz="sm" className={classes.line}>
                {line}
              </Text>
            </Group>
          </Radio.Card>
        ))}
      </Stack>
    </Radio.Group>
  );
}
