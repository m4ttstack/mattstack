import { Button, Chip, ICONS } from '@mattstack/tui-kit';
import type { RosterMember } from '../types.ts';
import { MemberInvadr } from './MemberInvadr.tsx';

function Sidebar({
  members,
  total,
  active,
  onPick,
  onSettings,
  scopeUncovered,
  note,
  empty,
  dimEmpty = false,
  queue,
}: {
  members: RosterMember[];
  total: number;
  active: string;
  onPick: (member: string) => void;
  onSettings: () => void;
  /** Authors demanded from rt but not yet backfilled -- their counts may be
      undercounts, so the row says so instead of quietly showing a low number. */
  scopeUncovered: string[];
  /** Caption under the roster, for when it is not the configured team. */
  note?: string;
  /** What the list says when it names no one. */
  empty?: string;
  /** Fade members with nothing on this tab (the tab's dimEmpty). */
  dimEmpty?: boolean;
  /** Pending decision queue -- null when empty. Rendered above the roster
      because it means the user owes an action, not just information. */
  queue?: { count: number; open: () => void } | null;
}) {
  return (
    <nav className="tui-sidebar" aria-label="team members">
      {queue && (
        <Button
          type="button"
          className="tui-dq-open"
          variant="filled"
          intent="accent"
          onClick={queue.open}
        >
          decision queue · {queue.count}
        </Button>
      )}
      {note && <p className="tui-side-note">{note}</p>}
      <div className="tui-side-head">
        <button
          className={
            active === 'all' ? 'tui-side-item active' : 'tui-side-item'
          }
          onClick={() => onPick('all')}
        >
          <span className="tui-side-name">◉ All</span>
          <span className="tui-side-count">{total}</span>
        </button>
        <button
          className="tui-side-gear"
          onClick={onSettings}
          title="manage roster — check people in/out"
          aria-label="manage roster"
        >
          {ICONS.people}
        </button>
      </div>
      {members.length === 0 && empty && (
        <p className="tui-side-placeholder">{empty}</p>
      )}
      {members.map(m => (
        <button
          key={m.username}
          className={
            (active === m.username ? 'tui-side-item active' : 'tui-side-item') +
            (dimEmpty && m.count === 0 ? ' tui-side-empty' : '')
          }
          onClick={() => onPick(m.username)}
          title={m.name ?? m.username}
        >
          <span className="tui-side-name">
            <MemberInvadr id={m.username} className="tui-avatar" />{' '}
            {m.name ?? m.username}
          </span>
          <span className="tui-side-right">
            {scopeUncovered.includes(m.username) && (
              <Chip
                intent="warn"
                data-flag=""
                title="rt hasn't finished backfilling this author's MRs... the count may be low"
              >
                syncing
              </Chip>
            )}
            <span className="tui-side-count">{m.count}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

export { Sidebar };
