import { useRef } from 'react';

import {
  Alert,
  Button,
  Icon,
  Modal,
  SearchSelect,
  Spinner,
} from '@mattstack/tui-kit';
import { GIT_BRANCH, HOUSE, RADIO } from '../icons.ts';
import type { SourceRow } from './live-api.ts';
import { currentSource, type LiveState } from './useLive.ts';

function items(sources: SourceRow[]) {
  const worktrees = sources.filter(s => !s.main).length;
  return sources.map(s => ({
    value: s.path,
    label: s.main ? 'main' : (s.branch ?? s.path),
    icon: <Icon d={s.main ? HOUSE : GIT_BRANCH} />,
    ...(s.main ? {} : { group: `worktrees · ${worktrees}` }),
    detail: s.main ? (
      'shared checkout'
    ) : s.liveApps.length ? (
      <span className="t-accent">{s.liveApps.join(', ')} is live here</span>
    ) : s.needsSetup ? (
      <span className="t-warn">needs setup</span>
    ) : null,
  }));
}

// The Modal closes on any Escape or outside press, including the one that
// only means to close the open source list.
function listOpen(frame: HTMLElement | null): boolean {
  return !!frame?.querySelector(
    '[data-part="search-select-popup"]:not([data-closed])'
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function GoLiveModal({ live }: { live: LiveState }) {
  const frame = useRef<HTMLDivElement>(null);
  const m = live.modal;
  if (!m || m.mode === 'failed') return null;
  const isLive = m.mode === 'live' && m.row.live != null;
  const picked = m.sources?.find(s => s.path === m.picked) ?? null;
  const unchanged =
    isLive && m.sources != null && m.picked === currentSource(m.row, m.sources);
  const title = isLive ? `${m.row.name} is live` : `Run ${m.row.name} live`;
  return (
    <Modal
      title={
        <span className="live-modal-title">
          {title}
          <span className="muted">
            {isLive
              ? 'It reloads as you edit. Pick other code to switch to it.'
              : 'Pick the code to run. It reloads as you edit.'}
          </span>
        </span>
      }
      ariaLabel={title}
      onClose={() => {
        if (!listOpen(frame.current)) live.close();
      }}
      className="live-modal"
      ref={frame}
    >
      <form
        onSubmit={ev => {
          ev.preventDefault();
          void live.submit();
        }}
      >
        <div className="modal-form">
          {m.sources == null ? (
            <Spinner />
          ) : (
            <SearchSelect
              label="Code to run"
              items={items(m.sources)}
              value={m.picked}
              onValueChange={live.pick}
              searchPlaceholder="Search worktrees"
              emptyText="No worktree matches"
              footer={
                <>
                  <span>
                    <kbd>↑↓</kbd> move
                  </span>
                  <span>
                    <kbd>↵</kbd> choose
                  </span>
                  <span>
                    <kbd>esc</kbd> close
                  </span>
                </>
              }
            />
          )}
          <div className="live-help">
            {isLive && (
              <p className="muted">
                Running since {formatTime(m.row.live!.startedAt)}.
              </p>
            )}
            {picked?.needsSetup && <p className="t-warn">Needs setup first.</p>}
            {picked && !picked.main && (
              <p className="muted">Worktrees use your real data.</p>
            )}
          </div>
          {m.error && <Alert intent="bad">{m.error}</Alert>}
        </div>
        <footer className="modal-footer">
          {isLive && (
            <Button
              type="button"
              variant="subtle"
              intent="bad"
              className="footer-start"
              disabled={m.busy}
              onClick={() => void live.stop()}
            >
              Stop Live
            </Button>
          )}
          <Button type="button" onClick={live.close}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="filled"
            intent="accent"
            busy={m.busy}
            disabled={!m.picked || unchanged}
          >
            <Icon d={RADIO} />
            {isLive ? 'Switch' : 'Go Live'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
