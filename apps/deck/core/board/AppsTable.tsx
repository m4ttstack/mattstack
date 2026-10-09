// The apps table and the strays table share one row template, per
// board.html.
import { useState } from 'react';

import {
  Badge,
  Button,
  Chip,
  Icon,
  ICONS,
  Spinner,
  Table,
  TextField,
  Tooltip,
} from '@mattstack/tui-kit';
import { CommandButton } from './CommandButton.tsx';
import { GLOBE } from './icons.ts';
import {
  commandKey,
  isPlatform,
  servicePid,
  showDevLinkPrompt,
  showVersionColumn,
  versionCell,
  type CommandRuns,
  type Row,
  type StatusData,
} from './logic.ts';
import { OptimisticSwitch } from './optimistic.tsx';
import type { BoardState } from './useBoardState.ts';

/** Shared column widths, one entry per column below, so every section table
    (mattstack / your apps / strays) lines up down the page: `.apps-grid`
    fixes the layout in board.css and every AppsTable renders the same
    colgroup, so the grid never sizes to each table's own content. The
    column set is page-wide (the version column follows dev mode, never the
    section), so two tables on one page always pick the same entry. */
const COL_WIDTHS = {
  plain: ['36%', '8%', '11%', '21%', '24%'],
  versioned: ['28%', '7%', '10%', '16%', '17%', '22%'],
};

export interface AppsSection {
  key: string;
  title: string | null;
  rows: Row[];
}

export interface DrawerRowProps {
  onOpenRow: (name: string) => void;
  /** Registers/unregisters a row's gear DOM node so the drawer can restore
      focus to it on close, including after the row that opened it switches
      (arrow keys) or is later removed. */
  registerGear: (name: string, el: HTMLButtonElement | null) => void;
}

