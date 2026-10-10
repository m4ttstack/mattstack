import { useState } from 'react';

import { Badge, Button, Icon } from '@mattstack/tui-kit';
import { SCROLL_TEXT } from '../icons.ts';
import { getProcessLog } from '../live/live-api.ts';
import type { Row } from '../logic.ts';
import { Tooltip } from '../Tooltip.tsx';
import type { BlockProps } from './block.ts';

type Process = NonNullable<Row['live']>['processes'][number];
type Log = { lines: string[]; error: string | null } | 'loading';

function ProcessRow({ app, proc }: { app: string; proc: Process }) {
  const [log, setLog] = useState<Log | null>(null);
  const toggle = () => {
    if (log) {
      setLog(null);
      return;
    }
    setLog('loading');
    void getProcessLog(app, proc.id).then(setLog);
  };
  const text =
    log === null || log === 'loading'
      ? ''
      : (log.error ?? (log.lines.length ? log.lines.join('\n') : 'No output.'));
  return (
    <li className="live-proc-item">
      <div className="live-proc">
        <span className="live-proc-kind">{proc.kind}</span>
        <code className="live-proc-cmd" title={proc.command}>
          {proc.command}
        </code>
        {proc.port != null && (
          <span className="settings-mono">{proc.port}</span>
        )}
        <Badge intent={proc.running ? 'ok' : 'bad'}>
          {proc.running ? 'running' : 'down'}
        </Badge>
        <Tooltip tip="Logs">
          <Button
            variant="subtle"
            size="sm"
            iconOnly
            aria-expanded={log !== null}
            aria-label={`${proc.id} logs`}
            onClick={toggle}
          >
            <Icon d={SCROLL_TEXT} />
          </Button>
        </Tooltip>
      </div>
      {log !== null && log !== 'loading' && (
        <pre
          className="settings-errors-tail live-proc-log"
          aria-label={`${proc.id} log`}
        >
          {text}
        </pre>
      )}
    </li>
  );
}

export function LiveProcessesBlock({ row }: BlockProps) {
  if (!row.live) return null;
  return (
    <section
      data-block="live-processes"
      aria-label="Live processes"
      className="settings-block"
    >
      <div className="settings-block-head">
        <h3 className="settings-heading">Live processes</h3>
        <p className="settings-note">
          From the app's manifest. Deck restarts one that stops.
        </p>
      </div>
      <ul className="live-procs">
        {row.live.processes.map(p => (
          <ProcessRow key={p.id} app={row.name} proc={p} />
        ))}
      </ul>
    </section>
  );
}
