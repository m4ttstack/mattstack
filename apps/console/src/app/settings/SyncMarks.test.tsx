import '../icons';

import type { ReactNode } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OrgSync } from '../../shared/settings-sync';
import { SettingsSyncContext } from './SettingsSyncProvider';
import { NotPushedMark, SyncNote } from './SyncMarks';
import { SettingsOrgContext, SettingsTeamContext } from './useConsoleSettings';

const sync: OrgSync = {
  org: 'acme',
  state: { kind: 'waiting', count: 1 },
  pending: [
    { store: 'team:web', key: 'board.slack', change: 'changed' },
    { store: 'team:other', key: 'board.title', change: 'changed' },
  ],
  cantPush: [],
  lastPushAt: null,
  pullIntervalSec: 300,
  trialBranch: null,
};

function Wrap({ children }: { children: ReactNode }) {
  return (
    <SettingsSyncContext.Provider
      value={{ orgs: [sync], push: vi.fn(async () => null) }}
    >
      <SettingsOrgContext.Provider value="acme">
        <SettingsTeamContext.Provider value="web">
          {children}
        </SettingsTeamContext.Provider>
      </SettingsOrgContext.Provider>
    </SettingsSyncContext.Provider>
  );
}

describe('NotPushedMark', () => {
  it("marks a key waiting in this team's store", () => {
    renderWithProviders(
      <Wrap>
        <NotPushedMark settingKey="board.slack" />
      </Wrap>
    );
    expect(screen.getByTestId('not-pushed')).toHaveTextContent('not pushed');
  });

  it("leaves a key alone that waits only in another team's store", () => {
    renderWithProviders(
      <Wrap>
        <NotPushedMark settingKey="board.title" />
      </Wrap>
    );
    expect(screen.queryByTestId('not-pushed')).toBeNull();
  });
});

describe('SyncNote', () => {
  const note = (followUp: Parameters<typeof SyncNote>[0]['followUp']) => {
    renderWithProviders(
      <Wrap>
        <SyncNote followUp={followUp} />
      </Wrap>
    );
    return screen.queryByTestId('sync-note');
  };

  it('says nothing before the push starts', () => {
    expect(note('saved')).toBeNull();
    expect(note(null)).toBeNull();
  });

  it('walks pushing, then pushed', () => {
    expect(note('pushing')).toHaveTextContent('Saved · pushing to acme…');
  });

  it('names the org once pushed', () => {
    expect(note('pushed')).toHaveTextContent('Pushed to acme');
  });

  it('says why a stuck save has not left this Mac', () => {
    expect(note({ stuck: 'trial', detail: 'try-x' })).toHaveTextContent(
      'Saved on this Mac, not pushed: This Mac is on a trial branch'
    );
  });
});
