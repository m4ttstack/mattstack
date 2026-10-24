import {
  createContext,
  memo,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import { Tooltip, UnstyledButton } from '@mattstack/app-kit/core';
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
import type { BandNode } from './model/foldBand';
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

const STEP_ICON: Record<BandNode['kind'], IconName> = {
  command: 'terminal',
  question: 'diamond',
  budget: 'diamond',
  step: 'circle',
};

/** A folded link's steps as its hover card lists them. */
export function FoldSteps({
  steps,
  hint,
}: {
  steps: BandNode[];
  hint?: string;
}) {
  return (
    <div className={classes.foldTip} data-testid="fold-steps">
      <div className={classes.foldTipTitle}>
        {`${steps.length} steps folded`}
      </div>
      <ul className={classes.foldTipList}>
        {steps.map(step => (
          <li key={step.id}>
            <Icon name={STEP_ICON[step.kind]} size={12} strokeWidth={2} />
            {step.kind === 'command' ? step.text : step.label}
          </li>
        ))}
      </ul>
      {hint && <div className={classes.foldTipHint}>{hint}</div>}
    </div>
  );
}

export type JumpPillProps = {
  label: string | null;
  target: string;
  direction: 'back' | 'forward';
  pressed?: boolean;
  /** The graph-only steps the jump passes, listed on hover. */
  steps?: BandNode[];
  onClick: () => void;
};

export function JumpPill({
  label,
  target,
  direction,
  pressed,
  steps = [],
  onClick,
}: JumpPillProps) {
  const [hovered, setHovered] = useState(false);
  const way = direction === 'back' ? 'back to' : 'on to';
  const pill = (
    <UnstyledButton
      className={classes.mapPill}
      data-testid="jump-pill"
      aria-label={`${label ? `${label}: ` : ''}${way} ${target}`}
      aria-pressed={pressed}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
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
  if (steps.length === 0) return pill;
  return (
    <Tooltip
      label={<FoldSteps steps={steps} />}
      opened={hovered}
      multiline
      w={280}
      withinPortal
    >
      {pill}
    </Tooltip>
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

/** Beside a jump's target: where the jump came from, and the way back. */
export function JumpFrom({
  label,
  onBack,
}: {
  label: string;
  onBack: () => void;
}) {
  return (
    <span className={classes.mapFrom} data-testid="jump-from">
      <span className={classes.mapFromLabel}>from {label}</span>
      <UnstyledButton className={classes.mapFromBack} onClick={onBack}>
        <Icon name="arrowDown" size={11} strokeWidth={ICON_STROKE} />
        Back
      </UnstyledButton>
    </span>
  );
}

export function BlockCard({
  id,
  label,
  kind,
  dots,
  width,
  pills,
  hot,
  dim,
  ring,
  from,
  onClick,
  onHover,
}: {
  id?: string;
  label: string;
  kind: MapKind;
  dots: Dot[];
  width: number;
  pills: JumpPillProps[];
  hot?: boolean;
  dim?: boolean;
  ring?: boolean;
  from?: { label: string; onBack: () => void } | null;
  /** Opens the block; the end card opens nothing. */
  onClick?: () => void;
  onHover?: (on: boolean) => void;
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
    ...(onHover
      ? {
          onMouseEnter: () => onHover(true),
          onMouseLeave: () => onHover(false),
          onFocus: () => onHover(true),
          onBlur: () => onHover(false),
        }
      : {}),
  };
  return (
    <div
      className={classes.mapBox}
      data-testid="map-box"
      data-node={id}
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
      {from && <JumpFrom {...from} />}
    </div>
  );
}

/** A graph-only step: muted, no shadow, never a button. */
export function StepCard({
  label,
  title,
  badge,
  width,
}: {
  label: string;
  title?: string | null;
  badge: MapKind;
  width: number;
}) {
  return (
    <div
      className={classes.flowStep}
      data-testid="flow-step"
      title={title ?? undefined}
      style={{ '--card-w': `${width}px` } as CSSProperties}
    >
      <span className={classes.flowStepBadge} data-badge={badge}>
        <Icon name={BADGE_ICON[badge]} size={10} strokeWidth={ICON_STROKE} />
      </span>
      <span className={classes.flowStepLabel}>{label}</span>
    </div>
  );
}

/** A shared split: a dot where several blocks' paths part, with its long
    exits as pills beside it. The dot has no name until it is hovered. */
export function SplitDot({
  id,
  question,
  pills,
  dim,
  ring,
  from,
}: {
  id?: string;
  question: string;
  pills: JumpPillProps[];
  dim?: boolean;
  ring?: boolean;
  from?: { label: string; onBack: () => void } | null;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={classes.mapSplitBox}
      data-node={id}
      data-dim={dim || undefined}
    >
      <Tooltip label={question} opened={hovered} withinPortal>
        <span
          className={classes.mapSplit}
          data-testid="map-split"
          data-ring={ring || undefined}
          role="img"
          aria-label={question}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      </Tooltip>
      <Pills pills={pills} />
      {from && <JumpFrom {...from} />}
    </div>
  );
}

export type NodeView = {
  hot: boolean;
  dim: boolean;
  ring: boolean;
  from: { label: string; onBack: () => void } | null;
  /** The targets of the jump this node's pill made, while it shows Back. */
  jumped: string[] | null;
};

export type EdgeView = {
  hot: boolean;
  dim: boolean;
  /** The folded link this edge draws, which opens on click. */
  link: string | null;
  /** The one edge per link that carries its button; the rest only hover. */
  button: boolean;
  /** The link itself is hovered, so its button shows its steps. */
  tip: boolean;
};

export type LinkInfo = { name: string; steps: BandNode[] };

const QUIET_NODE: NodeView = {
  hot: false,
  dim: false,
  ring: false,
  from: null,
  jumped: null,
};
const QUIET_EDGE: EdgeView = {
  hot: false,
  dim: false,
  link: null,
  button: false,
  tip: false,
};

/** What a map node or edge needs from the view around it. */
export type MapActions = {
  select: (blockId: string) => void;
  /** Scrolls to `targets` and marks them, remembering `from` for Back. */
  jump: (targets: string[], from: string, fromLabel: string) => void;
  /** The open block's node, drawn lit. */
  highlight: string | null;
  /** A split question's label as the map shows it. */
  questionOf: (nodeId: string) => string;
  hover: (target: { kind: 'node' | 'link'; id: string } | null) => void;
  open: (linkId: string) => void;
  fold: () => void;
  nodeView: (nodeId: string) => NodeView;
  edgeView: (edgeId: string) => EdgeView;
  linkInfo: (linkId: string) => LinkInfo | null;
};

export const MapActionsContext = createContext<MapActions>({
  select: () => {},
  jump: () => {},
  highlight: null,
  questionOf: id => id,
  hover: () => {},
  open: () => {},
  fold: () => {},
  nodeView: () => QUIET_NODE,
  edgeView: () => QUIET_EDGE,
  linkInfo: () => null,
});

export type MapFlowNode = Node<{ box: MapBox }, 'card' | 'split'>;
export type JunctionFlowNode = Node<Record<string, never>, 'junction'>;

export function Handles() {
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

function usePills(box: MapBox, fromLabel: string): JumpPillProps[] {
  const { jump, nodeView, linkInfo } = useContext(MapActionsContext);
  const jumped = nodeView(box.node.id).jumped?.join('\u0000');
  return box.pills.map(pill => ({
    label: pill.label,
    target: pill.target,
    direction: pill.direction,
    pressed: jumped === pill.targets.join('\u0000') || undefined,
    steps: linkInfo(pill.id)?.steps,
    onClick: () => jump(pill.targets, box.node.id, fromLabel),
  }));
}

function CardNode({ data: { box } }: NodeProps<MapFlowNode>) {
  const { select, hover, nodeView } = useContext(MapActionsContext);
  const pills = usePills(box, box.node.label);
  const view = nodeView(box.node.id);
  const { blockId, id } = box.node;
  return (
    <>
      <BlockCard
        id={id}
        label={box.node.label}
        kind={box.node.kind}
        dots={box.dots}
        width={box.width}
        pills={pills}
        hot={view.hot}
        dim={view.dim}
        ring={view.ring}
        from={view.from}
        onClick={blockId ? () => select(blockId) : undefined}
        onHover={on => hover(on ? { kind: 'node', id } : null)}
      />
      <Handles />
    </>
  );
}

function SplitNode({ data: { box } }: NodeProps<MapFlowNode>) {
  const { questionOf, nodeView } = useContext(MapActionsContext);
  const question = questionOf(box.node.id);
  const pills = usePills(box, question);
  const view = nodeView(box.node.id);
  return (
    <>
      <SplitDot
        id={box.node.id}
        question={question}
        pills={pills}
        dim={view.dim}
        ring={view.ring}
        from={view.from}
      />
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
