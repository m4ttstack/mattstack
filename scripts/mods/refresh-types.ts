import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(import.meta.dir, '..', '..')
const FILES = ['claude-code', 'claude-code-tools']
// Only claude-code's snapshot opens with the version line; the tools file has no header to check.
const VERSIONED = 'claude-code'

// The version the plugin-gate-form job installs: the mod API the snapshot must describe.
export function pinnedVersion(workflow: string): string | undefined {
  const job = workflow.split(/^ {2}plugin-gate-form:/m)[1]?.split(/^ {2}\S/m)[0]
  return job?.match(/claude-code@(\d+\.\d+\.\d+)/)?.[1]
}

export function writtenBy(dts: string): string | undefined {
  return dts.split('\n', 1)[0]?.match(/^\/\/ Written by Claude Code (\S+?)\.$/)?.[1]
}

function main(): number {
  const dir = process.argv[2]
  if (!dir) {
    console.error('usage: refresh-types.ts <loaded-mod-dir>')
    return 1
  }
  const pinned = pinnedVersion(readFileSync(join(root, '.github/workflows/checks.yml'), 'utf8'))
  if (!pinned) {
    console.error('no claude-code version pinned in the plugin-gate-form job of checks.yml')
    return 1
  }
  for (const name of FILES) {
    const from = join(dir, '.claude-plugin', 'types', name, 'index.d.ts')
    const found = writtenBy(readFileSync(from, 'utf8'))
    if (name === VERSIONED && found !== pinned) {
      console.error(`${from} is written by Claude Code ${found ?? '(unknown)'}, CI pins ${pinned}`)
      return 1
    }
    const to = join(root, 'packages/mod-kit/types', name, 'index.d.ts')
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    console.log(`copied ${name} (${pinned})`)
  }
  return 0
}

if (import.meta.main) process.exit(main())
