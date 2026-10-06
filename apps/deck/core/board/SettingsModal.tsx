import { useSettingsEmbed } from '@mattstack/settings-kit/react';
import { Modal } from '@mattstack/tui-kit';

/** deck's settings live in console: this frames console's deck group.
    Console owns every row, control and write. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const frame = useSettingsEmbed({
    group: 'deck',
    scheme: document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
    onClose,
  });
  return (
    <Modal
      title="deck settings"
      ariaLabel="deck settings"
      onClose={onClose}
      className="settings-modal"
    >
      <iframe
        ref={frame.ref}
        className="settings-frame"
        src={frame.src}
        title="deck settings"
        style={{ height: frame.height }}
      />
    </Modal>
  );
}
