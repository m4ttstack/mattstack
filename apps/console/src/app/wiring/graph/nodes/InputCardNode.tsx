import { memo } from 'react';
import { Button, Paper, Text, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import {
  inputHeightOf,
  LAYOUT,
  type InputNodeData,
} from '../layout/templateLayout';
import type { InputCard, RowState, SectionCard } from '../model/templateModel';
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

const SECTION_TAG = { label: 'team values changed', color: 'warn' } as const;

function SectionRow({ section }: { section: SectionCard }) {
  return (
    <div
      className={classes.section}
      data-testid="section-row"
      data-parity={`section · ${section.title}`}
    >
      <Icon strokeWidth={ICON_STROKE} name="team" size={12} color={MUTED} />
      <div className={classes.cardText}>
        <Text ff="monospace" fz={11} lh="normal" c={BODY} truncate>
          {section.title}
        </Text>
        <Text fz={10} lh="normal" c={MUTED} truncate>
          {section.source}
        </Text>
      </div>
      {section.changed && <StateTag tag={SECTION_TAG} />}
    </div>
  );
}

function InputCardNodeComponent({
  id,
  data: { card },
}: NodeProps<Node<InputNodeData, 'input'>>) {
  const { view, select, onSelect, onBind } = useCanvas();
  const name = parityName.input(view, card);
  const file = card.icon !== 'cpu';
  const row = view.rows.find(candidate => candidate.id === card.rowId);
  const bindable = card.state === 'required-unbound' && row !== undefined;
  const sections = card.sections.length > 0;
  const face = (
    <>
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
      {card.state === 'unsynced' && <StateTag tag={tagOf(card.state, null)} />}
    </>
  );

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
          data-sections={sections || undefined}
          w={LAYOUT.inputW}
          h={inputHeightOf(card)}
          className={classes.card}
          data-parity={`input · ${name}`}
        >
          {sections ? (
            <>
              <div className={classes.cardFace}>{face}</div>
              {card.sections.map(section => (
                <SectionRow key={section.id} section={section} />
              ))}
            </>
          ) : (
            face
          )}
        </Paper>
      </UnstyledButton>
      {bindable && (
        <Button
          variant="card-outline"
          size="compact-sm"
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
        style={sections ? { top: LAYOUT.cardH / 2 } : undefined}
        data-parity={`handle · in ${name}`}
      />
    </div>
  );
}

export const InputCardNode = memo(InputCardNodeComponent);
