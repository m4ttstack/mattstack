import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Router, useSearch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import type { OrgSync } from '../../shared/settings-sync';
import { SettingsSyncContext } from './SettingsSyncProvider';
import { SyncPill } from './SyncPill';

const base: OrgSync = {
  org: 'acme',
  state: { kind: 'pushed', lastPushAt: Date.now() - 4 * 60_000 },
  pending: [],
  cantPush: [],
  lastPushAt: Date.now() - 4 * 60_000,
  pullIntervalSec: 300,
  trialBranch: null,
};

let search = '';
function Search() {
  search = useSearch();
  return null;
}

function show(
  sync: Partial<OrgSync> | null,
  push = vi.fn(async () => null as string | null)
) {
  const { hook, searchHook } = memoryLocation({ path: '/settings' });
  renderWithProviders(
    <Router hook={hook} searchHook={searchHook}>
      <SettingsSyncContext.Provider
        value={{ orgs: sync ? [{ ...base, ...sync }] : [], push }}
      >
        <SyncPill org="acme" />
        <Search />
      </SettingsSyncContext.Provider>
    </Router>
  );
  return push;
}

const pill = () => screen.getByTestId('sync-pill');

describe('SyncPill', () => {
  it('renders nothing outside the sync provider', () => {
    renderWithProviders(<SyncPill org="acme" />);
    expect(screen.queryByTestId('sync-pill')).toBeNull();
  });

  it('names each state on the pill', () => {
    show({});
    expect(pill()).toHaveTextContent('Pushed');
  });

  it('reads unknown for an org the sync read does not list', () => {
    show(null);
    expect(pill()).toHaveTextContent('Sync unknown');
  });

  it('lists waiting keys, and a key opens its row', async () => {
    show({
      state: { kind: 'waiting', count: 2 },
      pending: [
        { store: 'team:web', key: 'board.slack', change: 'changed' },
        { store: 'org', repo: 'gh/acme/web', key: 'x', change: 'added' },
      ],
    });
    expect(pill()).toHaveTextContent('2 waiting');
    await userEvent.click(pill());
    expect(
      await screen.findByText('2 changes waiting to reach acme')
    ).toBeVisible();
    expect(screen.getByText('web team')).toBeVisible();
    expect(screen.getByText('org · gh/acme/web')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'board.slack' }));
    expect(new URLSearchParams(search).get('explain')).toBe('board.slack');
  });

  it("lists what this Mac can't push", async () => {
    show({
      state: { kind: 'waiting', count: 1 },
      pending: [{ path: '.sops.yaml' }],
      cantPush: ['mattstack/org/settings.org.jsonc'],
    });
    await userEvent.click(pill());
    expect(await screen.findByTestId('sync-cant-push')).toHaveTextContent(
      'mattstack/org/settings.org.jsonc'
    );
  });

  it('a stuck push shows why, the detail and the fix, and Try again reports inline', async () => {
    const push = show(
      {
        state: { kind: 'stuck', reason: 'push-failed', detail: 'error: 403' },
        pending: [{ store: 'team:web', key: 'board.slack', change: 'changed' }],
      },
      vi.fn(async () => 'remote refused')
    );
    expect(pill()).toHaveTextContent('Not pushing');
    await userEvent.click(pill());
    expect(await screen.findByText('error: 403')).toBeVisible();
    expect(screen.getByText(/rt setup, then try again/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(push).toHaveBeenCalledWith('acme');
    expect(
      await screen.findByText(/Didn't push: remote refused/)
    ).toBeVisible();
  });

  it('a conflict offers no push, since pushing cannot settle it', async () => {
    show({ state: { kind: 'stuck', reason: 'conflict', detail: null } });
    await userEvent.click(pill());
    await screen.findByTestId('sync-detail');
    expect(
      screen.queryByRole('button', { name: /Push now|Try again/ })
    ).toBeNull();
  });

  it('Push now reports a landed push inline', async () => {
    show({ state: { kind: 'waiting', count: 1 }, pending: [{ path: 'a' }] });
    await userEvent.click(pill());
    await userEvent.click(
      await screen.findByRole('button', { name: /Push now/ })
    );
    expect(await screen.findByText('Pushed just now')).toBeVisible();
  });
});
