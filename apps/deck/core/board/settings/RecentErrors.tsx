import { CopyButton, ICONS } from '@mattstack/tui-kit';
import type { BlockProps } from './block.ts';

export function RecentErrors({ row, blocks }: BlockProps) {
  if (!blocks.errors) return null;
  const setupFailed = row.liveSetup?.state === 'failed';
  const stderr = setupFailed ? row.liveSetup!.log : (row.service?.stderr ?? []);
  const tail = stderr.join('\n');
  return (
    <section
      data-block="errors"
      aria-label="Recent errors"
      className="settings-block"
    >
      <h3 className="settings-heading">
        {setupFailed ? 'Setup log' : 'Recent errors'}
      </h3>
      {stderr.length === 0 ? (
        <p className="settings-errors-empty">
          <span className="t-ok">{ICONS['circle-check']}</span>
          No errors. Recent stderr shows here when a health check fails.
        </p>
      ) : (
        <>
          <pre className="settings-errors-tail">{tail}</pre>
          <div className="settings-errors-foot">
            <span className="settings-note">
              {setupFailed ? 'setup output' : 'stderr tail, newest last, live'}
            </span>
            <CopyButton text={tail} title="Copy" label="Copy" />
          </div>
        </>
      )}
    </section>
  );
}
