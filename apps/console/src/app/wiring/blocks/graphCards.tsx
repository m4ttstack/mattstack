import {
  createContext,
  memo,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import { UnstyledButton } from '@mattstack/app-kit/core';
import { Icon, type IconName } from '@mattstack/app-kit/icons';
import {
  Handle,
  Position,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';

import classes from './blocks.module.css';
import type { Dot } from './model/blockFacts';
import type { MapKind } from './model/blockMap';
import type { MapBox } from './model/mapLayout';

const ICON_STROKE = 2;

const BADGE_ICON: Record<MapKind, IconName> = {
  step: 'circle',
  question: 'diamond',
  gate: 'flag',
  end: 'check',
  split: 'circle',
};

let textContext: CanvasRenderingContext2D | null | undefined;

/** A label's width as the canvas draws it in the page's font; an estimate
    where the browser gives no 2D canvas (tests). */
export function measureText(text: string, size: number, weight: number) {
  if (textContext === undefined) {
    textContext = document.createElement('canvas').getContext('2d');
  }
  if (!textContext) return text.length * size * 0.55;
  const family = getComputedStyle(document.body).fontFamily;
  textContext.font = `${weight} ${size}px ${family}`;
  return textContext.measureText(text).width;
}

/** True once the page's web fonts have loaded, so labels measure in the font
    they draw in rather than its fallback. */
export function useFontsLoaded(): boolean {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  const [loaded, setLoaded] = useState(
    !fonts?.ready || fonts.status === 'loaded'
  );
  useEffect(() => {
    if (loaded || !fonts?.ready) return;
    let live = true;
    void fonts.ready.then(() => {
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [fonts, loaded]);
  return loaded;
}

/** A card's layer dots: the sidebar's rule, drawn in the map's fills. */
function MapDots({ dots }: { dots: Dot[] }) {
  if (dots.length === 0) return null;
  return (
    <span className={classes.mapDots} data-testid="layer-dots">
      {dots.map(dot => (
        <span
          key={dot}
          className={classes.mapDot}
          data-layer={dot}
          title={
            dot === 'org'
              ? 'The org base passes a value'
              : 'The team passes a value'
          }
        />
      ))}
    </span>
  );
}

export type JumpPillProps = {
  label: string | null;
  target: string;
  direction: 'back' | 'forward';
  pressed?: boolean;
  onClick: () => void;
};

export function JumpPill({
  label,
  target,
  direction,
  pressed,
  onClick,
}: JumpPillProps) {
  const way = direction === 'back' ? 'back to' : 'on to';
  return (
    <UnstyledButton
      className={classes.mapPill}
      data-testid="jump-pill"
      aria-label={`${label ? `${label}: ` : ''}${way} ${target}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {label && <span className={classes.mapPillLabel}>{label}</span>}
      <Icon
        name={direction === 'back' ? 'cornerUpLeft' : 'arrowRight'}
        size={11}
        strokeWidth={ICON_STROKE}
        className={classes.mapPillIcon}
      />
      <span className={classes.mapPillTarget}>{target}</span>
    </UnstyledButton>
  );
}

function Pills({ pills }: { pills: JumpPillProps[] }) {
  if (pills.length === 0) return null;
  return (
    <span className={classes.mapPills}>
      {pills.map(pill => (
        <JumpPill key={`${pill.label}:${pill.target}`} {...pill} />
      ))}
    </span>
  );
}

export function BlockCard({
  label,
  kind,
  dots,
  width,
  pills,
  hot,
  dim,
  ring,
  onClick,
}: {
  label: string;
  kind: MapKind;
  dots: Dot[];
  width: number;
  pills: JumpPillProps[];
  hot?: boolean;
  dim?: boolean;
  ring?: boolean;
  /** Opens the block; the end card opens nothing. */
  onClick?: () => void;
}) {
  const face = (
    <>
      <span className={classes.mapBadge} data-badge={kind}>
        <Icon name={BADGE_ICON[kind]} size={12} strokeWidth={ICON_STROKE} />
      </span>
      <span className={classes.mapCardLabel}>{label}</span>
      <MapDots dots={dots} />
    </>
  );
  const shared = {
    className: classes.mapCard,
    'data-testid': 'map-card',
    'data-hot': hot || undefined,
    'data-ring': ring || undefined,
    style: { '--card-w': `${width}px` } as CSSProperties,
  };
  return (
    <div
      className={classes.mapBox}
      data-testid="map-box"
      data-dim={dim || undefined}
    >
      {onClick ? (
        <UnstyledButton {...shared} onClick={onClick}>
          {face}
        </UnstyledButton>
      ) : (
        <div {...shared}>{face}</div>
      )}
      <Pills pills={pills} />
    </div>
  );
}

/** A shared split: a dot where several blocks' paths part, with its long
    exits as pills beside it. */
export function SplitDot({
  question,
  pills,
  dim,
}: {
  question: string;
  pills: JumpPillProps[];
  dim?: boolean;
}) {
  return (
    <div className={classes.mapSplitBox} data-dim={dim || undefined}>
      <span
        className={classes.mapSplit}
        data-testid="map-split"
        role="img"
        aria-label={question}
      />
      <Pills pills={pills} />
    </div>
  );
}

/** What a map node needs from the view around it. */
export type MapActions = {
  select: (blockId: string) => void;
  jump: (linkId: string) => void;
  /** The open block's node, drawn lit. */
  highlight: string | null;
  /** A split question's label as the map shows it. */
  questionOf: (nodeId: string) => string;
};

export const MapActionsContext = createContext<MapActions>({
  select: () => {},
  jump: () => {},
  highlight: null,
  questionOf: id => id,
});

export type MapFlowNode = Node<{ box: MapBox }, 'card' | 'split'>;
export type JunctionFlowNode = Node<Record<string, never>, 'junction'>;

function Handles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={classes.mapHandle}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={classes.mapHandle}
      />
    </>
  );
}

function usePills(box: MapBox): JumpPillProps[] {
  const { jump } = useContext(MapActionsContext);
  return box.pills.map(pill => ({
    label: pill.label,
    target: pill.target,
    direction: pill.direction,
    onClick: () => jump(pill.id),
  }));
}

function CardNode({ data: { box } }: NodeProps<MapFlowNode>) {
  const { select, highlight } = useContext(MapActionsContext);
  const pills = usePills(box);
  const { blockId } = box.node;
  return (
    <>
      <BlockCard
        label={box.node.label}
        kind={box.node.kind}
        dots={box.dots}
        width={box.width}
        pills={pills}
        hot={box.node.id === highlight}
        onClick={blockId ? () => select(blockId) : undefined}
      />
      <Handles />
    </>
  );
}

function SplitNode({ data: { box } }: NodeProps<MapFlowNode>) {
  const { questionOf } = useContext(MapActionsContext);
  const pills = usePills(box);
  return (
    <>
      <SplitDot question={questionOf(box.node.id)} pills={pills} />
      <Handles />
    </>
  );
}

function JunctionNode() {
  return <Handles />;
}

export const MAP_NODE_TYPES: NodeTypes = {
  card: memo(CardNode),
  split: memo(SplitNode),
  junction: memo(JunctionNode),
};
