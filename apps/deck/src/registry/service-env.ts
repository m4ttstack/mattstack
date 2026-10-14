import { MATTSTACK_TLD } from '../../core/discover.ts';
import { isDevMode } from '../api/dev-mode.ts';
import { isMattstackOwned, type AppRecord } from './records.ts';

export const CANONICAL_HOST_ENV = 'MATTSTACK_CANONICAL_HOST';
export const FLAVOR_ENV = 'MATTSTACK_FLAVOR';

/** The launchd environment for a supervised record: manifest env first, then
    the values deck owns (PORT, and for a mattstack app the host its .localhost
    alias redirects to and the flavor of the app bundle running deck), which a
    manifest never overrides. */
export function serviceEnv(
  record: AppRecord,
  dev: boolean = isDevMode()
): Record<string, string> {
  const env: Record<string, string> = {
    ...(record.env ?? {}),
    PORT: String(record.port),
  };
  if (isMattstackOwned(record)) {
    env[CANONICAL_HOST_ENV] = `${record.name}.${MATTSTACK_TLD}`;
    env[FLAVOR_ENV] = dev ? 'dev' : 'prod';
  }
  return env;
}
