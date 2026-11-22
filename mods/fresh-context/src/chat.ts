import type { EngineInterface } from 'claude-code'

type Reply = { ok: boolean; handle?: string; signedOut?: boolean }

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// rt reads the session it acts for from CLAUDE_CODE_SESSION_ID. This process's own copy still
// names the session it started on, so each call passes the id that is current now. A login
// shell finds rt where a person's terminal would.
async function handoff($: EngineInterface, sessionId: string, args: string[]): Promise<Reply | null> {
  try {
    const command = ['rt', 'chat', 'handoff', ...args, '--json'].map(quote).join(' ')
    const run = await $.process.run(['/bin/zsh', '-lc', command], { env: { CLAUDE_CODE_SESSION_ID: sessionId }, timeoutMs: 10_000 })
    const last = run.stdout.trim().split('\n').pop()
    return last ? (JSON.parse(last) as Reply) : null
  } catch {
    return null
  }
}

/** The handle that is handing off, or null when the session is not signed in to chat (or rt is missing). */
export async function beginChat($: EngineInterface, sessionId: string): Promise<string | null> {
  const reply = await handoff($, sessionId, ['begin'])
  return reply?.ok && typeof reply.handle === 'string' ? reply.handle : null
}

export async function completeChat($: EngineInterface, fromSessionId: string, sessionId: string): Promise<boolean> {
  return (await handoff($, sessionId, ['complete', '--from', fromSessionId]))?.ok === true
}

export async function cancelChat($: EngineInterface, fromSessionId: string, sessionId: string): Promise<void> {
  await handoff($, sessionId, ['cancel', '--from', fromSessionId])
}
