import { Badge, Button, Icon, ICONS, Spinner } from '@mattstack/tui-kit';
import { CHEVRON_DOWN, GIT_BRANCH, RADIO } from '../icons.ts';
import type { Row, StatusData } from '../logic.ts';
import { Tooltip } from '../Tooltip.tsx';
import { liveCell } from './live-logic.ts';

export function LiveCell({
  row,
  data,
  now,
  onOpen,
}: {
  row: Row;
  data: StatusData;
  now: number;
  onOpen: (row: Row, opener: HTMLElement) => void;
}) {
  const cell = liveCell(row, data, now);
  switch (cell.kind) {
    case 'none':
      return null;
    case 'go':
    case 'blocked': {
      const button = (
        <Button
          size="sm"
          className="live-go"
          disabled={cell.kind === 'blocked'}
          aria-label={`run ${row.name} live`}
          onClick={e => onOpen(row, e.currentTarget)}
        >
          <Icon d={RADIO} className="live-mark" /> go live
        </Button>
      );
      return cell.kind === 'blocked' ? (
        <Tooltip tip={`Can't go live: ${cell.reason}`}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      );
    }
    case 'setup':
      return (
        <Badge intent="warn">
          <Spinner size="xs" />
          setting up {cell.branch ?? 'worktree'}
        </Badge>
      );
    case 'starting':
      return (
        <Badge intent="warn">
          <Spinner size="xs" />
          starting
        </Badge>
      );
    case 'failed':
      return (
        <button
          type="button"
          className="live-failed"
          aria-label={`${row.name} setup failed`}
          onClick={e => onOpen(row, e.currentTarget)}
        >
          <Badge intent="bad">
            {ICONS['triangle-alert']}
            setup failed
            <Icon d={CHEVRON_DOWN} />
          </Badge>
        </button>
      );
    case 'live': {
      const button = (
        <Button
          size="sm"
          className="live-source"
          aria-label={`${row.name} is live from ${cell.label}`}
          onClick={e => onOpen(row, e.currentTarget)}
        >
          <Icon d={RADIO} className="live-mark" />
          {cell.worktree && <Icon d={GIT_BRANCH} />}
          <span className="live-source-name">{cell.label}</span>
          {cell.movedFrom && (
            <span className="t-warn">{ICONS['triangle-alert']}</span>
          )}
          <Icon d={CHEVRON_DOWN} />
        </Button>
      );
      return cell.movedFrom ? (
        <Tooltip tip={`${cell.movedFrom} was deleted. Now live from main.`}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      );
    }
  }
}