export function AppsTable({
  section,
  showHead,
  data,
  board,
  onOpenRow,
  registerGear,
}: {
  section: AppsSection;
  showHead: boolean;
  data: StatusData;
  board: BoardState;
} & DrawerRowProps) {
  const {
    isRestarting,
    onRestart,
    onRunCommand,
    commandRuns,
    linkSource,
    onPublish,
  } = board;
  const versioned = showVersionColumn(data);
  const widths = versioned ? COL_WIDTHS.versioned : COL_WIDTHS.plain;
  return (
    <Table className="apps-grid">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      {/* Rendered on every section, not just the first: a headerless table
          still carries the shared colgroup, but some engines size a fixed
          table's columns off the first row rather than the colgroup alone
          when there is no header row to anchor it, drifting the later
          sections out of alignment with the first. Rendering it always and
          hiding the duplicates with `head-hidden` (zeroed box, not
          display:none) keeps every table's column-sizing input identical. */}
      <Table.Head className={showHead ? undefined : 'head-hidden'}>
        <Table.HeadCell>site</Table.HeadCell>
        <Table.HeadCell>port</Table.HeadCell>
        <Table.HeadCell>health</Table.HeadCell>
        {versioned && <Table.HeadCell>version</Table.HeadCell>}
        <Table.HeadCell className="col-gap">public</Table.HeadCell>
        <Table.HeadCell />
      </Table.Head>
      <Table.Body>
        {section.rows.map(row => {
          const restarting = isRestarting(row);
          return (
            <Table.Row key={row.name}>
              <Table.Cell className="col-ident">
                <SiteCell row={row} />
              </Table.Cell>
              <Table.Cell className="col-ident">
                <PortCell row={row} data={data} />
              </Table.Cell>
              <Table.Cell>
                <HealthCell row={row} restarting={restarting} />
              </Table.Cell>
              {versioned && (
                <Table.Cell>
                  <VersionColumnCell row={row} />
                </Table.Cell>
              )}
              <Table.Cell className="col-gap">
                <PublishCell row={row} data={data} onPublish={onPublish} />
              </Table.Cell>
              <Table.Cell align="end">
                <span className="row-actions">
                  <CommandsCell
                    row={row}
                    canManage={data.canManage}
                    onRunCommand={onRunCommand}
                    commandRuns={commandRuns}
                    linkSource={linkSource}
                  />
                  <RestartButton
                    row={row}
                    data={data}
                    restarting={restarting}
                    onRestart={onRestart}
                  />
                  <RowGear
                    row={row}
                    onOpen={() => onOpenRow(row.name)}
                    registerRef={el => registerGear(row.name, el)}
                  />
                </span>
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}

/** The row's brand mark, or a letter tile when it has none (user apps,
    strays). */
export function SiteMark({ row }: { row: Row }) {
  if (row.icon)
    return (
      <img className="site-mark" src={row.icon} alt="" aria-hidden="true" />
    );
  return (
    <span className="site-mark site-mark-letter" aria-hidden="true">
      {row.name.charAt(0)}
    </span>
  );
}

function SiteCell({ row }: { row: Row }) {
  return (
    <>
      <SiteMark row={row} />
      {row.url ? (
        <span className="site-name">
          <a className="unstyled" href={row.url}>
            <strong>{row.name}</strong>
            {row.displayTld && <span className="muted">.{row.displayTld}</span>}
          </a>
          {/* An unpublished row has a publicUrl the edge will not serve, so
              the globe is absent rather than dimmed: it is an open-this link,
              and there is nothing to open until the row is published. */}
          {row.published && row.publicUrl && row.publicUrl !== row.url && (
            <Tooltip tip={`open ${row.publicUrl.replace('https://', '')}`}>
              <a
                className="public-link"
                href={row.publicUrl}
                target="_blank"
                rel="noopener"
                aria-label={`open ${row.publicUrl.replace('https://', '')}`}
              >
                <Icon d={GLOBE} />
              </a>
            </Tooltip>
          )}
          {row.remote && (
            <Tooltip tip={`served from Railway (${row.remote.status})`}>
              <span
                className={`railway-globe railway-${row.remote.status}`}
                aria-label={`served from Railway (${row.remote.status})`}
              >
                <Icon d={GLOBE} />
              </span>
            </Tooltip>
          )}
        </span>
      ) : (
        <span className="muted">{row.name}</span>
      )}
      {/* Who owns this row's structure belongs with the row's identity, not
          in the column of things you can click. */}
      {isPlatform(row.managedBy ?? undefined) && (
        <Tooltip
          className="cell-tag"
          tip="this is Deck itself, `deck uninstall` to remove it"
        >
          <Chip
            uppercase
            aria-label="this is Deck itself, `deck uninstall` to remove it"
          >
            this board
          </Chip>
        </Tooltip>
      )}
      {(row.issues || []).map(issue => (
        <span className="preflight-issue" key={issue.source}>
          <Badge intent="bad">
            {ICONS['triangle-alert']}
            <span>{issue.source} sync failed</span>
          </Badge>
          <code className="muted">{issue.message}</code>
        </span>
      ))}
    </>
  );
}

function PortCell({ row, data }: { row: Row; data: StatusData }) {
  if (row.port == null) return <span className="muted">no route</span>;
  // The board's own row can never carry an override in practice, but the
  // dev chip still checks `self` defensively: showing "override" on the
  // board's own listing of itself would be self-contradictory.
  const override =
    row.override && data.canManage && !row.self ? row.override : null;
  return (
    <span>
      {row.port}
      {override && (
        <Tooltip
          className="cell-tag"
          tip={`dev port override, normally ${override.basePort}`}
        >
          <Chip
            uppercase
            aria-label={`dev port override, normally ${override.basePort}`}
          >
            dev
          </Chip>
        </Tooltip>
      )}
    </span>
  );
}

export const OFF_TIP =
  'Turned off. Turn it on in mattstack.app, Settings > Apps.';

export function OffBadge() {
  return (
    <Tooltip tip={OFF_TIP}>
      <Badge intent="muted">off</Badge>
    </Tooltip>
  );
}

function HealthCell({ row, restarting }: { row: Row; restarting: boolean }) {
  if (row.enabled === false) return <OffBadge />;
  if (restarting) {
    return (
      <Badge intent="warn">
        <Spinner size="xs" />
        restarting…
      </Badge>
    );
  }
  return (
    <span>
      {row.health && row.health.status === null && (
        <Tooltip tip="no response">
          <Badge intent="bad">unreachable</Badge>
        </Tooltip>
      )}
      {row.health && row.health.status !== null && (
        <Tooltip tip={`HTTP ${row.health.status}`}>
          <Badge intent={row.health.ok ? 'ok' : 'bad'}>
            {row.health.status} {row.health.ms}ms
          </Badge>
        </Tooltip>
      )}
      {/* No HTTP probe (unrouted rows): the badge falls back to the service's
          own pid, which is the only signal left to call ok/bad. */}
      {!row.health && row.service && (
        <Badge intent={servicePid(row.service) !== null ? 'ok' : 'bad'}>
          {servicePid(row.service) !== null ? 'running' : 'stopped'}
        </Badge>
      )}
      {!row.health && !row.service && <span className="muted">no route</span>}
    </span>
  );
}

/** Dev mode only: the API carries a deployed SHA only when it differs from
    the checkout's head, so a linked row without one reads as current and
    every other row is untracked. */
function VersionColumnCell({ row }: { row: Row }) {
  const cell = versionCell(row);
  if (cell.kind === 'behind') {
    return (
      <span className="version-cell">
        <span className="version-sha">{cell.deployed}</span>
        <span className="t-warn">→</span>
        <span className="version-sha t-warn">{cell.head}</span>
      </span>
    );
  }
  if (cell.kind === 'current') return <span>current</span>;
  return <span className="muted">not tracked</span>;
}

/** Marks a row already serving public traffic straight off Railway rather
    than through the cloudflared tunnel -- shown regardless of `canManage` (a
    read-only fact about how the row is served, not a control). */
function PublicOriginTag({ row }: { row: Row }) {
  if (row.publicOrigin !== 'railway') return null;
  const tip = 'serving public traffic directly from Railway, not the tunnel';
  return (
    <Tooltip className="cell-tag" tip={tip}>
      <Chip uppercase aria-label={tip}>
        public: railway
      </Chip>
    </Tooltip>
  );
}

function PublishCell({
  row,
  data,
  onPublish,
}: {
  row: Row;
  data: StatusData;
  onPublish: (row: Row) => Promise<void>;
}) {
  const tag = <PublicOriginTag row={row} />;
  if (row.enabled === false || !(data.canManage && row.port != null))
    return tag;
  const label = row.published
    ? `make ${row.name} private`
    : `publish ${row.name}`;
  const tip = row.published
    ? 'public — click to make private'
    : 'private — click to publish';
  return (
    <>
      {tag}
      <Tooltip tip={tip}>
        <OptimisticSwitch
          checked={row.published}
          mutate={() => onPublish(row)}
          aria-label={label}
        />
      </Tooltip>
    </>
  );
}

function RestartButton({
  row,
  data,
  restarting,
  onRestart,
}: {
  row: Row;
  data: StatusData;
  restarting: boolean;
  onRestart: (row: Row) => void;
}) {
  if (row.enabled === false || !(data.canRestart && row.service)) return null;
  return (
    <Tooltip tip="Restart service">
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        className="row-icon"
        disabled={restarting}
        aria-label={`restart ${row.service.short}`}
        onClick={() => onRestart(row)}
      >
        {ICONS['refresh-cw']}
      </Button>
    </Tooltip>
  );
}

/** Dev-mode source linking replaces the manifest command buttons rather than
    sharing the cell with them: `unlinked`/`broken` rows have nothing else to
    run yet. Unlink lives in the settings modal's Code block, not here: the
    table carries commands and the link-fix affordance only. */
function CommandsCell({
  row,
  canManage,
  onRunCommand,
  commandRuns,
  linkSource,
}: {
  row: Row;
  canManage: boolean;
  onRunCommand: (row: Row, name: string) => void;
  commandRuns: CommandRuns;
  linkSource: (row: Row, workingDirectory: string) => Promise<string | null>;
}) {
  if (row.enabled === false) return null;
  // The platform's own row never gets Link/Unlink: bootstrapSelf owns its serve
  // shape, and editApp refuses to touch it structurally, so those controls
  // would only ever produce a 200 that changes nothing this button implies.
  // canManage mirrors the gate every other mutating control in this file uses
  // (Publish, Restart, Push to Railway): the PATCH these submit is 403'd on a
  // public board host, so the control must not render there either.
  if (showDevLinkPrompt(row, canManage)) {
    return (
      <DevLinkPrompt
        row={row}
        label={row.devLink === 'unlinked' ? 'Link source' : 'fix link'}
        linkSource={linkSource}
      />
    );
  }
  return (
    <>
      {(row.commands ?? []).map(name => (
        <CommandButton
          key={name}
          row={row}
          name={name}
          phase={commandRuns[commandKey(row.name, name)]}
          onRunCommand={onRunCommand}
        />
      ))}
    </>
  );
}

/** The one inline input shared by "Link source" (unlinked) and "fix link"
    (broken): both just resubmit `{ dev: { workingDirectory } }`, so a single
    open/value/error state serves either entry point. */
function DevLinkPrompt({
  row,
  label,
  linkSource,
}: {
  row: Row;
  label: string;
  linkSource: (row: Row, workingDirectory: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button
        variant="subtle"
        size="sm"
        aria-label={`${label} for ${row.name}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  }

  const cancel = () => {
    setOpen(false);
    setValue('');
    setError(null);
  };

  const submit = async () => {
    const workingDirectory = value.trim();
    if (!workingDirectory) return;
    setBusy(true);
    const message = await linkSource(row, workingDirectory);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setOpen(false);
    setValue('');
  };

  return (
    <span className="dev-link-input">
      <TextField
        value={value}
        onChange={ev => {
          setValue(ev.target.value);
          setError(null);
        }}
        onKeyDown={ev => {
          if (ev.key === 'Enter') submit();
          if (ev.key === 'Escape') cancel();
        }}
        placeholder="/path/to/source"
        aria-label={`source path for ${row.name}`}
        error={error}
        disabled={busy}
        inputRef={el => el?.focus()}
      />
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        disabled={busy}
        aria-label={`confirm source path for ${row.name}`}
        onClick={submit}
      >
        {ICONS['circle-check']}
      </Button>
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        disabled={busy}
        aria-label={`cancel linking ${row.name}`}
        onClick={cancel}
      >
        {ICONS.close}
      </Button>
    </span>
  );
}

/** The only way into the row's settings. Always in the tab order; board.css
    keeps it transparent until the row is hovered or holds focus.
    `registerRef` feeds the drawer's gear map, read on close to restore
    focus. */
function RowGear({
  row,
  onOpen,
  registerRef,
}: {
  row: Row;
  onOpen: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <Button
      ref={registerRef}
      variant="subtle"
      size="sm"
      iconOnly
      className="row-gear row-icon"
      aria-label={`settings for ${row.name}`}
      onClick={onOpen}
    >
      {ICONS.settings}
    </Button>
  );
}
