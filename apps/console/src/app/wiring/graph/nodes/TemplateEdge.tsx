import { memo, type CSSProperties } from 'react';
import { Text } from '@mattstack/app-kit/core';
import {
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

import { MUTED } from './canvasContext';
import classes from './nodes.module.css';

export type TemplateEdgeData = { name: string };

/** Half the handle ring. React Flow anchors an edge on a handle's outer
    side; the boards run it from centre to centre. */
const HANDLE_RADIUS = 4;
const MARKER = { length: 7, halfHeight: 4, overlap: 1 };

function TemplateEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
}: EdgeProps<Edge<TemplateEdgeData>>) {
  const tipX = targetX + HANDLE_RADIUS;
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sourceX - HANDLE_RADIUS,
    sourceY,
    sourcePosition,
    targetX: tipX - MARKER.length + MARKER.overlap,
    targetY,
    targetPosition,
  });
  const name = data?.name ?? '';
  const marker = `M${tipX - MARKER.length} ${targetY - MARKER.halfHeight}l${MARKER.length} ${MARKER.halfHeight}-${MARKER.length} ${MARKER.halfHeight}z`;

  return (
    <>
      <path
        d={path}
        className={classes.edgeLine}
        data-parity={`edge · ${name}`}
      />
      <path
        d={marker}
        className={classes.edgeMarker}
        data-parity={`marker · ${name}`}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={classes.edgeLabel}
            style={
              {
                '--label-x': `${labelX}px`,
                '--label-y': `${labelY}px`,
              } as CSSProperties
            }
            data-parity={`edge label · ${name}`}
          >
            <Text ff="monospace" fz={10} lh="normal" c={MUTED} data-parity="l">
              {label}
            </Text>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const TemplateEdge = memo(TemplateEdgeComponent);
