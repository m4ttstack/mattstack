import { describe, expect, it } from 'vitest';

import { shipPayload } from '../__tests__/blocksFixture';
import { blockMap, type MapKind } from './blockMap';
import {
  CARD,
  fitZoom,
  mainColumn,
  mapLayout,
  MIN_MAP_ZOOM,
  pillTarget,
} from './mapLayout';

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

describe('mainColumn', () => {
  it("follows trunk mains and each split's first-declared exit to the end", () => {
    expect(mainColumn(map, graph).nodes).toEqual([
      'reopened_recapture',
      'domain_steps_before_gate',
      'gate_ship',
      'commit_named_files',
      'domain_fast_checks',
      'domain_rebases_unfinished',
      'create_forge_host',
      'mr_create',
      'browser_case',
      'capture_after_browser',
      'every_case_tried',
      'record_evidence',
      'attach_evidence',
      'write_title_description',
      'domain_runs_ci',
      'run_watch_ci',
      'gate_mark_ready',
      'shipped',
    ]);
  });
});

describe('pillTarget', () => {
  const jump = (from: string) =>
    map.links.find(link => link.from === from && link.kind !== 'line')!;

  it('names one target by its label', () => {
    expect(pillTarget(jump('gate_ship'), map, graph)).toBe('Domain steps');
  });

  it('names several targets by their shared leading word', () => {
    expect(pillTarget(jump('reopened_recapture'), map, graph)).toBe('Capture');
  });

  it("names a split without the question's trailing parenthetical", () => {
    const into = map.links.find(
      link =>
        link.from === 'gate_which_forge' && link.to[0] === 'create_forge_host'
    )!;
    expect(pillTarget(into, map, graph)).toBe('Forge host?');
  });

  it("names a split by its short label, as the dot's tooltip does", () => {
    const named = {
      ...map,
      nodes: map.nodes.map(node =>
        node.id === 'create_forge_host'
          ? { ...node, label: 'Forge host (ship)?' }
          : node
      ),
    };
    const into = map.links.find(
      link =>
        link.from === 'gate_which_forge' && link.to[0] === 'create_forge_host'
    )!;
    expect(pillTarget(into, named, graph)).toBe('Forge host?');
  });
});

describe('mapLayout', () => {
  it('chains one junction per trunk split, in flow order', () => {
    expect(layout.junctions).toContain(
      'gate_ship->commit_named_files@dirty_answer'
    );
    const chain = layout.edges.filter(edge =>
      edge.id.startsWith('gate_ship->commit_named_files')
    );
    expect(chain.map(edge => [edge.from, edge.to])).toEqual([
      ['gate_ship', 'gate_ship->commit_named_files@dirty_answer'],
      ['gate_ship->commit_named_files@dirty_answer', 'commit_named_files'],
    ]);
  });

  it('gives a split trunk main its exit label and no arrow into a split', () => {
    const trunk = layout.edges.filter(edge =>
      edge.id.startsWith('every_case_tried->record_evidence')
    );
    expect(trunk.map(edge => [edge.from, edge.label])).toEqual([
      ['every_case_tried', 'yes'],
      ['every_case_tried->record_evidence@after_captured', null],
    ]);
    const intoSplit = layout.edges.find(
      edge => edge.id === 'mr_create->browser_case'
    )!;
    expect(intoSplit.arrow).toBe(false);
  });

  it('keeps room for the pills beside a card and anchors ports at its centre', () => {
    const ship = layout.input.nodes.find(node => node.id === 'gate_ship')!;
    const box = layout.boxes.get('gate_ship')!;
    expect(box.pills).toHaveLength(1);
    expect(ship.width).toBeGreaterThan(box.width + 8);
    expect(ship.anchorX).toBe(box.width / 2);
  });

  it('asks ELK to keep main-column edges straight', () => {
    const edge = layout.input.edges.find(
      e => e.id === 'domain_steps_before_gate->gate_ship'
    )!;
    expect(edge.priority).toBe(20);
    const side = layout.input.edges.find(
      e => e.id === 'stash_them->domain_fast_checks'
    )!;
    expect(side.priority).toBeUndefined();
  });
});

describe('cards', () => {
  it('a side card is as wide as its text plus padding, badge and both borders', () => {
    const box = layout.boxes.get('stash_them')!;
    expect(box.main).toBe(false);
    expect(box.width).toBe(
      Math.ceil(
        2 * CARD.border +
          CARD.padLeft +
          CARD.badge +
          CARD.badgeGap +
          measure('Stash them', 13) +
          CARD.goGap +
          CARD.go +
          CARD.padRight
      )
    );
  });
});

describe('fitZoom', () => {
  it('fits a wide map down to the floor, and never past full size', () => {
    expect(fitZoom(1000, 800)).toBe(1);
    expect(fitZoom(900, 1000)).toBe(0.9);
    expect(fitZoom(500, 1000)).toBe(MIN_MAP_ZOOM);
    expect(fitZoom(0, 1000)).toBe(1);
  });
});
