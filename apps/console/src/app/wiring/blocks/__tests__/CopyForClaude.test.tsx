import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyForClaude } from '../CopyForClaude';
import { buildBlockContext } from '../model/brief';
import { miniPayload } from './blocksFixture';

const block = miniPayload.blocks.find(b => b.id === 'mini/gate')!;
const brief = buildBlockContext({ payload: miniPayload, block });

const mockClipboard = (writeText: ReturnType<typeof vi.fn>) =>
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });

afterEach(() => vi.restoreAllMocks());

describe('CopyForClaude', () => {
  it('copies the brief and shows it in a popover', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    renderWithProviders(<CopyForClaude payload={miniPayload} block={block} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy for Claude' })
    );
    expect(
      await screen.findByText('Copied. Paste it into Claude')
    ).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(brief);
    expect(
      screen.getByText('Add what you want changed after the last line')
    ).toBeTruthy();
    expect(screen.getByText(/Block: mini\/gate/)).toBeTruthy();
  });

  it('still shows the brief when the clipboard write fails', async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    renderWithProviders(<CopyForClaude payload={miniPayload} block={block} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy for Claude' })
    );
    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
    expect(screen.queryByText('Copied. Paste it into Claude')).toBeNull();
    expect(screen.getByText(/Block: mini\/gate/)).toBeTruthy();
  });
});
