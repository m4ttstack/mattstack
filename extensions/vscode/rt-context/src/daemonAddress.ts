import { getSetting } from '@mattstack/rt-client';

const DEFAULT_PORT = 9401;
const MEMO_MS = 60_000;

function validPort(value: unknown): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/** The daemon's port, picked the way the daemon binds it (lib/daemon-config.ts): RT_API_PORT, then rt.apiPort, then 9401. */
export function daemonPort(
  env: Record<string, string | undefined> = process.env,
  readSetting: () => unknown = () => getSetting<number>('rt.apiPort').value,
): number {
  const fromEnv = validPort(env.RT_API_PORT);
  if (fromEnv) return fromEnv;
  try {
    return validPort(readSetting()) ?? DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

let memo: { port: number; at: number } | null = null;

function currentPort(): number {
  const now = Date.now();
  if (!memo || now - memo.at >= MEMO_MS) memo = { port: daemonPort(), at: now };
  return memo.port;
}

/** The daemon binds 127.0.0.1 only, so `localhost` would miss it wherever that name resolves to ::1 first. */
export function daemonHttpBase(): string {
  return `http://127.0.0.1:${currentPort()}`;
}

export function daemonWsUrl(): string {
  return `ws://127.0.0.1:${currentPort()}/ws`;
}
