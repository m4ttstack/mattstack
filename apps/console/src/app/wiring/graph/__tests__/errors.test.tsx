import '../../../icons';

import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillsCheck } from '../../outline';
import type { SkillsAnatomy } from '../../useWiring';
import { designFixture } from './designFixtures';

const compositionGet = vi.fn();
const checkGet = vi.fn();
const anatomyGet = vi.fn();
const changesGet = vi.fn();

vi.mock('../../../api', () => ({
  client: {
    api: {
      skills: {
        packs: {
          $get: () =>
            Promise.resolve(
              ok({
                packs: [
                  {
                    name: 'acme',
                    dir: '/fixture/packs/acme',
                    layout: 'grouped',
                  },
                ],
              })
            ),
        },
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
        anatomy: { $get: (...args: unknown[]) => anatomyGet(...args) },
        changes: { $get: (...args: unknown[]) => changesGet(...args) },
        blocks: {
          $get: () =>
            Promise.resolve({
              ok: false,
              status: 404,
              json: async () => ({ error: 'not a block tree' }),
            }),
        },
        source: { $get: vi.fn() },
        surface: {
          $get: () =>
            Promise.resolve(
              ok({ pack: 'acme', packDir: '/fixture/packs/acme', rows: [] })
            ),
          apply: { $post: vi.fn() },
        },
        sync: { $post: vi.fn() },
      },
      settings: {
        'default-editor': {
          $get: () => Promise.resolve(ok({ editor: 'zed' })),
        },
      },
    },
  },
}));

const { WiringMap } = await import('../../WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function failed(error: string) {
  return { ok: false, status: 502, json: async () => ({ error }) };
}

function serve({
  check = designFixture('check'),
}: {
  check?: SkillsCheck | Error;
} = {}) {
  const anatomies: Record<string, SkillsAnatomy> = {
    work: designFixture('anatomy.work'),
    'stage-plan': designFixture('anatomy.stage-plan'),
  };
  compositionGet.mockResolvedValue(ok(designFixture('composition')));
  checkGet.mockResolvedValue(
    check instanceof Error ? failed(check.message) : ok(check)
  );
  changesGet.mockResolvedValue(ok(designFixture('changes.clean')));
  anatomyGet.mockImplementation(({ query }: { query: { skill: string } }) =>
    Promise.resolve(
      anatomies[query.skill]
        ? ok(anatomies[query.skill])
        : failed(`no anatomy for ${query.skill}`)
    )
  );
}

function renderAt(search: string) {
  window.history.pushState(null, '', `/wiring${search}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WiringMap />
    </QueryClientProvider>
  );
  return queryClient;
}

const MAP = '?tab=graph&focus=pipeline:feature';

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = stubVirtualLayout({
    rowHeight: 19,
    viewportHeight: 380,
    contentHeight: 1000 * 19,
  });
});

afterEach(() => {
  restoreLayout();
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('pipeline map errors', () => {
  it('a pipeline that fails to load gets a centred error with Retry', async () => {
    serve();
    anatomyGet.mockResolvedValueOnce(
      failed('rt skills anatomy: the template for work could not be read')
    );
    renderAt(MAP);

    const error = await screen.findByTestId('canvas-error');
    expect(error).toHaveTextContent(
      'rt skills anatomy: the template for work could not be read'
    );
    expect(error.getAttribute('style')).toContain('bad');
    expect(screen.queryByTestId('template-node')).toBeNull();

    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('template-node')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-error')).toBeNull();
  });

  it('puts the command rt suggests on its own line, as code', async () => {
    serve();
    anatomyGet.mockResolvedValueOnce(
      failed(
        'The acme pack has no skill called work\n  next: rt skills surface list --pack acme'
      )
    );
    renderAt(MAP);

    const error = await screen.findByTestId('canvas-error');
    expect(within(error).getByTestId('canvas-error-message')).toHaveTextContent(
      /^The acme pack has no skill called work$/
    );
    expect(within(error).getByTestId('canvas-error-next')).toHaveTextContent(
      'rt skills surface list --pack acme'
    );
  });

  it('a pipeline that fails to reload keeps the canvas it already drew', async () => {
    serve();
    const queryClient = renderAt(MAP);
    await screen.findByTestId('template-node');

    anatomyGet.mockResolvedValue(failed('rt skills anatomy: timed out'));
    await queryClient
      .refetchQueries({ queryKey: ['skills', 'anatomy'] })
      .catch(() => undefined);
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['skills', 'anatomy', 'acme', 'work'])?.status
      ).toBe('error')
    );
    expect(screen.getByTestId('template-node')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-error')).toBeNull();
  });

  it('a check that fails keeps the canvas and says the status is unavailable in the header', async () => {
    serve({
      check: new Error(
        'rt skills check: pack/skills.jsonc is not valid JSONC (line 14: unexpected "}")'
      ),
    });
    renderAt(MAP);

    const header = await screen.findByTestId('focus-header');
    const alert = await within(header).findByTestId('status-unavailable');
    expect(alert).toHaveTextContent(
      'Status unavailable: rt skills check: pack/skills.jsonc is not valid JSONC (line 14: unexpected "}")'
    );
    expect(alert.getAttribute('style')).toContain('warn');
    expect(within(header).queryByTestId('focus-status')).toBeNull();
    expect(await screen.findByTestId('template-node')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('focus-list')).getByTestId('check-error')
    ).toHaveTextContent(
      'rt skills check failed, so no row below can state its drift: rt skills check: pack/skills.jsonc is not valid JSONC'
    );
  });

  it('a failed changes poll shows nothing', async () => {
    serve();
    changesGet.mockResolvedValue(
      failed('rt skills changes: /fixture/packs/acme is not a git checkout')
    );
    const queryClient = renderAt(MAP);

    await screen.findByTestId('template-node');
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['skills', 'changes', 'acme'])?.status
      ).toBe('error')
    );
    expect(screen.queryByText(/unsynced change/)).toBeNull();
    expect(screen.queryByText(/not a git checkout/)).toBeNull();
  });
});

describe('block view header errors', () => {
  it('a check that fails says the status is unavailable over the block view', async () => {
    serve({ check: new Error('rt skills check: timed out') });
    renderAt('?tab=graph&focus=stage-plan');

    await screen.findByTestId('block-view-note');
    const header = screen.getByTestId('focus-header');
    expect(
      await within(header).findByTestId('status-unavailable')
    ).toHaveTextContent('Status unavailable: rt skills check: timed out');
  });

  it('a check that fails to refresh keeps the statuses it already gave, without the alert', async () => {
    serve();
    const queryClient = renderAt('?tab=graph&focus=stage-plan');
    await screen.findByTestId('block-view-note');
    const header = screen.getByTestId('focus-header');
    expect(await within(header).findByTestId('focus-status')).toHaveTextContent(
      'in sync with installed mattstack 0.30.4'
    );

    checkGet.mockResolvedValue(failed('rt skills check: timed out'));
    await queryClient
      .refetchQueries({ queryKey: ['skills', 'check'] })
      .catch(() => undefined);
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['skills', 'check', 'acme'])?.status
      ).toBe('error')
    );
    expect(within(header).queryByTestId('status-unavailable')).toBeNull();
    expect(within(header).getByTestId('focus-status')).toHaveTextContent(
      'in sync with installed mattstack 0.30.4'
    );
  });
});
