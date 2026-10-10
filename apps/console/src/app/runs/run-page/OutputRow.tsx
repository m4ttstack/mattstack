import type { ReactNode } from 'react';
import { Group, Text } from '@mattstack/app-kit/core';
import type { RunFieldRow } from '@mattstack/rt-client';

import { fieldLabel } from '../derive/fields';
import { FieldValue } from './FieldValue';
import classes from './OutputRow.module.css';

/** One labelled line of a story section or the Now card. The value carries
    the `v` layer. */
export function OutputRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Group
      gap={10}
      wrap="nowrap"
      align="flex-start"
      className={classes.row}
      data-row={label}
    >
      <Text
        fz="md"
        lh="normal"
        c="dimmed"
        className={classes.label}
        data-parity={label}
      >
        {label}
      </Text>
      <div className={classes.value}>{children}</div>
    </Group>
  );
}

export function FieldRows({
  fields,
  pathHref,
}: {
  fields: RunFieldRow[];
  pathHref?: (path: string) => string | null;
}) {
  return fields.map(f => (
    <OutputRow key={f.key} label={fieldLabel(f.key)}>
      <FieldValue
        fieldKey={f.key}
        value={f.value}
        pathHref={pathHref}
        data-parity="v"
      />
    </OutputRow>
  ));
}
