import { memo, type CSSProperties, type ReactNode } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Collapse,
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
  BlockRowInfo,
  RowState,
  TemplateRow,
  TemplateView,
} from '../model/templateModel';
import { ACCENT, BODY, ICON_STROKE, MUTED, useCanvas } from './canvasContext';
import classes from './nodes.module.css';
import { parityName } from './parity';

type Tag = { label: string; color?: 'warn' | 'bad' };

/** The tag a placeholder row's state earns: a hue where it needs attention,
    quiet where it only says how the prop is filled. A card says the same in
    its subtitle, so a card shows only `unsynced`. */
export function tagOf(state: RowState, fill: string | null): Tag | null {
  switch (state) {
    case 'unsynced':
      return { label: 'unsynced', color: 'warn' };
    case 'required-unbound':
      return { label: 'required, nothing bound', color: 'warn' };
    case 'no-matching-fill':
      return { label: 'no matching fill', color: 'warn' };
    case 'resolve-error':
      return { label: 'resolve error', color: 'bad' };
    case 'optional-unbound':
      return { label: 'optional, nothing bound' };
    case 'referenced':
      return { label: fill ? `links to ${fill}` : 'links to its fill' };
    case 'ok':
      return null;
  }
}

export function StateTag({ tag }: { tag: Tag | null }) {
  if (!tag) return null;
  return (
    <Badge
      variant={tag.color ? 'tint' : 'quiet'}
      color={tag.color}
      classNames={{ root: classes.tag }}
      data-parity={`tag · ${tag.label}`}
      attributes={{ label: { 'data-parity': 'l' } }}
    >
      {tag.label}
    </Badge>
  );
}

/** How long a section's blocks take to fold in or out. */
const FOLD_MS = 180;

type Piece =
  | { kind: 'row'; row: TemplateRow }
  | { kind: 'fold'; section: string; rows: TemplateRow[] };

/** The rows in order, a section's own blocks gathered into one fold. A
    shared block's inner blocks are never drawn: the block view opens them. */
function piecesOf(rows: readonly TemplateRow[]): Piece[] {
  const pieces: Piece[] = [];
  for (const row of rows) {
    const block = row.kind === 'text' ? row.block : null;
    if (block?.shared === 'inner') continue;
    if (block && block.shared === null && block.section !== null) {
      const last = pieces.at(-1);
      if (last?.kind === 'fold' && last.section === block.section)
        last.rows.push(row);
      else pieces.push({ kind: 'fold', section: block.section, rows: [row] });
      continue;
    }
    pieces.push({ kind: 'row', row });
  }
  return pieces;
}

/** A tree of blocks reads by its sections, so its rows carry no line
    numbers. */
const isBlockTree = (view: TemplateView) =>
  view.rows.some(row => row.kind === 'text' && row.block !== null);

function Gutter({ row, marked }: { row: TemplateRow; marked: boolean }) {
  return (
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
  );
}

/** A block's row: its caret when it is a section with blocks to fold, then
    its name, which opens the block view at it. */
