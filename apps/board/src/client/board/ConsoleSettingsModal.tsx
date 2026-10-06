import { useSettingsEmbed } from '@mattstack/settings-kit/react';
import { Modal } from '@mattstack/tui-kit';

/** The board's settings: console's board group, framed. Console owns every
    row, control and write; this modal only sizes the frame and reloads the
    board after each write lands. */
export function ConsoleSettingsModal({
  onSaved,
  onClose,
}: {
  onSaved: () => void;
  onClose: () => void;
}) {
  const frame = useSettingsEmbed({
    group: 'board',
    scheme: document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
    onSaved,
    onClose,
  });
  return (
    <Modal
      title="❯ board settings"
      ariaLabel="board settings"
      onClose={onClose}
      closeGlyph="✕"
      className="tui-console-settings-modal"
    >
      <iframe
        ref={frame.ref}
        className="tui-console-settings-frame"
        src={frame.src}
        title="board settings"
        style={{ height: frame.height }}
      />
    </Modal>
  );
}
