import { MarkerType, type Edge, type Node } from '@xyflow/react';

import type {
  InputCard,
  LinkCard,
  OutputCard,
  TemplateRow,
  TemplateView,
} from '../model/templateModel';

/**
 * Measured from the template-work and template-plan boards. The two boards
 * draw a placeholder row at different heights, so a template that renders to
 * an output node takes `stepPlaceholderRowH`.
 */
export const LAYOUT = {
  inputX: 40,
  inputW: 330,
  cardH: 40,
  templateX: 470,
  templateW: 420,
  headerH: 40,
  textRowH: 24,
  placeholderRowH: 30,
  stepPlaceholderRowH: 32,
  linkRowH: 46,
  rightX: 990,
  rightW: 330,
  outputW: 340,
} as const;

export type InputNodeData = { card: InputCard };
export type LinkNodeData = { card: LinkCard };
export type OutputNodeData = { output: OutputCard };
export type TemplateNodeData = { view: TemplateView };

export type LayoutResult = { nodes: Node[]; edges: Edge[]; height: number };

/** Rows are laid out by kind and order only: a legacy engine's rows carry no
    template lines. */
export function rowHeightOf(view: TemplateView, row: TemplateRow): number {
  if (row.kind === 'text') return LAYOUT.textRowH;
  if (row.placeholder === 'verb.path') return LAYOUT.linkRowH;
  return view.output ? LAYOUT.stepPlaceholderRowH : LAYOUT.placeholderRowH;
}

const rowHandle = (rowId: string) => `row:${rowId}`;

const edgeBetween = (
  source: string,
  target: string,
  handles: Pick<Edge, 'sourceHandle' | 'targetHandle' | 'label'>
): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  ...handles,
  type: 'default',
  markerEnd: { type: MarkerType.ArrowClosed },
});

export function layoutTemplate(view: TemplateView): LayoutResult {
  const centres = new Map<string, number>();
  let top: number = LAYOUT.headerH;
  for (const row of view.rows) {
    const height = rowHeightOf(view, row);
    centres.set(row.id, top + height / 2);
    top += height;
  }

  const taken = new Set<string>();
  const idFor = (base: string, rowId: string) => {
    const id = taken.has(base) ? `${base}@${rowId}` : base;
    taken.add(id);
    return id;
  };
  const cardY = (rowId: string) => {
    const centre = centres.get(rowId);
    return centre === undefined ? null : centre - LAYOUT.cardH / 2;
  };

  const nodes: Node[] = [
    {
      id: 'template',
      type: 'template',
      position: { x: LAYOUT.templateX, y: 0 },
      data: { view } satisfies TemplateNodeData,
    },
  ];
  const edges: Edge[] = [];
  let height = top;

  for (const card of view.inputs) {
    const y = cardY(card.rowId);
    if (y === null) continue;
    const id = idFor(`input:${card.id}`, card.rowId);
    nodes.push({
      id,
      type: 'input',
      position: { x: LAYOUT.inputX, y },
      data: { card } satisfies InputNodeData,
    });
    edges.push(
      edgeBetween(id, 'template', { targetHandle: rowHandle(card.rowId) })
    );
    height = Math.max(height, y + LAYOUT.cardH);
  }

  for (const card of view.links) {
    const y = cardY(card.rowId);
    if (y === null) continue;
    const id = idFor(card.id, card.rowId);
    nodes.push({
      id,
      type: 'link',
      position: { x: LAYOUT.rightX, y },
      data: { card } satisfies LinkNodeData,
    });
    edges.push(
      edgeBetween('template', id, { sourceHandle: rowHandle(card.rowId) })
    );
    height = Math.max(height, y + LAYOUT.cardH);
  }

  if (view.output) {
    nodes.push({
      id: 'output',
      type: 'output',
      position: { x: LAYOUT.rightX, y: 0 },
      data: { output: view.output } satisfies OutputNodeData,
    });
    edges.push(
      edgeBetween('template', 'output', {
        sourceHandle: 'out',
        label: 'render',
      })
    );
  }

  return { nodes, edges, height };
}
