import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';

export type LayoutNode = {
  id: string;
  width: number;
  height: number;
  parent?: string;
  anchorX?: number;
};
export type LayoutEdge = {
  id: string;
  source: string;
  target: string;
  label?: { text: string; width: number; height: number };
  /** ELK's straightness priority: higher keeps the edge straighter. */
  priority?: number;
};
export type LayoutInput = { nodes: LayoutNode[]; edges: LayoutEdge[] };
export type Box = { x: number; y: number; width: number; height: number };
export type LaidOut = {
  width: number;
  height: number;
  nodes: Record<string, Box>;
  edges: Record<string, { points: [number, number][]; label: Box | null }>;
};
export interface LayoutEngine {
  layout(input: LayoutInput): Promise<LaidOut>;
}

export const ELK_OPTIONS: Record<string, string> = {
  'org.eclipse.elk.algorithm': 'layered',
  'org.eclipse.elk.direction': 'DOWN',
  'org.eclipse.elk.edgeRouting': 'ORTHOGONAL',
  'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': '36',
  'org.eclipse.elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'org.eclipse.elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'org.eclipse.elk.spacing.nodeNode': '24',
  'org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers': '16',
  'org.eclipse.elk.edgeLabels.placement': 'TAIL',
  'org.eclipse.elk.padding': '[top=24,left=24,bottom=24,right=24]',
  // Shapes stay parent-relative (fromElk adds the offsets); edge points and
  // labels come back in root coordinates, since an INCLUDE_CHILDREN edge
  // would otherwise be relative to whichever container ELK assigns it.
  'org.eclipse.elk.json.edgeCoords': 'ROOT',
};

const topPort = (id: string) => `${id}:top`;
const bottomPort = (id: string) => `${id}:bottom`;

export function toElk(input: LayoutInput): ElkNode {
  const parents = new Set(
    input.nodes.flatMap(n => (n.parent ? [n.parent] : []))
  );
  const elkNodes = new Map<string, ElkNode>(
    input.nodes.map(n => {
      if (parents.has(n.id)) return [n.id, { id: n.id, children: [] }];
      const x = n.anchorX ?? n.width / 2;
      const port = (id: string, side: string, y: number) => ({
        id,
        x,
        y,
        width: 0,
        height: 0,
        layoutOptions: { 'org.eclipse.elk.port.side': side },
      });
      return [
        n.id,
        {
          id: n.id,
          width: n.width,
          height: n.height,
          layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_POS' },
          ports: [
            port(topPort(n.id), 'NORTH', 0),
            port(bottomPort(n.id), 'SOUTH', n.height),
          ],
        },
      ];
    })
  );

  const children: ElkNode[] = [];
  for (const n of input.nodes) {
    const parent = n.parent ? elkNodes.get(n.parent) : undefined;
    (parent?.children ?? children).push(elkNodes.get(n.id)!);
  }

  const edges: ElkExtendedEdge[] = input.edges.map(e => ({
    id: e.id,
    sources: [parents.has(e.source) ? e.source : bottomPort(e.source)],
    targets: [parents.has(e.target) ? e.target : topPort(e.target)],
    ...(e.label ? { labels: [{ ...e.label }] } : {}),
    ...(e.priority === undefined
      ? {}
      : {
          layoutOptions: {
            'org.eclipse.elk.layered.priority.straightness': String(e.priority),
          },
        }),
  }));

  return { id: 'root', layoutOptions: ELK_OPTIONS, children, edges };
}

export function fromElk(root: ElkNode): LaidOut {
  const out: LaidOut = {
    width: root.width ?? 0,
    height: root.height ?? 0,
    nodes: {},
    edges: {},
  };

  const walk = (node: ElkNode, offsetX: number, offsetY: number) => {
    for (const edge of node.edges ?? []) {
      const points: [number, number][] = (edge.sections ?? []).flatMap(s =>
        [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(
          (p): [number, number] => [p.x, p.y]
        )
      );
      const label = edge.labels?.[0];
      out.edges[edge.id] = {
        points,
        label: label
          ? {
              x: label.x ?? 0,
              y: label.y ?? 0,
              width: label.width ?? 0,
              height: label.height ?? 0,
            }
          : null,
      };
    }
    for (const child of node.children ?? []) {
      const x = offsetX + (child.x ?? 0);
      const y = offsetY + (child.y ?? 0);
      out.nodes[child.id] = {
        x,
        y,
        width: child.width ?? 0,
        height: child.height ?? 0,
      };
      walk(child, x, y);
    }
  };
  walk(root, 0, 0);
  return out;
}
