import type { EngineInterface } from 'claude-code'

type Reply = { ok: boolean; handle?: string; signedOut?: boolean }

const RT_MS = 10_000
// session.end hooks share a 1.5 s budget; a cancel that overran it would be cut off anyway.
const EXIT_RT_MS = 1_000
// A command that cannot start rejects at once; one that rejects later overran, and may have done its work.
const START_FAILURE_MS = 2_000

// rt reads the session it acts for from CLAUDE_CODE_SESSION_ID. This process's own copy still
// names the session it started on, so each call passes the id that is current now.
// rt on PATH first, then where mattstack installs it. Only a name that could not start moves on:
// begin and complete are writes, so a run that overran is never sent again.
async function handoff($: EngineInterface, sessionId: string, args: string[], timeoutMs = RT_MS): Promise<Reply | null> {
  const home = await $.env.get('HOME')
  for (const rt of ['rt', `${home ?? ''}/.local/bin/rt`]) {
    const started = await $.clock.now()
    let stdout: string
    try {
      stdout = (await $.process.run([rt, 'chat', 'handoff', ...args, '--json'], { env: { CLAUDE_CODE_SESSION_ID: sessionId }, timeoutMs })).stdout
    } catch {
      if ((await $.clock.now()) - started >= START_FAILURE_MS) return null
      continue
    }
    try {
      const last = stdout.trim().split('\n').pop()
      return last ? (JSON.parse(last) as Reply) : null
    } catch {
      return null
    }
  }
  return null
}

/** The handle that is handing off, or null when the session is not signed in to chat (or rt is missing). */
export async function beginChat($: EngineInterface, sessionId: string): Promise<string | null> {
  const reply = await handoff($, sessionId, ['begin'])
  return reply?.ok && typeof reply.handle === 'string' ? reply.handle : null
}

export async function completeChat($: EngineInterface, fromSessionId: string, sessionId: string): Promise<boolean> {
  return (await handoff($, sessionId, ['complete', '--from', fromSessionId]))?.ok === true
}

export async function cancelChat($: EngineInterface, fromSessionId: string, sessionId: string, opts: { onExit?: boolean } = {}): Promise<void> {
  await handoff($, sessionId, ['cancel', '--from', fromSessionId], opts.onExit ? EXIT_RT_MS : RT_MS)
}
