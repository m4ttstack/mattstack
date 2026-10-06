import { act, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { SettingsEmbedModal } from './SettingsEmbedModal';

test('frames the named console group, in the page scheme', async () => {
  renderWithProviders(
    <SettingsEmbedModal
      opened
      onClose={() => {}}
      group="chat"
      title="chat settings"
      origin="https://console.example"
    />
  );
  const src = new URL(
    (await screen.findByTitle('chat settings')).getAttribute('src')!
  );
  expect(src.origin).toBe('https://console.example');
  expect(src.pathname).toBe('/embed/settings/chat');
  expect(['light', 'dark']).toContain(src.searchParams.get('scheme'));
});

test('mounts no frame while closed', () => {
  renderWithProviders(
    <SettingsEmbedModal
      opened={false}
      onClose={() => {}}
      group="chat"
      title="chat settings"
    />
  );
  expect(screen.queryByTitle('chat settings')).not.toBeInTheDocument();
});

test("closes on the frame's close message, and ignores other windows", async () => {
  const onClose = vi.fn();
  renderWithProviders(
    <SettingsEmbedModal
      opened
      onClose={onClose}
      group="chat"
      title="chat settings"
      origin="https://console.example"
    />
  );
  const frame = (await screen.findByTitle(
    'chat settings'
  )) as HTMLIFrameElement;
  const close = { source: 'mattstack-settings-embed', type: 'close' };
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: close, source: window })
    );
  });
  expect(onClose).not.toHaveBeenCalled();
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: close,
        source: frame.contentWindow,
      })
    );
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});
