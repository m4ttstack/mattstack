import { Button, Icon } from '@mattstack/tui-kit';
import { CLOUD, GLOBE, LAPTOP, UPLOAD } from '../icons.ts';
import {
  localHosts,
  remoteToggleTip,
  type Row,
  type StatusData,
} from '../logic.ts';
import { OptimisticSwitch } from '../optimistic.tsx';
import type { BoardState } from '../useBoardState.ts';
import type { BlockProps } from './block.ts';
import { Help } from './Help.tsx';
import { SettingsItem } from './SettingsItem.tsx';

const PUBLIC_TIP =
  "Publishes this app on your public domain through deck's Cloudflare tunnel. Off: visitors get the tunnel's 404 page.";
const RAILWAY_TIP =
  'Pushes this app to Railway so it keeps serving when this Mac is off. Needs Google sign-in; a password alone does not protect it there.';

type RemoteStatus = NonNullable<Row['remote']>['status'];

const REMOTE_STATUS: Record<RemoteStatus, { text: string; tone: string }> = {
  deploying: { text: 'deploying…', tone: 'warn' },
  verifying: { text: 'verifying…', tone: 'warn' },
  live: { text: 'live', tone: 'ok' },
  error: { text: 'error', tone: 'bad' },
};

function PublicItem({
  row,
  data,
  board,
}: {
  row: Row;
  data: StatusData;
  board: BoardState;
}) {
  const host = row.publicUrl
    ? row.publicUrl.replace(/^https?:\/\//, '')
    : `${row.name}.${row.displayTld ?? data.suffix}`;
  return (
    <SettingsItem
      icon={GLOBE}
      label={
        <>
          Public, through the tunnel <Help tip={PUBLIC_TIP} />
        </>
      }
      note={
        row.published
          ? `On: ${host} is reachable through the tunnel`
          : "Off: visitors get the tunnel's 404 page"
      }
      end={
        <OptimisticSwitch
          checked={row.published}
          mutate={() => board.onPublish(row)}
          aria-label={
            row.published ? `make ${row.name} private` : `publish ${row.name}`
          }
        />
      }
    />
  );
}

function RailwayItem({ row, board }: { row: Row; board: BoardState }) {
  const remote = row.remote ?? null;
  const tip = remoteToggleTip(row);
  const status = remote ? REMOTE_STATUS[remote.status] : null;
  const pushing =
    remote?.status === 'deploying' || remote?.status === 'verifying';
  return (
    <SettingsItem
      icon={CLOUD}
      label={
        <>
          Railway <Help tip={RAILWAY_TIP} />
        </>
      }
      note={
        remote
          ? 'Serving public traffic from Railway'
          : 'Keeps serving when this Mac is off'
      }
      end={
        <OptimisticSwitch
          checked={remote != null}
          mutate={() => board.onSetRemote(row, remote == null)}
          disabled={tip != null}
          disabledTip={tip}
          aria-label={
            remote != null
              ? `turn off remote for ${row.name}`
              : `push ${row.name} to Railway`
          }
        />
      }
    >
      {remote && status && (
        <div className="settings-remote">
          <span className="settings-remote-status" data-tone={status.tone}>
            <span className="settings-pill-dot" aria-hidden="true" />
            {status.text}
          </span>
          <Button disabled={pushing} onClick={() => board.onPushRemote(row)}>
            <Icon d={UPLOAD} width="14" height="14" />
            Push to Railway
          </Button>
        </div>
      )}
    </SettingsItem>
  );
}

export function ReachBlock({ row, data, board, blocks }: BlockProps) {
  if (!blocks.reach) return null;
  return (
    <section
      data-block="reach"
      aria-label="Who can reach it"
      className="settings-block"
    >
      <h3 className="settings-heading">Who can reach it</h3>
      <ul className="settings-list">
        <SettingsItem
          icon={LAPTOP}
          label="This Mac"
          note={localHosts(row).join(' and ')}
          end={<span className="settings-note">always</span>}
        />
        <PublicItem row={row} data={data} board={board} />
        <RailwayItem row={row} board={board} />
      </ul>
    </section>
  );
}
