import { Icon } from '@mattstack/tui-kit';
import { HELP } from '../icons.ts';
import { Tooltip } from '../Tooltip.tsx';

/** A help glyph whose tooltip explains the label beside it. The kit card is
    aria-hidden, so the tip also rides the button's accessible name. */
export function Help({ tip }: { tip: string }) {
  return (
    <Tooltip tip={tip} className="settings-help">
      <button type="button" className="settings-help-icon" aria-label={tip}>
        <Icon d={HELP} width="13" height="13" />
      </button>
    </Tooltip>
  );
}
