import { existsSync, readdirSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'

import { buildMod } from './build-lib'

const root = resolve(import.meta.dir, '../..')
const MODS = join(root, 'mods')
const KIT_SRC = join(root, 'packages/mod-kit/src')

const USAGE = `usage:
  build.ts build [name] [--no-validate]   bundle mods/<name> (every mod when no name) into plugins/<name>/
  build.ts watch <name> --into <dir>      rebuild into <dir>/<name>/ whenever the mod or the kit changes`

function modNames(): string[] {
  if (!existsSync(MODS)) return []
  return readdirSync(MODS, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(MODS, d.name, 'mod.json')))
    .map(d => d.name)
}

function requireMod(name: string | undefined): string {
  if (!name || !modNames().includes(name)) throw new Error(`${name ? `no mod "${name}" in mods/` : 'name a mod'} (have: ${modNames().join(', ') || 'none'})`)
  return name
}

async function build(args: string[]): Promise<void> {
  const validate = !args.includes('--no-validate')
  const named = args.find(a => !a.startsWith('--'))
  const names = named ? [requireMod(named)] : modNames()
  for (const name of names) {
    await buildMod(join(MODS, name), join(root, 'plugins', name), { validate })
    console.log(`built plugins/${name}`)
  }
}

async function watchMod(args: string[]): Promise<void> {
  const name = requireMod(args.find(a => !a.startsWith('--')))
  const into = args[args.indexOf('--into') + 1]
  if (args.indexOf('--into') === -1 || !into) throw new Error('watch needs --into <dir>')
  const out = join(resolve(into), name)
  const rebuild = async () => {
    try {
      await buildMod(join(MODS, name), out, { validate: false })
      console.log(`built ${out}`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
    }
  }
  await rebuild()
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(rebuild, 100)
  }
  for (const dir of [join(MODS, name), KIT_SRC]) watch(dir, { recursive: true }, schedule)
  console.log(`watching mods/${name} and packages/mod-kit/src`)
}

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'build') await build(rest)
  else if (command === 'watch') await watchMod(rest)
  else {
    console.error(USAGE)
    process.exit(1)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
