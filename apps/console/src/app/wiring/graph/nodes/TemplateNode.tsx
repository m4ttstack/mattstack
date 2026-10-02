import { memo } from 'react';
import {
  Badge,
  Box,
  Group,
  Paper,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import {
  LAYOUT,
  rowHeightOf,
  type TemplateNodeData,
} from '../layout/templateLayout';
import type {
  RowState,
  TemplateRow,
  TemplateView,
} from '../model/templateModel';
import { ACCENT, BODY, ICON_STROKE, MUTED, useCanvas } from './canvasContext';
import classes from './nodes.module.css';
import { parityName } from './parity';

/** The tag a row's state earns. A card says the same in its subtitle, so a
    card shows only `unsynced`. */
const STATE_TAGS: Partial<Record<RowState, { label: string; color: string }>> =
  {
    unsynced: { label: 'unsynced', color: 'warn' },
    'required-unbound': { label: 'required, nothing bound', color: 'warn' },
    'resolve-error': { label: 'resolve error', color: 'bad' },
  };

export function StateTag({ state }: { state: RowState }) {
  const tag = STATE_TAGS[state];
  if (!tag) return null;
  return (
    <Badge
      variant="tint"
      color={tag.color}
      classNames={{ root: classes.tag }}
      data-parity={`tag · ${tag.label}`}
      attributes={{ label: { 'data-parity': 'l' } }}
    >
      {tag.label}
    </Badge>
  );
}

function RowButton({
  view,
  row,
  selected,
  onSelect,
}: {
  view: TemplateView;
  row: TemplateRow;
  selected: boolean;
  onSelect: (select: string) => void;
}) {
  const links = !view.output;
  // A placeholder row is already washed, so selecting it only rings it.
  const marked = selected && row.kind === 'text';
  return (
    <UnstyledButton
      className={classes.row}
      h={rowHeightOf(view, row)}
      data-kind={row.kind}
      data-selected={selected || undefined}
      data-parity={parityName.row(row)}
      data-testid="template-row"
      onClick={() => onSelect(`row:${row.line}`)}
    >
      <Box className={classes.gutter} data-parity="gutter">
        <Text
          ff="monospace"
          fz={9}
          lh="normal"
          fw={marked ? 700 : 400}
          c={marked ? ACCENT : MUTED}
          data-parity="ln"
          data-testid="row-gutter"
        >
          {row.gutter}
        </Text>
      </Box>
      <Box className={classes.body}>
        {row.kind === 'text' ? (
          <>
            <Text
              fz={11}
              lh="normal"
              c={selected ? BODY : MUTED}
              truncate
              className={links ? classes.grow : undefined}
              data-parity="txt"
            >
              {`··· ${row.label}`}
            </Text>
            {links && (
              <Icon
                strokeWidth={ICON_STROKE}
                name={selected ? 'panelRightOpen' : 'panelRight'}
                size={12}
                color={selected ? ACCENT : MUTED}
                data-parity="open"
              />
            )}
          </>
        ) : (
          <>
            <Text
              ff="monospace"
              fz={12}
              lh="normal"
              c={ACCENT}
              truncate
              data-parity="code"
            >
              {row.code}
            </Text>
            <StateTag state={row.state} />
          </>
        )}
      </Box>
    </UnstyledButton>
  );
}

function TemplateNodeComponent({
  data: { view },
}: NodeProps<Node<TemplateNodeData, 'template'>>) {
  const { select, onSelect } = useCanvas();
  const targeted = new Set(view.inputs.map(card => card.rowId));
  const linked = new Set(view.links.map(card => card.rowId));
  const selectedRow = view.rows.find(row => select === `row:${row.line}`);

  return (
    <div className={classes.shell} data-testid="template-node">
      <Paper
        withBorder
        variant="ground"
        radius={8}
        w={LAYOUT.templateW}
        data-parity={parityName.template(view)}
      >
        <Group
          className={classes.header}
          h={LAYOUT.headerH}
          gap={8}
          data-parity="header"
        >
          <Icon
            strokeWidth={ICON_STROKE}
            name="fileCode"
            size={14}
            color={MUTED}
            data-parity="i"
          />
          <Text ff="monospace" fz={12} lh="normal" c={BODY} data-parity="file">
            {view.templateFile}
          </Text>
          <span className={classes.spacer} />
          <Text ff="monospace" fz={10} lh="normal" c={MUTED} data-parity="meta">
            {view.templateMeta}
          </Text>
        </Group>
        <div
          className={classes.rows}
          data-view={view.output ? 'step' : 'links'}
        >
          {view.rows.map(row => (
            <RowButton
              key={row.id}
              view={view}
              row={row}
              selected={row === selectedRow}
              onSelect={onSelect}
            />
          ))}
        </div>
      </Paper>
      <div className={classes.handles}>
        <Box className={classes.slot} h={LAYOUT.headerH}>
          {view.output && (
            <Handle
              type="source"
              position={Position.Right}
              id="out"
              isConnectable={false}
              className={classes.handle}
              data-parity="handle · template out"
            />
          )}
        </Box>
        {view.rows.map(row => (
          <Box key={row.id} className={classes.slot} h={rowHeightOf(view, row)}>
            {targeted.has(row.id) && (
              <Handle
                type="target"
                position={Position.Left}
                id={`row:${row.id}`}
                isConnectable={false}
                className={classes.handle}
                data-parity={parityName.rowHandle(row)}
              />
            )}
            {linked.has(row.id) && (
              <Handle
                type="source"
                position={Position.Right}
                id={`row:${row.id}`}
                isConnectable={false}
                className={classes.handle}
                data-parity={parityName.rowHandle(row)}
              />
            )}
          </Box>
        ))}
      </div>
    </div>
  );
}

export const TemplateNode = memo(TemplateNodeComponent);
