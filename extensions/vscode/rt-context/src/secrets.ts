/**
 * Secrets for the VS Code extension, read through the rt daemon's
 * `secrets:read` verb. The daemon owns the encrypted sops/age store
 * (lib/linear.ts's loadSecrets), the only source; it is written only by
 * `rt secrets set rt <key>`, never from here.
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { daemonQuery } from './daemonClient';
import { pickDaemonSecret, type DaemonSecretKey } from './secretsMapping';

export type { DaemonSecretKey };

const API_TOKEN_PATH = join(homedir(), '.mattstack', 'rt', 'api-token');

/** /api/secrets is token-gated (api-auth.ts + the secrets:read handler); '' on a fresh machine just fails the gate, same as a wrong token. */
function apiToken(): string {
  try {
    return readFileSync(API_TOKEN_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

// Warn once per distinct cause per extension-host lifetime: getSecret runs on
// every status-bar refresh, but collapsing daemon-down and gate-failed into
// "undefined" silently would hide an actionable problem.
const warnedOnce = new Set<string>();
function warnOnce(dedupeKey: string, message: string): void {
  if (warnedOnce.has(dedupeKey)) return;
  warnedOnce.add(dedupeKey);
  console.warn(`[rt-context] ${message}`);
}

/** A secret from rt's store, or undefined when it is unset or the daemon cannot give it. */
export async function getSecret(key: DaemonSecretKey): Promise<string | undefined> {
  const response = await daemonQuery('/api/secrets', { headers: { 'X-RT-Token': apiToken() } });
  const result = pickDaemonSecret(response, key);

  switch (result.status) {
    case 'ok':
      return result.value;
    case 'unset':
      return undefined;
    case 'daemon-down':
      warnOnce('daemon-down', 'rt daemon unreachable, so no Linear or GitLab token is available');
      return undefined;
    case 'gate-failed':
      warnOnce(
        `gate-failed:${result.error}`,
        `rt daemon refused the secrets request (${result.error}). Check ~/.mattstack/rt/api-token`,
      );
      return undefined;
  }
}
