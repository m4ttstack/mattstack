import { Icon, Tooltip } from '@mattstack/tui-kit';
import { HELP } from '../icons.ts';

/** A help glyph whose tooltip explains the label beside it. Focusable so a
    keyboard reaches the tip too; the kit card is aria-hidden, so the tip
    also rides the accessible name. */
export function Help({ tip }: { tip: string }) {
  return (
    <Tooltip tip={tip} className="settings-help">
      <span
        className="settings-help-icon"
        role="img"
        tabIndex={0}
        aria-label={tip}
      >
        <Icon d={HELP} width="13" height="13" />
      </span>
    </Tooltip>
  );
}
