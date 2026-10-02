import { memo } from 'react';
import { Paper, Text, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { LAYOUT, type LinkNodeData } from '../layout/templateLayout';
import { STATUS_TONE } from '../model/statusTone';
import { StatusDot } from '../StatusDot';
import { BODY, ICON_STROKE, MUTED, useCanvas } from './canvasContext';
import classes from './nodes.module.css';
import { parityName } from './parity';

function LinkCardNodeComponent({
  data: { card },
}: NodeProps<Node<LinkNodeData, 'link'>>) {
  const { onOpenSkill } = useCanvas();
  const name = parityName.link(card);
  const tone = STATUS_TONE[card.status];

  return (
    <div className={classes.shell}>
      <UnstyledButton
        className={classes.cardButton}
        data-testid="link-card"
        onClick={() => onOpenSkill(card.skill)}
      >
        <Paper
          withBorder
          variant="ground"
          radius={7}
          w={LAYOUT.rightW}
          h={LAYOUT.cardH}
          className={classes.card}
          data-parity={`link · ${name}`}
        >
          <Icon
            strokeWidth={ICON_STROKE}
            name="fileText"
            size={14}
            color={MUTED}
            data-parity="i"
          />
          <div className={classes.cardText}>
            <Text
              ff="monospace"
              fz={12}
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
              c={tone === 'warn' ? 'var(--tk-text-warn)' : MUTED}
              truncate
              data-parity="sub"
            >
              {card.subtitle}
            </Text>
          </div>
          <StatusDot tone={tone} data-parity="status" />
          <Icon
            strokeWidth={ICON_STROKE}
            name="chevronRight"
            size={13}
            color={MUTED}
            data-parity="go"
          />
        </Paper>
      </UnstyledButton>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={classes.handle}
        data-parity={`handle · link ${name}`}
      />
    </div>
  );
}

export const LinkCardNode = memo(LinkCardNodeComponent);
