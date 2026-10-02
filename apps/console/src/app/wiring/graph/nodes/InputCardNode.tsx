import { memo } from 'react';
import { Button, Paper, Text, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { LAYOUT, type InputNodeData } from '../layout/templateLayout';
import type { InputCard, RowState } from '../model/templateModel';
import { ACCENT, BODY, ICON_STROKE, MUTED, useCanvas } from './canvasContext';
import classes from './nodes.module.css';
import { parityName } from './parity';
import { StateTag, tagOf } from './TemplateNode';

const SUBTITLE_COLOR: Record<InputCard['subtitleTone'], string> = {
  dimmed: MUTED,
  accent: ACCENT,
  warn: 'var(--tk-text-warn-small)',
  bad: 'var(--tk-text-bad-small)',
};

/** The ring a card's state earns, as the ground Paper's `data-attention`. */
const ATTENTION: Partial<Record<RowState, 'warn' | 'bad'>> = {
  unsynced: 'warn',
  'required-unbound': 'warn',
  'no-matching-fill': 'warn',
  'resolve-error': 'bad',
};

function InputCardNodeComponent({
  id,
  data: { card },
}: NodeProps<Node<InputNodeData, 'input'>>) {
  const { view, select, onSelect, onBind } = useCanvas();
  const name = parityName.input(view, card);
  const file = card.icon === 'fileText';
  const row = view.rows.find(candidate => candidate.id === card.rowId);
  const bindable = card.state === 'required-unbound' && row !== undefined;

  return (
    <div className={classes.shell}>
      <UnstyledButton
        className={classes.cardButton}
        data-testid="input-card"
        onClick={() => onSelect(`input:${id}`)}
      >
        <Paper
          withBorder
          variant="ground"
          radius={7}
          data-selected={select === `input:${id}` || undefined}
          data-attention={ATTENTION[card.state]}
          data-action={bindable || undefined}
          w={LAYOUT.inputW}
          h={LAYOUT.cardH}
          className={classes.card}
          data-parity={`input · ${name}`}
        >
          <Icon
            strokeWidth={ICON_STROKE}
            name={card.icon}
            size={14}
            color={MUTED}
            data-parity="i"
          />
          <div className={classes.cardText}>
            <Text
              ff={file ? 'monospace' : undefined}
              fz={12}
              fw={file ? 400 : 500}
              lh="normal"
              c={BODY}
              truncate
              data-parity="name"
              data-testid="card-title"
            >
              {card.title}
            </Text>
            <Text
              fz={10}
              lh="normal"
              c={SUBTITLE_COLOR[card.subtitleTone]}
              truncate
              data-parity="sub"
            >
              {card.subtitle}
            </Text>
          </div>
          {card.state === 'unsynced' && (
            <StateTag tag={tagOf(card.state, null)} />
          )}
        </Paper>
      </UnstyledButton>
      {bindable && (
        <Button
          variant="card-outline"
          size="xs"
          radius={6}
          className={classes.cardAction}
          onClick={() => onBind(row.line)}
        >
          Bind
        </Button>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={classes.handle}
        data-parity={`handle · in ${name}`}
      />
    </div>
  );
}

export const InputCardNode = memo(InputCardNodeComponent);
