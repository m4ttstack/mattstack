// A hand-built engine `$` for the hub and link tests: a manual clock, a
// scripted rt.sock and in-memory state. Not a test file itself.

export type Hook = (...args: any[]) => Promise<any>

/** What the scripted daemon answers: a reply envelope, or an Error the fetch rejects with. */
export type Reply = Record<string, unknown> | Error
export type Respond = (verb: string, body: any) => Reply | Promise<Reply>
export type Sent = { verb: string; socketPath: string | undefined; body: any }

export async function flush(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

export function fakeClock(start = 1_000_000) {
  let now = start
  let seq = 0
  const timers = new Map<number, { at: number; every: number | undefined; fn: () => void }>()
  const add = (ms: number, fn: () => void, every?: number) => {
    const id = ++seq
    timers.set(id, { at: now + ms, every, fn })
    return { cancel: () => void timers.delete(id) }
  }
  return {
    now: () => now,
    after: (ms: number, fn: () => void) => add(ms, fn),
    every: (ms: number, fn: () => void) => add(ms, fn, ms),
    /** The periods of the intervals still armed. */
    intervals: () => [...timers.values()].flatMap(t => (t.every === undefined ? [] : [t.every])),
    /** Moves time on by `ms`, firing every timer that falls due on the way. */
    async advance(ms: number) {
      const end = now + ms
      await flush()
      for (;;) {
        let next: [number, { at: number; every: number | undefined; fn: () => void }] | undefined
        for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry
        if (!next) break
        const [id, timer] = next
        now = timer.at
        if (timer.every === undefined) timers.delete(id)
        else timer.at = now + timer.every
        timer.fn()
        await flush()
      }
      now = end
    },
  }
}

export function harness(options: { version?: string; env?: Record<string, string>; respond?: Respond } = {}) {
  const version = options.version ?? '2.1.293'
  const env: Record<string, string> = { HOME: '/home/u', ...options.env }
  const hooks = new Map<string, Hook>()
  const on: any = (event: string, hook: Hook) => {
    hooks.set(event, hook)
  }
  const logs: { text: string; to: string | undefined }[] = []
  const clock = fakeClock()
  const sent: Sent[] = []
  const state = new Map<string, unknown>()
  const session = { id: 'sess-1' }
  let links = 0
  const defaults: Respond = (verb, body) => {
    if (verb === 'session:register') return { ok: true, data: { linkId: `ml-${++links}`, blocks: body.blocks } }
    if (verb === 'events:wait') return { ok: true, data: { events: [], cursor: body.after ?? 0 } }
    return { ok: true, data: {} }
  }
  const script = { respond: options.respond ?? defaults }
  const $: any = {
    ui: {
      log: (text: string, opts?: { to?: string }) => logs.push({ text, to: opts?.to }),
      resolve: () => ({
        Box: (props: Record<string, unknown>) => ({ element: 'Box', props }),
        Text: (props: Record<string, unknown>) => ({ element: 'Text', props }),
      }),
    },
    session: {
      version: async () => ({ version, base: version, builtAt: '2026-10-07T00:00:00.000Z' }),
      id: async () => session.id,
      cwd: async () => '/repo',
      root: async () => '/repo',
    },
    http: {
      fetch: async (url: string, init: { body?: string; socketPath?: string }) => {
        const verb = url.replace(/^http:\/\/localhost\//, '')
        const body = init.body === undefined ? undefined : JSON.parse(init.body)
        sent.push({ verb, socketPath: init.socketPath, body })
        const reply = await script.respond(verb, body)
        if (reply instanceof Error) throw reply
        return { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) }
      },
    },
    clock: { now: async () => clock.now(), after: clock.after, every: clock.every },
    env: { get: async (name: string) => env[name] },
    state: {
      get: async (ref: { key: string }) => ({ value: state.get(ref.key), version: state.has(ref.key) ? 1 : 0 }),
      set: async (ref: { key: string }, value: unknown) => {
        state.set(ref.key, value)
        return { isSet: true, version: 1 }
      },
    },
  }
  const fire = (event: string, e: unknown, next: Hook): Promise<any> => {
    const hook = hooks.get(event)
    if (!hook) throw new Error(`the hub registered no ${event} hook`)
    return hook($, e, next)
  }
  return {
    on,
    $,
    logs,
    clock,
    sent,
    state,
    session,
    defaults,
    script,
    fire,
    verbs: (verb: string) => sent.filter(s => s.verb === verb),
    start: (isInteractive = true) =>
      fire('session.start', { cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive }, async () => ({ cwd: '/repo' })),
    clear: (sessionId: string) => {
      session.id = sessionId
      return fire(
        'classic.SessionStart',
        { session_id: sessionId, transcript_path: '/t.jsonl', cwd: '/repo', hook_event_name: 'SessionStart', source: 'clear' },
        async () => ({}),
      )
    },
    /** A classic SessionStart other than a clear (resume, compact): the session id stays. */
    sessionStart: (source: string, sessionId = session.id) =>
      fire(
        'classic.SessionStart',
        { session_id: sessionId, transcript_path: '/t.jsonl', cwd: '/repo', hook_event_name: 'SessionStart', source },
        async () => ({}),
      ),
    end: (reason: string) =>
      fire('session.end', { reason, sessionId: session.id, resume: { id: session.id } }, async () => ({ sessionId: session.id })),
  }
}

export function recorder(answer: unknown) {
  const seen: unknown[] = []
  const next: Hook = async e => {
    seen.push(e)
    return answer
  }
  return { seen, next }
}
