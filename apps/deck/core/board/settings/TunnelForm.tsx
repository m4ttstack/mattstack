import { tunnelDomain } from '../logic.ts';
import type { BlockProps } from './block.ts';
import { RecentErrors } from './RecentErrors.tsx';

function TunnelBlock({ data }: BlockProps) {
  const domain = tunnelDomain(data);
  if (!domain) return null;
  return (
    <section data-block="tunnel" aria-label="Tunnel" className="settings-block">
      <h3 className="settings-heading">Tunnel</h3>
      <dl className="settings-facts">
        <dt>Carries</dt>
        <dd className="settings-mono">*.{domain}</dd>
      </dl>
    </section>
  );
}

/** The tunnel's reduced form: the domain it carries and its recent errors.
    Status and restart live in the header. */
export function TunnelForm(props: BlockProps) {
  return (
    <div className="settings-stack">
      <TunnelBlock {...props} />
      <RecentErrors {...props} />
    </div>
  );
}
