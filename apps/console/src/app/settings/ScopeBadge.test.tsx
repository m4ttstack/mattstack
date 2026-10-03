import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCOPE_COLOR, ScopeBadge } from './ScopeBadge';
import { SettingsOrgContext } from './useConsoleSettings';

afterEach(() => vi.restoreAllMocks());

describe('ScopeBadge', () => {
  it('gives every store its own hue', () => {
    const hues = Object.values(SCOPE_COLOR);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('shows a label cut short in the column whole in a tooltip', async () => {
    // jsdom lays nothing out, so the label's overflow is stubbed.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(117);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(65);
    renderWithProviders(<ScopeBadge scope="machine.repo" />);
    await userEvent.hover(screen.getByText('machine'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'machine · repo'
    );
  });

  it('a repo rung keeps its suffix outside the part that truncates', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80);
    renderWithProviders(
      <SettingsOrgContext.Provider value="acme-engineering-platform">
        <ScopeBadge scope="org.repo" />
      </SettingsOrgContext.Provider>
    );
    const name = screen.getByText('org (acme-engineering-platform)');
    const suffix = screen.getByText('· repo');
    expect(name).toHaveAttribute('data-truncate');
    expect(name.contains(suffix)).toBe(false);
    expect(suffix).not.toHaveAttribute('data-truncate');
    expect(suffix).toHaveStyle({ flex: 'none' });
    await userEvent.hover(name);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'org (acme-engineering-platform) · repo'
    );
  });

  it('a global layer has no suffix', () => {
    renderWithProviders(
      <SettingsOrgContext.Provider value="acme">
        <ScopeBadge scope="org" />
      </SettingsOrgContext.Provider>
    );
    expect(screen.getByText('org (acme)')).toBeInTheDocument();
    expect(screen.queryByText('· repo')).toBeNull();
  });
});
