import type { ReactNode } from 'react';
import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  formatValue,
  rowKind,
  SHAPES,
  summarize,
} from '@mattstack/settings-kit/shapes';

import { compositeParts } from './CompositeControls';
import { ScalarControl } from './ScalarControl';
import { useSettingsRepo } from './useConsoleSettings';
import type { useRowSave } from './useRowSave';
import { APPROVAL_KEY, rungBase, rungOf } from './view';

type Row = ReturnType<typeof useRowSave>;

export interface RowParts {
  control: ReactNode;
  body: ReactNode;
  perRepo: boolean;
}

export function useRowParts(
  def: SettingDefWire,
  row: Row,
  opts: {
    suggestions?: string[];
    open: boolean;
    onToggle: () => void;
    asJson: boolean;
    setAsJson: (on: boolean) => void;
  }
): RowParts {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  const kind = rowKind(def);
  // With no repo picked, every write here would be a global one, which a
  // repo-only key refuses; the repo reach beside the name says where it is set.
  const perRepo = def.repoOnly === true && repo === null;

  let control: ReactNode;
  let body: ReactNode = null;
  if (perRepo) {
    control = (
      <Text fz={12} c={text.muted}>
        set per repo
      </Text>
    );
  } else if (def.key === APPROVAL_KEY) {
    const hash =
      typeof def.effective.value === 'string' ? def.effective.value : null;
    const at = rungBase(def.effective.scope) ? def.effective.scope : null;
    control = (
      <Group gap={8} wrap="nowrap">
        {hash && (
          <Text fz={12} ff="monospace" c={text.muted}>
            {hash.slice(0, 12)}
          </Text>
        )}
        {hash && at && def.writable && (
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => void row.clear(at)}
          >
            Revoke
          </Button>
        )}
      </Group>
    );
  } else if (kind === 'scalar' || kind === 'enum') {
    control = (
      <ScalarControl
        def={def}
        writeScope={rungOf(row.target.scope, row.target.repo ?? null)}
        onSave={v => void row.save(v)}
        suggestions={opts.suggestions}
      />
    );
  } else if (kind === 'external') {
    const shape = SHAPES[def.key];
    const owner = shape?.kind === 'external' ? shape.app : 'another app';
    control = (
      <Text fz={12} c={text.muted}>
        {def.effective.value === undefined
          ? `edited in ${owner}`
          : `${summarize(def)} · edited in ${owner}`}
      </Text>
    );
  } else if (
    kind === 'readonly' &&
    def.type !== 'object' &&
    def.type !== 'array'
  ) {
    // An unset or rejected value is already said by the source text or the
    // error line; the control repeats nothing.
    const shown = def.secret
      ? def.effective.scope === null
        ? null
        : '•••'
      : def.effective.value === undefined
        ? null
        : formatValue(def.effective.value);
    control =
      shown === null ? null : (
        <Text fz={12} c={text.muted} ff="monospace">
          {shown}
        </Text>
      );
  } else {
    const composite = compositeParts(
      def,
      kind,
      row,
      opts.open,
      opts.onToggle,
      opts.asJson,
      () => opts.setAsJson(false),
      () => opts.setAsJson(true)
    );
    control = composite.control;
    body = composite.body;
  }
  return { control, body, perRepo };
}

/** The Value tab: a composite's editor, or the full description and the
    same control the header shows (the only control inside the modal). */
export function ValueContent({
  def,
  parts,
}: {
  def: SettingDefWire;
  parts: RowParts;
}) {
  const { text } = useSchemeColors();
  if (parts.body) return <>{parts.body}</>;
  return (
    <Stack gap={10} px={8}>
      <Text fz={12} c={text.muted}>
        {def.description}
      </Text>
      <Group gap={8} wrap="nowrap">
        {parts.control}
      </Group>
    </Stack>
  );
}
