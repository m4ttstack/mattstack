import {
  memo,
  useContext,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { HoverCard } from '@mattstack/app-kit/core';
import {
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';

import classes from './blocks.module.css';
import { HOVER_OPEN_MS, MapActionsContext, StepsCard } from './graphCards';
import type { Box } from './model/elkGraph';
import { exitLabel } from './model/labels';

type Point = [number, number];

const MARKER = { length: 7, halfWidth: 4 };

const num = (value: number) => String(Math.round(value * 100) / 100);
const at = ([x, y]: Point) => `${num(x)} ${num(y)}`;

/** An orthogonal run through `points`, each corner rounded to `radius`, or
    to half its shorter side when a side is shorter than twice the radius. */
export function roundedPath(points: Point[], radius = 10): string {
  if (points.length === 0) return '';
  let d = `M${at(points[0]!)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]!;
    const [cx, cy] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    const inLength = Math.hypot(cx - px, cy - py);
    const outLength = Math.hypot(nx - cx, ny - cy);
    const turn = (cx - px) * (ny - cy) - (cy - py) * (nx - cx);
    if (inLength === 0 || outLength === 0 || turn === 0) continue;
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const before: Point = [
      cx - ((cx - px) / inLength) * r,
      cy - ((cy - py) / inLength) * r,
    ];
    const after: Point = [
      cx + ((nx - cx) / outLength) * r,
      cy + ((ny - cy) / outLength) * r,
    ];
    d += `L${at(before)}Q${at([cx, cy])} ${at(after)}`;
  }
  return `${d}L${at(points[points.length - 1]!)}`;
}

export type MapEdgeData = {
  points: Point[];
  /** It passes graph-only steps, so it draws dotted. */
  folded: boolean;
  /** It ends at a card, not at a split or a junction. */
  arrow: boolean;
  label: string | null;
  labelBox: Box | null;
};

export type MapFlowEdge = Edge<MapEdgeData, 'map'>;

/** The run stops short of an arrowhead's tip, and the arrowhead points
    along its last segment. */
function withArrow(points: Point[]): { line: Point[]; head: string } {
  const [tx, ty] = points[points.length - 1]!;
  const [sx, sy] = points[points.length - 2]!;
  const length = Math.hypot(tx - sx, ty - sy) || 1;
  const [dx, dy] = [(tx - sx) / length, (ty - sy) / length];
  const base: Point = [tx - dx * MARKER.length, ty - dy * MARKER.length];
  const [ox, oy] = [-dy * MARKER.halfWidth, dx * MARKER.halfWidth];
  const head = `M${at([base[0] + ox, base[1] + oy])}L${at([tx, ty])}L${at([base[0] - ox, base[1] - oy])}Z`;
  return { line: [...points.slice(0, -1), base], head };
}

/** The wide invisible stroke that takes a folded link's hover and click. */
function LinkHit({
  d,
  link,
  button,
}: {
  d: string;
  link: string;
  button: boolean;
}) {
  const { hover, open, linkInfo } = useContext(MapActionsContext);
  const info = linkInfo(link);
  if (!info) return null;
  const on = () => hover({ kind: 'link', id: link });
  const off = () => hover(null);
  const hit = (
    <path
      d={d}
      className={classes.mapEdgeHit}
      onMouseEnter={on}
      onMouseLeave={off}
      onClick={() => open(link)}
      {...(button
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': info.name,
            'data-testid': 'map-link',
            'data-link': link,
            onFocus: on,
            onBlur: off,
            onKeyDown: (event: KeyboardEvent<SVGPathElement>) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              open(link);
            },
          }
        : { 'aria-hidden': true })}
    />
  );
  // Every stretch of the link opens its card, the same hover card a jump
  // pill opens.
  return (
    <HoverCard
      width={300}
      position="right"
      offset={16}
      shadow="md"
      openDelay={HOVER_OPEN_MS}
      closeDelay={60}
      withinPortal
    >
      <HoverCard.Target>{hit}</HoverCard.Target>
      <HoverCard.Dropdown p={0} className={classes.stepsCardDropdown}>
        <StepsCard steps={info.steps} hint="Click the line to unfold" />
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

function MapEdgeComponent({ id, data }: EdgeProps<MapFlowEdge>) {
  const { edgeView } = useContext(MapActionsContext);
  if (!data || data.points.length < 2) return null;
  const view = edgeView(id);
  const { line, head } = data.arrow
    ? withArrow(data.points)
    : { line: data.points, head: null };
  const box = data.labelBox;
  const d = roundedPath(line);
  const state = {
    'data-hot': view.hot || undefined,
    'data-dim': view.dim || undefined,
  };
  return (
    <>
      {/* Keyed by its route, so a line the layout moves is drawn anew and
          fades in once the cards have moved, rather than jumping. */}
      <path
        key={d}
        d={d}
        className={classes.mapEdge}
        data-testid="map-edge"
        data-edge={id}
        {...state}
        strokeWidth={data.folded ? 2.4 : 1.5}
        {...(data.folded
          ? { strokeDasharray: '0 5', strokeLinecap: 'round' as const }
          : {})}
      />
      {head && (
        <path key={head} d={head} className={classes.mapArrow} {...state} />
      )}
      {view.link && (
        <LinkHit
          d={roundedPath(data.points)}
          link={view.link}
          button={view.button}
        />
      )}
      {data.label && box && (
        <EdgeLabelRenderer>
          <div
            key={`${box.x},${box.y}`}
            className={classes.mapChip}
            title={
              exitLabel(data.label) === data.label ? undefined : data.label
            }
            data-testid="map-chip"
            {...state}
            style={
              {
                '--chip-x': `${box.x}px`,
                '--chip-y': `${box.y}px`,
                '--chip-w': `${box.width}px`,
              } as CSSProperties
            }
          >
            {exitLabel(data.label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const MAP_EDGE_TYPES: EdgeTypes = { map: memo(MapEdgeComponent) };
