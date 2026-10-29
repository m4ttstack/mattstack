import '../../../icons';

import type { ReactElement } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  PayloadBlock,
  PayloadSegment,
} from '../../../../server/blocksPayload';
import { PropBox } from '../PropBox';

/** The editor links read the editor setting through react-query. */
function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

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
  it("shows a fallen-back default as mattstack's, ruled grey", () => {
    render(
      <PropBox
        prop={prop({
          fromDefault: true,
          values: [
            {
              layer: 'default',
              color: 'mattstack',
              binding: 'mattstack:model-tiering',
              path: '/plugins/mattstack/skills/model-tiering/SKILL.md',
              lines: 1,
            },
          ],
        })}
        segments={[seg('default', 'mattstack', 'Use the tiering skill.')]}
        layerName={() => 'mattstack'}
      />
    );
    const bands = screen.getAllByTestId('prop-card');
    expect(bands).toHaveLength(1);
    expect(bands[0]).toHaveAttribute('data-layer', 'mattstack');
    expect(
      within(bands[0]).getByText("Tiering: mattstack's default")
    ).toBeInTheDocument();
    expect(
      within(bands[0]).getByText('model-tiering/SKILL.md')
    ).toBeInTheDocument();
  });

  it('titles a replacing value Set by its layer', () => {
    render(
      <PropBox
        prop={prop({
          default: '',
          values: [
            {
              layer: 'pack',
              color: 'team',
              binding: 'b/y',
              path: 'p',
              lines: 1,
            },
          ],
        })}
        segments={[seg('pack', 'team', 'Team tiering.')]}
        layerName={() => 'widgets'}
      />
    );
    const band = screen.getByTestId('prop-card');
    expect(band).toHaveAttribute('data-layer', 'team');
    expect(within(band).getByText('Set by widgets')).toBeInTheDocument();
    expect(
      within(band).getByText("replaces mattstack's default (none)")
    ).toBeInTheDocument();
  });

  it('shows org then team bands for an add prop, each with its source', () => {
    render(
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
    const bands = screen.getAllByTestId('prop-card');
    expect(bands.map(band => band.getAttribute('data-layer'))).toEqual([
      'org',
      'team',
    ]);
    expect(
      within(bands[0]).getByText('Rules added by acme')
    ).toBeInTheDocument();
    expect(within(bands[0]).getByText('a/x')).toBeInTheDocument();
    expect(within(bands[1]).getByText('Team rule.')).toBeInTheDocument();
  });

  it('says nothing passed for an empty add prop', () => {
    render(
      <PropBox
        prop={prop({ name: 'rules', merge: 'add', default: '' })}
        segments={[]}
      />
    );
    expect(screen.getByText('nothing passed')).toBeInTheDocument();
    expect(screen.queryByTestId('prop-card')).not.toBeInTheDocument();
  });

  it('renders backticks as code', () => {
    render(
      <PropBox
        prop={prop({})}
        segments={[
          seg('default', 'mattstack', 'Invoke `mattstack:model-tiering` now.'),
        ]}
      />
    );
    expect(
      screen.getByText('mattstack:model-tiering', { selector: 'code' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/`/)).not.toBeInTheDocument();
  });
});
