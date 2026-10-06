import { Tooltip } from '@mattstack/tui-kit';
import { ALL_TURN, type TurnConfig } from '../../turn.ts';
import type { ShowItem } from '../../view.ts';
import { showLabel, type ShowMenuModel } from './Controls.tsx';

/** A long enough hover that sweeping across the row doesn't flash tips. */
const TIP_DELAY_MS = 1000;

/** What each chip covers, in a person's words, in one short line. */
export function showTip(item: ShowItem, turn: TurnConfig): string {
  switch (item) {
    case 'posted':
      return 'Posted to the team Slack channel.';
    case 'notPosted':
      return 'Not posted to the team channel.';
    case 'authorTurn':
      return turn.author.length === 0
        ? 'No signal counts as the author’s move in Display Settings, so this covers nothing.'
        : 'MRs waiting on the author to act. Display Settings picks what counts.';
    case 'myDrafts':
      return 'Show or hide your own draft MRs. Other users’ drafts are never shown.';
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
                data-empty={show.counts[item] === 0 || undefined}
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
