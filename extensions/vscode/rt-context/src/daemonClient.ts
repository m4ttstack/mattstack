/**
 * The rt daemon's REST API and broadcast channel, both on 127.0.0.1 at the
 * port the daemon binds. Every call degrades to null or silence when the
 * daemon is down.
 */

import * as vscode from 'vscode';
import { subscribe } from '@mattstack/rt-client';
import { daemonHttpBase, daemonWsUrl } from './daemonAddress';

const REQUEST_TIMEOUT_MS = 2000;

export interface DaemonResponse {
  ok: boolean;
  data?: any;
  error?: string;
}

/** Query the daemon's REST API. Returns null if the daemon is unavailable. */
export async function daemonQuery(
  path: string,
  options?: { method?: string; body?: any; headers?: Record<string, string> },
): Promise<DaemonResponse | null> {
  const url = `${daemonHttpBase()}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const response = await fetch(url, {
      method: options?.method ?? 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        ...(options?.body ? { 'Content-Type': 'application/json' } : undefined),
        ...options?.headers,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    return await response.json() as DaemonResponse;
  } catch {
    return null;
  }
}

/**
 * Runs `onRefresh` after each daemon cache refresh (its `status` broadcast),
 * reconnecting until disposed. The port is read once here, so a port change
 * takes a window reload. An extension host with no global WebSocket gets no
 * live updates rather than a failed activation.
 */
export function onDaemonRefresh(onRefresh: () => void): vscode.Disposable {
  try {
    const stop = subscribe((type) => {
      if (type === 'status') onRefresh();
    }, { wsUrl: daemonWsUrl() });
    return new vscode.Disposable(stop);
  } catch (err) {
    console.warn(`[rt-context] no live updates from the rt daemon: ${err instanceof Error ? err.message : String(err)}`);
    return new vscode.Disposable(() => {});
  }
}
