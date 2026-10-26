import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { BlockText, FlowRow } from '../BlockText';
import { miniPayload } from './blocksFixture';

const byId = (id: string) => {
  const block = miniPayload.blocks.find(b => b.id === id);
  if (!block) throw new Error(`no fixture block ${id}`);
  return block;
};

describe('BlockText', () => {
  it('mounts a prop box at the prop segment, after the prose', () => {
    renderWithProviders(
      <BlockText
        block={byId('mini/gate')}
        payload={miniPayload}
       
      />
    );
    const heading = screen.getByRole('heading', { name: 'Ask the gate' });
    const box = screen.getByTestId('prop-box');
    expect(
      heading.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getAllByTestId('prop-card')).toHaveLength(1);
    expect(
      screen.getByText('mattstack:model-tiering', { selector: 'code' })
    ).toBeInTheDocument();
  });

  it("joins the engine's hard-wrapped lines into one paragraph", () => {
    const run = byId('mini/run');
    const wrapped: PayloadBlock = {
      ...run,
      segments: [{ ...run.segments[0], text: 'Do the work\nfor the widget.' }],
    };
    renderWithProviders(
      <BlockText block={wrapped} payload={miniPayload} />
    );
    const body = screen.getByTestId('block-text');
    expect(body.querySelector('br')).toBeNull();
    expect(body).toHaveTextContent('Do the work for the widget.');
  });

  it("titles a value's band by the layer that passed it", () => {
    renderWithProviders(
      <BlockText block={byId('mini')} payload={miniPayload} />
    );
    const card = screen.getByTestId('prop-card');
    expect(card).toHaveTextContent(/by widgets/);
  });

  it('renders no box for a block with no markers', () => {
    renderWithProviders(
      <BlockText block={byId('mini/run')} payload={miniPayload} />
    );
    expect(screen.queryByTestId('prop-box')).not.toBeInTheDocument();
  });

  it('leaves the Mermaid graph out of the text', () => {
    renderWithProviders(
      <BlockText block={byId('mini')} payload={miniPayload} />
    );
    expect(screen.queryByText(/steps ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/flowchart/)).not.toBeInTheDocument();
    expect(screen.getByTestId('prop-box')).toBeInTheDocument();
  });

  it('puts a marker-only block boxes after the text in marker order, no prose', () => {
    const base = byId('mini');
    const mk = (name: string, line: number): PayloadBlock['props'][number] => ({
      ...base.props[0],
      name,
      marker: { line, col: 1 },
      values: [],
    });
    const block: PayloadBlock = {
      ...base,
      text: '',
      segments: [],
      props: [mk('second', 9), mk('first', 3)],
    };
    renderWithProviders(
      <BlockText block={block} payload={miniPayload} />
    );
    const boxes = screen.getAllByTestId('prop-box');
    expect(boxes.map(b => b.getAttribute('data-prop'))).toEqual([
      'first',
      'second',
    ]);
    expect(screen.getAllByText('nothing passed')).toHaveLength(2);
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});

describe('FlowRow', () => {
  it("sizes a block's graph in one row that opens the flow", () => {
    const onOpen = vi.fn();
    renderWithProviders(
      <FlowRow payload={miniPayload} blockId="mini" onOpen={onOpen} />
    );
    expect(screen.getByTestId('flow-row')).toHaveTextContent(
      '4 steps · 2 blocks · how this block runs, step by step'
    );
    fireEvent.click(screen.getByRole('button', { name: /^Flow/ }));
    expect(onOpen).toHaveBeenCalledWith('mini');
  });

  it('shows the Mermaid source on demand', () => {
    renderWithProviders(<FlowRow payload={miniPayload} blockId="mini" />);
    expect(screen.queryByTestId('graph-source')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getByTestId('graph-source')).toHaveTextContent('flowchart');
  });

  it('draws nothing for a block with no graph', () => {
    const payload: BlocksPayload = { ...miniPayload, graphs: [] };
    renderWithProviders(<FlowRow payload={payload} blockId="mini" />);
    expect(screen.queryByTestId('flow-row')).not.toBeInTheDocument();
  });
});
