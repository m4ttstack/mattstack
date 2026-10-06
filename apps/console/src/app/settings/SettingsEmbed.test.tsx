import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schemaFields } from './testSchemas';
import type { ConsoleStore } from './useConsoleSettings';

const posted: unknown[] = [];
vi.mock('./embedBridge', async () => {
  const kit = await import('@mattstack/settings-kit/embed');
  return {
    embedMessage: kit.embedMessage,
    postToHost: (msg: unknown) => posted.push(msg),
  };
});

const { SettingsEmbed, announceWrites } = await import('./SettingsEmbed');

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key,
    type: 'string',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: `${key} setting.`,
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

const DEFS = [
  def('board.title'),
  def('board.staleAfterDays', { type: 'number' }),
  def('rt.runsPruneDays', { type: 'number', scopes: ['machine'] }),
];

beforeEach(() => {
  posted.length = 0;
  window.history.replaceState(null, '', '/embed/settings/board');
  vi.stubGlobal('fetch', async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.startsWith('/api/settings/explain/')
        ? { def: null, rows: [] }
        : { defs: DEFS },
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderEmbed(group = 'board') {
  return renderWithProviders(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsEmbed group={group} />
    </QueryClientProvider>
  );
}

describe('SettingsEmbed', () => {
  it('shows only its group, with no title row of its own', async () => {
    const { container } = renderEmbed();
    await waitFor(() =>
      expect(container.querySelector('[data-key="board.title"]')).not.toBeNull()
    );
    expect(container.querySelector('[data-key="rt.runsPruneDays"]')).toBeNull();
    expect(screen.queryByRole('heading', { name: /board/i })).toBeNull();
  });

  it('says so when the group has no settings', async () => {
    renderEmbed('nope');
    expect(
      await screen.findByText('No settings in the nope group.')
    ).toBeInTheDocument();
  });

  it('asks the host to close on Escape', async () => {
    renderEmbed();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(posted).toContainEqual(expect.objectContaining({ type: 'close' }));
  });

  it('leaves Escape in a field to the field', async () => {
    const { container } = renderEmbed();
    await waitFor(() =>
      expect(
        container.querySelector('[data-key="board.title"] input')
      ).not.toBeNull()
    );
    fireEvent.keyDown(
      container.querySelector('[data-key="board.title"] input')!,
      { key: 'Escape' }
    );
    expect(posted).not.toContainEqual(
      expect.objectContaining({ type: 'close' })
    );
  });

  it('reports its height to the host', async () => {
    renderEmbed();
    expect(posted).toContainEqual(expect.objectContaining({ type: 'height' }));
  });

  it('scrolls an opened row fully into view, with room under it', async () => {
    window.history.replaceState(
      null,
      '',
      '/embed/settings/board?explain=board.staleAfterDays'
    );
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    vi.stubGlobal('innerHeight', 400);
    const native = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return this.dataset.key === 'board.staleAfterDays'
        ? ({ top: 300, bottom: 450, height: 150 } as DOMRect)
        : native.call(this);
    };
    try {
      renderEmbed();
      await waitFor(() =>
        expect(scrollBy).toHaveBeenCalledWith(
          expect.objectContaining({ top: 450 - (400 - 24) })
        )
      );
    } finally {
      HTMLElement.prototype.getBoundingClientRect = native;
    }
  });
});

describe('announceWrites', () => {
  const store = (err: string | null) =>
    ({
      set: async () => err,
      unset: async () => err,
      move: async () => err,
      prune: async () => err,
    }) as unknown as ConsoleStore;

  it('tells the host about each write that lands', async () => {
    const s = announceWrites(store(null), 'board');
    await s.set('board.title', 'team', 'x');
    await s.unset('board.title', 'team');
    expect(posted).toEqual([
      expect.objectContaining({
        type: 'saved',
        key: 'board.title',
        group: 'board',
      }),
      expect.objectContaining({
        type: 'saved',
        key: 'board.title',
        group: 'board',
      }),
    ]);
  });

  it('stays quiet about a refused write and passes its error through', async () => {
    const s = announceWrites(store('nope'), 'board');
    expect(await s.set('board.title', 'team', 'x')).toBe('nope');
    expect(posted).toEqual([]);
  });
});
