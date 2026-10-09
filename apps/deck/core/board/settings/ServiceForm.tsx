import { Button, ICONS } from '@mattstack/tui-kit';
import type { BlockProps } from './block.ts';
import { RecentErrors } from './RecentErrors.tsx';

function RouteBlock({ row, board, blocks }: BlockProps) {
  if (!blocks.giveRoute) return null;
  return (
    <section data-block="service" aria-label="Route" className="settings-block">
      <h3 className="settings-heading">Route</h3>
      <div>
        <Button
          aria-label="give it a route…"
          onClick={() => board.openManualAdd(row.name)}
        >
          {ICONS.plus}
          give it a route…
        </Button>
      </div>
    </section>
  );
}

export function ServiceForm(props: BlockProps) {
  return (
    <div className="settings-stack">
      <RouteBlock {...props} />
      <RecentErrors {...props} />
    </div>
  );
}
