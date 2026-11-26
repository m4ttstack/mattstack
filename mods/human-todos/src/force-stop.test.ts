import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { killGroup, wrapped } from './wrapper'

// A herdr pane is an interactive zsh on a pty, which puts each typed command in its own process group; `script` gives one here.
// The call is BSD script's, and Linux CI has neither it nor zsh.
test.skipIf(process.platform !== 'darwin')("Force stop's kill ends a real run of a script that ignores INT and TERM within a second", async () => {
  const home = mkdtempSync(join(tmpdir(), 'todos-force-'))
  const typed = wrapped('tok1', "trap '' INT TERM; sleep 60", home)
  const child = Bun.spawn(['script', '-q', '/dev/null', 'zsh', '-fic', typed], {
    env: { HOME: home, PATH: '/usr/bin:/bin', ZDOTDIR: home },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  })
  try {
    const reader = child.stdout.getReader()
    let seen = ''
    let pgid: number | undefined
    while (pgid === undefined) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`the run ended before printing its pid: ${seen}`)
      seen += new TextDecoder().decode(value)
      const found = /__todo_pid_tok1 (\d+)/.exec(seen)?.[1]
      if (found) pgid = Number(found)
    }
    reader.releaseLock()
    // The script sets its trap before it starts sleep, so a sleep in the group means the kill meets a script ignoring INT and TERM.
    const sleeping = () => Bun.spawnSync(['pgrep', '-g', String(pgid), '-x', 'sleep']).exitCode === 0
    for (const startedAt = Date.now(); !sleeping(); await Bun.sleep(20)) {
      if (Date.now() - startedAt > 5000) throw new Error('the script never started sleep')
    }

    const [cmd, flag, line] = killGroup(pgid)
    const kill = Bun.spawnSync([cmd ?? '', flag ?? '', line ?? ''])
    const killedAt = Date.now()
    expect(kill.exitCode).toBe(0)
    await Promise.race([child.exited, Bun.sleep(1000)])
    expect(Date.now() - killedAt).toBeLessThan(1000)
    expect(Bun.spawnSync(['pgrep', '-g', String(pgid)]).exitCode).toBe(1)
  } finally {
    child.kill('SIGKILL')
    rmSync(home, { recursive: true, force: true })
  }
}, 10_000)