function BlockRow({
  view,
  row,
  block,
}: {
  view: TemplateView;
  row: Extract<TemplateRow, { kind: 'text' }>;
  block: BlockRowInfo;
}) {
  const { open, onToggle, onOpenBlock } = useCanvas();
  const section = block.depth === 1 && block.count > 0;
  const shared = block.shared === 'root';
  const opened = open.has(block.id);
  const indent = Math.max(block.depth - 1, 0) * 14;
  return (
    <div
      className={classes.row}
      style={{ height: rowHeightOf(view, row) }}
      data-kind="text"
      data-shared={shared || undefined}
      data-parity={parityName.row(row)}
      data-testid="template-row"
    >
      <div
        className={classes.blockBody}
        style={{ '--indent': `${indent}px` } as CSSProperties}
      >
        <UnstyledButton
          className={classes.blockOpen}
          onClick={() => (section ? onToggle(block.id) : onOpenBlock(block.id))}
          title={section ? undefined : 'Open in the block view'}
          aria-expanded={section ? opened : undefined}
          data-testid={section ? 'row-fold' : 'row-open'}
        >
          <span className={classes.caretSlot}>
            {section && (
              <Icon
                strokeWidth={ICON_STROKE}
                name={opened ? 'chevronDown' : 'chevronRight'}
                size={12}
                color={MUTED}
              />
            )}
          </span>
          {shared && (
            <Icon
              strokeWidth={ICON_STROKE}
              name="copy"
              size={12}
              color="var(--tk-text-2)"
            />
          )}
          <Text
            fz={11}
            lh="normal"
            c={shared ? 'var(--tk-text-2)' : BODY}
            ff={shared ? 'monospace' : undefined}
            fw={block.depth === 1 ? 500 : 400}
            truncate
            className={classes.grow}
            data-parity="txt"
          >
            {row.label}
          </Text>
          {block.count > 0 && (
            <Text fz={10} lh="normal" c={MUTED} data-testid="row-count">
              {`${block.count + (shared ? 1 : 0)} blocks`}
            </Text>
          )}
          {!section && (
            <Icon
              strokeWidth={ICON_STROKE}
              name="arrowUpRight"
              size={12}
              color={ACCENT}
              className={classes.openHint}
            />
          )}
        </UnstyledButton>
        {section && (
          <ActionIcon
            variant="subtle"
            size="xs"
            aria-label={`Open ${row.label} in the block view`}
            title="Open in the block view"
            onClick={() => onOpenBlock(block.id)}
            className={classes.openAction}
            data-testid="row-open"
          >
            <Icon
              strokeWidth={ICON_STROKE}
              name="arrowUpRight"
              size={12}
              color={ACCENT}
            />
          </ActionIcon>
        )}
      </div>
    </div>
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
  const { onOpenSkill, onOpenBlock } = useCanvas();
  if (row.kind === 'text' && row.block)
    return <BlockRow view={view} row={row} block={row.block} />;
  // A placeholder row is already washed, so selecting it only rings it.
  const marked = selected && row.kind === 'text';
  const link =
    row.kind === 'placeholder'
      ? view.links.find(card => card.rowId === row.id)
      : undefined;
  const opens = () => {
    if (link) onOpenSkill(link.skill);
    else if (row.kind === 'placeholder' && row.block) onOpenBlock(row.block);
    else onSelect(`row:${row.id}`);
  };
  return (
    <UnstyledButton
      className={classes.row}
      h={rowHeightOf(view, row)}
      data-kind={row.kind}
      data-selected={selected || undefined}
      data-parity={parityName.row(row)}
      data-testid="template-row"
      onClick={opens}
    >
      {!isBlockTree(view) && <Gutter row={row} marked={marked} />}
      <Box className={classes.body}>
        {row.kind === 'text' ? (
          <Text
            fz={11}
            lh="normal"
            c={selected ? BODY : MUTED}
            truncate
            data-parity="txt"
          >
            {`··· ${row.label}`}
          </Text>
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
            <StateTag tag={tagOf(row.state, row.fill)} />
          </>
        )}
      </Box>
    </UnstyledButton>
  );
}

function TemplateNodeComponent({
  data: { view },
}: NodeProps<Node<TemplateNodeData, 'template'>>) {
  const { select, onSelect, open } = useCanvas();
  const targeted = new Set(view.inputs.map(card => card.rowId));
  const linked = new Set(view.links.map(card => card.rowId));
  const selectedRow = view.rows.find(row => select === `row:${row.id}`);
  const pieces = piecesOf(view.rows);
  const rowOf = (row: TemplateRow) => (
    <RowButton
      key={row.id}
      view={view}
      row={row}
      selected={row === selectedRow}
      onSelect={onSelect}
    />
  );
  const slotOf = (row: TemplateRow) => (
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
  );
  const folded = (
    piece: Extract<Piece, { kind: 'fold' }>,
    inner: ReactNode
  ) => (
    <Collapse
      key={`fold:${piece.section}`}
      expanded={open.has(piece.section)}
      transitionDuration={FOLD_MS}
      animateOpacity={false}
      className={classes.fold}
    >
      {inner}
    </Collapse>
  );

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
          data-gutter={isBlockTree(view) ? 'off' : undefined}
        >
          {pieces.map(piece =>
            piece.kind === 'row'
              ? rowOf(piece.row)
              : folded(piece, piece.rows.map(rowOf))
          )}
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
        {pieces.map(piece =>
          piece.kind === 'row'
            ? slotOf(piece.row)
            : folded(piece, piece.rows.map(slotOf))
        )}
      </div>
    </div>
  );
}

export const TemplateNode = memo(TemplateNodeComponent);
