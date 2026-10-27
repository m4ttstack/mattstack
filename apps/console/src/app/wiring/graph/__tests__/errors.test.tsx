import '../../../icons';

import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { miniPayload } from '../../blocks/__tests__/blocksFixture';
import type { SkillsCheck } from '../../outline';
import type { SkillsAnatomy } from '../../useWiring';
import { designFixture } from './designFixtures';

const compositionGet = vi.fn();
const checkGet = vi.fn();
const anatomyGet = vi.fn();
const changesGet = vi.fn();
const blocksGet = vi.fn();

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
        blocks: { $get: (...args: unknown[]) => blocksGet(...args) },
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
  blockTrees = ['shepherdr'],
}: {
  check?: SkillsCheck | Error;
  /** The skills rt answers as block trees. */
  blockTrees?: string[];
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
  blocksGet.mockImplementation(({ query }: { query: { skill: string } }) =>
    Promise.resolve(
      blockTrees.includes(query.skill)
        ? ok(miniPayload)
        : {
            ok: false,
            status: 404,
            json: async () => ({ error: 'not a block tree' }),
          }
    )
  );
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

const LANDING = '?tab=graph';

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

describe('pack and skill errors', () => {
  it("says a skill's history is unavailable when its anatomy fails, and keeps its blocks", async () => {
    serve();
    renderAt('?tab=graph&focus=shepherdr');

    expect(await screen.findByTestId('block-view')).toBeInTheDocument();
    expect(await screen.findByTestId('history-unavailable')).toHaveTextContent(
      'History unavailable: no anatomy for shepherdr'
    );
  });

  it('keeps the history it already drew when the anatomy fails to reload', async () => {
    serve({ blockTrees: ['stage-plan'] });
    const queryClient = renderAt('?tab=graph&focus=stage-plan');
    expect(await screen.findByTestId('block-history')).toBeInTheDocument();

    anatomyGet.mockResolvedValue(failed('rt skills anatomy: timed out'));
    await queryClient
      .refetchQueries({ queryKey: ['skills', 'anatomy'] })
      .catch(() => undefined);
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['skills', 'anatomy', 'acme', 'stage-plan'])
          ?.status
      ).toBe('error')
    );
    expect(screen.getByTestId('block-history')).toBeInTheDocument();
    expect(screen.queryByTestId('history-unavailable')).toBeNull();
  });

  it('a check that fails keeps the landing and says the status is unavailable in the header', async () => {
    serve({
      check: new Error(
        'rt skills check: pack/skills.jsonc is not valid JSONC (line 14: unexpected "}")'
      ),
    });
    renderAt(LANDING);

    const header = await screen.findByTestId('focus-header');
    const alert = await within(header).findByTestId('status-unavailable');
    expect(alert).toHaveTextContent(
      'Status unavailable: rt skills check: pack/skills.jsonc is not valid JSONC (line 14: unexpected "}")'
    );
    expect(alert.getAttribute('style')).toContain('warn');
    expect(within(header).queryByTestId('focus-status')).toBeNull();
    expect(screen.getByTestId('block-stage')).toBeInTheDocument();
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
    const queryClient = renderAt(LANDING);

    await screen.findByTestId('focus-header');
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['skills', 'changes', 'acme'])?.status
      ).toBe('error')
    );
    expect(screen.queryByText(/unsynced change/)).toBeNull();
    expect(screen.queryByText(/not a git checkout/)).toBeNull();
    expect(screen.queryByTestId('history-tab-unsynced')).toBeNull();
    expect(screen.queryByTestId('unsynced-toast')).toBeNull();
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
