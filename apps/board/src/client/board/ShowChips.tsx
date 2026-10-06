import { Tooltip } from '@mattstack/tui-kit';
import { ALL_TURN, type TurnConfig } from '../../turn.ts';
import type { ShowItem } from '../../view.ts';
import { showLabel, type ShowMenuModel } from './Controls.tsx';
import { AUTHOR_LABEL } from './turn-labels.ts';

/** A long enough hover that sweeping across the row doesn't flash tips. */
const TIP_DELAY_MS = 750;

function bullets(items: string[]): string {
  return items
    .map(item => `• ${item.charAt(0).toUpperCase()}${item.slice(1)}`)
    .join('\n');
}

/** What each chip covers, in a person's words; Waiting on author follows the
    whose-turn signals switched on in Display Settings. */
export function showTip(item: ShowItem, turn: TurnConfig): string {
  switch (item) {
    case 'posted':
      return 'Posted to the team Slack channel.';
    case 'notPosted':
      return 'Not posted to the team channel.';
    case 'authorTurn':
      return turn.author.length === 0
        ? 'No signal counts as the author’s move in Display Settings, so this covers nothing.'
        : `The author’s move:\n${bullets(turn.author.map(s => AUTHOR_LABEL[s]))}`;
    case 'myDrafts':
      return 'Only your own drafts, as the signed-in user. Other people’s drafts aren’t affected.';
  }
}

/** The Show picker: one checkbox chip per offered item, always in view, so
    what the board shows and how much each choice covers read without
    opening anything. */
export function ShowChips({ show }: { show: ShowMenuModel }) {
  const turn = show.turn ?? ALL_TURN;
  return (
    <div className="tui-show">
      <div
        className="tui-show-chips"
        role="group"
        aria-label="show on the board"
      >
        {show.offered.map(item => {
          const on = !show.off.includes(item);
          const tip = showTip(item, turn);
          return (
            <Tooltip key={item} tip={tip} delay={TIP_DELAY_MS}>
              <label
                className="tui-show-chip"
                data-on={on || undefined}
                aria-description={tip}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => show.toggle(item)}
                />
                <span className="tui-show-chip-label">
                  {showLabel(item, show.channel)}
                </span>
                <span className="tui-show-chip-count">{show.counts[item]}</span>
              </label>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
