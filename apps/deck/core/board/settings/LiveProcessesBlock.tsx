import { Badge } from '@mattstack/tui-kit';
import type { BlockProps } from './block.ts';

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
          <li key={p.id} className="live-proc">
            <span className="live-proc-kind">{p.kind}</span>
            <code className="live-proc-cmd" title={p.command}>
              {p.command}
            </code>
            {p.port != null && <span className="settings-mono">{p.port}</span>}
            <Badge intent={p.running ? 'ok' : 'bad'}>
              {p.running ? 'running' : 'down'}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
