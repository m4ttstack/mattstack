import { ICONS } from '@mattstack/tui-kit';
import {
  showDescription,
  showLabel,
  TURN_SETTINGS_LABEL,
  type ShowMenuModel,
} from './Controls.tsx';

/** The Show picker: one checkbox chip per offered item, always in view, so
    what the board shows and how much each choice covers read without
    opening anything. */
export function ShowChips({
  show,
  onOpenTurnSettings,
}: {
  show: ShowMenuModel;
  onOpenTurnSettings?: () => void;
}) {
  return (
    <div className="tui-show">
      <div
        className="tui-show-chips"
        role="group"
        aria-label="show on the board"
      >
        {show.offered.map(item => {
          const on = !show.off.includes(item);
          return (
            <label
              key={item}
              className="tui-show-chip"
              data-on={on || undefined}
              title={showDescription(item, show.channel)}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => show.toggle(item)}
              />
              {showLabel(item, show.channel)}
              <span className="tui-show-count">{show.counts[item]}</span>
            </label>
          );
        })}
      </div>
      {onOpenTurnSettings && (
        <button
          type="button"
          className="tui-show-chips-settings"
          onClick={onOpenTurnSettings}
        >
          {ICONS.settings} {TURN_SETTINGS_LABEL}
        </button>
      )}
    </div>
  );
}
