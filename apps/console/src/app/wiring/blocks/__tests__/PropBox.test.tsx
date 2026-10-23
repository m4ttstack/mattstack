import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  PayloadBlock,
  PayloadSegment,
} from '../../../../server/blocksPayload';
import { PropBox } from '../PropBox';

type Prop = PayloadBlock['props'][number];

const prop = (over: Partial<Prop>): Prop => ({
  name: 'tiering',
  merge: 'replace',
  default: 'mattstack:model-tiering',
  contract: null,
  marker: { line: 1, col: 1 },
  values: [],
  fromDefault: false,
  ...over,
});

const seg = (layer: string, color: PayloadSegment['color'], text: string) => ({
  layer,
  color,
  prop: 'tiering',
  text,
});

describe('PropBox', () => {
  it('shows one card labelled default when a cleared override fell back', () => {
    renderWithProviders(
      <PropBox
        prop={prop({
          fromDefault: true,
          values: [
            {
              layer: 'default',
              color: 'mattstack',
              binding: 'mattstack:model-tiering',
              path: 'p',
              lines: 1,
            },
          ],
        })}
        segments={[seg('default', 'mattstack', 'Use the tiering skill.')]}
      />
    );
    const cards = screen.getAllByTestId('prop-card');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText('default')).toBeInTheDocument();
    expect(cards[0]).toHaveAttribute('data-layer', 'mattstack');
    expect(screen.queryByText('org')).not.toBeInTheDocument();
    expect(
      screen.getByText('replace · default mattstack:model-tiering')
    ).toBeInTheDocument();
  });

  it('shows org then team cards for an add prop', () => {
    renderWithProviders(
      <PropBox
        prop={prop({
          name: 'rules',
          merge: 'add',
          default: '',
          values: [
            {
              layer: 'acme',
              color: 'org',
              binding: 'a/x',
              path: 'p',
              lines: 1,
            },
            {
              layer: 'widgets',
              color: 'team',
              binding: 'b/y',
              path: 'p',
              lines: 1,
            },
          ],
        })}
        segments={[
          seg('acme', 'org', 'Org rule.'),
          seg('widgets', 'team', 'Team rule.'),
        ]}
      />
    );
    const cards = screen.getAllByTestId('prop-card');
    expect(cards.map(c => c.getAttribute('data-layer'))).toEqual([
      'org',
      'team',
    ]);
    expect(within(cards[0]).getByText('acme')).toBeInTheDocument();
    expect(within(cards[0]).getByText('a/x')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Team rule.')).toBeInTheDocument();
  });

  it('says nothing passed for an empty add prop', () => {
    renderWithProviders(
      <PropBox
        prop={prop({ name: 'rules', merge: 'add', default: '' })}
        segments={[]}
      />
    );
    expect(screen.getByText('nothing passed')).toBeInTheDocument();
    expect(screen.queryByTestId('prop-card')).not.toBeInTheDocument();
  });

  it('renders backticks as code', () => {
    renderWithProviders(
      <PropBox
        prop={prop({})}
        segments={[
          seg('default', 'mattstack', 'Invoke `mattstack:model-tiering` now.'),
        ]}
      />
    );
    expect(screen.getByText('mattstack:model-tiering').tagName).toBe('CODE');
    expect(screen.queryByText(/`/)).not.toBeInTheDocument();
  });
});
