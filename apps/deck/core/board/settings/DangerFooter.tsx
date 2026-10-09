import { Button, Icon } from '@mattstack/tui-kit';
import { TRASH } from '../icons.ts';
import type { BlockProps } from './block.ts';

/** Remove app… on the left, which opens today's RemoveConfirm stacked over
    the modal, and the save-as-you-flip note on the right whenever the modal
    has switches. */
export function DangerFooter({ row, board, blocks }: BlockProps) {
  const switches = blocks.reach || blocks.gates;
  if (!blocks.remove && !switches) return null;
  return (
    <footer className="settings-footer">
      {blocks.remove && (
        <section data-block="danger" aria-label="Remove">
          <Button
            variant="subtle"
            intent="bad"
            onClick={() => board.onRemove(row)}
          >
            <Icon d={TRASH} width="14" height="14" />
            Remove app…
          </Button>
        </section>
      )}
      {switches && (
        <span className="settings-note settings-footer-note">
          {blocks.gates
            ? 'Switches save as you flip them. Google sign-in saves when you Apply.'
            : 'Switches save as you flip them'}
        </span>
      )}
    </footer>
  );
}
