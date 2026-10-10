import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Alert, Badge, Button, ICONS, ToastHost } from '@mattstack/tui-kit';
import { AppsTable } from './AppsTable.tsx';
import { GoLiveModal } from './live/GoLiveModal.tsx';
import { SetupFailedModal } from './live/SetupFailedModal.tsx';
import { sublineHealthy, type Row } from './logic.ts';
import { AddAppModal, RemoveConfirm, UnlinkConfirm } from './modals.tsx';
import { AppSettingsModal } from './settings/AppSettingsModal.tsx';
import { SettingsModal } from './SettingsModal.tsx';
import { Tooltip } from './Tooltip.tsx';
import { UpdateStrip } from './UpdateStrip.tsx';
import { useBoardState } from './useBoardState.ts';

/** Aggregate cloudflare-tunnel health, collapsed to a single header badge that
    opens the tunnel's settings on click (the tunnel has no row of its own). */
function TunnelBadge({
  tunnels,
  isRestarting,
  onOpen,
}: {
  tunnels: Row[];
  isRestarting: (row: Row) => boolean;
  onOpen: (name: string, opener: HTMLElement) => void;
}) {
  if (!tunnels.length) return null;
  const restarting = tunnels.some(isRestarting);
  const health = tunnels[0]?.health ?? null;
  const up = tunnels.every(t => t.service && t.service.pid !== null);
  const intent = restarting ? 'warn' : (health?.tone ?? (up ? 'ok' : 'bad'));
  const label = restarting
    ? 'restarting…'
    : (health?.detail ?? (up ? 'up' : 'down'));
  const hint = health?.hint
    ? `${tunnels.map(t => t.name).join(', ')} · ${health.hint}`
    : null;
  const btn = (
    <button
      className="tunnel-badge"
      onClick={e => onOpen(tunnels[0]!.name, e.currentTarget)}
      aria-label={`cloudflare tunnel ${label}`}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </svg>
      <span className="muted tunnel-label">tunnel</span>
      <Badge intent={intent}>{label}</Badge>
    </button>
  );
  return hint ? <Tooltip tip={hint}>{btn}</Tooltip> : btn;
}

export function Board() {
  const mainRef = useRef<HTMLElement>(null);
  const board = useBoardState(mainRef);
  const {
    data,
    sections,
    tunnels,
    subline,
    isRestarting,
    reloadingProxy,
    onProxyReload,
    openAdd,
    proxyNotice,
  } = board;

  const gearRefs = useRef(new Map<string, HTMLButtonElement>()).current;
  const registerGear = (name: string, el: HTMLButtonElement | null) => {
    if (el) gearRefs.set(name, el);
    else gearRefs.delete(name);
  };
  const [open, setOpen] = useState<{
    id: number;
    name: string;
    /** The name before a saved rename, until a refresh carries the new one. */
    was?: string;
    opener: HTMLElement | null;
  } | null>(null);
  const openCount = useRef(0);
  const [showSettings, setShowSettings] = useState(false);
  const allRows = useMemo(
    () => [...sections.flatMap(s => s.rows), ...tunnels],
    [sections, tunnels]
  );
  const openSettings = useCallback(
    (name: string, opener?: HTMLElement) =>
      setOpen({
        id: ++openCount.current,
        name,
        opener: opener ?? gearRefs.get(name) ?? null,
      }),
    [gearRefs]
  );
  const closeSettings = useCallback(() => setOpen(null), []);
  const followRename = useCallback(
    (name: string) =>
      setOpen(o => (o && o.name !== name ? { ...o, name, was: o.name } : o)),
    []
  );
  const findRow = (name: string | undefined) =>
    allRows.find(r => r.name === name) ?? null;
  const openRow = open ? (findRow(open.name) ?? findRow(open.was)) : null;
  useEffect(() => {
    if (open?.was && openRow?.name === open.name)
      setOpen(o => o && { id: o.id, name: o.name, opener: o.opener });
  }, [open, openRow]);
  const healthy = data ? sublineHealthy(data) : null;

  return (
    <main
      className="board"
      ref={mainRef}
      tabIndex={-1}
      data-board-ready={data != null ? '' : undefined}
    >
      <header className="board-header">
        <div className="board-title">
          <img
            className="board-logo"
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
          />
          <h1>Deck</h1>
        </div>
        <span className="header-actions">
          <TunnelBadge
            tunnels={tunnels}
            isRestarting={isRestarting}
            onOpen={openSettings}
          />
          {data && data.canManage && (
            <>
              <Button size="sm" busy={reloadingProxy} onClick={onProxyReload}>
                {reloadingProxy ? 'restarting…' : 'reload proxy'}
              </Button>
              <Button size="sm" onClick={openAdd}>
                {ICONS.plus} add app
              </Button>
            </>
          )}
          <Tooltip tip="Deck settings">
            <Button
              size="sm"
              iconOnly
              aria-label="Deck settings"
              onClick={() => setShowSettings(true)}
            >
              {ICONS.settings}
            </Button>
          </Tooltip>
        </span>
      </header>
      <p className="board-subline">
        {healthy ? (
          <>
            <span className={healthy.ok ? 't-ok' : 't-bad'}>
              {healthy.text}
            </span>
            {subline.length > healthy.text.length && (
              <span className="subline-rest">
                {subline.slice(healthy.text.length).replace(/^\s*·\s*/, '')}
              </span>
            )}
          </>
        ) : (
          subline
        )}
      </p>
      {proxyNotice && (
        <Alert intent={proxyNotice.kind} command={proxyNotice.command}>
          {proxyNotice.message}
        </Alert>
      )}

      {data != null && (
        <>
          {sections.map((section, i) => (
            <section key={section.key} className={i === 0 ? undefined : 'mt-6'}>
              {section.title && (
                <h2 className="section-title">
                  {section.title}
                  {section.key === 'mattstack' && data.devMode && (
                    <Tooltip tip="These apps run from their linked source">
                      <Badge intent="warn">dev mode</Badge>
                    </Tooltip>
                  )}
                </h2>
              )}
              {/* The panel, not the table, carries the card so the update
                  strip and the table read as one surface: the kit Table
                  renders its children inside <table>. */}
              <div className="apps-panel">
                {section.key === 'mattstack' && (
                  <UpdateStrip
                    rows={section.rows}
                    canManage={data.canManage}
                    run={board.redeployAllRun}
                    onRedeployAll={board.redeployAll}
                  />
                )}
                <AppsTable
                  section={section}
                  showHead={i === 0}
                  data={data}
                  board={board}
                  onOpenRow={openSettings}
                  registerGear={registerGear}
                />
              </div>
            </section>
          ))}
          {open && (
            <AppSettingsModal
              key={open.id}
              row={openRow}
              data={data}
              board={board}
              onClose={closeSettings}
              onRenamed={followRename}
              returnFocusTo={() =>
                open.opener?.isConnected
                  ? open.opener
                  : (gearRefs.get(open.name) ?? null)
              }
              fallbackFocusRef={mainRef}
            />
          )}
        </>
      )}
      <AddAppModal board={board} />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <RemoveConfirm board={board} />
      <UnlinkConfirm board={board} />
      <GoLiveModal live={board.live} />
      <SetupFailedModal
        live={board.live}
        onFullLog={name => {
          board.live.close();
          openSettings(name);
        }}
      />
      <ToastHost toasts={board.toasts} />
    </main>
  );
}
