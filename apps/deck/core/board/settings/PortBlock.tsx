import { Button, TextField } from '@mattstack/tui-kit';
import type { Row } from '../logic.ts';
import { OptimisticSwitch } from '../optimistic.tsx';
import type { BoardState } from '../useBoardState.ts';
import type { BlockProps } from './block.ts';
import { escapeClearsDraft } from './escape.ts';
import { Help } from './Help.tsx';

const ASSIGNED_TIP =
  'The port deck gave this app. The route points here unless an override is set.';
const FOLLOWS_TIP =
  'On: tunnel visitors also see your dev server. Off: they keep getting the assigned port.';

function devOverrideTip(host: string, assigned: number | null): string {
  return `Send ${host} to a dev server you are running on another port. Revert to go back to ${assigned}.`;
}

/** The draft lives in board state, where it pauses polling, so it starts on
    the first keystroke rather than on focus and ends as soon as it is empty
    again. */
function DevPortInput({ row, board }: { row: Row; board: BoardState }) {
  const mine = board.editing?.app === row.name;
  const value = mine ? board.editing!.value : '';
  const submit = () => {
    if (value.trim() !== '') board.submitPort();
  };
  return (
    <span className="settings-inline-form">
      <TextField
        value={value}
        onChange={ev => {
          const next = ev.target.value;
          if (next === '') {
            board.cancelEdit();
            return;
          }
          if (!mine) board.startEdit(row);
          board.setEditValue(next);
        }}
        onKeyDown={ev => {
          if (ev.key === 'Enter') submit();
          else escapeClearsDraft(ev, value, board.cancelEdit);
        }}
        onBlur={() => {
          if (value === '') board.cancelEdit();
        }}
        inputMode="numeric"
        placeholder="e.g. 5173"
        aria-label="dev port override"
      />
      <Button disabled={value.trim() === ''} onClick={submit}>
        Route to it
      </Button>
    </span>
  );
}

function PublicFollows({ row, board }: { row: Row; board: BoardState }) {
  const override = row.override!;
  const follows = row.publicFollowsOverride;
  return (
    <div className="settings-toggle-row">
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">
          Public follows dev <Help tip={FOLLOWS_TIP} />
        </span>
        <span className="settings-note">
          {follows
            ? `On: tunnel visitors also get ${override.devPort}`
            : `Off: tunnel visitors keep getting ${override.basePort}`}
        </span>
      </span>
      <OptimisticSwitch
        checked={follows}
        mutate={() => board.onPublicFollows(row)}
        aria-label={
          follows
            ? `stop serving ${row.name}'s dev port publicly`
            : `serve ${row.name}'s dev port publicly`
        }
      />
    </div>
  );
}

/** The assigned port, and a dev override on top of it. Deck's own row never
    takes an override, so whatever override it carries stays hidden. */
export function PortBlock({ row, data, board, blocks }: BlockProps) {
  if (!blocks.port) return null;
  const host = `${row.name}.${row.displayTld ?? data.suffix}`;
  const assigned = row.override ? row.override.basePort : row.port;
  const override = blocks.overrideControls ? row.override : null;
  const note = row.self
    ? "overrides don't apply to deck itself"
    : override
      ? `${host} routes to ${override.devPort} while the override is set.`
      : blocks.portInput
        ? 'Point the route at a dev server while you work on it, then revert.'
        : null;
  const overrideLabel = (
    <dt>
      Dev override <Help tip={devOverrideTip(host, assigned)} />
    </dt>
  );

  return (
    <section data-block="port" aria-label="Port" className="settings-block">
      <div className="settings-block-head">
        <h3 className="settings-heading">Port</h3>
        {note && <p className="settings-note">{note}</p>}
      </div>
      <dl className="settings-facts">
        <dt>
          Assigned <Help tip={ASSIGNED_TIP} />
        </dt>
        <dd className="settings-mono">{assigned}</dd>
        {override && (
          <>
            {overrideLabel}
            <dd className="settings-override">
              <span className="settings-mono t-warn">{override.devPort}</span>
              <Button variant="subtle" onClick={() => board.clearPort(row)}>
                revert to {override.basePort}
              </Button>
            </dd>
          </>
        )}
        {blocks.portInput && (
          <>
            {overrideLabel}
            <dd>
              <DevPortInput row={row} board={board} />
            </dd>
          </>
        )}
      </dl>
      {override && <PublicFollows row={row} board={board} />}
    </section>
  );
}
