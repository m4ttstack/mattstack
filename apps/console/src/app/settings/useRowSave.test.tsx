import type { ReactNode } from 'react';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgSync } from '../../shared/settings-sync';
import { SettingsSyncContext } from './SettingsSyncProvider';
import { SettingsOrgContext, SettingsTeamContext } from './useConsoleSettings';
import { useRowSave } from './useRowSave';

const push = vi.fn<(org: string) => Promise<string | null>>();

function def(scope: string): SettingDefWire {
  return {
    key: 'board.slack',
    type: 'object',
    scopes: [scope],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: '',
    hasDefault: false,
    effective: { scope, file: '/x', value: undefined },
  } as unknown as SettingDefWire;
}

const store = {
  set: vi.fn(async () => null),
  unset: vi.fn(async () => null),
  move: vi.fn(async () => null),
};

let orgs: OrgSync[] = [];

function Wrap({ children }: { children: ReactNode }) {
  return (
    <SettingsSyncContext.Provider value={{ orgs, push }}>
      <SettingsOrgContext.Provider value="acme">
        <SettingsTeamContext.Provider value="web">
          {children}
        </SettingsTeamContext.Provider>
      </SettingsOrgContext.Provider>
    </SettingsSyncContext.Provider>
  );
}

describe('useRowSave push on save', () => {
  beforeEach(() => {
    orgs = [];
    push.mockReset();
    push.mockResolvedValue(null);
  });

  it('a save resolves before its push finishes', async () => {
    push.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRowSave(store, def('team')), {
      wrapper: Wrap,
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save('x');
    });
    expect(ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(result.current.followUp).toBe('pushing');
  });

  it('a failed push call heals once the sync data shows the key pushed', async () => {
    push.mockResolvedValue('A push for this org is still running');
    const { result, rerender } = renderHook(
      () => useRowSave(store, def('team')),
      { wrapper: Wrap }
    );
    await act(async () => {
      await result.current.save('x');
    });
    expect(result.current.followUp).toMatchObject({ stuck: 'push-failed' });
    const later = Date.now() + 1_000;
    orgs = [
      {
        org: 'acme',
        state: { kind: 'pushed', lastPushAt: later },
        pending: [],
        cantPush: [],
        lastPushAt: later,
        pullIntervalSec: 300,
        trialBranch: null,
      },
    ];
    rerender();
    expect(result.current.followUp).toBe('pushed');
  });

  it('a team save calls push once', async () => {
    const { result } = renderHook(() => useRowSave(store, def('team')), {
      wrapper: Wrap,
    });
    await act(async () => {
      await result.current.save({ channel: '#new' });
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('acme');
    expect(result.current.followUp).not.toBeNull();
  });

  it('a user save does not push', async () => {
    const { result } = renderHook(() => useRowSave(store, def('user')), {
      wrapper: Wrap,
    });
    await act(async () => {
      await result.current.save('x');
    });
    expect(push).not.toHaveBeenCalled();
    expect(result.current.followUp).toBeNull();
  });

  it('a failed save does not push', async () => {
    const failing = { ...store, set: vi.fn(async () => 'refused') };
    const { result } = renderHook(() => useRowSave(failing, def('team')), {
      wrapper: Wrap,
    });
    await act(async () => {
      await result.current.save('x');
    });
    expect(push).not.toHaveBeenCalled();
    expect(result.current.error).toBe('refused');
  });

  it('a row outside the sync provider saves without pushing', async () => {
    const { result } = renderHook(() => useRowSave(store, def('team')), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SettingsOrgContext.Provider value="acme">
          {children}
        </SettingsOrgContext.Provider>
      ),
    });
    await act(async () => {
      await result.current.save('x');
    });
    expect(push).not.toHaveBeenCalled();
    expect(result.current.followUp).toBeNull();
  });

  it('a failed push surfaces through followUp, not error', async () => {
    push.mockResolvedValue('Your role no longer owns these pending changes');
    const { result } = renderHook(() => useRowSave(store, def('org')), {
      wrapper: Wrap,
    });
    await act(async () => {
      await result.current.save('x');
    });
    expect(result.current.error).toBeNull();
    expect(result.current.followUp).toEqual({
      stuck: 'push-failed',
      detail: 'Your role no longer owns these pending changes',
    });
  });
});
