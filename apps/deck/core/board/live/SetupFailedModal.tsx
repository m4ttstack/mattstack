import { Alert, Button, Modal } from '@mattstack/tui-kit';
import type { LiveState } from './useLive.ts';

export function SetupFailedModal({
  live,
  onFullLog,
}: {
  live: LiveState;
  onFullLog: (name: string) => void;
}) {
  const m = live.modal;
  if (!m || m.mode !== 'failed' || !m.row.liveSetup) return null;
  const setup = m.row.liveSetup;
  const title = `Couldn't set up ${setup.branch ?? 'that worktree'}`;
  return (
    <Modal
      title={
        <span className="live-modal-title">
          {title}
          <span className="muted">
            {m.row.name} is still running its normal code.
          </span>
        </span>
      }
      ariaLabel={title}
      onClose={live.close}
      className="live-modal"
    >
      <div className="modal-form">
        <pre className="live-log">{setup.log.slice(-6).join('\n')}</pre>
        {m.error && <Alert intent="bad">{m.error}</Alert>}
      </div>
      <footer className="modal-footer">
        <Button
          type="button"
          variant="subtle"
          className="footer-start"
          onClick={() => onFullLog(m.row.name)}
        >
          Full log
        </Button>
        <Button
          type="button"
          disabled={m.busy}
          onClick={() => void live.dismiss()}
        >
          Dismiss
        </Button>
        <Button
          type="button"
          variant="filled"
          intent="accent"
          busy={m.busy}
          disabled={!m.picked}
          onClick={() => void live.submit()}
        >
          Try Again
        </Button>
      </footer>
    </Modal>
  );
}
