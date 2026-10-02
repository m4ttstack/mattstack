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
      cardGap: 6,
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
    const node = nodeOf(nodes, flags.id);
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
      const edge = edges.find(e => e.source === card.id)!;
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

  it.each(layouts)('names each card node by its card id (%s)', (_, view) => {
    const { nodes } = layoutTemplate(view);
    const cards = [...view.inputs, ...view.links];
    const cardNodes = [...ofType(nodes, 'input'), ...ofType(nodes, 'link')];
    expect(cardNodes.map(node => node.id).sort()).toEqual(
      cards.map(card => card.id).sort()
    );
    for (const node of cardNodes) {
      expect((node.data as { card: { id: string } }).card.id).toBe(node.id);
    }
  });
});

describe('a template that links one skill twice', () => {
  const view = buildTemplateView({
    anatomy: (() => {
      const anatomy = designFixture('anatomy.work');
      const plan = anatomy.parts.find(
        part => part.kind === 'verb.path' && part.name === 'stage-plan'
      )!;
      return {
        ...anatomy,
        parts: [...anatomy.parts, { ...plan, templateLines: [300, 300] }],
      };
    })(),
    composition,
    check,
    changes,
    step: null,
  });
  const { nodes, edges } = layoutTemplate(view);

  it('keeps two nodes and two edges, each with its own id', () => {
    const plans = view.links.filter(card => card.skill === 'stage-plan');
    expect(plans).toHaveLength(2);
    expect(plans.map(card => nodeOf(nodes, card.id).id)).toEqual(
      plans.map(card => card.id)
    );
    expect(new Set(nodes.map(node => node.id)).size).toBe(nodes.length);
    expect(new Set(edges.map(edge => edge.id)).size).toBe(edges.length);
  });

  it('leaves the template by the row of each repeat', () => {
    const plans = view.links.filter(card => card.skill === 'stage-plan');
    for (const card of plans) {
      const edge = edges.find(e => e.target === card.id)!;
      expect(edge.sourceHandle).toBe(`row:${card.rowId}`);
    }
    expect(plans[0]!.rowId).not.toBe(plans[1]!.rowId);
  });
});

describe('cards on rows closer together than a card', () => {
  const plan = designFixture('anatomy.stage-plan');
  const part = (name: string) => plan.parts.find(p => p.name === name)!;
  type Part = (typeof plan.parts)[number];
  const viewOf = (parts: Part[]) =>
    buildTemplateView({
      anatomy: { ...plan, parts },
      composition,
      check,
      changes,
      step: 2,
    });
  const onLines = (p: Part, from: number, to = from): Part => ({
    ...p,
    templateLines: [from, to],
  });
  const rendered = (p: Part, from: number, to: number): Part => ({
    ...p,
    templateLines: null,
    renderedLines: [from, to],
  });
  const stackOf = (view: TemplateView) =>
    ofType(layoutTemplate(view).nodes, 'input').map(node => node.position.y);
  const expectClear = (ys: number[]) => {
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(
        LAYOUT.cardH + LAYOUT.cardGap
      );
    }
  };

  it('keeps consecutive placeholder lines a card and a gap apart', () => {
    const view = viewOf([
      plan.parts[0]!,
      onLines(part('execution-strategy'), 10),
      onLines(part('gate-protocol'), 11),
      onLines(part('wrap-up-form'), 12),
    ]);
    const ys = stackOf(view);
    expect(ys).toHaveLength(3);
    expect(ys[0]).toBe(60);
    expectClear(ys);
  });

  it('keeps two placeholders on one line apart', () => {
    const view = viewOf([
      plan.parts[0]!,
      onLines(part('execution-strategy'), 10),
      onLines(part('gate-protocol'), 10),
    ]);
    expect(view.rows.map(row => row.id)).toEqual(['1', '10', '10.2']);
    const ys = stackOf(view);
    expect(ys[0]).toBe(60);
    expectClear(ys);
  });

  it('does not overlap a legacy engine whose parts come back to back', () => {
    const view = viewOf([
      rendered(plan.parts[0]!, 1, 3),
      rendered(part('execution-strategy'), 4, 10),
      rendered(part('gate-protocol'), 11, 20),
      rendered(part('stage.fields'), 21, 21),
      rendered(part('wrap-up-form'), 22, 30),
    ]);
    const { nodes, height } = layoutTemplate(view);
    const ys = ofType(nodes, 'input').map(node => node.position.y);
    expect(ys).toHaveLength(4);
    expectClear(ys);
    expect(height).toBeGreaterThanOrEqual(ys[3]! + LAYOUT.cardH);
  });

  it('leaves a card centred when there is room', () => {
    const spread = viewOf(plan.parts);
    const ys = stackOf(spread);
    expect(ys).toEqual([184, 240, 296, 352, 408].map(fromBoard));
  });
});

describe('a card that names no row', () => {
  it('is a model bug and throws, naming the card and the row', () => {
    const view = workView();
    const orphan = { ...view.inputs[0]!, rowId: 'nope' };
    expect(() => layoutTemplate({ ...view, inputs: [orphan] })).toThrow(
      'input card "variable:run-start.flags:work" names row "nope"'
    );
    const stray = { ...view.links[0]!, rowId: 'nope' };
    expect(() => layoutTemplate({ ...view, links: [stray] })).toThrow(
      'link card "link:stage-provision" names row "nope"'
    );
  });
});
