import { memo, useContext } from 'react';
import { UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { Node, NodeProps, NodeTypes } from '@xyflow/react';

import classes from './blocks.module.css';
import { Handles, JumpFrom, MapActionsContext } from './graphCards';
import type { BandBox, BandRow, OpenBand } from './model/bandLayout';

/** How long a jump's target stays ringed. */
export const RING_MS = 2000;

export type BandFlowNode = Node<{ band: OpenBand }, 'band'>;
export type BandStepFlowNode = Node<{ box: BandBox }, 'bandStep'>;

/** The open band's frame: a tint behind its steps, headed by their count
    and the Fold button. */
function BandFrame({ data: { band } }: NodeProps<BandFlowNode>) {
  const { fold } = useContext(MapActionsContext);
  const count = `${band.boxes.length} steps`;
  return (
    <div
      className={classes.foldBand}
      data-testid="fold-band"
      data-link={band.link.id}
      role="group"
      aria-label={count}
    >
      <div className={classes.foldBandHead}>
        <span className={classes.foldBandCount}>{count}</span>
        <UnstyledButton className={classes.foldBandFold} onClick={fold}>
          <Icon name="chevronUp" size={12} strokeWidth={2} />
          Fold
        </UnstyledButton>
      </div>
    </div>
  );
}

function Row({
  row,
  from,
  fromLabel,
}: {
  row: BandRow;
  from: string;
  fromLabel: string;
}) {
  const { jump } = useContext(MapActionsContext);
  const to = row.to;
  if (to === null) {
    return (
      <div className={classes.foldRow} data-testid="band-exit">
        <span className={classes.foldRowLabel}>{row.label}</span>
        <span className={classes.foldRowExit}>{row.target}</span>
      </div>
    );
  }
  const way = row.direction === 'back' ? 'back to' : 'on to';
  return (
    <UnstyledButton
      className={classes.foldRow}
      data-jump
      aria-label={`${row.label ? `${row.label}: ` : ''}${way} ${row.target}`}
      onClick={() => jump([to], from, fromLabel)}
    >
      <span className={classes.foldRowLabel}>{row.label}</span>
      <Icon
        name={row.direction === 'back' ? 'cornerUpLeft' : 'arrowRight'}
        size={11}
        strokeWidth={2}
        className={classes.mapPillIcon}
      />
      <span className={classes.mapPillTarget}>{row.target}</span>
    </UnstyledButton>
  );
}

/** One step inside the band: a command as a mono line, anything else as a
    card with its exits. */
function BandStep({ data: { box } }: NodeProps<BandStepFlowNode>) {
  const { nodeView } = useContext(MapActionsContext);
  const { node } = box;
  const view = nodeView(node.id);
  if (node.kind === 'command') {
    return (
      <>
        <div
          className={classes.foldCommand}
          data-testid="band-step"
          data-node={node.id}
          title={node.text}
        >
          {node.text}
        </div>
        <Handles />
      </>
    );
  }
  return (
    <>
      <div
        className={classes.foldStepBox}
        data-testid="band-step"
        data-node={node.id}
      >
        <div className={classes.foldCard} data-ring={view.ring || undefined}>
          <div className={classes.foldCardHead}>
            <span
              className={classes.mapBadge}
              data-badge={node.kind === 'step' ? 'step' : 'question'}
            >
              <Icon
                name={node.kind === 'step' ? 'circle' : 'diamond'}
                size={12}
                strokeWidth={2}
              />
            </span>
            <span className={classes.mapCardLabel}>{node.label}</span>
          </div>
          {box.rows.map(row => (
            <Row
              key={`${row.label}:${row.target}`}
              row={row}
              from={node.id}
              fromLabel={node.label}
            />
          ))}
          {node.pills.length > 0 && (
            <div className={classes.foldPills}>
              {node.pills.map(pill => (
                <span key={pill} className={classes.foldPill}>
                  {pill}
                </span>
              ))}
            </div>
          )}
        </div>
        {view.from && <JumpFrom {...view.from} />}
      </div>
      <Handles />
    </>
  );
}

export const BAND_NODE_TYPES: NodeTypes = {
  band: memo(BandFrame),
  bandStep: memo(BandStep),
};
