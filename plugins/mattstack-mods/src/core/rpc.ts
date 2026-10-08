import type { Timer } from 'claude-code'
import type { ModApi } from './hub.ts'

/** `$.http.fetch` cuts a request off at 30 s, so no call may wait longer than this. */
export const MAX_CALL_MS = 25_000
const DEFAULT_CALL_MS = 5_000

/**
 * A daemon answer. `transport` is this side's code for a call that never got
 * one (refused connection, reset, timeout, unreadable body); every other code
 * is the daemon's own `failure.code`.
 */
export type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

/** The rule in packages/rt-client/src/transport.ts: RT_DAEMON_SOCK, else rt.sock under HOME. */
export async function daemonSocket(api: ModApi): Promise<string | null> {
  const override = await api.env.daemonSock()
  if (override) return override
  const home = await api.env.home()
  return home ? `${home}/.mattstack/rt/rt.sock` : null
}

const transport = (message: string): Outcome<never> => ({ ok: false, error: { code: 'transport', message } })

function parse<T>(text: string): Outcome<T> {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return transport(`the daemon's answer was not JSON: ${text.slice(0, 120)}`)
  }
  if (body === null || typeof body !== 'object') return transport('the daemon answered with no envelope')
  const env = body as { ok?: unknown; data?: unknown; error?: unknown; failure?: { code?: unknown; message?: unknown } }
  if (env.ok === true) return { ok: true, data: env.data as T }
  const code = typeof env.failure?.code === 'string' ? env.failure.code : 'failed'
  const message = typeof env.failure?.message === 'string' ? env.failure.message : String(env.error ?? 'the daemon declined')
  return { ok: false, error: { code, message } }
}

/** POSTs `payload` to the daemon verb over rt.sock; never throws. */
export async function call<T>(api: ModApi, verb: string, payload: unknown, timeoutMs = DEFAULT_CALL_MS): Promise<Outcome<T>> {
  const limit = Math.min(Math.max(timeoutMs, 1), MAX_CALL_MS)
  let socketPath: string | null
  try {
    socketPath = await daemonSocket(api)
  } catch (err) {
    return transport(`cannot read the daemon socket's path: ${String(err)}`)
  }
  if (!socketPath) return transport('neither RT_DAEMON_SOCK nor HOME is set')

  let timer: Timer | undefined
  const timedOut = new Promise<Outcome<T>>(resolve => {
    timer = api.clock.after(limit, () => resolve(transport(`${verb} had no answer within ${limit} ms`)))
  })
  const answered = (async (): Promise<Outcome<T>> => {
    try {
      const res = await api.http.fetch(`http://localhost/${verb}`, {
        method: 'POST',
        socketPath,
        headers: { 'Content-Type': 'application/json', 'X-RT-Client': 'mattstack-mods' },
        body: JSON.stringify(payload ?? {}),
      })
      return parse<T>(res.text)
    } catch (err) {
      return transport(err instanceof Error ? err.message : String(err))
    }
  })()
  try {
    return await Promise.race([answered, timedOut])
  } finally {
    timer?.cancel()
  }
}
