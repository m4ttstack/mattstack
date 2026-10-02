import { memo } from 'react';
import { Paper, Text, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { LAYOUT, type InputNodeData } from '../layout/templateLayout';
import { ACCENT, BODY, ICON_STROKE, MUTED, useCanvas } from './canvasContext';
import classes from './nodes.module.css';
import { parityName } from './parity';
import { StateTag } from './TemplateNode';

function InputCardNodeComponent({
  id,
  data: { card },
}: NodeProps<Node<InputNodeData, 'input'>>) {
  const { view, select, onSelect } = useCanvas();
  const name = parityName.input(view, card);
  const file = card.icon === 'fileText';

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
              c={card.subtitleTone === 'accent' ? ACCENT : MUTED}
              truncate
              data-parity="sub"
            >
              {card.subtitle}
            </Text>
          </div>
          {card.state === 'unsynced' && <StateTag state={card.state} />}
        </Paper>
      </UnstyledButton>
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
