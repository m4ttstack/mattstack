import { useRef } from 'react';

import { Popover } from '@mattstack/tui-kit';
import type { BoardData } from '../../types.ts';
import { AskGlyph } from '../ask-glyph.tsx';
import {
  AsksDropdown,
  type AsksDropdownProps,
  type AsksHandlers,
} from './AsksDropdown.tsx';

export interface AsksButtonProps
  extends
    AsksHandlers,
    Pick<AsksDropdownProps, 'names' | 'confirmMs' | 'onNotice'> {
  asks: BoardData['asks'];
  open: boolean;
  onOpenChange(open: boolean): void;
  flashId: string | null;
}

/** The header's inbox: a count of waiting asks, and the dropdown under it. */
export function AsksButton({
  asks,
  open,
  onOpenChange,
  flashId,
  ...rest
}: AsksButtonProps) {
  // Focus lands on the dropdown itself, so opening it paints no ring on its
  // first link; Tab still reaches every control from there.
  const root = useRef<HTMLDivElement>(null);
  if (!asks) return null;
  const waiting = asks.pending.length;
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      sideOffset={6}
      ariaLabel="Asks for your agent"
      initialFocus={root}
      classNames={{ popup: 'tui-asks-popup' }}
      trigger={
        <button
          type="button"
          className="tui-theme-control tui-asks-button"
          aria-label={`Asks for your agent, ${waiting} waiting`}
          title="asks for your agent"
        >
          <AskGlyph name="inbox" size={16} />
          {waiting > 0 && (
            <span className="tui-asks-badge" aria-hidden>
              {waiting}
            </span>
          )}
        </button>
      }
    >
      <AsksDropdown asks={asks} flashId={flashId} rootRef={root} {...rest} />
    </Popover>
  );
}
