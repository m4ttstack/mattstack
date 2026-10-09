import { Icon } from '@mattstack/tui-kit';
import { CIRCLE_ARROW_UP } from './icons.ts';
import { behindRows, updateStripText, type Row } from './logic.ts';

/** The head of the mattstack section's panel: how many apps have new code
    since their last deploy. Renders nothing when none do. */
export function UpdateStrip({ rows }: { rows: Row[] }) {
  const count = behindRows(rows).length;
  if (count === 0) return null;
  return (
    <div data-block="update-strip" className="update-strip">
      <Icon d={CIRCLE_ARROW_UP} className="update-strip-icon" />
      <span className="update-strip-text">{updateStripText(count)}</span>
    </div>
  );
}
