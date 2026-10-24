import { describe, expect, it } from 'vitest';

import { shipPayload } from '../__tests__/blocksFixture';
import { blockMap, type MapKind } from './blockMap';
import { mainColumn, mapLayout, pillTarget } from './mapLayout';

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
    const main = layout.edges.find(
      edge => edge.id === 'every_case_tried->record_evidence'
    )!;
    expect(main.label).toBe('yes');
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
