import {
  createContext,
  memo,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  HoverCard,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
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
import { countOf } from './model/labels';
import { jumpsLabel, type MapBox } from './model/mapLayout';

const ICON_STROKE = 2;

/** Every hover card on a graph opens after the same pause. */
export const HOVER_OPEN_MS = 500;

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

/** A tool call names the tool; a shell line keeps its words. The graph's
    trailing `(<exit>)` tag repeats the card's own via. */
function commandOf(text: string) {
  const bare = text.replace(/\s*\([^()]*\)\s*$/, '');
  return /^[a-z_]+\s*\{/.test(bare) ? bare.slice(0, bare.indexOf('{')).trim() : bare;
}

/** Where a jump or folded link goes, and each step it passes, in the map's
    own badge colours. */
export function StepsCard({
  title,
  via,
  steps,
  hint,
}: {
  title?: ReactNode;
  via?: string | null;
  steps: BandNode[];
  hint?: string;
}) {
  return (
    <div className={classes.stepsCard} data-testid="fold-steps">
      {(title || via) && (
        <div className={classes.stepsCardHead}>
          {title && <div className={classes.stepsCardTitle}>{title}</div>}
          {via && (
            <div className={classes.stepsCardVia}>
              via <span className={classes.stepsCardExit}>{via}</span>
            </div>
          )}
        </div>
      )}
      {steps.length > 0 && (
        <div className={classes.stepsCardBody}>
          <div className={classes.stepsCardLabel}>
            {`${countOf(steps.length, 'step')} folded`}
          </div>
          <ul className={classes.stepsCardList}>
            {steps.map(step => (
              <li key={step.id} className={classes.stepsCardStep}>
                <span
                  className={classes.mapBadge}
                  data-badge={
                    step.kind === 'command' || step.kind === 'step'
                      ? 'step'
                      : 'question'
                  }
                >
                  <Icon
                    name={STEP_ICON[step.kind]}
                    size={11}
                    strokeWidth={ICON_STROKE}
                  />
                </span>
                {step.kind === 'command' ? (
                  <code className={classes.stepsCardCommand} title={step.text}>
                    {commandOf(step.text)}
                  </code>
                ) : (
                  <span className={classes.stepsCardText}>{step.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hint && <div className={classes.stepsCardHint}>{hint}</div>}
    </div>
  );
}

export type JumpPillProps = {
  id: string;
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
  const way = direction === 'back' ? 'back to' : 'on to';
  const pill = (
    <UnstyledButton
      className={classes.mapPill}
      data-testid="jump-pill"
      aria-label={`${label ? `${label}: ` : ''}${way} ${target}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon
        name={direction === 'back' ? 'cornerUpLeft' : 'arrowRight'}
        size={12}
        strokeWidth={ICON_STROKE}
        className={classes.mapPillIcon}
      />
      <span className={classes.mapPillTarget}>{target}</span>
    </UnstyledButton>
  );
  // The pill names where it goes; the exit it takes, and any steps it
  // passes, show on hover.
  if (!label && steps.length === 0) return pill;
  return (
    <HoverCard
      width={300}
      position="bottom-start"
      shadow="md"
      openDelay={HOVER_OPEN_MS}
      closeDelay={60}
      withinPortal
    >
      <HoverCard.Target>{pill}</HoverCard.Target>
      <HoverCard.Dropdown p={0} className={classes.stepsCardDropdown}>
        <StepsCard
          title={
            <>
              <Icon
                name={direction === 'back' ? 'cornerUpLeft' : 'arrowRight'}
                size={13}
                strokeWidth={ICON_STROKE}
              />
              {`${direction === 'back' ? 'Back to' : 'On to'} ${target}`}
            </>
          }
          via={label}
          steps={steps}
        />
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

/** One jump is a pill naming its target; several are one chip that lists
    each jump's target and the exit it takes when opened. */
function Pills({ pills }: { pills: JumpPillProps[] }) {
  if (pills.length === 0) return null;
  if (pills.length === 1) {
    return (
      <span className={classes.mapPills}>
        <JumpPill {...pills[0]!} />
      </span>
    );
  }
  const direction = pills.every(pill => pill.direction === 'back')
    ? 'back'
    : pills.every(pill => pill.direction === 'forward')
      ? 'forward'
      : null;
  return (
    <span className={classes.mapPills}>
      <HoverCard
        width={300}
        position="bottom-start"
        shadow="md"
        openDelay={HOVER_OPEN_MS}
        closeDelay={60}
        withinPortal
      >
        <HoverCard.Target>
          <UnstyledButton className={classes.mapPill} data-testid="jumps-chip">
            <Icon
              name={direction === 'forward' ? 'arrowRight' : 'cornerUpLeft'}
              size={12}
              strokeWidth={ICON_STROKE}
              className={classes.mapPillIcon}
            />
            <span className={classes.mapPillTarget}>{jumpsLabel(pills)}</span>
            <Icon
              name="chevronDown"
              size={12}
              strokeWidth={ICON_STROKE}
              className={classes.mapPillIcon}
            />
          </UnstyledButton>
        </HoverCard.Target>
        <HoverCard.Dropdown p={0} className={classes.stepsCardDropdown}>
          <div className={classes.stepsCard}>
            <div className={classes.stepsCardHead}>
              <div className={classes.stepsCardTitle}>{jumpsLabel(pills)}</div>
            </div>
            <ul className={classes.jumpList}>
              {pills.map(pill => (
                <li key={pill.id}>
                  <UnstyledButton
                    className={classes.jumpRow}
                    onClick={pill.onClick}
                    data-testid="jump-item"
                  >
                    <Icon
                      name={
                        pill.direction === 'back' ? 'cornerUpLeft' : 'arrowRight'
                      }
                      size={13}
                      strokeWidth={ICON_STROKE}
                      className={classes.mapPillIcon}
                    />
                    <span className={classes.jumpRowText}>
                      <span className={classes.jumpTarget}>{pill.target}</span>
                      {(pill.label || (pill.steps?.length ?? 0) > 0) && (
                        <span className={classes.jumpExit}>
                          {[
                            pill.label && `via ${pill.label}`,
                            (pill.steps?.length ?? 0) > 0 &&
                              `${countOf(pill.steps!.length, 'step')} folded`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    <Icon
                      name="chevronRight"
                      size={13}
                      className={classes.jumpRowGo}
                    />
                  </UnstyledButton>
                </li>
              ))}
            </ul>
          </div>
        </HoverCard.Dropdown>
      </HoverCard>
    </span>
  );
}

/** How far a node's left edge sits from the canvas's right edge, and its
    bottom edge from the canvas's bottom, in layout px. */
export type Room = { right: number; below: number };

export const roomOf = (
  placed: { x: number; y: number; height: number },
  canvas: { width: number; height: number }
): Room => ({
  right: canvas.width - placed.x,
  below: canvas.height - placed.y - placed.height,
});

/** The chip's height and its gap from the node, as blocks.module.css draws
    them. */
const FROM_CHIP = { height: 24, gap: 6 } as const;

export type JumpFromProps = { label: string; onBack: () => void; room: Room };

/** Under a jump's target, or over it with no room below: where the jump came
    from, and the way back. It is kept inside the canvas, so it never takes
    room from the layout. */
export function JumpFrom({ label, onBack, room }: JumpFromProps) {
  return (
    <span
      className={classes.mapFrom}
      data-testid="jump-from"
      data-place={
        room.below >= FROM_CHIP.height + FROM_CHIP.gap ? 'below' : 'above'
      }
      style={{ maxWidth: room.right }}
    >
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
  from?: JumpFromProps | null;
  /** Opens the block; the end card opens nothing. */
  onClick?: () => void;
  onHover?: (on: boolean) => void;
}) {
  const face = (
    <>
      <span className={classes.mapBadge} data-badge={kind}>
        <Icon name={BADGE_ICON[kind]} size={13} strokeWidth={ICON_STROKE} />
      </span>
      <span className={classes.mapCardLabel}>{label}</span>
      <MapDots dots={dots} />
      {onClick && (
        <Icon
          name="chevronRight"
          size={12}
          strokeWidth={ICON_STROKE}
          className={classes.mapGo}
        />
      )}
    </>
  );
  const shared = {
    className: classes.mapCard,
    'data-hue': kind,
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
  from?: JumpFromProps | null;
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

export type MapFlowNode = Node<{ box: MapBox; room: Room }, 'card' | 'split'>;
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
    id: pill.id,
    label: pill.label,
    target: pill.target,
    direction: pill.direction,
    pressed: jumped === pill.targets.join('\u0000') || undefined,
    steps: linkInfo(pill.id)?.steps,
    onClick: () => jump(pill.targets, box.node.id, fromLabel),
  }));
}

function CardNode({ data: { box, room } }: NodeProps<MapFlowNode>) {
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
        from={view.from && { ...view.from, room }}
        onClick={blockId ? () => select(blockId) : undefined}
        onHover={on => hover(on ? { kind: 'node', id } : null)}
      />
      <Handles />
    </>
  );
}

function SplitNode({ data: { box, room } }: NodeProps<MapFlowNode>) {
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
        from={view.from && { ...view.from, room }}
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
