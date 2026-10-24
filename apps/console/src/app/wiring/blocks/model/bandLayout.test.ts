import { describe, expect, it } from 'vitest';

import { shipPayload } from '../__tests__/blocksFixture';
import { BAND, openBand } from './bandLayout';
import { blockMap, type MapKind, type MapLink } from './blockMap';
import { mapLayout } from './mapLayout';

const graph = shipPayload.graphs.find(each => each.blockId === 'ship/flow')!;
const map = blockMap(graph, blockId => {
  const block = shipPayload.blocks.find(each => each.id === blockId)!;
  return {
    label: block.label,
    kind: block.kind as Exclude<MapKind, 'end' | 'split'>,
  };
});
const measure = (text: string, size: number) => text.length * size * 0.55;
const layout = mapLayout(map, graph, { dotsOf: () => [], measure });

const linkTo = (from: string, to: string): MapLink =>
  map.links.find(link => link.from === from && link.to.includes(to))!;

const edgeBetween = (
  edges: ReturnType<typeof openBand>['edges'],
  from: string,
  to: string
) => edges.find(edge => edge.from === from && edge.to === to);

describe('openBand', () => {
  const link = linkTo('domain_rebases_unfinished', 'resolve_conflict_files');
  const opened = openBand(layout, map, graph, link, measure);
  const bandId = opened.band!.id;

  it("replaces the link's edge with a compound node holding its steps", () => {
    expect(opened.edges.some(edge => edge.id === link.id)).toBe(false);
    const parent = opened.input.nodes.find(node => node.id === bandId)!;
    expect(parent.padding).toEqual(BAND.padding);
    expect(
      opened.input.nodes
        .filter(node => node.parent === bandId)
        .map(node => node.id)
    ).toEqual([
      'git_rebase_onto',
      'rebase_status',
      'run_budget_conflict_rounds',
    ]);
  });

  it('the source links to the first step with its exit label, and the last step to the target', () => {
    expect(
      edgeBetween(opened.edges, 'domain_rebases_unfinished', 'git_rebase_onto')
    ).toMatchObject({ label: 'yes', folded: false, arrow: true });
    expect(
      edgeBetween(opened.edges, 'git_rebase_onto', 'rebase_status')
    ).toMatchObject({ label: null, folded: false, arrow: true });
    expect(
      edgeBetween(
        opened.edges,
        'run_budget_conflict_rounds',
        'resolve_conflict_files'
      )
    ).toMatchObject({ folded: false, arrow: true });
  });

  it('band rows name a map node by its label and any other exit by its short label', () => {
    const status = opened.band!.boxes.find(
      box => box.node.id === 'rebase_status'
    )!;
    expect(status.rows).toEqual([
      {
        label: 'clean',
        target: 'Fast checks',
        to: 'domain_fast_checks',
        direction: 'back',
      },
      { label: 'error', target: 'Which exit?', to: null, direction: 'forward' },
    ]);
  });

  it('a box is tall enough for its title, rows and pills', () => {
    const status = opened.band!.boxes.find(
      box => box.node.id === 'rebase_status'
    )!;
    const node = opened.input.nodes.find(each => each.id === 'rebase_status')!;
    expect(node.height).toBe(status.height);
    expect(status.height).toBeGreaterThan(
      opened.band!.boxes.find(box => box.node.id === 'git_rebase_onto')!.height
    );
  });

  it("a trunk main's band drops the trunk and sends each branch out of the step it leaves from", () => {
    const main = linkTo('domain_rebases_unfinished', 'create_forge_host');
    const group = main.trunk!.group;
    const trunk = openBand(layout, map, graph, main, measure);

    expect(trunk.junctions.some(id => id.startsWith(`${group}@`))).toBe(false);
    expect(trunk.edges.some(edge => edge.id.startsWith(`${group}>`))).toBe(
      false
    );
    expect(
      edgeBetween(trunk.edges, 'push_result', 'gate_push_refused')
    ).toMatchObject({ label: 'refused or errored', folded: true });
    expect(
      edgeBetween(trunk.edges, 'git_remote_origin', 'create_forge_host')
    ).toMatchObject({ arrow: false });
    const push = trunk.band!.boxes.find(box => box.node.id === 'push_result')!;
    expect(push.rows.map(row => row.to)).not.toContain('gate_push_refused');
  });

  it('a command is never wider than the widest card', () => {
    const widest = Math.max(
      ...opened
        .band!.boxes.filter(box => box.node.kind !== 'command')
        .map(box => box.width)
    );
    const command = opened.band!.boxes.find(
      box => box.node.id === 'git_rebase_onto'
    )!;
    expect(command.width).toBeLessThanOrEqual(widest);
  });

  it("the band takes the link's place in input order", () => {
    const ids = opened.input.nodes.map(node => node.id);
    const source = ids.indexOf('domain_rebases_unfinished');
    expect(ids.slice(source + 1, source + 5)).toEqual([
      bandId,
      'git_rebase_onto',
      'rebase_status',
      'run_budget_conflict_rounds',
    ]);
    const before = layout.input.edges.findIndex(edge => edge.id === link.id);
    expect(opened.input.edges[before]!.id).toBe(`${bandId}:in:git_rebase_onto`);
  });

  it('keeps the main column straight through the band', () => {
    const main = linkTo('domain_rebases_unfinished', 'create_forge_host');
    const trunk = openBand(layout, map, graph, main, measure);
    const into = trunk.input.edges.find(
      edge =>
        edge.source === 'domain_rebases_unfinished' &&
        edge.target === 'needs_force_lease'
    )!;
    expect(into.priority).toBeGreaterThan(0);
  });
});
