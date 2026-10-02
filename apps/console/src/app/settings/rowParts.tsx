import type { ReactNode } from 'react';
import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
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
  toolbar?: ReactNode;
  perRepo: boolean;
}

export function useRowParts(
  def: SettingDefWire,
  row: Row,
  opts: {
    suggestions?: string[];
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
  let toolbar: ReactNode;
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
      opts.asJson,
      () => opts.setAsJson(false),
      () => opts.setAsJson(true)
    );
    control = composite.control;
    body = composite.body;
    toolbar = composite.toolbar;
  }
  return { control, body, toolbar, perRepo };
}

/** The Value tab: a composite's editor, or the full description and the
    same control the header shows (the only control inside the modal). A
    host that already shows the description passes `describe={false}`. */
export function ValueContent({
  def,
  parts,
  describe = true,
}: {
  def: SettingDefWire;
  parts: RowParts;
  describe?: boolean;
}) {
  const { text } = useSchemeColors();
  if (parts.body) return <>{parts.body}</>;
  return (
    <Stack gap={10} px={8}>
      {parts.toolbar}
      {describe && (
        <Text fz={12} c={text.muted}>
          {def.description}
        </Text>
      )}
      <Group gap={8} wrap="nowrap">
        {parts.control}
      </Group>
    </Stack>
  );
}

/** A write in flight or just landed, beside the control that made it. */
export function SaveStatus({ row }: { row: Row }) {
  const { text } = useSchemeColors();
  if (row.status === 'saving')
    return (
      <Text fz={12} c={text.muted}>
        saving…
      </Text>
    );
  if (row.status === 'saved')
    return (
      <Group gap={4} wrap="nowrap">
        <Text fz={12} c="var(--tk-text-ok-small)">
          saved
        </Text>
        <Icons.check size={12} color="var(--tk-text-ok-vivid)" />
      </Group>
    );
  return null;
}

/** rt's refusal of the last write, verbatim. */
export function WriteError({ row }: { row: Row }) {
  if (!row.error) return null;
  return (
    <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
      {row.error}
    </Text>
  );
}

/** Both of the above on their own lines, for a Value tab with no row
    header to hold the status. */
export function WriteState({ row }: { row: Row }) {
  if (row.status === 'idle' && !row.error) return null;
  return (
    <Stack gap={4} px={8}>
      <SaveStatus row={row} />
      <WriteError row={row} />
    </Stack>
  );
}
