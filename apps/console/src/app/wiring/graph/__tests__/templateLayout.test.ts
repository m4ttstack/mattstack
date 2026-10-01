// @vitest-environment node
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { LAYOUT, layoutTemplate, rowHeightOf } from '../layout/templateLayout';
import {
  buildTemplateView,
  type TemplateRow,
  type TemplateView,
} from '../model/templateModel';
import { designFixture } from './designFixtures';

const composition = designFixture('composition');
const check = designFixture('check');
const changes = designFixture('changes.clean');

const workView = () =>
  buildTemplateView({
    anatomy: designFixture('anatomy.work'),
    composition,
    check,
    changes,
    step: null,
  });
const planView = () =>
  buildTemplateView({
    anatomy: designFixture('anatomy.stage-plan'),
    composition,
    check,
    changes,
    step: 2,
  });

/** The boards draw the template node 124px down the stage; the layout starts
    it at 0, so a board's y is the layout's y plus this. */
const BOARD_TEMPLATE_Y = 124;
const fromBoard = (boardY: number) => boardY - BOARD_TEMPLATE_Y;

const nodeOf = (nodes: Node[], id: string) => {
  const node = nodes.find(n => n.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
};
const ofType = (nodes: Node[], type: string) =>
  nodes.filter(node => node.type === type);

const rowCentres = (view: TemplateView) => {
  const centres = new Map<string, number>();
  let top: number = LAYOUT.headerH;
  for (const row of view.rows) {
    const height = rowHeightOf(view, row);
    centres.set(row.id, top + height / 2);
    top += height;
  }
  return centres;
};

describe('the layout constants', () => {
  it('are the board measurements', () => {
    expect(LAYOUT).toEqual({
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
    });
  });
});

describe('row heights', () => {
  it('follow the row kind', () => {
    const view = workView();
    const heightOf = (line: number) =>
      rowHeightOf(
        view,
        view.rows.find(row => row.line === line)!
      );
    expect(heightOf(1)).toBe(24);
    expect(heightOf(29)).toBe(46);
    expect(heightOf(40)).toBe(30);
    expect(heightOf(246)).toBe(30);
  });

  it('give a step template taller placeholder rows, as its board draws them', () => {
    const view = planView();
    const heights = view.rows.map(row => rowHeightOf(view, row));
    expect(heights).toEqual([24, 32, 24, 32, 24, 32, 24, 32, 24, 32]);
  });
});

describe('the work layout', () => {
  const view = workView();
  const { nodes, edges, height } = layoutTemplate(view);

  it('puts the template node at the origin of its column', () => {
    const template = nodeOf(nodes, 'template');
    expect(template.type).toBe('template');
    expect(template.position).toEqual({ x: LAYOUT.templateX, y: 0 });
    expect(template.data).toEqual({ view });
  });

  it('draws one node per input and per link, and no output', () => {
    expect(ofType(nodes, 'input')).toHaveLength(4);
    expect(ofType(nodes, 'link')).toHaveLength(8);
    expect(ofType(nodes, 'output')).toHaveLength(0);
    expect(nodes).toHaveLength(13);
  });

  it('centres the run flags input on the row of its placeholder', () => {
    const flags = view.inputs.find(card => card.title === 'run flags')!;
    const node = nodeOf(nodes, `input:${flags.id}`);
    const rowCentre = rowCentres(view).get(flags.rowId)!;
    expect(node.position.x).toBe(LAYOUT.inputX);
    expect(node.position.y + LAYOUT.cardH / 2).toBe(rowCentre);
    expect(rowCentre).toBe(fromBoard(595));
    expect(node.position.y).toBe(fromBoard(575));
  });

  it('places the four inputs where the board does', () => {
    const ys = ofType(nodes, 'input').map(node => node.position.y);
    expect(ys).toEqual([575, 629, 683, 737].map(fromBoard));
    expect(ofType(nodes, 'input').map(node => node.position.x)).toEqual([
      40, 40, 40, 40,
    ]);
  });

  it('puts every link card at the right column, on its row', () => {
    const links = ofType(nodes, 'link');
    expect(links.map(node => node.position.x)).toEqual(
      Array(8).fill(LAYOUT.rightX)
    );
    expect(links.map(node => node.position.y)).toEqual(
      [191, 237, 283, 329, 375, 421, 467, 513].map(fromBoard)
    );
  });

  it('carries each card as node data', () => {
    expect(
      ofType(nodes, 'input').map(node => (node.data as { card: unknown }).card)
    ).toEqual(view.inputs);
    expect(
      ofType(nodes, 'link').map(node => (node.data as { card: unknown }).card)
    ).toEqual(view.links);
  });

  it('draws the canvas as tall as the lowest card or the template', () => {
    expect(height).toBe(fromBoard(737) + LAYOUT.cardH);
    const templateBottom =
      LAYOUT.headerH +
      view.rows.reduce((sum, row) => sum + rowHeightOf(view, row), 0);
    expect(templateBottom).toBe(648);
    expect(height).toBeGreaterThanOrEqual(templateBottom);
  });

  it('wires inputs into the template and the template out to its links', () => {
    const rowIds = new Set(view.rows.map(row => row.id));
    const inputEdges = edges.filter(edge => edge.target === 'template');
    const linkEdges = edges.filter(edge => edge.source === 'template');
    expect(inputEdges).toHaveLength(4);
    expect(linkEdges).toHaveLength(8);
    expect(edges).toHaveLength(12);
    for (const edge of inputEdges) {
      expect(nodeOf(nodes, edge.source).type).toBe('input');
      expect(edge.targetHandle).toMatch(/^row:/);
      expect(rowIds.has(edge.targetHandle!.slice('row:'.length))).toBe(true);
    }
    for (const edge of linkEdges) {
      expect(nodeOf(nodes, edge.target).type).toBe('link');
      expect(edge.sourceHandle).toMatch(/^row:/);
      expect(rowIds.has(edge.sourceHandle!.slice('row:'.length))).toBe(true);
    }
  });

  it('joins each card to the row its model names', () => {
    for (const card of view.inputs) {
      const edge = edges.find(e => e.source === `input:${card.id}`)!;
      expect(edge.targetHandle).toBe(`row:${card.rowId}`);
    }
    for (const card of view.links) {
      const edge = edges.find(e => e.target === card.id)!;
      expect(edge.sourceHandle).toBe(`row:${card.rowId}`);
    }
  });
});

describe('the plan layout', () => {
  const view = planView();
  const { nodes, edges, height } = layoutTemplate(view);

  it('puts the output node beside the template', () => {
    const output = nodeOf(nodes, 'output');
    expect(output.type).toBe('output');
    expect(output.position).toEqual({ x: LAYOUT.rightX, y: 0 });
    expect(output.data).toEqual({ output: view.output });
    expect(ofType(nodes, 'link')).toHaveLength(0);
  });

  it('leaves the template by the out handle with a render label', () => {
    const render = edges.find(edge => edge.target === 'output')!;
    expect(render.source).toBe('template');
    expect(render.sourceHandle).toBe('out');
    expect(render.label).toBe('render');
  });

  it('places the five inputs where the board does', () => {
    const inputs = ofType(nodes, 'input');
    expect(inputs.map(node => node.position.y)).toEqual(
      [184, 240, 296, 352, 408].map(fromBoard)
    );
    expect(inputs.map(node => node.position.x)).toEqual(Array(5).fill(40));
    expect(height).toBe(fromBoard(408) + LAYOUT.cardH);
  });

  it('draws only edges whose row handle exists, plus the out edge', () => {
    const rowIds = new Set(view.rows.map(row => row.id));
    const rowEdges = edges.filter(edge => edge.target !== 'output');
    expect(rowEdges).toHaveLength(5);
    for (const edge of rowEdges) {
      expect(rowIds.has(edge.targetHandle!.slice('row:'.length))).toBe(true);
    }
    expect(edges).toHaveLength(6);
  });
});

describe('every layout', () => {
  const layouts: [string, TemplateView][] = [
    ['work', workView()],
    ['plan', planView()],
  ];

  it.each(layouts)('gives the %s nodes and edges unique ids', (_, view) => {
    const { nodes, edges } = layoutTemplate(view);
    expect(new Set(nodes.map(node => node.id)).size).toBe(nodes.length);
    expect(new Set(edges.map(edge => edge.id)).size).toBe(edges.length);
  });

  it.each(layouts)(
    'draws %s edges as default curves with a closed arrow',
    (_, view) => {
      const { edges } = layoutTemplate(view);
      const plain = (edge: Edge) => [edge.type, edge.markerEnd];
      for (const edge of edges) {
        expect(plain(edge)).toEqual([
          'default',
          { type: MarkerType.ArrowClosed },
        ]);
      }
    }
  );

  it.each(layouts)('keeps %s edges between nodes that exist', (_, view) => {
    const { nodes, edges } = layoutTemplate(view);
    const ids = new Set(nodes.map(node => node.id));
    for (const edge of edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it.each(layouts)(
    'ignores template line numbers when placing %s',
    (_, view) => {
      const legacy: TemplateView = {
        ...view,
        rows: view.rows.map((row): TemplateRow =>
          row.kind === 'text'
            ? { ...row, templateLines: null }
            : { ...row, templateLine: null }
        ),
      };
      const positions = (v: TemplateView) =>
        layoutTemplate(v).nodes.map(node => [node.id, node.position]);
      expect(positions(legacy)).toEqual(positions(view));
    }
  );

  it('keeps a repeated link target as its own node', () => {
    const view = workView();
    const twice: TemplateView = {
      ...view,
      links: [
        ...view.links,
        { ...view.links[0]!, rowId: view.links[1]!.rowId },
      ],
    };
    const { nodes } = layoutTemplate(twice);
    expect(new Set(nodes.map(node => node.id)).size).toBe(nodes.length);
  });
});
