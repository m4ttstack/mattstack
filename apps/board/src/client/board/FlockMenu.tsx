import { useEffect, useState } from 'react';

import { ContextMenu, Tooltip } from '@mattstack/tui-kit';
import type { BoardMR } from '../../data.ts';
import { postAction } from '../api.ts';
import { FLOCK_ICON_URL } from './flock-icon.ts';

type FlockAction = 'shell' | 'claude' | 'resume' | 'command';

interface FlockMenuData {
  tree: string | null;
  resume: { livePane: string | null; worktreeGone: boolean } | null;
  commands: { label: string; command: string }[];
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; data: FlockMenuData }
  | { kind: 'failed'; message: string };

type Pending =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'failed'; message: string };

function failure(r: { status: number; text: string }): string {
  return (
    r.text || (r.status ? `failed (${r.status})` : "couldn't reach the board")
  );
}

/** The row's flock button: a menu of ways to open this MR's worktree in a
    focused Flock tab. Only the seat's own MRs, on a local board, get it. */
export function FlockButton({ mr }: { mr: BoardMR }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  if (!mr.webUrl) return null;
  return (
    <>
      <Tooltip tip="open in flock">
        <button
          type="button"
          className="tui-flock-button tui-copy-inline"
          data-active={at ? '' : undefined}
          title=""
          aria-label="open in flock"
          onClick={e => {
            e.stopPropagation();
            const box = e.currentTarget.getBoundingClientRect();
            setAt(at ? null : { x: box.left, y: box.bottom + 4 });
          }}
        >
          <img src={FLOCK_ICON_URL} alt="" width={16} height={16} />
        </button>
      </Tooltip>
      {at && (
        <FlockMenu
          mr={mr as BoardMR & { webUrl: string }}
          x={at.x}
          y={at.y}
          onClose={() => setAt(null)}
        />
      )}
    </>
  );
}

function FlockMenu({
  mr,
  x,
  y,
  onClose,
}: {
  mr: BoardMR & { webUrl: string };
  x: number;
  y: number;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [pending, setPending] = useState<Pending>({ kind: 'idle' });
  const target = { mrUrl: mr.webUrl, iid: mr.iid };

  useEffect(() => {
    let live = true;
    void postAction('/flock/menu', target).then(r => {
      if (!live) return;
      setLoad(
        r.ok
          ? { kind: 'ready', data: JSON.parse(r.text) as FlockMenuData }
          : { kind: 'failed', message: failure(r) }
      );
    });
    return () => {
      live = false;
    };
    // The menu loads once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, action: FlockAction, index?: number) => {
    setPending({ kind: 'busy', label });
    const r = await postAction('/flock/open', { ...target, action, index });
    if (r.ok) onClose();
    else setPending({ kind: 'failed', message: failure(r) });
  };

  const busy = pending.kind === 'busy';
  const data = load.kind === 'ready' ? load.data : null;
  const noTree = !!data && !data.tree;
  const item = (
    label: string,
    action: FlockAction,
    opts: { index?: number; hint?: string; disabled?: boolean } = {}
  ) => (
    <ContextMenu.Item
      key={`${action}-${opts.index ?? ''}`}
      label={busy && pending.label === label ? `${label}…` : label}
      hint={opts.hint}
      disabled={busy || opts.disabled}
      onClick={() => void run(label, action, opts.index)}
    />
  );

  return (
    <ContextMenu
      x={x}
      y={y}
      ariaLabel={`open !${mr.iid} in flock`}
      onClose={onClose}
    >
      <ContextMenu.Label>open in flock</ContextMenu.Label>
      {load.kind === 'loading' && (
        <ContextMenu.Item label="looking for the worktree…" disabled />
      )}
      {load.kind === 'failed' && (
        <ContextMenu.Item label={load.message} disabled />
      )}
      {data && (
        <>
          {noTree && (
            <ContextMenu.Item
              label="no worktree yet: picking one creates it"
              disabled
            />
          )}
          {item('shell', 'shell')}
          {item('claude', 'claude')}
          {data.resume &&
            item('resume work session', 'resume', {
              hint: data.resume.livePane
                ? 'running'
                : data.resume.worktreeGone
                  ? 'worktree gone'
                  : undefined,
              disabled: !data.resume.livePane && data.resume.worktreeGone,
            })}
          {data.commands.length > 0 && <ContextMenu.Separator />}
          {data.commands.map((c, index) =>
            item(c.label, 'command', { index, hint: c.command })
          )}
        </>
      )}
      {busy && noTree && (
        <ContextMenu.Item
          label="creating the worktree; setup keeps running after"
          disabled
        />
      )}
      {pending.kind === 'failed' && (
        <ContextMenu.Item label={pending.message} disabled />
      )}
    </ContextMenu>
  );
}
